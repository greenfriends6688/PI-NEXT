import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  hasModelCostDraftValue,
  KNOWN_MODEL_APIS,
  modelCostToDraft,
  parseCompleteModelCost,
  serializeHeaderRows,
  setCompatBool,
  updateHeaderRow,
} = await jiti.import("./models-config-helpers.ts");

const source = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");

// fork:model-api-protocols (B4) —— 协议下拉必须覆盖 pi-ai 的 `KnownApi` 全集。
// 清单从 SDK 的类型定义里解析：pi-ai 以后新增协议而这里忘了加，这条测试就红。
// fork:compat-flags (B5) —— 开关表按协议切换，且在 model 与 provider 两层都能编辑。
test("compat switches are protocol-scoped and editable at both levels", () => {
  const editor = source.slice(
    source.indexOf("const COMPAT_FLAG_STATE_OPTIONS"),
    source.indexOf("/* fork:models-presets"),
  );
  assert.match(editor, /compatFlagsForApi\(api\)/);
  // 三态而不是两态：Default = 不写键（跟随 pi 默认或按 baseUrl 自动探测）。
  assert.match(editor, /value: "default", label: "Default"/);
  assert.match(editor, /value: "on", label: "On"/);
  assert.match(editor, /value: "off", label: "Off"/);
  assert.match(editor, /compatFlagState\(compat, spec\)/);

  // model 层：读 provider+model 合并后的生效值，写回 model 条目。
  assert.match(source, /<CompatFlagsEditor[\s\S]{0,220}compat=\{effectiveCompat\(provider, model\)\}[\s\S]{0,120}api=\{model\.api \?\? provider\.api\}/);
  // provider 层：以前同样只能手改 models.json。
  assert.match(source, /<CompatFlagsEditor[\s\S]{0,220}compat=\{provider\.compat\}[\s\S]{0,120}api=\{provider\.api\}/);
});

