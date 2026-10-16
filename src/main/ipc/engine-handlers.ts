import { Ipc } from "@shared/ipc";
import type { ImportSourceId } from "@shared/types";
import { handle } from "./registry";
import { uiText } from "../engine/ui-text";
import { fetchPackageCatalog } from "../pi/package-catalog";
import { getPinextPaths } from "../engine/paths";
import { syncPinextConfigToPi } from "../engine/sync-pi-config";
import type { PiProcessManager } from "../pi/process-manager";

/**
 * The few capabilities only a desktop host has.
 *
 * A native directory dialog and opening a path with the OS's default program are the
 * only two things in the engine table that reach outside Node — everything else is the
 * engine and its files. They arrive as an object rather than an
 * `import { dialog, shell } from "electron"` so this module can be loaded by the
 * headless Agent and the browser entry, which reuse the same registration below.
 * When the host is absent the two methods refuse with a readable sentence instead of
 * silently succeeding or crashing.
 */
export type EngineIpcHost = {
  /** Native directory picker. Absent on a headless/browser host; that method then refuses. */
  pickDirectory?: (payload: { title: string }) => Promise<string | null>;
  /** Open an artifact with the system's default program. No such thing in a browser. */
  openPath?: (path: string) => Promise<void>;
};

/** One sentence for a method that exists on every client but can only *act* on a desktop. */
function desktopOnly(): Error {
  return new Error(
    uiText(
      "该功能需要桌面应用，浏览器里没有",
      "This feature requires the desktop app and is not available in the browser",
    ),
  );
}

/**
 * Register engine/session IPC without mixing it into the Electron bootstrap.
 *
 * Electron-free on purpose: the headless Agent and the browser entry call this very
 * function, so the same methods exist on every client, and a method added here cannot
 * silently go missing from the browser (the bug where `engine:export-html-document`
 * answered `unknown method`). The desktop passes its `dialog` / `shell`; the others pass
 * nothing and get a refusal for the two methods that need them.
 */
