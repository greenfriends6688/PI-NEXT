// fork:builtin-subagent-disable — upstream-port marker
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  initTheme,
  SessionManager,
  SettingsManager,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike } from "./pi-types";
import {
  subagentNotificationText,
  subagentToolDetails,
  type ResumeSubagentRequest,
  type StartSubagentRequest,
  type SubagentExecution,
  type SubagentExtensionRuntime,
} from "./subagent-extension";
import {
  readSubagentRun,
  resolveSubagentProfile,
  SUBAGENT_CONTROL_TOOL_NAMES,
  SUBAGENT_META_TYPE,
  SUBAGENT_STATUS_TYPE,
  SUBAGENT_RESULT_TYPE,
  selectSubagentExtensionTools,
  withSubagentExtensionTools,
  type SubagentMetadata,
  type SubagentResultMetadata,
  type SubagentRunInfo,
} from "./subagents";
import type { SessionEntry } from "./types";
import { buildSubagentPromptPlan } from "./subagent-prompt";
import { appendSubagentInputFiles, loadSubagentInputFiles } from "./subagent-input";
// PR-36 · 显式 thinkingLevel 按子代理模型归一化；收敛计数复用同一份活跃状态口径。
import { toThinkingModelFields } from "./thinking-profile";
import { normalizeSubagentThinkingLevel } from "./subagent-thinking";
import { filterActiveSubagents } from "./subagent-convergence";
import { projectTrustReloadOptions } from "./project-trust";
import { resolveShellTools } from "./powershell-settings";
import { isBuiltInSubagentsEnabled, readSubagentSettings } from "./subagent-settings";
import { SubagentQueue } from "./subagent-queue";
import { addWorktree, removeWorktree } from "./worktree";
import { createExactSystemPromptExtension } from "./exact-system-prompt";
import { randomUUID } from "node:crypto";

interface HostSession {
  readonly inner: AgentSessionLike;
  readonly sessionFile: string;
  readonly cwd: string;
  isAlive(): boolean;
  isRunning(): boolean;
  waitUntilReady(): Promise<void>;
}

export interface SubagentRuntimeDependencies {
  getSession(sessionId: string): HostSession | undefined;
  registerSession(
    inner: AgentSessionLike,
    options?: { exactSystemPrompt?: string; chatOnly?: boolean },
  ): void;
  reopenSession(sessionId: string, sessionFile: string): Promise<HostSession>;
  resolveSessionPath(sessionId: string): Promise<string | null>;
  invalidateSessionList(): void;
  isBuiltInSubagentsEnabled?(): boolean;
}

export interface SubagentController {
  readonly extensionRuntime: SubagentExtensionRuntime;
  get(sessionId: string): Promise<SubagentRunInfo | null>;
  steer(sessionId: string, message: string): Promise<void>;
  /** fork:agent-mail —— 给任意活着的会话送旁路消息。 */
  deliver(sessionId: string, content: string, details?: unknown): Promise<void>;
  abort(sessionId: string): Promise<void>;
}

type StoredSubagentExecution = {
  run: SubagentRunInfo;
  completion: Promise<SubagentRunInfo>;
  abortRequested: boolean;
  cancelQueued?: () => boolean;
};

declare global {
  var __piSubagentRuns: Map<string, StoredSubagentExecution> | undefined;
  var __piSubagentQueue: SubagentQueue<SubagentRunInfo> | undefined;
  var __piSubagentConsumedResults: Map<string, string> | undefined;
}
const SUBAGENT_CONTEXT_LIMIT = 50_000;
/** fork:agent-mail —— agent↔agent 旁路消息在会话文件里的类型名。 */
const SUBAGENT_MAIL_TYPE = "pi-web:subagent-mail";
const PARENT_IDLE_POLL_MS = 200;
const THINKING_LEVELS = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

// fork:upstream-0.9.2-subagent-errors — #886 移植：provider 报错按失败上报
/** pi's agent loop records provider failures as an assistant message with `stopReason: "error"` and resolves `prompt()` normally; surface that as a failed run. */
function lastAssistantError(sessionManager: { getEntries?: () => unknown }): string | undefined {
  const entries = sessionManager.getEntries?.();
  if (!Array.isArray(entries)) return undefined;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i] as { type?: unknown; message?: { role?: unknown; stopReason?: unknown; errorMessage?: unknown } };
    if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
    if (entry.message.stopReason !== "error") return undefined;
    return typeof entry.message.errorMessage === "string" && entry.message.errorMessage ? entry.message.errorMessage : "Provider returned an error";
  }
  return undefined;
}

