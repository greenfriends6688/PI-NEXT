// The overlays' shared state: the command palette's open flag, the toasts
// (with their timers), and the extension UI's side channels.
//
// Module-level signals are the app's store (`tsx.md` "Signals and writes"),
// so the shell, the palette, the extension dialog and the toasts all read
// the same values without a prop chain. Everything in this file runs
// outside render: the timers only write signals, and the components read
// them in bindings (`<If when={commandOpen()}>`, `<Each of={toasts()}>`).
//
// pi-next's sources:
//   components/CommandPalette.tsx        the palette's keys and focus restore
//   components/SidebarToast.tsx          one toast at a time, 10 s, hover pauses
//   lib/extension-ui-queue.ts            blocking requests wait in arrival order
import { signal, untracked } from "nsh";
import type { ExtensionUiRequest } from "../../api/types";
import { insertComposerText } from "../../state/session";

// --- the command palette ----------------------------------------------------

/** Whether the ⌘K palette is open. The shell mounts `CommandPalette` always. */
export const commandOpen = signal(false);

/**
 * The rows the last query matched (`Command.matchedCount()`), shown in the
 * palette's footer. The `Command` filters natively, so the count comes back
 * as a promise and is written from its `onHighlightChange` / `onQueryChange`.
 */
export const commandCount = signal(0);

export function openCommand(): void {
  commandOpen.set(true);
}

export function closeCommand(): void {
  if (!commandOpen()) return;
  commandOpen.set(false);
  commandCount.set(0);
}

/** ⌘K / Ctrl+K: open it, or close it when it is already open. */
export function toggleCommand(): void {
  if (commandOpen()) closeCommand();
  else openCommand();
}

// --- toasts -----------------------------------------------------------------

/** A toast's meaning: a dot's color, never its only cue. */
export type ToastTone = "neutral" | "info" | "warn" | "danger";

/** What a toast's action does after the toast goes (an Undo, a Retry). */
export interface ToastAction {
  label: string;
  run: () => void;
}

/** A toast as the app pushes it. */
export interface ToastInput {
  title?: string;
  /** The line shown; a `notify` method's message is one. */
  message: string;
  tone?: ToastTone;
  /** 0 keeps it until dismissed; unset is 10 s, as pi-next's sidebar toast. */
  durationMs?: number;
  action?: ToastAction;
  /** Stable id (an extension request's), so a replay does not stack twice. */
  id?: string;
}

/** A toast in the stack: its input, its id and its resolved tone. */
export interface ToastItem extends ToastInput {
  id: string;
  tone: ToastTone;
}

/** pi-next's `DEFAULT_TOAST_DURATION_MS` (components/SidebarToast.tsx). */
const TOAST_DURATION_MS = 10_000;

/** How many toasts stay: older ones go as new ones arrive. */
const MAX_TOASTS = 4;

/** Newest last; the stack lays them from the bottom up. */
export const toasts = signal<ToastItem[]>([]);

let nextToastId = 0;
/** While the stack is expanded (the pointer on it) every countdown stops. */
let toastsPaused = false;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** When the running timer would dismiss its toast. */
const deadlines = new Map<string, number>();
/** What a paused toast still had to live. */
const remaining = new Map<string, number>();

function clearTimer(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(id);
  deadlines.delete(id);
}

/** Restarts a toast's countdown from `ms`; 0 or less leaves it up. */
function schedule(id: string, ms: number): void {
  clearTimer(id);
  if (ms <= 0) {
    remaining.delete(id);
    return;
  }
  if (toastsPaused) {
    remaining.set(id, ms);
    return;
  }
  remaining.delete(id);
  deadlines.set(id, Date.now() + ms);
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      deadlines.delete(id);
      dismissToast(id);
    }, ms),
  );
}

/**
 * Shows a toast, or replaces the toast of the same id. Returns its id. An
 * error toast (tone `danger`) stays until dismissed unless `durationMs` says
 * otherwise, as pi-next leaves a failure up to be read.
 */
