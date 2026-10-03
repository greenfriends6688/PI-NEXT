import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  TAB_DRAG_ACTIVATION_PX,
  applyTabOrder,
  dropIndicatorX,
  dropIndexFromPointer,
  moveIntentFor,
  moveTabBefore,
} = await jiti.import("@/lib/tab-reorder");

/** 三个等宽 tab，x = 0 / 100 / 200，宽 100（无 gap，判定更直观）。 */
const rects = [
  { left: 0, width: 100 },
  { left: 100, width: 100 },
  { left: 200, width: 100 },
];

test("the drag threshold is a small one, not a gesture", () => {
  // 太大会让普通点击（手抖一下）变成拖拽，太小会在移动端变成误触。
  assert.ok(TAB_DRAG_ACTIVATION_PX > 0 && TAB_DRAG_ACTIVATION_PX <= 8);
});

test("the drop index is decided by the pointer against each tab's midline", () => {
  assert.equal(dropIndexFromPointer(0, rects), 0);
  assert.equal(dropIndexFromPointer(49, rects), 0, "left half of tab 0 stays before it");
  assert.equal(dropIndexFromPointer(50, rects), 1, "right half of tab 0 lands after it");
  assert.equal(dropIndexFromPointer(149, rects), 1);
  assert.equal(dropIndexFromPointer(150, rects), 2);
  assert.equal(dropIndexFromPointer(999, rects), 3, "past the last tab = append");
});

test("the drop index survives an empty or one-tab strip", () => {
  assert.equal(dropIndexFromPointer(120, []), 0);
  assert.equal(dropIndexFromPointer(-40, []), 0);
  assert.equal(dropIndexFromPointer(-40, [rects[0]]), 0);
  assert.equal(dropIndexFromPointer(60, [rects[0]]), 1, "past the only tab = append");
});

test("the indicator line sits on a tab boundary, or just past the last one", () => {
  assert.equal(dropIndicatorX(rects, 0), 0);
  assert.equal(dropIndicatorX(rects, 1), 100);
  assert.equal(dropIndicatorX(rects, 3), 300, "index === length = right edge of the last tab");
  assert.equal(dropIndicatorX(rects, -1), 0, "clamped");
  assert.equal(dropIndicatorX([], 0), 0);
});

test("moving right past a tab names the tab it now sits before", () => {
  assert.deepEqual(moveIntentFor(["a", "b", "c"], 0, 2), { changed: true, beforeId: "c" });
  assert.deepEqual(moveIntentFor(["a", "b", "c"], 0, 3), { changed: true, beforeId: null }, "past the end");
});

test("moving left names the tab it lands in front of", () => {
  assert.deepEqual(moveIntentFor(["a", "b", "c"], 2, 1), { changed: true, beforeId: "b" });
  assert.deepEqual(moveIntentFor(["a", "b", "c"], 2, 0), { changed: true, beforeId: "a" });
});

test("dropping where it already sits is a no-op, not a reorder", () => {
  // 自己前面 = 已经在那儿
  assert.deepEqual(moveIntentFor(["a", "b", "c"], 1, 1), { changed: false, beforeId: null });
  // 自己后面 = 也已经在那儿
  assert.deepEqual(moveIntentFor(["a", "b", "c"], 1, 2), { changed: false, beforeId: null });
  assert.deepEqual(moveIntentFor(["a", "b", "c"], 0, 0), { changed: false, beforeId: null });
  assert.deepEqual(moveIntentFor(["a", "b", "c"], 2, 3), { changed: false, beforeId: null });
});

test("a dragged tab that is not in the visible window reports no intent", () => {
  assert.deepEqual(moveIntentFor(["a", "b"], 5, 1), { changed: false, beforeId: null });
});

test("moveTabBefore lifts the tab out and reinserts it", () => {
  assert.deepEqual(moveTabBefore(["a", "b", "c"], "a", "c"), ["b", "a", "c"]);
  assert.deepEqual(moveTabBefore(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
  assert.deepEqual(moveTabBefore(["a", "b", "c"], "a", null), ["b", "c", "a"]);
  // 自己不能当自己的前驱：退化成末尾，而不是把自己删掉。
  assert.deepEqual(moveTabBefore(["a", "b", "c"], "b", "b"), ["a", "c", "b"]);
  // 不在顺序里的 tab（刚开的）按 beforeId 插入。
  assert.deepEqual(moveTabBefore(["a", "b"], "new", "a"), ["new", "a", "b"]);
  // 目标不存在 → 末尾。
  assert.deepEqual(moveTabBefore(["a", "b"], "a", "ghost"), ["b", "a"]);
  assert.deepEqual(moveTabBefore(["a"], "a", null), ["a"]);
});

test("applyTabOrder only reorders when the user has dragged", () => {
  const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(applyTabOrder(tabs, null).map((t) => t.id), ["a", "b", "c"]);
  assert.deepEqual(applyTabOrder(tabs, []).map((t) => t.id), ["a", "b", "c"]);
  assert.deepEqual(applyTabOrder(tabs, ["c", "b", "a"]).map((t) => t.id), ["c", "b", "a"]);
});

test("tabs opened after the drag go to the end, and closed ids are simply ignored", () => {
  const tabs = [{ id: "a" }, { id: "new" }, { id: "c" }];
  // 顺序表只含旧 tab（关掉过的那几个 id 留着也无害：applyTabOrder 只看还开着的）
  assert.deepEqual(applyTabOrder(tabs, ["c", "gone", "a"]).map((t) => t.id), ["c", "a", "new"]);
  // 没有出现在顺序表里的，保持彼此的相对次序并追加到末尾
  assert.deepEqual(applyTabOrder([{ id: "x" }, { id: "y" }], ["y"]).map((t) => t.id), ["y", "x"]);
});

test("applyTabOrder ignores duplicate ids in the order list", () => {
  assert.deepEqual(applyTabOrder([{ id: "a" }, { id: "b" }], ["b", "b", "a"]).map((t) => t.id), ["b", "a"]);
});