import { NextResponse } from "next/server";
import { resolveModelDiscoveryAuth } from "@/lib/model-discovery-auth";
import { buildDiscoveryHeaders, buildModelsListUrl, parseDiscoveredModels } from "@/lib/model-discovery";
import { createModelRuntimeWithExtensions } from "@/lib/model-runtime";

export const dynamic = "force-dynamic";

const DISCOVERY_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as { providerName?: unknown; provider?: unknown };
    const providerName = typeof body.providerName === "string" ? body.providerName.trim() : "";
    if (!providerName) return NextResponse.json({ error: "providerName is required" }, { status: 400 });
    if (!isRecord(body.provider)) return NextResponse.json({ error: "provider is required" }, { status: 400 });

    const api = typeof body.provider.api === "string" && body.provider.api
      ? body.provider.api
      : "openai-completions";

    let baseUrl = typeof body.provider.baseUrl === "string" ? body.provider.baseUrl.trim() : "";
    // fork:discover-live-list — a **catalog-only** provider (opencode-go and friends) has
    // no `models.json` entry, so `baseUrl` was empty and "refresh models" failed with
    // "Base URL is required" — while the provider's own plan listed models the bundled
    // catalog had never heard of. (`space-bunny-free` is the user's example, and pi's
    // catalog genuinely does not contain it: /api/models/providers/opencode-go returns 30,
    // while the provider's own /v1/models returns 42.)
    //
    // pi's catalog carries `baseUrl` **per model**, so the provider's endpoint is one
    // lookup away and no hardcoded preset table is needed.
    //
    // One provider can publish several baseUrls for different wire protocols —
    // opencode-go is both `https://opencode.ai/zen/go` (anthropic-messages) and
    // `.../zen/go/v1` (openai-completions). Picking an arbitrary one built
    // `.../zen/go/models`, which is the marketing site: it answers 200 with HTML, so the
    // request has to be matched to the api style being probed.
    if (!baseUrl) {
      const runtime = await createModelRuntimeWithExtensions();
      const available = await runtime.getAvailable();
      const catalogModels = available.filter((model) => model.provider === providerName && model.baseUrl);
      baseUrl = (catalogModels.find((model) => model.api === api) ?? catalogModels[0])?.baseUrl ?? "";
    }
    if (!baseUrl) return NextResponse.json({ error: "Base URL is required" }, { status: 400 });

    let endpoint: URL;
    try {
      endpoint = buildModelsListUrl(baseUrl, api);
    } catch {
      return NextResponse.json({ error: "Base URL is invalid" }, { status: 400 });
    }

    const auth = await resolveModelDiscoveryAuth(providerName, body.provider);
    if (typeof body.provider.apiKey === "string" && body.provider.apiKey.trim() && !auth.apiKey) {
      return NextResponse.json({ error: `No API key found for "${providerName}"` }, { status: 400 });
    }

    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: buildDiscoveryHeaders(api, auth.apiKey, auth.headers),
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    const responseText = await response.text();
    if (!response.ok) {
      return NextResponse.json({
        error: responseText.slice(0, 500) || `Upstream returned HTTP ${response.status}`,
        status: response.status,
      }, { status: 502 });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      return NextResponse.json({ error: "Upstream model list was not valid JSON" }, { status: 502 });
    }
    const models = parseDiscoveredModels(payload);
    if (models.length === 0) {
      return NextResponse.json({ error: "No models found in the upstream response" }, { status: 502 });
    }

    return NextResponse.json({ models, endpoint: endpoint.toString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof DOMException && error.name === "TimeoutError" ? 504 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
