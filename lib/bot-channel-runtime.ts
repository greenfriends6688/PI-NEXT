/**
 * Bot 渠道运行时的**唯一一份**启动 / 停止实现。
 *
 * 渠道是常驻的收消息循环（微信与飞书是长轮询 / 长连接，企业微信是回调，没有循环但要把
 * 回调登记为「在跑」）。重启进程它就静默消失，而界面上只显示「未运行」—— 用户看到的
 * 现象是「我绑定了，发消息却没有任何回应」。所以：
 * - `enabled` 字段 = 「**该不该在跑**」：start 写 true、stop 写 false；
 * - 启动器（instrumentation-node.ts）按它自动拉起，显式停掉的不会自己回来；
 * - 起不来只打日志，不影响 Pi Web 本身可用。
 */

import {
  botChannelReadiness,
  readBotChannelConfig,
  readBotChannelState,
  writeBotChannelConfig,
  writeBotChannelState,
  type BotChannelConfig,
  type BotChannelEntry,
  type BotChannelId,
} from "./bot-channel";
import { startWeixinRunner, type WeixinRunnerHandle } from "./weixin-channel";
import { startFeishuRunner, type FeishuRunnerHandle } from "./feishu-channel";
import { startDingtalkRunner, type DingtalkRunnerHandle } from "./dingtalk-channel";
import { newBotSession, runPromptAndWait } from "./bot-channel-delivery";

/** 等这一轮跑完的轮询间隔与上限。够跑完一次普通对话，不够跑一次长任务。 */
export const SETTLE_POLL_MS = 700;
export const SETTLE_TIMEOUT_MS = 10 * 60 * 1000;

interface Runner { stop(): void }
interface RunnerRegistry {
  wechat?: WeixinRunnerHandle;
  feishu?: FeishuRunnerHandle;
  lark?: FeishuRunnerHandle;
  dingtalk?: DingtalkRunnerHandle;
  /**
   * 企业微信没有循环（它靠回调），但「在跑」这件事仍然要记：只有登记过的渠道
   * 才接受回调，否则关掉之后旧隧道的请求还会继续驱动 agent。
   */
  wecom?: { stop(): void };
}

const RUNNERS_KEY = Symbol.for("pi-web.botChannelRunners");

function runners(): RunnerRegistry {
  const registry = globalThis as unknown as Record<symbol, RunnerRegistry | undefined>;
  return (registry[RUNNERS_KEY] ??= {});
}

export function isBotChannelRunning(id: BotChannelId): boolean {
  return Boolean(runners()[id]);
}

export function runningBotChannels(): BotChannelId[] {
  const registry = runners();
  return (Object.keys(registry) as BotChannelId[]).filter((id) => Boolean(registry[id]));
}

/** 落盘「该不该在跑」。start / stop 各写一次。 */
function setEnabled(id: BotChannelId, enabled: boolean): void {
  const config = readBotChannelConfig();
  const entry = config.channels[id];
  if (!entry || entry.enabled === enabled) return;
  writeBotChannelConfig({ ...config, channels: { ...config.channels, [id]: { ...entry, enabled } } });
}

/** 落盘首个发信人的绑定：白名单空着时，第一条消息的主人就是主人。 */
export function bindFirstSender(id: BotChannelId, senderId: string): void {
  const config = readBotChannelConfig();
  const entry = config.channels[id];
  if (!entry) return;
  if (entry.allowFrom.includes(senderId)) return;
  writeBotChannelConfig({
    ...config,
    channels: { ...config.channels, [id]: { ...entry, allowFrom: [...entry.allowFrom, senderId] } },
  });
}

/** 这台服务器自己的 API 根，用于**启动时**自动拉起（那时没有请求可以问端口）。 */
function defaultDeliverUrl(): string {
  const port = process.env.PORT ?? process.env.PI_WEB_PORT ?? "30142";
  return `http://127.0.0.1:${port}/api/agent/`;
}

/** 末尾的斜杠是路径的一部分：`/api/agent` 拼 `s-1` 会变成 `/api/agents-1`。 */
function normalizeDeliverUrl(url?: string): string {
  return `${(url ?? defaultDeliverUrl()).replace(/\/+$/, "")}/`;
}

export interface StartBotResult {
  ok: boolean;
  error?: string;
  status?: number;
}

/**
 * 起一个渠道。**幂等**：已在跑直接回 ok；没配好回 409 并说明缺什么。
 * 任何一家起不来只回错误，不抛。
 */
