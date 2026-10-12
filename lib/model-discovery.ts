/**
 * fork:model-discovery-specs (upstream closed PR #957) — provider 自己的 `/models`
 * 会报上下文窗口与最大输出，门禁格式却各写各的：顶层 snake_case / camelCase，或裹在
 * `metadata` / `limits` / `capabilities` / `top_provider` 下面。只认正整数，这样上游的
 * 脏值不会覆盖掉一份已经配好的配置。
 */
/** fork:upstream-0.12-model-parity —— 上游 `/models` 发布的能力（#856）：推理支持与档位映射。 */
const EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
type EffortLevel = typeof EFFORT_LEVELS[number];

const REASONING_FIELDS = ["supports_reasoning", "supportsReasoning", "reasoning", "thinking"] as const;
const EFFORT_LIST_FIELDS = ["supported_efforts", "supportedEfforts"] as const;

const CONTEXT_WINDOW_KEYS = [
  "context_window",
  "contextWindow",
  "context_length",
  "contextLength",
  "max_context_tokens",
  "maxContextTokens",
  "max_input_tokens",
  "maxInputTokens",
  "limit_context",
  // fork:upstream-0.12-model-parity —— Google 的 inputTokenLimit（#856）。
  "inputTokenLimit",
] as const;

const MAX_OUTPUT_TOKEN_KEYS = [
  "max_tokens",
  "maxTokens",
  "max_output_tokens",
  "maxOutputTokens",
  "max_completion_tokens",
  "maxCompletionTokens",
  "max_new_tokens",
  "maxNewTokens",
  // fork:upstream-0.12-model-parity —— Google 的 outputTokenLimit（#856）。
  "outputTokenLimit",
] as const;

/** 输入模态：数组写法（OpenRouter / 自己写网关）与布尔写法（vLLM / Together）都有。 */
const INPUT_MODALITY_KEYS = [
  "input_modalities",
  "inputModalities",
  "supported_input_modalities",
  "supportedInputModalities",
  "modalities",
] as const;

const VISION_FLAG_KEYS = [
  "vision",
  "image_input",
  "imageInput",
  "supports_vision",
  "supportsVision",
  "multimodal",
] as const;

/** 模态可以再裹一层：`modalities.input`、`capabilities.limits`、`metadata.output_modalities`。 */
const SPEC_CONTAINER_KEYS = [
  "metadata",
  "limits",
  "limit",
  "capabilities",
  "top_provider",
  "modalities",
  "architecture",
  "features",
] as const;

