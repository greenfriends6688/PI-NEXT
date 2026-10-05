import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

/* 形态：照参考项目 pi-web-main 的 `components/ModelsConfig.tsx`（列表 + 一层钻入）。
   下面的断言分三类：
   · **行为**（成本草稿 / 协议清单 / Header 行 / 兼容开关 / 思考档）—— 纯 helper 跑；
   · **形状**（新 DOM 的结构约定）；
   · **能力保全**（AGENTS.md 登记过的模型相关能力必须仍然能用）。 */

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  hasModelCostDraftValue,
  KNOWN_MODEL_APIS,
  MODEL_API_LABELS,
  modelApiChoices,
  modelCostToDraft,
  parseCompleteModelCost,
  serializeHeaderRows,
  setCompatBool,
  updateHeaderRow,
} = await jiti.import("./models-config-helpers.ts");

const source = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");

const stripComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const code = stripComments(source);

// ── 行为：纯 helper ───────────────────────────────────────────────────────────

// fork:model-api-protocols (B4) —— 协议下拉必须覆盖 pi-ai 的 `KnownApi` 全集。
test("the api protocol list is exactly pi-ai's KnownApi union", async () => {
  const types = await readFile(
    new URL("../node_modules/@earendil-works/pi-ai/dist/types.d.ts", import.meta.url),
    "utf8",
  );
  const union = types.match(/export type KnownApi =([^;]+);/);
  assert.ok(union, "pi-ai types.d.ts no longer declares KnownApi");
  const known = [...union[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  assert.ok(known.length > 4, `KnownApi union parsed only ${known.length} entries`);
  assert.deepEqual([...KNOWN_MODEL_APIS].sort(), [...known].sort());
  for (const api of known) assert.ok(KNOWN_MODEL_APIS.includes(api), `api option missing: ${api}`);
});

// fork:api-labels —— 协议下拉显示人话 + 端点路径，落盘值仍是内部 id。
test("every protocol dropdown entry has a human label", () => {
  const choices = modelApiChoices();
  assert.equal(choices.length, KNOWN_MODEL_APIS.length);
  assert.deepEqual(choices.map((c) => c.value), [...KNOWN_MODEL_APIS]);
  for (const choice of choices) {
    assert.ok(MODEL_API_LABELS[choice.value], `${choice.value} 缺少 MODEL_API_LABELS`);
    assert.notEqual(choice.label, choice.value, `${choice.value} 显示的还是内部 id`);
  }
  assert.equal(
    choices.find((c) => c.value === "openai-completions").label,
    "Chat Completions (/chat/completions)",
  );
});

test("model cost drafts default blank prices to zero unless all are blank", () => {
  const complete = { input: "1.25", output: "10", cacheRead: "0.125", cacheWrite: "0" };
  assert.deepEqual(parseCompleteModelCost(complete), { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 });
  assert.deepEqual(parseCompleteModelCost({ ...complete, input: "", cacheWrite: "" }), { input: 0, output: 10, cacheRead: 0.125, cacheWrite: 0 });
  assert.deepEqual(parseCompleteModelCost({ input: "1.25", output: "", cacheRead: "", cacheWrite: "" }), { input: 1.25, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(parseCompleteModelCost(modelCostToDraft()), undefined);
  assert.equal(parseCompleteModelCost({ ...complete, output: "not-a-price" }), undefined);
  assert.equal(parseCompleteModelCost({ ...complete, output: "-1" }), undefined);
  assert.equal(hasModelCostDraftValue(modelCostToDraft()), false);
  assert.equal(hasModelCostDraftValue({ ...complete, cacheWrite: "" }), true);
});

test("editing a header preserves row order and stable identities", () => {
  const rows = [
    { id: 10, name: "X-First", value: "one" },
    { id: 11, name: "X-Second", value: "two" },
  ];
  const updated = updateHeaderRow(rows, 10, { name: "X-First-Edited" });
  assert.deepEqual(updated.map(({ id, name }) => ({ id, name })), [
    { id: 10, name: "X-First-Edited" },
    { id: 11, name: "X-Second" },
  ]);
  assert.deepEqual(serializeHeaderRows(updated), { "X-First-Edited": "one", "X-Second": "two" });
});

test("blank header drafts are omitted until they have a name", () => {
  const rows = [
    { id: 1, name: "X-Existing", value: "kept" },
    { id: 2, name: "", value: "draft value" },
  ];
  assert.deepEqual(serializeHeaderRows(rows), { "X-Existing": "kept" });
  assert.deepEqual(
    serializeHeaderRows(updateHeaderRow(rows, 2, { name: "X-Draft" })),
    { "X-Existing": "kept", "X-Draft": "draft value" },
  );
});

test("disabling the developer role writes an explicit false override", () => {
  assert.deepEqual(
    setCompatBool({ compat: { supportsStore: true } }, "supportsDeveloperRole", false),
    { compat: { supportsStore: true, supportsDeveloperRole: false } },
  );
});

// ── 形状：新 DOM ──────────────────────────────────────────────────────────────

test("the page is a provider list with one level of drill-in", () => {
  assert.match(code, /const \[view, setView\] = useState<View>\(readRememberedView\);/);
  // 列表页：工具栏一句话 + 两枚动作，点行钻入。
  assert.match(code, /className="fork-pwa-ms-page fork-pwa-ms-models"/);
  assert.match(code, /t\("models\.summary", \{ count: chatTotal \}\)/);
  assert.match(code, /t\("models\.pickChatModels"\)/);
  assert.match(code, /onClick=\{\(\) => openProvider\(row\.id\)\}/);
  // 钻入页按「连接 / 端点 / 模型」三段摆，每段都回得去列表。
  assert.match(code, /onClick=\{\(\) => openProvider\(null\)\}/);
  assert.match(code, /t\("models\.sectionConnection"\)/);
  assert.match(code, /t\("models\.sectionEndpoint"\)/);
  assert.match(code, /t\("models\.sectionEndpointOverride"\)/);
  assert.match(code, /t\("models\.sectionModelsTitle"\)/);
  // 两层对话框：供应商详情 → 模型详情。
  assert.match(code, /onClick=\{\(\) => openModel\(row\.id, entry\.index as number\)\}/);
});

test("providers are split into connected and not connected", () => {
  assert.match(code, /connected: connectedIds\.has\(id\)/);
  assert.match(code, /const connected = providerRows\.filter\(\(row\) => row\.connected\);/);
  assert.match(code, /const other = providerRows\.filter\(\(row\) => !row\.connected\);/);
  assert.match(code, /t\("models\.groupConnected"\)/);
  assert.match(code, /t\("models\.groupNotConnected"\)/);
  // 一个供应商在 OAuth / API key 两张清单里都出现时仍只有一行：行由 id 唯一决定。
  assert.match(code, /const providerIds: string\[\] = \[\];/);
  assert.match(code, /if \(id && !providerIds\.includes\(id\)\) providerIds\.push\(id\);/);
  assert.doesNotMatch(code, /<table className="d-table">\s*<thead>[\s\S]{0,400}colProvider/);
});

test("the page adds no pw-* class and no new fork-* hook", () => {
  const classes = [...code.matchAll(/className="([^"]*)"/g)]
    .flatMap((match) => match[1].split(/\s+/))
    .filter(Boolean);
  assert.deepEqual(classes.filter((name) => name.startsWith("pw-")), []);
  // 手机档的两个既有钩子（app/pwa-models-skills.css 读的就是它们）不是新增的。
  assert.deepEqual(
    [...new Set(classes.filter((name) => name.startsWith("fork-")))].sort(),
    ["fork-pwa-ms-models", "fork-pwa-ms-page", "fork-pwa-ms-sheet"],
  );
});

test("page-level actions live in the page header, with no footer", () => {
  const actionsBlock = code.slice(code.indexOf("actions={"), code.indexOf("toolbar={"));
  assert.match(actionsBlock, /t\("models\.addProvider"\)/);
  assert.match(actionsBlock, /variant="primary"[\s\S]*?onClick=\{handleSave\}/);
  assert.match(actionsBlock, /t\("models\.saveModelsJson"\)/);
  assert.doesNotMatch(code, /<ConfigFooter/);
});

test("a malformed models.json disables saving instead of overwriting it", () => {
  assert.match(code, /if \(!response\.ok \|\| d\.error\) throw new Error\(d\.error \?\? `HTTP \$\{response\.status\}`\);/);
  assert.match(code, /disabled=\{saving \|\| savedOk \|\| loadError !== null\}/);
  assert.match(code, /<Notice tone="err">\{t\("models\.listUnreadable"\)\}<\/Notice>/);
  assert.match(code, /if \(loadError\) return;/);
});

test("the model editor separates sections instead of drawing dividers", () => {
  const modelDetail = code.slice(code.indexOf("function ModelDetail"), code.indexOf("// ── OAuth"));
  assert.match(modelDetail, /className="d-set-inner"/);
  assert.doesNotMatch(modelDetail, /borderTop: "1px solid var\(--border\)"/);
  assert.doesNotMatch(modelDetail, /style=\{\{[^}]*borderBottom/);
});

// ── 能力保全 ──────────────────────────────────────────────────────────────────

test("dual-auth providers keep both credential paths on one provider page", () => {
  // AGENTS.md「Auth and model config」：清单是能力驱动的，anthropic / github-copilot
  // 同时支持 OAuth 与 API key，页面上仍只有一行、进去后两段都在。
  const providerPage = code.slice(code.indexOf("const renderProviderPage"), code.indexOf("const renderPage"));
  assert.match(providerPage, /\{row\.oauth && <OAuthDetail/);
  assert.match(providerPage, /\{showApiKey && row\.apiKey && \(\s*<ApiKeyDetail/);
  assert.match(providerPage, /const showApiKey = Boolean\(row\.apiKey\) && \(!row\.oauth \|\| row\.apiKey\?\.configured \|\| !row\.oauth\?\.loggedIn\);/);
  assert.match(source, /if \(Array\.isArray\(d\.oauthProviders\)\) setOauthProviders\(d\.oauthProviders\)/);
  assert.match(source, /if \(Array\.isArray\(d\.apiKeyProviders\)\) setApiKeyProviders\(d\.apiKeyProviders\)/);
});

test("enabledModels scope keeps its diagnostics and both write paths", () => {
  // 作用域、诊断（project 只读 / 失配条目 / 解析错误）与「聊天里显示哪些模型」弹层。
  assert.match(code, /\{view && !view\.editable && <Notice tone="warn">\{t\("models\.enabledProjectScope"\)\}<\/Notice>\}/);
  assert.match(code, /t\("models\.patternStaleBanner", \{ count: view\.stalePatterns\.length \}\)/);
  assert.match(code, /onClick=\{enabledModels\.pruneStale\}/);
  assert.match(code, /onClick=\{enabledModels\.clearScope\}/);
  assert.match(code, /\{view\.settingsPath\}/);
  assert.match(code, /view\.scope === "project" \? t\("models\.scopeProject"\) : t\("models\.scopeGlobal"\)/);
  assert.match(code, /<ChatModelsPicker/);
});

test("per-model chat membership and the picker write the same setting", () => {
  assert.match(code, /onChange=\{\(next\) => enabledModels\.setModels\(entry\.view!\.ref, \[entry\.view!\.ref\], next\)\}/);
  assert.match(code, /if \(enabledModels\.view\?\.allEnabled\) enabledModels\.replaceModels\(refs\);\s*\n\s*else enabledModels\.setModels\("chat-picker", refs, true\);/);
  // `--models` 语法是服务端解析的；界面只显示解析结果（钉档徽标）。
  assert.match(code, /t\("models\.thinkingPin", \{ level: entry\.view\.thinkingPin \}\)/);
});

test("the default model for new sessions still reads and writes settings.json", () => {
  assert.match(code, /\/api\/models\?cwd=/);
  assert.match(code, /setDefaultModel\(data\.defaultModel \?\? null\)/);
  assert.match(code, /body: JSON\.stringify\(value \? \{ provider: value\.provider, modelId: value\.modelId, cwd \} : \{ clear: true, cwd \}\)/);
  // 命名模型写的是 General 页同一份 localStorage 偏好。
  assert.match(code, /if \(value\) setTitleModel\(value\.provider, value\.modelId\);\s*\n\s*else clearTitleModel\(\);/);
});

test("usage stays visible, on both the list and the provider page", () => {
  assert.match(code, /fetch\(`\/api\/usage-stats\?\$\{params\}`\)/);
  assert.match(code, /<UsageOverviewSection providerIds=\{providerRows\.map\(\(row\) => row\.id\)\} \/>/);
  assert.match(code, /<ProviderUsageSummary/);
});

test("thinking levels keep their three explicit states and the live preview", () => {
  const editor = code.slice(code.indexOf("function ThinkingLevelMapEditor"), code.indexOf("// ── 兼容性开关"));
  assert.match(editor, /THINKING_LEVELS\.map/);
  assert.match(editor, /value: "omit", label: t\("models\.levelDefault"\)/);
  assert.match(editor, /value: "null", label: t\("models\.levelDisabled"\)/);
  assert.match(editor, /value: "string", label: t\("models\.levelCustom"\)/);
  assert.match(editor, /const state: ThinkingLevelState/);
  assert.match(editor, /onChange=\{\(event\) => setLevel\(level, event\.target\.value\)\}/);
  assert.match(code, /describeThinkingRequestFromFields\(fields, level, map\)/);
  assert.match(code, /t\("models\.lastUsedThinking"\)/);
});

test("compat switches are protocol-scoped and editable at both levels", () => {
  assert.match(code, /compatFlagsForApi\(api\)/);
  assert.match(code, /compatFlagState\(compat, spec\)/);
  // model 层读合并后的生效值，写回 model 条目；provider 层单独一段。
  assert.match(code, /compat=\{effectiveCompat\(provider, model\)\}\s*\n\s*api=\{model\.api \?\? provider\.api\}/);
  assert.match(code, /compat=\{json\.compat\}\s*\n\s*api=\{json\.api\}/);
});

test("headers stay editable at both provider and model level", () => {
  const endpoint = code.slice(code.indexOf("function EndpointForm"), code.indexOf("// ── 上游导入"));
  assert.match(endpoint, /<HeaderListEditor headers=\{provider\.headers\}/);
  assert.match(endpoint, /onChange=\{\(headers\) => set\("headers", headers\)\}/);
  assert.match(code, /<HeaderListEditor headers=\{model\.headers\}/);
});

test("model specs, prices and tiers stay outside the advanced disclosure", () => {
  const modelDetail = code.slice(code.indexOf("function ModelDetail"), code.indexOf("// ── OAuth"));
  const specsIndex = modelDetail.indexOf('t("models.modelSpecs")');
  const advancedIndex = modelDetail.indexOf('t("models.advancedSettings")');
  assert.ok(specsIndex >= 0);
  assert.ok(advancedIndex > specsIndex);
  assert.match(modelDetail, /<CostTiersEditor tiers=\{costTiers\} onChange=\{setCostTiers\} \/>/);
  assert.match(modelDetail, /const completeCost = parseCompleteModelCost\(nextDraft\)/);
  assert.match(modelDetail, /delete nextModel\.cost/);
  assert.match(modelDetail, /<ModelInputLimitsFields/);
  assert.match(modelDetail, /<SamplingParamsEditor/);
  // 高级段自己收在一枚 disclosure 里。
  assert.match(modelDetail, /aria-controls="model-advanced"/);
});

test("catalog fill, connection test and upstream import all still have a reachable action", () => {
  const modelDetail = code.slice(code.indexOf("function ModelDetail"), code.indexOf("// ── OAuth"));
  assert.match(modelDetail, /void handleCatalogFill\(\)/);
  assert.match(modelDetail, /t\("models\.catalogUndo"\)/);
  assert.match(modelDetail, /void handleTest\(\)/);
  assert.match(code, /setDiscoveryFor\(row\.id\)/);
  assert.match(code, /<ModelDiscovery/);
  // fork:discover-catalog-endpoint：入口不按 baseUrl 为空禁用。
  assert.doesNotMatch(code, /disabled=\{!json\?\.baseUrl\?\.trim\(\)/);
  assert.match(code, /t\("models\.baseUrlCatalogFallbackHint"\)/);
});

test("discovered model specs land in models.json instead of only the id", () => {
  const importBlock = code.slice(code.indexOf("const addDiscoveredModels"), code.indexOf("const updateModel"));
  assert.match(importBlock, /entry\.contextWindow = discoveredModel\.contextWindow/);
  assert.match(importBlock, /entry\.maxTokens = discoveredModel\.maxTokens/);
  assert.match(importBlock, /entry\.input = \[\.\.\.discoveredModel\.input\]/);
  assert.match(importBlock, /if \(discoveredModel\.input !== undefined\)/);
});

test("the provider id is never renamed in place", () => {
  // 照参考项目：id 同时是 models.json / auth.json / enabledModels 的键，改名会
  // 静默孤立凭证与聊天名单，所以这里只有新建时的输入框，没有 Rename。
  assert.doesNotMatch(code, /onRename/);
  assert.doesNotMatch(code, /renameProviderEntry/);
  assert.doesNotMatch(code, /t\("i18n\.rename"\)/);
  assert.match(code, /const PROVIDER_ID_PATTERN = \/\^\[a-z0-9\]/);
  assert.match(code, /existingIds\.has\(trimmedId\) \? t\("models\.providerIdTaken"\)/);
});

test("a provider row never renders its models.json entry twice", () => {
  // 托管供应商（OAuth / API key）的 models.json 条目是覆盖层，不能再当自定义端点
  // 列一遍；行数据只由 id 唯一决定。
  assert.match(code, /const providerIds: string\[\] = \[\];/);
  assert.doesNotMatch(code, /managedProviderIds/);
  assert.doesNotMatch(code, /models-sidebar/);
  assert.doesNotMatch(cssSource, /\.models-provider-model-row \{/);
  assert.doesNotMatch(cssSource, /\.models-provider-model-action \{/);
  assert.doesNotMatch(cssSource, /\.models-thinking-memory \{/);
});
