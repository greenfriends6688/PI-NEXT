"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { copyText } from "@/lib/clipboard";
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
  BROWSER_DEVICE_PRESETS,
  findBrowserDevicePreset,
  isValidViewportDimension,
  resizeViewportFromDrag,
  resolveDeviceViewport,
  resolveViewportRender,
  rotateViewportSize,
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
  /* fork:browser-fullscreen（2026-10-08，用户实拍「浏览器无法全屏展示，没有那个按钮」）——
     把右侧面板的「工作区对调」接进面板自己的工具条。宿主（AppShell）持有
     `workspaceSwapped`，这里只读它画图标、点一下回传切换。 */
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

/* fork:v5-boards D-23 帧 A —— 画了刘海的机型。板面上只有 iPhone 15 / 16 Pro Max
   有 `.d-device-notch`，iPhone SE 明确写了「无刘海」，Pixel 9 / Galaxy Tab 也没画
   （板面语义是取景外壳，不做逐像素仿真）。机型表在 `lib/browser-viewport.ts`，
   但它只存宽高 + DPR、不存外壳细节，所以这个集合留在组件这一层（只多不少）*/
const BROWSER_DEVICE_NOTCH_IDS: ReadonlySet<string> = new Set([
  "iphone-15",
  "iphone-16-pro-max",
]);

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
export function BrowserPanel({ tab, onChangeUrl, sessionId, fullscreen, onToggleFullscreen }: Props) {
  const { t } = useI18n();
  // M-07 —— 手机档：地址栏 + 设备视口条 + 缩放档 + 元素拾取，四个控制件常驻。
  // 桌面分支（下面那个 return）一个字都没动。
  const isMobile = useIsMobile();
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
  /* fork:v5-boards D-23 帧 A —— 机型预设（宽高 + DPR 的**一对**，可旋转）。
     与上面那两段语义的关系写死在这里，免得下次又混：
       · `viewport`      宽度预设（断点用），单宽；
       · `deviceId`      机型预设（逻辑视口用），宽高对；
       · `viewportSize`  自由尺寸（含机型的当前值），拖把手改的就是它。
     三者互斥：选宽度预设、拖把手、关掉自由尺寸都会把机型选择摘掉。 */
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [resizing, setResizing] = useState<{ x: "left" | "right" | "none"; y: "top" | "bottom" | "none" } | null>(null);
  const device = findBrowserDevicePreset(deviceId);
  /* fork:v5-boards D-23 帧 A —— 刘海只给板上画了它的那两台机。 */
  const deviceHasNotch = device ? BROWSER_DEVICE_NOTCH_IDS.has(device.id) : false;

  /** 选一个机型：视口 = 该机型的逻辑宽高，取景回到 fit（先装下，再谈缩放）。 */
  const selectDevice = useCallback((id: string) => {
    const preset = findBrowserDevicePreset(id);
    if (!preset) return;
    setDeviceId(preset.id);
    setViewport(null);
    setViewportSize(resolveDeviceViewport(preset));
    setZoom(DEFAULT_BROWSER_VIEWPORT_ZOOM);
  }, []);

  /** 旋转 90°：只对调逻辑宽高，呈现尺寸仍由 `resolveViewportRender` 按缩放档算。 */
  const rotateDevice = useCallback(() => {
    setViewportSize((current) => (current ? rotateViewportSize(current) : current));
  }, []);

  // fork:browser-viewport —— 拖拽把手。指针坐标相对**容器**（面板本体），
  // 容器尺寸就是前面 `reportLayout` 存下来的那个 slot 矩形 —— 面板的可用区
  // 与 slot 同宽同高（slot 在面板里居中）。
  const beginResize = useCallback((edges: { x: "left" | "right" | "none"; y: "top" | "bottom" | "none" }) => {
    setViewportSize((current) => current ?? DEFAULT_FREE_VIEWPORT_SIZE);
    // 拖把手 = 用户自己改尺寸，不再是机型的尺寸。
    setDeviceId(null);
    setResizing(edges);
  }, []);

  useEffect(() => {
    if (!resizing) return;
    /* managed 面用 slot 的父盒（与下面 reportLayout 报给主进程的是同一块区域）；
       iframe 面没有 slot，用取景容器的父盒 —— 拖动把手属于产品行为，Web 端也应当能用。 */
    const anchor = slotRef.current ?? viewportHostRef.current;
    const container = anchor?.parentElement?.getBoundingClientRect()
      ?? anchor?.getBoundingClientRect();
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
  // fork:v5-skin D-05 帧 C2 — 视口预设按画板是一枚 `.d-chipbtn`，点开是
  // `.d-pop` 列表（不是原生 <select>）。
  const [viewportOpen, setViewportOpen] = useState(false);
  const viewportAnchorRef = useRef<HTMLButtonElement | null>(null);
  const viewportPanelRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  /* fork:v5-boards D-23 帧 A —— iframe 面的取景容器（设备舞台 / 自由尺寸外框）。
     `slotRef` 只在 managed 面存在，而 `resolveViewportRender` 的 fit 要用**容器实测**
     才能把整台设备装进面板（否则 fit 恒等于 1:1，iPhone 15 的 852pt 高会顶出面版）。 */
  const viewportHostRef = useRef<HTMLDivElement | null>(null);

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
  /* fork:browser-loading（2026-10-08，用户实拍 Web 版一直挂着一行「加载中…」）——
     iframe 面读不到页面内部（`refreshPageInfo` 直接 return），`pageInfo` 永远是
     `EMPTY_PAGE_INFO`（readyState 恒为 "loading"），于是那行文案**永远不消失**。
     iframe 自己有 load 事件，用它做真加载态；managed 面仍看探针的 readyState。 */
  const [iframeLoaded, setIframeLoaded] = useState(false);

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
    setIframeLoaded(false);
    // URL 一变就重探；加载刚结束时再补一次（标题常常在 load 之后才定下来）。
    void refreshPageInfo();
    const timer = setTimeout(() => { void refreshPageInfo(); }, 800);
    return () => clearTimeout(timer);
  }, [refreshPageInfo, currentUrl]);

  /* 真在等的那一刻：managed 面看探针，iframe 面看 iframe 自己的 load 事件。 */
  const browserLoading = !loadFailed && (surface === "managed"
    ? pageInfo.readyState === "loading"
    : !iframeLoaded);

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

  /* fork:v5-boards D-23 帧 A —— iframe 面的容器实测。managed 面由 reportLayout 填
     `slotRect`；这里给 `.d-device-stage` / 自由尺寸外框补上同一份测量（ResizeObserver
     已在别处用过，零新依赖）。容器是 flex 分配的固定格，测它不会反过来被 fit 缩放：
     测设备舞台不会形成反馈环。 */
  const hasViewportSize = viewportSize !== null;
  useEffect(() => {
    if (surface === "managed") return;
    const element = viewportHostRef.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      setSlotRect({ width: rect.width, height: rect.height });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [surface, currentUrl, hasViewportSize, deviceId]);

  const VIEWPORT_PRESETS = [
    { value: null, icon: "maximize-2", label: t("browser.viewportFill") },
    { value: 390, icon: "smartphone", label: t("browser.viewportPhone") },
    { value: 768, icon: "tablet", label: t("browser.viewportTablet") },
    { value: 1024, icon: "monitor", label: t("browser.viewportLaptop") },
    { value: 1280, icon: "monitor", label: t("browser.viewportDesktop") },
  ] as const;

  /* 自由尺寸宽/高输入框的固定宽 = 画板 D-05 帧 C2 的 `style="width:52px/56px"`。 */
  const FREE_SIZE_INPUT_WIDTH = 52;
  const FREE_SIZE_INPUT_HEIGHT_WIDTH = 56;


  /* ── M-07 帧 A · 手机档 ────────────────────────────────────────────────────
     手机上的浏览器不是「嵌个 webview」，是**调试台**：地址栏 + 设备视口预设 +
     缩放 + 元素拾取四个控制件常驻。DOM 抄画板帧 A（`.m-urlbar` / `.m-urlbox` /
     `.m-viewportbar` + `.m-vp` / `.m-sizebox` / `.m-zoombar` / `.m-vbar`），
     数据与交互全部是同一份：`history` / `navigate` / `go` / `viewport` /
     `viewportSize` / `zoom` / `deviceId` / `picking` / `startPicking` /
     `choosePick` / `beginResize` 一个都没有另开。

     与画板不同、且是刻意保留产品行为的一处，写在这里备案：
       ① 画板 `.m-sizebox` 是只读读数，本产品的宽高是**可编辑输入**（D-23 帧 B），
          手机上把那两个 input 放进同一个 `.m-sizebox` 里，读数与编辑同位。

     fork:v5-pwa-m0708（2026-10-06 逐帧）：
       ② **根节点不再是 `.m-viewer`**。`.m-viewer` 是库里的「整层浮起」
          （`position:absolute; inset:0; z-index: var(--nx-z-panel)`），而这一支的
          宿主是**pane 正文**（窄屏上它挂在 `.file-panel-main` 里，或 M-12 那一层的
          `.m-panel-scroll` 里）。挂上去 + 内联 `fixed/inset:0` 就等于让它逃出容器
          铺满视口：实测 390×844、z=100，把宿主自己的页签条整条盖掉 —— 手机上进得去
          出不来（顶栏那枚 M-12 入口钮被自己的 `.m-urlbar` 接管指针，重载后照样）。
          与 TraceFrame / FileExplorer 同一条路（见 `design/v5/DIVERGENCE.md` O 节），
          换成 `fork-browser-pane`（接线钩子，定义在 `app/design/v5-forms.css`）。
       ③ `.m-zoombar` 照帧 A 的**四件**（缩小钮 / 滑杆 / 放大钮 / 百分比徽章）。
          画板那条滑杆是连续 50–200，本产品的缩放模型是**离散档**
          （`BROWSER_VIEWPORT_ZOOM_OPTIONS` 七个值，`resolveViewportRender` 只认这七档），
          所以滑杆走**档位下标**而不是百分比：档位集合、默认档、`fit` 档的语义一个字没改，
          只是把「六枚文字芯片」换成板面那条缩放条 —— 板面原话是「三件事都不靠捏合手势」。 */
  if (isMobile) {
    const zoomLabel = (value: BrowserViewportZoom) =>
      (value === "fit" ? t("browser.viewportFit") : `${value}%`);
    /* 滑杆 / 两颗缩放钮走的是同一份档位表的下标，不是另一份数值来源。 */
    const zoomIndex = Math.max(0, BROWSER_VIEWPORT_ZOOM_OPTIONS.indexOf(zoom));
    const viewportReadout = viewportSize
      ? `${viewportSize.width} × ${viewportSize.height}${device ? ` · DPR ${device.dpr}` : ""}`
      : (viewport === null ? t("browser.viewportFill") : `${viewport}`);

    return (
      /* fork:v5-pwa-m0708 —— pane 正文，不再是整层浮起（见上面 ② 的实测）。
         剩下的 `.m-*` 一律照帧 A 原文；`.m-urlbar` 那 52px 状态栏让位在 pane 里是
         死空间（宿主自己有页签条 / `.m-viewer-bar`），由接线层 `fork-browser-pane`
         收掉，与 FileExplorer 的 `fork-pane-bar` 同一理由。 */
      <div className="fork-browser-pane">
        {pageInfo.title && (
          <div className="m-doc-head">
            {pageInfo.favicon
              /* eslint-disable-next-line @next/next/no-img-element -- 见桌面分支的同一条注释 */
              ? <img className="fork-browser-favicon" src={pageInfo.favicon} alt="" aria-hidden="true" />
              : null}
            <span className="m-grow">{pageInfo.title}</span>
          </div>
        )}

        <div className="m-urlbar">
          <button
            type="button"
            className="m-top-btn"
            title={t("browser.back")}
            aria-label={t("browser.back")}
            disabled={historyIndex <= 0}
            onClick={() => go(-1)}
          >
            <i data-ico="arrow-left" data-size="16" aria-hidden="true"></i>
          </button>
          <div className="m-urlbox" style={{ justifyContent: "flex-start" }}>
            <i data-ico="lock" data-size="12" aria-hidden="true"></i>
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
              className="m-grow"
              /* input 的 UA 归零：字号与等宽字体继承 `.m-urlbox`。 */
              style={{ minWidth: 0, border: 0, background: "none", color: "inherit", font: "inherit", outline: "none" }}
            />
          </div>
          <button
            type="button"
            className="m-top-btn"
            title={t("browser.reload")}
            aria-label={t("browser.reload")}
            disabled={!currentUrl}
            onClick={() => setReloadKey((key) => key + 1)}
          >
            <i data-ico="rotate-cw" data-size="16" aria-hidden="true"></i>
          </button>
          <a
            href={currentUrl || undefined}
            target="_blank"
            rel="noopener noreferrer"
            title={t("browser.openExternal")}
            aria-label={t("browser.openExternal")}
            className="m-top-btn"
            aria-disabled={!currentUrl}
            style={{ opacity: currentUrl ? 1 : 0.45, pointerEvents: currentUrl ? "auto" : "none", textDecoration: "none" }}
          >
            <i data-ico="share-2" data-size="16" aria-hidden="true"></i>
          </a>
        </div>

        {/* 设备视口条：五档宽度与桌面那份 `VIEWPORT_PRESETS` 逐字一致，互斥高亮走 `.is-on`。 */}
        <div className="m-viewportbar">
          {VIEWPORT_PRESETS.map((preset) => (
            <button
              key={preset.value ?? "fill"}
              type="button"
              className={`m-vp${viewport === preset.value ? " is-on" : ""}`}
              aria-pressed={viewport === preset.value}
              onClick={() => { setViewport(preset.value); setDeviceId(null); }}
            >
              {preset.label}
            </button>
          ))}
          <div className="m-sizebox">
            <span>{viewportReadout}</span>
            <span>{`${t("browser.viewportZoom")} ${zoomLabel(zoom)}`}</span>
          </div>
        </div>

        {/* 机型预设（D-23 帧 A）：与宽度预设是两段语义，同一批 `BROWSER_DEVICE_PRESETS`。 */}
        <div className="m-viewportbar">
          {BROWSER_DEVICE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`m-vp${device?.id === preset.id ? " is-on" : ""}`}
              aria-pressed={device?.id === preset.id}
              onClick={() => selectDevice(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {viewportSize && (
          <div className="m-pickbar">
            <input
              className="m-input m-mono"
              style={{ width: FREE_SIZE_INPUT_WIDTH }}
              value={viewportSize.width}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!isValidViewportDimension(value, "width")) return;
                setViewportSize({ ...viewportSize, width: value });
              }}
              aria-label={t("browser.viewportWidth")}
            />
            <input
              className="m-input m-mono"
              style={{ width: FREE_SIZE_INPUT_HEIGHT_WIDTH }}
              value={viewportSize.height}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (!isValidViewportDimension(value, "height")) return;
                setViewportSize({ ...viewportSize, height: value });
              }}
              aria-label={t("browser.viewportHeight")}
            />
            <button type="button" className="m-picktag" onClick={rotateDevice} title={`${t("browser.viewportWidth")} ⇄ ${t("browser.viewportHeight")}`}>
              <i data-ico="arrow-right-left" data-size="15" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              className="m-picktag"
              onClick={() => { setViewportSize(null); setZoom(DEFAULT_BROWSER_VIEWPORT_ZOOM); setDeviceId(null); }}
              title={t("browser.viewportReset")}
            >
              <i data-ico="x" data-size="15" aria-hidden="true"></i>
            </button>
          </div>
        )}

        {/* fork:v5-pwa-m0708 —— 缩放条照 M-07 帧 A 的四件：缩小钮 / 滑杆 / 放大钮 /
            百分比徽章（两颗钮各 44px 是 `.m-top-btn`，拇指 26px 是 `.m-slider`，都在库里）。
            滑杆走**档位下标**而不是 50–200 的连续百分比：本仓缩放是七档离散模型
            （`resolveViewportRender` 只认这七档），改成连续值就是编一个后端兑现不了的档。
            档位集合 / 顺序 / 默认档一个没动，`.m-badge` 仍是真读数。 */}
        <div className="m-zoombar">
          <button
            type="button"
            className="m-top-btn"
            title={`${t("browser.viewportZoom")} −`}
            aria-label={`${t("browser.viewportZoom")} −`}
            disabled={zoomIndex <= 0}
            onClick={() => setZoom(BROWSER_VIEWPORT_ZOOM_OPTIONS[zoomIndex - 1])}
          >
            <i data-ico="zoom-out" data-size="16" aria-hidden="true"></i>
          </button>
          <input
            className="m-slider"
            type="range"
            min={0}
            max={BROWSER_VIEWPORT_ZOOM_OPTIONS.length - 1}
            step={1}
            value={zoomIndex}
            aria-label={t("browser.viewportZoom")}
            onChange={(event) => setZoom(BROWSER_VIEWPORT_ZOOM_OPTIONS[Number(event.target.value)])}
          />
          <button
            type="button"
            className="m-top-btn"
            title={`${t("browser.viewportZoom")} +`}
            aria-label={`${t("browser.viewportZoom")} +`}
            disabled={zoomIndex >= BROWSER_VIEWPORT_ZOOM_OPTIONS.length - 1}
            onClick={() => setZoom(BROWSER_VIEWPORT_ZOOM_OPTIONS[zoomIndex + 1])}
          >
            <i data-ico="zoom-in" data-size="16" aria-hidden="true"></i>
          </button>
          <span className="m-badge mute">{zoomLabel(zoom)}</span>
        </div>

        {currentUrl ? (
          <div
            className="m-scroll-y"
            style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", position: "relative" }}
          >
            {loadFailed && (
              <div className="m-empty">
                <div className="m-empty-ico"><i data-ico="circle-alert" data-size="20" aria-hidden="true"></i></div>
                <div className="m-empty-t">{t("browser.loadFailed")}</div>
                <div className="m-pickbar">
                  <button type="button" className="m-picktag" onClick={() => setReloadKey((key) => key + 1)}>
                    {t("files.textRetry")}
                  </button>
                </div>
              </div>
            )}
            {!loadFailed && surface === "managed" ? (
              <div
                ref={slotRef}
                className={`fork-browser-slot${viewport === null ? "" : ` fork-browser-slot--${viewport}`}`}
                style={{ flex: "1 1 auto", minHeight: 0 }}
                data-session={hostSessionId}
                aria-label={tab.url}
                role="img"
              >
                {picking && (
                  <div className="fork-browser-pick" role="presentation">
                    {pickBoxes.map((raw) => {
                      const box = scalePickBox(raw, pickViewport, slotRect);
                      const active = pickHover === box.index;
                      const label = box.name || box.role || box.tag;
                      return (
                        <button
                          key={box.index}
                          type="button"
                          /* `.m-viewbox-sel` = M-07 帧 A 的命中描边（2px 强调色 + 1px 偏移），
                             与桌面那份 `fork-browser-pick-box is-active` 是同一个语义。 */
                          className={`fork-browser-pick-box${active ? " is-active m-viewbox-sel" : ""}`}
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
            ) : !loadFailed ? (
              viewportSize ? (
                <div
                  className="fork-browser-size-frame"
                  style={{ width: renderSize.renderWidth, height: renderSize.renderHeight }}
                >
                  <iframe
                    ref={iframeRef}
                    key={`${currentUrl}#${reloadKey}`}
                    src={currentUrl}
                    title={tab.url}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
                    referrerPolicy="no-referrer"
                    onLoad={() => setIframeLoaded(true)}
                    style={{ width: "100%", height: "100%", border: "none", background: "var(--nx-panel)", transform: renderSize.scale === 1 ? undefined : `scale(${renderSize.scale})`, transformOrigin: "top left" }}
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
                  /* 沙箱属性与桌面逐字一致（见桌面分支的注释）。 */
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
                  referrerPolicy="no-referrer"
                  onLoad={() => setIframeLoaded(true)}
                  style={{
                    flex: viewport === null ? 1 : "0 0 auto",
                    minHeight: 0,
                    width: viewport === null ? "100%" : viewport,
                    maxWidth: "100%",
                    border: "none",
                    background: "var(--nx-panel)",
                    ...(viewport === null ? {} : { boxShadow: "var(--nx-sh-1)", borderLeft: "1px solid var(--nx-line)", borderRight: "1px solid var(--nx-line)" }),
                  }}
                />
              )
            ) : null}
            <p className="fork-browser-surface-note">{browserSurfaceHint(surface, t)}</p>
            {pickError && <p className="fork-browser-surface-note">{pickError}</p>}
            {browserLoading && (
              <div className="fork-browser-loading" role="status">
                <span className="m-think-dots wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
                <span className="d-shimmer">{t("browser.loading")}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="m-scroll-y" style={{ flex: "1 1 auto", display: "flex", flexDirection: "column" }}>
            <div className="m-empty">
              <div className="m-empty-ico"><i data-ico="globe" data-size="20" aria-hidden="true"></i></div>
              <div className="m-empty-t">{t("browser.emptyTitle")}</div>
              <div className="m-empty-s">{t("browser.emptyHint")}</div>
            </div>
          </div>
        )}

        <div className="m-vbar">
          {surface === "managed" && (
            <button
              type="button"
              className={`m-menu-row${picking ? " is-on" : ""}`}
              title={picking ? t("browser.pickCancel") : t("browser.pickStart")}
              aria-pressed={picking}
              onClick={() => (picking ? setPicking(false) : void startPicking())}
            >
              <i data-ico="square-mouse-pointer" data-size="15" aria-hidden="true"></i>
              {picking ? t("browser.pickCancel") : t("browser.pickStart")}
            </button>
          )}
          <button
            type="button"
            className="m-menu-row"
            disabled={!currentUrl}
            onClick={() => { if (currentUrl) void copyText(currentUrl); }}
          >
            <i data-ico="copy" data-size="15" aria-hidden="true"></i>{t("files.copyPath")}
          </button>
          <a
            href={currentUrl || undefined}
            target="_blank"
            rel="noopener noreferrer"
            className="m-menu-row"
            aria-disabled={!currentUrl}
            style={{ opacity: currentUrl ? 1 : 0.45, pointerEvents: currentUrl ? "auto" : "none", textDecoration: "none" }}
            title={t("browser.openExternal")}
          >
            <i data-ico="external-link" data-size="15" aria-hidden="true"></i>{t("browser.openExternal")}
          </a>
        </div>
      </div>
    );
  }

  /* fork:v5-boards D-23 帧 A —— 设备底栏 `.d-device-bar`：左边写**逻辑视口 + DPR**
     （板上的「393 × 852 · DPR 3」），右边写**取景缩放**（当前那一档）。两件事分两处写，
     是这张板反复强调的：取景缩放是 CSS 缩放，不改逻辑视口，所以「手机断点生不生效」
     只看左边那行数字。只在选了机型时画；managed 面画在 slot 之后，iframe 面画在
     设备舞台之后 —— 同一个读数，两个宿主。 */
  const deviceBar = device && viewportSize ? (
    <div className="d-device-bar">
      <span className="d-mono d-t-xs d-grow">
        {`${viewportSize.width} × ${viewportSize.height} · DPR ${device.dpr}`}
      </span>
      <span
        className="d-badge mute"
        title={`${t("browser.viewportZoom")} ${zoom === "fit" ? t("browser.viewportFit") : `${zoom}%`}`}
      >
        {zoom === "fit" ? t("browser.viewportFit") : `${zoom}%`}
      </span>
    </div>
  ) : null;

  /* 自由尺寸与设备预览共用的四条拖拽把手：拖哪条边动哪个轴，尺寸算法在
     `lib/browser-viewport.ts`（居中盒子 ⇒ 新尺寸 = 指针到所贴那条边的距离 × 2）。 */
  const viewportSizeHandles = (
    <>
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
    </>
  );

  return (
    <div className="d-viewer">
      {/* fork:browser-page-info —— 标题 + favicon 一行（画板头行下方）。
          读不到（iframe 面）时不占位、不画坏图，只留标题回退到主机名。

          **这一行只在 managed 面可能出现**（`refreshPageInfo` 对 iframe 直接 return，
          所以 `title` 恒为空、整行不渲染）。 */}
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
      {/* fork:v5-skin D-05 帧 C/C2 —— 地址行照画板 .d-urlbar（后退 / 前进 / 重载 + .d-urlbox
          + 系统浏览器 + 拾取）。图标改用画板的 lucide 字形（chevron-left / chevron-right）。 */}
      <div className="d-urlbar">
        <button
          type="button"
          className="d-iconbtn"
          title={t("browser.back")}
          aria-label={t("browser.back")}
          disabled={historyIndex <= 0}
          onClick={() => go(-1)}
        >
          <i data-ico="chevron-left" data-size="14" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          className="d-iconbtn"
          title={t("browser.forward")}
          aria-label={t("browser.forward")}
          disabled={historyIndex >= history.length - 1}
          onClick={() => go(1)}
        >
          <i data-ico="chevron-right" data-size="14" aria-hidden="true"></i>
        </button>
        <button
          type="button"
          className="d-iconbtn"
          title={t("browser.reload")}
          aria-label={t("browser.reload")}
          disabled={!currentUrl}
          onClick={() => setReloadKey((key) => key + 1)}
        >
          <i data-ico="rotate-cw" data-size="14" aria-hidden="true"></i>
        </button>
        {/* fork:v5-skin D-05 帧 C2 —— 地址栏 = 画板 .d-urlbox（左 lock / 右 globe + 等宽路径）。
           .d-urlbox 的 > span 才是 span；产品这里是真实 input，只补 UA 归零。 */}
        <div className="d-urlbox">
          <i data-ico="lock" data-size="11" aria-hidden="true"></i>
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
            className="d-grow"
            /* input 的 UA 归零（描边 / 底色 / 字体）：字号与等宽字体继承 .d-urlbox。 */
            style={{ minWidth: 0, border: 0, background: "none", color: "inherit", font: "inherit", outline: "none" }}
          />
          <i data-ico="globe" data-size="12" aria-hidden="true"></i>
        </div>
        <a
          href={currentUrl || undefined}
          target="_blank"
          rel="noopener noreferrer"
          title={t("browser.openExternal")}
          aria-label={t("browser.openExternal")}
          className="d-iconbtn"
          aria-disabled={!currentUrl}
          style={{ opacity: currentUrl ? 1 : 0.45, pointerEvents: currentUrl ? "auto" : "none" }}
        >
          <i data-ico="external-link" data-size="14" aria-hidden="true"></i>
        </a>
        {/* fork:element-picker —— 「拾取元素」：拿一批带坐标的盒子盖在原生视图上，
            点一个就变成输入框里的一条 `@` 引用。只有 managed 面拿得到页面内部
            几何（Web / iframe 面拿不到），所以别的面上这枚钮不画，而不是点了
            才报错。 */}
        {surface === "managed" && (
          <button
            type="button"
            className={`d-iconbtn${picking ? " is-on" : ""}`}
            title={picking ? t("browser.pickCancel") : t("browser.pickStart")}
            aria-label={picking ? t("browser.pickCancel") : t("browser.pickStart")}
            aria-pressed={picking}
            onClick={() => (picking ? setPicking(false) : void startPicking())}
          >
            <i data-ico={picking ? "x" : "square-mouse-pointer"} data-size="14" aria-hidden="true"></i>
          </button>
        )}
        {/* fork:browser-fullscreen（2026-10-08，用户实拍「浏览器无法全屏展示，没有那个按钮」）
            —— 把右侧面板的工作区对调接到面板自己的工具条（与顶栏那枚 columns-2 同一动作）。 */}
        {onToggleFullscreen && (
          <button
            type="button"
            className={`d-iconbtn${fullscreen ? " is-on" : ""}`}
            title={fullscreen ? t("layout.exitFullscreen") : t("layout.enterFullscreen")}
            aria-label={fullscreen ? t("layout.exitFullscreen") : t("layout.enterFullscreen")}
            aria-pressed={fullscreen}
            onClick={onToggleFullscreen}
          >
            <i data-ico={fullscreen ? "minimize-2" : "maximize-2"} data-size="14" aria-hidden="true"></i>
          </button>
        )}
      </div>
      {/* fork:v5-skin D-05 帧 C2 —— 工具条：视口预设 + 自由尺寸 + 缩放档，排成画板的
          .d-row（flex-wrap）。视口预设仍是第一枚 .d-chipbtn（缩放档是 .d-chipbtn.sm）。 */}
      <div className="d-row" style={{ flexWrap: "wrap", gap: "var(--nx-sp-1)", padding: "var(--nx-sp-2)" }}>
        <button
          ref={viewportAnchorRef}
          type="button"
          className="d-chipbtn"
          aria-haspopup="menu"
          aria-expanded={viewportOpen}
          title={t("browser.viewport")}
          aria-label={t("browser.viewport")}
          onClick={() => setViewportOpen((open) => !open)}
        >
          <i data-ico={viewport === null ? "maximize-2" : "smartphone"} data-size="13" aria-hidden="true"></i>
          <span>{viewport === null ? t("browser.viewportFill") : `${viewport}`}</span>
          <i data-ico="chevron-down" data-size="11" aria-hidden="true"></i>
        </button>
        {/* fork:v5-boards D-23 帧 B —— 旋转 90°。只在自由尺寸/机型下出现（宽度预设是
            单宽，转了也说不清是什么转了）。无障碍名用既有的两个 i18n key 拼成
            「宽 ⇄ 高」，不硬编码中文。 */}
        {viewportSize && (
          <button
            type="button"
            className="d-iconbtn sm"
            onClick={rotateDevice}
            title={`${t("browser.viewportWidth")} ⇄ ${t("browser.viewportHeight")}`}
            aria-label={`${t("browser.viewportWidth")} ⇄ ${t("browser.viewportHeight")}`}
          >
            <i data-ico="arrow-right-left" data-size="14" aria-hidden="true"></i>
          </button>
        )}
        {/* fork:browser-viewport —— 自由尺寸框只在自由尺寸模式下渲染（同画板 C2），它的
            .d-input 不会把工具条顶高；预设与自由尺寸是两段语义。 */}
        {viewportSize && (
          <>
            <span className="d-chipbtn fork-browser-size" role="group" aria-label={t("browser.viewportSize")}>
              <input
                className="d-input d-mono"
                style={{ width: FREE_SIZE_INPUT_WIDTH }}
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
                className="d-input d-mono"
                style={{ width: FREE_SIZE_INPUT_HEIGHT_WIDTH }}
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
              className="d-iconbtn sm"
              onClick={() => { setViewportSize(null); setZoom(DEFAULT_BROWSER_VIEWPORT_ZOOM); setDeviceId(null); }}
              title={t("browser.viewportReset")}
              aria-label={t("browser.viewportReset")}
            >
              <i data-ico="x" data-size="14" aria-hidden="true"></i>
            </button>
          </>
        )}
        {BROWSER_VIEWPORT_ZOOM_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`d-chipbtn sm${zoom === option ? " is-on" : ""}`}
            aria-pressed={zoom === option}
            title={`${t("browser.viewportZoom")} ${option === "fit" ? t("browser.viewportFit") : `${option}%`}`}
            onClick={() => setZoom(option)}
          >
            {option === "fit" ? t("browser.viewportFit") : `${option}%`}
          </button>
        ))}
        <span className="d-grow" />
        {picking && (
          <span className="d-badge warn">
            <i data-ico="square-mouse-pointer" data-size="11" aria-hidden="true"></i>
            {t("browser.pickStart")}
          </span>
        )}
      </div>

      {/* fork:v5-boards D-23 帧 A —— 机型预设行 = `.d-tinybar` > `.d-device-presets` >
          `.d-device-preset`。与上面那排宽度预设是**两段语义**：宽度答「这条断点生不生效」，
          机型答「这一台设备的逻辑视口长什么样」（宽高对 + DPR，可旋转）。
          右侧那行数字始终是**逻辑视口** —— 取景缩放是 CSS 缩放，不触发断点重排。 */}
      <div className="d-tinybar">
        <i data-ico="smartphone" data-size="13" aria-hidden="true"></i>
        {/* fork:v5-frame-audit D-23 帧 A —— 机型行开头那个字（板面 `.d-t-sm.d-t-b`
            的「机型」）原先没有。文案用既有的 `browser.viewport`，不为这两个字新开
            i18n key；板面自己的帧 B/C 那一行写的也是「视口 / 运行形态」这类
            「这一行管什么」的短名，语义一致。 */}
        <span className="d-t-sm d-t-b">{t("browser.viewport")}</span>
        <div className="d-device-presets">
          {BROWSER_DEVICE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`d-device-preset${device?.id === preset.id ? " is-on" : ""}`}
              aria-pressed={device?.id === preset.id}
              onClick={() => selectDevice(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <span className="d-grow" />
        {device && viewportSize && (
          <span className="d-t-xs d-t-faint">
            {`${viewportSize.width} × ${viewportSize.height} · DPR ${device.dpr}`}
          </span>
        )}
      </div>

      <PortalDropdown
        open={viewportOpen}
        anchorRef={viewportAnchorRef}
        panelRef={viewportPanelRef}
        className="d-pop"
        width={200}
        align="right"
      >
        {VIEWPORT_PRESETS.map((preset) => (
          <button
            key={preset.value ?? "fill"}
            type="button"
            className={`d-menu-row${viewport === preset.value ? " is-on" : ""}`}
            onClick={() => {
              setViewport(preset.value);
              // 宽度预设与机型预设互斥：选了宽度就不再是「某一台设备」。
              setDeviceId(null);
              setViewportOpen(false);
            }}
          >
            <i data-ico={preset.icon} data-size="14" aria-hidden="true"></i>
            <span className="d-grow">{preset.label}</span>
            {viewport === preset.value && <i data-ico="check" data-size="14" aria-hidden="true"></i>}
          </button>
        ))}
      </PortalDropdown>

      {currentUrl ? (
        <div className="d-panel-body" style={{ padding: 0, position: "relative", display: "flex", flexDirection: "column" }}>
        {surface === "managed" ? (
          /* fork:proma-42-browser · 受管路径：这一格只是占位，真正的页面是主进程里的
             WebContentsView，由上面的 effect 把这个盒子的屏幕坐标报过去。占位自身
             不可见（透明），所以用户看到的还是地址栏 + 页面。 */
          <div
            ref={slotRef}
            className={`fork-browser-slot${viewport === null ? "" : ` fork-browser-slot--${viewport}`}`}
            style={{ flex: "1 1 auto", minHeight: 0 }}
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
        ) : device && viewportSize ? (
        /* fork:v5-boards D-23 帧 A/B —— 设备预览。`.d-device-stage`（带取景底纹的舞台）
           把 `.d-device`（机型外壳：圆角/描边/裁切由类给）摆中间，里面是
           `.d-device-screen`（按**逻辑视口**定尺寸、按取景做一次 CSS transform ——
           不改断点），刘海机型再叠一枚 `.d-device-notch`。复用的还是同一支 iframe、
           同一条 URL、同一份 sandbox：不引模拟器、不引新依赖。四条把手照旧能把设备
           切成自由尺寸（beginResize 会摘掉机型选择）。 */
        <>
          <div ref={viewportHostRef} className="d-device-stage">
            <div
              className="d-device"
              style={{ width: renderSize.renderWidth, height: renderSize.renderHeight }}
            >
              <div
                className="d-device-screen d-col"
                style={{
                  width: viewportSize.width,
                  height: viewportSize.height,
                  transformOrigin: "top left",
                  transform: renderSize.scale === 1 ? undefined : `scale(${renderSize.scale})`,
                }}
              >
                {/* 刘海只挡 64×16 的装饰，不吃指针（它不是页面内容）。 */}
                {deviceHasNotch && (
                  <div className="d-device-notch" style={{ pointerEvents: "none" }} />
                )}
                <iframe
                  ref={iframeRef}
                  key={`${currentUrl}#${reloadKey}`}
                  src={currentUrl}
                  title={tab.url}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
                  referrerPolicy="no-referrer"
                  onLoad={() => setIframeLoaded(true)}
                  style={{ flex: "1 1 auto", minHeight: 0, width: "100%", border: "none", background: "var(--nx-panel)" }}
                />
              </div>
              {viewportSizeHandles}
            </div>
          </div>
          {deviceBar}
        </>
        ) : viewportSize ? (
          /* fork:browser-viewport —— 自由尺寸：外面套一个可拖的边框，iframe 按
             `resolveViewportRender` 算出的呈现尺寸落在里面。iframe 保持**逻辑尺寸**、
             只做一次 scale，外框写的是缩放后的呈现尺寸 —— 这样 zoom 档才是真的页面缩放，
             取景缩放也只算一遍（与 D-23 帧 B「取景缩放是 CSS 缩放」同一条口径）；
             外框容器实测用于 fit，四边把手拖的是**容器内的指针位置**。 */
          <div
            ref={viewportHostRef}
            style={{ flex: "1 1 auto", minHeight: 0, position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
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
              onLoad={() => setIframeLoaded(true)}
              style={{ width: viewportSize.width, height: viewportSize.height, border: "none", background: "var(--nx-panel)", transform: renderSize.scale === 1 ? undefined : `scale(${renderSize.scale})`, transformOrigin: "top left" }}
            />
            {viewportSizeHandles}
          </div>
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
          onLoad={() => setIframeLoaded(true)}
          style={{
            flex: viewport === null ? 1 : "0 0 auto",
            minHeight: 0,
            width: viewport === null ? "100%" : viewport,
            maxWidth: "100%",
            border: "none",
            background: "var(--nx-panel)",
            ...(viewport === null ? {} : { boxShadow: "var(--nx-sh-1)", borderLeft: "1px solid var(--nx-line)", borderRight: "1px solid var(--nx-line)" }),
          }}
        />
        )}
          {/* fork:v5-boards D-23 帧 A —— managed 面：设备底栏挂在 slot 之后
              （原生 WebContentsView 画在 DOM 之外，设备外壳包不住它，所以这一面
              只保留同一行读数；iframe 面在上面那支设备舞台里自带同一条底栏）。 */}
          {surface === "managed" ? deviceBar : null}
          {/* fork:proma-42-browser · 一行说明当前宿主能力：桌面端 agent 可驱动，
              Web 端 agent 工具不可用（iframe 跨站策略拦死）。 */}
          <p className="fork-browser-surface-note">{browserSurfaceHint(surface, t)}</p>
          {/* fork:element-picker —— 拾取失败（页面不可达 / 没有可拾元素）就地说一句，
              不静默吞掉：否则用户点了钮什么也没发生，会以为按钮坏了。 */}
          {pickError && <p className="fork-browser-surface-note">{pickError}</p>}
          {/* fork:browser-page-info —— 加载 / 失败两态。改之前只有空态与一句
              “跨站策略会白屏” 的提示，页面挂掉时面板就静静地卡在上一帧。 */}
          {loadFailed && <p className="fork-browser-surface-note">{t("browser.loadFailed")}</p>}
          {browserLoading && (
            /* fork:browser-loading —— 真在等的居中加载态（点阵 + 流光文案），
               不再是一条贴在底部的裸文字。绝对定位盖在面板正文上（正文已是 relative）。 */
            <div className="fork-browser-loading" role="status">
              <span className="d-think-dots wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
              <span className="d-shimmer">{t("browser.loading")}</span>
            </div>
          )}
        </div>
      ) : (
        /* fork:v5-skin D-05 —— 空态用画板的 .d-empty（记号 + 标题 + 说明）。 */
        <div className="d-panel-body" style={{ padding: 0 }}>
          <div className="d-empty" style={{ height: "100%" }}>
            <div className="d-empty-ico"><i data-ico="globe" data-size="16" aria-hidden="true"></i></div>
            <p className="d-empty-t">{t("browser.emptyTitle")}</p>
            <p className="d-empty-s">{t("browser.emptyHint")}</p>
          </div>
        </div>
      )}
    </div>
  );
}