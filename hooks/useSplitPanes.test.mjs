import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/*
 * fork:pr40-split —— 接线层的**契约**测试。
 *
 * `lib/right-panel-split.ts` 里的比例 / 宽度算法是纯函数，在那边单测；
 * 这里钉的是几条「写在 hook 里、改起来很容易悄悄破掉」的行为：
 *   1. 宽度只经 `setWidth(width)`（默认不落盘）推给 `useResizablePanel`，
 *      分屏的 720 下限绝不能进 `pi-right-panel-width`；
 *   2. 分隔条拖拽是 rAF 节流 + **最新坐标 ref**，不是调度时捕获事件；
 *   3. 松手补一次 final flush（落点停在光标实际位置）；
 *   4. 切会话取消在飞的拖拽，且比例写回**拖拽开始时**那个会话槽；
 *   5. 窄栏 / 手机退回单列的分界线。
 */
const source = await readFile(new URL("./useSplitPanes.ts", import.meta.url), "utf8");

test("宽度只经 setWidth 推给 resizer，且不带 persist", () => {
  assert.match(source, /resizerRef\.current\.setWidth\(resolved\.width\);/);
  assert.doesNotMatch(source, /setWidth\([^)]*,\s*true\s*\)/);
  // 落盘全走 `lib/right-panel-split-memory`（普通宽度那份键归 useResizablePanel 管）。
  assert.doesNotMatch(source, /window\.localStorage/);
});

test("拖右边框时记进该记的那一套宽度（分屏中 = 宽工作区宽度）", () => {
  assert.match(
    source,
    /commitRightPanelWidth\(\{\s*memory: memoryNow,\s*width,\s*splitActive: isSplitActive,/,
  );
  // 提交用的槽是**拖拽开始时**那个，不是收尾时的当前槽。
  assert.match(source, /wasResizingRef\.current \?\?= \{ slot: sessionSlot \};/);
  assert.match(source, /\[started\.slot\]: merged/);
});

test("分隔条拖拽：rAF 节流，且坐标在回调里现取", () => {
  // pointermove 只存坐标 + 调度，绝不在这里算比例。
  assert.match(source, /drag\.latestClientX = event\.clientX;\s*\n\s*scheduleDividerApply\(\);/);
  // apply 读的是 drag 上的最新坐标（不是调度时捕获的事件对象）。
  assert.match(
    source,
    /drag\.originRatio \+ \(\(drag\.latestClientX - drag\.startX\) \/ drag\.width\)/,
  );
  assert.match(source, /drag\.frame = window\.requestAnimationFrame\(\(\) => \{/);
});

test("松手补一次 final flush，落点停在光标实际位置", () => {
  assert.match(
    source,
    /onDividerPointerUp[\s\S]*?drag\.latestClientX = event\.clientX;[\s\S]*?cancelAnimationFrame[\s\S]*?applyDividerDrag\(\);[\s\S]*?cancelDividerDrag\(\);/,
  );
});

test("切会话取消在飞的分屏拖拽，比例写回拖拽开始时的槽", () => {
  assert.match(
    source,
    /useEffect\(\(\) => \{\s*endTabDrag\(\);\s*cancelDividerDrag\(\);\s*\}, \[cancelDividerDrag, endTabDrag, sessionSlot\]\);/,
  );
  assert.match(source, /slot: sessionSlot,/);
  assert.match(source, /saveSplitRatio\(drag\.slot, drag\.ratio\);/);
});

test("窄栏 / 手机退回单列：分界线是 720 与 useIsMobile", () => {
  assert.match(source, /const splitAvailable = !isMobile && supportsSplitPanel\(resizer\.width, splitMinimumWidth\);/);
  assert.match(source, /const isSplitActive = split !== null && splitAvailable;/);
  // 退回单列时渲染焦点那一侧，而不是空面板。
  assert.match(source, /singlePaneTabId: split && !isSplitActive \? collapseRightPanelSplit\(split\) : activeTabId,/);
});

test("tab 拖出的落点解析按面板矩形，窄栏时直接不接", () => {
  assert.match(source, /if \(!splitAvailable\) return null;/);
  assert.match(source, /resolveSplitDropPane\(container\.getBoundingClientRect\(\), state\.clientX, state\.clientY\)/);
});