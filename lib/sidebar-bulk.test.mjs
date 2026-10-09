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
  moreRowState,
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

test("visibleFamilies reveals exactly one step per click and never hides special rows", () => {
  const families = Array.from({ length: 12 }, (unused, index) => ({ id: `f${index}` }));
  const special = (family) => family.id === "f9";

  const base = visibleFamilies(families, 6, 0, special);
  assert.deepEqual(base.visible.map((f) => f.id), ["f0", "f1", "f2", "f3", "f4", "f5", "f9"]);
  assert.equal(base.revealed, 0);

  const more = visibleFamilies(families, 6, SHOW_MORE_STEP, special);
  assert.deepEqual(more.visible.map((f) => f.id), families.map((f) => f.id));
  // 12 个家族、limit 6、f9 因 special 自己显示：extra 实际只显示了 5 个（6/7/8/10/11），
  // f9 不占名额 —— 所以下一次「显示更多」仍然是整整 SHOW_MORE_STEP 个。
  assert.equal(more.revealed, 5, "special rows do not consume the step");
});

test("show more / show less move one bucket at a time", () => {
  assert.equal(GROUP_VISIBLE_LIMIT, 6);
  assert.equal(shownMoreFor({}, "p"), 0);
  const once = showMoreFamilies({}, "p");
  assert.equal(shownMoreFor(once, "p"), SHOW_MORE_STEP);
  const twice = showMoreFamilies(once, "p");
  assert.equal(shownMoreFor(twice, "p"), SHOW_MORE_STEP * 2);
  assert.deepEqual(showLessFamilies(twice, "p"), {});
  // 坏数据按 0 处理。
  assert.equal(shownMoreFor({ p: -3 }, "p"), 0);
  assert.equal(shownMoreFor({ p: "x" }, "p"), 0);
});

test("the more row only appears when something is hidden or folding back is possible", () => {
  assert.equal(moreRowState(6, 6, 0), null);
  assert.deepEqual(moreRowState(13, 6, 0), { hidden: 7, canShowLess: false });
  assert.deepEqual(moreRowState(13, 13, 7), { hidden: 0, canShowLess: true });
  assert.equal(PINNED_MORE_KEY.length > 0, true);
});
