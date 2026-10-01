"use client";

import type { AgentMessage, AgentUsage } from "./types";

/**
 * 「本轮」的统计口径 —— 用户裁定 2026-10-01：「这个时间我觉得应该是 ai 每轮任务的时候，
 * 就是从每轮思考一直到本轮结束的时间吧……你看像输入、输出，以及金额，不也是这么算的吗」。
 *
 * 回合结束行上的四格必须**同一个口径**，否则读起来自相矛盾：耗时只算最后一步的生成
 * （4.4s），而 token / 费用也只算那一步，于是「17k 输入 + 161 输出」配 4.4 秒。
 * 这里把口径统一成**一轮任务** = 最后一条用户消息 → 这条助手消息结束：
 *
 *   - 耗时：本轮起点（用户消息时刻；缺时刻时退回本轮第一条助手消息）→ 这条消息的完成时刻
 *     （`completedAt`，即条目落盘 / 流式 `message_end`），含期间的工具执行时间；
 *   - token：把本轮内**每一条**助手消息的 input / output / cacheRead / cacheWrite 累加
 *     （`↑` 仍是「真的送进去的 prompt」= 三项之和，口径与单步一致）；
 *   - 费用：本轮内所有 `cost.total` 求和（0 = 免费 / 没上报价格，那一格不画）。
 *
 * 一次前向扫描给每个助手消息下标一份快照：回合结束行只读自己那一份，不用重算。
 */
export interface TurnStats {
  /** 本轮起点（ms）。null = 没有可用的时间戳。 */
  startTs: number | null;
  /** 这条消息的完成时刻（ms）。 */
  endTs: number | null;
  /** 本轮已耗时（秒）。null = 没有可用的时间戳。 */
  elapsedSec: number | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** 本轮费用合计。0 = 免费 / 上游没报价格（回合结束行据此不画金额格）。 */
  cost: number;
  /** 本轮内助手消息条数（诊断用；>= 2 说明这一轮跑过多步）。 */
  steps: number;
}

function emptyStats(startTs: number | null): TurnStats {
  return {
    startTs,
    endTs: null,
    elapsedSec: null,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    steps: 0,
  };
}

function addUsage(stats: TurnStats, usage: AgentUsage | undefined): void {
  if (!usage) return;
  stats.input += usage.input ?? 0;
  stats.output += usage.output ?? 0;
  stats.cacheRead += usage.cacheRead ?? 0;
  stats.cacheWrite += usage.cacheWrite ?? 0;
  if (usage.cost && typeof usage.cost.total === "number") stats.cost += usage.cost.total;
  stats.steps += 1;
}

/**
 * 一轮任务的累计统计：`Map<助手消息下标, 快照>`。
 *
 * 只有助手消息进表（回合结束行只挂在助手消息上）。用户消息开新一轮；会话开头若先遇到
 * 助手消息，用它的 `timestamp` 当本轮起点（页面重载、老会话缺用户消息时刻时的兜底）。
 */
export function computeTurnStats(messages: readonly AgentMessage[]): Map<number, TurnStats> {
  const out = new Map<number, TurnStats>();
  let current: TurnStats | null = null;
  let lastUserTs: number | null = null;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const timestamp = message.timestamp;
    const completedAt = (message as { completedAt?: number }).completedAt;

    if (message.role === "user") {
      current = null;
      // 时刻为 0（1970 / 测试夹具）也是有效值，所以用 undefined 判定而不是真值。
      if (timestamp !== undefined) lastUserTs = timestamp;
      continue;
    }
    if (message.role !== "assistant") continue;

    // 本轮起点：用户消息的时刻；会话开头没有用户消息（或缺时刻）时退回本轮第一条助手消息。
    if (!current) current = emptyStats(lastUserTs ?? timestamp ?? null);
    addUsage(current, message.usage);

    if (completedAt !== undefined) {
      current.endTs = completedAt;
      if (current.startTs !== null) {
        current.elapsedSec = Math.max(0, (completedAt - current.startTs) / 1000);
      }
    } else if (current.endTs === null && timestamp !== undefined) {
      // 还没落盘（流式中的那条）：进度只能到它自己的 timestamp。
      current.endTs = timestamp;
    }
    // 快照必须是副本：下一条消息继续往 current 上累加。
    out.set(i, { ...current });
  }
  return out;
}
