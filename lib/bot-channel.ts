/**
 * Bot 渠道（入站）：你在聊天应用里给机器人发消息，它把消息交给一个会话跑，再把结果发回聊天里。
 *
 * 这一个文件只管**配置与就绪状态**；渠道的实现在
 * `lib/weixin-channel.ts`（微信 iLink bot 平台，长轮询）、`lib/feishu-channel.ts`
 * （飞书 / Lark，扫码一键建应用 + 官方 SDK 的 WebSocket 长连接）、
 * `lib/wecom-channel.ts`（企业微信，应用消息 + 回调），生命周期在 `lib/bot-channel-runtime.ts`
 * （启动器也会按配置自动拉起）。
 *
 * ## 为什么是这三家
 *
 * 「手机里跟 agent 说话」要看平台能不能**不要公网 URL**就收到消息：
 * - **微信**：挂着微信自家的 **iLink bot 平台**（扫码拿 bot_token，`getupdates` 长轮询），
 *   普通 HTTPS，零新依赖。这是本仓真正能扫一下就用的那一家。
 * - **飞书 / Lark**：扫码一键建应用（device-flow，不用先去开放平台建），收消息走官方 SDK 的
 *   WebSocket 长连接。Lark 是同一套流程的国际站端点。
 * - **企业微信**：只有**回调 URL**，必须公网 HTTPS。要接就得开隧道（cloudflared /
 *   Tailscale Funnel）；这里按它的真实协议实现（签名校验 + AES 解密 + 被动回复），
 *   配好自己的公网隧道即可，`note` 里如实说明这一点。
 *
 * Discord 不做：Gateway 要 `ws`（现在只是 next 的传递依赖，直接 import 等于把构建绑在
 * 别人的依赖树上）。
 */

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

export type BotChannelId = "wechat" | "feishu" | "lark" | "dingtalk" | "wecom";

/** 一个渠道的规格，客户端也用它渲染那一排。 */
export interface BotChannelSpec {
  id: BotChannelId;
  label: string;
  /** 这台机器能不能不依赖公网 URL 就接上。 */
  lanFriendly: boolean;
  /** 跑起来还需要用户提供什么。 */
  requires: string[];
  note: string;
}

export const BOT_CHANNELS: readonly BotChannelSpec[] = [
  {
    id: "wechat",
    label: "微信",
    lanFriendly: true,
    requires: ["扫码授权"],
    note: "微信 iLink bot 平台：扫一下就拿到 bot_token，长轮询收、普通 HTTPS 发，不需要公网地址。",
  },
  {
    id: "feishu",
    label: "飞书",
    lanFriendly: true,
    requires: ["扫码一键建应用"],
    note: "扫码现建一个自建应用，收消息走官方 SDK 的 WebSocket 长连接，不需要公网地址。",
  },
  {
    id: "lark",
    label: "Lark",
    lanFriendly: true,
    requires: ["扫码一键建应用"],
    note: "与飞书同一套流程，国际站端点（accounts.larksuite.com / open.larksuite.com）。",
  },
  {
    id: "dingtalk",
    label: "钉钉",
    lanFriendly: true,
    requires: ["机器人应用的 Client ID / Client Secret"],
    note: "钉钉 Stream 模式：WebSocket 长连接收消息，不需要公网地址；答复用回调里的 sessionWebhook 直接回。",
  },
  {
    id: "wecom",
    label: "企业微信",
    lanFriendly: false,
    requires: ["自建应用（CorpID / Secret / AgentId）", "公网 HTTPS 回调地址"],
    note: "企业微信只支持回调 URL：接收消息必须有一个公网 HTTPS 地址（cloudflared / Tailscale Funnel 都行）。回调填 <隧道域名>/api/bot-channel/wecom。",
  },
];

export function botChannelSpec(id: BotChannelId): BotChannelSpec {
  const found = BOT_CHANNELS.find((channel) => channel.id === id);
  if (!found) throw new Error(`Unknown bot channel: ${id}`);
  return found;
}

export interface BotChannelEntry {
  /** 微信 bot_token / 飞书 app_secret / 企业微信应用 Secret。凭证，绝不回给浏览器。 */
  token?: string;
  /** 飞书 client_id / 企业微信 CorpID。 */
  appId?: string;
  /** 企业微信自建应用的 AgentId（发消息要用）。 */
  agentId?: string;
  /** 企业微信回调的 Token 与 EncodingAESKey（校验签名、解密消息）。 */
  callbackToken?: string;
  callbackAesKey?: string;
  /** 微信扫码返回的 ilink_bot_id（发消息时的 from_user_id）。 */
  botUserId?: string;
  /** 允许驱动 agent 的发送者白名单。空 = 谁都不许，直到首个发信人自动绑定。 */
  allowFrom: string[];
  /** 消息交给哪个会话跑。空 = 今天的临时目录里现开一个（~/pi-cwd/YYYYMMDD）。 */
  sessionId?: string;
  /** 「该不该在跑」：启动器按它自动拉起，停止时写成 false。 */
  enabled: boolean;
}

export interface BotChannelConfig {
  version: 1;
  channels: Partial<Record<BotChannelId, BotChannelEntry>>;
}

export const EMPTY_BOT_CONFIG: BotChannelConfig = { version: 1, channels: {} };

function configPath(): string {
  return join(getAgentDir(), "bot-channel.json");
}

/** 微信的不透明游标（`get_updates_buf`），与凭证分开放：丢了最多重放一批消息。 */
export interface BotChannelState {
  weixinGetUpdatesBuf?: string;
}

