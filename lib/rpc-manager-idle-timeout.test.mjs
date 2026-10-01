import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { resolveSessionIdleTimeoutMs } = await jiti.import("./rpc-manager.ts");

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function makeIdleInner(sessionId = "session-1") {
  return {
    sessionId,
    isBashRunning: false,
    isStreaming: false,
    isCompacting: false,
    extensionRunner: {},
    agent: { state: {} },
    subscribe: () => () => {},
    dispose() {},
  };
}

test("defaults to the 10-minute idle timeout when the env var is unset or blank", () => {
  assert.equal(resolveSessionIdleTimeoutMs(), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs(""), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs("   "), 10 * 60 * 1000);
});

test("treats zero as disabling idle shutdown", () => {
  assert.equal(resolveSessionIdleTimeoutMs("0"), 0);
});

test("uses a positive value as the timeout in milliseconds", () => {
  assert.equal(resolveSessionIdleTimeoutMs("1800000"), 1_800_000);
  assert.equal(resolveSessionIdleTimeoutMs("2147483647"), 2_147_483_647);
});

test("falls back to the 10-minute default and warns for invalid or out-of-range values", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  assert.equal(resolveSessionIdleTimeoutMs("abc"), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs("-5"), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs("NaN"), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs("Infinity"), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs("2147483648"), 10 * 60 * 1000);
  assert.equal(resolveSessionIdleTimeoutMs("2592000000"), 10 * 60 * 1000);
  assert.equal(warn.mock.callCount(), 6);
});

for (const [rawValue, timeoutMs] of [
  ["0", 0],
  ["1800000", 1_800_000],
  ["2592000000", 600_000],
]) {
  test(`PI_WEB_IDLE_TIMEOUT_MS=${rawValue} applies to an idle session`, async (t) => {
    const previousValue = process.env.PI_WEB_IDLE_TIMEOUT_MS;
    process.env.PI_WEB_IDLE_TIMEOUT_MS = rawValue;
    try {
      const freshJiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
      const { AgentSessionWrapper } = await freshJiti.import("./rpc-manager.ts");

      t.mock.timers.enable({ apis: ["setTimeout"] });
      const wrapper = new AgentSessionWrapper(makeIdleInner());
      t.after(() => wrapper.destroy());
      wrapper.start();
      assert.equal(wrapper.isRunning(), false);

      t.mock.timers.tick(timeoutMs === 0 ? 60 * 60 * 1000 : timeoutMs - 1);
      await nextTurn();
      assert.equal(wrapper.isAlive(), true);

      if (timeoutMs !== 0) {
        t.mock.timers.tick(1);
        await nextTurn();
        assert.equal(wrapper.isAlive(), false);
      }
    } finally {
      if (previousValue === undefined) delete process.env.PI_WEB_IDLE_TIMEOUT_MS;
      else process.env.PI_WEB_IDLE_TIMEOUT_MS = previousValue;
    }
  });
}

// fork:upstream-998-delegated-work — 上游依据：PR #998（只取 isBusy() 语义）
// 真实 wrapper + 假时钟：idle 回收那一行问的是 hasActiveSessionLivenessProvider()，
// 所以这里直接证明「有委派工作在跑」时那 10 分钟窗口会重新开始计时。
const IDLE_MS = 10 * 60 * 1000;

function liveChildRun(parentSessionId, status = "running") {
  return { run: { parentSessionId, status, runInBackground: true }, completion: Promise.resolve(), abortRequested: false };
}

/** Real wrapper on the default idle timeout, with the process-wide run table faked. */
async function startWrapperWithDelegatedWork(t, parentSessionId = "session-1") {
  const freshJiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
  const { AgentSessionWrapper } = await freshJiti.import("./rpc-manager.ts");
  const previousRuns = globalThis.__piSubagentRuns;
  globalThis.__piSubagentRuns = new Map();
  t.after(() => {
    globalThis.__piSubagentRuns = previousRuns;
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const wrapper = new AgentSessionWrapper(makeIdleInner(parentSessionId));
  t.after(() => wrapper.destroy());
  wrapper.start();
  assert.equal(wrapper.isRunning(), false);
  assert.equal(wrapper.isAlive(), true);
  return { runs: globalThis.__piSubagentRuns, wrapper };
}

test("a session with a background subagent still running is never idle-evicted", async (t) => {
  const { runs, wrapper } = await startWrapperWithDelegatedWork(t);
  // The parent's own turn already returned; only the uncollected child run is left.
  runs.set("child-1", liveChildRun("session-1", "running"));

  for (let round = 0; round < 3; round += 1) {
    t.mock.timers.tick(IDLE_MS);
    await nextTurn();
    assert.equal(wrapper.isAlive(), true, `idle eviction fired in round ${round + 1}`);
  }
  assert.equal(runs.has("child-1"), true, "this path never touches the run table");
});

test("a queued child run holds the session until the run is collected", async (t) => {
  const { runs, wrapper } = await startWrapperWithDelegatedWork(t);
  runs.set("child-queued", liveChildRun("session-1", "queued"));

  t.mock.timers.tick(IDLE_MS);
  await nextTurn();
  assert.equal(wrapper.isAlive(), true);

  // lib/subagent-runtime.ts removes the entry once the run reports a terminal
  // result; from then on the session is an ordinary idle one again.
  runs.delete("child-queued");
  t.mock.timers.tick(IDLE_MS);
  await nextTurn();
  assert.equal(wrapper.isAlive(), false);
});

test("another session's background subagent does not keep an idle session alive", async (t) => {
  const { wrapper } = await startWrapperWithDelegatedWork(t);
  globalThis.__piSubagentRuns.set("child-other", liveChildRun("someone-else", "running"));

  t.mock.timers.tick(IDLE_MS);
  await nextTurn();
  assert.equal(wrapper.isAlive(), false);
});

test("a child run that already ended does not pin its parent session", async (t) => {
  const { runs, wrapper } = await startWrapperWithDelegatedWork(t);
  // A terminal run can still sit in the table for one tick (abort/cleanup lands
  // after the result); it must not read as delegated work.
  runs.set("child-done", liveChildRun("session-1", "completed"));

  t.mock.timers.tick(IDLE_MS);
  await nextTurn();
  assert.equal(wrapper.isAlive(), false);
});
