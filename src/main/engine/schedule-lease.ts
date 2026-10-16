import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * One scheduler at a time, across processes.
 *
 * A schedule is a property of the machine, not of a process: `settings.json` and the task
 * file live in one data directory, and two engines reading it — the packaged app beside a
 * dev build, or a headless Agent beside the window — would each find the same occurrence due
 * and each send the prompt. Claiming an occurrence is durable, so that is not a duplicate
 * notification; it is the task running twice.
 *
 * The lease is a file holding the owner's pid and the instant it last checked in. A lease is
 * honoured only while it is fresh, so a process that was killed cannot keep the schedule
 * forever: after {@link LEASE_STALE_MS} anybody may take it. A live holder renews on every
 * timer tick, and releases on the way out so a clean quit hands over at once.
 *
 * What this deliberately does **not** do is fence the work: a holder that stops renewing
 * (a long sleep, a suspended laptop) can lose the lease while its run is still going, and
 * both processes may then have a run alive. That is the same window the catch-up rule
 * already covers, and the alternative — a lock held for the length of an agent run — would
 * stall the schedule on a crashed run for as long as its duration allows.
 */

export const LEASE_STALE_MS = 90_000;

export type ScheduleLease = { pid: number; at: number };

export type LeaseOutcome = "held" | "taken" | "busy";

function read(file: string): ScheduleLease | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<ScheduleLease>;
    if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    if (typeof parsed.at !== "number" || !Number.isFinite(parsed.at)) return null;
    return { pid: parsed.pid, at: parsed.at };
  } catch {
    // Missing, unreadable or corrupt: all three read as "nobody holds it". A half-written
    // file cannot be allowed to stop the schedule for ever.
    return null;
  }
}

function write(file: string, lease: ScheduleLease): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(lease)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

/** Whether this process may fire. `alreadyHeld` short-circuits the read on a renewal. */
export function claimLease(file: string, now = Date.now(), pid = process.pid, alreadyHeld = false): LeaseOutcome {
  if (alreadyHeld) {
    write(file, { pid, at: now });
    return "held";
  }
  const current = read(file);
  if (current && current.pid !== pid && now - current.at < LEASE_STALE_MS) return "busy";
  write(file, { pid, at: now });
  return current && current.pid !== pid ? "taken" : "held";
}

/** Drop the lease if this process holds it. Another process's lease is left alone. */
export function releaseLease(file: string, pid = process.pid): void {
  const current = read(file);
  if (!current || current.pid !== pid) return;
  try {
    rmSync(file, { force: true });
  } catch {
    // A lease that could not be removed goes stale on its own; nothing to report.
  }
}
