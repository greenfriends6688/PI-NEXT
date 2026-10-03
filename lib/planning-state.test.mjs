import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  PlanningConflictError,
  PlanningInputError,
  acknowledgeReminder,
  createEvent,
  createGroup,
  createReminder,
  createTag,
  createTodo,
  deleteGroup,
  deleteReminder,
  deleteTag,
  deleteTodo,
  emptyPlanningState,
  linkTodoSession,
  markReminderNotified,
  normalizePlanningState,
  snoozeReminder,
  updateTodo,
} = await jiti.import("./planning-state.ts");

const NOW = 1_760_000_000_000;

/* fork:proma-44-planning —— 状态层的不变量。时间全部注入，所以这里的
 * 「等一会儿」是零毫秒。 */

test("malformed storage fails soft: the workspace still opens", () => {
  // 顶层不是对象 → 空库（fail-closed 也只是「读不出来」这一个出口）
  assert.equal(normalizePlanningState(null).todos.length, 0);
  assert.equal(normalizePlanningState("nope").todos.length, 0);
  assert.equal(normalizePlanningState([1, 2, 3]).events.length, 0);

  // 半截条目被丢掉，好条目留下
  const state = normalizePlanningState({
    todos: [
      { id: "a", title: "keep" },
      { id: "", title: "no id" },
      { title: "no id at all" },
      "not an object",
    ],
    events: [{ id: "e", title: "no start" }],
    reminders: [{ id: "r", targetId: "a" }],
  });
  assert.deepEqual(state.todos.map((t) => t.id), ["a"]);
  assert.equal(state.events.length, 0);
  // 提醒指向的 todo 在，但 triggerAt 缺失 → 丢弃
  assert.equal(state.reminders.length, 0);
});

test("dangling references are dropped on load", () => {
  const state = normalizePlanningState({
    todos: [{ id: "a", title: "t", groupId: "gone", tagIds: ["gone"], reminderIds: ["gone"] }],
    groups: [],
    tags: [],
    reminders: [],
  });
  assert.equal(state.todos[0].groupId, undefined);
  assert.deepEqual(state.todos[0].tagIds, []);
  assert.deepEqual(state.todos[0].reminderIds, []);
});

test("create: trimmed title required, defaults, deduped tags, auto due reminder", () => {
  const state = emptyPlanningState();
  const todo = createTodo(state, { title: "  ship it  ", tagIds: ["x", "x", "y"], dueAt: NOW + 60_000 }, NOW);
  assert.equal(todo.title, "ship it");
  assert.equal(todo.status, "open");
  assert.equal(todo.priority, "medium");
  assert.deepEqual(todo.tagIds, ["x", "y"]);
  assert.equal(todo.reminderIds.length, 1);
  const reminder = state.reminders[0];
  assert.equal(reminder.origin, "todo_due_at");
  assert.equal(reminder.triggerAt, NOW + 60_000);
  assert.equal(reminder.status, "pending");

  assert.throws(() => createTodo(state, { title: "   " }, NOW), PlanningInputError);
  assert.throws(() => createEvent(state, { title: "x", startAt: Number.NaN }, NOW), PlanningInputError);
});

test("rescheduling a todo moves its auto reminder and re-arms the notification", () => {
  const state = emptyPlanningState();
  const todo = createTodo(state, { title: "t", dueAt: NOW + 1000 }, NOW);
  const reminderId = todo.reminderIds[0];
  markReminderNotified(state, reminderId, NOW + 2000);

  const later = NOW + 9_000_000;
  updateTodo(state, { id: todo.id, dueAt: later }, later);
  const moved = state.reminders.find((r) => r.id === reminderId);
  assert.equal(moved.triggerAt, later, "自动提醒跟着 dueAt 走");
  assert.equal(moved.lastNotifiedAt, undefined, "挪到将来以后必须允许再响一次");
  assert.equal(moved.status, "pending");

  // 清掉 dueAt → 自动提醒一并消失
  updateTodo(state, { id: todo.id, dueAt: null }, later + 1);
  assert.equal(state.reminders.length, 0);
  assert.deepEqual(state.todos[0].reminderIds, []);
});

