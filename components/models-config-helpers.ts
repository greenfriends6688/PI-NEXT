// fork:upstream-port — upstream-port marker
export interface CompatEntry {
  compat?: Record<string, unknown>;
}

export interface HeaderRow {
  id: number;
  name: string;
  value: string;
}

export const MODEL_COST_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

/**
 * fork:model-api-protocols (B4) —— models.json 里 `api` 字段的合法取值。
 *
 * 清单不靠印象，来自 pi-ai 的类型定义
 * `node_modules/@earendil-works/pi-ai/dist/types.d.ts:15`：
 *
 *   export type KnownApi = "openai-completions" | "mistral-conversations"
 *     | "openai-responses" | "azure-openai-responses" | "openai-codex-responses"
 *     | "anthropic-messages" | "bedrock-converse-stream" | "google-generative-ai"
 *     | "google-vertex" | "pi-messages";
 *   export type Api = KnownApi | (string & {});
 *
 * 注意真正的名字是 `bedrock-converse-stream`（不是 bedrock-converse）。
 *
 * 三条自证：
 * ① pi 的 models.json schema 把 `api` 声明为自由字符串
 *    （pi-coding-agent `core/model-config.js`：`api: Type.Optional(Type.String({minLength:1}))`），
 *    实测把 `bedrock-converse-stream` / `mistral-conversations` 写进去，
 *    `ModelRuntime.getModel().api` 原样保留、`getError()` 为空。
 * ② 十个取值在 pi-ai 的 api-registry 里都有实现（`compat.js` 的 `BUILTIN_APIS`
 *    + 模块加载时的 `registerBuiltInApiProviders()`），逐个 `getApiProvider(api)`
 *    实测全部已注册，所以自定义 provider 条目（没有 builtin base provider 时走
 *    `getApiProvider(model.api)` 分派）真的能发请求。
 * ③ `components/ModelsConfig.test.mjs` 从 `types.d.ts` 里解析 `KnownApi`
 *    联合类型并断言本清单与它相等 —— pi-ai 以后新增协议而这里忘了加，测试就红。
 *
 * `Api` 是开集（扩展可 `registerApiProvider` 注册自定义 api），下拉选不了的
 * 仍可在 models.json 手写。
 */
export const KNOWN_MODEL_APIS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
  "google-vertex",
  "mistral-conversations",
  "bedrock-converse-stream",
  "azure-openai-responses",
  "openai-codex-responses",
  "pi-messages",
] as const;

export type ModelCostKey = (typeof MODEL_COST_KEYS)[number];

export type ModelCostRates = Record<ModelCostKey, number>;

export type ModelCostDraft = Record<ModelCostKey, string>;

/**
 * fork:cost-tiers (B3) — pi-ai `ModelCostTier`（`dist/types.d.ts` 的
 * `ModelCostTier extends ModelCostRates { inputTokensAbove }`）：请求总输入
 * tokens 超过某个阈值后，整笔请求改用该档价格，取**最高匹配的阈值**（自证：
 * `dist/models.js` 的 `calculateCost()`）。长上下文档位的模型不配阶梯，显示的
 * 基础价和实际扣费就对不上。
 */
