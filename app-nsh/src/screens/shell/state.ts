// The shell's own store: what the sidebar shows and how, beside the session
// choice itself (`state/session.ts`). Module-level signals are the app's store
// (`tsx.md` "Signals and writes"): the shell and the panel read them without a
// prop chain, and `state/**` stays the session pane's store.
import { platform, signal } from "nsh";
import { pref, readPref, setPref } from "../../state/prefs";
import { activeCwd, selectSession } from "../../state/session";

// ---------------------------------------------------------------------------
// pi-next's geometry, in points. The shell and the sidebar read these, so the
// frame and the list stay on the design's numbers instead of their own.
// Sources: `app/v5/tokens.css` (`--shell-inset`, `--pane-radius`,
// `--chrome-height`, `--row-height`), `app/v5/shell.css`, `app/v5/sidebar.css`
// and `lib/panel-layout.ts`.
// ---------------------------------------------------------------------------

/** `--shell-inset` / `--shell-gap`: the window's edge, and the gap between panes. */
export const SHELL_INSET = 8;
export const SHELL_GAP = 8;
/** `--pane-radius` (`--pin-radius-lg`): the floating panes' corners. */
export const PANE_RADIUS = 16;
/** `--chrome-height`: the panes' top bars. */
export const CHROME_HEIGHT = 44;
/** `--chrome-button-size` (26), and a phone's `.m-top` button (36). */
export const CHROME_BUTTON = 26;
export const CHROME_BUTTON_TOUCH = 36;
/** `--row-height`: a session row (30), and a phone's 44. */
export const ROW_HEIGHT = 30;
export const ROW_HEIGHT_TOUCH = 44;
/** A project group's header: 32 on a desktop, 44 on a phone. */
export const GROUP_ROW_HEIGHT = 32;
export const GROUP_ROW_HEIGHT_TOUCH = 44;
/** A band caption ("Pinned", "Projects"): 24 high under a 6-point gap, 28/8 on a phone. */
export const BAND_LABEL_HEIGHT = 24;
export const BAND_LABEL_HEIGHT_TOUCH = 28;

/** The phone's breakpoint: at or under it the shell is one column (`--mobile-gutter`'s 767). */
export const MOBILE_MAX_WIDTH = 767;
/** From here up the right pane shares the row; under it the pane floats. */
export const SPLIT_PANEL_MIN_WIDTH = 1024;
/** 1024–1359 uses the compact 240-point sidebar while the panes share the row. */
export const COMPACT_PANEL_MAX_WIDTH = 1359;

/** The sidebar: 268 by default, 240 from 1024 to 1359, 210–440 when dragged. */
export const SIDEBAR_DEFAULT_WIDTH = 268;
export const SIDEBAR_COMPACT_WIDTH = 240;
export const SIDEBAR_MIN_WIDTH = 210;
export const SIDEBAR_MAX_WIDTH = 440;
/** The phone's drawer: `min(320px, 86vw)` (`app/v5/mobile.css`). */
export const SIDEBAR_DRAWER_WIDTH = 320;

/** The right pane: 420 by default, 320–1200 when dragged, 560 while it floats. */
export const RIGHT_PANEL_DEFAULT_WIDTH = 420;
export const RIGHT_PANEL_FALLBACK_WIDTH = 560;
export const RIGHT_PANEL_MIN_WIDTH = 320;
export const RIGHT_PANEL_MAX_WIDTH = 1200;
/** `getDefaultRightPanelWidth`'s floor under the 420. */
export const RIGHT_PANEL_DEFAULT_MIN = 360;

/** The chat's floor when a pane's ceiling is taken from the window
 * (`lib/panel-layout.ts`: 320 while the panes float, 420 in the split row). */
const COMPACT_CHAT_MIN_WIDTH = 320;
const DESKTOP_CHAT_MIN_WIDTH = 420;

/** `clampPanelWidth`: a whole number inside `min`–`max`, `min` for a bad width. */
export function clampPanelWidth(width: number, minWidth: number, maxWidth: number): number {
  const finite = Number.isFinite(width) ? width : minWidth;
  const top = Math.max(minWidth, maxWidth);
  return Math.round(Math.max(minWidth, Math.min(top, finite)));
}

