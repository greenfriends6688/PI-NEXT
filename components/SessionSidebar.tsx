"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useState, useCallback, useMemo, useRef, type MouseEvent as ReactMouseEvent, type ReactNode, type Ref, type RefObject, type UIEvent as ReactUIEvent } from "react";
import type { SessionInfo } from "@/lib/types";
import { listSessionFamilies, type SessionFamily } from "@/lib/session-family";
import { dispatchSessionRowContextMenu } from "@/lib/session-row-context-menu";
import { newSessionDeepLink, sessionDeepLink } from "@/lib/session-links";
import { getProjectActivity, getRecentProjects } from "@/lib/project-groups";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import {
  adjacentProjectMove,
  archivedFamilyIds,
  buildArchiveRows,
  buildSessionTree,
  effectiveGroupExpansion,
  familiesToArchive,
  familiesToDelete,
  familyIds,
  forgetKeptOpenGroups,
  forgetShownMoreOfFolded,
  isFamilyArchived,
  isGroupExpanded,
  keepOutgoingGroupOpen,
  nextProjectKeysToRecord,
  PINNED_MORE_KEY,
  showLessFamilies,
  showMoreFamilies,
  type SidebarProject,
  type SidebarRow,
} from "@/lib/session-tree";
import {
  forgetRetiredSidebarKeys,
  loadArchiveCollapsed,
  loadGroupExpansion,
  loadNonGitCwds,
  loadPinnedCollapsed,
  rememberCwdGitStatus,
  saveArchiveCollapsed,
  saveGroupExpansion,
  savePinnedCollapsed,
} from "@/lib/sidebar-prefs";
import {
  deleteProjectSessions,
  forkFailureMessage,
  projectNameMenuEntries,
  projectRenameRequest,
  sessionMenuEntries,
  type SessionMenuActionId,
} from "@/lib/sidebar-actions";
import { splitBeforeForkSuffix } from "@/lib/session-fork-name";
import {
  mergeProjectChoices,
  newSessionContextKey,
  newSessionTargetForProject,
  projectForCwd,
  withProjectAlias,
  type NewSessionContext,
  type NewSessionOptions,
  type NewSessionTarget,
  type ProjectChoice,
  type WorktreeChoice,
} from "@/lib/new-session-context";
import {
  chunkForSessionUiRequests,
  MAX_PROJECT_ORDER_KEYS,
  MAX_SESSION_UI_IDS_PER_REQUEST,
  type ProjectMovePosition,
  type SessionUiStateRequest,
} from "@/lib/session-ui-state-shared";
import { focusIfLost, type FocusDocument } from "@/lib/stacked-dialog";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useSessionUiState } from "@/hooks/useSessionUiState";
import { archiveViewState, useSidebarMotion } from "@/hooks/useSidebarMotion";
import { DirectoryPicker } from "./DirectoryPicker";
import { pickDirectoryNatively } from "@/lib/desktop-shell";
import type { WorktreeRemoval } from "./ProjectWorktreePicker";
import { DismissButton } from "./DismissButton";
import { PiWebTitle } from "./PiWebTitle";
import { SidebarTools } from "./shell/SidebarTools";
import { SessionSearch } from "./SessionSearch";
import { SessionTree, sessionRowTitle, type SessionTreeReveal } from "./SessionTree";
import { SidebarMenu, type SidebarMenuAnchor, type SidebarMenuItem } from "./SidebarMenu";
import { SidebarToast, type SidebarToastAction, type SidebarToastData } from "./SidebarToast";
import {
  ArchiveIcon,
  ChevronIcon,
  DotIcon,
  DotOutlineIcon,
  MoreIcon,
  ForkIcon,
  OpenInNewTabIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  RestoreIcon,
  TrashIcon,
} from "./SidebarIcons";

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
    };
  }
}

function sessionListUrl(summary: boolean, force: boolean): string {
  if (summary) return "/api/sessions?summary=1";
  if (force) return "/api/sessions?force=1";
  return "/api/sessions";
}

/** How a pick in the sidebar opens a session. */
export interface SelectSessionOptions {
  /** Leave a phone's drawer open: the sidebar has more to show (a fork's revealed row and its toast). */
  keepSidebarOpen?: boolean;
}

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean, entryId?: string, blockIndex?: number, options?: SelectSessionOptions) => void;
  /** projectKey: the target's project identity when it is known (a group's "+", the composer's bar). */
  onNewSession?: (sessionId: string, cwd: string, projectKey?: string | null, options?: NewSessionOptions) => void;
  /** What the bar above a fresh composer moves through (`SessionSidebarControl`). */
  controlRef?: Ref<SessionSidebarControl>;
  /** The sidebar's cwd as the bar above a fresh composer shows it; reported when that changes. */
  onNewSessionContextChange?: (context: NewSessionContext | null) => void;
  initialSessionId?: string | null;
  /** `initialSessionId` is the URL's `?session=`: a toast says so when it is gone. */
  initialSessionLinked?: boolean;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (
    cwd: string | null,
    projectRoot?: string | null,
    projectKey?: string | null,
  ) => void;
  /** Fired when a session that is not currently selected finishes running.
   *  Lets the app play a cross-workspace completion tone. */
  onBackgroundTaskDone?: () => void;
  onRunningSessionIdsChange?: (ids: Set<string>) => void;
  onSessionsChange?: (sessions: SessionInfo[]) => void;
  /** Full-screen phone drawer: the action that returns to the conversation. */
  onCloseMobile?: () => void;
}

/**
 * How the bar above a fresh composer (components/NewSessionContextBar.tsx)
 * moves it: the sidebar keeps the cwd and the project identity, so every
 * move goes through here, as the sidebar's own "+" buttons do.
 */
export interface SessionSidebarControl {
  /** Identity, then the sidebar's cwd, then `onNewSession`, as any new session. */
  startNewSessionIn(target: NewSessionTarget): void;
  /**
   * Opens the folder picker; the validated folder goes to `onPicked`, which
   * decides whether to start there. Focus goes back to `returnFocusTo` when
   * the picker closes without moving the composer.
   */
  openFolderForNewSession(onPicked: (target: NewSessionTarget) => void, returnFocusTo: HTMLElement | null): void;
  /** "Use default directory": today's ~/pi-cwd folder, validated as the folder picker's, goes to `onPicked`. */
  openDefaultDirectoryForNewSession(onPicked: (target: NewSessionTarget) => void): void;
  /** Lists the worktrees of the sidebar's cwd again (the composer's worktree menu opening). */
  refreshWorktrees(): void;
  /** Creates a worktree of `project` and lists it at once; the caller starts the session in it. */
  createWorktree(project: ProjectChoice, branch: string): Promise<{ path: string } | { error: string }>;
}

type WorktreeEntry = WorktreeChoice;

interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  /** Stable server-computed identity; never derive OS path semantics here. */
  projectKey: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
  isTopLevel: boolean;
  /** Canonical path of the checkout containing forCwd, resolved server-side. */
  currentWorktreePath: string | null;
  worktrees: WorktreeEntry[];
}

interface ProjectSelection {
  root: string;
  key: string;
}

interface ValidatedProject {
  cwd: string;
  root: string;
  key: string;
}

type SessionRow = Extract<SidebarRow, { kind: "session" }>;

/**
 * The one popup menu of the sidebar; kept here, above the virtualized rows.
 * `askDelete`: a menu turned into its delete question (a group's "Delete all
 * sessions", an archive header's "Delete all", the archive bar's two).
 */
type SidebarMenuState =
  | { kind: "row"; row: SessionRow; anchor: SidebarMenuAnchor; opener: HTMLElement | null }
  | { kind: "group"; project: SidebarProject; olderCount: number; anchor: SidebarMenuAnchor; opener: HTMLElement; askDelete?: boolean }
  | { kind: "archive-group"; project: SidebarProject; anchor: SidebarMenuAnchor; opener: HTMLElement; askDelete?: boolean }
  | { kind: "archive"; anchor: SidebarMenuAnchor; opener: HTMLElement; askDelete?: ArchiveDeleteScope };

/** The archive bar's deletes: every archived session, or those archived over 30 days ago. */
type ArchiveDeleteScope = "all" | "old";

const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";
const LAST_CUSTOM_CWD_STORAGE_KEY = "pi-web:last-custom-cwd";
const RUNNING_SESSIONS_POLL_MS = 2500;
const SESSION_DETAILS_HYDRATION_DELAY_MS = 750;
/** "Archive sessions older than 7 days" in a project's menu. */
const ARCHIVE_OLDER_THAN_MS = 7 * 24 * 60 * 60 * 1000;
/** The archive bar's "Delete archived over 30 days ago", by archive time. */
const ARCHIVED_DELETE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const TOAST_TITLE_MAX = 28;

/**
 * The files section below the sessions (the desktop's default layout). Its
 * height is the separator's, kept per browser: at least its header row (the
 * keys in it), the picker's row and about six tree rows; at
 * most what leaves the sessions SESSIONS_SECTION_MIN_HEIGHT (a few rows, the
 * CSS min-height of their panel). By default 45% of the sidebar under its
 * toolbar row; the 320px stands in until that is measured. A sidebar shorter
 * than both minimums shrinks the files section in CSS (app/sidebar.css).
 */
const FILES_SECTION_MIN_HEIGHT = 220;
const FILES_SECTION_MAX_HEIGHT = 2000;
const FILES_SECTION_DEFAULT_HEIGHT = 320;
const FILES_SECTION_DEFAULT_SHARE = 0.45;
const SESSIONS_SECTION_MIN_HEIGHT = 120;
const SIDEBAR_HEADER_HEIGHT = 36;

const SESSION_ACTION_LABEL_KEYS: Record<SessionMenuActionId, string> = {
  "open-new-tab": "sidebar.openInNewTab",
  pin: "sidebar.pin",
  unpin: "sidebar.unpin",
  rename: "sidebar.rename",
  fork: "sidebar.fork",
  "mark-read": "sidebar.markRead",
  "mark-unread": "sidebar.markUnread",
  archive: "sidebar.archive",
  unarchive: "sidebar.unarchive",
  delete: "sidebar.delete",
};

function sessionActionIcon(id: SessionMenuActionId): ReactNode {
  switch (id) {
    case "open-new-tab": return <OpenInNewTabIcon />;
    case "pin": return <PinIcon />;
    case "unpin": return <PinOffIcon />;
    case "rename": return <PencilIcon />;
    case "fork": return <ForkIcon />;
    case "mark-read": return <DotOutlineIcon />;
    case "mark-unread": return <DotIcon />;
    case "archive": return <ArchiveIcon />;
    case "unarchive": return <RestoreIcon />;
    case "delete": return <TrashIcon />;
  }
}

function loadLastCustomCwd(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(LAST_CUSTOM_CWD_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveLastCustomCwd(cwd: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_CUSTOM_CWD_STORAGE_KEY, cwd);
  } catch {
    // Persistence is best-effort.
  }
}

function parseUnreadSessionIds(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    // A malformed value (an interrupted write, another client) means no markers.
  }
  return new Set();
}

function loadUnreadSessionIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return parseUnreadSessionIds(window.localStorage.getItem(UNREAD_SESSIONS_STORAGE_KEY));
  } catch {
    return new Set();
  }
}

function saveUnreadSessionIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
    else window.localStorage.setItem(UNREAD_SESSIONS_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // ignore storage quota / privacy-mode errors
  }
}

/**
 * The running set for a polled id list: `previous` itself while it holds the
 * same ids. A new Set every 2.5 s poll would rebuild every tree row (memoized
 * by identity) and re-run everything that watches the set, for nothing.
 */
export function sameIdsOr(previous: Set<string>, ids: readonly string[]): Set<string> {
  const next = new Set(ids);
  if (next.size !== previous.size) return next;
  for (const id of next) {
    if (!previous.has(id)) return next;
  }
  return previous;
}

/** Temporary id for a session that does not exist yet: pi is spawned lazily
 *  when the user sends the first message, so no backend call is needed. */
function createTempSessionId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function shortTitle(title: string, max: number): string {
  return title.length > max ? `${title.slice(0, max)}…` : title;
}

/**
 * focusIfLost, also when focus is still on an element that is no longer
 * rendered (in a view just hidden) or inert (in a view sliding away, or
 * covered by one sliding in): browsers move it to <body> only at their next
 * rendering update, so it does not count as lost yet.
 */
function focusIfHidden(target: HTMLElement | null): void {
  const active = document.activeElement;
  if (target && active instanceof HTMLElement && active !== document.body && (active.getClientRects().length === 0 || active.closest("[inert]") !== null)) {
    target.focus({ preventScroll: true });
    return;
  }
  focusIfLost(document, target);
}

