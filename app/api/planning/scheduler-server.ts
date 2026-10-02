/**
 * fork:proma-44-planning —— 提醒 tick 的**服务端接线**（读盘 + 写回 + 单例启动）。
 *
 * 驱动器本身（`lib/planning-reminder-scheduler.ts`）不含 `fs`，所以它可以被任何
 * 一边 import；读盘那半在这里，只被 `/api/planning/reminders` 引用。这条边界是
 * `lib/client-graph-purity.test.mjs` 强制的 —— 客户端组件一旦间接拖进
 * `lib/planning-store.ts` 就等于把 `node:fs` 拖进浏览器包，build 才报错。
 *
 * 由**路由**在模块加载时启动，而不是让客户端去启动：提醒 tick 的生命周期因此就是
 * 「有人正在看工作区」的时长，不多不少。
 */

import { mutatePlanningState, readPlanningState } from "@/lib/planning-store";
import { dueReminders, reminderTarget, type DisplayReminder } from "@/lib/planning-reminders";
import { startPlanningReminderScheduler, type ReminderSchedulerHandle } from "@/lib/planning-reminder-scheduler";

/** 只读，所以**不**走 `mutatePlanningState` —— 那是读改写，用在这里等于每 30 秒把
 *  整个库原样写回一次，纯浪费还多一个与用户操作的竞争窗口。 */
export async function collectDueReminders(now: number): Promise<DisplayReminder[]> {
  const state = readPlanningState();
  const due = dueReminders(state.reminders, now).filter((reminder) => reminder.lastNotifiedAt === undefined);
  const out: DisplayReminder[] = [];
  for (const reminder of due) {
    const target = reminderTarget(state, reminder);
    if (!target.found) continue;   // 目标被删掉的提醒不弹
    out.push({
      reminder,
      fireAt: reminder.snoozedUntil ?? reminder.triggerAt,
      due: true,
      notified: false,
      targetTitle: target.title,
      targetType: target.type,
    });
  }
  return out;
}

export async function markRemindersNotified(ids: string[], now: number): Promise<void> {
  if (ids.length === 0) return;
  await mutatePlanningState((state) => {
    for (const id of ids) {
      const reminder = state.reminders.find((item) => item.id === id);
      if (!reminder || reminder.status !== "pending") continue;
      reminder.lastNotifiedAt = now;
      reminder.updatedAt = now;
    }
  });
}

let handle: ReminderSchedulerHandle | null = null;

/** 幂等：重复调用拿到同一个 handle（`startPlanningReminderScheduler` 内部也是单例）。 */
export function ensurePlanningReminderScheduler(): ReminderSchedulerHandle {
  handle ??= startPlanningReminderScheduler({
    collect: collectDueReminders,
    markNotified: markRemindersNotified,
  });
  return handle;
}
