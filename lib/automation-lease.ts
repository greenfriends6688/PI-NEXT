/**
 * lib/automation-lease.ts — fork:automation-lease
 *
 * 定时任务的**跨进程**认领。
 *
 * ## 为什么需要
 *
 * `lib/automation-scheduler.ts` 的 `runningIds: Set<string>` 只是**进程内**的
 * 防重入。而桌面壳本身已经是两个进程（Electron main + `next start`），
 * AGENTS.md 里也把「调度器若在两边都起，两个 `AgentSession` 同写一个 `.jsonl`
 * → 数据损坏」列为头号风险。
 *
 * 单看「调度器在哪个进程里跑」：`startAutomationScheduler()` 只由
 * `instrumentation-node.ts` 的 `register()` 调，也就是只在 Next 进程里，
 * Electron main 不跑它 —— 所以今天**不会**重复触发。但那是靠「恰好只有一个
 * 进程 import 它」维持的，不是靠机制保证的：任何人把这次 import 加到第二个
 * 进程（或者以后加一个 worker / CLI 入口），重复执行立刻变成事实，
 * 而且症状是「同一个 `.jsonl` 被两个 session 写」——最难查的那一类。
 *
 * ## 做法
 *
 * 落一个**租约文件**，认领 = 原子地写进去，释放 = 删掉。
 * `lib/atomic-file.ts` 的 `writePrivateFileAtomicSync`（staging + renameSync）
 * 已经把「写到一半被杀不会留下半截文件」这件事做好了，直接复用。
 *
 * 租约里记持有者进程 pid + 过期时间：进程被 `kill -9` 时锁文件会留下，
 * 所以读的时候要判断**是否过期**，过期就当作没锁（僵尸回收）。
 *
 * 纯逻辑（判定）+ 一层薄 IO，故可单测；IO 那一层把 `now` 与写盘都注入。
 */

/** 租约有效期。到期即视为无主（回收僵尸锁）。 */
export const AUTOMATION_LEASE_TTL_MS = 10 * 60 * 1000;

/** 单个租约文件的上限：僵尸锁最坏情况是每个任务一个，都很小。 */
const LEASE_ID_MAX = 128;

export interface AutomationLease {
  /** 持有者进程 pid，仅用于诊断。 */
  pid: number;
  /** 持有时刻（epoch ms）。 */
  acquiredAt: number;
  /** 过期时刻（epoch ms）= acquiredAt + TTL。 */
  expiresAt: number;
}

export type LeaseDecision =
  | { ok: true; lease: AutomationLease }
  /** 别人正持有且未过期。 */
  | { ok: false; reason: "held"; lease: AutomationLease }
  /** 存在残留文件但已过期（上一个进程被 kill -9），可以接管。 */
  | { ok: false; reason: "stale-reclaimed"; lease: AutomationLease };

/**
 * 判定：能不能认领。
 *
 * `existing` 是读到的原文（可能是 null / 坏 JSON / 别的形状）。返回 `ok:true`
 * 表示**可以**写 —— 调用方写完才算真正拿到，之间有一个极小的竞态窗口
 * （两个进程同时判定通过）。这个窗口靠 `writePrivateFileAtomicSync` 的
 * `rename` 语义收口不到（POSIX rename 不覆盖已存在目标在同一文件系统上的
 * 保证是「原子替换」，不是「排他」），所以下面按「后写者覆盖前写者」处理 ——
 * 对本产品可接受：最坏结果是两个进程都跑一轮，而**同一时刻**两轮的概率还要
 * 再乘上这个窗口。真要排他得上 `flock`，但那在 Windows 上没有等价物，
 * 而本仓明确要跨平台。
 */
export function decideLease(
  existing: AutomationLease | null,
  now: number,
  ttlMs: number = AUTOMATION_LEASE_TTL_MS,
): LeaseDecision {
  const lease: AutomationLease = { pid: existing?.pid ?? 0, acquiredAt: now, expiresAt: now + ttlMs };
  if (!isUsableLease(existing)) return { ok: true, lease };
  const expires = existing.expiresAt;
  // 到点即失效（用 <= 而不是 <）：过期的判定要含等号，否则同毫秒重入会互相卡住。
  if (expires <= now) return { ok: true, lease };
  return { ok: false, reason: "held", lease: existing };
}

