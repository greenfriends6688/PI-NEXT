/**
 * fork:imagegen —— 服务端那一半：`~/.pi/agent/imagegen.json` 的读写（0600 原子写）、
 * 掩码视图、生图落盘目录。
 *
 * 凭证边界与 im-bridge 同一条铁律：
 *   · 配置文件 0600（`writePrivateFileAtomicSync`，staging + rename）；
 *   · `GET /api/imagegen` 只回**掩码**后的密钥，明文不过网；
 *   · 写入时掩码值 = 「沿用已存密钥」，编辑其它字段不会把密钥清掉。
 *
 * 纯判断（类型 / 归一化 / 请求构造 / 响应解析）在 `imagegen-shared.ts`（客户端也要用）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { writePrivateFileAtomicSync } from "./atomic-file";
import { allowFileRoot } from "./allowed-roots";
import { readModelsConfig } from "./models-config-store";
import {
  IMAGEGEN_TIMEOUT_MS,
  buildImagesRequest,
  describeHttpError,
  parseImagesResponse,
  type GenerateParams,
} from "./imagegen-shared";
import {
  IMAGEGEN_KEY_MASK,
  IMAGEGEN_PRESET_IDS,
  isMaskedImageGenKey,
  normalizeImageGenConfig,
  profileIsConfigured,
  type ImageGenConfig,
  type ImageGenPreset,
  type ImageGenProfile,
  type ImageGenProviderEntry,
  type ImageGenStatus,
} from "./imagegen-shared";

// 服务端只记一个 import 路径：从 `-shared` 再导出一份。
export {
  IMAGEGEN_DEFAULT_SIZE,
  IMAGEGEN_KEY_MASK,
  IMAGEGEN_MAX_BATCH,
  IMAGEGEN_PRESET_ENDPOINTS,
  IMAGEGEN_PRESET_IDS,
  IMAGEGEN_PRESET_LABELS,
  IMAGEGEN_PRESET_MODELS,
  IMAGEGEN_TIMEOUT_MS,
  buildImagesRequest,
  describeHttpError,
  emptyImageGenStatus,
  isMaskedImageGenKey,
  normalizeImageGenConfig,
  parseImagesResponse,
  profileIsConfigured,
  type GenerateParams,
  type ImageGenConfig,
  type ImageGenPreset,
  type ImageGenProfile,
  type ImageGenProviderEntry,
  type ImageGenStatus,
  type ImageGenStatusState,
  type ParsedImageOutput,
  type ParsedImagesResponse,
} from "./imagegen-shared";

function imagegenConfigPath(agentDir?: string): string {
  return join(agentDir ?? getAgentDir(), "imagegen.json");
}

export function readImageGenConfig(agentDir?: string): ImageGenConfig {
  const path = imagegenConfigPath(agentDir);
  if (!existsSync(path)) return normalizeImageGenConfig(null);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // 解析失败不回显文件内容（含密钥），也不改它——下次保存会整体覆盖。
    return normalizeImageGenConfig(null);
  }
  return normalizeImageGenConfig(parsed);
}

/**
 * 写入。**掩码值 = 沿用已存密钥**：设置页拿不到明文，编辑 baseUrl 时把掩码原样
 * 传回来，不能因此清掉密钥。显式空串才是「用户清掉了」。
 */
