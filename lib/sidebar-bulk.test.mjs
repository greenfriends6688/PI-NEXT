import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

// fork:pi-1.1 —— 侧栏批量动作与「显示更多」分页（上游 lib/session-tree.ts 的同名规则）。
// jiti：sidebar-bulk.ts 里是省略扩展名的相对导入，node --test 的解析器跟不了。
const {
  ARCHIVE_OLDER_THAN_MS,
  GROUP_VISIBLE_LIMIT,
  PINNED_MORE_KEY,
  SHOW_MORE_STEP,
  familiesOlderThan,
  familiesToDelete,
  moreRowState,
  forgetShownMoreOfFolded,
  showLessFamilies,
  showMoreFamilies,
  shownMoreFor,
  visibleFamilies,
} = await createJiti(import.meta.url).import("./sidebar-bulk.ts");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-10-09T12:00:00.000Z");

function session(id, modified, extra = {}) {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/project",
    created: modified,
    modified,
    messageCount: 3,
    firstMessage: id,
    ...extra,
  };
}

const days = (n) => new Date(NOW - n * DAY).toISOString();

function flags(extra = {}) {
  return { pinned: [], archived: [], archivedAt: {}, ...extra };
}

test("archives old quiet families, never the running, unread, pinned or selected ones", () => {
  const sessions = [
    session("old", days(10)),
    session("fresh", days(2)),
    session("running", days(30)),
    session("unread", days(30)),
    session("pinned", days(30)),
    session("unsaved", days(30), { path: "" }),
  ];
  const ids = familiesOlderThan(
    sessions,
    flags({ pinned: ["pinned"] }),
    { runningIds: new Set(["running"]), unreadIds: new Set(["unread"]) },
    ARCHIVE_OLDER_THAN_MS,
    NOW,
  );
  assert.deepEqual(ids, ["old"]);

  // 选中的那个也不归档（用户在看着它）：同一份过滤条件，只多一个 selected。
  assert.deepEqual(
    familiesOlderThan(sessions, flags({ pinned: ["pinned"] }), { runningIds: new Set(["running"]), unreadIds: new Set(["unread"]), selectedSessionId: "old" }, ARCHIVE_OLDER_THAN_MS, NOW),
    [],
  );
});

test("an already-archived family is not archived twice", () => {
  const sessions = [session("old", days(30))];
  const archived = flags({ archived: ["old"], archivedAt: { old: days(1) } });
  assert.deepEqual(familiesOlderThan(sessions, archived, { runningIds: new Set(), unreadIds: new Set() }, ARCHIVE_OLDER_THAN_MS, NOW), []);
});

test("a family holding a running subagent is left alone", () => {
  const sessions = [
    session("root", days(30)),
    session("child", days(30), { relation: { kind: "subagent", parentSessionId: "root", profile: "explore", description: "", status: "running" } }),
  ];
  assert.deepEqual(
    familiesOlderThan(sessions, flags(), { runningIds: new Set(["child"]), unreadIds: new Set() }, ARCHIVE_OLDER_THAN_MS, NOW),
    [],
  );
});

test("visibleFamilies opens a position window and never hides special rows", () => {
  const families = Array.from({ length: 30 }, (unused, index) => ({ id: `f${index}` }));
  const special = (family) => family.id === "f9";

  const base = visibleFamilies(families, 6, 0, special);
  assert.deepEqual(base.visible.map((f) => f.id), ["f0", "f1", "f2", "f3", "f4", "f5", "f9"]);
  assert.equal(base.revealed, 0);

  const more = visibleFamilies(families, 6, SHOW_MORE_STEP, special);
  // 窗口是**位置**：limit 6 + shown 20 = 26。
  assert.deepEqual(more.visible.map((f) => f.id), families.slice(0, 26).map((f) => f.id));
  // f9 自己显示、不占窗口名额，所以窗口里恰有 19 行由「显示更多」打开。
  assert.equal(more.revealed, 19, "special rows do not consume the window");
  // 下一次点击打开 SHOW_MORE_STEP 个**隐藏**家族（26..29 共 4 个），窗口到 30。
  assert.equal(more.nextShown, 24);
});

test("show more / show less move one bucket at a time", () => {
  assert.equal(GROUP_VISIBLE_LIMIT, 6);
  assert.equal(shownMoreFor({}, "p"), 0);
  const once = showMoreFamilies({}, "p", SHOW_MORE_STEP);
  assert.equal(shownMoreFor(once, "p"), SHOW_MORE_STEP);
  const twice = showMoreFamilies(once, "p", SHOW_MORE_STEP * 2);
  assert.equal(shownMoreFor(twice, "p"), SHOW_MORE_STEP * 2);
  assert.deepEqual(showLessFamilies(twice, "p"), {});
  // 坏数据按 0 处理。
  assert.equal(shownMoreFor({ p: -3 }, "p"), 0);
  assert.equal(shownMoreFor({ p: "x" }, "p"), 0);
});

test("folding a group drops its show-more window", () => {
  const more = { a: 20, b: 40 };
  // a 折了，b 还开着：只丢 a。
  assert.deepEqual(forgetShownMoreOfFolded(more, { a: false, b: true }, ["a", "b"]), { b: 40 });
  // 都还开着：原样返回。
  assert.equal(forgetShownMoreOfFolded(more, { a: true, b: true }, ["a", "b"]), more);
});

test("the more row only appears when something is hidden or folding back is possible", () => {
  assert.equal(moreRowState(6, 6, 0), null);
  assert.deepEqual(moreRowState(13, 6, 0), { hidden: 7, canShowLess: false });
  assert.deepEqual(moreRowState(13, 13, 7), { hidden: 0, canShowLess: true });
  assert.equal(PINNED_MORE_KEY.length > 0, true);
});

// fork:upstream-0.12-sidebar-parity —— 项目「删除全部会话」要删哪些（#1182）。
test("familiesToDelete drops running families and transient roots", () => {
  const sessions = [
    session("a", days(1)),
    session("b", days(1)),
    session("running", days(1)),
    session("child", days(1), { relation: { kind: "subagent", parentSessionId: "a", profile: "explore", description: "", status: "running" } }),
    session("unsaved", days(1), { path: "", transient: true }),
  ];
  const { ids, running } = familiesToDelete(sessions, { runningIds: new Set(["running"]), unreadIds: new Set() });
  assert.deepEqual(ids, ["a", "b"]);
  assert.equal(running, 1, "the running family is kept and counted");

  // A subagent that runs keeps its whole family.
  const withRunningChild = familiesToDelete(sessions, { runningIds: new Set(["running", "child"]), unreadIds: new Set() });
  assert.deepEqual(withRunningChild.ids, ["b"]);
  assert.equal(withRunningChild.running, 2);
});
