import { execFile } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { VERSION as piVersion } from "@earendil-works/pi-coding-agent";
import { Ipc } from "@shared/ipc";
import type { AgentConfigSyncPayload } from "@shared/agent-config";
import type { CallerContext } from "../main/ipc/registry";
import { broadcast, subscribe } from "../main/ipc/broadcast";
import { registerDagIpc } from "../main/ipc/dag-handlers";
import { registerScheduleIpc } from "../main/ipc/schedule-handlers";
import { dispatch, handle, handlerChannels } from "../main/ipc/registry";
import type { PiProcessManager } from "../main/pi/process-manager";
import { readFilePreview } from "../main/engine/file-preview";
import { searchProjectFiles } from "../main/engine/project-files";
import { readWorkspaceDir, writeWorkspaceTextFile } from "../main/engine/workspace-fs";
import { existingFiles } from "../main/engine/path-exists";
import { conversationCwd, readFileForPayload } from "../main/engine/file-chunk";
import { readGitCommitFiles, readGitLog } from "../main/engine/git-graph";
import { checkLinkedDirectoryApproval, allowOutsideLink } from "../main/engine/linked-directory";
import { readCommitStatusFiles, collectCommitMessageMaterial } from "../main/workspace-git";
import { assertProxySettings, proxySettingsOf } from "../shared/proxy";
import { uiText } from "../main/engine/ui-text";
import type { FileMutation } from "../shared/file-mutation";
import { TerminalSessions } from "../main/engine/terminal-sessions";
import { applyLanguages } from "../main/engine/ai-language";
import { rekeyProjectSettings } from "../shared/project-folders.ts";
import { clearAppSettings, invalidateAppSettingsCache, readAppSettings, writeAppSettings } from "../main/engine/runtime-settings";
import { toolModeSettingsChanged } from "../main/engine/tool-modes";
import { writeAgentConfig } from "../main/engine/runtime-config";
import type { PinextPaths } from "../main/engine/paths";
import type { GitBranch, GitDiffSource, GitStatus } from "@shared/ipc";
import type { ImportSourceId, ProviderModel, UsageRange, McpServerConfig, SkillDraft, SubagentDraft } from "@shared/types";
import type { AgentRuntime } from "./runtime";

const execFileAsync = promisify(execFile);

export type AgentIpcDeps = {
  runtime: AgentRuntime;
  terminals: TerminalSessions;
  log: { info(message: string): void; warn(message: string): void; error(message: string, error?: unknown): void };
};

