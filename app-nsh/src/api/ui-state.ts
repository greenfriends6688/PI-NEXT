// The sidebar's own state on the server: which sessions are pinned or
// archived, which projects are pinned, their order and the display names the
// user gave them. pi-next keeps it in `pi-web-session-state.json` beside pi's
// own files, never inside a session's `.jsonl`, so the pi CLI does not see it
// (`lib/session-ui-state.ts`); this module is the wire half of
// `lib/session-ui-state-shared.ts` plus the two calls of
// `app/api/sessions/ui-state/route.ts` (GET :31-33, POST :35-71).
//
// The rules — pin and archive exclude each other, an archived session comes
// back when it gets newer activity, a move saves the band's unsaved keys
// first, a display name is one trimmed line — live on the server. The client
// applies the state the POST answers with instead of replaying them, so two
// windows that write at once agree on what is stored.

import { postJson, req, type RequestOptions } from "./client";

export const SESSION_UI_STATE_VERSION = 1;
/** Longest display name a project may take (`MAX_PROJECT_NAME_LENGTH`). */
export const MAX_PROJECT_NAME_LENGTH = 80;

/** One session family's flags, epoch ms (`SessionUiFamilyState`, keyed by the session id). */
export interface SessionUiFamilyState {
  pinnedAt?: number;
  archivedAt?: number;
}

/** One project's state (`SessionUiProjectState`, keyed by projectKey). */
export interface SessionUiProjectState {
  pinnedAt: number;
  root: string;
}

/**
 * The stored state (`SessionUiState`): `sessions` by session id, `projects` by
 * projectKey (`workspaceKeyOf`: projectKey, else projectRoot, else cwd),
 * `projectOrder` top first (absent while empty) and `projectNames` by
 * projectKey (absent while empty).
 */
export interface SessionUiState {
  version: 1;
  /** Bumped by the server on every changing write; a poll compares it. */
  revision: number;
  sessions: Record<string, SessionUiFamilyState>;
  projects: Record<string, SessionUiProjectState>;
  projectOrder?: string[];
  projectNames?: Record<string, string>;
}

/** Where a moved project goes, next to its anchor. */
export type ProjectMovePosition = "before" | "after";

/**
 * Every change `POST /api/sessions/ui-state` takes (`SessionUiStateRequest`).
 * `set` carries exactly one of `pinned` / `archived`; a project's name is
 * `null` to clear it (the folder name shows again).
 */
export type SessionUiStateRequest =
  | { action: "set"; ids: string[]; pinned: boolean }
  | { action: "set"; ids: string[]; archived: boolean }
  | { action: "pin-project"; projectKey: string; root: string; pinned: boolean }
  | { action: "add-projects"; keys: string[] }
  | { action: "move-project"; projectKey: string; anchorKey: string; position: ProjectMovePosition; add: string[] }
  | { action: "rename-project"; projectKey: string; name: string | null };

/** `GET` / `POST` answer (`SessionUiStateResponse`). */
export interface SessionUiStateResponse {
  state: SessionUiState;
}

/** Why the route refused (`SessionUiStateRefusalReason`); `error` says it in words. */
export type SessionUiStateRefusalReason =
  | "request-denied"
  | "content-type"
  | "invalid-request"
  | "full"
  | "locked"
  | "internal";

export interface SessionUiStateErrorResponse {
  error: string;
  reason: SessionUiStateRefusalReason;
}

/** The state before anything was stored (a missing file reads as this). */
export function emptyUiState(): SessionUiState {
  return { version: SESSION_UI_STATE_VERSION, revision: 0, sessions: {}, projects: {} };
}

/**
 * `GET /api/sessions/ui-state` — the whole state, `Cache-Control: no-store`.
 * Ids and project keys are not checked against the session list: an entry for
 * a session that is gone is harmless.
 */
export async function readUiState(options: RequestOptions = {}): Promise<SessionUiState> {
  const data = await req<SessionUiStateResponse>("/api/sessions/ui-state", {}, options);
  return data.state;
}

/**
 * `POST /api/sessions/ui-state` — one change, answers with the state after it
 * (the server's own rules applied). Throws `ApiError` with the route's
 * `{ error, reason }` body otherwise; `reason` is `"full"` when no room was
 * left for another project name.
 */
export async function updateUiState(
  request: SessionUiStateRequest,
  options: RequestOptions = {},
): Promise<SessionUiState> {
  const data = await postJson<SessionUiStateResponse>("/api/sessions/ui-state", request, options);
  return data.state;
}
