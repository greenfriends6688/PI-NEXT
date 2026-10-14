/**
 * fork:bot-channel-autostart —— 渠道运行时的**唯一一份**启动 / 停止实现。
 *
 * 原来它整段写在 `app/api/bot-channel/route.ts` 的 POST 分支里，只有浏览器点「启动」
 * 才会跑。结果是：**渠道是进程内的长轮询循环，每次重启进程（改代码、`npm run prod`、
 * 崩溃重启）它都悄悄消失**，而界面上只显示「未运行」—— 用户看到的现象就是
 * 「我绑定了，发消息却没有任何回应」（2026-10-06 用户实拍）。
 *
 * 现在 route 与进程启动器（`instrumentation-node.ts`）共用这一份：
 * - `enabled` 字段从此有真语义 = 「**该不该在跑**」：start 写 true、stop 写 false，
 *   启动时按它自动拉起。显式停掉的渠道不会在下次开机自己回来。
 * - 启动器只拉起 `enabled !== false` 且 `channelReadiness().ready` 的渠道；
 *   任何一条起不来只打日志，不影响 Pi Web 本身可用。
 */

import {
  CHANNELS,
  channelReadiness,
  readChatChannelConfig,
  readChatChannelState,
  writeChatChannelConfig,
  writeChatChannelState,
  type ChatChannelConfig,
  type ChatChannelId,
} from "./config.ts";
import { chatChannelRunners, startTelegramRunner } from "./telegram.ts";
import { startWeixinRunner } from "./weixin.ts";
import { startFeishuRunner } from "./feishu.ts";


/**
 * What the runtime needs from the host.
 *
 * PI NEXT delivered by POSTing to its own HTTP API (`/api/agent/<id>`) — the browser and the
 * bot went through one path on purpose, so there was no second agent channel to keep in step.
 * This host has no such HTTP face (the engine lives in the main process), so the same shape
 * arrives as four methods: the guarantee being preserved is *one* path into a conversation,
 * not the transport it used.
 */
export interface BotChannelHost {
  /** Whether that conversation is mid-turn right now. */
  isBusy(conversationId: string): Promise<boolean>;
  /** The last assistant text of a settled conversation. */
  lastReply(conversationId: string): Promise<string>;
  /** Start a turn, exactly as the composer does. */
  submit(conversationId: string, text: string): Promise<void>;
  /**
   * Where an unbound channel's messages go.
   *
   * A dedicated workspace conversation, created if there is none — **not** "the most recent
   * conversation". With the latter a message from your phone lands in whatever project you
   * left open, which is how a casual question ends up appended to a code discussion
   * (2026-10-03, the user's own words were less polite).
   */
  workspaceConversation(): Promise<string | null>;
}

/** How long a turn is given to settle before the reply is read anyway. */
const SETTLE_TIMEOUT_MS = 10 * 60 * 1000;
const SETTLE_POLL_MS = 700;

/**
 * Hand one chat message to a conversation and bring back that turn's final assistant text.
 */
export async function runOnce(host: BotChannelHost, conversationId: string, text: string): Promise<string> {
  const target = conversationId || await host.workspaceConversation();
  if (!target) return "Could not open a conversation for this channel. Try again, or pick one in Settings → 推送机器人.";

  // **Look before injecting.** Measured, not hypothetical: binding a channel to a conversation
  // somebody is using drops the bot's message straight into that in-flight turn and destroys
  // what they were doing. So while it is running, do not inject — say it is busy and let the
  // person decide when to let the bot in.
  if (await host.isBusy(target)) {
    return "That conversation is running a turn right now — not injecting into it. Try again when it settles.";
  }

  await host.submit(target, text);

  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
    if (!(await host.isBusy(target))) break;
  }
  return (await host.lastReply(target)).trim() || "(no reply)";
}

/** 落盘 `enabled`（= 该不该在跑）。start / stop 各写一次，启动器按它自动拉起。 */
function setChannelEnabled(id: ChatChannelId, enabled: boolean): void {
  const fresh = readChatChannelConfig();
  const channel = fresh.channels[id];
  if (!channel || channel.enabled === enabled) return;
  writeChatChannelConfig({
    version: 1,
    channels: { ...fresh.channels, [id]: { ...channel, enabled } },
  });
}

export interface StartChannelResult {
  ok: boolean;
  error?: string;
  status?: number;
}

/**
 * 起一个渠道的长轮询 / 长连接循环。**幂等**：已在跑时直接回 ok。
 * 起失败只回错误，不抛。
 */
