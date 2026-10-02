"use client";

import { useI18n } from "@/hooks/useI18n";
import { isSameLocalDay } from "@/lib/planning-calendar";
import type { DisplayReminder } from "@/lib/planning-reminders";

/*
 * fork:proma-44-planning —— 常驻提醒条。
 *
 * 显示未来 24 小时内未确认的提醒（不只是「已经到点的」）—— 与 Proma 的
 * `ActivePlanningReminder` 同一口径：不预告的话，用户早上打开工作区根本不知道
 * 下午有事。
 *
 * 三档状态在这一行上必须分得开（这是它最容易糊掉的地方）：
 *   due && !notified  → 红：刚到点、还没响过
 *   due &&  notified  → 橙：响过了、用户还没点掉
 *   !due              → 灰：预告
 * 混成一档的话，「已经响过、还在等你确认」和「还没到」会长得一模一样。
 *
 * 确认 / 稍后都由父组件发 op（`planning-state.ts` 里改状态并回传整份快照）。
 */

interface Props {
  reminders: DisplayReminder[];
  now: number;
  onAcknowledge: (reminder: DisplayReminder) => void;
  onSnooze: (reminder: DisplayReminder, minutes: number) => void;
  onOpen: (reminder: DisplayReminder) => void;
}

function formatFireAt(fireAt: number, now: number, locale: string): string {
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(fireAt));
  return isSameLocalDay(fireAt, now) ? time : `${new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" }).format(new Date(fireAt))} ${time}`;
}

export function PlanningReminderRail({ reminders, now, onAcknowledge, onSnooze, onOpen }: Props) {
  const { t, locale } = useI18n();
  if (reminders.length === 0) return null;

  return (
    <div className="fork-plan-rail" role="status" aria-label={t("planning.reminder.rail")}>
      {reminders.map((row) => {
        // 三档必须分得开：红 = 刚到点还没响过，橙 = 响过了等你确认，灰 = 还没到。
        const tone = row.due ? (row.notified ? "is-fired" : "is-due") : "";
        return (
          <span key={row.reminder.id} className={`fork-plan-reminder ${tone}`}>
            <button
              type="button"
              className="fork-plan-reminder-main"
              onClick={() => onOpen(row)}
              title={t("planning.reminder.open")}
            >
              <span className="pw-ico"><i data-ico="bell" data-size="11"></i></span>
              <span className="fork-plan-reminder-title">{row.targetTitle}</span>
              <span className="fork-plan-mono">{formatFireAt(row.fireAt, now, locale)}</span>
            </button>
            <button
              type="button"
              className="fork-plan-reminder-act"
              onClick={() => onSnooze(row, 10)}
              title={t("planning.reminder.snooze")}
            >
              <span className="pw-ico"><i data-ico="clock" data-size="11"></i></span>
            </button>
            <button
              type="button"
              className="fork-plan-reminder-act"
              onClick={() => onAcknowledge(row)}
              title={t("planning.reminder.ack")}
            >
              <span className="pw-ico"><i data-ico="check" data-size="11"></i></span>
            </button>
          </span>
        );
      })}
    </div>
  );
}
