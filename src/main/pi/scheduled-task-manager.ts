import type {
  ScheduledTask, ScheduledTaskDraft, ScheduledTaskPatch, ScheduledTaskRun, ScheduledTaskSnapshot,
} from "@shared/schedules";
// Relative: this file is loaded by `test/scheduled-tasks.test.ts`, which `node --test` runs
// without the `@shared/*` alias (see the note in `engine/scheduled-tasks.ts`).
import { CATCH_UP_WINDOW_MS, DEFAULT_MAX_DURATION_MIN } from "../../shared/schedules.ts";
import { ScheduledTaskStore } from "../engine/scheduled-tasks.ts";
import { claimLease, releaseLease } from "../engine/schedule-lease.ts";

const MAX_TIMER_MS = 60_000;

export type ScheduledTaskRunner = (
  task: ScheduledTask,
  signal: AbortSignal,
  onConversation: (id: string) => void,
) => Promise<void>;

/** Called once a run has ended on its own (not when the app quits under it). */
export type ScheduledTaskSettled = (task: ScheduledTask, run: ScheduledTaskRun) => void;

/** Engine-owned: a window can disappear without taking the next occurrence with it.
 * Claiming an occurrence is synchronous and durable; a crash cannot replay a prompt
 * whose tools may already have modified the workspace. */
export class ScheduledTaskManager {
  readonly #store: ScheduledTaskStore;
  readonly #runner: ScheduledTaskRunner;
  readonly #onSettled: ScheduledTaskSettled | undefined;
  readonly #listeners = new Set<(snapshot: ScheduledTaskSnapshot) => void>();
  readonly #leaseFile: string;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #started = false;
  #leaseHeld = false;
  /** Whether the last claim was refused, so the pane can say another process owns it. */
  #leaseBusy = false;
  #active: { taskId: string; runId: string; abort: AbortController; stopRequested: boolean; deadline: ReturnType<typeof setTimeout> | null } | null = null;

