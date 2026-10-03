/**
 * fork:bot-channel —— **客户端安全**的那一半：渠道清单与 id 类型。
 *
 * `lib/chat-channel.ts` 要读 `~/.pi/agent/chat-channels.json`，是服务端模块；
 * 设置页是 `"use client"`，直接 import 它会把 `node:fs` 拖进浏览器依赖图
 * （`lib/client-graph-purity.test.mjs` 管这条）。
 */

export type ChatChannelId = "telegram" | "discord" | "feishu" | "lark" | "wechat" | "huawei-today";

export interface ChatChannelSpec {
  id: ChatChannelId;
  label: string;
  /** lucide 图标名，必须在 design/pi-web-design/assets/icons.js 里。 */
  icon: string;
  /** 这台机器能不能不依赖公网 URL 就接上。 */
  lanFriendly: boolean;
  /** 跑起来还需要用户提供什么。 */
  requires: string[];
  note: string;
}

export const CHANNELS: readonly ChatChannelSpec[] = [
  {
    id: "telegram",
    label: "Telegram",
    icon: "send",
    lanFriendly: true,
    requires: ["Bot token (BotFather)", "chat id"],
    note: "长轮询，纯 HTTPS，零新依赖 —— 本仓已实现。",
  },
  {
    id: "discord",
    label: "Discord",
    icon: "message-circle",
    lanFriendly: true,
    requires: ["Bot token", "Intents: Message Content"],
    note: "Gateway 是 WebSocket + 心跳 + identify；ws 现在只是 next 的传递依赖，直接用等于把构建绑在别人的依赖树上。",
  },
  {
    id: "feishu",
    label: "Feishu",
    icon: "globe",
    lanFriendly: true,
    requires: ["扫码一键建应用（App ID / Secret）"],
    note: "扫码一键建应用 + 官方 @larksuiteoapi/node-sdk WebSocket 长连接 —— 本仓已实现（lib/feishu-channel.ts）。",
  },
  {
    id: "lark",
    label: "Lark",
    icon: "globe",
    lanFriendly: true,
    requires: ["扫码一键建应用（App ID / Secret）"],
    note: "与飞书同一套流程，国际站端点（accounts.larksuite.com / open.larksuite.com）。",
  },
  {
    id: "wechat",
    label: "Wechat",
    icon: "message-square",
    lanFriendly: true,
    requires: ["微信扫码获取 Bot Token"],
    note: "微信 iLink bot 平台：扫码拿 token，长轮询收发，零新依赖 —— 本仓已实现（lib/weixin-channel.ts）。",
  },
  {
    id: "huawei-today",
    label: "Huawei Today",
    icon: "sparkles",
    lanFriendly: false,
    requires: ["华为开发者账号"],
    note: "这个场景下华为没有通用 bot 接口，只有应用侧出站推送。",
  },
];

export function channelSpec(id: ChatChannelId): ChatChannelSpec {
  const found = CHANNELS.find((channel) => channel.id === id);
  if (!found) throw new Error(`Unknown chat channel: ${id}`);
  return found;
}
