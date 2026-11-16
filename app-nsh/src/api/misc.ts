// The remaining routes: a session's HTML export and its generated title, the
// cache-miss notice switch, provider quota queries, and the app's update
// check.
//
// Shapes are copied from the routes (pi-next 0.0.4):
//
//   GET  /api/sessions/[id]/export?inline=1    HTML (`:119-166`)
//   POST /api/sessions/[id]/auto-name          { title, usage } (`:7-45`)
//   GET/PUT /api/cache-miss-notices            { enabled } (`:25-67`)
//   POST /api/provider-usage/query             `ProviderUsageResult` (`:9-29`)
//   GET  /api/app-update                       `AppUpdateResponse` (`:63-86`)
//
// The export is HTML, not JSON, so it is the one request that reads
// `response.text()` itself instead of going through `client.req` (whose
// success path parses JSON). It still uses the same base, LAN token, timeout
// and `ApiError` shape. `inline=1` only changes Content-Disposition to
// `inline`; the body is the same file either way.

import fs from "fs/promises";
import path from "path";
import process from "process";
import { api, ApiError, req, RequestFailedError, segment, withQuery, withToken, type RequestOptions } from "./client";

/** `AppUpdateResponse` (`lib/api-types.ts:814-819`). */
export interface AppUpdateResponse {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  /** Empty when the version is not a stable `x.y.z`. */
  releaseUrl: string;
}

/** `POST /api/sessions/[id]/auto-name` (`app/api/sessions/[id]/auto-name/route.ts:36-43`). */
export interface AutoNameResponse {
  title: string;
  /** The model call's token usage, when the server reported it. */
  usage?: unknown;
}

/** `GET` / `PUT /api/cache-miss-notices` (`app/api/cache-miss-notices/route.ts:25-31, 42-67`). */
export interface CacheMissNoticesResponse {
  enabled: boolean;
}

/**
 * `POST /api/sessions/[id]/auto-name`: asks the server to generate and store
 * a title (it sets the live session's name and invalidates the list cache).
 * A 409 means the session closed while its title was being generated.
 */
export function autoNameSession(
  sessionId: string,
  options: RequestOptions = {},
): Promise<AutoNameResponse> {
  return req<AutoNameResponse>(
    `/api/sessions/${segment(sessionId)}/auto-name`,
    { method: "POST" },
    options,
  );
}

/** `GET /api/cache-miss-notices`: pi's `showCacheMissNotices` (off by default). */
export function loadCacheMissNotices(options: RequestOptions = {}): Promise<CacheMissNoticesResponse> {
  return req<CacheMissNoticesResponse>("/api/cache-miss-notices", {}, options);
}

/** `PUT /api/cache-miss-notices { enabled }`; answers the stored value. */
export function saveCacheMissNotices(
  enabled: boolean,
  options: RequestOptions = {},
): Promise<CacheMissNoticesResponse> {
  return req<CacheMissNoticesResponse>(
    "/api/cache-miss-notices",
    { method: "PUT", body: JSON.stringify({ enabled }) },
    options,
  );
}

/** `GET /api/app-update`; a 502 carries `{ error }` as an `ApiError`. */
export function loadAppUpdate(options: RequestOptions = {}): Promise<AppUpdateResponse> {
  return req<AppUpdateResponse>("/api/app-update", {}, options);
}

// --- provider usage --------------------------------------------------------
//
// `app/api/provider-usage/query/route.ts:9-29` answers one of:
//   { providerId, status: "ready", report }
//   { providerId, status: "auth-unavailable" | "query-failed", message }
// The ids are `lib/provider-usage-ids.ts`.

export const PROVIDER_USAGE_IDS = [
  "openai-codex",
  "deepseek",
  "openrouter",
  "moonshotai",
  "moonshotai-cn",
  "minimax",
  "minimax-cn",
  "vercel-ai-gateway",
  "opencode-go",
  "kimi-coding",
] as const;

export type ProviderUsageId = (typeof PROVIDER_USAGE_IDS)[number];

export function isProviderUsageId(value: string): value is ProviderUsageId {
  return (PROVIDER_USAGE_IDS as readonly string[]).includes(value);
}

export type UsageUnit = "percent" | "currency" | "count";

/** One quota window (`lib/provider-usage.ts:9-21`). */
export interface UsageBucket {
  id: string;
  label: string;
  groupLabel?: string;
  used?: number;
  remaining?: number;
  limit?: number;
  unit: UsageUnit;
  currency?: string;
  windowMinutes?: number;
  /** Unix seconds. */
  resetsAt?: number;
  period?: string;
}

/** One balance or status line (`lib/provider-usage.ts:23-29`). */
export interface UsageMetric {
  id: string;
  label: string;
  value: number | string;
  unit?: UsageUnit;
  currency?: string;
}

/** `UsageReport` (`lib/provider-usage.ts:31-39`). */
export interface UsageReport {
  providerId: ProviderUsageId;
  providerName: string;
  /** Unix milliseconds. */
  capturedAt: number;
  buckets: UsageBucket[];
  metrics: UsageMetric[];
  notes?: string[];
}

