// The link to the agent: one process, one pipe, no address.
//
// The window cannot host pi's agent (a Node SDK; this app's UI runs in
// QuickJS), so the app carries the agent as its own process and talks to it over
// stdin/stdout — `host/main.mjs` on the other end. There is no port, no URL and
// no HTTP server anyone could reach: `agentFetch()` below is the only way the
// app can reach the agent, and it writes a line into that pipe.
//
// Two things this module must keep true:
//
// 1. `client.ts`'s `req()` and `sse.ts`'s `openStream()` keep their shape. They
//    call a `fetch(url, init)`; the one installed here answers the same way —
//    a real `Response` for a call, a `Response` whose body is a reader fed by
//    the host's stream frames for SSE. That is why the ~40 screens and every
//    `src/api/*` module need no change: the transport changed, not the API.
// 2. A build without a host beside it (a plain `nsh run` in development, the
//    browser target) falls back to the old HTTP endpoint, so `npm run dev`
//    against `next dev` still works.
import { platform, signal } from "nsh";
import process, { spawn, type ChildProcess } from "process";
import { exists } from "fs/promises";
import { findNodeRuntime, findServerBundle, SERVER_HOST, SERVER_PORT } from "../lib/app-bundle";
import { checkPi, versionText } from "../pi/install";
import { attachedMode, serverBacked } from "./mode";
import { handleLocally } from "../local";
import type { LocalResponse } from "../local/request";

/**
 * A route the window does not answer, and no server behind it: the development
 * endpoint (`npm run dev`). Saying so beats a network failure — a settings pane
 * should read "this build has no server for it", not "cannot connect".
 */
async function endpointFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${FALLBACK_ORIGIN}${url}`, init);
  } catch {
    const body = JSON.stringify({
      error: "这个构建没有内置服务：这项功能还没搬到本地。",
    });
    return {
      ok: false,
      status: 503,
      statusText: "",
      headers: { get: () => "application/json" },
      text: async () => body,
      json: async () => JSON.parse(body),
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response;
  }
}

/** What the agent process is doing, as the connection card shows it. */
export type AgentPhase = "idle" | "starting" | "ready" | "failed";

export const agentPhase = signal<AgentPhase>("idle");
/** The agent's last lines of output, for the connection card. */
export const agentLog = signal<string[]>([]);
/** Why the agent did not come up. */
export const agentFailure = signal<string | null>(null);
/** Whether this app started the agent (so quitting stops it). */
export const agentRunning = signal<boolean>(false);
/** The shell's own switch: `up` once the agent answers, `down` once it stops. */
export const serverState = signal<"checking" | "up" | "down">("checking");
/**
 * Whether a start has taken long enough to deserve the connection card. The
 * agent usually answers in under a second, and flashing "starting" over the
 * window on every launch is noise — the card is for a start that is stuck.
 */
export const agentSlowStart = signal<boolean>(false);

/** Where a server this build does not carry would be (development, browser). */
const FALLBACK_ORIGIN = `http://${SERVER_HOST}:${SERVER_PORT}`;

function note(text: string): void {
  const line = String(text).trim();
  if (!line) return;
  console.log(`[agent] ${line}`);
  agentLog.set([...agentLog().slice(-40), line]);
}

// ------------------------------------------------------------------- messages
/** One in-flight request, keyed by the id its messages carry. */
interface Pending {
  resolve: (message: ResponseMessage) => void;
  reject: (error: Error) => void;
}

interface ResponseMessage {
  id: number;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  bodyEncoding?: "utf8" | "base64";
  error?: { message: string; code?: string };
  stream?: "open" | "end";
  chunk?: string;
  event?: string;
  text?: string;
  message?: string;
}

const pending = new Map<number, Pending>();
/** Open streams: chunk queues the reader drains. */
interface StreamState {
  queue: string[];
  ended: boolean;
  /** Wakes the reader when a chunk or the end arrives. */
  waiters: Array<() => void>;
  cancelled: boolean;
}
const streams = new Map<number, StreamState>();
let nextId = 1;
let child: ChildProcess | null = null;
let starting: Promise<boolean> | null = null;
/** Set once the host has said it is listening. */
let ready = false;
/** The first answered call: proof in the app's own log that the pipe works. */
let spoke = false;

