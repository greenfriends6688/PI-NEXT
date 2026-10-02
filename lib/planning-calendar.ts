/**
 * fork:proma-44-planning — 日历格计算（纯函数，**不引任何日期库**）。
 *
 * 硬约束：不许加依赖，所以 moment / dayjs / date-fns 一个都不来。原生 `Date` 的
 * 三个坑在这里各有一处显式处理，写在这里免得后来者重新踩：
 *
 * 1. **「同一天」按本地时区判**。`Date` 的 `getDate()` / `getMonth()` / `getFullYear()`
 *    本来就是本地时区口径，所以本模块所有日界都用 `new Date(y, m, d)` 这样的**本地
 *    构造器**，不用 `setUTCDate` / `toISOString().slice(0,10)`。后者会把 UTC+8 的
 *    「周一凌晨」算成周日 —— 这是所有自研日历最常见的一处 off-by-one。
 * 2. **加月必须锚到 1 号**。`setMonth(getMonth() + 1)` 在 1/31 上会溢出成 3/3
 *    （2 月只有 28 天），所以本模块的「上/下个月」统一先 `new Date(y, m ± 1, 1)`。
 * 3. **加天走 `setDate`**。加 1 天在夏令时切换日不等于 +86400000 ms；用
 *    `setDate(getDate() + n)` 由 `Date` 自己处理偏移。
 *
 * 布局（周视图时间轴的列分配）也在这里，因为它是纯几何：给定一列日程条目与
 * 该日的时间窗，输出每条的 `topPct` / `heightPct` 与并排的 `column` / `columns`。
 * 百分比而不是像素，前端只要把 `--fork-plan-top` 这类自定义属性塞进 style 即可，
 * 内联样式里不会出现写死的几何数字（`scripts/check-style-literals.mjs` 的门）。
 */

/** 周视图一屏显示的时间窗（本地小时，含端点）。 */
export const DAY_WINDOW_START_HOUR = 7;
export const DAY_WINDOW_END_HOUR = 22;

function toDate(value: number | Date): Date {
  return value instanceof Date ? new Date(value.getTime()) : new Date(value);
}