export interface ModelCostTier {
  inputTokensAbove: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelCostTierDraft extends ModelCostDraft {
  inputTokensAbove: string;
}

export function modelCostTierToDraft(tier: ModelCostTier): ModelCostTierDraft {
  return { inputTokensAbove: String(tier.inputTokensAbove), ...modelCostToDraft(tier) };
}

/** 阈值必须是正整数（pi 的 schema 是 `Type.Number()`，但 0/负数没有意义），价格四项全填才落盘。 */
export function parseModelCostTier(
  draft: ModelCostTierDraft,
): ModelCostTier | undefined {
  const threshold = Number(draft.inputTokensAbove.trim());
  if (!Number.isInteger(threshold) || threshold <= 0) return undefined;
  const rates = parseCompleteModelCost(draft);
  return rates ? { inputTokensAbove: threshold, ...rates } : undefined;
}

export function hasModelCostTierDraftValue(draft: ModelCostTierDraft): boolean {
  return draft.inputTokensAbove.trim() !== "" || hasModelCostDraftValue(draft);
}

/**
 * 草稿 → 落盘的阶梯数组。阈值必须递增，否则 pi 的「最高匹配阈值」比较会被
 * 后面的乱序档遮蔽 —— 直接按升序排，并丢掉解析不出阈值 / 价格的档。
 */
export function parseModelCostTiers(
  drafts: readonly ModelCostTierDraft[],
): ModelCostTier[] | undefined {
  const tiers = drafts
    .map((draft) => parseModelCostTier(draft))
    .filter((tier): tier is ModelCostTier => tier !== undefined)
    .sort((a, b) => a.inputTokensAbove - b.inputTokensAbove);
  if (!tiers.length) return undefined;
  // 同一阈值重复出现时只留最后一个（读的那一份也是后者生效）。
  return tiers.filter((tier, index) => index === tiers.length - 1 || tiers[index + 1].inputTokensAbove !== tier.inputTokensAbove);
}

export function modelCostToDraft(cost?: Partial<ModelCostRates>): ModelCostDraft {
  return {
    input: cost?.input === undefined ? "" : String(cost.input),
    output: cost?.output === undefined ? "" : String(cost.output),
    cacheRead: cost?.cacheRead === undefined ? "" : String(cost.cacheRead),
    cacheWrite: cost?.cacheWrite === undefined ? "" : String(cost.cacheWrite),
  };
}

export function parseCompleteModelCost(draft: ModelCostDraft): ModelCostRates | undefined {
  if (!hasModelCostDraftValue(draft)) return undefined;

  const parse = (value: string): number | undefined => {
    if (!value.trim()) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const input = parse(draft.input);
  const output = parse(draft.output);
  const cacheRead = parse(draft.cacheRead);
  const cacheWrite = parse(draft.cacheWrite);
  if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) {
    return undefined;
  }
  return { input, output, cacheRead, cacheWrite };
}

export function hasModelCostDraftValue(draft: ModelCostDraft): boolean {
  return MODEL_COST_KEYS.some((key) => draft[key].trim() !== "");
}

export function setCompatBool<T extends CompatEntry>(entry: T, key: string, value: boolean): T {
  return {
    ...entry,
    compat: { ...(entry.compat ?? {}), [key]: value },
  };
}

/**
 * fork:compat-flags (B5) —— `compat` 子键的合法全集与默认值。
 *
 * 清单来自 pi-ai 的类型定义，不是猜的：
 * `node_modules/@earendil-works/pi-ai/dist/types.d.ts:829` 写明 compat 是**按 api 分支**的：
 *
 *   compat?: TApi extends "openai-completions" ? OpenAICompletionsCompat
 *     : TApi extends "openai-responses" | "azure-openai-responses" | "openai-codex-responses" ? OpenAIResponsesCompat
 *     : TApi extends "anthropic-messages" ? AnthropicMessagesCompat
 *     : TApi extends "bedrock-converse-stream" ? BedrockCompat
 *     : TApi extends "mistral-conversations" ? MistralConversationsCompat : never;
 *
 * 也就是说 google-generative-ai / google-vertex / pi-messages **根本没有 compat**
 * （分支是 `never`），给它们配 compat 是假配置。
 *
 * 只收录布尔字段，且只收录 pi-ai 的请求构造真的读的（逐个 `grep` 过
 * `dist/api/<api>.js`）：枚举 / 对象 / 数字字段（`thinkingFormat`、`maxTokensField`、
 * `openRouterRouting`、`chatTemplateKwargs`、`vllmPriority`…）不给开关 —— 那是
 * 键值编辑器的活，不是开关的活。
 *
 * `defaultValue`：
 * · `null` = pi 按 baseUrl 自动探测（openai-completions 的多数字段就是这一类，
 *   自证：`dist/api/openai-completions.js` 的 `getCompat()` 是
 *   `model.compat.x ?? detected.x`）。
 * · `true`/`false` = pi-ai 声明的固定默认值（自证：`compat?.x ?? true|false`）。
 */
export interface CompatFlagSpec {
  /** models.json `compat` 里的键名（与 pi-ai 类型同名）。 */
  key: string;
  /** i18n key，形如 `models.compatFlag.<key>`。 */
  labelKey: string;
  /** `null` = 按 baseUrl 自动探测；其余是 pi-ai 的固定默认值。 */
  defaultValue: boolean | null;
}

const flag = (key: string, defaultValue: boolean | null): CompatFlagSpec => ({
  key,
  labelKey: `models.compatFlag.${key}`,
  defaultValue,
});

/** openai-completions（OpenAICompletionsCompat）—— 自建网关 / vLLM / llama.cpp 主要受害者。 */
const OPENAI_COMPLETIONS_FLAGS = [
  flag("supportsStore", null),
  flag("supportsReasoningEffort", null),
  flag("supportsUsageInStreaming", null),
  flag("supportsFinishReason", null),
  flag("requiresToolResultName", null),
  flag("requiresAssistantAfterToolResult", null),
  flag("requiresThinkingAsText", null),
  flag("zaiToolStream", false),
  flag("supportsStrictMode", null),
  flag("supportsOpenAIGrammarTools", false),
  flag("supportsMidConvoSystemMessages", null),
  flag("supportsMidConvoToolAdditions", null),
  flag("sendSessionAffinityHeaders", null),
  flag("supportsLongCacheRetention", true),
] as const;

/**
 * openai-responses 家族（OpenAIResponsesCompat）。三个 api 的默认值不同：
 * `supportsStrictMode` 在 openai-responses 是 false，在 azure / codex 是 true
 * （自证：`dist/api/azure-openai-responses.js` 与 `openai-codex-responses.js`
 * 都是 `supportsStrictMode ?? true`，`openai-responses.js` 是 `?? false`），
 * 所以按 api 分开写，不能合并。
 */
const OPENAI_RESPONSES_FLAGS = [
  flag("supportsMidConvoSystemMessages", false),
  flag("supportsStrictMode", false),
  flag("supportsOpenAIGrammarTools", false),
  flag("supportsAdditionalTools", false),
  flag("supportsToolSearch", false),
  flag("supportsExplicitPromptCacheMode", false),
  flag("supportsMaxOutputTokens", true),
  flag("supportsLongCacheRetention", true),
] as const;

const OPENAI_RESPONSES_STRICT_DEFAULT_FLAGS = OPENAI_RESPONSES_FLAGS.map((spec) => (
  spec.key === "supportsStrictMode" ? { ...spec, defaultValue: true } : spec
));

/** anthropic-messages（AnthropicMessagesCompat）。 */
const ANTHROPIC_MESSAGES_FLAGS = [
  flag("supportsEagerToolInputStreaming", true),
  flag("supportsLongCacheRetention", true),
  flag("supportsCacheControlOnTools", true),
  flag("supportsTemperature", true),
  flag("forceAdaptiveThinking", false),
  flag("allowEmptySignature", false),
  flag("supportsStrictTools", false),
  flag("supportsMidConvoEffort", false),
  flag("supportsMidConvoSystemMessages", false),
  flag("supportsMidConvoToolChanges", false),
] as const;

/**
 * api → 该协议真正接受的布尔 compat 字段。
 * 不在表里的 api 一律返回空数组：pi-ai 的条件类型对它们是 `never`，
 * 配了也不会被请求构造读。
 */
const COMPAT_FLAGS_BY_API: Readonly<Record<string, readonly CompatFlagSpec[]>> = {
  "openai-completions": OPENAI_COMPLETIONS_FLAGS,
  "openai-responses": OPENAI_RESPONSES_FLAGS,
  "azure-openai-responses": OPENAI_RESPONSES_STRICT_DEFAULT_FLAGS,
  "openai-codex-responses": OPENAI_RESPONSES_STRICT_DEFAULT_FLAGS,
  "anthropic-messages": ANTHROPIC_MESSAGES_FLAGS,
  "bedrock-converse-stream": [flag("supportsStrictMode", false)],
  "mistral-conversations": [flag("supportsMidConvoSystemMessages", false)],
};

export function compatFlagsForApi(api: string | undefined): readonly CompatFlagSpec[] {
  if (!api) return [];
  return COMPAT_FLAGS_BY_API[api] ?? [];
}

export type CompatFlagState = "default" | "on" | "off";

/**
 * 实际生效值：`default` = 没写这个键（pi 按 `defaultValue` 决定），`on` / `off` =
 * 写了显式值。默认态不写键，所以 models.json 里不会多出一堆与 pi 默认相同的噪声。
 */
export function compatFlagState(
  compat: Record<string, unknown> | undefined,
  spec: CompatFlagSpec,
): CompatFlagState {
  const value = compat?.[spec.key];
  if (value === true) return "on";
  if (value === false) return "off";
  return "default";
}

/** 回到默认态就是删键 —— 「没配」与「配成默认值」在 models.json 里应当长得一样。 */
export function setCompatFlag<T extends CompatEntry>(
  entry: T,
  key: string,
  state: CompatFlagState,
): T {
  const compat = { ...(entry.compat ?? {}) };
  if (state === "default") delete compat[key];
  else compat[key] = state === "on";
  return { ...entry, compat: Object.keys(compat).length ? compat : undefined };
}

/**
 * 开关集合里没被任何一行编辑的键（枚举 / 对象 / 手改 JSON 写进来的）。
 * 高级分节只统计「已知字段」，未知键单独报个数，不再把整个 compat 说成
 * 「N 个兼容项」而看不出是哪些。
 */
export function countUnknownCompatKeys(
  compat: Record<string, unknown> | undefined,
  specs: readonly CompatFlagSpec[],
): number {
  const known = new Set(specs.map((spec) => spec.key));
  return Object.keys(compat ?? {}).filter((key) => !known.has(key)).length;
}

export function updateHeaderRow(
  rows: readonly HeaderRow[],
  id: number,
  changes: Partial<Pick<HeaderRow, "name" | "value">>,
): HeaderRow[] {
  return rows.map((row) => row.id === id ? { ...row, ...changes } : row);
}

/**
 * Model-level `headers` are merged over the provider's, so an empty value is not
 * "clear it" — it silently blanks a header the provider still needs. Drop those rows.
 * (Upstream closed PR #482①, same bug on both sides.)
 */
export function serializeHeaderRows(rows: readonly HeaderRow[]): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name || !row.value.trim()) continue;
    headers[name] = row.value;
  }
  return Object.keys(headers).length ? headers : undefined;
}

