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
import { localCopy, type LocalCopy } from "@/components/settings-disabled-reasons";
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

/* fork:v5-landing · D-15 帧 D「每页 50 行」——
 * 画板的分页器是真的（`.d-pagebar` › `.d-page`，`.is-on` 是当前页，
 * 首页的「上一页」在第 1 页 disabled），不是画上去的装饰：
 * 排查「工具能不能调」时 99% 的人要的是错误，而 mcp.log 动辄几百行，
 * 一次糊在屏幕上等于没有日志。这里只切**显示窗口**，
 * 拉取的行数（`?lines=300`）、读取路径与刷新动作一个字都不改。 */
const LOG_PAGE_SIZE = 50;

/**
 * 画板帧 D 的分页器原样落地。**页码是纯数字**，所以这一段不需要新的 i18n key；
 * 上一页 / 下一行的无障碍名用 `localCopy`（与 `settingsHub.ts` / `ThemeSkinStudio`
 * 同一口径：`lib/i18n/messages/**` 这一轮不许改，先在本地表里落字）。
 */
const LOG_PAGER_COPY: Record<"prev" | "next" | "foot", LocalCopy> = {
  prev: { en: "Previous page", "zh-CN": "上一页", "zh-TW": "上一頁" },
  next: { en: "Next page", "zh-CN": "下一页", "zh-TW": "下一頁" },
  foot: {
    en: "Kept for 7 days · 50 lines per page · authorizing refreshes the state right here",
    "zh-CN": "日志只留 7 天 · 每页 50 行 · 授权动作在这里当场刷新状态",
    "zh-TW": "日誌只留 7 天 · 每頁 50 行 · 授權動作在這裡當場重新整理狀態",
  },
};

/**
 * 画板帧 D 的页码窗口：当前页永远居中，两侧各留一页（1 → ‹ 1 2 ›）。
 * `d-page` 是 `button`，`.is-on` 是状态类，disabled 只由「越界」决定 ——
 * 不因为页数少就把箭头点亮成一个按了没反应的按钮。
 */
function LogPageBar({
  page,
  pageCount,
  onSelect,
}: {
  page: number;
  pageCount: number;
  onSelect: (next: number) => void;
}) {
  const { locale } = useI18n();
  if (pageCount <= 1) return null;
  const first = Math.max(1, Math.min(page - 1, pageCount - 2));
  const pages = Array.from({ length: Math.min(3, pageCount) }, (_, index) => first + index);
  return (
    <div className="d-pagebar">
      <button
        type="button"
        className="d-page"
        disabled={page <= 1}
        onClick={() => onSelect(page - 1)}
        title={localCopy(LOG_PAGER_COPY.prev, locale)}
        aria-label={localCopy(LOG_PAGER_COPY.prev, locale)}
      >
        <i data-ico="chevron-left" data-size="12" aria-hidden="true" />
      </button>
      {pages.map((value) => (
        <button
          key={value}
          type="button"
          className={`d-page${value === page ? " is-on" : ""}`}
          aria-current={value === page ? "page" : undefined}
          onClick={() => onSelect(value)}
        >
          {value}
        </button>
      ))}
      <button
        type="button"
        className="d-page"
        disabled={page >= pageCount}
        onClick={() => onSelect(page + 1)}
        title={localCopy(LOG_PAGER_COPY.next, locale)}
        aria-label={localCopy(LOG_PAGER_COPY.next, locale)}
      >
        <i data-ico="chevron-right" data-size="12" aria-hidden="true" />
      </button>
    </div>
  );
}

export function McpLogModal({ open, onDismiss }: { open: boolean; onDismiss: () => void }): React.ReactElement | null {
  const { t, locale } = useI18n();
  const mobile = useIsMobile();
  const [data, setData] = useState<McpLogPayload | null>(null);
  const [loading, setLoading] = useState(false);
  // fork:v5-landing · D-15 帧 D —— 分页只切显示窗口，不重新拉取。
  const [page, setPage] = useState(1);
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

  // 重新拉取后行数会变 —— 页码夹回合法范围，避免停在第 9 页而只有 2 页内容。
  const pageCount = Math.max(1, Math.ceil((data?.lines.length ?? 0) / LOG_PAGE_SIZE));
  useEffect(() => {
    setPage((current) => Math.min(Math.max(1, current), pageCount));
  }, [pageCount]);

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
            {/* fork:v5-landing · D-15 帧 D 的分页：窄屏上同一份 50 行/页的口径
                （`.m-pickbar` 里的 `.m-picktag`，`.is-on` = 当前页），
                与桌面 `.d-pagebar` 是同一份页码状态，不是两套。 */}
            {pageCount > 1 ? (
              <button
                type="button"
                className="m-picktag"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                <i data-ico="chevron-left" data-size="13" aria-hidden="true" />
              </button>
            ) : null}
            {pageCount > 1 ? (
              <span className={`m-picktag${page >= 1 ? " is-on" : ""}`}>
                {`${page} / ${pageCount}`}
              </span>
            ) : null}
            {pageCount > 1 ? (
              <button
                type="button"
                className="m-picktag"
                disabled={page >= pageCount}
                onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              >
                <i data-ico="chevron-right" data-size="13" aria-hidden="true" />
              </button>
            ) : null}
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
                {data.lines
                  .slice((page - 1) * LOG_PAGE_SIZE, page * LOG_PAGE_SIZE)
                  .map((line) => (
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
            <>
              <div className="d-code" style={{ flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
                <pre
                  className="d-code-body"
                  style={{ flex: "1 1 auto", minHeight: 0, margin: 0, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {data.lines
                    .slice((page - 1) * LOG_PAGE_SIZE, page * LOG_PAGE_SIZE)
                    .map((line) => (
                      line.truncatedChars
                        ? `${line.text}… (${t("mcp.logTruncated", { count: line.truncatedChars })})`
                        : line.text
                    )).join("\n")}
                </pre>
              </div>
              {/* fork:v5-landing · D-15 帧 D 的分页行：说明在左、`.d-pagebar` 在右。
                  行数、截断标记、刷新与关闭全部不变。 */}
              <div className="d-row" style={{ marginTop: "var(--nx-sp-2)" }}>
                <span className="d-t-xs d-t-faint d-grow">{localCopy(LOG_PAGER_COPY.foot, locale)}</span>
                <LogPageBar page={page} pageCount={pageCount} onSelect={setPage} />
              </div>
            </>
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