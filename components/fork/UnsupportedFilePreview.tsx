"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { encodeFilePathForApi, getFileName } from "@/lib/file-paths";
import { unsupportedReasonKey } from "@/lib/file-preview-support";

/**
 * fork:gap-unsupported-preview — 无法预览文件的降级卡片。
 *
 * 原先二进制文件（zip/exe/sqlite/wasm/字体…）会被当作 UTF-8 文本渲染，
 * 用户看到的是一片乱码，既不知道这是二进制、也没有"用系统应用打开"的入口。
 * 这里给一个明确的卡片：文件名、类型、大小、修改时间，以及两个动作
 * （用默认应用打开 / 在文件管理器中显示）。
 *
 * 复用已有的 `/api/files/reveal`（它已经走 allow-list，argv 数组不经 shell），
 * 不新增任何服务端能力。
 */
export interface UnsupportedFilePreviewProps {
  filePath: string;
  cwd?: string;
  /** 已知大小（字节）；未知则不显示。 */
  size?: number | null;
  sourceSessionId?: string | null;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const digits = size >= 100 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(digits)} ${units[unitIndex]}`;
}

export function UnsupportedFilePreview({ filePath, cwd, size, sourceSessionId }: UnsupportedFilePreviewProps) {
  const { t } = useI18n();
  // M-06 帧 F · 手机档：降级卡 = `.m-viewbox`（`.m-doc-head` + `.m-doc-body`）+
  // `.m-pickbar` 两条替代路径。画板原话「降级不是白屏：至少给两条替代路径」——
  // 两条动作与桌面**完全相同**（同一个 `runAction`、同一个 `/api/files/reveal`），
  // 只是容器从卡片脚换成确认条；`src`-free 的纯展示壳，两档不共用 DOM。 */
  const isMobile = useIsMobile();
  const [busy, setBusy] = useState<"open" | "reveal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const name = getFileName(filePath);
  const extension = name.includes(".") ? name.split(".").pop() ?? "" : "";

  const runAction = useCallback(async (action: "open" | "reveal") => {
    setBusy(action);
    setError(null);
    try {
      const response = await fetch("/api/files/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: filePath,
          action,
          ...(sourceSessionId ? { sessionId: sourceSessionId } : {}),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${response.status}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [filePath, sourceSessionId]);

  const sizeText = typeof size === "number" ? formatBytes(size) : "";

  // fork:v5-landing —— 兜底卡 = D-06b 帧 E 的降级卡：`.d-empty` 居中，里面一张
  // `.d-card`（头：file 图标 + 等宽文件名 + 类型/大小徽章；体：原因与所在目录；
  // 脚：可复制路径 + 两枚 `.d-btn`）。整块不再有产品自有视觉类。
  if (isMobile) {
    return (
      <>
        <div className="m-viewbox">
          <div className="m-doc-head">
            <i data-ico="file" data-size="14" aria-hidden="true"></i>
            <span className="m-grow m-mono">{name}</span>
            {extension ? <span className="m-badge mute">{t("i18n.unsupportedType", { type: extension })}</span> : null}
            {sizeText ? <span className="m-badge mute">{sizeText}</span> : null}
          </div>
          <div className="m-doc-body">
            <div className="m-t-xs">{t(unsupportedReasonKey(filePath))}</div>
            {cwd ? <div className="m-t-faint">{cwd}</div> : null}
          </div>
        </div>

        {/* fork:v5-frame-audit —— 画板帧 F 在降级卡与两条动作之间有一句判据
            （`.m-group-title`）：「降级不是白屏」。这句话是这块卡的用途说明，
            去掉之后两条动作看起来只是两个按钮。 */}
        <div className="m-group-title">{t("i18n.unsupportedFallbackHint")}</div>

        <div className="m-pickbar">
          <button
            type="button"
            className="m-picktag"
            disabled={busy !== null}
            onClick={() => void runAction("reveal")}
          >
            <i data-ico="folder-open" data-size="15" aria-hidden="true"></i>
            {busy === "reveal" ? t("i18n.opening") : t("i18n.showInFolder")}
          </button>
          <button
            type="button"
            className="m-picktag is-on"
            disabled={busy !== null}
            onClick={() => void runAction("open")}
          >
            <i data-ico="external-link" data-size="15" aria-hidden="true"></i>
            {busy === "open" ? t("i18n.opening") : t("i18n.openWithDefaultApp")}
          </button>
        </div>

        {error ? (
          <div role="alert" className="m-banner err">
            <i data-ico="circle-alert" data-size="14" aria-hidden="true"></i>
            <span className="m-grow">{error}</span>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="d-empty" role="status" style={{ height: "100%" }}>
      <div className="d-card" style={{ width: "100%", maxWidth: 560 }}>
        <div className="d-card-head">
          <i data-ico="file" data-size="14"></i>
          <span className="d-grow d-mono">{name}</span>
          {extension ? <span className="d-badge mute">{t("i18n.unsupportedType", { type: extension })}</span> : null}
          {sizeText ? <span className="d-badge mute">{sizeText}</span> : null}
        </div>
        {/* fork:v5-landing D-06b 帧 E —— `.d-t-xs` 挂在卡片体上（板面原文），
            不再另套一层只有字号的 div：两处字号档此前是重复的一份来源。 */}
        <div className="d-card-body d-t-xs">
          <div>{t(unsupportedReasonKey(filePath))}</div>
          {cwd ? <div className="d-t-faint">{cwd}</div> : null}
        </div>
        <div className="d-pop-foot" style={{ borderTop: "1px solid var(--nx-line)" }}>
          {/* 保留一个可复制的路径，方便用户自己去终端处理。 */}
          <span className="d-mono">{encodeFilePathForApi(filePath)}</span>
          <span className="d-grow" />
          <button
            type="button"
            className="d-btn sm"
            disabled={busy !== null}
            onClick={() => void runAction("reveal")}
          >
            <i data-ico="folder-open" data-size="13"></i>
            {busy === "reveal" ? t("i18n.opening") : t("i18n.showInFolder")}
          </button>
          <button
            type="button"
            className="d-btn sm primary"
            disabled={busy !== null}
            onClick={() => void runAction("open")}
          >
            <i data-ico="external-link" data-size="13"></i>
            {busy === "open" ? t("i18n.opening") : t("i18n.openWithDefaultApp")}
          </button>
        </div>
      </div>
      {error ? (
        <div className="d-banner err" role="alert">
          <i data-ico="circle-alert" data-size="14"></i>
          <span className="d-grow">{error}</span>
        </div>
      ) : null}
    </div>
  );
}
