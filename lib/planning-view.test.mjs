import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  countOpenTodos,
  filterTodos,
  sortTodos,
  todoGroupBuckets,
  toEventView,
  toTodoView,
  visibleEvents,
  visibleTodos,
} = await jiti.import("./planning-view.ts");
const { createEvent, createGroup, createTag, createTodo, emptyPlanningState } =
  await jiti.import("./planning-state.ts");

/*
 * fork:proma-44-planning —— 读侧的视图模型。关系存的是 id，所以「接回去」这件事
 * 在这里发生，也在这里被钉住。
 */

const at = (y, m, d, h = 0) => new Date(y, m, d, h).getTime();
const NOW = at(2026, 2, 14, 10);

test("toTodoView joins group / tags / reminders and drops ids that resolve to nothing", () => {
  const state = emptyPlanningState();
  const group = createGroup(state, { scope: "todo", name: "Work" }, NOW);
  const tag = createTag(state, { name: "urgent" }, NOW);
  const todo = createTodo(state, {
    title: "t",
    groupId: group.id,
    tagIds: [tag.id, "ghost"],
    dueAt: NOW + 60_000,
  }, NOW);

  const view = toTodoView(todo, state);
  assert.equal(view.group.name, "Work");
  assert.deepEqual(view.tags.map((t) => t.name), ["urgent"], "接不到的标签 id 被丢掉，不留幽灵");
  assert.equal(view.reminders.length, 1, "到点自动提醒也跟着接上");
  assert.equal(view.reminders[0].origin, "todo_due_at");

  const plain = toTodoView(createTodo(state, { title: "plain" }, NOW), state);
  assert.equal(plain.group, undefined, "没分组时字段是 undefined 而不是空对象");
  assert.deepEqual(plain.tags, []);
  assert.deepEqual(plain.reminders, []);
});

test("reminders come back in fire order, and a snooze reorders them", () => {
  const state = emptyPlanningState();
  const todo = createTodo(state, { title: "t", reminderAt: [NOW + 9000, NOW + 5000] }, NOW);
  const view = toTodoView(todo, state);
  assert.deepEqual(view.reminders.map((r) => r.triggerAt), [NOW + 5000, NOW + 9000], "按触发时刻排");

  // 推迟第一条到明天：排序键从 triggerAt 变成 snoozedUntil，它就该沉到后面。
  const first = view.reminders[0];
  first.snoozedUntil = NOW + 90_000;
  assert.deepEqual(
    toTodoView(todo, state).reminders.map((r) => r.triggerAt),
    [NOW + 9000, NOW + 5000],
  );
});

test("toEventView joins the same way", () => {
  const state = emptyPlanningState();
  const group = createGroup(state, { scope: "calendar", name: "Meetings" }, NOW);
  const event = createEvent(state, { title: "e", startAt: NOW, groupId: group.id }, NOW);
  assert.equal(toEventView(event, state).group.name, "Meetings");
});

test("sortTodos: open first by due date, undated sink to the bottom, done newest first", () => {
  const state = emptyPlanningState();
  const undated = createTodo(state, { title: "undated" }, NOW);
  const tomorrow = createTodo(state, { title: "tomorrow", dueAt: at(2026, 2, 15, 9) }, NOW);
  const overdue = createTodo(state, { title: "overdue", dueAt: at(2026, 2, 10, 9) }, NOW);
  const doneOld = createTodo(state, { title: "done old" }, NOW);
  const doneNew = createTodo(state, { title: "done new" }, NOW);
  for (const [todo, at2] of [[doneOld, NOW - 10_000], [doneNew, NOW - 1_000]]) {
    todo.status = "completed";
    todo.completedAt = at2;
  }

  const sorted = sortTodos([undated, tomorrow, overdue, doneOld, doneNew]);
  assert.deepEqual(sorted.map((t) => t.title), ["overdue", "tomorrow", "undated", "done new", "done old"]);
});