/** Register the Electron-free part of the shared call table for a Linux Agent. */
export function registerAgentIpc(deps: AgentIpcDeps): void {
  const engine = deps.runtime.engine;
  const paths = deps.runtime.paths;
  const terminals = deps.terminals;

  handle(Ipc.engineGetStatus, () => engine.status);
  handle(Ipc.engineSubmitPrompt, (payload: Parameters<typeof engine.submitPrompt>[0]) => engine.submitPrompt(payload));
  handle(Ipc.engineStart, async (payload?: { cwd?: string }) => engine.start(payload?.cwd ?? engine.cwd));
  handle(Ipc.engineStop, async () => { await engine.stop(); return engine.status; });
  handle(Ipc.enginePrompt, async (payload: { message: string; streamingBehavior?: "steer" | "followUp"; images?: Array<{ type: "image"; data: string; mimeType: string }>; conversationId?: string }) => {
    await engine.prompt(payload.message, { streamingBehavior: payload.streamingBehavior, images: payload.images, conversationId: payload.conversationId });
  });
  handle(Ipc.engineSteer, async (payload: { message: string; images?: Array<{ type: "image"; data: string; mimeType: string }>; conversationId?: string }) => engine.steer(payload.message, payload.images, payload.conversationId));
  handle(Ipc.engineFollowUp, async (payload: { message: string; images?: Array<{ type: "image"; data: string; mimeType: string }>; conversationId?: string }) => engine.followUp(payload.message, payload.images, payload.conversationId));
  handle(Ipc.engineAbort, async (payload?: { conversationId?: string }) => engine.abort(payload?.conversationId));
  handle(Ipc.engineAbortSubagent, async (payload: { subagentId: string; conversationId?: string }) => engine.abortSubagent(payload.subagentId, payload.conversationId));
  handle(Ipc.engineContinue, async (payload?: { conversationId?: string }) => engine.continueTurn(payload?.conversationId));
  handle(Ipc.engineClearQueue, async (payload?: { conversationId?: string }) => engine.clearQueue(payload?.conversationId));
  handle(Ipc.engineQueueAdd, async (payload: Parameters<typeof engine.enqueueMessage>[0]) => engine.enqueueMessage(payload));
  handle(Ipc.engineQueueCancel, async (payload: { id: string; conversationId?: string }) => engine.cancelQueued(payload.id));
  handle(Ipc.engineQueueRecall, async (payload: { id: string; conversationId?: string }) => engine.recallQueued(payload.id));
  handle(Ipc.engineQueueSendNow, async (payload: { id: string; conversationId?: string }) => engine.sendQueuedNow(payload.id));
  handle(Ipc.engineQueueReorder, async (payload: { conversationId: string; ids: string[] }) => engine.reorderQueued(payload.conversationId, payload.ids));
  handle(Ipc.engineQueueResume, async (payload: { conversationId: string }) => engine.resumeQueue(payload.conversationId));
  handle(Ipc.engineCompact, async (payload?: { customInstructions?: string; conversationId?: string }) => engine.compact(payload?.customInstructions, payload?.conversationId));
  handle(Ipc.engineGetCommands, (payload?: { conversationId?: string }) => engine.getCommands(payload?.conversationId));
  handle(Ipc.engineReplaceSteering, (payload: { items: Array<{ text: string; images?: Array<{ type: "image"; data: string; mimeType: string }> }>; conversationId?: string }) => engine.replaceSteering(payload.items, payload.conversationId));
  handle(Ipc.engineGetExtensions, () => engine.getExtensions());
  handle(Ipc.engineInstallExtensionPackage, (payload: { source: string }) => engine.installExtensionPackage(payload.source));
  handle(Ipc.engineRemoveExtensionPackage, (payload: { source: string }) => engine.removeExtensionPackage(payload.source));
  handle(Ipc.engineListExtensionPackages, () => engine.listExtensionPackages());
  handle(Ipc.engineListMcpServers, () => engine.listMcpServers());
  handle(Ipc.engineSaveMcpServers, (payload: { configs: McpServerConfig[] }) => engine.saveMcpServers(payload.configs));
  handle(Ipc.engineReadSkill, (payload: { name: string }) => engine.readSkill(payload.name));
  handle(Ipc.engineSaveSkill, (payload: { name: string; content: string }) => engine.saveSkill(payload.name, payload.content));
  handle(Ipc.providersUsage, (payload: { id: string }) => engine.getProviderUsage(payload.id));
  handle(Ipc.imagegenGet, () => engine.getImageGen());
  handle(Ipc.imagegenSet, (payload: { active?: unknown; providers?: unknown }) => engine.setImageGen(payload ?? {}));
  handle(Ipc.imagegenTest, (payload: { provider?: string } | undefined) => engine.testImageGen(payload?.provider));
  handle(Ipc.websearchGet, () => engine.getWebSearch());
  handle(Ipc.websearchSet, (payload: Record<string, unknown>) => engine.setWebSearch(payload ?? {}));
  handle(Ipc.botChannelGet, () => engine.getBotChannels());
  handle(Ipc.botChannelSet, (payload: { channels?: unknown }) => engine.setBotChannels(payload ?? {}));
  handle(Ipc.botChannelStart, (payload: { id: string }) => engine.startBotChannel(payload.id));
  handle(Ipc.botChannelStop, (payload: { id: string }) => engine.stopBotChannel(payload.id));
  handle(Ipc.engineListSkills, () => engine.listSkills());
  handle(Ipc.engineCreateSkill, (payload: SkillDraft) => engine.createSkill(payload));
  handle(Ipc.engineRemoveSkill, (payload: { name: string }) => engine.removeSkill(payload.name));
  handle(Ipc.engineGetSubagents, (payload?: { conversationId?: string }) => engine.getSubagents(payload?.conversationId));
  handle(Ipc.engineListAgentConfigs, () => engine.getAgentConfigs());
  handle(Ipc.engineSaveAgentConfig, (payload: SubagentDraft) => engine.saveAgentConfig(payload));
  handle(Ipc.engineRemoveAgentConfig, (payload: { id: string }) => engine.removeAgentConfig(payload.id));
  handle(Ipc.engineGetSubagentMessages, (payload: { subagentId: string; conversationId?: string }) => engine.getSubagentMessages(payload.subagentId, payload.conversationId));
  handle(Ipc.engineGetCheckpoint, (payload: { conversationId: string }) => engine.getCheckpoint(payload.conversationId));
  handle(Ipc.engineRestoreCheckpoint, (payload: { conversationId: string }) => engine.restoreCheckpoint(payload.conversationId));
  handle(Ipc.enginePermissionRespond, (payload: { id: string; confirmed?: boolean; value?: string; cancelled?: boolean; answers?: Array<string | null>}) => engine.respondPermission(payload));
  handle(Ipc.engineNewSession, () => engine.newSession());
  handle(Ipc.engineGetState, (payload?: { conversationId?: string }) => engine.getState(payload?.conversationId));
  handle(Ipc.engineGetRunning, () => engine.getRunningConversations());
  handle(Ipc.engineGetPendingUi, () => engine.getPendingUi());
  handle(Ipc.engineGetModels, () => engine.getAvailableModels());
  handle(Ipc.engineSyncConfig, async (payload: AgentConfigSyncPayload) => {
    const expectedToken = process.env.PINEXT_AGENT_SYNC_TOKEN;
    if (!expectedToken || payload?.syncToken !== expectedToken) throw new Error("配置同步凭据无效");
    const previousSettings = readAppSettings(paths);
    const previousMcp = readFileOrEmpty(paths.mcpFile);
    const { syncToken: _syncToken, ...snapshot } = payload;
    writeAgentConfig(paths, snapshot);
    invalidateAppSettingsCache();
    const settings = readAppSettings(paths);
    applyLanguages(settings);
    await engine.reloadProviders();
    const mcpChanged = payload && "mcp" in payload && payload.mcp !== previousMcp;
    if (mcpChanged) {
      const parsed = typeof payload.mcp === "string" ? JSON.parse(payload.mcp) as unknown : [];
      await engine.saveMcpServers(Array.isArray(parsed) ? parsed : []);
    } else if (toolModeSettingsChanged(previousSettings, settings)) {
      // An MCP save already reloads every session, which re-reads these switches.
      void engine.refreshToolModes().catch(() => undefined);
    }
  });
  handle(Ipc.engineSetModel, (payload: { provider: string; modelId: string; conversationId?: string }) => engine.setModel(payload.provider, payload.modelId, payload.conversationId));
  handle(Ipc.engineSetThinking, (payload: { level: string; conversationId?: string }) => engine.setThinkingLevel(payload.level, payload.conversationId));
  handle(Ipc.engineSetInterrupt, (payload: { mode: "immediate" | "wait"; conversationId?: string }) => engine.setInterruptMode(payload.mode, payload.conversationId));
  handle(Ipc.engineSetAutoCompact, (payload: { enabled: boolean; conversationId?: string }) => engine.setAutoCompaction(payload.enabled, payload.conversationId));
  handle(Ipc.engineBranch, (payload: { entryId: string; conversationId?: string }) => engine.branch(payload.entryId, payload.conversationId));
  handle(Ipc.engineFork, (payload?: { entryId?: string; conversationId?: string }) => engine.fork(payload?.entryId, payload?.conversationId));
  handle(Ipc.engineGetMessages, (payload?: { conversationId?: string }) => engine.loadMessages(payload?.conversationId));
  handle(Ipc.engineGetSnapshot, (payload?: { conversationId?: string; fromEntryId?: string; historyLimit?: number; toolDetail?: unknown }) => {
    const toolDetail = payload?.toolDetail === "summary" ? "summary" : undefined;
    return toolDetail
      ? engine.getSnapshot(payload?.conversationId, payload?.fromEntryId, payload?.historyLimit, toolDetail)
      : engine.getSnapshot(payload?.conversationId, payload?.fromEntryId, payload?.historyLimit);
  });
  handle(Ipc.engineGetMessagesPage, (payload: import("../shared/transcript-page").TranscriptPageRequest) => {
    const toolDetail = payload.toolDetail === "summary" ? "summary" : undefined;
    return toolDetail
      ? engine.getMessagesPage(payload.conversationId, payload.beforeEntryId, payload.turnLimit, toolDetail)
      : engine.getMessagesPage(payload.conversationId, payload.beforeEntryId, payload.turnLimit);
  });
  handle(Ipc.engineGetStats, (payload?: { conversationId?: string }) => engine.getSessionStats(payload?.conversationId));
  handle(Ipc.engineSetSteering, (payload: { mode: "all" | "one-at-a-time"; conversationId?: string }) => engine.setSteeringMode(payload.mode, payload.conversationId));
  handle(Ipc.engineSetFollowUp, (payload: { mode: "all" | "one-at-a-time"; conversationId?: string }) => engine.setFollowUpMode(payload.mode, payload.conversationId));
  handle(Ipc.enginePromptConversation, (payload: { id: string; message: string; images?: Array<{ type: "image"; data: string; mimeType: string }> }) => engine.promptConversation(payload.id, payload.message, payload.images));
  handle(Ipc.engineGetConversationMessages, (payload: { id: string }) => engine.getConversationMessages(payload.id));
  // The sub-agent task graph runs inside this engine; the desktop reads and steers it through these.
  registerDagIpc(engine);
  registerScheduleIpc(engine);
  // Every change reaches every client through `memory.onChange` (wired in `index.ts`), so
  // none of these broadcasts for itself.
  handle(Ipc.memoryGetState, () => engine.memory.state());
  handle(Ipc.memorySetConfig, (payload: unknown) => engine.memory.setConfig(payload));
  handle(Ipc.memoryRun, () => engine.memory.run());
  handle(Ipc.memoryClear, () => engine.memory.clear());
  handle(Ipc.conversationsList, () => engine.listWorkspace());
  handle(Ipc.conversationsCreate, (payload?: { project?: string; activate?: boolean; reuseEmpty?: boolean }) => engine.createConversation(payload?.project, {
    activate: payload?.activate !== false,
    reuseEmpty: payload?.reuseEmpty,
  }));
  handle(Ipc.conversationsOpen, (payload: { id: string }) => engine.openConversation(payload.id));
  handle(Ipc.conversationsRename, (payload: { id: string; title: string }) => engine.renameConversation(payload.id, payload.title));
  handle(Ipc.conversationsDelete, (payload: { id: string }) => engine.deleteConversation(payload.id));
  handle(Ipc.conversationsRecordPrompt, (payload: { id: string; text: string }) => engine.recordPrompt(payload.id, payload.text));
  handle(Ipc.conversationsSetProject, (payload: { id: string; project: string | null }) => engine.setConversationProject(payload.id, payload.project));
  handle(Ipc.conversationsSearch, (payload: { query?: string }) => engine.searchConversations(payload?.query ?? ""));
  handle(Ipc.conversationsCreateSide, (payload: { project?: string; parentId?: string; title?: string }) => engine.createSideConversation(payload?.project, payload?.parentId, payload?.title));
  handle(Ipc.conversationsRestorePrompt, (payload: { id: string; expectedTitle: string; expectedPreview?: string; title: string; preview?: string }) => engine.restorePromptPreview(payload));
  handle(Ipc.conversationsCreateWorktree, (payload: { id: string; path?: string; branch?: string; label?: string }) => engine.createConversationWorktree(payload.id, payload));
  handle(Ipc.conversationsBindWorktree, (payload: { id: string; path: string }) => engine.bindConversationWorktree(payload.id, payload.path));
  handle(Ipc.conversationsUnbindWorktree, (payload: { id: string; remove?: boolean }) => engine.unbindConversationWorktree(payload.id, payload));
  handle(Ipc.conversationsListWorktrees, (payload: { id: string }) => engine.listConversationWorktrees(payload.id));
  handle(Ipc.projectsAddRemote, (payload: { cwd?: string }) => {
    const value = typeof payload?.cwd === "string" ? payload.cwd.trim() : "";
    if (!value) throw new Error("远程项目目录不能为空");
    return engine.addProject(value);
  });
  handle(Ipc.projectsRename, (payload: { cwd: string; name: string }) => engine.renameProject(payload.cwd, payload.name));
  handle(Ipc.projectsRemove, (payload: { cwd: string }) => engine.removeProject(payload.cwd));
  handle(Ipc.projectsReorder, (payload: { cwds: string[] }) => engine.reorderProjects(Array.isArray(payload?.cwds) ? payload.cwds : []));
  handle(Ipc.projectsCreate, (payload: { name?: string; folders?: string[] }) => engine.createProject(payload ?? {}));
  handle(Ipc.projectsPickFolder, () => {
    throw new Error("文件夹选择框只在桌面端可用");
  });
  handle(Ipc.projectsAddFolder, (payload: { cwd?: string; folder?: string }) => engine.addProjectFolder(payload?.cwd ?? "", payload?.folder ?? ""));
  handle(Ipc.projectsRemoveFolder, (payload: { cwd?: string; folder?: string }) => engine.removeProjectFolder(payload?.cwd ?? "", payload?.folder ?? ""));
  handle(Ipc.projectsSetPrimary, (payload: { cwd?: string; folder?: string }) => {
    const result = engine.setProjectPrimary(payload?.cwd ?? "", payload?.folder ?? "");
    if (result.previous !== result.next) {
      writeAppSettings(paths, rekeyProjectSettings(readAppSettings(paths), result.previous, result.next));
    }
    return result.snapshot;
  });
  handle(Ipc.projectsRepos, (payload: { cwd?: string }) => engine.projectRepos(payload?.cwd ?? ""));

  handle(Ipc.workspacePreview, (payload: { path: string }) => readFilePreview(payload.path));
  handle(Ipc.workspaceFilesExist, (payload: { paths?: unknown; cwd?: unknown }) =>
    existingFiles(payload?.paths, payload?.cwd),
  );
  handle(Ipc.workspaceReadDir, async (payload: { path: string }) => {
    try {
      return await readWorkspaceDir(payload.path, engine.workspaceRoots());
    } catch (error) {
      // 「目录链接指向项目外」不是「空目录」：把目标带回渲染层，让它能提「允许浏览」。
      if (error instanceof Error && error.message.startsWith("OUTSIDE_LINK:")) throw error;
      return [];
    }
  });
  handle(Ipc.workspaceSearchFiles, (payload: { cwd?: unknown; query?: unknown }) =>
    searchProjectFiles(payload?.cwd, payload?.query),
  );
  handle(Ipc.workspaceWriteFile, (payload: { path?: unknown; text?: unknown }) => {
    writeWorkspaceTextFile(payload?.path, payload?.text);
  });
  handle(Ipc.workspaceListFiles, (payload: { root: string }) => engine.listWorkspaceFiles(payload.root));
  handle(Ipc.workspaceMutate, async (payload: FileMutation) => {
    await engine.mutateWorkspaceFile(payload);
  });
  handle(Ipc.workspaceAllowLink, (payload: { path?: unknown; target?: unknown }) => {
    const check = checkLinkedDirectoryApproval(
      typeof payload?.path === "string" ? payload.path : "",
      typeof payload?.target === "string" ? payload.target : "",
      engine.workspaceRoots(),
    );
    if (!check.ok) return { ok: false, error: check.error };
    allowOutsideLink(check.target);
    return { ok: true };
  });
  handle(Ipc.workspaceReadFile, (payload: { path?: unknown; conversationId?: unknown; offset?: unknown; length?: unknown }) =>
    readFileForPayload(payload, () => conversationCwd(engine.listWorkspace(), payload?.conversationId)),
  );
  handle(Ipc.workspaceGitStatus, (payload: { cwd: string }) => readGitStatus(payload.cwd));
  handle(Ipc.workspaceGitLog, (payload: { cwd?: unknown; limit?: unknown }) =>
    readGitLog(typeof payload?.cwd === "string" ? payload.cwd : "", typeof payload?.limit === "number" ? payload.limit : undefined),
  );
  handle(Ipc.workspaceGitCommitFiles, (payload: { cwd?: unknown; hash?: unknown }) =>
    readGitCommitFiles(
      typeof payload?.cwd === "string" ? payload.cwd : "",
      typeof payload?.hash === "string" ? payload.hash : "",
    ),
  );
  handle(Ipc.workspaceGitGenerateCommitMessage, async (payload: { cwd?: unknown; conversationId?: unknown }): Promise<string> => {
    const dir = cwd(typeof payload?.cwd === "string" ? payload.cwd : "");
    if (!dir) throw new Error(uiText("项目路径无效", "Invalid project path"));
    const statusFiles = await readCommitStatusFiles(dir);
    if (statusFiles.length === 0) throw new Error(uiText("没有要提交的改动", "No changes to commit"));
    const files = await collectCommitMessageMaterial(dir, statusFiles);
    return engine.generateCommitMessage(files, typeof payload?.conversationId === "string" ? payload.conversationId : undefined);
  });
  handle(Ipc.workspaceGitBranches, (payload: { cwd: string }) => gitBranches(payload.cwd));
  handle(Ipc.workspaceGitCheckout, (payload: { cwd: string; branch: string }) => gitCheckout(payload.cwd, payload.branch));
  handle(Ipc.workspaceGitCreateBranch, (payload: { cwd: string; branch: string }) => gitCreateBranch(payload.cwd, payload.branch));
  handle(Ipc.workspaceGitStage, (payload: { cwd: string; paths?: string[]; all?: boolean }) => gitStage(payload.cwd, payload.paths, payload.all));
  handle(Ipc.workspaceGitCommit, (payload: { cwd: string; message: string }) => gitCommit(payload.cwd, payload.message));
  handle(Ipc.workspaceGitDiff, (payload: { cwd: string; path?: string; source?: GitDiffSource }) => gitDiff(payload.cwd, payload.path, payload.source));
  handle(Ipc.workspaceGitUnstage, (payload: { cwd: string; paths: string[] }) => gitUnstage(payload.cwd, payload.paths));
  handle(Ipc.workspaceGitDiscard, (payload: { cwd: string; paths: string[] }) => gitDiscard(payload.cwd, payload.paths));
  handle(Ipc.workspaceGitPull, (payload: { cwd: string }) => gitRemote(payload.cwd, "pull"));
  handle(Ipc.workspaceGitPush, (payload: { cwd: string }) => gitRemote(payload.cwd, "push"));
  handle(Ipc.workspaceTerminalStart, (payload: { cwd?: string; cols?: number; rows?: number }) => terminals.start(payload.cwd || homedir(), { cols: payload.cols, rows: payload.rows }));
  handle(Ipc.workspaceTerminalWrite, (payload: { id: string; data: string }) => terminals.write(payload.id, payload.data));
  handle(Ipc.workspaceTerminalResize, (payload: { id: string; cols: number; rows: number }) => terminals.resize(payload.id, payload.cols, payload.rows));
  handle(Ipc.workspaceTerminalKill, (payload: { id: string }) => terminals.kill(payload.id));

  handle(Ipc.settingsGet, () => readAppSettings(paths));
  handle(Ipc.settingsSet, (payload: Record<string, unknown>) => {
    const previous = readAppSettings(paths);
    const next = payload && typeof payload === "object" ? payload : {};
    writeAppSettings(paths, next);
    if (toolModeSettingsChanged(previous, next)) void engine.refreshToolModes().catch(() => undefined);
    return undefined;
  });
  handle(Ipc.settingsClear, () => {
    const previous = readAppSettings(paths);
    clearAppSettings(paths);
    if (toolModeSettingsChanged(previous, {})) void engine.refreshToolModes().catch(() => undefined);
  });
  // The headless Agent has no Chromium session to reconfigure, but the proxy fields still
  // belong in `settings.json` where the desktop reads them, and validation must not be
  // skipped just because this process will not act on them until its next start.
  handle(Ipc.settingsProxySet, (payload: Record<string, unknown>) => {
    assertProxySettings(payload);
    writeAppSettings(paths, { ...readAppSettings(paths), ...proxySettingsOf(payload) });
  });
  handle(Ipc.appGetInfo, () => ({ version: process.env.PINEXT_VERSION ?? "agent", engineVersion: piVersion, userData: paths.userData, runtimeRoot: paths.runtimeRoot, platform: process.platform }));
  // The Agent has no `logger.ts` (it imports Electron), so a renderer line is appended
  // here in the same shape the desktop writes — one file, both entries.
  handle(Ipc.appLog, (payload: unknown) => {
    const entry = payload && typeof payload === "object" ? payload as { level?: unknown; message?: unknown } : {};
    if (typeof entry.message !== "string" || !entry.message) return;
    const level = typeof entry.level === "string" && ["debug", "info", "warn", "error"].includes(entry.level) ? entry.level : "info";
    const line = `${new Date().toISOString()} [${level}] ${entry.message.slice(0, 16_384).replace(/\r?\n/g, "\\n")}\n`;
    try { appendFileSync(join(paths.logs, "renderer.log"), line); } catch { /* a log line must never fail the call */ }
  });
  handle(Ipc.workspaceFileIcons, () => ({ files: {}, folders: {} }));
  handle(Ipc.statsUsage, (_payload?: { range?: UsageRange }) => ({ range: "30d", from: "", to: "", totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tokens: 0, cost: 0, requests: 0, toolCalls: 0, activeDays: 0 }, days: [], models: [], sessions: 0, longestSessionMinutes: 0, currentStreak: 0, longestStreak: 0 }));

  handle(Ipc.providersList, () => engine.listProviders());
  handle(Ipc.providersNative, () => engine.listNativeProviders());
  handle(Ipc.providersAdd, (payload: { name: string; baseUrl: string; apiKey: string; api?: any; models: ProviderModel[] }) => engine.addProvider({ name: payload.name, baseUrl: payload.baseUrl, apiKey: payload.apiKey, api: payload.api }, payload.models));
  handle(Ipc.providersUpdate, (payload: { id: string; name?: string; baseUrl?: string; api?: any; enabled?: boolean; apiKey?: string; models?: ProviderModel[]; modelOrder?: string[] }) => engine.updateProvider(payload.id, payload));
  handle(Ipc.providersRemove, (payload: { id: string }) => engine.removeProvider(payload.id));
  handle(Ipc.providersRefresh, (payload: { id: string }) => engine.refreshProviderModels(payload.id));
  handle(Ipc.providersAddNative, (payload: { id: string; apiKey: string; models: ProviderModel[] }) => engine.addNativeProvider(payload.id, payload.apiKey, payload.models));
  handle(Ipc.providersLogout, (payload: { id: string }) => engine.logoutProvider(payload.id));
  handle(Ipc.providersQuota, (payload: { id: "openai" | "openai-codex"; force?: boolean }) => engine.getOpenAIAccountQuota(payload.id, payload.force === true));
  handle(Ipc.providersFetch, (payload: { baseUrl: string; apiKey: string; api?: import("@shared/types").ProviderApi }) => engine.fetchModels(payload.baseUrl, payload.apiKey, payload.api));
  handle(Ipc.providersProbeGateway, (payload: { baseUrl: string }) => engine.probeGateway(payload.baseUrl));
  handle(Ipc.providersGatewayBalance, (payload: { id: string; force?: boolean }) => engine.getGatewayBalance(payload.id, payload.force === true));
  handle(Ipc.providersGatewayCredentials, async (payload: { id: string; accessToken: string; userId: string }) => {
    await engine.setGatewayCredentials(payload.id, { accessToken: payload.accessToken, userId: payload.userId });
  });
  handle(Ipc.providersIdentifyGateway, (payload: { id: string }) => engine.identifyGateway(payload.id));
  handle(Ipc.providersCcSwitchScan, () => engine.scanCcSwitch());
  handle(Ipc.providersCcSwitchImport, (payload: { ids: string[] }) => engine.importCcSwitch(payload.ids));
  // Subscription (OAuth) logins. `login` resolves when the flow ends, so the renderer
  // holds one open dialog per provider while its events stream in on
  // `providers:oauth-event` — the prompts it has to answer among them.
  handle(Ipc.providersOAuthLogin, (payload: { id: string }) => engine.loginProvider(payload.id));
  handle(Ipc.providersOAuthAnswer, (payload: { id: string; promptId: string; value: string }) => {
    engine.answerOAuthPrompt(payload.id, payload.promptId, payload.value ?? "");
  });
  handle(Ipc.providersOAuthCancel, (payload: { id: string }) => {
    engine.cancelOAuthLogin(payload.id);
  });
  handle(Ipc.modelsDevUpdate, () => import("../main/engine/models-dev-update").then(({ updateModelsDevSnapshot }) => updateModelsDevSnapshot()));

  // A browser has no desktop to act on: no window to move, no native dialog to answer,
  // no embedded browser to drive, no separate web server to toggle. Registering these
  // with the reason beats leaving them out, because a missing channel answers
  // `unknown method: <channel>` — an error that names neither the feature nor why it is
  // absent, and reads as a broken client rather than as a desktop-only one.
  for (const channel of AGENT_UNSUPPORTED) {
    handle(channel, () => {
      throw new Error(uiText(
        "该功能需要桌面应用，浏览器里没有",
        "This feature requires the desktop app and is not available in the browser",
      ));
    });
  }

  bindAgentPush(engine, terminals);
}

