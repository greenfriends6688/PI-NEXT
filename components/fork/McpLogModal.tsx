/**
 * fork:mcp-native-exposure —— 「查看 MCP 日志」弹层。
 *
 * pi 的 mcp 扩展把每个 server 的连接/工具事件写进 agent 目录的 `mcp.log`
 * （`dist/extensions/mcp/index.js:253`，超过阈值自己轮转成 `.1`）。此前这个文件对用户
 * 不可见：server 连不上时浏览器只有一句 `MCP failed to load: …`，看不到是哪个 server、
 * 握手断在哪一步。日志是这个场景唯一的第一手材料。
 *
 * 形态照画板 43 的导入弹层（同一个 `useDialogA11y` + `.pw-modal` 壳，挂在
 * `SettingsPage` 的兄弟位），所以背景 inert / Esc / 焦点循环都现成。
 */

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { ConfigButton } from "../SettingsUi";

interface McpLogEntry {
  text: string;
  /** 这一行被截掉了多少字符（路由侧不写本地化文案，由这里拼）。 */
  truncatedChars?: number;
}

interface McpLogPayload {
  path: string;
  exists: boolean;
  size: number;
  lines: McpLogEntry[];
  error?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function McpLogModal({ open, onDismiss }: { open: boolean; onDismiss: () => void }): React.ReactElement | null {
  const { t } = useI18n();
  const [data, setData] = useState<McpLogPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const { dialogRef, dialogProps } = useDialogA11y({ open, onClose: onDismiss });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/mcp/log?lines=300", { cache: "no-store" });
      const payload = (await response.json()) as McpLogPayload;
      setData(response.ok ? payload : { path: "", exists: false, size: 0, lines: [], error: payload.error });
    } catch (error) {
      setData({ path: "", exists: false, size: 0, lines: [], error: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Esc 由 useDialogA11y 接管（它注册的 keydown 只在 open 时生效）。
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      className="config-panel-root is-modal"
      onClick={(event) => { if (event.target === event.currentTarget) onDismiss(); }}
      aria-label={t("mcp.logTitle")}
    >
      <div className="config-panel-surface" style={{ width: "min(880px, calc(100vw - 32px))", height: "min(620px, calc(100dvh - 32px))" }}>
        <div className="config-panel-header">
          <span className="config-panel-title">{t("mcp.logTitle")}</span>
          {data?.exists && (
            <span className="config-panel-subtitle">
              {data.path} · {formatSize(data.size)}
            </span>
          )}
          <button
            type="button"
            className="config-close-button"
            onClick={onDismiss}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
          >
            ×
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "var(--s3) var(--s4)" }}>
          {loading && <div className="pw-hint">{t("mcp.logLoading")}</div>}
          {!loading && data?.error && (
            <div className="pw-alert bad">
              <span className="pw-ico"><i data-ico="triangle-alert" data-size="14"></i></span>
              <span className="pw-grow">{data.error}</span>
            </div>
          )}
          {!loading && data && !data.error && !data.exists && (
            <div className="pw-hint">{t("mcp.logEmpty")}</div>
          )}
          {!loading && data?.exists && (
            <pre
              className="pw-mono"
              style={{
                margin: 0,
                fontSize: "var(--text-meta)",
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                color: "var(--text-muted)",
              }}
            >
              {data.lines.map((line) => (
                line.truncatedChars
                  ? `${line.text}… (${t("mcp.logTruncated", { count: line.truncatedChars })})`
                  : line.text
              )).join("\n")}
            </pre>
          )}
        </div>

        <div className="config-panel-footer" style={{ display: "flex", justifyContent: "flex-end", gap: "var(--s2)", padding: "var(--s3) var(--s4)" }}>
          <ConfigButton variant="secondary" size="small" onClick={() => void load()} disabled={loading}>
            <span className="pw-ico"><i data-ico="refresh-cw" data-size="13" aria-hidden="true" /></span>
            {t("i18n.refresh")}
          </ConfigButton>
          <ConfigButton size="small" onClick={onDismiss}>
            {t("i18n.close")}
          </ConfigButton>
        </div>
      </div>
    </div>
  );
}