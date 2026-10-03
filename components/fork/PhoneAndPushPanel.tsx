"use client";

import { useState } from "react";

import { useI18n } from "@/hooks/useI18n";
import type { ChatChannelId } from "@/lib/chat-channel-shared";
import { SettingsPage } from "../SettingsUi";
import { BotChannelsDialog, type BotDialogSelection } from "./BotChannelsDialog";
import { BotChannelBody } from "./BotChannelPanel";
import { LanPairBody } from "./LanPairPanel";

/**
 * fork:phone-push —— **手机与推送**：一个分节，两栏。
 *
 * 形态裁定 2026-10-03（用户对照 ZCode 的「移动端远程控制」弹窗拍板）：**左栏扫码连接**
 * （LanPairBody），**右栏 Bot Channel 入口卡**（BotChannelBody，干净的 logo + 一句话 +
 * 去配置链接）；「机器人管理」与各卡的「去 Bot Channels 配置」打开**二级弹窗**
 * （`BotChannelsDialog`，对照 ZCode 的 BotsDialog：左渠道列表 + 右详情，扫码 / 凭证 /
 * 投递 / 启停 / 推送目标全在里面）。第一版塞在分节里的配置表单与推送抽屉随之撤销。
 *
 * 两栏用 `repeat(auto-fit, minmax(340px, 1fr))`：设置弹窗内容列够宽就并排，窄屏自动
 * 塌成单列。排版全部走画板已有原子（`.pw-plan` / `.pw-chip` / `.pw-btn`），**不新增
 * 任何 `pw-*` 类**；弹窗壳的 `fork-bot-dialog*` 在 fork-ui.css。
 */

export function PhoneAndPushPanel() {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<{ open: boolean; selection: BotDialogSelection | null }>({ open: false, selection: null });

  const openDialog = (selection: BotDialogSelection | null) => setDialog({ open: true, selection });

  return (
    <SettingsPage title={t("phonePush.title")} sub={t("phonePush.pageSub")}>
      <div
        style={{
          display: "grid",
          gap: "var(--s4)",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
        }}
      >
        <section className="pw-plan" style={{ gap: "var(--s3)", gridTemplateRows: "auto auto 1fr" }}>
          <div className="pw-plan-head">
            <span className="pw-ico"><i data-ico="smartphone" data-size="15" aria-hidden="true" /></span>
            {t("phonePush.scanTitle")}
          </div>
          <p className="sub" style={{ margin: 0 }}>{t("phonePush.scanHint")}</p>
          <LanPairBody />
        </section>

        <section className="pw-plan" style={{ gap: "var(--s3)", gridTemplateRows: "auto auto 1fr auto" }}>
          <div className="pw-plan-head">
            <span className="pw-ico"><i data-ico="bot" data-size="15" aria-hidden="true" /></span>
            {t("phonePush.botColTitle")}
          </div>
          <p className="sub" style={{ margin: 0 }}>{t("phonePush.botColHint")}</p>
          <BotChannelBody onOpen={(channel: ChatChannelId) => openDialog(channel)} />
          <button
            type="button"
            className="pw-btn outline"
            style={{ width: "100%" }}
            onClick={() => openDialog(null)}
          >
            <span className="pw-ico"><i data-ico="bot" data-size="13" aria-hidden="true" /></span>
            {t("phonePush.botManage")}
            <span className="grow" />
            <span className="pw-ico"><i data-ico="chevron-right" data-size="13" aria-hidden="true" /></span>
          </button>
        </section>
      </div>

      <BotChannelsDialog
        open={dialog.open}
        initialSelection={dialog.selection}
        onClose={() => setDialog({ open: false, selection: null })}
      />
    </SettingsPage>
  );
}