/** `getDefaultRightPanelWidth`: 420, giving way to 360 in a narrow window. */
export function getDefaultRightPanelWidth(viewportWidth: number): number {
  return clampPanelWidth(Math.min(RIGHT_PANEL_DEFAULT_WIDTH, viewportWidth - 280), RIGHT_PANEL_DEFAULT_MIN, RIGHT_PANEL_DEFAULT_WIDTH);
}

/** The sidebar's column: 268, 240 between 1024 and 1359. */
export function getSidebarWidth(viewportWidth: number): number {
  const compact = viewportWidth >= SPLIT_PANEL_MIN_WIDTH && viewportWidth <= COMPACT_PANEL_MAX_WIDTH;
  return compact ? SIDEBAR_COMPACT_WIDTH : SIDEBAR_DEFAULT_WIDTH;
}

/**
 * The floating right pane's width, or `null` when it spans the shell (a phone,
 * where it is the whole pane). 768–1023: `min(560, 100vw − 48)`, never under
 * 300 (`globals.css`). From 1024 up the pane is a column in the split row, so
 * there is no floating width to give.
 */
export function getOverlayRightPanelWidth(viewportWidth: number): number | null {
  if (viewportWidth <= MOBILE_MAX_WIDTH) return null;
  if (viewportWidth >= SPLIT_PANEL_MIN_WIDTH) return null;
  return Math.max(300, Math.min(RIGHT_PANEL_FALLBACK_WIDTH, viewportWidth - 48));
}

/**
 * `getSidebarMaxWidth`: 440, giving way to the chat's floor and the right
 * pane beside it. Under 1024 the right pane floats, so it takes none of the
 * row; from 1024 up this shell's split row counts it beside the sidebar.
 */
export function getSidebarMaxWidth(options: {
  viewportWidth: number;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
}): number {
  const { viewportWidth, rightPanelOpen, rightPanelWidth } = options;
  if (viewportWidth <= MOBILE_MAX_WIDTH) return SIDEBAR_MAX_WIDTH;
  const compact = viewportWidth < SPLIT_PANEL_MIN_WIDTH;
  const chatWidth = compact ? COMPACT_CHAT_MIN_WIDTH : DESKTOP_CHAT_MIN_WIDTH;
  const visibleRightPanelWidth = !compact && rightPanelOpen ? rightPanelWidth : 0;
  return Math.min(SIDEBAR_MAX_WIDTH, viewportWidth - chatWidth - visibleRightPanelWidth);
}

/**
 * `getRightPanelMaxWidth`: 1200, giving way to the chat's 420 and the
 * sidebar beside it from 1024 up (`lib/panel-layout.ts`).
 */
export function getRightPanelMaxWidth(options: {
  viewportWidth: number;
  sidebarOpen: boolean;
  sidebarWidth: number;
}): number {
  const { viewportWidth, sidebarOpen, sidebarWidth } = options;
  if (viewportWidth < SPLIT_PANEL_MIN_WIDTH) return RIGHT_PANEL_MAX_WIDTH;
  const visibleSidebarWidth = sidebarOpen ? sidebarWidth : 0;
  return Math.min(RIGHT_PANEL_MAX_WIDTH, viewportWidth - DESKTOP_CHAT_MIN_WIDTH - visibleSidebarWidth);
}

/** The phone drawer's width: `min(320px, 86vw)`. */
export function getDrawerWidth(viewportWidth: number): number {
  return Math.min(SIDEBAR_DRAWER_WIDTH, viewportWidth * 0.86);
}

// ---------------------------------------------------------------------------
// The panes' widths, as the user drags them.
//
// pi-next kept them under `pi-sidebar-width` / `pi-right-panel-width` in
// `localStorage` (`AppShell.tsx`'s `useResizablePanel` options, with 210–440
// and 320–1200); this app keeps both in one preference, `prefs.layout`
// (refactor plan §5.4). A drag shows its width through `livePanelWidth` from
// the pointer's move to its release; the release writes the user's choice to
// `prefs`, so a window too narrow for it shows less without saving that.
// ---------------------------------------------------------------------------

/** The preference holding both pane widths (`src/state/prefs.ts`). */
export const LAYOUT_PREF = "layout";

/** `prefs.layout`: what a drag last chose, in points, before the window's clamp. */
export interface LayoutWidths {
  sidebar?: number;
  rightPanel?: number;
}

