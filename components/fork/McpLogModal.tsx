/**
 * fork:mcp-native-exposure —— 「查看 MCP 日志」弹层。
 *
 * pi 的 mcp 扩展把每个 server 的连接/工具事件写进 agent 目录的 `mcp.log`
 * （`dist/extensions/mcp/index.js:253`，超过阈值自己轮转成 `.1`）。此前这个文件对用户
 * 不可见：server 连不上时浏览器只有一句 `MCP failed to load: …`，看不到是哪个 server、
 * 握手断在哪一步。日志是这个场景唯一的第一手材料。
 *
 * 形态照 v5 画板 D-15 帧 D 的日志块（同一个 `useDialogA11y` + `.d-modal` 壳，挂在
 * `SettingsPage` 的兄弟位），所以背景 inert / Esc / 焦点循环都现成。
 */

import { useCallback, useEffect, useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { PwaBanner } from "@/components/pwa/PwaPage";
import { PwaSheet } from "@/components/pwa/PwaSheet";

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
  const mobile = useIsMobile();
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

  // fork:v5-landing Wave B · M-10 · 窄屏上日志走底部面板 `.m-sheet`，
  // 日志体是 `.m-code` / `.m-code-head` / `.m-code-body`（画板 M-11 的日志块）。
  // 行数、截断标记与刷新动作全不变。
  if (mobile) {
    return (
      <PwaSheet
        open
        title={t("mcp.logTitle")}
        label={t("mcp.logTitle")}
        onClose={onDismiss}
        footer={
          <>
            <button type="button" className="m-picktag" onClick={() => void load()} disabled={loading}>
              <i data-ico="refresh-cw" data-size="13" aria-hidden="true" />
              {t("i18n.refresh")}
            </button>
            <button type="button" className="m-picktag is-on" onClick={onDismiss}>
              {t("i18n.close")}
            </button>
          </>
        }
      >
        {loading && <p className="m-t-xs m-t-faint">{t("mcp.logLoading")}</p>}
        {!loading && data?.error && (
          <PwaBanner icon="triangle-alert" tone="err" role="alert">{data.error}</PwaBanner>
        )}
        {!loading && data && !data.error && !data.exists && (
          <p className="m-t-xs m-t-faint">{t("mcp.logEmpty")}</p>
        )}
        {!loading && data?.exists && (
          <div className="m-code">
            <div className="m-code-head">
              <i data-ico="file-diff" data-size="14" aria-hidden="true" />
              <span className="m-mono m-grow">{data.path}</span>
              <span className="m-mono">{formatSize(data.size)}</span>
            </div>
            <div className="m-code-scroll">
              <pre className="m-code-body">
                {data.lines.map((line) => (
                  line.truncatedChars
                    ? `${line.text}… (${t("mcp.logTruncated", { count: line.truncatedChars })})`
                    : line.text
                )).join("\n")}
              </pre>
            </div>
          </div>
        )}
      </PwaSheet>
    );
  }

  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      className="d-modal is-open"
      onClick={(event) => { if (event.target === event.currentTarget) onDismiss(); }}
      aria-label={t("mcp.logTitle")}
    >
      {/* fork:v5-landing D-15 帧 D「日志」—— `.d-modal-box` › `.d-modal-head`
          （图标 + 标题 + grow + `.d-iconbtn`）› `.d-modal-body`（`.d-code` 日志体）›
          `.d-modal-foot` 刷新/关闭。 */}
      <div
        className="d-modal-box wide"
        style={{ width: "min(880px, calc(100vw - 32px))", height: "min(620px, calc(100dvh - 32px))" }}
      >
        <div className="d-modal-head d-row">
          <i data-ico="file-diff" data-size="16" aria-hidden="true" />
          <span className="d-grow">{t("mcp.logTitle")}</span>
          {data?.exists && (
            <span className="d-t-xs d-t-faint d-mono">
              {data.path} · {formatSize(data.size)}
            </span>
          )}
          <button
            type="button"
            className="d-iconbtn"
            onClick={onDismiss}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
          >
            <i data-ico="x" data-size="14" aria-hidden="true" />
          </button>
        </div>

        <div className="d-modal-body" style={{ flex: "1 1 auto" }}>
          {loading && <div className="d-t-xs d-t-faint">{t("mcp.logLoading")}</div>}
          {!loading && data?.error && (
            <div className="d-banner err">
              <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
              <span className="d-grow">{data.error}</span>
            </div>
          )}
          {!loading && data && !data.error && !data.exists && (
            <div className="d-t-xs d-t-faint">{t("mcp.logEmpty")}</div>
          )}
          {!loading && data?.exists && (
            <div className="d-code" style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
              <pre
                className="d-code-body"
                style={{ flex: "1 1 auto", minHeight: 0, margin: 0, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
              >
                {data.lines.map((line) => (
                  line.truncatedChars
                    ? `${line.text}… (${t("mcp.logTruncated", { count: line.truncatedChars })})`
                    : line.text
                )).join("\n")}
              </pre>
            </div>
          )}
        </div>

        <div className="d-modal-foot">
          <button type="button" className="d-btn sm" onClick={() => void load()} disabled={loading}>
            <i data-ico="refresh-cw" data-size="13" aria-hidden="true" />
            {t("i18n.refresh")}
          </button>
          <button type="button" className="d-btn sm" onClick={onDismiss}>
            {t("i18n.close")}
          </button>
        </div>
      </div>
    </div>
  );
}