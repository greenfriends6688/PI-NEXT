// The terminal API: create a pseudo-terminal on the pi-web host, feed it
// keystrokes, resize it, and read its output as SSE. The emulator itself is
// `nsh/base`'s `Terminal`; nothing here draws.
//
// Server shapes (read before writing):
//   app/api/terminal/route.ts        POST { cwd, cols?, rows? } -> { id }
//   app/api/terminal/[id]/route.ts   POST { type: "input", data } (<=64 KiB)
//                                    POST { type: "resize", cols, rows }
//                                    DELETE -> { success }
//   app/api/terminal/[id]/events/route.ts
//                                    SSE `id: <offset>\ndata: <TerminalEvent>`;
//                                    resume from `Last-Event-ID` or `?after=`;
//                                    `:` comments every 30 s.
// The output frames come from `lib/terminal-manager.ts:9-12` (`TerminalEvent`)
// and the replay/`reset` rule from `subscribeTerminal()` there.

import { postJson, req, segment, withQuery, type RequestOptions } from "./client";
import { openStream, type OpenStreamOptions } from "./sse";

export interface TerminalCreateRequest {
  /** The shell's working directory; the server requires an existing, allowed folder. */
  cwd: string;
  /** Cells across; the server defaults to 80 and clamps to 2…1000. */
  cols: number;
  /** Cells down; the server defaults to 24 and clamps to 2…1000. */
  rows: number;
}

export interface TerminalCreateResponse {
  id: string;
}

/** One frame of `GET /api/terminal/[id]/events` (`lib/terminal-manager.ts:9-12`). */
export type TerminalEvent =
  | {
    type: "output";
    data: string;
    /** The total byte offset after this chunk; the SSE frame's `id:` is this. */
    offset: number;
    /** The client's cursor was outside the replay backlog: clear before writing. */
    reset?: boolean;
  }
  | { type: "exit"; exitCode: number }
  | { type: "closed" };

/** The server refuses one input write above this (`route.ts`: `64 * 1024`). */
export const MAX_TERMINAL_INPUT = 64 * 1024;

/** The server's bounds (`route.ts`: cols 2…1000, rows 1…1000 then at least 2). */
const MIN_DIMENSION = 2;
const MAX_DIMENSION = 1000;

function terminalPath(id: string): string {
  return `/api/terminal/${segment(id)}`;
}

function dimension(value: number): number {
  const rounded = Math.floor(value);
  if (!Number.isFinite(rounded)) return MIN_DIMENSION;
  return Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, rounded));
}

/**
 * Registers the pending-command chain of one terminal. Keystrokes and resizes
 * must reach the pty in the order they happened; `writeTerminalInput()` can be
 * called several times from one `onData` and must not interleave the POSTs.
 */
const commandChains = new Map<string, Promise<unknown>>();

function enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = commandChains.get(id) ?? Promise.resolve();
  const next = previous.then(task, task);
  // The chain remembers only settlement, never a rejection: one failed input
  // must not poison every later resize.
  const settled = next.then(() => undefined, () => undefined);
  commandChains.set(id, settled);
  void settled.then(() => {
    if (commandChains.get(id) === settled) commandChains.delete(id);
  });
  return next;
}

/** Splits a paste at the server's limit, never through a UTF-16 surrogate pair. */
function* inputChunks(data: string): Generator<string> {
  let at = 0;
  while (at < data.length) {
    let end = Math.min(at + MAX_TERMINAL_INPUT, data.length);
    if (end < data.length) {
      const code = data.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    }
    yield data.slice(at, end);
    at = end;
  }
}

/** `POST /api/terminal`: spawn a shell in `cwd` at the given window size. */
export function createTerminal(
  request: TerminalCreateRequest,
  options: RequestOptions = {},
): Promise<TerminalCreateResponse> {
  return postJson<TerminalCreateResponse>("/api/terminal", request, options);
}

