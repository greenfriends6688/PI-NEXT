import { useSessionStore } from "@/stores/session";
import type { ChatMessage, ConversationOpenResult, EngineSessionState, PromptImage, SessionStats, TranscriptTail } from "@shared/types";

type PinextEngine = typeof window.pinext.engine;

/**
 * The engine's per-conversation calls, addressed to the chat this window has open.
 *
 * Main keeps one `AgentSession` per conversation, but the IPC channels used to say
 * only *what* to do, never *which chat* — every call resolved against one engine-wide
 * active id. That is correct for a single window and wrong the moment there are two:
 * each window has its own idea of the open chat, and whichever window called
 * `conversations.open` last owned the engine's active id, so a prompt typed in one
 * window was delivered to the other window's conversation.
 *
 * So every call that acts on a conversation now carries its id. The store's `activeId`
 * is the one this window means, read at call time rather than captured, so a switch
 * mid-flight routes the next call to the new chat. Callers that mean a *different*
 * chat (archiving a background run) pass the id explicitly.
 *
 * The engine still accepts an omitted id and falls back to its own active
 * conversation, which keeps the no-conversation case — the empty hero, settings, the
 * first prompt of a brand-new chat — working without a special branch here.
 */
function activeId(): string | undefined {
  return useSessionStore.getState().activeId ?? undefined;
}

export const engine = {
  getMessagesPage: (beforeEntryId: string, conversationId = activeId(), turnLimit?: number) => {
    if (!conversationId) return Promise.reject(new Error("No conversation selected"));
    return window.pinext.engine.getMessagesPage({ conversationId, beforeEntryId, turnLimit });
  },
  submitPrompt: (payload: Omit<Parameters<PinextEngine["submitPrompt"]>[0], "conversationId"> & { conversationId?: string }) => {
    const conversationId = payload.conversationId ?? activeId();
    if (!conversationId) return Promise.reject(new Error("No conversation selected"));
    return window.pinext.engine.submitPrompt({ ...payload, conversationId });
  },
  prompt: (
    message: string,
    options?: { streamingBehavior?: "steer" | "followUp"; images?: PromptImage[]; conversationId?: string },
  ): Promise<void> =>
    window.pinext.engine.prompt(message, {
      streamingBehavior: options?.streamingBehavior,
      images: options?.images,
      conversationId: options?.conversationId ?? activeId(),
    }),

  steer: (message: string, images?: PromptImage[], conversationId?: string): Promise<void> =>
    window.pinext.engine.steer(message, images, conversationId ?? activeId()),

  followUp: (message: string, images?: PromptImage[], conversationId?: string): Promise<void> =>
    window.pinext.engine.followUp(message, images, conversationId ?? activeId()),

  /** Stop one chat. Called with no id it stops the one on screen (the composer, Escape). */
  abort: (conversationId?: string): Promise<void> =>
    window.pinext.engine.abort(conversationId ?? activeId()),

  continue: (conversationId?: string): Promise<void> =>
    window.pinext.engine.continue(conversationId ?? activeId()),

  clearQueue: (conversationId?: string): Promise<{ steering: string[]; followUp: string[] }> =>
    window.pinext.engine.clearQueue(conversationId ?? activeId()),

  replaceSteering: (
    items: Array<{ text: string; images?: PromptImage[] }>,
    conversationId?: string,
  ): Promise<void> => window.pinext.engine.replaceSteering(items, conversationId ?? activeId()),

  compact: (customInstructions?: string, conversationId?: string): Promise<EngineSessionState> =>
    window.pinext.engine.compact(customInstructions, conversationId ?? activeId()),

  branch: (entryId: string, conversationId?: string): Promise<ChatMessage[]> =>
    window.pinext.engine.branch(entryId, conversationId ?? activeId()),

  /** Copy a chat at an entry (or its current tip) without rewinding the source chat. */
  fork: (entryId?: string, conversationId?: string): Promise<ConversationOpenResult> =>
    window.pinext.engine.fork(entryId, conversationId ?? activeId()),

  getMessages: (conversationId?: string): Promise<ChatMessage[]> =>
    window.pinext.engine.getMessages(conversationId ?? activeId()),

  getMessagesSince: (anchorEntryId: string, conversationId?: string): Promise<TranscriptTail> =>
    window.pinext.engine.getMessagesSince(anchorEntryId, conversationId ?? activeId()),

  getStats: (conversationId?: string): Promise<SessionStats> =>
    window.pinext.engine.getStats(conversationId ?? activeId()),

  getState: (conversationId?: string): Promise<EngineSessionState> =>
    window.pinext.engine.getState(conversationId ?? activeId()),

  setModel: (provider: string, modelId: string, conversationId?: string): Promise<EngineSessionState> =>
    window.pinext.engine.setModel(provider, modelId, conversationId ?? activeId()),

  setThinking: (level: string, conversationId?: string): Promise<EngineSessionState> =>
    window.pinext.engine.setThinking(level, conversationId ?? activeId()),
};

