// Provider sign-in: the OAuth lists, the streaming OAuth handshake, manual
// codes, API keys, and logout.
//
// Every shape below is copied from pi-next 0.0.4's own routes
// (`重构/pi-next-0.0.4-source-2026-11-14`):
//
// - `GET /api/auth/providers` (`app/api/auth/providers/route.ts:9-14`) answers
//   `{ providers, oauthProviders, apiKeyProviders }`; the first two are the
//   same OAuth list. Rows are built by `lib/provider-listing.ts`:
//   an OAuth row's `loggedIn` is `credentialType === "oauth"` (`:113`), and an
//   API-key row's `configured` is `status.configured && credentialType !==
//   "oauth"` (`:89`), so a provider signed in with OAuth is deliberately
//   reported as not configured in the API-key list.
// - `GET /api/auth/login/[provider]` is an SSE stream whose frames have no
//   `event:` name: each is `data: {json}\n\n` (`login/[provider]/route.ts:53-55`).
//   The JSON `type`s and fields are the ones that file sends: `auth` (147-153),
//   `device_code` (155-160), `prompt_request` (136-141), `select_request`
//   (129-134), `progress` (163), `success` (170), `error` (174) and `cancelled`
//   (176).
// - `POST /api/auth/login/[provider]` takes `{ token, code }` (24-42); the
//   `token` is the one an `auth` / `prompt_request` / `select_request` event
//   carried, and `code` is the pasted callback URL, the typed code, or a
//   selection's option id.
// - `POST` / `DELETE /api/auth/api-key/[provider]` save `{ apiKey }` and remove
//   the stored key (`api-key/[provider]/route.ts:10-49`, 51-67).
// - `POST /api/auth/logout/[provider]` removes the OAuth credential
//   (`logout/[provider]/route.ts:7-22`).
//
// The SSE connection is `./sse`'s `openStream` (the server closes the stream
// when the handshake ends), not `EventSource`: it carries the endpoint and the
// LAN token the same way every other stream here does.

import {
  ApiError,
  postJson,
  req,
  RequestFailedError,
  segment,
  type RequestOptions,
} from "./client";
import { openStream, type OpenStreamOptions } from "./sse";

/** One OAuth row of `GET /api/auth/providers` (`lib/provider-listing.ts:53-60`). */
export interface OAuthProviderInfo {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
  /** The same provider also accepts an API key. */
  supportsApiKey: boolean;
}

/** One API-key row of `GET /api/auth/providers` (`lib/provider-listing.ts:43-51`). */
export interface ApiKeyProviderInfo {
  id: string;
  displayName: string;
  configured: boolean;
  /** Where a configured key comes from (`auth`, `env`, …); absent when none. */
  source?: string;
  modelCount: number;
  /** The same provider also offers OAuth. */
  supportsOAuth: boolean;
}

/** `GET /api/auth/providers` (`app/api/auth/providers/route.ts:14`). */
export interface AuthProvidersResponse {
  /** The OAuth list again, under the name the route has always used. */
  providers: OAuthProviderInfo[];
  oauthProviders: OAuthProviderInfo[];
  apiKeyProviders: ApiKeyProviderInfo[];
}

/** One choice of a `select_request` event (`AuthPrompt.options`). */
export interface AuthChoice {
  id: string;
  label: string;
}

/**
 * One decoded login-stream frame, exactly as
 * `app/api/auth/login/[provider]/route.ts:129-176` sends it.
 */
export type AuthLoginEvent =
  | {
    type: "auth";
    url: string;
    instructions: string | null;
    /** The token `POST /api/auth/login/[provider]` wants with the pasted code. */
    token: string;
  }
  | {
    type: "device_code";
    userCode: string;
    verificationUri: string;
    intervalSeconds: number | null;
    expiresInSeconds: number | null;
  }
  | {
    type: "prompt_request";
    message: string;
    placeholder: string | null;
    /** The token `POST /api/auth/login/[provider]` wants with the typed value. */
    token: string;
  }
  | {
    type: "select_request";
    message: string;
    options: AuthChoice[];
    /** The token `POST /api/auth/login/[provider]` wants with the option id. */
    token: string;
  }
  | { type: "progress"; message: string }
  | { type: "success" }
  | { type: "error"; message: string }
  | { type: "cancelled" };