/** The key nearest `key` in its group that is still enabled, the next one first. */
export function nearestEnabledKey(key: Element): HTMLButtonElement | null {
  const enabled = (element: Element | null): element is HTMLButtonElement => element?.tagName === "BUTTON" && !(element as HTMLButtonElement).disabled;
  for (let next = key.nextElementSibling; next; next = next.nextElementSibling) if (enabled(next)) return next;
  for (let previous = key.previousElementSibling; previous; previous = previous.previousElementSibling) if (enabled(previous)) return previous;
  return null;
}

/**
 * Hands the focus of a key just disabled to the nearest key still enabled
 * (else `fallback`). Focus still on the key counts as lost: current Chromium
 * (154) keeps a just-disabled element focused until its next rendering
 * update, after the layout effect that calls this, and only then blurs it to
 * the page (relatedTarget null; older builds blur it at once, which
 * focusIfLost covers). Focus the user put elsewhere stays. Returns whether
 * it moved focus.
 */
export function handOffDisabledKeyFocus(doc: FocusDocument, key: Element, fallback: HTMLElement | null): boolean {
  const target = nearestEnabledKey(key) ?? fallback;
  if (!target || doc.activeElement !== key) return focusIfLost(doc, target);
  target.focus({ preventScroll: true });
  return true;
}

/**
 * How much of the toolbar row's labels fit (`data-fit`, app/sidebar.css):
 * all (0), New's + alone (1), then the tabs' icons alone, or below the
 * sessions the brand's versions in a smaller type (2): the brand itself is
 * never cut. Measured, not a fixed width, since the labels' widths change
 * with the language; on the row itself, before paint, again whenever it
 * resizes or `labels` change. The returned fit is for what the row's size
 * does not show: the brand's text changing its width.
 */
function useHeaderFit(ref: RefObject<HTMLElement | null>, labels: string): () => void {
  const fit = useCallback(() => {
    const header = ref.current;
    if (!header) return;
    for (const level of ["0", "1", "2"]) {
      header.dataset.fit = level;
      if (header.scrollWidth <= header.clientWidth) return;
    }
  }, [ref]);
  useLayoutEffect(() => {
    const header = ref.current;
    if (!header) return;
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(header);
    return () => observer.disconnect();
  }, [ref, fit, labels]);
  return fit;
}

/** A menu placed below (or above) a button, lined up with one of its edges. */
function buttonAnchor(element: HTMLElement, align: "start" | "end"): SidebarMenuAnchor {
  const rect = element.getBoundingClientRect();
  return { kind: "rect", rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, align };
}