/** `ProviderUsageResult` (`lib/provider-usage.ts:41-44`). */
export type ProviderUsageResult =
  | { providerId: ProviderUsageId; status: "ready"; report: UsageReport }
  | { providerId: ProviderUsageId; status: "auth-unavailable" | "query-failed"; message: string };

/** `POST /api/provider-usage/query { providerId }`. */
export function queryProviderUsage(
  providerId: ProviderUsageId,
  options: RequestOptions = {},
): Promise<ProviderUsageResult> {
  return req<ProviderUsageResult>(
    "/api/provider-usage/query",
    { method: "POST", body: JSON.stringify({ providerId }) },
    { timeoutMs: 30_000, ...options },
  );
}

// --- session export --------------------------------------------------------
//
// The export can be several megabytes. `fs.writeFile` in NSH accepts at most
// 8 MiB, so a very large transcript may preview but not save; the caller gets
// the write's error and still has the HTML for the preview.

/** The HTML the export route answered, before it is written anywhere. */
export interface SessionExport {
  html: string;
  /** The route's `Content-Disposition` filename, or a session-id fallback. */
  fileName: string;
}

/** A filename safe for one path segment on every platform. */
function safeFileName(name: string, fallback: string): string {
  const base = name.split(/[\\/]/).pop()?.replace(/[<>:"|?*\u0000-\u001f]/g, "_").trim();
  return base && base !== "." && base !== ".." ? base : fallback;
}

/** `filename*=UTF-8''…` first (what the route writes for a non-ASCII id), else `filename="…"`. */
function fileNameFromDisposition(disposition: string | null, fallback: string): string {
  if (disposition) {
    const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(disposition);
    if (encoded?.[1]) {
      try {
        return safeFileName(decodeURIComponent(encoded[1].trim()), fallback);
      } catch {
        // A malformed % escape: try the plain name below.
      }
    }
    const plain = /filename\s*=\s*"([^"]+)"/i.exec(disposition) ?? /filename\s*=\s*([^;]+)/i.exec(disposition);
    if (plain?.[1]) return safeFileName(plain[1].trim(), fallback);
  }
  return fallback;
}

function parseErrorBody(text: string): { error?: string; [key: string]: unknown } {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as { error?: string; [key: string]: unknown };
    }
  } catch {
    // Not JSON: the text itself is the explanation.
  }
  return text ? { error: text } : {};
}

/**
 * `GET /api/sessions/[id]/export?inline=1` as text. A non-2xx answer is an
 * `ApiError` carrying the route's `{ error }`; a request that never answered
 * (or timed out) is a `RequestFailedError`.
 */
export async function fetchSessionExport(
  sessionId: string,
  options: RequestOptions = {},
): Promise<SessionExport> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  const caller = options.signal;
  const forwardAbort = () => controller.abort();
  if (caller) {
    if (caller.aborted) controller.abort();
    else caller.addEventListener("abort", forwardAbort);
  }

  const requestPath = withQuery(`/api/sessions/${segment(sessionId)}/export`, { inline: 1 });
  const url = withToken(
    options.base ?? api.base(),
    requestPath,
    options.token !== undefined ? options.token : api.token(),
  );
  const fallbackName = `pi-session-${sessionId.replace(/[^a-zA-Z0-9._-]/g, "_") || "session"}.html`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "text/html" },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new ApiError({
        status: response.status,
        statusText: response.statusText,
        body: parseErrorBody(text),
      });
    }
    return {
      html: text,
      fileName: fileNameFromDisposition(response.headers.get("Content-Disposition"), fallbackName),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) {
      throw new RequestFailedError(`Request timed out after ${timeoutMs} ms: ${requestPath}`, error, true);
    }
    if (caller?.aborted) throw new RequestFailedError("Request aborted", error, false);
    throw new RequestFailedError(`Request failed: ${requestPath}`, error, false);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    caller?.removeEventListener("abort", forwardAbort);
  }
}

/**
 * Writes the export under the app's own data directory:
 * `<dataDir>/downloads/<route filename>`. NSH grants only `${dataDir}` to
 * `fs`, and `openUrl` refuses `file:` URLs, so the system's Downloads folder
 * is not reachable from JS
 * (`nsh-main/docs/dev/sandbox.md` "The system's file dialogs and file
 * manager ... are Rust's only").
 *
 * TODO(nsh): ask the host for a save dialog / reveal-in-file-manager once
 * those have a JS face, and then save where the person chooses.
 *
 * Returns the absolute path, or null when this host has no data directory.
 */
export async function saveSessionExport(exported: SessionExport): Promise<string | null> {
  const dataDir = process.dataDir;
  if (!dataDir) return null;
  const directory = path.join(dataDir, "downloads");
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, safeFileName(exported.fileName, "session.html"));
  await fs.writeFile(target, exported.html);
  return target;
}
