// The agent's HTTP surface: state, commands, a new session, the running poll,
// and its SSE stream (which is a thin JSON projection over `openStream`).
//
// Every command is a POST of a pi command object. The route's contract is
// `{ success: true, data }` for a command and `{ error, code?, accepted? }`
// otherwise (`app/api/agent/[id]/route.ts:1-98`, `lib/agent-client.ts:1-68`);
// `sendCommand` unwraps `data` and lets `ApiError` carry the rest, including
// `promptRejected` / `missingCwd`.

import { api, postJson, req, segment, withQuery, withToken, type RequestOptions } from "./client";
import { openStream, type OpenStreamOptions, type SseEvent } from "./sse";
import type {
  AgentCommandResponse,
  AgentEvent,
  AgentRunningSnapshot,
  AgentStatePayload,
  AgentStateResponse,
} from "./types";

/** One image attached to a prompt, as pi takes it (`{ type, data, mimeType }`, base64 data). */
export interface AgentImage {
  type: "image";
  data: string;
  mimeType: string;
}

/** `ThinkingLevel` of `@earendil-works/pi-agent-core`, as `app/api/agent/new/route.ts:9` validates it. */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * A pi command. The route hands the body straight to `RpcSession.send()`, so
 * the object is the SDK's own command shape; the named commands below are the
 * ones this app sends, with their fields, and `AgentCommand` stays open for
 * the rest (`get_state`, `get_commands`, `fork`, `navigate_tree`, …).
 */
export interface AgentCommand {
  type: string;
  [key: string]: unknown;
}

export interface PromptCommand extends AgentCommand {
  type: "prompt";
  message: string;
  images?: AgentImage[];
  /** When a run is already going: queue it as a steer or a follow-up. */
  streamingBehavior?: "steer" | "follow_up";
}

export interface SteerCommand extends AgentCommand {
  type: "steer";
  message: string;
  images?: AgentImage[];
}

export interface FollowUpCommand extends AgentCommand {
  type: "follow_up";
  message: string;
  images?: AgentImage[];
}

export interface SetModelCommand extends AgentCommand {
  type: "set_model";
  provider: string;
  modelId: string;
}

export interface SetThinkingLevelCommand extends AgentCommand {
  type: "set_thinking_level";
  level: ThinkingLevel;
}

export interface CompactCommand extends AgentCommand {
  type: "compact";
  customInstructions?: string;
}

export interface SetToolsCommand extends AgentCommand {
  type: "set_tools";
  /** Omit to drop the session's pin and follow the configured defaults again. */
  toolNames?: string[];
}

/** `{ type: "prompt", message }` (plus images / streaming behavior). */
export function promptCommand(
  message: string,
  options: { images?: AgentImage[]; streamingBehavior?: "steer" | "follow_up" } = {},
): PromptCommand {
  const command: PromptCommand = { type: "prompt", message };
  if (options.images && options.images.length > 0) command.images = options.images;
  if (options.streamingBehavior) command.streamingBehavior = options.streamingBehavior;
  return command;
}

const AGENT_PATH = (sessionId: string) => `/api/agent/${segment(sessionId)}`;

/**
 * `GET /api/agent/[id]` — `{ running: false }` when no runtime wrapper is
 * alive, else pi's `get_state` reply. Pass `systemPrompt: false` for status
 * polls: the prompt is nearly the whole reply (`lib/agent-client.ts:38-46`).
 */
export function agentState(
  sessionId: string,
  options: RequestOptions & { systemPrompt?: boolean } = {},
): Promise<AgentStateResponse> {
  const { systemPrompt, ...request } = options;
  const path = withQuery(AGENT_PATH(sessionId), { systemPrompt: systemPrompt === false ? 0 : undefined });
  return req<AgentStateResponse>(path, {}, request);
}

/** `agentState()` for callers that only want the payload, or `undefined` when idle. */
export async function agentStatePayload(
  sessionId: string,
  options: RequestOptions & { systemPrompt?: boolean } = {},
): Promise<AgentStatePayload | undefined> {
  const response = await agentState(sessionId, options);
  return response.running ? response.state : undefined;
}

/**
 * `POST /api/agent/[id]` — sends one pi command and answers its `data`.
 * Throws `ApiError` otherwise: `status` 404 with `code: "prompt_rejected"` when
 * the session is gone, 500 with `missingCwd` when its folder was moved.
 */
