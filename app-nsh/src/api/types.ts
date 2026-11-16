// The wire format of the pi server, copied from its real types and routes.
//
// This file answers one question only: what does the server actually put on
// the wire? Every block names its source (pi-next 0.0.4); fields are copied,
// not invented, and nothing here is a UI model. Where a route assembles a
// response out of several library types, the comment quotes the object literal
// the route returns.
//
// Sources, in the order the blocks appear:
//   lib/types.ts            messages, entries, SessionInfo, SessionContext
//   lib/session-stats.ts    SessionFileStats, SessionUsageSummary
//   lib/session-search.ts   SessionSearchResult, SessionSearchResponse
//   lib/transcript-notices.ts   TranscriptNotice
//   lib/project-tree.ts     the tree the session route returns
//   app/api/sessions/route.ts, app/api/sessions/[id]/route.ts,
//   app/api/sessions/stats/route.ts, app/api/agent/[id]/route.ts,
//   app/api/agent/running/route.ts, app/api/agent/new/route.ts
//   lib/agent-event-wire.ts, lib/agent-event-stream.ts   the SSE events

// --- messages (lib/types.ts:19-137) ---------------------------------------

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  source: {
    type: "base64" | "url";
    media_type?: string;
    data?: string;
    url?: string;
  };
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  /** Historical content is a short preview; full reasoning is loaded on demand. */
  deferred?: boolean;
}

export interface ToolCallContent {
  type: "toolCall";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  /** Client-only buffer for streamed tool input. Never persisted to session files. */
  rawInput?: string;
}

export type AssistantContentBlock = TextContent | ImageContent | ThinkingContent | ToolCallContent;

/** `usage` of one model call (lib/types.ts:58-70). */
export interface AgentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp?: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantContentBlock[];
  model: string;
  provider: string;
  stopReason?: string;
  errorMessage?: string;
  /** When the request started. */
  timestamp?: number;
  /** From `timestamp` until the response ended, measured by pi (pi 1.1). */
  durationMs?: number;
  usage?: AgentUsage;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName?: string;
  content: (TextContent | ImageContent)[];
  isError?: boolean;
  details?: unknown;
  timestamp?: number;
  durationMs?: number;
  usage?: AgentUsage;
}

export interface CustomMessage {
  role: "custom";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  display: boolean;
  details?: unknown;
  timestamp?: number;
}

export interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode?: number;
  cancelled?: boolean;
  truncated?: boolean;
  fullOutputPath?: string;
  excludeFromContext?: boolean;
  timestamp?: number;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage | CustomMessage | BashExecutionMessage;

/** A transcript system message (prompt and tool loadout), never a chat bubble (lib/types.ts:127-135). */
export interface SystemMessage {
  role: "system";
  content: string | TextContent[];
  sections?: Record<string, string | null>;
  toolsAdded?: unknown[];
  toolsRemoved?: Array<{ name: string }>;
  timestamp?: number;
}

export type SessionMessage = AgentMessage | SystemMessage;

// --- transcript notices (lib/transcript-notices.ts:6-19) ------------------

/**
 * A line pi's TUI shows under the message it follows. The server hangs these
 * on `context.messages[i]` under the `transcriptNotices` key, which is not
 * part of pi's message (`withTranscriptNotices()`).
 */
export type TranscriptNotice =
  | { kind: "cache_miss"; missedTokens: number; missedCost: number; idleMinutes?: number; modelChanged?: boolean }
  | { kind: "cache_warm"; cost: number; note?: string }
  | { kind: "summary_cost"; source: "compaction" | "branch_summary"; tokens: number; cost: number }
  | { kind: "thinking_dropped"; count: number };

export const TRANSCRIPT_NOTICES_KEY = "transcriptNotices";

export type WithTranscriptNotices<T> = T & { [TRANSCRIPT_NOTICES_KEY]?: TranscriptNotice[] };

// --- extension UI (lib/types.ts:139-236) ----------------------------------

export type ExtensionUiRequest =
  | {
      type: "extension_ui_request";
      id: string;
      method: "select";
      title: string;
      options: string[];
      timeout?: number;
      expiresAt?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "confirm";
      title: string;
      message: string;
      timeout?: number;
      expiresAt?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "input";
      title: string;
      placeholder?: string;
      timeout?: number;
      expiresAt?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "editor";
      title: string;
      prefill?: string;
      timeout?: number;
      expiresAt?: number;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "notify";
      message: string;
      notifyType?: "info" | "warning" | "error";
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setStatus";
      statusKey: string;
      statusText?: string;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setWidget";
      widgetKey: string;
      widgetLines?: string[];
      widgetPlacement?: "aboveEditor" | "belowEditor";
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "setTitle";
      title: string;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "set_editor_text";
      text: string;
    }
  | {
      type: "extension_ui_request";
      id: string;
      method: "custom";
      lines: string[];
      closed?: boolean;
    };