export function writeImageGenConfig(
  config: ImageGenConfig,
  agentDir?: string,
): ImageGenConfig {
  const stored = readImageGenConfig(agentDir);
  const providers = {} as ImageGenConfig["providers"];
  for (const id of IMAGEGEN_PRESET_IDS) {
    const incoming = config.providers[id];
    const previous = stored.providers[id];
    // 显式空串 = 用户改回了「独立档」；缺字段（老客户端）= 沿用已存值。
    const providerId = incoming?.providerId ?? previous.providerId ?? "";
    const apiKey = isMaskedImageGenKey(incoming?.apiKey)
      ? previous.apiKey
      : (incoming?.apiKey ?? "");
    providers[id] = providerId
      // fork:imagegen-ref —— 引用态**绝不落盘端点与密钥**：它们属于 models.json，
      // 复制一份就是这次要消掉的那个重复（也正是「轮换不生效」的根因）。
      ? { ...previous, ...incoming, providerId, baseUrl: "", apiKey: "" }
      : { ...previous, ...incoming, providerId: "", apiKey };
  }
  const merged: ImageGenConfig = { version: 1, active: config.active, providers };
  const path = imagegenConfigPath(agentDir);
  mkdirSync(dirname(path), { recursive: true });
  writePrivateFileAtomicSync(path, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}

/** 生效档案：active 指向的那一份。 */
export function activeImageGenProfile(
  config: ImageGenConfig = readImageGenConfig(),
): { preset: ImageGenPreset; profile: ImageGenProfile | undefined } {
  return { preset: config.active, profile: config.providers[config.active] };
}

/** 只把 status 落回去（测试路由用），不动其它字段。 */
export function writeImageGenStatus(
  preset: ImageGenPreset,
  status: ImageGenStatus,
  agentDir?: string,
): ImageGenConfig {
  const current = readImageGenConfig(agentDir);
  return writeImageGenConfig(
    { version: 1, active: current.active, providers: { ...current.providers, [preset]: { ...current.providers[preset], status } } },
    agentDir,
  );
}

/** 设置页 / 工具的掩码视图：apiKey 有值就换成掩码常量。 */
export function maskedImageGenConfig(config: ImageGenConfig = readImageGenConfig()): ImageGenConfig {
  const providers = {} as ImageGenConfig["providers"];
  for (const id of IMAGEGEN_PRESET_IDS) {
    const profile = config.providers[id];
    // 引用态：端点是**派生**出来的（只为显示），密钥同样只回掩码。存盘里两项恒为空。
    const resolved = profile.providerId ? resolveImageGenProfile(profile) : null;
    const effective: ImageGenProviderEntry = resolved?.ok ? { ...profile, ...resolved.profile } : profile;
    providers[id] = { ...effective, apiKey: effective.apiKey ? IMAGEGEN_KEY_MASK : "" };
  }
  return { version: 1, active: config.active, providers };
}

// ── 「设置 → 模型」里的服务商（引用来源） ────────────────────────────────────────

/**
 * fork:imagegen-ref（2026-10-06 用户裁定）—— 端点与密钥**引用**「设置 → 模型」里
 * 已经配好的那一份，而不是让用户重填一遍。
 *
 * 为什么不直接拿那个服务商去生图：pi-ai 的 `KnownImageApi` 只有一个成员
 * `openrouter-images`（内置 57 个生图模型全走它，openai 的 image 模型数是 0），
 * 而且 models.json 里的 `type: "image"` 会被当成 chat 模型收下（实测
 * `getModelsOfType("image")` 返回空）。所以请求仍然由本模块直发，**能复用的就是
 * 端点与密钥这两项**，它们在同一份 models.json 里本来就有。
 */
export interface ModelsProviderRef {
  id: string;
  name: string;
  baseUrl: string;
  /** 只报「有没有」，明文绝不出现在任何响应里。 */
  hasKey: boolean;
}

function modelsProviderRecord(id: string, modelsPath?: string): Record<string, unknown> | null {
  let config: Record<string, unknown>;
  try {
    config = readModelsConfig(modelsPath);
  } catch {
    // models.json 坏了：与「找不到这个服务商」同一处置（fail closed）。
    return null;
  }
  const providers = config.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return null;
  const entry = (providers as Record<string, unknown>)[id];
  return entry && typeof entry === "object" && !Array.isArray(entry)
    ? entry as Record<string, unknown>
    : null;
}

/** 给设置页下拉用的服务商清单（不含密钥）。 */
export function listModelsProviders(modelsPath?: string): ModelsProviderRef[] {
  let config: Record<string, unknown>;
  try {
    config = readModelsConfig(modelsPath);
  } catch {
    return [];
  }
  const providers = config.providers;
  if (!providers || typeof providers !== "object" || Array.isArray(providers)) return [];
  return Object.entries(providers as Record<string, unknown>).flatMap(([id, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const entry = raw as Record<string, unknown>;
    return [{
      id,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : id,
      baseUrl: typeof entry.baseUrl === "string" ? entry.baseUrl.trim() : "",
      hasKey: typeof entry.apiKey === "string" && entry.apiKey.trim().length > 0,
    }];
  });
}

export type ResolvedImageGenProfile =
  | { ok: true; profile: ImageGenProfile }
  | { ok: false; error: string };

/**
 * 把档案解析成「真的能发请求」的一份：引用态在这里取端点与密钥。
 *
 * 工具、测试路由、设置页三处走的是**同一个**解析器 —— 谁都不许自己拼 baseUrl，
 * 否则「引用」会在某一处悄悄退化成复制。解析不出来就 fail closed，绝不用空密钥发请求。
 */
export function resolveImageGenProfile(
  profile: ImageGenProfile | undefined,
  modelsPath?: string,
): ResolvedImageGenProfile {
  if (!profile) return { ok: false, error: "No image-generation profile is selected" };
  if (!profile.providerId) {
    return profileIsConfigured(profile)
      ? { ok: true, profile }
      : { ok: false, error: "This profile needs a base URL, an API key and a model name" };
  }
  const entry = modelsProviderRecord(profile.providerId, modelsPath);
  if (!entry) {
    return {
      ok: false,
      error: `The referenced provider "${profile.providerId}" is no longer in Settings → Models. Pick another one there, or pick a built-in preset here.`,
    };
  }
  const baseUrl = typeof entry.baseUrl === "string" ? entry.baseUrl.trim() : "";
  const apiKey = typeof entry.apiKey === "string" ? entry.apiKey.trim() : "";
  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      error: `The provider "${profile.providerId}" in Settings → Models has no base URL or API key yet`,
    };
  }
  const resolved: ImageGenProfile = { ...profile, baseUrl, apiKey };
  return profileIsConfigured(resolved)
    ? { ok: true, profile: resolved }
    : { ok: false, error: `The provider "${profile.providerId}" is referenced, but this profile still needs a model name` };
}

