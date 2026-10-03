import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { planningDir, planningStorePath, readPlanningState, writePlanningState, mutatePlanningState } =
  await jiti.import("./planning-store.ts");
const { createTodo, emptyPlanningState } = await jiti.import("./planning-state.ts");

/*
 * fork:proma-44-planning —— 落盘层。
 *
 * `getAgentDir()` 认 `PI_CODING_AGENT_DIR`（`lib/context-budget-settings.test.mjs`
 * 隔离的就是它），所以这里指向一个临时目录：**不碰真实的 ~/.pi/agent**。
 */

const home = mkdtempSync(join(tmpdir(), "pi-planning-test-"));
process.env.PI_CODING_AGENT_DIR = join(home, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });

test.after(() => {
  rmSync(home, { recursive: true, force: true });
});

const NOW = 1_760_000_000_000;

test("the store lives under the pi agent dir in its own planning/ folder", () => {
  assert.equal(planningStorePath(), join(planningDir(), "store.json"));
  assert.equal(planningDir().startsWith(process.env.PI_CODING_AGENT_DIR), true);
  // pi CLI 只需要「认得不出、也不报错」—— 所以这个目录里不放任何它会去解析的形状。
  assert.equal(planningDir().endsWith(join("agent", "planning")), true);
});

test("a missing store reads as an empty library, not an error", () => {
  const state = readPlanningState();
  assert.deepEqual(state, emptyPlanningState());
});

test("write → read round-trips all five collections", () => {
  const state = emptyPlanningState();
  const todo = createTodo(state, { title: "round trip", dueAt: NOW + 1000, notes: "line1\nline2" }, NOW);
  state.events.push({
    id: "e1", title: "event", startAt: NOW, allDay: false,
    tagIds: [], reminderIds: [], createdAt: NOW, updatedAt: NOW,
  });
  state.groups.push({ id: "g1", scope: "todo", name: "G", sortOrder: 0, createdAt: NOW, updatedAt: NOW });
  state.tags.push({ id: "t1", name: "T", createdAt: NOW, updatedAt: NOW });
  writePlanningState(state);

  const back = readPlanningState();
  assert.equal(back.todos[0].id, todo.id);
  assert.equal(back.todos[0].notes, "line1\nline2", "多行描述原样往返");
  assert.equal(back.events[0].id, "e1");
  assert.equal(back.groups[0].name, "G");
  assert.equal(back.tags[0].name, "T");
  assert.equal(back.reminders.length, 1);
  assert.equal(readFileSync(planningStorePath(), "utf8").endsWith("\n"), true);
});

test("the folder ships a README so a human can tell whose data this is", () => {
  writePlanningState(emptyPlanningState());
  const readme = readFileSync(join(planningDir(), "README.md"), "utf8");
  assert.match(readme, /pi CLI/);
  assert.match(readme, /store\.json/);
});

test("a corrupt store degrades to empty instead of 500-ing the whole workspace", () => {
  writeFileSync(planningStorePath(), "{ this is not json", "utf8");
  assert.deepEqual(readPlanningState(), emptyPlanningState());

  // 结构对了但内容是别的形状
  writeFileSync(planningStorePath(), JSON.stringify({ todos: "nope", events: 42 }), "utf8");
  assert.deepEqual(readPlanningState(), emptyPlanningState());

  // 半截条目被丢掉
  writeFileSync(planningStorePath(), JSON.stringify({ todos: [{ id: "a", title: "ok" }, { title: "no id" }] }), "utf8");
  assert.equal(readPlanningState().todos.length, 1);
});

test("mutate is serialized and always persists", async () => {
  writePlanningState(emptyPlanningState());
  // 并发提交：串行化保证每一条都在，而不是后写的把先写的整份覆盖掉。
  await Promise.all([
    mutatePlanningState((s) => { createTodo(s, { title: "one" }, NOW); return s.todos.length; }),
    mutatePlanningState((s) => { createTodo(s, { title: "two" }, NOW); return s.todos.length; }),
    mutatePlanningState((s) => { createTodo(s, { title: "three" }, NOW); return s.todos.length; }),
  ]);
  assert.deepEqual(readPlanningState().todos.map((t) => t.title).sort(), ["one", "three", "two"]);
});

test("a failed mutation does not wedge the queue", async () => {
  writePlanningState(emptyPlanningState());
  await assert.rejects(mutatePlanningState(() => { throw new Error("boom"); }));
  await mutatePlanningState((s) => { createTodo(s, { title: "after the failure" }, NOW); });
  assert.deepEqual(readPlanningState().todos.map((t) => t.title), ["after the failure"]);
});