function wake(stream: StreamState): void {
  const waiting = stream.waiters;
  stream.waiters = [];
  for (const resolve of waiting) resolve();
}

function onLine(line: string): void {
  const text = line.trim();
  if (!text) return;
  let message: ResponseMessage;
  try {
    message = JSON.parse(text) as ResponseMessage;
  } catch {
    note(text);
    return;
  }

  if (message.event === "log") {
    note(message.text ?? "");
    return;
  }
  if (message.event === "ready") {
    ready = true;
    agentPhase.set("ready");
    serverState.set("up");
    agentSlowStart.set(false);
    note("the agent is running");
    return;
  }
  if (message.event === "failed") {
    ready = false;
    agentPhase.set("failed");
    serverState.set("down");
    agentSlowStart.set(true);
    agentFailure.set(message.message ?? "the agent did not start");
    return;
  }
  if (message.event === "error") {
    note(message.message ?? "the agent reported an error");
    return;
  }

  const id = message.id;
  if (typeof id !== "number") return;

  // Stream frames: open, chunk, end.
  if (message.stream === "open") return;
  if (message.stream === "end") {
    const stream = streams.get(id);
    if (stream) {
      stream.ended = true;
      wake(stream);
    }
    return;
  }
  if (typeof message.chunk === "string") {
    const stream = streams.get(id);
    if (stream) {
      stream.queue.push(message.chunk);
      wake(stream);
    }
    return;
  }

  const waiter = pending.get(id);
  if (!waiter) return;
  pending.delete(id);
  if (message.error) {
    waiter.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
    return;
  }
  waiter.resolve(message);
}

function startReading(started: ChildProcess): void {
  started.on("stdout", (line: string) => onLine(line));
  started.on("stderr", (line: string) => note(line));
  started.on("exit", (result) => {
    if (child === started) {
      child = null;
      ready = false;
      agentRunning.set(false);
      serverBacked.set(false);
      // An attached build keeps its shell: the pi on this machine answers the
      // window's own routes, and the server this child started only fills in
      // the routes the window does not (`/api/mcp`, `/api/skills`, uploads).
      // Its exit must not replace a working window with the connection card.
      if (attached) {
        note(`the optional server stopped (code ${result.code ?? "?"})`);
        return;
      }
      agentPhase.set("failed");
      serverState.set("down");
      agentFailure.set(`the agent stopped (code ${result.code ?? "?"})`);
    }
  });
}

// ------------------------------------------------------------------- starting
/**
 * Starts the agent if it is not running. Resolves with whether the app can go on
 * to draw the shell; a failure leaves the reason in `agentFailure`.
 */
export function startAgent(): Promise<boolean> {
  if (starting) return starting;
  starting = start().finally(() => {
    starting = null;
  });
  return starting;
}

/**
 * Whether the window is attached: the pi on this machine drives the agent and
 * `src/local` answers the routes, so nothing has to be started. The bundled
 * server (a build that still carries one) then starts on the first request that
 * falls through to it — see `ensureHost()`.
 */
let attached = false;

/** The one place `attached` changes, so the signal cannot drift. */
function setAttached(value: boolean): void {
  attached = value;
  attachedMode.set(value);
}

async function start(): Promise<boolean> {
  if (ready || attached) {
    agentPhase.set("ready");
    serverState.set("up");
    return true;
  }
  if (child) return false;

  agentPhase.set("starting");
  agentFailure.set(null);
  agentLog.set([]);
  agentSlowStart.set(false);

  // The browser build is served by a server; it talks to its own origin.
  if (platform.os === "web") {
    agentPhase.set("ready");
    serverState.set("up");
    return true;
  }

  // Draw the shell now, find the agent behind it. Looking for `pi` is a child
  // process (`loginShell` → `pi --version`, roughly a second) and booting a
  // bundled Next server is several; doing either before the first frame is a
  // window that appears seconds late. Every route the window answers itself
  // (`src/local`) works without the answer, so the check can wait.
  setAttached(true);
  agentPhase.set("ready");
  serverState.set("up");
  agentSlowStart.set(false);
  void attach();

  return true;
}

