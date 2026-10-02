/**
 * fork:proma-31-task-progress — task progress derived from the transcript (PR-31).
 *
 * Why this is a pure module and not a component: the only thing that knows about
 * "what is the agent doing right now" in this repo is `lib/todo-state.ts`, which
 * rebuilds the list from the newest `todo` tool result. That gives us a boolean
 * per item (`done`) and nothing else — no "current" field, no failure field, no
 * ordering guarantee beyond list order. Everything the overlay shows is therefore
 * an *inference*, and inferences belong somewhere they can be tested:
 *
 *   · six states (Proma's `TaskItemStatus`) so callers that later learn about
 *     blocked/error/cancelled don't need a second vocabulary;
 *   · `getCurrentTask` — the last `in_progress`, else the last non-terminal item.
 *     Proma uses the same two-step fallback, and it is the difference between a
 *     counter and progress: an un-ticked list still names the next step.
 *   · `shouldRetainTaskProgress` — **the finish countdown only starts once the
 *     whole run ended**. The obvious implementation ("no streaming → hide in 4s")
 *     drops the overlay in the middle of a run that streams between tool calls,
 *     which is exactly when the user needs to see it.
 *
 * Nothing here reads the clock, the DOM or the filesystem: the retention timer
 * lives in the component, the decision of *whether* to retain lives here.
 */

import type { TodoItem, TodoSummary } from "./todo-state";

/**
 * The six task states. `completed` / `cancelled` / `error` are terminal; `pending`
 * and `in_progress` are live; `blocked` is live-but-stuck (kept out of the
 * terminal set on purpose — a blocked task still waits to be picked up again).
 */
export const TASK_ITEM_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "cancelled",
  "error",
] as const;

export type TaskItemStatus = (typeof TASK_ITEM_STATUSES)[number];

export const TERMINAL_TASK_STATUSES: readonly TaskItemStatus[] = ["completed", "cancelled", "error"];

export function isTaskItemStatus(value: unknown): value is TaskItemStatus {
  return typeof value === "string" && (TASK_ITEM_STATUSES as readonly string[]).includes(value);
}

/** Narrow an unknown status from the outside world (tool output, localStorage). */
export function toTaskItemStatus(value: unknown, fallback: TaskItemStatus = "pending"): TaskItemStatus {
  return isTaskItemStatus(value) ? value : fallback;
}

/** A task as the overlay shows it: a name plus what is known about its state. */
export interface TaskItem {
  id: string;
  /** The task name (todo text). */
  subject: string;
  status: TaskItemStatus;
  /** What the agent is doing *right now*, when known. Preferred over `subject`. */
  activeForm?: string;
}

/** Everything the overlay renders comes out of here — one call, no re-deriving. */
export interface TaskProgress {
  /** Completed count. `done / total` is the fraction the progress bar fills. */
  done: number;
  total: number;
  /** The item in flight, or the next open one; `null` once everything is terminal. */
  current: TaskItem | null;
  hasBlocked: boolean;
  hasError: boolean;
}

export function isTerminalTaskStatus(status: TaskItemStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status);
}

/**
 * The one item worth naming: the last `in_progress`, else the last item that is
 * not terminal yet. "Last" because agents work top-down through a plan, so the
 * newest unfinished entry is the step they are on.
 */
export function getCurrentTask(items: readonly TaskItem[]): TaskItem | null {
  let current: TaskItem | null = null;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]!;
    if (item.status === "in_progress") return item;
    // Walking backwards, the first non-terminal row we meet *is* the last one,
    // so it must not be overwritten by the rows before it.
    if (current === null && !isTerminalTaskStatus(item.status)) current = item;
  }
  return current;
}

export function aggregateTaskItems(items: readonly TaskItem[]): TaskProgress {
  let done = 0;
  let hasBlocked = false;
  let hasError = false;
  for (const item of items) {
    if (item.status === "completed") done += 1;
    else if (item.status === "blocked") hasBlocked = true;
    else if (item.status === "error") hasError = true;
  }
  return { done, total: items.length, current: getCurrentTask(items), hasBlocked, hasError };
}

