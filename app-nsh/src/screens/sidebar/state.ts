// The sidebar's own store: what the list shows (pins, archive, project order
// and display names, which groups are folded), the running/awaiting poll and
// the search text. The persisted half lives on the server
// (`/api/sessions/ui-state`, `api/ui-state.ts`); this module keeps the
// session-side copy plus the client-only half (folded groups, the search
// text, unread marks), and the pure rules that turn the session list and that
// state into the rows the panel draws.
//
// Module-level signals are the app's store (`tsx.md` "Signals and writes"):
// the panel, a row and a row's menu read them in their JSX bindings and write
// through the functions here, so they never disagree. The model is pi-next's
// `lib/session-tree.ts`: subagent and side sessions fold under their root
// family (`listSessionFamilies`), a pin or an archive is keyed by that root,
// and each band draws a "show more" window instead of every row at once.
//
// The family relation comes from the wire row's `relation.kind` /
// `relation.parentSessionId` (`lib/types.ts:371-380`, built by
// `lib/session-reader.ts:213-267`); a fork stays a top-level family.

import { computed, signal } from "nsh";
import { runningSnapshot } from "../../api/agent";
import { deleteSessions as deleteSessionsApi, type SessionInfo } from "../../api/sessions";
import {
  readUiState,
  updateUiState,
  type ProjectMovePosition,
  type SessionUiFamilyState,
  type SessionUiState,
  type SessionUiStateRequest,
} from "../../api/ui-state";
import { agentRunning, agentSessionId } from "../../state/agent";
import { errorText } from "../../ui/errors";
import { t } from "../../ui/i18n";

/** How often the sidebar asks `GET /api/agent/running` (pi-next: 2500 ms). */
export const RUNNING_POLL_MS = 2500;
/** The pinned band's key in `collapsedGroups`. */
export const PINNED_GROUP = "__pinned__";
/** An archived project's key prefix in `collapsedGroups` (the live keys stay bare). */
export const ARCHIVE_PREFIX = "archive:";
/** Families a project group shows before "show more" (`GROUP_VISIBLE_LIMIT`). */
export const GROUP_VISIBLE_LIMIT = 6;
/** Families the pinned band shows before "show more" (`PINNED_VISIBLE_LIMIT`). */
export const PINNED_VISIBLE_LIMIT = 8;
/** How many more families one "show more" click reveals (`SHOW_MORE_STEP`). */
export const SHOW_MORE_STEP = 20;
/** `moreShown` entry for the pinned band's "show more". */
export const PINNED_MORE_KEY = "pinned";
/** A project menu's "Archive sessions older than 7 days". */
export const ARCHIVE_OLDER_THAN_MS = 7 * 24 * 60 * 60 * 1000;
/** `POST /api/sessions/ui-state` takes at most this many ids (`MAX_SESSION_UI_IDS_PER_REQUEST`). */
export const SESSION_UI_IDS_PER_REQUEST = 500;
/** `POST /api/sessions/delete` takes at most this many ids (`MAX_SESSION_DELETE_IDS`). */
export const SESSION_DELETE_IDS_PER_REQUEST = 500;

// --- the server's state ----------------------------------------------------

/** The state the server answered with; `null` until the first read. */
export const uiState = signal<SessionUiState | null>(null);
/** A read or write of the state failed; the panel shows it with a Retry. */
export const uiStateError = signal<string | null>(null);
/** The last row action's failure (a fork, a delete), shown under the search field. */
export const actionError = signal<string | null>(null);

/** A thrown value as a line the UI can show (`ui/errors.ts`). */
export { errorText };

export function setActionError(message: string | null): void {
  actionError.set(message);
}

/** Reads the whole state (pins, archive, project order and names). */
export async function refreshUiState(): Promise<void> {
  try {
    uiState.set(await readUiState());
    uiStateError.set(null);
  } catch (error) {
    uiStateError.set(errorText(error));
  }
}

/** Sends one change; the answer is the state after it, the server's rules applied. */
export async function sendUiState(request: SessionUiStateRequest): Promise<boolean> {
  try {
    uiState.set(await updateUiState(request));
    uiStateError.set(null);
    return true;
  } catch (error) {
    uiStateError.set(errorText(error));
    return false;
  }
}

/** `{ action: "set", ids, pinned }`; pinning an archived session restores it. */
export function pinSession(id: string, pinned: boolean): Promise<boolean> {
  return sendUiState({ action: "set", ids: [id], pinned });
}

/** `{ action: "set", ids, archived }`; archiving unpins, unarchiving keeps the rest. */
export function archiveSession(id: string, archived: boolean): Promise<boolean> {
  return sendUiState({ action: "set", ids: [id], archived });
}

/**
 * Archives families in parts of `SESSION_UI_IDS_PER_REQUEST` (the server's
 * `ids` limit): a project's "Archive sessions older than 7 days" may reach
 * more families than one request carries. A refused part ends the run.
 */
