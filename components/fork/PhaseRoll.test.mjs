import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const {
  PHASE_ROLL_HOLD_MS,
  PHASE_ROLL_MAX_PENDING,
  PHASE_ROLL_TIMER_DRIFT_SKIP_MS,
  PHASE_ROLL_TOTAL_MS,
  PHASE_ROLL_TRANSITION_MS,
  PhaseRoll,
  dropLatePhaseBacklog,
  enqueuePhaseSnapshot,
  phaseKeyOf,
  phaseLabel,
} = await jiti.import("./PhaseRoll.tsx");

const source = await readFile(new URL("./PhaseRoll.tsx", import.meta.url), "utf8");
const snapshot = (key, text = key) => ({ key, text });

test("the queue holds at most two entries", () => {
  assert.equal(PHASE_ROLL_MAX_PENDING, 2);
  let queue = [];
  for (const key of ["a", "b", "c", "d", "e"]) {
    queue = enqueuePhaseSnapshot(queue, snapshot(key));
    assert.ok(queue.length <= PHASE_ROLL_MAX_PENDING, `queue grew past the cap: ${queue.length}`);
  }
  // 队首（下一条要播的）不被后来的条目挤掉，第三格每来一条就换一次。
  assert.deepEqual(queue.map((item) => item.key), ["a", "e"]);
});

test("an empty queue accepts the first entry as-is", () => {
  assert.deepEqual(enqueuePhaseSnapshot([], snapshot("waiting", "Waiting")), [{ key: "waiting", text: "Waiting" }]);
});

test("a same-key snapshot replaces in place instead of replaying the roll", () => {
  const queued = enqueuePhaseSnapshot(enqueuePhaseSnapshot([], snapshot("bash", "Running bash...")), snapshot("read", "Reading"));
  const replacedTail = enqueuePhaseSnapshot(queued, snapshot("read", "Reading file.ts"));
  assert.deepEqual(replacedTail, [snapshot("bash", "Running bash..."), snapshot("read", "Reading file.ts")]);

  const replacedHead = enqueuePhaseSnapshot(queued, snapshot("bash", "Running bash... 42%"));
  assert.deepEqual(replacedHead, [snapshot("bash", "Running bash... 42%"), snapshot("read", "Reading")]);
});

test("a late timer drops the backlog down to the newest snapshot", () => {
  const queue = [snapshot("a"), snapshot("b")];
  assert.equal(PHASE_ROLL_TIMER_DRIFT_SKIP_MS, 250);

  // 迟到 >250ms 且积压多于一条：旧状态不补播。
  assert.deepEqual(dropLatePhaseBacklog(queue, 900), [snapshot("b")]);
  // 刚好 250ms 不算迟到（判定是严格大于）。
  assert.deepEqual(dropLatePhaseBacklog(queue, 250), queue);
  // 只有一条时无所谓迟不迟到。
  assert.deepEqual(dropLatePhaseBacklog([snapshot("a")], 900), [snapshot("a")]);
  assert.deepEqual(dropLatePhaseBacklog([], 900), []);
});

test("the roll budget is 300ms transition + 500ms hold", () => {
  assert.equal(PHASE_ROLL_TRANSITION_MS, 300);
  assert.equal(PHASE_ROLL_HOLD_MS, 500);
  assert.equal(PHASE_ROLL_TOTAL_MS, 800);
});

test("SSR renders the current phase statically (no animation middle state)", () => {
  const html = renderToStaticMarkup(
    React.createElement(PhaseRoll, { text: "Waiting for model...", phaseKey: "waiting_model" }),
  );
  assert.match(html, /role="status"/);
  assert.match(html, /data-fork-phase-roll="waiting_model"/);
  assert.match(html, /Waiting for model\.\.\./);
});

test("reduced motion shows the latest text directly", () => {
  const html = renderToStaticMarkup(
    React.createElement(PhaseRoll, { text: "Running read...", phaseKey: "tools:read", reducedMotion: true }),
  );
  assert.match(html, /Running read\.\.\./);
  // 没有旧层（退出动画的残留）被打进静态快照。
  assert.equal((html.match(/data-fork-phase-roll/g) ?? []).length, 1);
});

test("no text renders nothing", () => {
  const html = renderToStaticMarkup(
    React.createElement(PhaseRoll, { text: null, phaseKey: "none", reducedMotion: true }),
  );
  assert.equal(html, "");
});

