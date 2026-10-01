// fork:upstream-0.9.2-thinking-profile — D2-PR-21 展示层的单测
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const {
  compatFlagState,
  compatFlagsForApi,
  countUnknownCompatKeys,
  formatThinkingRequestParams,
  hasModelCostTierDraftValue,
  modelCostTierToDraft,
  parseModelCostTier,
  parseModelCostTiers,
  renameProviderEntry,
  savedModelIds,
  serializeHeaderRows,
  setCompatFlag,
} = await createJiti(import.meta.url)
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

// fork:cost-tiers (B3) —— pi-ai `ModelCostTier`：输入超过阈值后整笔改用这组价格，
// `calculateCost()`（dist/models.js）取最高匹配的阈值。
const tierDraft = (over = {}) => ({ inputTokensAbove: "200000", input: "2", output: "3", cacheRead: "0.25", cacheWrite: "0", ...over });

test("a tier round-trips through its draft without losing the threshold", () => {
  const tier = { inputTokensAbove: 200000, input: 2, output: 3, cacheRead: 0.25, cacheWrite: 0 };
  assert.deepEqual(modelCostTierToDraft(tier), tierDraft());
  assert.deepEqual(parseModelCostTier(tierDraft()), tier);
});

test("a tier needs a positive whole threshold and all four prices", () => {
  for (const bad of ["0", "-1", "1.5", "", "abc", "200000 tokens"]) {
    assert.equal(parseModelCostTier(tierDraft({ inputTokensAbove: bad })), undefined, `threshold ${bad}`);
  }
  // 阈值合法但价格没填全 → 不落盘（半档比没有更危险：会按 0 计费）。
  assert.deepEqual(parseModelCostTier(tierDraft({ cacheWrite: "" })), { inputTokensAbove: 200000, input: 2, output: 3, cacheRead: 0.25, cacheWrite: 0 });
  assert.equal(parseModelCostTier(tierDraft({ output: "-2" })), undefined);
  assert.equal(hasModelCostTierDraftValue(tierDraft({ inputTokensAbove: "" })), true);
  assert.equal(hasModelCostTierDraftValue({ inputTokensAbove: "", input: "", output: "", cacheRead: "", cacheWrite: "" }), false);
});

test("tiers are sorted ascending and blank rows never reach models.json", () => {
  assert.deepEqual(parseModelCostTiers([
    tierDraft({ inputTokensAbove: "1000000", input: "10", output: "20", cacheRead: "1", cacheWrite: "2" }),
    tierDraft(),
    { inputTokensAbove: "", input: "", output: "", cacheRead: "", cacheWrite: "" },
  ]), [
    { inputTokensAbove: 200000, input: 2, output: 3, cacheRead: 0.25, cacheWrite: 0 },
    { inputTokensAbove: 1000000, input: 10, output: 20, cacheRead: 1, cacheWrite: 2 },
  ]);
  // 解析不出来的档被丢掉而不是写成 0 元。
  assert.deepEqual(parseModelCostTiers([tierDraft({ inputTokensAbove: "-1" })]), undefined);
  assert.equal(parseModelCostTiers([]), undefined);
});

test("a duplicated threshold keeps the later row, matching what pi charges", () => {
  assert.deepEqual(parseModelCostTiers([
    tierDraft({ inputTokensAbove: "200000", input: "2" }),
    tierDraft({ inputTokensAbove: "200000", input: "9" }),
  ]), [{ inputTokensAbove: 200000, input: 9, output: 3, cacheRead: 0.25, cacheWrite: 0 }]);
});

