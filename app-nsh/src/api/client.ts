// The API client: one `req()`, and the one place the app reaches the agent.
//
// In a packaged app the agent is the app's own process and the transport is the
// pipe to it (`link.ts`); there is no address and no port. `fetch` here is
// `agentFetch`, which keeps the `fetch(url, init) -> Response` shape, so every
// `src/api/*` module and every screen is unchanged by that.
//
// Two things still vary per install and stay in signals: the base (the browser
// build's origin, a dev run's endpoint) and the LAN token, which travels as
// `?t=` because a native fetch has no cookie jar and an SSE request cannot set a
// header in a browser (`lib/lan-access.ts:16-18`).
//
// `sse.ts` stays pure (no imports) so its frame parser can be unit-tested under
// plain Node; `client.ts` installs both the target and the transport in it.

import { platform, signal, UrlScheme } from "nsh";
import { setStreamFetch, setStreamTarget, withToken } from "./sse";
import { agentFetch } from "./link";

/** The server this app talks to, plus the LAN token when one is set. */
export const api = {
  /**
   * Where the server is. A native app starts on `pi-web`'s default headless
   * port (a desktop launch replaces it with the printed URL); a web build is
   * served by a pi server, so it talks to its own origin, read from the page.
   */
  base: signal<string>(webOrigin()),
  token: signal<string | null>(null),
};

// The SSE module resolves its own URL through these, so `openStream(path)`
// needs no arguments beyond the path — and reads the same pipe `req()` uses.
setStreamTarget(() => ({ base: api.base(), token: api.token() }));
setStreamFetch(agentFetch);

export { withToken };

/**
 * The web build's own origin (`https://pi.example`), from the page's address;
 * a native app has no page and keeps the shell's default. Read once, at load:
 * `UrlScheme.url()` is the page's address on the web.
 */
function webOrigin(): string {
  if (platform.os !== "web") return "http://127.0.0.1:30142";
  try {
    const address = UrlScheme.url();
    return address ? new URL(address).origin : "";
  } catch {
    return "";
  }
}

/** Points the client at another server (a spawned `pi-web`, or a paired phone's desktop). */
export function setEndpoint(base: string, token: string | null = null): void {
  api.base.set(base.replace(/\/+$/, ""));
  api.token.set(token);
}

/** The `reason` a session's folder no longer exists (`lib/missing-cwd.ts:6`). */
export const CWD_MISSING_REASON = "cwd-missing";

/** The refusal code `POST /api/agent/*` adds to a prompt it never accepted (`app/api/agent/[id]/route.ts:66-72`). */
export const PROMPT_REJECTED_CODE = "prompt_rejected";

/**
 * The error body routes answer with. Every route's shape, since each writes
 * `{ error }` and a few add fields: `reason`/`cwd` for a missing folder
 * (`lib/missing-cwd.ts:24-36`), `code`/`accepted` for a rejected prompt, and
 * `reason: "cwd-missing"` inside the agent wrapper's thrown error
 * (`app/api/agent/[id]/route.ts:63-72`).
 */
export interface ApiErrorBody {
  error?: string;
  /** `"cwd-missing"` when the session's folder was moved or renamed. */
  reason?: string;
  /** The folder named by a `cwd-missing` body. */
  cwd?: string;
  /** `"prompt_rejected"` when a prompt never reached the model. */
  code?: string;
  accepted?: boolean;
  [key: string]: unknown;
}

export interface ApiErrorInit {
  status: number;
  statusText?: string;
  body: ApiErrorBody;
}

/** A non-2xx answer, with the body the server wrote kept verbatim. */
export class ApiError extends Error {
  /** The HTTP status; 0 when the request never got a response (timeout, network). */
  readonly status: number;
  readonly statusText: string;
  readonly body: ApiErrorBody;
  /** `body.code`, e.g. `"prompt_rejected"`. */
  readonly code: string | undefined;
  /** `body.reason`, e.g. `"cwd-missing"`. */
  readonly reason: string | undefined;

  constructor(init: ApiErrorInit) {
    const message = typeof init.body.error === "string" && init.body.error
      ? init.body.error
      : `HTTP ${init.status}${init.statusText ? ` ${init.statusText}` : ""}`;
    super(message);
    this.name = "ApiError";
    this.status = init.status;
    this.statusText = init.statusText ?? "";
    this.body = init.body;
    this.code = typeof init.body.code === "string" ? init.body.code : undefined;
    this.reason = typeof init.body.reason === "string" ? init.body.reason : undefined;
  }

