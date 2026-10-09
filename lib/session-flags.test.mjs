import assert from "node:assert/strict";
import test from "node:test";

const {
  parseSessionFlags,
  applySessionFlags,
  archivedSessions,
} = await import("./session-flags.ts");

test("parseSessionFlags tolerates malformed and hostile storage", () => {
  const empty = { pinned: [], archived: [], archivedAt: {} };
  assert.deepEqual(parseSessionFlags(null), empty);
  assert.deepEqual(parseSessionFlags(""), empty);
  assert.deepEqual(parseSessionFlags("{"), empty);
  assert.deepEqual(parseSessionFlags("[]"), empty);
  assert.deepEqual(parseSessionFlags("null"), empty);
  // Non-string entries and duplicates are dropped.
  assert.deepEqual(
    parseSessionFlags(JSON.stringify({ pinned: ["a", 3, null, "a", ""], archived: "nope" })),
    { pinned: ["a"], archived: [], archivedAt: {} },
  );
  // fork:ui-archive-history — a hostile archivedAt map keeps only id → non-empty string.
  assert.deepEqual(
    parseSessionFlags(JSON.stringify({ archivedAt: { a: "2026-01-01T00:00:00.000Z", b: 7, "": "x", c: "" } })).archivedAt,
    { a: "2026-01-01T00:00:00.000Z" },
  );
});

test("parseSessionFlags round-trips a well-formed payload", () => {
  const flags = parseSessionFlags(JSON.stringify({
    pinned: ["a"],
    archived: ["b", "c"],
    archivedAt: { b: "2026-01-01T00:00:00.000Z" },
  }));
  assert.deepEqual(flags, {
    pinned: ["a"],
    archived: ["b", "c"],
    archivedAt: { b: "2026-01-01T00:00:00.000Z" },
  });
});

const rows = [
  { id: "s1" },
  { id: "s2" },
  { id: "s3" },
  { id: "s4" },
];

test("applySessionFlags returns a copy when no flags are set", () => {
  const out = applySessionFlags(rows, { pinned: [], archived: [] });
  assert.deepEqual(out.map((r) => r.id), ["s1", "s2", "s3", "s4"]);
  assert.notEqual(out, rows, "must not alias the input array");
});

test("applySessionFlags drops archived rows without touching the others", () => {
  const out = applySessionFlags(rows, { pinned: [], archived: ["s2"] });
  assert.deepEqual(out.map((r) => r.id), ["s1", "s3", "s4"]);
});

test("applySessionFlags partitions pinned rows stably (no reshuffle)", () => {
  const first = applySessionFlags(rows, { pinned: ["s3"], archived: [] });
  assert.deepEqual(first.map((r) => r.id), ["s3", "s1", "s2", "s4"]);
  const second = applySessionFlags(rows, { pinned: ["s1", "s3"], archived: [] });
  // Pinned keep their original relative order.
  assert.deepEqual(second.map((r) => r.id), ["s1", "s3", "s2", "s4"]);
});

test("applySessionFlags drops a row that is both pinned and archived", () => {
  const out = applySessionFlags(rows, { pinned: ["s2"], archived: ["s2"] });
  assert.deepEqual(out.map((r) => r.id), ["s1", "s3", "s4"]);
});

test("archivedSessions keeps an archived id retrievable while the main list hides it", () => {
  const flags = { pinned: [], archived: ["s2"] };
  assert.deepEqual(applySessionFlags(rows, flags).map((r) => r.id), ["s1", "s3", "s4"]);
  assert.deepEqual(archivedSessions(rows, flags).map((r) => r.id), ["s2"]);
  // Nothing archived means nothing to recover, and the helper never aliases
  // the input array the main filter copied.
  assert.deepEqual(archivedSessions(rows, { pinned: [], archived: [] }), []);
  assert.notEqual(archivedSessions(rows, flags), rows);
});

// fork:no-session-tag —— 状态标记退役后，老 payload 里残留的 `tags` 必须被忽略
// （不是报错、也不是原样回写）。
test("a retired status tag in an old payload is ignored", () => {
  const legacy = parseSessionFlags(JSON.stringify({ pinned: ["a"], tags: { s2: "error" } }));
  assert.deepEqual(legacy, { pinned: ["a"], archived: [], archivedAt: {} });
  assert.equal("tags" in legacy, false);
});

// fork:pi-1.1（上游 2e87ddb1b）—— 归档后又有新消息的会话自动回到列表。
test("an archived session returns once it has messages newer than its archive time", () => {
  const flags = { pinned: [], archived: ["quiet", "revived"], archivedAt: { quiet: "2026-10-01T00:00:00.000Z", revived: "2026-10-01T00:00:00.000Z" } };
  const rows = [
    { id: "quiet", modified: "2026-09-30T00:00:00.000Z" },
    { id: "revived", modified: "2026-10-02T00:00:00.000Z" },
    { id: "fresh", modified: "2026-10-03T00:00:00.000Z" },
  ];
  assert.deepEqual(applySessionFlags(rows, flags).map((row) => row.id), ["revived", "fresh"]);
  assert.deepEqual(archivedSessions(rows, flags).map((row) => row.id), ["quiet"]);
});

test("an archive with no readable time stays archived (never a silent unarchive)", () => {
  const rows = [{ id: "old", modified: "2026-10-09T00:00:00.000Z" }];
  assert.deepEqual(applySessionFlags(rows, { pinned: [], archived: ["old"] }), []);
  assert.deepEqual(applySessionFlags(rows, { pinned: [], archived: ["old"], archivedAt: { old: "not-a-date" } }), []);
});
