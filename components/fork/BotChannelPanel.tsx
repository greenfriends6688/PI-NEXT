"use client";

import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { CHANNELS, type ChatChannelId } from "@/lib/chat-channel-shared";
import { ChannelIcon } from "./ChannelIcon";

/**
 * fork:bot-channel —— 右栏「使用 Bot Channel」入口卡。
 *
 * 形态裁定 2026-10-03 第二轮（对照 ZCode 的 `WebRemoteControlDialog` 截图，收掉第一轮
 * 的「卡里塞满状态」）：每张卡只有 **品牌 logo + 名字（+ 站点角标）+ 一句「从XX打开
 * 这个工作区」+ 「去 Bot Channels 配置」文字链** —— 状态点、缺项数、启停钮全部撤出，
 * 挪进「机器人管理」弹窗（`BotChannelsDialog`），入口卡不再自己 fetch。
 *
 * 清单也照截图收成四条（微信 / 飞书 / Lark / Telegram）：Discord 未接线、Huawei Today
 * 只做出站，都不在入口层摆着 —— 它们在管理弹窗的列表里仍有行，如实给原因。
 */

/** 入口卡展示的渠道与顺序（对照截图：微信 → 飞书 → Lark → Telegram）。 */
const ENTRY_CHANNELS: readonly ChatChannelId[] = ["wechat", "feishu", "lark", "telegram"];

export function BotChannelBody({ onOpen }: { onOpen: (channel: ChatChannelId) => void }) {
  const { t } = useI18n();
  const mobile = useIsMobile();

  // fork:v5-landing Wave B · M-10 · 窄屏：渠道行 = `.m-setrow`（品牌 logo + 名字 +
  // 地区徽章 + 一句说明 + 右箭头），点整行进二级面板。
  // **ChannelIcon 仍是那张品牌 PNG**（DIVERGENCE 已登记的例外），两端一致。
  if (mobile) {
    return (
      <div className="m-cardgroup">
        {ENTRY_CHANNELS.map((id) => {
          const spec = CHANNELS.find((channel) => channel.id === id);
          if (!spec) return null;
          return (
            <button
              key={id}
              type="button"
              className="m-setrow"
              onClick={() => onOpen(spec.id)}
            >
              <ChannelIcon id={spec.id} icon={spec.icon} size={22} />
              <span className="m-setrow-body">
                <span className="m-setrow-t">{spec.label}</span>
                <span className="m-setrow-s">{t(`botChannel.desc.${spec.id}`)}</span>
              </span>
              {spec.id === "feishu" && <span className="m-badge mute">{t("botChannel.regionCN")}</span>}
              {spec.id === "lark" && <span className="m-badge mute">{t("botChannel.regionGlobal")}</span>}
              <i data-ico="chevron-right" data-size="15" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    );
  }

  // v5 · D-20 帧 D：渠道行 = `.d-set-row`（品牌 logo + 标题 + 地区徽章 + 说明 + 下一步按钮）。
  return (
    <div className="d-col" style={{ gap: "var(--nx-sp-2)" }}>
      {ENTRY_CHANNELS.map((id) => {
        const spec = CHANNELS.find((channel) => channel.id === id);
        if (!spec) return null;
        return (
          <div key={id} className="d-set-row" style={{ paddingTop: 0 }}>
            <ChannelIcon id={spec.id} icon={spec.icon} size={22} />
            <div className="d-set-row-box">
              <div className="d-row">
                <span className="d-set-row-t">{spec.label}</span>
                {spec.id === "feishu" && <span className="d-badge mute">{t("botChannel.regionCN")}</span>}
                {spec.id === "lark" && <span className="d-badge mute">{t("botChannel.regionGlobal")}</span>}
              </div>
              <div className="d-set-row-s">{t(`botChannel.desc.${spec.id}`)}</div>
            </div>
            <button
              type="button"
              className="d-btn sm ghost"
              onClick={() => onOpen(spec.id)}
            >
              {t("botChannel.goConfigure")}
            </button>
          </div>
        );
      })}
    </div>
  );
}
