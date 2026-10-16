import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionUIContext,
  type FileEntry,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ChatMessage, ThinkingTiming } from "@shared/types";
import { isAbortOutcome } from "@shared/abort";
import { readDefaultModel } from "../engine/runtime-settings";
import { currentAiLanguageDirective, currentCustomSystemPrompt } from "../engine/ai-language";
import { uiText } from "../engine/ui-text";
import { mapEngineMessages } from "../engine/map-messages";
import type { PinextPaths } from "../engine/paths";
import { SubagentManager } from "../engine/subagents";
import { DAG_WORKER_TOOLS, DAG_COORDINATOR_TOOLS, dagReportExtension, dagInputAllowance, estimateDagTokens } from "./dag-node-runtime";
import type { DagReport } from "../../shared/dag";
import { resolveSubagentModel } from "./subagent-model";
import { SubagentControl } from "./subagent-control";
import {
  guardSessionListener,
  sessionCompletionTimes,
  sessionEntryIds,
  slimStreamEvent,
  summarizeSubagentMessages,
  type SubagentHostUsage,
} from "./process-manager-events";
import { builtinExtensionFile } from "./extension-manager";
import { createAgentMailExtension } from "../pinext/agent-mail/extension.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type SubagentHostRequest = {
  /** `${parentToolCallId}:${index}` — the same id the tool-call tracker mints. */
  subagentId: string;
  agent: string;
  agentSource?: "user" | "project";
  task: string;
  systemPrompt: string;
  /**
   * Hand the parent conversation over as background, as pi-web's `inherit_context` does.
   *
   * Off unless the role asks for it. A delegated run normally shares nothing with its
   * parent, which is what makes the brief in the tool call the whole task; a role that
   * wants the parent's history says so in its own file.
   */
  inheritContext?: boolean;
  tools?: string[];
  model?: string;
  fallbackModel?: string;
  thinkingLevel?: ThinkingLevel;
  cwd: string;
  signal?: AbortSignal;
  /**
   * Continue a run that already finished, instead of starting a fresh one.
   *
   * A delegated session is `SessionManager.inMemory` — nothing is on disk — so its history
   * lives only as long as this process remembers it. `#subagentHistories` is that memory:
   * the entries a finished run left behind, which seed the new in-memory session so the
   * agent remembers what it did instead of being asked to start over.
   *
   * The profile (system prompt, tools, model) still comes from the caller: a resume is the
   * same role continuing, and reading the old resource policy back would need it persisted.
   */
  resumeFrom?: string;
  dag?: {
    coordinator?: boolean;
    skills?: boolean;
    acceptance?: string;
    tools?: ToolDefinition[];
    prepareTask: (handoffChars: number) => string;
    childrenReady: () => boolean;
    onCheckpoint?: () => void;
    onUsage?: (usage: { tokens: number; turns: number }) => void;
  };
};

export type SubagentHostResponse = {
  report?: DagReport;
  messages: unknown[];
  exitCode: number;
  usage: SubagentHostUsage;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
};

type ReasoningBlocks = { blocks: ThinkingTiming[] };

/** How much of a parent conversation may be handed to a child, in characters. pi-web's number. */
const PARENT_CONTEXT_LIMIT = 50_000;

export type SubagentRunHost = {
  runtime: ModelRuntime | null;
  models: ModelRegistry | null;
  cwd: string;
  paths: PinextPaths;
  subagentManager: SubagentManager;
  subagentControls: Map<string, SubagentControl>;
  subagentSessions: Map<string, AgentSession>;
  subagentMessages: Map<string, ChatMessage[]>;
  subagentReasoning: Map<string, Map<string, ThinkingTiming[]>>;
  reasoningRun: Map<string, ReasoningBlocks>;
  stoppedSubagents: Set<string>;
  emit(event: Record<string, unknown>): void;
  resolvePendingUi(conversationId?: string, owner?: string): void;
  extensionUi(conversationId: string, owner: string): ExtensionUIContext;
  publishSubagentState(subagentId: string, conversationId: string, session: AgentSession): void;
  /**
   * Deliver a message into a live session, as a follow-up turn.
   *
   * The mailbox stores first and calls this second, so a target that has already finished
   * still has the message waiting rather than losing it.
   */
  wakeSession(sessionId: string, text: string): Promise<void>;
  /**
   * The parent conversation's messages, serialized, for a role that asked to inherit them.
   *
   * Answered by the manager because the session map is its own; this file only knows how to
   * run a child. `undefined` when the conversation is not loaded, which reads downstream as
   * "nothing to inherit" rather than a failure.
   */
  parentContext?(conversationId: string): Promise<string | undefined>;
  folderPrompt?(cwd: string): Promise<string | undefined>;
  timeReasoning(
    key: string,
    event: AgentSessionEvent,
    session: AgentSession,
    now: number,
    file: (entryId: string, blocks: ThinkingTiming[]) => void,
  ): void;
  fileSubagentReasoning(subagentId: string, entryId: string, blocks: ThinkingTiming[]): void;
  withThinkingTiming(key: string, event: AgentSessionEvent, payload: Record<string, unknown>): void;
};

