// fork:upstream-998-delegated-work — 上游依据：PR #998「有委派工作的会话不算 idle」
//
// 只取上游的**语义**：`isRunning()` 只描述 wrapper 自己那一轮（待处理 prompt、流式
// 输出、压缩、shell 命令），委派出去的子 run 会在父轮结束之后继续跑，于是父会话看起来
// 空闲 —— 10 分钟的 idle 关停（`PI_WEB_IDLE_TIMEOUT_MS` 默认 600_000）把它连坐回收，
// 子代理的结果再也取不回来。有委派工作在跑时，空闲窗口重新开始计时。
//
// **刻意不抄上游那套 artifact-mtime 扫描。** 我们的会话模型是同一个 pi 进程内的 run
// 注册表（`globalThis.__piSubagentRuns`，`lib/subagent-runtime.ts` 的
// `getSubagentRuns()`）：start / resume 时写入，终态（completed / failed / aborted）时
// 删除，所以「还在表里」就等于「还在跑」。按子会话文件的 mtime 扫目录既看不见**已排队
// 还没开始写文件**的 run，也会把**刚写完文件但已经结束**的 run 算成活着。
//
// 只读：读不到注册表、条目形状不对、没有父会话 id，一律当作「没有委派工作」，
// 绝不会抛错 —— 空闲判定读到异常就该按内存策略回收，而不是把会话永远钉住。

import type { SubagentSessionStatus } from "./types";

/**
 * 「子 run 还活着」的状态集合：已受理、还没报终态。
 * 不在集合里的都是已结束或被打断，不再占住父会话。
 * 与 `lib/subagent-status.ts` 的 `LIVE_STATUSES` 同一份口径。
 */
export const ACTIVE_SUBAGENT_STATUSES: ReadonlySet<SubagentSessionStatus> = new Set<SubagentSessionStatus>([
  "starting",
  "queued",
  "running",
]);

export interface DelegatedWorkIdentity {
  /** 会话 id；注册表里的 run 记的是 `run.parentSessionId`。 */
  sessionId?: string;
  /** 会话文件路径。目前的 run 记录不带父路径，故不参与匹配，仅为调用方少写一次解构。 */
  sessionFile?: string;
}

/** 注册表条目的最小形状：只要父会话 id 与状态，别的字段（结果、清理信息）一概不看。 */
interface DelegatedRunEntry {
  run?: Partial<{ parentSessionId: unknown; status: unknown }>;
}

/**
 * 进程内的 run 注册表。没起过子代理时它是 undefined，所以每次都现读：
 * 复制（jiti / bundler）出来的模块实例必须看到同一份表，而表本身由
 * `lib/subagent-runtime.ts` 负责创建。
 */
function getDelegatedRuns(): Map<string, DelegatedRunEntry> | null {
  const runs: unknown = globalThis.__piSubagentRuns;
  return runs instanceof Map ? (runs as Map<string, DelegatedRunEntry>) : null;
}

function isActiveRun(entry: DelegatedRunEntry | undefined): boolean {
  const status = entry?.run?.status;
  return typeof status === "string" && ACTIVE_SUBAGENT_STATUSES.has(status as SubagentSessionStatus);
}

function parentSessionIdOf(entry: DelegatedRunEntry | undefined): string | null {
  const parentSessionId = entry?.run?.parentSessionId;
  return typeof parentSessionId === "string" && parentSessionId ? parentSessionId : null;
}

/**
 * 这个会话底下还有没有活着的委派工作。
 *
 * 前台 run 也算：父轮还没结束时 `isRunning()` 已经答了，但父轮结束、子 run 还在收尾的
 * 那段窗口里，只有这里答得出来。前台/后台的区别由运行期自己保证（前台 run 随父轮中止）。
 *
 * @param session 父会话身份；`sessionId` 为空时直接答 false。
 */
export function hasDelegatedWorkRunning(session: DelegatedWorkIdentity): boolean {
  const sessionId = typeof session.sessionId === "string" ? session.sessionId : "";
  if (!sessionId) return false;
  const runs = getDelegatedRuns();
  if (!runs) return false;
  for (const entry of runs.values()) {
    if (!isActiveRun(entry)) continue;
    if (parentSessionIdOf(entry) === sessionId) return true;
  }
  return false;
}

/**
 * 所有底下还有活着的委派工作的父会话 id（去重、保持首次出现顺序）。
 * 供 `/api/agent/running` 那种「这一轮有没有在忙」的快照使用。
 */
export function listDelegatedWorkSessionIds(): string[] {
  const runs = getDelegatedRuns();
  if (!runs) return [];
  const sessionIds: string[] = [];
  const seen = new Set<string>();
  for (const entry of runs.values()) {
    if (!isActiveRun(entry)) continue;
    const parentSessionId = parentSessionIdOf(entry);
    if (!parentSessionId || seen.has(parentSessionId)) continue;
    seen.add(parentSessionId);
    sessionIds.push(parentSessionId);
  }
  return sessionIds;
}