/**
 * What the window talks to, decided behind the first frame: the pi this
 * machine has, else the bundled server this build may carry, else a dev
 * server. A failure replaces the shell with the connection card, which is
 * right — an attached window with no pi can do nothing.
 */
async function attach(): Promise<void> {
  const installed = await checkPi();
  if (installed.kind === "ready") {
    note(`attached to pi ${versionText(installed.version)} (${installed.executable})`);
    // The routes only the old server answers (`/api/mcp`, `/api/skills`,
    // uploads …) still need it: start it behind the drawn window, so the first
    // of those screens does not wait for a Next boot.
    setTimeout(() => {
      void ensureHost();
    }, 1200);
    return;
  }

  const bundle = await findServerBundle();
  if (bundle && (await hasHost(bundle))) {
    await startHost(bundle);
    return;
  }

  if (await probeDevServer()) {
    note("using the dev server this build was started against");
    serverBacked.set(true);
    return;
  }

  setAttached(false);
  agentPhase.set("failed");
  serverState.set("down");
  agentSlowStart.set(true);
  agentFailure.set(
    installed.kind === "missing"
      ? "pi was not found. Install it with `npm install -g @earendil-works/pi-coding-agent`, then reopen the app."
      : installed.kind === "too-old" || installed.kind === "too-new"
        ? `The pi on this machine (${versionText(installed.version)}) does not fit this app: it needs 1.4.0 or newer, 1.x.`
        : "This build does not carry its agent, and no dev server is running on the old endpoint. Reinstall PI NEXT, or run `npm run dev`.",
  );
}

/** Starts the bundled host and waits for it. */
async function startHost(bundle: string): Promise<boolean> {
  const node = await findNodeRuntime();
  if (!node) {
    note("the Node runtime this app ships is missing from the bundle");
    return false;
  }

  const hostPath = `${bundle}/host/main.mjs`;
  note(`starting the agent: ${hostPath}`);
  try {
    // The app's runtime is started through `/usr/bin/env` (a fixed, granted
    // path) on POSIX so it is found wherever the app was installed; Windows
    // starts it by path.
    const launches = platform.os === "windows"
      ? [{ command: node, args: [hostPath] }]
      : [
        { command: "/usr/bin/env", args: [`PATH=${node.slice(0, node.lastIndexOf("/"))}`, "node", hostPath] },
        { command: node, args: [hostPath] },
      ];

    for (const launch of launches) {
      let started: ChildProcess;
      try {
        started = spawn(launch.command, launch.args, {
          stdin: "pipe",
          lines: true,
          cwd: process.dataDir,
        });
      } catch (error) {
        note(`${launch.command}: ${(error as { code?: string }).code ?? String(error)}`);
        continue;
      }
      child = started;
      ready = false;
      agentRunning.set(true);
      if (!attached) serverState.set("checking");
      startReading(started);
      const up = await waitForReady(started, bundle);
      if (up) {
        serverBacked.set(true);
        return true;
      }
      stopAgent();
    }
  } catch (error) {
    note(String((error as Error).message ?? error));
  }

  // The shell stays: a bundled server that will not start only means the
  // routes it alone serves are unavailable.
  note(`the agent did not answer.${locationHint(bundle)}`);
  return false;
}

/** One host start at a time, for the requests that fall through to it. */
let hostStarting: Promise<boolean> | null = null;

/**
 * Starts the bundled server if a request needs it (`agentFetch`'s fallback).
 * Attached builds keep it stopped until then: the shell and the chat never wait
 * for a Next boot.
 */
async function ensureHost(): Promise<boolean> {
  if (child && ready) return true;
  if (!attached) return false;
  let bundle: string | null = null;
  try {
    bundle = await findServerBundle();
  } catch (error) {
    note(`on-demand server: lookup failed: ${(error as Error).message}`);
  }
  note(`on-demand server: ${bundle ?? "none in this build"}`);
  if (!bundle || !(await hasHost(bundle))) return false;
  if (hostStarting !== null) return hostStarting;
  hostStarting = startHost(bundle).finally(() => {
    hostStarting = null;
  });
  return hostStarting;
}