/** The parts of models.json the rename tracking needs. */
export interface ModelsConfigDraft {
  providers?: Record<string, { models?: { id: string }[] }>;
}

/** Snapshot of the model ids models.json holds, by provider and slot. */
export function savedModelIds(config: ModelsConfigDraft): Map<string, (string | null)[]> {
  return new Map(Object.entries(config.providers ?? {}).map(([name, provider]) => [
    name,
    (provider.models ?? []).map((model) => model.id),
  ]));
}

export function trackAddedModels(slots: Map<string, (string | null)[]>, providerName: string, count: number) {
  if (count <= 0) return;
  const existing = slots.get(providerName) ?? [];
  slots.set(providerName, [...existing, ...Array.from({ length: count }, () => null)]);
}

/**
 * Model ids that changed in place since the last save, as full references.
 *
 * `from` keeps the provider id the settings file still spells, so the server
 * can rewrite the entry before it applies the provider renames.
 */
export function collectModelRenames(
  config: ModelsConfigDraft,
  slots: Map<string, (string | null)[]>,
  providerRenames: Map<string, string>,
): { from: string; to: string }[] {
  const originalProvider = (name: string) => {
    for (const [from, to] of providerRenames) if (to === name) return from;
    return name;
  };

  const renames: { from: string; to: string }[] = [];
  for (const [name, provider] of Object.entries(config.providers ?? {})) {
    const saved = slots.get(name);
    if (!saved) continue;
    (provider.models ?? []).forEach((model, index) => {
      const before = saved[index];
      if (!before || !model.id || before === model.id) return;
      renames.push({ from: `${originalProvider(name)}/${before}`, to: `${name}/${model.id}` });
    });
  }
  return renames;
}

