// fork:proma-43-automation —— 调度算术（纯函数，时间全部由入参 `from` 注入）。
/**
 * 「下次什么时候跑」的**唯一**权威算法。
 *
 * 全文件不读时钟、不碰 fs：`computeNextRunAt(automation, from)` 的 `from` 由调用方注入，
 * 所以单测里可以把「现在」拨到任意时刻验证跨日 / 跨周 / 窗口边界，
 * 不需要真的等（也就不会写出 `await sleep(…)` 这种测试）。
 *
 * 关键取舍：
 *
 * 1. **一次只算下一个点**，不预展开整段时间窗。展开出来的锚点必须和调度器实际写入
 *    `nextRunAt` 的值逐位一致，否则面板上「未来三次」和真跑的时间会慢慢分叉。
 *    需要预展开就反复调 `computeNextRunAt`（见 `listUpcomingRuns`）。
 * 2. **interval 的锚点是「窗口起点」而不是「上一次实际触发时刻」**。若用后者，
 *    一轮跑了 4 分钟，下一次就从 +4 分钟处起算，`10:00 / 10:20 / …` 会被推成
 *    `10:04 / 10:24 / …`，几轮之后彻底漂走。
 * 3. **daily / weekly 用本地日历推进**，保留 `timeOfDay` 的 hh:mm，DST 切换当天不会漂。
 * 4. 「同一自然日」一律用 `getFullYear/getMonth/getDate` 取本地时区，
 *    不引时区库（规则三）：这个产品只在用户自己的机器上跑，UTC 偏移对它没有意义。
 */
import type { Automation } from "./automation-types";

/** 计算失败时的兜底间隔（10 分钟）—— 宁可跑得不准，也不要把任务卡成永不再触发。 */
const FALLBACK_INTERVAL_MS = 10 * 60_000;

/** 一次「跑满窗口」的迭代上限，防止配置写错时死循环。 */
const MAX_WEEKDAY_SCAN_DAYS = 8;

/**
 * 两个时间戳是否落在**同一个本地自然日**（规则三）。
 *
 * 刻意不引时区库、不做 `toISOString().slice(0,10)`：后者拿到的是 UTC 日期，
 * 东八区本地 08:00 前会被算成前一天，`daily` 档会在早上误判「跨日了」而多开一个会话。
 */
export function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate()
  );
}

