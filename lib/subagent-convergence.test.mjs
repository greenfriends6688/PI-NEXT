// PR-36 · 委派收敛屏障的纯逻辑验收：未收敛计数 + 模型可见的软提醒。
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  countActiveSubagents,
  filterActiveSubagents,
  subagentConvergenceReminder,
} = await jiti.import("./subagent-convergence.ts");

function run(parentSessionId, status, overrides = {}) {
  return { sessionId: `child-${parentSessionId}-${status}`, parentSessionId, status, ...overrides };
}

test("only starting/queued/running runs of the same parent count as pending", () => {
  const runs = [
    run("parent-a", "running"),
    run("parent-a", "queued"),
    run("parent-a", "starting"),
    run("parent-a", "completed"),
    run("parent-a", "failed"),
    run("parent-a", "aborted"),
    run("parent-a", "interrupted"),
    run("parent-b", "running"),
  ];
  assert.equal(countActiveSubagents(runs, "parent-a"), 3);
  assert.equal(countActiveSubagents(runs, "parent-b"), 1);
  assert.equal(countActiveSubagents(runs, "parent-c"), 0);
});

test("malformed entries and a missing parent id fail closed", () => {
  const runs = [
    null,
    undefined,
    "not-a-run",
    { parentSessionId: "parent-a" },
    { status: "running" },
    { parentSessionId: "parent-a", status: 42 },
  ];
  assert.equal(countActiveSubagents(runs, "parent-a"), 0);
  assert.equal(countActiveSubagents([run("parent-a", "running")], ""), 0);
});

test("filterActiveSubagents preserves input order and identity", () => {
  const first = run("parent-a", "running", { marker: 1 });
  const second = run("parent-a", "queued", { marker: 2 });
  const filtered = filterActiveSubagents([first, run("parent-b", "running"), second], "parent-a");
  assert.deepEqual(filtered, [first, second]);
});

test("the reminder is empty at zero and names the pending count otherwise", () => {
  assert.equal(subagentConvergenceReminder(0), "");
  assert.equal(subagentConvergenceReminder(-3), "");
  assert.equal(subagentConvergenceReminder(Number.NaN), "");

  const one = subagentConvergenceReminder(1);
  assert.match(one, /1 sub-agent is still running/);
  assert.match(one, /get_subagent_result with wait=true/);
  assert.match(one, /not the final state/);

  const three = subagentConvergenceReminder(3);
  assert.match(three, /3 sub-agents are still running/);
  assert.doesNotMatch(three, /1 sub-agent is/);
});
