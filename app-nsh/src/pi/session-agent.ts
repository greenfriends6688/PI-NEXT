// One live pi per app session: the process, the session file it belongs to, and
// the little state the window needs about it (running, awaiting input, queue).
//
// The old server kept this in `lib/rpc-manager.ts` (`AgentSessionWrapper` +
// a registry keyed by session id). Here the same map exists, but each entry is
// a `pi --mode rpc` process the user's own pi runs and, for an existing
// session, is resumed from the JSONL file `sessionFilePath()` finds. That file
// is also what makes a session survive an app restart: the id in its name is
// the id the app uses everywhere.
//
// Everything the routes need is a plain function: `resumeAgent()` (start or
// find), `startNewAgent()` (a brand-new session in a folder), `liveAgent()`
// (never starts anything), and the two lists `GET /api/agent/running` reports.
import { sessionFilePath } from "../local/request";
import type { RpcExit, RpcRecord, RpcResponse } from "./rpc";
import { PiRpc } from "./rpc";

/** How long an idle process is kept before it is stopped (pi-next: 10 min). */
export const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** How long pi gets to answer the `get_state` that proves it started. */
const START_TIMEOUT_MS = 30_000;

/** The options `POST /api/agent/new` passes to pi's command line. */
export interface AgentStartOptions {
  provider?: string;
  modelId?: string;
  thinkingLevel?: string;
  /** A pinned tool list: `[]` is "Chat only", `undefined` keeps pi's defaults. */
  toolNames?: string[];
}

/** The session id names no session: the route answers 404, as the old one did. */
export class SessionNotFoundError extends Error {
  constructor(message = "Session not found") {
    super(message);
    this.name = "SessionNotFoundError";
  }
}

function asRecord(value: unknown): RpcRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RpcRecord
    : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** The extension dialogs that block the run until a person answers (`lib/types.ts`). */
function isBlockingUiRequest(record: RpcRecord): boolean {
  if (typeof record.id !== "string") return false;
  switch (record.method) {
    case "select":
    case "confirm":
    case "input":
    case "editor":
      return true;
    case "custom":
      // A custom overlay is answered by closing it; `closed: true` is that news.
      return record.closed !== true;
    default:
      // notify / setStatus / setWidget / setTitle / set_editor_text never block.
      return false;
  }
}

/** One `pi --mode rpc` process and the state the app reads off its events. */
export class SessionAgent {
  /** pi's own session id (`get_state.sessionId`), empty until the first answer. */
  private sessionIdValue = "";
  /** The JSONL file pi writes, when it has one yet. */
  private sessionFileValue: string | null;
  /** Queued prompts pi reported (`queue_update` is always the complete lists). */
  private queue: { steering: string[]; followUp: string[] } = { steering: [], followUp: [] };
  /** Blocking extension dialogs pi still holds, by request id. */
  private readonly dialogs = new Map<string, RpcRecord>();
  private readonly listeners = new Set<(event: RpcRecord) => void>();
  private stoppedPromise: Promise<void>;
  private markStopped: () => void = () => {};
  private exitInfo: RpcExit | null = null;
  /** A prompt was accepted and its run has not settled (`isPromptRunning`). */
  private promptActive = false;
  private streaming = false;
  private compacting = false;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** When the idle timer was last armed, so a burst of deltas does not re-arm it. */
  private idleArmedAt = 0;

  private constructor(private readonly rpc: PiRpc, sessionFile: string | null) {
    this.sessionFileValue = sessionFile;
    this.stoppedPromise = new Promise<void>((resolve) => {
      this.markStopped = resolve;
    });
  }

  /** Starts pi: a resumed `sessionFile`, or a new session in `cwd`. */
  static async start(
    options: AgentStartOptions & { cwd?: string; sessionFile?: string | null },
  ): Promise<SessionAgent> {
    // Anything pi emits between the spawn and the constructor belongs to the
    // session too (an extension's startup dialogs): hold it until it exists.
    const early: RpcRecord[] = [];
    let earlyExit: RpcExit | null = null;
    let agent: SessionAgent | null = null;

    const rpc = await PiRpc.start({
      cwd: options.cwd,
      sessionFile: options.sessionFile ?? null,
      provider: options.provider,
      modelId: options.modelId,
      thinkingLevel: options.thinkingLevel,
      toolNames: options.toolNames,
      onEvent: (record) => {
        if (agent) agent.handle(record);
        else early.push(record);
      },
      onExit: (exit) => {
        if (agent) agent.handleExit(exit);
        else earlyExit = exit;
      },
    });

    agent = new SessionAgent(rpc, options.sessionFile ?? null);
    for (const record of early) agent.handle(record);
    if (earlyExit !== null) agent.handleExit(earlyExit);
    return agent;
  }

