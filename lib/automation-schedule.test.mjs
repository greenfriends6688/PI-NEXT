// fork:proma-43-automation —— 调度算术的单测。
//
// 全部用「拨时钟」而不是真等：`base = new Date(2026, 2, 12, 9, 0, 0).getTime()`
// （3 月 12 日本地 09:00，一个普通的工作日周四），需要换天就显式 new Date(...)。
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeNextRunAt,
  describeSchedule,
  describeWeekdays,
  isRunQuotaComplete,
  isSameLocalDay,
  listUpcomingRuns,
  rescheduleOverdueOnStart,
} from "./automation-schedule.ts";

/** 2026-03-12 是周四。 */
const THU_0900 = new Date(2026, 2, 12, 9, 0, 0).getTime();
const THU_0930 = new Date(2026, 2, 12, 9, 30, 0).getTime();
const THU_1000 = new Date(2026, 2, 12, 10, 0, 0).getTime();
const THU_1800 = new Date(2026, 2, 12, 18, 0, 0).getTime();
const FRI_0900 = new Date(2026, 2, 13, 9, 0, 0).getTime();
const SAT_0900 = new Date(2026, 2, 14, 9, 0, 0).getTime();
const SUN_0900 = new Date(2026, 2, 15, 9, 0, 0).getTime();
const NEXT_MON_0900 = new Date(2026, 2, 16, 9, 0, 0).getTime();
const NEXT_TUE_0900 = new Date(2026, 2, 17, 9, 0, 0).getTime();

