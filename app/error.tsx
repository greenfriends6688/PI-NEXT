"use client";

import { useEffect } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { PwaPageError } from "@/components/pwa/ErrorStates";

/**
 * fork:gap-error-boundary — 应用级错误边界。
 *
 * fork:design-components —— 形态照画板 D-26b 帧 B「段级 · app/error.tsx」：
 * `.d-empty`（`.d-empty-ico` / `.d-empty-t` / `.d-empty-s`）+ `.d-code`（digest）
 * + `.d-row` 里的两枚 `.d-btn`。生产环境里的 message 被脱敏，只有 digest 能对照
 * 服务端日志；完整堆栈留在控制台。
 *
 * 注意（Next 16 约定）：错误边界的恢复函数叫 `retry`，不是 `reset`；且必须是客户端
 * 组件。错误页可能在任何主题变量挂上之前渲染，所以外层配色保留内联 `var()` 兜底。
 *
 * fork:v5-wave-b-sysstate —— 窄屏走 M-11 帧 F-1 的 `.m-empty` 四件 + digest 的
 * `.m-code` + `.m-pickbar` 两颗钮（见 `components/pwa/ErrorStates.tsx`）。
 * 两级都给「重试」，这是 M-11 帧 D ⑪ / 帧 F 的硬判据。
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { t } = useI18n();
  const isMobile = useIsMobile();

  useEffect(() => {
    console.error("[pi-web] render error boundary", error);
  }, [error]);

  if (isMobile) {
    return (
      <PwaPageError
        title={t("error.boundaryTitle")}
        hint={t("error.boundaryHint")}
        digest={error.digest}
        digestLabel={t("error.boundaryDigest")}
        style={{ margin: "0 auto", maxWidth: 560, minHeight: "60vh" }}
        actions={[
          { key: "retry", label: t("error.boundaryRetry"), icon: "rotate-cw", variant: "primary", onClick: () => retry() },
          { key: "reload", label: t("error.boundaryReload"), icon: "refresh-cw", onClick: () => window.location.reload() },
        ]}
      />
    );
  }

  return (
    <div
      role="alert"
      className="d-empty"
      style={{ margin: "0 auto", maxWidth: 560, minHeight: "60vh", color: "var(--nx-text, CanvasText)" }}
    >
      <div className="d-empty-ico" style={{ color: "var(--nx-danger, #d64545)" }}>
        <i data-ico="triangle-alert" data-size="20" aria-hidden="true" />
      </div>
      <div className="d-empty-t">{t("error.boundaryTitle")}</div>
      <div className="d-empty-s">{t("error.boundaryHint")}</div>
      {error.digest && (
        <div className="d-code" style={{ alignSelf: "stretch", maxWidth: 420 }}>
          <div className="d-code-head">
            <span className="d-grow">{t("error.boundaryDigest")}</span>
          </div>
          <div className="d-code-body">{error.digest}</div>
        </div>
      )}
      <div className="d-row">
        <button type="button" className="d-btn sm primary" onClick={() => retry()}>
          <i data-ico="rotate-cw" data-size="13" aria-hidden="true" />
          {t("error.boundaryRetry")}
        </button>
        <button type="button" className="d-btn sm" onClick={() => window.location.reload()}>
          <i data-ico="refresh-cw" data-size="13" aria-hidden="true" />
          {t("error.boundaryReload")}
        </button>
      </div>
    </div>
  );
}