  /** pi's session id (the id the app uses once it knows it). */
  get sessionId(): string {
    return this.sessionIdValue;
  }

  /** The JSONL file, when there is one yet (a brand-new session has none). */
  get sessionFile(): string | null {
    return this.sessionFileValue;
  }

  /** True once pi exited or was stopped: nothing can be sent any more. */
  get exited(): boolean {
    return this.rpc.exited;
  }

  /** Resolves when the process is gone (already resolved for a dead process). */
  whenStopped(): Promise<void> {
    return this.stoppedPromise;
  }

  /** Why pi ended, when it did. */
  get exit(): RpcExit | null {
    return this.exitInfo;
  }

  /** Sends one command and answers its `data`; pi's refusal throws. */
  async request(
    command: Record<string, unknown>,
    options: { timeoutMs?: number | null; signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const response = await this.send(command, options);
    if (response.success === false) {
      throw new Error(
        typeof response.error === "string" && response.error !== ""
          ? response.error
          : `pi refused the ${String(command.type)} command`,
      );
    }
    return response.data;
  }

  /** Sends one command and answers pi's record (a refused command is not a throw). */
  async send(
    command: Record<string, unknown>,
    options: { timeoutMs?: number | null; signal?: AbortSignal } = {},
  ): Promise<RpcResponse> {
    this.touch();
    const type = typeof command.type === "string" ? command.type : "";

    // `extension_ui_response` gets no protocol response: pi hands the value to
    // the extension that asked (`docs/rpc-extension-ui.md` "Responses to Pi").
    if (type === "extension_ui_response") {
      this.rpc.sendRaw(command);
      if (typeof command.id === "string") this.dialogs.delete(command.id);
      return { type: "response", command: type, success: true, data: null };
    }

    // The app's `PromptCommand.streamingBehavior` says `follow_up`; pi's
    // protocol spells the same thing `followUp` (`docs/rpc-commands.md#prompt`).
    const outgoing = { ...command };
    if (type === "prompt" && outgoing.streamingBehavior === "follow_up") {
      outgoing.streamingBehavior = "followUp";
    }

    const response = await this.rpc.send(outgoing, options);
    this.afterResponse(type, response);
    return response;
  }

  /** `get_state`, with the fields pi's RPC reply leaves to the wrapper. */
  async state(options: { timeoutMs?: number | null; signal?: AbortSignal } = {}): Promise<RpcRecord> {
    const data = asRecord(await this.request(
      { type: "get_state" },
      { ...options, timeoutMs: options.timeoutMs ?? START_TIMEOUT_MS },
    ));
    this.noteState(data);
    return data;
  }

  /**
   * `get_session_stats`: the session's totals and, when pi can compute it, the
   * context window's current fill. Optional by design: the state route calls
   * this only for the stats strip, and an older pi or a process on its way out
   * must leave that read working without the numbers.
   */
  async sessionStats(
    options: { timeoutMs?: number | null; signal?: AbortSignal } = {},
  ): Promise<RpcRecord | null> {
    try {
      return asRecord(await this.request(
        { type: "get_session_stats" },
        { ...options, timeoutMs: options.timeoutMs ?? START_TIMEOUT_MS },
      ));
    } catch {
      return null;
    }
  }

  /**
   * `get_state`'s payload plus what this slice knows from pi's events: the
   * queued prompts (`queue_update`) and whether a prompt's run is under way
   * (RPC's reply has no `isPromptRunning`, the SDK's state had one).
   */
  enrichedState(state: RpcRecord): RpcRecord {
    return {
      ...state,
      isPromptRunning: this.promptActive,
      queuedMessages: {
        steering: [...this.queue.steering],
        followUp: [...this.queue.followUp],
      },
    };
  }

  /** True while a run, a queue, a compaction or a bash command is going. */
  running(): boolean {
    return !this.exited && (this.promptActive || this.streaming || this.compacting);
  }

  /** True while a blocking extension dialog is unanswered (a subset of running). */
  awaitingInput(): boolean {
    return this.dialogs.size > 0 && this.running();
  }

  /** The dialogs pi still waits on, so a reconnecting stream can replay them. */
  pendingUiRequests(): RpcRecord[] {
    return [...this.dialogs.values()];
  }

  /** Session events from pi (`response` records never reach listeners). */
  subscribe(listener: (event: RpcRecord) => void): () => void {
    this.listeners.add(listener);
    this.touch();
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The process's exit (immediately, for one that already ended). */
  onExit(listener: (exit: RpcExit) => void): () => void {
    return this.rpc.onExit(listener);
  }

  /** Restarts the idle countdown: a command, a lease, a stream, an event. */
  touch(): void {
    // `message_update` alone arrives hundreds of times a second while a model
    // streams; the countdown only needs a reset every half minute.
    const now = Date.now();
    if (this.idleTimer !== undefined && now - this.idleArmedAt < SESSION_IDLE_TIMEOUT_MS / 20) return;
    if (this.idleTimer !== undefined) clearTimeout(this.idleTimer);
    this.idleArmedAt = now;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      // A page watching the stream, or work under way, keeps the process.
      if (this.listeners.size > 0 || this.running()) {
        this.idleArmedAt = 0;
        this.touch();
        return;
      }
      this.dispose();
    }, SESSION_IDLE_TIMEOUT_MS);
  }

