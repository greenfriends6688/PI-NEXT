// The local API: the routes this window answers itself, with no server behind
// them.
//
// Until now every `/api/*` call went over the pipe to `host/main.mjs`, the Node
// process that carried pi-web's Next server. Attached mode (`docs/attached.md`)
// replaces that with the pi the machine already has — `pi --mode rpc` for the
// agent, pi's own files for everything else — so each route is answered here, in
// the window's QuickJS.
//
// A route module exports `handle<X>(request)` and answers `null` for any path it
// does not own. `index.ts` asks each module in turn; `link.ts` sends the request
// over the old pipe when none of them answers, so a half-ported build keeps
// working.
import { homedir } from "os";
import process from "process";
import path from "path";
import { readdir } from "fs/promises";

/** One request, already decoded. */
export interface LocalRequest {
  /** `GET`, `POST`, … upper-cased. */
  method: string;
  /** Path and query as the caller wrote them: `/api/sessions?summary=1`. */
  url: string;
  /** The query, parsed. */
  params: URLSearchParams;
  /** `/api/sessions/abc` → `["api", "sessions", "abc"]`, percent-decoded. */
  segments: string[];
  /** The request's headers, lower-cased names. */
  headers: Record<string, string>;
  /** The body as text (`null` when there is none, and always for a binary body). */
  body: string | null;
  /** A binary body — a multipart upload's bytes, boundary included. */
  bytes?: Uint8Array;
  /** The body's content type, which carries a multipart boundary. */
  contentType?: string;
  signal?: AbortSignal;
}

/** A streamed body (SSE), as `/api/agent/[id]/events` needs. */
export interface LocalStream {
  /** Pushes one frame, e.g. `data: {...}\n\n`. */
  emit: (chunk: string) => void;
  /** Ends the stream from this side (the source is gone); the client reconnects
   *  on its own terms instead of waiting for its watchdog. */
  end: () => void;
  /** Resolves when the window stops reading (the stream was cancelled). */
  closed: Promise<void>;
}

/** What a route answers. `stream` and `body` are mutually exclusive. */
export interface LocalResponse {
  status: number;
  headers?: Record<string, string>;
  /** The body as text; use `jsonResponse()` / `errorResponse()`. */
  body?: string;
  /** A stream that runs until the client cancels; returns the cleanup. */
  stream?: (stream: LocalStream) => () => void;
}

export type LocalHandler = (
  request: LocalRequest,
) => Promise<LocalResponse | null> | LocalResponse | null;

/** `{ ... }` with `application/json`. */
export function jsonResponse(value: unknown, status = 200): LocalResponse {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}

/** The `{ error }` shape every pi-web route writes (`src/api/client.ts:ApiErrorBody`). */
export function errorResponse(
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
): LocalResponse {
  return jsonResponse({ error: message, ...extra }, status);
}

/** Plain text, for a file's bytes-as-text or a log. */
export function textResponse(value: string, status = 200, contentType = "text/plain; charset=utf-8"): LocalResponse {
  return { status, headers: { "content-type": contentType }, body: value };
}

/**
 * The app's home directory (`~`).
 *
 * `HOME` first: it is granted to the app by `nsh.json` and is the same string
 * the runtime expands `${homeDir}` to, while `os.homedir()` needs its own
 * `capabilities.homeDir` — which a packaged build drops, so asking for it made
 * every local route fall back to the pipe in the shipped app (and nothing there
 * answered). `homedir()` stays as the fallback for a host without `HOME`.
 */
export function homeDirectory(): string {
  const configured = process.env.HOME as string | undefined;
  if (configured !== undefined && configured.startsWith("/")) return configured;
  return homedir();
}

/** pi's own folder: `~/.pi/agent` (`piConfig.configDir` in pi's package.json). */
export function piAgentDirectory(): string {
  return path.join(homeDirectory(), ".pi", "agent");
}

/** Where pi keeps its sessions: `~/.pi/agent/sessions/<encoded-cwd>/`. */
export function sessionsDirectory(): string {
  return path.join(piAgentDirectory(), "sessions");
}

/**
 * The file of the session with `id`. pi names a session file
 * `<timestamp>_<id>.jsonl` under a per-project folder, so the id is enough to
 * find it (`lib/session-reader.ts:399` in the web app does the same). `null`
 * when the file is not there.
 */
export async function sessionFilePath(id: string): Promise<string | null> {
  if (id === "" || id.includes("/")) return null;
  const suffix = `_${id}.jsonl`;
  const root = sessionsDirectory();
  let projects: string[];
  try {
    projects = await readdir(root);
  } catch {
    return null;
  }
  for (const project of projects) {
    const directory = path.join(root, project);
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith(suffix)) return path.join(directory, entry);
    }
  }
  return null;
}

/** A `catch`-safe message. */
export function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/** `true` when `candidate` is inside `root` (no `..` escapes, no prefix tricks). */
export function isInside(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}
