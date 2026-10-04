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
        <div className="m-sheet-grab" />
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
          <button type="button" className="m-picktag is-on" onClick={onConfirm} disabled={busy}>
            {busy ? t("trust.trusting") : t("trust.trustProject")}
          </button>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}
