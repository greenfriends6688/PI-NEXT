import assert from "node:assert/strict";
import test from "node:test";

import {
  groupCandidates,
  groupSelectionState,
  groupsForKind,
  summarizeResults,
  toggleAllSelection,
  toggleGroupSelection,
} from "./groups.ts";

const session = (id, source, projectPath, updatedAt) => ({
  kind: "sessions", id, source, externalId: id, filePath: `/tmp/${id}.jsonl`,
  destination: "/tmp", projectPath, createdAt: null, updatedAt, messageCount: 1,
});

const skill = (id, source) => ({
  kind: "skills", id, source, externalId: id, filePath: `/tmp/${id}/SKILL.md`,
  destination: "/tmp", name: id, description: null,
});

const candidates = [
  session("a", "claude", "/repo/one", "2026-09-20T00:00:00.000Z"),
  session("b", "claude", "/repo/one", "2026-09-22T00:00:00.000Z"),
  session("c", "codex", "/repo/two", "2026-09-19T00:00:00.000Z"),
  session("d", "codex", null, "2026-09-23T00:00:00.000Z"),
];

test("only sessions offer a project grouping", () => {
  assert.deepEqual(groupsForKind("sessions"), ["source", "project"]);
  assert.deepEqual(groupsForKind("models"), ["source"]);
  assert.deepEqual(groupsForKind("mcp"), ["source"]);
  assert.deepEqual(groupsForKind("skills"), ["source"]);
});

test("grouping by source keeps each source together", () => {
  const groups = groupCandidates(candidates, "source");
  assert.deepEqual(groups.map((g) => g.rawLabel), ["codex", "claude"]);
  // codex is newest overall (2026-09-23) so it leads.
  assert.deepEqual(groups.find((g) => g.rawLabel === "claude").items.map((i) => i.id), ["a", "b"]);
});

test("grouping by project puts real projects before the path-less bucket", () => {
  const groups = groupCandidates(candidates, "project");
  assert.equal(groups[groups.length - 1].key, "", "the no-project bucket must come last");
  assert.deepEqual(groups.slice(0, 2).map((g) => g.key), ["/repo/one", "/repo/two"]);
});

test("a group with an unknown timestamp still appears", () => {
  const groups = groupCandidates([skill("x", "claude")], "source");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].latest, "");
});

test("group selection reports all / some / none", () => {
  const items = candidates.slice(0, 2);
  assert.equal(groupSelectionState(items, new Set()), "none");
  assert.equal(groupSelectionState(items, new Set(["a"])), "some");
  assert.equal(groupSelectionState(items, new Set(["a", "b"])), "all");
  assert.equal(groupSelectionState([], new Set()), "none");
});

test("toggling a partly-selected group selects the rest instead of clearing it", () => {
  const items = candidates.slice(0, 2);
  const next = toggleGroupSelection(new Set(["a", "z"]), items);
  assert.deepEqual([...next].sort(), ["a", "b", "z"]);
});

test("toggling a fully-selected group clears only that group", () => {
  const items = candidates.slice(0, 2);
  const next = toggleGroupSelection(new Set(["a", "b", "z"]), items);
  assert.deepEqual([...next], ["z"]);
});

test("the global toggle selects everything, then clears everything", () => {
  const all = toggleAllSelection(new Set(), candidates);
  assert.equal(all.size, candidates.length);
  assert.equal(groupSelectionState(candidates, all), "all");
  assert.equal(toggleAllSelection(all, candidates).size, 0);
});

test("results are bucketed into the three counts the UI shows", () => {
  assert.deepEqual(
    summarizeResults([
      { status: "imported" }, { status: "skipped" }, { status: "failed" }, { status: "imported" },
    ]),
    { imported: 2, skipped: 1, failed: 1 },
  );
  assert.deepEqual(summarizeResults([]), { imported: 0, skipped: 0, failed: 0 });
});
