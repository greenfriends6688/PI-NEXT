// The chat's state: the messages of the open session (read from the session
// file) and the agent's live event stream folded into signals.
//
// This replaces pi's `hooks/useAgentSession.ts` for the chat pane only: the
// same event names, the same reducer (`lib/streaming-message.ts`), and the same
// store shape, but signals instead of React state (TSX "Signals and writes":
// module-level signals are the app's store). The components read them in
// bindings; nothing here renders.
//
// Sources, both read before writing this:
//   pi/hooks/useAgentSession.ts:1764-2070   the event switch
//   pi/lib/streaming-message.ts              the streaming reducer (start /
//                                            snapshot / delta / end)
//   pi/lib/agent-event-wire.ts:1-217         the events' payloads, which the
//                                            server already projects
//   app-nsh/src/api/types.ts                 what is really on the wire

import { batch, computed, signal, untracked } from "nsh";
import { agentState, openAgentEvents, sendCommand } from "../api/agent";
import type { AgentEvent, ExtensionUiRequest, SessionView } from "../api/types";
import { carryMessageKeys, messageRenderKeys } from "../lib/message-keys";
import { normalizeStreamingToolCalls, normalizeToolCalls } from "../lib/normalize";
import { userMessageKey } from "../lib/prompt-recovery";
import { withTranscriptNotices, type TranscriptNotice } from "../lib/transcript-notices";
import type {
  AgentMessage,
  AssistantContentBlock,
  AssistantMessage,
  CustomMessage,
  ToolResultMessage,
} from "../lib/types";

// --- the wire's deltas ------------------------------------------------------

/**
 * One step of a streamed assistant message (`message_update.assistantMessageEvent`
 * after the server's projection, `lib/agent-event-wire.ts:170-217`). The wire
 * keeps the payload loose (`AgentEvent`), so this is what the reducer reads and
 * checks at run time rather than a strict union of pi's own types.
 */
export interface AssistantDeltaEvent {
  type: string;
  contentIndex?: number;
  /** `text_delta` / `thinking_delta` / `toolcall_delta`. */
  delta?: string;
  /** `text_end` / `thinking_end`: the block's whole text. */
  content?: unknown;
  /** `toolcall_*`: the call's id and name, projected in from `partial` for the starts and deltas. */
  id?: string;
  toolName?: string;
  /** `toolcall_end`. */
  toolCall?: { id?: string; name?: string; arguments?: unknown };
}

// --- the agent's UI state ---------------------------------------------------

/** One tool a run is executing, as the working line lists it. */
export interface RunningTool {
  id: string;
  name: string;
}

/** What the agent is doing between the model's calls (`waiting_model`) and while tools run. */
export type AgentPhase = { kind: "waiting_model" } | { kind: "running_tools"; tools: RunningTool[] } | null;

/** A retry the provider is doing on its own (`auto_retry_start`). */
export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  errorMessage?: string;
}

/** A line the chat shows about the session itself, not the model. */
export interface ChatNotice {
  id: number;
  kind: "error" | "info";
  text: string;
}

/** The messages of the open session, in transcript order. */
export const messages = signal<AgentMessage[]>([]);

/** Parallel to `messages`: the session entry id of each (empty for one added during a run). */
export const entryIds = signal<string[]>([]);

/**
 * Entry id → render key, so a message added during a run keeps its key when the
 * file is read again (`lib/message-keys.ts`). Not read by components: the rows
 * carry the resolved key.
 */
const keyAliases = signal<ReadonlyMap<string, string>>(new Map());

/** The reply being written, or null. Kept apart from `messages` until its `message_end`. */
export const streamingMessage = signal<AssistantMessage | null>(null);

/** A run is going (`agent_start` … `agent_settled` / `prompt_done`). */
export const agentRunning = signal(false);

/** What the run is doing right now, for the working line. */
export const agentPhase = signal<AgentPhase>(null);

/** Live output of the tools still running, by tool call id (`tool_execution_update`). */
export const activeToolResults = signal<ReadonlyMap<string, ToolResultMessage>>(new Map());

/** Prompts queued in pi: a steer or a follow-up the run has not taken yet. */
export const queuedMessages = signal<{ steering: string[]; followUp: string[] }>({ steering: [], followUp: [] });

