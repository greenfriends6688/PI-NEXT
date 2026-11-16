// The files pane's tabs: the tree is the `files` tab, and every open file is a
// tab of its own (pi-next's `components/file-tab-state.ts` + `TabBar`).
//
// The shell's `rightPane` says which pane is on screen (`files`, `changes`,
// `terminal`); inside `files`, `activeFileTab` says whether the tree or a file
// is showing. `openFileTabs` keeps every file tab, in the order it was opened,
// so closing the active tab can fall back to its neighbour and the tabs stay
// after the user looks at the tree again.
//
// Tabs belong to a folder: opening `a.ts` in one project must not put it in
// another project's pane. Each working directory therefore remembers its own
// pair under `prefs` key `files:tabs:<cwd>` (the 20 most recent tabs and the
// active one). The preference is read once per folder and written whenever the
// tabs change; a window too small for the tabs is not what is saved.
//
// Module-level signals are the app's store (`tsx.md` "Signals and writes"), so
// `<FileTree>`, `<FileView>`, the shell's tab strip and the command palette
// share it without a prop chain.
import { signal } from "nsh";
import { pref, setPref } from "../../state/prefs";
import { activeCwd, rightPane, showRightPane } from "../../state/session";
import { openPanelTab } from "../panel/state";

/** One open file. The path is absolute and is the tab's identity. */
export interface FileTab {
  path: string;
}

/** How many tabs a folder remembers (pi-next's tree/scroll memories use 20). */
export const FILE_TAB_LIMIT = 20;

/** The preference prefix; the folder's absolute path completes it. */
const FILE_TABS_PREF_PREFIX = "files:tabs:";

/** The open files of the current folder, oldest first. */
export const openFileTabs = signal<FileTab[]>([]);

/** The file tab on screen, or `null` while the `files` tab shows the tree. */
export const activeFileTab = signal<string | null>(null);

/** What one folder keeps in `prefs`. `paths` is capped to the newest 20. */
interface StoredFileTabs {
  paths: string[];
  active: string | null;
}

const EMPTY_TABS: StoredFileTabs = { paths: [], active: null };

/** The folder whose tabs are in the signals; `undefined` before the first read. */
let shownCwd: string | null | undefined;

/**
 * Whether the user changed the tabs since `shownCwd` was read. A write to
 * `prefs` (our own, or another setting's) must not put back an older list; a
 * folder switch clears this and reads the new folder's list.
 */
let edited = false;

function tabsKey(cwd: string): string {
  return `${FILE_TABS_PREF_PREFIX}${cwd}`;
}

/** Keeps the last by-path occurrence, so a path appears once, newest last. */
function uniquePaths(paths: readonly string[]): string[] {
  const unique: string[] = [];
  for (const path of paths) {
    if (path.length === 0) continue;
    const seen = unique.indexOf(path);
    if (seen !== -1) unique.splice(seen, 1);
    unique.push(path);
  }
  return unique.slice(-FILE_TAB_LIMIT);
}

/** `pref` gives what the device stored: our object, or an old array of paths. */
function parseStored(value: unknown): StoredFileTabs {
  if (Array.isArray(value)) {
    return { paths: uniquePaths(value.filter((path): path is string => typeof path === "string")), active: null };
  }
  if (typeof value !== "object" || value === null) return EMPTY_TABS;
  const record = value as Record<string, unknown>;
  const paths = uniquePaths(
    Array.isArray(record.paths) ? record.paths.filter((path): path is string => typeof path === "string") : [],
  );
  const active = typeof record.active === "string" && paths.includes(record.active) ? record.active : null;
  return { paths, active };
}

/** A folder's remembered tabs. Reads `prefs`, so an effect follows the first read. */
function storedTabs(cwd: string): StoredFileTabs {
  return parseStored(pref<unknown>(tabsKey(cwd), null));
}

function applyTabs(stored: StoredFileTabs): void {
  openFileTabs.set(stored.paths.map((path) => ({ path })));
  activeFileTab.set(stored.active);
}

/**
 * Shows the dock's files view. The panel's own store (`screens/panel/state.ts`)
 * is the tab strip's source; the legacy `rightPane` is what the current shell
 * reads, so both are told while the shell is being moved to the dock.
 */
function showFilesDock(): void {
  openPanelTab({ kind: "files" });
  if (rightPane() !== "files") showRightPane("files");
}

