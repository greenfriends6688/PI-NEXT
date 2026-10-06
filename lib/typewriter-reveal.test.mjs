import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  createTypewriter,
  revealStep,
  safeRevealCut,
  BASE_STEP_CHARS,
  CATCHUP_BACKLOG,
  MAX_STEP_CHARS,
  QUIET_FLUSH_MS,
  FRAME_MS,
} = await jiti.import("./typewriter-reveal.ts");

test("safeRevealCut: 闭合的标记不动切点", () => {
  const text = "**粗体** 与 `code` 与 [链接](http://x) 都写完了";
  assert.equal(safeRevealCut(text, text.length), text.length);
});

test("safeRevealCut: 未闭合的强调回退到开标记之前（不闪出 **）", () => {
  const text = "前面写完了，现在开始加**粗";
  const cut = safeRevealCut(text, text.length);
  assert.equal(cut, "前面写完了，现在开始加".length);
});

test("safeRevealCut: 未闭合的行内代码 / 链接同样回退", () => {
  assert.equal(safeRevealCut("看这个 `snip", 12), "看这个 ".length);
  assert.equal(safeRevealCut("引用 [文档", 9), "引用 ".length);
});

test("safeRevealCut: ** 是一个标记不是两个（**bold 已闭合就不回退）", () => {
  const text = "**bold**";
  assert.equal(safeRevealCut(text, text.length), text.length);
});

test("safeRevealCut: 不劈开代理对", () => {
  const text = "看这个 🎯 目标"; // 🎯 占两个 UTF-16 单元
  assert.equal(safeRevealCut(text, 5), 4); // 5 会落在代理对中间 → 回退到 4
  assert.equal(text.slice(0, safeRevealCut(text, 5)), "看这个 ");
  assert.equal(safeRevealCut(text, text.length), text.length); // 整段收尾时不回退
});

test("safeRevealCut: 回退上限之内才让位，太严就直接放行（不冻住）", () => {
  const text = `a_b_c${"x".repeat(200)}`; // 落单的 `_` 后面积累了长文本
  assert.equal(safeRevealCut(text, text.length), text.length);
});

test("safeRevealCut: target 夹取到 [0, len]，不是负数就是超长", () => {
  assert.equal(safeRevealCut("abc", -5), 0);
  assert.equal(safeRevealCut("abc", 99), 3);
});

test("revealStep: 无积压时恒定打字机速度，大积压时全速追", () => {
  assert.equal(revealStep(0), 0);
  assert.equal(revealStep(-3), 0);
  assert.equal(revealStep(1), BASE_STEP_CHARS);
  assert.equal(revealStep(BASE_STEP_CHARS), BASE_STEP_CHARS);
  // 积压超过阈值 = 明显落后 → 直接给上限，不做「越追越慢」的渐近收尾
  assert.equal(revealStep(CATCHUP_BACKLOG + 1), MAX_STEP_CHARS);
  assert.equal(revealStep(400), MAX_STEP_CHARS);
  // 阈值以内：步长上界 48，且不低于最小打字机步长
  for (const pending of [1, 7, CATCHUP_BACKLOG]) {
    const step = revealStep(pending);
    assert.ok(step >= BASE_STEP_CHARS && step <= MAX_STEP_CHARS, `pending=${pending} step=${step}`);
  }
});

/** 假时钟：interval 与 timeout 共用一个按时间排序的队列，推进是确定性的。 */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const jobs = new Map();
  return {
    setIntervalFn: (handler, ms) => {
      const id = ++seq;
      jobs.set(id, { handler, at: now + ms, every: ms });
      return id;
    },
    clearIntervalFn: (handle) => jobs.delete(handle),
    setTimeoutFn: (handler, ms) => {
      const id = ++seq;
      jobs.set(id, { handler, at: now + ms, every: null });
      return id;
    },
    clearTimeoutFn: (handle) => jobs.delete(handle),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let pick = null;
        for (const [id, job] of jobs) {
          if (job.at > end) continue;
          if (pick === null || job.at < jobs.get(pick).at) pick = id;
        }
        if (pick === null) break;
        const job = jobs.get(pick);
        now = job.at;
        if (job.every === null) jobs.delete(pick);
        else job.at = now + job.every;
        job.handler();
      }
      now = end;
    },
  };
}

