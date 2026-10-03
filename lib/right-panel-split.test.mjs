import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const {
  SPLIT_PANEL_MIN_WIDTH,
  SPLIT_PANE_MIN_WIDTH,
  SPLIT_RATIO_DEFAULT,
  clampSplitRatio,
  clampSplitRatioForWidth,
  collapseRightPanelSplit,
  commitRightPanelWidth,
  createRightPanelSplit,
  createRightPanelWidthMemory,
  focusedRightPanelTabId,
  getSplitPaneWidths,
  groupRightPanelSplitTabs,
  markWideWorkspaceOpened,
  placeRightPanelSplitTab,
  resolveRightPanelWidth,
  resolveSplitDropPane,
  sanitizeRightPanelSplit,
  selectRightPanelSplitTab,
  supportsSplitPanel,
} = await jiti.import("./right-panel-split.ts");

const split = (overrides = {}) => ({
  leftTabId: "a",
  rightTabId: "b",
  focusedPane: "left",
  ratio: 0.5,
  ...overrides,
});

test("窄栏门槛 = Proma 的 720，且算术底线 320×2+8 也在下面", () => {
  assert.equal(SPLIT_PANEL_MIN_WIDTH, 720);
  assert.equal(SPLIT_PANE_MIN_WIDTH, 320);
  // 720 时每个 Pane ≈356px，比 320 的硬底线多 72px 余量。
  assert.equal(SPLIT_PANEL_MIN_WIDTH - 8, 712);
  assert.ok((SPLIT_PANEL_MIN_WIDTH - 8) / 2 > SPLIT_PANE_MIN_WIDTH);
  assert.equal(supportsSplitPanel(719), false);
  assert.equal(supportsSplitPanel(720), true);
  assert.equal(supportsSplitPanel(800), true);
  assert.equal(supportsSplitPanel(Number.NaN), false);
});

test("比例夹紧：绝对档 [0.3, 0.7]，非有限值一律回中位", () => {
  assert.equal(clampSplitRatio(0.1), 0.3);
  assert.equal(clampSplitRatio(0.9), 0.7);
  assert.equal(clampSplitRatio(0.42), 0.42);
  // NaN / ±Infinity 都归到 0.5：比例算不出来时宁可对半分，也不要偏向某一侧。
  assert.equal(clampSplitRatio(Number.NaN), SPLIT_RATIO_DEFAULT);
  assert.equal(clampSplitRatio(Number.POSITIVE_INFINITY), SPLIT_RATIO_DEFAULT);
});

test("按宽度夹比例：每个 Pane 至少 320（内容区 = 总宽 − 8 分隔条）", () => {
  // 1288 内容区 → 320/1288 ≈ 0.248，落到 [0.3, 0.7] 的 0.3 那一档。
  assert.equal(clampSplitRatioForWidth(0.05, 1296), 0.3);
  // 800 内容区 → 320/800 = 0.4，左右都不能低于 0.4。
  assert.equal(clampSplitRatioForWidth(0.1, 808), 0.4);
  assert.equal(clampSplitRatioForWidth(0.5, 808), 0.5);
  assert.equal(clampSplitRatioForWidth(0.95, 808), 0.6);
  // 面板比「两个 320 + 分隔条」还窄时，两个下限之和 > 1：取 0.5 对半分。
  assert.equal(clampSplitRatioForWidth(0.1, 400), 0.5);
  assert.equal(clampSplitRatioForWidth(0.9, 400), 0.5);
  // 宽度读不出来（SSR / 面板未挂载）时给中位，不给 0。
  assert.equal(clampSplitRatioForWidth(0.9, 8), 0.5);
});

test("比例 → 像素宽：两个 Pane 加起来正好是内容区", () => {
  assert.deepEqual(getSplitPaneWidths(720, 0.5), { left: 356, divider: 8, right: 356 });
  // 0.25 先被绝对下限抬到 0.3（两个 Pane 都要留 320）。
  const widths = getSplitPaneWidths(1296, 0.25);
  assert.equal(widths.left, 386);
  assert.equal(widths.left + widths.divider + widths.right, 1296);
});

