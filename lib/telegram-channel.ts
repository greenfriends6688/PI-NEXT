/**
 * fork:bot-channel —— Telegram 渠道的**真实现**（长轮询，零新依赖，不需要公网 URL）。
 *
 * 唯一一个从局域网这台机器就能跑通的入站渠道：Telegram 的 `getUpdates` 是普通 HTTPS，
 * 长轮询 25 秒一次，`sendMessage` 也是普通 HTTPS。所以整个 runner 就是两个 fetch 循环：
 * 不引 WebSocket、不引 SDK、不暴露公网端口（Musepi 的 collab relay 也正是为这件事绕的
 * 那一大圈；见 `docs/im-bridge-plan-2026-10-03.md`）。
 *
 * 消息交给会话的那一步**复用既有 RPC 面**（`POST /api/agent/<id>` 的 `prompt` 帧 +
 * `get_last_assistant_text`），而不是另开一条 agent 通道 —— 少一套生命周期，少一处漂移。
 */

import type { ChatChannelId } from "./chat-channel";

/** 可覆盖只是为了测试打桩（本地 HTTP 桩）；默认值是官方地址。 */
export function telegramApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return (env.TELEGRAM_API_BASE ?? "https://api.telegram.org").replace(/\/+$/, "");
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    from?: { id?: number; username?: string };
    chat?: { id?: number; type?: string };
  };
}

export interface TelegramSendOutcome {
  ok: boolean;
  detail: string;
}

/** 发一条。`parse_mode` 不用 —— MarkdownV2 的转义规则很容易踩，直接发纯文本。 */
export async function telegramSendMessage(
  token: string,
  chatId: string,
  text: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<TelegramSendOutcome> {
  const base = telegramApiBase(options.env);
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const response = await doFetch(`${base}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as { ok?: boolean; description?: string };
    if (payload.ok === true) return { ok: true, detail: "sent" };
    return { ok: false, detail: payload.description ?? `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: controller.signal.aborted ? "timed out" : error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/** 拉一批更新。`offset` 只确认不重发，所以轮询循环天然不会重复处理。 */
export async function telegramGetUpdates(
  token: string,
  offset: number,
  options: { fetchImpl?: typeof fetch; timeoutSeconds?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {},
): Promise<{ updates: TelegramUpdate[]; nextOffset: number; error?: string }> {
  const base = telegramApiBase(options.env);
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutSeconds = options.timeoutSeconds ?? 25;
  try {
    const url = new URL(`${base}/bot${token}/getUpdates`);
    url.searchParams.set("timeout", String(timeoutSeconds));
    if (offset > 0) url.searchParams.set("offset", String(offset));
    const response = await doFetch(url.toString(), { signal: options.signal });
    const payload = await response.json().catch(() => ({})) as {
      ok?: boolean;
      description?: string;
      result?: TelegramUpdate[];
    };
    if (payload.ok !== true || !Array.isArray(payload.result)) {
      return { updates: [], nextOffset: offset, error: payload.description ?? `HTTP ${response.status}` };
    }
    const updates = payload.result;
    const last = updates.at(-1)?.update_id;
    return { updates, nextOffset: typeof last === "number" ? last + 1 : offset };
  } catch (error) {
    if (options.signal?.aborted) return { updates: [], nextOffset: offset };
    return { updates: [], nextOffset: offset, error: error instanceof Error ? error.message : String(error) };
  }
}

/** 白名单判定。**空 = 谁都不许**（fail closed）：拿到机器人令牌的人不该顺手就能开你的 agent。 */
export function isAllowedSender(allowFrom: readonly string[], sender: { chatId?: number; username?: string }): boolean {
  if (allowFrom.length === 0) return false;
  const candidates = [sender.chatId?.toString(), sender.username].filter((value): value is string => Boolean(value));
  return candidates.some((value) => allowFrom.includes(value));
}

export interface TelegramRunnerOptions {
  token: string;
  chatId: string;
  allowFrom: string[];
  sessionId: string;
  /** 把一条消息交给会话，并拿回最终答复。 */
  deliver: (sessionId: string, text: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  onLog?: (line: string) => void;
  signal: AbortSignal;
}

/** 空批次后的歇脚时间。真长轮询本身挂 25 秒，这个只是防止「秒回」退化。 */
const IDLE_POLL_MS = 1_000;

export interface TelegramRunnerHandle {
  stop(): void;
  readonly processed: number;
}

/**
 * 轮询循环。每条消息：白名单 → 交给会话 → 拿答复 → 回 Telegram。
 * 任何一条出错都**只记日志不退出循环**（聊天端点抖一下不该把通道搞没）。
 */
export function startTelegramRunner(options: TelegramRunnerOptions): TelegramRunnerHandle {
  let offset = 0;
  let processed = 0;
  let stopped = false;
  const log = (line: string) => options.onLog?.(line);

  const loop = async () => {
    while (!stopped && !options.signal.aborted) {
      const batch = await telegramGetUpdates(options.token, offset, {
        fetchImpl: options.fetchImpl,
        signal: options.signal,
        ...(options.env ? { env: options.env } : {}),
      });
      if (batch.error) {
        // 401（令牌错）/ 409（另一个进程在轮询）等：退避一点，别打死循环。
        log(`telegram poll failed: ${batch.error}`);
        await delay(5_000, options.signal);
        continue;
      }
      offset = batch.nextOffset;
      // 空批次也要喘口气：真长轮询会挂 25 秒，但**任何一次立刻返回**（代理、本地打桩、
      // 平台改行为）都会让这个循环变成 100% CPU 的空转，把整个 Next 进程的热事件循环
      // 一起饿死 —— 这是第一版真的踩到过的坑（测试直接死锁）。
      if (batch.updates.length === 0) {
        await delay(IDLE_POLL_MS, options.signal);
        continue;
      }
      for (const update of batch.updates) {
        if (stopped || options.signal.aborted) return;
        const message = update.message;
        if (!message?.text) continue;
        if (!isAllowedSender(options.allowFrom, { chatId: message.chat?.id, username: message.from?.username })) {
          log(`telegram: ignored a sender outside the allowlist (${message.from?.username ?? message.chat?.id ?? "?"})`);
          continue;
        }
        try {
          const reply = await options.deliver(options.sessionId, message.text);
          processed += 1;
          const outcome = await telegramSendMessage(options.token, options.chatId, reply || "(no reply)", {
            fetchImpl: options.fetchImpl,
            ...(options.env ? { env: options.env } : {}),
          });
          if (!outcome.ok) log(`telegram reply failed: ${outcome.detail}`);
        } catch (error) {
          log(`telegram deliver failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  };

  void loop();
  return {
    stop() { stopped = true; },
    get processed() { return processed; },
  };
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

export type RunnerRegistry = Map<ChatChannelId, TelegramRunnerHandle>;

/** 进程级 registry：热重载后旧的循环要能被找到并停掉。 */
const RUNNERS_KEY = Symbol.for("pi-web.chatChannelRunners");

export function chatChannelRunners(): RunnerRegistry {
  const registry = globalThis as unknown as Record<symbol, RunnerRegistry | undefined>;
  const existing = registry[RUNNERS_KEY];
  if (existing) return existing;
  const created: RunnerRegistry = new Map();
  registry[RUNNERS_KEY] = created;
  return created;
}