"use client";

import type { ChatChannelId } from "@/lib/chat-channel-shared";

/**
 * fork:phone-push —— 渠道的**品牌 logo**（fork:bot-channel）。
 *
 * 形态裁定 2026-10-03（对照 ZCode 的「移动端远程控制」弹窗）：渠道行用彩色品牌
 * 图标而不是单色 lucide 线条 —— 平台在这里是「你要去连的服务」，认品牌是第一眼
 * 的事；线条图标把微信/飞书/Telegram 画成一个样。PNG 资源 vendor 自
 * `pi参考项目/ZCode-main/packages/ui/src/assets/channel-icons/`（128×128 @2x），
 * 放在 `public/channel-icons/`。这偏离了「图标一律 lucide」的画板约定，已在
 * `DIVERGENCE.md` 登记为形态差异；lucide 名仍作没有品牌资源的渠道的兜底
 * （huawei-today），与管理行的单色 UI 图标（齿轮、播放）分属两层。
 */

/** 飞书与 Lark 共用一张 logo（ZCode 也这么做）：同一个品牌，两个站点点。 */
const BRAND_ICONS: Partial<Record<ChatChannelId, string>> = {
  telegram: "/channel-icons/telegram.png",
  discord: "/channel-icons/discord.png",
  feishu: "/channel-icons/feishu.png",
  lark: "/channel-icons/feishu.png",
  wechat: "/channel-icons/wechat.png",
};

export function ChannelIcon({ id, icon, size = 20 }: { id: ChatChannelId; icon: string; size?: number }) {
  const src = BRAND_ICONS[id];
  // v5：图标直接落 `<i data-ico>`，外层 `.pw-ico` 只是旧设计的包裹壳，已无规则依赖。
  if (!src) {
    return <i data-ico={icon} data-size={String(size)} aria-hidden="true" />;
  }
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      style={{ flex: "none", borderRadius: "var(--nx-r-sm)" }}
    />
  );
}