export async function archiveSessions(ids: readonly string[]): Promise<boolean> {
  const unique = [...new Set(ids)];
  for (let start = 0; start < unique.length; start += SESSION_UI_IDS_PER_REQUEST) {
    const ok = await sendUiState({
      action: "set",
      ids: unique.slice(start, start + SESSION_UI_IDS_PER_REQUEST),
      archived: true,
    });
    if (!ok) return false;
  }
  return true;
}

/**
 * A project's "Delete all sessions" (`POST /api/sessions/delete`, in parts of
 * the server's 500): every id the confirmation named, subagents included by
 * the server. A running session is kept and comes back in `running`; the ones
 * deleted are hidden at once, so the list cannot show them again while it
 * reloads.
 */
export async function deleteSessions(
  ids: readonly string[],
): Promise<{ deleted: number; running: number } | null> {
  const unique = [...new Set(ids)];
  let deleted = 0;
  let running = 0;
  for (let start = 0; start < unique.length; start += SESSION_DELETE_IDS_PER_REQUEST) {
    try {
      const result = await deleteSessionsApi(unique.slice(start, start + SESSION_DELETE_IDS_PER_REQUEST));
      deleted += result.deleted.length;
      running += result.running.length;
      for (const id of [...result.deleted, ...result.missing]) forgetSession(id);
    } catch (error) {
      setActionError(errorText(error));
      return deleted > 0 || running > 0 ? { deleted, running } : null;
    }
  }
  sessionListVersion.set(-1);
  return { deleted, running };
}

/** `{ action: "pin-project", projectKey, root, pinned }`. */
export function pinProject(key: string, root: string, pinned: boolean): Promise<boolean> {
  return sendUiState({ action: "pin-project", projectKey: key, root, pinned });
}

/**
 * `{ action: "rename-project", projectKey, name }`: an empty name, or the
 * folder's own name, clears the display name (`null`), as pi-next's
 * `projectRenameRequest` does.
 */
export function renameProject(key: string, root: string, value: string): Promise<boolean> {
  const name = value.trim();
  const clear = name === "" || name === projectNameOf(root);
  return sendUiState({ action: "rename-project", projectKey: key, name: clear ? null : name });
}

/**
 * `{ action: "move-project", projectKey, anchorKey, position, add }`: `add`
 * is the whole order on screen, so the move lands where the user saw it even
 * when none of those keys had a saved place yet (`lib/session-ui-state-shared.ts`
 * `withProjectMoved`).
 */
export function moveProject(
  key: string,
  anchor: string,
  position: ProjectMovePosition,
  add: readonly string[],
): Promise<boolean> {
  return sendUiState({ action: "move-project", projectKey: key, anchorKey: anchor, position, add: [...add] });
}

// --- the running poll ------------------------------------------------------

/** Sessions a runtime wrapper is running right now. */
export const runningIds = signal<string[]>([]);
/**
 * The poll's running set, plus the open session while its live stream says a
 * prompt is running. The stream starts the spinner with the prompt and stops
 * it at `prompt_done` / `agent_settled`, not at the next poll.
 */
export const liveRunningIds = computed<string[]>(() => {
  const polled = runningIds();
  const live = agentSessionId();
  return agentRunning() && live !== null && !polled.includes(live) ? [...polled, live] : polled;
});
/** Sessions parked on an extension's blocking dialog (a subset of `runningIds`). */
export const awaitingIds = signal<string[]>([]);
/** The server's list version, so the panel reloads when a session appeared or went. */
export const sessionListVersion = signal<number>(-1);

/** One `GET /api/agent/running`; also reloads the UI state when another window changed it. */
export async function refreshRunning(): Promise<void> {
  try {
    const snapshot = await runningSnapshot();
    runningIds.set(Array.isArray(snapshot.runningSessionIds) ? snapshot.runningSessionIds : []);
    awaitingIds.set(Array.isArray(snapshot.awaitingInputSessionIds) ? snapshot.awaitingInputSessionIds : []);
    sessionListVersion.set(typeof snapshot.sessionListVersion === "number" ? snapshot.sessionListVersion : -1);
    const revision = snapshot.sessionUiStateRevision;
    if (typeof revision === "number" && revision !== uiState()?.revision) await refreshUiState();
  } catch {
    // A poll that failed keeps the last snapshot: the next one catches up.
  }
}

/**
 * Starts the poll and answers its stop (`cleanup(stop)` in the panel's effect).
 *
 * TODO(nsh): pi-next skips a poll while the window is not visible
 * (`document.visibilityState`); nsh has no visibility signal here, so this
 * one keeps asking every `RUNNING_POLL_MS` while the panel is mounted.
 */
