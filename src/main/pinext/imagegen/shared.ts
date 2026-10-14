/**
 * fork:imagegen —— **客户端安全**的那一半：类型、服务商预设表、掩码、请求构造与响应解析。
 *
 * 为什么单独一个文件（`lib/client-graph-purity.test.mjs` 的规矩，与 `im-bridge-shared`
 * 同一条）：`lib/imagegen-config.ts` 要读写 `~/.pi/agent/imagegen.json`（`node:fs`），
 * 设置页是 `"use client"`，直接 import 就把服务端模块拖进浏览器依赖图。
 * 所以：**文件读写留服务端，类型与纯函数留这里**，两边从同一份定义出。
 *
 * 预设表与三种方言**照抄参考项目的实测实现**（`pi参考项目/标书功能/client/electron/services/aiService.cjs`
 * 的 `OPENAI_IMAGE_PROVIDER_META` / `createOpenAICompatibleImageRequestBody` / `createGoogleImageRequestBody`，
 * 与 `pi参考项目/MusePi-main/packages/coding-agent/src/tools/image-gen.ts` 的 Agnes 分支）：
 *   · `openai`   —— `POST {base}/images/generations`，`{model, prompt, size}`（DALL·E 才带 response_format）
 *   · `agnes`    —— 同一条路，但 `extra_body.response_format`，2.1-flash 另带 `ratio`
 *   · `google`   —— `POST {base}/models/{model}:generateContent`，`x-goog-api-key`，回 `inlineData`
 * 三家都是实测过的形状，不是照文档猜的。预设端点/默认模型同样取自这两个项目。
 */

export type ImageGenPreset = "agnes" | "agnes-global" | "volcengine" | "google" | "openai" | "custom";

/** 请求方言：决定 URL、请求头与请求体长什么样。 */
export type ImageGenDialect = "openai" | "agnes" | "google";

export interface ImageGenPresetMeta {
  label: string;
  /** 预设端点；`custom` 为空 = 必须自己填。 */
  baseUrl: string;
  /** 预填的模型名（可改；各家站内名称以自己那份为准）。 */
  model: string;
  /** 默认尺寸。 */
  size: string;
  dialect: ImageGenDialect;
}

/**
 * 预设表。金龍中轉按用户要求**不在表里**（要它就用自定义填端点）。
 * Agnes 有国内与国际两个入口，凭证不互通，所以是两个档。
 */
export const IMAGEGEN_PRESETS: Record<ImageGenPreset, ImageGenPresetMeta> = {
  agnes: {
    label: "Agnes AI（国内）",
    baseUrl: "https://api.agnes-ai.cn/v1",
    model: "agnes-image-2.1-flash",
    size: "1K",
    dialect: "agnes",
  },
  "agnes-global": {
    label: "Agnes AI（国际）",
    baseUrl: "https://apihub.agnes-ai.com/v1",
    model: "agnes-image-2.1-flash",
    size: "1K",
    dialect: "agnes",
  },
  volcengine: {
    label: "火山方舟（豆包）",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seedream-4-0-250828",
    size: "1024x1024",
    dialect: "openai",
  },
  google: {
    label: "Google AI Studio",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash-image",
    size: "1K",
    dialect: "google",
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-image-1",
    size: "1024x1024",
    dialect: "openai",
  },
  custom: {
    label: "自定义（OpenAI 兼容）",
    baseUrl: "",
    model: "",
    size: "1024x1024",
    dialect: "openai",
  },
};

export const IMAGEGEN_PRESET_IDS: readonly ImageGenPreset[] = [
  "agnes",
  "agnes-global",
  "volcengine",
  "google",
  "openai",
  "custom",
];

export const IMAGEGEN_DEFAULT_PRESET: ImageGenPreset = "agnes";

