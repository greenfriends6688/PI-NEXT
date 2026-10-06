import { readFileSync } from "node:fs";

import { NextResponse } from "next/server";

import {
  IMAGEGEN_PRESET_IDS,
  type ImageGenPreset,
  describeHttpError,
  emptyImageGenStatus,
  ensureGeneratedImagesRootRegistered,
  generateImagesWithProfile,
  listModelsProviders,
  maskedImageGenConfig,
  readImageGenConfig,
  resolveImageGenProfile,
  saveGeneratedImageSync,
  writeImageGenConfig,
  writeImageGenStatus,
} from "@/lib/imagegen-config";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * GET /api/imagegen —— 设置页读配置（掩码视图：apiKey 有值就给掩码常量，明文不过网）。
 *        另带 `modelsProviders`（「设置 → 模型」里已配的服务商，供下拉引用）与
 *        `refError`（当前引用解析不出来时的原因）。
 * PUT —— 整表替换；掩码值 = 「沿用已存密钥」（字段级合并见 writeImageGenConfig）。
 * POST —— 「测试」：真的用当前配置生成一张小图并落盘，状态落回配置文件。
 *         「看起来配好了」不算数——只有测试通过的档案才允许标书自动配图。
 */
export async function GET() {
  const raw = readImageGenConfig();
  const activeProfile = raw.providers[raw.active];
  // 引用态解析不出来时把原因一并回给面板（引用已删的服务商是允许发生的后果）。
  const resolved = activeProfile?.providerId ? resolveImageGenProfile(activeProfile) : null;
  return NextResponse.json({
    ...maskedImageGenConfig(raw),
    modelsProviders: listModelsProviders(),
    refError: resolved && !resolved.ok ? resolved.error : null,
  });
}

function asPreset(value: unknown): ImageGenPreset | null {
  return typeof value === "string" && (IMAGEGEN_PRESET_IDS as readonly string[]).includes(value)
    ? value as ImageGenPreset
    : null;
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as { active?: unknown; providers?: unknown };
    const active = asPreset(body.active);
    if (!active) {
      return NextResponse.json({ error: "active must be a known provider id" }, { status: 400 });
    }
    if (!body.providers || typeof body.providers !== "object" || Array.isArray(body.providers)) {
      return NextResponse.json({ error: "providers must be an object" }, { status: 400 });
    }
    const current = readImageGenConfig();
    const rawProviders = body.providers as Record<string, unknown>;
    const providers = {} as typeof current.providers;
    for (const id of IMAGEGEN_PRESET_IDS) {
      const incoming = (rawProviders[id] ?? {}) as Record<string, unknown>;
      // 未提交的档案原样保留（设置页只编辑展开的那一份）；apiKey 走掩码合并。
      providers[id] = {
        ...current.providers[id],
        ...(typeof incoming.providerId === "string" ? { providerId: incoming.providerId.trim() } : {}),
        ...(typeof incoming.baseUrl === "string" ? { baseUrl: incoming.baseUrl.trim() } : {}),
        ...(typeof incoming.apiKey === "string" ? { apiKey: incoming.apiKey } : {}),
        ...(typeof incoming.model === "string" ? { model: incoming.model.trim() } : {}),
        ...(typeof incoming.size === "string" && incoming.size.trim() ? { size: incoming.size.trim() } : {}),
        ...(typeof incoming.concurrency === "number" && Number.isFinite(incoming.concurrency)
          ? { concurrency: Math.min(4, Math.max(1, Math.floor(incoming.concurrency))) }
          : {}),
      };
    }
    const saved = writeImageGenConfig({ version: 1, active, providers });
    return NextResponse.json(maskedImageGenConfig(saved));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let preset: ImageGenPreset | null = null;
  try {
    const body = await req.json() as { provider?: unknown };
    preset = asPreset(body.provider);
  } catch {
    // 无 body / 非 JSON 也允许：默认测 active 档案
  }

  const config = readImageGenConfig();
  const target = preset ?? config.active;
  // fork:imagegen-ref —— 端点与密钥从解析器出（引用态去 models.json 取），
  // 测试与 generate_image 工具走的是同一条路。
  const resolved = resolveImageGenProfile(config.providers[target]);
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: 409 });
  }
  const profile = resolved.profile;

  const root = ensureGeneratedImagesRootRegistered();
  const outcome = await generateImagesWithProfile(profile, { prompt: "a single small blue circle on a white background, minimal test image", n: 1, size: profile.size }, {
    saveImage: (data, mimeType) => saveGeneratedImageSync(root, data, mimeType),
  });

  const status = outcome.ok
    ? { state: "available" as const, testedAt: new Date().toISOString(), lastError: null, lastDurationMs: outcome.durationMs }
    : { ...emptyImageGenStatus(), state: "unavailable" as const, testedAt: new Date().toISOString(), lastError: outcome.error ?? "unknown error" };
  writeImageGenStatus(target, status);

  if (!outcome.ok) {
    return NextResponse.json(
      { ok: false, status, error: outcome.error ?? describeHttpError(502, "provider error") },
      { status: 502 },
    );
  }

  // 测试图以 data URL 回显（只此一张、只在这次响应里；会话文件与配置文件都不收 base64）。
  const first = outcome.images[0];
  const dataUrl = `data:${first.mimeType};base64,${readFileSync(first.path).toString("base64")}`;
  return NextResponse.json({
    ok: true,
    status,
    image: dataUrl,
    path: first.path,
    durationMs: outcome.durationMs,
  });
}
