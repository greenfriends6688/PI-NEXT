// The shell's shared state: which session is open, and which pane the right
// side shows. Module-level signals are the app's store (`tsx.md` "Signals and
// writes"): screens read them without a prop chain.
import { computed, signal } from "nsh";
import { activePanelTab, closePanel, openPanelTab, panelOpen } from "../screens/panel/state";

/** The session the chat pane shows, or `null` (nothing chosen). */
export const selectedSessionId = signal<string | null>(null);

export function selectSession(id: string | null): void {
  if (selectedSessionId() === id) return;
  selectedSessionId.set(id);
}

/**
 * The dock's three original views. `rightPane` is the compatibility name the
 * file tabs and the command palette still read: it is the active dock tab when
 * that is one of them, else null (`screens/panel/state.ts` owns the tabs now).
 */
export type RightPane = "files" | "changes" | "terminal";

export const rightPane = computed<RightPane | null>(() => {
  if (!panelOpen()) return null;
  const tab = activePanelTab();
  return tab !== null && (tab.kind === "files" || tab.kind === "changes" || tab.kind === "terminal")
    ? tab.kind
    : null;
});

/** Opens `pane` in the dock, or hides the dock when it is the tab on screen. */
export function showRightPane(pane: RightPane | null): void {
  if (pane === null) {
    closePanel();
    return;
  }
  if (panelOpen() && rightPane() === pane) {
    closePanel();
    return;
  }
  openPanelTab({ kind: pane });
}

/** Whether the settings dialog is open. */
export const settingsOpen = signal(false);

/**
 * The Settings section a command asked for (`/skills`, `/mcp`). The dialog
 * consumes it once when it opens and clears it, so opening Settings from the
 * sidebar afterwards keeps the section the reader chose last.
 */
export const settingsTarget = signal<string | null>(null);

export function openSettings(): void {
  settingsOpen.set(true);
}

/** Opens Settings on `section`, for a built-in slash command. */
export function openSettingsAt(section: string): void {
  settingsTarget.set(section);
  settingsOpen.set(true);
}

export function closeSettings(): void {
  settingsOpen.set(false);
}

/** The working directory the open session (or a fresh composer) runs in. */
export const activeCwd = signal<string | null>(null);

/**
 * A folder `/api/cwd/validate` accepted, waiting for its trust decision
 * (`GET /api/project-trust`). The trust dialog either accepts it
 * (`acceptPendingCwd()`) or sends the user back to the directory browser.
 */
export interface PendingCwd {
  cwd: string;
  projectRoot: string;
  projectKey: string;
}

/** The folder the trust step is deciding, or null. */
export const pendingCwd = signal<PendingCwd | null>(null);

/** Stages a validated folder for the trust step. */
export function stagePendingCwd(folder: PendingCwd): void {
  pendingCwd.set(folder);
}

/** The folder needs no trust (or has it): it becomes the fresh composer's cwd. */
export function acceptPendingCwd(): void {
  const folder = pendingCwd();
  if (!folder) return;
  pendingCwd.set(null);
  activeCwd.set(folder.cwd);
}

/** Drops the staged folder without changing the cwd. */
export function clearPendingCwd(): void {
  if (pendingCwd() !== null) pendingCwd.set(null);
}

/** Whether the directory browser overlay is open. */
export const cwdPickerOpen = signal(false);

/** Where the browser starts; null lets the server pick (home, or drives on Windows). */
export const cwdPickerStart = signal<string | null>(null);

/** Whether the browser opens with its "New folder" form showing. */
export const cwdPickerCreate = signal(false);

/** Opens the browser at `start` (null: the server's start folder). */
export function openCwdPicker(start: string | null = null, create = false): void {
  cwdPickerStart.set(start);
  cwdPickerCreate.set(create);
  cwdPickerOpen.set(true);
}

/** Closes the directory browser. */
export function closeCwdPicker(): void {
  cwdPickerOpen.set(false);
  cwdPickerCreate.set(false);
}

/**
 * A piece of text an extension put in the composer (`set_editor_text`, which
 * pi-next handed to its `ChatInput.insertText`). The extension dialog records
 * one of these per request; the mounted composer appends it to its draft and
 * consumes it. A piece that arrives while no composer is mounted waits here
 * for the next one (`MainPane` mounts the composer only with a session).
 */
export interface ComposerInsert {
  /** Monotonic, so two inserts of the same text are both written. */
  id: number;
  text: string;
}

/** Inserts waiting for the composer, oldest first. */
export const composerInsert = signal<ComposerInsert[]>([]);

let nextComposerInsertId = 0;

/** Queues text for the composer; blank text inserts nothing. */
export function insertComposerText(text: string): void {
  if (text.trim().length === 0) return;
  composerInsert.update((list) => [...list, { id: ++nextComposerInsertId, text }]);
}

/** The composer wrote the inserts it saw; the queue drops them. */
export function consumeComposerInserts(ids: readonly number[]): void {
  if (ids.length === 0) return;
  composerInsert.update((list) => list.filter((insert) => !ids.includes(insert.id)));
}

/**
 * A session entry the chat should scroll to: a search result's message, or a
 * branch's leaf. The sidebar sets it when it opens a session from a content
 * match (`SessionSearchResult.entryId`); `ChatView` reads more of the branch
 * until that row is loaded, scrolls to it and clears it. It names the session
 * too, so an entry id of another session's branch is never looked for here.
 */
export const pendingEntryId = signal<{ sessionId: string; entryId: string } | null>(null);

/** Asks the chat to reveal one message of a session (`?entryId=` in pi-next). */
export function revealEntry(sessionId: string, entryId: string): void {
  pendingEntryId.set({ sessionId, entryId });
}

/** The chat scrolled to the entry (or could not find it on this branch). */
export function clearPendingEntry(): void {
  if (pendingEntryId() !== null) pendingEntryId.set(null);
}
