import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

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
  // fork:api-labels —— 清单经 `modelApiChoices()` 变成下拉选项（显示人话，落盘仍是 id）。
  assert.match(source, /const API_OPTIONS = modelApiChoices\(\);/);
  // 少一个都不行：协议选不了 = 那个 provider 根本配不出来。
  for (const api of known) assert.ok(KNOWN_MODEL_APIS.includes(api), `api option missing: ${api}`);
});

// fork:v5-landing · D-08 —— 主页面不再是主从两栏：供应商是一张 `.d-table` 表
// （供应商 / 认证 / 接口地址 / 模型 / 上次同步），行可点、进详情。旧的
// `.models-sidebar-*` 族随侧栏列表退役，CSS 里不允许再留。
test("providers are a table with auth badges, not a sidebar list", () => {
  const table = source.slice(
    source.indexOf("function ProviderTableSection"),
    source.indexOf("function UsageOverviewSection"),
  );
  assert.match(table, /<ProviderIcon id=\{row\.id\} size=\{16\} \/>/);
  assert.match(table, /<DBadge tone=\{row\.auth\.tone\}>\{row\.auth\.label\}<\/DBadge>/);
  assert.match(table, /t\("models\.colLastSync"\)/);
  assert.match(table, /onClick=\{\(\) => onOpen\(row\)\}/);
  // 侧栏行基件与它的缩进 / 徽章 CSS 一并退役（铁律五：挪 DOM 顺手删 stale）。
  // AddProviderPicker 仍用 ConfigSidebarItem 出选择器行，所以这里只锁主组件。
  const mainComponent = source.slice(source.indexOf("export function ModelsConfig"));
  assert.doesNotMatch(mainComponent, /<ConfigSidebarItem/);
  assert.doesNotMatch(cssSource, /\.models-sidebar-indented-item \{/);
  assert.doesNotMatch(cssSource, /\.models-sidebar-badge \{/);
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

// fork:v5-landing · D-08 帧 B + D-09 —— 编辑页按帧 B 拆节（模型规格 / 推理·思考 /
// 兼容性 / 测试连接），价格与规格同屏；Header / 采样 / API 覆盖 / 上限收进
// 「模型高级」二级弹窗，编辑页头行给入口。
test("model specs keep catalog-filled prices visible outside advanced settings", () => {
  const modelDetail = source.slice(
    source.indexOf("function ModelDetail"),
    source.indexOf("function ModelAdvancedModal"),
  );
  const specsIndex = modelDetail.indexOf('t("models.modelSpecs")');
  const costIndex = modelDetail.indexOf('t("models.costPerMillion")');

  assert.ok(specsIndex >= 0);
  assert.ok(costIndex > specsIndex);
  assert.match(modelDetail, /setCostEditing\(false\)/);
  assert.match(modelDetail, /formatCost\(key\)/);
  // 编辑页本身不再内联 Header / 采样编辑器 —— 它们搬到 D-09 弹窗里了。
  assert.doesNotMatch(modelDetail, /<HeaderListEditor/);
  assert.doesNotMatch(modelDetail, /<SamplingParamsEditor/);

  const advanced = source.slice(
    source.indexOf("function ModelAdvancedModal"),
    source.indexOf("// ── OAuth detail"),
  );
  assert.match(advanced, /<HeaderListEditor headers=\{model\.headers\}/);
  assert.match(advanced, /<SamplingParamsEditor value=\{model\.samplingParams\}/);
  assert.match(advanced, /<ModelInputLimitsFields/);
  // 编辑页头行的入口（D-09 的开法）。
  assert.match(modelDetail, /setAdvancedOpen\(true\)/);
});

// fork:cost-tiers (B3) —— 阶梯定价编辑器接在基础价之后（同一个 cost 对象），
// 且只用画板已有的类：`.d-set-row` 行 + `.d-input.d-mono` 窄数值框（v5 D-08/09）。
test("tiered pricing has an editor wired into the model cost object", () => {
  const editor = source.slice(
    source.indexOf("function CostTiersEditor"),
    source.indexOf("function fillEmptyModelFields"),
  );
  assert.match(editor, /parseModelCostTiers\(next\)/);
  // 控件全是画板已固化的基件：`.d-set-row` 行 + `.d-input.d-mono` 窄数值框。
  assert.match(editor, /className="d-set-row"/);
  assert.match(editor, /className="d-input d-mono"/);

  const modelDetail = source.slice(
    source.indexOf("function ModelDetail"),
    source.indexOf("// ── OAuth detail"),
  );
  assert.match(modelDetail, /<CostTiersEditor[\s\S]*?tiers=\{costTiers\}[\s\S]*?onChange=\{setCostTiers\}/);
  // 清空阶梯就删掉 `tiers` 键，不留 `tiers: []`。
  assert.match(modelDetail, /const costTiers = useMemo\(/);
  assert.match(modelDetail, /\[\s*model\.cost\?\.tiers\s*\],?\s*\);/);
  assert.match(modelDetail, /if \(tiers\?\.length\) nextCost\.tiers = tiers;/);
  assert.match(modelDetail, /else delete nextCost\.tiers;/);
});

// fork:v5-landing · D-08 帧 B —— 编辑页四个 `.d-set-sec`（模型规格 / 推理·思考 /
// 兼容性 / 测试连接），段与段之间由分节间距分隔，组件里不手写 `borderTop`。
test("the model editor separates sections instead of drawing dividers", () => {
  const modelDetail = source.slice(
    source.indexOf("function ModelDetail"),
    source.indexOf("function ModelAdvancedModal"),
  );

  assert.equal((modelDetail.match(/<div className="d-set-sec">/g) ?? []).length, 4);
  assert.doesNotMatch(modelDetail, /borderTop: "1px solid var\(--border\)"/);
  assert.doesNotMatch(modelDetail, /borderBottom: "1px solid var\(--border\)"/);
});

// fork:v5-landing · D-08 / D-10 —— 主页面是一列 `.d-set-sec` 分节 + 钻入详情，
// 不再是两栏 split；「返回」在详情列首行，独立弹窗宿主由内容列自己滚。
test("the models page is one overview column with drill-in details", () => {
  const modelsConfig = source.slice(source.indexOf("export function ModelsConfig"));
  assert.match(modelsConfig, /<SettingsPage[\s\S]*?sub=\{t\("models\.pageSub"\)\}/);
  assert.doesNotMatch(modelsConfig, /<ConfigSplitView>/);
  assert.doesNotMatch(modelsConfig, /\bfill\s*>/);
  // 列表级的分节全家福（帧 A / 帧 C / 帧 D + D-10）。
  assert.match(modelsConfig, /<ProviderTableSection rows=\{providerRows\} lastSyncMap=\{lastSyncMap\} badgeLabel=/);
  assert.match(modelsConfig, /<UsageOverviewSection providerIds=\{providerRows\.map/);
  assert.match(modelsConfig, /<FavoritesSection favorites=\{favoriteModels\}/);
  assert.match(modelsConfig, /<ModelRolesSection cwd=\{cwd\} \/>/);
  assert.match(modelsConfig, /<SelectorVisibilitySection enabledModels=\{enabledModels\} \/>/);
  // fork:models-picker —— 「聊天里显示哪些模型」改由跨供应商选择器表达，成本档表、
  // pattern 白名单表与匹配预览三节退役（成本在模型编辑页里改，pattern 是存法）。
  assert.match(modelsConfig, /<ChatModelsPicker/);
  assert.doesNotMatch(modelsConfig, /<CostTableSection/);
  assert.doesNotMatch(modelsConfig, /<PatternSection/);
  assert.doesNotMatch(modelsConfig, /<MatchPreviewSection/);
  // 供应商行的「N/M 在聊天里」（helper 一直存在，这里才第一次被接上）。
  assert.match(modelsConfig, /providerBadgeLabel\(enabledModels\.view, id\)/);
  // 钻入态：详情替换整列，返回钮在列首。
  assert.match(modelsConfig, /const atListLevel = selection === null;/);
  assert.match(modelsConfig, /detailContent \?\? \(/);
  assert.match(source, /function BackRowButton/);
  // 独立弹窗宿主（config-panel-surface overflow:hidden）里由内容列承担滚动。
  assert.match(cssSource, /\.config-panel-surface > \.d-col \{[^}]*overflow-y: auto;/);
});

// fork:v5-landing · D-08 —— 「列表空」落在概览列里（方框图标 + 一句，不折行）：
// 有过滤词沿用选择器的「没有匹配的 Provider」，空库用 models.listEmpty + listEmptyHint。
// 旧「详情未选」空态随主从两栏一起退役 —— 落地态就是列表本身。
test("the empty list state lands in the overview column", () => {
  const modelsConfig = source.slice(source.indexOf("export function ModelsConfig"));

  assert.match(modelsConfig, /providerRows\.length === 0 && \(/);
  assert.match(modelsConfig, /<span className="d-empty-ico"><i data-ico="server" data-size="16" aria-hidden="true" \/>/);
  assert.match(modelsConfig, /needle \? t\("i18n\.noProviders"\) : t\("models\.listEmpty"\)/);
  assert.match(modelsConfig, /!needle && <p className="d-empty-s">\{t\("models\.listEmptyHint"\)\}<\/p>/);
  // 加载失败不再是裸文本：横幅说明「读不出 ≠ 空」，保存同时已被禁用。
  assert.match(modelsConfig, /<div className="d-banner err">\{t\("models\.listUnreadable"\)\}<\/div>/);
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
  assert.match(editor, /<DSeg/);
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

// fork:model-row-inline（用户 2026-10-05 裁定，对齐 ZCode 的模型行）——
// 行内要同时有 🔌 测试 / ✏️ 编辑 / 启停开关，外加上下文窗口与视觉两枚徽标；
// 且**行本身不再是 button**（里面真装了两个 button 和一个 role="switch"）。
test("model row carries inline test / edit / enable controls, not a button row", () => {
  const rowStart = source.indexOf("models-provider-model-row");
  // 剥掉注释再查负面项：ModelsConfig.tsx 的说明里**故意**引用了旧写法
  // （`role="button"` / `.focus-visible`）作为对照，直接全文匹配会判成「还在」。
  const stripComments = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const row = stripComments(
    source.slice(rowStart, source.indexOf("models.enabledProjectScope", rowStart)),
  );

  // 三个控件都在。
  assert.match(row, /testRowModel\(index, model\)/, "inline test goes through the shared request");
  assert.match(source, /postModelTest\(\{ providerName: name, provider, model \}\)/);
  assert.match(source, /setTestState\(await postModelTest\(/, "editor reuses the same call");
  assert.match(row, /onClick=\{\(\) => onOpenModel\(index\)\}/, "edit opens the model editor");
  assert.match(row, /enabledModels\.setModels\(/, "row-level enable toggle");

  // 行不再是 button：role="button" 会抢语义，且点击会冒泡成「误开编辑器」。
  assert.doesNotMatch(row, /role="button"/);
  assert.doesNotMatch(row, /tabIndex=\{0\}/);
  // 之前那条规则就是为整行可点存在的，现在必须退役，否则行还顶着 pointer 光标。
  assert.doesNotMatch(cssSource, /\.models-provider-model-row:focus-visible/);
  assert.match(cssSource, /\.models-provider-model-action/);
});

test("model row badges read contextWindow and input modalities", () => {
  // 徽标的数据源本来就写在 models.json 里，只是列表一直没读。
  assert.match(source, /formatContextWindowBadge\(model\.contextWindow\)/);
  assert.match(source, /model\.input \?\? \[\]\)\.some\(\(modality\) => modality === "image" \|\| modality === "pdf"\)/);
  // 与 ZCode 一致：1M / 262.1K。
  assert.match(source, /contextWindow >= 1_000_000/);
  assert.match(source, /contextWindow >= 1000/);
});

// fork:api-labels —— 协议下拉显示人话 + 端点路径，落盘值仍是内部 id。
// 这条是 DoD：pi-ai 以后新增一个 `Api` 而这里忘了配标签，测试就红
// （与既有那条「下拉必须覆盖 KnownApi 全集」同一道门）。
test("every protocol dropdown entry has a human label", () => {
  const choices = modelApiChoices();

  // 一个不多一个不少：清单与 KNOWN_MODEL_APIS 一一对应。
  assert.equal(choices.length, KNOWN_MODEL_APIS.length);
  assert.deepEqual(
    choices.map((c) => c.value),
    [...KNOWN_MODEL_APIS],
  );
  // value 仍是内部 id（models.json 靠它），label 不再是。
  for (const choice of choices) {
    assert.ok(MODEL_API_LABELS[choice.value], `${choice.value} 缺少 MODEL_API_LABELS`);
    assert.notEqual(choice.label, choice.value, `${choice.value} 显示的还是内部 id`);
  }
  // 对齐 ZCode 那一列：Chat Completions 带端点路径。
  assert.equal(
    choices.find((c) => c.value === "openai-completions").label,
    "Chat Completions (/chat/completions)",
  );
});

// fork:provider-inline-fields —— 供应商头卡同屏可改 Base URL / API 格式 / API Key，
// 不再只印一张只读的 `.pw-kv` 表。是**移动**不是复制：每个字段在文件里只能出现一次。
test("provider header card edits base url / api / key in place", () => {
  const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const code = strip(source);

  // 三个字段各只出现一次（移动 = 文件里一次 + 头卡里一次）。
  for (const marker of [
    /set\("baseUrl", v \|\| undefined\)/,
    /set\("api", v\)/,
    /set\("apiKey", v \|\| undefined\)/,
  ]) {
    assert.equal(code.match(marker).length, 1, `${marker} 出现了不止一次`);
  }

  // 锚在 ProviderDetail 自己的函数体里，不再按 i18n 键的出场顺序切片
  // （概览节的「用量摘要」键现在出现在 ProviderDetail 之前）。
  const providerDetail = code.slice(
    code.indexOf("function ProviderDetail"),
    code.indexOf("// ── ThinkingLevelMap editor"),
  );
  assert.match(providerDetail, /set\("baseUrl", v \|\| undefined\)/, "头卡没有 Base URL 输入框");
  assert.match(providerDetail, /set\("api", v\)/, "头卡没有 API 格式下拉");
  assert.match(providerDetail, /set\("apiKey", v \|\| undefined\)/, "头卡没有 API Key 输入框");
  assert.doesNotMatch(providerDetail, /<dt>\$\{t\("models\.kvBaseUrl"\)\}<\/dt>/, "只读的地址行还在");
});
