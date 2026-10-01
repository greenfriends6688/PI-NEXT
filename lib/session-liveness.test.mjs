import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  SESSION_LIVENESS_LEASE_TTL_MS,
  SESSION_LIVENESS_REGISTRY_KEY,
  acquireSessionLivenessLease,
  hasActiveSessionLivenessProvider,
  registerSessionLivenessProvider,
  renewSessionLivenessLeases,
} = await jiti.import("./session-liveness.ts");

test("documented global registry contract remains compatible with extensions", (t) => {
  assert.equal(SESSION_LIVENESS_REGISTRY_KEY, "@agegr/pi-web/session-liveness/v1");
  const liveness = globalThis[Symbol.for(SESSION_LIVENESS_REGISTRY_KEY)];
  assert.equal(liveness?.version, 1);
  assert.equal(typeof liveness?.register, "function");
  assert.equal(typeof liveness?.hasActiveProvider, "function");

  const release = liveness.register({
    name: "global-contract-provider",
    sessionId: "session-global-contract",
    isActive: () => true,
  });
  t.after(release);

  assert.equal(liveness.hasActiveProvider({ sessionId: "session-global-contract" }), true);
});

test("session liveness providers are matched by exact session id or file", (t) => {
  const dispose = registerSessionLivenessProvider({
    name: "test-provider",
    sessionId: "session-a",
    sessionFile: "/tmp/session-a.jsonl",
    isActive: () => true,
  });
  t.after(dispose);

  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-a" }), true);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "alias", sessionFile: "/tmp/session-a.jsonl" }), true);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session" }), false);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-a-suffix" }), false);
});

test("each registration receives an independent idempotent disposer", () => {
  const provider = {
    name: "reloadable-provider",
    sessionId: "session-reload",
    isActive: () => true,
  };
  const disposeOld = registerSessionLivenessProvider(provider);
  const disposeReplacement = registerSessionLivenessProvider(provider);

  disposeOld();
  disposeOld();
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-reload" }), true);

  disposeReplacement();
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-reload" }), false);
});

test("malformed registrations are rejected", () => {
  assert.throws(() => registerSessionLivenessProvider({
    name: "invalid-provider",
    sessionId: "",
    isActive: () => true,
  }), /sessionId must be a non-empty string/);
});

test("provider failures preserve the matching session", (t) => {
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(" "));
  t.after(() => { console.error = originalError; });
  const disposeThrowing = registerSessionLivenessProvider({
    name: "broken-provider",
    sessionId: "session-broken",
    isActive: () => {
      throw new Error("probe failed");
    },
  });
  const disposeMalformed = registerSessionLivenessProvider({
    name: "malformed-provider",
    sessionId: "session-malformed",
    isActive: () => "yes",
  });
  t.after(disposeThrowing);
  t.after(disposeMalformed);

  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-broken" }), true);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-malformed" }), true);
  assert.match(errors.join("\n"), /broken-provider.*probe failed/);
  assert.match(errors.join("\n"), /malformed-provider.*must return a boolean/);
});

test("non-stringifiable provider failures preserve the session until recovery", (t) => {
  t.mock.method(console, "error", () => {});
  const error = Object.create(null);
  let failing = true;
  t.after(registerSessionLivenessProvider({
    name: "non-stringifiable-provider",
    sessionId: "session-non-stringifiable",
    isActive: () => {
      if (failing) throw error;
      return false;
    },
  }));

  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-non-stringifiable" }), true);
  failing = false;
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-non-stringifiable" }), false);
});

test("selected-session leases expire, renew together, and release cleanly", (t) => {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const first = acquireSessionLivenessLease("session-lease");
  const second = acquireSessionLivenessLease("session-lease");
  t.after(() => {
    first.release();
    second.release();
  });

  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-lease" }), true);
  assert.equal(renewSessionLivenessLeases("session-lease"), 2);
  now += SESSION_LIVENESS_LEASE_TTL_MS + 1;
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-lease" }), false);
  assert.equal(renewSessionLivenessLeases("session-lease"), 0);

  first.release();
  second.release();
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-lease" }), false);
});

// fork:upstream-998-delegated-work — 上游依据：PR #998（只取 isBusy() 语义，不抄 artifact-mtime 扫描）
function withDelegatedRuns(t, entries) {
  const previous = globalThis.__piSubagentRuns;
  globalThis.__piSubagentRuns = new Map(entries ?? []);
  t.after(() => {
    globalThis.__piSubagentRuns = previous;
  });
}

function liveChildRun(parentSessionId, status) {
  return { run: { parentSessionId, status, runInBackground: true }, completion: Promise.resolve(), abortRequested: false };
}

test("delegated work keeps a session alive even with no provider registered", (t) => {
  withDelegatedRuns(t, [["child", liveChildRun("session-delegated", "running")]]);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-delegated" }), true);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-unrelated" }), false);
});

test("a finished delegated run releases the session back to idle eviction", (t) => {
  withDelegatedRuns(t, [["child", liveChildRun("session-finished", "completed")]]);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-finished" }), false);

  const runs = globalThis.__piSubagentRuns;
  // lib/subagent-runtime.ts deletes the entry on every terminal outcome, and an
  // aborted background run has no other trace — both must answer "idle".
  runs.delete("child");
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-finished" }), false);
});

test("the global registry contract extensions rely on stays provider-only", (t) => {
  withDelegatedRuns(t, [["child", liveChildRun("session-global-delegated", "running")]]);
  const liveness = globalThis[Symbol.for(SESSION_LIVENESS_REGISTRY_KEY)];
  assert.equal(liveness.hasActiveProvider({ sessionId: "session-global-delegated" }), false);
  assert.equal(hasActiveSessionLivenessProvider({ sessionId: "session-global-delegated" }), true);
});
