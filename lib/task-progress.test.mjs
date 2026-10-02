/**
 * fork:proma-31-task-progress —— 纯推导层的单测。
 *
 * 覆盖：六态词表与终态判定 · todo → 六态的两级映射 · 聚合计数 · getCurrentTask
 * 的两级回退 · taskSignature 的稳定性 · shouldRetainTaskProgress 的倒计时闸门。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  TASK_ITEM_STATUSES,
  TERMINAL_TASK_STATUSES,
  aggregateTaskItems,
  deriveTaskItems,
  getCurrentTask,
  isTaskItemStatus,
  isTerminalTaskStatus,
  shouldRetainTaskProgress,
  taskProgressRatio,
  taskProgressTone,
  taskSignature,
  taskStatusFromTodo,
  toTaskItemStatus,
} = await jiti.import("@/lib/task-progress");

/** 一份 3 行清单：第 1 行已完成，第 2 行是「正在做」，第 3 行还没开始。 */
const SUMMARY = {
  todos: [
    { id: 1, text: "read the spec", done: true },
    { id: 2, text: "write the code", done: false },
    { id: 3, text: "run the tests", done: false },
  ],
  done: 1,
  total: 3,
};

const task = (id, status, extra = {}) => ({ id: String(id), subject: `task ${id}`, status, ...extra });

test("六态词表齐全，终态只有三个", () => {
  assert.deepEqual([...TASK_ITEM_STATUSES], [
    "pending",
    "in_progress",
    "completed",
    "blocked",
    "cancelled",
    "error",
  ]);
  assert.deepEqual([...TERMINAL_TASK_STATUSES], ["completed", "cancelled", "error"]);
  for (const status of TASK_ITEM_STATUSES) {
    assert.equal(isTaskItemStatus(status), true);
    // blocked 是「还欠着」而不是「结束了」——它必须留在非终态里，
    // 否则 getCurrentTask 会跳过它，浮层也永远不会报「卡住了」。
    assert.equal(
      isTerminalTaskStatus(status),
      status === "completed" || status === "cancelled" || status === "error",
      `${status} 终态判定`,
    );
  }
  assert.equal(isTaskItemStatus("deleted"), false);
  assert.equal(isTaskItemStatus(undefined), false);
  assert.equal(toTaskItemStatus("error"), "error");
  assert.equal(toTaskItemStatus("deleted"), "pending");
  assert.equal(toTaskItemStatus("deleted", "blocked"), "blocked");
});

test("todo 映射：已完成 / 正在做 / 还没开始", () => {
  assert.equal(taskStatusFromTodo(true, false), "completed");
  assert.equal(taskStatusFromTodo(true, true), "completed");
  assert.equal(taskStatusFromTodo(false, true), "in_progress");
  assert.equal(taskStatusFromTodo(false, false), "pending");

  const streaming = deriveTaskItems(SUMMARY, { streaming: true });
  assert.deepEqual(streaming.map((item) => item.status), ["completed", "in_progress", "pending"]);
  assert.deepEqual(streaming.map((item) => item.id), ["1", "2", "3"]);
  assert.equal(streaming[1].subject, "write the code");
  assert.equal(streaming[1].activeForm, undefined);

  // run 结束：没有一条还在「进行中」，但未完成的行仍是未完成。
  const finished = deriveTaskItems(SUMMARY, { streaming: false });
  assert.deepEqual(finished.map((item) => item.status), ["completed", "pending", "pending"]);
});

