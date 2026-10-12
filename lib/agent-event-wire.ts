import type { JsonAgentSessionEvent } from "@earendil-works/pi-coding-agent";

export interface AgentEventLike {
  type: string;
  [key: string]: unknown;
}

type JsonMessageUpdateEvent = Extract<
  JsonAgentSessionEvent,
  { type: "message_update" }
>;

type JsonAssistantMessageEvent = JsonMessageUpdateEvent["assistantMessageEvent"];
type JsonToolCallStartEvent = Extract<JsonAssistantMessageEvent, { type: "toolcall_start" }>;
type JsonToolCallDeltaEvent = Extract<JsonAssistantMessageEvent, { type: "toolcall_delta" }>;

export type ClientAssistantMessageEvent =
  | Exclude<JsonAssistantMessageEvent, { type: "toolcall_start" | "toolcall_delta" }>
  | (JsonToolCallStartEvent & { id?: string; toolName?: string })
  | (JsonToolCallDeltaEvent & { id?: string; toolName?: string });

export type ClientMessageUpdateEvent = Omit<JsonMessageUpdateEvent, "assistantMessageEvent"> & {
  assistantMessageEvent: ClientAssistantMessageEvent;
};

const OMITTED_EVENT_TYPES = new Set([
  "turn_start",
  "turn_end",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolCallMetadata(
  event: Record<string, unknown>,
): { id: string; toolName: string } | null {
  if (
    (event.type !== "toolcall_start" && event.type !== "toolcall_delta")
    || !isObject(event.partial)
  ) return null;
  const content = event.partial.content;
  const contentIndex = event.contentIndex;
  if (!Array.isArray(content) || typeof contentIndex !== "number") return null;

  const block = content[contentIndex];
  if (!isObject(block) || block.type !== "toolCall") return null;
  const id = typeof block.id === "string"
    ? block.id
    : (typeof block.toolCallId === "string" ? block.toolCallId : null);
  const toolName = typeof block.name === "string"
    ? block.name
    : (typeof block.toolName === "string" ? block.toolName : null);
  return id !== null && toolName !== null ? { id, toolName } : null;
}

/** A `message_start` / `message_end` for a transcript system message (prompt and tool loadout). */
export function isSystemMessageEvent(event: AgentEventLike): boolean {
  return (event.type === "message_start" || event.type === "message_end")
    && isObject(event.message)
    && event.message.role === "system";
}

/** Apply pi-web's event filters plus Pi 0.84's message_update projection. */
export function toClientAgentEvent(
  event: AgentEventLike,
): AgentEventLike | ClientMessageUpdateEvent | null {
  if (OMITTED_EVENT_TYPES.has(event.type)) return null;
  // Pi >= 0.86 appends the prompt and tool loadout to the transcript as system
  // messages, which the agent loop announces like any message. They carry the
  // whole prompt plus every tool schema and are never rendered, so drop them
  // before they cost the browser bandwidth.
  if (isSystemMessageEvent(event)) return null;
  // fork:upstream-0.12-infra —— 工具结果 / 投递的用户消息用 message_start + message_end
  // 背靠背宣告；浏览器只从 assistant 的 start 建气泡，其余只读 role，所以它们的 body
  // （一次图片读取的 base64）白白发了两次（#1176）。
  if (event.type === "message_start" && isObject(event.message) && event.message.role !== "assistant") {
    return { type: "message_start", message: { role: event.message.role } };
  }

  if (event.type === "message_update") {
    const assistantMessageEvent = event.assistantMessageEvent;
    if (
      typeof assistantMessageEvent !== "object"
      || assistantMessageEvent === null
      || Array.isArray(assistantMessageEvent)
    ) return null;

    if (!("partial" in assistantMessageEvent)) {
      return {
        type: "message_update",
        assistantMessageEvent,
      } as ClientMessageUpdateEvent;
    }

    const metadata = toolCallMetadata(assistantMessageEvent as Record<string, unknown>);
    const { partial: _partial, ...deltaEvent } = assistantMessageEvent;
    void _partial;
    return {
      type: "message_update",
      assistantMessageEvent: metadata ? { ...deltaEvent, ...metadata } : deltaEvent,
    } as ClientMessageUpdateEvent;
  }

  if (event.type === "tool_execution_update") {
    return {
      type: "tool_execution_update",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      partialResult: event.partialResult,
    };
  }

  if (event.type === "agent_end") return { type: "agent_end" };
  return event;
}

export function isEventIncludedInSnapshot(
  event: AgentEventLike,
  snapshot: unknown,
): boolean {
  return snapshot !== undefined
    && (event.type === "message_start" || event.type === "message_update")
    && event.message === snapshot;
}

/**
 * 这个事件被丢掉时，后面还有没有事件能修好它。`*_delta` 只是延长一个块，而它的
 * `*_end` 会用权威内容替换整个块；`tool_execution_update` 带的是整个部分结果，
 * 会被下一次 update 或 `tool_execution_end` 取代。`*_start` / `*_end` 永不丢：
 * 客户端的流式 reducer 就是靠它们创建和收尾块的。
 *
 * fork:upstream-sse-backlog — #997 移植（6b0c6a5）。
 * fork:event-seq —— 同一判据现在也用来决定**给不给序号**：可重建的增量不编号，
 * 否则背压下丢一条就制造一个假缺口。
 */
export function isDroppableEvent(event: AgentEventLike): boolean {
  if (event.type === "tool_execution_update") return true;
  if (event.type !== "message_update") return false;
  const update = event.assistantMessageEvent;
  return typeof update === "object"
    && update !== null
    && typeof (update as { type?: unknown }).type === "string"
    && (update as { type: string }).type.endsWith("_delta");
}