/** The provider's automatic retry, while it waits. */
export const retryInfo = signal<RetryInfo | null>(null);

/** A compaction is running. */
export const compacting = signal(false);

/** Why a compaction failed, until the next one. */
export const compactError = signal<string | null>(null);

/** Errors about the session, newest last; the chat shows them above the list. */
export const notices = signal<ChatNotice[]>([]);

/** Extension dialogs the server still holds, newest last (another pane answers them). */
export const extensionUi = signal<ExtensionUiRequest[]>([]);

/**
 * Bumped when the chat should read the session again: a (re)connection, the end
 * of a run, a finished compaction. `ChatView` keeps it in its load source, so a
 * bump is one `readSession` — the file is the truth after a stream.
 */
export const reloadGeneration = signal(0);

/** The session everything above belongs to; null before one is opened. */
export const agentSessionId = signal<string | null>(null);

/** Thinking blocks the reader opened, by block key. Kept here: list rows are recycled. */
export const openThinking = signal<Record<string, boolean>>({});

/** Tool cards the reader opened, by block key. */
export const openToolCalls = signal<Record<string, boolean>>({});

/** A turn's folded process group, by block key. */
export const openProcess = signal<Record<string, boolean>>({});

/**
 * One render key per message: its entry id, or a live key for a message added
 * during a run (`lib/message-keys.ts`, pi's #1184). A list row keeps its key
 * across the read that lands, so an open tool card and a scrolled prompt stay.
 */
export const messageKeys = computed(() => messageRenderKeys(entryIds(), messages().length, keyAliases()));

/** Appends a notice; the chat drops the oldest past a dozen so a broken run cannot fill the screen. */
export function addNotice(kind: ChatNotice["kind"], text: string): void {
  const id = noticeIds++;
  notices.update((list) => [...list, { id, kind, text }].slice(-12));
}

let noticeIds = 1;

/** Closes one notice (the chat's dismiss). */
export function dismissNotice(id: number): void {
  notices.update((list) => list.filter((notice) => notice.id !== id));
}

export function toggleThinking(key: string): void {
  openThinking.update((open) => ({ ...open, [key]: !open[key] }));
}

export function toggleToolCall(key: string): void {
  openToolCalls.update((open) => ({ ...open, [key]: !open[key] }));
}

export function toggleProcess(key: string): void {
  openProcess.update((open) => ({ ...open, [key]: !open[key] }));
}

/** Asks `ChatView` to read the session again (see `reloadGeneration`). */
export function requestReload(): void {
  reloadGeneration.update((generation) => generation + 1);
}

// --- the session's messages -------------------------------------------------

/**
 * Adopts a `readSession` answer. Keys are carried over from the live messages
 * (`carryMessageKeys`) so a message added during a run, or a page loaded at the
 * top, keeps its row — and with it the open thinking block and tool card.
 */
export function applySessionView(view: SessionView): void {
  // The wire's message type and `lib/types.ts` are the same shape, field for
  // field (api/types.ts quotes the server's `lib/types.ts`); the cast is the
  // boundary between the two copies, nothing more.
  const next = (view.context.messages ?? []) as AgentMessage[];
  const nextIds = view.context.entryIds ?? [];
  // Untracked: this runs in an effect, and the messages it reads are the ones
  // it writes — a tracked read would make that effect change what it reads.
  const aliases = untracked(() => carryMessageKeys(
    { messages: messages(), entryIds: entryIds(), aliases: keyAliases() },
    { messages: next, entryIds: nextIds },
  ));
  batch(() => {
    keyAliases.set(aliases);
    messages.set(next);
    entryIds.set(nextIds);
  });
}

/**
 * Adds a message the app has but the session file does not yet — the prompt the
 * composer just sent. Its `message_end` then matches it (`sameMessage`) and
 * leaves the bubble where it is.
 */
export function appendLocalMessage(message: AgentMessage): void {
  appendMessage(message);
}

/** Two messages that say the same thing: role, plus who said what. */
function sameMessage(a: AgentMessage, b: AgentMessage): boolean {
  if (a.role !== b.role) return false;
  if (a.role === "user") return userMessageKey(a) === userMessageKey(b);
  if (a.role === "custom") {
    return a.customType === (b as CustomMessage).customType && a.timestamp === b.timestamp;
  }
  const left = a.timestamp;
  return left !== undefined && left === (b as { timestamp?: number }).timestamp;
}