  constructor(file: string, runner: ScheduledTaskRunner, onSettled?: ScheduledTaskSettled) {
    this.#store = new ScheduledTaskStore(file);
    this.#leaseFile = `${file}.lease`;
    this.#runner = runner;
    this.#onSettled = onSettled;
    this.#store.onChange = (snapshot) => {
      this.#notify(snapshot);
      this.#arm();
    };
  }

  onChange(listener: (snapshot: ScheduledTaskSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  list(): ScheduledTaskSnapshot { return this.#store.snapshot(); }
  history(id: string): ScheduledTaskRun[] { return this.#store.listRuns(id); }
  hasEnabledTasks(): boolean { return this.#store.hasEnabledTasks() || this.#active !== null; }
  /**
   * Whether this process owns the schedule. False means another Pinext (a dev build beside
   * the installed app, a headless Agent) is holding it, so nothing here fires and the tasks
   * will look paused for a reason the pane has to be able to explain.
   */
  holdsLease(): boolean { return this.#leaseHeld; }
  leaseBusy(): boolean { return this.#leaseBusy; }
  flush(): void { this.#store.flush(); }

  create(draft: ScheduledTaskDraft): ScheduledTask {
    const task = this.#store.create(draft);
    this.#wake();
    return task;
  }

  update(id: string, patch: ScheduledTaskPatch): ScheduledTask {
    const task = this.#store.update(id, patch);
    if (!task) throw new Error("定时任务不存在");
    this.#wake();
    return task;
  }

  remove(id: string): boolean {
    if (this.#active?.taskId === id) throw new Error("任务正在执行，请先停止后再删除");
    return this.#store.remove(id);
  }

  runNow(id: string): ScheduledTaskRun {
    const task = this.#store.get(id);
    if (!task) throw new Error("定时任务不存在");
    if (!this.#started) throw new Error("引擎未启动，无法立即执行");
    if (!this.#leaseHeld) this.#takeLease();
    if (!this.#leaseHeld) throw new Error("另一个 Pinext 进程正在管理定时任务，请先退出它");
    if (this.#active) throw new Error("已有定时任务正在执行，请等待其结束");
    const run = this.#store.claim(id, Date.now(), "running", true);
    this.#launch(task, run);
    return run;
  }

  stopRun(id: string): boolean {
    const active = this.#active;
    if (!active || active.taskId !== id) return false;
    active.stopRequested = true;
    active.abort.abort();
    return true;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#wake();
  }

  /** Call after the machine wakes or its clock changes. It never replays an already
   * claimed occurrence, and collapses multiple missed repeats into at most one run. */
  wake(): void { this.#wake(); }

  stop(): void {
    this.#started = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    const active = this.#active;
    if (active) {
      if (active.deadline) clearTimeout(active.deadline);
      this.#store.finish(active.runId, "interrupted", "应用已退出");
      active.abort.abort();
      // Keep the slot occupied until the runner's finally settles. A quick stop/start
      // must never overlap a new occurrence with the old Agent still winding down.
    }
    this.#store.flush();
    if (this.#leaseHeld) releaseLease(this.#leaseFile);
    this.#leaseHeld = false;
    this.#leaseBusy = false;
  }

  /**
   * Take or renew the machine-wide lease. Renewed on every timer tick, so a holder that is
   * alive keeps it and one that was killed loses it to whoever asks next.
   */
  #takeLease(): void {
    const outcome = claimLease(this.#leaseFile, Date.now(), process.pid, this.#leaseHeld);
    this.#leaseHeld = outcome !== "busy";
    this.#leaseBusy = outcome === "busy";
    if (outcome === "taken") console.warn("[schedules] took over the schedule from a process that stopped renewing it");
  }

  #wake(): void {
    if (!this.#started) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#pump();
  }

  #pump(): void {
    if (!this.#started) return;
    this.#takeLease();
    if (!this.#leaseHeld) { this.#arm(); return; }
    if (this.#active) { this.#arm(); return; }
    const now = Date.now();
    const due = this.#store.due(now).sort((a, b) => (a.nextRunAt ?? 0) - (b.nextRunAt ?? 0));
    for (const task of due) {
      const at = task.nextRunAt!;
      if (now - at > CATCH_UP_WINDOW_MS) {
        // Too old to be a run the user still wants: a task that was due yesterday morning
        // and fires now would do its work on today's workspace. It is recorded as missed so
        // the history says what happened to it, and the schedule moves on.
        this.#store.claim(task.id, at, "missed");
        continue;
      }
      // Otherwise it runs late and the run is marked as a catch-up. One occurrence, however
      // many slots were skipped: `claim` moves the next time past `now`.
      const run = this.#store.claim(task.id, at);
      this.#launch(task, run);
      return;
    }
    this.#arm();
  }

  #launch(task: ScheduledTask, run: ScheduledTaskRun): void {
    const active = {
      taskId: task.id, runId: run.id, abort: new AbortController(), stopRequested: false,
      deadline: null as ReturnType<typeof setTimeout> | null,
    };
    this.#active = active;
    this.#arm(); // No zero-delay retry loop while another occurrence is in flight.
    this.#notify(); // A consumed one-off still needs the tray until this run ends.
    // An unattended run has nobody to notice it is stuck, so it stops itself. The reason is
    // written onto the run: a timeout that showed up as a bare failure would read as the
    // task's fault rather than its length.
    const minutes = task.maxDurationMin ?? DEFAULT_MAX_DURATION_MIN;
    let timedOut = false;
    active.deadline = setTimeout(() => {
      timedOut = true;
      active.stopRequested = true;
      this.#store.finish(run.id, "failed", `运行超过 ${minutes} 分钟，已停止`);
      active.abort.abort();
    }, minutes * 60_000);
    void Promise.resolve().then(() => this.#runner(task, active.abort.signal, (id) => this.#store.setConversation(run.id, id)))
      .then(() => this.#store.finish(run.id, active.stopRequested && !timedOut ? "stopped" : "completed"))
      .catch((error: unknown) => this.#store.finish(run.id, timedOut ? "failed" : active.stopRequested ? "stopped" : "failed", String(error instanceof Error ? error.message : error)))
      .then((finished) => {
        // Only the call that moved the run out of `running` reports it: stop() has
        // already marked a quit-time run interrupted, and that is nobody's news. The
        // deadline's own finish is reported here too — with the count of failures in a row,
        // which is how the message can say the task just paused itself.
        if (!finished) return;
        try { this.#onSettled?.(this.#store.get(task.id) ?? task, finished); }
        catch (error) { console.error("[schedules] settle listener failed:", error); }
      })
      .finally(() => {
        if (active.deadline) clearTimeout(active.deadline);
        if (this.#active === active) this.#active = null;
        this.#wake();
        this.#notify();
      })
      .catch((error: unknown) => console.error("[schedules] could not persist run outcome:", error));
  }

  #notify(snapshot = this.#store.snapshot()): void {
    for (const listener of this.#listeners) {
      try { listener(snapshot); }
      catch (error) { console.error("[schedules] subscriber failed:", error); }
    }
  }

  #arm(): void {
    if (!this.#started) return;
    // The lease is renewed here rather than on its own timer: this runs on every store
    // change and at least once a minute while a task is scheduled, which is well inside
    // `LEASE_STALE_MS`, and a process with nothing scheduled does not need to hold it.
    this.#takeLease();
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#active) { this.#timer = null; return; }
    const next = this.#store.snapshot().tasks.filter((task) => task.enabled && task.nextRunAt !== undefined)
      .reduce<number | undefined>((earliest, task) => earliest === undefined ? task.nextRunAt : Math.min(earliest, task.nextRunAt!), undefined);
    if (next === undefined) { this.#timer = null; return; }
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#pump();
    }, Math.max(0, Math.min(MAX_TIMER_MS, next - Date.now())));
  }
}
