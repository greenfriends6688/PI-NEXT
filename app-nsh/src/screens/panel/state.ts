// The right dock's store: the tabs it holds and the one on screen.
//
// pi-next keeps a tab per file, terminal, subagent run and side chat in its
// right panel (`components/TabBar.tsx` and `AppShell.tsx`'s `panelTabs`),
// while the system prompt, tools, session info and branches are floating
// panels from its top bar. This app puts all of them in the same tabbed dock
// so the right side is one place: the three local views (files, review,
// terminal), the session's own views (branches, system, tools, session), and
// one tab per subagent run or side chat.
//
// Module-level signals are the app's store (`tsx.md` "Signals and writes"):
// the shell, the tab strip and every tab body read them without a prop chain.
// A tab's identity is `panelTabKey`, so opening files twice selects the one
// tab instead of adding another, and a subagent or side chat is keyed by its
// session id.
import { computed, signal } from "nsh";

/** The views the dock itself knows how to open. */
export type PanelSimpleKind = "files" | "changes" | "terminal" | "branches" | "system" | "tools" | "session" | "debug";

/** One tab of the dock. `agent` is a subagent run's transcript, `side` a side chat. */
export type PanelTab =
  | { kind: "files" }
  | { kind: "changes" }
  | { kind: "terminal" }
  | { kind: "branches" }
  | { kind: "system" }
  | { kind: "tools" }
  | { kind: "session" }
  | { kind: "debug" }
  /** A subagent run: read-only transcript plus steer / abort. */
  | { kind: "agent"; sessionId: string; name?: string }
  /** A side chat: its own chat and composer. */
  | { kind: "side"; sessionId: string; name: string };

/** The tabs in the strip, left to right. */
export const tabs = signal<PanelTab[]>([]);

/** The index of the tab on screen (`-1` only while the dock has no tabs). */
export const active = signal(0);

/**
 * Whether the dock is on screen. Closing the last tab collapses it; hiding it
 * (the panel's close button, the shell's toggle) keeps the tabs, so reopening
 * lands on the same one.
 */
export const panelOpen = signal(false);

/** The dock fills the window (the tab strip's expand button). */
export const panelFullscreen = signal(false);

/** Fills the window, or goes back to the column / floating panel. */
export function togglePanelFullscreen(): void {
  panelFullscreen.set(!panelFullscreen());
}

/** A tab's stable identity: one of each simple view, one per session. */
export function panelTabKey(tab: PanelTab): string {
  switch (tab.kind) {
    case "agent":
      return `agent:${tab.sessionId}`;
    case "side":
      return `side:${tab.sessionId}`;
    default:
      return tab.kind;
  }
}

/** The tab on screen, or null when the dock is hidden / empty. */
export const activePanelTab = computed<PanelTab | null>(() => {
  const list = tabs();
  const index = active();
  if (index < 0 || index >= list.length) return null;
  return list[index] ?? null;
});

/** Opens `tab`, selecting it when it is already open. */
export function openPanelTab(tab: PanelTab): void {
  const list = tabs();
  const key = panelTabKey(tab);
  const index = list.findIndex((current) => panelTabKey(current) === key);
  if (index >= 0) {
    // A subagent / side tab may arrive with a fresher name.
    const next = [...list];
    next[index] = tab;
    tabs.set(next);
    active.set(index);
  } else {
    tabs.set([...list, tab]);
    active.set(list.length);
  }
  panelOpen.set(true);
}

/** Shows the tab at `index`; out-of-range values are ignored. */
export function setActive(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= tabs().length) return;
  active.set(index);
  panelOpen.set(true);
}

/** Closes one tab; closing the last one collapses the dock. */
export function closePanelTab(key: string): void {
  const list = tabs();
  const index = list.findIndex((tab) => panelTabKey(tab) === key);
  if (index < 0) return;
  const next = list.filter((_, at) => at !== index);
  tabs.set(next);
  if (next.length === 0) {
    active.set(0);
    panelOpen.set(false);
    panelFullscreen.set(false);
    return;
  }
  let chosen = active();
  if (index < chosen) chosen -= 1;
  else if (index === chosen) chosen = Math.min(index, next.length - 1);
  active.set(Math.max(0, Math.min(chosen, next.length - 1)));
}

/** Closes every tab and the dock. */
export function closeAllPanelTabs(): void {
  tabs.set([]);
  active.set(0);
  panelOpen.set(false);
  panelFullscreen.set(false);
}

/** Hides the dock without forgetting its tabs. */
export function closePanel(): void {
  if (!panelOpen()) return;
  panelOpen.set(false);
  panelFullscreen.set(false);
}

/** Shows the dock again on its last active tab (files when it has none). */
export function showPanel(): void {
  if (tabs().length === 0) {
    openPanelTab({ kind: "files" });
    return;
  }
  const index = Math.max(0, Math.min(active(), tabs().length - 1));
  active.set(index);
  panelOpen.set(true);
}

/** Opens `tab`, or hides the dock when that same tab is already on screen. */
export function togglePanelTab(tab: PanelTab): void {
  const current = activePanelTab();
  if (panelOpen() && current !== null && panelTabKey(current) === panelTabKey(tab)) {
    closePanel();
    return;
  }
  openPanelTab(tab);
}

/** The shell's single panel button: hide it when open, else show it. */
export function togglePanel(): void {
  if (panelOpen()) closePanel();
  else showPanel();
}

/** Whether a tab of `kind` is open (active or not). */
export function hasPanelTab(kind: PanelSimpleKind): boolean {
  return tabs().some((tab) => tab.kind === kind);
}

/** Whether a tab of `kind` is the one on screen. */
export function isPanelTabActive(kind: PanelSimpleKind): boolean {
  return panelOpen() && activePanelTab()?.kind === kind;
}