test("a manual reminder survives a due-date change", () => {
  const state = emptyPlanningState();
  const todo = createTodo(state, { title: "t", dueAt: NOW, reminderAt: [NOW + 5_000] }, NOW);
  assert.equal(todo.reminderIds.length, 2);
  updateTodo(state, { id: todo.id, dueAt: NOW + 500 }, NOW + 1);
  const origins = state.reminders.map((r) => r.origin).sort();
  assert.deepEqual(origins, ["manual", "todo_due_at"]);
});

test("completing a todo closes its pending reminders; reopening re-arms only the due one", () => {
  const state = emptyPlanningState();
  const todo = createTodo(state, { title: "t", dueAt: NOW, reminderAt: [NOW + 5_000] }, NOW);
  const auto = todo.reminderIds.find((id) => state.reminders.find((r) => r.id === id).origin === "todo_due_at");
  const manual = todo.reminderIds.find((id) => id !== auto);

  const done = updateTodo(state, { id: todo.id, status: "completed" }, NOW + 10);
  assert.equal(done.completedAt, NOW + 10);
  assert.equal(state.reminders.find((r) => r.id === auto).status, "completed");
  assert.equal(state.reminders.find((r) => r.id === manual).status, "completed");

  // 重新打开：手动提醒保持已完成（它已经被确认过一次），到点提醒重新武装。
  updateTodo(state, { id: todo.id, status: "open" }, NOW + 20);
  assert.equal(state.todos[0].completedAt, undefined);
  assert.equal(state.reminders.find((r) => r.id === manual).status, "completed");
  const rearmed = state.reminders.find((r) => r.origin === "todo_due_at" && r.status === "pending");
  assert.equal(rearmed.triggerAt, NOW, "重新打开的任务按原计划时间再响一次");
});

test("expectedUpdatedAt rejects a stale cross-view write instead of overwriting it", () => {
  const state = emptyPlanningState();
  const todo = createTodo(state, { title: "first" }, NOW);
  updateTodo(state, { id: todo.id, title: "second" }, NOW + 1000);
  assert.throws(
    () => updateTodo(state, { id: todo.id, title: "stale", expectedUpdatedAt: NOW }, NOW + 2000),
    PlanningConflictError,
  );
  assert.equal(state.todos[0].title, "second", "冲突的写入必须一个字节都不落地");
  // 对得上就放行
  assert.equal(updateTodo(state, { id: todo.id, title: "third", expectedUpdatedAt: NOW + 1000 }, NOW + 3000).title, "third");
});

test("deleting a group or a tag clears it from every todo and event", () => {
  const state = emptyPlanningState();
  const group = createGroup(state, { scope: "todo", name: "Work" }, NOW);
  const tag = createTag(state, { name: "#urgent" }, NOW);
  const todo = createTodo(state, { title: "t", groupId: group.id, tagIds: [tag.id] }, NOW);
  const event = createEvent(state, { title: "e", startAt: NOW, groupId: group.id, tagIds: [tag.id] }, NOW);

  deleteGroup(state, group.id);
  assert.equal(state.todos[0].groupId, undefined);
  assert.equal(state.events[0].groupId, undefined);

  deleteTag(state, tag.id);
  assert.deepEqual(state.todos[0].tagIds, []);
  assert.deepEqual(state.events[0].tagIds, []);
  assert.equal(state.tags.length, 0);
  void todo; void event;
});