function statePath(): string {
  return join(getAgentDir(), "bot-channel-state.json");
}

function stringField(entry: Record<string, unknown>, key: string): string | undefined {
  const value = entry[key];
  return typeof value === "string" && value ? value : undefined;
}

export function readBotChannelConfig(): BotChannelConfig {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
    const raw = (parsed?.channels ?? {}) as Record<string, unknown>;
    const channels: Partial<Record<BotChannelId, BotChannelEntry>> = {};
    for (const spec of BOT_CHANNELS) {
      const value = raw[spec.id];
      if (!value || typeof value !== "object") continue;
      const entry = value as Record<string, unknown>;
      channels[spec.id] = {
        ...(stringField(entry, "token") ? { token: stringField(entry, "token") } : {}),
        ...(stringField(entry, "appId") ? { appId: stringField(entry, "appId") } : {}),
        ...(stringField(entry, "agentId") ? { agentId: stringField(entry, "agentId") } : {}),
        ...(stringField(entry, "callbackToken") ? { callbackToken: stringField(entry, "callbackToken") } : {}),
        ...(stringField(entry, "callbackAesKey") ? { callbackAesKey: stringField(entry, "callbackAesKey") } : {}),
        ...(stringField(entry, "botUserId") ? { botUserId: stringField(entry, "botUserId") } : {}),
        ...(stringField(entry, "sessionId") ? { sessionId: stringField(entry, "sessionId") } : {}),
        allowFrom: Array.isArray(entry.allowFrom)
          ? entry.allowFrom.filter((item): item is string => typeof item === "string" && Boolean(item))
          : [],
        enabled: entry.enabled === true,
      };
    }
    return { version: 1, channels };
  } catch {
    // 文件不存在或坏了 —— 当作没配。不回显内容（里面有令牌）。
    return { version: 1, channels: {} };
  }
}

export function writeBotChannelConfig(config: BotChannelConfig): BotChannelConfig {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  writePrivateFileAtomicSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

export function readBotChannelState(): BotChannelState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), "utf8")) as Record<string, unknown>;
    return {
      ...(typeof parsed.weixinGetUpdatesBuf === "string" && parsed.weixinGetUpdatesBuf
        ? { weixinGetUpdatesBuf: parsed.weixinGetUpdatesBuf }
        : {}),
    };
  } catch {
    return {};
  }
}

export function writeBotChannelState(patch: BotChannelState): void {
  const path = statePath();
  mkdirSync(dirname(path), { recursive: true });
  writePrivateFileAtomicSync(path, `${JSON.stringify({ ...readBotChannelState(), ...patch }, null, 2)}\n`);
}

/** 一个渠道「配好了没」：需要的字段齐了就是 ready。 */
export function botChannelReadiness(
  id: BotChannelId,
  entry: BotChannelEntry | undefined = readBotChannelConfig().channels[id],
): { ready: boolean; missing: string[] } {
  const spec = botChannelSpec(id);
  const missing: string[] = [];
  if (!entry?.token) missing.push(spec.requires[0] ?? "token");
  // 第二个字段只在前一个已经有了之后才提：什么都没配时只说「去扫码/填凭证」，
  // 否则界面上会同时挂「扫码授权」和「app id」，读起来像两件要做的事。
  if (entry?.token) {
    if ((id === "feishu" || id === "lark") && !entry.appId) missing.push("app id");
    if (id === "dingtalk" && !entry.appId) missing.push("client id");
  }
  if (id === "wecom" && entry?.token) {
    if (!entry.appId) missing.push("corp id");
    if (!entry.agentId) missing.push("agent id");
    if (!entry.callbackToken || !entry.callbackAesKey) missing.push("callback token / encoding AES key");
  }
  // 隧道不是配置项，是这台机器的网络条件：只在「还差东西」时提醒一次，
  // 配齐了就不再念叨（否则永远 ready=false）。
  if (!spec.lanFriendly && missing.length > 0) {
    missing.push("public HTTPS callback URL (needs a tunnel)");
  }
  return { ready: missing.length === 0, missing };
}

/** 给界面看的形状：只说明「有没有配」，绝不带凭证本身。 */
export interface BotChannelStatus {
  id: BotChannelId;
  label: string;
  lanFriendly: boolean;
  requires: string[];
  note: string;
  configured: boolean;
  hasAppId: boolean;
  hasAgentId: boolean;
  hasCallback: boolean;
  allowCount: number;
  sessionId: string;
  ready: boolean;
  missing: string[];
  running: boolean;
  tokenHint: string | null;
}

export function botChannelStatus(id: BotChannelId, running: boolean): BotChannelStatus {
  const spec = botChannelSpec(id);
  const entry = readBotChannelConfig().channels[id];
  const { ready, missing } = botChannelReadiness(id, entry);
  return {
    id,
    label: spec.label,
    lanFriendly: spec.lanFriendly,
    requires: spec.requires,
    note: spec.note,
    configured: Boolean(entry?.token),
    hasAppId: Boolean(entry?.appId),
    hasAgentId: Boolean(entry?.agentId),
    hasCallback: Boolean(entry?.callbackToken && entry?.callbackAesKey),
    allowCount: entry?.allowFrom.length ?? 0,
    sessionId: entry?.sessionId ?? "",
    ready,
    missing,
    running,
    tokenHint: entry?.token ? `${entry.token.slice(0, 4)}…${entry.token.slice(-4)}` : null,
  };
}