/**
 * Appends a message a stream delivered, unless the list already ends with it: a
 * reconnect replays `message_end` for messages the session read already brought
 * in, and appending those again would double every reply of the run.
 */
function appendMessage(message: AgentMessage): void {
  const list = messages();
  for (let index = list.length - 1; index >= 0 && index >= list.length - 4; index--) {
    if (sameMessage(list[index], message)) return;
  }
  messages.set([...list, message]);
}

/** Drops every message and every live value: another session was opened, or a run ended. */
export function resetChatState(): void {
  batch(() => {
    messages.set([]);
    entryIds.set([]);
    keyAliases.set(new Map());
    extensionUi.set([]);
    notices.set([]);
    clearStream();
    resetRunState();
  });
}

function clearStream(): void {
  streamingMessage.set(null);
}

function resetRunState(): void {
  batch(() => {
    agentRunning.set(false);
    agentPhase.set(null);
    activeToolResults.set(new Map());
    queuedMessages.set({ steering: [], followUp: [] });
    retryInfo.set(null);
    compacting.set(false);
    compactError.set(null);
  });
}

// --- the streaming reducer (pi lib/streaming-message.ts) --------------------

function withContentBlock(
  message: AssistantMessage,
  contentIndex: number,
  update: (block: AssistantContentBlock | undefined) => AssistantContentBlock | null,
): AssistantMessage | null {
  if (!Number.isInteger(contentIndex) || contentIndex < 0) return null;
  const content = [...(message.content ?? [])];
  const block = update(content[contentIndex]);
  if (!block) return null;
  content[contentIndex] = block;
  return { ...message, content };
}

/** One step of the reply being written. A step this reducer does not know is dropped. */
function applyDelta(event: AssistantDeltaEvent): void {
  const message = streamingMessage();
  if (!message) return;
  const index = typeof event.contentIndex === "number" ? event.contentIndex : -1;
  const delta = typeof event.delta === "string" ? event.delta : "";
  let next: AssistantMessage | null = null;
  switch (event.type) {
    case "text_start":
      // pi's `partial` carries the block's first delta by the time a start is
      // read, so a start resets the block instead of keeping that text: else
      // the first chunk shows twice until `text_end`.
      next = withContentBlock(message, index, () => ({ type: "text", text: "" }));
      break;
    case "text_delta":
      next = withContentBlock(message, index, (current) => (
        current?.type === "text" ? { ...current, text: current.text + delta } : null
      ));
      break;
    case "text_end":
      next = withContentBlock(message, index, (current) => ({
        ...(current?.type === "text" ? current : {}),
        type: "text",
        text: typeof event.content === "string" ? event.content : "",
      }));
      break;
    case "thinking_start":
      next = withContentBlock(message, index, () => ({ type: "thinking", thinking: "" }));
      break;
    case "thinking_delta":
      next = withContentBlock(message, index, (current) => (
        current?.type === "thinking" ? { ...current, thinking: current.thinking + delta } : null
      ));
      break;
    case "thinking_end":
      next = withContentBlock(message, index, (current) => ({
        ...(current?.type === "thinking" ? current : {}),
        type: "thinking",
        thinking: typeof event.content === "string" ? event.content : "",
      }));
      break;
    case "toolcall_start":
      next = withContentBlock(message, index, (current) => {
        if (current?.type === "toolCall") {
          // The deltas rebuild `rawInput`, so a start clears it (same leak as text_start).
          return {
            ...current,
            toolCallId: event.id ?? current.toolCallId,
            toolName: event.toolName ?? current.toolName,
            rawInput: "",
          };
        }
        if (typeof event.toolName !== "string") return null;
        return { type: "toolCall", toolCallId: event.id ?? "", toolName: event.toolName, input: {}, rawInput: "" };
      });
      break;
    case "toolcall_delta":
      next = withContentBlock(message, index, (current) => (
        current?.type === "toolCall"
          ? {
            ...current,
            toolCallId: event.id || current.toolCallId,
            toolName: event.toolName || current.toolName,
            rawInput: (current.rawInput ?? "") + delta,
          }
          : null
      ));
      break;
    case "toolcall_end": {
      const call = event.toolCall ?? {};
      next = withContentBlock(message, index, () => ({
        type: "toolCall",
        toolCallId: typeof call.id === "string" ? call.id : "",
        toolName: typeof call.name === "string" ? call.name : "",
        input: call.arguments !== null && typeof call.arguments === "object" && !Array.isArray(call.arguments)
          ? call.arguments as Record<string, unknown>
          : {},
      }));
      break;
    }
  }
  if (next) streamingMessage.set(next);
}

