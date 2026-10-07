import { NextResponse } from "next/server";

import { describeSearchFailures, searchWeb } from "@/lib/websearch";
import {
  maskedWebSearchSettings,
  readWebSearchSettings,
  writeWebSearchSettings,
  type WebSearchSettings,
} from "@/lib/websearch-settings";
import { WEB_SEARCH_PROVIDERS, WEB_SEARCH_PROVIDER_IDS, isWebSearchProviderId } from "@/lib/websearch/types";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * fork:websearch —— 「设置 → 联网搜索」的读写与测试。
 *
 * GET  —— 掩码视图（`searxngToken` 只回掩码）+ provider 清单（设置页的下拉与文案）。
 * PUT  —— 部分更新；掩码值 = 沿用已存 token（与 im-bridge / 生图同一条铁律）。
 * POST —— 「测试」：用**当前设置**真跑一条查询，返回结果与逐档失败原因。
 *         测试不看 `enabled`（它就是用来验通道的），但工具本身关着时会拒绝出网。
 */
export async function GET() {
  const settings = readWebSearchSettings();
  return NextResponse.json({
    ...maskedWebSearchSettings(settings),
    providers: WEB_SEARCH_PROVIDER_IDS.map((id) => WEB_SEARCH_PROVIDERS[id]),
  });
}

function readPatch(value: unknown): Partial<WebSearchSettings> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const patch: Partial<WebSearchSettings> = {};
  if (typeof raw.enabled === "boolean") patch.enabled = raw.enabled;
  if (isWebSearchProviderId(raw.provider)) patch.provider = raw.provider;
  if (typeof raw.fallbackToPublic === "boolean") patch.fallbackToPublic = raw.fallbackToPublic;
  if (typeof raw.timeoutSeconds === "number" && Number.isFinite(raw.timeoutSeconds)) patch.timeoutSeconds = raw.timeoutSeconds;
  if (typeof raw.searxngEndpoint === "string") patch.searxngEndpoint = raw.searxngEndpoint;
  if (typeof raw.searxngToken === "string") patch.searxngToken = raw.searxngToken;
  if (typeof raw.searxngLanguage === "string") patch.searxngLanguage = raw.searxngLanguage;
  if (typeof raw.allowPrivateEndpoint === "boolean") patch.allowPrivateEndpoint = raw.allowPrivateEndpoint;
  return patch;
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = await req.json() as { settings?: unknown };
    const patch = readPatch(body.settings);
    if (!patch) return NextResponse.json({ error: "settings must be an object" }, { status: 400 });
    const saved = writeWebSearchSettings(patch);
    return NextResponse.json({ ...maskedWebSearchSettings(saved), providers: WEB_SEARCH_PROVIDER_IDS.map((id) => WEB_SEARCH_PROVIDERS[id]) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = await req.json().catch(() => ({})) as { query?: unknown };
    const query = typeof body.query === "string" && body.query.trim() ? body.query.trim() : "pi coding agent";
    const response = await searchWeb(query, { settings: readWebSearchSettings(), count: 5 });
    return NextResponse.json({
      ok: response.results.length > 0,
      query,
      provider: response.provider,
      results: response.results,
      failures: response.failures,
      durationMs: response.durationMs,
      ...(response.results.length === 0 ? { error: describeSearchFailures(response.failures) || "no results" } : {}),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}
