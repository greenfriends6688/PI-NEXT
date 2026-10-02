"use client";

import type { CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  DAY_WINDOW_END_HOUR,
  DAY_WINDOW_START_HOUR,
  buildMonthGrid,
  buildWeekGrid,
  dayWindow,
  endOfLocalDay,
  itemsOnDay,
  layoutDaySegments,
  startOfLocalDay,
} from "@/lib/planning-calendar";
import type { PlanningEventView } from "@/lib/planning-view";

/*
 * fork:proma-44-planning —— 周 / 月视图（**静态渲染，不引任何日历库**）。
 *
 * 格阵与时间轴列分配都在 `lib/planning-calendar.ts`（纯函数，有单测，在
 * Asia/Shanghai / New_York / Berlin / Auckland 四个时区下都跑过）。这里只做两件事：
 * 把算好的百分比塞进局部自定义属性、把数字画出来。
 *
 * 百分比走自定义属性而不是 `style={{ top: "37%" }}`：写死的内联几何数字是
 * `scripts/check-style-literals.mjs` 的门禁项，而这四条规则的消费端在 CSS 里，
 * 组件中一个几何数字都不写。
 */

export type PlanningCalendarMode = "week" | "month";

interface Props {
  mode: PlanningCalendarMode;
  cursor: number;
  now: number;
  events: PlanningEventView[];
  onModeChange: (mode: PlanningCalendarMode) => void;
  onNavigate: (amount: number) => void;
  onToday: () => void;
  onNewEventAt: (startAt: number) => void;
  onSelectEvent: (event: PlanningEventView) => void;
}

/** 索引 0 = 周一（格阵的 `weekStartsOn` 口径就是 1）。 */
const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
/** 补白格点「新建」时给的默认时刻：上午 9 点。 */
const DEFAULT_NEW_HOUR = 9;

function formatTime(value: number): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function weekdayKeyOf(value: number): string {
  return WEEKDAY_KEYS[(new Date(value).getDay() + 6) % 7];
}

function rangeLabel(from: number, to: number): string {
  const a = new Date(from);
  const b = new Date(to);
  const month = new Intl.DateTimeFormat(undefined, { month: "short" }).format(a);
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  return sameMonth
    ? `${month} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`
    : `${month} ${a.getDate()} – ${new Intl.DateTimeFormat(undefined, { month: "short" }).format(b)} ${b.getDate()}, ${b.getFullYear()}`;
}

/** 周视图的标题 = 这一周的首尾两天（走 `buildWeekGrid` 的同一套口径，别自己加 6 天）。 */
function weekRangeLabel(cursor: number): string {
  const week = buildWeekGrid(cursor);
  return rangeLabel(week.start, endOfLocalDay(week.days[6]));
}

function monthLabel(cursor: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(cursor));
}

function ModeSwitch({ mode, onModeChange }: { mode: PlanningCalendarMode; onModeChange: (mode: PlanningCalendarMode) => void }) {
  const { t } = useI18n();
  return (
    <div className="fork-plan-segmented" role="tablist" aria-label={t("planning.calendar.mode")}>
      {(["week", "month"] as const).map((item) => (
        <button
          key={item}
          type="button"
          role="tab"
          aria-selected={mode === item}
          data-active={mode === item}
          onClick={() => onModeChange(item)}
        >
          {t(`planning.calendar.${item}`)}
        </button>
      ))}
    </div>
  );
}

