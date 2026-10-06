/**
 * fork:imagegen —— **客户端安全**的那一半：类型、服务商预设、掩码、请求构造与响应解析。
 *
 * 为什么单独一个文件（`lib/client-graph-purity.test.mjs` 的规矩，与 `im-bridge-shared`
 * 同一条）：`lib/imagegen-config.ts` 要读写 `~/.pi/agent/imagegen.json`（`node:fs`），
 * 设置页是 `"use client"`，直接 import 就把服务端模块拖进浏览器依赖图。
 * 所以：**文件读写留服务端，类型与纯函数留这里**，两边从同一份定义出。
 *
 * 协议裁定（docs/imagegen-plan-2026-10-06.md D1）：只做 OpenAI 兼容
 * `POST {baseUrl}/images/generations`。OpenAI 官方 / 金龙中转 / 硅基流动 / 火山方舟
 * 都是这一个形状，预设只带端点，密钥与模型各填各的。
 */

export type ImageGenPreset = "openai" | "jinlong" | "siliconflow" | "volcengine" | "custom";

export const IMAGEGEN_PRESET_IDS: readonly ImageGenPreset[] = [
  "openai",
  "jinlong",
  "siliconflow",
  "volcengine",
  "custom",
];

/**
 * 预设端点。`custom` 端点为空 = 用户必须自己填。
 * 参考来源：pi参考项目/标书功能 `SettingsPage.tsx` 的服务商表 + 各家公开文档。
 */
export const IMAGEGEN_PRESET_ENDPOINTS: Record<ImageGenPreset, string> = {
  openai: "https://api.openai.com/v1",
  jinlong: "https://img-api.jlaudeapi.com/v1",
  siliconflow: "https://api.siliconflow.cn/v1",
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  custom: "",
};

export const IMAGEGEN_PRESET_LABELS: Record<ImageGenPreset, string> = {
  openai: "OpenAI",
  jinlong: "金龙中转",
  siliconflow: "SiliconFlow",
  volcengine: "火山方舟（豆包）",
  custom: "自定义",
};

/** 默认模型只是占位提示：换服务商后这里经常要跟着改，以各站模型列表为准。 */
export const IMAGEGEN_PRESET_MODELS: Record<ImageGenPreset, string> = {
  openai: "gpt-image-2",
  jinlong: "gpt-image-2",
  siliconflow: "Kwai-Kolors/Kolors",
  volcengine: "doubao-seedream-4-0-250828",
  custom: "",
};

/** 工具没显式给尺寸时用档案默认；请求体里原样透传（各家认各家的枚举）。 */
export const IMAGEGEN_DEFAULT_SIZE = "1024x1024";

/** 一批最多 4 张：够拼一版标书插图，也封顶单次误触的烧钱量。 */
export const IMAGEGEN_MAX_BATCH = 4;

/** 单张请求上限：生图端点常见 60-180s，取最宽档（MusePi 同款 3 分钟）。 */
export const IMAGEGEN_TIMEOUT_MS = 180_000;

/** 掩码：设置页要能显示「已配」又不能把密钥回显给浏览器（im-bridge 同款常量）。 */
export const IMAGEGEN_KEY_MASK = "••••••••";

export function isMaskedImageGenKey(value: string | undefined): boolean {
  return value === IMAGEGEN_KEY_MASK;
}

export interface ImageGenProfile {
  /** OpenAI 兼容根端点（不含 `/images/generations`）。 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 请求体里的默认 `size`；各家枚举不同，原样透传。 */
  size: string;
  /** 一次多张时的在途上限（1-4）。 */
  concurrency: number;
}

export type ImageGenStatusState = "untested" | "available" | "unavailable";

export interface ImageGenStatus {
  state: ImageGenStatusState;
  /** ISO 时间；null = 从没测过。 */
  testedAt: string | null;
  /** 最近一次失败的原因（截断后），成功时为 null。 */
  lastError: string | null;
  /** 最近一次成功的耗时（毫秒），给「测试」按钮的徽标用。 */
  lastDurationMs: number | null;
}

export interface ImageGenProviderEntry extends ImageGenProfile {
  status: ImageGenStatus;
}

export interface ImageGenConfig {
  version: 1;
  /** 当前生效的服务商；请求与工具都读它。 */
  active: ImageGenPreset;
  providers: Record<ImageGenPreset, ImageGenProviderEntry>;
}

export function emptyImageGenStatus(): ImageGenStatus {
  return { state: "untested", testedAt: null, lastError: null, lastDurationMs: null };
}

function asPreset(value: unknown): ImageGenPreset {
  return typeof value === "string" && (IMAGEGEN_PRESET_IDS as readonly string[]).includes(value)
    ? value as ImageGenPreset
    : "custom";
}

function clampConcurrency(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 2;
  return Math.min(IMAGEGEN_MAX_BATCH, Math.max(1, n));
}

function readProfile(value: unknown): ImageGenProviderEntry {
  const entry = (value ?? {}) as Record<string, unknown>;
  const rawStatus = (entry.status ?? {}) as Record<string, unknown>;
  const state = rawStatus.state === "available" || rawStatus.state === "unavailable"
    ? rawStatus.state
    : "untested";
  return {
    baseUrl: typeof entry.baseUrl === "string" ? entry.baseUrl.trim() : "",
    apiKey: typeof entry.apiKey === "string" ? entry.apiKey : "",
    model: typeof entry.model === "string" ? entry.model.trim() : "",
    size: typeof entry.size === "string" && entry.size.trim() ? entry.size.trim() : IMAGEGEN_DEFAULT_SIZE,
    concurrency: clampConcurrency(entry.concurrency),
    status: {
      state,
      testedAt: typeof rawStatus.testedAt === "string" ? rawStatus.testedAt : null,
      lastError: typeof rawStatus.lastError === "string" ? rawStatus.lastError : null,
      lastDurationMs: typeof rawStatus.lastDurationMs === "number" && Number.isFinite(rawStatus.lastDurationMs)
        ? rawStatus.lastDurationMs
        : null,
    },
  };
}