/** `GET /api/auth/providers` — the OAuth and API-key lists. */
export function loadAuthProviders(
  options: RequestOptions = {},
): Promise<AuthProvidersResponse> {
  return req<AuthProvidersResponse>("/api/auth/providers", {}, options);
}

/** `GET /api/auth/login/<provider>` — the path `startOAuthLogin` opens. */
export function oauthLoginPath(provider: string): string {
  return `/api/auth/login/${segment(provider)}`;
}

/**
 * `GET /api/auth/login/<provider>` as SSE, decoded into `AuthLoginEvent`s.
 *
 * A reconnect would call `ModelRuntime.login()` again and start a second
 * handshake, so the stream is given a long stale window and a dropped
 * connection is reported (through `onError`) instead of retried: the caller
 * starts a new sign-in deliberately. Returns `close()`.
 */
export function startOAuthLogin(
  provider: string,
  onEvent: (event: AuthLoginEvent) => void,
  options: OpenStreamOptions = {},
): () => void {
  let stop: (() => void) | null = null;
  const close = openStream(oauthLoginPath(provider), (frame) => {
    const event = parseAuthLoginEvent(frame.data);
    if (event !== null) onEvent(event);
  }, {
    // An OAuth handshake can wait for a person: keep the watchdog far away.
    staleMs: 30 * 60 * 1000,
    ...options,
    onError: (error, info) => {
      options.onError?.(error, info);
      if (info.willRetry) stop?.();
    },
  });
  stop = close;
  return close;
}

/** `POST /api/auth/login/<provider>` — submit a pasted URL/code or an option id. */
export function submitOAuthCode(
  provider: string,
  token: string,
  code: string,
  options: RequestOptions = {},
): Promise<{ ok: true; provider: string }> {
  return postJson<{ ok: true; provider: string }>(
    oauthLoginPath(provider),
    { token, code },
    options,
  );
}

/** `POST /api/auth/api-key/<provider>` — save or replace the provider's key. */
export function saveApiKey(
  provider: string,
  apiKey: string,
  options: RequestOptions = {},
): Promise<{ success: true }> {
  return postJson<{ success: true }>(
    `/api/auth/api-key/${segment(provider)}`,
    { apiKey },
    options,
  );
}

/** `DELETE /api/auth/api-key/<provider>` — remove the stored API key. */
export function deleteApiKey(
  provider: string,
  options: RequestOptions = {},
): Promise<{ success: true }> {
  return req<{ success: true }>(
    `/api/auth/api-key/${segment(provider)}`,
    { method: "DELETE" },
    options,
  );
}

/** `POST /api/auth/logout/<provider>` — remove the stored OAuth credential. */
export function logoutOAuth(
  provider: string,
  options: RequestOptions = {},
): Promise<{ ok: true }> {
  return req<{ ok: true }>(
    `/api/auth/logout/${segment(provider)}`,
    { method: "POST" },
    options,
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function choices(value: unknown): AuthChoice[] {
  if (!Array.isArray(value)) return [];
  const result: AuthChoice[] = [];
  for (const item of value) {
    if (!record(item)) continue;
    const id = text(item.id);
    if (id === null || id === "") continue;
    result.push({ id, label: text(item.label) ?? id });
  }
  return result;
}

/**
 * One frame's data as an `AuthLoginEvent`, or `null` for a frame this route
 * never sends (a proxy's error page, an event added by a newer server).
 */
export function parseAuthLoginEvent(data: string): AuthLoginEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!record(parsed)) return null;

  switch (parsed.type) {
    case "auth": {
      const url = text(parsed.url);
      const token = text(parsed.token);
      if (url === null || token === null) return null;
      return { type: "auth", url, instructions: text(parsed.instructions), token };
    }
    case "device_code": {
      const userCode = text(parsed.userCode);
      const verificationUri = text(parsed.verificationUri);
      if (userCode === null || verificationUri === null) return null;
      return {
        type: "device_code",
        userCode,
        verificationUri,
        intervalSeconds: optionalNumber(parsed.intervalSeconds),
        expiresInSeconds: optionalNumber(parsed.expiresInSeconds),
      };
    }
    case "prompt_request": {
      const message = text(parsed.message);
      const token = text(parsed.token);
      if (message === null || token === null) return null;
      return {
        type: "prompt_request",
        message,
        placeholder: text(parsed.placeholder),
        token,
      };
    }
    case "select_request": {
      const message = text(parsed.message);
      const token = text(parsed.token);
      if (message === null || token === null) return null;
      return {
        type: "select_request",
        message,
        options: choices(parsed.options),
        token,
      };
    }
    case "progress": {
      const message = text(parsed.message);
      return message === null ? null : { type: "progress", message };
    }
    case "error": {
      const message = text(parsed.message);
      return message === null ? null : { type: "error", message };
    }
    case "success":
      return { type: "success" };
    case "cancelled":
      return { type: "cancelled" };
    default:
      return null;
  }
}

