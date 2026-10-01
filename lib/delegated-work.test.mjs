// fork:upstream-998-delegated-work — 上游依据：PR #998（只取「有委派工作就不算 idle」的语义）
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  ACTIVE_SUBAGENT_STATUSES,
  hasDelegatedWorkRunning,
  listDelegatedWorkSessionIds,
} = await jiti.import("./delegated-work.ts");

/** A run the way lib/subagent-runtime.ts stores it; `overrides` stays minimal on purpose. */
function storedRun(parentSessionId, status, overrides = {}) {
  return {
    run: {
      sessionId: `child-of-${parentSessionId}`,
      sessionPath: `/tmp/child-of-${parentSessionId}.jsonl`,
      parentSessionId,
      parentToolCallId: "tool-call",
      profile: "Explore",
      description: "Inspect parser",
      task: "Find the parser",
      runInBackground: true,
      status,
      createdAt: "2026-10-01T00:00:00.000Z",
      ...overrides,
    },
    completion: new Promise(() => {}),
    abortRequested: false,
  };
}

function withRuns(t, entries) {
  const previous = globalThis.__piSubagentRuns;
  globalThis.__piSubagentRuns = entries === null ? undefined : new Map(entries ?? []);
  t.after(() => {
    globalThis.__piSubagentRuns = previous;
  });
}

test("a background run whose result is still uncollected keeps its parent busy", (t) => {
  withRuns(t, [["child-1", storedRun("parent-1", "running")]]);
  assert.equal(hasDelegatedWorkRunning({ sessionId: "parent-1" }), true);
  // The parent's own turn has ended; only the child keeps it alive.
  assert.deepEqual(listDelegatedWorkSessionIds(), ["parent-1"]);
});

test("every live run status counts as delegated work", (t) => {
  withRuns(t, [
    ["child-starting", storedRun("parent-starting", "starting")],
    ["child-queued", storedRun("parent-queued", "queued")],
    ["child-running", storedRun("parent-running", "running")],
  ]);
  for (const status of ACTIVE_SUBAGENT_STATUSES) {
    assert.equal(typeof status, "string");
  }
  assert.deepEqual([...ACTIVE_SUBAGENT_STATUSES].sort(), ["queued", "running", "starting"]);
  for (const sessionId of ["parent-starting", "parent-queued", "parent-running"]) {
    assert.equal(hasDelegatedWorkRunning({ sessionId }), true, sessionId);
  }
  assert.deepEqual(
    listDelegatedWorkSessionIds(),
    ["parent-starting", "parent-queued", "parent-running"],
  );
});

test("a foreground run also keeps its parent busy", (t) => {
  withRuns(t, [["child-1", storedRun("parent-1", "running", { runInBackground: false })]]);
  assert.equal(hasDelegatedWorkRunning({ sessionId: "parent-1" }), true);
});

test("terminal and interrupted runs hold nothing open", (t) => {
  withRuns(t, [
    ["c1", storedRun("parent-1", "completed")],
    ["c2", storedRun("parent-2", "failed")],
    ["c3", storedRun("parent-3", "aborted")],
    ["c4", storedRun("parent-4", "interrupted")],
  ]);
  for (const sessionId of ["parent-1", "parent-2", "parent-3", "parent-4"]) {
    assert.equal(hasDelegatedWorkRunning({ sessionId }), false, sessionId);
  }
  assert.deepEqual(listDelegatedWorkSessionIds(), []);
});

test("another session's child never makes this one busy", (t) => {
  withRuns(t, [["child-1", storedRun("parent-1", "running")]]);
  assert.equal(hasDelegatedWorkRunning({ sessionId: "parent-2" }), false);
  assert.equal(hasDelegatedWorkRunning({ sessionId: "" }), false);
  assert.equal(hasDelegatedWorkRunning({}), false);
});

test("one session with several live children is reported once", (t) => {
  withRuns(t, [
    ["child-1", storedRun("parent-1", "running")],
    ["child-2", storedRun("parent-1", "running")],
    ["child-3", storedRun("parent-1", "queued")],
  ]);
  assert.equal(hasDelegatedWorkRunning({ sessionId: "parent-1" }), true);
  assert.deepEqual(listDelegatedWorkSessionIds(), ["parent-1"]);
});

test("a missing, empty or malformed registry answers quiet instead of throwing", (t) => {
  withRuns(t, null);
  assert.equal(hasDelegatedWorkRunning({ sessionId: "parent-1" }), false);
  assert.deepEqual(listDelegatedWorkSessionIds(), []);

  withRuns(t, []);
  assert.equal(hasDelegatedWorkRunning({ sessionId: "parent-1" }), false);

  withRuns(t, [
    ["empty", {}],
    ["no-run", { completion: Promise.resolve() }],
    ["no-parent", storedRun("", "running")],
    ["nullish-parent", storedRun(undefined, "running")],
    ["bad-status", storedRun("parent-1", 42)],
  ]);
  assert.equal(hasDelegatedWorkRunning({ sessionId: "parent-1" }), false);
  assert.deepEqual(listDelegatedWorkSessionIds(), []);
});

test("a non-Map global is ignored rather than crashing the idle path", (t) => {
  const previous = globalThis.__piSubagentRuns;
  globalThis.__piSubagentRuns = { nope: true };
  t.after(() => {
    globalThis.__piSubagentRuns = previous;
  });
  assert.equal(hasDelegatedWorkRunning({ sessionId: "parent-1" }), false);
  assert.deepEqual(listDelegatedWorkSessionIds(), []);
});