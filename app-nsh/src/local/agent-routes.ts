// The agent's HTTP surface, answered by the user's own pi over JSONL RPC.
//
// The shapes are `src/api/agent.ts`'s (copied from pi-next's routes, see the
// comments there); the semantics are the old routes' (`app/api/agent/**`), with
// `lib/rpc-manager.ts`'s wrapper replaced by one `pi --mode rpc` process per
// session (`src/pi/session-agent.ts`):
//
//   GET  /api/agent/running          the sidebar's poll: which sessions run
//   GET  /api/agent/[id]             `{ running }` + pi's `get_state`
//   POST /api/agent/[id]             one pi command → `{ success, data }`
//   GET  /api/agent/[id]/events      the session's SSE stream
//   POST /api/agent/[id]/lease       is there work here (never starts a pi)
//   POST /api/agent/new              a brand-new pi in a folder
//
// Anything else under `/api/agent/` stays with the old pipe: `null` here means
// "not mine" (`src/local/index.ts`). `bash-output` is the one route deliberately
// left out — it reads a `pi-bash-*.log` the *session file* names, which is the
// session slice's work, not a live process's.
import path from "path";
import { exists, readFile, stat } from "fs/promises";
import {
  describe,
  errorResponse,
  jsonResponse,
  piAgentDirectory,
  textResponse,
  type LocalRequest,
  type LocalResponse,
  type LocalStream,
} from "./request";
import { CWD_MISSING_PREFIX } from "../pi/rpc";
import { refreshSessionDirectory, sessionCatalogueRevision } from "./session-routes";
import {
  bridgeRequestId,
  readBridgeAnswer,
  readBridgeState,
} from "../pi/bridge";
import {
  SessionNotFoundError,
  awaitingInputSessionIds,
  liveAgent,
  resumeAgent,
  runningSessionIds,
  sessionListRevision,
  startNewAgent,
  type SessionAgent,
} from "../pi/session-agent";

/**
 * The two wire codes a refusal carries (`src/api/client.ts` names them).
 * Spelled out here: importing `client.ts` would pull in the fetch/SSE wiring,
 * and `link.ts` (which calls this module) is what installs it.
 */
const PROMPT_REJECTED = "prompt_rejected";
const CWD_MISSING = "cwd-missing";

/** `AGENT_EVENT_HEARTBEAT_MS` (`lib/agent-event-wire.ts`): proof of life, not an event. */
const HEARTBEAT_MS = 30_000;

/** One answer from the app's pi extension. */
type BridgeAnswer = Awaited<ReturnType<typeof readBridgeAnswer>> & {};


/** The thinking levels pi accepts (`app/api/agent/new/route.ts:9`). */
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export async function handleAgent(request: LocalRequest): Promise<LocalResponse | null> {
  const segments = request.segments;
  if (segments[0] !== "api" || segments[1] !== "agent") return null;
  const rest = segments.slice(2);
  if (rest.length === 0) return null;
  const method = request.method;

  if (rest.length === 1) {
    const id = rest[0];
    if (id === "running") return method === "GET" ? runningSnapshot() : null;
    if (id === "new") return method === "POST" ? createSession(request) : null;
    // The debug panel's snapshot (`app/api/agent/debug/route.ts`) is the old
    // server's own state; it stays with the pipe.
    if (id === "debug") return null;
    if (method === "GET") return readState(request, id);
    if (method === "POST") return postCommand(request, id);
    return null;
  }
  if (rest.length === 2) {
    const [id, action] = rest;
    if (action === "events") return method === "GET" ? openEvents(request, id) : null;
    if (action === "lease") return method === "POST" ? lease(id) : null;
  }
  return null;
}

// ------------------------------------------------------------ running poll

/** `GET /api/agent/running` (`app/api/agent/running/route.ts:19-32`). */
async function runningSnapshot(): Promise<LocalResponse> {
  // A directory that gained, lost or renamed a session moves the catalogue's
  // revision; the same tree costs a handful of folder stats and leaves the
  // transcripts' cached stats alone (the 730-file `stat` was ~0.9 s a poll).
  await refreshSessionDirectory();
  return jsonResponse({
    // The sidebar refreshes when this number moves, so it has to move for a
    // rename or a delete too (`session-routes` owns that counter).
    sessionListVersion: Math.max(sessionListRevision(), sessionCatalogueRevision()),
    runningSessionIds: runningSessionIds(),
    awaitingInputSessionIds: awaitingInputSessionIds(),
    // Nothing here runs subagents (`lib/subagent-runtime.ts`), so neither list
    // has entries; the fields stay because every sidebar poll reads all six.
    completionNotificationSuppressedSessionIds: [],
    subagentsActiveSessionIds: [],
    sessionUiStateRevision: await uiStateRevision(),
  });
}