export function SessionSidebar({ selectedSessionId, onSelectSession, onNewSession, controlRef, onNewSessionContextChange, initialSessionId, initialSessionLinked, skipInitialProjectSelection, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, onBackgroundTaskDone, onRunningSessionIdsChange, onSessionsChange, onCloseMobile }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  // Tracked in a ref only: the version is compared against the polled value to
  // decide whether the list needs reloading, and no render reads it.
  const sessionListVersionRef = useRef<number | null>(null);
  const sessionLoadIdRef = useRef(0);
  const [loading, setLoading] = useState(true);
  // The first paint lists summary rows (their time is the file's mtime); the
  // project order is first saved from the full details.
  const [sessionDetailsLoaded, setSessionDetailsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  // Open for the files tab's project list, or for the composer's bar ("new-session").
  const [customPathOpen, setCustomPathOpen] = useState<false | "files" | "new-session">(false);
  const [customPathValue, setCustomPathValue] = useState(loadLastCustomCwd);
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const [validatedProject, setValidatedProject] = useState<ValidatedProject | null>(null);
  // The files tab's project and worktree picker.
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const [worktreeLoadingCwd, setWorktreeLoadingCwd] = useState<string | null>(null);
  // Folders the listing last found outside any git repository, loaded from
  // the browser's memory of them (after a reload too: the default dated
  // folder is one) on the first client render: while one is listed, no
  // "checking" box shows only to go and widen the project box. The server's
  // render reads none; the box shows only once a listing starts, client-side.
  const nonGitCwdsRef = useRef<Set<string> | null>(null);
  nonGitCwdsRef.current ??= new Set(loadNonGitCwds());
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [awaitingInputSessionIds, setAwaitingInputSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(() => loadUnreadSessionIds());
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  const currentSuppressedCompletionSessionIdsRef = useRef<Set<string>>(new Set());
  const previousSuppressedCompletionSessionIdsRef = useRef<Set<string>>(new Set());
  // Once polling has delivered a snapshot it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const runningPollAuthoritativeRef = useRef(false);
  const detailsHydrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sessionsPanelRef = useRef<HTMLDivElement>(null);
  const panelScrollTopsRef = useRef(new WeakMap<Element, number>());
  // Project groups: explicit expand/collapse choices (saved), the groups kept
  // open for the page after they stopped being current (keepOutgoingGroupOpen;
  // never saved), how many families "show more" has revealed per group
  // (SHOW_MORE_STEP a click), the pinned section, the archive view.
  const [groupExpansion, setGroupExpansion] = useState<Readonly<Record<string, boolean>>>({});
  const [keptOpenGroups, setKeptOpenGroups] = useState<ReadonlySet<string>>(() => new Set());
  const [moreShown, setMoreShown] = useState<Readonly<Record<string, number>>>({});
  const [pinnedCollapsed, setPinnedCollapsed] = useState(false);
  // The archive view's folded projects, per browser (lib/sidebar-prefs.ts).
  const [archiveCollapsed, setArchiveCollapsed] = useState<readonly string[]>([]);
  const [archiveView, setArchiveViewState] = useState(false);
  // The archive view moves (hooks/useSidebarMotion.ts): only when the user
  // goes in or out, never on a restore, a drag or a resize, and not at all
  // under reduced motion. The current value tells a change from a repeat,
  // which starts nothing.
  const { phase: archivePhase, start: startArchiveMotion, end: endArchiveMotion } = useSidebarMotion();
  const archiveViewRef = useRef(archiveView);
  archiveViewRef.current = archiveView;
  const setArchiveView = useCallback((open: boolean) => {
    if (open !== archiveViewRef.current) startArchiveMotion(open ? "in" : "out");
    setArchiveViewState(open);
  }, [startArchiveMotion]);
  const archiveMotion = archiveViewState(archiveView, archivePhase);
  // Row states that must survive virtualization live here, not in the rows.
  const [renamingRootId, setRenamingRootId] = useState<string | null>(null);
  const [renamingProjectKey, setRenamingProjectKey] = useState<string | null>(null);
  const [confirmDeleteRootId, setConfirmDeleteRootId] = useState<string | null>(null);
  const [menu, setMenu] = useState<SidebarMenuState | null>(null);
  // A row the main tree should scroll to (a fork's new row); see
  // SessionTreeReveal. Held until the tree says it is done with it.
  const [treeReveal, setTreeReveal] = useState<SessionTreeReveal | null>(null);
  const treeRevealIdRef = useRef(0);
  const handleRevealHandled = useCallback((id: number) => {
    setTreeReveal((current) => (current?.id === id ? null : current));
  }, []);
  // The archive view's own: a project's "View archived" puts its header on top.
  const [archiveReveal, setArchiveReveal] = useState<SessionTreeReveal | null>(null);
  const handleArchiveRevealHandled = useCallback((id: number) => {
    setArchiveReveal((current) => (current?.id === id ? null : current));
  }, []);
  const selectedSessionIdRef = useRef(selectedSessionId);
  selectedSessionIdRef.current = selectedSessionId;
  const [toast, setToast] = useState<SidebarToastData | null>(null);
  const toastIdRef = useRef(0);
  const showToast = useCallback((message: string, actions: SidebarToastAction[] = [], tail?: string) => {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, message, ...(tail ? { tail } : {}), actions });
  }, []);
  const [uiWriteFailures, setUiWriteFailures] = useState(0);
  const shownUiWriteFailuresRef = useRef(0);
  const contextMenuFocusRef = useRef<HTMLElement | null>(null);
  // The composer's "Open another project…": where the validated folder goes,
  // and the control focus returns to when the composer does not move.
  const folderPickRef = useRef<((target: NewSessionTarget) => void) | null>(null);
  const folderReturnFocusRef = useRef<HTMLElement | null>(null);

  // Focus to settle once a change is on the page, after the control that had
  // it went away with that change (a toast's button, a delete confirmation's
  // Cancel, the folder picker). Only focus that fell to <body> moves
  // (focusIfLost): focus the user put elsewhere stays.
  const focusAfterCommitRef = useRef<(() => HTMLElement | null) | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const focusAfterCommit = useCallback((target: () => HTMLElement | null) => {
    focusAfterCommitRef.current = target;
    setFocusRequest((count) => count + 1);
  }, []);
  useEffect(() => {
    const target = focusAfterCommitRef.current;
    focusAfterCommitRef.current = null;
    if (target) focusIfLost(document, target());
  }, [focusRequest]);

  // Pins, archive and project order: pi-web's own state, kept on the server for every window.
  const {
    state: uiState,
    loaded: uiStateLoaded,
    synced: uiStateSynced,
    error: uiStateError,
    apply: applyUiStateRequest,
    snapshot: snapshotUiState,
    noteRevision: noteUiRevision,
  } = useSessionUiState();

  // The explorer's scroll container is always mounted (empty without a cwd),
  // so the scrollbar hook stays bound to the element that is on the page.
  const headerRef = useRef<HTMLDivElement>(null);
  // The toolbar row's search button: always there and enabled, so focus has
  // somewhere to go when a row it was on goes away.
  const searchButtonRef = useRef<HTMLButtonElement>(null);

  const sidebarRef = useRef<HTMLDivElement>(null);

  // Browser storage is unavailable during server rendering. Restore the
  // sidebar preferences after hydration: read in a state initializer, a saved
  // Files tab would make the first client render differ from the server's
  // HTML (a hydration error, and the server markup thrown away). The group
  // choices load before the retired keys go: the old ones move to v2 then.
  useEffect(() => {
    const groups = loadGroupExpansion();
    if (Object.keys(groups).length > 0) setGroupExpansion(groups);
    if (loadPinnedCollapsed()) setPinnedCollapsed(true);
    const archiveFolds = loadArchiveCollapsed();
    if (archiveFolds.length > 0) setArchiveCollapsed(archiveFolds);
    forgetRetiredSidebarKeys();
  }, []);

  const loadSessions = useCallback(async (showLoading = false, force = false, summary = false) => {
    const loadId = ++sessionLoadIdRef.current;
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(sessionListUrl(summary, force), {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        sessions: SessionInfo[];
        sessionListVersion: number;
        runningSessionIds?: string[];
        awaitingInputSessionIds?: string[];
        completionNotificationSuppressedSessionIds?: string[];
      };
      if (loadId !== sessionLoadIdRef.current) return;
      sessionListVersionRef.current = data.sessionListVersion;
      setAllSessions(data.sessions);
      if (!summary) setSessionDetailsLoaded(true);
      // Treat the fetched running set as an initial fallback only. Once the
      // lightweight poll is live, a slow session-list fetch cannot overwrite it.
      if (!runningPollAuthoritativeRef.current) {
        currentSuppressedCompletionSessionIdsRef.current = new Set(
          data.completionNotificationSuppressedSessionIds ?? [],
        );
        setRunningSessionIds((previous) => sameIdsOr(previous, data.runningSessionIds ?? []));
        setAwaitingInputSessionIds((previous) => sameIdsOr(previous, data.awaitingInputSessionIds ?? []));
      }
      // Drop markers for deleted sessions and for subagents, whose completion
      // is intentionally silent even if an older client marked them unread.
      const unreadEligibleIds = new Set(
        data.sessions
          .filter((session) => session.relation?.kind !== "subagent")
          .map((session) => session.id),
      );
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => unreadEligibleIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
    } catch (e) {
      if (loadId === sessionLoadIdRef.current) setError(String(e));
    } finally {
      if (loadId === sessionLoadIdRef.current) setLoading(false);
    }
  }, []);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    let active = true;

    if (isFirst) {
      // Header/stat metadata is enough to select the URL session and paint the
      // sidebar. Hydrate exact counts, names, and first messages once the
      // selected chat has had a chance to start loading.
      void loadSessions(true, false, true).then(() => {
        if (!active) return;
        detailsHydrationTimerRef.current = setTimeout(() => {
          detailsHydrationTimerRef.current = null;
          if (active) void loadSessions(false, true);
        }, SESSION_DETAILS_HYDRATION_DELAY_MS);
      });
    } else {
      // Every refreshKey bump follows a change the server already invalidated
      // the list for (a run's agent_end, a fork, a delete, a name, a new
      // session). Forcing would rescan again and bump the version, so every
      // other open tab would reload the list once more.
      void loadSessions();
    }

    return () => {
      active = false;
      if (detailsHydrationTimerRef.current) {
        clearTimeout(detailsHydrationTimerRef.current);
        detailsHydrationTimerRef.current = null;
      }
    };
  }, [loadSessions, refreshKey]);

  // Persist unread markers so they survive a browser refresh before the user
  // has actually opened the completed session.
  useEffect(() => {
    saveUnreadSessionIds(unreadSessionIds);
  }, [unreadSessionIds]);

  // Another tab's read or mark-unread of the same session: its localStorage
  // write is the only cross-tab notice there is, and the browser fires the
  // storage event only in the tabs that did not write. Without adopting the
  // written set here, a session read in the other tab keeps its dot in this
  // one, and this tab's next local write would persist the stale marker
  // again, resurrecting it everywhere after a refresh.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== UNREAD_SESSIONS_STORAGE_KEY) return;
      setUnreadSessionIds((prev) => sameIdsOr(prev, [...parseUnreadSessionIds(event.newValue)]));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (stopped || document.visibilityState !== "visible") return;
      timer = setTimeout(() => void poll(), RUNNING_SESSIONS_POLL_MS);
    };

    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const current = new AbortController();
      controller?.abort();
      controller = current;
      try {
        const res = await fetch("/api/agent/running", {
          cache: "no-store",
          signal: current.signal,
        });
        if (!res.ok) return;
        const data = await res.json() as {
          sessionListVersion: number;
          runningSessionIds?: string[];
          awaitingInputSessionIds?: string[];
          completionNotificationSuppressedSessionIds?: string[];
          sessionUiStateRevision?: number | null;
        };
        if (stopped || controller !== current) return;
        runningPollAuthoritativeRef.current = true;
        currentSuppressedCompletionSessionIdsRef.current = new Set(
          data.completionNotificationSuppressedSessionIds ?? [],
        );
        setRunningSessionIds((previous) => sameIdsOr(previous, data.runningSessionIds ?? []));
        setAwaitingInputSessionIds((previous) => sameIdsOr(previous, data.awaitingInputSessionIds ?? []));
        // Pins and archive changed in another window: reload them.
        noteUiRevision(data.sessionUiStateRevision);
        if (data.sessionListVersion !== sessionListVersionRef.current) {
          // Reuse the invalidated cache; forcing a scan would change the version again.
          await loadSessions();
        }
      } catch {
        // Keep the last known state; the next visible-tab poll retries.
      } finally {
        if (controller === current) controller = null;
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
        return;
      }
      clearTimer();
      controller?.abort();
      controller = null;
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadSessions, noteUiRevision]);

  useEffect(() => {
    onRunningSessionIdsChange?.(runningSessionIds);
  }, [onRunningSessionIdsChange, runningSessionIds]);

  useEffect(() => {
    onSessionsChange?.(allSessions);
  }, [allSessions, onSessionsChange]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const knownSubagentIds = new Set(
      allSessions
        .filter((session) => session.relation?.kind === "subagent")
        .map((session) => session.id),
    );
    const completedWithNotifications = completedInBackground.filter(
      (id) => !previousSuppressedCompletionSessionIdsRef.current.has(id) && !knownSubagentIds.has(id),
    );
    const newlyRunning = [...runningSessionIds].filter((id) => !previous.has(id));

    if (completedWithNotifications.length > 0 || newlyRunning.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        runningSessionIds.forEach((id) => next.delete(id));
        completedWithNotifications.forEach((id) => next.add(id));
        return next;
      });
    }
    const hasUnlistedRunningSession = newlyRunning.some(
      (id) => !allSessions.some((session) => session.id === id),
    );
    // Not forced: a run's agent_end has already invalidated the server's list,
    // and a forced rescan here, in every tab not showing that session, bumped
    // the version again and made all the others reload once more.
    if (completedInBackground.length > 0 || hasUnlistedRunningSession) {
      void loadSessions();
    }
    if (completedWithNotifications.length > 0) {
      onBackgroundTaskDone?.();
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
    previousSuppressedCompletionSessionIdsRef.current = new Set(
      [...runningSessionIds].filter(
        (id) => currentSuppressedCompletionSessionIdsRef.current.has(id) || knownSubagentIds.has(id),
      ),
    );
  }, [runningSessionIds, selectedSessionId, allSessions, loadSessions, onBackgroundTaskDone]);

  useEffect(() => {
    if (!selectedSessionId) return;
    setUnreadSessionIds((prev) => {
      if (!prev.has(selectedSessionId)) return prev;
      const next = new Set(prev);
      next.delete(selectedSessionId);
      return next;
    });
  }, [selectedSessionId]);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  const restoredRef = useRef(false);

  /** Resolve both display root and stable identity from server-provided data. */
  const projectFor = useCallback((cwd: string | null): ProjectSelection | null => (
    cwd ? projectForCwd(cwd, { validated: validatedProject, listing: worktreeState, sessions: allSessions }) : null
  ), [validatedProject, worktreeState, allSessions]);

  // The project of the sidebar's cwd: the files tab shows it, and its group in
  // the sessions tab exists even before it has a session.
  const selectedProject = useMemo(() => projectFor(selectedCwd), [projectFor, selectedCwd]);

  // A worktree/session refresh can hydrate the stable key without changing
  // cwd, so notify when either changes. The parent treats same-cwd key changes
  // as identity hydration rather than a workspace switch.
  const lastNotifiedProjectRef = useRef<{ cwd: string | null; key: string | null } | null>(null);
  useEffect(() => {
    const project = projectFor(selectedCwd);
    const previous = lastNotifiedProjectRef.current;
    if (previous?.cwd === selectedCwd && previous.key === (project?.key ?? null)) return;
    lastNotifiedProjectRef.current = { cwd: selectedCwd, key: project?.key ?? null };
    onCwdChange?.(
      selectedCwd,
      project?.root ?? null,
      project?.key ?? null,
    );
  }, [selectedCwd, onCwdChange, projectFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one group, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back. The prop
  // goes null when the shell switches project from here; forgetting the last
  // value then lets a restored session in a worktree that was synced before
  // move the cwd again, so the files tab shows the checkout the chat uses.
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedCwdProp) {
      lastSyncedCwdPropRef.current = null;
      return;
    }
    if (selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

  // Load worktrees for the current effective cwd
  const [wtRefreshKey, setWtRefreshKey] = useState(0);
  useLayoutEffect(() => {
    if (!selectedCwd) {
      setWorktreeState(null);
      setWorktreeLoadingCwd(null);
      return;
    }
    let cancelled = false;
    setWorktreeLoadingCwd(selectedCwd);
    fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
      .then((r) => r.json())
      .then((d: { projectRoot?: string; projectKey?: string; isGit?: boolean; isTopLevel?: boolean; currentWorktreePath?: string | null; worktrees?: WorktreeEntry[]; error?: string }) => {
        if (cancelled) return;
        setWorktreeLoadingCwd(null);
        if (d.error || !d.projectRoot) {
          setWorktreeState(null);
          return;
        }
        if (d.isGit) nonGitCwdsRef.current?.delete(selectedCwd);
        else nonGitCwdsRef.current?.add(selectedCwd);
        rememberCwdGitStatus(selectedCwd, Boolean(d.isGit));
        setWorktreeState({
          forCwd: selectedCwd,
          projectRoot: d.projectRoot,
          projectKey: d.projectKey ?? d.projectRoot,
          isGit: d.isGit ?? false,
          isTopLevel: d.isTopLevel ?? false,
          currentWorktreePath: d.currentWorktreePath ?? null,
          worktrees: d.worktrees ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWorktreeLoadingCwd(null);
          setWorktreeState(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedCwd, wtRefreshKey, refreshKey]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (allSessions.length === 0 || skipInitialProjectSelection) return;

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
        if (initialSessionLinked) showToast(t("sidebar.sessionNotFound"));
      }
      const projects = getRecentProjects(allSessions);
      if (projects.length > 0) setSelectedCwd(projects[0].root);
    }
  }, [allSessions, selectedCwd, initialSessionId, initialSessionLinked, skipInitialProjectSelection, onSelectSession, onInitialRestoreDone, showToast, t]);

  // Prefer an exact UI selection while a refetch is in flight. Once the
  // response catches up, the server-resolved path handles Windows case and
  // separator differences without teaching the browser OS path semantics.
  const currentWorktree = worktreeState
    ? worktreeState.worktrees.find((worktree) => worktree.path === selectedCwd)
      ?? (worktreeState.forCwd === selectedCwd && worktreeState.currentWorktreePath
        ? worktreeState.worktrees.find((worktree) => worktree.path === worktreeState.currentWorktreePath)
        : undefined)
      ?? worktreeState.worktrees.find((worktree) => worktree.isMain)
    : undefined;
  const currentWorktreePath = currentWorktree?.path ?? null;

  // `purpose`: who asked, the folder picker's opener by default ("Use default directory" names its own).
  const commitCustomPath = useCallback(async (candidate?: string, { remember = true, purpose = customPathOpen } = {}) => {
    const path = (candidate ?? customPathValue).trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as {
        cwd?: string;
        projectRoot?: string;
        projectKey?: string;
        error?: string;
      };
      if (!res.ok || data.error || !data.cwd || !data.projectRoot || !data.projectKey) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (remember) {
        saveLastCustomCwd(data.cwd);
        setCustomPathValue(data.cwd);
      }
      setCustomPathOpen(false);
      if (purpose === "new-session") {
        // The composer's bar asked: the shell decides whether its fresh
        // composer moves there, and the sidebar's cwd moves only with it.
        const pick = folderPickRef.current;
        const opener = folderReturnFocusRef.current;
        folderPickRef.current = null;
        folderReturnFocusRef.current = null;
        pick?.({ cwd: data.cwd, projectKey: data.projectKey, projectRoot: data.projectRoot });
        // Not moved (the folder in use): the bar's control takes focus back.
        focusAfterCommit(() => (opener?.isConnected ? opener : null));
        return;
      }
      setValidatedProject({
        cwd: data.cwd,
        root: data.projectRoot,
        key: data.projectKey,
      });
      setSelectedCwd(data.cwd);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathOpen, customPathValue, customPathValidating, focusAfterCommit]);

  const handleCustomPathClick = useCallback(() => {
    setCustomPathError(null);
    // Same rule as the composer's bar: the system picker when the desktop shell
    // has one, the in-page directory browser otherwise.
    void (async () => {
      const picked = await pickDirectoryNatively({ title: t("directoryPicker.selectDirectory") });
      if (!picked) {
        setCustomPathOpen("files");
        return;
      }
      if (picked.canceled || !picked.path) return;
      await commitCustomPathRef.current(picked.path, { remember: true, purpose: "files" });
    })();
  }, [t]);
  const handleDefaultCwd = useCallback(async (purpose: "files" | "new-session" = "files") => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      // Select it like any other directory, so validation, project identity and
      // the file allow-list all go through /api/cwd/validate. It is not a path
      // the user typed, so the custom-path picker does not remember it.
      if (data.cwd) await commitCustomPath(data.cwd, { remember: false, purpose });
    } catch {
      // ignore
    }
  }, [commitCustomPath]);
  // The composer's bar asks through the handle, which is made once.
  const handleDefaultCwdRef = useRef(handleDefaultCwd);
  handleDefaultCwdRef.current = handleDefaultCwd;
  const commitCustomPathRef = useRef(commitCustomPath);
  commitCustomPathRef.current = commitCustomPath;

  // Both pickers create through here: the worktree is listed at once, so
  // projectFor() keeps it in the project before the refetch lands, and
  // listed even when nobody moves there. The picker moves there itself.
  const createWorktree = useCallback(async (project: ProjectChoice, branch: string): Promise<{ path: string } | { error: string }> => {
    try {
      const res = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: project.root, branch }),
      });
      const data = await res.json().catch(() => ({})) as { path?: string; error?: string };
      if (!res.ok || data.error || !data.path) return { error: data.error ?? `HTTP ${res.status}` };
      const path = data.path;
      setWorktreeState((prev) => (prev && prev.projectKey === project.key && !prev.worktrees.some((worktree) => worktree.path === path)
        ? { ...prev, worktrees: [...prev.worktrees, { path, branch, isMain: false }] }
        : prev));
      setWtRefreshKey((k) => k + 1);
      return { path };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, []);

  // The files tab's remove button. A checkout with changes answers "dirty",
  // and the picker asks before retrying with force.
  const handleRemoveWorktree = useCallback(async (project: ProjectChoice, path: string, force: boolean): Promise<WorktreeRemoval> => {
    try {
      const res = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: project.root, path, force }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; dirty?: boolean };
      if (!res.ok) {
        if (data.dirty && !force) return "dirty";
        return { error: data.error ?? `HTTP ${res.status}` };
      }
      if (currentWorktreePath === path) setSelectedCwd(project.root);
      setWtRefreshKey((k) => k + 1);
      return "removed";
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [currentWorktreePath]);

  const refreshWorktrees = useCallback(() => setWtRefreshKey((k) => k + 1), []);

  // The files tab's picks move the sidebar's cwd, with the identity the
  // picker read from the project list or the worktree listing: a pinned
  // project without sessions keeps its server key, as in startNewSessionIn.
  const handleFilesPick = useCallback(({ cwd, projectKey, projectRoot }: NewSessionTarget) => {
    if (projectKey && projectRoot) setValidatedProject({ cwd, root: projectRoot, key: projectKey });
    setSelectedCwd(cwd);
  }, []);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback((s: SessionInfo, entryId?: string, blockIndex?: number, options?: SelectSessionOptions) => {
    setAllSessions((current) => current.some((session) => session.id === s.id) ? current : [s, ...current]);
    if (s.cwd) setSelectedCwd(s.cwd);
    onSelectSession(s, false, entryId, blockIndex, options);
  }, [onSelectSession]);

  // Every "new session" goes through here. The cwd moves first, on the click
  // path like a session pick, and the shell gets the target's project so it
  // adopts it up front: a session in another project closes the previous
  // project's file tabs instead of being mistaken for identity hydration.
  const startNewSessionIn = useCallback(({ cwd, projectKey, projectRoot, carryComposer }: NewSessionTarget) => {
    // A worktree without sessions has no other source of identity yet.
    if (projectKey && projectRoot) setValidatedProject({ cwd, root: projectRoot, key: projectKey });
    setSelectedCwd(cwd);
    onNewSession?.(createTempSessionId(), cwd, projectKey, carryComposer ? { carryComposer: true } : undefined);
  }, [onNewSession]);
  // The handle below is made once: it calls the newest closure.
  const startNewSessionInRef = useRef(startNewSessionIn);
  startNewSessionInRef.current = startNewSessionIn;

  useImperativeHandle(controlRef, () => ({
    startNewSessionIn: (target) => startNewSessionInRef.current(target),
    openFolderForNewSession: (onPicked, returnFocusTo) => {
      folderPickRef.current = onPicked;
      folderReturnFocusRef.current = returnFocusTo;
      setCustomPathError(null);
      // 桌面壳里直接开系统的选目录框（有侧边栏位置、最近使用、能新建文件夹）；
      // 浏览器构建没有这个能力，落到自己的目录浏览器。
      void (async () => {
        const picked = await pickDirectoryNatively({ title: t("directoryPicker.selectDirectory") });
        if (!picked) {
          setCustomPathOpen("new-session");
          return;
        }
        if (picked.canceled || !picked.path) {
          const opener = folderReturnFocusRef.current;
          folderPickRef.current = null;
          folderReturnFocusRef.current = null;
          focusAfterCommit(() => (opener?.isConnected ? opener : null));
          return;
        }
        await commitCustomPathRef.current(picked.path, { remember: true, purpose: "new-session" });
      })();
    },
    openDefaultDirectoryForNewSession: (onPicked) => {
      folderPickRef.current = onPicked;
      folderReturnFocusRef.current = null;
      void handleDefaultCwdRef.current("new-session");
    },
    refreshWorktrees,
    createWorktree,
  }), [createWorktree, refreshWorktrees]);

  // Header "+": a new session in the sidebar's current cwd (worktree).
  const handleNewSession = useCallback(() => {
    if (!selectedCwd) return;
    startNewSessionIn({ cwd: selectedCwd });
  }, [selectedCwd, startNewSessionIn]);

  const recentProjects = useMemo(() => getRecentProjects(allSessions), [allSessions]);

  const sessionFamilies = useMemo(() => listSessionFamilies(allSessions), [allSessions]);
  const familyByRootId = useMemo(
    () => new Map(sessionFamilies.map((family) => [family.root.id, family])),
    [sessionFamilies],
  );

  // Every session id of an archived family (search tags them), and how many
  // families each project has in the archive.
  const archiveIndex = useMemo(() => {
    const ids = new Set<string>();
    const countByProject = new Map<string, number>();
    for (const family of sessionFamilies) {
      if (!isFamilyArchived(family, uiState, runningSessionIds)) continue;
      for (const id of familyIds(family)) ids.add(id);
      const key = workspaceKeyOf(family.root);
      countByProject.set(key, (countByProject.get(key) ?? 0) + 1);
    }
    return { ids, countByProject };
  }, [sessionFamilies, uiState, runningSessionIds]);

  // Per-project activity counts (running / unread) for the files tab's project menu.
  // Uses the same stable server key as the project list and filtering. An
  // archived family is out of sight, so it does not count as activity.
  const projectActivity = useMemo(
    () => getProjectActivity(
      archiveIndex.ids.size === 0 ? allSessions : allSessions.filter((session) => !archiveIndex.ids.has(session.id)),
      runningSessionIds,
      unreadSessionIds,
    ),
    [allSessions, archiveIndex, runningSessionIds, unreadSessionIds],
  );

  const showWorktreeSwitcher = Boolean(
    worktreeState?.isGit
    && worktreeState.isTopLevel
    && selectedCwd
    && selectedProject?.key === worktreeState.projectKey
  );
  // A subdirectory of a git checkout keeps a disabled box saying why it has
  // no worktrees (its root has them). A folder outside any repository has
  // no worktree box at all: the project box takes the whole row.
  const worktreeGuide = selectedCwd
    && worktreeState?.isGit
    && selectedProject?.key === worktreeState.projectKey
    && !showWorktreeSwitcher
    ? {
        label: t("sidebar.openRepoRoot"),
        title: t("sidebar.openRepoRootTitle"),
      }
    : null;
  const worktreeLoading = Boolean(selectedCwd && worktreeLoadingCwd === selectedCwd);
  const inactiveWorktreeSelector = worktreeGuide
    ?? (worktreeLoading && !showWorktreeSwitcher && !(selectedCwd && nonGitCwdsRef.current?.has(selectedCwd))
      ? {
           label: t("sidebar.worktrees"),
           title: t("sidebar.checkingWorktrees"),
        }
      : null);

  // The tree of every project. Its group for the current project exists even
  // without sessions (a fresh custom path, a new worktree).
  const currentProjectKey = selectedProject?.key ?? null;
  const currentProjectRoot = selectedProject?.root ?? null;
  const currentProject = useMemo(
    () => (currentProjectKey && currentProjectRoot ? { key: currentProjectKey, root: currentProjectRoot } : null),
    [currentProjectKey, currentProjectRoot],
  );
  // What the tree shows and every toggle reads: the saved choices over the
  // groups kept open for the page. Writes go to the saved choices alone
  // (saveGroupChoices).
  const shownGroupExpansion = useMemo(
    () => effectiveGroupExpansion(groupExpansion, keptOpenGroups),
    [groupExpansion, keptOpenGroups],
  );
  const model = useMemo(() => buildSessionTree({
    sessions: allSessions,
    uiState,
    runningIds: runningSessionIds,
    awaitingIds: awaitingInputSessionIds,
    unreadIds: unreadSessionIds,
    selectedSessionId,
    currentProject,
    groupExpansion: shownGroupExpansion,
    moreShown,
    pinnedCollapsed,
  }), [allSessions, uiState, runningSessionIds, awaitingInputSessionIds, unreadSessionIds, selectedSessionId, currentProject, shownGroupExpansion, moreShown, pinnedCollapsed]);
  // Built while the archive view is rendered, its way out included: it
  // leaves as it was, not empty.
  const archiveMounted = archiveMotion.archiveMounted;
  const archiveCollapsedSet = useMemo(() => new Set(archiveCollapsed), [archiveCollapsed]);
  const archiveRows = useMemo(() => (archiveMounted ? buildArchiveRows({
    sessions: allSessions,
    uiState,
    runningIds: runningSessionIds,
    awaitingIds: awaitingInputSessionIds,
    unreadIds: unreadSessionIds,
    selectedSessionId,
    currentProject,
    collapsed: archiveCollapsedSet,
  }) : []), [archiveMounted, allSessions, uiState, runningSessionIds, awaitingInputSessionIds, unreadSessionIds, selectedSessionId, currentProject, archiveCollapsedSet]);
  // The archive's projects, top to bottom, folded or not.
  const archiveGroups = useMemo(
    () => archiveRows.flatMap((row) => (row.kind === "archive-group" ? [row] : [])),
    [archiveRows],
  );
  const projectByKey = useMemo(
    () => new Map(model.projects.map((project) => [project.key, project])),
    [model.projects],
  );

  // The project order is saved as projects turn up: a project without a place
  // renders at the top of its band, and saving it puts it at the top of the
  // list, so nothing moves on screen; from then on only a drag or Move up/down
  // moves it. The first save (an empty order) records the activity order the
  // user sees. It waits for real server state (a failed GET leaves the local
  // state empty: archived projects would count as live) and for the session
  // details (the summary rows' times are file mtimes). When more keys wait
  // than one request holds, the bottom ones go first
  // (nextProjectKeysToRecord): a batch never lands below keys still unsaved.
  // Each key is sent once per page: a refused save is not retried in a loop,
  // and keys that do not fit a full list are not sent again and again. A
  // background save fails quietly (the raw apply, no toast).
  const recordedOrderKeysRef = useRef(new Set<string>());
  const projectKeysToRecord = model.projectKeysToRecord;
  const storedOrderLength = uiState.projectOrder?.length ?? 0;
  useEffect(() => {
    if (loading || !uiStateSynced || !sessionDetailsLoaded) return;
    if (storedOrderLength >= MAX_PROJECT_ORDER_KEYS) return;
    const recorded = recordedOrderKeysRef.current;
    const keys = nextProjectKeysToRecord(projectKeysToRecord, recorded, MAX_SESSION_UI_IDS_PER_REQUEST);
    if (keys.length === 0) return;
    for (const key of keys) recorded.add(key);
    void applyUiStateRequest({ action: "add-projects", keys });
  }, [applyUiStateRequest, loading, projectKeysToRecord, sessionDetailsLoaded, storedOrderLength, uiStateSynced]);

  // Every project in the groups' order, then those with sessions but no
  // group (all of them archived, or pinned while the project is not): the
  // project menus of the files tab and of the bar above a fresh composer,
  // with the names the user gave them.
  const projectNames = uiState.projectNames;
  const projectChoiceList = useMemo(
    () => mergeProjectChoices(model.projects, recentProjects, projectNames),
    [model.projects, recentProjects, projectNames],
  );

  // What both pickers show for this cwd: the project, its worktrees where the
  // files tab offers them (the top of a git checkout), every project. The
  // tree is rebuilt on every refresh and running poll; the bar above a fresh
  // composer hears of it only when something it shows changed.
  const newSessionContext = useMemo<NewSessionContext | null>(() => {
    if (!selectedCwd || !selectedProject) return null;
    const listed = showWorktreeSwitcher && worktreeState !== null;
    return {
      cwd: selectedCwd,
      project: withProjectAlias(selectedProject, projectNames),
      worktrees: listed ? worktreeState.worktrees.map(({ path, branch, isMain }) => ({ path, branch, isMain })) : null,
      currentWorktreePath: listed ? currentWorktreePath : null,
      projects: projectChoiceList,
    };
  }, [selectedCwd, selectedProject, showWorktreeSwitcher, worktreeState, currentWorktreePath, projectChoiceList, projectNames]);
  const newSessionContextRef = useRef(newSessionContext);
  newSessionContextRef.current = newSessionContext;
  const newSessionContextSignature = newSessionContextKey(newSessionContext);
  useEffect(() => {
    onNewSessionContextChange?.(newSessionContextRef.current);
  }, [newSessionContextSignature, onNewSessionContextChange]);

  // Picking a session in another group makes its project current. The group
  // that was current keeps its look instead of folding up under the pointer
  // (keepOutgoingGroupOpen), before the browser paints the change. For the
  // page only: saved, every project visited would come back open after a reload.
  const previousCurrentProjectKeyRef = useRef(currentProjectKey);
  useLayoutEffect(() => {
    const previous = previousCurrentProjectKeyRef.current;
    previousCurrentProjectKeyRef.current = currentProjectKey;
    if (previous === null || previous === currentProjectKey) return;
    const outgoing = projectByKey.get(previous);
    setKeptOpenGroups((kept) => keepOutgoingGroupOpen(kept, groupExpansion, outgoing));
  }, [currentProjectKey, groupExpansion, projectByKey]);

  // An explicit choice for the groups `keys` (null: every group): saved, and
  // it replaces what the page kept open for them.
  // A group it folds also drops its "show more" window: opened again, it
  // shows its first rows only.
  const saveGroupChoices = useCallback((next: Readonly<Record<string, boolean>>, keys: readonly string[] | null) => {
    setGroupExpansion(next);
    saveGroupExpansion(next);
    setKeptOpenGroups((kept) => forgetKeptOpenGroups(kept, keys));
    setMoreShown((shown) => forgetShownMoreOfFolded(shown, next, keys));
  }, []);

  /**
   * Where focus goes when the control it was on is gone: the toolbar row's
   * search button, always there and enabled.
   */
  const selectedTabButton = useCallback(() => searchButtonRef.current, []);

  // A family's row where the tree shows it now (pinned, in its group, or in
  // the open archive view), else the selected tab.
  const familyRowButton = useCallback((rootId: string): HTMLElement | null => {
    const panel = sessionsPanelRef.current;
    for (const context of ["pinned", "group", "archive"]) {
      const key = CSS.escape(`session:${context}:${rootId}`);
      const button = panel?.querySelector<HTMLElement>(`[data-row-key="${key}"] .session-tree-main`);
      if (button && button.getClientRects().length > 0) return button;
    }
    return selectedTabButton();
  }, [selectedTabButton]);

  // A project's group header (its toggle), else the selected tab.
  const groupHeaderButton = useCallback((projectKey: string): HTMLElement | null => {
    const key = CSS.escape(`group:${projectKey}`);
    const button = sessionsPanelRef.current?.querySelector<HTMLElement>(`[data-row-key="${key}"] .session-tree-group-toggle`);
    return button && button.getClientRects().length > 0 ? button : selectedTabButton();
  }, [selectedTabButton]);

  // Pin and archive changes apply at once and are saved in the background; a
  // refused save rolls back (useSessionUiState) and says why in a toast.
  const applyUiState = useCallback(async (request: SessionUiStateRequest) => {
    const ok = await applyUiStateRequest(request);
    if (!ok) setUiWriteFailures((count) => count + 1);
    return ok;
  }, [applyUiStateRequest]);
  useEffect(() => {
    if (uiWriteFailures === shownUiWriteFailuresRef.current) return;
    shownUiWriteFailuresRef.current = uiWriteFailures;
    showToast(t("sidebar.uiStateFailed", { error: uiStateError ?? "" }));
  }, [uiWriteFailures, uiStateError, showToast, t]);

  // A drop, or Move up/down: the project goes next to another of its band.
  // Its band's projects without a place are saved first, top to bottom, so
  // it lands where the user saw it; past one request's worth (a full list, a
  // move before the first save), the bottom ones, which land where they
  // show. The moved group is then scrolled into view (a drop past a tall
  // group, a keyboard move); kept mounted until then, it is still there for
  // the menu to give focus back to.
  const moveProject = useCallback((projectKey: string, anchorKey: string, position: ProjectMovePosition) => {
    const project = projectByKey.get(projectKey);
    const anchor = projectByKey.get(anchorKey);
    // Pinned or unpinned in another window meanwhile: a move never crosses bands.
    if (!project || !anchor || project === anchor || project.pinned !== anchor.pinned) return;
    const add = model.unorderedKeysByBand[project.pinned ? "pinned" : "other"].slice(-MAX_SESSION_UI_IDS_PER_REQUEST);
    void applyUiState({ action: "move-project", projectKey, anchorKey, position, add });
    treeRevealIdRef.current += 1;
    setTreeReveal({ id: treeRevealIdRef.current, at: Date.now(), rowKey: `group:${projectKey}` });
  }, [applyUiState, model.unorderedKeysByBand, projectByKey]);

  // A hidden panel is display: none, and browsers do not reliably keep the
  // scroll position of what it holds. Positions are noted as the user
  // scrolls and put back when the panel (the tree under the archive view)
  // shows again; SessionTree then re-reads its window from them. A hidden
  // one is skipped: it has no box.
  const rememberScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element) panelScrollTopsRef.current.set(target, target.scrollTop);
  }, []);
  useLayoutEffect(() => {
    const panel = sessionsPanelRef.current;
    if (!panel || panel.hidden) return;
    for (const element of panel.querySelectorAll<HTMLElement>(".session-tree-scroll")) {
      const saved = panelScrollTopsRef.current.get(element);
      if (saved !== undefined && element.scrollTop !== saved) element.scrollTop = saved;
    }
  }, [archiveView]);

  // With `projectKey` (a group menu's "View archived") that project's header
  // goes to the top of the archive, unfolded if it was; the other projects
  // stay as they were.
  const openArchiveView = useCallback((projectKey?: string) => {
    setMenu(null);
    setArchiveView(true);
    // Search results would cover it.
    setSessionSearchOpen(false);
    if (projectKey === undefined) return;
    if (archiveCollapsed.includes(projectKey)) {
      const next = archiveCollapsed.filter((key) => key !== projectKey);
      setArchiveCollapsed(next);
      saveArchiveCollapsed(next);
    }
    treeRevealIdRef.current += 1;
    setArchiveReveal({ id: treeRevealIdRef.current, at: Date.now(), rowKey: `archive:${projectKey}`, block: "start" });
  }, [archiveCollapsed, setArchiveView]);

  // Opening the archive hides the tree that held focus (the footer link, a
  // menu's opener, the toast's View) and Back removes the archive's own
  // controls; while the view slides in or away, what it covers or what
  // leaves is inert first (focusIfHidden counts both). Focus that went with
  // them moves to the archive's Back button, then back to the footer link,
  // or to the tab when that row is not shown.
  const archiveBackRef = useRef<HTMLButtonElement>(null);
  const previousArchiveViewRef = useRef(archiveView);
  // Where closing the archive put focus: a fork opened from the archive
  // reveals its row and may take focus from there.
  const archiveCloseFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (previousArchiveViewRef.current === archiveView) return;
    previousArchiveViewRef.current = archiveView;
    if (archiveView) {
      focusIfHidden(archiveBackRef.current);
      return;
    }
    const footer = sessionsPanelRef.current?.querySelector<HTMLElement>('[data-row-key="footer-archived"] button');
    const target = footer && footer.getClientRects().length > 0 ? footer : selectedTabButton();
    focusIfHidden(target);
    if (target && document.activeElement === target) archiveCloseFocusRef.current = target;
  }, [archiveView, selectedTabButton]);

  // A session family's pin and archive flags live on its root session.
  const setFamilyPinned = useCallback((family: SessionFamily, pinned: boolean) => {
    void applyUiState({ action: "set", ids: [family.root.id], pinned });
  }, [applyUiState]);

  const markFamilyRead = useCallback((family: SessionFamily, read: boolean) => {
    setUnreadSessionIds((prev) => {
      const next = new Set(prev);
      if (read) {
        for (const id of familyIds(family)) next.delete(id);
      } else {
        // Subagents never carry the marker (loadSessions prunes them).
        next.add(family.root.id);
      }
      return next;
    });
  }, []);

  // Unread markers coming back (Undo, a refused archive), except on the
  // session that is open by now: it has been read.
  const restoreUnread = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return;
    setUnreadSessionIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (id !== selectedSessionIdRef.current) next.add(id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, []);

  const archiveFamilies = useCallback((families: readonly SessionFamily[]) => {
    const archivable = families.filter((family) => !family.root.transient);
    if (archivable.length === 0) return;
    const snapshot = snapshotUiState(archivable.map((family) => family.root.id));
    // Archived means dealt with: its unread markers go, and Undo brings them back.
    const memberIds = archivable.flatMap((family) => familyIds(family));
    const unreadBefore = memberIds.filter((id) => unreadSessionIds.has(id));
    // A request carries at most MAX_SESSION_UI_IDS_PER_REQUEST families, so a
    // big "Archive sessions older than 7 days" goes in parts; the write queue
    // of useSessionUiState keeps them, and an Undo after them, in order.
    for (const part of chunkForSessionUiRequests(archivable)) {
      const ids = part.map((family) => family.root.id);
      void applyUiState({ action: "set", ids, archived: true }).then((ok) => {
        // A refused part is back in the tree (rolled back): so are its markers.
        if (ok || unreadBefore.length === 0) return;
        const partIds = new Set(part.flatMap((family) => familyIds(family)));
        restoreUnread(unreadBefore.filter((id) => partIds.has(id)));
      });
    }
    if (unreadBefore.length > 0) {
      setUnreadSessionIds((prev) => {
        const next = new Set(prev);
        for (const id of memberIds) next.delete(id);
        return next;
      });
    }
    const message = archivable.length === 1
      ? t("sidebar.archivedToast", { title: shortTitle(sessionRowTitle(archivable[0].root), TOAST_TITLE_MAX) })
      : t("sidebar.archivedManyToast", { count: archivable.length });
    showToast(message, [
      {
        id: "undo",
        label: t("sidebar.undo"),
        onClick: () => {
          for (const entries of chunkForSessionUiRequests(snapshot)) {
            void applyUiState({ action: "restore", entries });
          }
          restoreUnread(unreadBefore);
          // The toast held focus; the first family back in the tree takes it.
          focusAfterCommit(() => familyRowButton(archivable[0].root.id));
        },
      },
      { id: "view", label: t("sidebar.viewArchive"), onClick: () => openArchiveView() },
    ]);
  }, [applyUiState, focusAfterCommit, familyRowButton, openArchiveView, restoreUnread, showToast, snapshotUiState, t, unreadSessionIds]);

  // The row's archive button. A running family would come straight back, so
  // it is not archived (the row offers no button for it either).
  const archiveFamily = useCallback((family: SessionFamily) => {
    if (familyIds(family).some((id) => runningSessionIds.has(id))) return;
    archiveFamilies([family]);
  }, [archiveFamilies, runningSessionIds]);

  // Out of the archive: one row's Restore, or an archive menu's Restore all
  // (in parts, as a bulk archive goes; Undo after them, in order).
  const restoreFamilies = useCallback((families: readonly SessionFamily[]) => {
    if (families.length === 0) return;
    const ids = families.map((family) => family.root.id);
    const snapshot = snapshotUiState(ids);
    for (const part of chunkForSessionUiRequests(ids)) {
      void applyUiState({ action: "set", ids: part, archived: false });
    }
    const message = families.length === 1
      ? t("sidebar.restoredToast", { title: shortTitle(sessionRowTitle(families[0].root), TOAST_TITLE_MAX) })
      : t("sidebar.restoredManyToast", { count: families.length });
    showToast(message, [
      {
        id: "undo",
        label: t("sidebar.undo"),
        onClick: () => {
          for (const entries of chunkForSessionUiRequests(snapshot)) {
            void applyUiState({ action: "restore", entries });
          }
          // Back in the archive view if it is open; else the tab takes focus.
          focusAfterCommit(() => familyRowButton(families[0].root.id));
        },
      },
    ]);
  }, [applyUiState, familyRowButton, focusAfterCommit, showToast, snapshotUiState, t]);

  const restoreFamily = useCallback((family: SessionFamily) => restoreFamilies([family]), [restoreFamilies]);

  const startRename = useCallback((family: SessionFamily) => {
    if (family.root.transient) return;
    setConfirmDeleteRootId(null);
    setRenamingRootId(family.root.id);
  }, []);

  const commitRename = useCallback(async (family: SessionFamily, renameValue: string) => {
    const session = family.root;
    const title = sessionRowTitle(session);
    const name = renameValue.trim();
    setRenamingRootId((current) => (current === session.id ? null : current));
    // No-op when unchanged: the fallback title (first message / id) isn't a
    // real stored name, so don't persist it as one. (The rename input seeds
    // from the same collapsed first message, so an untouched rename of a
    // skill-invoked session stays a no-op instead of persisting raw XML.)
    if (renameValue === title || name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      void loadSessions();
    } catch {
      // ignore
    }
  }, [loadSessions]);

  // A project's display name is pi-web's own (the UI state file): renaming
  // it never selects the project, nor moves, pins or folds its group. The
  // header's field goes as the name is saved; its toggle takes the focus.
  const startProjectRename = useCallback((project: SidebarProject) => {
    setRenamingProjectKey(project.key);
  }, []);

  const endProjectRename = useCallback((projectKey: string) => {
    setRenamingProjectKey((current) => (current === projectKey ? null : current));
    focusAfterCommit(() => groupHeaderButton(projectKey));
  }, [focusAfterCommit, groupHeaderButton]);

  const commitProjectRename = useCallback((project: SidebarProject, value: string) => {
    endProjectRename(project.key);
    const request = projectRenameRequest(project, value);
    if (request) void applyUiState(request);
  }, [applyUiState, endProjectRename]);

  const performDelete = useCallback(async (family: SessionFamily) => {
    const session = family.root;
    if (session.transient) return;
    setConfirmDeleteRootId((current) => (current === session.id ? null : current));
    try {
      // The server deletes the family's subagent sessions with it.
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onSessionDeleted?.(session.id);
      void loadSessions();
    } catch {
      // The row stays; the next refresh shows what happened.
    }
  }, [loadSessions, onSessionDeleted]);

  // Only Shift skips the confirmation (Shift+click, Shift+Enter or Shift+D in the menu).
  const requestDelete = useCallback((family: SessionFamily, shiftKey: boolean) => {
    if (shiftKey) {
      void performDelete(family);
    } else {
      setRenamingRootId(null);
      setConfirmDeleteRootId(family.root.id);
    }
  }, [performDelete]);

  // Fork (the row menu's F): the server copies the family's current branch
  // into a new session beside it (POST /api/sessions/[id]/fork) and leaves
  // the source as it is, running or not. The copy opens where its row is: the
  // archive view closes (the copy has no pin or archive flag), a group the
  // user collapsed opens, and the main tree scrolls to the row, which takes
  // focus when it is still on the source's row (or fell to the page). Called
  // after a request and from a toast, so always through openForkedRef: the
  // newest state and AppShell's newest selection handler, never a click-time
  // closure. `fromRowKey` is the row whose Fork this answers: focus may move
  // from it, and a phone's drawer stays open, since the copy looks just like
  // its source and only the sidebar (its row, the toast) tells them apart.
  // null is the toast's Open, which opens the copy as a row click does.
  const openForked = (forked: SessionInfo, fromRowKey: string | null) => {
    archiveCloseFocusRef.current = null;
    if (archiveView) {
      // The main tree's saved position would be put back over the reveal.
      const main = sessionsPanelRef.current?.querySelector(".sidebar-sessions-view .session-tree-scroll");
      if (main) panelScrollTopsRef.current.delete(main);
      setArchiveView(false);
    }
    const groupKey = workspaceKeyOf(forked);
    if (Object.hasOwn(shownGroupExpansion, groupKey) && shownGroupExpansion[groupKey] === false) {
      const next = { ...groupExpansion };
      // Re-inserted, so the choice counts as the newest one kept.
      delete next[groupKey];
      next[groupKey] = true;
      saveGroupChoices(next, [groupKey]);
    }
    handleSelectSessionFromList(forked, undefined, undefined, { keepSidebarOpen: fromRowKey !== null });
    // The route invalidated the list: the next load has the copy.
    void loadSessions();
    const fromRow = fromRowKey ? `[data-row-key="${CSS.escape(fromRowKey)}"]` : null;
    treeRevealIdRef.current += 1;
    setTreeReveal({
      id: treeRevealIdRef.current,
      at: Date.now(),
      rowKey: `session:group:${forked.id}`,
      takeFocusFrom: (active) => (fromRow !== null && active.closest(fromRow) !== null) || active === archiveCloseFocusRef.current,
    });
  };
  const openForkedRef = useRef(openForked);
  openForkedRef.current = openForked;

  // One fork per session at a time: F again on a session whose fork is under
  // way does nothing; another session's Fork goes ahead.
  const forkingIdsRef = useRef(new Set<string>());
  const forkFamily = useCallback(async (row: SessionRow) => {
    const source = row.family.root;
    if (source.transient || forkingIdsRef.current.has(source.id)) return;
    forkingIdsRef.current.add(source.id);
    const selectedAtClick = selectedSessionIdRef.current;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(source.id)}/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await res.json().catch(() => ({})) as { session?: SessionInfo; code?: string; error?: string };
      if (!res.ok || !data.session) {
        const { key, params } = forkFailureMessage(data.code, data.error ?? `HTTP ${res.status}`);
        showToast(t(key, params));
        // Deleted elsewhere (the pi CLI, another window): its row goes.
        if (data.code === "not_found") void loadSessions();
        return;
      }
      const forked = data.session;
      // The copy's name ends in the suffix that tells it from its source: the
      // toast's ellipsis cuts the name before it, never the suffix. A copy
      // left unnamed (its source had no title) is cut as other toasts are.
      const title = sessionRowTitle(forked);
      const { head: message, tail } = splitBeforeForkSuffix(t("sidebar.forkedToast", { title }), title)
        ?? { head: t("sidebar.forkedToast", { title: shortTitle(title, TOAST_TITLE_MAX) }), tail: undefined };
      if (selectedSessionIdRef.current !== selectedAtClick) {
        // Another session was opened meanwhile: the user stays there. The
        // copy waits in its group, unread (so it shows beyond the group's
        // limit), and the toast offers to open it.
        setAllSessions((current) => (current.some((session) => session.id === forked.id) ? current : [forked, ...current]));
        setUnreadSessionIds((prev) => new Set(prev).add(forked.id));
        void loadSessions();
        showToast(message, [{ id: "open", label: t("sidebar.open"), onClick: () => openForkedRef.current(forked, null) }], tail);
        return;
      }
      openForkedRef.current(forked, row.key);
      showToast(message, [], tail);
    } catch (error) {
      showToast(t("sidebar.forkFailed", { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      forkingIdsRef.current.delete(source.id);
    }
  }, [loadSessions, showToast, t]);

  // Open in new tab (the row menu's T): the row's session in a browser tab of
  // its own, by the same link its title carries. This tab's selection, cwd and
  // file tabs stay as they are, and nothing is asked of the server here: the
  // new tab loads the session as a reload would. Synchronous inside the menu's
  // click or key press, so the browser counts it as the user's and does not
  // block it as a popup. Its return value says nothing: with noopener the
  // browser returns null whether the tab opened or not.
  const openFamilyInNewTab = useCallback((family: SessionFamily) => {
    if (family.root.transient) return;
    window.open(sessionDeepLink(family.root.id), "_blank", "noopener,noreferrer");
  }, []);

  const runSessionAction = (id: SessionMenuActionId, row: SessionRow, shiftKey: boolean) => {
    const { family } = row;
    switch (id) {
      case "open-new-tab": openFamilyInNewTab(family); break;
      case "pin": setFamilyPinned(family, true); break;
      case "unpin": setFamilyPinned(family, false); break;
      case "rename": startRename(family); break;
      case "fork": void forkFamily(row); break;
      case "mark-read": markFamilyRead(family, true); break;
      case "mark-unread": markFamilyRead(family, false); break;
      case "archive": archiveFamily(family); break;
      case "unarchive": restoreFamily(family); break;
      case "delete": requestDelete(family, shiftKey); break;
    }
  };

  const openRowMenu = useCallback((row: SessionRow, anchor: SidebarMenuAnchor, opener: HTMLElement | null) => {
    if (row.status.transient) return;
    setMenu({ kind: "row", row, anchor, opener });
  }, []);

  // Right-click: an extension listening for the downstream event (a pi-web
  // integration) claims the row first; only an unclaimed event opens the
  // built-in menu. A transient row has nothing to offer, so the browser's own
  // menu stays.
  const handleContextMenu = useCallback((row: SessionRow, event: ReactMouseEvent) => {
    const session = row.family.root;
    if (session.id === renamingRootId || session.id === confirmDeleteRootId) return;
    if (dispatchSessionRowContextMenu({
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name,
      clientX: event.clientX,
      clientY: event.clientY,
      refresh: () => { void loadSessions(); },
    })) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (session.transient) return;
    event.preventDefault();
    const rowElement = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    // The keyboard's context-menu key reports no pointer position.
    const anchor: SidebarMenuAnchor = event.clientX === 0 && event.clientY === 0 && rowElement
      ? buttonAnchor(rowElement, "start")
      : { kind: "point", x: event.clientX, y: event.clientY };
    // Focus goes back into the row it came from (the keyboard case). An
    // element elsewhere (the composer) is not made the menu's opener, whose
    // next click the menu would take as "close"; it gets focus back after.
    const active = document.activeElement;
    const inRow = active instanceof HTMLElement && rowElement !== null && rowElement.contains(active);
    contextMenuFocusRef.current = !inRow && active instanceof HTMLElement && active !== document.body ? active : null;
    openRowMenu(row, anchor, inRow ? active : null);
  }, [confirmDeleteRootId, loadSessions, openRowMenu, renamingRootId]);

  const treeSelectionInput = useMemo(() => ({
    sessions: allSessions,
    uiState,
    runningIds: runningSessionIds,
    awaitingIds: awaitingInputSessionIds,
    unreadIds: unreadSessionIds,
    selectedSessionId,
  }), [allSessions, uiState, runningSessionIds, awaitingInputSessionIds, unreadSessionIds, selectedSessionId]);

  const handleGroupMenu = useCallback((project: SidebarProject, opener: HTMLElement) => {
    const olderCount = familiesToArchive(treeSelectionInput, project.key, ARCHIVE_OLDER_THAN_MS, Date.now()).length;
    setMenu({ kind: "group", project, olderCount, anchor: buttonAnchor(opener, "end"), opener });
  }, [treeSelectionInput]);

  const archiveOlderSessions = useCallback((project: SidebarProject) => {
    const ids = familiesToArchive(treeSelectionInput, project.key, ARCHIVE_OLDER_THAN_MS, Date.now());
    archiveFamilies(ids.flatMap((id) => {
      const family = familyByRootId.get(id);
      return family ? [family] : [];
    }));
  }, [archiveFamilies, familyByRootId, treeSelectionInput]);

  // A project's "Delete all sessions…" (and the archive's deletes): the menu
  // turns into its question, focus on Cancel (the sheet's on a phone), so
  // Enter deletes nothing; Cancel goes back to the list. Delete closes the
  // menu and sends the families the question counts at that moment, running
  // ones kept (the server also keeps one that started since); toasts say how
  // it went. One run per project (or archive scope) at a time.
  const askProjectDelete = useCallback((projectKey: string, askDelete: boolean) => {
    setMenu((current) => (current?.kind === "group" && current.project.key === projectKey ? { ...current, askDelete } : current));
  }, []);

  const deletingRunsRef = useRef(new Set<string>());
  const deleteFamilyIds = useCallback(async (runKey: string, ids: readonly string[], focusTarget: () => HTMLElement | null) => {
    setMenu(null);
    if (ids.length === 0 || deletingRunsRef.current.has(runKey)) return;
    deletingRunsRef.current.add(runKey);
    showToast(t("sidebar.deletingSessions"));
    try {
      const outcome = await deleteProjectSessions(ids, fetch);
      for (const id of outcome.deleted) onSessionDeleted?.(id);
      // A group goes with its last session (in the tree, unless it is
      // current or pinned): focus that fell to the page with it moves on.
      void loadSessions().then(() => focusAfterCommit(focusTarget));
      if (outcome.error !== null) {
        showToast(t("sidebar.deleteFailed", { error: outcome.error }));
        return;
      }
      const count = outcome.deletedRoots.length;
      const parts = [count === 1 ? t("sidebar.deletedOneToast") : t("sidebar.deletedManyToast", { count })];
      if (outcome.running.length > 0) parts.push(t("sidebar.keptRunningToast", { count: outcome.running.length }));
      showToast(parts.join(" · "));
    } finally {
      deletingRunsRef.current.delete(runKey);
    }
  }, [focusAfterCommit, loadSessions, onSessionDeleted, showToast, t]);

  const deleteAllProjectSessions = useCallback((project: SidebarProject) => {
    const { ids } = familiesToDelete(treeSelectionInput, project.key);
    void deleteFamilyIds(`project:${project.key}`, ids, () => groupHeaderButton(project.key));
  }, [deleteFamilyIds, groupHeaderButton, treeSelectionInput]);

  // The archive's own menus: a project header's ⋯ (Restore all, Delete
  // all…) and the bar's (fold every project, Restore all, the two deletes).
  // Their counts are live; Restore and Delete take what is archived when
  // chosen. An archived family never runs, so nothing is kept back.
  // A project's archive header (its toggle), else the archive's Back, else the selected tab.
  const archiveHeaderButton = useCallback((projectKey: string | null): HTMLElement | null => {
    const key = projectKey === null ? null : CSS.escape(`archive:${projectKey}`);
    const button = key === null ? null : sessionsPanelRef.current?.querySelector<HTMLElement>(`[data-row-key="${key}"] .session-tree-group-toggle`);
    if (button && button.getClientRects().length > 0) return button;
    const back = archiveBackRef.current;
    return back && back.getClientRects().length > 0 ? back : selectedTabButton();
  }, [selectedTabButton]);

  const familiesOf = useCallback((ids: readonly string[]) => ids.flatMap((id) => {
    const family = familyByRootId.get(id);
    return family ? [family] : [];
  }), [familyByRootId]);

  const handleArchiveGroupMenu = useCallback((project: SidebarProject, opener: HTMLElement) => {
    setMenu({ kind: "archive-group", project, anchor: buttonAnchor(opener, "end"), opener });
  }, []);

  const openArchiveMenu = useCallback((opener: HTMLElement) => {
    setMenu((current) => (current?.kind === "archive" ? null : { kind: "archive", anchor: buttonAnchor(opener, "end"), opener }));
  }, []);

  const askArchiveDelete = useCallback((askDelete: ArchiveDeleteScope | undefined) => {
    setMenu((current) => {
      if (current?.kind === "archive") return { ...current, askDelete };
      if (current?.kind === "archive-group") return { ...current, askDelete: askDelete !== undefined };
      return current;
    });
  }, []);

  const archiveDeleteIds = useCallback((scope: ArchiveDeleteScope | { projectKey: string }) => archivedFamilyIds(
    treeSelectionInput,
    scope === "all" ? {} : scope === "old" ? { archivedBefore: Date.now() - ARCHIVED_DELETE_AFTER_MS } : scope,
  ), [treeSelectionInput]);

  const deleteArchived = useCallback((scope: ArchiveDeleteScope | { projectKey: string }) => {
    const ids = archiveDeleteIds(scope);
    const runKey = typeof scope === "string" ? `archive:${scope}` : `archive-project:${scope.projectKey}`;
    void deleteFamilyIds(runKey, ids, () => (typeof scope === "string" ? archiveHeaderButton(null) : archiveHeaderButton(scope.projectKey)));
  }, [archiveDeleteIds, archiveHeaderButton, deleteFamilyIds]);

  // Folding the archive's projects: one header, or (Alt+click, the bar's
  // menu) every one of them. Saved per browser, the newest choice last.
  const saveArchiveFolds = useCallback((next: readonly string[]) => {
    setArchiveCollapsed(next);
    saveArchiveCollapsed(next);
  }, []);
  const setAllArchiveGroupsExpanded = useCallback((expanded: boolean) => {
    const keys = archiveGroups.map((row) => row.project.key);
    const others = archiveCollapsed.filter((key) => !keys.includes(key));
    saveArchiveFolds(expanded ? others : [...others, ...keys]);
  }, [archiveCollapsed, archiveGroups, saveArchiveFolds]);
  const handleToggleArchiveGroup = useCallback((projectKey: string, all: boolean) => {
    const expanded = archiveCollapsed.includes(projectKey);
    if (all) {
      setAllArchiveGroupsExpanded(expanded);
      return;
    }
    const others = archiveCollapsed.filter((key) => key !== projectKey);
    saveArchiveFolds(expanded ? others : [...others, projectKey]);
  }, [archiveCollapsed, saveArchiveFolds, setAllArchiveGroupsExpanded]);

  // A group's "+": a new session at once. The current project starts in the
  // sidebar's worktree, another one in its root (the main checkout); the bar
  // above the fresh composer picks another worktree. The group's own key and
  // root go along, so a worktree is never taken for another project, and a
  // pinned project without sessions keeps its server identity.
  const handleGroupNew = useCallback((project: SidebarProject) => {
    setMenu(null);
    startNewSessionIn(newSessionTargetForProject(project, selectedCwd));
  }, [selectedCwd, startNewSessionIn]);

  const closeMenu = useCallback(() => setMenu(null), []);

  // After a right-click menu, focus returns to where it was unless the chosen
  // action put it somewhere (a rename field, a delete confirmation).
  useEffect(() => {
    if (menu !== null) return;
    const previous = contextMenuFocusRef.current;
    contextMenuFocusRef.current = null;
    if (!previous?.isConnected) return;
    const active = document.activeElement;
    if (!active || active === document.body) previous.focus({ preventScroll: true });
  }, [menu]);

  // A row whose menu is open can leave the tree (archived or deleted in
  // another window): its menu goes with it.
  const visibleRows = archiveView ? archiveRows : model.rows;
  useEffect(() => {
    if (menu?.kind === "row" && !visibleRows.some((row) => row.key === menu.row.key)) setMenu(null);
    if (menu?.kind === "archive-group" && !visibleRows.some((row) => row.key === `archive:${menu.project.key}`)) setMenu(null);
  }, [menu, visibleRows]);

  // Rows are rebuilt on every refresh; the menu acts on the current one.
  const menuRow = menu?.kind === "row"
    ? (visibleRows.find((row): row is SessionRow => row.kind === "session" && row.key === menu.row.key) ?? menu.row)
    : null;

  const handleSelectFamily = useCallback((family: SessionFamily) => {
    handleSelectSessionFromList(family.root);
  }, [handleSelectSessionFromList]);

  // Every group at once: a group's menu, or Alt+click on its header.
  // Re-inserted, so the choices count as the newest ones kept.
  const setAllGroupsExpanded = useCallback((expanded: (project: SidebarProject) => boolean) => {
    const next = { ...groupExpansion };
    for (const project of model.projects) {
      delete next[project.key];
      next[project.key] = expanded(project);
    }
    saveGroupChoices(next, null);
  }, [groupExpansion, model.projects, saveGroupChoices]);

  // Expanding or collapsing a group only changes the view: it never moves the
  // cwd (picking a project does that, in the files tab). With Alt, every
  // group follows the one clicked, as in a Finder outline.
  const handleToggleGroup = useCallback((projectKey: string, all: boolean) => {
    const project = projectByKey.get(projectKey);
    if (!project) return;
    const expanded = !isGroupExpanded(project, shownGroupExpansion);
    if (all) {
      setAllGroupsExpanded(() => expanded);
      return;
    }
    const next = { ...groupExpansion };
    // Re-inserted, so the choice counts as the newest one kept.
    delete next[projectKey];
    next[projectKey] = expanded;
    saveGroupChoices(next, [projectKey]);
  }, [groupExpansion, projectByKey, saveGroupChoices, setAllGroupsExpanded, shownGroupExpansion]);

  // The window a click opens is the one its row offers now (`nextShown`):
  // decided at the click, by position, so a row that turns selected, unread
  // or running later never shifts it.
  const handleShowMore = useCallback((key: string) => {
    const row = model.rows.find((item) => (item.kind === "group-more" && item.projectKey === key)
      || (item.kind === "pinned-more" && key === PINNED_MORE_KEY));
    if (row?.kind !== "group-more" && row?.kind !== "pinned-more") return;
    setMoreShown((prev) => showMoreFamilies(prev, key, row.nextShown));
  }, [model.rows]);
  const handleShowLess = useCallback((key: string) => {
    setMoreShown((prev) => showLessFamilies(prev, key));
  }, []);

  const handleTogglePinned = () => {
    const next = !pinnedCollapsed;
    setPinnedCollapsed(next);
    savePinnedCollapsed(next);
    // Folded, the pinned section drops its "show more" window as a group does.
    if (next) setMoreShown((shown) => showLessFamilies(shown, PINNED_MORE_KEY));
  };

  const openProjectInNewTab = (project: SidebarProject) => {
    const { cwd } = newSessionTargetForProject(project, selectedCwd);
    // Navigation only, synchronous in the menu action so the browser permits it.
    window.open(newSessionDeepLink(cwd), "_blank", "noopener,noreferrer");
  };

  const sessionMenuItems = (row: SessionRow): SidebarMenuItem[] => sessionMenuEntries(row.context, row.status).map((entry, index) => {
    if (entry.kind === "separator") return { type: "separator", id: `separator-${index}` };
    const label = t(SESSION_ACTION_LABEL_KEYS[entry.id]);
    return {
      type: "item",
      id: entry.id,
      label: entry.id === "delete" ? `${label}…` : label,
      icon: sessionActionIcon(entry.id),
      shortcut: entry.shortcut,
      danger: entry.id === "delete",
      disabled: entry.disabledReason !== undefined,
      disabledReason: entry.disabledReason === "running" ? t("sidebar.cannotArchiveRunning") : undefined,
      onSelect: ({ shiftKey }) => runSessionAction(entry.id, row, shiftKey),
    };
  });

  const groupMenuItems = (project: SidebarProject, olderCount: number): SidebarMenuItem[] => {
    const archivedCount = archiveIndex.countByProject.get(project.key) ?? 0;
    const deletable = familiesToDelete(treeSelectionInput, project.key);
    // Within the project's band; disabled at its edges.
    const up = adjacentProjectMove(model.projects, project.key, "up");
    const down = adjacentProjectMove(model.projects, project.key, "down");
    const nameItems = projectNameMenuEntries(project).map((id): SidebarMenuItem => (id === "rename-project" ? {
      type: "item",
      id,
      label: t("sidebar.renameProject"),
      icon: <PencilIcon />,
      onSelect: () => startProjectRename(project),
    } : {
      type: "item",
      id,
      label: t("sidebar.resetProjectName"),
      icon: <RestoreIcon />,
      onSelect: () => { void applyUiState({ action: "rename-project", projectKey: project.key, name: null }); },
    }));
    // Three groups, by what they act on: the project itself, its place in the
    // list, its sessions (Delete all last, in red).
    return [
      {
        type: "item",
        id: "pin-project",
        label: t(project.pinned ? "sidebar.unpinProject" : "sidebar.pinProject"),
        icon: project.pinned ? <PinOffIcon /> : <PinIcon />,
        onSelect: () => { void applyUiState({ action: "pin-project", projectKey: project.key, root: project.root, pinned: !project.pinned }); },
      },
      ...nameItems,
      {
        type: "item",
        id: "open-new-tab",
        label: t("sidebar.openInNewTab"),
        icon: <OpenInNewTabIcon />,
        shortcut: "T",
        onSelect: () => openProjectInNewTab(project),
      },
      { type: "separator", id: "separator-layout" },
      {
        type: "item",
        id: "move-up",
        label: t("sidebar.moveProjectUp"),
        icon: <ChevronIcon className="sidebar-icon-up" />,
        disabled: up === null,
        onSelect: () => { if (up) moveProject(project.key, up.anchorKey, up.position); },
      },
      {
        type: "item",
        id: "move-down",
        label: t("sidebar.moveProjectDown"),
        icon: <ChevronIcon className="sidebar-icon-down" />,
        disabled: down === null,
        onSelect: () => { if (down) moveProject(project.key, down.anchorKey, down.position); },
      },
      {
        // This project open, every other one closed.
        type: "item",
        id: "collapse-others",
        label: t("sidebar.collapseOtherGroups"),
        icon: <ChevronIcon />,
        disabled: model.projects.every((other) => isGroupExpanded(other, shownGroupExpansion) === (other.key === project.key)),
        onSelect: () => setAllGroupsExpanded((other) => other.key === project.key),
      },
      {
        type: "item",
        id: "expand-all",
        label: t("sidebar.expandAllGroups"),
        icon: <ChevronIcon className="sidebar-icon-down" />,
        disabled: model.projects.every((other) => isGroupExpanded(other, shownGroupExpansion)),
        onSelect: () => setAllGroupsExpanded(() => true),
      },
      { type: "separator", id: "separator-sessions" },
      {
        type: "item",
        id: "archive-older",
        label: t("sidebar.archiveOlderThanWeek", { count: olderCount }),
        icon: <ArchiveIcon />,
        disabled: olderCount === 0,
        onSelect: () => archiveOlderSessions(project),
      },
      {
        type: "item",
        id: "view-archived",
        label: t("sidebar.viewArchived", { count: archivedCount }),
        icon: <ArchiveIcon />,
        disabled: archivedCount === 0,
        onSelect: () => openArchiveView(project.key),
      },
      {
        type: "item",
        id: "delete-all",
        label: t("sidebar.deleteProjectSessions", { count: deletable.ids.length }),
        icon: <TrashIcon />,
        danger: true,
        disabled: deletable.ids.length === 0,
        onSelect: ({ keepOpen }) => {
          keepOpen();
          askProjectDelete(project.key, true);
        },
      },
    ];
  };

  // A menu's delete question (a project's "Delete all sessions…", the
  // archive's deletes); its counts are live.
  const deleteQuestionBody = ({ heading, headingTitle, notes, count, onConfirm, onCancel }: {
    heading: string;
    headingTitle?: string;
    notes: string[];
    count: number;
    onConfirm: () => void;
    onCancel: () => void;
  }): ReactNode => (
    <div className="sidebar-menu-question">
      <div className="sidebar-menu-header" title={headingTitle}>{heading}</div>
      {notes.map((note) => <p key={note} className="sidebar-menu-question-text">{note}</p>)}
      <div className="sidebar-menu-question-buttons">
        <button type="button" className="sidebar-menu-question-confirm" disabled={count === 0} onClick={onConfirm}>
          {t("sidebar.deleteCount", { count })}
        </button>
        {!isMobile && (
          <button type="button" className="sidebar-menu-question-cancel" data-sidebar-menu-autofocus="" onClick={onCancel}>
            {t("sidebar.cancel")}
          </button>
        )}
      </div>
    </div>
  );

  const projectDeleteBody = (project: SidebarProject): ReactNode => {
    const { ids, running } = familiesToDelete(treeSelectionInput, project.key);
    return deleteQuestionBody({
      heading: t("sidebar.deleteProjectSessionsHeading", { name: project.name }),
      headingTitle: project.root,
      notes: [
        t("sidebar.deleteProjectSessionsMessage"),
        ...(running > 0 ? [t("sidebar.deleteProjectSessionsRunning", { count: running })] : []),
      ],
      count: ids.length,
      onConfirm: () => deleteAllProjectSessions(project),
      onCancel: () => askProjectDelete(project.key, false),
    });
  };

  const archiveGroupMenuItems = (project: SidebarProject): SidebarMenuItem[] => {
    const ids = archiveDeleteIds({ projectKey: project.key });
    return [
      {
        type: "item",
        id: "restore-all",
        label: t("sidebar.restoreAllArchived", { count: ids.length }),
        icon: <RestoreIcon />,
        disabled: ids.length === 0,
        onSelect: () => restoreFamilies(familiesOf(ids)),
      },
      { type: "separator", id: "separator-delete" },
      {
        type: "item",
        id: "delete-all",
        label: t("sidebar.deleteAllArchived", { count: ids.length }),
        icon: <TrashIcon />,
        danger: true,
        disabled: ids.length === 0,
        onSelect: ({ keepOpen }) => {
          keepOpen();
          askArchiveDelete("all");
        },
      },
    ];
  };

  const archiveMenuItems = (): SidebarMenuItem[] => {
    const all = archiveDeleteIds("all");
    const old = archiveDeleteIds("old");
    const folded = archiveGroups.filter((row) => !row.expanded).length;
    return [
      {
        type: "item",
        id: "collapse-all",
        label: t("sidebar.collapseAllGroups"),
        icon: <ChevronIcon />,
        disabled: folded === archiveGroups.length,
        onSelect: () => setAllArchiveGroupsExpanded(false),
      },
      {
        type: "item",
        id: "expand-all",
        label: t("sidebar.expandAllGroups"),
        icon: <ChevronIcon className="sidebar-icon-down" />,
        disabled: folded === 0,
        onSelect: () => setAllArchiveGroupsExpanded(true),
      },
      { type: "separator", id: "separator-sessions" },
      {
        type: "item",
        id: "restore-all",
        label: t("sidebar.restoreAllArchived", { count: all.length }),
        icon: <RestoreIcon />,
        disabled: all.length === 0,
        onSelect: () => restoreFamilies(familiesOf(all)),
      },
      {
        type: "item",
        id: "delete-old",
        label: t("sidebar.deleteOldArchived", { count: old.length }),
        icon: <TrashIcon />,
        danger: true,
        disabled: old.length === 0,
        onSelect: ({ keepOpen }) => {
          keepOpen();
          askArchiveDelete("old");
        },
      },
      {
        type: "item",
        id: "delete-all",
        label: t("sidebar.deleteAllArchived", { count: all.length }),
        icon: <TrashIcon />,
        danger: true,
        disabled: all.length === 0,
        onSelect: ({ keepOpen }) => {
          keepOpen();
          askArchiveDelete("all");
        },
      },
    ];
  };

  const archiveDeleteBody = (scope: ArchiveDeleteScope | { projectKey: string }, project: SidebarProject | null): ReactNode => deleteQuestionBody({
    heading: project
      ? t("sidebar.deleteArchivedInProjectHeading", { name: project.name })
      : t(scope === "old" ? "sidebar.deleteOldArchivedHeading" : "sidebar.deleteAllArchivedHeading"),
    headingTitle: project?.root,
    notes: [t("sidebar.deleteArchivedMessage")],
    count: archiveDeleteIds(scope).length,
    onConfirm: () => deleteArchived(scope),
    onCancel: () => askArchiveDelete(undefined),
  });

  let menuTitle: string | undefined;
  let menuLabel = "";
  // Room for "Archive sessions older than 7 days · N".
  let menuWidth: number | undefined;
  let menuItems: SidebarMenuItem[] | undefined;
  let menuBody: ReactNode = null;
  if (menu?.kind === "row" && menuRow) {
    menuTitle = sessionRowTitle(menuRow.family.root);
    menuLabel = t("sidebar.sessionActions");
    menuItems = sessionMenuItems(menuRow);
  } else if (menu?.kind === "group") {
    // The project as the tree has it now: pinned, unpinned, renamed or moved in another window while the menu is open.
    const project = projectByKey.get(menu.project.key) ?? menu.project;
    menuTitle = project.name;
    menuLabel = t("sidebar.projectActions", { name: project.name });
    menuItems = groupMenuItems(project, menu.olderCount);
    if (menu.askDelete) menuBody = projectDeleteBody(project);
    menuWidth = 264;
  } else if (menu?.kind === "archive-group") {
    const project = archiveGroups.find((row) => row.project.key === menu.project.key)?.project ?? menu.project;
    menuTitle = project.name;
    menuLabel = t("sidebar.archivedProjectActions", { name: project.name });
    menuItems = archiveGroupMenuItems(project);
    if (menu.askDelete) menuBody = archiveDeleteBody({ projectKey: project.key }, project);
    menuWidth = 248;
  } else if (menu?.kind === "archive") {
    menuTitle = t("sidebar.archived");
    menuLabel = t("sidebar.archiveActions");
    menuItems = archiveMenuItems();
    if (menu.askDelete) menuBody = archiveDeleteBody(menu.askDelete, null);
    menuWidth = 280;
  }

  // The tree row (and the button in it) that the open menu belongs to.
  const activeMenuRowKey = menu?.kind === "row"
    ? menu.row.key
    : menu?.kind === "group" ? `group:${menu.project.key}`
    : menu?.kind === "archive-group" ? `archive:${menu.project.key}` : null;

  const treeLayout = isMobile ? "mobile" : "desktop";
  // Until pins and archive have loaded, archived rows would flash in.
  const treeLoading = loading || !uiStateLoaded;
  const treeProps = {
    layout: treeLayout,
    loading: treeLoading,
    error,
    renamingRootId,
    renamingProjectKey,
    confirmDeleteRootId,
    activeMenuRowKey,
    onSelectFamily: handleSelectFamily,
    onToggleGroup: handleToggleGroup,
    onShowMore: handleShowMore,
    onShowLess: handleShowLess,
    onTogglePinned: handleTogglePinned,
    onArchiveFamily: archiveFamily,
    onRestoreFamily: restoreFamily,
    onOpenRowMenu: openRowMenu,
    onRowContextMenu: handleContextMenu,
    onRenameCommit: (family: SessionFamily, value: string) => { void commitRename(family, value); },
    onRenameCancel: () => setRenamingRootId(null),
    onRenameProjectCommit: commitProjectRename,
    onRenameProjectCancel: () => { if (renamingProjectKey) endProjectRename(renamingProjectKey); },
    onDeleteConfirm: (family: SessionFamily) => { void performDelete(family); },
    onDeleteCancel: () => {
      const rootId = confirmDeleteRootId;
      setConfirmDeleteRootId(null);
      // Cancel goes with the confirmation: the row's own button takes focus.
      if (rootId) focusAfterCommit(() => familyRowButton(rootId));
    },
    onGroupNew: handleGroupNew,
    onGroupMenu: handleGroupMenu,
    onToggleArchiveGroup: handleToggleArchiveGroup,
    onArchiveGroupMenu: handleArchiveGroupMenu,
    // The footer's "Open another project": the folder picker itself, now that
    // the files' own project list is gone.
    onOpenOtherProject: () => handleCustomPathClick(),
    onOpenArchive: () => openArchiveView(),
    // The archive view has no group rows: only the main tree's can be dragged.
    onMoveGroup: moveProject,
  } as const;

  const archivedCount = model.archivedCount;
  // 侧栏只承载会话；文件树在右栏，这里不再有页签，标题只按「新建」两个字适配。
  const fitHeader = useHeaderFit(headerRef, ["below", t("sidebar.new")].join("\n"));

  return (
    <div
      ref={sidebarRef}
      className={`session-sidebar${toast ? " has-toast" : ""}`}
    >
      {customPathOpen && (
        <DirectoryPicker
          initialPath={customPathValue}
          busy={customPathValidating}
          error={customPathError}
          onCancel={() => {
            // The composer's "Open another project…" puts focus back on its
            // control: the picker took it and leaves nothing behind.
            const opener = customPathOpen === "new-session" ? folderReturnFocusRef.current : null;
            folderPickRef.current = null;
            folderReturnFocusRef.current = null;
            setCustomPathOpen(false);
            setCustomPathError(null);
            if (opener) focusAfterCommit(() => (opener.isConnected ? opener : null));
          }}
          onSelect={(path) => void commitCustomPath(path)}
        />
      )}
      {/* One toolbar row, in the cells of the chat's top bar beside it (its
          line continues that bar's): Sessions | Files, then New and the
          search of the tab in view. Only the two tabs are the tablist. With
          the files below the sessions there is nothing to choose: the brand
          stands there (the panel's anchor, the versions on a click), and
          the search is the sessions'. */}
      {/* 画板 web-running 帧 A 的 .lights：主人不要那颗蓝绿灯（浏览器里本来就是假窗灯），不渲染。 */}
      <div ref={headerRef} className="sidebar-header">
        {isMobile && onCloseMobile && (
          <button
            type="button"
            className="sidebar-mobile-close"
            onClick={onCloseMobile}
            title={t("i18n.close")}
            aria-label={t("i18n.close")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
        {!isMobile && <PiWebTitle onWidthChange={fitHeader} />}
        {/* 画板的 .side__tools：新建（铅笔）与搜索两个 ghost 钮 + 留白。
            留白由它内部的 .spacer 提供，这里不再另加一颗。 */}
        <SidebarTools
          searchButtonRef={searchButtonRef}
          newTitle={selectedCwd ? t("sidebar.newSessionTitle", { path: selectedCwd }) : t("sidebar.selectProject")}
          newDisabled={!selectedCwd}
          onNew={handleNewSession}
          searchTitle={t("sidebar.toggleSessionSearch")}
          searchOpen={sessionSearchOpen}
          onSearch={() => setSessionSearchOpen((open) => !open)}
        />
      </div>

      {/* Sessions: every project's sessions, or the archive. */}
      <div
        ref={sessionsPanelRef}
        id="session-sidebar-panel-sessions"
        role="region"
        className="sidebar-panel sidebar-sessions-panel"
        onScrollCapture={rememberScroll}
      >
        {sessionSearchOpen && (
          <div className="sidebar-search">
            <input
              id="session-search-input"
              type="search"
              autoFocus
              value={sessionSearchQuery}
              maxLength={200}
              aria-label={t("sidebar.searchSessions")}
              placeholder={t("sidebar.searchSessions")}
              onChange={(event) => setSessionSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.stopPropagation();
                  setSessionSearchQuery("");
                }
              }}
              className="sidebar-search-input"
            />
          </div>
        )}
        <SessionSearch
          open={sessionSearchOpen}
          query={sessionSearchQuery}
          selectedSessionId={selectedSessionId}
          onSelectSession={handleSelectSessionFromList}
          archivedSessionIds={archiveIndex.ids}
        >
          {/* The tree and the archive view share one cell: the archive
              slides in over the tree and away from it again. */}
          <div className="sidebar-sessions-views">
            {/* Kept mounted under the archive view, so going back finds it as
                it was: inert while the archive slides in, then hidden. */}
            <div className="sidebar-sessions-view" hidden={archiveMotion.mainHidden} inert={archiveMotion.mainInert}>
              <SessionTree
                {...treeProps}
                rows={model.rows}
                emptyLabel={t("sidebar.noSessions")}
                reveal={treeReveal}
                onRevealHandled={handleRevealHandled}
              />
            </div>
            {/* Mounted while open and on its way out, inert then, so nothing
                in it is clicked twice; the tree is back under it at once. */}
            {archiveMotion.archiveMounted && (
              <div
                className={`sidebar-sessions-view sidebar-archive-view${archiveMotion.archiveClass ? ` ${archiveMotion.archiveClass}` : ""}`}
                inert={archiveMotion.archiveInert}
                onAnimationEnd={(event) => { if (event.target === event.currentTarget) endArchiveMotion(); }}
              >
                <div className="sidebar-archive-bar">
                  <button
                    ref={archiveBackRef}
                    type="button"
                    className="sidebar-archive-back"
                    title={t("sidebar.backToSessions")}
                    aria-label={`${t("sidebar.backToSessions")}: ${t("sidebar.archivedCount", { count: archivedCount })}`}
                    onClick={() => setArchiveView(false)}
                  >
                    <ChevronIcon size={13} className="sidebar-icon-back" />
                    <span>{t("sidebar.archived")}</span>
                    <span className="sidebar-archive-count">· {archivedCount}</span>
                  </button>
                  <button
                    type="button"
                    className={`sidebar-archive-menu-button${menu?.kind === "archive" ? " is-active" : ""}`}
                    title={t("sidebar.archiveActions")}
                    aria-label={t("sidebar.archiveActions")}
                    aria-haspopup="menu"
                    aria-expanded={menu?.kind === "archive"}
                    disabled={archiveGroups.length === 0}
                    onClick={(event) => openArchiveMenu(event.currentTarget)}
                  >
                    <MoreIcon size={13} />
                  </button>
                </div>
                <SessionTree
                  {...treeProps}
                  rows={archiveRows}
                  emptyLabel={t("sidebar.noArchived")}
                  reveal={archiveReveal}
                  onRevealHandled={handleArchiveRevealHandled}
                />
              </div>
            )}
          </div>
        </SessionSearch>
      </div>

      <SidebarMenu
        open={menu !== null}
        anchor={menu?.anchor ?? null}
        sheet={isMobile}
        ariaLabel={menuLabel}
        title={menuTitle}
        items={menuItems}
        cancelLabel={t("sidebar.cancel")}
        focusCancel={menuBody !== null}
        onClose={closeMenu}
        returnFocusTo={menu?.opener ?? null}
        width={menuWidth}
      >
        {menuBody}
      </SidebarMenu>
      <SidebarToast toast={toast} onDismiss={() => setToast(null)} dismissLabel={t("sidebar.dismiss")} />
    </div>
  );
}