/** Fill fraction in [0, 1]; an empty list is 0, not NaN. */
export function taskProgressRatio(progress: TaskProgress): number {
  if (progress.total <= 0) return 0;
  return Math.min(1, Math.max(0, progress.done / progress.total));
}

/**
 * Visual tone for the overlay. `error` outranks `blocked`: a failed task is the
 * one that needs a decision, a blocked one only needs to be noticed.
 */
export type TaskProgressTone = "active" | "blocked" | "error";

export function taskProgressTone(progress: TaskProgress): TaskProgressTone {
  if (progress.hasError) return "error";
  if (progress.hasBlocked) return "blocked";
  return "active";
}

/**
 * A stable string identity for a task list, for React dependency convergence:
 * every streamed chunk rebuilds the array, so depending on the array itself
 * restarts the overlay's timers several times per second. A string compares by
 * value, so an unchanged list is an unchanged dependency.
 */
export function taskSignature(items: readonly TaskItem[]): string {
  return items.map((item) => `${item.id}:${item.status}:${item.subject}:${item.activeForm ?? ""}`).join("|");
}

/**
 * Whether the overlay should keep the finished state around and start counting
 * down. **Only after the run ended** — while the agent is still streaming there
 * is nothing to count down, and hiding early is what made this feature feel
 * broken in the reference implementation's followers.
 */
export function shouldRetainTaskProgress(streaming: boolean, hasTasks: boolean): boolean {
  return hasTasks && !streaming;
}

/** How a todo row maps onto the six states, given whether it is the active row. */
export function taskStatusFromTodo(done: boolean, active: boolean): TaskItemStatus {
  if (done) return "completed";
  return active ? "in_progress" : "pending";
}

export interface TaskDeriveOptions {
  /** Whether the run is still going. A finished run has nothing "in progress". */
  streaming?: boolean;
  /** The run failed on this item — the open one becomes `error`, not `pending`. */
  failed?: boolean;
  /** The run was stopped/cancelled: every unfinished item becomes `cancelled`. */
  cancelled?: boolean;
  /**
   * Per-id corrections from another producer, the seam where a non-todo source
   * reports `blocked` (or a friendlier `activeForm`). Todo rows alone can never
   * produce `blocked` — the tool has no such field, and inventing one from the
   * text would be a guess dressed as data.
   */
  overrides?: Record<string, Partial<Pick<TaskItem, "status" | "subject" | "activeForm">>>;
}

function todoListOf(source: TodoSummary | readonly TodoItem[]): readonly TodoItem[] {
  return Array.isArray(source) ? source : (source as TodoSummary).todos;
}

/**
 * Todo list → task items.
 *
 * `TodoItem` is a `{id, text, done}` triple, so exactly three states are
 * readable from it: completed rows, the first open row (the one the agent is on),
 * and the remaining open rows. The three outcomes — failed / cancelled / blocked —
 * are applied afterwards, which keeps the mapping table inspectable in one place.
 */
export function deriveTaskItems(source: TodoSummary | readonly TodoItem[], options: TaskDeriveOptions = {}): TaskItem[] {
  const todos = todoListOf(source);
  if (todos.length === 0) return [];

  const streaming = options.streaming ?? false;
  const firstOpen = todos.findIndex((todo) => !todo.done);
  const overrides = options.overrides ?? {};

  const items = todos.map<TaskItem>((todo, index) => {
    const override = overrides[String(todo.id)];
    // A finished run has no "in progress": the row stays open, it is just not
    // being worked on any more (Proma demotes `in_progress` the same way).
    const active = streaming && !todo.done && index === firstOpen;
    return {
      id: String(todo.id),
      subject: override?.subject ?? todo.text,
      status: override?.status ?? taskStatusFromTodo(todo.done, active),
      ...(override?.activeForm ? { activeForm: override.activeForm } : {}),
    };
  });

  if (options.cancelled) {
    return items.map((item) => (isTerminalTaskStatus(item.status) ? item : { ...item, status: "cancelled" as const }));
  }
  if (options.failed) {
    const failedId = items[firstOpen === -1 ? 0 : firstOpen]?.id;
    return items.map((item) => (
      item.id === failedId && !isTerminalTaskStatus(item.status) ? { ...item, status: "error" as const } : item
    ));
  }
  return items;
}