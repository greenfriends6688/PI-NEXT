// The composer's store: per-session drafts, what a send is doing, the queue
// the server reports (`queue_update` / `get_state`), and the two preference
// picks the composer owns (model, thinking level, Enter mode).
//
// Module-level signals are the app's store (`skills/nsh/references/tsx.md`
// "Signals and writes"); screens read them without a prop chain. Drafts live
// in `prefs` (`src/state/prefs.ts`) under one JSON object, so a write to the
// device is debounced and a failed write only logs. Nothing here throws on a
// failed request: the error goes into the session's state and the caller keeps
// the draft.

import { signal } from "nsh";
import {
  agentState,
  promptCommand,
  sendCommand,
  type AgentImage,
  type ThinkingLevel,
} from "../api/agent";
import type { AgentStatePayload } from "../api/types";
import { errorText } from "../ui/errors";
import { t } from "../ui/i18n";
import { pref, readPref, setPref } from "./prefs";

// --- drafts ---------------------------------------------------------------

/** The one preference key holding every composer draft (`pi-web:composer-drafts`). */
export const COMPOSER_DRAFTS_PREF = "composer:drafts";

/**
 * The draft a composer writes to. A session has one draft; a composer that
 * has no session yet uses its working directory, so two composer mounts for
 * the same fresh project share it (pi's `parked-new:<cwd>` idea,
 * `lib/draft-store.ts:24-27`).
 */
export function draftKey(sessionId: string | null, cwd?: string | null): string {
  if (sessionId) return `session:${sessionId}`;
  return cwd ? `new:${cwd}` : "new";
}

/** The draft for `key`; reads the prefs signal, so a JSX binding follows it. */
export function composerDraft(key: string): string {
  const drafts = pref<Record<string, string>>(COMPOSER_DRAFTS_PREF, {});
  return drafts[key] ?? "";
}

/** Writes (or clears) one draft. The signal changes now; the disk follows (`prefs.ts`). */
export function setComposerDraft(key: string, text: string): void {
  const drafts = readPref<Record<string, string>>(COMPOSER_DRAFTS_PREF, {});
  const next = { ...drafts };
  if (text) next[key] = text;
  else delete next[key];
  setPref(COMPOSER_DRAFTS_PREF, next);
}

/** Appends one piece (an attached file's name, a recalled queue) to the draft. */
export function appendComposerDraft(key: string, text: string, separator = "\n"): void {
  const value = text.trim();
  if (!value) return;
  const current = composerDraft(key);
  setComposerDraft(key, current ? `${current}${separator}${text}` : text);
}

// --- what the server says about a session --------------------------------

/** The message queues pi keeps for a running session (`AgentStatePayload.queuedMessages`). */
export interface ComposerQueue {
  steering: string[];
  followUp: string[];
}

/** Everything the composer shows about one session besides its draft. */
export interface ComposerSessionState {
  /** A run is under way (streaming or a prompt waiting for the model). */
  running: boolean;
  /** A send/abort/model request is in flight. */
  pending: boolean;
  /** Messages pi parked behind the running turn. */
  queue: ComposerQueue;
  /** The last failed action, for the composer's error line. */
  error: string | null;
  /** The model the session reports (`get_state.model`). */
  model: { provider: string; modelId: string } | null;
  /** The thinking level the session reports. */
  thinkingLevel: ThinkingLevel | null;
}

const EMPTY_QUEUE: ComposerQueue = { steering: [], followUp: [] };

function emptyState(): ComposerSessionState {
  return {
    running: false,
    pending: false,
    queue: EMPTY_QUEUE,
    error: null,
    model: null,
    thinkingLevel: null,
  };
}

/** Session id → its composer state. `composerSession()` supplies the defaults. */
export const composerSessions = signal<Record<string, ComposerSessionState>>({});

/** The state of `sessionId`, or empty defaults. Reads the signal when rendered. */
export function composerSession(sessionId: string): ComposerSessionState {
  return composerSessions()[sessionId] ?? emptyState();
}