export function pushToast(message: string, input: Omit<ToastInput, "message"> = {}): string {
  const text = message.trim();
  const id = input.id ?? `toast-${++nextToastId}`;
  if (!text) return id;
  const item: ToastItem = {
    ...input,
    message: text,
    id,
    tone: input.tone ?? "neutral",
    durationMs: input.durationMs ?? (input.tone === "danger" ? 0 : TOAST_DURATION_MS),
  };
  const current = untracked(() => toasts()).filter((toast) => toast.id !== id);
  const overflow = Math.max(0, current.length + 1 - MAX_TOASTS);
  for (const dropped of current.slice(0, overflow)) {
    clearTimer(dropped.id);
    remaining.delete(dropped.id);
  }
  toasts.set([...current.slice(overflow), item]);
  schedule(id, item.durationMs ?? 0);
  return id;
}

export function dismissToast(id: string): void {
  clearTimer(id);
  remaining.delete(id);
  const list = untracked(() => toasts());
  if (!list.some((toast) => toast.id === id)) return;
  const next = list.filter((toast) => toast.id !== id);
  toasts.set(next);
  // An empty stack has nothing to hold the pointer: its next toast starts
  // its own countdown even if the expansion never reported the collapse.
  if (next.length === 0) toastsPaused = false;
}

/** Escape on the stack (when it is the topmost layer): the newest goes. */
export function dismissNewestToast(): void {
  const newest = untracked(() => toasts()).at(-1);
  if (newest) dismissToast(newest.id);
}

export function clearToasts(): void {
  for (const toast of untracked(() => toasts())) clearTimer(toast.id);
  remaining.clear();
  toastsPaused = false;
  toasts.set([]);
}

/**
 * Stops or restarts every countdown (pi-next's toast pauses while the pointer
 * is on it or focus is in it; `ToastStack` reports its expansion, which is
 * the pointer resting on the stack or a finger held down on it).
 */
export function pauseToasts(paused: boolean): void {
  if (toastsPaused === paused) return;
  toastsPaused = paused;
  for (const toast of untracked(() => toasts())) {
    const duration = toast.durationMs ?? 0;
    if (duration <= 0) continue;
    if (paused) {
      const deadline = deadlines.get(toast.id);
      const left = deadline === undefined ? (remaining.get(toast.id) ?? duration) : Math.max(1, deadline - Date.now());
      clearTimer(toast.id);
      remaining.set(toast.id, left);
    } else {
      schedule(toast.id, remaining.get(toast.id) ?? duration);
    }
  }
}

/** A toast's action dismisses it first, so an Undo that shows its own toast replaces this one. */
export function runToastAction(toast: ToastItem): void {
  dismissToast(toast.id);
  toast.action?.run();
}

// --- extension UI side channels --------------------------------------------

/** `setStatus` entries, newest last, keyed by the extension's status key. */
export interface ExtensionStatus {
  key: string;
  text: string;
}

export const extensionStatuses = signal<ExtensionStatus[]>([]);

/** `setWidget` entries, keyed by the extension's widget key. */
export interface ExtensionWidget {
  key: string;
  lines: string[];
  placement: "aboveEditor" | "belowEditor";
}

export const extensionWidgets = signal<ExtensionWidget[]>([]);

/**
 * `setTitle`'s title. The shell puts it on the desktop window
 * (`nsh/desktop`'s `currentWindow().set({ title })`, which is what pi-next's
 * `document.title` was on the web); the app's own title is the fallback.
 */
export const extensionTitle = signal<string | null>(null);

/** Records a request that needs no answer (see `ExtensionDialog`). */
export function recordExtensionSideChannel(request: ExtensionUiRequest): void {
  switch (request.method) {
    case "setStatus":
      extensionStatuses.update((list) => {
        const rest = list.filter((item) => item.key !== request.statusKey);
        return request.statusText === undefined ? rest : [...rest, { key: request.statusKey, text: request.statusText }];
      });
      return;
    case "setWidget":
      extensionWidgets.update((list) => {
        const rest = list.filter((item) => item.key !== request.widgetKey);
        if (request.widgetLines === undefined) return rest;
        return [...rest, { key: request.widgetKey, lines: request.widgetLines, placement: request.widgetPlacement ?? "aboveEditor" }];
      });
      return;
    case "setTitle":
      extensionTitle.set(request.title || null);
      return;
    case "set_editor_text":
      // The composer owns the draft (`state/composer.ts`): queue the text for
      // it, and its next effect appends it (`appendComposerDraft`).
      insertComposerText(request.text);
      return;
    default:
      return;
  }
}
