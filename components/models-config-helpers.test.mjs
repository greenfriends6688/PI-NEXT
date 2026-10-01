// fork:upstream-0.9.2-thinking-profile — D2-PR-21 展示层的单测
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { formatThinkingRequestParams, renameProviderEntry, savedModelIds, serializeHeaderRows } = await createJiti(import.meta.url)
  .import("./models-config-helpers.ts");

test("A1 — header rows with a blank value never reach models.json", () => {
  assert.deepEqual(
    serializeHeaderRows([
      { id: 0, name: "X-Api-Key", value: "sk-live" },
      { id: 1, name: "X-Trace", value: "" },
      { id: 2, name: "X-Spaced", value: "   " },
      { id: 3, name: "", value: "orphan" },
    ]),
    { "X-Api-Key": "sk-live" },
  );
});

test("A1 — a model left with no usable rows clears its header overrides", () => {
  assert.equal(serializeHeaderRows([{ id: 0, name: "X-Trace", value: "" }]), undefined);
  assert.equal(serializeHeaderRows([]), undefined);
});

test("A1 — non-blank rows keep their value verbatim and the last duplicate wins", () => {
  assert.deepEqual(
    serializeHeaderRows([
      { id: 0, name: " X-Key ", value: " first " },
      { id: 1, name: "X-Key", value: "second" },
    ]),
    { "X-Key": "second" },
  );
});

test("flattens nested request params into one line", () => {
  assert.equal(
    formatThinkingRequestParams({ reasoning_effort: "high" }),
    "reasoning_effort=high",
  );
  assert.equal(
    formatThinkingRequestParams({ thinking: { type: "enabled", budget_tokens: 8192, display: "summarized" } }),
    "thinking.type=enabled, thinking.budget_tokens=8192, thinking.display=summarized",
  );
  assert.equal(
    formatThinkingRequestParams({ thinkingConfig: { includeThoughts: true, thinkingLevel: "HIGH" } }),
    "thinkingConfig.includeThoughts=true, thinkingConfig.thinkingLevel=HIGH",
  );
  assert.equal(
    formatThinkingRequestParams({ reasoning: { effort: "none" }, include: ["reasoning.encrypted_content"] }),
    "reasoning.effort=none, include=reasoning.encrypted_content",
  );
});

test("returns null when a level sends no reasoning params", () => {
  assert.equal(formatThinkingRequestParams({}), null);
});

// fork:model-rename-save —— 上游 bd85004 (#969, fixes #903)。搬动逻辑全部在这里，
// 组件只负责「什么时候搬」。
const renameTracking = (config) => ({
  savedProviders: new Set(Object.keys(config.providers ?? {})),
  renames: new Map(),
  slots: savedModelIds(config),
});

test("renaming a provider keeps its place and moves its rename tracking", () => {
  const config = {
    providers: {
      first: { models: [{ id: "a" }] },
      stepfun: { baseUrl: "https://x", models: [{ id: "aaa" }, { id: "ddd" }] },
      last: {},
    },
  };
  const tracking = renameTracking(config);
  const renamed = renameProviderEntry(config, tracking, "stepfun", "house");

  assert.deepEqual(Object.keys(renamed.providers), ["first", "house", "last"]);
  assert.equal(renamed.providers.house, config.providers.stepfun);
  assert.deepEqual([...tracking.renames], [["stepfun", "house"]]);
  assert.deepEqual(tracking.slots.get("house"), ["aaa", "ddd"]);
  assert.equal(tracking.slots.has("stepfun"), false);

  // 改回原名取消这次搬动，而不是记一条 stepfun -> stepfun。
  renameProviderEntry(renamed, tracking, "house", "stepfun");
  assert.deepEqual([...tracking.renames], []);
});

test("a chained rename still records the id models.json has on disk", () => {
  const config = { providers: { stepfun: { models: [{ id: "aaa" }] } } };
  const tracking = renameTracking(config);
  const once = renameProviderEntry(config, tracking, "stepfun", "house");
  const twice = renameProviderEntry(once, tracking, "house", "home");

  assert.deepEqual(Object.keys(twice.providers), ["home"]);
  assert.deepEqual([...tracking.renames], [["stepfun", "home"]]);
  assert.deepEqual([...tracking.slots.keys()], ["home"]);
});

test("renaming a provider onto another provider's id changes nothing", () => {
  const config = { providers: { one: { models: [{ id: "a" }] }, two: { models: [{ id: "b" }] } } };
  const tracking = renameTracking(config);

  assert.equal(renameProviderEntry(config, tracking, "one", "two"), null);
  assert.equal(renameProviderEntry(config, tracking, "gone", "three"), null);
  assert.deepEqual([...tracking.renames], []);
  assert.deepEqual([...tracking.slots.keys()], ["one", "two"]);
});

test("a provider added since the last save is renamed without a settings rewrite", () => {
  const config = { providers: { "new-provider": {} } };
  const tracking = { savedProviders: new Set(), renames: new Map(), slots: new Map() };
  const renamed = renameProviderEntry(config, tracking, "new-provider", "house");

  assert.deepEqual(Object.keys(renamed.providers), ["house"]);
  assert.deepEqual([...tracking.renames], []);
});
