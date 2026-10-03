"use client";

/**
 * fork:pr40-split —— 右栏双 Pane 分屏的接线层。
 *
 * 纯逻辑都在 `lib/right-panel-split.ts`（可单测），这里只做三件事：
 *   1. 按会话槽记分屏态 + **两套宽度**（普通 / 宽工作区）；
 *   2. 拖拽：tab 拖出（落点解析来自 TabBar 发的事件）与分隔条比例拖拽；
 *   3. 窄栏 / 手机退化：宽度不够 720px 就退回单列，但**分屏态保留**（内容不丢）。
 *
 * 宽度口径照 Proma `AppShell.tsx` 的 `ordinaryRightPanelMinimumWidth`：
 * 进入分屏时把「宽工作区宽度」顶上去（种子 = 普通宽度），下限临时换成 720，
 * **绝不把 720 这个分屏下限写回普通宽度** —— 退分屏后右栏还是用户自己拖的那个宽度。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from "react";
import { RIGHT_PANEL_MIN_WIDTH } from "@/lib/panel-layout";
import {
  clampSplitRatio,
  clampSplitRatioForWidth,
  collapseRightPanelSplit,
  commitRightPanelWidth,
  createRightPanelSplit,
  createRightPanelWidthMemory,
  focusedRightPanelTabId,
  markWideWorkspaceOpened,
  placeRightPanelSplitTab,
  resolveRightPanelWidth,
  resolveSplitDropPane,
  sanitizeRightPanelSplit,
  selectRightPanelSplitTab,
  SPLIT_PANEL_MIN_WIDTH,
  SPLIT_RATIO_DEFAULT,
  SPLIT_RATIO_MAX,
  SPLIT_RATIO_MIN,
  supportsSplitPanel,
  type RightPanelPane,
  type RightPanelSplitState,
  type RightPanelTabDragState,
  type RightPanelWidthMemory,
} from "@/lib/right-panel-split";
import {
  DRAFT_SESSION_SLOT,
  loadRightPanelWidthMemory,
  loadSplitRatio,
  saveRightPanelWidthMemory,
  saveSplitRatio,
} from "@/lib/right-panel-split-memory";

/** TabBar 在「拖出中」时上报的落点载荷（定义在纯逻辑层，TabBar 不用拉 hook 才能拿到类型）。 */
export type SplitTabDragState = RightPanelTabDragState;

export interface SplitPaneDividerProps {
  role: "separator";
  "aria-orientation": "vertical";
  "aria-label": string;
  "aria-valuemin": number;
  "aria-valuemax": number;
  "aria-valuenow": number;
  tabIndex: number;
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLDivElement>) => void;
  onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}

/** `useResizablePanel` 的一小块：分屏只借用它，不接管它的存储。 */
export interface SplitPaneResizerLike {
  /** 当前渲染宽度（px）。 */
  width: number;
  /** 当前视口允许的上限（px）。 */
  maxWidth: number;
  isResizing: boolean;
  /** 程序化改宽（第二参数默认 false = 不落盘）。 */
  setWidth: (width: number, persist?: boolean) => void;
}

export interface UseSplitPanesOptions {
  /** 会话 id；新会话草稿（还没有 id）走 `DRAFT_SESSION_SLOT`。 */
  sessionId: string | null;
  /** 右栏当前开着的 tab id（用于校验分屏引用、顶栏排序）。 */
  availableTabIds: readonly string[];
  /** 焦点 Pane 的 tab id（AppShell 的 `activeFileTabId`）。 */
  activeTabId: string | null;
  onActiveTabIdChange: (tabId: string | null) => void;
  /** 手机是单屏全幅工作区，永远不分屏。 */
  isMobile: boolean;
  resizer: SplitPaneResizerLike;
  /** 分屏下限（默认 720）。 */
  splitMinimumWidth?: number;
  dividerAriaLabel: string;
}