/** `composerSession()` for a possibly missing session (a fresh composer). */
export function composerSessionOrEmpty(sessionId: string | null): ComposerSessionState {
  return sessionId ? composerSession(sessionId) : emptyState();
}

function updateSession(
  sessionId: string,
  update: (state: ComposerSessionState) => ComposerSessionState,
): void {
  composerSessions.update((all) => ({
    ...all,
    [sessionId]: update(all[sessionId] ?? emptyState()),
  }));
}

function errorMessage(error: unknown): string {
  return errorText(error);
}

/** Puts a status-line message on a session (a failed pick, a refused command). */
export function setComposerError(sessionId: string, message: string | null): void {
  updateSession(sessionId, (state) => ({ ...state, error: message }));
}

/** Clears the status-line message. */
export function clearComposerError(sessionId: string): void {
  updateSession(sessionId, (state) => (state.error === null ? state : { ...state, error: null }));
}

/** `get_state.thinkingLevel` is a string on the wire; keep only the levels pi accepts. */
const THINKING_LEVELS: readonly ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export function asThinkingLevel(value: string | null | undefined): ThinkingLevel | null {
  return value && (THINKING_LEVELS as readonly string[]).includes(value)
    ? (value as ThinkingLevel)
    : null;
}

export { THINKING_LEVELS };

/**
 * The strength the composer's chip shows, in pi-next's short words: the seven
 * pi levels fold into `off` / `medium` / `high` (关 / 中 / 高). The exact level
 * is still kept, and chosen, in the picker's menu: only the chip's text is
 * coarse, so `xhigh` or `max` never reads as a paragraph.
 */
export type ThinkingDisplayLevel = "off" | "medium" | "high";

/** `off|minimal → off`, `low|medium → medium`, `high|xhigh|max → high`. */
export function thinkingDisplayLevel(level: ThinkingLevel | null | undefined): ThinkingDisplayLevel {
  switch (level) {
    case "low":
    case "medium":
      return "medium";
    case "high":
    case "xhigh":
    case "max":
      return "high";
    default:
      return "off";
  }
}

/** The exact level a chip tier sends when picked (`high` stays `high`). */
export function thinkingLevelForDisplay(level: ThinkingDisplayLevel): ThinkingLevel {
  return level;
}

function applyState(sessionId: string, state: AgentStatePayload | undefined, _wrapperRunning: boolean): void {
  updateSession(sessionId, (current) => {
    const model = state?.model
      ? { provider: state.model.provider, modelId: state.model.id }
      : current.model;
    const thinkingLevel = asThinkingLevel(state?.thinkingLevel) ?? current.thinkingLevel;
    return {
      ...current,
      // `/api/agent/[id]`'s `running` is "an RPC session exists", true for
      // every session the moment it is opened (`startRpcSession` in the events
      // route). What the composer means by running is a reply in flight
      // (`useAgentSession.ts:1565,1711`).
      running:
        Boolean(state?.isStreaming) ||
        Boolean(state?.isPromptRunning) ||
        Boolean(state?.isCompacting),
      queue: {
        steering: state?.queuedMessages?.steering ?? [],
        followUp: state?.queuedMessages?.followUp ?? [],
      },
      model,
      thinkingLevel,
    };
  });
}

/**
 * Applies an SSE `queue_update` (`useAgentSession.ts:2029-2036`): `steering`
 * and `followUp` are the server's full lists, not deltas. `ChatView` can call
 * this from its event stream; polling alone would lag by up to two seconds.
 */
export function applyQueueUpdate(
  sessionId: string,
  queue: { steering?: string[]; followUp?: string[] } | null | undefined,
): void {
  // A queue update says nothing about whether a reply is in flight: the
  // `agent_start` / `agent_end` events carry that.
  updateSession(sessionId, (state) => ({
    ...state,
    queue: {
      steering: [...(queue?.steering ?? [])],
      followUp: [...(queue?.followUp ?? [])],
    },
  }));
}

/** `agent_start` / `agent_end` / `prompt_done`: flips the composer's run state. */
export function setComposerRunning(sessionId: string, running: boolean): void {
  updateSession(sessionId, (state) => ({
    ...state,
    running,
    queue: running ? state.queue : EMPTY_QUEUE,
  }));
}