/** Agnes 的尺寸是档位（1K/2K/3K/4K），2.0 才是像素；照参考项目的白名单收。 */
export const IMAGEGEN_AGNES_2_1_SIZES = ["1K", "2K", "3K", "4K"];
export const IMAGEGEN_AGNES_2_0_SIZES = ["1024x768", "1024x1024", "768x1024"];
export const IMAGEGEN_AGNES_RATIOS = ["1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"];

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

export function imageGenPresetMeta(preset: ImageGenPreset): ImageGenPresetMeta {
  return IMAGEGEN_PRESETS[preset];
}

export interface ImageGenProfile {
  /** OpenAI 兼容根端点（不含 `/images/generations`）；google 档不含 `/models/...`。 */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 请求体里的默认 `size`；各家枚举不同，原样透传。 */
  size: string;
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

export function emptyImageGenStatus(): ImageGenStatus {
  return { state: "untested", testedAt: null, lastError: null, lastDurationMs: null };
}

export interface ImageGenProviderEntry extends ImageGenProfile {
  concurrency: number;
  status: ImageGenStatus;
}

export interface ImageGenConfig {
  version: 3;
  /** 当前生效的预设档；请求与工具都读它。 */
  active: ImageGenPreset;
  providers: Record<ImageGenPreset, ImageGenProviderEntry>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPreset(value: unknown): ImageGenPreset | null {
  return typeof value === "string" && (IMAGEGEN_PRESET_IDS as readonly string[]).includes(value)
    ? value as ImageGenPreset
    : null;
}

function clampConcurrency(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 2;
  return Math.min(IMAGEGEN_MAX_BATCH, Math.max(1, n));
}

function readStatus(value: unknown): ImageGenStatus {
  const raw = isRecord(value) ? value : {};
  const state = raw.state === "available" || raw.state === "unavailable" ? raw.state : "untested";
  return {
    state,
    testedAt: typeof raw.testedAt === "string" ? raw.testedAt : null,
    lastError: typeof raw.lastError === "string" ? raw.lastError : null,
    lastDurationMs: typeof raw.lastDurationMs === "number" && Number.isFinite(raw.lastDurationMs)
      ? raw.lastDurationMs
      : null,
  };
}

export function readEntry(preset: ImageGenPreset, value: unknown): ImageGenProviderEntry {
  const meta = IMAGEGEN_PRESETS[preset];
  const raw = isRecord(value) ? value : {};
  return {
    baseUrl: typeof raw.baseUrl === "string" && raw.baseUrl.trim() ? raw.baseUrl.trim() : meta.baseUrl,
    apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
    model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : meta.model,
    size: typeof raw.size === "string" && raw.size.trim() ? raw.size.trim() : meta.size,
    concurrency: clampConcurrency(raw.concurrency),
    status: readStatus(raw.status),
  };
}

/** 单档归一化（配置写入时逐档合并用，与整体归一化同一份规则）。 */
export function normalizeImageGenEntry(preset: ImageGenPreset, value: unknown): ImageGenProviderEntry {
  return readEntry(preset, value);
}

/**
 * 读入的任意 JSON → 合法配置。字段缺失落默认，绝不抛（坏文件不阻塞会话启动）。
 *
 * 迁移：v3（本形状）直接用；更早的两种形状（v1 的 `{active, providers}`、v2 的
 * `{profile}` 引用档）只按 id 取回同名档位里**用户自己填过**的端点/密钥/模型。
 * 已从表里去掉的档（金龍中轉、硅基流动）与引用档的 `providerId` 一并丢弃 ——
 * 它们没有对应的新档位可落。
 */
export function normalizeImageGenConfig(value: unknown): ImageGenConfig {
  const raw = isRecord(value) ? value : {};
  const legacyProviders = isRecord(raw.providers) ? raw.providers : {};
  const providers = {} as Record<ImageGenPreset, ImageGenProviderEntry>;
  for (const preset of IMAGEGEN_PRESET_IDS) {
    providers[preset] = readEntry(preset, legacyProviders[preset]);
  }
  const active = asPreset(raw.active) ?? IMAGEGEN_DEFAULT_PRESET;
  return { version: 3, active, providers };
}

/** 「这个档案能不能直接发起生成」——工具与测试路由共用同一份判定。 */
export function profileIsConfigured(profile: ImageGenProfile | undefined): profile is ImageGenProfile {
  return Boolean(profile && profile.baseUrl && profile.apiKey && profile.model);
}

// ── 请求构造与响应解析（纯函数，fetch 桩可测） ────────────────────────────────

export interface BuiltImagesRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface GenerateParams {
  prompt: string;
  /** 覆盖档案默认尺寸。 */
  size?: string;
  /** Agnes 2.1 的宽高比；其它方言忽略。 */
  ratio?: string;
}

/** DALL·E 才认 `response_format`；GPT Image 与未知兼容模型传它会 400（PI-Desktop 同一条规矩）。 */
function wantsResponseFormat(model: string): boolean {
  return /^dall-e-/i.test(model.trim());
}

function agnesRequestBody(profile: ImageGenProfile, params: GenerateParams): Record<string, unknown> {
  // `response_format` 在 Agnes 走 extra_body（顶层会被拒），照参考项目抄。
  const body: Record<string, unknown> = {
    model: profile.model,
    prompt: params.prompt,
    size: (params.size ?? profile.size ?? IMAGEGEN_DEFAULT_SIZE).trim() || IMAGEGEN_DEFAULT_SIZE,
    extra_body: { response_format: "url" },
  };
  if (profile.model === "agnes-image-2.1-flash") {
    const ratio = (params.ratio ?? "1:1").trim();
    body.ratio = IMAGEGEN_AGNES_RATIOS.includes(ratio) ? ratio : "1:1";
  }
  return body;
}

function googleRequestBody(profile: ImageGenProfile, params: GenerateParams): Record<string, unknown> {
  const imageSize = (params.size ?? profile.size ?? "1K").trim();
  return {
    contents: [{ role: "user", parts: [{ text: params.prompt }] }],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
      ...(imageSize ? { imageConfig: { imageSize } } : {}),
    },
  };
}

/**
 * 按方言构造请求。三家的 URL / 头 / body 各不相同，所以方言从预设表来，
 * 由调用方显式传入（不猜）。
 */
export function buildImagesRequest(
  preset: ImageGenPreset,
  profile: ImageGenProfile,
  params: GenerateParams,
): BuiltImagesRequest {
  const baseUrl = profile.baseUrl.replace(/\/+$/, "");
  const dialect = IMAGEGEN_PRESETS[preset].dialect;

  if (dialect === "google") {
    return {
      url: `${baseUrl}/models/${encodeURIComponent(profile.model)}:generateContent`,
      headers: { "content-type": "application/json", "x-goog-api-key": profile.apiKey },
      body: JSON.stringify(googleRequestBody(profile, params)),
    };
  }

  const body = dialect === "agnes"
    ? agnesRequestBody(profile, params)
    : {
      model: profile.model,
      prompt: params.prompt,
      size: (params.size ?? profile.size ?? IMAGEGEN_DEFAULT_SIZE).trim() || IMAGEGEN_DEFAULT_SIZE,
      ...(wantsResponseFormat(profile.model) ? { response_format: "b64_json" } : {}),
    };
  return {
    url: `${baseUrl}/images/generations`,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${profile.apiKey}`,
    },
    body: JSON.stringify(body),
  };
}

/** 服务商回的图：`b64` 直接解码，`url` 必须由调用方下载落盘（外链会过期）。 */
export interface ParsedImageOutput {
  b64?: string;
  url?: string;
  /** google 档自带 mime；OpenAI 兼容档一律按 PNG 猜（除非 url 有扩展名）。 */
  mimeType?: string;
  revisedPrompt?: string;
}

export interface ParsedImagesResponse {
  images: ParsedImageOutput[];
  usage?: unknown;
  /** 服务商回的错误正文（截断后）；HTTP 非 2xx 或业务错误时给。 */
  error?: string;
}

const ERROR_DETAIL_MAX = 300;

/** 网页 404（`<!DOCTYPE html>`）不是 API 的报错正文。 */
const HTML_BODY = /^\s*(?:<!doctype\s+html|<html\b)/i;

function clip(text: string): string {
  return text.length > ERROR_DETAIL_MAX ? `${text.slice(0, ERROR_DETAIL_MAX - 1)}…` : text;
}

/** google 的图在 `candidates[].content.parts[].inlineData.{mimeType,data}`（snake_case 也认）。 */
function parseGoogleImages(root: Record<string, unknown>): ParsedImageOutput[] {
  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  const images: ParsedImageOutput[] = [];
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue;
    const content = isRecord(candidate.content) ? candidate.content : {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    for (const part of parts) {
      if (!isRecord(part)) continue;
      const inline = isRecord(part.inlineData) ? part.inlineData : isRecord(part.inline_data) ? part.inline_data : null;
      const data = inline && typeof inline.data === "string" ? inline.data : "";
      if (!data) continue;
      const mime = inline && typeof (inline.mimeType ?? inline.mime_type) === "string"
        ? String(inline.mimeType ?? inline.mime_type)
        : "image/png";
      images.push({ b64: data, mimeType: mime });
    }
  }
  return images;
}

/** OpenAI 兼容档：`data[].b64_json` / `data[].url`，中转站偶见 `data: [[{url}]]`（摊平一层）。 */
function parseDataImages(root: Record<string, unknown>): ParsedImageOutput[] {
  const data = Array.isArray(root.data) ? root.data : [];
  const images: ParsedImageOutput[] = [];
  for (const item of data) {
    const entries = Array.isArray(item) ? item : [item];
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const b64 = typeof entry.b64_json === "string" && entry.b64_json
        ? entry.b64_json
        : typeof entry.b64 === "string" && entry.b64
          ? entry.b64
          : undefined;
      const url = typeof entry.url === "string" && entry.url ? entry.url : undefined;
      const revisedPrompt = typeof entry.revised_prompt === "string" && entry.revised_prompt
        ? entry.revised_prompt
        : undefined;
      if (b64 || url) images.push({ ...(b64 ? { b64 } : {}), ...(url ? { url } : {}), ...(revisedPrompt ? { revisedPrompt } : {}) });
    }
  }
  return images;
}

export function parseImagesResponse(payload: unknown, preset: ImageGenPreset): ParsedImagesResponse {
  const root = isRecord(payload) ? payload : {};
  const rawError = root.error ?? root.message;
  const error = typeof rawError === "string"
    ? clip(rawError)
    : isRecord(rawError)
      ? clip(String(rawError.message ?? JSON.stringify(rawError)))
      : undefined;

  const images = IMAGEGEN_PRESETS[preset].dialect === "google" ? parseGoogleImages(root) : parseDataImages(root);
  return { images, usage: root.usage ?? root.usageMetadata, ...(error && images.length === 0 ? { error } : {}) };
}

/** 失败详情带 HTTP 状态，模型与设置页都靠它判断是密钥、尺寸还是限流。 */
export function describeHttpError(status: number, bodyText: string): string {
  let message = bodyText.trim();
  let structured = false;
  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const err = parsed.error;
    if (typeof err === "string") message = err;
    else if (isRecord(err) && typeof err.message === "string") message = err.message;
    else if (typeof parsed.message === "string") message = parsed.message;
    structured = true;
  } catch {
    // 非 JSON 正文原样截断
  }
  /* 把一整页 HTML（服务商官网的 404 页）原样截 300 字丢进错误里，只会让人对着模板标签猜。
     这个形状只有一个含义：这个 URL 后面根本没有 OpenAI 兼容 API。 */
  if (!structured && HTML_BODY.test(message)) {
    return clip(`HTTP ${status} this URL answered with an HTML page, not a JSON API — check the Base URL (or pick another provider)`);
  }
  return clip(`HTTP ${status}${message ? ` ${message}` : ""}`);
}
