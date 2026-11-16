// Session reads: the list, one session, the search, the usage summary.
//
// Shapes come from the routes themselves (quoted in `types.ts`). The one
// narrowing here is the list row: the sidebar only browses `id/path/cwd/name/
// modified/messageCount`, and needs to know whether the session is running,
// which the server reports separately as `runningSessionIds` — so `running`
// is folded in here instead of every caller rebuilding the set.

import { ApiError, api, postJson, req, segment, withQuery, withToken, type RequestOptions } from "./client";
import type {
  SessionContext,
  SessionInfo as WireSessionInfo,
  SessionSearchResponse,
  SessionStatsResponse,
  SessionSummaryView,
  SessionUsageSummary,
  SessionView,
  SessionsResponse,
} from "./types";

/**
 * One row as the UI reads it. Every field is a server field of
 * `lib/types.ts:357`; `running` is the client's fold of `runningSessionIds`.
 */
export interface SessionInfo {
  id: string;
  path: string;
  cwd: string;
  name?: string;
  modified: string;
  messageCount?: number;
  running?: boolean;
  // The rest of the wire row (`lib/types.ts:357`), kept by the spread in
  // `toSessionInfo`. The sidebar groups by project and knows a transient
  // session by these.
  created?: string;
  firstMessage?: string;
  /** `?summary=1`: only header/stat metadata so far; `modified` is not trusted for archive. */
  detailsPending?: boolean;
  /** The runtime session exists only in memory; no file yet. */
  transient?: boolean;
  /** Main repo root shared by the worktrees of `cwd`. */
  projectRoot?: string;
  /** Internal, stable project identity (Windows keys case- and separator-insensitive). */
  projectKey?: string;
  parentSessionId?: string;
}

export interface SessionListOptions {
  /** `?force=1`: rescan the session directory instead of serving the cached list. */
  force?: boolean;
  /** `?summary=1`: header/stat metadata only, so the sidebar paints before every transcript is parsed. */
  summary?: boolean;
}

export interface SessionListResult {
  sessions: SessionInfo[];
  /** Bumped by every server-side list mutation; a poll compares it to skip a refresh. */
  sessionListVersion: number;
}

/** Widens a wire row, keeping its extra fields (firstMessage, projectRoot, relation…) for later screens. */
function toSessionInfo(session: WireSessionInfo, running: boolean): SessionInfo {
  return { ...session, running };
}

/**
 * `GET /api/sessions`. In `summary` mode a row may still be `detailsPending`;
 * `running` is folded from the response's `runningSessionIds`.
 */
export async function listSessions(options: SessionListOptions = {}): Promise<SessionListResult> {
  const data = await req<SessionsResponse>(withQuery("/api/sessions", {
    force: options.force ? 1 : undefined,
    summary: options.summary ? 1 : undefined,
  }));
  const running = new Set(Array.isArray(data.runningSessionIds) ? data.runningSessionIds : []);
  const sessions = (Array.isArray(data.sessions) ? data.sessions : []).map((session) =>
    toSessionInfo(session, running.has(session.id))
  );
  return { sessions, sessionListVersion: typeof data.sessionListVersion === "number" ? data.sessionListVersion : 0 };
}

export interface ReadSessionOptions extends RequestOptions {
  /** `?force=1`: probe the disk and rebuild a stale in-memory wrapper (session mount / refresh). */
  force?: boolean;
  /** `?tail=N`: only the last N entries (the subagent viewer pages this way; the chat does not). */
  tail?: number;
  /** `?tree=summary`: a tree of entry stubs instead of full entries (much smaller for big sessions). */
  summaryTree?: boolean;
  /** `?leafId=`: read another branch of the session (a branch switch) instead of its leaf. */
  leafId?: string | null;
  /** `?deferThinking`: historical thinking as previews; full text is fetched per entry on demand. */
  deferThinking?: boolean;
  /** `?deferMedia`: historical tool-result images as lazy URLs instead of base64. */
  deferMedia?: boolean;
}

/**
 * `GET /api/sessions/[id]` — the whole active branch of one session (messages,
 * tree, stats, revision). Throws `ApiError` with status 404 when the session
 * is gone.
 */
