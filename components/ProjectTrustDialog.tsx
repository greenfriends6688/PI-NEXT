"use client";

import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { PwaTrustSheet } from "./pwa/PwaTrustSheet";

/**
 * fork:design-components —— 项目信任对话框 = 画板 D-26b 帧 E「项目信任对话框」：
 * 三个状态是**同一个模态的三种头部图标**（shield-question / loader-circle / circle-x），
 * 壳是 `.d-modal.is-open` › `.d-modal-box` › `.d-modal-head` + `.d-modal-body` +
 * `.d-modal-foot`；正文里的 cwd 走 `.d-code`（图标 + mono path）。
 *
 * fork:v5-wave-b-sysstate —— 窄屏（`useIsMobile()`）走 M-10 帧 C-2 的
 * `.m-scrim.is-open` + `.m-sheet.is-open` 底部 sheet，DOM 在
 * `components/pwa/PwaTrustSheet.tsx`。三态与两枚动作的 props 不变。
 */
export function ProjectTrustDialog({
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
  const isMobile = useIsMobile();

  if (isMobile) {
    return <PwaTrustSheet cwd={cwd} busy={busy} error={error} onCancel={onCancel} onConfirm={onConfirm} />;
  }

  const headIcon = error
    ? { ico: "circle-x", color: "var(--nx-danger)" }
    : busy
      ? { ico: "loader-circle", color: "var(--nx-accent)" }
      : { ico: "shield-question", color: "var(--nx-warning)" };

  return (
    <div
      role="presentation"
      // fork:ui-10 — hook for the phone bottom-sheet geometry in app/fork-ui.css
      data-fork-dialog="trust"
      className="d-modal is-open"
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-trust-title"
        className="d-modal-box"
        style={{ width: 440, maxWidth: "100%" }}
      >
        <div className="d-modal-head d-row" style={{ alignItems: "flex-start" }}>
          <i data-ico={headIcon.ico} data-size="16" aria-hidden="true" style={{ color: headIcon.color, flexShrink: 0, marginTop: 2 }} />
          <span id="project-trust-title" className="d-grow">{t("trust.dialogTitle")}</span>
        </div>
        <div className="d-modal-body">
          <div>{t("trust.dialogBody")}</div>
          <div className="d-code">
            <div className="d-code-head">
              <i data-ico="folder" data-size="13" aria-hidden="true" />
              <span className="d-grow d-mono">{cwd}</span>
            </div>
          </div>
          {error && (
            <div className="d-err" role="alert">
              <span className="d-mono">{error}</span>
            </div>
          )}
        </div>
        <div className="d-modal-foot">
          <button type="button" className="d-btn ghost" onClick={onCancel} disabled={busy}>
            {t("trust.cancel")}
          </button>
          <span className="d-grow" />
          <button type="button" className="d-btn primary" onClick={onConfirm} disabled={busy}>
            <i data-ico="shield-check" data-size="14" aria-hidden="true" />
            {busy ? t("trust.trusting") : t("trust.trustProject")}
          </button>
        </div>
      </div>
    </div>
  );
}