export async function sendCommand<T = unknown>(
  sessionId: string,
  command: AgentCommand,
  options: RequestOptions = {},
): Promise<T> {
  const response = await postJson<AgentCommandResponse<T>>(AGENT_PATH(sessionId), command, options);
  return response.data;
}

/** `POST /api/agent/new` body (`app/api/agent/new/route.ts:27-100`). */
export interface NewSessionRequest {
  cwd: string;
  type: string;
  message?: string;
  images?: AgentImage[];
  provider?: string;
  /** Required together with `provider` (the route refuses one without the other). */
  modelId?: string;
  toolNames?: string[];
  thinkingLevel?: ThinkingLevel;
}

/** `POST /api/agent/new` answer (`app/api/agent/new/route.ts:77-100`). */
export interface NewSessionResponse {
  success: true;
  /** pi's real session id; the caller switches to it. */
  sessionId: string;
  /** The command's result (`null` for `ensure_session`). */
  data: unknown;
  model: { provider: string; modelId: string } | null;
  thinkingLevel?: string;
}

/**
 * `POST /api/agent/new` — spawns a brand-new pi session and sends one command
 * (`type: "prompt"` normally, `"ensure_session"` to only create it).
 */
export function newSession(request: NewSessionRequest, options: RequestOptions = {}): Promise<NewSessionResponse> {
  return postJson<NewSessionResponse>("/api/agent/new", request, options);
}

/**
 * `GET /api/agent/[id]/bash-output?path=` — a bash run's spilled full output
 * (`app/api/agent/[id]/bash-output/route.ts:12-60`). The route only reads a
 * `pi-bash-*.log` in the temp folder that one of the session's `bashExecution`
 * entries names: 400 for a missing / invalid path, 403 when this session does
 * not reference it, 413 when the file is over its inline limit (the body's
 * `data.size` names the file's size), 404 when the file is gone.
 */
export async function readBashOutput(
  sessionId: string,
  path: string,
  options: RequestOptions = {},
): Promise<string> {
  const data = await req<{ success?: boolean; data?: { output?: unknown } }>(
    withQuery(`${AGENT_PATH(sessionId)}/bash-output`, { path }),
    {},
    options,
  );
  return typeof data?.data?.output === "string" ? data.data.output : "";
}

/**
 * The download URL of that file (`?download=1` streams it with a
 * `Content-Disposition: attachment`, `route.ts:34-45`), absolute and tokenized
 * so `openUrl` can hand it to the system browser.
 */
export function bashOutputUrl(sessionId: string, path: string, download = false): string {
  return withToken(
    api.base(),
    withQuery(`${AGENT_PATH(sessionId)}/bash-output`, { path, download: download ? 1 : undefined }),
    api.token(),
  );
}

/**
 * `GET /api/agent/running` — the sidebar's lightweight poll: which sessions
 * run or await input, whether the list changed, and the UI-state revision.
 */
export function runningSnapshot(options: RequestOptions = {}): Promise<AgentRunningSnapshot> {
  return req<AgentRunningSnapshot>("/api/agent/running", {}, options);
}

/** The SSE path of a session's agent stream (`app/api/agent/[id]/events/route.ts`). */
export function agentEventsPath(sessionId: string, holder?: string): string {
  return withQuery(`/api/agent/${segment(sessionId)}/events`, { holder });
}

/**
 * Opens the session's agent stream and hands the caller decoded events.
 *
 * The wire events are `data: {json}` only — no `event:` name, no `id:` — and
 * `{"type":"heartbeat"}` is a data event that only proves the stream is alive
 * (`lib/agent-event-wire.ts:9-16`), so it is dropped here; reconnection,
 * staleness and `Last-Event-ID` are `openStream`'s.
 */
export function openAgentEvents(
  sessionId: string,
  onEvent: (event: AgentEvent) => void,
  options: OpenStreamOptions & { holder?: string } = {},
): () => void {
  const { holder, ...stream } = options;
  return openStream(agentEventsPath(sessionId, holder), (frame: SseEvent) => {
    let event: AgentEvent;
    try {
      event = JSON.parse(frame.data) as AgentEvent;
    } catch {
      return; // A non-JSON line on the stream (a proxy's error page) is not an event.
    }
    if (event.type === "heartbeat") return;
    onEvent(event);
  }, stream);
}