/** What the panel remembers between saves to tell renames from edits. */
export interface ProviderRenameTracking {
  /** Provider ids as models.json has them on disk. */
  savedProviders: Set<string>;
  /** Saved provider id -> where renames since the last save moved it. */
  renames: Map<string, string>;
  /** Saved model ids per provider, keyed by the provider's current id. */
  slots: Map<string, (string | null)[]>;
}

/**
 * fork:model-rename-save (upstream bd85004 / #969, fixes #903) — moves a provider to a
 * new id while keeping its place in models.json, and records the move so the
 * enabledModels entries can follow it on save.
 *
 * Returns null and records nothing when the provider is gone or the new id is
 * already taken: models.json is keyed by id, so the move would silently replace
 * the other provider. Returns the config unchanged when the id already matches.
 */
export function renameProviderEntry<T extends ModelsConfigDraft>(
  config: T,
  tracking: ProviderRenameTracking,
  oldName: string,
  newName: string,
): T | null {
  const providers = config.providers ?? {};
  if (!Object.hasOwn(providers, oldName)) return null;
  if (oldName === newName) return config;
  if (Object.hasOwn(providers, newName)) return null;

  const { renames, savedProviders, slots } = tracking;
  // A provider may already have been renamed once; keep the disk spelling as the
  // from side so `enabledModels` entries follow a single move, not a chain.
  let original = oldName;
  for (const [from, to] of renames) {
    if (to !== oldName) continue;
    original = from;
    break;
  }
  if (original === newName) renames.delete(original);
  else if (savedProviders.has(original)) renames.set(original, newName);
  const saved = slots.get(oldName);
  if (saved) {
    slots.delete(oldName);
    slots.set(newName, saved);
  }

  const entries = Object.entries(providers);
  const index = entries.findIndex(([name]) => name === oldName);
  entries[index] = [newName, entries[index][1]];
  return { ...config, providers: Object.fromEntries(entries) };
}

/**
 * D2-PR-21 — render one level's actual request params as a single compact line.
 *
 * The values come from `lib/thinking-request-core.ts`, a read-only mirror of pi-ai's request
 * construction, so this is what the provider would really receive for that level.
 * Returns null when the level sends no reasoning params at all.
 */
export function formatThinkingRequestParams(params: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        walk(nested, path ? `${path}.${key}` : key);
      }
      return;
    }
    parts.push(`${path}=${Array.isArray(value) ? value.join("|") : String(value)}`);
  };
  walk(params, "");
  return parts.length > 0 ? parts.join(", ") : null;
}