/** The methods that block the agent until the person answers. */
export type BlockingExtensionUiRequest = Extract<
  ExtensionUiRequest,
  { method: "select" | "confirm" | "input" | "editor" | "custom" }
>;

export type ExtensionUiResponse =
  | { type: "extension_ui_response"; id: string; value: string }
  | { type: "extension_ui_response"; id: string; confirmed: boolean }
  | { type: "extension_ui_response"; id: string; cancelled: true };

export interface ExtensionStatusItem {
  key: string;
  text: string;
}

export interface ExtensionWidgetItem {
  key: string;
  lines: string[];
  placement: "aboveEditor" | "belowEditor";
}

// --- session entries (lib/types.ts:3-17, 239-350) -------------------------

export interface SessionHeader {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

export interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

export interface SessionMessageEntry extends SessionEntryBase {
  type: "message";
  message: SessionMessage;
}

export interface ThinkingLevelChangeEntry extends SessionEntryBase {
  type: "thinking_level_change";
  thinkingLevel: string;
}

export interface ModelChangeEntry extends SessionEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

/** Model usage outside the conversation, such as prompt-cache warming (`kind: "cache_warm"`). */
export interface UsageEntry extends SessionEntryBase {
  type: "usage";
  kind: string;
  provider: string;
  model: string;
  usage: AgentUsage;
  note?: string;
}

export interface CompactionEntry extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  details?: unknown;
  fromHook?: boolean;
  usage?: AgentUsage;
}

export interface BranchSummaryEntry extends SessionEntryBase {
  type: "branch_summary";
  fromId: string;
  summary: string;
  details?: unknown;
  fromHook?: boolean;
  usage?: AgentUsage;
}

export interface CustomEntry extends SessionEntryBase {
  type: "custom";
  customType: string;
  data?: unknown;
}

export interface CustomMessageEntry extends SessionEntryBase {
  type: "custom_message";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  details?: unknown;
  display: boolean;
}

export interface LabelEntry extends SessionEntryBase {
  type: "label";
  targetId: string;
  label: string | undefined;
}

export interface SessionInfoEntry extends SessionEntryBase {
  type: "session_info";
  name?: string;
}

/** Append-only edit of an earlier entry's model context. */
export interface ContextEditEntry extends SessionEntryBase {
  type: "context_edit";
  targetId: string;
  replacement: { content: unknown } | null;
}

export type SessionEntry =
  | SessionMessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | UsageEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomEntry
  | CustomMessageEntry
  | ContextEditEntry
  | LabelEntry
  | SessionInfoEntry;

export type FileEntry = SessionHeader | SessionEntry;

export interface BranchPreview {
  role?: "user" | "assistant";
  text: string;
}

export type SubagentSessionStatus =
  | "starting"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "aborted"
  | "interrupted";

/** `tree` of the session route: `projectTreeForResponse()` on the SDK's tree. */
export interface SessionTreeNode {
  entry: SessionEntry;
  children: SessionTreeNode[];
  label?: string;
  compressedEntryIds?: string[];
  branchPreview?: BranchPreview;
}

/**
 * `?tree=summary` (lib/project-tree.ts:46-72): the same shape with only the
 * entry fields the branch list needs, so a 1000-entry session stays small.
 */
export interface SessionTreeSummaryNode {
  entry: Pick<SessionEntryBase, "id" | "parentId" | "type" | "timestamp">;
  children: SessionTreeSummaryNode[];
  compressedEntryIds?: string[];
  branchPreview?: BranchPreview;
}

// --- session list (lib/types.ts:357-396, app/api/sessions/route.ts:44-64) --

