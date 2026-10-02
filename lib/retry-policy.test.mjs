/**
 * fork:proma-35-retry —— 重试映射 / 降噪 / run 隔离的单测。
 *
 * 覆盖：阈值边界 · 五个 phase 的映射 · 前 5 次不产生事件 · 按 attempt upsert
 * （终态不追加重复的第 N 项）· 迟到旧 run 不污染新流 · maxRetries 继承 · 文案 key。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  PI_RETRY_VISIBILITY_THRESHOLD,
  RETRY_CANCELLED_FINAL_ERROR,
  mapRetryEvent,
  retryNoticeMessageKey,
  shouldSurfaceRetry,
  upsertRetryNotice,
} = await jiti.import("@/lib/retry-policy");

const RUN = { runId: 7, runStartedAt: 1_700_000_000_000 };

test("阈值就是 5，且只在 attempt > 5 时上报", () => {
  assert.equal(PI_RETRY_VISIBILITY_THRESHOLD, 5);
  for (const attempt of [1, 2, 3, 4, 5]) assert.equal(shouldSurfaceRetry(attempt), false, `attempt ${attempt}`);
  for (const attempt of [6, 7, 8, 20]) assert.equal(shouldSurfaceRetry(attempt), true, `attempt ${attempt}`);
});

test("前 5 次自动重试完全不上报", () => {
  for (const attempt of [1, 2, 3, 4, 5]) {
    assert.equal(
      mapRetryEvent({ type: "auto_retry_start", attempt, maxAttempts: 8 }, RUN),
      null,
      `attempt ${attempt} 不该产生事件`,
    );
  }
});

test("五个 phase 各自映射正确，并带上 run 上下文", () => {
  const scheduled = mapRetryEvent(
    { type: "auto_retry_start", attempt: 6, maxAttempts: 8, delayMs: 4000, errorMessage: "socket hang up" },
    RUN,
    111,
  );
  assert.deepEqual(scheduled, {
    runId: 7,
    runStartedAt: 1_700_000_000_000,
    attempt: 6,
    maxRetries: 8,
    phase: "scheduled",
    errorMessage: "socket hang up",
    delayMs: 4000,
    scheduledAt: 111,
  });

  assert.equal(mapRetryEvent({ type: "auto_retry_attempt_start", attempt: 6 }, RUN).phase, "running");
  assert.equal(mapRetryEvent({ type: "auto_retry_end", attempt: 6, success: true }, RUN).phase, "succeeded");

  const exhausted = mapRetryEvent({ type: "auto_retry_end", attempt: 6, success: false, finalError: "429" }, RUN);
  assert.equal(exhausted.phase, "exhausted");
  assert.equal(exhausted.errorMessage, "429");

  const cancelled = mapRetryEvent(
    { type: "auto_retry_end", attempt: 6, success: false, finalError: RETRY_CANCELLED_FINAL_ERROR },
    RUN,
  );
  assert.equal(cancelled.phase, "cancelled");
});

test("未知事件、压缩重试与非法 attempt 都不映射", () => {
  assert.equal(mapRetryEvent({ type: "message_start", attempt: 9 }, RUN), null);
  // 压缩 / 分支摘要的重试不属于「继续当前回答」，不进消息流。
  assert.equal(mapRetryEvent({ type: "summarization_retry_scheduled", attempt: 9, maxAttempts: 9 }, RUN), null);
  assert.equal(mapRetryEvent({ type: "auto_retry_start" }, RUN), null);
  assert.equal(mapRetryEvent({ type: "auto_retry_start", attempt: 0 }, RUN), null);
  assert.equal(mapRetryEvent({ type: "auto_retry_start", attempt: 6.5 }, RUN), null);
});

test("按 attempt upsert：终态覆盖同一次，不追加重复的第 N 项", () => {
  const scheduled = mapRetryEvent({ type: "auto_retry_start", attempt: 8, maxAttempts: 12 }, RUN, 1);
  const withScheduled = upsertRetryNotice([], scheduled);
  assert.equal(withScheduled.length, 1);

  // auto_retry_end 不带 maxAttempts：终态必须继承 scheduled 的 12，而不是塌成 8。
  const succeeded = mapRetryEvent({ type: "auto_retry_end", attempt: 8, success: true }, RUN, 2);
  const withSucceeded = upsertRetryNotice(withScheduled, succeeded);
  assert.equal(withSucceeded.length, 1, "第 8 次不能出现两条");
  assert.equal(withSucceeded[0].phase, "succeeded");
  assert.equal(withSucceeded[0].maxRetries, 12);
});

test("迟到旧 run 的事件不污染新流；新一轮替换整份历史", () => {
  const oldRun = { runId: 3, runStartedAt: 100 };
  const newRun = { runId: 4, runStartedAt: 200 };

  const oldNotice = mapRetryEvent({ type: "auto_retry_start", attempt: 6, maxAttempts: 8 }, oldRun, 1);
  let notices = upsertRetryNotice([], oldNotice);
  assert.equal(notices.length, 1);

  // 旧 run 的终态事件晚到：列表原样返回，新 run 的提示不受影响。
  const lateOldEnd = mapRetryEvent({ type: "auto_retry_end", attempt: 6, success: false }, oldRun, 2);
  notices = upsertRetryNotice(notices, lateOldEnd);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].runId, 3);

  // 新一轮开始：历史被替换。
  const newNotice = mapRetryEvent({ type: "auto_retry_start", attempt: 6, maxAttempts: 8 }, newRun, 3);
  notices = upsertRetryNotice(notices, newNotice);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].runId, 4);
  assert.equal(notices[0].runStartedAt, 200);
});

test("文案 key 由 phase 生成", () => {
  assert.equal(retryNoticeMessageKey("scheduled"), "chat.retryNotice.scheduled");
  assert.equal(retryNoticeMessageKey("exhausted"), "chat.retryNotice.exhausted");
});