test("拖出落点：面板矩形内按中线分左右，矩形外不接受", () => {
  const rect = { top: 100, bottom: 500, left: 1000, right: 1400 };
  assert.equal(resolveSplitDropPane(rect, 1100, 300), "left");
  assert.equal(resolveSplitDropPane(rect, 1399, 300), "right");
  // 中线正好落在分界上：算右边（和 Proma 的 `x < left + width/2` 一致）。
  assert.equal(resolveSplitDropPane(rect, 1200, 300), "right");
  assert.equal(resolveSplitDropPane(rect, 1199, 300), "left");
  // 矩形外（拖到侧栏 / 顶栏）一律 null，AppShell 于是原样保持单栏。
  assert.equal(resolveSplitDropPane(rect, 900, 300), null);
  assert.equal(resolveSplitDropPane(rect, 1200, 40), null);
  assert.equal(resolveSplitDropPane(rect, 1200, 600), null);
  assert.equal(resolveSplitDropPane(rect, Number.NaN, 300), null);
});

test("拖出建分屏：拖的是当前 tab 就不建；落哪侧决定谁在左", () => {
  assert.equal(createRightPanelSplit("a", "a", "right"), null);
  assert.equal(createRightPanelSplit("a", "", "right"), null);
  const left = createRightPanelSplit("a", "b", "left", 0.8);
  assert.deepEqual(left, { leftTabId: "b", rightTabId: "a", focusedPane: "left", ratio: 0.7 });
  const right = createRightPanelSplit("a", "b", "right", 0.2);
  assert.deepEqual(right, { leftTabId: "a", rightTabId: "b", focusedPane: "right", ratio: 0.3 });
});

test("把 tab 换到另一侧 = 两边内容对调，焦点跟着去", () => {
  // 已在另一侧 = 两边内容对调（Proma `placeRightWorkspaceSplitTab` 同款）。
  assert.deepEqual(
    placeRightPanelSplitTab(split(), "a", "right"),
    { leftTabId: "b", rightTabId: "a", focusedPane: "right", ratio: 0.5 },
  );
  // 已经在目标侧 = 只换焦点，不动内容。
  assert.deepEqual(
    placeRightPanelSplitTab(split(), "b", "right"),
    { leftTabId: "a", rightTabId: "b", focusedPane: "right", ratio: 0.5 },
  );
  // 不在分屏里的 tab：落进目标侧。
  assert.deepEqual(
    placeRightPanelSplitTab(split(), "c", "right"),
    { leftTabId: "a", rightTabId: "c", focusedPane: "right", ratio: 0.5 },
  );
});

test("顶栏点选：已分屏的 tab 只换焦点；别的 tab 替换焦点那一侧", () => {
  const focusedLeft = split();
  assert.deepEqual(selectRightPanelSplitTab(focusedLeft, "b"), split({ focusedPane: "right" }));
  assert.deepEqual(selectRightPanelSplitTab(focusedLeft, "c"), split({ leftTabId: "c" }));
  assert.deepEqual(
    selectRightPanelSplitTab(split({ focusedPane: "right" }), "c"),
    split({ focusedPane: "right", rightTabId: "c" }),
  );
});

test("退分屏留下焦点那一侧", () => {
  assert.equal(collapseRightPanelSplit(split()), "a");
  assert.equal(collapseRightPanelSplit(split({ focusedPane: "right" })), "b");
  assert.equal(focusedRightPanelTabId(split({ focusedPane: "right" })), "b");
});

test("tab 关掉后能修就修，只剩一个才退回单列（内容不丢）", () => {
  // 右 pane 的 tab 关了：换成另一个还开着的，激活项跟着换。
  const repaired = sanitizeRightPanelSplit(split(), ["a", "c"]);
  assert.equal(repaired.split.rightTabId, "c");
  assert.equal(repaired.split.leftTabId, "a");
  assert.equal(repaired.activeTabId, "a");
  // 焦点在右 pane 时，右 pane 换了内容，激活项必须跟着右 pane。
  const repairedFocused = sanitizeRightPanelSplit(split({ focusedPane: "right" }), ["a", "c"]);
  assert.equal(repairedFocused.activeTabId, "c");
  // 两个都还开着：原样返回（引用相等，调用方因此不会重渲染）。
  const intact = split();
  assert.equal(sanitizeRightPanelSplit(intact, ["a", "b"]).split, intact);
  // 只剩一个 tab：退回单列，激活它。
  const collapsed = sanitizeRightPanelSplit(split(), ["a"]);
  assert.equal(collapsed.split, null);
  assert.equal(collapsed.activeTabId, "a");
  // 一个都不剩（面板被清空）：激活项留空，不硬造一个 tab。
  assert.deepEqual(sanitizeRightPanelSplit(split(), []), { split: null, activeTabId: "" });
});