interface DividerDrag {
  /** 拖拽**开始时**的会话槽 —— 切会话时收尾只能写回这一槽，不能写到新会话。 */
  slot: string;
  pointerId: number;
  /** 拖拽起点 X。 */
  startX: number;
  /** 起点比例（clamp 到当前宽度之后）。 */
  originRatio: number;
  /** 当前比例 —— 每次 apply 都写这里，落盘读它。 */
  ratio: number;
  /** 拖拽开始时面板的渲染宽度（分母）。 */
  width: number;
  frame: number | null;
  /** 最新指针 X —— rAF 回调里现取，绝不在调度时捕获事件坐标。 */
  latestClientX: number;
  previousCursor: string;
  previousUserSelect: string;
  /** 拖拽期间挂在 window 上的兜底监听（blur / 会话切换）。 */
  removeListeners: () => void;
}

const RATIO_STEP = 0.05;

export function useSplitPanes(options: UseSplitPanesOptions) {
  const {
    sessionId,
    availableTabIds,
    activeTabId,
    onActiveTabIdChange,
    isMobile,
    resizer,
    splitMinimumWidth = SPLIT_PANEL_MIN_WIDTH,
    dividerAriaLabel,
  } = options;

  const sessionSlot = sessionId ?? DRAFT_SESSION_SLOT;
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [splits, setSplits] = useState<Record<string, RightPanelSplitState | undefined>>({});
  const [ratios, setRatios] = useState<Record<string, number | undefined>>({});
  const [widthMemories, setWidthMemories] = useState<Record<string, RightPanelWidthMemory | undefined>>({});
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dropTargetPane, setDropTargetPane] = useState<RightPanelPane | null>(null);
  const [isDividerResizing, setIsDividerResizing] = useState(false);

  const split = splits[sessionSlot] ?? null;
  const ratio = ratios[sessionSlot] ?? SPLIT_RATIO_DEFAULT;
  const memory = widthMemories[sessionSlot]
    ?? createRightPanelWidthMemory({ ordinaryWidth: resizer.width });

  /** 画两个 Pane 的条件：非手机 + 宽度够 + 有分屏态。 */
  const splitAvailable = !isMobile && supportsSplitPanel(resizer.width, splitMinimumWidth);
  const isSplitActive = split !== null && splitAvailable;

  /* ---- 同步给「读得到最新值」的地方（effect 里不重算回调） ---------------- */
  const memoryRef = useRef(memory);
  memoryRef.current = memory;
  const availableTabIdsRef = useRef(availableTabIds);
  availableTabIdsRef.current = availableTabIds;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const onActiveTabIdChangeRef = useRef(onActiveTabIdChange);
  onActiveTabIdChangeRef.current = onActiveTabIdChange;
  const splitsRef = useRef(splits);
  splitsRef.current = splits;
  const ratiosRef = useRef(ratios);
  ratiosRef.current = ratios;
  const resizerRef = useRef(resizer);
  resizerRef.current = resizer;
  /** 最近一次「非分屏状态下的普通宽度」，给新会话槽当种子用。 */
  const fallbackOrdinaryWidthRef = useRef<number | null>(null);

  /* ---- 会话槽首次进入：从 localStorage 补齐比例与两套宽度 ---------------- */
  const hydratedSlotsRef = useRef(new Set<string>());
  useEffect(() => {
    if (hydratedSlotsRef.current.has(sessionSlot)) return;
    hydratedSlotsRef.current.add(sessionSlot);
    setRatios((previous) => (
      previous[sessionSlot] === undefined
        ? { ...previous, [sessionSlot]: loadSplitRatio(sessionSlot) }
        : previous
    ));
    // 种子 = `useResizablePanel` 当前宽度（它自己写 `pi-right-panel-width`）。
    // **但正在分屏时不能用当前宽度当种子** —— 那是分屏临时顶上去的宽值，
    // 记成新会话的普通宽度就是「下次打开右栏莫名变宽」。改用上一次退分屏时的普通宽度。
    const seedWidth = splitsRef.current[sessionSlot]
      ? fallbackOrdinaryWidthRef.current ?? resizerRef.current.width
      : resizerRef.current.width;
    if (!splitsRef.current[sessionSlot]) fallbackOrdinaryWidthRef.current = seedWidth;
    setWidthMemories((previous) => (
      previous[sessionSlot] === undefined
        ? {
          ...previous,
          [sessionSlot]: loadRightPanelWidthMemory(sessionSlot, { ordinaryWidth: seedWidth }),
        }
        : previous
    ));
  }, [sessionSlot]);

  /* ---- 切会话：取消在飞的两种拖拽，绝不把旧闭包的尺寸写到新会话 -------- */
  const dividerDragRef = useRef<DividerDrag | null>(null);
  const endTabDrag = useCallback(() => {
    setDraggedTabId(null);
    setDropTargetPane(null);
  }, []);
  const cancelDividerDrag = useCallback(() => {
    const drag = dividerDragRef.current;
    if (!drag) return;
    dividerDragRef.current = null;
    if (drag.frame !== null && typeof window !== "undefined") window.cancelAnimationFrame(drag.frame);
    drag.frame = null;
    drag.removeListeners();
    document.body.style.cursor = drag.previousCursor;
    document.body.style.userSelect = drag.previousUserSelect;
    setIsDividerResizing(false);
    // 比例已经写进内存态，这里只补一次落盘。槽位取**拖拽开始时**那一槽：
    // 切会话触发的收尾若写到新会话上，就成了「上一个会话的尺寸污染下一个」。
    saveSplitRatio(drag.slot, drag.ratio);
  }, []);

  useEffect(() => {
    endTabDrag();
    cancelDividerDrag();
  }, [cancelDividerDrag, endTabDrag, sessionSlot]);
  useEffect(() => () => cancelDividerDrag(), [cancelDividerDrag]);

  /* ---- 分屏引用校验：tab 关了就修一个，或者整体退回单列（内容不丢） ----- */
  // 分隔符用 NUL：tab id 里可能有空格（`file:/tmp/my file.ts`），
  // 用空格拼会撞出同一个 key，校验就漏跑了。
  const availableKey = useMemo(() => availableTabIds.join("\u0000"), [availableTabIds]);
  useEffect(() => {
    const current = splitsRef.current[sessionSlot] ?? null;
    if (!current) return;
    const resolution = sanitizeRightPanelSplit(current, availableTabIdsRef.current);
    if (resolution.split === current) return;
    setSplits((previous) => (
      previous[sessionSlot] === current
        ? { ...previous, [sessionSlot]: resolution.split ?? undefined }
        : previous
    ));
    if (!resolution.split && resolution.activeTabId && activeTabIdRef.current !== resolution.activeTabId) {
      onActiveTabIdChangeRef.current(resolution.activeTabId);
    }
  }, [availableKey, sessionSlot]);

  /* ---- 焦点不变量：AppShell 直接 setActiveFileTabId（开文件 / 恢复终端…）
         之后把新 tab 落到焦点那一侧。 ------------------------------------ */
  useEffect(() => {
    const current = splitsRef.current[sessionSlot] ?? null;
    if (!current || !activeTabId) return;
    if (focusedRightPanelTabId(current) === activeTabId) return;
    const next = selectRightPanelSplitTab(current, activeTabId);
    setSplits((previous) => (
      previous[sessionSlot] === current ? { ...previous, [sessionSlot]: next } : previous
    ));
  }, [activeTabId, sessionSlot]);

  /* ---- 顶栏点选 ------------------------------------------------------- */
  const selectTab = useCallback((tabId: string) => {
    const current = splitsRef.current[sessionSlot] ?? null;
    if (!current) {
      onActiveTabIdChange(tabId);
      return;
    }
    const next = selectRightPanelSplitTab(current, tabId);
    setSplits((previous) => ({ ...previous, [sessionSlot]: next }));
    onActiveTabIdChange(focusedRightPanelTabId(next));
  }, [onActiveTabIdChange, sessionSlot]);

  const collapseSplit = useCallback(() => {
    const current = splitsRef.current[sessionSlot] ?? null;
    if (!current) return;
    setSplits((previous) => ({ ...previous, [sessionSlot]: undefined }));
    onActiveTabIdChange(collapseRightPanelSplit(current));
    endTabDrag();
  }, [endTabDrag, onActiveTabIdChange, sessionSlot]);

  /* ---- tab 拖出 ------------------------------------------------------- */
  const resolveDropPane = useCallback((state: SplitTabDragState): RightPanelPane | null => {
    if (!splitAvailable) return null;
    const container = containerRef.current;
    if (!container || !state.tabId) return null;
    return resolveSplitDropPane(container.getBoundingClientRect(), state.clientX, state.clientY);
  }, [splitAvailable]);

  const handleTabDragChange = useCallback((state: SplitTabDragState | null) => {
    if (!state) {
      endTabDrag();
      return;
    }
    setDraggedTabId(state.tabId);
    setDropTargetPane(resolveDropPane(state));
  }, [endTabDrag, resolveDropPane]);

  const handleTabDrop = useCallback((state: SplitTabDragState) => {
    const pane = resolveDropPane(state);
    const current = splitsRef.current[sessionSlot] ?? null;
    endTabDrag();
    if (!pane || !state.tabId) return;
    const next = current
      ? placeRightPanelSplitTab(current, state.tabId, pane)
      : createRightPanelSplit(
        activeTabIdRef.current ?? "",
        state.tabId,
        pane,
        ratiosRef.current[sessionSlot] ?? SPLIT_RATIO_DEFAULT,
      );
    if (!next) return;
    setSplits((previous) => ({ ...previous, [sessionSlot]: next }));
    // 拖出的 tab 成为焦点那一侧（与 Proma `handleSplitTab` 同序：先激活，再落布局）。
    onActiveTabIdChange(state.tabId);
    const previousMemory = memoryRef.current;
    const widened = markWideWorkspaceOpened(previousMemory);
    if (widened !== previousMemory) {
      memoryRef.current = widened;
      setWidthMemories((previous) => ({ ...previous, [sessionSlot]: widened }));
    }
  }, [endTabDrag, onActiveTabIdChange, resolveDropPane, sessionSlot]);

  /* ---- 宽度：普通 / 宽工作区两套，按会话槽记 --------------------------- */

  // 拖右边框结束：把这一次的宽度记到该记的那一套里（分屏中 = 宽工作区宽度）。
  // **声明在「应用宽度」之前**：同一次提交里它先把 memoryRef 同步好，
  // 下面那个 effect 才读得到用户刚拖出来的那个值（否则会先弹回旧宽度再弹回来）。
  const wasResizingRef = useRef<{ slot: string } | null>(null);
  useEffect(() => {
    if (resizer.isResizing) {
      // 记住是哪个会话槽开始的这次拖拽：中途切会话时收尾也不能记到新会话头上。
      wasResizingRef.current ??= { slot: sessionSlot };
      return;
    }
    const started = wasResizingRef.current;
    if (!started) return;
    wasResizingRef.current = null;
    const width = resizer.width;
    const memoryNow = memoryRef.current;
    const nextMemory = commitRightPanelWidth({
      memory: memoryNow,
      width,
      splitActive: isSplitActive,
    });
    if (nextMemory === memoryNow) return;
    memoryRef.current = nextMemory;
    if (!isSplitActive) fallbackOrdinaryWidthRef.current = width;
    setWidthMemories((previous) => {
      const current = previous[started.slot];
      const merged = current ? commitRightPanelWidth({ memory: current, width, splitActive: isSplitActive }) : nextMemory;
      return merged === current ? previous : { ...previous, [started.slot]: merged };
    });
  }, [isSplitActive, resizer, sessionSlot]);

  // 应用宽度：把「该用多宽」交给 resizer。用户拖右边框时不动（`isResizing`）。
  // 宽度算法读 `memoryRef` 而不是闭包里的 memory —— 拖拽结束的那一帧，
  // `memoryRef` 已经被下面那个 effect 同步更新，不会先把宽度拽回去再弹回来。
  useEffect(() => {
    if (resizerRef.current.isResizing) return;
    const resolved = resolveRightPanelWidth({
      memory: memoryRef.current,
      splitActive: isSplitActive,
      minimumWidth: RIGHT_PANEL_MIN_WIDTH,
      maximumWidth: resizerRef.current.maxWidth,
      splitMinimumWidth,
    });
    if (Math.abs(resizerRef.current.width - resolved.width) < 1) return;
    // persist=false：分屏下限 / 宽工作区宽度只活在会话记忆里，
    // 不写 `pi-right-panel-width`（那是「普通宽度」那一份）。
    resizerRef.current.setWidth(resolved.width);
  }, [isSplitActive, splitMinimumWidth, resizer]);

  // 记忆落盘（普通宽度 + 宽工作区宽度 + 是否用过宽布局）。
  // 逐槽写而不是只写当前槽：拖拽中途切会话时那次提交落在**拖拽开始的**那个槽上。
  useEffect(() => {
    for (const [slot, memoryToSave] of Object.entries(widthMemories)) {
      if (memoryToSave) saveRightPanelWidthMemory(slot, memoryToSave);
    }
  }, [widthMemories]);

  /* ---- 分隔条拖拽 ----------------------------------------------------- */
  const setRatioForSlot = useCallback((next: number) => {
    setRatios((previous) => {
      const clamped = clampSplitRatio(next);
      return previous[sessionSlot] === clamped ? previous : { ...previous, [sessionSlot]: clamped };
    });
  }, [sessionSlot]);

  /** rAF 里读**最新**指针位置算比例，返回算出来的值给松手时落盘。 */
  const applyDividerDrag = useCallback((): number | null => {
    const drag = dividerDragRef.current;
    if (!drag) return null;
    const next = clampSplitRatioForWidth(
      drag.originRatio + ((drag.latestClientX - drag.startX) / drag.width),
      drag.width,
    );
    drag.ratio = next;
    setRatioForSlot(next);
    return next;
  }, [setRatioForSlot]);

  const scheduleDividerApply = useCallback(() => {
    const drag = dividerDragRef.current;
    if (!drag || typeof window === "undefined" || drag.frame !== null) return;
    drag.frame = window.requestAnimationFrame(() => {
      const current = dividerDragRef.current;
      if (current) current.frame = null;
      applyDividerDrag();
    });
  }, [applyDividerDrag]);

  const onDividerPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const width = containerRef.current?.clientWidth ?? 0;
    if (width <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    cancelDividerDrag();
    const target = event.currentTarget;
    target.focus({ preventScroll: true });
    try {
      target.setPointerCapture(event.pointerId);
    } catch {
      // 捕获失败（节点刚被换掉）时仍能靠 window 的兜底监听结束拖拽。
    }
    const onBlur = () => cancelDividerDrag();
    const onKey = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      cancelDividerDrag();
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKey, true);
    dividerDragRef.current = {
      slot: sessionSlot,
      pointerId: event.pointerId,
      startX: event.clientX,
      originRatio: clampSplitRatioForWidth(ratiosRef.current[sessionSlot] ?? SPLIT_RATIO_DEFAULT, width),
      ratio: ratiosRef.current[sessionSlot] ?? SPLIT_RATIO_DEFAULT,
      width,
      frame: null,
      latestClientX: event.clientX,
      previousCursor: document.body.style.cursor,
      previousUserSelect: document.body.style.userSelect,
      removeListeners: () => {
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("keydown", onKey, true);
      },
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setIsDividerResizing(true);
  }, [cancelDividerDrag, sessionSlot]);

  const onDividerPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dividerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.pointerType === "mouse" && event.buttons === 0) {
      cancelDividerDrag();
      return;
    }
    event.preventDefault();
    // 只存坐标、只调度；坐标在 rAF 回调里现取。
    drag.latestClientX = event.clientX;
    scheduleDividerApply();
  }, [cancelDividerDrag, scheduleDividerApply]);

  const onDividerPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dividerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // final flush：先取松手那一刻的真实坐标，落点就停在光标实际位置，
    // 而不是最后一帧 rAF 时算出来的位置。
    drag.latestClientX = event.clientX;
    if (drag.frame !== null && typeof window !== "undefined") window.cancelAnimationFrame(drag.frame);
    drag.frame = null;
    applyDividerDrag();
    cancelDividerDrag();
  }, [applyDividerDrag, cancelDividerDrag]);

  const commitRatio = useCallback((next: number) => {
    const width = containerRef.current?.clientWidth ?? 0;
    const clamped = width > 0 ? clampSplitRatioForWidth(next, width) : clampSplitRatio(next);
    setRatioForSlot(clamped);
    saveSplitRatio(sessionSlot, clamped);
  }, [sessionSlot, setRatioForSlot]);

  const onDividerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? RATIO_STEP * 2 : RATIO_STEP;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      commitRatio(ratio - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      commitRatio(ratio + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      commitRatio(SPLIT_RATIO_MIN);
    } else if (event.key === "End") {
      event.preventDefault();
      commitRatio(SPLIT_RATIO_MAX);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commitRatio(SPLIT_RATIO_DEFAULT);
    }
  }, [commitRatio, ratio]);

  const dividerProps = useMemo<SplitPaneDividerProps>(() => ({
    role: "separator",
    "aria-orientation": "vertical",
    "aria-label": dividerAriaLabel,
    "aria-valuemin": Math.round(SPLIT_RATIO_MIN * 100),
    "aria-valuemax": Math.round(SPLIT_RATIO_MAX * 100),
    "aria-valuenow": Math.round(ratio * 100),
    tabIndex: 0,
    onPointerDown: onDividerPointerDown,
    onPointerMove: onDividerPointerMove,
    onPointerUp: onDividerPointerUp,
    onPointerCancel: () => cancelDividerDrag(),
    onLostPointerCapture: () => cancelDividerDrag(),
    onKeyDown: onDividerKeyDown,
    onDoubleClick: () => commitRatio(SPLIT_RATIO_DEFAULT),
  }), [cancelDividerDrag, commitRatio, dividerAriaLabel, onDividerKeyDown, onDividerPointerDown, onDividerPointerMove, onDividerPointerUp, ratio]);

  /* ---- 顶栏 tab 排序不在这层做（见 lib 的 groupRightPanelSplitTabs） --- */

  return {
    /** 保留态：窄栏退回单列时它仍在，宽度一够就自动回来。 */
    split,
    /** 实际渲染两个 Pane。 */
    isSplitActive,
    /** 有分屏态但当前渲染不出来（窄栏 / 手机）—— UI 可据此给一句提示。 */
    isSplitUnavailable: split !== null && !isSplitActive,
    ratio,
    leftTabId: split?.leftTabId ?? null,
    rightTabId: split?.rightTabId ?? null,
    focusedPane: split?.focusedPane ?? null,
    /** 单列时该渲染哪个 tab（= 焦点那一侧的内容，不丢）。 */
    singlePaneTabId: split && !isSplitActive ? collapseRightPanelSplit(split) : activeTabId,
    containerRef,
    isDraggingTab: draggedTabId !== null,
    dropTargetPane,
    selectTab,
    collapseSplit,
    handleTabDragChange,
    handleTabDrop,
    endTabDrag,
    dividerProps,
    isDividerResizing,
  };
}

export type UseSplitPanesResult = ReturnType<typeof useSplitPanes>;