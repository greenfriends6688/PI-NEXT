import { readFileSync } from "node:fs";

import { NextResponse } from "next/server";

import {
  IMAGEGEN_PRESET_IDS,
  describeHttpError,
  emptyImageGenStatus,
  ensureGeneratedImagesRootRegistered,
  generateImagesWithProfile,
  maskedImageGenConfig,
  profileIsConfigured,
  readImageGenConfig,
  saveGeneratedImageSync,
  writeImageGenConfig,
  writeImageGenStatus,
  type ImageGenConfig,
  type ImageGenPreset,
} from "@/lib/imagegen-config";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * GET /api/imagegen —— 设置页读配置（掩码视图：apiKey 有值就给掩码常量，明文不过网）。
 * PUT —— 整表替换；掩码值 = 「沿用已存密钥」（字段级合并见 writeImageGenConfig）。
 * POST —— 「测试」：真的用指定档位生成一张小图并落盘，状态落回配置文件。
 *         「看起来配好了」不算数——只有测试通过的档位才允许标书自动配图。
 */
export async function GET() {
  return NextResponse.json(maskedImageGenConfig(readImageGenConfig()));
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
    const providers = {} as ImageGenConfig["providers"];
    for (const preset of IMAGEGEN_PRESET_IDS) {
      const incoming = (rawProviders[preset] ?? {}) as Record<string, unknown>;
      // 未提交的档位原样保留（设置页只编辑展开的那一份）；apiKey 走掩码合并。
      providers[preset] = {
        ...current.providers[preset],
        ...(typeof incoming.baseUrl === "string" ? { baseUrl: incoming.baseUrl.trim() } : {}),
        ...(typeof incoming.apiKey === "string" ? { apiKey: incoming.apiKey } : {}),
        ...(typeof incoming.model === "string" ? { model: incoming.model.trim() } : {}),
        ...(typeof incoming.size === "string" && incoming.size.trim() ? { size: incoming.size.trim() } : {}),
        ...(typeof incoming.concurrency === "number" && Number.isFinite(incoming.concurrency)
          ? { concurrency: Math.min(4, Math.max(1, Math.floor(incoming.concurrency))) }
          : {}),
      };
    }
    const saved = writeImageGenConfig({ version: 3, active, providers });
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
    // 无 body / 非 JSON 也允许：默认测 active 档
  }

  const config = readImageGenConfig();
  const target = preset ?? config.active;
  const profile = config.providers[target];
  if (!profileIsConfigured(profile)) {
    return NextResponse.json(
      { error: "This profile needs a base URL, an API key and a model name before it can be tested." },
      { status: 409 },
    );
  }

  const root = ensureGeneratedImagesRootRegistered();
  const outcome = await generateImagesWithProfile(target, profile, { prompt: "a single small blue circle on a white background, minimal test image", size: profile.size }, {
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