  /** The folder a `cwd-missing` refusal names, else `undefined` (`lib/missing-cwd.ts:29-34`). */
  get missingCwd(): string | undefined {
    return this.reason === CWD_MISSING_REASON && typeof this.body.cwd === "string" && this.body.cwd
      ? this.body.cwd
      : undefined;
  }

  /** True for a prompt the server refused outright: nothing was queued, so the text can go back. */
  get promptRejected(): boolean {
    return this.code === PROMPT_REJECTED_CODE && this.body.accepted === false;
  }
}

/** A request that never reached the server (timeout, DNS, refused connection). */
export class RequestFailedError extends Error {
  readonly cause: unknown;
  readonly timedOut: boolean;

  constructor(message: string, cause: unknown, timedOut: boolean) {
    super(message);
    this.name = "RequestFailedError";
    this.cause = cause;
    this.timedOut = timedOut;
  }
}

/** Plan §5.1's default: JSON reads are small; the SSE watchdog covers long-lived ones. */
export const DEFAULT_TIMEOUT_MS = 15_000;

export interface RequestOptions {
  /** Default 15 s. `0` disables the timeout (a blocking call such as a compaction). */
  timeoutMs?: number;
  /** Override the client's endpoint for this call. */
  base?: string;
  /** Override the client's token for this call (`null` sends none). */
  token?: string | null;
  /** Caller's cancellation; aborts the request like the timeout does. */
  signal?: AbortSignal;
}

/** Body of a response as JSON when it is JSON, as text when it is not, `undefined` when empty. */
async function readBody(response: Response): Promise<ApiErrorBody | undefined> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as ApiErrorBody)
      : { error: text };
  } catch {
    return { error: text };
  }
}

/**
 * One request against the pi server. Answers the parsed JSON body (`T`), or
 * throws `ApiError` for a non-2xx answer (body kept, `missingCwd` /
 * `promptRejected` read from it) and `RequestFailedError` when the request
 * never got an answer.
 */
export async function req<T>(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  // The caller's signal and the timeout both abort our controller; `nsh`'s
  // AbortSignal has no `AbortSignal.any`, so the forwarding is explicit.
  const caller = options.signal ?? init.signal ?? undefined;
  const forwardAbort = () => controller.abort();
  if (caller) {
    if (caller.aborted) controller.abort();
    else caller.addEventListener("abort", forwardAbort);
  }

  const headers = new Headers(init.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  // Only a JSON string body: a FormData body must keep the boundary the
  // runtime writes for it (a wrong JSON type breaks the file upload).
  if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const url = withToken(
    options.base ?? api.base(),
    path,
    options.token !== undefined ? options.token : api.token(),
  );

  try {
    const response = await agentFetch(url, { ...init, headers, signal: controller.signal });
    const body = await readBody(response);
    if (!response.ok) {
      throw new ApiError({
        status: response.status,
        statusText: response.statusText,
        body: body ?? { error: `HTTP ${response.status}` },
      });
    }
    // An empty 2xx (a `DELETE` answering `{ ok: true }` has a body; some do not).
    return (body ?? undefined) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) throw new RequestFailedError(`Request timed out after ${timeoutMs} ms: ${path}`, error, true);
    if (caller?.aborted) throw new RequestFailedError("Request aborted", error, false);
    throw new RequestFailedError(`Request failed: ${path}`, error, false);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    caller?.removeEventListener("abort", forwardAbort);
  }
}

/** `req` for a JSON body: stringifies and sets the content type. */
export function postJson<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  return req<T>(path, { method: "POST", body: JSON.stringify(body) }, options);
}

/** `path` with `query` appended (`undefined`/`null`/`""` entries dropped). */
export function withQuery(path: string, query: Record<string, string | number | boolean | null | undefined>): string {
  const parts: string[] = [];
  for (const key of Object.keys(query)) {
    const value = query[key];
    if (value === undefined || value === null || value === "") continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  if (parts.length === 0) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${parts.join("&")}`;
}

/** `encodeURIComponent` for one path segment (a session id). */
export function segment(value: string): string {
  return encodeURIComponent(value);
}