/** `message_start` of an assistant message: the reply's first snapshot. */
function applySnapshot(event: AgentEvent): void {
  const raw = event.message as AgentMessage | undefined;
  if (!raw || raw.role !== "assistant") return;
  const message = normalizeStreamingToolCalls(raw) as AssistantMessage;
  streamingMessage.set({ ...message, content: message.content ?? [] });
  if ((message.content ?? []).length > 0) agentPhase.set(null);
}

// --- the event switch (pi useAgentSession.ts:1764-2070) --------------------

function sameText(list: readonly string[], next: readonly string[]): boolean {
  return list.length === next.length && list.every((value, index) => value === next[index]);
}

/**
 * Asks the server what the session is doing and folds the answer in: the one
 * thing a stream cannot promise is that it delivered everything (`connected`
 * says only what is true now). Errors are left to the next event.
 */
async function reconcileAgentState(sessionId: string): Promise<void> {
  const response = await agentState(sessionId, { systemPrompt: false }).catch(() => null);
  if (!response) return;
  // Another session opened while this was on its way.
  if (agentSessionId() !== sessionId) return;
  const state = response.running ? response.state : undefined;
  if (!state) {
    // No runtime wrapper any more: nothing of the last run is live.
    batch(() => {
      agentRunning.set(false);
      agentPhase.set(null);
      retryInfo.set(null);
      compacting.set(false);
      clearStream();
    });
    return;
  }
  const busy = state.isStreaming === true || state.isPromptRunning === true || state.isCompacting === true;
  batch(() => {
    agentRunning.set(busy);
    if (!busy) agentPhase.set(null);
    else if (state.isStreaming !== true) agentPhase.set({ kind: "waiting_model" });
    if (state.isCompacting !== undefined) compacting.set(state.isCompacting === true);
    if (!busy) clearStream();
    const queued = state.queuedMessages;
    if (queued !== undefined) {
      const steering = Array.isArray(queued?.steering) ? queued.steering : [];
      const followUp = Array.isArray(queued?.followUp) ? queued.followUp : [];
      const current = queuedMessages();
      if (!sameText(current.steering, steering) || !sameText(current.followUp, followUp)) {
        queuedMessages.set({ steering: [...steering], followUp: [...followUp] });
      }
    }
  });
}

/**
 * Folds one agent event into the state. `agentEventsPath`'s stream is already
 * filtered (heartbeats dropped by `openAgentEvents`, `turn_start` / `turn_end` /
 * `entry_appended` and transcript system messages by the server), so every name
 * here is one pi's chat keeps.
 */