export function startRunningPoll(): () => void {
  let stopped = false;
  const tick = () => {
    if (!stopped) void refreshRunning();
  };
  tick();
  const timer = setInterval(tick, RUNNING_POLL_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

// --- the sidebar's own choices --------------------------------------------

/** The search text (`""` lists every session). */
export const sessionFilter = signal("");

export function setSessionFilter(value: string): void {
  sessionFilter.set(value);
}

/** Whether the archive view (the archived sessions) is on screen instead of the tree. */
export const archiveView = signal(false);

export function openArchive(): void {
  archiveView.set(true);
}

export function closeArchive(): void {
  archiveView.set(false);
}

/** Project groups (and the pinned band, by `PINNED_GROUP`) the user folded away. */
export const collapsedGroups = signal<string[]>([]);

export function isGroupOpen(key: string): boolean {
  return !collapsedGroups().includes(key);
}

export function toggleGroup(key: string): void {
  const keys = collapsedGroups();
  if (keys.includes(key)) {
    collapsedGroups.set(keys.filter((folded) => folded !== key));
    return;
  }
  collapsedGroups.set([key, ...keys]);
  // A group opened again shows its first rows, not the window it had.
  const shownKey = key === PINNED_GROUP ? PINNED_MORE_KEY : key;
  const shown = moreShown();
  if (Object.prototype.hasOwnProperty.call(shown, shownKey)) {
    const next = { ...shown };
    delete next[shownKey];
    moreShown.set(next);
  }
}

/**
 * Families whose subagent rows are open, by root id. Expanded belongs to
 * looking, not to the data: pi-next keeps it in the sidebar's own state
 * (`expandedFamilies`), defaulting to folded.
 */
export const expandedFamilies = signal<string[]>([]);

export function isFamilyExpanded(rootId: string): boolean {
  return expandedFamilies().includes(rootId);
}

export function toggleFamily(rootId: string): void {
  const ids = expandedFamilies();
  expandedFamilies.set(ids.includes(rootId) ? ids.filter((id) => id !== rootId) : [rootId, ...ids]);
}

/** Families revealed past the base limit by "show more", per project key or `PINNED_MORE_KEY`. */
export const moreShown = signal<Record<string, number>>({});

/** Positions "show more" opened past the base limit for `key` (0 when none or malformed). */
export function shownMoreFor(shown: Readonly<Record<string, number>>, key: string): number {
  if (!Object.prototype.hasOwnProperty.call(shown, key)) return 0;
  const value = shown[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** One "show more" click for `key`: the window its more row offered. */
export function showMore(key: string, nextShown: number): void {
  const current = moreShown();
  const value = Math.max(shownMoreFor(current, key), Number.isFinite(nextShown) ? Math.floor(nextShown) : 0);
  moreShown.set({ ...current, [key]: value });
}

/** "Show less": back to the base limit for `key`. */
export function showLess(key: string): void {
  const current = moreShown();
  if (!Object.prototype.hasOwnProperty.call(current, key)) return;
  const next = { ...current };
  delete next[key];
  moreShown.set(next);
}

/**
 * Sessions this window deleted: hidden from the model at once, so the
 * auto-open effect cannot pick one again while the list reloads. The next list
 * no longer holds them; the ids stay harmlessly.
 */
export const removedSessionIds = signal<string[]>([]);

export function forgetSession(id: string): void {
  const ids = removedSessionIds();
  if (!ids.includes(id)) removedSessionIds.set([...ids, id]);
}

/** Sessions with new activity the user has not opened yet (client-side, like pi-next's). */
export const unreadIds = signal<string[]>([]);

export function markRead(id: string): void {
  const ids = unreadIds();
  if (!ids.includes(id)) return;
  unreadIds.set(ids.filter((item) => item !== id));
}

/** Opens a family: every member's mark goes, as pi-next's `markFamilyRead` does. */
export function markReadMany(sessionIds: readonly string[]): void {
  if (sessionIds.length === 0) return;
  const drop = new Set(sessionIds);
  const ids = unreadIds();
  const next = ids.filter((id) => !drop.has(id));
  if (next.length !== ids.length) unreadIds.set(next);
}

/** The `modified` each session had when it was last seen, to spot new activity. */
const lastModified = new Map<string, string>();

/**
 * Marks a session unread when its `modified` moved since the last look, unless
 * it is the one on screen. The first list records without marking anything, so
 * a cold start does not turn every row into an unread dot.
 *
 * TODO(nsh): keep the marks across launches as pi-next does
 * (`pi-web:unread-session-ids` in localStorage); `prefs.ts` has no array
 * helper for it yet.
 */
export function noteActivity(sessions: readonly SessionInfo[], selectedId: string | null): void {
  const unread = new Set(unreadIds());
  let changed = false;
  for (const session of sessions) {
    const previous = lastModified.get(session.id);
    if (previous === undefined) {
      lastModified.set(session.id, session.modified);
      continue;
    }
    if (previous === session.modified) continue;
    lastModified.set(session.id, session.modified);
    if (session.id === selectedId || unread.has(session.id)) continue;
    unread.add(session.id);
    changed = true;
  }
  if (changed) unreadIds.set([...unread]);
}

// --- sessions and their families ------------------------------------------

/**
 * A session's relation on the wire (`lib/types.ts:371-380`). A fork stays a
 * top-level family of its own; a `subagent` or `side` session is a hidden
 * member of the session in `parentSessionId`.
 */
export interface SessionRelation {
  kind: "fork" | "subagent" | "side";
  parentSessionId?: string;
  profile?: string;
  description?: string;
  status?: string;
  originSessionId?: string;
}

/** The row plus the relation `api/sessions.ts` keeps by its spread but does not type. */
type RelationalSession = SessionInfo & { relation?: SessionRelation };

function relationOf(session: SessionInfo): SessionRelation | undefined {
  return (session as RelationalSession).relation;
}

/** The parent a hidden (subagent / side) session belongs to, else null. */
function hiddenParentOf(session: SessionInfo): string | null {
  const relation = relationOf(session);
  if (!relation || (relation.kind !== "subagent" && relation.kind !== "side")) return null;
  // `relation.parentSessionId` is the wire field; the row's own id is the fallback.
  const parent = relation.parentSessionId ?? session.parentSessionId;
  return typeof parent === "string" && parent.length > 0 ? parent : null;
}

/** A root session with every hidden descendant the list holds. */
export interface SessionFamily {
  root: SessionInfo;
  /** Subagent runs and side chats of the root, oldest first. */
  members: SessionInfo[];
  /** The root and its members, root first. */
  sessions: SessionInfo[];
  /** The newest `modified` of the family: what orders it and dates its row. */
  latestModified: string;
}

/** Every session id of a family, the root first. */
export function familyIds(family: SessionFamily): string[] {
  return [family.root.id, ...family.members.map((session) => session.id)];
}

/**
 * `listSessionFamilies` (`lib/session-family.ts:66-100`): every session
 * without a hidden relation is a root; a hidden member follows
 * `relation.parentSessionId` (nested subagents included) to its root. Forks
 * stay roots. A member whose root is not in the list (or a broken cycle)
 * stands alone rather than vanishing. Families sort newest first by
 * `latestModified`; members oldest first, as pi-next's subagent rows.
 */
export function listSessionFamilies(sessions: readonly SessionInfo[]): SessionFamily[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const rootOf = new Map<string, string>();
  const resolve = (start: string): string => {
    const cachedRoot = rootOf.get(start);
    if (cachedRoot !== undefined) return cachedRoot;
    const path: string[] = [];
    const visited = new Set<string>();
    let current = start;
    while (true) {
      const cached = rootOf.get(current);
      if (cached !== undefined) {
        for (const id of path) rootOf.set(id, cached);
        return cached;
      }
      if (visited.has(current)) break;
      visited.add(current);
      path.push(current);
      const session = byId.get(current);
      if (!session) break;
      const parent = hiddenParentOf(session);
      if (parent === null) {
        for (const id of path) rootOf.set(id, current);
        return current;
      }
      if (!byId.has(parent)) break;
      current = parent;
    }
    // No root in this list: the member stands alone as its own family.
    for (const id of path) rootOf.set(id, start);
    return start;
  };
  for (const session of sessions) resolve(session.id);

  const families = new Map<string, SessionFamily>();
  for (const session of sessions) {
    if (rootOf.get(session.id) !== session.id) continue;
    families.set(session.id, {
      root: session,
      members: [],
      sessions: [session],
      latestModified: session.modified,
    });
  }
  for (const session of sessions) {
    const rootId = rootOf.get(session.id);
    if (rootId === undefined || rootId === session.id) continue;
    const family = families.get(rootId);
    if (!family) continue;
    family.members.push(session);
    if (session.modified > family.latestModified) family.latestModified = session.modified;
  }
  for (const family of families.values()) {
    const ordered = family.members
      .map((session, index) => ({ session, index, at: timeOf(session.modified) }))
      .sort((a, b) => oldestFirst(a.at, b.at) || a.index - b.index)
      .map(({ session }) => session);
    family.members = ordered;
    family.sessions = [family.root, ...ordered];
  }
  return [...families.values()]
    .map((family, index) => ({ family, index }))
    .sort((a, b) => b.family.latestModified.localeCompare(a.family.latestModified) || a.index - b.index)
    .map(({ family }) => family);
}

/** A member row's title: its description or profile, its name, else its path's last part. */
export function familyMemberTitleOf(session: SessionInfo): string {
  const relation = relationOf(session);
  const label = relation?.description?.trim() || relation?.profile?.trim();
  if (label) return label;
  const name = session.name?.trim();
  if (name) return name;
  return relation?.kind === "side" ? t("sideChat.title") : sessionTitleOf(session);
}

// --- flags -----------------------------------------------------------------

/** A session's flags, never through `Object.prototype` (`constructor` is a valid id). */
function flagsOf(state: SessionUiState | null, id: string): SessionUiFamilyState | undefined {
  if (!state || !Object.prototype.hasOwnProperty.call(state.sessions, id)) return undefined;
  return state.sessions[id];
}

/** A project's stored entry, with the same own-property guard. */
function projectOf(state: SessionUiState | null, key: string) {
  if (!state || !Object.prototype.hasOwnProperty.call(state.projects, key)) return undefined;
  return state.projects[key];
}

/** `workspaceKeyOf` (`lib/workspace-memory.ts:92-98`): projectKey, else projectRoot, else cwd. */
export function workspaceKeyOf(session: SessionInfo): string {
  return session.projectKey ?? session.projectRoot ?? session.cwd;
}

/** The folder a project shows and pins: its repo root when known, else the session's cwd. */
export function projectRootOf(session: SessionInfo): string {
  return session.projectRoot ?? session.cwd;
}

/** Last path segment of a project root, for `/` and `\` paths alike (`projectNameOf`). */
export function projectNameOf(root: string): string {
  const trimmed = root.replace(/[\\/]+$/, "");
  if (!trimmed) return root.charAt(0) || t("sidebar.tabSessions");
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return trimmed.slice(separator + 1);
}

/** How much of a first message a row title keeps before the ellipsis. */
const SESSION_TITLE_MAX = 60;

/**
 * A first message as a row-sized title. Whitespace and newlines collapse to
 * one space so a multi-line prompt stays on the row, and a long prompt is cut
 * at 60 units with an ellipsis; the cut backs off a high surrogate so an emoji
 * is never split. `(no messages)` is the wire's empty-session sentinel, not a
 * prompt, so it leaves the caller's path fallback in place.
 */
function firstMessageTitle(firstMessage: string | undefined): string {
  if (!firstMessage || firstMessage === "(no messages)") return "";
  const line = firstMessage.replace(/\s+/g, " ").trim();
  if (!line) return "";
  if (line.length <= SESSION_TITLE_MAX) return line;
  // Keep the ellipsis inside the cap: 59 units of text and one for the mark.
  let end = SESSION_TITLE_MAX - 1;
  const last = line.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${line.slice(0, end).trimEnd()}…`;
}

/**
 * A row's title: an explicit rename, else the first user message on one line,
 * else the last part of the session's path. The path keeps the old fallback
 * for an empty or image-only session, where there is no prompt to show.
 */
export function sessionTitleOf(session: SessionInfo): string {
  const name = session.name?.trim();
  if (name) return name;
  const firstMessage = firstMessageTitle(session.firstMessage);
  if (firstMessage) return firstMessage;
  const parts = session.path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? session.id;
}

/** A project's display name: the user's own, else its folder's. */
export function projectTitle(state: SessionUiState | null, key: string, root: string): string {
  const names = state?.projectNames;
  const name = names && Object.prototype.hasOwnProperty.call(names, key) ? names[key] : undefined;
  return name && name.trim() ? name : projectNameOf(root);
}

function timeOf(iso: string | undefined): number {
  const time = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(time) ? -Infinity : time;
}

/** Newest first; equal values keep their order (`a - b` would give NaN at ±Infinity). */
function newestFirst(a: number, b: number): number {
  return a === b ? 0 : a > b ? -1 : 1;
}

/** Oldest first, safe at ±Infinity (the subagent rows' order). */
function oldestFirst(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function anyMemberIn(family: SessionFamily, ids: ReadonlySet<string>): boolean {
  if (ids.size === 0) return false;
  return ids.has(family.root.id) || family.members.some((session) => ids.has(session.id));
}

function anyMemberIs(family: SessionFamily, id: string | null): boolean {
  if (!id) return false;
  return family.root.id === id || family.members.some((session) => session.id === id);
}

/**
 * `isFamilyArchived` (`lib/session-tree.ts:151-162`): `archivedAt` on the
 * root, no member running, and (a summary row whose time is not trusted, or
 * `archivedAt` no older than the root's `modified`). Newer activity on the
 * root brings it back on its own; subagent activity alone does not.
 */
function archivedFamily(family: SessionFamily, state: SessionUiState | null, running: ReadonlySet<string>): boolean {
  const archivedAt = flagsOf(state, family.root.id)?.archivedAt;
  if (typeof archivedAt !== "number" || !Number.isFinite(archivedAt)) return false;
  if (anyMemberIn(family, running)) return false;
  if (family.root.detailsPending) return true;
  const modified = Date.parse(family.root.modified);
  return Number.isNaN(modified) || archivedAt >= modified;
}

/** `isFamilyPinned`: a root `pinnedAt` that is not archived. */
function pinnedFamily(family: SessionFamily, state: SessionUiState | null, running: ReadonlySet<string>): boolean {
  const pinnedAt = flagsOf(state, family.root.id)?.pinnedAt;
  return typeof pinnedAt === "number" && Number.isFinite(pinnedAt) && !archivedFamily(family, state, running);
}

/** A single session's archive state (the row menus act on family roots). */
function archivedNow(session: SessionInfo, state: SessionUiState | null, running: readonly string[]): boolean {
  const archivedAt = flagsOf(state, session.id)?.archivedAt;
  if (typeof archivedAt !== "number" || !Number.isFinite(archivedAt)) return false;
  if (running.includes(session.id)) return false;
  if (session.detailsPending) return true;
  const modified = Date.parse(session.modified);
  return Number.isNaN(modified) || archivedAt >= modified;
}

/** A single session's pin state that is not archived (`isFamilyPinned`). */
function pinnedNow(session: SessionInfo, state: SessionUiState | null, running: readonly string[]): boolean {
  const pinnedAt = flagsOf(state, session.id)?.pinnedAt;
  return typeof pinnedAt === "number" && Number.isFinite(pinnedAt) && !archivedNow(session, state, running);
}

// The live forms the panel and the row menus read in their JSX bindings.
export function isSessionPinned(session: SessionInfo): boolean {
  return pinnedNow(session, uiState(), liveRunningIds());
}

export function isSessionArchived(session: SessionInfo): boolean {
  return archivedNow(session, uiState(), liveRunningIds());
}

export function isSessionRunning(session: SessionInfo): boolean {
  return liveRunningIds().includes(session.id);
}

export function isSessionAwaiting(session: SessionInfo): boolean {
  return awaitingIds().includes(session.id);
}

export function isSessionUnread(session: SessionInfo): boolean {
  return unreadIds().includes(session.id);
}

export function isFamilyPinned(family: SessionFamily): boolean {
  return pinnedFamily(family, uiState(), new Set(liveRunningIds()));
}

export function isFamilyArchived(family: SessionFamily): boolean {
  return archivedFamily(family, uiState(), new Set(liveRunningIds()));
}

/** Any member running: the family row's dot, and what disables Archive. */
export function isFamilyRunning(family: SessionFamily): boolean {
  return anyMemberIn(family, new Set(liveRunningIds()));
}

export function isFamilyAwaiting(family: SessionFamily): boolean {
  return anyMemberIn(family, new Set(awaitingIds()));
}

export function isFamilyUnread(family: SessionFamily): boolean {
  return anyMemberIn(family, new Set(unreadIds()));
}

// --- the model -------------------------------------------------------------

/** One "show more" row's state (`moreRowState` in `lib/session-tree.ts`). */
export interface SidebarMore {
  /** Families still hidden below the window. */
  hidden: number;
  /** "Show less" would fold rows back (only rows "show more" revealed). */
  canShowLess: boolean;
  /** The window one "show more" click opens. */
  nextShown: number;
}

/** One project's session families, as a group header and its rows draw it. */
export interface SidebarGroup {
  /** `workspaceKeyOf`: the project's key in `projectOrder` and `projectNames`. */
  key: string;
  /** Its folder (`projectRoot` when known). */
  root: string;
  /** Its display name (the user's, else the folder's). */
  name: string;
  /** A pinned project: its band comes first, as pi-next orders projects. */
  pinned: boolean;
  /** The families the group shows (its "show more" window). */
  families: SessionFamily[];
  /** Their roots: what the old callers read when they only need a session. */
  sessions: SessionInfo[];
  /** Every matching family of the group, the window and the hidden ones. */
  count: number;
  running: number;
  awaiting: number;
  unread: number;
  /** The "show more" / "show less" row, or null when neither applies. */
  more: SidebarMore | null;
}

export interface SidebarModel {
  /** The pinned band, newest pin first (its "show more" window). */
  pinned: SessionFamily[];
  /** Every pinned family, the window and the hidden ones. */
  pinnedCount: number;
  /** The pinned band's "show more" row, or null. */
  pinnedMore: SidebarMore | null;
  /** The project groups: pinned projects, then the others. */
  groups: SidebarGroup[];
  /** The archived families, grouped by project, newest archive first. */
  archived: SidebarGroup[];
  /** Every archived family, whatever the search text (the footer's count). */
  archivedCount: number;
}

export interface SidebarInput {
  sessions: readonly SessionInfo[];
  state: SessionUiState | null;
  running: readonly string[];
  awaiting: readonly string[];
  unread: readonly string[];
  /** The search text: a family matches when any of its sessions matches by title, folder or project name. */
  query: string;
  /** The session on screen: its family stays in the window and is never bulk-archived. */
  selectedSessionId: string | null;
  /** "show more" windows, by project key or `PINNED_MORE_KEY` (`moreShown`). */
  moreShown: Readonly<Record<string, number>>;
}

interface FamilyFlags {
  running: ReadonlySet<string>;
  awaiting: ReadonlySet<string>;
  unread: ReadonlySet<string>;
  selectedSessionId: string | null;
}

interface FamilyStatus {
  running: boolean;
  awaiting: boolean;
  unread: boolean;
  selected: boolean;
  transient: boolean;
}

function familyStatus(family: SessionFamily, flags: FamilyFlags): FamilyStatus {
  return {
    running: anyMemberIn(family, flags.running),
    awaiting: anyMemberIn(family, flags.awaiting),
    unread: anyMemberIn(family, flags.unread),
    selected: anyMemberIs(family, flags.selectedSessionId),
    transient: family.root.transient === true,
  };
}

/** A folded header's counts follow its families: awaiting wins over running. */
function activityCounts(families: readonly SessionFamily[], flags: FamilyFlags): { running: number; awaiting: number; unread: number } {
  let running = 0;
  let awaiting = 0;
  let unread = 0;
  for (const family of families) {
    const status = familyStatus(family, flags);
    if (status.awaiting) awaiting++;
    else if (status.running) running++;
    if (status.unread) unread++;
  }
  return { running, awaiting, unread };
}

/**
 * The first `limit` families, the `shown` positions "show more" opened past
 * them, and any later family that is running, unread or selected (sorted
 * order kept). Positions, not a budget: a family that turns selected, unread
 * or running inside the window keeps its place and frees nothing. `nextShown`
 * is the window a "show more" click opens, decided at the click:
 * `SHOW_MORE_STEP` more hidden families past this one (those that show anyway
 * do not use up the click), or all that are left.
 */
function windowFamilies(
  families: readonly SessionFamily[],
  limit: number,
  shown: number,
  flags: FamilyFlags,
): { visible: SessionFamily[]; revealed: number; nextShown: number } {
  const flagged = families.map((family, index) => {
    if (index < limit) return false;
    const status = familyStatus(family, flags);
    return status.running || status.unread || status.selected;
  });
  const end = limit + shown;
  let revealed = 0;
  const visible = families.filter((_family, index) => {
    if (index < limit || flagged[index]) return true;
    if (index < end) {
      revealed++;
      return true;
    }
    return false;
  });
  let next = Math.max(limit, Math.min(end, families.length));
  for (let hidden = 0; next < families.length && hidden < SHOW_MORE_STEP; next++) {
    if (!flagged[next]) hidden++;
  }
  return { visible, revealed, nextShown: next - limit };
}

function moreRowState(total: number, visible: number, revealed: number, nextShown: number): SidebarMore | null {
  const hidden = total - visible;
  const canShowLess = revealed > 0;
  return hidden > 0 || canShowLess ? { hidden, canShowLess, nextShown } : null;
}

/**
 * The rows the panel draws: the pinned band, the project groups in the stored
 * order (pinned projects first; projects without a saved place before the
 * saved ones, the ones with a real file before the transient ones, newest
 * activity first), and the archive. A pinned family leaves its project group
 * for the band, as pi-next moves a pinned family out of its group; an archived
 * one leaves the tree for the archive view. Each band shows its first families
 * and a "show more" row, as `lib/session-tree.ts` does.
 */
export function buildSidebarModel(input: SidebarInput): SidebarModel {
  const { state } = input;
  const flags: FamilyFlags = {
    running: new Set(input.running),
    awaiting: new Set(input.awaiting),
    unread: new Set(input.unread),
    selectedSessionId: input.selectedSessionId,
  };
  const query = input.query.trim().toLowerCase();
  const matches = (session: SessionInfo): boolean =>
    !query
    || sessionTitleOf(session).toLowerCase().includes(query)
    || familyMemberTitleOf(session).toLowerCase().includes(query)
    || session.cwd.toLowerCase().includes(query)
    || projectNameOf(projectRootOf(session)).toLowerCase().includes(query);
  const families = listSessionFamilies(input.sessions);

  const pinned: SessionFamily[] = [];
  const live = new Map<string, SessionFamily[]>();
  const archived = new Map<string, { family: SessionFamily; archivedAt: number }[]>();
  const roots = new Map<string, string>();
  const activity = new Map<string, number>();
  const saved = new Set<string>();
  let archivedCount = 0;

  for (const family of families) {
    const key = workspaceKeyOf(family.root);
    if (archivedFamily(family, state, flags.running)) {
      archivedCount++;
      const entry = { family, archivedAt: flagsOf(state, family.root.id)?.archivedAt ?? 0 };
      const list = archived.get(key);
      if (list) list.push(entry);
      else archived.set(key, [entry]);
      continue;
    }
    activity.set(key, Math.max(activity.get(key) ?? -Infinity, timeOf(family.latestModified)));
    if (!family.root.transient) saved.add(key);
    // The list is newest first, so the first family of a key names its folder.
    if (!roots.has(key)) roots.set(key, projectRootOf(family.root));
    if (pinnedFamily(family, state, flags.running)) {
      pinned.push(family);
      continue;
    }
    const list = live.get(key);
    if (list) list.push(family);
    else live.set(key, [family]);
  }

  // Search narrows a family, never splits it: any member's match shows the root.
  const familyMatches = (family: SessionFamily): boolean => family.sessions.some(matches);

  const pinnedAt = (family: SessionFamily) => flagsOf(state, family.root.id)?.pinnedAt ?? 0;
  const pinnedRows = pinned
    .filter(familyMatches)
    .map((family, index) => ({ family, index }))
    .sort((a, b) => newestFirst(pinnedAt(a.family), pinnedAt(b.family)) || a.index - b.index)
    .map(({ family }) => family);
  // A filter shows every match: "show more" is a browsing aid, and hiding a
  // hit behind it would read as "not found" (`SessionSidebar.tsx` filters the
  // whole tree while a query is typed).
  const pinnedWindow = windowFamilies(
    pinnedRows,
    query ? pinnedRows.length : PINNED_VISIBLE_LIMIT,
    query ? pinnedRows.length : shownMoreFor(input.moreShown, PINNED_MORE_KEY),
    flags,
  );
  const pinnedMore = moreRowState(
    pinnedRows.length,
    pinnedWindow.visible.length,
    pinnedWindow.revealed,
    pinnedWindow.nextShown,
  );

  // The saved project order: the first place a key has wins (a duplicate in
  // the file cannot demote it), as `lib/session-tree.ts` ranks them.
  const rank = new Map<string, number>();
  for (const [index, key] of (state?.projectOrder ?? []).entries()) {
    if (!rank.has(key)) rank.set(key, index);
  }
  const entries = [...live.keys()].map((key, index) => {
    const project = projectOf(state, key);
    return {
      key,
      root: roots.get(key) ?? key,
      pinned: project !== undefined,
      index,
      activity: activity.get(key) ?? -Infinity,
      pinnedAt: project?.pinnedAt ?? 0,
    };
  });
  type ProjectEntry = (typeof entries)[number];
  // Projects without a place come first, in the fallback order, the ones not
  // saved on their own (transient only) before the others; then the saved
  // ones by their rank. Activity never moves a project that has a place.
  const band = (list: ProjectEntry[], fallback: (a: ProjectEntry, b: ProjectEntry) => number): ProjectEntry[] => [
    ...list
      .filter((entry) => !rank.has(entry.key))
      .sort((a, b) => Number(saved.has(a.key)) - Number(saved.has(b.key)) || fallback(a, b)),
    ...list
      .filter((entry) => rank.has(entry.key))
      .sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0)),
  ];
  const ordered = [
    ...band(
      entries.filter((entry) => entry.pinned),
      (a, b) => newestFirst(a.pinnedAt, b.pinnedAt) || a.index - b.index,
    ),
    ...band(
      entries.filter((entry) => !entry.pinned),
      (a, b) => newestFirst(a.activity, b.activity) || a.index - b.index,
    ),
  ];

  const groups: SidebarGroup[] = [];
  for (const entry of ordered) {
    const familiesInGroup = (live.get(entry.key) ?? []).filter(familyMatches);
    if (familiesInGroup.length === 0) continue;
    const window = windowFamilies(
      familiesInGroup,
      query ? familiesInGroup.length : GROUP_VISIBLE_LIMIT,
      query ? familiesInGroup.length : shownMoreFor(input.moreShown, entry.key),
      flags,
    );
    const counts = activityCounts(familiesInGroup, flags);
    const more = moreRowState(
      familiesInGroup.length,
      window.visible.length,
      window.revealed,
      window.nextShown,
    );
    groups.push({
      key: entry.key,
      root: entry.root,
      name: projectTitle(state, entry.key, entry.root),
      pinned: entry.pinned,
      families: window.visible,
      sessions: window.visible.map((family) => family.root),
      count: familiesInGroup.length,
      running: counts.running,
      awaiting: counts.awaiting,
      unread: counts.unread,
      more,
    });
  }

  const archivedGroups = [...archived.entries()]
    .map(([key, list], index) => {
      const matching = list.filter(({ family }) => familyMatches(family));
      if (matching.length === 0) return null;
      return {
        key,
        index,
        newest: Math.max(...matching.map((entry) => entry.archivedAt)),
        list: matching
          .map((entry, order) => ({ ...entry, order }))
          .sort((a, b) => newestFirst(a.archivedAt, b.archivedAt) || a.order - b.order),
      };
    })
    .filter((group): group is NonNullable<typeof group> => group !== null)
    .sort((a, b) => newestFirst(a.newest, b.newest) || a.index - b.index)
    .map(({ key, list }): SidebarGroup => {
      const familiesInGroup = list.map((entry) => entry.family);
      const root = projectRootOf(familiesInGroup[0].root);
      const counts = activityCounts(familiesInGroup, flags);
      return {
        key,
        root,
        name: projectTitle(state, key, root),
        pinned: projectOf(state, key) !== undefined,
        families: familiesInGroup,
        sessions: familiesInGroup.map((family) => family.root),
        count: familiesInGroup.length,
        running: counts.running,
        awaiting: counts.awaiting,
        unread: counts.unread,
        more: null,
      };
    });

  return {
    pinned: pinnedWindow.visible,
    pinnedCount: pinnedRows.length,
    pinnedMore,
    groups,
    archived: archivedGroups,
    archivedCount,
  };
}

/**
 * Root ids of live, non-pinned, non-running, non-unread, non-selected
 * families of `projectKey` whose newest activity is older than
 * `now - olderThanMs` (`familiesToArchive`, `lib/session-tree.ts:926-950`).
 * A transient family has no file and is never archived; a summary row's time
 * is not trusted, so an unparsable `latestModified` keeps it too.
 */
export interface ArchiveOlderInput {
  sessions: readonly SessionInfo[];
  state: SessionUiState | null;
  running: readonly string[];
  unread: readonly string[];
  selectedSessionId: string | null;
}

export function familiesToArchive(
  input: ArchiveOlderInput,
  projectKey: string,
  olderThanMs: number,
  now: number,
): string[] {
  const cutoff = now - olderThanMs;
  const running = new Set(input.running);
  const flags: FamilyFlags = {
    running,
    awaiting: new Set(),
    unread: new Set(input.unread),
    selectedSessionId: input.selectedSessionId,
  };
  const ids: string[] = [];
  for (const family of listSessionFamilies(input.sessions)) {
    if (workspaceKeyOf(family.root) !== projectKey) continue;
    if (archivedFamily(family, input.state, running)) continue;
    if (pinnedFamily(family, input.state, running)) continue;
    const status = familyStatus(family, flags);
    if (status.running || status.unread || status.selected || status.transient) continue;
    const modified = Date.parse(family.latestModified);
    if (Number.isNaN(modified) || modified >= cutoff) continue;
    ids.push(family.root.id);
  }
  return ids;
}
