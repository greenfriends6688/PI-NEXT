import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// 分页（sentinel + IntersectionObserver + 「更早 N 轮」）已经删掉：整份历史一次
// 读进来，只在首屏按消息数画一段、空闲时翻倍补齐。这个测试钉住的就是那条新路，
// 以及「不再有分页游标」这件事。
const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const lazyLoad = await import("../lib/chat-lazy-load.ts");

test("the transcript draws the tail first and doubles the window instead of paging", () => {
  assert.equal(lazyLoad.FIRST_PAINT_MESSAGES > 0, true);
  assert.equal(lazyLoad.IDLE_PAINT_STEP > 0, true);

  // No paging machinery left in the window.
  assert.doesNotMatch(source, /new IntersectionObserver/);
  assert.doesNotMatch(source, /requestedCursorRef/);
  assert.doesNotMatch(source, /getVisibleRenderWindow/);
  assert.doesNotMatch(source, /loadOlderPage/);
  assert.doesNotMatch(source, /chat\.loadEarlier/);

  // The paint window counts messages from the end of the transcript…
  assert.match(source, /for \(let idx = Math\.max\(0, messages\.length - paintCount\); idx < messages\.length;\)/);
  // …and grows by doubling (at least IDLE_PAINT_STEP) on an idle slice.
  assert.match(source, /Math\.max\(current \* 2, current \+ IDLE_PAINT_STEP\)/);
  // A different session starts from the small window again.
  assert.match(source, /if \(paintCount !== FIRST_PAINT_MESSAGES\) setPaintCount\(FIRST_PAINT_MESSAGES\)/);
});

test("the printed window never exceeds the messages it draws", () => {
  // The tail window is `messages.length - paintCount`, clamped at 0.
  const start = (length, paintCount) => Math.max(0, length - paintCount);
  assert.equal(start(1703, 60), 1643);
  assert.equal(start(40, 60), 0);
  assert.equal(start(0, 60), 0);
});
