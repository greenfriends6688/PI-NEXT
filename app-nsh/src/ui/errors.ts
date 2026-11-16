// A failure in words a person can act on: the one place between an exception
// and the screen.
//
// Every request goes through `api/client.ts`, so a failure arrives as one of
// two shapes: `ApiError` (the route answered non-2xx and its `{ error, reason,
// code }` body is kept) or `RequestFailedError` (nothing answered: a timeout,
// a refused connection, an abort). Shown with `String(error)` they read as
// `RequestFailedError: Request failed: /api/...` — the "many errors" of the
// reports — so this module maps both to the app's own sentences.
//
// The copy lives in `src/i18n/messages/*.ts` (the three locales pi-next ships).
// `uiText` uses the first of the user's preferred languages those files have,
// so a phone set to Chinese gets Chinese here even while the rest of the shell
// is still English (the screens are not wired to `src/i18n` yet).
import { localeSettings, untracked } from "nsh";
import { ApiError, CWD_MISSING_REASON, RequestFailedError, api } from "../api/client";
import { translateMessage } from "../i18n/format";
import { locale } from "./i18n";
import { getLocalePlugin, getSupportedLocales, resolveBrowserLocale } from "../i18n/registry";
import type { Locale, TranslationParams } from "../i18n/types";

const MESSAGES: Record<string, Record<string, string>> = Object.fromEntries(
  getSupportedLocales().flatMap((id) => {
    const plugin = getLocalePlugin(id);
    return plugin ? [[id, plugin.messages]] : [];
  }),
);

/** The language of these texts: the user's choice, the same signal the UI reads. */
export function errorLocale(): Locale {
  return locale();
}

/**
 * A message from `src/i18n/messages/*.ts`, in the user's language.
 * A missing key comes back as the key itself (`translateMessage`).
 */
export function uiText(key: string, params: TranslationParams = {}): string {
  return translateMessage(errorLocale(), key, MESSAGES, params);
}

/** The server this app talks to, for the "can't reach it" line. */
function endpoint(): string {
  return untracked(() => api.base());
}

/** A server message with a wrapper ("Error: …") removed. */
function clean(message: string): string {
  return message.replace(/^\s*(?:Error:\s*)+/, "").trim();
}

/**
 * The route's own words for a known refusal. These are the messages the three
 * entry routes (and the ones the screens read most) answer with; a message the
 * table does not know falls through to its status.
 */
const SERVER_MESSAGE_KEYS: Record<string, string> = {
  "Session not found": "errors.notFound",
  "Assistant message not found": "i18n.thinkingUnavailable",
  "Thinking block not found": "i18n.thinkingUnavailable",
  "Invalid thinking response": "i18n.thinkingUnavailable",
  "Tool result not found": "errors.toolResultUnavailable",
  "Tool result image not found": "errors.imageUnavailable",
  "Unsupported image type": "errors.unsupported",
  "Invalid or oversized image data": "errors.imageInvalid",
  "Valid blockIndex is required": "errors.badRequest",
  "path required": "errors.badRequest",
  "invalid path": "errors.badRequest",
  "invalid url": "errors.badRequest",
  forbidden: "errors.forbidden",
  "full output unavailable": "errors.outputUnavailable",
};

/** The `{ reason }` codes the routes add to a refusal (`lib/missing-cwd.ts`, settings routes). */
const REASON_KEYS: Record<string, string> = {
  [CWD_MISSING_REASON]: "errors.missingCwd",
  not_found: "errors.notFound",
  "not-found": "errors.notFound",
  "too-large": "errors.tooLarge",
  "request-denied": "errors.rejected",
  "project-scope": "errors.projectScope",
  "project-untrusted": "errors.projectUntrusted",
};

/** The size a 413 names (`{ data: { size, maxBytes } }` in the bash-output route). */
function sizeOf(error: ApiError): number | undefined {
  const data = error.body.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  const size = (data as Record<string, unknown>).size;
  return typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : undefined;
}

