/**
 * fork:bot-channel —— **Bot Channel**（入站）：你在聊天应用里给机器人发消息，它把消息
 * 交给一个会话跑，再把结果发回聊天里。
 *
 * 与 `lib/im-bridge.ts`（出站）是**同一件事的两个方向**：那边 agent 推出去，这边用户拉进来。
 * 两者共用一套「目标」概念，但生命周期不同 —— 出站无状态、入站是一个常驻循环，所以必须能
 * **启动 / 停止**（对应 MusePi 右栏每行的「启动」钮）。
 *
 * ## 平台能不能真跑起来，取决于**这台机器在局域网里**这件事
 *
 * 只有**长连接 / 轮询**类的接入能不要公网 URL：
 * - **Telegram**：`getUpdates` 长轮询，纯 HTTPS，零依赖，✅ 本仓已实现（`lib/telegram-channel.ts`）。
 * - **微信**：挂在微信自家 **iLink bot 平台**（扫码拿 bot_token，`getupdates` 长轮询），
 *   ✅ 本仓已实现（`lib/weixin-channel.ts`，协议对拍 ZCode）—— 推翻了早先
 *   「个人微信没有任何官方 bot API」的结论。
 * - **飞书 / Lark**：扫码一键建应用 + 官方 `@larksuiteoapi/node-sdk` WebSocket 长连接，
 *   ✅ 本仓已实现（`lib/feishu-channel.ts`，协议对拍 ZCode）。
 * - **Discord**：Gateway 是 WebSocket + 心跳 + identify；`ws` 只是 `next` 的传递依赖，
 *   直接 import 它等于把构建绑在别人的依赖树上（下次 npm 装完可能就没了），所以要正式做
 *   得把 `ws` 写进 `dependencies`。
 * - **企业微信**：只有回调 URL，必须公网 HTTPS，不做。
 *
 * 这些结论都写在 `CHANNELS` 的 `note` 里并显示在界面上 —— 一排永远点不动的按钮比没有更糟。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { writePrivateFileAtomicSync } from "./atomic-file";

import { CHANNELS, channelSpec, type ChatChannelId } from "./chat-channel-shared";

/** 清单定义在 `-shared` 里（客户端也要渲染那一片），这里转出去给服务端用。 */
export { CHANNELS, channelSpec } from "./chat-channel-shared";
export type { ChatChannelId, ChatChannelSpec } from "./chat-channel-shared";

// ── 配置 ────────────────────────────────────────────────────────────────────

export interface ChatChannelConfig {
  version: 1;
  /** 每个渠道一份：令牌 / chat id / 绑哪个会话 / 是否在跑。 */
  channels: Record<string, {
    /** Telegram bot token / 微信 iLink bot_token / 飞书 app_secret —— 都是凭证。 */
    token?: string;
    /** Telegram 的 chat id。 */
    chatId?: string;
    /** 消息交给哪个会话跑（会话 id）。空 = 用最近一次活跃的会话。 */
    sessionId?: string;
    /** 允许驱动 agent 的 id 白名单。空数组 = 谁都不许（fail closed）——扫码渠道由首个发信人自动绑定。 */
    allowFrom: string[];
    /** 飞书/Lark 的应用 id（扫码注册返回的 client_id）。 */
    appId?: string;
    /** 平台侧的自身/绑定标识：微信 = ilink_bot_id（发消息的 from_user_id），飞书 = 扫码人的 open_id。 */
    botUserId?: string;
    enabled: boolean;
  }>;
}

export const EMPTY_CHAT_CHANNEL_CONFIG: ChatChannelConfig = { version: 1, channels: {} };

function configPath(): string {
  return join(getAgentDir(), "chat-channels.json");
}

export function readChatChannelConfig(): ChatChannelConfig {
  try {
    const parsed = JSON.parse(readFileSync(configPath(), "utf8")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_CHAT_CHANNEL_CONFIG };
    const channels = parsed.channels;
    if (!channels || typeof channels !== "object") return { ...EMPTY_CHAT_CHANNEL_CONFIG };
    return {
      version: 1,
      channels: Object.fromEntries(
        Object.entries(channels as Record<string, unknown>).map(([id, value]) => {
          const entry = (value ?? {}) as Record<string, unknown>;
          return [id, {
            ...(typeof entry.token === "string" && entry.token ? { token: entry.token } : {}),
            ...(typeof entry.chatId === "string" && entry.chatId ? { chatId: entry.chatId } : {}),
            ...(typeof entry.sessionId === "string" && entry.sessionId ? { sessionId: entry.sessionId } : {}),
            ...(typeof entry.appId === "string" && entry.appId ? { appId: entry.appId } : {}),
            ...(typeof entry.botUserId === "string" && entry.botUserId ? { botUserId: entry.botUserId } : {}),
            allowFrom: Array.isArray(entry.allowFrom)
              ? entry.allowFrom.filter((item): item is string => typeof item === "string")
              : [],
            enabled: entry.enabled !== false,
          }];
        }),
      ),
    };
  } catch {
    // 文件不存在或坏了 —— 当作没配。不回显内容（里面有 token）。
    return { ...EMPTY_CHAT_CHANNEL_CONFIG };
  }
}

export function writeChatChannelConfig(config: ChatChannelConfig): ChatChannelConfig {
  mkdirSync(dirname(configPath()), { recursive: true });
  writePrivateFileAtomicSync(configPath(), `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

/**
 * 运行时**位点**（微信 `getupdates` 的不透明游标），与凭证分开放：这个文件丢了最多
 * 重放一批消息，凭证丢了就得重新扫码。同样 0600 原子写。
 */
export interface ChatChannelState {
  weixinGetUpdatesBuf?: string;
}

function statePath(): string {
  return join(getAgentDir(), "chat-channels-state.json");
}

export function readChatChannelState(): ChatChannelState {
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

export function writeChatChannelState(patch: ChatChannelState): void {
  mkdirSync(dirname(statePath()), { recursive: true });
  const next = { ...readChatChannelState(), ...patch };
  writePrivateFileAtomicSync(statePath(), `${JSON.stringify(next, null, 2)}\n`);
}

/** 一个渠道「配好了没」：需要的字段齐了就是 ready。 */
export function channelReadiness(
  id: ChatChannelId,
  config: ChatChannelConfig = readChatChannelConfig(),
): { ready: boolean; missing: string[] } {
  const spec = channelSpec(id);
  const entry = config.channels[id] ?? { allowFrom: [], enabled: true };
  const missing: string[] = [];
  if (!entry.token) missing.push(spec.requires[0] ?? "token");
  if (id === "telegram" && !entry.chatId) missing.push("chat id");
  if ((id === "feishu" || id === "lark") && !entry.appId) missing.push("app id");
  if (!spec.lanFriendly) missing.push("public callback URL (not supported on the LAN)");
  return { ready: missing.length === 0, missing };
}