/** One row of `GET /api/sessions` (`SessionInfo` in lib/types.ts:357). */
export interface SessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  /** True while the sidebar has only header/stat metadata for this session (`?summary=1`). */
  detailsPending?: boolean;
  /** Source session for a fork, or parent for a subagent / side chat. */
  parentSessionId?: string;
  relation?:
    | { kind: "fork"; originSessionId?: string }
    | {
        kind: "subagent";
        parentSessionId: string;
        profile: string;
        description: string;
        status: SubagentSessionStatus;
      }
    | { kind: "side"; parentSessionId: string };
  /** Main repo root shared by all worktrees of this cwd (cwd itself for non-git dirs). */
  projectRoot?: string;
  /** Internal, stable project identity (Windows keys case- and separator-insensitive). */
  projectKey?: string;
  /** Current git branch (undefined for non-git or detached HEAD). */
  branch?: string;
  /** True when cwd is a linked git worktree (not the main checkout). */
  isWorktree?: boolean;
  /** True while the runtime session exists only in memory and its JSONL does not exist yet. */
  transient?: boolean;
}

/** `GET /api/sessions` (route returns this literal at :43-61). */
export interface SessionsResponse {
  sessions: SessionInfo[];
  sessionListVersion: number;
  runningSessionIds: string[];
  awaitingInputSessionIds: string[];
  completionNotificationSuppressedSessionIds: string[];
}

// --- one session (lib/types.ts:398-407, app/api/sessions/[id]/route.ts:125-140) --

export interface SessionContext {
  messages: AgentMessage[];
  /** Parallel to `messages`: the session entry id for each message. */
  entryIds: string[];
  oldestEntryId: string | null;
  hasMore: boolean;
  /** Turns on the branch before `oldestEntryId`, not loaded. */
  turnsBefore: number;
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
}

/** `stats` of the session route: `computeSessionStats()` (lib/session-stats.ts:3-18). */
export interface SessionFileStats {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
}

/** `GET /api/sessions/[id]` (route's returned literal at :147-159). */
export interface SessionView {
  sessionId: string;
  filePath: string;
  /** `null` for a runtime session whose file has no header to describe it. */
  info: SessionInfo | null;
  leafId: string | null;
  tree: SessionTreeNode[];
  /** Present only for `?tree=summary`. */
  treeFormat?: "summary";
  /**
   * Opaque freshness token (lib/session-revision.ts:36-51); `null` means the
   * snapshot could not be fingerprinted and must not be cached as fresh.
   */
  snapshotRevision: string | null;
  context: SessionContext;
  stats: SessionFileStats;
  totalActiveMs: number;
  /** The session's pinned tool names, when it has a pin. */
  toolNames?: string[];
  /** True when a `?force=1` read had to rebuild a stale in-memory wrapper. */
  wrapperRebuilt?: boolean;
}

/** The same view over `?tree=summary`. */
export interface SessionSummaryView extends Omit<SessionView, "tree" | "treeFormat"> {
  tree: SessionTreeSummaryNode[];
  treeFormat: "summary";
}

// --- search (lib/session-search.ts:11-26) ---------------------------------

export interface SessionSearchResult {
  session: SessionInfo;
  entryId?: string;
  blockIndex: number;
  /** A title hit has no message entry to reveal. */
  titleMatch?: boolean;
  before: string;
  match: string;
  after: string;
}

export interface SessionSearchResponse {
  results: SessionSearchResult[];
  truncated: boolean;
}

// --- usage summary (lib/session-stats.ts:20-29, app/api/sessions/stats/route.ts:64-87) --

/** One session's totals for the agent switcher. */
export interface SessionUsageSummary {
  tokens: SessionFileStats["tokens"];
  cost: number;
  toolCalls: number;
  totalActiveMs: number;
  /** Recorded settings of this session's active branch, not its profile defaults. */
  model?: SessionContext["model"];
  thinkingLevel?: string;
}

/** `POST /api/sessions/stats` body `{ ids }`, answer `{ stats }` (route :66-92). */
export interface SessionStatsResponse {
  /** Keyed by session id; a session that is gone is left out. */
  stats: Record<string, SessionUsageSummary>;
}

// --- agent state (app/api/agent/[id]/route.ts:84-98, hooks/useAgentSession.ts:111-126) --

/**
 * `state` of `GET /api/agent/[id]`: pi's `{ type: "get_state" }` reply, minus
 * `systemPrompt` when the caller passed `?systemPrompt=0`.
 */
