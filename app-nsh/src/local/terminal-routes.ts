// The terminal pane: a shell the window itself starts.
//
// There is no pty in this runtime. The old server gave each tab a node-pty and
// forwarded its bytes (`lib/terminal-manager.ts`); here `process.spawn` starts
// the same login shell with piped stdin/stdout/stderr. That keeps the API the
// pane already speaks (`src/api/terminal.ts`) and is enough for ordinary
// commands, but it is not a terminal: there is no resize, no tty line
// discipline (so prompts and full-screen TUIs render wrong), and stdout/stderr
// are two pipes whose interleaving is not the pty's single stream.
//
// The shapes are copied from pi-web's routes:
//   POST   /api/terminal                 { cwd, cols?, rows? } -> { id }
//   POST   /api/terminal/[id]            { type:"input", data } | { type:"resize", cols, rows }
//   GET    /api/terminal/[id]/events     SSE `id: <offset>\ndata: <event>`, resume with `?after=`
//   DELETE /api/terminal/[id]            kill the child's process group
//
// Output is kept in a byte ring of the last MAX_BACKLOG bytes. `offset` is the
// total number of UTF-8 bytes the shell has written, so a reconnecting client's
// `Last-Event-ID`/`?after=` selects exactly the bytes it has not seen yet.
import { stat } from "fs/promises";
import path from "path";
import process, { spawn, type ChildProcess, type ExitResult } from "process";
import { loginShell } from "../pi/install";
import {
  describe,
  errorResponse,
  homeDirectory,
  isInside,
  jsonResponse,
  textResponse,
  type LocalRequest,
  type LocalResponse,
  type LocalStream,
} from "./request";

/** Same replay bound as the old server (`lib/terminal-manager.ts`). */
const MAX_BACKLOG = 128 * 1024;
/** The old server's `TERMINAL_RECONNECT_MS`: how long an unobserved shell lives. */
const IDLE_TIMEOUT_MS = 120_000;
/** The SSE keep-alive the old events route wrote. */
const HEARTBEAT_MS = 30_000;
/** The old input route's limit (`app/api/terminal/[id]/route.ts`). */
const MAX_INPUT = 64 * 1024;

type TerminalEvent =
  | { type: "output"; data: string; offset: number; reset?: boolean }
  | { type: "exit"; exitCode: number }
  | { type: "closed" };

type TerminalListener = (event: TerminalEvent) => void;

