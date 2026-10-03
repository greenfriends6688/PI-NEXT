import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  DAY_WINDOW_END_HOUR,
  DAY_WINDOW_START_HOUR,
  addLocalDays,
  addLocalMonths,
  buildMonthGrid,
  buildWeekGrid,
  dayWindow,
  daysInLocalMonth,
  dueTone,
  endOfLocalDay,
  eventEndAt,
  isSameLocalDay,
  itemOccursOnDay,
  itemsOnDay,
  layoutDaySegments,
  startOfLocalDay,
  startOfLocalMonth,
  startOfLocalWeek,
} = await jiti.import("./planning-calendar.ts");

/*
 * fork:proma-44-planning —— 日历格算法。
 *
 * 所有断言都只依赖**本地时区**语义（`getFullYear/getMonth/getDate`），所以在
 * 任何 TZ 下跑都应该是同一组结果；测试本身不设 TZ，因为要测的就是「不依赖
 * 某个固定 UTC 偏移」。
 */

const at = (y, m, d, h = 0, min = 0) => new Date(y, m, d, h, min).getTime();
const atMs = (y, m, d, h, min, sec, ms) => new Date(y, m, d, h, min, sec, ms).getTime();

test("local day boundaries and same-day comparison", () => {
  const noon = at(2026, 2, 14, 12, 34);
  assert.equal(startOfLocalDay(noon), at(2026, 2, 14));
  assert.equal(endOfLocalDay(noon), atMs(2026, 2, 14, 23, 59, 59, 999));
  // 一天的跨度是 24h（或 DST 切换日的 23h / 25h）减 1ms，不会是别的。
  const dayLength = endOfLocalDay(noon) - startOfLocalDay(noon) + 1;
  assert.ok([23, 24, 25].includes(dayLength / 3_600_000), `一天的跨度应约 24h，实际 ${dayLength}ms`);
  assert.equal(isSameLocalDay(noon, at(2026, 2, 14, 0, 0)), true);
  assert.equal(isSameLocalDay(noon, at(2026, 2, 14, 23, 59)), true);
  assert.equal(isSameLocalDay(noon, at(2026, 2, 15, 0, 0)), false);
  // 跨年 / 跨月边界
  assert.equal(isSameLocalDay(at(2025, 11, 31, 23), at(2025, 11, 31, 1)), true);
  assert.equal(isSameLocalDay(at(2025, 11, 31, 23), at(2026, 0, 1, 1)), false);
  // 闰年 2/29
  assert.equal(isSameLocalDay(at(2028, 1, 29, 8), at(2028, 1, 29, 20)), true);
});

test("addLocalDays crosses months and years through the Date constructor", () => {
  assert.equal(startOfLocalDay(addLocalDays(at(2026, 0, 31), 1)), at(2026, 1, 1));
  assert.equal(startOfLocalDay(addLocalDays(at(2026, 0, 1), -1)), at(2025, 11, 31));
  assert.equal(startOfLocalDay(addLocalDays(at(2028, 1, 28), 1)), at(2028, 1, 29)); // 闰年 2/28 → 2/29
  assert.equal(startOfLocalDay(addLocalDays(at(2027, 1, 28), 1)), at(2027, 2, 1));  // 平年 2/28 → 3/1
  // 一次跳 400 天不是「400 × 24h」：交给 Date 自己处理偏移。
  assert.equal(startOfLocalDay(addLocalDays(at(2026, 2, 1), 400)), startOfLocalDay(at(2027, 3, 5)));
});

test("addLocalMonths is anchored to the 1st so 1/31 + 1 month is 2/1, not 3/3", () => {
  const jan31 = at(2026, 0, 31);
  assert.equal(addLocalMonths(jan31, 1), at(2026, 1, 1));
  assert.equal(addLocalMonths(jan31, -1), at(2025, 11, 1));
  assert.equal(startOfLocalMonth(addLocalMonths(jan31, 12)), at(2027, 0, 1));
  // 再退回去必须回到同一个「月」而不是同一天
  assert.equal(startOfLocalMonth(addLocalMonths(addLocalMonths(jan31, 5), -5)), at(2026, 0, 1));
});

test("daysInLocalMonth knows February", () => {
  assert.equal(daysInLocalMonth(at(2026, 1, 10)), 28);
  assert.equal(daysInLocalMonth(at(2028, 1, 10)), 29);
  assert.equal(daysInLocalMonth(at(2026, 0, 10)), 31);
  assert.equal(daysInLocalMonth(at(2026, 3, 10)), 30);
});

test("startOfLocalWeek defaults to Monday and honours weekStartsOn", () => {
  const wednesday = at(2026, 2, 18);
  assert.equal(startOfLocalWeek(wednesday, 1), at(2026, 2, 16));
  assert.equal(startOfLocalWeek(wednesday, 0), at(2026, 2, 15));
  // 周日开头那一档：周日自己是起点
  assert.equal(startOfLocalWeek(at(2026, 2, 15), 0), at(2026, 2, 15));
  // 周一开头那一档：周日属于上一个周一
  assert.equal(startOfLocalWeek(at(2026, 2, 15), 1), at(2026, 2, 9));
  // 周六不越到下一周
  assert.equal(startOfLocalWeek(at(2026, 2, 21), 1), at(2026, 2, 16));
});