test("todo 映射的另外三态：取消 / 失败 / 外部阻塞", () => {
  assert.deepEqual(
    deriveTaskItems(SUMMARY, { streaming: true, cancelled: true }).map((item) => item.status),
    ["completed", "cancelled", "cancelled"],
  );
  // 失败落在「正在做」的那一行，其余未完成行不受影响。
  assert.deepEqual(
    deriveTaskItems(SUMMARY, { streaming: true, failed: true }).map((item) => item.status),
    ["completed", "error", "pending"],
  );
  // blocked / activeForm 只能由别的生产者给（todo 工具没有这两个字段）。
  const blocked = deriveTaskItems(SUMMARY, {
    streaming: true,
    overrides: { 3: { status: "blocked", activeForm: "waiting on review" } },
  });
  assert.deepEqual(blocked.map((item) => item.status), ["completed", "in_progress", "blocked"]);
  assert.equal(blocked[2].activeForm, "waiting on review");

  assert.deepEqual(deriveTaskItems({ todos: [], done: 0, total: 0 }), []);
});

test("聚合计数：完成数只数 completed，blocked/error 各出一个标记", () => {
  const progress = aggregateTaskItems([
    task(1, "completed"),
    task(2, "completed"),
    task(3, "blocked"),
    task(4, "in_progress"),
  ]);
  assert.equal(progress.done, 2);
  assert.equal(progress.total, 4);
  assert.equal(progress.hasBlocked, true);
  assert.equal(progress.hasError, false);
  assert.equal(progress.current?.id, "4");
  assert.equal(taskProgressRatio(progress), 0.5);
  assert.equal(taskProgressTone(progress), "blocked");

  const failed = aggregateTaskItems([task(1, "completed"), task(2, "error")]);
  assert.equal(failed.done, 1);
  assert.equal(failed.hasError, true);
  assert.equal(taskProgressTone(failed), "error");
  assert.equal(failed.current, null);

  const empty = aggregateTaskItems([]);
  assert.deepEqual(empty, { done: 0, total: 0, current: null, hasBlocked: false, hasError: false });
  assert.equal(taskProgressRatio(empty), 0);
  assert.equal(taskProgressTone(empty), "active");
});

test("getCurrentTask 走两级回退：最后一个 in_progress，否则最后一个非终态", () => {
  // 一级：显式的 in_progress，取**最后一个**（agent 自下往上改计划时是最后一个）。
  const severalRunning = [task(1, "in_progress"), task(2, "in_progress"), task(3, "pending")];
  assert.equal(getCurrentTask(severalRunning)?.id, "2");

  // 一级没命中：退到最后一个非终态项（哪怕它只是 pending）。
  const noRunning = [task(1, "completed"), task(2, "pending"), task(3, "blocked")];
  assert.equal(getCurrentTask(noRunning)?.id, "3");

  // 全终态 = 没有「当前项」，浮层该改说「都做完了」。
  assert.equal(getCurrentTask([task(1, "completed"), task(2, "cancelled"), task(3, "error")]), null);
  assert.equal(getCurrentTask([]), null);
});

test("taskSignature 只随内容变化，不随数组身份变化", () => {
  const once = deriveTaskItems(SUMMARY, { streaming: true });
  const twice = deriveTaskItems(SUMMARY, { streaming: true });
  assert.notEqual(once, twice, "两次推导是两个不同数组");
  assert.equal(taskSignature(once), taskSignature(twice));

  const later = deriveTaskItems(SUMMARY, { streaming: true, failed: true });
  assert.notEqual(taskSignature(once), taskSignature(later), "状态变了签名必须变");

  // activeForm 参与签名：同一个任务换了「现在在干什么」也要重新计时。
  const named = deriveTaskItems(SUMMARY, { streaming: true, overrides: { 2: { activeForm: "editing" } } });
  assert.notEqual(taskSignature(once), taskSignature(named));
  assert.equal(taskSignature([]), "");
});

test("倒计时闸门：只有整个 run 结束才留进度", () => {
  assert.equal(shouldRetainTaskProgress(false, true), true, "run 结束且有任务 → 保留并倒计时");
  assert.equal(shouldRetainTaskProgress(true, true), false, "还在流式 → 不倒计时，浮层钉住");
  assert.equal(shouldRetainTaskProgress(false, false), false, "没有任务 → 没有可留的");
  assert.equal(shouldRetainTaskProgress(true, false), false);
});