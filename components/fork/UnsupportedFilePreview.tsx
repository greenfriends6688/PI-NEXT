"use client";

import { useCallback, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
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

  // fork:design-system SW-D —— 兜底卡 = 画板的 `.pw-card`：头（`.pw-ico` + `.pw-tool`
  // + 类型 / 大小徽章）、体（原因与所在目录）、脚（可复制路径 + 两个画板按钮）。
  // 整块挂在 `.pw-empty` / `.pw-empty-inner` 上居中，视觉只剩 board.css 一个来源。
  return (
    <div className="pw-empty" role="status" style={{ height: "100%" }}>
      <div className="pw-empty-inner" style={{ width: "100%" }}>
        <div className="pw-card" style={{ width: "100%" }}>
          <div className="pw-card-head">
            <span className="pw-ico"><i data-ico="file" data-size="13"></i></span>
            <span className="pw-tool">{name}</span>
            <span className="pw-grow" />
            {extension ? <span className="pw-badge">{t("i18n.unsupportedType", { type: extension })}</span> : null}
            {sizeText ? <span className="pw-badge count">{sizeText}</span> : null}
          </div>
          <div className="pw-card-body">
            <p style={{ margin: "0 0 4px" }}>{t(unsupportedReasonKey(filePath))}</p>
            {cwd ? <p className="pw-dim" style={{ margin: 0 }}>{cwd}</p> : null}
          </div>
          <div className="pw-card-foot">
            {/* 保留一个可复制的路径，方便用户自己去终端处理。 */}
            <span className="pw-mono pw-dim">{encodeFilePathForApi(filePath)}</span>
            <span className="pw-grow" />
            <button
              type="button"
              className="pw-btn sm"
              disabled={busy !== null}
              onClick={() => void runAction("reveal")}
            >
              <span className="pw-ico"><i data-ico="folder-open" data-size="13"></i></span>
              {busy === "reveal" ? t("i18n.opening") : t("i18n.showInFolder")}
            </button>
            <button
              type="button"
              className="pw-btn sm primary"
              disabled={busy !== null}
              onClick={() => void runAction("open")}
            >
              <span className="pw-ico"><i data-ico="external-link" data-size="13"></i></span>
              {busy === "open" ? t("i18n.opening") : t("i18n.openWithDefaultApp")}
            </button>
          </div>
        </div>
        {error ? <div className="pw-alert" role="alert">{error}</div> : null}
      </div>
    </div>
  );
}
