"use client";

import { useState } from "react";

import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { PwaPage } from "@/components/pwa/PwaPage";
import type { ChatChannelId } from "@/lib/chat-channel-shared";
import { SettingsPage } from "../SettingsUi";
import { BotChannelsDialog, type BotDialogSelection } from "./BotChannelsDialog";
import { BotChannelBody } from "./BotChannelPanel";
import { LanPairBody } from "./LanPairPanel";
import { MirrorBody } from "./MirrorPanel";
import { TunnelBody } from "./TunnelPanel";

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
 * 塌成单列。排版全部走 v5 画板已有原子（`.d-set-row` / `.d-set-navitem` / `.d-btn`），
 * **不新增任何 `d-*` 类**；弹窗壳的 `fork-bot-dialog*` 在 fork-ui.css。
 * fork:v5-landing Wave B：窄屏分支见函数体内部注释（`.m-onboard` / `.m-step-card`）。
 */

export function PhoneAndPushPanel() {
  const { t } = useI18n();
  const mobile = useIsMobile();
  const [dialog, setDialog] = useState<{ open: boolean; selection: BotDialogSelection | null }>({ open: false, selection: null });

  const openDialog = (selection: BotDialogSelection | null) => setDialog({ open: true, selection });

  // fork:v5-landing Wave B · M-10 帧 D「standalone 首启」——
  // 窄屏上这一节是三步 onboarding（`.m-onboard` + `.m-step-card`）：连上电脑 /
  // 配对二维码 / 机器人渠道。两栏的桌面两列在手机上自然堆成一列，
  // 机器人管理仍是那张二级面板（窄屏形态见 BotChannelsDialog）。
  if (mobile) {
    return (
      <>
        <PwaPage title={t("phonePush.title")} bodyClass="m-onboard">
          <div className="m-hero">
            <div className="m-onboard-t">{t("phonePush.pageSub")}</div>
            <div className="m-onboard-s">{t("phonePush.quickOpen")}</div>
          </div>

          <div className="m-step-card">
            <div className="m-step-dot-lg">1</div>
            <div className="m-grow m-step-row-2">
              <div className="m-setrow-t">{t("phonePush.lanTitle")}</div>
              <div className="m-setrow-s">{t("phonePush.scanHint")}</div>
              <LanPairBody />
            </div>
          </div>

          <div className="m-step-card">
            <div className="m-step-dot-lg">2</div>
            <div className="m-grow m-step-row-2">
              <div className="m-setrow-t">{t("phonePush.botTitle")}</div>
              <div className="m-setrow-s">{t("phonePush.botColHint")}</div>
              <BotChannelBody onOpen={(channel: ChatChannelId) => openDialog(channel)} />
              <div className="m-tray">
                <button type="button" className="m-tray-chip" onClick={() => openDialog(null)}>
                  <i data-ico="bot" data-size="12" aria-hidden="true" />
                  {t("phonePush.botManage")}
                </button>
              </div>
            </div>
          </div>

          {/* fork:mobile-shell —— 壳内镜像库入口（不在壳里时 MirrorBody 返回 null） */}
          <MirrorBody />
        </PwaPage>
        <BotChannelsDialog
          open={dialog.open}
          initialSelection={dialog.selection}
          onClose={() => setDialog({ open: false, selection: null })}
        />
      </>
    );
  }

  return (
    <SettingsPage title={t("phonePush.title")} sub={t("phonePush.pageSub")}>
      <div
        style={{
          display: "grid",
          gap: "var(--nx-sp-4)",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
        }}
      >
        {/* v5 · D-20 帧 A/B：扫码卡 = `.d-chart` + `.d-chart-head` + `.d-card-body`。 */}
        <section className="d-chart" style={{ display: "grid", gridTemplateRows: "auto auto 1fr" }}>
          <div className="d-chart-head">
            <i data-ico="smartphone" data-size="15" aria-hidden="true" />
            {t("phonePush.scanTitle")}
          </div>
          <div className="d-card-body d-col" style={{ gap: "var(--nx-sp-3)", paddingBottom: 0 }}>
            <p className="d-t-xs d-t-faint" style={{ margin: 0 }}>{t("phonePush.scanHint")}</p>
          </div>
          <div className="d-card-body">
            <LanPairBody />
          </div>
        </section>

        {/* fork:mobile-shell —— 5G 控制（出门隧道）卡。 */}
        <TunnelBody />

        {/* v5 · D-20 帧 D：Bot Channel 入口卡。 */}
        <section className="d-chart" style={{ display: "grid", gridTemplateRows: "auto auto 1fr auto" }}>
          <div className="d-chart-head">
            <i data-ico="bot" data-size="15" aria-hidden="true" />
            {t("phonePush.botColTitle")}
          </div>
          <div className="d-card-body d-col" style={{ gap: "var(--nx-sp-3)" }}>
            <p className="d-t-xs d-t-faint" style={{ margin: 0 }}>{t("phonePush.botColHint")}</p>
            <BotChannelBody onOpen={(channel: ChatChannelId) => openDialog(channel)} />
          </div>
          <div className="d-card-body" style={{ paddingTop: 0 }}>
            <button
              type="button"
              className="d-btn"
              style={{ width: "100%" }}
              onClick={() => openDialog(null)}
            >
              <i data-ico="bot" data-size="13" aria-hidden="true" />
              {t("phonePush.botManage")}
              <span className="d-grow" />
              <i data-ico="chevron-right" data-size="13" aria-hidden="true" />
            </button>
          </div>
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
