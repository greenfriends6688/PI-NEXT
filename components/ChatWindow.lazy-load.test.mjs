import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";

// 首屏仍按消息数画一段、空闲时翻倍补齐；但**读**有了上界：一次只取最近
// SESSION_WINDOW_ENTRIES 条 entry（11 MB 的转录整份取一次在手机上要好几秒），
// 更早的一页由「加载更早的消息」或滚到顶部向 /context 要。这个测试钉住两件事：
// 画法没有回到 IntersectionObserver，以及读取是有窗口的。
const source = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const lazyLoad = await import("../lib/chat-lazy-load.ts");

test("the transcript draws the tail first and doubles the window instead of paging", () => {
  assert.equal(lazyLoad.FIRST_PAINT_MESSAGES > 0, true);
  assert.equal(lazyLoad.IDLE_PAINT_STEP > 0, true);

  // Painting is still doubling on idle, not an IntersectionObserver sentinel.
  assert.doesNotMatch(source, /new IntersectionObserver/);
  assert.doesNotMatch(source, /getVisibleRenderWindow/);
  assert.doesNotMatch(source, /loadOlderPage/);

  // The read is windowed, and one explicit way to ask for the page above it.
  const hook = readFileSync(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  assert.match(hook, /tail: String\(SESSION_WINDOW_ENTRIES\)/);
  assert.match(source, /loadContext\(sessionId, activeLeafId, historyCursor, \{ tail: SESSION_WINDOW_ENTRIES \}\)/);
  assert.match(source, /t\("chat\.loadEarlier"\)/);

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
