// Settings › Models without a server: the provider list, models.json and the
// provider usage panel, read from pi's own files.
//
// The three routes here used to be the last ones answering "no service":
//
//   GET  /api/auth/providers          the sign-in / API-key rows
//   GET  /api/models-config           models.json, parsed
//   PUT  /api/models-config           the whole file, as the editor holds it
//   GET  /api/models-config/catalog   models.dev presets (network)
//   POST /api/models-config/discover  one provider's upstream /models
//   POST /api/models-config/test      one short completion
//   POST /api/provider-usage/query    quotas
//
// The file routes are real. The network ones answer honestly with an empty
// result and a note in `message`, because this window has no SDK and no
// provider credentials of its own — pi owns those, and these panes are for
// configuring pi, not for spending its quota.
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import {
  describe,
  errorResponse,
  jsonResponse,
  piAgentDirectory,
  type LocalRequest,
  type LocalResponse,
} from "./request";

/** `~/.pi/agent/models.json`. */
function modelsFile(): string {
  return path.join(piAgentDirectory(), "models.json");
}

/** pi's cached provider catalogs, one entry per provider with its models. */
function modelsStoreFile(): string {
  return path.join(piAgentDirectory(), "models-store.json");
}

/** Provider credentials (`type` + `key`, or an OAuth record). */
function authFile(): string {
  return path.join(piAgentDirectory(), "auth.json");
}

/** JSON with comments and trailing commas, as `models.json` is hand-edited. */
function readJsonc(text: string): unknown {
  const stripped = text
    .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match, quoted?: string) => {
      if (quoted !== undefined) return quoted;
      return "";
    })
    .replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/g, (match, quoted?: string, tail?: string) => {
      if (quoted !== undefined) return quoted;
      return tail ?? "";
    });
  return JSON.parse(stripped.replace(/^\uFEFF/, ""));
}

