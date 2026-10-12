// fork:event-seq — 会话级事件序号 + 有界重放缓冲。
//
// 问题：SSE 事件没有序号。断线重连时服务端只会重发 `connected` + 流式消息快照，
// 于是「断线期间**已经跑完**的工具调用」在客户端永远不出现，直到这一轮结束
// （`agent_end`/`agent_settled` 会 `loadSession()` 重新读文件）才补上。
// 长时间多工具的一轮 + 中途息屏/切网，界面就会一直缺内容。
//
// 做法照 XTLaw 的 run_events：每条**权威事件**带一个会话内单调递增的 `seq`，
// 客户端重连时把 `lastEventId` 带回来，服务端从缓冲里补发 `seq > lastEventId`。
//
// 什么事件有 seq：**权威事件**（message_start/end、tool_execution_start/end、
// agent_end、prompt_done、审批……）。可重建的增量（`*_delta`、
// `tool_execution_update`）**不带 seq**：它们会在背压下被丢掉（见
// `agent-event-stream.ts` 的水位逻辑），给它们编号只会制造假缺口，而它们的
// `*_end` 会带权威内容补回来。
//
// 缓冲有界：超过条数或字节就丢最老的，`replayAfter()` 会如实回报 `complete: false`，
// 调用方退回「重发快照」那条既有通路 —— 缺的只是更早的事件，不是当前状态。

import type { AgentEventLike } from "./agent-event-wire";
import { isDroppableEvent, toClientAgentEvent } from "./agent-event-wire";

export interface SequencedAgentEvent {
  seq: number;
  event: AgentEventLike;
  /** 已经序列化好的 SSE `data:` 负载（含 `seq`），避免在流里再 stringify 一次。 */
  text: string;
}

/**
 * 交给 SSE 流的一条客户端事件。
 * - `seq` 为数字：**权威事件**，已编号、可重放，`text` 是现成的负载。
 * - `seq` 为 null：可重建的增量（delta / tool_execution_update），或
 *   `onClientEvent` 重放的待决请求 —— 不编号，也不参与缺口判定。
 */
export type ClientAgentEvent =
  | { seq: number; event: AgentEventLike; text: string; messageRef?: unknown }
  | { seq: null; event: AgentEventLike; messageRef?: unknown };

export interface ReplayResult {
  events: SequencedAgentEvent[];
  /** false = 缓冲已经滚过请求位置，只能退回快照。 */
  complete: boolean;
}

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

export class AgentEventLog {
  private nextSeq = 1;
  private entries: SequencedAgentEvent[] = [];
  private bytes = 0;

  constructor(
    private readonly options: { maxEntries?: number; maxBytes?: number } = {},
  ) {}

  /** 最后一条已记录事件的序号；没有任何事件时为 0。 */
  get currentSeq(): number {
    return this.nextSeq - 1;
  }

  record(event: AgentEventLike): SequencedAgentEvent {
    const seq = this.nextSeq;
    this.nextSeq += 1;
    const entry: SequencedAgentEvent = {
      seq,
      event,
      text: JSON.stringify({ ...event, seq }),
    };
    this.entries.push(entry);
    this.bytes += entry.text.length;
    this.evict();
    return entry;
  }

  /**
   * `seq > afterSeq` 的事件。
   *
   * - `afterSeq >= currentSeq` → 没有漏，空数组 + complete。
   * - 缓冲最老一条 > `afterSeq + 1` → 中间断档，`complete: false`。
   */
  replayAfter(afterSeq: number): ReplayResult {
    if (!Number.isFinite(afterSeq) || afterSeq >= this.currentSeq) {
      return { events: [], complete: true };
    }
    const oldest = this.entries[0]?.seq;
    if (oldest === undefined || oldest > afterSeq + 1) {
      return { events: [], complete: false };
    }
    return { events: this.entries.filter((entry) => entry.seq > afterSeq), complete: true };
  }

  private evict(): void {
    const maxEntries = this.options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const maxBytes = this.options.maxBytes ?? DEFAULT_MAX_BYTES;
    while (
      this.entries.length > 0
      && (this.entries.length > maxEntries || this.bytes > maxBytes)
    ) {
      const dropped = this.entries.shift();
      if (dropped) this.bytes -= dropped.text.length;
    }
  }
}

/**
 * 把一条原始 agent 事件变成交给 SSE 流的那份形态：
 * - 投影成客户端事件（`toClientAgentEvent`），不可见事件返回 null；
 * - 权威事件记入日志、拿到序号与现成负载；可重建增量不编号。
 *
 * 注意 `messageRef`：投影会丢掉 `message`（那是每帧都在长的正文），而快照去重靠的
 * 正是它与 `streamingMessage` 的引用相等，所以把引用单独带过去。
 */
export function createClientAgentEvent(
  event: AgentEventLike,
  log: AgentEventLog,
): ClientAgentEvent | null {
  const projected = toClientAgentEvent(event);
  if (!projected) return null;
  const messageRef = (event.type === "message_start" || event.type === "message_update")
    ? event.message
    : undefined;
  return isDroppableEvent(projected)
    ? { seq: null, event: projected, messageRef }
    : { ...log.record(projected), messageRef };
}