export function registerEngineIpc(engine: PiProcessManager, host: EngineIpcHost = {}): void {
  handle(Ipc.engineSubmitPrompt, (payload: Parameters<typeof engine.submitPrompt>[0]) => engine.submitPrompt(payload));
  handle(Ipc.engineGetStatus, () => engine.status);

  handle(Ipc.engineStart, async (payload?: { cwd?: string }) => {
    return engine.start(payload?.cwd ?? engine.cwd);
  });

  handle(Ipc.engineStop, async () => {
    await engine.stop();
    return engine.status;
  });

  handle(
    Ipc.enginePrompt,
    async (
      payload: {
        message: string;
        streamingBehavior?: "steer" | "followUp";
        images?: Array<{ type: "image"; data: string; mimeType: string }>;
        /** Omitted by single-window callers, which mean "the chat on screen". */
        conversationId?: string;
      },
    ) => {
      await engine.prompt(payload.message, {
        streamingBehavior: payload.streamingBehavior,
        images: payload.images,
        conversationId: payload.conversationId,
      });
    },
  );

  handle(
    Ipc.engineSteer,
    async (
      payload: { message: string; images?: Array<{ type: "image"; data: string; mimeType: string }>; conversationId?: string },
    ) => {
      await engine.steer(payload.message, payload.images, payload.conversationId);
    },
  );

  handle(
    Ipc.engineFollowUp,
    async (
      payload: { message: string; images?: Array<{ type: "image"; data: string; mimeType: string }>; conversationId?: string },
    ) => {
      await engine.followUp(payload.message, payload.images, payload.conversationId);
    },
  );

  handle(Ipc.engineAbort, async (payload?: { conversationId?: string }) => {
    await engine.abort(payload?.conversationId);
  });

  handle(Ipc.engineAbortSubagent, async (payload: { subagentId: string; conversationId?: string }) => {
    await engine.abortSubagent(payload.subagentId, payload.conversationId);
  });

  handle(Ipc.engineContinue, async (payload?: { conversationId?: string }) => {
    await engine.continueTurn(payload?.conversationId);
  });

  handle(Ipc.engineClearQueue, async (payload?: { conversationId?: string }) => {
    return engine.clearQueue(payload?.conversationId);
  });

  handle(
    Ipc.engineReplaceSteering,
    async (
      payload: {
        items: Array<{ text: string; images?: Array<{ type: "image"; data: string; mimeType: string }> }>;
        conversationId?: string;
      },
    ) => {
      await engine.replaceSteering(payload.items, payload.conversationId);
    },
  );

  handle(Ipc.engineQueueAdd, async (payload: Parameters<typeof engine.enqueueMessage>[0]) => {
    return engine.enqueueMessage(payload);
  });
  handle(Ipc.engineQueueCancel, async (payload: { id: string; conversationId?: string }) => engine.cancelQueued(payload.id));
  handle(Ipc.engineQueueRecall, async (payload: { id: string; conversationId?: string }) => engine.recallQueued(payload.id));
  handle(Ipc.engineQueueSendNow, async (payload: { id: string; conversationId?: string }) => engine.sendQueuedNow(payload.id));
  handle(Ipc.engineQueueReorder, async (payload: { conversationId: string; ids: string[] }) =>
    engine.reorderQueued(payload.conversationId, payload.ids));
  handle(Ipc.engineQueueResume, async (payload: { conversationId: string }) =>
    engine.resumeQueue(payload.conversationId));

  handle(Ipc.engineCompact, async (payload?: { customInstructions?: string; conversationId?: string }) => {
    return engine.compact(payload?.customInstructions, payload?.conversationId);
  });

  handle(Ipc.engineGetCommands, async (payload?: { conversationId?: string }) => {
    return engine.getCommands(payload?.conversationId);
  });
  handle(Ipc.engineGetExtensions, async () => engine.getExtensions());
  handle(Ipc.engineListExtensionPackages, async () => engine.listExtensionPackages());
  handle(
    Ipc.engineInstallExtensionPackage,
    async (payload: { source: string }) => engine.installExtensionPackage(payload.source),
  );
  handle(
    Ipc.engineRemoveExtensionPackage,
    async (payload: { source: string }) => engine.removeExtensionPackage(payload.source),
  );
  handle(
    Ipc.engineListMarketPackages,
    async (payload: import("@shared/types").MarketPackageQuery) => fetchPackageCatalog(payload),
  );
  handle(Ipc.engineTestMcp, async (payload: { id: string }) => engine.testMcpServer(payload.id));
  handle(Ipc.engineDiscoverMcp, async () => engine.discoverMcpServers());
  handle(Ipc.engineListMcpServers, async () => engine.listMcpServers());
  handle(Ipc.engineSaveMcpServers, async (payload: { configs: import("@shared/types").McpServerConfig[] }) => engine.saveMcpServers(payload.configs));
  handle(Ipc.providersUsage, async (payload: { id: string }) => engine.getProviderUsage(payload.id));
  handle(Ipc.imagegenGet, async () => engine.getImageGen());
  handle(Ipc.imagegenSet, async (payload: { active?: unknown; providers?: unknown }) => engine.setImageGen(payload ?? {}));
  handle(Ipc.imagegenModels, async (payload: { provider?: string } | undefined) => engine.listImageGenModels(payload?.provider));
  handle(Ipc.imagegenTest, async (payload: { provider?: string } | undefined) => engine.testImageGen(payload?.provider));
  handle(Ipc.websearchGet, async () => engine.getWebSearch());
  handle(Ipc.websearchSet, async (payload: Record<string, unknown>) => engine.setWebSearch(payload ?? {}));
  handle(Ipc.botChannelGet, async () => engine.getBotChannels());
  handle(Ipc.botChannelSet, async (payload: { channels?: unknown }) => engine.setBotChannels(payload ?? {}));
  handle(Ipc.botChannelRegisterBegin, async (payload: { id: string }) => engine.beginBotChannelRegistration(payload.id));
  handle(Ipc.botChannelRegisterPoll, async (payload: { id: string }) => engine.pollBotChannelRegistration(payload.id));
  handle(Ipc.botChannelRegisterCancel, async (payload: { id: string }) => engine.cancelBotChannelRegistration(payload.id));
  handle(Ipc.botChannelStart, async (payload: { id: string }) => engine.startBotChannel(payload.id));
  handle(Ipc.botChannelStop, async (payload: { id: string }) => engine.stopBotChannel(payload.id));
  handle(Ipc.imGet, async () => engine.getImBridge());
  handle(Ipc.imSet, async (payload: { targets?: unknown }) => engine.setImBridge(payload ?? {}));
  handle(Ipc.imTest, async (payload: { targetId: string }) => engine.testImBridge(payload.targetId));
  handle(Ipc.engineReadSkill, async (payload: { name: string }) => engine.readSkill(payload.name));
  handle(Ipc.engineSaveSkill, async (payload: { name: string; content: string }) => engine.saveSkill(payload.name, payload.content));
  handle(Ipc.engineListSkills, async () => engine.listSkills());
  handle(Ipc.engineCreateSkill, async (payload: import("@shared/types").SkillDraft) => engine.createSkill(payload));
  handle(Ipc.engineImportSkill, async () => {
    const pickDirectory = host.pickDirectory;
    if (!pickDirectory) throw desktopOnly();
    const directory = await pickDirectory({ title: uiText("导入技能", "Import skill") });
    if (!directory) return null;
    return engine.importSkill(directory);
  });
  handle(Ipc.engineRemoveSkill, async (payload: { name: string }) => engine.removeSkill(payload.name));

  handle(Ipc.engineGetSubagents, async (payload?: { conversationId?: string }) => {
    return engine.getSubagents(payload?.conversationId);
  });
  handle(Ipc.engineListAgentConfigs, () => engine.getAgentConfigs());
  handle(Ipc.engineSaveAgentConfig, (payload: import("@shared/types").SubagentDraft) => engine.saveAgentConfig(payload));
  handle(Ipc.engineRemoveAgentConfig, (payload: { id: string }) => engine.removeAgentConfig(payload.id));
  handle(Ipc.engineSetAgentEnabled, (payload: { id: string; enabled: boolean }) => engine.setAgentEnabled(payload.id, payload.enabled));

  handle(Ipc.engineGetSubagentMessages, async (payload: { subagentId: string; conversationId?: string }) => {
    return engine.getSubagentMessages(payload.subagentId, payload.conversationId);
  });

  handle(Ipc.engineGetCheckpoint, (payload: { conversationId: string }) => {
    return engine.getCheckpoint(payload.conversationId);
  });

  handle(Ipc.engineRestoreCheckpoint, async (payload: { conversationId: string }) => {
    return engine.restoreCheckpoint(payload.conversationId);
  });

  handle(Ipc.conversationsSearch, (payload: { query?: string }) => {
    return engine.searchConversations(payload?.query ?? "");
  });

  handle(
    Ipc.enginePermissionRespond,
    (payload: { id: string; confirmed?: boolean; value?: string; cancelled?: boolean; answers?: Array<string | null>}) => {
      engine.respondPermission(payload);
    },
  );

  handle(Ipc.engineNewSession, async () => {
    await engine.newSession();
  });

  handle(Ipc.engineGetState, async (payload?: { conversationId?: string }) => {
    return engine.getState(payload?.conversationId);
  });

  handle(Ipc.engineGetRunning, async () => {
    return engine.getRunningConversations();
  });

  handle(Ipc.engineGetPendingUi, () => engine.getPendingUi());

  handle(Ipc.engineGetModels, async () => {
    return engine.getAvailableModels();
  });

  handle(
    Ipc.engineSetModel,
    async (payload: { provider: string; modelId: string; conversationId?: string }) => {
      return engine.setModel(payload.provider, payload.modelId, payload.conversationId);
    },
  );

  handle(
    Ipc.engineSetThinking,
    async (payload: { level: string; conversationId?: string }) => {
      return engine.setThinkingLevel(payload.level, payload.conversationId);
    },
  );
  handle(Ipc.engineSetInterrupt, async (payload: { mode: "immediate" | "wait"; conversationId?: string }) => {
    return engine.setInterruptMode(payload.mode, payload.conversationId);
  });
  handle(Ipc.engineSetAutoCompact, async (payload: { enabled: boolean; conversationId?: string }) => {
    return engine.setAutoCompaction(payload.enabled, payload.conversationId);
  });
  handle(Ipc.engineBranch, async (payload: { entryId: string; conversationId?: string }) => {
    return engine.branch(payload.entryId, payload.conversationId);
  });
  handle(Ipc.engineFork, async (payload?: { entryId?: string; conversationId?: string }) => {
    return engine.fork(payload?.entryId, payload?.conversationId);
  });
  handle(Ipc.engineGetMessages, async (payload?: { conversationId?: string }) => {
    return engine.loadMessages(payload?.conversationId);
  });
  handle(Ipc.engineGetMessagesSince, async (payload?: { anchorEntryId?: string; conversationId?: string }) => {
    const anchor = payload?.anchorEntryId;
    if (!anchor) return { mode: "full", messages: await engine.loadMessages(payload?.conversationId) };
    return engine.loadMessagesSince(anchor, payload?.conversationId);
  });
  handle(Ipc.engineGetSnapshot, async (payload?: { conversationId?: string; fromEntryId?: string; historyLimit?: number; toolDetail?: unknown }) => {
    const toolDetail = payload?.toolDetail === "summary" ? "summary" : undefined;
    return toolDetail
      ? engine.getSnapshot(payload?.conversationId, payload?.fromEntryId, payload?.historyLimit, toolDetail)
      : engine.getSnapshot(payload?.conversationId, payload?.fromEntryId, payload?.historyLimit);
  });
  handle(Ipc.engineGetMessagesPage, (payload: import("../../shared/transcript-page").TranscriptPageRequest) => {
    const toolDetail = payload.toolDetail === "summary" ? "summary" : undefined;
    return toolDetail
      ? engine.getMessagesPage(payload.conversationId, payload.beforeEntryId, payload.turnLimit, toolDetail)
      : engine.getMessagesPage(payload.conversationId, payload.beforeEntryId, payload.turnLimit);
  });
  handle(Ipc.engineGetStats, async (payload?: { conversationId?: string }) => {
    return engine.getSessionStats(payload?.conversationId);
  });
  handle(Ipc.engineSetSteering, async (payload: { mode: "all" | "one-at-a-time"; conversationId?: string }) => {
    return engine.setSteeringMode(payload.mode, payload.conversationId);
  });
  handle(Ipc.engineSetFollowUp, async (payload: { mode: "all" | "one-at-a-time"; conversationId?: string }) => {
    return engine.setFollowUpMode(payload.mode, payload.conversationId);
  });
  // Markdown 只回一个字符串（HTML 那条会把文件写到运行服务端的机器上并打开它）。
  handle(Ipc.engineExportMarkdown, async () => engine.exportMarkdown());
  handle(Ipc.engineExportHtml, async () => {
    const path = await engine.exportHtml();
    if (path) {
      const openPath = host.openPath;
      if (!openPath) throw desktopOnly();
      await openPath(path);
    }
    return path;
  });
  handle(Ipc.engineExportHtmlDocument, async (payload: { conversationId?: string } | undefined) =>
    engine.exportHtmlDocument(payload?.conversationId),
  );
  // 设置 → 导入. Read-only scans of the other agents' data plus an explicit import;
  // nothing here runs on the live engine, so a scan cannot disturb the chat in flight.
  handle(Ipc.engineImportSources, async () => engine.importSources());
  handle(Ipc.engineImportCandidates, async (payload: { source: ImportSourceId }) =>
    engine.importCandidates(payload.source),
  );
  handle(Ipc.engineImportSessions, async (payload: { source: ImportSourceId; ids: string[] }) =>
    engine.importSessions(payload.source, payload.ids),
  );
  // One-shot write into ~/.pi/agent. It does not touch the live engine or its sessions.
  // `replace` drops providers and MCP servers that exist only in pi; `merge` keeps them.
  handle(Ipc.engineSyncPiConfig, async (payload?: { mode?: "merge" | "replace" }) =>
    syncPinextConfigToPi(getPinextPaths(), undefined, payload?.mode === "replace" ? "replace" : "merge"),
  );

}