function MonthView({ cursor, now, events, onSelectEvent, onNewEventAt }: {
  cursor: number; now: number; events: PlanningEventView[];
  onSelectEvent: (event: PlanningEventView) => void;
  onNewEventAt: (startAt: number) => void;
}) {
  const { t } = useI18n();
  const grid = buildMonthGrid(cursor, now);
  return (
    <>
      <div className="fork-plan-cal-week" aria-hidden="true">
        {WEEKDAY_KEYS.map((key) => <div key={key}>{t(`planning.weekday.${key}`)}</div>)}
      </div>
      <div className="fork-plan-cal-grid" style={{ "--fork-plan-cal-weeks": grid.weekCount } as CSSProperties}>
        {grid.cells.map((cell) => {
          const dayEvents = itemsOnDay(events, cell.start);
          return (
            <div
              key={cell.start}
              className={`fork-plan-cal-cell${cell.inMonth ? "" : " is-out"}${cell.isToday ? " is-today" : ""}`}
            >
              <button
                type="button"
                className="fork-plan-cal-daynum"
                onClick={() => onNewEventAt(cell.start + DEFAULT_NEW_HOUR * 3_600_000)}
                title={t("planning.calendar.newHere")}
              >
                {cell.dayOfMonth}
              </button>
              <div className="fork-plan-cal-items">
                {dayEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className={`fork-plan-cal-item${event.allDay ? " is-all-day" : ""}`}
                    title={event.title}
                    onClick={() => onSelectEvent(event)}
                  >
                    {event.allDay ? "" : `${formatTime(event.startAt)} `}{event.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function WeekView({ cursor, now, events, onSelectEvent, onNewEventAt }: {
  cursor: number; now: number; events: PlanningEventView[];
  onSelectEvent: (event: PlanningEventView) => void;
  onNewEventAt: (startAt: number) => void;
}) {
  const { t } = useI18n();
  const week = buildWeekGrid(cursor);
  const window = dayWindow(week.start);
  const hours = Array.from(
    { length: DAY_WINDOW_END_HOUR - DAY_WINDOW_START_HOUR },
    (_, index) => DAY_WINDOW_START_HOUR + index,
  );
  const today = startOfLocalDay(now);

  return (
    <>
      <div className="fork-plan-cal-week" aria-hidden="true">
        {week.days.map((day) => (
          <div key={day} className={startOfLocalDay(day) === today ? "is-today" : undefined}>
            {t(`planning.weekday.${weekdayKeyOf(day)}`)} {new Date(day).getDate()}
          </div>
        ))}
      </div>

      <div className="fork-plan-allday" aria-label={t("planning.calendar.allDay")}>
        {week.days.map((day) => (
          <div key={day}>
            <button
              type="button"
              className="fork-plan-cal-add"
              onClick={() => onNewEventAt(day)}
              title={t("planning.calendar.newHere")}
            >
              <span className="pw-ico"><i data-ico="plus" data-size="11"></i></span>
            </button>
            {events
              .filter((event) => event.allDay && itemsOnDay([event], day).length > 0)
              .map((event) => (
                <button
                  key={event.id}
                  type="button"
                  className="fork-plan-cal-item is-all-day"
                  title={event.title}
                  onClick={() => onSelectEvent(event)}
                >
                  {event.title}
                </button>
              ))}
          </div>
        ))}
      </div>

      <div className="fork-plan-time">
        <div className="fork-plan-time-gutter" aria-hidden="true">
          {hours.map((hour) => (
            <p key={hour} className="fork-plan-time-hour">
              {String(hour).padStart(2, "0")}:00
            </p>
          ))}
        </div>
        {week.days.map((day) => (
          <div key={day} className="fork-plan-time-col">
            {hours.map((hour) => (
              <div key={hour} className="fork-plan-time-row" />
            ))}
            {layoutDaySegments(events, day, window).map((segment) => (
              <button
                key={segment.item.id}
                type="button"
                className="fork-plan-time-seg"
                title={`${formatTime(segment.item.startAt)} ${segment.item.title}`}
                style={{
                  "--fork-plan-top": `${segment.topPct}%`,
                  "--fork-plan-height": `${segment.heightPct}%`,
                  "--fork-plan-left": `${(segment.column / segment.columns) * 100}%`,
                  "--fork-plan-width": `${(1 / segment.columns) * 100}%`,
                } as CSSProperties}
                onClick={() => onSelectEvent(segment.item)}
              >
                <span className="fork-plan-time-seg-label">
                  {formatTime(segment.item.startAt)} {segment.item.title}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

export function PlanningCalendar({
  mode,
  cursor,
  now,
  events,
  onModeChange,
  onNavigate,
  onToday,
  onNewEventAt,
  onSelectEvent,
}: Props) {
  const { t } = useI18n();
  return (
    <div
      className="fork-plan-cal"
      // 时间窗的小时数交给 CSS 算列高：组件里不写 `--fork-plan-*` 的默认值，
      // 免得两处各有一份（改 DAY_WINDOW_* 时忘了改 CSS 就会错位一小时）。
      style={{
        "--fork-plan-start-hour": DAY_WINDOW_START_HOUR,
        "--fork-plan-end-hour": DAY_WINDOW_END_HOUR,
      } as CSSProperties}
    >
      <div className="fork-plan-cal-bar">
        <button
          type="button"
          className="pw-iconbtn"
          onClick={() => onNavigate(mode === "week" ? -7 : -1)}
          aria-label={t("planning.calendar.prev")}
        >
          <span className="pw-ico"><i data-ico="chevron-left" data-size="14"></i></span>
        </button>
        <span className="fork-plan-cal-title">
          {mode === "week" ? weekRangeLabel(cursor) : monthLabel(cursor)}
        </span>
        <button
          type="button"
          className="pw-iconbtn"
          onClick={() => onNavigate(mode === "week" ? 7 : 1)}
          aria-label={t("planning.calendar.next")}
        >
          <span className="pw-ico"><i data-ico="chevron-right" data-size="14"></i></span>
        </button>
        <span className="grow" />
        <button type="button" className="pw-btn sm outline" onClick={onToday}>{t("planning.calendar.today")}</button>
        <ModeSwitch mode={mode} onModeChange={onModeChange} />
      </div>

      {mode === "week" ? (
        <WeekView cursor={cursor} now={now} events={events} onSelectEvent={onSelectEvent} onNewEventAt={onNewEventAt} />
      ) : (
        <MonthView cursor={cursor} now={now} events={events} onSelectEvent={onSelectEvent} onNewEventAt={onNewEventAt} />
      )}
    </div>
  );
}