/**
 * The calls that carry no conversation: they are about the install, not a chat.
 *
 * Wrapped rather than destructured at module scope. A module-scope `const { x } =
 * window.pinext.engine` runs the moment this file is imported — before React mounts,
 * and therefore outside any error boundary — so a build where the preload bridge is not
 * up yet would throw during module evaluation and leave a blank window with nothing to
 * catch it. Reading the bridge per call moves that failure inside the tree.
 */
export const onEvent: PinextEngine["onEvent"] = (...args) => window.pinext.engine.onEvent(...args);
export const onStatus: PinextEngine["onStatus"] = (...args) => window.pinext.engine.onStatus(...args);
export const onConversationReady: PinextEngine["onConversationReady"] = (...args) =>
  window.pinext.engine.onConversationReady(...args);
export const respondPermission: PinextEngine["respondPermission"] = (...args) =>
  window.pinext.engine.respondPermission(...args);
/**
 * Newly session-scoped (parent must route by `conversationId`, including a namespaced
 * remote id): `getCommands`, `getModels`, `getSubagents`, `getSubagentMessages`,
 * `abortSubagent`. Previously they hit whichever engine was active on this machine.
 */
export const getCommands: PinextEngine["getCommands"] = (conversationId) =>
  window.pinext.engine.getCommands(conversationId ?? activeId());
export const getModels: PinextEngine["getModels"] = (conversationId) =>
  window.pinext.engine.getModels(conversationId ?? activeId());
export const getStatus: PinextEngine["getStatus"] = (...args) => window.pinext.engine.getStatus(...args);
export const start: PinextEngine["start"] = (...args) => window.pinext.engine.start(...args);
export const stop: PinextEngine["stop"] = (...args) => window.pinext.engine.stop(...args);
export const setInterruptMode: PinextEngine["setInterruptMode"] = (mode, conversationId) =>
  window.pinext.engine.setInterruptMode(mode, conversationId ?? activeId());
export const setAutoCompaction: PinextEngine["setAutoCompaction"] = (enabled, conversationId) =>
  window.pinext.engine.setAutoCompaction(enabled, conversationId ?? activeId());
export const setSteeringMode: PinextEngine["setSteeringMode"] = (mode, conversationId) =>
  window.pinext.engine.setSteeringMode(mode, conversationId ?? activeId());
export const setFollowUpMode: PinextEngine["setFollowUpMode"] = (mode, conversationId) =>
  window.pinext.engine.setFollowUpMode(mode, conversationId ?? activeId());
export const exportHtml: PinextEngine["exportHtml"] = (...args) => window.pinext.engine.exportHtml(...args);
export const abortSubagent: PinextEngine["abortSubagent"] = (subagentId, conversationId) =>
  window.pinext.engine.abortSubagent(subagentId, conversationId ?? activeId());
export const getSubagents: PinextEngine["getSubagents"] = (conversationId) =>
  window.pinext.engine.getSubagents(conversationId ?? activeId());
export const getSubagentMessages: PinextEngine["getSubagentMessages"] = (subagentId, conversationId) =>
  window.pinext.engine.getSubagentMessages(subagentId, conversationId ?? activeId());
export const getCheckpoint: PinextEngine["getCheckpoint"] = (conversationId) =>
  window.pinext.engine.getCheckpoint(conversationId);
export const restoreCheckpoint: PinextEngine["restoreCheckpoint"] = (conversationId) =>
  window.pinext.engine.restoreCheckpoint(conversationId);
export const newSession: PinextEngine["newSession"] = (...args) => window.pinext.engine.newSession(...args);
export const getRunning: PinextEngine["getRunning"] = (...args) => window.pinext.engine.getRunning(...args);
export const promptConversation: PinextEngine["promptConversation"] = (...args) =>
  window.pinext.engine.promptConversation(...args);
export const getConversationMessages: PinextEngine["getConversationMessages"] = (...args) =>
  window.pinext.engine.getConversationMessages(...args);
