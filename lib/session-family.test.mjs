import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getSessionFamily, listSessionFamilies } = await createJiti(import.meta.url).import("./session-family.ts");

function session(id, modified, relation) {
  return {
    path: `/tmp/${id}.jsonl`,
    id,
    cwd: "/tmp",
    created: modified,
    modified,
    messageCount: 1,
    firstMessage: id,
    ...(relation ? { relation } : {}),
  };
}

test("groups nested subagents under their main session and uses family activity for sorting", () => {
  const main = session("main", "2026-01-01T00:00:00.000Z");
  const child = session("child", "2026-01-04T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "main", profile: "explore", description: "Explore", status: "completed",
  });
  const grandchild = session("grandchild", "2026-01-03T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "child", profile: "review", description: "Review", status: "running",
  });
  const newerRoot = session("newer-root", "2026-01-02T00:00:00.000Z");

  const families = listSessionFamilies([main, child, grandchild, newerRoot]);
  assert.deepEqual(families.map((family) => family.root.id), ["main", "newer-root"]);
  assert.deepEqual(families[0].subagents.map((item) => item.id), ["child", "grandchild"]);
  assert.equal(getSessionFamily([main, child, grandchild], "grandchild")?.root.id, "main");
});

test("does not promote orphaned or cyclic subagent metadata into the main session list", () => {  const orphan = session("orphan", "2026-01-03T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "missing", profile: "explore", description: "Explore", status: "interrupted",
  });
  const a = session("a", "2026-01-01T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "b", profile: "a", description: "A", status: "interrupted",
  });
  const b = session("b", "2026-01-02T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "a", profile: "b", description: "B", status: "interrupted",
  });

  assert.deepEqual(listSessionFamilies([orphan, a, b]), []);
  assert.equal(getSessionFamily([orphan, a, b], "orphan"), null);
});

// fix:pin-partition —— 置顶分区是调用方（`applySessionFlags`）给的顺序；这里曾按
// `latestModified` 重排，把它洗回时间序，置顶因此“点了没反应”。
test("family order follows the caller's order so a pinned row stays first", () => {
  const older = session("older", "2026-01-01T00:00:00.000Z");
  const newer = session("newer", "2026-01-05T00:00:00.000Z");
  const middle = session("middle", "2026-01-03T00:00:00.000Z");
  // Caller order: modified desc with `older` (pinned) hoisted to the front.
  assert.deepEqual(
    listSessionFamilies([older, newer, middle]).map((family) => family.root.id),
    ["older", "newer", "middle"],
  );
  // A subagent's activity never drags its family forward.
  const child = session("child", "2026-01-09T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "middle", profile: "explore", description: "Explore", status: "completed",
  });
  assert.deepEqual(
    listSessionFamilies([older, middle, newer, child]).map((family) => family.root.id),
    ["older", "middle", "newer"],
  );
});