/** Writes the current pair to the folder's preference (`prefs` debounces disk writes). */
function rememberTabs(cwd: string | null): void {
  if (!cwd) return;
  const paths = openFileTabs().map((tab) => tab.path);
  const active = activeFileTab();
  setPref(tabsKey(cwd), {
    paths: paths.slice(-FILE_TAB_LIMIT),
    active: active !== null && paths.includes(active) ? active : null,
  });
}

/**
 * Moves the signals to `cwd`'s remembered tabs when the folder changed. Called
 * before a mutation, so an open from a closed pane appends to the new
 * folder's list rather than the previous one's.
 */
function ensureCwd(): string | null {
  const cwd = activeCwd();
  if (cwd !== shownCwd) {
    shownCwd = cwd;
    edited = false;
    applyTabs(cwd ? storedTabs(cwd) : EMPTY_TABS);
  }
  return cwd;
}

/**
 * Reads the current folder's remembered tabs. The shell calls this in an
 * effect: the first call happens before `prefs` has loaded (empty), the next
 * when the read lands, and every time another folder is selected. A folder
 * whose tabs the user already changed is left alone.
 */
export function syncFileTabs(): void {
  const cwd = activeCwd();
  const stored = cwd ? storedTabs(cwd) : EMPTY_TABS;
  if (cwd !== shownCwd) {
    shownCwd = cwd;
    edited = false;
    applyTabs(stored);
    return;
  }
  if (edited) return;
  applyTabs(stored);
}

/** The last part of a file's path: a tab's label (`components/TabBar.tsx`). */
export function fileTabName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  return trimmed.split(/[/\\]/).pop() || trimmed;
}

/**
 * Opens `path`: a tab already open becomes the active one, a new file is
 * appended (oldest first out past `FILE_TAB_LIMIT`). Opening a file always
 * shows the files pane, so the tab the user asked for is what they see.
 */
export function openFileTab(path: string): void {
  if (path.length === 0) return;
  const cwd = ensureCwd();
  const tabs = openFileTabs();
  const existing = tabs.some((tab) => tab.path === path);
  const activeChanged = activeFileTab() !== path;
  if (existing) {
    if (activeChanged) {
      activeFileTab.set(path);
      edited = true;
      rememberTabs(cwd);
    }
  } else {
    openFileTabs.set([...tabs, { path }].slice(-FILE_TAB_LIMIT));
    activeFileTab.set(path);
    edited = true;
    rememberTabs(cwd);
  }
  showFilesDock();
}

/**
 * Closes `path`. Closing the active tab activates its neighbour (the next one,
 * else the previous); closing the last file tab leaves `null`, which is the
 * tree. Closing another tab leaves the active one where it is.
 */
export function closeFileTab(path: string): void {
  const cwd = ensureCwd();
  const tabs = openFileTabs();
  const index = tabs.findIndex((tab) => tab.path === path);
  if (index === -1) return;

  const remaining = tabs.filter((tab) => tab.path !== path);
  openFileTabs.set(remaining);
  if (activeFileTab() === path) {
    // `remaining[index]` is the tab that followed the closed one; at the end
    // of the strip it is undefined, so the previous one takes its place.
    const neighbour = remaining[index] ?? remaining[index - 1] ?? null;
    activeFileTab.set(neighbour ? neighbour.path : null);
  }
  edited = true;
  rememberTabs(cwd);
}

/** Closes every tab but `path`, which becomes active. */
export function closeOtherFileTabs(path: string): void {
  const cwd = ensureCwd();
  const kept = openFileTabs().filter((tab) => tab.path === path);
  if (kept.length === 0) return;
  openFileTabs.set(kept);
  activeFileTab.set(path);
  edited = true;
  rememberTabs(cwd);
}

/** Closes every file tab and shows the tree. */
export function closeAllFileTabs(): void {
  const cwd = ensureCwd();
  if (openFileTabs().length === 0 && activeFileTab() === null) return;
  openFileTabs.set([]);
  activeFileTab.set(null);
  edited = true;
  rememberTabs(cwd);
}

/**
 * Shows the `files` tab: the tree, with any open file tabs kept in the strip.
 * This is what the pane's "Files" tab and "Show files" command do.
 */
export function showFilesTab(): void {
  const cwd = ensureCwd();
  if (activeFileTab() !== null) {
    activeFileTab.set(null);
    edited = true;
    rememberTabs(cwd);
  }
  showFilesDock();
}