/**
 * Methods the Agent answers with a refusal rather than a result.
 *
 * They are registered (see the loop at the end of `registerAgentIpc`) so the browser
 * gets one readable sentence instead of `unknown method`, and they are listed here so
 * `test/agent-call-table.test.ts` can hold the whole call table to account.
 */
export const AGENT_UNSUPPORTED: readonly string[] = [
  // Window chrome: a browser tab has no OS window. The web client only draws a title bar
  // where `HAS_CUSTOM_TITLE_BAR` is true (Windows / Linux), and there these controls would
  // otherwise be buttons that do nothing; the remote policy also denies them outright.
  Ipc.windowNew,
  Ipc.windowMinimize,
  Ipc.windowToggleMaximize,
  Ipc.windowClose,
  Ipc.windowIsMaximized,
  // Native dialogs open on the machine running the Agent, where nobody is looking.
  Ipc.workspacePick,
  Ipc.projectsAdd,
  // Act on the desktop that is running the Agent, not on the browser's.
  Ipc.workspaceReveal,
  Ipc.workspaceOpenTerminal,
  Ipc.appExportLogs,
  // The embedded browser and its bridge live in a desktop `<webview>`.
  Ipc.browserListProfiles,
  Ipc.browserImportProfile,
  Ipc.browserClearData,
  Ipc.browserListEngines,
  Ipc.browserResponse,
  // The Agent is the web server; there is no second one to start or stop.
  Ipc.webServerGet,
  Ipc.webServerStart,
  Ipc.webServerStop,
  Ipc.webServerPort,
];