test("the api protocol list is exactly pi-ai's KnownApi union", async () => {
  const types = await readFile(
    new URL("../node_modules/@earendil-works/pi-ai/dist/types.d.ts", import.meta.url),
    "utf8",
  );
  const union = types.match(/export type KnownApi =([^;]+);/);
  assert.ok(union, "pi-ai types.d.ts no longer declares KnownApi");
  const known = [...union[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);

  assert.ok(known.length > 4, `KnownApi union parsed only ${known.length} entries`);
  // 面板用的就是这一个清单（provider 下拉与 model 级覆写下拉共用）。
  assert.deepEqual([...KNOWN_MODEL_APIS].sort(), [...known].sort());
  assert.match(source, /const API_OPTIONS = KNOWN_MODEL_APIS;/);
  // 少一个都不行：协议选不了 = 那个 provider 根本配不出来。
  for (const api of known) assert.ok(KNOWN_MODEL_APIS.includes(api), `api option missing: ${api}`);
});

test("uses shared sidebar sizing for providers and matching indented model rows", () => {
  const sidebar = source.slice(source.indexOf("<ConfigSidebar>"), source.indexOf("</ConfigSidebar>"));

  assert.match(sidebar, /<ConfigSidebarItem[\s\S]*?active=\{isSelected\}/);
  assert.match(sidebar, /<ConfigSidebarItem[\s\S]*?active=\{isProviderSelected\}/);
  assert.match(sidebar, /className="models-sidebar-indented-item"/);
  assert.match(sidebar, /className="models-sidebar-indented-item models-sidebar-add-item"/);
  assert.match(cssSource, /\.models-sidebar-indented-item \{[\s\S]*?padding-left: 26px/);
});

test("ignores malformed auth provider responses", () => {
  assert.match(
    source,
    /if \(Array\.isArray\(d\.oauthProviders\)\) setOauthProviders\(d\.oauthProviders\)/,
  );
  assert.match(
    source,
    /if \(Array\.isArray\(d\.apiKeyProviders\)\) setApiKeyProviders\(d\.apiKeyProviders\)/,
  );
});

test("custom model config exposes provider-level request headers", () => {
  const providerDetail = source.slice(
    source.indexOf("function ProviderDetail"),
    source.indexOf("// ── ThinkingLevelMap editor"),
  );
  assert.match(providerDetail, /<HeaderListEditor/);
  assert.match(providerDetail, /headers=\{provider\.headers\}/);
  assert.match(providerDetail, /set\("headers", headers\)/);
});

test("custom model config exposes model headers and supportsDeveloperRole compat flag", () => {
  // Model-level headers editor, wired to the model entry.
  assert.match(source, /headers=\{model\.headers\}/);
  assert.match(source, /set\("headers", headers\)/);

  // Model-level compat toggle reads the effective (provider+model) value so
  // hand-edited models.json settings are reflected, while writes stay on the
  // model entry as an explicit per-model override.
  assert.match(source, /effectiveCompat\(provider, model\)\["supportsDeveloperRole"\] !== false/);
  assert.match(source, /setCompatBool\(model, "supportsDeveloperRole", v\)/);
});

test("disabling the developer role writes an explicit false override", () => {
  assert.deepEqual(
    setCompatBool({ compat: { supportsStore: true } }, "supportsDeveloperRole", false),
    { compat: { supportsStore: true, supportsDeveloperRole: false } },
  );
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
  assert.deepEqual(serializeHeaderRows(updated), {
    "X-First-Edited": "one",
    "X-Second": "two",
  });
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

test("model cost drafts default blank prices to zero unless all are blank", () => {
  const complete = {
    input: "1.25",
    output: "10",
    cacheRead: "0.125",
    cacheWrite: "0",
  };
  assert.deepEqual(parseCompleteModelCost(complete), {
    input: 1.25,
    output: 10,
    cacheRead: 0.125,
    cacheWrite: 0,
  });
  assert.deepEqual(parseCompleteModelCost({ ...complete, input: "", cacheWrite: "" }), {
    input: 0,
    output: 10,
    cacheRead: 0.125,
    cacheWrite: 0,
  });
  assert.deepEqual(parseCompleteModelCost({ input: "1.25", output: "", cacheRead: "", cacheWrite: "" }), {
    input: 1.25,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
  assert.equal(parseCompleteModelCost(modelCostToDraft()), undefined);
  assert.equal(parseCompleteModelCost({ ...complete, output: "not-a-price" }), undefined);
  assert.equal(parseCompleteModelCost({ ...complete, output: "-1" }), undefined);
  assert.equal(hasModelCostDraftValue(modelCostToDraft()), false);
  assert.equal(hasModelCostDraftValue({ ...complete, cacheWrite: "" }), true);
});

test("manual price editing commits completed costs and removes only an all-blank group", () => {
  const modelDetail = source.slice(
    source.indexOf("function ModelDetail"),
    source.indexOf("// ── OAuth detail"),
  );

  assert.match(modelDetail, /const completeCost = parseCompleteModelCost\(nextDraft\)/);
  assert.match(modelDetail, /if \(completeCost\)/);
  assert.match(modelDetail, /delete nextModel\.cost/);
  assert.match(modelDetail, /const nextDraft = \{ \.\.\.costDraftRef\.current, \[key\]: value \}/);
  assert.match(modelDetail, /costDraftRef\.current = nextDraft/);
  assert.match(modelDetail, /costTemplateRef\.current/);
  assert.match(modelDetail, /value=\{costDraft\[key\]\}/);
});

// fork:model-rename-save（上游 bd85004 #969，fixes #903）—— 保存时把输入框里的
// 重命名一起落盘，并拒绝被占用的 id（models.json 以 id 为键，撞了就是静默覆盖）。
test("discovered model specs land in models.json instead of only the id", () => {
  const importBlock = source.slice(
    source.indexOf("const addDiscoveredModels"),
    source.indexOf("const updateModel"),
  );
  assert.match(importBlock, /entry\.contextWindow = discoveredModel\.contextWindow/);
  assert.match(importBlock, /entry\.maxTokens = discoveredModel\.maxTokens/);
  assert.match(importBlock, /entry\.input = \[\.\.\.discoveredModel\.input\]/);
  // 上游没报的字段不写进 models.json（0 会被 pi 当成声明值）。
  assert.match(importBlock, /if \(discoveredModel\.contextWindow !== undefined\)/);
  assert.match(importBlock, /if \(discoveredModel\.input !== undefined\)/);
});

test("Save applies a provider name typed without pressing Rename", () => {
  const providerDetail = source.slice(
    source.indexOf("function ProviderDetail"),
    source.indexOf("// ── ThinkingLevelMap editor"),
  );
  // 输入框改的是面板的草稿，不是 Save 看不见的组件本地 state。
  assert.doesNotMatch(providerDetail, /useState\(name\)/);
  assert.match(providerDetail, /onChange=\{onEditingNameChange\}/);

  const save = source.slice(
    source.indexOf("const handleSave = useCallback"),
    source.indexOf("const providers = Object.entries(config.providers"),
  );
  assert.match(save, /applyProviderRename\(config, providerNameDraft\.provider, pendingName\)/);
  assert.match(save, /body: JSON\.stringify\(draft\)/);
  assert.match(save, /collectModelRenames\(draft,/);
  assert.match(save, /setSaveError\(t\("models\.providerNameTaken", \{ name: pendingName \}\)\)/);
});

// fork:models-board —— 模型详情按画板 41 拆成三张独立的 `.pw-detail`
// （能力 / 规格 / 成本 → 高级 → 测试连接），所以标题串换成了画板的措辞。
test("model specs keep catalog-filled prices visible outside advanced settings", () => {
  const modelDetail = source.slice(
    source.indexOf("function ModelDetail"),
    source.indexOf("// ── OAuth detail"),
  );
  const specsIndex = modelDetail.indexOf('t("models.specs")');
  const costIndex = modelDetail.indexOf('t("models.costPerMillion")');
  const advancedIndex = modelDetail.indexOf('t("models.advancedTitle")');

  assert.ok(specsIndex >= 0);
  assert.ok(costIndex > specsIndex);
  assert.ok(advancedIndex > costIndex);
  assert.match(modelDetail, /setCostEditing\(false\)/);
  assert.match(modelDetail, /formatCost\(key\)/);
});

// fork:cost-tiers (B3) —— 阶梯定价编辑器接在基础价之后（同一个 cost 对象），
// 且只用画板已有的类：`.pw-field` 行 + `.pw-numin` 窄数值框。
test("tiered pricing has an editor wired into the model cost object", () => {
  const editor = source.slice(
    source.indexOf("function CostTiersEditor"),
    source.indexOf("function fillEmptyModelFields"),
  );
  assert.match(editor, /parseModelCostTiers\(next\)/);
  // 控件全是画板已固化的基件：`.pw-field` 行 + `.pw-numin` 窄数值框（画板 40）。
  assert.match(editor, /className="pw-field"/);
  assert.match(editor, /className="pw-input pw-numin pw-mono"/);

  const modelDetail = source.slice(
    source.indexOf("function ModelDetail"),
    source.indexOf("// ── OAuth detail"),
  );
  assert.match(modelDetail, /<CostTiersEditor[\s\S]*?tiers=\{costTiers\}[\s\S]*?onChange=\{setCostTiers\}/);
  // 清空阶梯就删掉 `tiers` 键，不留 `tiers: []`。
  assert.match(modelDetail, /const costTiers = Array\.isArray\(model\.cost\?\.tiers\) \? model\.cost\.tiers : \[\]/);
  assert.match(modelDetail, /if \(tiers\?\.length\) nextCost\.tiers = tiers;/);
  assert.match(modelDetail, /else delete nextCost\.tiers;/);
});

test("the three model-detail cards separate sections instead of drawing dividers", () => {
  const modelDetail = source.slice(
    source.indexOf("function ModelDetail"),
    source.indexOf("// ── OAuth detail"),
  );

  // 画板 41：高级与测试连接各自成卡，段与段之间由 `.pw-detail` 的描边分隔，
  // 组件里不再手写 `borderTop`（原先那一条就是「弹窗影子」的一部分）。
  assert.equal((modelDetail.match(/<ConfigDetail>/g) ?? []).length, 3);
  assert.doesNotMatch(modelDetail, /borderTop: "1px solid var\(--border\)"/);
  assert.doesNotMatch(modelDetail, /borderBottom: "1px solid var\(--border\)"/);
});

test("the models page is a page frame plus a two-column split, not one giant card", () => {
  const modelsConfig = source.slice(source.indexOf("export function ModelsConfig"));
  assert.match(modelsConfig, /<SettingsPage[\s\S]*?sub=\{t\("models\.pageSub"\)\}/);
  assert.match(modelsConfig, /<ConfigSplitView>/);
  // 骨架 B（画板 62）：内容区拿 is-fixed，不滚，两列各自滚。
  assert.match(modelsConfig, /\bfill\s*>/);
  // 右列是 `ConfigDetailStack`（一列独立的卡），不再包一层撑满高度的 `ConfigDetail`。
  assert.doesNotMatch(modelsConfig, /<ConfigDetail>\s*<ConfigDetailStack/);
  assert.match(cssSource, /\.config-panel-surface > \.pw-scontent \{\s*flex: 1;/);
});

// fork:settings-frame（画板 62 帧 D）—— 模型页用到的两个空态各有落点：
// 「列表空」在列表列内（方框图标 + 一句，不折行），「详情未选」在详情列居中
// （square-mouse-pointer 方框 + 一句引导），不再是一句孤悬的裸文本。
test("empty states land in their own columns per board 62 frame D", () => {
  const modelsConfig = source.slice(source.indexOf("export function ModelsConfig"));

  const listColumn = modelsConfig.slice(
    modelsConfig.indexOf("<ConfigSidebar>"),
    modelsConfig.indexOf("</ConfigSidebar>"),
  );
  // 列表列先分「加载中 / 空 / 有行」三态；空态是 ConfigEmptyState（pw-empty）。
  assert.match(listColumn, /loading \? \(/);
  assert.match(listColumn, /!hasVisibleRows \? \(/);
  assert.match(listColumn, /className="mark"><i data-ico="server" data-size="16" aria-hidden="true" \/>/);
  // 有过滤词沿用选择器的「没有匹配的 Provider」；空库用 models.listEmpty + 第二句
  // listEmptyHint（帧 D 的「一句 + 一句说明」，键已补进三语包）。
  assert.match(listColumn, /needle \? t\("i18n\.noProviders"\) : t\("models\.listEmpty"\)/);
  assert.match(listColumn, /!needle && <p className="pw-hint">\{t\("models\.listEmptyHint"\)\}<\/p>/);

  const detailColumn = modelsConfig.slice(
    modelsConfig.indexOf("<ConfigDetailStack>"),
    modelsConfig.indexOf("</ConfigDetailStack>"),
  );
  assert.match(detailColumn, /className="mark"><i data-ico="square-mouse-pointer" data-size="16" aria-hidden="true" \/>/);
  assert.match(detailColumn, /<p>\{t\("models\.detailEmpty"\)\}<\/p>/);
});

// fork:settings-frame（画板 62 帧 D「动作层级」）—— 页级动作只有页头右端两个
// （添加供应商 outline + 保存 primary）。保存的位置按**画板 41 的 DOM** 裁定
// （那一帧的 .pw-shead-acts 就是这两个动作；62 落位表「表单级→连接块底部」被
// 41 的明确形态覆盖，理由见 ModelsConfig.tsx 的注释），页脚与视口右下角不再有动作。
test("page-level actions stay in the page header per board 41, and the footer has none", () => {
  const modelsConfig = source.slice(source.indexOf("export function ModelsConfig"));
  const actionsBlock = modelsConfig.slice(
    modelsConfig.indexOf("actions={"),
    modelsConfig.indexOf("toolbar="),
  );
  assert.match(actionsBlock, /variant="secondary"[\s\S]*?t\("models\.addProvider"\)/);
  assert.match(actionsBlock, /variant="primary"[\s\S]*?onClick=\{handleSave\}/);
  assert.doesNotMatch(modelsConfig, /<ConfigFooter/);
});

test("thinking level overrides keep explicit default, disabled, and custom controls", () => {
  // 三态选项的常量定义在编辑器函数之前，切片从常量开始才能盖住全部形态。
  const editor = source.slice(
    source.indexOf("const LEVEL_STATE_OPTIONS"),
    source.indexOf("// ── Model detail"),
  );

  assert.match(editor, /THINKING_LEVELS\.map/);
  // 三态分段从自绘 inline 换成了画板的 `.pw-radio`（SettingsUi 的 PwRadio 基件），
  // 但三个状态仍然是显式的：omit（Default）/ null（Disabled）/ string（Custom+值）。
  assert.match(editor, /<PwRadio/);
  assert.match(editor, /value: "omit", label: "Default"/);
  assert.match(editor, /value: "null", label: "Disabled"/);
  assert.match(editor, /value: "string", label: "Custom"/);
  assert.match(editor, /const state: ThinkingLevelState/);
  assert.match(editor, /value=\{state\}/);
  assert.match(editor, /next === "omit" \? "omit" : next === "null" \? null : strVal \|\| level/);
  assert.match(editor, /state === "string" && \(/);
  assert.match(editor, /onChange=\{\(e\) => setLevel\(level, e\.target\.value\)\}/);
});

// fork:discover-catalog-endpoint（上游 d8f89c5 #1006）—— 发现端点可从 pi 的 provider
// catalog 反查，后端早就做了；入口别再按 baseUrl 为空把按钮禁掉。
test("import models is not gated on a configured base URL", () => {
  const providerDetail = source.slice(
    source.indexOf("function ProviderDetail"),
    source.indexOf("// ── ThinkingLevelMap editor"),
  );
  assert.doesNotMatch(providerDetail, /disabled=\{!provider\.baseUrl\?\.trim\(\)/);
  assert.match(providerDetail, /disabled=\{discoveryState\.phase === "loading"\}/);
  assert.match(providerDetail, /if \(discoveryState\.phase === "loading"\) return;/);
  assert.match(source, /hint=\{t\("models\.baseUrlCatalogFallbackHint"\)\}/);
});