/**
 * The sidebar's pins/archive revision (`lib/session-ui-state.ts:159`): one read
 * of the small JSON the state lives in. `0` for "no file yet", `null` when it
 * cannot be read, which the sidebar treats as "cannot tell".
 */
async function uiStateRevision(): Promise<number | null> {
  const file = path.join(piAgentDirectory(), "pi-web-session-state.json");
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as { revision?: unknown };
    return typeof parsed.revision === "number" && Number.isFinite(parsed.revision) ? parsed.revision : 0;
  } catch (cause) {
    return (cause as { code?: string }).code === "ENOENT" ? 0 : null;
  }
}

// ------------------------------------------------------------------- state

/** `GET /api/agent/[id]` — `{ running: false }` unless this process holds it. */
async function readState(request: LocalRequest, id: string): Promise<LocalResponse> {
  // pi-web started a wrapper from the session file here too: the panels read
  // the system prompt and the tool set, and those only exist in a live pi
  // (`src/pi/bridge.ts` publishes them). A session with no file stays
  // `{ running: false }`, and an idle one is reaped by the wrapper itself.
  let agent: SessionAgent;
  try {
    agent = await resumeAgent(id);
  } catch {
    return jsonResponse({ running: false });
  }
  try {
    const state = agent.enrichedState(await agent.state({ signal: request.signal }));
    // pi's `get_state` carries no `contextUsage` (the old server computed it
    // beside the state); `get_session_stats` does, so this one GET asks for it
    // and merges only that field. A refused stats read leaves the state as pi
    // gave it — the composer loses its context chip, not the chat.
    const stats = await agent.sessionStats({ signal: request.signal });
    if (stats?.contextUsage !== undefined) state.contextUsage = stats.contextUsage;
    // RPC's `get_state` carries neither the system prompt nor the tool set; the
    // app's own extension publishes both (`src/pi/bridge.ts`).
    const bridge = await readBridgeState();
    if (bridge !== null) {
      if (typeof bridge.systemPrompt === "string" && bridge.systemPrompt !== "") {
        state.systemPrompt = bridge.systemPrompt;
      }
      const tools = bridgeTools(bridge);
      if (tools.length > 0) state.tools = tools;
    }
    if (request.params.get("systemPrompt") === "0") delete state.systemPrompt;
    return jsonResponse({ running: true, state });
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
}

// ---------------------------------------------------------------- commands

/** `POST /api/agent/[id]` — one pi command, answered as `{ success, data }`. */
async function postCommand(request: LocalRequest, id: string): Promise<LocalResponse> {
  const body = parseBody(request);
  if (body === null) return errorResponse("The command must be a JSON object", 400);
  const commandType = typeof body.type === "string" ? body.type : "";
  if (commandType === "") return errorResponse("The command must name its type", 400);
  const toolNamesError = validateToolNames(body.toolNames);
  if (toolNamesError !== null) return failure(new Error(toolNamesError), commandType);

  let agent: SessionAgent;
  try {
    // The old route started a wrapper from the session file the same way; an
    // id with neither a process nor a file is a 404 the composer reads as a
    // refused prompt (`promptRejected`).
    agent = await resumeAgent(id);
  } catch (cause) {
    if (cause instanceof SessionNotFoundError) {
      return errorResponse("Session not found", 404, commandType === "prompt"
        ? { code: PROMPT_REJECTED, accepted: false }
        : {});
    }
    return failure(cause, commandType);
  }

  try {
    if (commandType === "get_tools") {
      return jsonResponse({ success: true, data: await toolsFor(agent) });
    }
    if (commandType === "set_tools") {
      // `toolNames` omitted is "follow the configured defaults"; pi has no such
      // command over RPC, so the pinned list stays and the answer reports it.
      const answer = await askBridge(agent, {
        op: "set-tools",
        ...(Array.isArray(body.toolNames) ? { tools: body.toolNames } : {}),
      });
      return jsonResponse({ success: true, data: bridgeTools(answer) });
    }
    if (commandType === "navigate_tree") {
      const targetId = typeof body.targetId === "string" ? body.targetId : "";
      if (targetId === "") return errorResponse("navigate_tree needs a targetId", 400);
      const answer = await askBridge(agent, {
        op: "navigate",
        targetId,
        summarize: body.summarize === true,
      });
      if (answer.ok === false) return failure(new Error(answer.error ?? "the session tree refused the move"), commandType);
      return jsonResponse({ success: true, data: { cancelled: false } });
    }
    const data = await agent.request(body, { signal: request.signal });
    return jsonResponse({ success: true, data: data === undefined ? null : data });
  } catch (cause) {
    return failure(cause, commandType);
  }
}

// ------------------------------------------------------------- the bridge
//
// pi's RPC has no command for the system prompt, the tool set or moving in the
// tree; the app's extension answers those (`src/pi/bridge.ts`). It is asked
// with a slash command — one prompt per call — and answers in a file.

/** The tool rows the panels read (`AgentStatePayload.tools`), from a snapshot. */
function bridgeTools(state: { tools?: unknown; all?: unknown }): Array<Record<string, unknown>> {
  const active = new Set(Array.isArray(state.tools) ? state.tools.filter((name) => typeof name === "string") : []);
  const all = Array.isArray(state.all) ? state.all.filter((tool): tool is Record<string, unknown> => tool !== null && typeof tool === "object") : [];
  if (all.length === 0) {
    return [...active].map((name) => ({ name, active: true }));
  }
  return all.map((tool) => {
    const name = typeof tool.name === "string" ? tool.name : "";
    return {
      ...tool,
      name,
      description: typeof tool.description === "string" ? tool.description : "",
      active: active.size === 0 ? true : active.has(name),
    };
  });
}

/** Asks the extension one question and waits for its answer file. */
async function askBridge(agent: SessionAgent, request: Record<string, unknown>): Promise<BridgeAnswer> {
  const id = bridgeRequestId();
  await agent.request({ type: "prompt", message: `/pi-next-bridge ${JSON.stringify({ ...request, id })}` });
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const answer = await readBridgeAnswer(id);
    if (answer !== null) return answer;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("the app's pi extension did not answer (is pi 1.4+ with --extension support?)");
}

/** `get_tools`: the published snapshot, or a fresh answer from the extension. */
async function toolsFor(agent: SessionAgent): Promise<Array<Record<string, unknown>>> {
  const published = await readBridgeState();
  const fromPublished = published === null ? [] : bridgeTools(published);
  if (fromPublished.length > 0) return fromPublished;
  return bridgeTools(await askBridge(agent, { op: "tools" }));
}

// ------------------------------------------------------------------- lease

/**
 * `POST /api/agent/[id]/lease` (`app/api/agent/[id]/lease/route.ts`): renews
 * the idle countdown of a session a page has selected, and says what is under
 * way. Never starts a wrapper.
 */
function lease(id: string): LocalResponse {
  const agent = liveAgent(id);
  if (!agent) {
    return jsonResponse({ success: true, running: false, awaitingInput: false, subagentsActive: false });
  }
  return jsonResponse({
    success: true,
    running: agent.running(),
    awaitingInput: agent.awaitingInput(),
    subagentsActive: false,
  });
}

// ---------------------------------------------------------------- new agent

/** `POST /api/agent/new` (`app/api/agent/new/route.ts:23-100`). */
async function createSession(request: LocalRequest): Promise<LocalResponse> {
  const body = parseBody(request);
  if (body === null) return errorResponse("The request must be a JSON object", 400);
  const commandType = typeof body.type === "string" ? body.type : "";

  const cwd = body.cwd;
  if (typeof cwd !== "string" || cwd === "") {
    return errorResponse("cwd is required", 400, commandType === "prompt"
      ? { code: PROMPT_REJECTED, accepted: false }
      : {});
  }
  if (!(await isDirectory(cwd))) {
    // The composer names the folder instead of showing a model error (#1422).
    return errorResponse(`Directory does not exist: ${cwd}`, 400, {
      reason: CWD_MISSING,
      cwd,
      ...(commandType === "prompt" ? { code: PROMPT_REJECTED, accepted: false } : {}),
    });
  }

  const provider = typeof body.provider === "string" ? body.provider : undefined;
  const modelId = typeof body.modelId === "string" ? body.modelId : undefined;
  if ((provider !== undefined) !== (modelId !== undefined)) {
    return failure(new Error("provider and modelId must be provided together"), commandType);
  }
  const thinkingLevel = body.thinkingLevel;
  if (thinkingLevel !== undefined && (typeof thinkingLevel !== "string" || !THINKING_LEVELS.has(thinkingLevel))) {
    return failure(new Error(`Invalid thinking level: ${String(thinkingLevel)}`), commandType);
  }
  const toolNamesError = validateToolNames(body.toolNames);
  if (toolNamesError !== null) return failure(new Error(toolNamesError), commandType);

  // Everything else is the command pi gets: `prompt`, `ensure_session`, …
  const command: Record<string, unknown> = { ...body };
  delete command.cwd;
  delete command.provider;
  delete command.modelId;
  delete command.toolNames;
  delete command.thinkingLevel;

  let started: { agent: SessionAgent; state: Record<string, unknown> };
  try {
    started = await startNewAgent(cwd, {
      provider,
      modelId,
      thinkingLevel: typeof thinkingLevel === "string" ? thinkingLevel : undefined,
      toolNames: Array.isArray(body.toolNames) ? body.toolNames as string[] : undefined,
    });
  } catch (cause) {
    return failure(cause, commandType);
  }

  const { agent, state } = started;
  const model = state.model !== null && typeof state.model === "object"
    ? state.model as { provider?: unknown; id?: unknown }
    : {};
  const answer = {
    success: true,
    sessionId: agent.sessionId,
    data: null as unknown,
    model: typeof model.provider === "string" && typeof model.id === "string"
      ? { provider: model.provider, modelId: model.id }
      : null,
    ...(typeof state.thinkingLevel === "string" ? { thinkingLevel: state.thinkingLevel } : {}),
  };

  // `ensure_session` only creates the runtime: the caller queries it next.
  if (command.type === "ensure_session") return jsonResponse(answer);

  try {
    const data = await agent.request(command, { signal: request.signal });
    // A brand-new session's JSONL is written with the run's first entry, and the
    // caller switches to this id at once (`chooseSession`) and reads
    // `/api/sessions/[id]` for it: give pi the moment it needs for that file.
    if (commandType === "prompt" && agent.sessionFile !== null) {
      await waitForFile(agent.sessionFile, SESSION_FILE_WAIT_MS);
    }
    return jsonResponse({ ...answer, data: data === undefined ? null : data });
  } catch (cause) {
    return failure(cause, commandType);
  }
}

// ------------------------------------------------------------------ events

/**
 * `GET /api/agent/[id]/events` — the session's agent stream. The old route
 * started a wrapper when none was live; so does this one, from the JSONL file.
 */
async function openEvents(request: LocalRequest, id: string): Promise<LocalResponse> {
  if (request.signal?.aborted) return { status: 204 };

  let agent: SessionAgent;
  try {
    agent = await resumeAgent(id);
  } catch (cause) {
    if (cause instanceof SessionNotFoundError) return textResponse("Session not found", 404);
    return errorResponse(describe(cause), 500);
  }

  return {
    status: 200,
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform" },
    stream: (stream) => openEventStream(id, agent, stream, request.signal),
  };
}

/**
 * Writes one session event per pi event as `data: {json}\n\n` — the frames
 * `lib/agent-event-stream.ts` wrote — plus a heartbeat every 30 s.
 */
function openEventStream(
  sessionId: string,
  agent: SessionAgent,
  stream: LocalStream,
  signal?: AbortSignal,
): () => void {
  let finished = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | null = null;

  const stopHeartbeat = (): void => {
    if (heartbeat !== undefined) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
  };
  const emitText = (text: string): void => {
    if (finished) return;
    try {
      stream.emit(text);
    } catch {
      // The window stopped reading: `stream.closed` runs the cleanup.
      finished = true;
    }
  };
  const send = (event: unknown): void => {
    emitText(`data: ${JSON.stringify(event)}\n\n`);
  };

  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    finished = true;
    unsubscribe?.();
    unsubscribe = null;
    stopHeartbeat();
    try {
      signal?.removeEventListener("abort", cleanup);
    } catch {
      // A signal from another realm: nothing to detach.
    }
  };

  // The old stream's first frame, kept for the same reason it was there: the
  // frame carries no event (`api/sse.ts` drops comment-only frames), but it
  // makes the client's first read settle at once — so a connection cancelled
  // while pi was still starting ends instead of waiting for a frame that is
  // never coming.
  emitText(":\n\n");

  // The first *event* of every (re)connection: what the client resyncs from,
  // and which dialogs are still open (`lib/agent-event-stream.ts:326-331`).
  unsubscribe = agent.subscribe((event) => {
    if (event.type === "session_shutdown") {
      // pi is gone, so this stream can never carry another event. The old
      // route ended the stream here (`lib/agent-event-stream.ts` cleans up on
      // `session_shutdown` without forwarding it); a local stream cannot be
      // ended from this side, so dropping the heartbeat is how `api/sse.ts`'s
      // stale watchdog learns — it reconnects, which starts a new pi.
      stopHeartbeat();
      return;
    }
    send(event);
  });
  send({
    type: "connected",
    // The id the app opened the stream for (the old route echoed its own
    // `[id]`), which is what `reconcileAgentState` asks `/api/agent/[id]` about.
    sessionId,
    isStreaming: agent.running(),
    pendingExtensionUiIds: pendingUiIds(agent),
  });
  // `onEvent()` replays what the session still holds; the dialogs are ours.
  for (const pending of agent.pendingUiRequests()) send(pending);

  heartbeat = setInterval(() => send({ type: "heartbeat" }), HEARTBEAT_MS);

  if (signal) {
    if (signal.aborted) {
      cleanup();
      return cleanup;
    }
    signal.addEventListener("abort", cleanup);
  }
  // The window's reader cancelling is the other "client is gone" signal a local
  // stream has (`LocalResponse.stream`); `link.ts` resolves it on cancel.
  void stream.closed.then(cleanup);
  return cleanup;
}

