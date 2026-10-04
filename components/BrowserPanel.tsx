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
import {
  BROWSER_VIEWPORT_LIMITS,
  DEFAULT_FREE_VIEWPORT_SIZE,
  BROWSER_VIEWPORT_ZOOM_OPTIONS,
  DEFAULT_BROWSER_VIEWPORT_ZOOM,
  isValidViewportDimension,
  resizeViewportFromDrag,
  resolveViewportRender,
  type BrowserViewportZoom,
} from "@/lib/browser-viewport";
import {
  EMPTY_PAGE_INFO,
  buildPageInfoExpression,
  parsePageInfo,
  type BrowserPageInfo,
} from "@/lib/browser-page-info";
import {
  buildPickListExpression,
  parsePickList,
  publishBrowserPick,
  scalePickBox,
  toBrowserPick,
  type PickableBox,
} from "@/lib/browser-element-pick";

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
  /* fork:browser-viewport —— 自由尺寸 + 缩放档（对齐 ZCode 的
     `ResponsiveBrowserViewport` + `BrowserViewportToolbar`）。
     `viewportSize` 是**自由尺寸**（null = 沿用上面的设备预设），`zoom` 是页面
     自身的缩放；两者是独立两段语义，算法在 `lib/browser-viewport.ts` 里。 */
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState<BrowserViewportZoom>(DEFAULT_BROWSER_VIEWPORT_ZOOM);
  const [resizing, setResizing] = useState<{ x: "left" | "right" | "none"; y: "top" | "bottom" | "none" } | null>(null);

  // fork:browser-viewport —— 拖拽把手。指针坐标相对**容器**（面板本体），
  // 容器尺寸就是前面 `reportLayout` 存下来的那个 slot 矩形 —— 面板的可用区
  // 与 slot 同宽同高（slot 在面板里居中）。
  const beginResize = useCallback((edges: { x: "left" | "right" | "none"; y: "top" | "bottom" | "none" }) => {
    setViewportSize((current) => current ?? DEFAULT_FREE_VIEWPORT_SIZE);
    setResizing(edges);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    const container = slotRef.current?.parentElement?.getBoundingClientRect()
      ?? slotRef.current?.getBoundingClientRect();
    if (!container) return;
    const onMove = (event: PointerEvent) => {
      const pointer = { width: event.clientX - container.left, height: event.clientY - container.top };
      setViewportSize(resizeViewportFromDrag(pointer, container, resizing));
    };
    const stop = () => setResizing(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [resizing]);
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

  /* fork:element-picker —— 拾取模式。`boxes` 是一次探针拿回来的候选，
     `hovered` 是当前高亮的那一个（hover 发生在**我们自己的覆盖层**上，
     不往页面里注入事件监听）。 */
  const [picking, setPicking] = useState(false);
  const [pickBoxes, setPickBoxes] = useState<PickableBox[]>([]);
  const [pickViewport, setPickViewport] = useState({ width: 0, height: 0 });
  const [pickHover, setPickHover] = useState<number | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [slotRect, setSlotRect] = useState({ width: 0, height: 0 });


  /** 探针回的那份页面视口；回不来就用 slot 自己的尺寸（不缩放）。 */
  const pageViewportOf = (raw: unknown): { width: number; height: number } => {
    const vp = (raw as { viewport?: { width?: unknown; height?: unknown } } | null)?.viewport;
    const width = typeof vp?.width === "number" && vp.width > 0 ? vp.width : 0;
    const height = typeof vp?.height === "number" && vp.height > 0 ? vp.height : 0;
    if (width > 0 && height > 0) return { width, height };
    const rect = slotRef.current?.getBoundingClientRect();
    return { width: Math.round(rect?.width ?? 0), height: Math.round(rect?.height ?? 0) };
  };

  const startPicking = useCallback(async () => {
    if (surface !== "managed" || !hostSessionId) return;
    setPickError(null);
    try {
      const res = await fetch("/api/browser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "extract",
          sessionId: hostSessionId,
          tabId: tab.id,
          payload: { expression: buildPickListExpression() },
        }),
      });
      const data = await res.json() as { result?: unknown; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      const viewport = slotRef.current?.getBoundingClientRect();
      const boxes = parsePickList(
        data.result,
        { width: Math.round(viewport?.width ?? 0), height: Math.round(viewport?.height ?? 0) },
      );
      if (boxes.length === 0) {
        setPickError(t("browser.pickNothing"));
        return;
      }
      setPickBoxes(boxes);
      setPickViewport(pageViewportOf(data.result));
      setPicking(true);
    } catch (error) {
      setPickError(error instanceof Error ? error.message : String(error));
    }
  }, [surface, hostSessionId, tab.id, t]);

  // 退出拾取（含切 tab / 卸载）时清干净，别把一堆盒子留在覆盖层上。
  useEffect(() => {
    if (!picking) return;
    return () => {
      setPickBoxes([]);
      setPickHover(null);
    };
  }, [picking, tab.id]);

  const choosePick = useCallback((box: PickableBox) => {
    publishBrowserPick(toBrowserPick(box, tab.id));
    setPicking(false);
    setPickBoxes([]);
    setPickHover(null);
  }, [tab.id]);

  // A tab restored from sessionStorage carries a url the component never saw.
  useEffect(() => {
    setDraft(tab.url);
    setHistory(tab.url ? [tab.url] : []);
    setHistoryIndex(tab.url ? 0 : -1);
  }, [tab.id, tab.url]);

  const currentUrl = history[historyIndex] ?? "";

  /* fork:browser-page-info —— 标题 / favicon / 加载态。URL 变化与加载事件都会
     重新探一次；这里不做长轮询（探针要过一趟 host 往返，轮询只是白烧）。
     iframe 面读不到（跨源），保持 EMPTY_PAGE_INFO，UI 如实显示主机名。 */
  const [pageInfo, setPageInfo] = useState<BrowserPageInfo>(EMPTY_PAGE_INFO);
  const [loadFailed, setLoadFailed] = useState(false);

  const refreshPageInfo = useCallback(async () => {
    if (surface !== "managed" || !hostSessionId) return;
    try {
      const res = await fetch("/api/browser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          op: "extract",
          sessionId: hostSessionId,
          tabId: tab.id,
          payload: { expression: buildPageInfoExpression() },
        }),
      });
      if (!res.ok) return;
      const data = await res.json() as { result?: unknown };
      setPageInfo(parsePageInfo(data.result));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, [surface, hostSessionId, tab.id]);

  useEffect(() => {
    setLoadFailed(false);
    // URL 一变就重探；加载刚结束时再补一次（标题常常在 load 之后才定下来）。
    void refreshPageInfo();
    const timer = setTimeout(() => { void refreshPageInfo(); }, 800);
    return () => clearTimeout(timer);
  }, [refreshPageInfo, currentUrl]);

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
    /* fork:element-picker —— slot 的尺寸也留一份给拾取覆盖层换算坐标。
       `reportLayout` 已经挂在 mount + ResizeObserver 上，所以窗口一变就跟着更新，
       不必另挂一个观察者。 */
    setSlotRect({ width: rect.width, height: rect.height });
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
  // fork:browser-viewport —— 呈现尺寸：视口 CSS 尺寸 × 缩放，夹进容器。
  const renderSize = resolveViewportRender(
    viewportSize,
    zoom,
    slotRect.width > 0 ? { width: slotRect.width, height: slotRect.height } : { width: 0, height: 0 },
  );

  const VIEWPORT_PRESETS = [
    { value: null, icon: "maximize-2", label: t("browser.viewportFill") },
    { value: 390, icon: "smartphone", label: t("browser.viewportPhone") },
    { value: 768, icon: "tablet", label: t("browser.viewportTablet") },
    { value: 1024, icon: "monitor", label: t("browser.viewportLaptop") },
    { value: 1280, icon: "monitor", label: t("browser.viewportDesktop") },
  ] as const;

  return (
    <div className="pw-browser">
      {/* fork:browser-page-info —— 标题 + favicon 一行（画板 31 头行下方）。
          读不到（iframe 面）时不占位、不画坏图，只留标题回退到主机名。

          **这一行只在 managed 面可能出现**（`refreshPageInfo` 对 iframe 直接 return，
          所以 `title` 恒为空、整行不渲染）—— 而 `verify:boards` 跑的是 Web/生产服务，
          永远看不到它。也就是说画板 31 不需要为它补一帧；反过来，如果哪天有人把
          `title &&` 的守卫去掉，`.pw-browser` 的高度会多出 20px + 一条发丝边，
          那时 31 号 spec 会立刻报漂移 —— 这行注释就是留给那时的提示。 */}
      {pageInfo.title && (
        <div className="fork-browser-pageinfo">
          {pageInfo.favicon
            /* eslint-disable-next-line @next/next/no-img-element --
               favicon **必须**走原生 <img>：它是任意站点给的任意 URL（探针只保证
               协议是 http(s)/data，见 lib/browser-page-info.ts），走 next/image 的
               优化器等于把所有站点的图标都代理一遍 —— 既泄露浏览历史，又因为站点
               不该我们的域名而直接失败。而且这是 14px 的小图，LCP 上没有意义。 */
            ? <img className="fork-browser-favicon" src={pageInfo.favicon} alt="" aria-hidden="true" />
            : null}
          <span className="fork-browser-title">{pageInfo.title}</span>
        </div>
      )}
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
        {/* fork:element-picker —— 「拾取元素」：拿一批带坐标的盒子盖在原生视图上，
            点一个就变成输入框里的一条 `@` 引用。只有 managed 面拿得到页面内部
            几何（Web / iframe 面拿不到），所以别的面上这枚钮不画，而不是点了
            才报错。 */}
        {surface === "managed" && (
          <button
            type="button"
            className={`pw-iconbtn sm${picking ? " is-on" : ""}`}
            title={picking ? t("browser.pickCancel") : t("browser.pickStart")}
            aria-label={picking ? t("browser.pickCancel") : t("browser.pickStart")}
            aria-pressed={picking}
            onClick={() => (picking ? setPicking(false) : void startPicking())}
          >
            <span className="pw-ico">
              <i data-ico={picking ? "x" : "crosshair"} data-size="14"></i>
            </span>
          </button>
        )}
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
        {/* fork:browser-viewport —— **位置有讲究**：缩放档与自由尺寸框排在视口预设**之后**。
            画板 31 那一帧里 `.pw-chipbtn` 只有一枚（视口预设），而
            `scripts/board-specs/31-terminal-browser-git.mjs` 是按「第一个 `.pw-chipbtn`」
            配对量几何的 —— 把缩放芯片插在它前面，那条 spec 就变成拿缩放芯片去对视口预设，
            量出来「巧合相近」也说明不了任何东西。视口预设保持在第一位。 */}
        {/* fork:browser-viewport —— 自由尺寸 + 缩放档。与视口预设是**两段**语义：
            这几档缩的是页面自身，宽高那个框管的是视口的 CSS 尺寸。
            壳沿用现成的 `.pw-chipbtn`（画板 31 的视口预设已经在用），零新类。

            宽高框只在**自由尺寸模式**下渲染（默认关），所以它那个 `.pw-input`
            不会把头行顶高 —— 画板 31 量到的仍是单枚视口预设那一档的高度。 */}
        {viewportSize && (
          <>
            <span className="pw-chipbtn fork-browser-size" role="group" aria-label={t("browser.viewportSize")}>
              <input
                className="pw-input pw-mono"
                value={viewportSize.width}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!isValidViewportDimension(value, "width")) return;
                  setViewportSize({ ...viewportSize, width: value });
                }}
                aria-label={t("browser.viewportWidth")}
                title={`${BROWSER_VIEWPORT_LIMITS.minWidth}-${BROWSER_VIEWPORT_LIMITS.maxWidth}`}
              />
              <span aria-hidden="true">x</span>
              <input
                className="pw-input pw-mono"
                value={viewportSize.height}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!isValidViewportDimension(value, "height")) return;
                  setViewportSize({ ...viewportSize, height: value });
                }}
                aria-label={t("browser.viewportHeight")}
                title={`${BROWSER_VIEWPORT_LIMITS.minHeight}-${BROWSER_VIEWPORT_LIMITS.maxHeight}`}
              />
            </span>
            <button
              type="button"
              className="pw-iconbtn sm"
              onClick={() => { setViewportSize(null); setZoom(DEFAULT_BROWSER_VIEWPORT_ZOOM); }}
              title={t("browser.viewportReset")}
              aria-label={t("browser.viewportReset")}
            >
              <span className="pw-ico"><i data-ico="x" data-size="14"></i></span>
            </button>
          </>
        )}
        {BROWSER_VIEWPORT_ZOOM_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`pw-chipbtn sm${zoom === option ? " is-on" : ""}`}
            aria-pressed={zoom === option}
            title={`${t("browser.viewportZoom")} ${option === "fit" ? t("browser.viewportFit") : `${option}%`}`}
            onClick={() => setZoom(option)}
          >
            {option === "fit" ? t("browser.viewportFit") : `${option}%`}
          </button>
        ))}
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
          >
            {/* fork:element-picker —— 覆盖层画在这个 slot 里。slot 的屏幕矩形
                就是原生 WebContentsView 的矩形（上面 reportLayout 把同一组数字
                报给了宿主），所以盒子坐标能直接对上；hover / click 全部发生在
                **我们这份 DOM** 里，页面脚本不参与。
                坐标是 CSS px、与 `getBoundingClientRect()` 同系，无需换算。 */}
            {picking && (
              <div className="fork-browser-pick" role="presentation">
                {pickBoxes.map((raw) => {
                  // 页面 CSS px → slot 像素；页面可能缩放过，不换算会整体偏。
                  const box = scalePickBox(raw, pickViewport, slotRect);
                  const active = pickHover === box.index;
                  const label = box.name || box.role || box.tag;
                  return (
                    <button
                      key={box.index}
                      type="button"
                      className={`fork-browser-pick-box${active ? " is-active" : ""}`}
                      style={{
                        left: box.bounds.x,
                        top: box.bounds.y,
                        width: box.bounds.width,
                        height: box.bounds.height,
                      }}
                      title={label}
                      aria-label={label}
                      onMouseEnter={() => setPickHover(box.index)}
                      onFocus={() => setPickHover(box.index)}
                      onClick={() => choosePick(raw)}
                    >
                      {active && box.bounds.height >= 18 && box.bounds.width >= 60 ? (
                        <span className="fork-browser-pick-tag">{label}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
        /* fork:browser-viewport —— 自由尺寸：外面套一个可拖的边框，iframe 按
           `resolveViewportRender` 算出的呈现尺寸落在里面。四条边把手拖的是
           **容器内的指针位置**，尺寸算法在 `lib/browser-viewport.ts`
           （居中盒子 ⇒ 尺寸 = 指针到所贴那条边的距离 × 2）。
           预设（`viewport`）与自由尺寸（`viewportSize`）互斥：选预设就退出自由尺寸。 */
        viewportSize ? (
          <div className="fork-browser-size-frame" style={{
            width: renderSize.renderWidth,
            height: renderSize.renderHeight,
          }}>
            <iframe
              ref={iframeRef}
              key={`${currentUrl}#${reloadKey}`}
              src={currentUrl}
              title={tab.url}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
              referrerPolicy="no-referrer"
              style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)", transform: renderSize.scale === 1 ? undefined : `scale(${renderSize.scale})`, transformOrigin: "top left" }}
            />
            {(["left", "right"] as const).map((side) => (
              <div
                key={side}
                role="separator"
                aria-orientation="vertical"
                aria-label={t("browser.viewportResize")}
                className={`fork-browser-size-handle fork-browser-size-handle--${side}`}
                onPointerDown={() => beginResize({ x: side, y: "none" })}
              />
            ))}
            {(["top", "bottom"] as const).map((side) => (
              <div
                key={side}
                role="separator"
                aria-orientation="horizontal"
                aria-label={t("browser.viewportResize")}
                className={`fork-browser-size-handle fork-browser-size-handle--${side}`}
                onPointerDown={() => beginResize({ x: "none", y: side })}
              />
            ))}
          </div>
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
        ))}
          {/* fork:proma-42-browser · 一行说明当前宿主能力：桌面端 agent 可驱动，
              Web 端 agent 工具不可用（iframe 跨站策略拦死）。 */}
          <p className="fork-browser-surface-note">{browserSurfaceHint(surface, t)}</p>
          {/* fork:element-picker —— 拾取失败（页面不可达 / 没有可拾元素）就地说一句，
              不静默吞掉：否则用户点了钮什么也没发生，会以为按钮坏了。 */}
          {pickError && <p className="fork-browser-surface-note">{pickError}</p>}
          {/* fork:browser-page-info —— 加载 / 失败两态。改之前只有空态与一句
              “跨站策略会白屏” 的提示，页面挂掉时面板就静静地卡在上一帧。 */}
          {loadFailed && <p className="fork-browser-surface-note">{t("browser.loadFailed")}</p>}
          {!loadFailed && pageInfo.readyState === "loading" && (
            <p className="fork-browser-surface-note" role="status">{t("browser.loading")}</p>
          )}
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