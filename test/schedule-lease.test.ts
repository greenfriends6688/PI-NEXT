import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEASE_STALE_MS, claimLease, releaseLease } from "../src/main/engine/schedule-lease.ts";

/**
 * One machine, one scheduler.
 *
 * Two engines reading the same task file — the installed app beside a dev build, or a
 * headless Agent beside a window — would otherwise both find the same occurrence due and
 * both send the prompt. Claiming is durable, so that is not a duplicate notice; it is the
 * task running twice, with its tools doing their work twice.
 *
 * The tests hand in the pid rather than relying on this process's, because "another
 * process" is exactly the case being described.
 */

function leaseFile(t: { after(fn: () => void): void }): string {
  const folder = mkdtempSync(join(tmpdir(), "pinext-lease-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "tasks.json.lease");
}

test("the first asker holds it and a second process is refused", (t) => {
  const file = leaseFile(t);
  const now = Date.parse("2026-01-01T00:00:00Z");
  assert.equal(claimLease(file, now, 111), "held");
  assert.equal(claimLease(file, now + 1000, 222), "busy");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).pid, 111, "the holder was not overwritten");
});

test("a holder renews without reading, and keeps it", (t) => {
  const file = leaseFile(t);
  const now = Date.parse("2026-01-01T00:00:00Z");
  claimLease(file, now, 111);
  assert.equal(claimLease(file, now + LEASE_STALE_MS - 1, 111, true), "held");
  assert.equal(claimLease(file, now + LEASE_STALE_MS + 1, 222), "busy", "renewal kept it fresh");
});

test("a process that stopped renewing loses the lease", (t) => {
  const file = leaseFile(t);
  const now = Date.parse("2026-01-01T00:00:00Z");
  claimLease(file, now, 111);
  assert.equal(claimLease(file, now + LEASE_STALE_MS, 222), "taken");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).pid, 222);
});

test("a lease nobody can read does not stop the schedule for ever", (t) => {
  const file = leaseFile(t);
  const now = Date.parse("2026-01-01T00:00:00Z");
  for (const junk of ["", "not json", "{}", '{"pid":0,"at":1}', '{"pid":"111","at":1}', '{"pid":111}']) {
    writeFileSync(file, junk);
    assert.equal(claimLease(file, now, 111), "held", `${JSON.stringify(junk)} should read as free`);
  }
  rmSync(file, { force: true });
  assert.equal(claimLease(file, now, 111), "held", "a missing file is free");
});

test("only the holder releases, and releasing twice is not an error", (t) => {
  const file = leaseFile(t);
  const now = Date.parse("2026-01-01T00:00:00Z");
  claimLease(file, now, 111);
  releaseLease(file, 222);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).pid, 111, "a stranger's release was ignored");
  releaseLease(file, 111);
  assert.throws(() => readFileSync(file, "utf8"), "the file is gone, not emptied");
  assert.equal(claimLease(file, now, 222), "held", "the lease is free once released");
  releaseLease(file, 222);
});