/**
 * Call-table methods that only the desktop entry serves.
 *
 * The Agent deliberately registers none of these: they are the desktop's own account,
 * SSH, remote-access and update controls, its local decision model, the import/export
 * tools that open files on the desktop, and the channels whose runtime the headless
 * Agent does not host. Listed rather than ignored so a method the desktop adds cannot
 * silently go missing from every other client — the bug this whole file exists to end.
 */
export const DESKTOP_ONLY: readonly string[] = [
  Ipc.accountGet,
  Ipc.accountLogin,
  Ipc.accountCancelLogin,
  Ipc.accountLogout,
  Ipc.botChannelRegisterBegin,
  Ipc.botChannelRegisterCancel,
  Ipc.botChannelRegisterPoll,
  Ipc.decisionGetConfig,
  Ipc.decisionKeyState,
  Ipc.decisionSaveConfig,
  Ipc.decisionSetKey,
  Ipc.decisionTest,
  Ipc.engineDiscoverMcp,
  Ipc.engineExportHtml,
  Ipc.engineExportHtmlDocument,
  Ipc.engineExportMarkdown,
  Ipc.engineGetMessagesSince,
  Ipc.engineImportCandidates,
  Ipc.engineImportSessions,
  Ipc.engineImportSkill,
  Ipc.engineImportSources,
  Ipc.engineListMarketPackages,
  Ipc.engineSetAgentEnabled,
  Ipc.engineSyncPiConfig,
  Ipc.engineTestMcp,
  Ipc.imGet,
  Ipc.imSet,
  Ipc.imTest,
  Ipc.imagegenModels,
  Ipc.remoteClearPassword,
  Ipc.remoteGetState,
  Ipc.remoteListDevices,
  Ipc.remoteOfficialDisconnect,
  Ipc.remoteRevokeDevice,
  Ipc.remoteSetDeviceName,
  Ipc.remoteSetPassword,
  Ipc.remoteStart,
  Ipc.remoteStop,
  Ipc.sshConnect,
  Ipc.sshDisconnect,
  Ipc.sshHostKeyScan,
  Ipc.sshHostKeyTrust,
  Ipc.sshHostRemove,
  Ipc.sshHostSave,
  Ipc.sshHosts,
  Ipc.sshPickIdentityFile,
  Ipc.sshSetPhoneAccess,
  Ipc.sshStartAgent,
  Ipc.sshState,
  Ipc.sshStates,
  Ipc.sshStopAgent,
  Ipc.sshTest,
  Ipc.updateCheck,
  Ipc.updateDownload,
  Ipc.updateGetState,
  Ipc.updateInstall,
];

