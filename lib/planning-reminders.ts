/**
 * fork:proma-44-planning — 提醒「该不该响」的判定（纯函数）。
 *
 * 这一层刻意**不碰** PR-43 的自动化调度器：那边管的是「定时跑一次 agent 会话」，
 * 队列、失败退避、无人值守权限全是它的事。这里的提醒是另一回事 —— 一次性的、
 * 用户自己排的、到点弹一条应用内通知。把两者放同一个调度器里，PR-43 的生命周期
 * 一变（暂停 / 重排 / 退避）就会连带改掉「明天早上九点提醒我开会」。所以这里只有
 * 一份纯判定 + 一个独立的短 tick 驱动器（`planning-reminder-scheduler.ts`）。
 *
 * 状态机只有三步，全部在这里：
 *
 *   pending ──到点──▶ pending(已通知, lastNotifiedAt) ──确认──▶ acknowledged
 *      │                                                        │
 *      └──稍后 N 分钟──▶ pending(snoozedUntil, 清 lastNotifiedAt)  └──目标完成──▶ completed
 *
 * 两个容易写错的地方有单测钉着：
 * - **已通知过的不重复响**。`lastNotifiedAt` 是「响过一次」的凭据；每次 tick 都重弹
 *   是最直白的 bug —— 用户点掉之前它会一直响。
 * - **稍后提醒要清 `lastNotifiedAt`**。否则推迟到 10 分钟后的那条永远不会再响。
 */

import type { PlanningReminder, PlanningState } from "./planning-types";

/** 稍后提醒的预设档（分钟）。 */
export const SNOOZE_MINUTES = [5, 15, 60] as const;

/** 实际触发时刻：稍后提醒优先于原定时刻。 */
export function reminderFireAt(reminder: PlanningReminder): number {
  return reminder.snoozedUntil ?? reminder.triggerAt;
}

/** 到点了、还没被处理、且这一轮还没响过 —— 调度器只取这一批。 */
export function dueReminders(reminders: readonly PlanningReminder[], now: number): PlanningReminder[] {
  return reminders
    .filter((reminder) => reminder.status === "pending" && reminderFireAt(reminder) <= now)
    .slice()
    .sort((a, b) => reminderFireAt(a) - reminderFireAt(b) || a.id.localeCompare(b.id));
}

/**
 * 常驻提醒条上显示的那一批。
 *
 * 与 `dueReminders` 的区别是**包含「今天之内将要响」的**：提醒条要预告，
 * 否则用户早上打开工作区根本不知道下午有事。这是 Proma `ActivePlanningReminder`
 * 的口径（未确认的提醒常驻显示）。
 */
export function upcomingReminders(
  reminders: readonly PlanningReminder[],
  now: number,
  horizonMs = 24 * 60 * 60_000,
): PlanningReminder[] {
  return reminders
    .filter((reminder) => reminder.status === "pending" && reminderFireAt(reminder) <= now + horizonMs)
    .slice()
    .sort((a, b) => reminderFireAt(a) - reminderFireAt(b) || a.id.localeCompare(b.id));
}

export interface ReminderTarget {
  type: "todo" | "calendar_event";
  title: string;
  /** 目标已不存在（被删掉）时提醒应随之消失；这里是纯查表，缺失就是缺失。 */
  found: boolean;
}

export function reminderTarget(state: PlanningState, reminder: PlanningReminder): ReminderTarget {
  if (reminder.targetType === "todo") {
    const todo = state.todos.find((item) => item.id === reminder.targetId);
    return { type: "todo", title: todo?.title ?? "", found: todo !== undefined };
  }
  const event = state.events.find((item) => item.id === reminder.targetId);
  return { type: "calendar_event", title: event?.title ?? "", found: event !== undefined };
}

export interface DisplayReminder {
  reminder: PlanningReminder;
  fireAt: number;
  due: boolean;
  notified: boolean;
  targetTitle: string;
  targetType: ReminderTarget["type"];
}

/** 提醒条渲染用的一行：提醒本体 + 目标标题（不让前端去 join 关系）。 */
export function displayReminders(state: PlanningState, now: number, horizonMs?: number): DisplayReminder[] {
  const list = horizonMs === undefined
    ? dueReminders(state.reminders, now)
    : upcomingReminders(state.reminders, now, horizonMs);
  const out: DisplayReminder[] = [];
  for (const reminder of list) {
    const target = reminderTarget(state, reminder);
    if (!target.found) continue;
    out.push({
      reminder,
      fireAt: reminderFireAt(reminder),
      due: reminderFireAt(reminder) <= now,
      notified: reminder.lastNotifiedAt !== undefined,
      targetTitle: target.title,
      targetType: target.type,
    });
  }
  return out;
}