/** The two panes whose edge drags: the sidebar's column and the right pane's. */
export type PanelId = keyof LayoutWidths;

/** What a drag is showing right now; `null` follows the stored (or default) width. */
const liveWidths = signal<Record<PanelId, number | null>>({ sidebar: null, rightPanel: null });

/** The width a drag is showing for `panel`, or `null`. Reads the signal. */
export function livePanelWidth(panel: PanelId): number | null {
  return liveWidths()[panel];
}

/** Shows `width` while a drag runs; `null` goes back to the stored width. */
export function showPanelWidth(panel: PanelId, width: number | null): void {
  const current = liveWidths();
  if (current[panel] === width) return;
  liveWidths.set({ ...current, [panel]: width });
}

/**
 * The width the user chose for `panel`, or `null` before the first drag.
 * Reads the prefs signal, so a pane follows the stored value once its
 * asynchronous read lands (`prefs.ts`).
 */
export function storedPanelWidth(panel: PanelId): number | null {
  const layout = pref<LayoutWidths>(LAYOUT_PREF, {});
  const value = layout[panel];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Remembers a dragged width in `prefs.layout`. `setPref` changes the signal
 * now and the device at most once per 200 ms burst; a failed write only logs
 * (`prefs.ts`), so a press never throws.
 */
export function rememberPanelWidth(panel: PanelId, width: number): void {
  const layout = readPref<LayoutWidths>(LAYOUT_PREF, {});
  if (layout[panel] === width) return;
  setPref(LAYOUT_PREF, { ...layout, [panel]: width });
}

/** Whether the sidebar is on screen: its pane on a desktop, its drawer on a phone. */
export const sidebarOpen = signal(platform.idiom !== "phone");

export function openSidebar(): void {
  sidebarOpen.set(true);
}

export function closeSidebar(): void {
  sidebarOpen.set(false);
}

export function toggleSidebar(): void {
  sidebarOpen.set(!sidebarOpen());
}

/**
 * Sessions the user pinned, newest first. pi-next keeps pinned projects on
 * top of the list (`SessionTree`'s pinned band); this list is the same band
 * for single sessions.
 *
 * TODO(nsh): persist the pinned ids and the folded groups through the
 * server's `session_ui_state` route (`SessionSidebar.tsx`'s
 * `savePinnedCollapsed` / `saveGroupExpansion`); this app has no such route
 * yet, so both lists live for the run only.
 */
export const pinnedSessionIds = signal<string[]>([]);

export function isSessionPinned(id: string): boolean {
  return pinnedSessionIds().includes(id);
}

export function togglePinnedSession(id: string): void {
  const ids = pinnedSessionIds();
  pinnedSessionIds.set(ids.includes(id) ? ids.filter((pinned) => pinned !== id) : [id, ...ids]);
}

/** Project groups the user folded away, by the group's key (its `cwd`). */
export const collapsedGroups = signal<string[]>([]);

/** The pinned band's key in `collapsedGroups`. */
export const PINNED_GROUP = "__pinned__";

export function isGroupOpen(key: string): boolean {
  return !collapsedGroups().includes(key);
}

export function toggleGroup(key: string): void {
  const keys = collapsedGroups();
  collapsedGroups.set(keys.includes(key) ? keys.filter((folded) => folded !== key) : [key, ...keys]);
}

/** The sidebar's search text (`""` lists every session). */
export const sessionFilter = signal("");

export function setSessionFilter(value: string): void {
  sessionFilter.set(value);
}

/** The open session's display name, for the shell's 44-point top bar. */
export const sessionTitle = signal<string | null>(null);

/**
 * The user asked for a fresh chat. The auto-open of the newest session must
 * not undo it: `SessionsPanel`'s effect leaves the choice alone until a
 * session is chosen again.
 */
export const freshSession = signal(false);

/** Shows `id` in the chat pane and remembers its folder and name. */
export function chooseSession(id: string, cwd: string, title: string): void {
  freshSession.set(false);
  selectSession(id);
  activeCwd.set(cwd);
  sessionTitle.set(title);
}

/** Clears the chat pane for a new session (the composer starts empty). */
export function startFreshSession(): void {
  freshSession.set(true);
  sessionTitle.set(null);
  selectSession(null);
}
