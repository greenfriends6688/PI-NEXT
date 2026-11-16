// `/api/models-config*`: the models.json editor's wire format.
//
// The file's schema is pi-coding-agent's `ModelsConfigSchema`
// (`dist/core/model-config.js`, built from `ProviderConfigSchema`,
// `ModelDefinitionSchema` and `ModelOverrideSchema`), which the server reads
// through `lib/models-config-store.ts` and writes after
// `lib/model-context.ts` / `lib/model-provider-check.ts` /
// `lib/model-image-limits.ts` have checked it. Provider keys are free-form ids;
// every other shape below is copied from that schema, not invented.
//
// GET and PUT are `app/api/models-config/route.ts`. GET answers the parsed file
// (`{ providers }`, plus `$schema` and any keys the file carries) and 422 when
// the file cannot be read. PUT takes the whole file, normalizes cost groups and
// context-window overrides, refuses a provider pi cannot load, and answers
// `{ success: true }` or `{ error }` with 400 (a provider rule), 409 (the file
// changed under the draft) or 422 (an unreadable file).
//
// `/api/models-config/catalog` is `app/api/models-config/catalog/route.ts`:
// models.dev's catalog flattened by `lib/model-catalog.ts`, searched with
// `q`, `provider`, `baseUrl` and `limit` (1..100), plus a recommendation for
// the exact model id the query names.
//
// `/api/models-config/discover` (`discover/route.ts`) asks one provider's
// upstream `/models` endpoint and returns `lib/model-discovery.ts`'s
// `DiscoveredModel[]` and the URL it used. `/api/models-config/test`
// (`test/route.ts`) writes a one-model temporary models.json, resolves the
// credential and sends one short completion: `{ ok, latencyMs, status,
// responseText }`, or `{ ok: false, error }` (sometimes with HTTP 200 for an
// upstream error, so `ok` is the answer, not the status).

import { req, withQuery, type RequestOptions } from "./client";

/** One model's rates: USD per million tokens (`ModelCostSchema`). */
export interface ModelsJsonModelCost {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** Request-wide pricing tiers (`ModelCostTierSchema[]`), preserved as they are. */
  tiers?: unknown[];
}

/** A `providers.<id>.models[]` entry (`ModelDefinitionSchema`). */
export interface ModelsJsonModel {
  /** Required, at least one character. */
  id: string;
  name?: string;
  /** Overrides the provider's protocol. */
  api?: string;
  /** Overrides the provider's Base URL. */
  baseUrl?: string;
  reasoning?: boolean;
  /** The provider value sent for each thinking level; `null` marks it unsupported. */
  thinkingLevelMap?: Record<string, string | null>;
  /** `text`, `image` (default `["text"]`). */
  input?: string[];
  /** `maxRequestBytes` and `images.{resize,maxPerMessage,maxPerRequest}`. */
  inputLimits?: Record<string, unknown>;
  cost?: ModelsJsonModelCost;
  /** Context window in tokens; positive. Defaults to 128000. */
  contextWindow?: number;
  /** Maximum output tokens; positive. Defaults to 16384. */
  maxTokens?: number;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
}

/** One `providers.<id>` entry (`ProviderConfigSchema`). */
export interface ModelsJsonProvider {
  /** Display name pi's selector can show. The key is the provider id. */
  name?: string;
  /** API base URL, also applied to the provider's built-in models. */
  baseUrl?: string;
  /** Literal key, `$ENV_NAME` interpolation, or `!command` output. */
  apiKey?: string;
  /** Protocol for the provider's models. */
  api?: string;
  /** pi ships one OAuth flow in models.json: Radius. Requires `baseUrl`. */
  oauth?: "radius";
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  /** Send the resolved API key as `Authorization: Bearer`. */
  authHeader?: boolean;
  models?: ModelsJsonModel[];
  /** Context/model overrides for a built-in provider's models. */
  modelOverrides?: Record<string, Record<string, unknown>>;
}

/** The whole file. `providers` is the only key PUT needs; anything else is kept. */
export interface ModelsJsonConfig {
  $schema?: string;
  providers?: Record<string, ModelsJsonProvider>;
  [key: string]: unknown;
}

/** `GET /api/models-config` — the parsed models.json. */
export function loadModelsConfig(options: RequestOptions = {}): Promise<ModelsJsonConfig> {
  return req<ModelsJsonConfig>("/api/models-config", {}, options);
}

/**
 * `PUT /api/models-config` — writes the whole file. A non-2xx answer keeps the
 * route's `{ error }` (an empty provider stub, `oauth` without a Base URL, a
 * context override pi refuses, an unreadable file) in `ApiError.body.error`.
 */
export function saveModelsConfig(
  config: ModelsJsonConfig,
  options: RequestOptions = {},
): Promise<{ success: true }> {
  return req<{ success: true }>(
    "/api/models-config",
    { method: "PUT", body: JSON.stringify(config) },
    options,
  );
}

/** One catalog row (`lib/model-catalog.ts:9-24`). */
export interface ModelCatalogEntry {
  /** `providerId/id`. */
  key: string;
  providerId: string;
  providerName: string;
  providerBaseUrl?: string;
  id: string;
  name: string;
  reasoning?: boolean;
  /** The input modalities models.dev advertises, limited to `text` / `image`. */
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost: ModelsJsonModelCost;
}