/** The delegated-run loop, split out of `PiProcessManager` so the host file can stay about sessions. */
export class SubagentTurnRunner {
  #host: SubagentRunHost;
  #runtime: ModelRuntime | null;
  #models: ModelRegistry | null;
  #cwd: string;
  #paths: PinextPaths;
  #subagentManager: SubagentManager;
  #subagentControls: Map<string, SubagentControl>;
  #subagentSessions: Map<string, AgentSession>;
  #subagentMessages: Map<string, ChatMessage[]>;
  /**
   * What a finished run's session held, kept so `resumeFrom` can continue it.
   *
   * A delegated session is `SessionManager.inMemory`, so its entries exist only here. Only
   * terminal runs are kept — a live one is still reachable through `#subagentSessions` —
   * and the map is bounded because a long conversation delegates many times.
   */
  #subagentHistories: Map<string, FileEntry[]> = new Map();
  #subagentReasoning: Map<string, Map<string, ThinkingTiming[]>>;
  #reasoningRun: Map<string, ReasoningBlocks>;
  #stoppedSubagents: Set<string>;

  constructor(host: SubagentRunHost) {
    this.#host = host;
    this.#runtime = host.runtime;
    this.#models = host.models;
    this.#cwd = host.cwd;
    this.#paths = host.paths;
    this.#subagentManager = host.subagentManager;
    this.#subagentControls = host.subagentControls;
    this.#subagentSessions = host.subagentSessions;
    this.#subagentMessages = host.subagentMessages;
    this.#subagentReasoning = host.subagentReasoning;
    this.#reasoningRun = host.reasoningRun;
    this.#stoppedSubagents = host.stoppedSubagents;
  }

