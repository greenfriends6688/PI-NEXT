/**
 * PR-36 · 委派收敛屏障的纯逻辑（软提醒，不是硬阻断）。
 *
 * Proma 的 `wait_for_delegations` 是「结果收敛屏障」：委派返回 ≠ 完成，只要本轮
 * 回复依赖子任务结果，模型就必须等。本仓刻意做得更保守 —— 不设「不调用 wait 就
 * 不许结束本轮」的硬门（那会打断合理地只报告部分结果的场景），只在两个地方放软提醒：
 *
 * 1. `get_subagent_result` 的返回值（模型可见）：还有几个子代理没收敛；
 * 2. 消息流里的状态徽标（人可见）：同一份 pending 计数经 tool details 送到 UI。
 *
 * 「还活着」的口径与空闲回收共用 `lib/delegated-work.ts` 的 `ACTIVE_SUBAGENT_STATUSES`，
 * 不在这里另造一份集合，避免两处漂移。
 */
import { ACTIVE_SUBAGENT_STATUSES } from "./delegated-work";
import type { SubagentSessionStatus } from "./types";

/** 只取匹配需要的两个字段，注册表里的完整 run 结构可以原样传进来。 */
export interface ActiveSubagentLike {
  parentSessionId?: string;
  status?: string;
}

/**
 * 某个父会话底下仍处于 `starting | queued | running` 的子代理。
 * 顺序保持传入顺序；父会话 id 为空时返回空数组。
 */
export function filterActiveSubagents<T extends ActiveSubagentLike>(
  runs: Iterable<T>,
  parentSessionId: string,
): T[] {
  const parent = typeof parentSessionId === "string" ? parentSessionId : "";
  if (!parent) return [];
  const active: T[] = [];
  for (const run of runs) {
    if (!run || typeof run !== "object") continue;
    if (run.parentSessionId !== parent) continue;
    if (typeof run.status !== "string") continue;
    if (!ACTIVE_SUBAGENT_STATUSES.has(run.status as SubagentSessionStatus)) continue;
    active.push(run);
  }
  return active;
}

/** 未收敛计数；只做展示与提醒，不参与任何阻塞判定。 */
export function countActiveSubagents(
  runs: Iterable<ActiveSubagentLike>,
  parentSessionId: string,
): number {
  return filterActiveSubagents(runs, parentSessionId).length;
}

/**
 * 模型可见的收敛提醒。0 个未收敛时返回空串，调用方直接拼接即可。
 * 语气是「提醒」不是「命令」：明确说清这是部分结果，让模型自己决定是否继续等。
 */
export function subagentConvergenceReminder(count: number): string {
  const pending = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (pending === 0) return "";
  const subject = pending === 1 ? "1 sub-agent is" : `${pending} sub-agents are`;
  return `Convergence reminder: ${subject} still running in this session (starting/queued/running). Their results have not converged yet, so this is not the final state. If your reply, decision, or deliverable depends on them, wait for them before reporting completion (call get_subagent_result with wait=true, or wait for the background completion notification). If you intentionally report partial progress, state clearly which delegated work is still outstanding.`;
}