export async function startBotChannel(
  id: BotChannelId,
  options: { deliverUrl?: string } = {},
): Promise<StartBotResult> {
  const config = readBotChannelConfig();
  const readiness = botChannelReadiness(id, config.channels[id]);
  if (!readiness.ready) return { ok: false, error: `Not ready: ${readiness.missing.join(", ")}`, status: 409 };
  if (runners()[id]) return { ok: true };
  const entry = config.channels[id]!;
  const base = normalizeDeliverUrl(options.deliverUrl);
  const controller = new AbortController();
  const onLog = (line: string) => console.warn(`[bot-channel:${id}]`, line);

  // 所有渠道的交付都是同一条：没有绑定会话就现开一个临时会话，绝不插进别人正在跑的对话。
  const deliver = async (sessionId: string, text: string): Promise<string> => {
    const target = sessionId || await newBotSession(base);
    if (!target) return "Could not open a session for this channel. Try again from the app.";
    return runPromptAndWait(base, target, text, { settleMs: SETTLE_POLL_MS, timeoutMs: SETTLE_TIMEOUT_MS });
  };

  if (id === "wechat") {
    runners().wechat = startWeixinRunner({
      token: entry.token!,
      fromBotId: entry.botUserId ?? "",
      allowFrom: entry.allowFrom,
      sessionId: entry.sessionId ?? "",
      signal: controller.signal,
      onLog,
      deliver,
      onBindFirstSender: (senderId) => bindFirstSender("wechat", senderId),
      onCursor: (buf) => writeBotChannelState({ weixinGetUpdatesBuf: buf }),
      initialBuf: readBotChannelState().weixinGetUpdatesBuf ?? "",
    });
    setEnabled(id, true);
    return { ok: true };
  }

  if (id === "feishu" || id === "lark") {
    // SDK 缺失时给出用户可见的报错（runner 里动态 import 的失败只进日志）。
    try {
      await import("@larksuiteoapi/node-sdk");
    } catch {
      return { ok: false, error: "@larksuiteoapi/node-sdk is not installed", status: 501 };
    }
    runners()[id] = await startFeishuRunner({
      appId: entry.appId!,
      appSecret: entry.token!,
      provider: id === "lark" ? "lark" : "feishu",
      allowFrom: entry.allowFrom,
      sessionId: entry.sessionId ?? "",
      signal: controller.signal,
      onLog,
      deliver,
      onBindFirstSender: (senderId) => bindFirstSender(id, senderId),
    });
    setEnabled(id, true);
    return { ok: true };
  }

  if (id === "dingtalk") {
    // SDK 缺失时给出用户可见的报错（runner 里动态 import 的失败只进日志）。
    try {
      await import("dingtalk-stream");
    } catch {
      return { ok: false, error: "dingtalk-stream is not installed", status: 501 };
    }
    runners().dingtalk = await startDingtalkRunner({
      clientId: entry.appId!,
      clientSecret: entry.token!,
      allowFrom: entry.allowFrom,
      sessionId: entry.sessionId ?? "",
      signal: controller.signal,
      onLog,
      deliver,
      onBindFirstSender: (senderId) => bindFirstSender("dingtalk", senderId),
    });
    setEnabled(id, true);
    return { ok: true };
  }

  if (id === "wecom") {
    // 没有循环：记下「这个渠道在跑」，回调路由据此放行。
    const handle = { stop() { controller.abort(); } };
    runners().wecom = handle;
    setEnabled(id, true);
    return { ok: true };
  }

  return { ok: false, error: `${id} is not implemented`, status: 501 };
}

/** 停一个渠道，并把「该不该在跑」落成 false（下次开机不会自己回来）。 */
export function stopBotChannel(id: BotChannelId): void {
  const registry = runners();
  (registry[id] as Runner | undefined)?.stop();
  delete registry[id];
  setEnabled(id, false);
}

/** 所有渠道一起停（e2e 与关停时用）。 */
export function stopAllBotChannels(): void {
  for (const id of runningBotChannels()) stopBotChannel(id);
}

/**
 * 进程启动时按配置自动拉起。**只打日志、不抛** —— 渠道起不来不影响 Pi Web 本身。
 * 幂等：dev 的 instrumentation 会重跑，已在跑的直接返回。
 */
export async function startConfiguredBotChannels(): Promise<void> {
  const config = readBotChannelConfig();
  for (const [id, entry] of Object.entries(config.channels) as [BotChannelId, BotChannelEntry][]) {
    if (entry.enabled !== true) continue;
    const readiness = botChannelReadiness(id, entry);
    if (!readiness.ready) {
      console.warn(`[bot-channel:${id}] enabled but not ready: ${readiness.missing.join(", ")}`);
      continue;
    }
    try {
      const result = await startBotChannel(id);
      console.warn(result.ok ? `[bot-channel:${id}] started` : `[bot-channel:${id}] did not start: ${result.error}`);
    } catch (error) {
      console.warn(`[bot-channel:${id}] failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export type { BotChannelConfig, BotChannelEntry };