  /** Stops the process (an idle session, or a start that failed to come up). */
  dispose(): void {
    if (this.idleTimer !== undefined) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    this.idleArmedAt = 0;
    this.rpc.stop();
  }

  // ---------------------------------------------------------------- internal

  /** One session event, tracked and passed on. */
  private handle(record: RpcRecord): void {
    switch (record.type) {
      case "agent_start":
        this.promptActive = true;
        this.streaming = true;
        break;
      case "agent_end":
        this.streaming = false;
        break;
      case "agent_settled":
        // pi has no more automatic work: the queue is spent and the run over.
        this.promptActive = false;
        this.streaming = false;
        this.compacting = false;
        this.queue = { steering: [], followUp: [] };
        break;
      case "queue_update":
        this.queue = {
          steering: stringList(record.steering),
          followUp: stringList(record.followUp),
        };
        break;
      case "compaction_start":
      case "auto_compaction_start":
        this.compacting = true;
        break;
      case "compaction_end":
      case "auto_compaction_end":
        this.compacting = false;
        break;
      case "extension_ui_request":
        if (typeof record.id === "string") {
          if (isBlockingUiRequest(record)) this.dialogs.set(record.id, record);
          // A custom overlay that closed itself is no longer waiting on a person.
          else if (record.method === "custom" && record.closed === true) this.dialogs.delete(record.id);
        }
        break;
      case "extension_ui_closed":
        if (typeof record.id === "string") this.dialogs.delete(record.id);
        break;
      default:
        break;
    }
    this.touch();
    for (const listener of [...this.listeners]) {
      try {
        listener(record);
      } catch {
        // One subscriber's bug must not stop the stream (or pi's reader).
      }
    }
  }

  private handleExit(exit: RpcExit): void {
    if (this.exitInfo !== null) return;
    this.exitInfo = exit;
    this.promptActive = false;
    this.streaming = false;
    this.compacting = false;
    this.dialogs.clear();
    // The old wrapper announced a shutdown the same way; the chat resets on it
    // and the stream's route stops its heartbeat, so the client reconnects.
    this.emitShutdown();
    this.markStopped();
  }

  private emitShutdown(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener({ type: "session_shutdown" });
      } catch {
        // Nothing to do: the process is gone.
      }
    }
  }

  private noteState(state: RpcRecord): void {
    if (typeof state.sessionId === "string" && state.sessionId !== "") this.sessionIdValue = state.sessionId;
    if (typeof state.sessionFile === "string" && state.sessionFile !== "") this.sessionFileValue = state.sessionFile;
    if (state.isStreaming === true) this.streaming = true;
    if (state.isStreaming === false) this.streaming = false;
    if (typeof state.isCompacting === "boolean") this.compacting = state.isCompacting;
  }

  private afterResponse(type: string, response: RpcResponse): void {
    if (response.success === false) return;
    if (type === "prompt") {
      const data = asRecord(response.data);
      // "started" and "queued" both mean a run will follow; "handled" means an
      // extension answered it and no run started (`docs/rpc-commands.md`).
      if (data.disposition === "started" || data.disposition === "queued") this.promptActive = true;
    }
    if (type === "new_session") {
      // pi switched to another session inside the same process; the app keeps
      // its own id, but `GET /api/agent/running` should name the new one.
      void this.rpc.send({ type: "get_state" }).then((reply) => {
        if (reply.success !== false) this.noteState(asRecord(reply.data));
      }).catch(() => {
        // The process is gone: the exit path already reported it.
      });
    }
  }
}