export interface AgentStatePayload {
  model?: { provider: string; id: string };
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  /** Active time over the live wrapper's entries (the session snapshot carries the same field). */
  totalActiveMs?: number;
  systemPrompt?: string;
  /**
   * The session's tools, when the server's `get_state` includes them. This
   * server answers `get_tools` separately (`POST /api/agent/[id]`), so the
   * tools panel falls back to that; the field is kept because a wrapper may
   * grow it and pi-next's state carries `ToolEntry[]`.
   */
  tools?: Array<{
    name: string;
    description?: string;
    active?: boolean;
    declarationHidden?: boolean;
    parameters?: Record<string, unknown>;
    promptGuidelines?: string[];
  }>;
  thinkingLevel?: string;
  isStreaming?: boolean;
  isPromptRunning?: boolean;
  isBashRunning?: boolean;
  isCompacting?: boolean;
  autoCompactionEnabled?: boolean;
  extensionStatuses?: ExtensionStatusItem[];
  extensionWidgets?: ExtensionWidgetItem[];
  queuedMessages?: { steering?: string[]; followUp?: string[] } | null;
}

/** `GET /api/agent/[id]` (route :76-97): `{ running: false }` when no wrapper is alive. */
export interface AgentStateResponse {
  running: boolean;
  state?: AgentStatePayload;
  /** Present instead of a state on a 500. */
  error?: string;
}

/** `POST /api/agent/[id]` and `POST /api/agent/new` success envelope (agent-client.ts:3-6). */
export interface AgentCommandResponse<T = unknown> {
  success: true;
  data: T;
  /** Only `/api/agent/new` sets these. */
  sessionId?: string;
  model?: { provider: string; modelId: string } | null;
  thinkingLevel?: string;
}

// --- running snapshot (app/api/agent/running/route.ts:19-32) --------------

/** `GET /api/agent/running` — the sidebar's poll while tabs are visible. */
export interface AgentRunningSnapshot {
  sessionListVersion: number;
  runningSessionIds: string[];
  awaitingInputSessionIds: string[];
  completionNotificationSuppressedSessionIds: string[];
  /** Sessions whose subagents can still start a run there. */
  subagentsActiveSessionIds: string[];
  /** Pins/archive changed elsewhere; `null` when the UI state file is unreadable. */
  sessionUiStateRevision: number | null;
}

// --- agent events (lib/agent-event-wire.ts, lib/agent-event-stream.ts) ----

/**
 * Every event name the browser sees. `turn_start`, `turn_end` and
 * `entry_appended` never reach the client (`OMITTED_EVENT_TYPES`,
 * lib/agent-event-wire.ts:34-40), and transcript `system` messages are dropped
 * (`isSystemMessageEvent`, :142-147). Any other SDK event passes through
 * unchanged, so the payload itself stays loose, as the server's own
 * `AgentEventLike` is (`{ type: string; [key: string]: unknown }`).
 */
export type AgentEventType =
  | "connected"
  | "heartbeat"
  | "startup_error"
  | "agent_start"
  | "agent_end"
  | "agent_settled"
  | "prompt_done"
  | "prompt_error"
  | "extension_error"
  | "message_start"
  | "message_update"
  | "message_end"
  | "tool_execution_start"
  | "tool_execution_update"
  | "tool_execution_end"
  | "queue_update"
  | "auto_retry_start"
  | "auto_retry_end"
  | "auto_compaction_start"
  | "compaction_start"
  | "auto_compaction_end"
  | "compaction_end"
  | "extension_ui_request"
  | "extension_ui_closed"
  | "session_shutdown";

export interface AgentEvent {
  type: AgentEventType | (string & {});
  [key: string]: unknown;
}

/** The first event of every (re)connection (`lib/agent-event-stream.ts:326-331`). */
export interface AgentConnectedEvent extends AgentEvent {
  type: "connected";
  sessionId: string;
  isStreaming: boolean;
  /** Requests still held, so a reconnecting client drops those closed while it was away. */
  pendingExtensionUiIds: string[];
}

/** `{ type: "heartbeat" }` every 30 s (`AGENT_EVENT_HEARTBEAT_MS`, lib/agent-event-wire.ts:14). */
export interface AgentHeartbeatEvent extends AgentEvent {
  type: "heartbeat";
}

/** `message_update`'s payload after pi-web's projection (lib/agent-event-wire.ts:171-217). */
export interface AgentMessageUpdateEvent extends AgentEvent {
  type: "message_update";
  assistantMessageEvent: { type: string; [key: string]: unknown };
}

/** `{ sessionId, isStreaming }` per stream, and `?systemPrompt=0`'s omission are the only route quirks. */
export interface AgentStreamPathOptions {
  /** Labels the stream in the server's debug panel (`?holder=`). */
  holder?: string;
}