/** Route messages that are clearer said in the panel's own words. */
const MESSAGE_TEXT: Record<string, string> = {
  "token and code required": "Paste the callback address or the code first.",
  "No pending login for token": "This sign-in is no longer waiting. Start it again.",
  "Token does not match provider": "That code belongs to another provider's sign-in. Start it again.",
  "apiKey is required": "Enter an API key first.",
  "Login cancelled": "The sign-in was cancelled.",
};

/** The `reason` values an auth refusal can carry, when a server sends one. */
const REASON_TEXT: Record<string, string> = {
  "not-configured": "The provider is not configured on the server.",
  "unknown-provider": "The server does not offer this provider.",
  "oauth-credential": "This provider is signed in with OAuth, not an API key.",
  "api-key-credential": "This provider is signed in with an API key, not OAuth.",
};

function clean(message: string): string {
  return message.replace(/^Error:\s*/, "").trim();
}

/**
 * A login-stream `error` message, or a route's `error`, in words that say what
 * to do. An unknown message is kept as the server wrote it.
 */
export function authMessageText(message: string): string {
  const value = clean(message);
  const known = MESSAGE_TEXT[value];
  if (known !== undefined) return known;
  if (value.startsWith("Unknown provider:")) {
    const provider = value.slice("Unknown provider:".length).trim();
    return provider ? `The server does not offer ${provider}.` : "The server does not offer that provider.";
  }
  if (value.endsWith(" does not support API key login")) {
    return "This provider does not accept an API key.";
  }
  if (value.endsWith(" requires interactive authentication setup")) {
    return "This provider needs more than an API key. Set it up in the provider's console first.";
  }
  if (value.endsWith(" requires additional authentication settings")) {
    return "This provider needs more than an API key. Set it up in the provider's console first.";
  }
  if (value.endsWith(" is authenticated with OAuth, not an API key")) {
    return "This provider is signed in with OAuth. Sign out there before removing an API key.";
  }
  if (value.endsWith(" is authenticated with an API key, not OAuth")) {
    return "This provider is signed in with an API key. Remove the key before signing out of OAuth.";
  }
  if (value === "SSE: stream ended") {
    return "The sign-in stream closed before it finished. Start again.";
  }
  if (value === "SSE: response has no body" || value === "fetch failed") {
    return "The sign-in stream could not open. Check that the Pi server is running.";
  }
  if (value.startsWith("SSE ")) {
    return `The sign-in stream could not open (${value.slice(4)}).`;
  }
  return value || "The provider returned an empty error.";
}

/**
 * A failed auth request, for the panel: the route's `{ error, reason }` when
 * it sent one, else the transport's own words.
 */
export function authErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    const detail = typeof error.body.error === "string" ? error.body.error : "";
    const reason = typeof error.body.reason === "string" ? error.body.reason : "";
    const reasonText = reason ? (REASON_TEXT[reason] ?? reason) : "";
    if (detail) {
      const message = authMessageText(detail);
      return reasonText && !message.includes(reasonText) ? `${message} ${reasonText}` : message;
    }
    if (reasonText) return reasonText;
    return `The server answered HTTP ${error.status}.`;
  }
  if (error instanceof RequestFailedError) {
    return error.timedOut
      ? "The Pi server did not answer in time. Try again."
      : "Can't reach the Pi server. Check that it is running.";
  }
  if (error instanceof Error && error.message) return authMessageText(error.message);
  return String(error);
}