/** A byte count as a line reads it: 512 B, 48 KB, 5.0 MB. */
function bytesText(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${Math.round(size)} B`;
}

/** A route's `error` when it reads as a sentence; a stack or a raw exception is not shown. */
function readableDetail(error: ApiError): string | null {
  const detail = clean(typeof error.body.error === "string" ? error.body.error : "");
  if (detail === "" || detail.length > 200) return null;
  if (detail.includes("\n") || /\bat\s+[^\s]+\s*:\d+:\d+/.test(detail)) return null;
  if (/^(?:TypeError|ReferenceError|RangeError|SyntaxError):/.test(detail)) return null;
  return detail;
}

/** An `ApiError` as a sentence: reason first, then the route's message, then the status. */
function apiErrorText(error: ApiError): string {
  const detail = clean(typeof error.body.error === "string" ? error.body.error : "");
  const reason = error.reason ?? "";
  const size = sizeOf(error);

  if (reason === CWD_MISSING_REASON) {
    return uiText("errors.missingCwd", { cwd: error.missingCwd ?? detail });
  }
  if (error.status === 401) return uiText("errors.unauthorized");
  if (error.status === 403) return uiText("errors.forbidden");
  if (error.promptRejected) return uiText("errors.promptRejected");

  const messageKey = SERVER_MESSAGE_KEYS[detail];
  if (messageKey) {
    return uiText(messageKey, size === undefined ? {} : { size: bytesText(size) });
  }
  // `Full output is too large to display (limit 5242880 bytes)` names the
  // limit; the answer also carries the file's own size.
  if (error.status === 413 && /too large/i.test(detail)) {
    return size === undefined
      ? uiText("errors.tooLarge")
      : uiText("errors.outputTooLarge", { size: bytesText(size) });
  }

  const reasonKey = REASON_KEYS[reason];
  if (reasonKey) {
    return uiText(reasonKey, reason === CWD_MISSING_REASON ? { cwd: error.missingCwd ?? detail } : {});
  }

  if (error.status === 404) return uiText("errors.notFound");
  if (error.status === 413) return uiText("errors.tooLarge");
  if (error.status === 415) return uiText("errors.unsupported");
  if (error.status >= 500) return uiText("errors.server", { status: error.status });

  return readableDetail(error) ?? (error.status === 400 ? uiText("errors.badRequest") : uiText("errors.rejected"));
}

/** The error and its causes, as one string: `fetch` wraps the network error. */
function failureChain(cause: unknown): string {
  const parts: string[] = [];
  let current: unknown = cause;
  for (let depth = 0; depth < 4 && current !== undefined && current !== null; depth++) {
    if (current instanceof Error) {
      parts.push(current.name, current.message);
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(" ");
}

/**
 * A request that never got an answer: a timeout, an abort, or a transport
 * error. A refused connection (the API says "Failed to fetch", Node says
 * `ECONNREFUSED`) gets the line that says what to start.
 */
function requestFailedText(error: RequestFailedError): string {
  if (error.timedOut) return uiText("errors.timeout");
  if (/abort/i.test(error.message)) return uiText("errors.cancelled");
  const chain = failureChain(error.cause);
  if (
    /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|connection refused|failed to fetch|load failed|networkerror|network error|fetch failed|net::ERR/i
      .test(chain)
  ) {
    return uiText("errors.unreachable", { endpoint: endpoint() });
  }
  return uiText("errors.network", { endpoint: endpoint() });
}

/**
 * One failure as a readable line. `ApiError` keeps the route's reason and
 * message; `RequestFailedError` says whether the server timed out or could not
 * be reached; any other exception keeps its own message (cleaned) so an app's
 * own rule ("No session is open") still reads as itself.
 */
export function errorText(cause: unknown): string {
  if (cause instanceof ApiError) return apiErrorText(cause);
  if (cause instanceof RequestFailedError) return requestFailedText(cause);
  if (cause instanceof Error) {
    if (cause.name === "AbortError") return uiText("errors.cancelled");
    const message = clean(cause.message);
    if (/ERR_ACCESS_DENIED/.test(message)) return uiText("errors.forbidden");
    return message || uiText("errors.unknown");
  }
  const text = clean(cause === null || cause === undefined ? "" : String(cause));
  return text || uiText("errors.unknown");
}