/**
 * `GET /api/agent/[id]` (`?systemPrompt=0`) → the composer's running flag and
 * queue. A session with no live wrapper (`running: false`) is idle, its queue
 * gone. Failures keep the previous state and put the message on `error`, so a
 * poll never makes the composer jump.
 */
export async function refreshComposerState(sessionId: string): Promise<void> {
  try {
    const response = await agentState(sessionId, { systemPrompt: false });
    if (!response.running) {
      updateSession(sessionId, (current) => ({
        ...current,
        running: false,
        queue: EMPTY_QUEUE,
      }));
      return;
    }
    applyState(sessionId, response.state, response.running);
  } catch (error) {
    updateSession(sessionId, (current) => ({ ...current, error: errorMessage(error) }));
  }
}

// --- sends ----------------------------------------------------------------

export interface SendPromptOptions {
  images?: AgentImage[];
  /**
   * While a run is going: park the message behind it (`"follow_up"`) or add it
   * to the running turn (`"steer"`, pi's `streamingBehavior`).
   */
  behavior?: "steer" | "follow_up";
}

/**
 * Sends `text` as a pi `prompt` command (`promptCommand()` → `sendCommand()`),
 * optimistically marks the session running or queued, and returns whether the
 * server accepted it. The caller clears the draft only on `true`
 * (`ChatApp`'s `if (isPromptRejectedError(e)) restore` idea, `useAgentSession.ts:2770-2790`).
 */
export async function sendPrompt(
  sessionId: string,
  text: string,
  options: SendPromptOptions = {},
): Promise<boolean> {
  const message = text.trim();
  const images = options.images?.length ? options.images : undefined;
  if (!message && !images) return false;

  updateSession(sessionId, (state) => ({ ...state, pending: true, error: null }));
  try {
    await sendCommand(sessionId, promptCommand(message, {
      images,
      streamingBehavior: options.behavior,
    }));
    updateSession(sessionId, (state) => ({
      ...state,
      pending: false,
      running: true,
      queue: options.behavior === "follow_up"
        ? {
            steering: state.queue.steering,
            followUp: [...state.queue.followUp, message || "(image)"],
          }
        : state.queue,
    }));
    return true;
  } catch (error) {
    updateSession(sessionId, (state) => ({
      ...state,
      pending: false,
      error: errorMessage(error),
    }));
    return false;
  }
}

/** `{ type: "abort" }`: stops the running turn; pi keeps its queue out of the answer here. */
export async function abortComposer(sessionId: string): Promise<void> {
  updateSession(sessionId, (state) => ({ ...state, pending: true, error: null }));
  try {
    await sendCommand(sessionId, { type: "abort" });
    updateSession(sessionId, (state) => ({
      ...state,
      pending: false,
      running: false,
      queue: EMPTY_QUEUE,
    }));
  } catch (error) {
    updateSession(sessionId, (state) => ({
      ...state,
      pending: false,
      error: errorMessage(error),
    }));
  }
}

/**
 * `{ type: "clear_queue" }`: takes the parked messages back. Returns their
 * text so the composer can put it in the draft (pi's `handleRecallQueue`,
 * `useAgentSession.ts:2825-2845`; the command is `clear_queue`, not `recall`).
 */
export async function recallQueue(sessionId: string): Promise<string> {
  try {
    const result = await sendCommand<{
      steering?: string[];
      followUp?: string[];
    }>(sessionId, { type: "clear_queue" });
    updateSession(sessionId, (state) => ({ ...state, queue: EMPTY_QUEUE }));
    return [...(result?.steering ?? []), ...(result?.followUp ?? [])].join("\n\n");
  } catch (error) {
    updateSession(sessionId, (state) => ({ ...state, error: errorMessage(error) }));
    return "";
  }
}

// --- model and thinking level --------------------------------------------