export function agentChannels(): readonly string[] {
  return handlerChannels();
}

export function bindAgentPush(engine: PiProcessManager, terminals: TerminalSessions): void {
  engine.onStatus((status) => broadcast(Ipc.status, status));
  engine.onConversationReady((payload) => broadcast(Ipc.conversationReady, payload));
  engine.onWorkspaceChange((snapshot) => broadcast(Ipc.workspaceChanged, snapshot));
  engine.onOAuthEvent((payload) => broadcast(Ipc.providersOAuthEvent, payload));
  terminals.onData((event) => broadcast(Ipc.workspaceTerminalData, event));
  engine.onEvent((event) => {
    if (event.type === "extension_ui_request") void engine.handleExtensionUi(event);
    broadcast(Ipc.event, event);
  });
  engine.onSchedulesChanged((snapshot) => broadcast(Ipc.scheduleChanged, snapshot));
}

function readFileOrEmpty(path: string): string {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}

function cwd(value: string): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseBranchHeader(header: string): string {
  // `main...origin/main [ahead 1]`, `No commits yet on main`, `HEAD (no branch)`.
  const name = header.split("...")[0]?.split(" ")[0] ?? "";
  return name === "HEAD" ? "" : name;
}

function parseGitNumstat(output: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of output.split(/\r?\n/)) {
    const [added, removed] = line.split("\t", 3);
    if (/^\d+$/.test(added ?? "")) additions += Number(added);
    if (/^\d+$/.test(removed ?? "")) deletions += Number(removed);
  }
  return { additions, deletions };
}

