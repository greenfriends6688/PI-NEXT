// fork:desktop-crash-budget —— 重启预算的守卫。
//
// 这条测试存在的理由就是那个真 bug：旧实现把计数清零写在 `startServer()` 里面，
// `main.js` 又只有在 Electron 里才 load 得起来，所以「退避永不增长」这件事
// 在单测里根本无从发现。逻辑抽出来之后，这里把它钉死。
import assert from "node:assert/strict";
import test from "node:test";

import { createCrashBudget, SERVER_RESTART_MAX_ATTEMPTS } from "./server-crash-budget.js";

test("连崩时退避是 1/2/4/8/16 秒，不是永远 1 秒", () => {
  const budget = createCrashBudget();
  // uptime 0 = 每次都是刚起来就崩（旧实现里这正是永远 1s 的那种场景）。
  const delays = [];
  for (let i = 0; i < 5; i++) delays.push(budget.recordExit(0).delayMs);
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 16000]);
});

test("超过上限就进入终态，不再无限重启", () => {
  const budget = createCrashBudget();
  for (let i = 0; i < SERVER_RESTART_MAX_ATTEMPTS; i++) {
    assert.equal(budget.recordExit(0).exhausted, false, `第 ${i + 1} 次不该停手`);
  }
  const last = budget.recordExit(0);
  assert.equal(last.exhausted, true, "第 6 次必须停手（旧实现永远不会到这里）");
});

test("稳定窗口：跑够一整轮之后再崩，预算还回去", () => {
  const budget = createCrashBudget({ stableMs: 60_000 });
  budget.recordExit(0);
  budget.recordExit(0);
  assert.equal(budget.attempts, 2);
  // 这次活了 61s 才崩 —— 上一轮翻篇，重新从第 1 次算。
  const after = budget.recordExit(61_000);
  assert.equal(after.attempts, 1);
  assert.equal(after.delayMs, 1000);
});

test("刚好卡在稳定窗口边上不算稳定（用 >= 而不是 >）", () => {
  const budget = createCrashBudget({ stableMs: 60_000 });
  budget.recordExit(0);
  assert.equal(budget.recordExit(60_000).attempts, 1, "跑满窗口即翻篇");
});

test("拿不到 uptime（NaN / undefined）按不稳定算，预算继续扣", () => {
  const budget = createCrashBudget();
  budget.recordExit(0);
  assert.equal(budget.recordExit(NaN).attempts, 2);
  assert.equal(budget.recordExit(undefined).attempts, 3);
});

test("reset()：换网卡 / 手动重启这类非崩溃退出把预算还回去", () => {
  const budget = createCrashBudget();
  budget.recordExit(0);
  budget.recordExit(0);
  budget.reset();
  assert.equal(budget.attempts, 0);
  assert.equal(budget.recordExit(0).delayMs, 1000);
});
