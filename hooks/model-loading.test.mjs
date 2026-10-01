import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script } from "node:vm";
import { createJiti } from "jiti";
import ts from "typescript";

const source = ts.createSourceFile(
  "useAgentSession.ts",
  await readFile(new URL("./useAgentSession.ts", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const nodes = [];
function visit(node) {
  nodes.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
const loader = nodes.find((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === "loadModels");
const schedule = nodes.find((node) => ts.isVariableDeclaration(node) && node.name.getText(source) === "MODELS_RETRY_DELAYS_MS");
const effect = nodes.find((node) => ts.isCallExpression(node)
  && node.expression.getText(source) === "useEffect"
  && node.arguments[1]?.getText(source) === "[loadModels, modelsRefreshKey]");
const retry = effect.arguments[0].body.statements.find(ts.isExpressionStatement).expression;
function script(text) {
  return new Script(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText);
}
const loadScript = script(`(${loader.initializer.arguments[0].getText(source)})`);
const retryScript = script(retry.getText(source));

// fork:thinking-level-prefill —— loadModels 里多了一次预选判定，把真函数与那张表快照
// 一并放进沙箱（与其它依赖一样处理：沙箱只缺它没有注入的东西）。
const { resolvePrefilledThinkingLevel } = await createJiti(import.meta.url).import("../lib/thinking-level-prefill.ts");

function setup(fetchImpl) {
  const writes = [];
  const delays = [];
  const context = {
    Error, DOMException,
    controller: new AbortController(),
    newSessionCwd: "/project", session: null, isNew: true,
    sessionIdRef: { current: null }, thinkingLevelOverrideRef: { current: null },
    thinkingLevelTablesRef: { current: { thinkingLevels: {}, thinkingLevelPins: {}, thinkingLevelMemory: {} } },
    resolvePrefilledThinkingLevel,
    fetch: fetchImpl,
    MODELS_RETRY_DELAYS_MS: script(schedule.initializer.getText(source)).runInNewContext(),
    delay: async (ms) => { delays.push(ms); },
  };
  for (const name of ["ModelError", "ModelNames", "ModelScopeWarnings", "ModelThinkingLevels", "ModelThinkingLevelMaps", "ModelList", "NewSessionDefaultModel", "ThinkingLevel"]) {
    context[`set${name}`] = (value) => writes.push([name, value]);
  }
  context.loadModels = loadScript.runInNewContext(context);
  return { context, writes, delays, run: () => retryScript.runInNewContext(context) };
}

test("model-load failures stay visible through bounded retries and clear on recovery", async () => {
  for (const [fetchImpl, expected] of [
    [async () => { throw new TypeError("Failed to fetch"); }, "Failed to fetch"],
    [async () => Response.json({ error: "Access denied" }, { status: 403 }), "Access denied"],
    [async () => new Response("Unavailable", { status: 503 }), "Failed to load models (HTTP 503)"],
    [async () => ({ ok: true, json: async () => { throw new SyntaxError("Invalid JSON"); } }), "Invalid JSON"],
  ]) {
    const state = setup(fetchImpl);
    await state.run();
    assert.deepEqual(state.delays, [2_000, 5_000, 10_000]);
    assert.deepEqual(state.writes, Array.from({ length: 4 }, () => ["ModelError", expected]));
  }

  let attempts = 0;
  const recovered = setup(async () => {
    if (++attempts === 1) throw new TypeError("Failed to fetch");
    return Response.json({
      models: { "custom:test": "Test" },
      modelList: [{ provider: "custom", id: "test", name: "Test" }],
      defaultModel: { provider: "custom", modelId: "test" },
      thinkingLevelPins: { "custom/test": "high" },
    });
  });
  await recovered.run();
  assert.equal(attempts, 2);
  assert.deepEqual(recovered.delays, [2_000]);
  assert.deepEqual(recovered.writes.filter(([name]) => name === "ModelError"), [["ModelError", "Failed to fetch"], ["ModelError", null]]);
  assert.ok(recovered.writes.some(([name, value]) => name === "ModelList" && value[0].id === "test"));
  assert.ok(recovered.writes.some(([name, value]) => name === "NewSessionDefaultModel" && value.modelId === "test"));
  assert.ok(recovered.writes.some(([name, value]) => name === "ThinkingLevel" && value === "high"));
});

// fork:thinking-level-prefill —— 没有 pin 时按 per-model 记忆预选，并把「记忆」来源
// 钉到 thinkingLevelOverrideRef（否则选择器显示的档和真跑的不一样）；pin 来源不钉。
test("the remembered level preselects the new session and is pinned onto it", async () => {
  const payload = {
    models: { "custom:test": "Test" },
    modelList: [{ provider: "custom", id: "test", name: "Test" }],
    defaultModel: { provider: "custom", modelId: "test" },
    thinkingLevels: { "custom:test": ["low", "high"] },
    thinkingLevelMemory: { "custom/test": "high" },
  };
  const state = setup(async () => Response.json(payload));
  await state.run();
  assert.ok(state.writes.some(([name, value]) => name === "ThinkingLevel" && value === "high"));
  assert.equal(state.context.thinkingLevelOverrideRef.current, "high");
});

test("no pin and no memory leaves the new session on 'auto' and pins nothing", async () => {
  const state = setup(async () => Response.json({
    models: { "custom:test": "Test" },
    modelList: [{ provider: "custom", id: "test", name: "Test" }],
    defaultModel: { provider: "custom", modelId: "test" },
  }));
  await state.run();
  assert.ok(state.writes.some(([name, value]) => name === "ThinkingLevel" && value === "auto"));
  assert.equal(state.context.thinkingLevelOverrideRef.current, null);
});

test("an explicit override from the user is never replaced by the prefill", async () => {
  const state = setup(async () => Response.json({
    models: { "custom:test": "Test" },
    modelList: [{ provider: "custom", id: "test", name: "Test" }],
    defaultModel: { provider: "custom", modelId: "test" },
    thinkingLevelMemory: { "custom/test": "high" },
  }));
  state.context.thinkingLevelOverrideRef.current = "low";
  await state.run();
  assert.ok(!state.writes.some(([name]) => name === "ThinkingLevel"));
  assert.equal(state.context.thinkingLevelOverrideRef.current, "low");
});

test("cancelling model loads prevents state writes and further retries", async () => {
  for (const status of [200, 403]) {
    const reading = Promise.withResolvers();
    const state = setup(async (_url, { signal }) => ({
      ok: status === 200, status,
      json: () => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        reading.resolve();
      }),
    }));
    const completed = state.run();
    await reading.promise;
    state.context.controller.abort();
    await completed;
    assert.deepEqual(state.writes, []);
    assert.deepEqual(state.delays, []);
  }

  const late = setup(async (_url, { signal }) => ({
    ok: true,
    json: async () => {
      late.context.controller.abort();
      assert.equal(signal.aborted, true);
      return { models: {}, modelList: [] };
    },
  }));
  await late.run();
  assert.deepEqual(late.writes, []);

  let attempts = 0;
  const waiting = setup(async () => { attempts++; throw new TypeError("Failed to fetch"); });
  waiting.context.delay = async () => waiting.context.controller.abort();
  await waiting.run();
  assert.equal(attempts, 1);
});
