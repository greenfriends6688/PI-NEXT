"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { normalizeBrowserUrl, type BrowserTab } from "./browser-tab-state";
import { PortalDropdown } from "./PortalDropdown";
import {
  browserSurfaceHint,
  detectBrowserHostSessionId,
  detectBrowserSurface,
  notifyBrowserHostBridge,
  type BrowserSurface,
} from "@/lib/browser-view";

interface Props {
  tab: BrowserTab;
  /** Keep the tab's url in AppShell state so sessionStorage survives a refresh. */
  onChangeUrl: (tabId: string, url: string) => void;
  /** 聊天会话 id：桌面端按它隔离浏览器 profile，Web 端忽略。 */
  sessionId?: string;
}

/**
 * An in-app browser for local services (dev servers, docs servers, localhost
 * tools) — and, on the desktop build, a **managed** browser the agent can drive.
 *
 * fork:proma-42-browser · 42a: the Web/Electron fork now lives in exactly one place,
 * `lib/browser-view.ts`. This component asks for a `surface` and renders against it:
 *
 *   · `iframe` (web, and desktop without the host wired) — unchanged from before.
 *     Sites that send `X-Frame-Options: DENY` or a `frame-ancestors` CSP simply stay
 *     blank; the toolbar offers "open in a new window" for those.
 *   · `managed` (desktop, host registered) — the page is a real `WebContentsView`
 *     owned by the main process. The element below is only a **placeholder**: it
 *     reports its own box so the native view can be laid over it exactly, and it
 *     carries the same toolbar, history and empty state as the iframe path.
 *
 * Nothing here branches on `window.piWebDesktop`, and nothing here talks to Electron
 * APIs directly — a missing bridge is a one-line degradation in the adapter, never a
 * blank panel.
 */
