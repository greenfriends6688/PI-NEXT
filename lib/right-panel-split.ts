/**
 * fork:pr40-split — 右栏双 Pane 分屏的**纯逻辑**（宽度口径 / 比例 clamp / 落点解析 /
 * 分屏态的增删改）。这一层不碰 React、不碰 DOM，所以能直接单测。
 *
 * 参照 Proma（`apps/electron/src/renderer/lib/right-workspace-split.ts` +
 * `components/app-shell/right-panel-layout.ts`），但有两处按 pi-web 自己的形状改：
 *
 * 1. Proma 的 pane 里装的是「能力 tab」枚举，这里装的是**任意 tab id**（文件 / 终端 /
 *    浏览器 / 图谱 / 改动 / 轨迹 / 探索分支），所以一切按字符串 id 走。
 * 2. Proma 把两套宽度记在 `RightWorkspaceSplitState` 旁边的 atom map；这里把「普通宽度 /
 *    宽工作区宽度」拆成一个独立的 `RightPanelWidthMemory`，因为 pi-web 的右栏宽度由
 *    `useResizablePanel` 持有（它自己写 localStorage），分屏只能在旁边**借用**一份宽布局，
 *    绝不能把分屏下限当成普通宽度写回去。
 */

/** 单个 Pane 的内容宽度下限。Proma `clampRightWorkspaceSplitRatioForWidth` 的默认值。 */
export const SPLIT_PANE_MIN_WIDTH = 320;

/** 中间分隔条的占位宽度。Proma `clampRightWorkspaceSplitRatioForWidth` 的默认值。 */
export const SPLIT_DIVIDER_WIDTH = 8;

/**
 * 右栏**低于**这个宽度就退回单列。
 *
 * 依据：Proma `AppShell.tsx` 的 `MIN_SPLIT_PANEL_WIDTH = 720`，注释写的是
 * 「两个 Pane 需要各自保留约 320px 内容区及中间分隔条」。算术底线其实是
 * `320 + 8 + 320 = 648`；Proma 多留了 72px 余量 —— 720 时每个 Pane ≈356px，
 * 文件树 / diff 行还能读。两个都挤到 320 的观感是「两个都没法用」，所以照 720。
 */
export const SPLIT_PANEL_MIN_WIDTH = 720;

/** 比例的绝对上下限（即使面板极宽也不让一个 Pane 吃掉整条）。Proma 同值。 */
export const SPLIT_RATIO_MIN = 0.3;
export const SPLIT_RATIO_MAX = 0.7;
export const SPLIT_RATIO_DEFAULT = 0.5;

export type RightPanelPane = "left" | "right";

/** TabBar 在「拖出中」时上报的落点载荷（与 Proma 的 `RightWorkspaceTabDragState` 同形）。 */
export interface RightPanelTabDragState {
  tabId: string;
  clientX: number;
  clientY: number;
}

export interface RightPanelSplitState {
  /** 左 Pane 的 tab id。 */
  leftTabId: string;
  /** 右 Pane 的 tab id。 */
  rightTabId: string;
  /** 键盘焦点 / 顶栏选中态跟着哪个 Pane 走。 */
  focusedPane: RightPanelPane;
  /** 左 Pane 占**内容区**（不含分隔条）的比例。 */
  ratio: number;
}

export interface RightPanelWidthMemory {
  /** 普通（单栏）宽度：用户拖右边框拖出来的那一个。 */
  ordinaryWidth: number;
  /** 宽工作区宽度：分屏期间借用的那一个（退出分屏后普通宽度原样回来）。 */
  wideWidth: number;
  /** 一旦用过宽布局（分屏、或宽 tab），普通宽度就该让位给宽布局。 */
  hasOpenedWideWorkspace: boolean;
}

export interface SplitPaneWidths {
  left: number;
  divider: number;
  right: number;
}

export interface SplitDropRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** 默认比例夹紧：非有限值退回 0.5，其余夹进 [0.3, 0.7]。 */
export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return SPLIT_RATIO_DEFAULT;
  return Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, ratio));
}

/**
 * 按**当前面板宽度**再夹一次：每个 Pane 至少留 `paneMinWidth`。
 *
 * Proma 同名函数 `clampRightWorkspaceSplitRatioForWidth`：
 * `minRatio = min(0.5, max(0.3, paneMinWidth / contentWidth))`，再夹进 `[minRatio, 1-minRatio]`。
 */
export function clampSplitRatioForWidth(
  ratio: number,
  totalWidth: number,
  paneMinWidth: number = SPLIT_PANE_MIN_WIDTH,
  dividerWidth: number = SPLIT_DIVIDER_WIDTH,
): number {
  const contentWidth = Math.max(0, totalWidth - dividerWidth);
  if (contentWidth === 0) return SPLIT_RATIO_DEFAULT;
  const minRatio = Math.min(0.5, Math.max(SPLIT_RATIO_MIN, paneMinWidth / contentWidth));
  return Math.max(minRatio, Math.min(1 - minRatio, clampSplitRatio(ratio)));
}

