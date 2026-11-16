// Server-sent events over `fetch` (`getReader`), no `EventSource`.
//
// This module is deliberately **pure**: it imports nothing, not even `nsh`.
// The server's SSE never needs `signal()`, and keeping the import list empty
// is what lets `node --experimental-strip-types --test sse.test.mjs` run the
// frame parser and the connection loop outside the app runtime. The endpoint
// and token reach it through `setStreamTarget()` — `client.ts` installs the
// accessors over its `api.base` / `api.token` signals at module load.
//
// Server facts this follows (pi-next 0.0.4):
// - agent stream: `data: {...}\n\n`, `{\"type\":\"heartbeat\"}` every 30 s
//   (`lib/agent-event-wire.ts:13`), one `:\n\n` comment first
//   (`lib/agent-event-stream.ts` `enqueueText(":\n\n")`);
// - terminal stream: `id: <offset>\ndata: {...}\n\n` and reads the cursor from
//   the `last-event-id` header or `?after=`
//   (`app/api/terminal/[id]/events/route.ts:12-16`).

/** Where `openStream(path)` sends its request. */
export interface StreamTarget {
  base: string;
  token?: string | null;
}

/** One decoded frame. `data` is the frame's data lines joined with `\n`. */
export interface SseFrame {
  event?: string;
  data: string;
  id?: string;
  /** The server's `retry:` millisecond hint; this client keeps its own backoff. */
  retry?: number;
}

/** What one `parseFrames()` call produced: whole frames plus the unterminated tail. */
export interface ParseFramesResult {
  frames: SseFrame[];
  rest: string;
}

/** One delivered event: a frame with data. Comment-only frames never get here. */
export interface SseEvent {
  event?: string;
  data: string;
  id?: string;
}

export interface StreamErrorInfo {
  attempt: number;
  willRetry: boolean;
  delayMs?: number;
  status?: number;
}

export interface OpenStreamOptions {
  /** Override the installed target (`client.ts` installs `api.base` / `api.token`). */
  base?: string;
  token?: string | null;
  /** Extra request headers; `Last-Event-ID` is added here when a cursor is known. */
  headers?: Record<string, string>;
  /** Silence (no byte at all) after which the connection is treated as dead. */
  staleMs?: number;
  /** Backoff floor and ceiling: 1 s → 10 s with jitter. */
  minRetryMs?: number;
  maxRetryMs?: number;
  /** Closes the stream when it aborts. */
  signal?: AbortSignal;
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  onOpen?: () => void;
  onError?: (error: unknown, info: StreamErrorInfo) => void;
}

export const DEFAULT_ENDPOINT = "http://127.0.0.1:30142";
/** 2.5× the server's 30 s heartbeat (`AGENT_EVENT_HEARTBEAT_MS`). */
export const DEFAULT_STALE_MS = 75_000;
export const DEFAULT_MIN_RETRY_MS = 1_000;
export const DEFAULT_MAX_RETRY_MS = 10_000;

/**
 * The server's keep-alive, as a `data:` frame
 * (`lib/agent-event-wire.ts` `AGENT_EVENT_HEARTBEAT_MS`, `{"type":"heartbeat"}`).
 * It is proof of life, not something the UI shows.
 */
const HEARTBEAT_PREFIX = '{"type":"heartbeat"';
const isHeartbeat = (data: string): boolean => data.startsWith(HEARTBEAT_PREFIX);

const noTarget = (): StreamTarget => ({ base: DEFAULT_ENDPOINT, token: null });
let streamTarget: () => StreamTarget = noTarget;

/**
 * The transport `openStream` uses. A packaged app installs the pipe to its own
 * agent (`link.ts` `agentFetch`); left alone it is the global `fetch`, which is
 * what the browser build and the tests use.
 */
let streamFetch: typeof fetch | null = null;

/** Installs the transport (`client.ts` calls this once); `null` restores `fetch`. */
export function setStreamFetch(transport: typeof fetch | null): void {
  streamFetch = transport;
}

/** Installs the endpoint/token accessors (`client.ts` calls this once); `null` restores the default. */
export function setStreamTarget(resolve: (() => StreamTarget) | null): void {
  streamTarget = resolve ?? noTarget;
}

