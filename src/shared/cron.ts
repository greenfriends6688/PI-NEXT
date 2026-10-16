/**
 * A five-field cron expression, parsed once and matched against a local wall clock.
 *
 * The expression is the storage format (`{ kind: "cron", expr, timeZone }`) because it is
 * the one that can say 「每 15 分钟」or 「工作日 9 点」 without a new rule kind for each; the
 * presets in the form are sugar over it. Five fields — minute, hour, day of month, month,
 * day of week — and no seconds: a task that must run more often than once a minute is not
 * something anybody wants scheduled on a laptop.
 *
 * The matching is split from the clock on purpose. `nextCronInstant` takes two functions
 * that read and write local time, so the algorithm is exercised by `node --test` with a
 * plain UTC clock, while the engine hands it the same zone-aware helpers it already uses
 * for the daily and weekly rules — the two cannot disagree about what "9:00 in Shanghai"
 * means because there is one implementation of that.
 *
 * Supported syntax, and nothing else: `*`, a number, `a-b`, a list `a,b,c`, and a step
 * `*&#47;n` or `a-b/n`. Month and weekday names are **not** accepted: `MON` and `1` mean the
 * same thing, and shipping only the numbers keeps one spelling for a stored expression.
 */

export type CronFields = {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** Whether day-of-month was written out, which decides the day-of-week OR rule below. */
  dayOfMonthRestricted: boolean;
  dayOfWeekRestricted: boolean;
};

export type CronWall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** Sunday is 0, matching cron's own `0 7 * * 0`. */
  weekday: number;
};

const FIELD_RANGES: Array<[keyof CronFields, number, number]> = [
  ["minute", 0, 59],
  ["hour", 0, 23],
  ["dayOfMonth", 1, 31],
  ["month", 1, 12],
  ["dayOfWeek", 0, 7],
];

/** The five fields of a cron expression, or null when it is not one. */
export function parseCron(expr: string): CronFields | null {
  if (typeof expr !== "string") return null;
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const parsed: Partial<Record<keyof CronFields, Set<number>>> = {};
  for (const [index, [name, min, max]] of FIELD_RANGES.entries()) {
    const values = parseField(fields[index]!, min, max);
    if (!values) return null;
    parsed[name] = values;
  }
  const dayOfWeek = parsed.dayOfWeek!;
  // cron lets 7 be Sunday; 0 already is.
  if (dayOfWeek.has(7)) {
    dayOfWeek.delete(7);
    dayOfWeek.add(0);
  }
  return {
    minute: parsed.minute!,
    hour: parsed.hour!,
    dayOfMonth: parsed.dayOfMonth!,
    month: parsed.month!,
    dayOfWeek,
    dayOfMonthRestricted: fields[2] !== "*",
    dayOfWeekRestricted: fields[4] !== "*",
  };
}

function parseField(field: string, min: number, max: number): Set<number> | null {
  if (field.length === 0) return null;
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepText] = part.split("/") as [string, string?];
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;
    let from: number;
    let to: number;
    if (range === "*") {
      from = min;
      to = max;
    } else {
      const [startText, endText] = range.split("-") as [string, string?];
      if (!/^\d+$/.test(startText)) return null;
      from = Number(startText);
      to = endText === undefined ? (stepText === undefined ? from : max) : Number(endText);
      if (endText !== undefined && !/^\d+$/.test(endText)) return null;
      if (from < min || to > max || from > to) return null;
    }
    for (let value = from; value <= to; value += step) values.add(value);
  }
  return values.size > 0 ? values : null;
}

/**
 * Whether one local minute is a scheduled one.
 *
 * Day-of-month and day-of-week follow cron's own rule, which surprises everyone once: when
 * **both** are restricted the minute matches if *either* matches (`0 0 1 * 1` is the 1st of
 * the month *and* every Monday), and when only one is restricted it is the one that decides.
 */
