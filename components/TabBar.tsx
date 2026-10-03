"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { getFileIcon } from "./FileIcons";
import { TabOverview } from "./fork/TabOverview";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { FileViewerDisplayMode, FileViewerState } from "@/lib/file-viewer-state";
import type { RestorableTab } from "@/lib/recent-closed-tabs";
import { splitVisibleTabs } from "@/lib/tab-overflow";
import {
  TAB_DRAG_ACTIVATION_PX,
  dropIndexFromPointer,
  dropIndicatorX,
  moveIntentFor,
  type TabRect,
} from "@/lib/tab-reorder";
import type { RightPanelTabDragState } from "@/lib/right-panel-split";
import { TEXT } from "@/lib/typography";

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  /** fork:git-graph-tab — `git-graph` 是工作区单例视图 tab（无 filePath）。 */
  /** fork:trace-pane — `trace` 是单例「调用轨迹」视图 tab（同上）。 */
  kind?: "terminal" | "browser" | "session" | "git-graph" | "trace";
  closing?: boolean;
  sourceSessionId?: string | null;
  initialDisplayMode?: FileViewerDisplayMode;
  /** PDF page requested by the link that opened this tab (`#page=N`). */
  page?: number;
  viewerState?: FileViewerState;
  viewerRevision?: number;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  /**
   * fork:proma-38-tab-reorder — 把 `tabId` 挪到 `beforeTabId` 之前（`null` = 最末尾）。
   * 不传就没有拖拽排序（键盘移动也随之关闭），TabBar 在没有 tab 状态所有者的场景
   * （测试、静态渲染）里仍然可用。
   */
  onMoveTab?: (tabId: string, beforeTabId: string | null) => void;
  /**
   * fork:zc-06 — tab 概览（全部 tab + 最近关闭）。不传就不渲染入口按钮，
   * 这样 TabBar 在没有 tab 状态所有者的场景（测试、静态渲染）里仍然可用。
   */
  overview?: {
    recentClosed: RestorableTab[];
    onCloseAll: () => void;
    onCloseOthers: () => void;
    onRestore: (tab: RestorableTab) => void;
    onClearRecent: () => void;
  };
  /**
   * fork:pr40-split — 右栏双 Pane 分屏的接线。**全部可选**：六个都不传就是改动前的
   * 单列行为（TabBar 只多了一批指针事件监听，没有任何视觉或语义变化）。
   * 它们是 `useSplitPanes` 返回值的同名转发，所以右栏那边不用再做适配。
   */
  /** 拖出过程中的落点上报（`null` = 松手 / 取消）。 */
  handleTabDragChange?: (state: RightPanelTabDragState | null) => void;
  /** 松手：落在右栏哪一侧由 AppShell 侧的落点解析决定。 */
  handleTabDrop?: (state: RightPanelTabDragState) => void;
  /** 强制收尾（切会话 / 右栏关闭）。 */
  endTabDrag?: () => void;
  /** 右栏此刻是否在拖出中（拖出时整条标签栏跟手变灰）。 */
  isDraggingTab?: boolean;
  /** 有分屏态（窄栏 / 手机下为 true 但渲染不出两格 —— 退分屏钮仍要留着）。 */
  isSplitActive?: boolean;
  /** 退分屏。 */
  collapseSplit?: () => void;
  /** 退分屏钮的 aria-label / title。 */
  collapseSplitLabel?: string;
}

// fork:ui-12 — width of the "…" fold button (kept in sync with its style below).
const TAB_OVERFLOW_BUTTON_WIDTH = 34;

// fork:pr40-split — 拖出阈值（照 Proma `TabBar.tsx` 的那一对）：
//   · **方向**：指针要**向下**离开标签栏 12px（往上是顶栏，不该触发分屏）；
//   · **距离**：累计位移 ≥ 18px —— 单次抖动 / 误触不该把 tab 拆出去。
// 两条都满足才算「拖出中」，否则全程只当普通点击。
const TAB_DRAG_OUT_EXIT_PX = 12;
const TAB_DRAG_OUT_TRAVEL_PX = 18;

