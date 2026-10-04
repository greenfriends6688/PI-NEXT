import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  AUTOMATION_LEASE_TTL_MS,
  decideLease,
  leaseFileName,
  parseLease,
  serializeLease,
} = await jiti.import("./automation-lease.ts");

const HELD = { pid: 111, acquiredAt: 1000, expiresAt: 2000 };

// fork:automation-lease —— 判定的三条：没人持有 / 有人持有未过期 / 僵尸锁。
test("no holder means the lease is grantable", () => {
  const decision = decideLease(null, 1000);
  assert.equal(decision.ok, true);
  assert.equal(decision.lease.pid, 0, "没人持有时 pid 只是占位");
  assert.equal(decision.lease.expiresAt, 1000 + AUTOMATION_LEASE_TTL_MS);
});

test("a live holder blocks everyone else", () => {
  const decision = decideLease(HELD, 1500);
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "held");
  // 拿回的是**持有者**的租约，不是我们自己的 —— 否则 UI 会显示自己锁着自己。
  assert.deepEqual(decision.lease, HELD);
});

// kill -9 会留下锁文件。没这条的话，一个崩掉的调度器就让那个任务**永久**不再跑，
// 而且没有任何提示。
test("an expired leftover lock is reclaimed, not honoured", () => {
  const decision = decideLease(HELD, 2000);
  assert.equal(decision.ok, true);
  assert.equal(decision.reason, undefined);
  assert.equal(decision.lease.expiresAt, 2000 + AUTOMATION_LEASE_TTL_MS);
  // 刚过期一毫秒也要能接管（用 <= 而不是 <）。
  assert.equal(decideLease(HELD, 1999).ok, false);
  assert.equal(decideLease(HELD, 2000).ok, true);
});

test("garbage in the lock file must not deadlock the task forever", () => {
  // 缺 expiresAt / NaN / 负数 / 非对象 —— 全部当无主。
  for (const bad of [
    { pid: 1, acquiredAt: 0 },
    { pid: 1, expiresAt: NaN },
    { pid: 1, expiresAt: -1 },
    { expiresAt: 5000 },
    { pid: "x", expiresAt: 5000 },
  ]) {
    assert.equal(decideLease(bad, 1000).ok, true, `${JSON.stringify(bad)} 不该永久锁死`);
  }
});

test("parseLease rejects anything that is not a lease", () => {
  assert.equal(parseLease(null), null);
  assert.equal(parseLease(""), null);
  assert.equal(parseLease("{oops"), null);
  assert.equal(parseLease("[]"), null);
  assert.equal(parseLease('"a string"'), null);
  assert.equal(parseLease('{"pid":1}'), null, "缺 expiresAt");
  assert.deepEqual(parseLease(serializeLease(HELD)), HELD);
  // 缺 acquiredAt 可以补 0，但 expiresAt 不能缺 —— 那是判活依据。
  assert.deepEqual(parseLease('{"pid":7,"expiresAt":9000}'), { pid: 7, acquiredAt: 0, expiresAt: 9000 });
});

test("lease file names cannot escape the lease directory", () => {
  // automationId 来自本地配置，但仍然不该让它决定路径。
  assert.equal(leaseFileName("../../etc/passwd"), ".._.._etc_passwd.lease.json");
  assert.equal(leaseFileName("a/b\\c"), "a_b_c.lease.json");
  assert.equal(leaseFileName(""), "automation.lease.json");
  // 非 ASCII 一律归一化成 `_`：macOS 按 NFD 存文件名，NFC 与 NFD 的同一个词
  // 会变成**两个文件**，于是两把“不同”的锁，锁就等于没有。
  assert.equal(leaseFileName("正常任务-1"), "____-1.lease.json");
  assert.equal(
    leaseFileName("café"),
    leaseFileName("café"),
    "NFC 与 NFD 的同一个词必须映射到同一个租约文件",
  );
  assert.ok(leaseFileName("x".repeat(500)).length <= 128 + ".lease.json".length, "超长 id 要截断");
});
// IO 层用真实临时目录跑：判定逻辑对了、落盘错了，同样是重复执行。
test("claim + release works against real files, and a second claim is refused", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { claimAutomationLease, leaseIoForDir } = await jiti.import("./automation-lease.ts");

  const dir = join(mkdtempSync(join(tmpdir(), "pi-lease-")), "automation");
  const io = leaseIoForDir(dir, 4242);

  const release = claimAutomationLease(io, "task-a", 1000, 4242);
  assert.ok(release, "第一次认领应该成功");
  // 落盘内容可读回，且 pid 是我们给的。
  assert.equal(io.read("task-a")?.pid, 4242);

  // 第二个「进程」拿不到同一把锁。
  assert.equal(claimAutomationLease(io, "task-a", 1500), null);
  // 但**另一个**任务互不影响。
  const other = claimAutomationLease(io, "task-b", 1500, 4242);
  assert.ok(other);

  release();
  assert.equal(io.read("task-a"), null, "释放后不该还锁着");
  // 释放后能重新拿到。
  assert.ok(claimAutomationLease(io, "task-a", 1600, 4242));
  other();
});

test("release is idempotent — a double release must not delete someone else's lease", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { claimAutomationLease, leaseIoForDir } = await jiti.import("./automation-lease.ts");

  const dir = join(mkdtempSync(join(tmpdir(), "pi-lease-")), "automation");
  const io = leaseIoForDir(dir, 1);
  const release = claimAutomationLease(io, "t", 1000, 1);
  release();
  // 第二个进程拿到锁。
  const second = claimAutomationLease(io, "t", 1100, 2);
  assert.ok(second);
  // 第一个进程的 release 再跑一次 —— 它早该失效，不该把别人的锁删了。
  release();
  assert.ok(io.read("t"), "迟到的 release 删掉了别人的锁");
});

// 这是 PR-C1 的**目的**本身：两个「进程」共用一份租约目录时，
// 同一个任务在任一时刻只能被认领一次。
test("two schedulers sharing a lease dir cannot both run the same task", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { claimAutomationLease, leaseIoForDir } = await jiti.import("./automation-lease.ts");

  const dir = join(mkdtempSync(join(tmpdir(), "pi-lease-")), "automation");
  // 两个进程各自一个 pid，各读各的「文件视角」，但目录是同一个。
  const procA = leaseIoForDir(dir, 1001);
  const procB = leaseIoForDir(dir, 1002);

  const releaseA = claimAutomationLease(procA, "nightly", 10_000, 1001);
  assert.ok(releaseA);
  assert.equal(claimAutomationLease(procB, "nightly", 10_000, 1002), null, "B 不该同时拿到同一把锁");
  // 不同任务仍可并行。
  const bOther = claimAutomationLease(procB, "hourly", 10_000, 1002);
  assert.ok(bOther);

  // A 跑完释放后 B 可以接手 —— 这正是「A 崩了重启后任务还能继续」的那条路。
  releaseA();
  const bNightly = claimAutomationLease(procB, "nightly", 10_100, 1002);
  assert.ok(bNightly, "A 释放后 B 应该能接手");
  bNightly();
  bOther();
});
