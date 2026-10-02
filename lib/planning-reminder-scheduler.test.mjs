import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  PLANNING_REMINDER_TICK_MS,
  startPlanningReminderScheduler,
  stopPlanningReminderScheduler,
} = await jiti.import("./planning-reminder-scheduler.ts");

/*
 * fork:proma-44-planning —— 提醒 tick 驱动器。
 *
 * 依赖全部注入（now / setInterval / collect / markNotified / onFire），所以
 * 「30 秒后响一次」在这里是一条同步调用，不占测试时间，也不依赖真定时器。
 */

const T0 = 1_760_000_000_000;

function fakeClock() {
  let now = T0;
  let unrefCalls = 0;
  const handles = new Map();
  let nextId = 1;
  const clock = {
    now: () => now,
    advance: (ms) => { now += ms; },
    setIntervalFn: (handler, ms) => {
      const id = nextId++;
      handles.set(id, { handler, ms, unref: () => { unrefCalls += 1; } });
      return handles.get(id);
    },
    clearIntervalFn: (handle) => { handles.delete([...handles.keys()].find((k) => handles.get(k) === handle)); },
    fire: () => { for (const handle of [...handles.values()]) handle.handler(); },
    get registered() { return [...handles.values()]; },
    get unrefCalls() { return unrefCalls; },
  };
  return clock;
}

test("the tick is short and unref'd so it never pins the process", () => {
  const clock = fakeClock();
  const handle = startPlanningReminderScheduler({
    now: clock.now,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    collect: async () => [],
    markNotified: async () => {},
  });
  assert.equal(clock.registered.length, 1);
  assert.equal(clock.registered[0].ms, PLANNING_REMINDER_TICK_MS);
  assert.equal(PLANNING_REMINDER_TICK_MS, 30_000, "长 setInterval 会在系统休眠回来后漂到不可预期的时刻");
  assert.equal(clock.unrefCalls, 1, "unref 掉，否则这个 tick 会把 Next 进程钉住不让退出");
  handle.stop();
  assert.equal(clock.registered.length, 0);
});

test("one tick fires each due reminder once, then marks it notified", async () => {
  const clock = fakeClock();
  const notified = new Set();
  const fired = [];
  const items = [
    { reminder: { id: "r1" }, fireAt: T0 - 1, due: true, notified: false, targetTitle: "a", targetType: "todo" },
    { reminder: { id: "r2" }, fireAt: T0 - 1, due: true, notified: false, targetTitle: "b", targetType: "todo" },
  ];

  const handle = startPlanningReminderScheduler({
    now: clock.now,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    collect: async () => items.filter((item) => !notified.has(item.reminder.id)),
    markNotified: async (ids) => { for (const id of ids) notified.add(id); },
    onFire: (rows) => { fired.push(...rows.map((r) => r.reminder.id)); },
  });

  await handle.tick();
  assert.deepEqual(fired, ["r1", "r2"]);
  await handle.tick();
  assert.deepEqual(fired, ["r1", "r2"], "第二轮 collect 返回空 → 不重复弹");

  // 定时器那条路也是同一个 tick
  clock.fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fired, ["r1", "r2"]);
  handle.stop();
});

test("a failing collect never marks anything notified and never throws", async () => {
  const clock = fakeClock();
  let marked = 0;
  const handle = startPlanningReminderScheduler({
    now: clock.now,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    collect: async () => { throw new Error("disk gone"); },
    markNotified: async () => { marked += 1; },
    onFire: () => { throw new Error("不该被调到"); },
  });
  await handle.tick();
  assert.equal(marked, 0, "读失败时不能把提醒标成「响过了」——那等于吞掉一条提醒");
  handle.stop();
});

test("a failing write-back also does not fire the notification", async () => {
  const clock = fakeClock();
  let firedCount = 0;
  const handle = startPlanningReminderScheduler({
    now: clock.now,
    setIntervalFn: clock.setIntervalFn,
    clearIntervalFn: clock.clearIntervalFn,
    collect: async () => [{
      reminder: { id: "r1" }, fireAt: T0 - 1, due: true, notified: false, targetTitle: "a", targetType: "todo",
    }],
    markNotified: async () => { throw new Error("read-only disk"); },
    onFire: () => { firedCount += 1; },
  });
  await handle.tick();
  assert.equal(firedCount, 0, "记不住「响过了」就别弹，否则下一轮会再弹一次");
  handle.stop();
});

test("the scheduler is a singleton so hot reload cannot double-fire", () => {
  const noop = { collect: async () => [], markNotified: async () => {} };
  const first = startPlanningReminderScheduler(noop);
  const second = startPlanningReminderScheduler(noop);
  assert.equal(first, second, "两个 tick 循环会把同一条提醒记两次通知");
  stopPlanningReminderScheduler();
  assert.notEqual(startPlanningReminderScheduler(noop), first, "stop 之后能重新起");
  stopPlanningReminderScheduler();
});
