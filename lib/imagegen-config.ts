/**
 * fork:imagegen —— 服务端那一半：`~/.pi/agent/imagegen.json` 的读写（0600 原子写）、
 * 掩码视图、生图落盘目录、生成的执行。
 *
 * 凭证边界与 im-bridge 同一条铁律：
 *   · 配置文件 0600（`writePrivateFileAtomicSync`，staging + rename）；
 *   · `GET /api/imagegen` 只回**掩码**后的密钥，明文不过网；
 *   · 写入时掩码值 = 「沿用已存密钥」，编辑其它字段不会把密钥清掉。
 *
 * 生图档案是**自带的、独立于对话模型**的一份：每个预设档（含自定义）各有端点、
 * 密钥、模型、默认尺寸与测试状态（`imagegen-shared.ts` 的预设表照抄参考项目）。
 *
 * 纯判断（类型 / 预设表 / 请求构造 / 响应解析）在 `imagegen-shared.ts`（客户端也要用）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { writePrivateFileAtomicSync } from "./atomic-file";
import { allowFileRoot } from "./allowed-roots";
import {
  IMAGEGEN_KEY_MASK,
  IMAGEGEN_PRESET_IDS,
  emptyImageGenStatus,
  imageGenPresetMeta,
  isMaskedImageGenKey,
  normalizeImageGenConfig,
  normalizeImageGenEntry,
  parseImagesResponse,
  buildImagesRequest,
  describeHttpError,
  IMAGEGEN_TIMEOUT_MS,
  type GenerateParams,
  type ImageGenConfig,
  type ImageGenPreset,
  type ImageGenProfile,
  type ImageGenProviderEntry,
  type ImageGenStatus,
} from "./imagegen-shared";

// 服务端只记一个 import 路径：从 `-shared` 再导出一份。
export {
  IMAGEGEN_AGNES_2_0_SIZES,
  IMAGEGEN_AGNES_2_1_SIZES,
  IMAGEGEN_AGNES_RATIOS,
  IMAGEGEN_DEFAULT_PRESET,
  IMAGEGEN_DEFAULT_SIZE,
  IMAGEGEN_KEY_MASK,
  IMAGEGEN_MAX_BATCH,
  IMAGEGEN_PRESETS,
  IMAGEGEN_PRESET_IDS,
  IMAGEGEN_TIMEOUT_MS,
  buildImagesRequest,
  describeHttpError,
  emptyImageGenStatus,
  imageGenPresetMeta,
  isMaskedImageGenKey,
  normalizeImageGenConfig,
  normalizeImageGenEntry,
  parseImagesResponse,
  profileIsConfigured,
  type GenerateParams,
  type ImageGenConfig,
  type ImageGenDialect,
  type ImageGenPreset,
  type ImageGenPresetMeta,
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
 * 写入。**掩码值 = 沿用已存密钥**：设置页拿不到明文，编辑 baseUrl / 模型时把掩码原样
 * 传回来，不能因此清掉密钥。显式空串才是「用户清掉了」。
 *
 * 另外把「换端点或换模型」的档位状态重置成未测试：上一次的「可用」是**那套配置**的
 * 结论，换掉之后它就是错的背书（标书自动配图只认「可用」，这条不能含糊）。
 */
export function writeImageGenConfig(
  config: ImageGenConfig,
  agentDir?: string,
): ImageGenConfig {
  const stored = readImageGenConfig(agentDir);
  const providers = {} as Record<ImageGenPreset, ImageGenProviderEntry>;
  for (const preset of IMAGEGEN_PRESET_IDS) {
    const incoming = config.providers?.[preset];
    const previous = stored.providers[preset];
    const apiKey = incoming
      ? (isMaskedImageGenKey(incoming.apiKey) ? previous.apiKey : incoming.apiKey ?? "")
      : previous.apiKey;
    const merged = normalizeImageGenEntry(preset, { ...previous, ...(incoming ?? {}), apiKey });
    const changed = merged.baseUrl !== previous.baseUrl || merged.model !== previous.model;
    // 换端点 / 换模型 → 上一次的「可用」不再成立；否则原样保留（含刚写进来的新状态）。
    providers[preset] = changed ? { ...merged, status: emptyImageGenStatus() } : merged;
  }
  const active = IMAGEGEN_PRESET_IDS.includes(config.active) ? config.active : "custom";
  const next: ImageGenConfig = { version: 3, active, providers };
  const path = imagegenConfigPath(agentDir);
  mkdirSync(dirname(path), { recursive: true });
  writePrivateFileAtomicSync(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** 生效档案：active 指向的那一档。 */
export function activeImageGenProfile(
  config: ImageGenConfig = readImageGenConfig(),
): { preset: ImageGenPreset; profile: ImageGenProviderEntry | undefined } {
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
    { version: 3, active: current.active, providers: { ...current.providers, [preset]: { ...current.providers[preset], status } } },
    agentDir,
  );
}

/** 设置页 / 工具的掩码视图：apiKey 有值就换成掩码常量。 */
export function maskedImageGenConfig(config: ImageGenConfig = readImageGenConfig()): ImageGenConfig {
  const providers = {} as Record<ImageGenPreset, ImageGenProviderEntry>;
  for (const preset of IMAGEGEN_PRESET_IDS) {
    const entry = config.providers[preset];
    providers[preset] = { ...entry, apiKey: entry.apiKey ? IMAGEGEN_KEY_MASK : "" };
  }
  return { version: 3, active: config.active, providers };
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
 * 跑一次生成并**全部落盘**。服务商回 `b64_json` / `inlineData` 就直接解码；回 `url`
 * 就当场下载——外链会过期，只有落盘的文件能进结果卡、标书正文和导出 Word。
 */
export async function generateImagesWithProfile(
  preset: ImageGenPreset,
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
  const request = buildImagesRequest(preset, profile, params);
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
    const parsed = parseImagesResponse(payload, preset);
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
        mimeType = image.mimeType ?? "image/png";
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

/** 生效档的预设元数据（工具报错文案里要写清是哪一档）。 */
export function activeImageGenPresetMeta(config: ImageGenConfig = readImageGenConfig()) {
  return imageGenPresetMeta(config.active);
}