// ------------------------------------------------------------------- registry

/** One live agent per app session id (the id in the session file's name). */
const agents = new Map<string, SessionAgent>();
/** Starts in flight, so two requests for one session share a single pi. */
const starting = new Map<string, Promise<SessionAgent>>();
/** Bumped when a session appears in or leaves the live registry. */
let listRevision = 1;

/** The live agent for `sessionId`, or null: never starts anything. */
export function liveAgent(sessionId: string): SessionAgent | null {
  const agent = agents.get(sessionId);
  if (!agent) return null;
  if (agent.exited) return null;
  agent.touch();
  return agent;
}

/**
 * The live agent for `sessionId`, resumed from its session file when there is
 * none. Throws `SessionNotFoundError` when the id names no session file and no
 * live process.
 */
export async function resumeAgent(sessionId: string): Promise<SessionAgent> {
  const existing = agents.get(sessionId);
  if (existing) {
    if (!existing.exited) {
      existing.touch();
      return existing;
    }
    // Its process is on the way out: let it finish before a new one opens the
    // same file (two writers to one JSONL would interleave).
    await existing.whenStopped();
  }
  const inflight = starting.get(sessionId);
  if (inflight) return inflight;

  const tracked = openExisting(sessionId).finally(() => {
    if (starting.get(sessionId) === tracked) starting.delete(sessionId);
  });
  starting.set(sessionId, tracked);
  return tracked;
}

/** Starts a brand-new session in `cwd` (no session file yet). */
export async function startNewAgent(
  cwd: string,
  options: AgentStartOptions = {},
): Promise<{ agent: SessionAgent; state: RpcRecord }> {
  const agent = await SessionAgent.start({ cwd, sessionFile: null, ...options });
  let state: RpcRecord;
  try {
    state = await agent.state();
  } catch (cause) {
    agent.dispose();
    throw cause;
  }
  if (agent.sessionId === "") {
    agent.dispose();
    throw new Error("pi started without naming its session");
  }
  register(agent.sessionId, agent);
  return { agent, state };
}

/** The ids of the sessions whose agent is running something (pi's own ids). */
export function runningSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, agent] of agents) {
    if (agent.exited || !agent.running()) continue;
    ids.add(agent.sessionId || sessionId);
  }
  return [...ids];
}

/** The subset of `runningSessionIds()` parked on an extension's dialog. */
export function awaitingInputSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, agent] of agents) {
    if (agent.exited || !agent.awaitingInput()) continue;
    ids.add(agent.sessionId || sessionId);
  }
  return [...ids];
}

/** A version for `GET /api/agent/running`: it changed when the live set did. */
export function sessionListRevision(): number {
  return listRevision;
}

/**
 * Stops every live agent (the app is quitting). Nothing calls it yet: the
 * window has no quit hook here, and an idle session is reaped on its own. A
 * later slice can call it from `App.tsx` if the host drops children abruptly.
 */
export function stopAllAgents(): void {
  for (const agent of agents.values()) agent.dispose();
}

// -------------------------------------------------------------------- helpers

async function openExisting(sessionId: string): Promise<SessionAgent> {
  const file = await sessionFilePath(sessionId);
  if (file === null) throw new SessionNotFoundError();

  // Another id already runs this file (pi switched sessions inside one
  // process): one writer per JSONL.
  for (const agent of agents.values()) {
    if (!agent.exited && agent.sessionFile === file) return agent;
  }

  // No `cwd`: nsh defaults to the app's data directory, a granted root. pi
  // resumes the *session's* folder from its file header, and refuses a session
  // whose folder is gone ("Stored session working directory does not exist"),
  // which is exactly the refusal the composer shows.
  const agent = await SessionAgent.start({ sessionFile: file });
  try {
    await agent.state();
  } catch (cause) {
    agent.dispose();
    throw cause;
  }
  register(sessionId, agent);
  return agent;
}

function register(sessionId: string, agent: SessionAgent): void {
  agents.set(sessionId, agent);
  listRevision += 1;
  agent.onExit((exit) => {
    if (agents.get(sessionId) === agent) {
      agents.delete(sessionId);
      listRevision += 1;
    }
    if (exit.code !== 0 && exit.stderr.trim() !== "") {
      // A session that died on its own: the window's log is the only place the
      // reason survives (`GET /api/agent/[id]` then answers `{ running: false }`).
      console.log(`[agent] ${sessionId} stopped (exit ${exit.code ?? "?"}): ${exit.stderr.trim()}`);
    }
  });
}
