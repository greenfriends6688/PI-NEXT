import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  SNOOZE_MINUTES,
  displayReminders,
  dueReminders,
  reminderFireAt,
  reminderTarget,
  upcomingReminders,
} = await jiti.import("./planning-reminders.ts");
const { createEvent, createTodo, emptyPlanningState, snoozeReminder, markReminderNotified, acknowledgeReminder } =
  await jiti.import("./planning-state.ts");

/*
 * fork:proma-44-planning —— 提醒「该不该响」的判定。全部注入 `now`。
 */

const NOW = 1_760_000_000_000;

test("reminderFireAt prefers the snooze time", () => {
  assert.equal(reminderFireAt({ snoozedUntil: 200, triggerAt: 100 }), 200);
  assert.equal(reminderFireAt({ triggerAt: 100 }), 100);
  // snoozedUntil: undefined 也走 triggerAt（不能用 `??` 之外的写法）
  assert.equal(reminderFireAt({ snoozedUntil: undefined, triggerAt: 100 }), 100);
});

test("only pending, already-due reminders fire, and they come out in time order", () => {
  const state = emptyPlanningState();
  const a = createTodo(state, { title: "later", reminderAt: [NOW + 10_000] }, NOW);
  const b = createTodo(state, { title: "sooner", reminderAt: [NOW - 1] }, NOW);
  void a; void b;
  const acked = createTodo(state, { title: "acked", reminderAt: [NOW - 5] }, NOW);
  acknowledgeReminder(state, acked.reminderIds[0], NOW);

  const due = dueReminders(state.reminders, NOW);
  assert.deepEqual(due.map((r) => r.targetId), [b.id], "只有到点且仍 pending 的那一条");
});

test("the due check ignores the notified flag; the scheduler is what dedupes", () => {
  // 分工：判定层回答「到点了吗」，驱动器回答「响过没有」（`lastNotifiedAt === undefined`）。
  // 判据放进判定层的话，「已响过但用户还没确认」的那条会从提醒条上消失 ——
  // 而提醒条恰恰要一直留着它直到用户点掉。
  const state = emptyPlanningState();
  const todo = createTodo(state, { title: "t", reminderAt: [NOW - 1] }, NOW);
  markReminderNotified(state, todo.reminderIds[0], NOW);
  assert.equal(dueReminders(state.reminders, NOW).length, 1, "到点就是到点");
  const [row] = displayReminders(state, NOW);
  assert.equal(row.notified, true, "但驱动器看得见它响过了");
  assert.equal(row.due, true);
});

test("upcomingReminders previews the next 24h, which is what the rail shows", () => {
  const state = emptyPlanningState();
  const soon = createTodo(state, { title: "soon", reminderAt: [NOW + 60_000] }, NOW);
  const later = createTodo(state, { title: "later", reminderAt: [NOW + 30 * 60_000] }, NOW);
  const far = createTodo(state, { title: "far", reminderAt: [NOW + 40 * 60 * 60_000] }, NOW);
  void soon; void later; void far;

  assert.equal(dueReminders(state.reminders, NOW).length, 0, "还没到点的不进 due");
  assert.equal(upcomingReminders(state.reminders, NOW).length, 2, "24 小时内预告，超出的不预告");
  assert.equal(upcomingReminders(state.reminders, NOW, 48 * 3_600_000).length, 3);
});

test("snoozing pushes a fired reminder into the future and lets it fire again", () => {
  const state = emptyPlanningState();
  const todo = createTodo(state, { title: "t", reminderAt: [NOW - 1] }, NOW);
  const id = todo.reminderIds[0];
  markReminderNotified(state, id, NOW);
  assert.equal(dueReminders(state.reminders, NOW).length, 1);

  snoozeReminder(state, id, SNOOZE_MINUTES[1], NOW);
  assert.equal(dueReminders(state.reminders, NOW).length, 0, "推迟之后这一轮不再响");
  assert.equal(dueReminders(state.reminders, NOW + 15 * 60_000 + 1).length, 1, "15 分钟后重新可响");
  assert.equal(state.reminders[0].lastNotifiedAt, undefined, "lastNotifiedAt 必须被清掉");
});

test("displayReminders joins the target title and drops reminders with no target", () => {
  const state = emptyPlanningState();
  const todo = createTodo(state, { title: "call mum", reminderAt: [NOW - 1] }, NOW);
  const event = createEvent(state, { title: "retro", startAt: NOW, reminderAt: [NOW - 1] }, NOW);
  // 一条提醒的目标被删掉（悬空）→ 不进提醒条，否则用户会去点一个不存在的条目
  createTodo(state, { title: "orphan", reminderAt: [NOW - 1] }, NOW);
  const orphanId = state.todos[state.todos.length - 1].id;
  state.todos = state.todos.filter((item) => item.id !== orphanId);
  state.reminders = state.reminders.filter((r) => r.targetId !== orphanId);

  const rows = displayReminders(state, NOW);
  assert.deepEqual(rows.map((r) => r.targetTitle).sort(), ["call mum", "retro"]);
  assert.equal(rows.every((r) => r.due), true);
  assert.equal(rows.every((r) => r.notified === false), true);
  assert.deepEqual(rows.map((r) => r.targetType).sort(), ["calendar_event", "todo"]);
  void todo; void event;
});

test("reminderTarget reports a missing target instead of inventing one", () => {
  const state = emptyPlanningState();
  const reminder = { id: "r", targetType: "todo", targetId: "ghost", triggerAt: NOW, status: "pending", origin: "manual", createdAt: NOW, updatedAt: NOW };
  assert.deepEqual(reminderTarget(state, reminder), { type: "todo", title: "", found: false });
});

test("SNOOZE_MINUTES are the three quick options, ascending", () => {
  assert.deepEqual([...SNOOZE_MINUTES], [5, 15, 60]);
});