function getSubagentRuns(): Map<string, StoredSubagentExecution> {
  if (!globalThis.__piSubagentRuns) globalThis.__piSubagentRuns = new Map();
  return globalThis.__piSubagentRuns;
}

function getSubagentQueue(): SubagentQueue<SubagentRunInfo> {
  if (!globalThis.__piSubagentQueue) globalThis.__piSubagentQueue = new SubagentQueue();
  return globalThis.__piSubagentQueue;
}

// fork:upstream-subagent-0.9.2-subagent-notify — #937 移植 / #987 移植（c8ff7e8）
type SubagentRunIdentity = Pick<SubagentRunInfo, "sessionId" | "completedAt">;

/**
 * 父会话已经用 `get_subagent_result` 取回过的**后台 run**的终态结果，
 * 按子会话 id 存，并记下被取回的那次 run 的 `completedAt`。`resume` 复用同一个
 * session id，所以这个标记必须指名到 run：父会话在通知**已经送达之后**才轮询，
 * 会留下一条没人消费的标记，光记 session id 就会把它下一次 run 的通知一起吞掉
 * （#987）。`resume` **故意不清**这条：父会话可能同一轮里既取回结果又 resume，
 * 那时这次 run 的通知还压着，标记必须继续压住它（#889）。只记后台 run（前台 run
 * 从不通知），且每个 session 最多一条。
 */
function getConsumedSubagentResults(): Map<string, string> {
  // fork:upstream-subagent-notify — 热重载可能在 globalThis 上留下 #987 之前的 Set，
  // 换掉它，不要在 Set 上调 Map 方法。
  if (!(globalThis.__piSubagentConsumedResults instanceof Map)) globalThis.__piSubagentConsumedResults = new Map();
  return globalThis.__piSubagentConsumedResults;
}

function markResultConsumed(run: SubagentRunIdentity): void {
  // 没有 completedAt 的终态 run（interrupted）从不通知，没什么可丢的。
  if (!run.completedAt) return;
  getConsumedSubagentResults().set(run.sessionId, run.completedAt);
}

/** 只在标记指的**就是**这次 run 时才取走；上一次 run 留下的标记一律忽略。 */
function takeResultConsumed(run: SubagentRunIdentity): boolean {
  const consumed = getConsumedSubagentResults();
  if (!run.completedAt || consumed.get(run.sessionId) !== run.completedAt) return false;
  consumed.delete(run.sessionId);
  return true;
}

/**
 * fork:upstream-subagent-orphan-run — #990 移植（00156d5）
 *
 * 一条 run 从派发到结果 entry 落盘一直待在内存表里，所以一条**持久化的
 * `running` / `queued`** 状态走到 `get()` 时既没有表项、也没有在跑的 wrapper，
 * 只可能是进程在 run 中途停了，永远不会收尾。报成 `interrupted`（工具本来就会
 * 把它渲染成「was interrupted before completion」），于是
 * `get_subagent_result({ wait: true })` 会返回而不是永远轮询，run 也能被 resume。
 */
function settleOrphanedRun(run: SubagentRunInfo): SubagentRunInfo {
  return run.status === "running" || run.status === "queued" ? { ...run, status: "interrupted" } : run;
}

function parseSubagentModel(runtime: ModelRuntime, value: string | undefined) {
  if (!value?.trim()) return undefined;
  const requested = value.trim();
  const slash = requested.indexOf("/");
  if (slash > 0) {
    const provider = requested.slice(0, slash);
    const modelId = requested.slice(slash + 1);
    const model = runtime.getModel(provider, modelId);
    if (!model) throw new Error(`Subagent model not found: ${requested}`);
    return model;
  }
  const matches = runtime.getModels().filter((model) => model.id === requested);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new Error(`Subagent model not found: ${requested}`);
  throw new Error(`Subagent model is ambiguous; use provider/modelId: ${requested}`);
}