/** 本地当天 00:00:00.000 的时间戳。 */
export function startOfLocalDay(value: number | Date): number {
  const date = toDate(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** 本地当天 23:59:59.999 的时间戳（闭区间上界用）。 */
export function endOfLocalDay(value: number | Date): number {
  const date = toDate(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
}

/** 同一个自然日吗（本地时区）。判「今天 / 逾期 / 落在这一格」全走它。 */
export function isSameLocalDay(left: number | Date, right: number | Date): boolean {
  const a = toDate(left);
  const b = toDate(right);
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function addLocalDays(value: number | Date, amount: number): number {
  const date = toDate(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount).getTime();
}

/** 加月，锚在当月 1 号，1/31 + 1 月 = 2/1 而不是 3/3。 */
export function addLocalMonths(value: number | Date, amount: number): number {
  const date = toDate(value);
  return new Date(date.getFullYear(), date.getMonth() + amount, 1).getTime();
}

export function startOfLocalMonth(value: number | Date): number {
  const date = toDate(value);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** 本月第一天是周几（0 = 周日 … 6 = 周六）。 */
export function firstWeekdayOfLocalMonth(value: number | Date): number {
  return toDate(value).getDay();
}

/** `weekStartsOn` 口径下的一周起点。默认周一（与 Proma 的 `(getDay() + 6) % 7` 一致）。 */
export function startOfLocalWeek(value: number | Date, weekStartsOn = 1): number {
  const day = startOfLocalDay(value);
  const weekday = toDate(day).getDay();
  const offset = (weekday - weekStartsOn + 7) % 7;
  return addLocalDays(day, -offset);
}

export function daysInLocalMonth(value: number | Date): number {
  const date = toDate(value);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export interface CalendarCell {
  /** 该格对应日期的本地 00:00。 */
  start: number;
  /** 月视图里当月的几号（补白格为真实日期，便于 hover / 键盘导航）。 */
  dayOfMonth: number;
  inMonth: boolean;
  isToday: boolean;
}

export interface MonthGrid {
  /** 网格第一格（可能在上个月）。 */
  start: number;
  /** 整月的周数 = 格数 / 7。 */
  weekCount: number;
  cells: CalendarCell[];
}

function toCell(value: number, today: number): CalendarCell {
  const date = toDate(value);
  return {
    start: value,
    dayOfMonth: date.getDate(),
    inMonth: true,
    isToday: isSameLocalDay(value, today),
  };
}

/**
 * 月视图的格阵。
 *
 * `lead = (当月 1 号的 getDay() - weekStartsOn + 7) % 7` 是当月 1 号前面要补几格；
 * 总格数向上取整到 7 的倍数，保证最后一行是完整的一周（不裁掉 30/31 号）。
 * 补白格直接用 `new Date(y, m, 0)` / `new Date(y, m + 1, d)` 让 `Date` 自己滚月，
 * 不在这里手算「上个月有几号」。
 */
export function buildMonthGrid(cursor: number, now: number, weekStartsOn = 1): MonthGrid {
  const anchor = toDate(startOfLocalMonth(cursor));
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const days = new Date(year, month + 1, 0).getDate();
  const lead = (anchor.getDay() - weekStartsOn + 7) % 7;
  const weekCount = Math.ceil((lead + days) / 7);
  const cells: CalendarCell[] = [];
  for (let index = 0; index < weekCount * 7; index += 1) {
    const offset = index - lead + 1;
    const start = new Date(year, month, offset).getTime();
    cells.push({
      ...toCell(start, now),
      inMonth: offset >= 1 && offset <= days,
    });
  }
  return { start: cells[0]?.start ?? 0, weekCount, cells };
}

export interface WeekGrid {
  start: number;
  days: number[];
}

/** 一周七天的本地 00:00。 */
export function buildWeekGrid(weekStart: number): WeekGrid {
  const start = startOfLocalWeek(weekStart);
  return { start, days: Array.from({ length: 7 }, (_, index) => addLocalDays(start, index)) };
}

// ---------------------------------------------------------------------------
// 日程在某一天的落位
// ---------------------------------------------------------------------------

export interface CalendarItemLike {
  id: string;
  startAt: number;
  endAt?: number;
  allDay?: boolean;
}

/** 没有结束时间的日程按多久算（周视图里必须有个高度）。 */
export const DEFAULT_EVENT_DURATION_MS = 60 * 60_000;

/** 全天日程铺满整天；定时日程缺 endAt 时按默认时长兜底。 */
export function eventEndAt(item: CalendarItemLike): number {
  if (item.allDay) return endOfLocalDay(item.startAt);
  if (item.endAt !== undefined && item.endAt > item.startAt) return item.endAt;
  return item.startAt + DEFAULT_EVENT_DURATION_MS;
}

/** 跨天日程在每一格都出现（`start <= dayEnd && end >= dayStart`）。 */
export function itemOccursOnDay(item: CalendarItemLike, dayStart: number): boolean {
  return item.startAt <= endOfLocalDay(dayStart) && eventEndAt(item) >= startOfLocalDay(dayStart);
}

export function itemsOnDay<T extends CalendarItemLike>(items: readonly T[], dayStart: number): T[] {
  return items.filter((item) => itemOccursOnDay(item, dayStart));
}

// ---------------------------------------------------------------------------
// 周视图时间轴的列分配
// ---------------------------------------------------------------------------

export interface DaySegment<T> {
  item: T;
  /** 0 起；与同列的前一条重叠时 +1。 */
  column: number;
  /** 本条参与的最宽列数（该重叠簇的总列数）。 */
  columns: number;
  /** 距时间窗顶部的百分比，0–100。 */
  topPct: number;
  /** 占时间窗高度的百分比，0–100。 */
  heightPct: number;
}

export interface DayWindow {
  start: number;
  end: number;
}

export function dayWindow(dayStart: number): DayWindow {
  return {
    start: new Date(toDate(dayStart).getFullYear(), toDate(dayStart).getMonth(), toDate(dayStart).getDate(), DAY_WINDOW_START_HOUR).getTime(),
    end: new Date(toDate(dayStart).getFullYear(), toDate(dayStart).getMonth(), toDate(dayStart).getDate(), DAY_WINDOW_END_HOUR).getTime(),
  };
}

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/**
 * 把一天里的条目排成互不遮挡的竖列。
 *
 * 做法照 Proma 的 `getTimedSegments` 收窄成两段：
 *
 * 1. **按开始时间排序后贪心放列** —— 逐条找第一个放得下它的列（`end <= 该列最后
 *    一条的 end`）。不用全量二分图匹配：真实日程的重叠规模是「同一小时两三条」，
 *    贪心在这个量级与最优解同形，而全量匹配是个没人读得懂的算法。
 * 2. **按重叠簇结算列宽** —— 一条与当前簇里**最晚**结束的那条都不重叠时收束本簇。
 *    簇宽决定这一簇切成几份；不这么做的话，「上午两两重叠」会把当天傍晚那条独苗
 *    也压成半格宽。
 *
 * 全天日程不进时间轴（周视图另有全天行）；跨天且 `allDay` 为 false 的条目按
 * `[dayStart, dayEnd]` 裁剪，于是「昨天 22:00 到今天 02:00」在今天这格里只画
 * 落在时间窗内的那一段。
 */
export function layoutDaySegments<T extends CalendarItemLike>(
  items: readonly T[],
  dayStart: number,
  window: DayWindow = dayWindow(dayStart),
): DaySegment<T>[] {
  const span = Math.max(1, window.end - window.start);
  const dayEnd = endOfLocalDay(dayStart);
  const dayFirst = startOfLocalDay(dayStart);
  const timed = items
    .filter((item) => !item.allDay && item.startAt < dayEnd && eventEndAt(item) > dayFirst)
    .slice()
    .sort((a, b) => a.startAt - b.startAt || a.id.localeCompare(b.id));

  interface Placed { item: T; start: number; end: number; column: number; cluster: number }
  const placed: Placed[] = [];
  const clusterEnds: number[] = [];
  let cluster = -1;
  let runningMax = -Infinity;

  for (const item of timed) {
    const start = clamp(item.startAt, window.start, window.end);
    const end = clamp(eventEndAt(item), window.start, window.end);
    if (clusterEnds.length && start >= runningMax) {
      clusterEnds.length = 0;              // 收束上一簇，列号从 0 重新排
      cluster += 1;
      runningMax = -Infinity;
    }
    if (cluster === -1) cluster = 0;
    let column = clusterEnds.findIndex((columnEnd) => end <= columnEnd);
    if (column === -1) {
      column = clusterEnds.length;
      clusterEnds.push(end);
    } else {
      clusterEnds[column] = end;
    }
    runningMax = Math.max(runningMax, end);
    placed.push({ item, start, end, column, cluster });
  }

  const widths: number[] = [];
  for (const entry of placed) {
    widths[entry.cluster] = Math.max(widths[entry.cluster] ?? 0, entry.column + 1);
  }

  return placed.map((entry) => {
    const topPct = ((entry.start - window.start) / span) * 100;
    // 整条都落在时间窗外时会算出 0 高；给一个最小可见高度，否则那一条「消失」。
    const rawHeight = ((entry.end - entry.start) / span) * 100 || (DEFAULT_EVENT_DURATION_MS / span) * 100;
    return {
      item: entry.item,
      column: entry.column,
      columns: widths[entry.cluster] ?? 1,
      topPct: clampPercent(topPct),
      heightPct: clampPercent(Math.min(100 - topPct, rawHeight)),
    };
  });
}

function clampPercent(value: number): number {
  return value < 0 ? 0 : value > 100 ? 100 : value;
}

/** 逾期 / 今天 / 未来 三种口径，纯读 dueAt，供列表用色。 */
export type DueTone = "overdue" | "today" | "upcoming" | "none";

export function dueTone(dueAt: number | undefined, now: number): DueTone {
  if (dueAt === undefined) return "none";
  if (dueAt < startOfLocalDay(now)) return "overdue";
  if (isSameLocalDay(dueAt, now)) return "today";
  return "upcoming";
}