/** `{ type: "set_model", provider, modelId }` (`useAgentSession.ts:2350-2390`). */
export async function switchModel(
  sessionId: string,
  provider: string,
  modelId: string,
): Promise<boolean> {
  const previous = composerSession(sessionId).model;
  updateSession(sessionId, (state) => ({
    ...state,
    pending: true,
    error: null,
    model: { provider, modelId },
  }));
  try {
    const selected = await sendCommand<{ provider: string; id: string }>(sessionId, {
      type: "set_model",
      provider,
      modelId,
    });
    updateSession(sessionId, (state) => ({
      ...state,
      pending: false,
      model: selected
        ? { provider: selected.provider, modelId: selected.id }
        : { provider, modelId },
    }));
    return true;
  } catch (error) {
    updateSession(sessionId, (state) => ({
      ...state,
      pending: false,
      model: previous,
      error: errorMessage(error),
    }));
    return false;
  }
}

/** `{ type: "set_thinking_level", level }` (`useAgentSession.ts:2845-2860`). */
export async function switchThinkingLevel(
  sessionId: string,
  level: ThinkingLevel,
): Promise<boolean> {
  const previous = composerSession(sessionId).thinkingLevel;
  updateSession(sessionId, (state) => ({
    ...state,
    pending: true,
    error: null,
    thinkingLevel: level,
  }));
  try {
    await sendCommand(sessionId, { type: "set_thinking_level", level });
    updateSession(sessionId, (state) => ({ ...state, pending: false, thinkingLevel: level }));
    return true;
  } catch (error) {
    updateSession(sessionId, (state) => ({
      ...state,
      pending: false,
      thinkingLevel: previous,
      error: errorMessage(error),
    }));
    return false;
  }
}

// --- slash commands -------------------------------------------------------

/** One command of `get_commands` (`lib/rpc-manager.ts:1632-1655`). */
export interface SlashCommandInfo {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill" | "builtin";
  sourceInfo?: {
    path: string;
    source: string;
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    baseDir?: string;
  };
  /** A built-in that stays usable while a reply streams (`ChatInput.tsx:296-317`). */
  availableWhileStreaming?: boolean;
}

/**
 * The commands this app runs itself. pi-next always puts them first in the
 * palette (`ChatInput.tsx:304-326,1126-1135`), because a fresh composer has
 * no session whose `get_commands` could supply them, and because these are UI
 * actions rather than prompts an extension registered.
 *
 * `description` is an i18n key for a built-in. The list is data only: it does
 * not read the locale, so the palette can translate it each time it draws.
 */
export const BUILTIN_SLASH_COMMANDS: readonly SlashCommandInfo[] = [
  { name: "compact", description: "chat.commandCompact", source: "builtin" },
  { name: "auto-compact", description: "chat.commandAutoCompact", source: "builtin" },
  { name: "reload", description: "chat.commandReload", source: "builtin" },
  { name: "name", description: "chat.commandName", source: "builtin" },
  { name: "session", description: "chat.commandSession", source: "builtin", availableWhileStreaming: true },
  { name: "copy", description: "chat.commandCopy", source: "builtin", availableWhileStreaming: true },
  { name: "clone", description: "chat.commandClone", source: "builtin" },
  { name: "side", description: "chat.commandSide", source: "builtin", availableWhileStreaming: true },
  // This app opens its own Settings pages for the two commands pi-next leaves
  // to its built-in MCP extension; neither needs a session to show them.
  { name: "skills", description: "chat.commandSkills", source: "builtin" },
  { name: "mcp", description: "chat.commandMcp", source: "builtin" },
];

/** A built-in's copy in the reader's language. */
export function builtinText(key: string): string {
  return t(key);
}

/** The built-in named `name`, or undefined for an extension / prompt / skill. */
export function builtinSlashCommand(name: string): SlashCommandInfo | undefined {
  return BUILTIN_SLASH_COMMANDS.find((command) => command.name === name);
}

/** A built-in's description in the reader's language; other commands keep theirs. */
export function slashCommandDescription(command: SlashCommandInfo): string | undefined {
  if (command.source !== "builtin" || !command.description) return command.description;
  return builtinText(command.description);
}