export function applyAgentEvent(event: AgentEvent): void {
  switch (event.type) {
    case "connected": {
      const sessionId = typeof event.sessionId === "string" ? event.sessionId : agentSessionId();
      if (Array.isArray(event.pendingExtensionUiIds)) {
        // The server replays what it still holds right after this event, so a
        // dialog closed while the stream was down goes now.
        const pending = new Set(event.pendingExtensionUiIds as string[]);
        extensionUi.update((list) => list.filter((request) => pending.has(request.id)));
      }
      batch(() => {
        if (event.isStreaming === true) {
          agentRunning.set(true);
          agentPhase.set({ kind: "waiting_model" });
          // The server replays the calls still running; one that ended while the
          // stream was down must not stay listed.
          activeToolResults.set(new Map());
        }
        // Events may have been missed while the stream was down (`connected` is
        // the first event of every connection, reconnections too): the file is
        // the truth, and the state read below says what is running now.
        requestReload();
      });
      if (sessionId) void reconcileAgentState(sessionId);
      return;
    }
    case "agent_start":
      batch(() => {
        agentRunning.set(true);
        agentPhase.set({ kind: "waiting_model" });
        retryInfo.set(null);
        clearStream();
      });
      return;
    case "agent_end":
      // One prompt can emit several of these (a retry, a compaction, queued
      // messages); the stream stays open until `prompt_done` / `agent_settled`.
      batch(() => {
        agentPhase.set(null);
        retryInfo.set(null);
      });
      // The run wrote its messages to the file: read it rather than keeping the
      // live copies (pi's `loadSession` at agent_end).
      requestReload();
      return;
    case "agent_settled":
      batch(() => {
        agentRunning.set(false);
        compacting.set(false);
        agentPhase.set(null);
      });
      requestReload();
      return;
    case "prompt_done":
      batch(() => {
        agentRunning.set(false);
        agentPhase.set(null);
      });
      requestReload();
      return;
    case "prompt_error":
      addNotice("error", typeof event.errorMessage === "string" ? event.errorMessage : "The command failed");
      return;
    case "extension_error":
      addNotice("error", typeof event.error === "string" ? event.error : "An extension failed");
      return;
    case "startup_error":
      addNotice("error", typeof event.errorMessage === "string" ? event.errorMessage : "The agent did not start");
      return;
    case "message_start": {
      const message = event.message as AgentMessage | undefined;
      // A prompt is already in the list (sent, or delivered by its own
      // `message_end`), and a non-assistant start carries the role only.
      if (message?.role === "user") return;
      if (message?.role === "assistant") applySnapshot(event);
      else agentPhase.set(null);
      return;
    }
    case "message_update": {
      const delta = event.assistantMessageEvent as AssistantDeltaEvent | undefined;
      if (!delta) return;
      applyDelta(delta);
      if (delta.type !== "toolcall_start" && delta.type !== "toolcall_delta") agentPhase.set(null);
      return;
    }
    case "message_end": {
      const completed = event.message as AgentMessage | undefined;
      if (!completed) return;
      if (completed.role === "user") {
        // A steering or follow-up prompt the run took; the run's own prompt is
        // already the list's last user message, which `appendMessage` keeps.
        appendMessage(normalizeToolCalls(completed));
      } else {
        const listed = Array.isArray(event.transcriptNotices) ? event.transcriptNotices as TranscriptNotice[] : undefined;
        appendMessage(withTranscriptNotices(normalizeToolCalls(completed), listed));
      }
      batch(() => {
        clearStream();
        agentPhase.set({ kind: "waiting_model" });
      });
      return;
    }
    case "tool_execution_start": {
      if (isNestedTool(event)) return;
      const tool = runningTool(event);
      if (!tool) return;
      agentPhase.update((phase) => {
        const tools = phase?.kind === "running_tools" ? [...phase.tools] : [];
        if (!tools.some((entry) => entry.id === tool.id)) tools.push(tool);
        return { kind: "running_tools", tools };
      });
      return;
    }
    case "tool_execution_update": {
      if (isNestedTool(event)) return;
      const tool = runningTool(event);
      const partial = event.partialResult as ToolResultMessage | undefined;
      // Live output for a shell (and a codemode script's calls so far); other
      // tools only say they are still running.
      if (tool && (tool.name === "bash" || tool.name === "powershell" || tool.name === "codemode") && Array.isArray(partial?.content)) {
        activeToolResults.update((results) => {
          const next = new Map(results);
          next.set(tool.id, {
            role: "toolResult",
            toolCallId: tool.id,
            toolName: tool.name,
            content: partial!.content,
            isError: partial?.isError,
            details: partial?.details,
          });
          return next;
        });
      }
      if (!tool) return;
      agentPhase.update((phase) => {
        const tools = phase?.kind === "running_tools" ? [...phase.tools] : [];
        const known = tools.some((entry) => entry.id === tool.id);
        return {
          kind: "running_tools",
          tools: known ? tools.map((entry) => (entry.id === tool.id ? tool : entry)) : [...tools, tool],
        };
      });
      return;
    }
    case "tool_execution_end": {
      if (isNestedTool(event)) return;
      const id = typeof event.toolCallId === "string" ? event.toolCallId : "";
      if (!id) return;
      activeToolResults.update((results) => {
        if (!results.has(id)) return results;
        const next = new Map(results);
        next.delete(id);
        return next;
      });
      agentPhase.update((phase) => {
        if (phase?.kind !== "running_tools") return phase;
        const tools = phase.tools.filter((tool) => tool.id !== id);
        return tools.length === 0 ? { kind: "waiting_model" } : { kind: "running_tools", tools };
      });
      return;
    }
    case "queue_update": {
      const steering = Array.isArray(event.steering) ? event.steering as string[] : [];
      const followUp = Array.isArray(event.followUp) ? event.followUp as string[] : [];
      const current = queuedMessages();
      // A new array on every event would re-render the working line for nothing.
      if (sameText(current.steering, steering) && sameText(current.followUp, followUp)) return;
      queuedMessages.set({ steering: [...steering], followUp: [...followUp] });
      return;
    }
    case "auto_retry_start":
      retryInfo.set({
        attempt: typeof event.attempt === "number" ? event.attempt : 1,
        maxAttempts: typeof event.maxAttempts === "number" ? event.maxAttempts : 1,
        errorMessage: typeof event.errorMessage === "string" ? event.errorMessage : undefined,
      });
      return;
    case "auto_retry_end":
      retryInfo.set(null);
      return;
    case "auto_compaction_start":
    case "compaction_start":
      batch(() => {
        compacting.set(true);
        compactError.set(null);
      });
      return;
    case "auto_compaction_end":
    case "compaction_end": {
      const message = typeof event.errorMessage === "string" ? event.errorMessage : null;
      batch(() => {
        compacting.set(false);
        compactError.set(message);
      });
      if (!message && event.aborted !== true) requestReload();
      return;
    }
    case "extension_ui_request": {
      const request = event as unknown as ExtensionUiRequest;
      if (typeof request.id !== "string") return;
      extensionUi.update((list) => [...list.filter((entry) => entry.id !== request.id), request]);
      return;
    }
    case "extension_ui_closed": {
      const id = typeof event.id === "string" ? event.id : "";
      if (id) extensionUi.update((list) => list.filter((entry) => entry.id !== id));
      return;
    }
    case "session_shutdown":
      resetChatState();
      return;
    default:
      // `heartbeat` never reaches here (`openAgentEvents` drops it). Anything
      // else the server adds later is unknown to this UI and ignored.
      return;
  }
}