export function BrowserPanel({ tab, onChangeUrl, sessionId }: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(tab.url);
  const [history, setHistory] = useState<string[]>(() => (tab.url ? [tab.url] : []));
  const [historyIndex, setHistoryIndex] = useState(() => (tab.url ? 0 : -1));
  const [reloadKey, setReloadKey] = useState(0);
  // fork:ui-30 — viewport preset. `null` keeps the iframe filling the panel; a
  // number pins it to a device width and centres it, which is the only way to
  // check a responsive layout without a second device.
  const [viewport, setViewport] = useState<number | null>(null);
  // fork:design-system SW-06 — 视口预设按画板 31 是一枚 `.pw-chipbtn`，点开是
  // `.pw-pop` 列表（不是原生 <select>）。
  const [viewportOpen, setViewportOpen] = useState(false);
  const viewportAnchorRef = useRef<HTMLButtonElement | null>(null);
  const viewportPanelRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);

  // fork:proma-42-browser · 宿主判定**同步**完成：首帧就必须知道画 iframe 还是画占位。
  const surface: BrowserSurface = useMemo(() => detectBrowserSurface(), []);
  const hostSessionId = useMemo(() => sessionId ?? detectBrowserHostSessionId(tab.id), [sessionId, tab.id]);

  // A tab restored from sessionStorage carries a url the component never saw.
  useEffect(() => {
    setDraft(tab.url);
    setHistory(tab.url ? [tab.url] : []);
    setHistoryIndex(tab.url ? 0 : -1);
  }, [tab.id, tab.url]);

  const currentUrl = history[historyIndex] ?? "";

  const navigate = (input: string, { replace = false } = {}) => {
    const url = normalizeBrowserUrl(input);
    if (!url) return;
    setDraft(url);
    onChangeUrl(tab.id, url);
    if (replace || historyIndex < 0) {
      setHistory((entries) => [...entries.slice(0, historyIndex + 1), url]);
      setHistoryIndex((index) => (historyIndex < 0 ? 0 : index + 1));
      return;
    }
    // Same url: just reload.
    if (url === currentUrl) {
      setReloadKey((key) => key + 1);
      return;
    }
    setHistory((entries) => [...entries.slice(0, historyIndex + 1), url]);
    setHistoryIndex(historyIndex + 1);
  };

  const go = (delta: number) => {
    const next = historyIndex + delta;
    if (next < 0 || next >= history.length) return;
    setHistoryIndex(next);
    const url = history[next];
    setDraft(url);
    onChangeUrl(tab.id, url);
  };

  /**
   * fork:proma-42-browser · 把占位盒子的屏幕坐标交给主进程。
   *
   * WebContentsView 画在 DOM 之外（它不是 renderer 的元素），所以必须由 renderer 报
   * 自己的 `getBoundingClientRect`。窗口缩放 / 面板拖动 / 视口预设切换都会改这个盒子，
   * 因此这里挂 ResizeObserver + scroll 监听，而不是只在挂载时算一次。
   *
   * 退化路径（iframe）下这个 effect 什么都不做：桥不存在时通知函数直接返回。
   */
  const reportLayout = useCallback(() => {
    if (surface !== "managed") return;
    const element = slotRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    notifyBrowserHostBridge("layout", [hostSessionId, {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    }]);
  }, [surface, hostSessionId]);

  useEffect(() => {
    if (surface !== "managed") return;
    const element = slotRef.current;
    notifyBrowserHostBridge("setPresentation", [hostSessionId, true]);
    reportLayout();
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(reportLayout);
    observer.observe(element);
    window.addEventListener("resize", reportLayout);
    window.addEventListener("scroll", reportLayout, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reportLayout);
      window.removeEventListener("scroll", reportLayout, true);
      // 面板收起 = 这个 session 回到后台，主进程据此把它算作「可回收」。
      notifyBrowserHostBridge("setPresentation", [hostSessionId, false]);
    };
  }, [surface, hostSessionId, reportLayout]);

  // fork:design-system SW-06 —— 视口预设清单：图标与顺序照画板 31 帧 B。
  const VIEWPORT_PRESETS = [
    { value: null, icon: "maximize-2", label: t("browser.viewportFill") },
    { value: 390, icon: "smartphone", label: t("browser.viewportPhone") },
    { value: 768, icon: "tablet", label: t("browser.viewportTablet") },
    { value: 1024, icon: "monitor", label: t("browser.viewportLaptop") },
    { value: 1280, icon: "monitor", label: t("browser.viewportDesktop") },
  ] as const;

  return (
    <div className="pw-browser">
      {/* fork:design-system SW-06 —— 头行 = pw-viewer-head（画板 31：地址栏 + 视口预设）。 */}
      <div className="pw-browser-bar">
        <button
          type="button"
          className="pw-iconbtn sm"
          title={t("browser.back")}
          aria-label={t("browser.back")}
          disabled={historyIndex <= 0}
          onClick={() => go(-1)}
        >
          <span className="pw-ico"><i data-ico="arrow-left" data-size="14"></i></span>
        </button>
        <button
          type="button"
          className="pw-iconbtn sm"
          title={t("browser.forward")}
          aria-label={t("browser.forward")}
          disabled={historyIndex >= history.length - 1}
          onClick={() => go(1)}
        >
          <span className="pw-ico"><i data-ico="arrow-right" data-size="14"></i></span>
        </button>
        <button
          type="button"
          className="pw-iconbtn sm"
          title={t("browser.reload")}
          aria-label={t("browser.reload")}
          disabled={!currentUrl}
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <span className="pw-ico"><i data-ico="rotate-cw" data-size="14"></i></span>
        </button>
        {/* fork:design-system SW-06 —— 地址栏 = 画板 31 的 .pw-url（等宽、面板底、细边框）。
           .pw-url 在画板里是 span，这里是真实 input：只补上边框/底色归零之外的行为样式。 */}
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            navigate(draft);
          }}
          placeholder={t("browser.addressPlaceholder")}
          aria-label={t("browser.address")}
          spellCheck={false}
          autoComplete="off"
          className="pw-url"
          /* fork:board-diff-2026-10-01 —— 地址栏的等宽字体/字号由 board.css 的
             `.pw-url`（font-family var(--font-mono) / font-size var(--text-meta)）承担，
             这里只留布局所需的 min-width。原来的 `font: "inherit"` 把等宽 11px 顶成了
             UI 无衬线 13px —— `31-terminal-browser-git` 的 spec 把它报成了漂移。 */
          style={{ minWidth: 0 }}
        />
        <a
          href={currentUrl || undefined}
          target="_blank"
          rel="noopener noreferrer"
          title={t("browser.openExternal")}
          aria-label={t("browser.openExternal")}
          className="pw-iconbtn sm"
          aria-disabled={!currentUrl}
          style={{ opacity: currentUrl ? 1 : 0.45, pointerEvents: currentUrl ? "auto" : "none" }}
        >
          <span className="pw-ico"><i data-ico="external-link" data-size="14"></i></span>
        </a>
        {/* fork:ui-30 + fork:design-system SW-06 —— 视口预设：画板 31 是一枚
            `.pw-chipbtn`，点开是 `.pw-pop` 列表；portal 到 body 免得被右栏裁掉。 */}
        <button
          ref={viewportAnchorRef}
          type="button"
          className="pw-chipbtn"
          aria-haspopup="menu"
          aria-expanded={viewportOpen}
          title={t("browser.viewport")}
          aria-label={t("browser.viewport")}
          onClick={() => setViewportOpen((open) => !open)}
        >
          <span className="pw-ico"><i data-ico={viewport === null ? "maximize-2" : "smartphone"} data-size="13"></i></span>
          <span>{viewport === null ? t("browser.viewportFill") : `${viewport}`}</span>
          <span className="pw-ico"><i data-ico="chevron-down" data-size="11"></i></span>
        </button>
      </div>

      <PortalDropdown
        open={viewportOpen}
        anchorRef={viewportAnchorRef}
        panelRef={viewportPanelRef}
        className="pw-pop"
        width={200}
        align="right"
      >
        {VIEWPORT_PRESETS.map((preset) => (
          <button
            key={preset.value ?? "fill"}
            type="button"
            className={`pw-prow${viewport === preset.value ? " is-on" : ""}`}
            onClick={() => {
              setViewport(preset.value);
              setViewportOpen(false);
            }}
          >
            <span className="pw-ico"><i data-ico={preset.icon} data-size="14"></i></span>
            <span className="grow">{preset.label}</span>
            {viewport === preset.value && <span className="pw-ico"><i data-ico="check" data-size="14"></i></span>}
          </button>
        ))}
      </PortalDropdown>

      {currentUrl ? (
        <div className="pw-browser-body">
        {surface === "managed" ? (
          /* fork:proma-42-browser · 受管路径：这一格只是占位，真正的页面是主进程里的
             WebContentsView，由上面的 effect 把这个盒子的屏幕坐标报过去。占位自身
             不可见（透明），所以用户看到的还是地址栏 + 页面。 */
          <div
            ref={slotRef}
            className={`fork-browser-slot${viewport === null ? "" : ` fork-browser-slot--${viewport}`}`}
            data-session={hostSessionId}
            aria-label={tab.url}
            role="img"
          />
        ) : (
        <iframe
          ref={iframeRef}
          key={`${currentUrl}#${reloadKey}`}
          src={currentUrl}
          title={tab.url}
          /* 沙箱属性不变（画板 31 的既有行为）。Web 端没有进程级网络守卫，这串属性
             就是这里唯一的兜底，所以它留在 iframe 元素上、不进适配层。 */
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
          referrerPolicy="no-referrer"
          style={{
            flex: viewport === null ? 1 : "0 0 auto",
            minHeight: 0,
            width: viewport === null ? "100%" : viewport,
            maxWidth: "100%",
            border: "none",
            background: "var(--bg)",
            ...(viewport === null ? {} : { boxShadow: "var(--shadow-sm)", borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)" }),
          }}
        />
        )}
          {/* fork:proma-42-browser · 一行说明当前宿主能力：桌面端 agent 可驱动，
              Web 端 agent 工具不可用（iframe 跨站策略拦死）。 */}
          <p className="fork-browser-surface-note">{browserSurfaceHint(surface, t)}</p>
        </div>
      ) : (
        /* 画板 31 帧 B 的空态：`.pw-empty-inner` + 记号 + 两句说明 */
        <div className="pw-browser-body">
          <div className="pw-empty-inner">
            <span className="mark"><span className="pw-ico"><i data-ico="globe" data-size="16"></i></span></span>
            <p>{t("browser.emptyTitle")}</p>
            <p className="pw-dim">{t("browser.emptyHint")}</p>
          </div>
        </div>
      )}
    </div>
  );
}