/** A complete per-million-token price (`price.cost` when the price is reliable). */
export interface ModelCatalogFullCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** The exact-model price verdict (`lib/model-catalog.ts:30-47`). */
export type ModelCatalogPriceRecommendation =
  | {
      status: "reliable";
      method: "provider" | "base-url" | "consensus";
      cost: ModelCatalogFullCost;
      providerId?: string;
      providerName?: string;
      support: number;
      total: number;
    }
  | {
      status: "unreliable";
      reason: "no-exact-match" | "no-valid-price" | "insufficient-support" | "conflict";
      support: number;
      total: number;
    };

/** What `recommendModelCatalogPreset()` answered for the exact id. */
export interface ModelCatalogRecommendation {
  exactMatches: number;
  metadataMethod: "provider" | "base-url" | "consensus" | "none";
  matchedProviderId?: string;
  matchedProviderName?: string;
  preset: {
    name?: string;
    reasoning?: boolean;
    input?: string[];
    contextWindow?: number;
    maxTokens?: number;
    cost?: ModelCatalogFullCost;
  };
  price: ModelCatalogPriceRecommendation;
}

/** `GET /api/models-config/catalog` (`catalog/route.ts:59-75`). */
export interface ModelCatalogResponse {
  models: ModelCatalogEntry[];
  recommendation: ModelCatalogRecommendation;
  /** `https://models.dev/api.json`. */
  source: string;
}

/** The catalog's query (`catalog/route.ts:54-57`): `q`, `provider` and
 * `baseUrl` are cut to 120 / 120 / 500 characters, `limit` to 1..100 (default 50). */
export interface ModelCatalogQuery {
  q?: string;
  provider?: string;
  baseUrl?: string;
  limit?: number;
}

/**
 * `GET /api/models-config/catalog?q=&provider=&baseUrl=&limit=`. The catalog
 * comes from models.dev, cached for an hour on the server; 502 when the
 * download fails and the cache is empty.
 */
export function loadModelCatalog(
  query: ModelCatalogQuery = {},
  options: RequestOptions = {},
): Promise<ModelCatalogResponse> {
  return req<ModelCatalogResponse>(
    withQuery("/api/models-config/catalog", {
      q: query.q,
      provider: query.provider,
      baseUrl: query.baseUrl,
      limit: query.limit,
    }),
    {},
    { timeoutMs: 30_000, ...options },
  );
}

/** One model the upstream `/models` list advertised (`lib/model-discovery.ts:3-12`). */
export interface DiscoveredModel {
  id: string;
  name?: string;
  reasoning?: true;
  thinkingLevelMap?: Record<string, string | null>;
  contextWindow?: number;
  maxTokens?: number;
}

/** `POST /api/models-config/discover` (`discover/route.ts:50-110`). */
export interface ModelDiscoveryResponse {
  models: DiscoveredModel[];
  /** The URL the route called (its own `/models` path, with protocol-specific query). */
  endpoint: string;
}

/**
 * `POST /api/models-config/discover` with `{ providerName, provider }`. The
 * route builds the upstream URL from the provider's Base URL and protocol
 * (`lib/model-discovery.ts`'s `buildModelsListUrl`), resolves the credential
 * like pi does, and asks for the model list. It fails with 400 for a missing
 * Base URL/name and 502/504 for an upstream failure.
 */
export function discoverProviderModels(
  providerName: string,
  provider: ModelsJsonProvider,
  options: RequestOptions = {},
): Promise<ModelDiscoveryResponse> {
  // The route replaces `models` with its own placeholder; sending hundreds of
  // existing entries only makes the request bigger.
  const requestProvider = { ...provider };
  delete requestProvider.models;
  return req<ModelDiscoveryResponse>(
    "/api/models-config/discover",
    { method: "POST", body: JSON.stringify({ providerName, provider: requestProvider }) },
    { timeoutMs: 30_000, ...options },
  );
}

/** `POST /api/models-config/test` (`test/route.ts:33-149`). */
export interface ModelTestResult {
  /** `false` is a failed test even when the HTTP status is 200 (an aborted/errored completion). */
  ok: boolean;
  latencyMs?: number;
  /** The upstream HTTP status when the completion got a response. */
  status?: number;
  /** At most 300 characters of the assistant's text. */
  responseText?: string;
  error?: string;
}

/**
 * `POST /api/models-config/test` with `{ providerName, provider, model }`.
 * The route writes a temporary models.json with only this model, resolves the
 * provider's credential, and sends one `"Reply with OK only."` completion
 * (16 output tokens, 20 s). A model without an id or a provider without a key
 * comes back as `ok: false`; transport/route failures throw `ApiError`.
 */
export function testProviderModel(
  providerName: string,
  provider: ModelsJsonProvider,
  model: ModelsJsonModel,
  options: RequestOptions = {},
): Promise<ModelTestResult> {
  const requestProvider = { ...provider };
  delete requestProvider.models;
  return req<ModelTestResult>(
    "/api/models-config/test",
    { method: "POST", body: JSON.stringify({ providerName, provider: requestProvider, model }) },
    { timeoutMs: 45_000, ...options },
  );
}