test("filterTodos understands every view and status combination", () => {
  const state = emptyPlanningState();
  const group = createGroup(state, { scope: "todo", name: "Work" }, NOW);
  const tag = createTag(state, { name: "urgent" }, NOW);
  const overdue = createTodo(state, { title: "overdue", dueAt: at(2026, 2, 13, 23) }, NOW);
  const today = createTodo(state, { title: "today", dueAt: at(2026, 2, 14, 23) }, NOW);
  const later = createTodo(state, { title: "later", dueAt: at(2026, 2, 20) }, NOW);
  createTodo(state, { title: "grouped", groupId: group.id, tagIds: [tag.id] }, NOW);
  const done = createTodo(state, { title: "done", dueAt: at(2026, 2, 10) }, NOW);
  done.status = "completed";

  const titles = (view, status) =>
    filterTodos(state.todos, { view, status, now: NOW }).map((t) => t.title).sort();

  assert.equal(titles("today", "open").join(","), "today");
  assert.equal(titles("overdue", "open").join(","), "overdue");
  assert.equal(titles("all", "open").includes("done"), false, "完成的默认不出现在「未完成」档");
  assert.equal(titles("all", "open").length, 4);
  assert.equal(titles("all", "completed").join(","), "done");
  assert.equal(titles("all", "all").length, 5);
  assert.deepEqual(titles(`group:${group.id}`, "all"), ["grouped"]);
  assert.deepEqual(titles(`tag:${tag.id}`, "all"), ["grouped"]);
  void overdue; void today; void later;
});

test("visibleTodos returns view models, ready to render", () => {
  const state = emptyPlanningState();
  const tag = createTag(state, { name: "urgent" }, NOW);
  createTodo(state, { title: "t", tagIds: [tag.id] }, NOW);
  const [row] = visibleTodos(state, { view: "all", now: NOW });
  assert.equal(row.tags[0].name, "urgent");
  assert.equal(countOpenTodos(state), 1);
});

test("todoGroupBuckets keeps declared groups in order and puts the rest last", () => {
  const state = emptyPlanningState();
  const b = createGroup(state, { scope: "todo", name: "B", sortOrder: 2 }, NOW);
  const a = createGroup(state, { scope: "todo", name: "A", sortOrder: 1 }, NOW);
  createGroup(state, { scope: "calendar", name: "Not a todo group" }, NOW);
  createTodo(state, { title: "in b", groupId: b.id }, NOW);
  createTodo(state, { title: "in a", groupId: a.id }, NOW);
  createTodo(state, { title: "loose" }, NOW);

  const buckets = todoGroupBuckets(state);
  assert.deepEqual(buckets.map((bucket) => bucket.group?.name ?? "(none)"), ["A", "B", "(none)"]);
  assert.deepEqual(buckets[0].todos.map((t) => t.title), ["in a"]);
  assert.deepEqual(buckets[2].todos.map((t) => t.title), ["loose"]);
});

test("visibleEvents keeps a multi-day event once even though it matches several days", () => {
  const state = emptyPlanningState();
  createEvent(state, { title: "conf", startAt: at(2026, 2, 14, 22), endAt: at(2026, 2, 16, 2) }, NOW);
  createEvent(state, { title: "outside", startAt: at(2026, 1, 1) }, NOW);
  const rows = visibleEvents(state, { from: at(2026, 2, 1), to: at(2026, 3, 1) });
  assert.deepEqual(rows.map((e) => e.title), ["conf"]);
});

test("visibleEvents is sorted by start time", () => {
  const state = emptyPlanningState();
  createEvent(state, { title: "late", startAt: at(2026, 2, 20, 9) }, NOW);
  createEvent(state, { title: "early", startAt: at(2026, 2, 2, 9) }, NOW);
  const rows = visibleEvents(state, { from: at(2026, 1, 1), to: at(2026, 3, 1) });
  assert.deepEqual(rows.map((e) => e.title), ["early", "late"]);
});
