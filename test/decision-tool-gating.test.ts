import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * The decision-engine switch decides which tools a conversation is offered
 * (docs/decision-layer.md §5.2, §7.9): with 浏览器控制 off, `browser_task` must not be
 * active and the step-by-step tools must be; with it on, the reverse for the in-page
 * interaction tools. The switch is re-read every turn, so flipping it applies to
 * conversations that already exist. Loaded through the real extension factory with a
 * stub `pi`, the way a session loads it.
 *
 * 电脑操控 was removed outright (macOS 13+ only), so `computer-use.ts` is gone and this
 * covers the browser half alone.
 */

type Session = { active: () => string[]; turn: () => void; registered: string[]; setActive: (names: string[]) => void };

async function session(file: string, switchOn: () => boolean, hostless = false): Promise<Session> {
  const scope = globalThis as Record<string, unknown>;
  for (const key of ["__pinextBrowserTask", "__pinextBrowserTaskEnabled"]) delete scope[key];
  if (!hostless) {
    scope.__pinextBrowserTask = async () => ({});
    scope.__pinextBrowserTaskEnabled = switchOn;
  }
  const registered: string[] = [];
  let active: string[] = [];
  const handlers = new Map<string, Array<() => void>>();
  const pi = {
    registerTool: (tool: { name: string }) => registered.push(tool.name),
    on: (event: string, handler: () => void) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    getActiveTools: () => [...active],
    setActiveTools: (names: string[]) => (active = [...names]),
  };
  const module = await import(`../resources/extensions/${file}?t=${Date.now()}-${Math.random()}`);
  module.default(pi as never);
  // The SDK activates every registered tool, then starts the session.
  active = [...registered];
  for (const handler of handlers.get("session_start") ?? []) handler();
  return {
    active: () => active,
    registered,
    setActive: (names) => (active = names),
    turn: () => {
      for (const handler of handlers.get("before_agent_start") ?? []) handler();
    },
  };
}

const STEPS = ["browser_click", "browser_type", "browser_press"];
const TASK = "browser_task";
const FILE = "browser-use.ts";
const READING = ["browser_open", "browser_navigate", "browser_snapshot", "browser_history"];

const offersSteps = (tools: string[], label: string) => {
  assert.ok(!tools.includes(TASK), `${label}: no ${TASK}`);
  for (const name of [...STEPS, ...READING]) assert.ok(tools.includes(name), `${label}: ${name}`);
};
const offersTask = (tools: string[], label: string) => {
  assert.ok(tools.includes(TASK), `${label}: ${TASK}`);
  for (const name of STEPS) assert.ok(!tools.includes(name), `${label}: no ${name}`);
  for (const name of READING) assert.ok(tools.includes(name), `${label}: ${name}`);
};

test(`${TASK}: switch off from the start offers only the step tools`, async () => {
  const s = await session(FILE, () => false);
  offersSteps(s.active(), "session start");
});

test(`${TASK}: switch on from the start offers ${TASK} instead of the step tools`, async () => {
  const s = await session(FILE, () => true);
  offersTask(s.active(), "session start");
});

test(`${TASK}: flipping the switch applies to an existing conversation from its next turn`, async () => {
  let on = true;
  const s = await session(FILE, () => on);
  offersTask(s.active(), "on");
  on = false;
  s.turn();
  offersSteps(s.active(), "turned off");
  on = true;
  s.turn();
  offersTask(s.active(), "turned back on");
});

test(`${TASK}: a host without the runner never registers it`, async () => {
  const s = await session(FILE, () => true, true);
  assert.ok(!s.registered.includes(TASK));
  offersSteps(s.active(), "headless");
});

test(`${TASK}: tools another extension deactivated stay deactivated`, async () => {
  let on = false;
  const s = await session(FILE, () => on);
  // Another extension narrowed the set to read-only tools; neither group is active.
  s.setActive(["read", "grep"]);
  on = true;
  s.turn();
  assert.deepEqual(s.active(), ["read", "grep"], "switching on adds nothing to a read-only set");
  on = false;
  s.turn();
  assert.deepEqual(s.active(), ["read", "grep"], "nor does switching off");
});