function parentContextText(parent: HostSession): string {
  const messages = parent.inner.sessionManager.buildSessionContext().messages;
  const serialized = JSON.stringify(messages);
  if (serialized.length <= SUBAGENT_CONTEXT_LIMIT) return serialized;
  return `${serialized.slice(0, SUBAGENT_CONTEXT_LIMIT)}\n[Parent context truncated]`;
}

async function cleanupWorktree(
  parentCwd: string,
  worktree: { path: string; branch: string } | undefined,
): Promise<string | undefined> {
  if (!worktree) return undefined;
  try {
    await removeWorktree(parentCwd, worktree.path);
    return undefined;
  } catch (error) {
    return `Worktree retained at ${worktree.path}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function createSubagentController(
  dependencies: SubagentRuntimeDependencies,
): SubagentController {
  async function start(request: StartSubagentRequest): Promise<SubagentExecution> {
    const enabled = dependencies.isBuiltInSubagentsEnabled ?? isBuiltInSubagentsEnabled;
    if (!enabled()) throw new Error("PI NEXT built-in sub-agents are disabled");
    const parentSessionId = request.parentContext.sessionManager.getSessionId();
    const parent = dependencies.getSession(parentSessionId);
    if (!parent?.isAlive()) throw new Error("Parent session is no longer available");
    if (!parent.sessionFile) throw new Error("Parent session must be persisted before starting a subagent");

    let isolatedWorktree: { path: string; branch: string } | undefined;
    try {
      const profile = resolveSubagentProfile(parent.cwd, request.profile);
      if (!profile) throw new Error(`Unknown or disabled subagent profile: ${request.profile}`);

      const runInBackground = request.runInBackground ?? profile.runInBackground;
      const isolation = profile.isolation === "off" ? undefined : request.isolation ?? profile.isolation;
      if (isolation === "worktree") {
        isolatedWorktree = await addWorktree(parent.cwd, `pi-web-agent-${randomUUID()}`);
      }
      const childCwd = isolatedWorktree?.path ?? parent.cwd;
      const inheritContext = request.inheritContext ?? profile.inheritContext;
      const maxTurns = request.maxTurns ?? profile.maxTurns;
      if (maxTurns !== undefined && (!Number.isFinite(maxTurns) || maxTurns < 0)) {
        throw new Error("max_turns must be a non-negative number");
      }
      const turnLimit = maxTurns && maxTurns > 0 ? Math.floor(maxTurns) : undefined;
      const parentModelRuntime = (parent.inner as unknown as { modelRuntime: ModelRuntime }).modelRuntime;
      // PR-36 · thinkingLevel 归一化要先知道子代理模型。显式请求（工具参数或 profile）
      // 才做归一化；两者都没有时保持 undefined，让新会话走自己的默认值，不拿父会话
      // 的档位去覆盖它。
      const requestedThinking = request.thinking ?? profile.thinking;
      if (requestedThinking && !THINKING_LEVELS.has(requestedThinking as ThinkingLevel)) {
        throw new Error(`Invalid subagent thinking level: ${requestedThinking}`);
      }
      const requestedModel = parseSubagentModel(parentModelRuntime, request.model ?? profile.model);
      const parentModel = parent.inner.model as ReturnType<ModelRuntime["getModel"]>;
      const childModel = requestedModel ?? parentModel;
      const thinking = requestedThinking && childModel
        ? normalizeSubagentThinkingLevel(
            requestedThinking,
            toThinkingModelFields(childModel),
            childModel.thinkingLevelMap ?? {},
          )
        : undefined;

      const agentDir = getAgentDir();
      const settingsManager = SettingsManager.create(childCwd, agentDir);
      const inheritedParentContext = inheritContext
        ? `The following is the active conversation context from the parent session. Use it only as background for the delegated task:\n${parentContextText(parent)}`
        : undefined;
      const inputFiles = loadSubagentInputFiles(parent.cwd, request.inputFiles ?? []);
      const promptPlan = buildSubagentPromptPlan({
        profileSystemPrompt: profile.systemPrompt,
        tools: profile.tools,
        loadSkills: profile.loadSkills,
        loadExtensions: profile.loadExtensions,
        promptMode: profile.promptMode,
        task: appendSubagentInputFiles(request.task, inputFiles),
        inheritedParentContext,
      });
      const { chatOnly, appendSystemPrompt, delegatedTask } = promptPlan;
      if (!chatOnly) initTheme();
      const services = await createAgentSessionServices({
        cwd: childCwd,
        agentDir,
        modelRuntime: parentModelRuntime,
        settingsManager,
        resourceLoaderOptions: {
          noExtensions: !profile.loadExtensions,
          noSkills: !profile.loadSkills,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          ...(chatOnly || promptPlan.exactSystemPrompt !== undefined
            ? {
                systemPrompt: " ",
                systemPromptOverride: () => undefined,
              }
            : {}),
          appendSystemPrompt,
          // The exact prompt is sent through before_agent_start; see lib/exact-system-prompt.ts.
          ...(promptPlan.exactSystemPrompt !== undefined
            ? { extensionFactories: [createExactSystemPromptExtension(() => promptPlan.exactSystemPrompt)] }
            : {}),
        },
        ...((profile.loadExtensions || profile.loadSkills)
          ? { resourceLoaderReloadOptions: projectTrustReloadOptions(childCwd, agentDir) }
          : {}),
      });

      const extensionToolNames = profile.loadExtensions
        ? profile.extensionTools?.length
          ? selectSubagentExtensionTools(
            services.resourceLoader.getExtensions().extensions,
            profile.extensionTools,
            profile.disallowedExtensionTools,
          )
          : services.resourceLoader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()])
        : [];
      const activeTools = resolveShellTools(
        withSubagentExtensionTools(profile.tools, extensionToolNames),
        settingsManager.getDefaultTools(),
      );

      const sessionManager = isolatedWorktree
        ? SessionManager.create(childCwd, undefined, { parentSession: parent.sessionFile })
        : SessionManager.create(parent.cwd, undefined, { parentSession: parent.sessionFile });
      const createdAt = new Date().toISOString();
      const metadata: SubagentMetadata = {
        version: 1,
        parentSessionId,
        parentSessionPath: parent.sessionFile,
        parentToolCallId: request.parentToolCallId,
        profile: profile.name,
        description: request.description.trim() || profile.displayName,
        task: request.task,
        runInBackground,
        createdAt,
        resourceSnapshot: {
          version: 1,
          appendSystemPrompt: [...appendSystemPrompt],
          tools: [...activeTools],
          loadSkills: profile.loadSkills,
        loadExtensions: profile.loadExtensions,
        ...(promptPlan.exactSystemPrompt !== undefined ? { exactSystemPrompt: promptPlan.exactSystemPrompt } : {}),
        },
        ...(isolatedWorktree ? { worktreePath: isolatedWorktree.path, worktreeBranch: isolatedWorktree.branch } : {}),
      };
      sessionManager.appendCustomEntry(SUBAGENT_META_TYPE, metadata);
      sessionManager.appendSessionInfo(metadata.description);

      const { session: inner } = await createAgentSessionFromServices({
        services,
        sessionManager,
        model: requestedModel ?? parentModel,
        ...(thinking ? { thinkingLevel: thinking as ThinkingLevel } : {}),
        tools: activeTools,
        excludeTools: [...SUBAGENT_CONTROL_TOOL_NAMES],
      });
      dependencies.registerSession(inner, {
        ...(promptPlan.exactSystemPrompt !== undefined
          ? { exactSystemPrompt: promptPlan.exactSystemPrompt }
          : {}),
        chatOnly,
      });

      const initialRun: SubagentRunInfo = {
        sessionId: inner.sessionId,
        sessionPath: inner.sessionFile ?? sessionManager.getSessionFile() ?? "",
        parentSessionId,
        parentToolCallId: request.parentToolCallId,
        profile: profile.name,
        description: metadata.description,
        task: request.task,
        runInBackground,
        status: "queued",
        createdAt,
        ...(isolatedWorktree ? { worktreePath: isolatedWorktree.path, worktreeBranch: isolatedWorktree.branch } : {}),
      };

      let turnCount = 0;
      let maxTurnsReached = false;
      let softLimitReached = false;
      const unsubscribeTurns = turnLimit
        ? inner.subscribe((event) => {
            if (event.type !== "turn_end") return;
            turnCount += 1;
            if (!softLimitReached && turnCount >= turnLimit) {
              softLimitReached = true;
              void inner.steer("You have reached your turn limit. Wrap up immediately and provide your final answer now.");
            } else if (softLimitReached && turnCount >= turnLimit + 1) {
              maxTurnsReached = true;
              void inner.abort();
            }
          })
        : () => {};
      let resolveCompletion!: (run: SubagentRunInfo) => void;
      const completion = new Promise<SubagentRunInfo>((resolve) => { resolveCompletion = resolve; });
      const stored: StoredSubagentExecution = {
        run: initialRun,
        completion,
        abortRequested: false,
      };
      getSubagentRuns().set(initialRun.sessionId, stored);
      request.onUpdate?.(initialRun);
      dependencies.invalidateSessionList();

      const handleParentAbort = () => {
        stored.abortRequested = true;
        if (stored.run.status === "queued") stored.cancelQueued?.();
        else void inner.abort();
      };
      if (!runInBackground) request.signal?.addEventListener("abort", handleParentAbort, { once: true });

      const execute = async (): Promise<SubagentRunInfo> => {
        if (stored.abortRequested) {
          const result: SubagentRunInfo = { ...initialRun, status: "aborted", completedAt: new Date().toISOString() };
          sessionManager.appendCustomEntry(SUBAGENT_RESULT_TYPE, { version: 1, status: "aborted", completedAt: result.completedAt });
          await cleanupWorktree(parent.cwd, isolatedWorktree);
          stored.run = result;
          request.onUpdate?.(result);
          getSubagentRuns().delete(initialRun.sessionId);
          dependencies.invalidateSessionList();
          return result;
        }
        stored.run = { ...stored.run, status: "running" };
        sessionManager.appendCustomEntry(SUBAGENT_STATUS_TYPE, { version: 1, status: "running" });
        request.onUpdate?.(stored.run);
        dependencies.invalidateSessionList();
        let result: SubagentRunInfo;
        try {
          await inner.prompt(delegatedTask, {
            source: "rpc",
          });
          const text = inner.getLastAssistantText()?.trim();
          const aborted = stored.abortRequested && !maxTurnsReached;
          const providerError = aborted ? undefined : lastAssistantError(sessionManager);
          result = {
            ...initialRun,
            status: aborted ? "aborted" : providerError ? "failed" : "completed",
            completedAt: new Date().toISOString(),
            ...(text ? { result: text } : {}),
            ...(providerError ? { error: providerError } : {}),
          };
        } catch (error) {
          const text = inner.getLastAssistantText()?.trim();
          const aborted = stored.abortRequested || request.signal?.aborted;
          result = {
            ...initialRun,
            status: aborted ? "aborted" : maxTurnsReached ? "completed" : "failed",
            completedAt: new Date().toISOString(),
            ...(text ? { result: text } : {}),
            ...(!aborted && !maxTurnsReached
              ? { error: error instanceof Error ? error.message : String(error) }
              : {}),
          };
        } finally {
          unsubscribeTurns();
          request.signal?.removeEventListener("abort", handleParentAbort);
        }

        const cleanupError = await cleanupWorktree(parent.cwd, isolatedWorktree);
        if (cleanupError) result = { ...result, worktreeCleanupError: cleanupError };
        const persisted: SubagentResultMetadata = {
          version: 1,
          status: result.status as SubagentResultMetadata["status"],
          completedAt: result.completedAt!,
          ...(result.result ? { result: result.result } : {}),
          ...(result.error ? { error: result.error } : {}),
          ...(result.worktreeCleanupError ? { worktreeCleanupError: result.worktreeCleanupError } : {}),
        };
        sessionManager.appendCustomEntry(SUBAGENT_RESULT_TYPE, persisted);
        stored.run = result;
        request.onUpdate?.(result);
        getSubagentRuns().delete(initialRun.sessionId);
        dependencies.invalidateSessionList();
        return result;
      };

      const finishQueuedAbort = async () => {
        if (stored.run.status !== "queued") return;
        const result: SubagentRunInfo = { ...initialRun, status: "aborted", completedAt: new Date().toISOString() };
        const cleanupError = await cleanupWorktree(parent.cwd, isolatedWorktree);
        const finalResult = cleanupError ? { ...result, worktreeCleanupError: cleanupError } : result;
        sessionManager.appendCustomEntry(SUBAGENT_RESULT_TYPE, { version: 1, status: "aborted", completedAt: finalResult.completedAt, ...(cleanupError ? { worktreeCleanupError: cleanupError } : {}) });
        stored.run = finalResult;
        request.onUpdate?.(finalResult);
        getSubagentRuns().delete(initialRun.sessionId);
        dependencies.invalidateSessionList();
        resolveCompletion(finalResult);
      };
      const queued = getSubagentQueue().enqueue(
        parentSessionId,
        readSubagentSettings().maxConcurrent,
        execute,
        (state) => {
          if (state === "queued") {
            sessionManager.appendCustomEntry(SUBAGENT_STATUS_TYPE, { version: 1, status: "queued" });
          }
          request.onUpdate?.({ ...stored.run, status: state });
          stored.run = { ...stored.run, status: state };
          dependencies.invalidateSessionList();
        },
        finishQueuedAbort,
      );
      stored.cancelQueued = queued.cancel;
      void queued.promise.then(resolveCompletion, (error) => {
        resolveCompletion({ ...initialRun, status: "failed", completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
      });

      return { run: stored.run, completion: stored.completion };
    } catch (error) {
      if (isolatedWorktree) {
        try { await removeWorktree(parent.cwd, isolatedWorktree.path); } catch { /* preserve setup failure and avoid force deletion */ }
      }
      throw error;
    }
  }

  async function resume(request: ResumeSubagentRequest): Promise<SubagentExecution> {
    const enabled = dependencies.isBuiltInSubagentsEnabled ?? isBuiltInSubagentsEnabled;
    if (!enabled()) throw new Error("PI NEXT built-in sub-agents are disabled");
    const parentSessionId = request.parentContext.sessionManager.getSessionId();
    const existing = await get(request.sessionId);
    if (!existing) throw new Error(`Subagent not found: ${request.sessionId}`);
    if (existing.parentSessionId !== parentSessionId) throw new Error("Subagent does not belong to this parent session");
    if (existing.status === "running" || existing.status === "queued") throw new Error("Subagent is already running");
    const parent = dependencies.getSession(parentSessionId);
    if (!parent?.isAlive()) throw new Error("Parent session is no longer available");
    const sessionPath = existing.sessionPath || await dependencies.resolveSessionPath(request.sessionId);
    if (!sessionPath) throw new Error(`Subagent session file not found: ${request.sessionId}`);
    let wrapper = dependencies.getSession(request.sessionId);
    if (!wrapper?.isAlive()) wrapper = await dependencies.reopenSession(request.sessionId, sessionPath);
    if (!wrapper.isAlive()) throw new Error("Subagent session is no longer available");
    if (wrapper.isRunning()) throw new Error("Subagent is already running");

    const runInBackground = request.runInBackground ?? existing.runInBackground;
    const initialRun: SubagentRunInfo = {
      ...existing,
      parentToolCallId: request.parentToolCallId,
      task: request.task,
      description: request.description.trim() || existing.description,
      runInBackground,
      status: "queued",
      completedAt: undefined,
      result: undefined,
      error: undefined,
      // fork:upstream-subagent-resumed-notice — #991 移植（2a71c57）
      resumed: true,
    };
    const manager = wrapper.inner.sessionManager;
    let resolveCompletion!: (run: SubagentRunInfo) => void;
    const completion = new Promise<SubagentRunInfo>((resolve) => { resolveCompletion = resolve; });
    const stored: StoredSubagentExecution = { run: initialRun, completion, abortRequested: false };
    getSubagentRuns().set(request.sessionId, stored);
    request.onUpdate?.(initialRun);
    dependencies.invalidateSessionList();
    const handleParentAbort = () => {
      stored.abortRequested = true;
      if (stored.run.status === "queued") stored.cancelQueued?.();
      else void wrapper!.inner.abort();
    };
    if (!runInBackground) request.signal?.addEventListener("abort", handleParentAbort, { once: true });

    const execute = async (): Promise<SubagentRunInfo> => {
      if (stored.abortRequested) {
        const result: SubagentRunInfo = { ...initialRun, status: "aborted", completedAt: new Date().toISOString() };
        manager.appendCustomEntry(SUBAGENT_RESULT_TYPE, { version: 1, status: "aborted", completedAt: result.completedAt });
        stored.run = result;
        getSubagentRuns().delete(request.sessionId);
        resolveCompletion(result);
        return result;
      }
      stored.run = { ...stored.run, status: "running" };
      manager.appendCustomEntry(SUBAGENT_STATUS_TYPE, { version: 1, status: "running" });
      request.onUpdate?.(stored.run);
      let result: SubagentRunInfo;
      try {
        await wrapper!.inner.prompt(request.task, { source: "rpc" });
        const text = wrapper!.inner.getLastAssistantText()?.trim();
        // fork:upstream-0.9.2-subagent-errors — #886 移植
        const providerError = stored.abortRequested ? undefined : lastAssistantError(manager);
        result = {
          ...initialRun,
          status: stored.abortRequested ? "aborted" : providerError ? "failed" : "completed",
          completedAt: new Date().toISOString(),
          ...(text ? { result: text } : {}),
          ...(providerError ? { error: providerError } : {}),
        };
      } catch (error) {
        result = {
          ...initialRun,
          status: stored.abortRequested || request.signal?.aborted ? "aborted" : "failed",
          completedAt: new Date().toISOString(),
          ...(!stored.abortRequested && !request.signal?.aborted ? { error: error instanceof Error ? error.message : String(error) } : {}),
        };
      } finally {
        request.signal?.removeEventListener("abort", handleParentAbort);
      }
      manager.appendCustomEntry(SUBAGENT_RESULT_TYPE, {
        version: 1,
        status: result.status as "completed" | "failed" | "aborted",
        completedAt: result.completedAt!,
        ...(result.result ? { result: result.result } : {}),
        ...(result.error ? { error: result.error } : {}),
      });
      stored.run = result;
      request.onUpdate?.(result);
      getSubagentRuns().delete(request.sessionId);
      dependencies.invalidateSessionList();
      return result;
    };
    const finishQueuedAbort = () => {
      if (stored.run.status !== "queued") return;
      const result: SubagentRunInfo = { ...initialRun, status: "aborted", completedAt: new Date().toISOString() };
      manager.appendCustomEntry(SUBAGENT_RESULT_TYPE, { version: 1, status: "aborted", completedAt: result.completedAt });
      stored.run = result;
      request.onUpdate?.(result);
      getSubagentRuns().delete(request.sessionId);
      dependencies.invalidateSessionList();
      resolveCompletion(result);
    };
    const queued = getSubagentQueue().enqueue(parentSessionId, readSubagentSettings().maxConcurrent, execute, (state) => {
      if (state === "queued") manager.appendCustomEntry(SUBAGENT_STATUS_TYPE, { version: 1, status: "queued" });
      stored.run = { ...stored.run, status: state };
      request.onUpdate?.(stored.run);
      dependencies.invalidateSessionList();
    }, finishQueuedAbort);
    stored.cancelQueued = queued.cancel;
    void queued.promise.then(resolveCompletion, (error) => resolveCompletion({ ...initialRun, status: "failed", completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }));
    return { run: stored.run, completion };
  }

  async function get(sessionId: string): Promise<SubagentRunInfo | null> {
    const stored = getSubagentRuns().get(sessionId);
    if (stored) return stored.run;
    const wrapper = dependencies.getSession(sessionId);
    if (wrapper?.isAlive()) {
      const run = readSubagentRun(
        wrapper.inner.sessionManager.getEntries() as unknown as SessionEntry[],
        sessionId,
        wrapper.sessionFile,
      );
      if (run && wrapper.isRunning()) return { ...run, status: "running" };
      if (run) return settleOrphanedRun(run);
    }
    const sessionPath = await dependencies.resolveSessionPath(sessionId);
    if (!sessionPath) return null;
    const manager = SessionManager.open(sessionPath);
    const run = readSubagentRun(manager.getEntries() as unknown as SessionEntry[], sessionId, sessionPath);
    return run && settleOrphanedRun(run);
  }

  async function steer(sessionId: string, message: string): Promise<void> {
    const wrapper = dependencies.getSession(sessionId);
    if (!wrapper?.isAlive() || !wrapper.isRunning()) throw new Error("Subagent is not running");
    if (!message.trim()) throw new Error("Steering message is required");
    await wrapper.inner.steer(message.trim());
  }

  async function notifyParent(run: SubagentRunInfo): Promise<void> {
    // fork:upstream-0.9.2-subagent-notify — #937 移植：已取回则不送；父会话忙时先等空闲
    if (takeResultConsumed(run)) return;
    let parent = dependencies.getSession(run.parentSessionId);
    if (!parent?.isAlive()) {
      const sessionFile = await dependencies.resolveSessionPath(run.parentSessionId);
      if (!sessionFile) throw new Error(`Parent session not found: ${run.parentSessionId}`);
      parent = await dependencies.reopenSession(run.parentSessionId, sessionFile);
    }
    await parent.waitUntilReady();
    // The parent may still be inside the `get_subagent_result` call that collects this result,
    // and `deliverAs: "followUp"` would only queue the message until that turn ends anyway.
    // Hold the notification until the parent is idle and re-check the mark, so a result the
    // parent already consumed never triggers a duplicate turn.
    while (parent.isAlive() && parent.isRunning()) {
      if (takeResultConsumed(run)) return;
      await new Promise<void>((resolve) => { setTimeout(resolve, PARENT_IDLE_POLL_MS); });
    }
    if (takeResultConsumed(run)) return;
    if (!parent.isAlive()) throw new Error(`Parent session is no longer available: ${run.parentSessionId}`);
    await parent.inner.sendCustomMessage({
      customType: "pi-web:subagent-notification",
      content: subagentNotificationText(run),
      display: true,
      details: subagentToolDetails(run),
    }, { deliverAs: "followUp", triggerTurn: true });
  }

  /**
   * fork:agent-mail —— 给**任意**活着的会话送一条消息（父 / 兄弟 / 自己）。
   *
   * `notifyParent()` 是专用版：它要避开重复唤醒，所以会先等父会话空闲。信箱没有这个
   * 约束 —— 发信的人不该为了收信的人闲下来而卡住 —— 所以直接 `deliverAs: "followUp"`，
   * pi 自己排到当前这轮结束时送进去。
   */
  async function deliver(sessionId: string, content: string, details?: unknown): Promise<void> {
    const wrapper = dependencies.getSession(sessionId);
    if (!wrapper?.isAlive()) throw new Error(`Session is not available: ${sessionId}`);
    if (!content.trim()) throw new Error("Message is required");
    await wrapper.waitUntilReady();
    await wrapper.inner.sendCustomMessage({
      customType: SUBAGENT_MAIL_TYPE,      content,
      display: true,
      ...(details === undefined ? {} : { details }),
    }, { deliverAs: "followUp", triggerTurn: true });
  }

  async function abort(sessionId: string): Promise<void> {    const wrapper = dependencies.getSession(sessionId);
    const stored = getSubagentRuns().get(sessionId);
    if (stored?.run.status === "queued") {
      stored.abortRequested = true;
      if (!stored.cancelQueued?.()) throw new Error("Subagent is no longer queued");
      return;
    }
    if (!wrapper?.isAlive() || !wrapper.isRunning()) throw new Error("Subagent is not running");
    if (stored) stored.abortRequested = true;
    await wrapper.inner.abort();
  }

  /**
   * PR-36 · 同一父会话里仍处于 starting/queued/running 的 run。纯函数负责过滤，
   * 这里只把注册表里的 `StoredSubagentExecution` 拆成 `run`。
   */
  async function listActive(parentSessionId: string): Promise<SubagentRunInfo[]> {
    const runs = [...getSubagentRuns().values()].map((stored) => stored.run);
    return filterActiveSubagents(runs, parentSessionId);
  }

  return {
    extensionRuntime: { start, resume, get, listActive, steer, notifyParent, markResultConsumed, deliver },
    get,
    steer,
    deliver,
    abort,
  };
}
