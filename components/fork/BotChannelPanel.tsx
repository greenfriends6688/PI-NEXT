"use client";

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

  return (
    <div style={{ display: "grid", gap: "var(--s2)" }}>
      {ENTRY_CHANNELS.map((id) => {
        const spec = CHANNELS.find((channel) => channel.id === id);
        if (!spec) return null;
        return (
          <div key={id} className="pw-plan" style={{ gap: "var(--s2)" }}>
            <div className="pw-plan-head" style={{ padding: 0 }}>
              <ChannelIcon id={spec.id} icon={spec.icon} size={22} />
              <span>{spec.label}</span>
              {spec.id === "feishu" && <span className="pw-chip">{t("botChannel.regionCN")}</span>}
              {spec.id === "lark" && <span className="pw-chip">{t("botChannel.regionGlobal")}</span>}
            </div>
            <p className="sub" style={{ margin: 0 }}>{t(`botChannel.desc.${spec.id}`)}</p>
            <button
              type="button"
              className="fork-linkbtn"
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