/**
 * `path` against `base`, with the LAN token in the query (`?t=`): la
 * `lib/lan-access.ts` prefers Bearer/cookie but `?t=` is the one channel every
 * host here has (a native fetch has no cookie jar, and an SSE request cannot
 * set a header in a browser).
 */
export function withToken(base: string, path: string, token?: string | null): string {
  const absolute = path.startsWith("http://") || path.startsWith("https://");
  const trimmed = absolute ? path : `${base.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
  if (!token || /[?&]t=/.test(trimmed)) return trimmed;
  return `${trimmed}${trimmed.includes("?") ? "&" : "?"}t=${encodeURIComponent(token)}`;
}

/** The URL `openStream` would open for `path`, without connecting. */
export function streamUrl(path: string, target: StreamTarget = streamTarget()): string {
  return withToken(target.base, path, target.token);
}

/**
 * One frame's lines → a frame, or `null` for a block with nothing to dispatch.
 *
 * `:` comment lines (the `:\n\n` the server writes first, and any keep-alive
 * comment) are dropped; the value of a field drops one leading space, as the
 * spec's "collect the value" does. Multiple `data:` lines join with `\n`.
 */
function parseBlock(block: string): SseFrame | null {
  let event: string | undefined;
  let id: string | undefined;
  let retry: number | undefined;
  const data: string[] = [];

  for (const line of block.split("\n")) {
    if (line === "" || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "event":
        event = value;
        break;
      case "data":
        data.push(value);
        break;
      case "id":
        // The spec ignores an id carrying NUL; keep the same rule.
        if (!value.includes("\u0000")) id = value;
        break;
      case "retry":
        if (/^\d+$/.test(value)) retry = Number(value);
        break;
      default:
        // Unknown field: ignored, as the spec says.
        break;
    }
  }

  // Nothing to dispatch: a comment/heartbeat block or a stray blank line.
  if (data.length === 0 && event === undefined && id === undefined) return null;
  const frame: SseFrame = { data: data.join("\n") };
  if (event !== undefined) frame.event = event;
  if (id !== undefined) frame.id = id;
  if (retry !== undefined) frame.retry = retry;
  return frame;
}

/**
 * Appends `chunk` to `buffer` and splits off every complete frame.
 *
 * Pure and incremental, so a frame cut across two reads (or two TCP chunks)
 * survives: whatever follows the last blank line comes back as `rest` and goes
 * into the next call as `buffer`. A trailing lone `\r` is held back in `rest`
 * because it may be the first half of a `\r\n` the next chunk completes.
 */
export function parseFrames(buffer: string, chunk = ""): ParseFramesResult {
  let text = buffer + chunk;
  let held = "";
  // A trailing CR may be the first half of a CRLF that the next chunk
  // completes. `\r\r` is not: the first CR ended a line.
  if (text.endsWith("\r") && !text.endsWith("\r\r")) {
    held = "\r";
    text = text.slice(0, -1);
  }
  // CRLF, lone CR and LF are all line terminators in an event stream.
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const frames: SseFrame[] = [];
  let start = 0;
  for (;;) {
    const end = text.indexOf("\n\n", start);
    if (end < 0) break;
    const frame = parseBlock(text.slice(start, end));
    if (frame !== null) frames.push(frame);
    start = end + 2;
  }
  return { frames, rest: text.slice(start) + held };
}

/** 4xx answers that will not change by retrying (a bad token, a vanished session). */
function retryable(status: number): boolean {
  return !(status >= 400 && status < 500) || status === 408 || status === 429;
}

/**
 * Opens `path` as an SSE stream and keeps it open: stale watchdog (any byte
 * resets it), reconnect with jittered exponential backoff, and `Last-Event-ID`
 * on every reconnect so a cursor-based stream (the terminal's `?after=`)
 * resumes where it stopped. Returns `close()`; after it, nothing reconnects.
 */
export function openStream(
  path: string,
  onEvent: (event: SseEvent) => void,
  options: OpenStreamOptions = {},
): () => void {
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const minRetryMs = options.minRetryMs ?? DEFAULT_MIN_RETRY_MS;
  const maxRetryMs = options.maxRetryMs ?? DEFAULT_MAX_RETRY_MS;
  const doFetch: typeof fetch = options.fetch ?? streamFetch ?? fetch;

  let closed = false;
  /** Cursor for `Last-Event-ID`: the last `id:` any frame carried. */
  let lastEventId: string | undefined;
  let attempt = 0;
  let controller: AbortController | null = null;
  /** The open body's reader: cancelling it is the only way to break a read the
   *  watchdog gave up on (aborting the controller does not touch a body the
   *  caller owns). */
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let staleTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const clearStale = () => {
    if (staleTimer !== undefined) {
      clearTimeout(staleTimer);
      staleTimer = undefined;
    }
  };

  /** Any byte counts as life: restart the watchdog. */
  const bump = () => {
    clearStale();
    if (closed) return;
    staleTimer = setTimeout(() => {
      staleTimer = undefined;
      // Half-open connection (a proxy dropped it, the machine slept):
      // cancel the read so `await reader.read()` settles, then abort; the
      // read loop's catch reconnects.
      void activeReader?.cancel().catch(() => {});
      controller?.abort();
    }, staleMs);
  };

  const close = () => {
    if (closed) return;
    closed = true;
    clearStale();
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
    options.signal?.removeEventListener("abort", close);
    void activeReader?.cancel().catch(() => {});
    activeReader = undefined;
    controller?.abort();
    controller = null;
  };

  const backoffMs = (n: number) => {
    const ceiling = Math.min(maxRetryMs, minRetryMs * 2 ** Math.min(Math.max(n, 1) - 1, 10));
    // Half-to-full jitter: never a thundering herd, never below half the step.
    return Math.round(ceiling * (0.5 + Math.random() * 0.5));
  };

  const scheduleReconnect = (error: unknown, status?: number) => {
    if (closed) return;
    if (status !== undefined && !retryable(status)) {
      options.onError?.(error, { attempt, willRetry: false, status });
      return;
    }
    attempt += 1;
    const delayMs = backoffMs(attempt);
    options.onError?.(error, { attempt, willRetry: true, delayMs, status });
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      void connect();
    }, delayMs);
  };

  async function connect(): Promise<void> {
    if (closed) return;
    if (options.signal?.aborted) {
      close();
      return;
    }
    const abort = new AbortController();
    controller = abort;
    let status: number | undefined;
    let localReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    bump();

    try {
      const headers: Record<string, string> = { Accept: "text/event-stream", ...options.headers };
      if (lastEventId !== undefined) headers["Last-Event-ID"] = lastEventId;
      const target = streamTarget();
      const response = await doFetch(
        withToken(options.base ?? target.base, path, options.token !== undefined ? options.token : target.token),
        { headers, signal: abort.signal },
      );
      status = response.status;
      if (!response.ok) throw new Error(`SSE ${response.status} ${response.statusText || ""}`.trim());
      const body = response.body;
      if (!body) throw new Error("SSE: response has no body");

      const reader = (localReader = body.getReader());
      activeReader = reader;
      const decoder = new TextDecoder();
      let buffer = "";
      options.onOpen?.();

      for (;;) {
        const { value, done } = await reader.read();
        if (closed) return;
        if (done) break;
        if (value !== undefined && value.length > 0) bump();
        const chunk = value === undefined ? "" : decoder.decode(value, { stream: true });
        const parsed = parseFrames(buffer, chunk);
        buffer = parsed.rest;
        for (const frame of parsed.frames) {
          if (frame.id !== undefined) lastEventId = frame.id;
          // A frame with no data dispatches no event (comment/heartbeat
          // block, or an `id:`-only frame that only moves the cursor).
          if (frame.data === "") continue;
          // The 30 s keep-alive is proof of life, not an event.
          if (isHeartbeat(frame.data)) continue;
          // A stream that produces events is healthy: the next failure
          // starts the backoff from 1 s again.
          attempt = 0;
          const event: SseEvent = { data: frame.data };
          if (frame.event !== undefined) event.event = frame.event;
          if (frame.id !== undefined) event.id = frame.id;
          onEvent(event);
        }
      }
    } catch (error) {
      if (closed) return;
      scheduleReconnect(error, status);
      return;
    } finally {
      clearStale();
      if (activeReader === localReader) activeReader = undefined;
      if (controller === abort) controller = null;
    }

    // A clean EOF is still a dropped stream (the server closed or rotated).
    scheduleReconnect(new Error("SSE: stream ended"), status);
  }

  options.signal?.addEventListener("abort", close);
  void connect();
  return close;
}