test("buildWeekGrid returns seven consecutive local midnights", () => {
  const week = buildWeekGrid(at(2026, 2, 18, 22, 15));
  assert.equal(week.days.length, 7);
  assert.equal(week.days[0], at(2026, 2, 16));
  assert.equal(week.days[6], at(2026, 2, 22));
  for (const day of week.days) assert.equal(day, startOfLocalDay(day));
  // 跨月的一周
  const crossing = buildWeekGrid(at(2026, 2, 31));
  assert.equal(crossing.days[0], at(2026, 2, 30));
  assert.equal(crossing.days[6], at(2026, 3, 5));
});

test("month grid is whole weeks and the 1st lands in the right column", () => {
  // 2026-03-01 是周日 → 周一开头那一档前面补 6 格；6 + 31 = 37 → 6 周 42 格。
  const grid = buildMonthGrid(at(2026, 2, 15), at(2026, 2, 15));
  assert.equal(grid.cells.length % 7, 0);
  assert.equal(grid.weekCount, Math.ceil(grid.cells.length / 7));
  assert.equal(grid.weekCount, 6);
  assert.equal(grid.cells.length, 42);

  const march1 = grid.cells.find((cell) => cell.inMonth && cell.dayOfMonth === 1);
  assert.ok(march1, "3/1 必须在格阵里");
  assert.equal(march1.start, at(2026, 2, 1));
  assert.equal(new Date(march1.start).getDay(), 0);
  // 周一开头 → 3/1 前面补的格数是 (0 - 1 + 7) % 7 = 6
  assert.equal(grid.cells.indexOf(march1), 6);
  assert.equal(grid.cells.filter((cell) => cell.inMonth).length, 31);
  // 补白格带着真实日期，hover / 键盘导航才有落点
  assert.equal(grid.cells[0].inMonth, false);
  assert.equal(new Date(grid.cells[0].start).getMonth(), 1); // 2 月
  // 最后一天真的在格阵里，没有被裁掉
  assert.ok(grid.cells.some((cell) => cell.inMonth && cell.dayOfMonth === 31));
});

test("month grid on a 1st that already is the week start needs no leading blanks", () => {
  // 2026-06-01 是周一。
  const grid = buildMonthGrid(at(2026, 5, 10), at(2026, 5, 10));
  assert.equal(grid.cells[0].inMonth, true);
  assert.equal(grid.cells[0].dayOfMonth, 1);
  assert.equal(grid.weekCount, 5); // 30 天 + 0 补白 = 30 → 5 周
});

test("month grid marks today by local day, not by timestamp equality", () => {
  const grid = buildMonthGrid(at(2026, 2, 15), at(2026, 2, 14, 23, 30));
  const marked = grid.cells.filter((cell) => cell.isToday);
  assert.equal(marked.length, 1);
  assert.equal(marked[0].start, at(2026, 2, 14));
});

test("eventEndAt falls back for open-ended and all-day items", () => {
  const start = at(2026, 2, 14, 10);
  assert.equal(eventEndAt({ id: "a", startAt: start, endAt: start + 3_600_000 }), start + 3_600_000);
  assert.equal(eventEndAt({ id: "a", startAt: start }), start + 3_600_000, "没有结束时间按一小时兜底");
  // 结束早于开始（手改文件能造出来）同样兜底，而不是算出负高度
  assert.equal(eventEndAt({ id: "a", startAt: start, endAt: start - 1000 }), start + 3_600_000);
  assert.equal(eventEndAt({ id: "a", startAt: start, allDay: true }), endOfLocalDay(start));
});

test("a multi-day event shows up in every day it touches", () => {
  const item = { id: "x", startAt: at(2026, 2, 14, 22), endAt: at(2026, 2, 16, 2) };
  assert.equal(itemOccursOnDay(item, at(2026, 2, 14)), true);
  assert.equal(itemOccursOnDay(item, at(2026, 2, 15)), true);
  assert.equal(itemOccursOnDay(item, at(2026, 2, 16)), true, "结束当天的凌晨仍然属于这件事");
  assert.equal(itemOccursOnDay(item, at(2026, 2, 17)), false);
  assert.equal(itemOccursOnDay(item, at(2026, 2, 13)), false);

  assert.deepEqual(
    itemsOnDay([{ id: "a", startAt: at(2026, 2, 15, 9) }, { id: "b", startAt: at(2026, 2, 16, 9) }], at(2026, 2, 15)).map((i) => i.id),
    ["a"],
  );
});

test("day window is a local-time range and never zero-width", () => {
  const window = dayWindow(at(2026, 2, 14));
  assert.equal(new Date(window.start).getHours(), DAY_WINDOW_START_HOUR);
  assert.equal(new Date(window.end).getHours(), DAY_WINDOW_END_HOUR);
  assert.ok(window.end > window.start);
});

