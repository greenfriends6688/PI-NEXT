import type { ThinkingLevel } from "./types.ts";

/** A durable instruction for a future Agent run. Times are UTC milliseconds unless noted. */
export type ScheduleRule =
  | { kind: "once"; at: string }
  | { kind: "daily"; time: string; timeZone: string }
  | { kind: "weekly"; time: string; timeZone: string; days: number[] }
  /** A five-field cron expression (`shared/cron.ts` parses it). */
  | { kind: "cron"; expr: string; timeZone: string };

export type ScheduledTaskDraft = {
  name: string;
  prompt: string;
  /** A project on the machine that owns the schedule; absent means a fresh scratch chat. */
  project?: string;
  /** The chat that asked for this task. Each run's outcome is reported back into it. */
  notifyConversationId?: string;
  schedule: ScheduleRule;
  /**
   * How much of the toolset this run may use. Absent means `read-only`: an unattended run has
   * nobody to approve a write, so the safe answer is the one a task gets by default.
   */
  toolPreset?: "default" | "read-only";
  /** The model to answer with, when the task should not follow whatever the app is on. */
  model?: { provider: string; id: string };
  /** The reasoning effort for this task's runs. Absent leaves the model's own default. */
  thinkingLevel?: ThinkingLevel;
  /**
   * How long one run may last before it is stopped, in minutes.
   *
   * Absent means {@link DEFAULT_MAX_DURATION_MIN}. An unattended run has nobody to notice it
   * is stuck, and a task that quietly holds the agent slot for a day is worse than one that
   * stops and says why: the next occurrence then has somewhere to run.
   */
  maxDurationMin?: number;
};

/** 30 minutes: long enough for a real task, short enough that a wedged one is not a day. */
export const DEFAULT_MAX_DURATION_MIN = 30;
/** The range `validateScheduleDraft` accepts. */
export const MAX_DURATION_LIMITS = { min: 1, max: 24 * 60 } as const;
/** Failed runs in a row after which a task pauses itself. */
export const MAX_CONSECUTIVE_FAILURES = 5;

export type ScheduledTask = ScheduledTaskDraft & {
  id: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  nextRunAt?: number;
  lastRunAt?: number;
  lastStatus?: ScheduledRunStatus;
  /**
   * Failed runs in a row. Reset by a run that completed; at {@link MAX_CONSECUTIVE_FAILURES}
   * the task switches itself off, because a schedule that fails every time is not a schedule
   * — it is a notification the user has stopped reading.
   */
  consecutiveFailures?: number;
  /** Set when the task switched itself off, so the row can say why instead of looking paused. */
  disabledReason?: "failures";
};

/** What started a run. A catch-up ran late; a manual one was asked for by hand. */
export type ScheduledRunTrigger = "schedule" | "catch-up" | "manual";

/** How late a scheduled occurrence may start and still count as one (rather than being missed). */
export const CATCH_UP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Past this much delay the occurrence is treated as a catch-up run in the history. */
export const CATCH_UP_LATE_MS = 60_000;

export type ScheduledRunStatus = "running" | "completed" | "failed" | "stopped" | "interrupted" | "missed";

/**
 * What started a run, from when it was supposed to start and when it actually did.
 *
 * A run that began within {@link CATCH_UP_LATE_MS} of its own time is the schedule doing its
 * job; one that began later came back from a sleep, a restart or a busy engine, and the
 * history should say so rather than showing a run that "started" at the wrong minute. Pure,
 * because this is the kind of rule that should be readable on its own.
 */
export function runTrigger(scheduledAt: number, now: number, manual: boolean): ScheduledRunTrigger {
  if (manual) return "manual";
  return now - scheduledAt > CATCH_UP_LATE_MS ? "catch-up" : "schedule";
}

export type ScheduledTaskRun = {
  id: string;
  taskId: string;
  scheduledAt: number;
  startedAt?: number;
  endedAt?: number;
  status: ScheduledRunStatus;
  conversationId?: string;
  error?: string;
  /** Absent in files written before this field existed, and read as a scheduled run. */
  trigger?: ScheduledRunTrigger;
  /** A manual run does not move a recurring task's next scheduled occurrence. */
  manual?: boolean;
  /** The switch-off that this run caused, so the message names the same number the row shows. */
  disabledAfterFailures?: number;
};

export type ScheduledTaskPatch = Partial<Pick<ScheduledTaskDraft, "name" | "prompt" | "schedule" | "maxDurationMin" | "toolPreset" | "model" | "thinkingLevel">> & {
  /** Explicitly clear a bound project with an empty string (undefined means leave unchanged). */
  project?: string;
  /** An empty string stops reporting back. */
  notifyConversationId?: string;
  enabled?: boolean;
};

export type ScheduledTaskSnapshot = {
  revision: number;
  tasks: ScheduledTask[];
};
/** Every rule kind, in the order the form offers them. */
export const SCHEDULE_KINDS = ["once", "daily", "weekly", "cron"] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];