export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  overview,
  onMoveTab,
  handleTabDragChange,
  handleTabDrop,
  endTabDrag,
  isDraggingTab,
  isSplitActive,
  collapseSplit,
  collapseSplitLabel,
}: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [hoveredClose, setHoveredClose] = useState<string | null>(null);
  // fork:ui-14 — the close control stays out of the way until the tab is
  // active, hovered or keyboard-focused (reference implementations reveal it
  // on hover; keeping it in the layout avoids jitter).
  const [focusedClose, setFocusedClose] = useState<string | null>(null);
  // fork:ui-12 — fold trailing tabs into a "…" menu when the bar runs out of room.
  // Widths are measured per tab (content-derived), the split itself is pure.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widthsRef = useRef(new Map<string, number>());
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowPos, setOverflowPos] = useState<{ top: number; left: number } | null>(null);
  // fork:zc-06 — tab 概览浮层。锚点仍然按 fixed 计算，理由与「…」菜单相同
  // （这条 tab 栏横向裁切，in-flow 下拉会被切掉）。
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overviewPos, setOverviewPos] = useState<{ top: number; left: number } | null>(null);
  // fork:zm-05 — sliding active-tab indicator. The pill is absolutely positioned
  // and lives outside the flex flow, so none of the measurements below see it.
  const tabElementsRef = useRef(new Map<string, HTMLElement>());
  const pendingTabFocusRef = useRef<string | null>(null);
  const pillFrameRef = useRef<number | null>(null);
  const [pillState, setPillState] = useState<{ x: number; width: number; ready: boolean }>({
    x: 0,
    width: 0,
    ready: false,
  });
  /* fork:proma-38-tab-reorder — 拖拽排序。拖动期间**不重排 DOM**：重排会移动每个
     tab 的 offsetLeft/offsetWidth，`lib/tab-overflow.ts` 的折叠判定与上面那颗滑动
     pill 都靠这些测量值，来回抖。所以只画一条落点指示线，松手才换顺序。

     `pendingRef` = 按下但还没超过阈值的候选（未超过就是一次普通点击）；
     `dragRef` + `drag` = 已经成立的拖拽（ref 供 window 监听器读，state 只驱动渲染）。 */
  const pendingRef = useRef<{ tabId: string; fromIndex: number; startX: number; startY: number } | null>(null);
  const dragRef = useRef<{ tabId: string; fromIndex: number; insertIndex: number; insertX: number } | null>(null);
  const [drag, setDrag] = useState<{ tabId: string; fromIndex: number; insertIndex: number; insertX: number } | null>(null);

  /* fork:pr40-split —— 拖出成手势分屏。
   *
   * 监听挂在 window 上而不是 tab 上：指针一旦向下移出这条 `overflow-x: hidden` 的
   * 标签栏，元素级监听就收不到后续 move 了。也因此全程不 `setPointerCapture` ——
   * 捕获会把事件锁在 tab 上，右栏拿不到真实指针位置，落点会粘在按下那一格。
   *
   * 两个回调任一为空就整段不挂（单列路径零成本）。
   */
  const dragOutEnabled = Boolean(handleTabDragChange && handleTabDrop);
  const dragOutRef = useRef<{
    tabId: string;
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    // 过阈值之前 pointermove 一次都不报，避免每次微小抖动都往返 React。
    dragging: boolean;
  } | null>(null);
  // 拖出成立后紧跟着的那次 click 要吃掉：否则松手会把 tab 切走一次，
  // 刚建的分屏又被顶栏点选改回去。
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (!dragOutEnabled) return;
    const finish = (cancelled: boolean) => {
      const drag = dragOutRef.current;
      if (!drag) return;
      dragOutRef.current = null;
      if (!drag.dragging) return;
      suppressClickRef.current = !cancelled;
      // 落点与分屏态全在右栏那边算；这里只报一个坐标，松手后它自己收手。
      if (cancelled) handleTabDragChange?.(null);
      else handleTabDrop?.({ tabId: drag.tabId, clientX: drag.lastX, clientY: drag.lastY });
    };
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragOutRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      if (drag.dragging) {
        handleTabDragChange?.({ tabId: drag.tabId, clientX: event.clientX, clientY: event.clientY });
        return;
      }
      const dy = event.clientY - drag.startY;
      const travel = Math.hypot(event.clientX - drag.startX, dy);
      if (dy < TAB_DRAG_OUT_EXIT_PX || travel < TAB_DRAG_OUT_TRAVEL_PX) return;
      drag.dragging = true;
      handleTabDragChange?.({ tabId: drag.tabId, clientX: event.clientX, clientY: event.clientY });
    };
    const onPointerUp = (event: PointerEvent) => {
      if (dragOutRef.current?.pointerId !== event.pointerId) return;
      finish(false);
    };
    const onPointerCancel = (event: PointerEvent) => {
      if (dragOutRef.current?.pointerId !== event.pointerId) return;
      finish(true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !dragOutRef.current) return;
      finish(true);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown, true);
      // 卸载时通知右栏收手（切会话 / 关右栏时指针可能还在半空）。
      const drag = dragOutRef.current;
      dragOutRef.current = null;
      if (drag?.dragging) handleTabDragChange?.(null);
    };
  }, [dragOutEnabled, handleTabDragChange, handleTabDrop]);

  // 右栏自己收手（切会话）后，这边也要把内部状态清掉，否则下一次 pointermove
  // 还会往一个已经不存在的拖拽上发坐标。
  useEffect(() => {
    if (!isDraggingTab && dragOutRef.current?.dragging) dragOutRef.current = null;
  }, [isDraggingTab]);

  const startTabDragOut = (tabId: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragOutEnabled || event.button !== 0) return;
    dragOutRef.current = {
      tabId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      dragging: false,
    };
  };

  useEffect(() => {
    // tab 全关光时浮层无事可做，留着只会悬在空栏上。
    if (tabs.length === 0 && overviewOpen) setOverviewOpen(false);
  }, [overviewOpen, tabs.length]);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const update = () => setContainerWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const measureTab = (id: string) => (element: HTMLElement | null) => {
    if (!element) {
      tabElementsRef.current.delete(id);
      return;
    }
    tabElementsRef.current.set(id, element);
    const width = element.offsetWidth;
    if (widthsRef.current.get(id) === width) return;
    widthsRef.current.set(id, width);
    setLayoutVersion((current) => current + 1);
  };

  const activeIndex = tabs.findIndex((tab) => tab.id === activeTabId);

  // fork:zm-05 — measure the active tab and move the pill. `offsetLeft` is
  // relative to the positioned tab bar (`.fork-tabbar`), so transform and width
  // can be applied verbatim. Measurement is batched through rAF when it comes
  // from observers; a commit (tab switch, keyboard navigation) updates in the
  // layout phase so the pill and the content move in the same frame.
  const updatePill = useCallback(() => {
    const element = tabElementsRef.current.get(activeTabId);
    if (!element) return;
    const x = element.offsetLeft;
    const width = element.offsetWidth;
    setPillState((current) => (
      current.ready && current.x === x && current.width === width
        ? current
        : { x, width, ready: true }
    ));
  }, [activeTabId]);

  const schedulePillUpdate = useCallback(() => {
    if (typeof window === "undefined" || pillFrameRef.current !== null) return;
    pillFrameRef.current = window.requestAnimationFrame(() => {
      pillFrameRef.current = null;
      updatePill();
    });
  }, [updatePill]);

  // Runs after every commit: covers click/keyboard selection, and restores focus
  // to a tab that was folded into the overflow menu until it became visible.
  useLayoutEffect(() => {
    updatePill();
    const pendingFocusId = pendingTabFocusRef.current;
    if (!pendingFocusId) return;
    pendingTabFocusRef.current = null;
    tabElementsRef.current.get(pendingFocusId)?.focus();
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedulePillUpdate);
    observer?.observe(container);
    for (const element of tabElementsRef.current.values()) observer?.observe(element);
    window.addEventListener("resize", schedulePillUpdate);
    return () => {
      if (pillFrameRef.current !== null) {
        window.cancelAnimationFrame(pillFrameRef.current);
        pillFrameRef.current = null;
      }
      observer?.disconnect();
      window.removeEventListener("resize", schedulePillUpdate);
    };
  }, [activeTabId, containerWidth, layoutVersion, schedulePillUpdate, tabs.length]);
  // `layoutVersion` is the re-measure signal: widths live in a ref, and this state
  // value is what re-runs the split after a tab reports a new width.
  const measuredWidths = useMemo(
    () => tabs.map((tab) => widthsRef.current.get(tab.id) ?? 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs, layoutVersion],
  );
  const { visible, hidden } = splitVisibleTabs({
    widths: measuredWidths,
    containerWidth: containerWidth || 100_000,
    moreWidth: TAB_OVERFLOW_BUTTON_WIDTH,
    activeIndex,
  });
  const visibleSet = new Set(visible);
  const hiddenTabs = hidden.map((index) => tabs[index]!).filter(Boolean);

  useEffect(() => {
    if (!overflowOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-tab-overflow-menu]")) return;
      setOverflowOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOverflowOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [overflowOpen]);

  const tabAccessibleName = (tab: Tab) => (
    tab.kind === "terminal"
      ? t("terminal.tabLabel", { name: tab.label })
      : tab.kind === "browser"
        ? t("browser.tabLabel", { name: tab.label })
        : tab.label
  );

  /* fork:proma-38-tab-reorder —— 拖拽排序的几何与手势。 */
  /** 当前**看得见**的 tab（折叠进「…」的不在 `tabElementsRef` 里），按 tab 顺序量。 */
  const measureVisibleRects = useCallback((): (TabRect & { id: string })[] => {
    const bar = containerRef.current;
    if (!bar) return [];
    const barLeft = bar.getBoundingClientRect().left;
    const out: (TabRect & { id: string })[] = [];
    for (const tab of tabs) {
      const element = tabElementsRef.current.get(tab.id);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      out.push({ id: tab.id, left: rect.left - barLeft, width: rect.width });
    }
    return out;
  }, [tabs]);

  const endDrag = useCallback(() => {
    pendingRef.current = null;
    dragRef.current = null;
    setDrag(null);
  }, []);

  useEffect(() => {
    if (!onMoveTab) return;
    const onPointerMove = (event: PointerEvent) => {
      const pending = pendingRef.current;
      if (!pending) return;
      let active = dragRef.current;
      if (!active) {
        const moved = Math.hypot(event.clientX - pending.startX, event.clientY - pending.startY);
        if (moved < TAB_DRAG_ACTIVATION_PX) return;
        active = { tabId: pending.tabId, fromIndex: pending.fromIndex, insertIndex: pending.fromIndex, insertX: 0 };
      }
      const bar = containerRef.current;
      if (!bar) return;
      const rects = measureVisibleRects();
      const insertIndex = dropIndexFromPointer(event.clientX - bar.getBoundingClientRect().left, rects);
      // 刚落下的第一帧（dragRef 还是 null）必须算：指示线一上来就该在真实落点上。
      if (dragRef.current && active.insertIndex === insertIndex) return;
      const next = {
        ...active,
        insertIndex,
        // 指示线的 x 与 pill 同一坐标系（标签栏内容盒左缘为 0），不越出标签行。
        insertX: Math.max(0, Math.min(dropIndicatorX(rects, insertIndex), bar.clientWidth)),
      };
      dragRef.current = next;
      setDrag(next);
    };
    const onPointerUp = () => {
      const finished = dragRef.current;
      endDrag();
      // 没超过阈值时 finished 就是 null —— 那是一次普通点击，交给 onClick。
      if (!finished) return;
      const visibleIds = measureVisibleRects().map((rect) => rect.id);
      const intent = moveIntentFor(visibleIds, finished.fromIndex, finished.insertIndex);
      if (intent.changed) onMoveTab(finished.tabId, intent.beforeId);
    };
    // 手势被系统接管（滚动 / 系统级取消）= 撤销，不落顺序。
    const onPointerCancel = () => endDrag();
    const onKeyDown = (event: KeyboardEvent) => {
      // Esc 取消：拖到一半的落点不生效，标签行回到原样。
      if (event.key !== "Escape" || !dragRef.current) return;
      event.preventDefault();
      endDrag();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [endDrag, measureVisibleRects, onMoveTab]);

  // 窄屏退化：标签行本身要能横向滑动，拖拽排序让位给滚动（键盘移动仍然可用）。
  const dragEnabled = Boolean(onMoveTab) && !isMobile && tabs.length > 1;

  return (
    <div
      ref={containerRef}
      role="tablist"
      /* fork:design-components —— 标签条直接用画板 31 的 .pw-tabs（2px 间距 / 发丝底线），
         每个标签追加 .pw-tab（.is-on 选中态）；拖拽排序与溢出折叠逻辑不变。 */
      className={`fork-tabbar pw-tabs${drag ? " is-reordering" : ""}`}
      title={dragEnabled ? t("tabs.reorder") : undefined}
      /* fork:proma-38-tab-reorder —— 拖动中禁掉默认的拖选（否则会选中一行标签文字），
         拖拽本身不阻止默认行为：点击仍然选中、关闭钮仍然可点。 */
      onDragStart={(event) => {
        if (!drag) return;
        event.preventDefault();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        background: "transparent",
        overflowX: "hidden",
        flexShrink: 0,
        height: "var(--control-lg)",
        minWidth: 0,
        // fork:pr40-split —— 拖出中整条栏变淡：这是「正在把 tab 拆出去」的全局反馈
        // （落点高亮在右栏那一侧，不依赖具体哪个 tab）。
        opacity: isDraggingTab ? 0.55 : 1,
        transition: "opacity 120ms var(--ease-out)",
      }}
    >
      {/* fork:zm-05 — the highlight pill. Absolutely positioned (out of flow) so
          the per-tab offsetWidth measurements that drive the "…" fold are
          unaffected; opacity stays 0 until the first measurement lands, which
          prevents a flash at (0,0). */}
      <span
        aria-hidden="true"
        className="fork-tab-pill"
        style={{
          transform: `translateX(${pillState.ready ? pillState.x : 0}px)`,
          width: pillState.ready ? pillState.width : 0,
          opacity: pillState.ready && activeIndex >= 0 && tabs.length > 0 ? 1 : 0,
        }}
      />
      {/* fork:proma-38-tab-reorder —— 落点指示线。与 pill 一样绝对定位（拖动中不占流，
          也就不会推动任何 tab）：一条强调色竖线，落在两个 tab 之间或行尾。
          几何：`.fork-tab-drop` 在 fork-ui.css（判据⑦ 只管 `.pw-*`），高度跟着画板
          `.pw-tab` 的 26。 */}
      {drag && (
        <span
          aria-hidden="true"
          className="fork-tab-drop"
          style={{ transform: `translateX(${drag.insertX}px)` }}
        />
      )}
      {tabs.map((tab, index) => {
        if (!visibleSet.has(index)) return null;
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            ref={measureTab(tab.id)}
            role="tab"
            className={`fork-tab pw-tab${isActive ? " is-on" : ""}`}
            aria-label={tabAccessibleName(tab)}
            aria-selected={isActive}
            /* fork:proma-38-tab-reorder —— 拖拽的键盘等价物（窄屏也可用）。 */
            aria-keyshortcuts={onMoveTab ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
            tabIndex={isActive || (!activeTabId && tabs[0].id === tab.id) ? 0 : -1}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectTab(tab.id);
              } else if (onMoveTab && event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
                // fork:proma-38-tab-reorder —— Alt+←/→ 在整条 tab 顺序里搬动这个 tab
                // （拖拽的键盘等价物，窄屏也能用）。
                // **必须排在纯方向键分支前面**：否则 Alt+← 会先被当成「选上一个」。
                // 往左 = 插到上一个之前；往右 = 插到下一个之前（没有下一个就放末尾）。
                event.preventDefault();
                const index = tabs.findIndex((item) => item.id === tab.id);
                const beforeId = event.key === "ArrowLeft"
                  ? (tabs[index - 1]?.id ?? null)
                  : (tabs[index + 1]?.id ?? null);
                if (beforeId === tab.id) return;
                onMoveTab(tab.id, beforeId);
              } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const index = tabs.findIndex((item) => item.id === tab.id);
                const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                const nextId = tabs[next].id;
                onSelectTab(nextId);
                // fork:zm-05 — the pill is the tab bar's first child, so the old
                // positional `children[next]` lookup would land one node early.
                // Focus by id after the selection re-renders (the tab may have
                // been folded into the overflow menu before this keypress).
                pendingTabFocusRef.current = nextId;
              }
            }}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
              onSelectTab(tab.id);
            }}
            onPointerDown={(e) => startTabDragOut(tab.id, e)}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              if (!tab.closing) onCloseTab(tab.id);
            }}
            style={{
              // fork:design-components —— 尺寸 / 内边距 / 圆角 / 间距 / 字号全部来自画板
              // 的 `.pw-tab`（board.css：26 高 / 0 8px / radius-4 4 0 0 / gap 5 / --text-meta）。
              // 这里只留折叠与拖拽需要的宽度约束、光标与主题色三态。
              display: "flex",
              alignItems: "center",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              maxWidth: 180,
              minWidth: 80,
              flexShrink: 0,
              userSelect: "none",
              transition: "color 0.1s, transform 120ms var(--ease-out)",
            }}
          >
            <span className="pw-ico" style={{ opacity: isActive ? 1 : 0.7 }}>
              {tab.kind === "terminal" ? (
                <i data-ico="terminal" data-size={13} aria-hidden="true"></i>
              ) : tab.kind === "browser" ? (
                <i data-ico="globe" data-size={13} aria-hidden="true"></i>
              ) : tab.kind === "trace" ? (
                <i data-ico="activity" data-size={13} aria-hidden="true"></i>
              ) : (
                getFileIcon(tab.label, 13)
              )}
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
                fontWeight: isActive ? 500 : 400,
              }}
              title={tab.filePath}
            >
              {tab.label}
            </span>
            <button
              type="button"
              disabled={tab.closing}
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              onMouseEnter={() => setHoveredClose(tab.id)}
              onMouseLeave={() => setHoveredClose(null)}
              onFocus={() => setFocusedClose(tab.id)}
              onBlur={() => setFocusedClose(null)}
              /* fork:design-components —— 关闭钮 = 画板 31/30 的 `.pw-tab .x`：
                 `x` 字形走 data-ico（11px / --n-placeholder 来自 board.css），不再自绘 SVG。
                 画板里 `.x` 是静态 span，产品里是可点钮 —— UA 归零在 fork-ui.css 的接线块里。 */
              className="x"
              style={{
                cursor: "pointer",
                color: hoveredClose === tab.id || focusedClose === tab.id ? "var(--n-muted)" : undefined,
              }}
               title={t(tab.kind === "terminal" ? "terminal.close" : "i18n.close")}
               aria-label={`${t(tab.kind === "terminal" ? "terminal.close" : "i18n.close")} ${tab.label}`}
            >
              <i data-ico="x" data-size={11} aria-hidden="true"></i>
            </button>
          </div>
        );
      })}
      {/* fork:ui-12 — the folded tabs. The menu is fixed-positioned because the
          bar itself clips on the x axis (overflow-x: hidden), which would cut off
          any in-flow dropdown. */}
      {hiddenTabs.length > 0 && (
        <button
          type="button"
          className="fork-tab-more"
          onClick={(event) => {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            setOverflowPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 240) });
            setOverflowOpen((current) => !current);
          }}
          title={t("tabs.more", { count: hiddenTabs.length })}
          aria-label={t("tabs.more", { count: hiddenTabs.length })}
          aria-expanded={overflowOpen}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-icon)",
            height: "var(--control-sm)", width: TAB_OVERFLOW_BUTTON_WIDTH, flexShrink: 0,
            background: overflowOpen ? "var(--bg-selected)" : "transparent",
            border: "none", borderRadius: "var(--radius-md)",
            color: "var(--text-muted)", cursor: "pointer", fontSize: TEXT.xs,
          }}
        >
          <i data-ico="ellipsis" data-size={14} aria-hidden="true"></i>
          {hiddenTabs.length}
        </button>
      )}
      {/* fork:pr40-split —— 退分屏。窄栏 / 手机下也渲染（那时 `isSplitActive` 仍为真，
          只是画不出两格）—— 不留这颗钮，分屏态就会变成一个用户看得见却删不掉的幽灵。
          位置在「…」与概览之前：它是**当前布局**的动作，不是 tab 列表的动作。 */}
      {isSplitActive && collapseSplit && (
        <button
          type="button"
          data-split-collapse="true"
          className="fork-tab-collapse"
          onClick={() => {
            collapseSplit();
            endTabDrag?.();
          }}
          title={collapseSplitLabel}
          aria-label={collapseSplitLabel}
          aria-pressed={false}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "var(--control-sm)", width: "var(--control-sm)", flexShrink: 0,
            background: "transparent",
            border: "none", borderRadius: "var(--radius-md)",
            color: "var(--text-muted)", cursor: "pointer",
          }}
        >
          <i data-ico="minimize-2" data-size={14} aria-hidden="true"></i>
        </button>
      )}
      {/* fork:zc-06 — 概览入口。始终存在（只要还有 tab），因为溢出菜单只在
          放不下时才出现 —— 那正是「tab 少的时候看不到全部 tab」的成因。 */}
      {overview && tabs.length > 0 && (
        <button
          type="button"
          data-tab-overview-trigger="true"
          className="fork-tab-overview"
          onClick={(event) => {
            const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
            setOverviewPos({ top: rect.bottom + 4, left: Math.max(8, rect.right - 300) });
            setOverviewOpen((current) => !current);
          }}
          title={t("tabs.overview")}
          aria-label={t("tabs.overview")}
          aria-expanded={overviewOpen}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: "var(--control-sm)", width: "var(--control-sm)", flexShrink: 0,
            background: overviewOpen ? "var(--bg-selected)" : "transparent",
            border: "none", borderRadius: "var(--radius-md)",
            color: overviewOpen ? "var(--text)" : "var(--text-muted)", cursor: "pointer",
          }}
        >
          <i data-ico="rows-3" data-size={14} aria-hidden="true"></i>
        </button>
      )}
      {overview && (
        <TabOverview
          open={overviewOpen}
          anchor={overviewPos}
          tabs={tabs}
          activeTabId={activeTabId}
          recentClosed={overview.recentClosed}
          onClose={() => setOverviewOpen(false)}
          onSelectTab={onSelectTab}
          onCloseTab={onCloseTab}
          onCloseAll={overview.onCloseAll}
          onCloseOthers={overview.onCloseOthers}
          onRestore={overview.onRestore}
          onClearRecent={overview.onClearRecent}
        />
      )}
      {overflowOpen && overflowPos && hiddenTabs.length > 0 && (
        <div
          data-tab-overflow-menu="true"
          role="menu"
          style={{
            position: "fixed",
            top: overflowPos.top,
            left: overflowPos.left,
            zIndex: 400,
            width: "var(--pop-w-sm)",
            maxHeight: "min(60vh, 420px)",
            overflowY: "auto",
            padding: "var(--s1)",
            background: "var(--bg-elev)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          {hiddenTabs.map((tab) => (
            <div key={tab.id} style={{ display: "flex", alignItems: "center" }}>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOverflowOpen(false);
                  onSelectTab(tab.id);
                }}
                title={tab.filePath}
                style={{
                  display: "flex", alignItems: "center", gap: "var(--s2)", flex: 1, minWidth: 0, height: 30,
                  padding: "0 8px", background: "none", border: "none",
                  borderRadius: "var(--radius-md)", color: "var(--text)",
                  cursor: "pointer", fontSize: TEXT.sm, textAlign: "left",
                }}
                onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(event) => { event.currentTarget.style.background = "none"; }}
              >
                <span style={{ flexShrink: 0, opacity: 0.75, display: "flex", alignItems: "center" }}>
                  {tab.kind === "terminal" ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                  ) : tab.kind === "browser" ? (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="9" /><path d="M3 12h18" />
                    </svg>
                  ) : tab.kind === "trace" ? (
                    <i data-ico="activity" data-size={12} aria-hidden="true"></i>
                  ) : getFileIcon(tab.label, 12)}
                </span>
                <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tab.label}</span>
              </button>
              <button
                type="button"
                disabled={tab.closing}
                onClick={() => {
                  setOverflowOpen(false);
                  onCloseTab(tab.id);
                }}
                title={t(tab.kind === "terminal" ? "terminal.close" : "i18n.close")}
                aria-label={`${t(tab.kind === "terminal" ? "terminal.close" : "i18n.close")} ${tab.label}`}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: "var(--control-2xs)", height: "var(--control-2xs)", flexShrink: 0, background: "none",
                  border: "none", borderRadius: "var(--radius-sm)",
                  color: "var(--text-dim)", cursor: "pointer", padding: 0,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <line x1="2" y1="2" x2="8" y2="8" /><line x1="8" y1="2" x2="2" y2="8" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
