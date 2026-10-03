import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/*
 * fork:pr40-split (2026-10-03) —— 拖出成手势分屏的接线守卫。
 *
 * 这批断言全是**源码形状**级别的（同本目录其它 TabBar 测试的做法）：分屏的判定
 * 阈值、监听挂在哪一层、点击抑制这几处一旦被「顺手改一下」，退化是**静默**的
 * —— 拖不动、或者松手顺手把 tab 切走，都不会报错、不会崩，只会「像坏了」。
 */

const source = await readFile(new URL("./TabBar.tsx", import.meta.url), "utf8");
// 注释里会提到这些 API 名（「为什么不 setPointerCapture」），断言只看代码。
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => {
    const at = line.indexOf("//");
    return at === -1 ? line : line.slice(0, at);
  })
  .join("\n");

test("drag-out thresholds are Proma's pair: 12px out of the bar, 18px of travel", () => {
  // 两条必须**同时**满足：只满足其一就退化成误触（单条）或拖不动（另一条）。
  assert.match(source, /const TAB_DRAG_OUT_EXIT_PX = 12;/);
  assert.match(source, /const TAB_DRAG_OUT_TRAVEL_PX = 18;/);
  assert.match(
    source,
    /if \(dy < TAB_DRAG_OUT_EXIT_PX \|\| travel < TAB_DRAG_OUT_TRAVEL_PX\) return;/,
    "either threshold alone must be enough to keep the gesture a plain click",
  );
  assert.match(source, /Math\.hypot\(event\.clientX - drag\.startX, dy\)/);
});

test("the drag-out listeners live on window, not on the tab", () => {
  // 标签栏是 `overflow-x: hidden`：指针一旦向下移出去，元素级监听就收不到后续 move。
  // 反过来，全局监听就必须靠 pointerId 对账，否则多指/多钮会串。
  for (const type of ["pointermove", "pointerup", "pointercancel"]) {
    assert.match(code, new RegExp(`window\\.addEventListener\\("${type}"`), type);
    assert.match(code, new RegExp(`window\\.removeEventListener\\("${type}"`), `${type} cleanup`);
  }
  assert.match(code, /drag\.pointerId !== event\.pointerId/);
  // setPointerCapture 会把事件锁在 tab 上，右栏就拿不到真实指针位置了。
  assert.doesNotMatch(code, /setPointerCapture/);
});

test("nothing is reported before the gesture passes the threshold", () => {
  // 阈值之前每次 pointermove 都往返 React 的话，标签栏会被 micro-jitter 打成
  // 「一直在拖」：整条栏一直半透明。
  assert.match(source, /if \(drag\.dragging\) \{[\s\S]*?return;\n\s+\}/);
  assert.match(source, /drag\.dragging = true;\n\s+handleTabDragChange/);
});

test("a completed drag-out eats the click that follows it", () => {
  // 不吃掉的话：松手建好分屏，紧跟着的那次 click 又把 tab 切走一次。
  assert.match(source, /const suppressClickRef = useRef\(false\)/);
  assert.match(source, /suppressClickRef\.current = !cancelled/);
  assert.match(source, /onClick=\{\(\) => \{\n\s+if \(suppressClickRef\.current\) \{\n\s+suppressClickRef\.current = false;\n\s+return;/);
});

test("all six split props are optional and gate the whole gesture", () => {
  assert.match(source, /const dragOutEnabled = Boolean\(handleTabDragChange && handleTabDragDrop\)|const dragOutEnabled = Boolean\(handleTabDragChange && handleTabDrop\)/);
  assert.match(source, /if \(!dragOutEnabled\) return;/);
  // 不传任何一个分屏回调时，标签栏连指针监听都不挂 —— 单列路径零成本。
  assert.match(source, /handleTabDragChange\?: \(state: RightPanelTabDragState \| null\) => void;/);
  assert.match(source, /handleTabDrop\?: \(state: RightPanelTabDragState\) => void;/);
  assert.match(source, /endTabDrag\?: \(\) => void;/);
  assert.match(source, /isDraggingTab\?: boolean;/);
  assert.match(source, /isSplitActive\?: boolean;/);
  assert.match(source, /collapseSplit\?: \(\) => void;/);
});

test("the collapse control is a lucide icon button rendered whenever a split exists", () => {
  // 窄栏 / 手机下 `isSplitActive` 仍为真（画不出两格但分屏态还在）：不留这颗钮，
  // 分屏就变成一个用户看得见、却删不掉的幽灵态。
  assert.match(source, /\{isSplitActive && collapseSplit && \(/);
  assert.match(source, /data-split-collapse="true"/);
  assert.match(source, /<i data-ico="minimize-2" data-size=\{14\} aria-hidden="true"><\/i>/);
  assert.match(source, /onClick=\{\(\) => \{\n\s+collapseSplit\(\);\n\s+endTabDrag\?\.\(\);/);
});

test("dragging a tab out fades the whole bar", () => {
  assert.match(source, /opacity: isDraggingTab \? 0\.55 : 1/);
});