/** The dev server on the old endpoint answers (`npm run dev`). */
async function probeDevServer(): Promise<boolean> {
  try {
    const response = await fetch(`${FALLBACK_ORIGIN}/api/sessions`, { signal: AbortSignal.timeout(2500) } as RequestInit);
    return response.ok || response.status === 401;
  } catch {
    return false;
  }
}

/** Whether the bundle carries `host/main.mjs` (checked with the app's fs grant). */
async function hasHost(bundle: string): Promise<boolean> {
  try {
    return await exists(`${bundle}/host/main.mjs`);
  } catch {
    return false;
  }
}

/** How long a start may take before the card says what is holding it up. */
const START_TIMEOUT_MS = 25_000;

/**
 * macOS asks for consent the first time a process reads a protected folder
 * (Desktop, Documents, Downloads). An app run from there cannot start its agent
 * until that dialog is answered, which looks exactly like "stuck on starting" —
 * so say it, and say the thing that makes it stop: an app belongs in
 * Applications, which is not protected.
 */
function locationHint(bundle: string): string {
  const protectedFolder = /\/(Desktop|Documents|Downloads)\//.test(bundle);
  return protectedFolder
    ? " macOS is waiting for a folder-permission prompt (this copy runs from Desktop/Documents/Downloads). "
      + "Answer it once, or move PI NEXT into Applications — then it never asks again."
    : "";
}

/** Waits for the host's `ready` (or its exit), then for one answered call. */
async function waitForReady(started: ChildProcess, bundle: string): Promise<boolean> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (ready) return true;
    if (child !== started) return false;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  note(`the agent did not report ready in ${Math.round(START_TIMEOUT_MS / 1000)} s`);
  if (!agentFailure()) agentFailure.set(`The agent did not start.${locationHint(bundle)}`);
  return false;
}

/** Stops the agent this app started (the app is quitting). */
export function stopAgent(): void {
  const running = child;
  child = null;
  ready = false;
  agentRunning.set(false);
  for (const waiter of pending.values()) waiter.reject(new Error("the agent stopped"));
  pending.clear();
  streams.clear();
  if (!running) return;
  try {
    running.kill();
  } catch {
    // Already gone.
  }
}

// ------------------------------------------------------------------ transport
interface WireBody {
  text: string;
  encoding: "utf8" | "base64";
  /** Set for a `FormData` body: the content type carrying the boundary. */
  contentType?: string;
}

/**
 * The body as the wire carries it. A `FormData` body (a file upload) becomes the
 * same multipart bytes the browser would have written, base64'd so the pipe
 * carries binary safely.
 */
async function wireBody(body: unknown): Promise<WireBody | null> {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return { text: body, encoding: "utf8" };
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const boundary = `----pi-next-${Math.random().toString(16).slice(2)}`;
    const parts: Uint8Array[] = [];
    const encoder = new TextEncoder();
    for (const [name, value] of body.entries()) {
      const file = typeof File !== "undefined" && value instanceof File ? value : null;
      if (file) {
        parts.push(encoder.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${file.name}"\r\n`
          + `Content-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
        ));
        parts.push(new Uint8Array(await file.arrayBuffer()));
        parts.push(encoder.encode("\r\n"));
      } else {
        parts.push(encoder.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`,
        ));
      }
    }
    parts.push(encoder.encode(`--${boundary}--\r\n`));
    return {
      text: base64(concat(parts)),
      encoding: "base64",
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }
  return { text: String(body), encoding: "utf8" };
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 for bytes (the runtime has `btoa`, which takes text, not bytes). */
function base64(bytes: Uint8Array): string {
  let out = "";
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at];
    const b = bytes[at + 1];
    const c = bytes[at + 2];
    out += BASE64[a >> 2];
    out += BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? "=" : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? "=" : BASE64[c & 63];
  }
  return out;
}

function decodeBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let at = 0;
  for (let index = 0; index < clean.length; index += 4) {
    const a = BASE64.indexOf(clean[index]);
    const b = BASE64.indexOf(clean[index + 1] ?? "A");
    const c = BASE64.indexOf(clean[index + 2] ?? "A");
    const d = BASE64.indexOf(clean[index + 3] ?? "A");
    out[at++] = (a << 2) | (b >> 4);
    if (clean[index + 2] !== undefined) out[at++] = ((b & 15) << 4) | (c >> 2);
    if (clean[index + 3] !== undefined) out[at++] = ((c & 3) << 6) | d;
  }
  return out.subarray(0, at);
}

/** The path part of a URL: the wire has no origin, so one is dropped. */
function pathOf(url: string): string {
  const absolute = /^https?:\/\//i.exec(url);
  if (!absolute) return url;
  const rest = url.slice(absolute[0].length);
  const slash = rest.indexOf("/");
  return slash < 0 ? "/" : rest.slice(slash);
}

function headerObject(init: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const headers = init.headers as unknown;
  if (!headers) return out;
  const each = headers as { forEach?: (callback: (value: string, key: string) => void) => void };
  if (typeof each.forEach === "function") {
    each.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  for (const [key, value] of Object.entries(headers as Record<string, string>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** Sends one message and resolves with the answer (not for streams). */
function call(message: { path: string; method: string; headers: Record<string, string>; body: WireBody | null }): Promise<ResponseMessage> {
  if (!child || !ready) return Promise.reject(new Error("the agent is not running"));
  const id = nextId++;
  return new Promise<ResponseMessage>((resolvePromise, rejectPromise) => {
    const resolve = (message: ResponseMessage) => {
      if (!spoke) {
        spoke = true;
        note(`the window reached the agent (first answer: ${message.status ?? "?"})`);
      }
      resolvePromise(message);
    };
    pending.set(id, { resolve, reject: rejectPromise });
    const line = JSON.stringify({
      id,
      path: message.path,
      method: message.method,
      headers: message.headers,
      ...(message.body ? { body: message.body.text, bodyEncoding: message.body.encoding } : {}),
    });
    try {
      child?.write(`${line}\n`);
    } catch (error) {
      pending.delete(id);
      rejectPromise(error as Error);
    }
  });
}

/** One header's value, whatever case the answer wrote it in. */
function headerLookup(headers: Record<string, string> | undefined, name: string): string | null {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return null;
}

/** A `Response` built from the wire's answer, so `req()` reads it unchanged. */
function toResponse(message: ResponseMessage): Response {
  const text = message.body ?? "";
  const bytes = message.bodyEncoding === "base64" ? decodeBase64(text) : undefined;
  return {
    ok: (message.status ?? 0) >= 200 && (message.status ?? 0) < 300,
    status: message.status ?? 0,
    statusText: "",
    headers: {
      get: (name: string) => headerLookup(message.headers, name),
    },
    text: async () => (bytes ? new TextDecoder().decode(bytes) : text),
    json: async () => JSON.parse(bytes ? new TextDecoder().decode(bytes) : text),
    arrayBuffer: async () => (bytes ?? new TextEncoder().encode(text)).buffer,
  } as unknown as Response;
}

/** A reader over one open stream, as `sse.ts` expects `response.body.getReader()`. */
function streamResponse(id: number, status: number): Response {
  const decoder = new TextDecoder();
  const read = async (): Promise<{ value?: Uint8Array; done: boolean }> => {
    const stream = streams.get(id);
    if (!stream) return { done: true };
    while (stream.queue.length === 0 && !stream.ended && !stream.cancelled) {
      await new Promise<void>((resolve) => stream.waiters.push(resolve));
    }
    if (stream.cancelled) return { done: true };
    const chunk = stream.queue.shift();
    if (chunk === undefined) {
      streams.delete(id);
      return { done: true };
    }
    return { value: new TextEncoder().encode(chunk), done: false };
  };

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read,
        cancel: async () => {
          const stream = streams.get(id);
          if (stream) {
            stream.cancelled = true;
            wake(stream);
          }
          cancel(id);
        },
      }),
    },
  } as unknown as Response;
}

/** Tells the host to drop a request or stream it is still serving. */
function cancel(id: number): void {
  if (!child || !ready) return;
  try {
    child.write(`${JSON.stringify({ id, cancel: true })}\n`);
  } catch {
    // The agent is gone.
  }
  pending.delete(id);
  streams.delete(id);
}