export function cronMatches(cron: CronFields, wall: CronWall): boolean {
  return cron.minute.has(wall.minute) && cron.hour.has(wall.hour) && cron.month.has(wall.month) && cronMatchesDay(cron, wall);
}

/**
 * Whether the calendar day matches, which is the part with a rule of its own.
 *
 * When **both** day fields are written the minute matches if *either* matches — `0 0 13 * 5`
 * is the 13th of the month *and* every Friday, not the Friday the 13th. When only one is
 * written, that one decides. Both the matcher and the forward walk below go through this, so
 * the walk cannot skip a day the matcher would have accepted.
 */
export function cronMatchesDay(cron: CronFields, wall: CronWall): boolean {
  const dom = cron.dayOfMonth.has(wall.day);
  const dow = cron.dayOfWeek.has(wall.weekday);
  if (cron.dayOfMonthRestricted && cron.dayOfWeekRestricted) return dom || dow;
  if (cron.dayOfMonthRestricted) return dom;
  if (cron.dayOfWeekRestricted) return dow;
  return true;
}

/**
 * The first scheduled instant strictly after `now`.
 *
 * It walks forward in local time rather than in instants: a minute that does not match is
 * skipped by jumping to the next hour, day or month it could possibly match in, so a
 * 「每年 1 月 1 日」expression costs a handful of steps instead of half a million. The two
 * injected functions are what keep that honest across a DST change — the same wall clock can
 * be two instants, or none, and only the caller's zone knows which.
 */
export function nextCronInstant(
  cron: CronFields,
  now: number,
  readWall: (instant: number) => CronWall,
  instantAtWall: (year: number, month: number, day: number, hour: number, minute: number) => number,
): number | undefined {
  // The next whole minute: an occurrence at the current minute has already been claimed.
  let instant = Math.floor(now / 60_000) * 60_000 + 60_000;
  const horizon = now + 5 * 366 * 86_400_000;
  for (let step = 0; instant <= horizon && step < 100_000; step++) {
    const wall = readWall(instant);
    let next: number | null = null;
    if (!cron.month.has(wall.month)) {
      const year = wall.year + Math.floor(wall.month / 12);
      next = instantAtWall(year, (wall.month % 12) + 1, 1, 0, 0);
    } else if (!cronMatchesDay(cron, wall)) {
      const day = new Date(Date.UTC(wall.year, wall.month - 1, wall.day + 1));
      next = instantAtWall(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 0, 0);
    } else if (!cron.hour.has(wall.hour)) {
      const day = new Date(Date.UTC(wall.year, wall.month - 1, wall.day));
      const hour = wall.hour + 1;
      if (hour > 23) day.setUTCDate(day.getUTCDate() + 1);
      next = instantAtWall(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour % 24, 0);
    } else if (!cron.minute.has(wall.minute)) {
      next = instant + 60_000;
    } else {
      return instant;
    }
    // A wall clock that named a time which resolves to an earlier instant (the repeated hour
    // of a fall-back) must still move forward, or the loop would sit on one minute for ever.
    instant = next > instant ? next : instant + 60_000;
  }
  return undefined;
}

/**
 * The presets the form offers, so the field is a choice before it is a syntax.
 *
 * Each is a plain expression the user can then edit: the sheet says what it means, and
 * what is stored is only ever the expression.
 */
export const CRON_PRESETS: ReadonlyArray<{ expr: string; zh: string; en: string }> = [
  { expr: "*/15 * * * *", zh: "每 15 分钟", en: "Every 15 minutes" },
  { expr: "0 * * * *", zh: "每小时", en: "Every hour" },
  { expr: "0 9 * * *", zh: "每天 9:00", en: "Daily at 9:00" },
  { expr: "0 9 * * 1-5", zh: "工作日 9:00", en: "Weekdays at 9:00" },
  { expr: "0 9 * * 1", zh: "每周一 9:00", en: "Mondays at 9:00" },
  { expr: "0 9 1 * *", zh: "每月 1 日 9:00", en: "Monthly on the 1st at 9:00" },
];