export function readSession(
  sessionId: string,
  options: ReadSessionOptions & { summaryTree: true },
): Promise<SessionSummaryView>;
export function readSession(sessionId: string, options?: ReadSessionOptions): Promise<SessionView>;
export async function readSession(
  sessionId: string,
  options: ReadSessionOptions = {},
): Promise<SessionView | SessionSummaryView> {
  const { base, token, signal, timeoutMs, force, tail, summaryTree, leafId, deferThinking, deferMedia } = options;
  const path = withQuery(`/api/sessions/${segment(sessionId)}`, {
    force: force ? 1 : undefined,
    tail: tail !== undefined && tail > 0 ? tail : undefined,
    tree: summaryTree ? "summary" : undefined,
    leafId: leafId ?? undefined,
    deferThinking: deferThinking ? 1 : undefined,
    deferMedia: deferMedia ? 1 : undefined,
  });
  return req<SessionView | SessionSummaryView>(path, {}, { base, token, signal, timeoutMs });
}

/**
 * `GET /api/sessions/search?q=`. A query over 200 characters is refused with
 * a 400 (`app/api/sessions/search/route.ts:8-11`), which surfaces as an
 * `ApiError`; `truncated` means the server's 3 s / 30-hit budget ran out.
 */
export function searchSessions(query: string, options: RequestOptions = {}): Promise<SessionSearchResponse> {
  const path = withQuery("/api/sessions/search", { q: query.trim() });
  return req<SessionSearchResponse>(path, {}, options);
}

/**
 * `PATCH /api/sessions/[id]` body `{ name }`
 * (`app/api/sessions/[id]/route.ts:183-213`): renames in a live wrapper, else
 * appends a `session_info` entry to the file. 404 when the session is gone.
 */
