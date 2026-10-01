// fork:upstream-998-delegated-work — 上游依据：PR #998（只取 isBusy() 语义）
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET: getRunningSessions } = await jiti.import("./route.ts");

function fakeWrapper(sessionId, isRunning) {
  return {
    sessionId,
    isRunning: () => isRunning,
    hasSuppressedCompletionNotifications: () => false,
    hasPendingUiRequest: () => false,
    pendingUiRequestKind: () => null,
  };
}

function childRun(parentSessionId, status) {
  return { run: { parentSessionId, status, runInBackground: true }, completion: Promise.resolve(), abortRequested: false };
}

function withRuntime(t, { sessions = [], runs = [] } = {}) {
  const previousSessions = globalThis.__piSessions;
  const previousRuns = globalThis.__piSubagentRuns;
  globalThis.__piSessions = new Map(sessions.map((session) => [session.sessionId, session]));
  globalThis.__piSubagentRuns = new Map(runs.map((run, index) => [`child-${index}`, run]));
  t.after(() => {
    globalThis.__piSessions = previousSessions;
    globalThis.__piSubagentRuns = previousRuns;
  });
}

async function snapshot() {
  const response = await getRunningSessions();
  assert.equal(response.status, 200);
  return response.json();
}

test("the polled snapshot reports a parent whose background subagent is still running", async (t) => {
  withRuntime(t, {
    sessions: [fakeWrapper("wrapper-running", true), fakeWrapper("wrapper-idle", false)],
    runs: [
      childRun("parent-busy", "running"),
      childRun("parent-queued", "queued"),
      childRun("parent-done", "completed"),
    ],
  });

  const body = await snapshot();
  assert.deepEqual(body.runningSessionIds.sort(), ["parent-busy", "parent-queued", "wrapper-running"]);
});

test("a parent that runs its own turn and delegates at once is listed once", async (t) => {
  withRuntime(t, {
    sessions: [fakeWrapper("both", true)],
    runs: [childRun("both", "running"), childRun("both", "queued")],
  });

  const body = await snapshot();
  assert.deepEqual(body.runningSessionIds, ["both"]);
});

test("delegated work does not leak into the other snapshot fields", async (t) => {
  withRuntime(t, {
    sessions: [fakeWrapper("wrapper-idle", false)],
    runs: [childRun("parent-busy", "running")],
  });

  const body = await snapshot();
  assert.deepEqual(body.awaitingSessionIds, []);
  assert.deepEqual(body.awaitingSessionKinds, {});
  assert.deepEqual(body.completionNotificationSuppressedSessionIds, []);
});

test("nothing running and nothing delegated is still an empty snapshot", async (t) => {
  withRuntime(t);
  const body = await snapshot();
  assert.deepEqual(body.runningSessionIds, []);
});