/** 右栏够不够宽放两个 Pane。低于门槛一律单列（内容保留，不拆成两半）。 */
export function supportsSplitPanel(
  panelWidth: number,
  minimum: number = SPLIT_PANEL_MIN_WIDTH,
): boolean {
  return Number.isFinite(panelWidth) && panelWidth >= minimum;
}

/** 比例 → 两个 Pane 的像素宽（纯换算，给单测与 aria-valuetext 用）。 */
export function getSplitPaneWidths(
  totalWidth: number,
  ratio: number,
  dividerWidth: number = SPLIT_DIVIDER_WIDTH,
): SplitPaneWidths {
  const contentWidth = Math.max(0, totalWidth - dividerWidth);
  const left = Math.round(contentWidth * clampSplitRatio(ratio));
  return { left, divider: dividerWidth, right: Math.max(0, contentWidth - left) };
}

/** 两个 Pane 的 tab 落在哪一侧：内容区中线左 / 右。落在矩形外 = 不接受这次拖拽。 */
export function resolveSplitDropPane(
  rect: SplitDropRect,
  clientX: number,
  clientY: number,
): RightPanelPane | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  if (clientY < rect.top || clientY > rect.bottom) return null;
  if (clientX < rect.left || clientX > rect.right) return null;
  return clientX < rect.left + (rect.right - rect.left) / 2 ? "left" : "right";
}

/** 拖出的 tab 与当前 tab 相同 / 为空时不建分屏。 */
export function createRightPanelSplit(
  activeTabId: string,
  draggedTabId: string,
  pane: RightPanelPane,
  ratio: number = SPLIT_RATIO_DEFAULT,
): RightPanelSplitState | null {
  if (!activeTabId || !draggedTabId || activeTabId === draggedTabId) return null;
  return {
    leftTabId: pane === "left" ? draggedTabId : activeTabId,
    rightTabId: pane === "right" ? draggedTabId : activeTabId,
    focusedPane: pane,
    ratio: clampSplitRatio(ratio),
  };
}

/** 把一个已在分屏里的 tab 换到另一侧（换边 = 两边内容对调，焦点跟着去）。 */
export function placeRightPanelSplitTab(
  split: RightPanelSplitState,
  tabId: string,
  pane: RightPanelPane,
): RightPanelSplitState {
  if (split.leftTabId === split.rightTabId) return split;
  const currentPane: RightPanelPane | null = split.leftTabId === tabId
    ? "left"
    : split.rightTabId === tabId
      ? "right"
      : null;
  if (currentPane === pane) return { ...split, focusedPane: pane };
  if (currentPane !== null) {
    return {
      ...split,
      leftTabId: split.rightTabId,
      rightTabId: split.leftTabId,
      focusedPane: pane,
    };
  }
  return pane === "left"
    ? { ...split, leftTabId: tabId, focusedPane: pane }
    : { ...split, rightTabId: tabId, focusedPane: pane };
}

export function focusedRightPanelTabId(split: RightPanelSplitState): string {
  return split.focusedPane === "left" ? split.leftTabId : split.rightTabId;
}

/**
 * 顶栏点选某个 tab：本来就是某个 Pane 的内容就只换焦点，否则**替换焦点那一侧**的内容。
 * 与 Proma `selectRightWorkspaceSplitTab` 同口径。
 */
export function selectRightPanelSplitTab(
  split: RightPanelSplitState,
  tabId: string,
): RightPanelSplitState {
  if (split.leftTabId === tabId) return { ...split, focusedPane: "left" };
  if (split.rightTabId === tabId) return { ...split, focusedPane: "right" };
  return split.focusedPane === "left"
    ? { ...split, leftTabId: tabId }
    : { ...split, rightTabId: tabId };
}

/** 退分屏时留下哪一侧：焦点那一侧（Proma `collapseRightWorkspaceSplit`）。 */
export function collapseRightPanelSplit(split: RightPanelSplitState): string {
  return focusedRightPanelTabId(split);
}

export interface RightPanelSplitResolution {
  split: RightPanelSplitState | null;
  activeTabId: string;
}

/**
 * 校验分屏态引用的 tab 是否还开着；关掉一个就退分屏（内容落到留下的那个 tab）。
 * **不丢内容**：能修就修（换一个还开着的 tab），只有一个 tab 时才整体退回单列。
 */
export function sanitizeRightPanelSplit(
  split: RightPanelSplitState,
  availableTabIds: readonly string[],
): RightPanelSplitResolution {
  const available = new Set(availableTabIds);
  const hasLeft = available.has(split.leftTabId);
  const hasRight = available.has(split.rightTabId);
  if (hasLeft && hasRight && split.leftTabId !== split.rightTabId) {
    return { split, activeTabId: focusedRightPanelTabId(split) };
  }
  const fallback = hasLeft ? split.leftTabId : hasRight ? split.rightTabId : availableTabIds[0] ?? "";
  const other = availableTabIds.find((id) => id !== fallback);
  if (other === undefined) return { split: null, activeTabId: fallback };
  const repaired: RightPanelSplitState = hasLeft
    ? { ...split, rightTabId: other }
    : hasRight
      ? { ...split, leftTabId: other }
      : { ...split, leftTabId: fallback, rightTabId: other };
  return { split: repaired, activeTabId: focusedRightPanelTabId(repaired) };
}