async function readGitStatus(root: string): Promise<GitStatus> {
  const dir = cwd(root);
  const empty: GitStatus = { cwd: dir, isRepository: false, changed: 0, staged: 0, additions: 0, deletions: 0, files: [] };
  if (!dir) return empty;
  try {
    const { stdout } = await execFileAsync("git", ["-C", dir, "status", "--short", "--branch"], { timeout: 5000, maxBuffer: 256 * 1024 });
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    const header = lines.shift() ?? "";
    if (!header.startsWith("## ")) return empty;
    const branch = parseBranchHeader(header.slice(3));
    const ahead = Number(header.match(/ahead (\d+)/)?.[1] ?? 0);
    const behind = Number(header.match(/behind (\d+)/)?.[1] ?? 0);
    let changed = 0;
    let staged = 0;
    const files: GitStatus["files"] = [];
    for (const line of lines) {
      if (line.length < 2) continue;
      changed += 1;
      if (line[0] !== " " && line[0] !== "?") staged += 1;
      files.push({ index: line[0] === "?" ? "?" : line[0], worktree: line[1] ?? " ", path: line.slice(3).trim() });
    }
    let additions = 0;
    let deletions = 0;
    try {
      const diff = await execFileAsync("git", ["-C", dir, "diff", "--numstat", "HEAD", "--"], { timeout: 5000, maxBuffer: 256 * 1024 });
      ({ additions, deletions } = parseGitNumstat(diff.stdout));
    } catch {
      // An unborn branch has no HEAD: sum the staged and unstaged layers instead.
      const [stagedDiff, workingDiff] = await Promise.all([
        execFileAsync("git", ["-C", dir, "diff", "--numstat", "--cached", "--"], { timeout: 5000, maxBuffer: 256 * 1024 }).catch(() => ({ stdout: "" })),
        execFileAsync("git", ["-C", dir, "diff", "--numstat", "--"], { timeout: 5000, maxBuffer: 256 * 1024 }).catch(() => ({ stdout: "" })),
      ]);
      const stagedStats = parseGitNumstat(stagedDiff.stdout);
      const workingStats = parseGitNumstat(workingDiff.stdout);
      additions = stagedStats.additions + workingStats.additions;
      deletions = stagedStats.deletions + workingStats.deletions;
    }
    return { cwd: dir, isRepository: true, branch, changed, staged, additions, deletions, ahead, behind, files };
  } catch {
    return empty;
  }
}