test("layout: a single timed item sits where its clock time says", () => {
  const day = at(2026, 2, 14);
  const window = dayWindow(day);
  const span = window.end - window.start;
  const start = at(2026, 2, 14, 12);
  const [segment] = layoutDaySegments([{ id: "a", startAt: start, endAt: start + 3_600_000 }], day);
  assert.equal(segment.column, 0);
  assert.equal(segment.columns, 1);
  assert.equal(segment.topPct, ((start - window.start) / span) * 100);
  assert.equal(segment.heightPct, (3_600_000 / span) * 100);
  // 12:00 = (12-7)/15 = 1/3
  assert.ok(Math.abs(segment.topPct - 100 / 3) < 1e-9);
  assert.ok(Math.abs(segment.heightPct - (100 / 15)) < 1e-9);
});

test("layout: overlapping items are split into columns, a later cluster is not", () => {
  const day = at(2026, 2, 14);
  const a = { id: "a", startAt: at(2026, 2, 14, 9), endAt: at(2026, 2, 14, 11) };
  const b = { id: "b", startAt: at(2026, 2, 14, 10), endAt: at(2026, 2, 14, 12) };
  const c = { id: "c", startAt: at(2026, 2, 14, 10, 30), endAt: at(2026, 2, 14, 11, 30) };
  const lonely = { id: "d", startAt: at(2026, 2, 14, 15), endAt: at(2026, 2, 14, 16) };

  const segments = layoutDaySegments([a, b, c, lonely], day);
  const byId = new Map(segments.map((s) => [s.item.id, s]));
  // 贪心：c（10:30–11:30）放得进 b 那一列（b 到 12:00），所以只有两列。
  // 这正是贪心该有的结果 —— b/c 互不遮挡，压成一列比硬切两列好读。
  assert.equal(byId.get("a").columns, 2);
  assert.equal(byId.get("b").columns, 2);
  assert.equal(byId.get("c").columns, 2);
  assert.equal(byId.get("a").column, 0);
  assert.equal(byId.get("b").column, 1);
  assert.equal(byId.get("c").column, byId.get("b").column, "c 复用 b 那一列");
  assert.equal(new Set([byId.get("a").column, byId.get("b").column]).size, 2);
  // 15:00 那条不与任何一条重叠 → 独占整格，不被上午的三列挤成三分之一。
  assert.equal(byId.get("d").columns, 1);
  assert.equal(byId.get("d").column, 0);
});

test("layout: a sequential pair reuses column 0 and a zero-length item stays visible", () => {
  const day = at(2026, 2, 14);
  const a = { id: "a", startAt: at(2026, 2, 14, 9), endAt: at(2026, 2, 14, 10) };
  const b = { id: "b", startAt: at(2026, 2, 14, 10), endAt: at(2026, 2, 14, 11) };
  const segments = layoutDaySegments([a, b, { id: "z", startAt: at(2026, 2, 14, 9) }], day);
  const byId = new Map(segments.map((s) => [s.item.id, s]));
  assert.equal(byId.get("b").column, 0, "首尾相接不算重叠");
  assert.equal(byId.get("b").columns, 1);
  assert.ok(byId.get("z").heightPct > 0, "零时长不能算成 0 高度（那会让这条消失）");
});

test("layout: all-day items stay out of the time axis, out-of-window items are clipped", () => {
  const day = at(2026, 2, 14);
  const window = dayWindow(day);
  const segments = layoutDaySegments([
    { id: "allday", startAt: day, endAt: endOfLocalDay(day), allDay: true },
    { id: "early", startAt: at(2026, 2, 14, 2), endAt: at(2026, 2, 14, 4) },
    { id: "late", startAt: at(2026, 2, 14, 23), endAt: at(2026, 2, 14, 23, 30) },
  ], day);
  assert.deepEqual(segments.map((s) => s.item.id), ["early", "late"]);
  const late = segments.find((s) => s.item.id === "late");
  assert.equal(late.topPct, 100, "整条都在窗外 → 贴到时间窗底");
  assert.equal(late.heightPct, 0);
  const early = segments.find((s) => s.item.id === "early");
  assert.equal(early.topPct, 0, "整条都在窗前 → 贴到顶");
  assert.ok(early.heightPct > 0);
  void window;
});

test("layout: percentages never leave the 0–100 range", () => {
  const day = at(2026, 2, 14);
  for (const segment of layoutDaySegments([
    { id: "a", startAt: at(2026, 2, 13, 20), endAt: at(2026, 2, 15, 20) },
    { id: "b", startAt: at(2026, 2, 14, 12) },
  ], day)) {
    assert.ok(segment.topPct >= 0 && segment.topPct <= 100);
    assert.ok(segment.heightPct >= 0 && segment.heightPct <= 100);
  }
});

test("dueTone buckets by local day", () => {
  const now = at(2026, 2, 14, 10);
  assert.equal(dueTone(undefined, now), "none");
  assert.equal(dueTone(at(2026, 2, 13, 23), now), "overdue");
  assert.equal(dueTone(at(2026, 2, 14, 0), now), "today", "今天凌晨到期仍然算今天，不是逾期");
  assert.equal(dueTone(at(2026, 2, 14, 23), now), "today");
  assert.equal(dueTone(at(2026, 2, 15, 0), now), "upcoming");
});