async function readJsonFile(file: string): Promise<unknown> {
  try {
    const text = await readFile(file, "utf8");
    return text.trim() === "" ? null : readJsonc(text);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

interface ProviderSources {
  models: Record<string, unknown>;
  store: Record<string, unknown>;
  auth: Record<string, unknown>;
}

async function readSources(): Promise<ProviderSources> {
  const [modelsJson, storeJson, authJson] = await Promise.all([
    readJsonFile(modelsFile()),
    readJsonFile(modelsStoreFile()),
    readJsonFile(authFile()),
  ]);
  const providers = isRecord(modelsJson) && isRecord(modelsJson.providers) ? modelsJson.providers : {};
  return {
    models: providers,
    store: isRecord(storeJson) ? storeJson : {},
    auth: isRecord(authJson) ? authJson : {},
  };
}

/** Every provider id any of the three files knows, in a stable order. */
function providerIds(sources: ProviderSources): string[] {
  const ids = new Set<string>();
  for (const source of [sources.models, sources.store, sources.auth]) {
    for (const id of Object.keys(source)) ids.add(id);
  }
  return [...ids].sort((left, right) => left.localeCompare(right));
}

/** How many models pi caches for `provider`. */
function modelCount(sources: ProviderSources, provider: string): number {
  const entry = sources.store[provider];
  const models = isRecord(entry) ? entry.models : undefined;
  if (Array.isArray(models)) return models.length;
  const configured = sources.models[provider];
  const own = isRecord(configured) ? configured.models : undefined;
  return Array.isArray(own) ? own.length : 0;
}

/**
 * Whether the provider has something to authenticate with: a key in
 * `auth.json`, a literal/`$ENV`/`!command` API key in models.json, or an OAuth
 * record.
 */
function credential(sources: ProviderSources, provider: string): "oauth" | "key" | "none" {
  const entry = sources.auth[provider];
  if (isRecord(entry)) {
    if (entry.type === "oauth" || typeof entry.refresh === "string") return "oauth";
    if (typeof entry.key === "string" && entry.key !== "") return "key";
  }
  const configured = sources.models[provider];
  if (isRecord(configured) && typeof configured.apiKey === "string" && configured.apiKey !== "") return "key";
  if (isRecord(configured) && configured.oauth !== undefined) return "oauth";
  return "none";
}

function providerName(sources: ProviderSources, provider: string): string {
  const configured = sources.models[provider];
  if (isRecord(configured) && typeof configured.name === "string" && configured.name !== "") return configured.name;
  return provider;
}

/** `GET /api/auth/providers` (`app/api/auth/providers/route.ts`). */
async function authProviders(): Promise<LocalResponse> {
  const sources = await readSources();
  const oauthProviders = providerIds(sources)
    .filter((provider) => credential(sources, provider) === "oauth")
    .map((provider) => ({
      id: provider,
      name: providerName(sources, provider),
      usesCallbackServer: false,
      loggedIn: true,
      supportsApiKey: true,
    }));
  const apiKeyProviders = providerIds(sources).map((provider) => {
    const how = credential(sources, provider);
    return {
      id: provider,
      displayName: providerName(sources, provider),
      configured: how !== "none",
      ...(how === "none" ? {} : { source: how === "oauth" ? "auth" : "auth" }),
      modelCount: modelCount(sources, provider),
      supportsOAuth: oauthProviders.some((row) => row.id === provider),
    };
  });
  return jsonResponse({ providers: oauthProviders, oauthProviders, apiKeyProviders });
}

/** `GET /api/models-config` — the parsed file the editor drafts from. */
async function readModelsConfig(): Promise<LocalResponse> {
  const parsed = await readJsonFile(modelsFile());
  if (parsed === null) return jsonResponse({ providers: {} });
  return jsonResponse(parsed);
}

/** `PUT /api/models-config` — writes the whole file, formatted for a person. */
async function writeModelsConfig(request: LocalRequest): Promise<LocalResponse> {
  let body: unknown;
  try {
    body = JSON.parse(request.body ?? "null");
  } catch (cause) {
    return errorResponse(describe(cause), 400);
  }
  if (!isRecord(body)) return errorResponse("The body must be a models.json object", 400);
  const file = modelsFile();
  try {
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = path.join(path.dirname(file), `.models-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    await writeFile(temporary, `${JSON.stringify(body, null, 2)}\n`);
    await rename(temporary, file);
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
  return jsonResponse({ success: true });
}

/** The catalog the editor searches: models.dev, which this window never fetches. */
function catalogResponse(): LocalResponse {
  return jsonResponse({
    models: [],
    recommendation: { model: null, price: null, contextWindow: null },
    source: "https://models.dev/api.json",
    message: "这个构建不联网获取模型目录；模型和价格请直接写进 models.json。",
  });
}

function discoverResponse(): LocalResponse {
  return jsonResponse({
    models: [],
    url: "",
    message: "这个构建不向 provider 发请求；请直接写进 models.json。",
  });
}

function testResponse(): LocalResponse {
  return jsonResponse({
    ok: false,
    error: "这个构建不发送测试请求：用 pi 自己的一次会话验证即可。",
  });
}

/** Provider quotas need the provider's own API and credentials; say so quietly. */
function usageResponse(request: LocalRequest): LocalResponse {
  let providerId = "";
  try {
    const body = JSON.parse(request.body ?? "null") as { providerId?: unknown };
    if (isRecord(body) && typeof body.providerId === "string") providerId = body.providerId;
  } catch {
    // No body: the pane sends one provider at a time.
  }
  return jsonResponse({
    providerId,
    status: "auth-unavailable",
    message: "这个构建不查询额度：用量在这里没有凭据。",
  });
}

export async function handleModelSettings(request: LocalRequest): Promise<LocalResponse | null> {
  const segments = request.segments;
  if (segments[0] !== "api") return null;

  if (segments[1] === "auth" && segments[2] === "providers" && segments.length === 3) {
    return request.method === "GET" ? authProviders() : null;
  }

  if (segments[1] === "provider-usage" && segments[2] === "query" && segments.length === 3) {
    return request.method === "POST" ? usageResponse(request) : null;
  }

  if (segments[1] !== "models-config") return null;

  if (segments.length === 2) {
    if (request.method === "GET") return readModelsConfig();
    if (request.method === "PUT") return writeModelsConfig(request);
    return null;
  }

  if (segments[2] === "catalog" && segments.length === 3 && request.method === "GET") return catalogResponse();
  if (segments[2] === "discover" && segments.length === 3 && request.method === "POST") return discoverResponse();
  if (segments[2] === "test" && segments.length === 3 && request.method === "POST") return testResponse();
  return null;
}