test("driver: 逐帧推进，大积压半秒内追平（不落后于流）", () => {
  const clock = fakeClock();
  const seen = [];
  const driver = createTypewriter((cut) => seen.push(cut), clock);
  const first = "一二三四五六七八九十"; // 10 字
  driver.push(first);
  assert.equal(driver.cut(), 0, "首帧不预吐，等定时器推");
  clock.advance(FRAME_MS);
  assert.equal(driver.cut(), BASE_STEP_CHARS);
  clock.advance(FRAME_MS);
  assert.equal(driver.cut(), BASE_STEP_CHARS * 2);
  assert.equal(driver.pending(), true);
  assert.deepEqual(seen.slice(0, 2), [3, 6]);
  // 大队时全速追：一次性来 400 字不该吐 100+ 帧，半秒内排空（= 不落后于流）
  driver.push("x".repeat(400));
  clock.advance(FRAME_MS * 30);
  assert.equal(driver.cut(), 400, "大队在 0.5s 内追平");
  assert.equal(driver.pending(), false);
});

test("driver: 安静 QUIET_FLUSH_MS 后整段落定（被挡住的切点不会永久冻住）", () => {
  const clock = fakeClock();
  const text = "正文写完了，然后开始**粗"; // 末尾卡着一个未闭合的 `**`
  const driver = createTypewriter(() => {}, clock);
  driver.push(text);
  clock.advance(FRAME_MS * 20);
  assert.equal(driver.cut(), "正文写完了，然后开始".length, "只吐到安全边界");
  assert.equal(driver.pending(), true);
  clock.advance(QUIET_FLUSH_MS);
  assert.equal(driver.cut(), text.length, "安静兜底把剩下的整段交出去");
  assert.equal(driver.pending(), false);
});

test("driver: 新字到达会重置安静计时，吐完不再留定时器", () => {
  const clock = fakeClock();
  let calls = 0;
  const driver = createTypewriter(() => { calls += 1; }, clock);
  driver.push("a".repeat(10));
  clock.advance(FRAME_MS * 4);
  assert.equal(driver.pending(), false);
  const before = calls;
  clock.advance(QUIET_FLUSH_MS * 4);
  assert.equal(calls, before, "排空后没有任何回调 = 没有残留定时器");

  // 新的 delta 重新起一个安静窗口
  driver.push("a".repeat(14));
  clock.advance(FRAME_MS * 4);
  assert.equal(driver.cut(), 14);
  assert.equal(driver.pending(), false);
});

test("driver: 文本变短（重开 / 切分支）时切点回落，不停在旧位置", () => {
  const clock = fakeClock();
  const driver = createTypewriter(() => {}, clock);
  const text = "很长的一段流式文字"; // 9 字
  driver.push(text);
  clock.advance(FRAME_MS * 10);
  assert.equal(driver.cut(), text.length);
  driver.push("短");
  assert.equal(driver.cut(), 1);
});

test("driver: reset / dispose 停表并让后续 push 无效", () => {
  const clock = fakeClock();
  let calls = 0;
  const driver = createTypewriter(() => { calls += 1; }, clock);
  driver.push("abcd");
  driver.reset();
  clock.advance(FRAME_MS * 10 + QUIET_FLUSH_MS);
  assert.equal(calls, 0);
  assert.equal(driver.pending(), false);
  driver.push("abcdef");
  driver.dispose();
  clock.advance(FRAME_MS * 10 + QUIET_FLUSH_MS);
  assert.equal(calls, 0);
  assert.equal(driver.cut(), 0);
});