async function gitBranches(root: string): Promise<GitBranch[]> {
  const { stdout } = await execFileAsync("git", ["-C", cwd(root), "for-each-ref", "--format=%(refname:short)\t%(HEAD)\t%(upstream:short)", "refs/heads"], { timeout: 5000, maxBuffer: 128 * 1024 });
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => { const [name, head, upstream] = line.split("\t"); return { name, current: head === "*", upstream: upstream || undefined }; });
}

async function gitCheckout(root: string, branch: string): Promise<GitStatus> { await execFileAsync("git", ["-C", cwd(root), "switch", branch], { timeout: 10000 }); return readGitStatus(root); }
async function gitCreateBranch(root: string, branch: string): Promise<GitStatus> { await execFileAsync("git", ["-C", cwd(root), "switch", "-c", branch], { timeout: 10000 }); return readGitStatus(root); }
async function gitStage(root: string, paths?: string[], all?: boolean): Promise<GitStatus> { await execFileAsync("git", ["-C", cwd(root), "add", all || !paths?.length ? "-A" : "--", ...(paths ?? [])], { timeout: 10000 }); return readGitStatus(root); }
async function gitCommit(root: string, message: string): Promise<GitStatus> { await execFileAsync("git", ["-C", cwd(root), "commit", "-m", message], { timeout: 30000 }); return readGitStatus(root); }
async function gitDiff(root: string, path?: string, source: GitDiffSource = "unstaged"): Promise<string> { const args = ["-C", cwd(root), "diff", "--no-ext-diff", "--unified=3"]; if (source === "staged") args.push("--cached"); else if (source === "branch") args.push("@{upstream}...HEAD"); else if (source === "last-turn") args.push("HEAD"); if (path) args.push("--", path); try { const { stdout } = await execFileAsync("git", args, { timeout: 10000, maxBuffer: 1024 * 1024 }); return stdout; } catch (error: any) { return typeof error?.stdout === "string" ? error.stdout : ""; } }
async function gitUnstage(root: string, paths: string[]): Promise<GitStatus> { await execFileAsync("git", ["-C", cwd(root), "restore", "--staged", "--", ...paths], { timeout: 10000 }); return readGitStatus(root); }
async function gitDiscard(root: string, paths: string[]): Promise<GitStatus> { await execFileAsync("git", ["-C", cwd(root), "restore", "--worktree", "--source=HEAD", "--", ...paths], { timeout: 10000 }); return readGitStatus(root); }
async function gitRemote(root: string, command: "pull" | "push"): Promise<GitStatus> { await execFileAsync("git", ["-C", cwd(root), command, ...(command === "pull" ? ["--ff-only"] : [])], { timeout: 60000 }); return readGitStatus(root); }
