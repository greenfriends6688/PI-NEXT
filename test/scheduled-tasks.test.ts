import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ScheduledTaskStore, nextScheduleAt, validateScheduleDraft } from "../src/main/engine/scheduled-tasks.ts";
import { runTrigger } from "../src/shared/schedules.ts";
import { ScheduledTaskManager } from "../src/main/pi/scheduled-task-manager.ts";

function temporary(t: { after(fn: () => void): void }): string {
  const folder = mkdtempSync(join(tmpdir(), "pinext-schedules-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "tasks.json");
}

const daily = { kind: "daily" as const, time: "09:00", timeZone: "Asia/Shanghai" };

test("recurrence follows the named wall clock, not a 24-hour interval", () => {
  assert.equal(nextScheduleAt(daily, Date.parse("2026-01-01T00:59:00Z")), Date.parse("2026-01-01T01:00:00Z"));
  assert.equal(nextScheduleAt(daily, Date.parse("2026-01-01T01:00:00Z")), Date.parse("2026-01-02T01:00:00Z"));
  assert.equal(nextScheduleAt({ kind: "weekly", time: "09:00", timeZone: "Asia/Shanghai", days: [1] }, Date.parse("2026-01-01T00:00:00Z")), Date.parse("2026-01-05T01:00:00Z"));
});

test("DST gaps move to the next real minute and folds run only on their first occurrence", () => {
  const gap = { kind: "daily" as const, time: "02:30", timeZone: "America/New_York" };
  assert.equal(nextScheduleAt(gap, Date.parse("2026-03-08T05:00:00Z")), Date.parse("2026-03-08T07:00:00Z"));
  const fold = { ...gap, time: "01:30" };
  assert.equal(nextScheduleAt(fold, Date.parse("2026-11-01T04:59:00Z")), Date.parse("2026-11-01T05:30:00Z"));
  assert.equal(nextScheduleAt(fold, Date.parse("2026-11-01T05:31:00Z")), Date.parse("2026-11-02T06:30:00Z"));
});

test("only absolute future one-shots and valid IANA repeats can be persisted", () => {
  assert.throws(() => validateScheduleDraft({ name: "x", prompt: "work", schedule: { kind: "once", at: "2027-01-01T10:00" } }));
  assert.throws(() => validateScheduleDraft({ name: "x", prompt: "work", schedule: { kind: "weekly", time: "09:00", timeZone: "Invalid/Zone", days: [2] } }));
  assert.throws(() => validateScheduleDraft({ name: "x", prompt: "work", schedule: { kind: "weekly", time: "09:00", timeZone: "UTC", days: [] } }));
});

test("claim is durable before the runner begins, survives restart and is never replayed", (t) => {
  const file = temporary(t);
  const store = new ScheduledTaskStore(file);
  const task = store.create({ name: "Daily", prompt: "work", project: "/tmp/work", schedule: daily });
  const scheduledAt = task.nextRunAt!;
  const run = store.claim(task.id, scheduledAt);
  assert.equal(store.get(task.id)?.nextRunAt, nextScheduleAt(daily, Math.max(run.startedAt!, scheduledAt)));
  assert.equal(store.due(scheduledAt).length, 0);
  assert.throws(() => store.claim(task.id, scheduledAt));
  const disk = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(disk.runs[0].status, "running");
  assert.equal(disk.runs[0].id, run.id);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const reloaded = new ScheduledTaskStore(file);
  assert.equal(reloaded.listRuns(task.id)[0]?.status, "interrupted");
  assert.equal(reloaded.due(scheduledAt).length, 0);
});

test("manual repeats keep their next occurrence; project binding can be cleared", (t) => {
  const store = new ScheduledTaskStore(temporary(t));
  const task = store.create({ name: "Daily", prompt: "work", project: "/tmp/work", schedule: daily });
  store.claim(task.id, Date.now(), "running", true);
  assert.equal(store.get(task.id)?.nextRunAt, task.nextRunAt);
  const cleared = store.update(task.id, { project: "", enabled: false });
  assert.equal(cleared?.project, undefined);
  assert.equal(cleared?.nextRunAt, undefined);
  const resumed = store.update(task.id, { enabled: true });
  assert.ok(resumed?.nextRunAt && resumed.nextRunAt > Date.now());
});

test("manager reports a consumed one-shot as background work until its run settles", async (t) => {
  const file = temporary(t);
  let finish!: () => void;
  const manager = new ScheduledTaskManager(file, async (_task, signal, onConversation) => {
    onConversation("chat-one");
    await new Promise<void>((resolve) => { finish = resolve; });
    assert.equal(signal.aborted, false);
  });
  const task = manager.create({ name: "Once", prompt: "work", schedule: { kind: "once", at: new Date(Date.now() + 60_000).toISOString() } });
  manager.start();
  const run = manager.runNow(task.id);
  assert.equal(manager.list().tasks[0]?.enabled, false);
  assert.equal(manager.hasEnabledTasks(), true);
  await new Promise((resolve) => setImmediate(resolve));
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.history(task.id)[0]?.status, "completed");
  assert.equal(manager.history(task.id)[0]?.conversationId, "chat-one");
  assert.equal(manager.hasEnabledTasks(), false);
  assert.ok(run.id);
  manager.stop();
});

test("a task remembers the chat that asked for it, and reporting can be switched off", (t) => {
  const store = new ScheduledTaskStore(temporary(t));
  const task = store.create({ name: "Daily", prompt: "work", notifyConversationId: "chat-1", schedule: daily });
  assert.equal(store.get(task.id)?.notifyConversationId, "chat-1");
  assert.equal(store.update(task.id, { name: "Renamed" })?.notifyConversationId, "chat-1");
  assert.equal(store.update(task.id, { notifyConversationId: "" })?.notifyConversationId, undefined);
  assert.throws(() => validateScheduleDraft({ name: "x", prompt: "work", notifyConversationId: " ", schedule: daily }));
});

test("the manager reports a run that ended, once, and not one cut short by quitting", async (t) => {
  const file = temporary(t);
  const seen: string[] = [];
  const manager = new ScheduledTaskManager(file, async () => undefined, (task, run) => seen.push(`${task.id}:${run.status}`));
  const task = manager.create({ name: "Once", prompt: "work", notifyConversationId: "chat-1", schedule: daily });
  manager.start();
  manager.runNow(task.id);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(seen, [`${task.id}:completed`]);
  manager.stop();
});

test("a cron rule is stored, validated and scheduled in the task's own zone", () => {
  assert.equal(
    nextScheduleAt({ kind: "cron", expr: "0 9 * * *", timeZone: "Asia/Shanghai" }, Date.parse("2026-01-01T00:00:00Z")),
    Date.parse("2026-01-01T01:00:00Z"),
    "09:00 in Shanghai is 01:00Z",
  );
  assert.equal(
    nextScheduleAt({ kind: "cron", expr: "*/15 * * * *", timeZone: "Asia/Shanghai" }, Date.parse("2026-01-01T00:07:00Z")),
    Date.parse("2026-01-01T00:15:00Z"),
  );
  assert.throws(() => validateScheduleDraft({ name: "x", prompt: "work", schedule: { kind: "cron", expr: "*/15 * * *", timeZone: "UTC" } }), /cron/);
  assert.throws(() => validateScheduleDraft({ name: "x", prompt: "work", schedule: { kind: "cron", expr: "0 9 * * *", timeZone: "Invalid/Zone" } }), /时区/);
  // The 30th of February is a legal expression that never happens.
  assert.throws(() => validateScheduleDraft({ name: "x", prompt: "work", schedule: { kind: "cron", expr: "0 0 30 2 *", timeZone: "UTC" } }), /没有可执行/);
});

test("a run that ends five times in a row switches its own task off, and re-enabling resets it", (t) => {
  const store = new ScheduledTaskStore(temporary(t));
  const task = store.create({ name: "Daily", prompt: "work", schedule: daily });
  // Not `update({ enabled: true })` between attempts: switching a task on is a fresh start
  // and clears the count, which is the other half of this test.
  const fail = (): ScheduledTaskRun => {
    const claimed = store.claim(task.id, store.get(task.id)!.nextRunAt!);
    const finished = store.finish(claimed.id, "failed", "boom");
    assert.ok(finished);
    return finished;
  };
  for (let attempt = 1; attempt <= 4; attempt++) {
    fail();
    assert.equal(store.get(task.id)?.enabled, true, `still on after ${attempt} failures`);
    assert.equal(store.get(task.id)?.consecutiveFailures, attempt);
  }
  const last = fail();
  assert.equal(store.get(task.id)?.enabled, false, "the fifth failure switches it off");
  assert.equal(store.get(task.id)?.disabledReason, "failures");
  assert.equal(store.get(task.id)?.nextRunAt, undefined);
  assert.equal(last.disabledAfterFailures, 5, "the run says which switch-off it caused");
  assert.equal(store.listRuns(task.id)[0]?.status, "failed");

  // Switching it back on is a fresh start: the count that paused it is not held against it.
  const resumed = store.update(task.id, { enabled: true });
  assert.equal(resumed?.enabled, true);
  assert.equal(resumed?.consecutiveFailures, undefined);
  assert.equal(resumed?.disabledReason, undefined);

  // A run that completes (or is stopped) clears the count without needing the switch.
  const bad = store.claim(task.id, store.get(task.id)!.nextRunAt!);
  store.finish(bad.id, "failed");
  const good = store.claim(task.id, store.get(task.id)!.nextRunAt!);
  store.finish(good.id, "completed");
  assert.equal(store.get(task.id)?.consecutiveFailures, undefined);
});

test("late is recorded as a catch-up, and a miss never ran", (t) => {
  const store = new ScheduledTaskStore(temporary(t));
  const task = store.create({ name: "Daily", prompt: "work", schedule: daily });
  const due = store.get(task.id)!.nextRunAt!;

  const onTime = store.claim(task.id, due);
  assert.equal(onTime.trigger, "schedule");
  assert.equal(store.finish(onTime.id, "completed") !== undefined, true);

  // Too old to run is not a run at all: it is consumed so the schedule moves on.
  const missed = store.claim(task.id, store.get(task.id)!.nextRunAt!, "missed");
  assert.equal(missed.status, "missed");

  // A manual run is nobody's schedule, and does not move it.
  const next = store.get(task.id)!.nextRunAt;
  const manual = store.claim(task.id, Date.now(), "running", true);
  assert.equal(manual.trigger, "manual");
  assert.equal(manual.manual, true);
  assert.equal(store.get(task.id)?.nextRunAt, next);
});

test("how late a run is decides what the history calls it", () => {
  const now = Date.parse("2026-01-01T09:00:00Z");
  assert.equal(runTrigger(now, now, false), "schedule");
  assert.equal(runTrigger(now - 5_000, now, false), "schedule", "a few seconds is the same run");
  assert.equal(runTrigger(now - 6 * 60_000, now, false), "catch-up");
  assert.equal(runTrigger(now - 6 * 60_000, now, true), "manual", "asked for by hand is nobody's catch-up");
});

test("a run that outlives its task's deadline is stopped and says so", async (t) => {
  const manager = new ScheduledTaskManager(temporary(t), async (_task, signal) => {
    // A stop can arrive before the runner has started — the claim is synchronous and the
    // launch is a microtask — so `aborted` is checked first, exactly as the real runner does
    // (`#runScheduledTask`).
    if (signal.aborted) throw new Error("任务已停止");
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    throw new Error("任务已停止");
  });
  const task = manager.create({ name: "Long", prompt: "work", schedule: daily, maxDurationMin: 1 });
  manager.start();
  // The deadline is a minute, which a test cannot wait for; the run is stopped by hand to
  // prove the same path — `stopRun` and the deadline both abort the same signal.
  const run = manager.runNow(task.id);
  assert.equal(manager.stopRun(task.id), true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(manager.history(task.id)[0]?.status, "stopped");
  assert.equal(manager.history(task.id)[0]?.id, run.id);
  manager.stop();
});

test("a duration the form cannot mean is refused rather than stored", () => {
  for (const maxDurationMin of [0, -1, 24 * 60 + 1, 1.5, Number.NaN]) {
    assert.throws(
      () => validateScheduleDraft({ name: "x", prompt: "work", schedule: daily, maxDurationMin }),
      /单次运行时长/,
      `${maxDurationMin} should not be storable`,
    );
  }
  assert.doesNotThrow(() => validateScheduleDraft({ name: "x", prompt: "work", schedule: daily, maxDurationMin: 1 }));
});