/**
 * The palette's list: the built-ins first, then whatever this session's
 * `get_commands` reported. A fresh composer (no session yet) still gets the
 * built-ins, which is the welcome composer's whole palette.
 */
export function slashCommandsWithBuiltins(
  sessionId: string | null,
  streaming: boolean,
): SlashCommandInfo[] {
  const builtins = streaming
    ? BUILTIN_SLASH_COMMANDS.filter((command) => command.availableWhileStreaming === true)
    : BUILTIN_SLASH_COMMANDS;
  return sessionId ? [...builtins, ...slashCommandsFor(sessionId)] : [...builtins];
}

/** Session id → the commands last loaded. */
export const slashCommandsBySession = signal<Record<string, SlashCommandInfo[]>>({});
/** Session id → a command load is in flight. */
export const slashCommandsLoading = signal<Record<string, boolean>>({});
/** Session id → the last command-load error (the palette still shows what it has). */
export const slashCommandsError = signal<Record<string, string | null>>({});

/** The cached commands for `sessionId`; reads the signal when rendered. */
export function slashCommandsFor(sessionId: string): SlashCommandInfo[] {
  return slashCommandsBySession()[sessionId] ?? [];
}

/** Whether the first command load for `sessionId` is under way. */
export function slashCommandsLoadingFor(sessionId: string): boolean {
  return slashCommandsLoading()[sessionId] === true;
}

/**
 * Loads a session's slash commands once. The server's `get_state` reply does
 * not carry them (the real `get_commands` command returns
 * `{ commands }`); we check a `commands` field first in case the state route
 * starts folding it in, then fall back to `get_commands`.
 */
export async function ensureSlashCommands(sessionId: string): Promise<SlashCommandInfo[]> {
  const cached = slashCommandsBySession()[sessionId];
  if (cached) return cached;
  if (slashCommandsLoading()[sessionId]) return [];

  slashCommandsLoading.update((all) => ({ ...all, [sessionId]: true }));
  slashCommandsError.update((all) => ({ ...all, [sessionId]: null }));

  let commands: SlashCommandInfo[] = [];
  try {
    const response = await agentState(sessionId, { systemPrompt: false });
    const inline = (response.state as (AgentStatePayload & { commands?: unknown }) | undefined)?.commands;
    if (Array.isArray(inline)) {
      commands = inline as SlashCommandInfo[];
    } else {
      const result = await sendCommand<{ commands?: SlashCommandInfo[] }>(sessionId, {
        type: "get_commands",
      });
      commands = result?.commands ?? [];
    }
  } catch (error) {
    slashCommandsError.update((all) => ({ ...all, [sessionId]: errorMessage(error) }));
  } finally {
    slashCommandsLoading.update((all) => ({ ...all, [sessionId]: false }));
    slashCommandsBySession.update((all) => ({ ...all, [sessionId]: commands }));
  }
  return commands;
}

/** Filters by name or description, matching pi's palette (`ChatInput.tsx:1126-1134`). */
export function filterSlashCommands(
  commands: readonly SlashCommandInfo[],
  query: string,
): SlashCommandInfo[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [...commands];
  return commands.filter((command) => (
    command.name.toLocaleLowerCase().includes(normalized)
    || (slashCommandDescription(command) ?? "").toLocaleLowerCase().includes(normalized)
  ));
}

// --- Enter-to-send preference --------------------------------------------

/** The two semantics of pi's `useEnterSendMode` (`hooks/useEnterSendMode.ts:1-8`). */
export type EnterSendMode = "enter" | "ctrlEnter";

/** The old localStorage key, kept as the preference key's name. */
export const ENTER_SEND_MODE_PREF = "pi-enter-send-mode";

/** `"enter"` (Enter sends, Shift+Enter breaks) or `"ctrlEnter"` (Ctrl/Cmd+Enter sends). */
export function enterSendMode(): EnterSendMode {
  return pref<string>(ENTER_SEND_MODE_PREF, "enter") === "ctrlEnter" ? "ctrlEnter" : "enter";
}

export function setEnterSendMode(mode: EnterSendMode): void {
  setPref(ENTER_SEND_MODE_PREF, mode);
}