function pendingUiIds(agent: SessionAgent): string[] {
  const ids: string[] = [];
  for (const pending of agent.pendingUiRequests()) {
    if (typeof pending.id === "string") ids.push(pending.id);
  }
  return ids;
}

// ----------------------------------------------------------------- helpers

function parseBody(request: LocalRequest): Record<string, unknown> | null {
  if (request.body === null || request.body.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(request.body);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function validateToolNames(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((name) => typeof name !== "string")) {
    return "toolNames must be an array of strings";
  }
  return null;
}

/** The folder pi names when it refuses a session whose project is gone. */
function missingCwdOf(message: string): string | null {
  for (const line of message.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(CWD_MISSING_PREFIX)) continue;
    const folder = trimmed.slice(CWD_MISSING_PREFIX.length).trim();
    if (folder !== "") return folder;
  }
  return null;
}

/**
 * A command pi refused (or never answered): `{ error }` plus the two optional
 * fields the app's `ApiError` reads. A prompt that never reached the model also
 * carries `code: "prompt_rejected"`, so the composer puts the text back.
 */
function failure(cause: unknown, commandType: string, accepted = false): LocalResponse {
  const message = describe(cause);
  const cwd = missingCwdOf(message);
  return errorResponse(message, 500, {
    ...(cwd !== null ? { reason: CWD_MISSING, cwd } : {}),
    ...(commandType === "prompt" && !accepted ? { code: PROMPT_REJECTED, accepted: false } : {}),
  });
}

/** How long the first entry of a new session may take to reach its file. */
const SESSION_FILE_WAIT_MS = 1_500;

/** Waits (briefly) for pi to create `file`: `exists()` is cheap, the wait is not. */
async function waitForFile(file: string, deadlineMs: number): Promise<void> {
  const until = Date.now() + deadlineMs;
  for (;;) {
    try {
      if (await exists(file)) return;
    } catch {
      return;
    }
    if (Date.now() >= until) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
}

async function isDirectory(folder: string): Promise<boolean> {
  try {
    return (await stat(folder)).isDirectory();
  } catch (cause) {
    // Only "it is not there" is this route's to answer. A folder the app's
    // grants cannot see (outside `~`) is pi's to refuse: starting it there
    // reports the runtime's own message instead of a wrong "does not exist".
    return (cause as { code?: string }).code !== "ENOENT";
  }
}