function automation(overrides = {}) {
  return {
    id: "a1",
    name: "triage",
    prompt: "do it",
    active: true,
    scheduleType: "daily",
    intervalMinutes: 60,
    createdAt: 0,
    updatedAt: 0,
    nextRunAt: THU_0900,
    runHistory: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
test("isSameLocalDay 用本地日历，跨 24h 不等于跨自然日，跨日等于", () => {
  assert.equal(isSameLocalDay(THU_0900, THU_1800), true);
  assert.equal(isSameLocalDay(THU_0900, new Date(2026, 2, 12, 23, 59, 0).getTime()), true);
  assert.equal(isSameLocalDay(THU_0900, new Date(2026, 2, 13, 0, 1, 0).getTime()), false);
  assert.equal(isSameLocalDay(FRI_0900, new Date(2026, 2, 13, 23, 59, 0).getTime()), true);
  // 去年同日不同年
  assert.equal(isSameLocalDay(THU_0900, new Date(2025, 2, 12, 9, 0, 0).getTime()), false);
});

test("daily：今天过了就顺延到明天同一时刻", () => {
  const a = automation({ scheduleType: "daily", timeOfDay: "09:00" });
  assert.equal(computeNextRunAt(a, THU_0930), FRI_0900);
  assert.equal(computeNextRunAt(a, THU_0900 - 60_000), THU_0900);
});

test("weekly：本周同一天没到就本周，已过就下周；周日=0 不能被当成「没配」", () => {
  const monday = automation({ scheduleType: "weekly", dayOfWeek: 1, timeOfDay: "09:00" });
  assert.equal(computeNextRunAt(monday, THU_0900), new Date(2026, 2, 16, 9, 0, 0).getTime());
  const sunday = automation({ scheduleType: "weekly", dayOfWeek: 0, timeOfDay: "09:00" });
  assert.equal(computeNextRunAt(sunday, THU_0900), SUN_0900);
  assert.equal(computeNextRunAt(sunday, SUN_0900 - 1000), SUN_0900);
});

test("once：永远返回固定的 scheduledAt，哪怕已经过去（补跑一次）", () => {
  const at = THU_1000;
  const a = automation({ scheduleType: "once", scheduledAt: at });
  assert.equal(computeNextRunAt(a, THU_0900), at);
  assert.equal(computeNextRunAt(a, FRI_0900), at);
  // 缺 scheduledAt 时兜底 10 分钟，而不是 0 / NaN
  assert.equal(computeNextRunAt(automation({ scheduleType: "once" }), THU_0900), THU_0900 + 600_000);
});

test("interval：锚点是 from + 间隔，执行耗时不会逐轮漂移", () => {
  const a = automation({ scheduleType: "interval", intervalMinutes: 20 });
  assert.equal(computeNextRunAt(a, THU_1000), THU_1000 + 20 * 60_000);
  // 从窗口/上一轮实际时刻起算都是干净的等距
  assert.equal(computeNextRunAt(a, THU_0930), THU_0930 + 20 * 60_000);
});

test("interval + 每日时段窗：锚点是当天窗口起点，跨窗口跳到下一个运行日的窗口起点", () => {
  const a = automation({
    scheduleType: "interval",
    intervalMinutes: 20,
    activeWindowStart: "10:00",
    activeWindowEnd: "22:00",
  });
  // 21:50 → 22:00 越过窗口 → 明天 10:00
  assert.equal(computeNextRunAt(a, new Date(2026, 2, 12, 21, 50, 0).getTime()), new Date(2026, 2, 13, 10, 0, 0).getTime());
  // 09:30 还没进窗口 → 今天 10:00
  assert.equal(computeNextRunAt(a, new Date(2026, 2, 12, 9, 30, 0).getTime()), THU_1000);
  // 10:07 在窗口里 → 锚点 10:00 起 20 分钟 → 10:20（不是 10:27）
  assert.equal(computeNextRunAt(a, new Date(2026, 2, 12, 10, 7, 0).getTime()), new Date(2026, 2, 12, 10, 20, 0).getTime());
});

test("interval + 工作日：周五夜里越界直接跳到下周一窗口起点，不在周末触发", () => {
  const a = automation({
    scheduleType: "interval",
    intervalMinutes: 60,
    activeWindowStart: "09:00",
    activeWindowEnd: "18:00",
    activeWeekdays: [1, 2, 3, 4, 5],
  });
  const fridayEvening = new Date(2026, 2, 13, 17, 30, 0).getTime();
  assert.equal(computeNextRunAt(a, fridayEvening), new Date(2026, 2, 16, 9, 0, 0).getTime());
});

test("interval + 周末：周六在窗口内也能跑", () => {
  const a = automation({
    scheduleType: "interval",
    intervalMinutes: 30,
    activeWindowStart: "09:00",
    activeWindowEnd: "18:00",
    activeWeekdays: [0, 6],
  });
  assert.equal(computeNextRunAt(a, SAT_0900), new Date(2026, 2, 14, 9, 30, 0).getTime());
});

test("interval 非法配置回退到 10 分钟而不是 0 / NaN", () => {
  assert.equal(
    computeNextRunAt(automation({ scheduleType: "interval", intervalMinutes: 0 }), THU_0900),
    THU_0900 + 600_000,
  );
});

// ---------------------------------------------------------------------------
test("规则二 · 启动恢复把过期的周期任务顺延到「现在 + 一个完整间隔」", () => {
  const overnight = new Date(2026, 2, 12, 3, 0, 0).getTime(); // 积压一夜
  const a = automation({ scheduleType: "interval", intervalMinutes: 30, nextRunAt: overnight });

  const rescheduled = rescheduleOverdueOnStart(a, THU_0900);
  assert.ok(rescheduled, "过期任务必须被顺延");
  assert.equal(rescheduled.nextRunAt, THU_0900 + 30 * 60_000);
  // 关键：不能是过去的时间戳，否则第一个 tick 就会触发 → 雪崩
  assert.ok(rescheduled.nextRunAt > THU_0900);

  // 没过期 / 已停用 / once 都不动
  assert.equal(rescheduleOverdueOnStart({ ...a, nextRunAt: THU_0900 + 1 }, THU_0900), null);
  assert.equal(rescheduleOverdueOnStart({ ...a, active: false, nextRunAt: overnight }, THU_0900), null);
  const once = automation({ scheduleType: "once", scheduledAt: overnight, nextRunAt: overnight });
  assert.equal(rescheduleOverdueOnStart(once, THU_0900), null, "once 保留过去值以便补跑一次");
});

test("isRunQuotaComplete：once 跑一次就完成，maxRuns 跑满就完成", () => {
  assert.equal(isRunQuotaComplete(automation({ scheduleType: "once" }), 1), true);
  assert.equal(isRunQuotaComplete(automation({ scheduleType: "once" }), 0), false);
  assert.equal(isRunQuotaComplete(automation({ scheduleType: "daily", maxRuns: 3 }), 3), true);
  assert.equal(isRunQuotaComplete(automation({ scheduleType: "daily", maxRuns: 3 }), 2), false);
  assert.equal(isRunQuotaComplete(automation({ scheduleType: "daily" }), 999), false);
});

test("listUpcomingRuns 的锚点与调度器实际写入的 nextRunAt 一致", () => {
  const a = automation({ scheduleType: "daily", timeOfDay: "09:00", nextRunAt: THU_0900 });
  assert.deepEqual(listUpcomingRuns(a, THU_0900, 3), [THU_0900, FRI_0900, SAT_0900]);
  const once = automation({ scheduleType: "once", scheduledAt: THU_1000, nextRunAt: THU_1000 });
  assert.deepEqual(listUpcomingRuns(once, THU_0900, 5), [THU_1000], "once 只展开一个点");
  // weekly 也逐档推进（一次跳 7 天）
  const weekly = automation({ scheduleType: "weekly", dayOfWeek: 2, timeOfDay: "09:00", nextRunAt: NEXT_MON_0900 });
  assert.deepEqual(listUpcomingRuns(weekly, THU_0900, 2), [NEXT_MON_0900, NEXT_TUE_0900]);
  // 过期（nextRunAt < from）时从「现在」重算，不把昨天那次当展示
  const overdue = automation({ scheduleType: "daily", timeOfDay: "09:00", nextRunAt: THU_0930 - 60_000 });
  assert.deepEqual(listUpcomingRuns(overdue, THU_1000, 1), [FRI_0900]);
});

// ---------------------------------------------------------------------------
const echo = (key, params) =>
  params
    ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(",")})`
    : key;

test("describeWeekdays 认得工作日 / 周末 / 每天 / 自定义", () => {
  assert.equal(describeWeekdays(undefined, echo), undefined);
  assert.equal(describeWeekdays([], echo), undefined);
  assert.equal(describeWeekdays([1, 2, 3, 4, 5], echo), "automation.weekdays.weekdays");
  assert.equal(describeWeekdays([0, 6], echo), "automation.weekdays.weekend");
  assert.equal(describeWeekdays([0, 1, 2, 3, 4, 5, 6], echo), "automation.weekdays.every");
  assert.equal(
    describeWeekdays([1, 3], echo),
    "automation.weekdays.summary(days=automation.weekday.1, automation.weekday.3)",
  );
});

test("describeSchedule 四种模式都产出一句人话", () => {
  assert.equal(describeSchedule(automation({ scheduleType: "daily", timeOfDay: "08:30" }), echo), "automation.schedule.daily(time=08:30)");
  assert.equal(
    describeSchedule(automation({ scheduleType: "weekly", dayOfWeek: 0, timeOfDay: "07:00" }), echo),
    "automation.schedule.weekly(weekday=automation.weekday.0,time=07:00)",
  );
  assert.match(describeSchedule(automation({ scheduleType: "once", scheduledAt: THU_1000 }), echo, "en"), /^automation\.schedule\.once\(when=/);
  assert.equal(
    describeSchedule(
      automation({
        scheduleType: "interval",
        intervalMinutes: 90,
        activeWeekdays: [1, 2, 3, 4, 5],
        activeWindowStart: "09:00",
        activeWindowEnd: "18:00",
      }),
      echo,
    ),
    "automation.schedule.interval(interval=automation.intervalMinutes(count=90))"
      + "automation.schedule.weekdaySuffix(days=automation.weekdays.weekdays)"
      + "automation.schedule.windowSuffix(start=09:00,end=18:00)",
  );
});