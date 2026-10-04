/**
 * lib/turn-observability.ts — fork:per-turn-observability
 *
 * 把每一轮的耗时 / token / 成本 / 工具调用**落盘**，让「上周那次卡在哪」这类问题
 * 有据可查。
 *
 * ## 为什么现在做不到
 *
 * `lib/turn-stats.ts`（103 行）算的是**当前这一轮**，只活在内存里：页面一关就没了，
 * 而且它挂在 `ChatWindow` 上，看历史会话时拿不到。
 *
 * ZCode 有三张表（`packages/services/src/session-store/migrations.ts:392-517`）：
 * `model_usage` / `turn_usage` / `tool_usage`，每轮每工具都落一行，带
 * TTFT、重试次数、错误码、`cancelled_by_user`、`context_exceeded`。
 *
 * ## 本次做到哪
 *
 * **一张表、一轮一行**：`~/.pi/agent/pi-web/turns.jsonl`（append-only JSONL）。
 * 只记已经算得出来的东西（耗时 / token / 成本 / 工具调用数 / 成功失败），
 * **不**记错误码与重试 —— 那些要从 pi 的事件流里再挖一遍，而 `turn-stats` 拿不到，
 * 与其记一堆永远是 null 的列，不如先落能落对的。
 *
 * 为什么用 JSONL 而不是 SQLite：ZCode 用 SQLite 是因为它要跨进程 + 要按日聚合；
 * 我们只是**写一条读一条**，而且本仓的 `lib/usage-stats.ts` 已经证明了
 * 「扫 jsonl + 指纹缓存」这条路走得通（`USAGE_CACHE_VERSION` 那一套）。
 *
 * append-only 的代价要说清：文件只增不减，且**没有**删改 API。真要按时间窗聚合时，
 * 沿用 `lib/usage-stats.ts` 的 `(size, mtimeMs)` 缓存失效法即可。
 */

import { mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** 一轮的观测记录。字段全可选 —— 缺就是「这次没上报」，不是「值为 0」。 */
export interface TurnObservation {
  /** 会话 id。没有会话（新会话还没落盘）就不记。 */
  sessionId: string;
  /** 会话文件里的消息 id，定位这一轮用。 */
  entryId?: string;
  /** 本轮起点（epoch ms）。 */
  startedAt?: number;
  /** 本轮结束（epoch ms）。 */
  endedAt?: number;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  /** 本轮成本合计；0 = 免费或没上报价格，两者在本仓是同一件事（沿用 turn-stats 的口径）。 */
  cost?: number;
  /** 本轮工具调用次数。 */
  toolCalls?: number;
  /** 工具失败次数。 */
  toolErrors?: number;
  /** 用户主动停掉的（stopAgent）—— 与「跑完」要能分开看。 */
  stopped?: boolean;
}

/** 落盘格式版本。读的时候对不上就整份忽略，而不是猜。 */
export const TURN_LOG_VERSION = 1;

export interface TurnLogRow extends TurnObservation {
  v: number;
}

/** 一行最多记这么多字符（snippet 之类），防一行撑爆文件。 */
const MAX_LINE_CHARS = 4096;

/** 纯函数：把一次观测整成一行 JSON（不含换行）。不合格返回 null。 */
export function serializeTurnObservation(observation: TurnObservation): string | null {
  const sessionId = observation.sessionId?.trim();
  // 没有会话 id 的记录无法归属，丢掉 —— 宁可少记，不要写一堆孤儿行。
  if (!sessionId) return null;
  const row: Record<string, unknown> = { v: TURN_LOG_VERSION, sessionId };
  // 逐个复制而不是 spread：观测对象可能带着 UI 状态之类不该落盘的东西。
  for (const key of ["entryId", "startedAt", "endedAt", "input", "output", "cacheRead",
    "cacheWrite", "cost", "toolCalls", "toolErrors", "stopped"] as const) {
    const value = observation[key];
    if (value === undefined) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    row[key] = value;
  }
  const line = JSON.stringify(row);
  return line.length <= MAX_LINE_CHARS ? line : null;
}

/** 解析一行。坏行返回 null —— 一行坏数据不该让整份日志读不出来。 */
export function parseTurnLogLine(raw: string): TurnLogRow | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (record.v !== TURN_LOG_VERSION) return null;
    if (typeof record.sessionId !== "string" || !record.sessionId) return null;
    // 经 unknown 再转：JSON.parse 的产物与具体接口没有结构重叠，
    // 直接断言 TS 会拒绝（而这里要的正是「相信磁盘上的形状，交给调用方读字段」）。
    return record as unknown as TurnLogRow;
  } catch {
    return null;
  }
}

/** 默认落盘位置。与 usage 的缓存同一个 agent 目录树下，但**另一个文件**。 */
export function turnLogPath(agentDir: string): string {
  return join(agentDir, "pi-web", "turns.jsonl");
}

/**
 * 读回某一会话的全部观测（时间升序）。
 *
 * 上限是为了防「一个几千轮的长会话把内存吃光」—— 真要看全量的场合应该去 grep
 * 文件，这里给的是面板/诊断用的窗口。
 */
export function readTurnObservations(
  path: string,
  sessionId: string,
  limit = 200,
): TurnLogRow[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: TurnLogRow[] = [];
  for (const line of raw.split("\n")) {
    const row = parseTurnLogLine(line);
    if (row && row.sessionId === sessionId) out.push(row);
  }
  out.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  return limit > 0 && out.length > limit ? out.slice(out.length - limit) : out;
}

/** 追加一行。返回是否真的写进去了（不合格的观测返回 false，且不留半行）。 */
export function appendTurnObservation(path: string, observation: TurnObservation): boolean {
  const line = serializeTurnObservation(observation);
  if (!line) return false;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    appendFileSync(path, `${line}\n`, { mode: 0o600 });
    return true;
  } catch {
    // 写不进去就当没记。观测是**旁路**，不能因为它失败而让一轮对话失败。
    return false;
  }
}