export interface DiscoveredModel {
  id: string;
  name?: string;
  /** Context window the endpoint reports, when it reports one. */
  contextWindow?: number;
  /** Max output tokens the endpoint reports, when it reports one. */
  maxTokens?: number;
  /** Input modalities the endpoint reports (`text` / `image`); never a guess. */
  input?: string[];
  /** fork:upstream-0.12-model-parity —— 端点声明支持推理（#856）。 */
  reasoning?: true;
  /** 端点声明的档位列表映射到 pi 的档位（未列的标 null）。 */
  thinkingLevelMap?: Partial<Record<EffortLevel, string | null>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * fork:upstream-0.12-model-parity —— 端点声明的档位列表用的是 pi 自己的档位名（pi 在
 * thinkingLevelMap 没有条目时就把档位名当 effort 发出去）。它未列的档位标为不支持（null），
 * `xhigh` / `max` 要有条目才会被提供。`off` 不映射：列表没说能不能关掉思考。
 * 一个都没列到 pi 档位的列表不映射任何东西（#856）。
 */
function thinkingLevelMapFromEfforts(value: Record<string, unknown>): DiscoveredModel["thinkingLevelMap"] {
  const list = EFFORT_LIST_FIELDS.map((field) => value[field]).find(Array.isArray);
  if (!list) return undefined;
  const advertised = new Set(list.filter((effort): effort is string => typeof effort === "string"));
  if (!EFFORT_LEVELS.some((level) => advertised.has(level))) return undefined;
  const map: NonNullable<DiscoveredModel["thinkingLevelMap"]> = {};
  for (const level of EFFORT_LEVELS) {
    if (!advertised.has(level)) map[level] = null;
    else if (level === "xhigh" || level === "max") map[level] = level;
  }
  return map;
}

function reasoningCapabilities(value: Record<string, unknown>): Pick<DiscoveredModel, "reasoning" | "thinkingLevelMap"> {
  const reasoning = REASONING_FIELDS.some((field) => value[field] === true);
  if (!reasoning) return {};
  const thinkingLevelMap = thinkingLevelMapFromEfforts(value);
  return { reasoning: true, ...(thinkingLevelMap ? { thinkingLevelMap } : {}) };
}

function readLimit(value: unknown): number | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return undefined;
    const parsed = Number(trimmed);
    return parsed > 0 ? parsed : undefined;
  }
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function pickLimit(source: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = readLimit(source[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

import { isModelInputModality } from "./model-capabilities";

function readModalities(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const modalities = [...new Set(value.filter((entry): entry is string => (
    typeof entry === "string" && (entry === "text" || isModelInputModality(entry))
  )))];
  return modalities.length ? modalities : undefined;
}

function readVisionFlag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

interface DiscoveredSpecs {
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
}

function readSpecs(value: unknown, depth = 0): DiscoveredSpecs {
  const specs: DiscoveredSpecs = {};
  if (!isRecord(value)) return specs;

  const contextWindow = pickLimit(value, CONTEXT_WINDOW_KEYS);
  if (contextWindow !== undefined) specs.contextWindow = contextWindow;

  const maxTokens = pickLimit(value, MAX_OUTPUT_TOKEN_KEYS);
  if (maxTokens !== undefined) specs.maxTokens = maxTokens;

  // 模态：数组写法优先；布尔写法只在数组不存在时用（`vision: true` → ["text","image"]）。
  const listed = pickModalities(value);
  if (listed !== undefined) specs.input = listed;

  if (depth >= 2) return specs;

  // 网关会把 limits 掉一层：`metadata.limits.context_window`、
  // `top_provider.context_length`、`capabilities.limits.max_tokens`、`modalities.input`。
  for (const nestedKey of SPEC_CONTAINER_KEYS) {
    if (specs.contextWindow !== undefined && specs.maxTokens !== undefined && specs.input !== undefined) break;
    const nested = readSpecs(value[nestedKey], depth + 1);
    if (specs.contextWindow === undefined && nested.contextWindow !== undefined) {
      specs.contextWindow = nested.contextWindow;
    }
    if (specs.maxTokens === undefined && nested.maxTokens !== undefined) {
      specs.maxTokens = nested.maxTokens;
    }
    if (specs.input === undefined && nested.input !== undefined) {
      specs.input = nested.input;
    }
  }

  return specs;
}

function pickModalities(source: Record<string, unknown>): string[] | undefined {
  for (const key of INPUT_MODALITY_KEYS) {
    const listed = readModalities(source[key]);
    if (listed) return listed;
  }
  // `modalities` 既可能是数组（["text","image"]），也可能是 {input: [...]}。
  const modalities = source.modalities;
  if (isRecord(modalities)) {
    const nested = readModalities(modalities.input);
    if (nested) return nested;
  }
  for (const key of VISION_FLAG_KEYS) {
    const flag = readVisionFlag(source[key]);
    if (flag !== undefined) return flag ? ["text", "image"] : ["text"];
  }
  return undefined;
}

function modelFromValue(value: unknown): DiscoveredModel | null {
  if (typeof value === "string") {
    const id = value.trim();
    return id ? { id } : null;
  }
  if (!isRecord(value)) return null;

  const rawId = cleanString(value.id) ?? cleanString(value.model) ?? cleanString(value.name);
  if (!rawId) return null;
  const id = rawId.startsWith("models/") ? rawId.slice("models/".length) : rawId;
  if (!id) return null;
  const name = cleanString(value.display_name)
    ?? cleanString(value.displayName)
    ?? (cleanString(value.id) || cleanString(value.model) ? cleanString(value.name) : undefined);

  // fork:model-discovery-specs —— 私有网关 / vLLM / 自建端点在 models.dev 上查不到，
  // 它们的 `/models` 是唯一的规格来源，所以发现时就带着走。
  const specs = readSpecs(value);
  const discovered: DiscoveredModel = { id };
  if (name && name !== id) discovered.name = name;
  if (specs.contextWindow !== undefined) discovered.contextWindow = specs.contextWindow;
  if (specs.maxTokens !== undefined) discovered.maxTokens = specs.maxTokens;
  if (specs.input !== undefined) discovered.input = specs.input;
  Object.assign(discovered, reasoningCapabilities(value));
  return discovered;
}

function listFromResponse(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of ["data", "models", "results", "items"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate;
    if (isRecord(candidate)) return Object.values(candidate);
  }
  return [];
}

export function parseDiscoveredModels(value: unknown): DiscoveredModel[] {
  const seen = new Set<string>();
  const models: DiscoveredModel[] = [];
  for (const item of listFromResponse(value)) {
    const model = modelFromValue(item);
    if (!model || seen.has(model.id)) continue;
    seen.add(model.id);
    models.push(model);
  }
  return models.sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id, undefined, {
    numeric: true,
    sensitivity: "base",
  }));
}

export function buildModelsListUrl(baseUrl: string, api: string): URL {
  const url = new URL(baseUrl.trim());
  const trimmedPath = url.pathname.replace(/\/+$/, "");

  if (!/\/models$/i.test(trimmedPath)) {
    let path = trimmedPath;
    if (api === "anthropic-messages" && !/\/v\d+(?:beta)?$/i.test(path)) path += "/v1";
    if (api === "google-generative-ai" && !/\/v\d+(?:beta)?$/i.test(path)) path += "/v1beta";
    url.pathname = `${path}/models`.replace(/\/+/g, "/");
  }

  if (api === "anthropic-messages" && !url.searchParams.has("limit")) {
    url.searchParams.set("limit", "1000");
  }
  if (api === "google-generative-ai" && !url.searchParams.has("pageSize")) {
    url.searchParams.set("pageSize", "1000");
  }
  return url;
}

function hasHeader(headers: Headers, name: string): boolean {
  return headers.has(name);
}

/**
 * Headers for a provider's own `/models` list probe — same rules the
 * `/api/models-config/discover` route uses, shared with catalog refresh.
 */
export function buildDiscoveryHeaders(
  api: string,
  apiKey: string | undefined,
  configured: Record<string, string>,
): Headers {
  const headers = new Headers(configured);
  if (!hasHeader(headers, "accept")) headers.set("Accept", "application/json");
  if (!apiKey) return headers;

  if (api === "anthropic-messages") {
    if (!hasHeader(headers, "x-api-key")) headers.set("x-api-key", apiKey);
    if (!hasHeader(headers, "anthropic-version")) headers.set("anthropic-version", "2023-06-01");
  } else if (api === "google-generative-ai") {
    if (!hasHeader(headers, "x-goog-api-key")) headers.set("x-goog-api-key", apiKey);
  } else if (!hasHeader(headers, "authorization")) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }
  return headers;
}