test("group names are unique per scope but the same name may exist in both scopes", () => {
  const state = emptyPlanningState();
  createGroup(state, { scope: "todo", name: "Inbox" }, NOW);
  assert.throws(() => createGroup(state, { scope: "todo", name: "inbox" }, NOW), PlanningInputError);
  const calendarGroup = createGroup(state, { scope: "calendar", name: "Inbox" }, NOW);
  assert.equal(calendarGroup.scope, "calendar");
  assert.equal(state.groups.length, 2);
});

test("deleting a todo takes its reminders and todo-linked events with it", () => {
  const state = emptyPlanningState();
  const todo = createTodo(state, { title: "t", dueAt: NOW }, NOW);
  createEvent(state, { title: "e", startAt: NOW, todoId: todo.id, reminderAt: [NOW + 10] }, NOW);
  assert.equal(state.reminders.length, 2);

  deleteTodo(state, todo.id);
  assert.equal(state.todos.length, 0);
  assert.equal(state.reminders.filter((r) => r.targetType === "todo").length, 0);
  // 独立日程本身还在，但它指向的 todo 没了
  const events = normalizePlanningState(state);
  assert.equal(events.events[0].todoId, undefined, "悬空的 todoId 在读侧被清掉");
});

test("reminder acknowledge / snooze / notify transitions", () => {
  const state = emptyPlanningState();
  const todo = createTodo(state, { title: "t" }, NOW);
  const reminder = createReminder(state, { targetType: "todo", targetId: todo.id, triggerAt: NOW + 1000 }, NOW);
  assert.deepEqual(todo.reminderIds, [reminder.id]);

  markReminderNotified(state, reminder.id, NOW + 1500);
  assert.equal(state.reminders[0].lastNotifiedAt, NOW + 1500);

  const snoozed = snoozeReminder(state, reminder.id, 10, NOW + 2000);
  assert.equal(snoozed.snoozedUntil, NOW + 2000 + 600_000);
  assert.equal(snoozed.lastNotifiedAt, undefined, "推迟后必须允许再响");
  assert.equal(snoozed.status, "pending");

  const acked = acknowledgeReminder(state, reminder.id, NOW + 3000);
  assert.equal(acked.status, "acknowledged");
  assert.equal(acked.acknowledgedAt, NOW + 3000);
  // 重复确认不改时间戳
  assert.equal(acknowledgeReminder(state, reminder.id, NOW + 9000).acknowledgedAt, NOW + 3000);

  assert.throws(() => snoozeReminder(state, reminder.id, 0, NOW), PlanningInputError);
  assert.throws(
    () => createReminder(state, { targetType: "todo", targetId: "nope", triggerAt: NOW }, NOW),
    PlanningInputError,
  );

  deleteReminder(state, reminder.id);
  assert.deepEqual(state.todos[0].reminderIds, []);
});

test("session links are deduplicated by session id and keep the first touch time", () => {
  const state = emptyPlanningState();
  const todo = createTodo(state, { title: "t" }, NOW);
  linkTodoSession(state, todo.id, "s1", NOW + 10);
  linkTodoSession(state, todo.id, "s1", NOW + 20);
  linkTodoSession(state, todo.id, "s2", NOW + 30);
  assert.equal(state.todos[0].sessionLinks.length, 2);
  const first = state.todos[0].sessionLinks.find((l) => l.sessionId === "s1");
  assert.equal(first.firstTouchedAt, NOW + 10);
  assert.equal(first.lastTouchedAt, NOW + 20);

  // 重新读一遍（模拟重启）仍然是两条
  assert.equal(normalizePlanningState(state).todos[0].sessionLinks.length, 2);
});

test("notes are stored verbatim; an empty string clears the field", () => {
  const state = emptyPlanningState();
  const todo = createTodo(state, { title: "t", notes: "  keep\n  indent  " }, NOW);
  assert.equal(todo.notes, "  keep\n  indent  ");
  assert.equal(updateTodo(state, { id: todo.id, notes: "" }, NOW + 1).notes, undefined);
  assert.equal(state.todos[0].notes, undefined);
});
