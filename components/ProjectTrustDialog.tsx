"use client";

import { useI18n } from "@/hooks/useI18n";

/**
 * fork:design-system SW-03 —— 项目信任对话框 = 画板 50 的 pw-modal 三态
 * （确认 / 信任中 / 失败）：head 图标随状态换（shield-question / loader-circle /
 * circle-x），正文说明「读写文件、执行命令」，cwd 走 pw-inline 面板 + mono。
 * 画板 foot 的「不信任」danger ghost 对应本产品的取消钮。
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

  const headIcon = error
    ? { ico: "circle-x", color: "var(--error)" }
    : busy
      ? { ico: "loader-circle", color: "var(--accent)" }
      : { ico: "shield-question", color: "var(--warning)" };

  return (
    <div
      role="presentation"
      // fork:ui-10 — hook for the phone bottom-sheet geometry in app/fork-ui.css
      data-fork-dialog="trust"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "var(--scrim)",
      }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-trust-title"
        className="pw-modal"
        style={{ width: 440, maxWidth: "100%" }}
      >
        <div className="pw-modal-head">
          <span className="pw-ico" style={{ color: headIcon.color, display: "inline-flex" }}>
            <i data-ico={headIcon.ico} data-size="16"></i>
          </span>
          <span id="project-trust-title">{t("trust.dialogTitle")}</span>
        </div>
        <div className="pw-modal-body">
          <p style={{ margin: 0 }}>{t("trust.dialogBody")}</p>
          <div
            className="pw-inline"
            style={{
              padding: "var(--s2)",
              border: "1px solid var(--n-border-subtle)",
              borderRadius: "var(--radius-4)",
              background: "var(--surface-panel)",
            }}
          >
            <span className="pw-ico pw-dim"><i data-ico="folder" data-size="14"></i></span>
            <span className="pw-mono" style={{ fontSize: "var(--text-meta)", minWidth: 0, overflowWrap: "anywhere" }}>{cwd}</span>
          </div>
          {error && (
            <div role="alert" style={{ margin: 0, color: "var(--error)", fontSize: "var(--text-meta)", lineHeight: 1.5 }}>
              <span className="pw-mono">{error}</span>
            </div>
          )}
        </div>
        <div className="pw-modal-foot">
          <button type="button" className="pw-btn outline sm" onClick={onCancel} disabled={busy}>
            {t("trust.cancel")}
          </button>
          <span className="grow" />
          <button
            type="button"
            className="pw-btn primary sm"
            onClick={onConfirm}
            disabled={busy}
            style={busy ? { opacity: 0.7, cursor: "wait" } : undefined}
          >
            {busy ? t("trust.trusting") : t("trust.trustProject")}
          </button>
        </div>
      </div>
    </div>
  );
}