/** A call another tool made while it ran (a codemode script's): its parent's card shows it. */
function isNestedTool(event: AgentEvent): boolean {
  return typeof event.parentToolCallId === "string" && event.parentToolCallId !== "";
}

function runningTool(event: AgentEvent): RunningTool | null {
  const id = typeof event.toolCallId === "string" ? event.toolCallId : "";
  if (!id) return null;
  return { id, name: typeof event.toolName === "string" ? event.toolName : "tool" };
}

// --- the stream and the commands -------------------------------------------

/**
 * Subscribes to the session's agent stream from now on; the returned function
 * closes it. Reconnection (backoff, staleness) is `api/sse.ts`'s, and every
 * reconnect starts with `connected`, which is what re-reads the session.
 */
export function connectAgentSession(sessionId: string): () => void {
  agentSessionId.set(sessionId);
  return openAgentEvents(sessionId, applyAgentEvent, { holder: "nsh-chat" });
}

/**
 * Answers an extension's dialog. The request leaves the queue here, as pi does
 * whether the send works or not (the server's own timer closes it too).
 */
export async function respondToExtensionUi(
  requestId: string,
  response: { value: string } | { confirmed: boolean } | { cancelled: true },
): Promise<void> {
  const sessionId = agentSessionId();
  extensionUi.update((list) => list.filter((entry) => entry.id !== requestId));
  if (!sessionId) return;
  await sendCommand(sessionId, { type: "extension_ui_response", id: requestId, ...response });
}

/** Sends one command to the open session (`prompt`, `abort`, `compact`, …). */
export function sendAgentCommand<T = unknown>(command: { type: string; [key: string]: unknown }): Promise<T> {
  const sessionId = agentSessionId();
  if (!sessionId) return Promise.reject(new Error("No session is open"));
  return sendCommand<T>(sessionId, command);
}