/** 读入的任意 JSON → 合法配置。字段缺失落默认，绝不抛（坏文件不阻塞会话启动）。 */
export function normalizeImageGenConfig(value: unknown): ImageGenConfig {
  const raw = (value ?? {}) as Record<string, unknown>;
  const active = asPreset(raw.active);
  const rawProviders = (raw.providers ?? {}) as Record<string, unknown>;
  const providers = {} as Record<ImageGenPreset, ImageGenProviderEntry>;
  for (const id of IMAGEGEN_PRESET_IDS) {
    const preset = readProfile(rawProviders[id]);
    // 预设端点只在「用户没写 / 写的是旧预设默认」时兜底；custom 永远以用户填写为准。
    if (!preset.baseUrl && id !== "custom") preset.baseUrl = IMAGEGEN_PRESET_ENDPOINTS[id];
    providers[id] = preset;
  }
  return { version: 1, active, providers };
}

/** 「这个档案能不能直接发起生成」——工具与测试路由共用同一份判定。 */
export function profileIsConfigured(profile: ImageGenProfile | undefined): profile is ImageGenProfile {
  return Boolean(
    profile
      && profile.baseUrl
      && profile.apiKey
      && profile.model,
  );
}

// ── 请求构造与响应解析（纯函数，fetch 桩可测） ────────────────────────────────

export interface BuiltImagesRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface GenerateParams {
  prompt: string;
  /** 1-4；超出按上限收。 */
  n?: number;
  /** 覆盖档案默认尺寸。 */
  size?: string;
}

/** OpenAI 兼容请求体。火山方舟的 `size` 也在 body，无需分方言。 */
export function buildImagesRequest(
  profile: ImageGenProfile,
  params: GenerateParams,
): BuiltImagesRequest {
  const baseUrl = profile.baseUrl.replace(/\/+$/, "");
  const n = Math.min(IMAGEGEN_MAX_BATCH, Math.max(1, Math.floor(params.n ?? 1)));
  const size = (params.size ?? profile.size ?? IMAGEGEN_DEFAULT_SIZE).trim() || IMAGEGEN_DEFAULT_SIZE;
  return {
    url: `${baseUrl}/images/generations`,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${profile.apiKey}`,
    },
    body: JSON.stringify({ model: profile.model, prompt: params.prompt, n, size }),
  };
}

/** 服务商可能回 `b64_json` 或 `url` 两种载荷；`url` 必须由调用方下载落盘（外链会过期）。 */
export interface ParsedImageOutput {
  b64?: string;
  url?: string;
  revisedPrompt?: string;
}

export interface ParsedImagesResponse {
  images: ParsedImageOutput[];
  usage?: unknown;
  /** 服务商回的错误正文（截断后）；HTTP 非 2xx 或业务错误时给。 */
  error?: string;
}

const ERROR_DETAIL_MAX = 300;

function clip(text: string): string {
  return text.length > ERROR_DETAIL_MAX ? `${text.slice(0, ERROR_DETAIL_MAX - 1)}…` : text;
}

/** 兼容三种返回形状：OpenAI `data[].b64_json` / `data[].url`、中转站的 `data[][].url`。 */
export function parseImagesResponse(payload: unknown): ParsedImagesResponse {
  const root = (payload ?? {}) as Record<string, unknown>;
  const rawError = root.error ?? root.message;
  const error = typeof rawError === "string"
    ? clip(rawError)
    : rawError && typeof rawError === "object"
      ? clip(String((rawError as Record<string, unknown>).message ?? JSON.stringify(rawError)))
      : undefined;

  const data = Array.isArray(root.data) ? root.data : [];
  const images: ParsedImageOutput[] = [];
  for (const item of data) {
    // 中转站偶见 `data: [[{url}]]`（数组的数组），摊平一层。
    const entries = Array.isArray(item) ? item : [item];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const b64 = typeof record.b64_json === "string" && record.b64_json
        ? record.b64_json
        : typeof record.b64 === "string" && record.b64
          ? record.b64
          : undefined;
      const url = typeof record.url === "string" && record.url ? record.url : undefined;
      const revisedPrompt = typeof record.revised_prompt === "string" && record.revised_prompt
        ? record.revised_prompt
        : undefined;
      if (b64 || url) images.push({ ...(b64 ? { b64 } : {}), ...(url ? { url } : {}), ...(revisedPrompt ? { revisedPrompt } : {}) });
    }
  }
  return { images, usage: root.usage, ...(error && images.length === 0 ? { error } : {}) };
}

/** 失败详情带 HTTP 状态，模型与设置页都靠它判断是密钥、尺寸还是限流。 */
export function describeHttpError(status: number, bodyText: string): string {
  let message = bodyText.trim();
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const err = parsed.error;
    if (typeof err === "string") message = err;
    else if (err && typeof err === "object" && typeof (err as Record<string, unknown>).message === "string") {
      message = String((err as Record<string, unknown>).message);
    } else if (typeof parsed.message === "string") message = parsed.message;
  } catch {
    // 非 JSON 正文原样截断
  }
  return clip(`HTTP ${status}${message ? ` ${message}` : ""}`);
}