  #emit(event: Record<string, unknown>): void {
    this.#host.emit(event);
  }

  #resolvePendingUi(conversationId?: string, owner?: string): void {
    this.#host.resolvePendingUi(conversationId, owner);
  }

  #extensionUi(conversationId: string, owner: string = conversationId): ExtensionUIContext {
    return this.#host.extensionUi(conversationId, owner);
  }

  #publishSubagentState(subagentId: string, conversationId: string, session: AgentSession): void {
    this.#host.publishSubagentState(subagentId, conversationId, session);
  }

  #timeReasoning(
    key: string,
    event: AgentSessionEvent,
    session: AgentSession,
    now: number,
    file: (entryId: string, blocks: ThinkingTiming[]) => void,
  ): void {
    this.#host.timeReasoning(key, event, session, now, file);
  }

  #fileSubagentReasoning(subagentId: string, entryId: string, blocks: ThinkingTiming[]): void {
    this.#host.fileSubagentReasoning(subagentId, entryId, blocks);
  }

  #withThinkingTiming(key: string, event: AgentSessionEvent, payload: Record<string, unknown>): void {
    this.#host.withThinkingTiming(key, event, payload);
  }

  /**
   * Run one subagent role to completion on a throwaway session.
   *
   * The whole point is context isolation: the role gets its own session, its own
   * system prompt and only the tools its definition allows, and streams its
   * events back under `subagent_event` so the right pane can show the transcript.
   * A throwaway `DefaultResourceLoader` loads no Pinext extension (no recursion,
   * no goal) except `folder-consent`, which only primes macOS folder access.
   */
  /**
   * The parent conversation as background for a role that asked for it.
   *
   * pi-web's wording, kept word for word because the first sentence is the whole point: a
   * child handed a transcript will otherwise read it as its own task and answer the parent's
   * last question instead of the one it was given. **Use it only as background** is not
   * decoration; it is what makes the inherited history safe to hand over.
   *
   * Bounded like pi-web's, at the same 50,000 characters: a long parent would otherwise be
   * the child's entire context window before its brief is read.
   */
  async #parentContext(conversationId: string): Promise<string | undefined> {
    const serialized = await this.#host.parentContext?.(conversationId);
    if (!serialized) return undefined;
    const bounded = serialized.length <= PARENT_CONTEXT_LIMIT
      ? serialized
      : `${serialized.slice(0, PARENT_CONTEXT_LIMIT)}\n[Parent context truncated]`;
    return `The following is the active conversation context from the parent session. Use it only as background for the delegated task:\n${bounded}`;
  }

  async #runSubagent(conversationId: string, request: SubagentHostRequest): Promise<SubagentHostResponse> {
    const { subagentId } = request;
    const lifecycle = (status: string, error?: string): void => {
      this.#emit({ type: "subagent_lifecycle", subagentId, conversationId, agent: request.agent, name: request.agent, status, detail: request.task, ...(error ? { error } : {}) });
    };
    const control = new SubagentControl(request.signal, () => this.#resolvePendingUi(undefined, subagentId));
    this.#subagentControls.set(subagentId, control);
    let session: AgentSession | undefined;
    let unsubscribe: (() => void) | undefined;
    let thrown: unknown;
    let stopReason: string | undefined;
    let errorMessage: string | undefined;
    let messages: unknown[] = [];
    let summary = summarizeSubagentMessages([]);
    let usedModel: string | undefined;
    let report: DagReport | undefined;
    const metered = new WeakSet<object>();
    const spent = { turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    try {
      lifecycle("running");
      control.check();
      if (!this.#runtime || !this.#models) throw new Error("engine not ready");
      const cwd = request.cwd || this.#cwd;
      const settingsManager = SettingsManager.create(cwd, this.#paths.agentDir);
      const folderConsent = builtinExtensionFile("folder-consent.ts");
      // A delegated run never loads the `output-language` extension (`noExtensions`), so
      // its system prompt carries the same AI 偏好语言 requirement directly — a subagent
      // report the user cannot read is a bug, not a preference.
      const folderPrompt = await this.#host.folderPrompt?.(cwd);
      const appendSystemPrompt = [
        request.systemPrompt.trim(),
        currentAiLanguageDirective(),
        currentCustomSystemPrompt(),
        folderPrompt,
        request.inheritContext ? await this.#parentContext(conversationId) : undefined,
      ].filter(
        (value): value is string => Boolean(value),
      );
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir: this.#paths.agentDir,
        settingsManager,
        noExtensions: true,
        noThemes: true,
        noPromptTemplates: true,
        noSkills: !request.dag?.skills,
        additionalExtensionPaths: [folderConsent, ...(request.dag ? [builtinExtensionFile("dag.ts")] : [])].filter((path): path is string => Boolean(path)),
        // agent ↔ agent 的信箱 (fork:agent-mail)。子代理能拿到的三个既有工具都只能
        // 「被父操作」；这一个让它能主动说话 —— 问一句、报告一个发现、给兄弟提个醒。
        extensionFactories: [
          ...(request.dag ? [{ name: "dag-report", factory: dagReportExtension({
            acceptance: request.dag.acceptance,
            report: (value) => { report = value; },
            childrenReady: request.dag.childrenReady,
          }) }, { name: "dag-granted-tools", factory: (pi: ExtensionAPI) => {
            for (const tool of request.dag?.tools ?? []) pi.registerTool({ ...tool, exposure: "direct" });
          } }] : []),
          createAgentMailExtension({
            self: subagentId,
            parent: conversationId,
            label: request.agent,
            // 唤醒父会话：与其它注入同一条路。
            wake: async (sessionId, text) => {
              await this.#host.wakeSession(sessionId, text);
            },
          }),
        ],
        ...(appendSystemPrompt.length > 0 ? { appendSystemPrompt } : {}),
      });
      await loader.reload();
      control.check();

      // A role's configured model wins when it is available and authenticated. An empty
      // role setting inherits the parent conversation's model, keeping delegation on the
      // gateway the user just proved works; the user's default model is the last resort
      // for a parent session that has no usable model of its own.
      const preferred = readDefaultModel(this.#paths);
      const configuredModel = this.#subagentManager.modelFor(request.agent, request.model, request.agentSource);
      const thinkingLevel = this.#subagentManager.thinkingLevelFor(request.agent, request.thinkingLevel, request.agentSource);
      const model = this.#resolveSubagentModel(
        configuredModel,
        request.fallbackModel ?? (preferred ? `${preferred.provider}/${preferred.id}` : undefined),
      );
      const tools =
        request.tools && request.tools.length > 0
          ? request.tools
          : ["read", "bash", "edit", "write", "grep", "find", "ls"];
      usedModel = model ? `${model.provider}/${model.id}` : undefined;
      const created = await createAgentSession({
        cwd,
        agentDir: this.#paths.agentDir,
        modelRuntime: this.#runtime,
        sessionManager: SessionManager.inMemory(cwd, undefined, request.resumeFrom ? this.#subagentHistories.get(request.resumeFrom) : undefined),
        settingsManager,
        resourceLoader: loader,
        tools: request.dag ? [...tools, ...(request.dag.coordinator ? DAG_COORDINATOR_TOOLS : DAG_WORKER_TOOLS)] : tools,
        ...(model ? { model } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      });
      session = created.session;
      control.bind(session);
      const activeSession = session;
      // A resumed run starts from the entries the previous one left; drop them now so a
      // second resume does not read a list this run is about to extend.
      if (request.resumeFrom) this.#subagentHistories.delete(request.resumeFrom);
      // Bind the parent's UI so a prompt raised inside the run renders in the same
      // composer panel as the parent's own.
      await session.bindExtensions({ mode: "rpc", uiContext: this.#extensionUi(conversationId, subagentId) });
      if (request.dag) session.setActiveToolsByName([...tools, ...(request.dag.coordinator ? DAG_COORDINATOR_TOOLS : DAG_WORKER_TOOLS)]);
      this.#subagentSessions.set(subagentId, session);
      this.#publishSubagentState(subagentId, conversationId, activeSession);
      unsubscribe = activeSession.subscribe(guardSessionListener(`subagent ${subagentId}`, (event) => {
        // Time each thinking block as it streams. A delegated run's transcript has no
        // measured bounds of its own, so without this its thinking row could only ever
        // fall back to the span of the whole round-trip — and while that round-trip was
        // still running there was nothing to fall back to at all.
        if (request.dag && event.type === "message_start" && event.message.role === "user") report = undefined;
        if (request.dag && event.type === "turn_end") {
          try { request.dag.onCheckpoint?.(); } catch (error) { console.warn("[dag] checkpoint failed", error); }
        }
        if (request.dag && event.type === "message_end" && event.message.role === "assistant" && !metered.has(event.message)) {
          metered.add(event.message);
          const usage = summarizeSubagentMessages([event.message]).usage;
          for (const field of Object.keys(spent) as Array<keyof typeof spent>) spent[field] += usage[field];
          request.dag.onUsage?.({ turns: spent.turns, tokens: spent.input + spent.output + spent.cacheRead + spent.cacheWrite });
        }
        const now = Date.now();
        this.#timeReasoning(subagentId, event, activeSession, now, (entryId, blocks) =>
          this.#fileSubagentReasoning(subagentId, entryId, blocks),
        );
        // The bounds belong on the *inner* event: the renderer re-applies that object
        // (`applySubagentStream` unwraps `event.event`), and `stampThinkingTiming`
        // reads them off whatever it was handed.
        const nested = slimStreamEvent(event as unknown as Record<string, unknown>);
        this.#withThinkingTiming(subagentId, event, nested);
        this.#emit({ type: "subagent_event", subagentId, conversationId, event: nested });
        // The context window moves at every turn boundary, exactly as it does on the
        // main thread, so the read-only composer's ring is refreshed from the same
        // point rather than only when the run ends.
        if (event.type === "turn_end" || event.type === "agent_start" || event.type === "agent_settled") {
          this.#publishSubagentState(subagentId, conversationId, activeSession);
        }
      }));
      control.check();
      let task = request.task;
      if (request.dag) {
        const toolSchemas = session.getAllTools().filter((tool) => session!.getActiveToolNames().includes(tool.name));
        const allowance = dagInputAllowance(session.systemPrompt, JSON.stringify(toolSchemas), model?.contextWindow);
        task = request.dag.prepareTask(Math.min(16000, Math.max(0, Math.floor((allowance - estimateDagTokens(request.dag.prepareTask(0))) / 2))));
        if (estimateDagTokens(task) > allowance) throw new Error("任务输入超过上下文预算；请缩短任务或项目说明。项目规则没有被自动删减。");
      }
      await session.prompt(task);
      if (request.dag && !control.aborted && !report) throw new Error("子任务未提交 dag_report，不能确认已完成；检查执行记录后重试");
    } catch (error) {
      thrown = error;
    }
    unsubscribe?.();
    try {
      if (session) {
        messages = session.messages.slice();
        summary = summarizeSubagentMessages(messages);
        if (session.model) usedModel = `${session.model.provider}/${session.model.id}`;
        // `message_end` is slimmed for IPC, so the live stream is the only in-flight
        // transcript; persist the mapped session here so a tab opened after the run
        // still has the full reply (tools and parts included). The sub-session is
        // in-memory, but its entries still carry the persist instant, so a completed
        // pane's footer reads the same as a persisted transcript's.
        const subEntryIds = sessionEntryIds(session);
        this.#subagentMessages.set(
          subagentId,
          mapEngineMessages(
            messages,
            (message) => subEntryIds.get(message),
            this.#subagentReasoning.get(subagentId),
            undefined,
            sessionCompletionTimes(session),
          ),
        );
        this.#publishSubagentState(subagentId, conversationId, session);
      }
    } catch (error) {
      thrown ??= error;
    } finally {
      this.#subagentReasoning.delete(subagentId);
    }
    // A run cut off mid-thought (aborted, torn down) never emits the `message_end` that
    // would have dropped this, and the key is the run id — nothing else will reuse it.
    this.#reasoningRun.delete(subagentId);
    stopReason = control.aborted ? "aborted" : thrown ? (isAbortOutcome(thrown) ? "aborted" : "error") : summary.stopReason;
    errorMessage = thrown ? (thrown instanceof Error ? thrown.message : String(thrown)) : summary.errorMessage;
    if (report && report.outcome !== "completed" && !control.aborted && !thrown) { stopReason = "error"; errorMessage = report.summary; }
    // A user stop and a parent abort both arrive as `aborted`, but only the first has a
    // waiting parent to tell, and it is the message the main agent reads back as the
    // tool result. Forced, not merely relabelled: the abort can surface here as a
    // thrown error (`thrown` above), and the tool result must still say the user
    // stopped it rather than name an engine failure.
    if (this.#stoppedSubagents.delete(subagentId)) {
      stopReason = "aborted";
      errorMessage = uiText("已被用户终止", "Stopped by the user");
    }
    const failed = stopReason === "error" || stopReason === "aborted";
    // Keep what this run held, so `resume` can continue it. Read before the session is
    // released below, and only from a session that actually existed — a run that failed
    // during setup has nothing to continue from.
    if (session) {
      try {
        this.#subagentHistories.set(subagentId, session.sessionManager.getEntries());
        this.#trimSubagentHistories();
      } catch {
        // A session that cannot hand back its entries simply cannot be resumed.
      }
    }
    try {
      // Cache and state land before the terminal event: a pane reacting to it can
      // now read the complete transcript, never a half-finalised live session.
      lifecycle(stopReason === "aborted" ? "aborted" : failed ? "error" : "completed", errorMessage);
    } finally {
      control.dispose();
      this.#subagentControls.delete(subagentId);
      this.#subagentSessions.delete(subagentId);
      this.#resolvePendingUi(undefined, subagentId);
      session?.dispose();
    }

    return {
      messages,
      ...(report ? { report } : {}),
      exitCode: failed ? 1 : 0,
      usage: summary.usage,
      model: usedModel,
      stopReason,
      errorMessage,
    };
  }

  /**
   * Resolve a subagent's model: the preferred spec first, else the fallback.
   *
   * A spec is only honored when this install can actually authenticate it: the
   * catalog (`getAll()`) carries every reseller's models, and a spec that points at
   * an unreachable vendor would otherwise be picked and fail the whole delegation
   * with "No API key found". A spec may omit its provider; an id with no usable auth
   * falls back instead of failing.
   */
  #resolveSubagentModel(spec?: string, fallback?: string): ReturnType<ModelRegistry["find"]> {
    return resolveSubagentModel(this.#models, spec, fallback);
  }

  /**
   * How many finished runs stay resumable.
   *
   * A conversation delegates many times and each kept history is a whole transcript, so an
   * unbounded map is a leak that only shows up in a long session. Oldest first — a run
   * somebody wants back is nearly always a recent one.
   */
  static #HISTORY_LIMIT = 32;

  #trimSubagentHistories(): void {
    while (this.#subagentHistories.size > SubagentTurnRunner.#HISTORY_LIMIT) {
      const oldest = this.#subagentHistories.keys().next();
      if (oldest.done) return;
      this.#subagentHistories.delete(oldest.value);
    }
  }

  run(conversationId: string, request: SubagentHostRequest): Promise<SubagentHostResponse> {
    return this.#runSubagent(conversationId, request);
  }
}