// ── 生成图片的落盘 ───────────────────────────────────────────────────────────

/**
 * 默认落盘根：`~/.pi/agent/generated-images/`。独立于项目目录——对话里随手生成的图
 * 不该污染仓库；`dest` 参数（标书配图）才写进项目内。
 */
export function generatedImagesRoot(agentDir?: string): string {
  return join(agentDir ?? getAgentDir(), "generated-images");
}

let generatedRootRegistered = false;

/**
 * 把落盘根登记进 `/api/files` 的允许清单（结果卡与 markdown 预览都走它）。
 * 幂等：进程内第一次调用生效，之后是 Set.add 的空转。允许清单是进程级的，
 * 重启后由工具工厂 / 路由第一次使用时重新登记。
 */
export function ensureGeneratedImagesRootRegistered(agentDir?: string): string {
  const root = generatedImagesRoot(agentDir);
  if (!generatedRootRegistered) {
    allowFileRoot(root);
    generatedRootRegistered = true;
  }
  return root;
}

/** 时间分桶（YYYYMMDD）+ UUID 文件名；扩展名按服务商回的 mime 定。 */
export function newGeneratedImagePath(root: string, now: Date, mimeType: string): string {
  const bucket = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const ext = mimeType.includes("jpeg") || mimeType.includes("jpg")
    ? "jpg"
    : mimeType.includes("webp")
      ? "webp"
      : "png";
  const uuid = crypto.randomUUID();
  return join(root, bucket, `${uuid}.${ext}`);
}

export function saveGeneratedImageSync(
  root: string,
  data: Buffer,
  mimeType: string,
  now: Date = new Date(),
): string {
  const path = newGeneratedImagePath(root, now, mimeType);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data, { mode: 0o600 });
  return path;
}

// ── 生成的执行（测试路由与 generate_image 工具共用） ─────────────────────────

export interface GeneratedImageFile {
  /** 落盘绝对路径（模型可读、`/api/files` 可预览）。 */
  path: string;
  mimeType: string;
  bytes: number;
}

export interface GenerateOutcome {
  ok: boolean;
  /** 失败原因（HTTP 状态 + 服务商正文，截断后）；成功时为 null。 */
  error: string | null;
  images: GeneratedImageFile[];
  revisedPrompts: string[];
  durationMs: number;
}

function mimeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return match?.[1] ?? "image/png";
}

function mimeFromUrlPath(url: string): string {
  const path = url.split("?")[0];
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.webp$/i.test(path)) return "image/webp";
  return "image/png";
}

/**
 * 跑一次生成并**全部落盘**。服务商回 `b64_json` 就直接解码；回 `url` 就当场下载——
 * 外链会过期，只有落盘的文件能进结果卡、标书正文和导出 Word。
 */
export async function generateImagesWithProfile(
  profile: ImageGenProfile,
  params: GenerateParams,
  options: {
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    saveImage: (data: Buffer, mimeType: string) => string;
    timeoutMs?: number;
  },
): Promise<GenerateOutcome> {
  const startedAt = Date.now();
  const request = buildImagesRequest(profile, params);
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? IMAGEGEN_TIMEOUT_MS;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    const bodyText = await response.text().catch(() => "");
    if (!response.ok) {
      return { ok: false, error: describeHttpError(response.status, bodyText), images: [], revisedPrompts: [], durationMs: Date.now() - startedAt };
    }
    let payload: unknown;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      return { ok: false, error: `HTTP ${response.status} responded with non-JSON body`, images: [], revisedPrompts: [], durationMs: Date.now() - startedAt };
    }
    const parsed = parseImagesResponse(payload);
    if (parsed.error) {
      return { ok: false, error: parsed.error, images: [], revisedPrompts: [], durationMs: Date.now() - startedAt };
    }
    if (parsed.images.length === 0) {
      return { ok: false, error: "Provider returned no images", images: [], revisedPrompts: [], durationMs: Date.now() - startedAt };
    }

    const images: GeneratedImageFile[] = [];
    const revisedPrompts: string[] = [];
    for (const image of parsed.images) {
      let buffer: Buffer;
      let mimeType: string;
      if (image.b64) {
        buffer = Buffer.from(image.b64, "base64");
        mimeType = "image/png";
      } else if (image.url?.startsWith("data:")) {
        const base64 = image.url.slice(image.url.indexOf(",") + 1);
        buffer = Buffer.from(base64, "base64");
        mimeType = mimeFromDataUrl(image.url);
      } else if (image.url) {
        const fileResponse = await doFetch(image.url, { signal: controller.signal });
        if (!fileResponse.ok) {
          return { ok: false, error: `Downloading generated image failed: HTTP ${fileResponse.status}`, images: [], revisedPrompts: [], durationMs: Date.now() - startedAt };
        }
        buffer = Buffer.from(await fileResponse.arrayBuffer());
        mimeType = fileResponse.headers.get("content-type")?.split(";")[0] || mimeFromUrlPath(image.url);
      } else {
        continue;
      }
      images.push({
        path: options.saveImage(buffer, mimeType),
        mimeType,
        bytes: buffer.byteLength,
      });
      if (image.revisedPrompt) revisedPrompts.push(image.revisedPrompt);
    }
    if (images.length === 0) {
      return { ok: false, error: "Provider returned no usable images", images: [], revisedPrompts: [], durationMs: Date.now() - startedAt };
    }
    return { ok: true, error: null, images, revisedPrompts, durationMs: Date.now() - startedAt };
  } catch (error) {
    const reason = options.signal?.aborted
      ? "cancelled by the caller"
      : controller.signal.aborted
        ? `timed out after ${timeoutMs}ms`
        : error instanceof Error ? error.message : String(error);
    return { ok: false, error: reason, images: [], revisedPrompts: [], durationMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

/** 会话内相对路径 → 绝对路径；越出 cwd 一律拒绝（标书 `dest` 的护栏）。 */
export function resolveDestWithinCwd(cwd: string, dest: string): string | null {
  if (!cwd || !dest.trim()) return null;
  const target = isAbsolute(dest) ? dest : resolve(cwd, dest);
  const normalizedRoot = resolve(cwd);
  const normalizedTarget = resolve(target);
  if (normalizedTarget === normalizedRoot) return normalizedRoot;
  if (normalizedTarget.startsWith(normalizedRoot + sep)) return normalizedTarget;
  return null;
}
