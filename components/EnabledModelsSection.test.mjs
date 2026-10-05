// fork:enabled-models — upstream-port marker
//
// 形态收敛（2026-10-06）：模型页照参考项目 pi-web-main 改成「列表 + 一层钻入」后，
// 逐模型开关长在**供应商页的模型行**上，`EnabledModelsSection` 那个组件退役了，
// 这一文件只剩数据（`useEnabledModels`）、纯 helper 与目录刷新按钮。
// 下面的断言因此分两类：**能力还在**（串行化写、拒绝理由、project 只读、
// 聊天名单一个写入口）与**形状**（页面上不再有第二份可用模型表）。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  isLastEnabledModel,
  providerBadgeLabel,
} = await jiti.import("./enabled-models-helpers.ts");

const source = await readFile(new URL("./EnabledModelsSection.tsx", import.meta.url), "utf8");
const modelsConfigSource = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
const helpersSource = await readFile(new URL("./enabled-models-helpers.ts", import.meta.url), "utf8");

const entry = (id, enabled, extra = {}) => ({
  id,
  name: id.toUpperCase(),
  ref: `anthropic/${id}`,
  enabled,
  ...extra,
});

function view(models, overrides = {}) {
  return {
    allEnabled: false,
    patterns: ["anthropic/*"],
    stalePatterns: [],
    enabledTotal: models.filter((model) => model.enabled).length,
    availableTotal: models.length,
    providers: [{
      id: "anthropic",
      name: "Anthropic",
      kind: "builtin",
      enabledCount: models.filter((model) => model.enabled).length,
      models,
    }],
    scope: "global",
    editable: true,
    ...overrides,
  };
}

test("the last enabled model is locked on", () => {
  const models = [entry("sonnet", true), entry("opus", false)];
  const single = view(models);
  assert.equal(isLastEnabledModel(single, models[0]), true);
  assert.equal(isLastEnabledModel(single, models[1]), false);
  assert.equal(isLastEnabledModel(view(models, { enabledTotal: 2 }), models[0]), false);
});

test("the sidebar badge only appears while the selector is narrowed", () => {
  const models = [entry("sonnet", true), entry("opus", false)];
  assert.equal(providerBadgeLabel(view(models), "anthropic"), "1/2");
  assert.equal(providerBadgeLabel(view(models, { allEnabled: true }), "anthropic"), null);
  assert.equal(providerBadgeLabel(view(models), "openai"), null);
  assert.equal(providerBadgeLabel(null, "anthropic"), null);
});

test("edits are serialized so two writes cannot race on the settings file", () => {
  assert.match(source, /if \(pendingRef\.current\) \{\s*\n\s*queuedRef\.current = \{ key, body \};\s*\n\s*return;/);
  assert.match(source, /pendingRef\.current = key;/);
});

test("a save landing mid-toggle is queued, not dropped", () => {
  assert.match(source, /queuedRef\.current = \{ key, body \};/);
  assert.match(source, /if \(queued\) mutateRef\.current\?\.\(queued\.key, queued\.body\);/);
});

test("known refusals are shown as localized text, not raw server strings", () => {
  assert.match(source, /"last-model": "models\.enabledLastModel"/);
  assert.match(source, /"project-scope": "models\.enabledProjectScope"/);
  assert.match(modelsConfigSource, /failure\.messageKey \? t\(enabledModels\.failure\.messageKey\) : enabledModels\.failure\.message/);
});

test("the catalog refresh control keeps its four outcomes", () => {
  assert.match(source, /export function useCatalogRefresh\(/);
  assert.match(source, /models\.catalogOffline/);
  assert.match(source, /models\.catalogUpdated/);
  assert.match(source, /models\.catalogUnchanged/);
  assert.match(source, /models\.catalogUnreachable/);
  // 按钮本身在供应商页的「模型」分节里（与参考项目一致的位置）。
  assert.match(modelsConfigSource, /<CatalogRefreshButton providerId=\{row\.id\} onDone=\{enabledModels\.refresh\} \/>/);
});

test("there is exactly one place that edits one model's chat membership", () => {
  // 供应商页的模型行：开关写 /api/models/enabled，旧的那张「可用模型」表退役。
  assert.match(modelsConfigSource, /onChange=\{\(next\) => enabledModels\.setModels\(entry\.view!\.ref, \[entry\.view!\.ref\], next\)\}/);
  assert.doesNotMatch(modelsConfigSource, /<EnabledModelsSection/);
  assert.doesNotMatch(modelsConfigSource, /<EnabledModelsProviderSwitch/);
  assert.doesNotMatch(modelsConfigSource, /<EnabledModelsBanner/);
  // 供应商页没有 models.json 条目时，这一节仍然挂载（未登录给一句说明，不是整段消失）。
  assert.match(modelsConfigSource, /\{json \? t\("models\.noDefinitions"\) : t\("models\.connectToSeeModels"\)\}/);
});

test("the per-model switch refuses to empty the scope", () => {
  assert.match(modelsConfigSource, /const lastOne = isLastEnabledModel\(enabledModels\.view, entry\.view\);/);
  assert.match(modelsConfigSource, /disabled=\{enabledModels\.pending !== null \|\| !enabledModels\.view\?\.editable \|\| lastOne\}/);
  assert.match(modelsConfigSource, /label=\{lastOne \? t\("models\.enabledLastModel"\) : t\("models\.showInChat"\)\}/);
});

test("a project-scoped enabledModels is reported, not written", () => {
  assert.match(modelsConfigSource, /\{view && !view\.editable && <Notice tone="warn">\{t\("models\.enabledProjectScope"\)\}<\/Notice>\}/);
  assert.match(modelsConfigSource, /disabled=\{!enabledModels\.view\?\.editable\}/);
});

test("the chat list diagnostics stay on the list page", () => {
  // 失配条目 + 清理入口 + 设置文件路径，全在列表页那一节 / 顶部横幅里。
  assert.match(modelsConfigSource, /t\("models\.patternStaleBanner", \{ count: view\.stalePatterns\.length \}\)/);
  assert.match(modelsConfigSource, /onClick=\{enabledModels\.pruneStale\}/);
  assert.match(modelsConfigSource, /<SelectorScopeSection \/>/);
  assert.match(modelsConfigSource, /\{view\.settingsPath\}/);
  assert.match(helpersSource, /providerBadgeLabel/);
});

test("saving models.json re-reads the resolved view", () => {
  // 落盘可能新增/删除模型；重新读一次比在浏览器里猜「现在是什么意思」诚实。
  assert.match(modelsConfigSource, /enabledModels\.refresh\(\);/);
  assert.doesNotMatch(modelsConfigSource, /enabledModels\.resync\(/);
});