/**
 * `POST /api/terminal/[id]` with `{ type: "input" }`. Large pastes are split
 * at 64 KiB and sent in order through the terminal's command chain.
 */
export function writeTerminalInput(
  id: string,
  data: string,
  options: RequestOptions = {},
): Promise<void> {
  if (data.length === 0) return Promise.resolve();
  const path = terminalPath(id);
  let tail: Promise<void> = Promise.resolve();
  for (const chunk of inputChunks(data)) {
    tail = enqueue(id, () => postJson<{ success?: boolean }>(path, {
      type: "input",
      data: chunk,
    }, options).then(() => undefined));
  }
  return tail;
}

/** `POST /api/terminal/[id]` with `{ type: "resize" }`, clamped to the server's bounds. */
export function resizeTerminal(
  id: string,
  cols: number,
  rows: number,
  options: RequestOptions = {},
): Promise<void> {
  const width = dimension(cols);
  const height = dimension(rows);
  return enqueue(id, () => postJson<{ success?: boolean }>(terminalPath(id), {
    type: "resize",
    cols: width,
    rows: height,
  }, options).then(() => undefined));
}

/** `DELETE /api/terminal/[id]`: kills the shell and drops its backlog. */
export function killTerminal(
  id: string,
  options: RequestOptions = {},
): Promise<{ success?: boolean }> {
  // A write queued before the delete has nobody to reach any more.
  commandChains.delete(id);
  return req<{ success?: boolean }>(terminalPath(id), { method: "DELETE", keepalive: true }, options);
}

export interface TerminalOutputOptions extends OpenStreamOptions {
  /**
   * The byte offset to resume after (`?after=`). Omit for a fresh terminal:
   * the server then replays the whole backlog with `reset: true`.
   */
  after?: number;
  /** The page holding the stream (the Debug panel's connected pages). */
  holder?: string;
}

/**
 * Opens one terminal's output stream and hands the caller decoded
 * `TerminalEvent`s (`output` / `exit` / `closed`).
 *
 * Cursor: the initial `after` goes in the query; every later reconnect uses
 * the `id:` of the last output frame as `Last-Event-ID` (both handled inside
 * `openStream`, `sse.ts`). A small local cursor drops an output frame the
 * server replays anyway (`offset <=` what was shown), except after a `reset`,
 * where the backlog is meant to replace the screen.
 *
 * The stream closes itself once the shell ends (`exit` / `closed`), so a dead
 * terminal does not reconnect every few seconds until its record expires.
 */
export function openTerminalOutput(
  id: string,
  onEvent: (event: TerminalEvent) => void,
  options: TerminalOutputOptions = {},
): () => void {
  const { after, holder, ...stream } = options;
  const initial = after !== undefined && Number.isSafeInteger(after) && after >= 0
    ? after
    : undefined;
  const path = withQuery(`/api/terminal/${segment(id)}/events`, {
    after: initial,
    holder,
  });
  let lastOffset = initial ?? -1;
  let close: (() => void) | null = null;

  const stop = openStream(path, (frame) => {
    let event: TerminalEvent;
    try {
      event = JSON.parse(frame.data) as TerminalEvent;
    } catch {
      return; // A proxy's error page is not a terminal event.
    }
    if (!isTerminalEvent(event)) return;
    if (event.type === "output") {
      if (!event.reset && event.offset <= lastOffset) return;
      lastOffset = event.offset;
    }
    onEvent(event);
    if (event.type === "exit" || event.type === "closed") close?.();
  }, stream);

  close = stop;
  return () => {
    close = null;
    stop();
  };
}

function isTerminalEvent(value: unknown): value is TerminalEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as { type?: unknown; data?: unknown; offset?: unknown; exitCode?: unknown };
  if (event.type === "output") {
    return typeof event.data === "string" && typeof event.offset === "number";
  }
  if (event.type === "exit") return typeof event.exitCode === "number";
  return event.type === "closed";
}