// fork:compat-flags (B5) —— 合法字段清单来自 pi-ai 的类型定义，不是猜的。
test("compat switches exist only for protocols pi actually reads", () => {
  // pi-ai 的 compat 是按 api 分支的条件类型（types.d.ts:829）；这些分支是真的。
  for (const api of ["openai-completions", "openai-responses", "anthropic-messages", "bedrock-converse-stream", "mistral-conversations"]) {
    assert.ok(compatFlagsForApi(api).length > 0, `${api} should have compat flags`);
  }
  // google-generative-ai / google-vertex / pi-messages 的那一支是 `never`：配了没人读。
  for (const api of ["google-generative-ai", "google-vertex", "pi-messages", "not-a-protocol", undefined]) {
    assert.deepEqual(compatFlagsForApi(api), [], `${api} must not offer compat switches`);
  }
});

test("every listed compat flag is a boolean pi-ai reads, with an i18n label in all three locales", async () => {
  const types = await readFile(
    new URL("../node_modules/@earendil-works/pi-ai/dist/types.d.ts", import.meta.url),
    "utf8",
  );
  const locales = await Promise.all(["en", "zh-CN", "zh-TW"].map(async (id) => (
    await readFile(new URL(`../lib/i18n/messages/${id}.ts`, import.meta.url), "utf8")
  )));

  for (const api of ["openai-completions", "openai-responses", "azure-openai-responses", "anthropic-messages"]) {
    for (const spec of compatFlagsForApi(api)) {
      // pi-ai 类型里确实声明了这个布尔字段。
      assert.match(types, new RegExp(`\\b${spec.key}\\?: boolean;`), `${spec.key} is not a boolean in pi-ai`);
      assert.ok(spec.defaultValue === null || typeof spec.defaultValue === "boolean", spec.key);
      for (const [index, locale] of locales.entries()) {
        assert.ok(locale.includes(`"${spec.labelKey}"`), `${spec.labelKey} missing from locale #${index}`);
      }
    }
  }
});

test("a compat flag reads back Default / On / Off and drops the key for Default", () => {
  const [spec] = compatFlagsForApi("openai-completions");
  assert.equal(compatFlagState(undefined, spec), "default");
  assert.equal(compatFlagState({}, spec), "default");
  assert.equal(compatFlagState({ [spec.key]: true }, spec), "on");
  assert.equal(compatFlagState({ [spec.key]: false }, spec), "off");
  // pi-ai 的字段是 boolean：非布尔值既不是 On 也不是 Off，只能当没配。
  assert.equal(compatFlagState({ [spec.key]: "yes" }, spec), "default");

  assert.deepEqual(setCompatFlag({ compat: { supportsStore: true } }, "supportsStore", "off"),
    { compat: { supportsStore: false } });
  assert.deepEqual(setCompatFlag({ compat: { supportsStore: true, zaiToolStream: true } }, "supportsStore", "default"),
    { compat: { zaiToolStream: true } });
  // 删到空就把 compat 整个去掉（`compat: undefined` 序列化时不落盘），不留 `compat: {}`。
  assert.deepEqual(setCompatFlag({ compat: { supportsStore: true } }, "supportsStore", "default"), { compat: undefined });
  assert.equal(JSON.stringify(setCompatFlag({ compat: { supportsStore: true } }, "supportsStore", "default")), "{}");
  assert.deepEqual(setCompatFlag({}, "supportsStore", "on"), { compat: { supportsStore: true } });
});

test("unknown compat keys are counted, not silently folded into the summary", () => {
  const specs = compatFlagsForApi("openai-completions");
  assert.equal(countUnknownCompatKeys(undefined, specs), 0);
  assert.equal(countUnknownCompatKeys({ supportsStore: true }, specs), 0);
  // 枚举 / 对象字段没有开关，只能报个数。
  assert.equal(countUnknownCompatKeys({ thinkingFormat: "deepseek", openRouterRouting: {} }, specs), 2);
  // 换一个协议就不是「已知」了：supportsToolSearch 是 responses 家族的字段。
  assert.equal(countUnknownCompatKeys({ supportsToolSearch: true }, compatFlagsForApi("openai-completions")), 1);
  assert.equal(countUnknownCompatKeys({ supportsToolSearch: true }, compatFlagsForApi("openai-responses")), 0);
});