export async function startChatChannel(
  id: ChatChannelId,
  host: BotChannelHost,
  config: ChatChannelConfig = readChatChannelConfig(),
): Promise<StartChannelResult> {
  const readiness = channelReadiness(id, config);
  if (!readiness.ready) {
    return { ok: false, error: `Not ready: ${readiness.missing.join(", ")}`, status: 409 };
  }
  if (chatChannelRunners().has(id)) return { ok: true };
  const entry = config.channels[id]!;
  if (!entry.token) return { ok: false, error: "token is required", status: 400 };

  const deliver = (sessionId: string, text: string) => runOnce(host, sessionId, text);
  // 首发信人自动绑定：runner 已把人 push 进 entry.allowFrom（内存），这里负责落盘。
  const persistBoundSender = (senderId: string) => {
    const fresh = readChatChannelConfig();
    const channel = fresh.channels[id];
    if (!channel) return;
    writeChatChannelConfig({
      version: 1,
      channels: { ...fresh.channels, [id]: { ...channel, allowFrom: [...new Set([...channel.allowFrom, senderId])] } },
    });
  };
  const onLog = (line: string) => console.warn("[bot-channel]", line);
  const controller = new AbortController();

  if (id === "telegram") {
    if (!entry.chatId) return { ok: false, error: "token and chat id are required", status: 400 };
    chatChannelRunners().set(id, startTelegramRunner({
      token: entry.token,
      chatId: entry.chatId,
      allowFrom: entry.allowFrom,
      sessionId: entry.sessionId ?? "",
      signal: controller.signal,
      onLog,
      deliver,
    }));
    return { ok: true };
  }

  if (id === "wechat") {
    chatChannelRunners().set(id, startWeixinRunner({
      token: entry.token,
      fromBotId: entry.botUserId ?? "",
      allowFrom: entry.allowFrom,
      sessionId: entry.sessionId ?? "",
      signal: controller.signal,
      onLog,
      deliver,
      onBindFirstSender: persistBoundSender,
      onCursor: (buf) => writeChatChannelState({ weixinGetUpdatesBuf: buf }),
      initialBuf: readChatChannelState().weixinGetUpdatesBuf ?? "",
    }));
    return { ok: true };
  }

  if (id === "feishu" || id === "lark") {
    if (!entry.appId) return { ok: false, error: "app id is required", status: 400 };
    // 动态 import：这个 SDK 只在这里用，浏览器依赖图不该看到它（SDK 不在就明说，不是静默失败）。
    try {
      await import("@larksuiteoapi/node-sdk");
    } catch {
      return { ok: false, error: "@larksuiteoapi/node-sdk is not installed", status: 501 };
    }
    chatChannelRunners().set(id, await startFeishuRunner({
      appId: entry.appId,
      appSecret: entry.token,
      provider: id === "lark" ? "lark" : "feishu",
      allowFrom: entry.allowFrom,
      sessionId: entry.sessionId ?? "",
      signal: controller.signal,
      onLog,
      deliver,
      onBindFirstSender: persistBoundSender,
    }));
    return { ok: true };
  }

  // Discord / 华为：没有实现。明说，而不是起一个永远送不出去东西的循环。
  return { ok: false, error: "该渠道还没接上", status: 501 };
}

/** 停一个渠道，并把「该不该在跑」落成 false（下次开机不会自己回来）。 */
export function stopChatChannel(id: ChatChannelId): void {
  chatChannelRunners().get(id)?.stop();
  chatChannelRunners().delete(id);
  setChannelEnabled(id, false);
}

/**
 * 进程启动时按配置自动拉起。**只打日志、不抛** —— 渠道起不来不影响这个应用本身。
 *
 * The point of `enabled` is exactly this: it means "should this be running", so a channel the
 * person turned on comes back after a restart, and one they explicitly stopped stays stopped.
 * Without it a long-poll loop is something that silently disappears on every restart while the
 * settings page still says it is configured — the observed symptom being "I bound it, and
 * messages get no answer" (2026-10-06).
 */
export async function startConfiguredChatChannels(host: BotChannelHost): Promise<void> {
  const config = readChatChannelConfig();
  for (const spec of CHANNELS) {
    const entry = config.channels[spec.id];
    if (!entry || entry.enabled === false) continue;
    const readiness = channelReadiness(spec.id, config);
    if (!readiness.ready) {
      console.warn(`[bot-channel] ${spec.id} is configured but not ready: ${readiness.missing.join(", ")}`);
      continue;
    }
    try {
      const result = await startChatChannel(spec.id, host, config);
      console.warn(result.ok
        ? `[bot-channel] ${spec.id} started on boot`
        : `[bot-channel] ${spec.id} did not start: ${result.error}`);
    } catch (error) {
      console.warn(`[bot-channel] ${spec.id} failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