interface TerminalRecord {
  id: string;
  child: ChildProcess;
  cwd: string;
  cols: number;
  rows: number;
  listeners: Set<TerminalListener>;
  /** The last MAX_BACKLOG bytes, chunked as they arrived. */
  backlog: Uint8Array[];
  bufferedBytes: number;
  /** Total UTF-8 bytes written since the shell started. */
  offset: number;
  exited: boolean;
  exitCode: number | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

interface TerminalSubscription {
  output: Extract<TerminalEvent, { type: "output" }>;
  exited: boolean;
  exitCode: number | null;
  unsubscribe: () => void;
}

const terminals = new Map<string, TerminalRecord>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function randomId(): string {
  const digits = "0123456789abcdef";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += digits[Math.floor(Math.random() * 16)];
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bodyRecord(request: LocalRequest): Record<string, unknown> | null {
  if (request.body === null || request.body.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(request.body);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function dimension(value: unknown, fallback: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(1000, Math.max(2, number));
}

/** The shell the old manager started: the user's login shell, `$SHELL` first. */
function terminalShell(): string | null {
  const shell = loginShell();
  if (shell !== null) return shell;
  if (process.platform === "windows") return (process.env.ComSpec as string | undefined) ?? "cmd";
  return "/bin/sh";
}

// ---------------------------------------------------------------- output ring

/** The bytes of the backlog from `from` (0-based within the ring) onwards. */
function bufferedText(record: TerminalRecord, from: number): string {
  if (record.bufferedBytes === 0) return "";
  let skip = Math.max(0, Math.min(from, record.bufferedBytes));
  let total = record.bufferedBytes - skip;
  if (total <= 0) return "";
  const parts: Uint8Array[] = [];
  for (const chunk of record.backlog) {
    if (skip >= chunk.byteLength) {
      skip -= chunk.byteLength;
      continue;
    }
    const part = skip > 0 ? chunk.subarray(skip) : chunk;
    parts.push(part);
    skip = 0;
    total -= part.byteLength;
    if (total <= 0) break;
  }
  if (parts.length === 0) return "";
  if (parts.length === 1) return decoder.decode(parts[0]);
  const joined = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.byteLength;
  }
  return decoder.decode(joined);
}

function appendOutput(record: TerminalRecord, text: string): void {
  if (text === "") return;
  const bytes = encoder.encode(text);
  record.offset += bytes.byteLength;
  record.backlog.push(bytes);
  record.bufferedBytes += bytes.byteLength;
  while (record.bufferedBytes > MAX_BACKLOG) {
    const first = record.backlog[0];
    if (first === undefined) break;
    const excess = record.bufferedBytes - MAX_BACKLOG;
    if (first.byteLength <= excess) {
      record.backlog.shift();
      record.bufferedBytes -= first.byteLength;
    } else {
      record.backlog[0] = first.subarray(excess);
      record.bufferedBytes -= excess;
    }
  }
  emit(record, { type: "output", data: text, offset: record.offset });
}

// ------------------------------------------------------------------- registry

function emit(record: TerminalRecord, event: TerminalEvent): void {
  for (const listener of record.listeners) listener(event);
}

function clearIdle(record: TerminalRecord): void {
  if (record.idleTimer !== null) {
    clearTimeout(record.idleTimer);
    record.idleTimer = null;
  }
}

function scheduleIdle(record: TerminalRecord): void {
  if (record.idleTimer !== null || record.listeners.size > 0 || terminals.get(record.id) !== record) return;
  record.idleTimer = setTimeout(() => {
    record.idleTimer = null;
    if (record.listeners.size === 0 && terminals.get(record.id) === record) {
      remove(record.id, record, true);
    }
  }, IDLE_TIMEOUT_MS);
}

function remove(id: string, record: TerminalRecord, kill: boolean): void {
  if (terminals.get(id) === record) terminals.delete(id);
  clearIdle(record);
  if (kill && !record.exited) {
    try {
      // `ChildProcess.kill()` sends SIGTERM to the process group and SIGKILL
      // after 250 ms, so a shell's children go with it.
      record.child.kill();
    } catch {
      // Already gone.
    }
  }
  emit(record, { type: "closed" });
  record.listeners.clear();
}

function subscribe(
  record: TerminalRecord,
  listener: TerminalListener,
  after: number | undefined,
): TerminalSubscription | null {
  if (terminals.get(record.id) !== record) return null;
  record.listeners.add(listener);
  clearIdle(record);

  const start = record.offset - record.bufferedBytes;
  const reset = after === undefined || after < start || after > record.offset;
  const from = reset || after === undefined ? 0 : after - start;
  return {
    output: {
      type: "output",
      data: bufferedText(record, from),
      offset: record.offset,
      reset,
    },
    exited: record.exited,
    exitCode: record.exitCode,
    unsubscribe: () => {
      record.listeners.delete(listener);
      scheduleIdle(record);
    },
  };
}

// --------------------------------------------------------------------- routes

async function createTerminal(request: LocalRequest): Promise<LocalResponse> {
  const body = bodyRecord(request);
  if (body === null) return errorResponse("cwd required", 400);

  // The old route let a reconnecting tab name its terminal again. The current
  // client does not, but accepting the same 32-hex id keeps that shape.
  if (body.id !== undefined && (typeof body.id !== "string" || !/^[a-f0-9]{32}$/.test(body.id))) {
    return errorResponse("Invalid terminal id", 400);
  }
  const requestedId = typeof body.id === "string" ? body.id : undefined;

  const requested = typeof body.cwd === "string" ? body.cwd.trim() : "";
  if (requested === "") return errorResponse("cwd required", 400);
  const cwd = path.resolve(requested);
  if (!isInside(homeDirectory(), cwd)) return errorResponse("Access denied", 403);

  let info;
  try {
    info = await stat(cwd);
  } catch {
    return errorResponse("cwd must be a directory", 400);
  }
  if (!info.isDirectory()) return errorResponse("cwd must be a directory", 400);

  const id = requestedId ?? randomId();
  const existing = terminals.get(id);
  if (existing !== undefined) {
    if (path.resolve(existing.cwd) !== cwd) {
      return errorResponse("Terminal belongs to a different workspace", 500);
    }
    return jsonResponse({ id });
  }

  const shell = terminalShell();
  if (shell === null) return errorResponse("this platform has no login shell", 500);

  let child: ChildProcess;
  try {
    child = spawn(shell, ["-il"], {
      stdin: "pipe",
      lines: false,
      cwd,
    });
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }

  const record: TerminalRecord = {
    id,
    child,
    cwd,
    cols: dimension(body.cols, 80),
    rows: dimension(body.rows, 24),
    listeners: new Set(),
    backlog: [],
    bufferedBytes: 0,
    offset: 0,
    exited: false,
    exitCode: null,
    idleTimer: null,
  };
  // Registered before the listeners: a child that already exited calls its
  // `exit` handler during `on()`, and that handler needs the record in the map.
  terminals.set(id, record);

  child.on("stdout", (text: string) => {
    if (terminals.get(id) === record) appendOutput(record, text);
  });
  child.on("stderr", (text: string) => {
    if (terminals.get(id) === record) appendOutput(record, text);
  });
  child.on("exit", (result: ExitResult) => {
    if (record.exited) return;
    record.exited = true;
    record.exitCode = typeof result.code === "number" ? result.code : 0;
    if (terminals.get(id) !== record) return;
    clearIdle(record);
    emit(record, { type: "exit", exitCode: record.exitCode });
    scheduleIdle(record);
  });

  scheduleIdle(record);
  return jsonResponse({ id });
}

function postTerminal(request: LocalRequest, id: string): LocalResponse {
  const body = bodyRecord(request);
  if (body === null) return errorResponse("Invalid terminal command", 400);

  const record = terminals.get(id);
  if (record === undefined) return errorResponse("Terminal not found", 404);

  const input = body.type === "input" || (body.type === undefined && typeof body.data === "string");
  if (input) {
    if (typeof body.data !== "string" || body.data.length > MAX_INPUT) {
      return errorResponse("Invalid terminal command", 400);
    }
    if (record.exited) return errorResponse("Terminal not found", 404);
    try {
      record.child.write(body.data);
    } catch (cause) {
      return errorResponse(describe(cause), 500);
    }
    return jsonResponse({ success: true });
  }

  const resize = body.type === "resize" || (body.cols !== undefined && body.rows !== undefined);
  if (resize) {
    if (record.exited) return errorResponse("Terminal not found", 404);
    // Accepted for the client's sake, but a pipe has no window size. Keeping
    // the last value is all this route can honestly do with it.
    record.cols = dimension(body.cols, record.cols);
    record.rows = dimension(body.rows, record.rows);
    return jsonResponse({ success: true });
  }

  return errorResponse("Invalid terminal command", 400);
}

function deleteTerminal(id: string): LocalResponse {
  const record = terminals.get(id);
  if (record !== undefined) remove(id, record, true);
  // The old route answered success even for an id that had already expired.
  return jsonResponse({ success: true });
}

function openEvents(request: LocalRequest, id: string): LocalResponse {
  const record = terminals.get(id);
  if (record === undefined) return textResponse("Terminal not found", 404);
  if (request.signal?.aborted) return { status: 204 };

  // The old route read the header first and `?after=` second; an invalid
  // header means "no cursor" rather than falling back to the query.
  const header = request.headers["last-event-id"] ?? request.headers["Last-Event-ID"];
  const cursor = header ?? request.params.get("after");
  const after = cursor !== null
    && cursor !== undefined
    && /^\d+$/.test(cursor)
    && Number.isSafeInteger(Number(cursor))
    ? Number(cursor)
    : undefined;

  return {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
    stream: (stream) => streamEvents(record, after, request.signal, stream),
  };
}

function streamEvents(
  record: TerminalRecord,
  after: number | undefined,
  signal: AbortSignal | undefined,
  stream: LocalStream,
): () => void {
  let stopped = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | null = null;

  const cleanup = (): void => {
    if (stopped) return;
    stopped = true;
    if (heartbeat !== undefined) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
    unsubscribe?.();
    unsubscribe = null;
    try {
      signal?.removeEventListener("abort", cleanup);
    } catch {
      // A signal from another realm: nothing to detach.
    }
    scheduleIdle(record);
  };

  const emitText = (text: string): void => {
    if (stopped) return;
    try {
      stream.emit(text);
    } catch {
      // The window stopped reading: `stream.closed` runs the cleanup too.
      cleanup();
    }
  };

  const send = (event: TerminalEvent): void => {
    if (stopped) return;
    const frameId = event.type === "output" ? `id: ${event.offset}\n` : "";
    emitText(`${frameId}data: ${JSON.stringify(event)}\n\n`);
    if (event.type === "exit" || event.type === "closed") {
      try {
        stream.end();
      } catch {
        // Already ended.
      }
      cleanup();
    }
  };

  const subscription = subscribe(record, send, after);
  if (subscription === null) {
    try {
      stream.end();
    } catch {
      // Already ended.
    }
    cleanup();
    return cleanup;
  }
  unsubscribe = subscription.unsubscribe;

  // The old route's first comment frame: it lets the client's first read
  // settle before the shell has produced anything.
  emitText(":\n\n");
  send(subscription.output);
  if (subscription.exited) send({ type: "exit", exitCode: subscription.exitCode ?? 0 });
  if (stopped) return cleanup;

  heartbeat = setInterval(() => emitText(":\n\n"), HEARTBEAT_MS);

  if (signal) {
    if (signal.aborted) {
      cleanup();
      try {
        stream.end();
      } catch {
        // Already ended.
      }
      return cleanup;
    }
    try {
      signal.addEventListener("abort", cleanup);
    } catch {
      // A signal from another realm: it can only time itself out.
    }
  }
  void stream.closed.then(cleanup);
  return cleanup;
}

/** Kills every shell this window started; the app's quit hook calls this. */
export function stopAll(): void {
  for (const record of [...terminals.values()]) {
    remove(record.id, record, true);
  }
  terminals.clear();
}

export async function handleTerminal(request: LocalRequest): Promise<LocalResponse | null> {
  const segments = request.segments;
  if (segments[0] !== "api" || segments[1] !== "terminal") return null;
  const method = request.method;

  if (segments.length === 2) {
    if (method !== "POST") return null;
    try {
      return await createTerminal(request);
    } catch (cause) {
      return errorResponse(describe(cause), 500);
    }
  }

  if (segments.length === 3) {
    const id = segments[2];
    if (id === "") return null;
    if (method === "POST") {
      try {
        return postTerminal(request, id);
      } catch (cause) {
        return errorResponse(describe(cause), 500);
      }
    }
    if (method === "DELETE") return deleteTerminal(id);
    return null;
  }

  if (segments.length === 4 && segments[3] === "events" && method === "GET") {
    const id = segments[2];
    if (id === "") return null;
    try {
      return openEvents(request, id);
    } catch (cause) {
      return errorResponse(describe(cause), 500);
    }
  }

  return null;
}