/** 顶栏 tab 排序：分屏的两个 tab 排到相邻位置（Proma `groupRightWorkspaceTabs`）。 */
export function groupRightPanelSplitTabs<T extends { id: string }>(
  tabs: readonly T[],
  leftTabId: string | null,
  rightTabId: string | null,
): T[] {
  if (!leftTabId || !rightTabId) return [...tabs];
  const groupedIds = new Set([leftTabId, rightTabId]);
  const firstGroupIndex = tabs.findIndex((tab) => groupedIds.has(tab.id));
  if (firstGroupIndex < 0) return [...tabs];
  const group = [leftTabId, rightTabId]
    .map((id) => tabs.find((tab) => tab.id === id))
    .filter((tab): tab is T => tab !== undefined);
  const remaining = tabs.filter((tab) => !groupedIds.has(tab.id));
  remaining.splice(Math.min(firstGroupIndex, remaining.length), 0, ...group);
  return remaining;
}

/* ---------------------------------------------------------------------------
 * 「普通宽度 / 分屏宽度」两套值
 * ------------------------------------------------------------------------- */

/**
 * 造一份宽度记忆。`wideWidth` 的种子是**普通宽度**而不是 720：
 * 进入分屏时把普通宽度原样顶上去，用户拖宽工作区后它才变宽，
 * 退分屏时普通宽度一点没动 —— 这就是 Proma `ordinaryRightPanelMinimumWidth`
 * 那条口径的落点。
 */
export function createRightPanelWidthMemory(seed: {
  ordinaryWidth: number;
  wideWidth?: number;
  hasOpenedWideWorkspace?: boolean;
}): RightPanelWidthMemory {
  return {
    ordinaryWidth: seed.ordinaryWidth,
    wideWidth: seed.wideWidth ?? seed.ordinaryWidth,
    hasOpenedWideWorkspace: seed.hasOpenedWideWorkspace ?? false,
  };
}

/**
 * 解析本次该显示多宽。
 *
 * - `splitActive` 为假 → 显示普通宽度（夹在普通下限 / 上限之间）。
 * - `splitActive` 为真 → 显示宽工作区宽度，**下限换成 `SPLIT_PANEL_MIN_WIDTH`，
 *   但这个下限绝不回写 `ordinaryWidth`**（Proma 的同名口径）。
 * - 窗口撑不下时上限先塌（`getRightPanelMaxWidth` 已经算过），此时
 *   `supportsSplitPanel` 会判 false 退回单列，所以这里 clamp 出来的窄值只是过渡态。
 */
export function resolveRightPanelWidth(options: {
  memory: RightPanelWidthMemory;
  splitActive: boolean;
  minimumWidth: number;
  maximumWidth: number;
  splitMinimumWidth?: number;
}): { width: number; ordinaryWidth: number; wideWidth: number } {
  const {
    memory,
    splitActive,
    minimumWidth,
    maximumWidth,
    splitMinimumWidth = SPLIT_PANEL_MIN_WIDTH,
  } = options;
  const maximum = Math.max(0, maximumWidth);
  const clamp = (value: number, minimum: number) => {
    const lower = Math.max(0, Math.min(minimum, maximum));
    return Math.round(Math.max(lower, Math.min(maximum, value)));
  };
  const ordinaryWidth = clamp(memory.ordinaryWidth, minimumWidth);
  if (!splitActive) {
    return { width: ordinaryWidth, ordinaryWidth, wideWidth: memory.wideWidth };
  }
  const wideWidth = clamp(Math.max(memory.wideWidth, ordinaryWidth), splitMinimumWidth);
  return { width: wideWidth, ordinaryWidth, wideWidth };
}

/** 用户拖右边框：分屏期间算宽工作区宽度，否则算普通宽度。 */
export function commitRightPanelWidth(options: {
  memory: RightPanelWidthMemory;
  width: number;
  splitActive: boolean;
}): RightPanelWidthMemory {
  const { memory, width, splitActive } = options;
  if (!Number.isFinite(width)) return memory;
  if (splitActive) return { ...memory, wideWidth: width, hasOpenedWideWorkspace: true };
  return { ...memory, ordinaryWidth: width };
}

/** 分屏刚刚建立（此前没用过宽布局）→ 普通宽度要让位。 */
export function markWideWorkspaceOpened(memory: RightPanelWidthMemory): RightPanelWidthMemory {
  return memory.hasOpenedWideWorkspace ? memory : { ...memory, hasOpenedWideWorkspace: true };
}