/** The window's own answer (`src/local`), as the `Response` shape `req()` reads. */
function fromLocal(reply: LocalResponse): Response {
  if (!reply.stream) {
    return toResponse({
      id: 0,
      status: reply.status,
      headers: reply.headers,
      body: reply.body ?? "",
    });
  }

  const queue: string[] = [];
  const waiters: Array<() => void> = [];
  let ended = false;
  let cancelled = false;
  const wake = (): void => {
    for (const resolve of waiters.splice(0)) resolve();
  };
  let markClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    markClosed = resolve;
  });
  let cleanup: (() => void) | null = null;
  try {
    cleanup = reply.stream({
      emit: (chunk: string) => {
        if (ended) return;
        queue.push(chunk);
        wake();
      },
      end: () => {
        if (ended) return;
        ended = true;
        markClosed();
        try {
          cleanup?.();
        } catch {
          // The stream is over.
        }
        wake();
      },
      closed,
    });
  } catch {
    ended = true;
  }

  const read = async (): Promise<{ value?: Uint8Array; done: boolean }> => {
    while (queue.length === 0 && !ended) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    const chunk = queue.shift();
    if (chunk === undefined) return { done: true };
    return { value: new TextEncoder().encode(chunk), done: false };
  };

  return {
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    statusText: "",
    headers: { get: (name: string) => headerLookup(reply.headers, name) },
    body: {
      getReader: () => ({
        read,
        cancel: async () => {
          if (cancelled) return;
          cancelled = true;
          ended = true;
          markClosed();
          try {
            cleanup?.();
          } catch {
            // The stream is over.
          }
          wake();
        },
      }),
    },
  } as unknown as Response;
}

/**
 * `fetch` over the pipe. Same signature and the same `Response` shape, so
 * `client.ts` and `sse.ts` treat it exactly as they treated the network — and a
 * build without an agent (the browser target, a dev run against `next dev`)
 * still goes to the old endpoint.
 */
export async function agentFetch(input: string | Request | URL, init: RequestInit = {}): Promise<Response> {
  const url = pathOf(String(input));
  const headers = headerObject(init);
  const method = (init.method ?? "GET").toUpperCase();

  // The window answers first (`src/local`): attached mode has no server behind
  // the pipe, and a ported route should not need one. `null` means no module
  // owns this path yet — then the pipe (a dev build) or the endpoint below.
  //
  // A `FormData` body (a file upload) becomes the multipart bytes the browser
  // would have written, so a local route can read it; the boundary rides in the
  // content type.
  const wire = await wireBody(init.body);
  const localHeaders = wire?.contentType ? { ...headers, "content-type": wire.contentType } : headers;
  const local = await handleLocally(url, {
    method,
    headers: localHeaders,
    body: typeof init.body === "string" ? init.body : null,
    bytes: wire?.encoding === "base64" ? decodeBase64(wire.text) : undefined,
    contentType: wire?.contentType,
    signal: init.signal ?? undefined,
  });
  if (local !== null) return fromLocal(local);

  if (!child || !ready) {
    // A route the window does not answer yet: in an attached build the bundled
    // server starts now, not at launch (and a dev run has its own server).
    if (!(attached && (await ensureHost()))) {
      // No host to fall back to (a build without one, or a failed start).
      return endpointFetch(url, init);
    }
  }
  // The host that `ensureHost()` just started; without it, the endpoint.
  if (!child || !ready) return endpointFetch(url, init);

  const body = wire;
  if (body?.contentType && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = body.contentType;
  }

  if (/text\/event-stream/i.test(headers.Accept ?? headers.accept ?? "")) {
    const id = nextId++;
    const stream: StreamState = { queue: [], ended: false, waiters: [], cancelled: false };
    streams.set(id, stream);
    try {
      child.write(`${JSON.stringify({ id, path: url, method, headers, stream: true })}\n`);
    } catch (error) {
      streams.delete(id);
      throw error;
    }
    return streamResponse(id, 200);
  }

  const message = await call({ path: url, method, headers, body });
  return toResponse(message);
}
