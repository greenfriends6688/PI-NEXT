import test from "node:test";
import assert from "node:assert/strict";
import { CRON_PRESETS, cronMatches, nextCronInstant, parseCron, type CronWall } from "../src/shared/cron.ts";

/**
 * The parse and the match, against a plain UTC clock.
 *
 * The zone is the caller's business (`scheduled-tasks.ts` hands the engine's own zone-aware
 * helpers to `nextCronInstant`), which is what makes this file able to say what the
 * algorithm does without a timezone table in the way. The engine's own test covers the same
 * expression in Asia/Shanghai.
 */

const utcWall = (instant: number): CronWall => {
  const at = new Date(instant);
  return {
    year: at.getUTCFullYear(),
    month: at.getUTCMonth() + 1,
    day: at.getUTCDate(),
    hour: at.getUTCHours(),
    minute: at.getUTCMinutes(),
    weekday: at.getUTCDay(),
  };
};
const utcInstant = (year: number, month: number, day: number, hour: number, minute: number): number =>
  Date.UTC(year, month - 1, day, hour, minute);

function next(expr: string, from: string): string | undefined {
  const cron = parseCron(expr);
  assert.ok(cron, `${expr} did not parse`);
  const at = nextCronInstant(cron, Date.parse(from), utcWall, utcInstant);
  return at === undefined ? undefined : new Date(at).toISOString();
}

test("a five-field expression parses, everything else does not", () => {
  assert.ok(parseCron("*/15 * * * *"));
  assert.ok(parseCron("0 9 * * 1-5"));
  assert.ok(parseCron("1,2,3 0 * * *"));
  assert.ok(parseCron("0 0 1 1 0"));
  assert.ok(parseCron("5-59/5 * * * *"), "a stepped range");
  assert.ok(parseCron("  0   9   *   *   *  "), "whitespace is not a field");

  assert.equal(parseCron(""), null, "no fields");
  assert.equal(parseCron("* * * *"), null, "four fields");
  assert.equal(parseCron("* * * * * *"), null, "six fields");
  assert.equal(parseCron("* * * * MON"), null, "names are not accepted, only numbers");
  assert.equal(parseCron("60 * * * *"), null, "minute 60 does not exist");
  assert.equal(parseCron("* 24 * * *"), null, "hour 24 does not exist");
  assert.equal(parseCron("* * 0 * *"), null, "day of month is 1-based");
  assert.equal(parseCron("* * * 13 *"), null, "there is no month 13");
  assert.equal(parseCron("*/0 * * * *"), null, "a step of zero would never terminate");
  assert.equal(parseCron("5-1 * * * *"), null, "a backwards range");
  assert.equal(parseCron("1- * * * *"), null, "an open range with no step");
  assert.equal(parseCron("a * * * *"), null);
  assert.equal(parseCron(", * * * *"), null);
  assert.equal(parseCron("1,,2 * * * *"), null, "an empty list element");
});

test("Sunday is 0 and 7, and a list keeps both spellings out", () => {
  assert.deepEqual([...parseCron("0 0 * * 7")!.dayOfWeek], [0]);
  assert.deepEqual([...parseCron("0 0 * * 0")!.dayOfWeek], [0]);
  assert.deepEqual([...parseCron("0 0 * * 1-5")!.dayOfWeek], [1, 2, 3, 4, 5]);
});

test("the next occurrence is the next one, never the current minute", () => {
  assert.equal(next("*/15 * * * *", "2026-01-01T00:07:00Z"), "2026-01-01T00:15:00.000Z");
  assert.equal(next("*/15 * * * *", "2026-01-01T00:15:00Z"), "2026-01-01T00:30:00.000Z", "already due is not due again");
  assert.equal(next("0 9 * * *", "2026-01-01T00:10:00Z"), "2026-01-01T09:00:00.000Z");
  assert.equal(next("0 9 * * *", "2026-01-01T09:00:00Z"), "2026-01-02T09:00:00.000Z");
  assert.equal(next("30 8 * * *", "2026-01-01T08:31:00Z"), "2026-01-02T08:30:00.000Z", "an hour that already passed");
});

test("day, weekday and month all reach for their own next slot", () => {
  // 2026-01-01 is a Thursday.
  assert.equal(next("0 0 * * 1", "2026-01-01T00:00:00Z"), "2026-01-05T00:00:00.000Z", "next Monday");
  assert.equal(next("0 0 * * 1-5", "2026-01-03T12:00:00Z"), "2026-01-05T00:00:00.000Z", "a Saturday skips to Monday");
  assert.equal(next("0 0 1 * *", "2026-01-02T00:00:00Z"), "2026-02-01T00:00:00.000Z", "the 1st of next month");
  assert.equal(next("0 0 1 1 *", "2026-01-01T00:00:00Z"), "2027-01-01T00:00:00.000Z", "next January");
  assert.equal(next("0 9 29 2 *", "2026-03-01T00:00:00Z"), "2028-02-29T09:00:00.000Z", "a leap day is years away");
});

test("day-of-month and day-of-week are an OR when both are written", () => {
  // cron's own rule, and the one that surprises people: `0 0 13 * 5` is the 13th *and* every
  // Friday. 2026-01-01 is a Thursday, so the 2nd is the first Friday.
  assert.equal(next("0 0 13 * 5", "2026-01-01T00:00:00Z"), "2026-01-02T00:00:00.000Z", "the Friday comes first");
  assert.equal(next("0 0 13 * 5", "2026-01-10T00:00:00Z"), "2026-01-13T00:00:00.000Z", "then the 13th");
  // Only one restricted: that one decides.
  assert.equal(next("0 0 13 * *", "2026-01-14T00:00:00Z"), "2026-02-13T00:00:00.000Z");
  assert.equal(next("0 0 * * 5", "2026-01-03T00:00:00Z"), "2026-01-09T00:00:00.000Z");
});

test("matching one minute reads every field", () => {
  const cron = parseCron("30 8 1 6 1")!;
  const base: CronWall = { year: 2026, month: 6, day: 1, hour: 8, minute: 30, weekday: 1 };
  assert.equal(cronMatches(cron, base), true);
  assert.equal(cronMatches(cron, { ...base, minute: 29 }), false);
  assert.equal(cronMatches(cron, { ...base, hour: 9 }), false);
  assert.equal(cronMatches(cron, { ...base, month: 7 }), false);
  assert.equal(cronMatches(cron, { ...base, day: 2, weekday: 2 }), false);
  // June 2nd is a Monday: the weekday is still true even though the day of month is not.
  assert.equal(cronMatches(cron, { ...base, day: 2 }), true);
});

test("every preset the form offers is an expression the engine can run", () => {
  assert.ok(CRON_PRESETS.length >= 4);
  for (const preset of CRON_PRESETS) {
    const cron = parseCron(preset.expr);
    assert.ok(cron, `${preset.expr} did not parse`);
    assert.ok(nextCronInstant(cron, Date.parse("2026-01-01T00:00:00Z"), utcWall, utcInstant) !== undefined, `${preset.expr} never fires`);
    assert.ok(preset.zh.length > 0 && preset.en.length > 0, `${preset.expr} has no label`);
  }
});

test("an expression that cannot fire in the horizon gives up rather than looping", () => {
  // The 30th of February is legal in cron and never happens.
  const cron = parseCron("0 0 30 2 *")!;
  assert.equal(nextCronInstant(cron, Date.parse("2026-01-01T00:00:00Z"), utcWall, utcInstant), undefined);
});