function parseClockMinutes(value: string | undefined): number | undefined {
  if (!value || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return undefined;
  const [hours, minutes] = value.split(":").map(Number);
  return hours! * 60 + minutes!;
}

function normalizedWeekdays(automation: Automation): number[] {
  const raw = automation.activeWeekdays ?? [];
  return [...new Set(raw.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
}

function isAllowedDay(date: Date, weekdays: number[]): boolean {
  return weekdays.length === 0 || weekdays.includes(date.getDay());
}

/** 从 `from` 起找下一个允许运行的日子（保留时分秒），最多往后找一周。 */
function nextAllowedDayAt(from: Date, weekdays: number[]): Date {
  const next = new Date(from);
  for (let i = 0; i < MAX_WEEKDAY_SCAN_DAYS; i++) {
    if (i > 0) next.setDate(next.getDate() + 1);
    if (isAllowedDay(next, weekdays)) return next;
  }
  return next;
}

function startOfLocalWindow(from: Date, windowMinutes: number): Date {
  const start = new Date(from);
  start.setHours(Math.floor(windowMinutes / 60), windowMinutes % 60, 0, 0);
  return start;
}

/** 字段子集：让纯函数不必依赖完整的 `Automation`（测试里可以只给几个字段）。 */
export type AutomationScheduleFields = Pick<Automation, "scheduleType" | "nextRunAt"> & Partial<
  Pick<
    Automation,
    | "intervalMinutes"
    | "activeWindowStart"
    | "activeWindowEnd"
    | "activeWeekdays"
    | "timeOfDay"
    | "dayOfWeek"
    | "scheduledAt"
  >
>;

export interface ComputeNextRunAtOptions {
  /**
   * `true` = 返回**不早于** `from` 的下一个点（正好落在 `from` 上也算）。
   * 面向「现在就要落一条新任务 / 改配置」：用户把时刻设成 09:00、而现在恰好是 09:00，
   * 严格大于的算法会直接跳过今天这一轮，那条任务要等一整天才第一次跑。
   * 调度循环那边**必须**用默认的严格大于，否则 `nextRunAt <= now` 与它互相错开一拍。
   */
  inclusive?: boolean;
}

/**
 * 从基准时刻 `from` 起算的下次触发时间戳。
 *
 * - `once`：永远返回固定的 `scheduledAt`，不随 `from` 前进。**即使它已经过去**
 *   （重启后恢复）也原样返回 —— 让下一个 tick 补跑一次，跑完由 `applyRunOutcome`
 *   自动停用。这正是「该跑没跑就补上」的期望；把它推成「未来」等于悄悄丢掉一次任务。
 * - `interval`：`from + 间隔`，再按运行日 / 每日窗口修正（见文件头的锚点说明）。
 * - `daily` / `weekly`：本地日历上今天 / 本周（或下周）的 `timeOfDay`，已过则进一档。
 *
 * 返回值保证是有限正整数；输入非法时回退到 `from + 10min`。
 */
export function computeNextRunAt(
  automation: AutomationScheduleFields,
  from: number,
  options: ComputeNextRunAtOptions = {},
): number {
  const tooEarly = (candidate: number): boolean => (options.inclusive ? candidate < from : candidate <= from);
  let result: number;

  if (automation.scheduleType === "once") {
    result = Number.isFinite(automation.scheduledAt) && automation.scheduledAt! > 0
      ? automation.scheduledAt!
      : from + FALLBACK_INTERVAL_MS;
  } else if (automation.scheduleType === "interval") {
    const minutes = Number(automation.intervalMinutes);
    if (!Number.isFinite(minutes) || minutes < 1) {
      result = from + FALLBACK_INTERVAL_MS;
    } else {
      const step = Math.round(minutes) * 60_000;
      const weekdays = normalizedWeekdays(automation as Automation);
      const windowStartMinutes = parseClockMinutes(automation.activeWindowStart);
      const windowEndMinutes = parseClockMinutes(automation.activeWindowEnd);
      const hasWindow = windowStartMinutes !== undefined
        && windowEndMinutes !== undefined
        && windowStartMinutes < windowEndMinutes;
      result = hasWindow
        ? nextIntervalInsideWindow(from, step, weekdays, windowStartMinutes!, windowEndMinutes!)
        : nextIntervalWithWeekdays(from, step, weekdays);
    }
  } else {
    const timeOfDay = automation.timeOfDay ?? "09:00";
    const parts = timeOfDay.split(":").map(Number);
    const hours = Number.isFinite(parts[0]) ? parts[0]! : 9;
    const minutes = Number.isFinite(parts[1]) ? parts[1]! : 0;
    const next = new Date(from);
    next.setSeconds(0, 0);
    next.setHours(hours, minutes, 0, 0);

    if (automation.scheduleType === "daily") {
      if (tooEarly(next.getTime())) next.setDate(next.getDate() + 1);
      result = next.getTime();
    } else {
      // weekly：dayOfWeek 缺省按周一（1）；0 是合法的「周日」，所以不能用 `?? 1` 之外的
      // 真值判断，这里显式判 undefined。
      const targetDay = Number.isFinite(automation.dayOfWeek) ? automation.dayOfWeek! : 1;
      let dayDiff = (targetDay - next.getDay() + 7) % 7;
      if (dayDiff === 0 && tooEarly(next.getTime())) dayDiff = 7;
      next.setDate(next.getDate() + dayDiff);
      result = next.getTime();
    }
  }

  if (!Number.isFinite(result) || result <= 0) return from + FALLBACK_INTERVAL_MS;
  return result;
}

/** interval + 每日窗口：以「当天窗口起点」为锚点等距推进，跨窗口跳到下一个运行日的窗口起点。 */
function nextIntervalInsideWindow(
  from: number,
  step: number,
  weekdays: number[],
  windowStartMinutes: number,
  windowEndMinutes: number,
): number {
  const windowStart = startOfLocalWindow(new Date(from), windowStartMinutes);
  const windowEnd = startOfLocalWindow(new Date(from), windowEndMinutes);

  // 今天不是运行日，或已经走出今天的窗口 → 直接跳到下一个运行日的窗口起点。
  if (!isAllowedDay(windowStart, weekdays) || from >= windowEnd.getTime()) {
    const base = new Date(windowStart);
    if (from >= windowEnd.getTime()) base.setDate(base.getDate() + 1);
    const allowed = nextAllowedDayAt(base, weekdays);
    return startOfLocalWindow(allowed, windowStartMinutes).getTime();
  }

  // 还没进今天的窗口 → 窗口起点。
  if (from < windowStart.getTime()) return windowStart.getTime();

  // 在窗口里：锚点是窗口起点，floor 保证不会因为执行耗时而逐轮往后漂。
  const elapsed = from - windowStart.getTime();
  const candidate = windowStart.getTime() + (Math.floor(elapsed / step) + 1) * step;
  if (candidate < windowEnd.getTime()) return candidate;

  const nextDay = new Date(windowStart);
  nextDay.setDate(nextDay.getDate() + 1);
  return startOfLocalWindow(nextAllowedDayAt(nextDay, weekdays), windowStartMinutes).getTime();
}

/** interval 不带窗口：等距推进，落到非运行日就跳到下一个运行日的同一钟点。 */
function nextIntervalWithWeekdays(from: number, step: number, weekdays: number[]): number {
  const candidate = from + step;
  if (isAllowedDay(new Date(candidate), weekdays)) return candidate;
  const current = new Date(from);
  const next = nextAllowedDayAt(new Date(candidate), weekdays);
  // 保留原来的钟点：周五 23:50 + 20min 落到周六 00:10 → 跳到下周一 00:10，而不是周一 00:30。
  next.setHours(current.getHours(), current.getMinutes(), current.getSeconds(), current.getMilliseconds());
  return next.getTime();
}

/**
 * 启动恢复：把所有**已过期**的周期任务顺延到「现在 + 一个完整间隔」—— 规则二。
 *
 * 为什么：进程停一夜 / 关机一天后开机，`nextRunAt` 会集体堆在昨天。修长 interval
 * 的话第一轮 tick 会一次性触发全部到期任务（每轮都是真金白银的模型调用），
 * 开机瞬间就被雪崩埋掉。顺延之后，它们会在接下来的一整个间隔内**分散**跑完。
 *
 * `once` 例外：它没有「下一个间隔」，把过去的时间戳推到未来等于把这个任务悄悄改成
 * 「永不到期」。所以 once 保持原值，让 tick 补跑一次然后自动停用（最多补一轮，不构成雪崩）。
 *
 * 返回要写回的 automation；无需改动时返回 null。
 */
export function rescheduleOverdueOnStart(automation: Automation, now: number): Automation | null {
  if (!automation.active) return null;
  if (!Number.isFinite(automation.nextRunAt) || automation.nextRunAt > now) return null;
  if (automation.scheduleType === "once") return null;
  return { ...automation, nextRunAt: computeNextRunAt(automation, now), updatedAt: now };
}

/** 一次跑完是否算「已完成」（区别于失败暂停 / 手动暂停）。 */
export function isRunQuotaComplete(automation: Automation, runCount: number): boolean {
  if (automation.scheduleType === "once") return runCount >= 1;
  if (automation.maxRuns === undefined) return false;
  return runCount >= automation.maxRuns;
}

/**
 * 未来若干次触发时刻（升序），只给面板展示。
 *
 * 反复调 `computeNextRunAt` 而不是另写一套展开器：锚点逻辑只存在一处，
 * 面板上看到的第三个时间点和调度器真写进 `nextRunAt` 的第三个值必然相同。
 */
export function listUpcomingRuns(
  automation: AutomationScheduleFields,
  from: number,
  count: number,
): number[] {
  const limit = Math.max(0, Math.min(Math.floor(count), 20));
  if (limit === 0) return [];
  const remaining = automation.scheduleType === "once" ? 1 : limit;
  const runs: number[] = [];
  let cursor: AutomationScheduleFields = automation;
  // nextRunAt 还没到（>= from）就直接拿它当第一个点；已经过期（< from）则从现在重算，
  // 否则面板会把「昨天该跑的那次」当成下一次展示。
  let at = Number.isFinite(automation.nextRunAt) && automation.nextRunAt > 0 && automation.nextRunAt >= from
    ? automation.nextRunAt
    : computeNextRunAt(automation, from);
  for (let i = 0; i < remaining && i < 1000; i++) {
    runs.push(at);
    cursor = { ...cursor, nextRunAt: at };
    at = computeNextRunAt(cursor, at);
  }
  return runs;
}
// ---------------------------------------------------------------------------
// 展示用的一行摘要（纯；翻译与区域格式化由调用方注入）
// ---------------------------------------------------------------------------

export type ScheduleTranslateFn = (key: string, params?: Record<string, string | number>) => string;

/** 「工作日 / 周末 / 每天 / 自定义」的一行摘要。 */
export function describeWeekdays(days: number[] | undefined, t: ScheduleTranslateFn): string | undefined {
  const normalized = [...new Set(days ?? [])].sort((a, b) => a - b);
  if (normalized.length === 0) return undefined;
  if (normalized.join(",") === "1,2,3,4,5") return t("automation.weekdays.weekdays");
  if (normalized.join(",") === "0,6") return t("automation.weekdays.weekend");
  if (normalized.length === 7) return t("automation.weekdays.every");
  return t("automation.weekdays.summary", {
    days: normalized.map((day) => t(`automation.weekday.${day}`)).join(", "),
  });
}

function describeIntervalLength(minutes: number, t: ScheduleTranslateFn): string {
  if (minutes < 60) return t("automation.intervalMinutes", { count: minutes });
  if (minutes % (60 * 24) === 0) return t("automation.intervalDays", { count: minutes / (60 * 24) });
  if (minutes % 60 === 0) return t("automation.intervalHours", { count: minutes / 60 });
  return t("automation.intervalMinutes", { count: minutes });
}

/**
 * 一行人话摘要，面板列表与注入给 agent 的上下文共用。
 *
 * `locale` 只影响 `once` 的时间格式化（`toLocaleString`）；周几/间隔这些短语
 * 来自三语表，所以同一个任务在面板上和在 agent 眼里是同一句话。
 */
export function describeSchedule(
  automation: AutomationScheduleFields,
  t: ScheduleTranslateFn,
  locale?: string,
): string {
  if (automation.scheduleType === "once") {
    const when = Number.isFinite(automation.scheduledAt) && automation.scheduledAt! > 0
      ? new Date(automation.scheduledAt!).toLocaleString(locale, {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    return t("automation.schedule.once", { when });
  }
  if (automation.scheduleType === "daily") {
    return t("automation.schedule.daily", { time: automation.timeOfDay ?? "09:00" });
  }
  if (automation.scheduleType === "weekly") {
    const day = Number.isFinite(automation.dayOfWeek) ? automation.dayOfWeek! : 1;
    return t("automation.schedule.weekly", {
      weekday: t(`automation.weekday.${day}`),
      time: automation.timeOfDay ?? "09:00",
    });
  }

  const minutes = Number(automation.intervalMinutes);
  let label = t("automation.schedule.interval", {
    interval: Number.isFinite(minutes) && minutes >= 1
      ? describeIntervalLength(Math.round(minutes), t)
      : "",
  });
  const days = describeWeekdays(automation.activeWeekdays, t);
  if (days) label += t("automation.schedule.weekdaySuffix", { days });
  if (automation.activeWindowStart && automation.activeWindowEnd) {
    label += t("automation.schedule.windowSuffix", {
      start: automation.activeWindowStart,
      end: automation.activeWindowEnd,
    });
  }
  return label;
}