test("顶栏排序：分屏的两个 tab 排到相邻，其余顺序不动", () => {
  const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
  // b 与 d 原本隔着 c：把这一对抽出来插到 b 的位置，其余相对顺序不动。
  assert.deepEqual(groupRightPanelSplitTabs(tabs, "b", "d").map((t) => t.id), ["a", "b", "d", "c", "e"]);
  // 本来就相邻：原样返回。
  assert.deepEqual(groupRightPanelSplitTabs(tabs, "c", "d").map((t) => t.id), ["a", "b", "c", "d", "e"]);
  // 分屏的 tab 都被关掉了：原序返回，不动用户的标签栏。
  assert.deepEqual(groupRightPanelSplitTabs(tabs, "x", "y").map((t) => t.id), ["a", "b", "c", "d", "e"]);
});

test("宽度记忆：分屏借用宽布局，普通宽度一点没动", () => {
  const memory = createRightPanelWidthMemory({ ordinaryWidth: 480 });
  assert.deepEqual(memory, { ordinaryWidth: 480, wideWidth: 480, hasOpenedWideWorkspace: false });

  // 进入分屏：顶到**分屏下限** 720（这正是 720 门槛的用处），
  // 但被借用的只是「宽工作区宽度」，普通宽度仍是 480。
  const splitting = resolveRightPanelWidth({
    memory,
    splitActive: true,
    minimumWidth: 300,
    maximumWidth: 1200,
  });
  assert.deepEqual(splitting, { width: 720, ordinaryWidth: 480, wideWidth: 720 });
  // 普通宽度解析出来还是 480：分屏那 720 的下限没有被写回去。
  const ordinary = resolveRightPanelWidth({
    memory,
    splitActive: false,
    minimumWidth: 300,
    maximumWidth: 1200,
  });
  assert.equal(ordinary.width, 480);

  // 面板窄到连下限都撑不住时，宽度被上限截断（`supportsSplitPanel` 随之判 false）。
  const cramped = resolveRightPanelWidth({
    memory: createRightPanelWidthMemory({ ordinaryWidth: 900 }),
    splitActive: true,
    minimumWidth: 300,
    maximumWidth: 600,
  });
  assert.equal(cramped.width, 600);
  assert.equal(cramped.ordinaryWidth, 600, "普通宽度照夹自己的下限/上限，不受分屏下限影响");
});

test("用户拖右边框：分屏期间记进宽工作区宽度，退分屏后普通宽度照旧", () => {
  const memory = createRightPanelWidthMemory({ ordinaryWidth: 480 });
  const draggedWide = commitRightPanelWidth({ memory, width: 900, splitActive: true });
  assert.equal(draggedWide.wideWidth, 900);
  assert.equal(draggedWide.ordinaryWidth, 480, "分屏时拖边框不得改普通宽度");
  assert.equal(draggedWide.hasOpenedWideWorkspace, true);

  const back = resolveRightPanelWidth({
    memory: draggedWide,
    splitActive: false,
    minimumWidth: 300,
    maximumWidth: 1200,
  });
  assert.equal(back.width, 480, "退分屏后回到用户自己拖出来的普通宽度");

  const draggedOrdinary = commitRightPanelWidth({ memory, width: 520, splitActive: false });
  assert.equal(draggedOrdinary.ordinaryWidth, 520);
  assert.equal(draggedOrdinary.wideWidth, 480, "单栏拖动不得改宽工作区宽度");
});

test("宽布局标记幂等", () => {
  const memory = createRightPanelWidthMemory({ ordinaryWidth: 480 });
  const once = markWideWorkspaceOpened(memory);
  assert.equal(once.hasOpenedWideWorkspace, true);
  assert.equal(markWideWorkspaceOpened(once), once);
});