export async function renameSession(sessionId: string, name: string, options: RequestOptions = {}): Promise<void> {
  await req<{ ok: true }>(
    `/api/sessions/${segment(sessionId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
    options,
  );
}

/**
 * `DELETE /api/sessions/[id]` (`app/api/sessions/[id]/route.ts:215-229`): the
 * session and the subagent sessions below it; 404 when it was already gone.
 */
export async function deleteSession(sessionId: string, options: RequestOptions = {}): Promise<void> {
  await req<{ ok: true }>(`/api/sessions/${segment(sessionId)}`, { method: "DELETE" }, options);
}

/**
 * `POST /api/sessions/delete` body `{ ids }` (`app/api/sessions/delete/route.ts`):
 * a project's "Delete all sessions", the ids in one request (at most 500, the
 * server's `MAX_SESSION_DELETE_IDS`). Sessions that started running since are
 * kept and reported, never stopped (`lib/session-delete.ts:37-44`).
 */
export interface SessionDeleteResult {
  /** Every session removed: the named ones and the subagent sessions below them. */
  deleted: string[];
  /** Named ids with neither a file nor a cached path. */
  missing: string[];
  /** Named ids kept because a session of theirs runs. */
  running: string[];
}

export const MAX_SESSION_DELETE_IDS = 500;

export function deleteSessions(ids: readonly string[], options: RequestOptions = {}): Promise<SessionDeleteResult> {
  return postJson<SessionDeleteResult>("/api/sessions/delete", { ids: [...ids] }, options);
}

/** `POST /api/sessions/[id]/fork` answer (`app/api/sessions/[id]/fork/route.ts:29-34`). */
export interface SessionForkResult {
  sessionId: string;
  /** The new session's catalogue row, as `GET /api/sessions` lists it. */
  session: WireSessionInfo;
}

/**
 * `POST /api/sessions/[id]/fork` body `{}`
 * (`app/api/sessions/[id]/fork/route.ts:36-97`): copies the session's current
 * branch into a new session file, leaving the source untouched. A refusal is
 * `ApiError` with `code` `not_found` / `unsaved` / `empty` / `subagent` /
 * `request-denied`.
 */
export function forkSession(sessionId: string, options: RequestOptions = {}): Promise<SessionForkResult> {
  return postJson<SessionForkResult>(`/api/sessions/${segment(sessionId)}/fork`, {}, options);
}

/**
 * `POST /api/sessions/[id]/fork` body `{ side: true, name? }`
 * (`app/api/sessions/[id]/fork/route.ts:36-97`): forks the branch into a side
 * chat. The copy keeps the parent's tool pin and gains the hidden boundary
 * message (`docs/agents/side-sessions.md`). A refusal is `ApiError` with the
 * same `not_found` / `unsaved` / `empty` / `subagent` / `request-denied`
 * codes as a plain fork.
 */
export function forkSideSession(
  sessionId: string,
  name?: string,
  options: RequestOptions = {},
): Promise<SessionForkResult> {
  return postJson<SessionForkResult>(
    `/api/sessions/${segment(sessionId)}/fork`,
    name ? { side: true, name } : { side: true },
    options,
  );
}

/** `GET /api/sessions/[id]/context` answer (`app/api/sessions/[id]/context/route.ts:36`). */
export interface SessionContextPage {
  context: SessionContext;
  /** The `?tail=` the server applied (clamped at 1000, 0 = the whole branch). */
  tail: number;
  /** The entry the page stopped at, or `null` for the newest page. */
  before: string | null;
}

export interface SessionContextOptions extends RequestOptions {
  /** The oldest entry already on screen: the page holds its ancestors, not it (`excludeLeaf`). */
  before?: string | null;
  /** How many ancestors to read; the server clamps at 1000, 0 reads the whole branch. */
  tail?: number;
  /** The branch to read when `before` is not given (the session's leaf by default). */
  leafId?: string | null;
  /** Historical thinking as previews; the full text is fetched per entry on demand. */
  deferThinking?: boolean;
  /** Historical tool-result images as lazy URLs instead of base64. */
  deferMedia?: boolean;
}

/**
 * `GET /api/sessions/[id]/entries/[entryId]/thinking?blockIndex=` — the full
 * text of one thinking block of one assistant message
 * (`app/api/sessions/[id]/entries/[entryId]/thinking/route.ts:4-32`). With
 * `?deferThinking` the read carries only a preview (`deferred: true`); this is
 * how an opened block fetches the rest. The route answers 400 for a missing
 * `blockIndex`, 404 when the session, the assistant message or a thinking
 * block at that index is gone.
 */
export async function readEntryThinking(
  sessionId: string,
  entryId: string,
  blockIndex: number,
  options: RequestOptions = {},
): Promise<string> {
  const path = withQuery(
    `/api/sessions/${segment(sessionId)}/entries/${segment(entryId)}/thinking`,
    { blockIndex },
  );
  const data = await req<{ thinking?: unknown }>(path, {}, options);
  if (typeof data?.thinking !== "string") {
    // A 2xx without the field is not the route's contract; say so instead of
    // showing an empty block.
    throw new ApiError({ status: 502, statusText: "Bad Gateway", body: { error: "Invalid thinking response" } });
  }
  return data.thinking;
}

/**
 * The lazy `src` of a tool-result image
 * (`app/api/sessions/[id]/entries/[entryId]/tool-result-image/route.ts:38-75`).
 * With `?deferMedia` the history read replaces a base64 image with
 * `{ source: { type: "url", url } }` naming this route; the browser loads the
 * bytes when the card is opened. The server has no token, so the URL is made
 * absolute here and carries the LAN token like every other request
 * (`withToken`).
 */
export function toolResultImageUrl(
  sessionId: string,
  entryId: string,
  blockIndex: number,
  options: Pick<RequestOptions, "base" | "token"> = {},
): string {
  const path = withQuery(
    `/api/sessions/${segment(sessionId)}/entries/${segment(entryId)}/tool-result-image`,
    { blockIndex },
  );
  return withToken(
    options.base ?? api.base(),
    path,
    options.token !== undefined ? options.token : api.token(),
  );
}

/**
 * `GET /api/sessions/[id]/context?before=&tail=` — one page of a branch, walking
 * up from `before` (`app/api/sessions/[id]/context/route.ts:8-46`). This is the
 * chat's "earlier messages": the page that ends where the ones on screen begin,
 * with `hasMore` saying whether another one exists above it.
 */
export function readSessionContext(
  sessionId: string,
  options: SessionContextOptions = {},
): Promise<SessionContextPage> {
  const { base, token, signal, timeoutMs, before, tail, leafId, deferThinking, deferMedia } = options;
  const path = withQuery(`/api/sessions/${segment(sessionId)}/context`, {
    before: before ?? undefined,
    leafId: before ? undefined : leafId ?? undefined,
    tail: tail !== undefined && tail > 0 ? tail : undefined,
    deferThinking: deferThinking ? 1 : undefined,
    deferMedia: deferMedia ? 1 : undefined,
  });
  return req<SessionContextPage>(path, {}, { base, token, signal, timeoutMs });
}

/**
 * `POST /api/sessions/stats` body `{ ids }` (at most 200; more is a 400).
 * Answers the map alone, keyed by session id: a session that is gone is
 * simply absent (`app/api/sessions/stats/route.ts:76-87`).
 */
export async function sessionStats(
  sessionIds: readonly string[],
  options: RequestOptions = {},
): Promise<Record<string, SessionUsageSummary>> {
  const ids = [...new Set(sessionIds)].slice(0, 200);
  if (ids.length === 0) return {};
  const data = await postJson<SessionStatsResponse>("/api/sessions/stats", { ids }, options);
  return data.stats ?? {};
}