/**
 * 这份「租约」够不够格当作一份锁。
 *
 * `pid` 与 `expiresAt` **都要**在：`pid` 缺失说明文件不是本模块写出来的（或者
 * 被手改过），拿它去判活就等于信了一个来路不明的布尔值。宁可多跑一轮。
 */
function isUsableLease(value: AutomationLease | null | undefined): value is AutomationLease {
  if (!value) return false;
  return typeof value.pid === "number" && Number.isFinite(value.pid)
    && typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)
    && value.expiresAt > 0;
}

/** 解析租约文件内容。任何不认识的形状都返回 null（当作没锁）。 */
export function parseLease(raw: string | null): AutomationLease | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.pid !== "number" || !Number.isFinite(record.pid)) return null;
    if (typeof record.expiresAt !== "number" || !Number.isFinite(record.expiresAt)) return null;
    const acquiredAt = typeof record.acquiredAt === "number" && Number.isFinite(record.acquiredAt)
      ? record.acquiredAt
      : 0;
    return { pid: record.pid, acquiredAt, expiresAt: record.expiresAt };
  } catch {
    return null;
  }
}

export function serializeLease(lease: AutomationLease): string {
  return JSON.stringify({ pid: lease.pid, acquiredAt: lease.acquiredAt, expiresAt: lease.expiresAt });
}

/**
 * 租约文件名。一个任务一个文件 ⇒ 认领互不影响。
 *
 * 非 ASCII 一律换成 `_`（不只换路径字符）：macOS 的 HFS+/APFS 按 NFD 存文件名，
 * 于是 `café`(NFC) 与 `café`(NFD) 肉眼一模一样却是**两个文件** ——
 * 同样的两个任务 id 会各自拿到一把“不同”的锁，而锁因此形同虚设。
 * 归一化成 ASCII 就绕开了整个 Unicode 归一化问题。
 */
export function leaseFileName(automationId: string): string {
  const safe = automationId.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, LEASE_ID_MAX);
  return `${safe || "automation"}.lease.json`;
}
// ── IO 层 ───────────────────────────────────────────────────────────────────
//
// 判定在上面（纯逻辑、可单测），这里只做「读文件 / 原子写 / 删」。
// IO 全部注入，故测试能用临时目录跑真实文件行为，而不必 mock fs。

import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writePrivateFileAtomicSync } from "./atomic-file";

export interface AutomationLeaseIo {
  read: (automationId: string) => AutomationLease | null;
  write: (automationId: string, lease: AutomationLease) => void;
  release: (automationId: string) => void;
}

/**
 * 认领一个任务：能拿到就返回 release 函数，拿不到返回 null。
 *
 * 调用方**必须**在 finally 里调 release —— 租约的 TTL 是兜底（进程被 kill -9
 * 时回收僵尸锁），不是正常路径。靠 TTL 收尾意味着每轮都要多等一次过期才能再跑。
 */
export function claimAutomationLease(
  io: AutomationLeaseIo,
  automationId: string,
  now: number = Date.now(),
  pid: number = process.pid,
): (() => void) | null {
  const decision = decideLease(io.read(automationId), now);
  if (!decision.ok) return null;
  // pid **必须**在这里盖上：`decideLease` 在「原本没人持有」时只能填 0
  //（它没有调用方进程的上下文），而 pid 是事后诊断「这条锁是谁留下的」的唯一线索。
  const lease: AutomationLease = { ...decision.lease, pid };
  io.write(automationId, lease);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    io.release(automationId);
  };
}

/** 租约目录默认与定时任务本体同目录（同一个 `~/.pi/agent/automation/`）。 */
export function leaseIoForDir(dir: string, pid: number = process.pid): AutomationLeaseIo {
  const pathOf = (automationId: string) => join(dir, leaseFileName(automationId));
  return {
    read(automationId) {
      try {
        return parseLease(readFileSync(pathOf(automationId), "utf8"));
      } catch {
        return null;
      }
    },
    write(automationId, lease) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      writePrivateFileAtomicSync(pathOf(automationId), serializeLease(lease));
    },
    release(automationId) {
      try {
        rmSync(pathOf(automationId), { force: true });
      } catch {
        // 删不掉就等 TTL 过期，释放失败不该让调度器抛。
      }
    },
  };
}
