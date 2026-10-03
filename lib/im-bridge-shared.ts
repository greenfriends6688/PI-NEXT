/**
 * fork:im-bridge —— **客户端安全**的那一半：类型、平台清单、URL 识别、掩码常量。
 *
 * 为什么单独一个文件（`lib/client-graph-purity.test.mjs` 的规矩）：`lib/im-bridge.ts`
 * 要读写 `~/.pi/agent/im-bridge.json` 并用 `node:crypto` 算加签，它是服务端模块；
 * 设置页是 `"use client"`，直接 import 它就把 `node:fs` / pi SDK 拖进浏览器依赖图，
 * `npm run build` 才会红（本仓已经因为同类问题红过两次，见那条测试的头注）。
 *
 * 所以：**实现留服务端，类型与纯判断留这里**，两边都从同一份定义出。
 */

export type ImProvider = "feishu" | "wecom" | "dingtalk" | "slack" | "telegram" | "custom";

export const IM_PROVIDER_IDS: readonly ImProvider[] = [
  "feishu",
  "wecom",
  "dingtalk",
  "slack",
  "telegram",
  "custom",
];

/** 按 host 认平台。**认不出就是 custom**，绝不猜：猜错的表现是「测试发送一直失败，
 * 但看不出该改哪个字段」。 */
export function detectImProvider(url: string): ImProvider {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "custom";
  }
  if (host === "open.feishu.cn" || host === "open.larksuite.cn" || host === "open.larksuite.com") return "feishu";
  if (host === "qyapi.weixin.qq.com") return "wecom";
  if (host === "oapi.dingtalk.com") return "dingtalk";
  if (host === "hooks.slack.com") return "slack";
  if (host === "api.telegram.org") return "telegram";
  return "custom";
}

/**
 * 只有飞书与钉钉文档里写了加签。
 *
 * **企业微信群机器人没有签名**：它的官方页（`developer.work.weixin.qq.com/document/path/91770`，
 * 2025-08-07 版）通篇只有 IP 白名单与「每分钟 20 条」，没有签名算法。所以这里必须是这两家 ——
 * 多写一家只会让人以为「填了 secret 就更安全」。
 */
export function needsImSecret(provider: ImProvider): boolean {
  return provider === "feishu" || provider === "dingtalk";
}

/** Telegram 的 URL 里不带 chat_id，得单独填。 */
export function needsImChatId(provider: ImProvider): boolean {
  return provider === "telegram";
}

/** 掩码：设置页要能显示「已配」又不能把 webhook 与 secret 回显给浏览器。 */
export const IM_SECRET_MASK = "••••••••";

export function isMaskedSecret(value: string | undefined): boolean {
  return value === IM_SECRET_MASK;
}

/**
 * 只登记**文档里写明**的长度上限（字节）。查不到的一律不写：飞书只写了「请求体 20 KB」，
 * 企业微信写了 `text.content` 2048 / `markdown.content` 4096，而钉钉、Slack、Telegram 的
 * 当前文档里没有给上限。编一个「2000」进去只会把本来能发的长消息拒掉，报错还指不出是哪层拒的。
 */
export const IM_TEXT_LIMITS: Partial<Record<ImProvider, number>> = {
  feishu: 20_000,
  wecom: 2_048,
};

export interface ImTarget {
  id: string;
  /** 人看的名字，模型也会用它来挑目标。 */
  label: string;
  provider: ImProvider;
  /** 群机器人 / incoming webhook 地址。这个值本身即凭证。 */
  url: string;
  /** 只有开了「签名校验」的飞书 / 钉钉要。 */
  secret?: string;
  /** Telegram 专用。 */
  chatId?: string;
  enabled: boolean;
}

export interface ImMessage {
  text: string;
  /** 可选标题，飞书 post 与企业微信 / 钉钉 markdown 用得上。 */
  title?: string;
}
