"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";

/*
 * fork:v5-wave-b-sysstate —— 手机上的项目信任对话框 = M-10 帧 C-2「三个选项」
 * 那张 sheet 的**壳**（`.m-scrim.is-open` › `.m-sheet.is-open` ›
 * `.m-sheet-grab` / `.m-sheet-title` / `.m-sheet-body` › `.m-pickbar`）。
 *
 * 为什么不是 `.m-modal`：M-10 的裁定是「目录信任钉在顶上直到处理为止」，
 * 交互是**一次一次就地回答**，不是打断式确认 —— 打断式确认（`.m-modal`）
 * 只留给不可逆动作（M-11 帧 B-3 的删除会话）。
 *
 * 三态与桌面同一个模态的三种头部图标一一对应（`d-modal` 的
 * shield-question / loader-circle / circle-x）：
 *   · 未决定 → `.m-banner`（shield-alert）+ 说明来源的一行；
 *   · 正在做 → `.m-run`（M-11 帧 E「三 · 正在做」，带图标与就地文案）；
 *   · 失败   → `.m-banner.err`（M-11 帧 D ③ / M-10 帧 C 的错误位）。
 * 行为零变化：同一个 `onCancel` / `onConfirm`，busy 时两钮都禁。
 *
 * 为什么走 portal（LANDING §2②「浮窗必查裁切」）：`.m-scrim` / `.m-sheet` 是
 * `position: absolute`，画板里它们的定位祖先是 `.m-phone-inner`；产品里没有那个
 * 取景框，若就地渲染会落到最近的定位祖先上（面板列）而不是视口。与
 * `DirectoryPicker` 一样 portal 到 body，DOM 类名一个字不改。
 *
 * fork:v5-wave-n1 · M-11 帧 C 的 **48 档**（`.m-touch-48` = `--nx-ctl-lg`，
 * 硬下限 44 之上的那一档）落在「一级行动钮」上 —— 本 sheet 的主按钮就是
 * 这一屏唯一的主动作。类是画板规格表自己点名要补的（帧 C 注记：
 * 「让规格与实现同源」），这里只挂类名，不写任何数值。
 */

export function PwaTrustSheet({
  cwd,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  cwd: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  if (!portalTarget) return null;

  return createPortal(
    /* 定位层：铁律四允许的「几何定位」。`.m-scrim` / `.m-sheet` 是 absolute，
       画板里靠 `.m-phone-inner` 定位；产品没有取景框，这层 fixed 让它们落到视口。 */
    <div style={{ position: "fixed", inset: 0, zIndex: "var(--nx-z-modal)" }}>
      <div
        className="m-scrim is-open"
        data-fork-dialog="trust"
        onClick={() => {
          if (!busy) onCancel();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-trust-title"
        className="m-sheet is-open"
      >
        {/* 抓手可点即收（div→button 的既定换法）；busy 中不许收，与遮罩同一守卫。
            命中区在 `app/design/v5-forms.css` 的接线层放大。 */}
        <div className="m-sheet-title" id="project-trust-title">
          {t("trust.dialogTitle")}
        </div>
        <div className="m-sheet-body">
          {busy ? (
            <div className="m-run">
              <i data-ico="loader-circle" data-size="14" aria-hidden="true" />
              {t("trust.trusting")}
            </div>
          ) : error ? (
            <div className="m-banner err" role="alert">
              <i data-ico="circle-x" data-size="14" aria-hidden="true" />
              <span className="m-grow m-mono">{error}</span>
            </div>
          ) : (
            <div className="m-banner">
              <i data-ico="shield-alert" data-size="14" aria-hidden="true" />
              <span className="m-grow">{t("trust.dialogBody")}</span>
            </div>
          )}

          {/* 目录来源：M-10 帧 C-1 用只读的路径行，这里用同义的 `.m-code`
              （图标 + mono 路径），与桌面 `.d-code` 一一对应。 */}
          <div className="m-code">
            <div className="m-code-head">
              <i data-ico="folder" data-size="13" aria-hidden="true" />
              <span className="m-grow m-mono">{cwd}</span>
            </div>
          </div>

          <div className="m-sep" />
          <div className="m-t-xs m-t-faint">{t("trust.mobileBannerBody")}</div>
        </div>
        <div className="m-pickbar">
          <button type="button" className="m-picktag" onClick={onCancel} disabled={busy}>
            {t("trust.cancel")}
          </button>
          <button type="button" className="m-picktag is-on m-touch-48" onClick={onConfirm} disabled={busy}>
            {busy ? t("trust.trusting") : t("trust.trustProject")}
          </button>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}

/**
 * `.m-trust` —— 目录信任的**常驻条**（M-10 帧 C-1），不是一次性弹窗。
 *
 * 画板原文：
 *   <div class="m-trust">
 *     <i data-ico="shield-alert" data-size="14"></i>
 *     <span class="m-setrow-body m-grow">
 *       <span class="m-setrow-t">未信任目录 · ~/Projects/pi-next</span>
 *       <span class="m-setrow-s">命令与文件写入会被拦下，直到你处理它</span>
 *     </span>
 *     <button class="m-top-btn"><i data-ico="chevron-right" data-size="15"></i></button>
 *   </div>
 * 它的位置纪律也照板：断网条与它同在 `top: 0`，库里的 `.m-offline ~ .m-trust`
 * 兄弟选择器负责把信任条自动落到断网条下面 —— 所以两件必须是**兄弟**，
 * 中间不许再包一层（那会让 `~` 失配，两条横幅叠在一起）。
 *
 * 与板面的两处差别都记在这里（板面是一张状态图，产品要能真的用）：
 *   ① 尾件：板面那一枚是「开三选项 sheet」的 chevron，而产品的信任模型只有一个动作
 *      （授权本目录），且 SW-16 的用户裁定要求「横幅内联『信任』按钮直接完成」——
 *      所以尾件换成同尺寸的行动钮，不把这条一次动作拆成两级。
 *   ② `position` 摆回流内：板面把横幅画在屏幕最顶上（帧 C-1 根本没有顶栏），
 *      而产品那里是 `.m-top`（绝对定位的渐隐顶栏 + 抽屉钮）；真跑到 `top: 0`
 *      会把抽屉入口盖住。除位置外的底色 / 描边 / 内距 / 字号全部由 `.m-trust` 给。
 */
export function PwaTrustBanner({
  cwd,
  busy,
  error,
  onTrust,
}: {
  cwd: string;
  busy: boolean;
  error: string | null;
  onTrust: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="m-trust"
      data-mobile-trust-banner="true"
      role={error ? "alert" : "status"}
      style={{ position: "static" }}
    >
      <i data-ico="shield-alert" data-size="14" aria-hidden="true" />
      <span className="m-setrow-body m-grow">
        <span className="m-setrow-t">
          {t("trust.resourcesNotLoaded")} · <span className="m-mono">{cwd}</span>
        </span>
        <span className="m-setrow-s">
          {error ?? t("trust.mobileBannerBody")}
        </span>
      </span>
      <button
        type="button"
        className="m-btn primary sm m-touch-44"
        disabled={busy}
        onClick={onTrust}
      >
        {busy ? t("trust.trusting") : t("trust.trustShort")}
      </button>
    </div>
  );
}