test("the WAAPI roll is gated on explicit no-preference and only nudges transform/opacity", () => {
  assert.match(source, /preference === "no-preference"/);
  assert.match(source, /translateY\(0\.8em\)/);
  assert.match(source, /translateY\(-0\.8em\)/);
  assert.match(source, /typeof incoming\.animate === "function"/);
  assert.doesNotMatch(source, /from "framer-motion"|from "motion\/react"/);
  // 不动布局尺寸：动画键只有 transform / opacity。
  assert.doesNotMatch(source, /animate\(\[\s*\{[^}]*\b(width|height|top|left)\b/);
});

// fork:zm-08 —— 压缩期间的相位文案与相位身份（上游 2e66e40 / #1008）。
// 这两个纯函数从 ChatWindow.tsx 搬到这里，就是为了让优先级能被 node 直接断言：
// ChatWindow 一 import 就把 next/image 与整棵组件树拖进来，测不了。

/** 把 key 与参数原样拼回去的 t，断言读起来就是意图。 */
const t = (key, params = {}) => (Object.keys(params).length ? `${key}:${JSON.stringify(params)}` : key);

test("names the phase the stream is actually in", () => {
  assert.equal(phaseLabel({ kind: "waiting_model" }, t), "chat.waitingModel");
  assert.equal(phaseLabel({ kind: "running_command" }, t), "chat.runningCommand");
  assert.equal(phaseLabel(null, t), null);
  assert.equal(phaseLabel(undefined, t), null);
});

test("describes the tools currently running", () => {
  assert.equal(phaseLabel({ kind: "running_tools", tools: [{ name: "Read" }] }, t), 'chat.runningNamedTool:{"name":"Read"}');
  assert.equal(
    phaseLabel({ kind: "running_tools", tools: [{ name: "Read" }, { name: "Grep" }] }, t),
    'chat.runningTools:{"names":"Read, Grep"}',
  );
  assert.equal(phaseLabel({ kind: "running_tools", tools: [] }, t), "chat.runningTool");
  // Progress belongs to the newest tool, not the first one.
  assert.equal(
    phaseLabel({ kind: "running_tools", tools: [{ name: "Read" }, { name: "Bash", progress: "3/5" }] }, t),
    'chat.runningNamedTool:{"name":"Bash"} 3/5',
  );
});

test("compaction outranks waiting for model so a long compaction does not read as a hang", () => {
  // The reported bug: a turn enters auto-compaction, the stream has not produced a token
  // yet, and the phase is still the one set when the prompt was sent.
  assert.equal(phaseLabel({ kind: "waiting_model" }, t, true), "chat.compacting");
  assert.equal(phaseLabel({ kind: "running_tools", tools: [{ name: "Read" }] }, t, true), "chat.compacting");
  // Compaction can also be the only thing blocking the turn: no phase at all.
  assert.equal(phaseLabel(null, t, true), "chat.compacting");
  assert.equal(phaseLabel(undefined, t, true), "chat.compacting");
});

test("the compaction flag off keeps the phase label", () => {
  assert.equal(phaseLabel({ kind: "waiting_model" }, t, false), "chat.waitingModel");
  assert.equal(phaseLabel({ kind: "running_command" }, t, false), "chat.runningCommand");
});

test("compaction is its own phase identity so the status line rolls into it", () => {
  // Same key would swap the text in place without the roll, and the switch into
  // compaction is exactly the change the user has to notice.
  assert.equal(phaseKeyOf({ kind: "waiting_model" }), "waiting_model");
  assert.equal(phaseKeyOf(null), "idle");
  assert.equal(phaseKeyOf({ kind: "running_tools", tools: [{ name: "Read", id: "t1" }] }), "tools:t1");
  assert.equal(phaseKeyOf({ kind: "waiting_model" }, true), "compacting");
  assert.equal(phaseKeyOf(null, true), "compacting");
  assert.notEqual(phaseKeyOf({ kind: "waiting_model" }, true), phaseKeyOf({ kind: "waiting_model" }));
});

test("the compacting phase reuses the model spinner glyph", () => {
  const html = renderToStaticMarkup(
    React.createElement(PhaseRoll, { text: phaseLabel({ kind: "waiting_model" }, t, true), phaseKey: phaseKeyOf(null, true), reducedMotion: true }),
  );
  assert.match(html, /data-fork-phase-roll="compacting"/);
  assert.match(html, /data-ico="loader-circle"/);
  assert.match(html, /chat\.compacting/);
});
