// The chat composer: a multiline field, Enter-to-send (or Ctrl/Cmd+Enter in
// the other mode), a per-session draft, an attach menu, a split model /
// strength chip, file mentions into the text, a slash palette, and the run
// controls (Send, or Stop with Queue / Steer behind it).
//
// The look is the gallery's kit (`../../ui/kit`): `fieldLook` / `inputLook`
// for the well, `menuPopup` + `menuItemLook` + `MenuLabel` for the slash
// palette, `Badge` for the queue, and the kit's `Press`, `Button` and
// `RoundButton` for the controls. The numbers follow pi-next's
// `app/v5/composer.css`: an 820-point column, a 14-point card, a 44-point
// text line, 26-point chips and a 30-point send button.
//
// NSH rules this file follows (`skills/nsh/references/tsx.md`):
//   - the component body runs once; every changing value is a binding;
//   - `If` / `Each` for conditions and lists;
//   - `Input` is `nsh/base`'s native field: `onChange({ value })`,
//     `onSubmit({ text })`, `onKeyPress({ key })`, and `submitBehavior`
//     decides what Return does (`docs/dev/elements.md:16`, `tsx.md` "Forms and
//     the keyboard"). A multiline input that submits still inserts a line
//     break on Shift+Return / Option+Return on the desktops, which is exactly
//     the "Enter sends, Shift+Enter breaks" pair.

import { cleanup, Clipboard, effect, Image, keymap, Picker, platform, Scroll, signal, Text, token, untracked, View, windowSize } from "nsh";
import { Dialog, Input, Menu } from "nsh/base";
import {
  alpha,
  backdrop,
  Badge,
  Button,
  colors,
  fieldLook,
  finish,
  focusRing,
  Icon,
  inputLook,
  menuItemGlyph,
  menuItemLabel,
  menuItemLook,
  menuItemNote,
  menuPopup,
  MenuLabel,
  popoverLook,
  Press,
  radius,
  RoundButton,
  Spinner,
  tints,
  Tip,
} from "../../ui/kit";
import { errorText } from "../../ui/errors";
import { t } from "../../ui/i18n";
import { mono, sans } from "../../ui/fonts";
import {
  AT_RESULT_LIMIT,
  buildAtInsertText,
  buildAtMentionText,
  extractAtQuery,
  type FileIndexEntry,
} from "../../lib/file-fuzzy";
import { ensureListing, mentionEntries } from "../../api/file-index";
import { chatContentWidth } from "../../lib/chat-width";
import { paneAlpha } from "../../lib/background-opacity";
import { Glyph } from "../../ui/chat/glyphs";
import { FileChip, Photo } from "../../ui/chat/parts";
import { uploadFiles } from "../../api/files";
import { newSession, agentState, sendCommand, type ThinkingLevel } from "../../api/agent";
import { readSession, renameSession } from "../../api/sessions";
import { toolPresetChoiceTools } from "../../lib/tool-presets";
import { defaultToolPreset } from "../../state/tool-preset-default";
import { chooseSession, sessionTitle } from "../shell/state";
import { openPanelTab } from "../panel/state";
import { openSideChatTab } from "../panel/actions";
import { ModelPicker } from "./ModelPicker";
import {
  abortComposer,
  appendComposerDraft,
  builtinSlashCommand,
  builtinText,
  clearComposerError,
  composerDraft,
  composerSessionOrEmpty,
  draftKey,
  ensureSlashCommands,
  enterSendMode,
  filterSlashCommands,
  recallQueue,
  refreshComposerState,
  sendPrompt,
  setComposerDraft,
  setComposerError,
  slashCommandDescription,
  slashCommandsError,
  slashCommandsLoadingFor,
  slashCommandsWithBuiltins,
  type SlashCommandInfo,
} from "../../state/composer";
import { prefsLoaded } from "../../state/prefs";
import {
  activeCwd,
  composerInsert,
  consumeComposerInserts,
  openSettingsAt,
  selectedSessionId,
} from "../../state/session";

export interface ComposerProps {
  /** The session to prompt; defaults to the shell's selected session. */
  sessionId?: string | null;
  /** A fresh composer: no session yet; sending creates one in `cwd`. */
  fresh?: boolean;
  /** The welcome's taller field and placeholder (a fresh composer). */
  welcome?: boolean;
  /** The folder of a not-yet-created session (draft key and model catalog). */
  cwd?: string | null;
  placeholder?: string;
  /** Hides the controls and makes the field read-only (no session ready). */
  disabled?: boolean;
  /** Called after the server accepted a prompt; the transcript can scroll. */
  onSent?: (sessionId: string, text: string) => void;
}

/** A pointer and a keyboard: compact density, as the kit's demos. */
const desktop = platform.desktop;

/** How often a mounted composer asks `get_state` for running / queue changes. */
const COMPOSER_POLL_MS = 2000;
/** How many queued messages the composer names before it only shows a count. */
const QUEUE_PREVIEW = 2;

/** pi-next's composer column (`app/v5/composer.css`: `--pin-content-max` 820). */
const COMPOSER_MAX_WIDTH = () => chatContentWidth();
/** The composer card: 14-point corners, 10 / 12 / 8 padding, 8 between rows. */
const COMPOSER_PADDING = { top: 10, side: 12, bottom: 8 };
/** A multi-line composer line: 44 high with a pointer (64 on a phone),
 * growing to 140 before it scrolls. */
const TEXT_MIN_HEIGHT = desktop ? 44 : 64;
const TEXT_MAX_HEIGHT = 140;
/** The bar's chips and buttons: 26 / 28 / 30, from the board's CSS. */
const PLUS_SIZE = 28;
const SEND_SIZE = desktop ? 30 : 28;
/** The slash palette is 420 wide with a 42-point head and 44-point rows. */
const SLASH_WIDTH = 420;
const SLASH_HEAD = 42;

/** The palette's head row (title + count), shared by the `/` and `@` menus. */
const slashHeadStyle = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  justifyContent: "space-between" as const,
  height: SLASH_HEAD,
  paddingHorizontal: 12,
  borderBottomWidth: 1,
  borderBottomColor: colors.line,
  backgroundColor: colors.field,
};
const SLASH_ROW = 44;

/** A slash command's source, as the palette's small hint. */
function commandSource(command: SlashCommandInfo): string {
  switch (command.source) {
    case "builtin":
      return t("chat.builtIn");
    case "prompt":
      return t("chat.prompts");
    case "skill":
      return t("chat.skills");
    default:
      return t("chat.extensions");
  }
}

/** A built-in typed with its arguments (`/compact keep the API`). */
function builtinInvocation(text: string): { command: SlashCommandInfo; args: string } | null {
  const match = text.trim().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const command = builtinSlashCommand(match[1]);
  return command ? { command, args: (match[2] ?? "").trim() } : null;
}

/** The file name of a dropped `file:` URL, decoded for an `@` mention. */
function fileNameFromUri(uri: string): string {
  const path = uri.replace(/^file:\/\//, "").replace(/\/+$/, "");
  const name = path.slice(path.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** Picked or dropped names as pi mentions (`@a.ts @"my file.txt"`). */
function attachmentMentions(names: string[]): string {
  return names
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => buildAtMentionText(name, false))
    .join("");
}

/** A picked image waiting in the composer: bytes for pi, a data URL for the thumbnail. */
interface PendingImage {
  id: number;
  name: string;
  mimeType: string;
  /** Base64, as pi's `AgentImage` takes it. */
  data: string;
  /** `data:` URL of the same bytes, for the thumbnail. */
  src: string;
  size: number;
}

/** A picked file already uploaded into the session's folder (the draft carries its `@mention`). */
interface PendingFile {
  id: number;
  name: string;
  size: number;
  /** The `@name` this file put in the draft, taken out when the chip is removed. */
  mention: string;
}

/** Base64 of a picked file's bytes (chunked: a spread of a megabyte would overflow the stack). */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x1000;
  for (let at = 0; at < bytes.length; at += chunk) {
    binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  }
  return btoa(binary);
}

/** A picked file's size, short (`12.4 KB`). */
function formatFileSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

/**
 * Picked or pasted images as the composer holds them. The file picker and the
 * clipboard both hand over `File`s, so one conversion keeps their thumbnails,
 * bytes and ids identical (a pasted screenshot must look like a picked one).
 */
async function pendingImagesFromFiles(files: File[], nextId: () => number): Promise<PendingImage[]> {
  const pending: PendingImage[] = [];
  for (const file of files) {
    const mimeType = file.type.startsWith("image/") ? file.type : "image/png";
    const bytes = new Uint8Array(await file.arrayBuffer());
    const data = toBase64(bytes);
    pending.push({
      id: nextId(),
      name: file.name || "image",
      mimeType,
      data,
      src: `data:${mimeType};base64,${data}`,
      size: file.size,
    });
  }
  return pending;
}

/** What this file needs of a native field (`InputRef` minus the view parts). */
interface FieldRef {
  setSelection(start: number, end?: number): void;
  insertText(text: string): void;
}

export function Composer(props: ComposerProps) {
  const sessionId = () => (props.fresh ? null : (props.sessionId ?? selectedSessionId()));
  const cwd = () => props.cwd ?? activeCwd();
  const key = () => draftKey(sessionId(), cwd());
  const draft = () => composerDraft(key());
  const state = () => composerSessionOrEmpty(sessionId());

  const running = () => state().running;
  const pending = () => state().pending || freshPending();
  const hasText = () => draft().trim().length > 0;
  const queue = () => state().queue;
  const queueCount = () => queue().steering.length + queue().followUp.length;
  const queuedPreview = () => [...queue().steering, ...queue().followUp].slice(0, QUEUE_PREVIEW);

  // A composition (pinyin, Japanese) must not open the slash palette; the
  // native field also keeps Return for the IME (`elements.md:16`).
  const composing = signal(false);
  const slashSuppressed = signal(false);
  const slashIndex = signal(0);
  /** Images and uploaded files waiting beside the draft. */
  const pendingImages = signal<PendingImage[]>([]);
  /** The thumbnail opened full size, or null. */
  const previewImage = signal<PendingImage | null>(null);
  const pendingFiles = signal<PendingFile[]>([]);
  const attaching = signal(false);
  let nextAttachmentId = 1;
  /** A fresh composer's own error and pending state (no session store to hold them). */
  const freshError = signal<string | null>(null);

  // The native field, and the text it currently holds. `Input` takes `value`
  // when it mounts, not when it changes (nsh's text view), so everything the
  // app changes behind the user's back — a session's restored draft, a
  // `set_editor_text` from an extension, a send clearing the box, switching
  // sessions — has to be driven into the field as an edit. Otherwise the field
  // shows one thing and the draft holds another (this is what made a
  // historical session's composer look empty while the text was there).
  let field: FieldRef | null = null;
  let fieldValue = draft();
  const freshPending = signal(false);
  const freshModel = signal<{ provider: string; modelId: string } | null>(null);
  const freshThinking = signal<ThinkingLevel | null>(null);
  /** What Send takes: text, or images with an empty draft. */
  const canSend = () => hasText() || pendingImages().length > 0;

  // Pending images and files belong to the draft they were picked for: a
  // session (or a cwd) switch starts with none, as the text does.
  let attachmentsKey = key();
  effect(() => {
    const current = key();
    if (current === attachmentsKey) return;
    attachmentsKey = current;
    untracked(() => {
      pendingImages.set([]);
      pendingFiles.set([]);
    });
  });

  // ---- `@` file mentions (pi's `ChatInput.tsx` @ menu, `lib/file-fuzzy.ts`) ----
  const mentionIndex = signal(0);
  const mentionSuppressed = signal(false);
  /** The listing is fetched once per cwd, on the first `@`. */
  const mentionListing = signal<string | null>(null);
  const mentionLoading = signal(false);

  const mention = (): { start: number; query: string; quoted: boolean } | null => {
    if (composing()) return null;
    const value = draft();
    // The slash palette owns a draft that starts with `/`.
    if (value.startsWith("/")) return null;
    return extractAtQuery(value);
  };

  const mentionRows = (): FileIndexEntry[] => {
    // The listing cache is a plain Map: subscribe to the fetch's state so an
    // `Each of={mentionRows()}` re-runs when the first listing settles.
    mentionLoading();
    mentionListing();
    const at = mention();
    const dir = cwd();
    if (!at || !dir) return [];
    // Only the cached listing can be filtered synchronously; the first `@`
    // loads it and the rows appear one tick later.
    return mentionEntries(dir, at.query, AT_RESULT_LIMIT);
  };

  // The menu opens as soon as the token appears, even while the first listing
  // loads: the popup shows a loading row and its rows replace it when the
  // fetch settles. Reading `mentionLoading` here is what makes that settle
  // re-run this binding; the listing cache itself is not reactive.
  const mentionOpen = (): boolean => {
    if (!mention() || mentionSuppressed() || !cwd()) return false;
    return mentionLoading() || mentionListing() === cwd() || mentionRows().length > 0;
  };

  const selectedMention = (): FileIndexEntry | null => {
    const rows = mentionRows();
    if (rows.length === 0) return null;
    return rows[Math.min(mentionIndex(), rows.length - 1)] ?? null;
  };

  const applyMention = (entry: FileIndexEntry): void => {
    const at = mention();
    if (!at) return;
    const insertion = buildAtInsertText(entry.path, entry.isDir, at.quoted);
    const value = draft();
    const before = value.slice(0, at.start);
    const after = value.slice(at.start + at.query.length + (at.quoted ? 3 : 1));
    setComposerDraft(key(), `${before}${insertion.text}${after}`);
    // A directory keeps the menu open for drill-down; a file closes it.
    mentionSuppressed.set(!entry.isDir);
    mentionIndex.set(0);
  };

  const slashQuery = (): string | null => {
    if (composing()) return null;
    const value = draft();
    return value.startsWith("/") && !/\s/.test(value.slice(1))
      ? value.slice(1).toLocaleLowerCase()
      : null;
  };

  const commands = (): SlashCommandInfo[] => (
    slashCommandsWithBuiltins(sessionId(), running())
  );

  const filteredCommands = (): SlashCommandInfo[] => (
    filterSlashCommands(commands(), slashQuery() ?? "")
  );

  const slashOpen = (): boolean => slashQuery() !== null && !slashSuppressed();

  const selectedCommand = (): SlashCommandInfo | null => {
    const list = filteredCommands();
    if (list.length === 0) return null;
    return list[Math.min(slashIndex(), list.length - 1)] ?? null;
  };

  const applyCommand = (command: SlashCommandInfo): void => {
    // pi's palette completes the command first (`ChatInput.tsx:1480-1495`);
    // the following Return sends it, because the space ends the query.
    setComposerDraft(key(), `/${command.name} `);
    slashSuppressed.set(true);
    slashIndex.set(0);
  };

  type BuiltinOutcome = "send" | "clear" | "keep";

  /**
   * Runs one built-in before pi sees the text. `"send"` means an extension's
   * own command of the same name (or an argument form this app does not own)
   * should go on to pi; `"clear"` clears the draft after success; `"keep"`
   * leaves it so a usage or session error can be corrected and retried.
   */
  const runBuiltinCommand = async (
    id: string | null,
    command: SlashCommandInfo,
    args: string,
  ): Promise<BuiltinOutcome> => {
    // `/mcp login` and the like belong to pi's MCP extension; only the bare
    // form opens this app's Settings page.
    if ((command.name === "skills" || command.name === "mcp") && args) return "send";

    const needsSession = command.name !== "skills" && command.name !== "mcp";
    if (needsSession && !id) {
      freshError.set(builtinText("chat.commandNeedsSession"));
      return "keep";
    }
    if (id && running() && command.availableWhileStreaming !== true) {
      setComposerError(id, builtinText("chat.commandNotWhileStreaming"));
      return "keep";
    }

    if (command.name === "skills") {
      openSettingsAt("skills");
      return "clear";
    }
    if (command.name === "mcp") {
      openSettingsAt("mcp");
      return "clear";
    }
    if (!id) {
      freshError.set(builtinText("chat.commandNeedsSession"));
      return "keep";
    }

    switch (command.name) {
      case "session":
        openPanelTab({ kind: "session" });
        return "clear";

      case "compact":
        // Detached on purpose: the compact POST waits for the whole summary,
        // while the composer must stay usable (`useAgentSession.ts:2625-2640`).
        void sendCommand(id, {
          type: "compact",
          ...(args ? { customInstructions: args } : {}),
        }).catch((error: unknown) => {
          setComposerError(id, t("chat.compactionFailed", { message: errorText(error) }));
        });
        return "clear";

      case "name":
        if (!args) {
          setComposerError(id, builtinText("chat.commandNameUsage"));
          return "keep";
        }
        try {
          await renameSession(id, args);
          sessionTitle.set(args);
          setComposerError(id, builtinText("chat.commandRenamed"));
          return "clear";
        } catch (error) {
          setComposerError(id, errorText(error));
          return "keep";
        }

      case "auto-compact": {
        try {
          // Read the live wrapper so the toggle follows settings.json rather
          // than assuming the composer's last known value (`useAgentSession.ts:2645-2665`).
          const state = await agentState(id, { systemPrompt: false });
          const enabled = !(state.state?.autoCompactionEnabled ?? true);
          await sendCommand(id, { type: "set_auto_compaction", enabled });
          setComposerError(id, builtinText(enabled
            ? "chat.commandAutoCompactOn"
            : "chat.commandAutoCompactOff"));
          return "clear";
        } catch (error) {
          setComposerError(id, errorText(error));
          return "keep";
        }
      }

      case "reload":
        try {
          await sendCommand(id, { type: "reload" });
          setComposerError(id, t("i18n.sessionReloaded"));
          return "clear";
        } catch (error) {
          setComposerError(id, errorText(error));
          return "keep";
        }

      case "copy":
        try {
          const data = await sendCommand<{ text?: string | null }>(id, {
            type: "get_last_assistant_text",
          });
          const text = data?.text ?? "";
          if (!text) {
            setComposerError(id, builtinText("chat.commandNoAssistant"));
            return "keep";
          }
          await Clipboard.writeText(text);
          setComposerError(id, t("i18n.copied"));
          return "clear";
        } catch (error) {
          setComposerError(id, errorText(error));
          return "keep";
        }

      case "clone":
        try {
          // pi clones the branch its wrapper has selected; the session read is
          // where this app can name that leaf, so an empty session is refused
          // before a clone command could leave a half-made copy.
          const loaded = await readSession(id, { summaryTree: true });
          if (!loaded.leafId) {
            setComposerError(id, t("sidebar.forkEmpty"));
            return "keep";
          }
          const result = await sendCommand<{ cancelled?: boolean }>(id, {
            type: "clone",
            leafId: loaded.leafId,
          });
          if (result?.cancelled) {
            setComposerError(id, t("sidebar.forkUnsaved"));
            return "keep";
          }
          setComposerError(id, builtinText("chat.commandCloned"));
          return "clear";
        } catch (error) {
          setComposerError(id, t("sidebar.forkFailed", { error: errorText(error) }));
          return "keep";
        }

      case "side":
        try {
          const opened = await openSideChatTab(id, args || undefined);
          return opened ? "clear" : "keep";
        } catch (error) {
          setComposerError(id, errorText(error));
          return "keep";
        }

      default:
        return "send";
    }
  };

  const submit = async (behavior?: "steer" | "follow_up"): Promise<void> => {
    const id = sessionId();
    const text = draft().trim();
    const images = pendingImages().map((image) => ({
      type: "image" as const,
      data: image.data,
      mimeType: image.mimeType,
    }));
    if ((!text && images.length === 0) || pending()) return;

    // Built-ins run here, before the fresh-session branch and pi's prompt:
    // `/skills` and `/mcp` need no session, and the rest answer with a notice
    // when there is none (`ChatInput.tsx` `handleSend` → `runBuiltinCommand`).
    const invocation = builtinInvocation(text);
    if (invocation) {
      const outcome = await runBuiltinCommand(id, invocation.command, invocation.args);
      if (outcome !== "send") {
        if (outcome === "clear") {
          setComposerDraft(key(), "");
          pendingImages.set([]);
          pendingFiles.set([]);
          slashSuppressed.set(false);
          slashIndex.set(0);
        }
        return;
      }
    }

    // A fresh composer has no session yet: the first send creates one in the
    // chosen folder (`POST /api/agent/new`), with the model / strength it
    // shows and General's tool preset, then selects it.
    if (!id) {
      const dir = cwd();
      if (!dir || freshPending()) return;
      freshPending.set(true);
      freshError.set(null);
      try {
        const toolNames = toolPresetChoiceTools(defaultToolPreset()) ?? undefined;
        const chosen = freshModel();
        const level = freshThinking();
        const created = await newSession({
          cwd: dir,
          type: "prompt",
          message: text,
          images,
          toolNames,
          ...(chosen ? { provider: chosen.provider, modelId: chosen.modelId } : {}),
          ...(level ? { thinkingLevel: level } : {}),
        });
        setComposerDraft(key(), "");
        pendingImages.set([]);
        pendingFiles.set([]);
        slashSuppressed.set(false);
        slashIndex.set(0);
        chooseSession(created.sessionId, dir, t("i18n.newSession"));
      } catch (cause) {
        freshError.set(errorText(cause));
      } finally {
        freshPending.set(false);
      }
      return;
    }

    // A message sent while a turn runs waits for it (`follow_up`): the same
    // rule the send button shows, no separate queue control.
    const actual = behavior ?? (running() ? "follow_up" : undefined);
    const accepted = await sendPrompt(id, text, { behavior: actual, images });
    if (!accepted) return;
    setComposerDraft(key(), "");
    pendingImages.set([]);
    pendingFiles.set([]);
    slashSuppressed.set(false);
    slashIndex.set(0);
    props.onSent?.(id, text);
  };

  const submitOrComplete = (): void => {
    // A mention open under the caret takes Return: it completes, never sends.
    if (mentionOpen()) {
      const entry = selectedMention();
      if (entry) applyMention(entry);
      return;
    }
    const command = selectedCommand();
    if (slashOpen() && command) {
      // A built-in typed in full runs on Return, as pi's composer does
      // (`submitsSlashCommandOnEnter`, `ChatInput.tsx:1469-1495`); every other
      // row still completes to `/name ` and takes a second Return to send.
      const exact = command.source === "builtin"
        && draft().trim() === `/${command.name}`
        && (!running() || command.availableWhileStreaming === true);
      if (exact) void submit();
      else applyCommand(command);
      return;
    }
    void submit();
  };

  const abort = (): void => {
    const id = sessionId();
    if (id) void abortComposer(id);
  };

  const recall = async (): Promise<void> => {
    const id = sessionId();
    if (!id) return;
    const recalled = await recallQueue(id);
    if (recalled) appendComposerDraft(key(), recalled, "\n\n");
  };

  /**
   * The system's file picker, directly (no upload menu): images stay in the
   * composer as thumbnails and go to pi with the prompt; other files are
   * uploaded into the session's folder and enter the draft as `@mentions`.
   */
  const attachFiles = async (): Promise<void> => {
    const id = sessionId();
    const dir = cwd();
    if (attaching()) return;
    attaching.set(true);
    // A new pick starts clean; the problems it finds are set below.
    if (id) clearComposerError(id);
    try {
      const picked = await Picker.pickFiles({ multiple: true, limit: 10 });
      if (picked.length === 0) return;
      const tooLarge = picked.filter((file) => file.status !== "read" || !file.file);
      const usable = picked.filter((file) => file.status === "read" && file.file);
      const images = usable.filter((file) => file.type.startsWith("image/"));
      const files = usable.filter((file) => !file.type.startsWith("image/"));

      const nextImages = await pendingImagesFromFiles(
        images.map((image) => image.file!),
        () => nextAttachmentId++,
      );
      if (nextImages.length > 0) pendingImages.set([...pendingImages(), ...nextImages]);

      if (files.length > 0) {
        if (!dir) {
          if (id) setComposerError(id, t("workspace.noFolderSelected"));
          return;
        }
        const result = await uploadFiles(dir, files.map((file) => file.file!), "skip");
        const present = new Set([...(result.uploaded ?? []), ...(result.skipped ?? [])]);
        const uploaded = files.filter((file) => present.has(file.name));
        if (uploaded.length > 0) {
          pendingFiles.set([
            ...pendingFiles(),
            ...uploaded.map((file) => ({
              id: nextAttachmentId++,
              name: file.name,
              size: file.size,
              mention: buildAtMentionText(file.name, false),
            })),
          ]);
          appendComposerDraft(key(), attachmentMentions(uploaded.map((file) => file.name)), " ");
        }
        const problems = [
          ...tooLarge.map((file) => `${file.name}: ${t("chat.fileTooLarge")}`),
          ...(result.errors ?? []).map((failure) => `${failure.name}: ${failure.error}`),
        ];
        if (id && problems.length > 0) setComposerError(id, problems.join("\n"));
      } else if (id && tooLarge.length > 0) {
        setComposerError(id, tooLarge.map((file) => `${file.name}: ${t("chat.fileTooLarge")}`).join("\n"));
      }
    } catch (error) {
      // A denied picker or a vanished dialog must not throw from a press.
      if (id) setComposerError(id, errorText(error));
      else console.warn("[composer] could not pick files", error);
    } finally {
      attaching.set(false);
    }
  };

  /**
   * A paste that carries images: clipboard files become the same thumbnails
   * the picker makes. The field keeps its default paste, so the text of a rich
   * copy still lands in the draft; only the images are taken out of it here.
   */
  const pasteImages = async ({ files }: { files: File[] }): Promise<void> => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    // `uris` are local `file:` URLs whose bytes the UI would have to read off
    // the disk; copied images and screenshots arrive as `files`, so those are
    // the ones this handles.
    if (images.length === 0) return;
    const id = sessionId();
    if (id) clearComposerError(id);
    try {
      const nextImages = await pendingImagesFromFiles(images, () => nextAttachmentId++);
      if (nextImages.length > 0) pendingImages.set([...pendingImages(), ...nextImages]);
    } catch (error) {
      if (id) setComposerError(id, errorText(error));
      else freshError.set(errorText(error));
    }
  };

  const removeImage = (id: number): void => {
    pendingImages.set(pendingImages().filter((image) => image.id !== id));
  };

  const removeFile = (id: number): void => {
    const file = pendingFiles().find((item) => item.id === id);
    pendingFiles.set(pendingFiles().filter((item) => item.id !== id));
    if (!file?.mention) return;
    // The chip and the `@mention` are one attachment: removing the chip takes
    // the mention out of the draft, or the text keeps pointing at a file the
    // user just let go of.
    const text = draft();
    const at = text.indexOf(file.mention);
    if (at < 0) return;
    const next = `${text.slice(0, at)}${text.slice(at + file.mention.length)}`.replace(/ {2,}/g, " ");
    setComposerDraft(key(), next);
  };

  /** Drop on the card: the same `@name` mentions as the attach menu. */
  const dropFiles = ({ uris }: { uris: string[] }): void => {
    const names = uris.map(fileNameFromUri).filter(Boolean);
    if (names.length === 0) return;
    appendComposerDraft(key(), attachmentMentions(names), " ");
    const id = sessionId();
    if (id) clearComposerError(id);
  };

  // Put the draft's value into the field when it did not come from typing:
  // select what the field holds and replace it, which keeps focus and the
  // caret and reports one `onChange` (the same text, so `fieldValue` matches
  // and this effect stops).
  effect(() => {
    const value = draft();
    if (value === fieldValue) return;
    const previous = fieldValue;
    fieldValue = value;
    const target = field;
    // Before the field exists its `value` already mounted the draft.
    if (target === null) return;
    untracked(() => {
      target.setSelection(0, previous.length);
      target.insertText(value);
    });
  });

  const change = ({ value }: { value: string }): void => {
    fieldValue = value;
    setComposerDraft(key(), value);
    slashSuppressed.set(false);
    slashIndex.set(0);
    mentionSuppressed.set(false);
    mentionIndex.set(0);
    const id = sessionId();
    if (id && value.startsWith("/") && !/\s/.test(value.slice(1))) {
      // The first `/` loads the palette; later keystrokes only filter.
      void ensureSlashCommands(id);
    }
    const at = extractAtQuery(value);
    const dir = cwd();
    if (at && dir && mentionListing() !== dir) {
      // The first `@` loads the project's index once; later ones only filter.
      mentionLoading.set(true);
      mentionListing.set(dir);
      void ensureListing(dir)
        .catch(() => mentionListing.set(null))
        .finally(() => mentionLoading.set(false));
    }
  };

  const keyPress = ({ key: pressed }: { key: string }): void => {
    if (pressed === "Escape") {
      if (mentionOpen()) {
        mentionSuppressed.set(true);
        return;
      }
      if (slashOpen()) {
        slashSuppressed.set(true);
        return;
      }
      if (running()) {
        abort();
        return;
      }
    }
    if (mentionOpen()) {
      const rows = mentionRows();
      if (pressed === "ArrowDown") {
        if (rows.length > 0) mentionIndex.update((index) => (index + 1) % rows.length);
        return;
      }
      if (pressed === "ArrowUp") {
        if (rows.length > 0) mentionIndex.update((index) => (index - 1 + rows.length) % rows.length);
        return;
      }
      if (pressed === "Tab") {
        const entry = selectedMention();
        if (entry) applyMention(entry);
        return;
      }
      // Return completes the mention and does not send (`ChatInput.tsx`).
      if (pressed === "Enter") return;
    }
    if (!slashOpen()) return;
    const list = filteredCommands();
    if (list.length === 0) return;
    if (pressed === "ArrowDown") {
      slashIndex.update((index) => (index + 1) % list.length);
    } else if (pressed === "ArrowUp") {
      slashIndex.update((index) => (index - 1 + list.length) % list.length);
    } else if (pressed === "Tab") {
      const command = selectedCommand();
      if (command) applyCommand(command);
    }
  };

  // Poll the live session for running / queue changes. `ChatView` may also
  // push SSE `queue_update` through the same store; polling keeps a composer
  // usable on its own (and after a reconnect drops an event).
  effect(() => {
    const id = sessionId();
    if (!id) return;
    void refreshOnce(id);
    const timer = setInterval(() => void refreshOnce(id), COMPOSER_POLL_MS);
    cleanup(() => clearInterval(timer));
  });

  // `set_editor_text`: an extension's text for the composer. `overlays/state`
  // queues it in `composerInsert`; append each piece once to the draft that is
  // on screen (a piece that arrives with no composer mounted waits there).
  // The append writes `prefs`, which this effect must not track: pi-next's
  // `insertText` put the text in its textarea, this app owns the draft.
  effect(() => {
    const pending = composerInsert();
    if (pending.length === 0) return;
    const target = key();
    untracked(() => {
      for (const insert of pending) {
        // A file mention is part of the sentence being typed; an extension's
        // text is a block of its own. The old default newline broke the line
        // every time the file tree's `@` button inserted a path.
        appendComposerDraft(target, insert.text, insert.text.trimStart().startsWith("@") ? " " : "\n");
      }
      consumeComposerInserts(pending.map((insert) => insert.id));
    });
  });

  // The `ctrlEnter` mode of `hooks/useEnterSendMode.ts`: Return breaks the
  // line natively (`submitBehavior="newline"`), Ctrl/Cmd+Enter sends. `when:
  // "always"` is required because a multiline field uses Return itself.
  // TODO(nsh): verify that `keymap` sees `mod+enter` while `Input` has focus
  // (`keymap` declarations say text inputs keep keys that edit).
  effect(() => {
    if (enterSendMode() !== "ctrlEnter") return;
    const off = keymap.bind("mod+enter", () => submitOrComplete(), { when: "always" });
    cleanup(off);
  });

  // The card is a field's well, so the kit's focus-within edge lights the
  // whole composer (pi-next's 3-point ring around `.composer`).
  const card = fieldLook({
    multiline: true,
    readonly: () => props.disabled === true,
    style: () => ({
      flexDirection: "column",
      // `fieldLook` starts a multiline well as a row that hugs its content;
      // as a column the card needs its rows to span it, or the bottom bar
      // shrinks to its chips and the send button sits mid-card instead of at
      // the far right.
      alignItems: "stretch",
      borderRadius: 14,
      borderCurve: "continuous",
      get backgroundColor(): string {
        const a = paneAlpha();
        return a >= 1 ? colors.surface : alpha(colors.surface, a);
      },
      boxShadow: finish.menu.boxShadow,
      paddingTop: COMPOSER_PADDING.top,
      paddingHorizontal: COMPOSER_PADDING.side,
      paddingBottom: COMPOSER_PADDING.bottom,
      gap: 8,
    }),
  });

  // The text sits on the card itself (no second well): the numbers are
  // `.chat-input-textarea` from `app/v5/composer.css`.
  const text = inputLook({
    multiline: true,
    readonly: () => props.disabled === true,
    style: () => ({
      flex: undefined,
      width: "100%",
      minHeight: TEXT_MIN_HEIGHT,
      maxHeight: TEXT_MAX_HEIGHT,
      paddingHorizontal: 2,
      paddingVertical: 1,
      fontSize: 13.5,
      // Points, not the CSS multiplier a `Text` takes: a native text view reads
      // a fractional line height as that many points, so `1.6` gave 1.6-point
      // lines and the text was there but invisible (13.5 × 1.6 = 21.6).
      lineHeight: 21.6,
      // The field's text: the app's font, Chinese first (a native field takes
      // the text's font, not its parent's).
      fontFamily: sans,
      backgroundColor: "transparent",
      borderWidth: 0,
      borderRadius: 0,
      boxShadow: "none",
    }),
  });

  const slashPopup = menuPopup({ side: "top", minWidth: SLASH_WIDTH });
  const slashSurface = popoverLook({ width: SLASH_WIDTH, compact: true });
  const slashRow = menuItemLook({
    style: {
      height: SLASH_ROW,
      paddingVertical: 0,
      paddingHorizontal: 10,
      gap: 9,
      borderRadius: radius.control,
    },
  });
  return (
    <View
      style={{
        paddingTop: 8,
        paddingHorizontal: desktop ? 24 : 12,
        paddingBottom: desktop ? 14 : 10,
        alignItems: "center",
      }}
    >
      <View style={{ width: "100%", maxWidth: COMPOSER_MAX_WIDTH(), gap: 8 }}>
        <If when={state().error ?? freshError()}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 8,
              paddingVertical: 5,
              borderRadius: radius.control,
              backgroundColor: tints.danger,
            }}
          >
            <Text style={{ flex: 1, fontSize: 11.5, color: colors.danger, numberOfLines: 2 }}>{state().error ?? freshError() ?? ""}</Text>
            <RoundButton
              icon="close"
              label={t("files.dismissError")}
              variant="secondary"
              size={20}
              onPress={() => {
                freshError.set(null);
                const id = sessionId();
                if (id) clearComposerError(id);
              }}
            />
          </View>
        </If>

        <If when={queueCount() > 0}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 2 }}>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Badge label={t("chat.queued", { count: queueCount() })} />
              <Each of={queuedPreview()} key="index">
                {(message) => (
                  <Text style={{ fontSize: 11.5, color: colors.text, numberOfLines: 1 }}>{message()}</Text>
                )}
              </Each>
            </View>
            <Button label={t("chat.recall")} variant="secondary" size="small" onPress={() => void recall()} />
          </View>
        </If>

        <View class={card.class} style={card.style} onFileDrop={dropFiles}>
          {/* A zero-size anchor: the palette is opened by the text (`open`),
              not by a press, but `Menu` still needs a trigger to place
              against. TODO(nsh): verify a controlled `Menu` opens with a
              never-pressed, zero-size trigger and still measures the anchor. */}
          <Menu
            open={slashOpen()}
            placement="top"
            align="start"
            offset={19}
            trigger={<View style={{ width: 0, height: 0 }} />}
            popupStyle={desktop ? { ...slashPopup.popupStyle, ...slashSurface } : slashPopup.popupStyle}
            popupStartingStyle={slashPopup.popupStartingStyle}
            backdropStyle={slashPopup.backdropStyle}
            onOpenChange={({ open }) => {
              if (!open) slashSuppressed.set(true);
            }}
          >
            <View testID="slash-command-head" style={slashHeadStyle}>
              <MenuLabel text={t("commandPalette.groupCommands")} />
              <Text style={{ ...menuItemNote(), fontSize: 11.5, color: colors.muted }}>
                {slashCommandsLoadingFor(sessionId() ?? "") ? t("i18n.loading") : `${filteredCommands().length}`}
              </Text>
            </View>

            <If when={slashCommandsError()[sessionId() ?? ""]}>
              <Text style={{ paddingHorizontal: 12, paddingVertical: 6, fontSize: 11.5, color: colors.danger }}>
                {slashCommandsError()[sessionId() ?? ""] ?? ""}
              </Text>
            </If>

            <Scroll style={{ maxHeight: SLASH_ROW * 10 }}>
              <View style={{ gap: 0 }}>
                <If when={filteredCommands().length === 0}>
                  <Text style={{ ...menuItemNote(), paddingHorizontal: 10, paddingVertical: 10 }}>
                    {t("commandPalette.empty")}
                  </Text>
                </If>
                <Each of={filteredCommands()} key={(command: SlashCommandInfo) => command.name}>
                  {(command) => (
                    <View
                      testID="slash-command-row"
                      onPress={() => applyCommand(command())}
                      style={{
                        ...slashRow.style,
                        backgroundColor: selectedCommand()?.name === command().name ? token("accent") : undefined,
                      }}
                      hoverStyle={slashRow.hoverStyle}
                      focusStyle={slashRow.focusStyle}
                      activeStyle={slashRow.activeStyle}
                    >
                      <Text
                        style={{
                          ...menuItemLabel(),
                          flexGrow: 0,
                          flexShrink: 1,
                          flexBasis: 92,
                          fontSize: 12.5,
                          fontWeight: "600",
                          fontFamily: mono,
                        }}
                      >
                        /{command().name}
                      </Text>
                      <If when={command().description}>
                        <Text
                          style={{
                            flex: 1,
                            minWidth: 0,
                            fontSize: 11.5,
                            color: colors.muted,
                            numberOfLines: 1,
                          }}
                        >
                          {slashCommandDescription(command()) ?? ""}
                        </Text>
                      </If>
                      <Text style={{ ...menuItemNote(), fontSize: 10.5 }}>{commandSource(command())}</Text>
                    </View>
                  )}
                </Each>
              </View>
            </Scroll>
          </Menu>

          {/* The `@` menu: the same anchor and popup as the slash palette
              (`ChatInput.tsx`'s file menu, ranked by `lib/file-fuzzy.ts`). */}
          <Menu
            open={mentionOpen()}
            placement="top"
            align="start"
            offset={19}
            trigger={<View style={{ width: 0, height: 0 }} />}
            popupStyle={desktop ? { ...slashPopup.popupStyle, ...slashSurface } : slashPopup.popupStyle}
            popupStartingStyle={slashPopup.popupStartingStyle}
            backdropStyle={slashPopup.backdropStyle}
            onOpenChange={({ open }) => {
              if (!open) mentionSuppressed.set(true);
            }}
          >
            <View style={slashHeadStyle}>
              <MenuLabel text={t("commandPalette.groupFiles")} />
              <Text style={{ ...menuItemNote(), fontSize: 11.5, color: colors.muted }}>
                {mentionLoading() ? t("i18n.loading") : `${mentionRows().length}`}
              </Text>
            </View>

            <Scroll style={{ maxHeight: SLASH_ROW * 10 }}>
              <View style={{ gap: 0 }}>
                <If when={mentionRows().length === 0}>
                  <Text style={{ ...menuItemNote(), paddingHorizontal: 10, paddingVertical: 10 }}>
                    {mentionLoading() ? t("chat.loadingFiles") : t("chat.noMatchingFiles")}
                  </Text>
                </If>
                <Each of={mentionRows()} key={(entry: FileIndexEntry) => entry.path}>
                  {(entry) => (
                    <View
                      onPress={() => applyMention(entry())}
                      style={{
                        ...slashRow.style,
                        backgroundColor: selectedMention()?.path === entry().path ? token("accent") : undefined,
                      }}
                      hoverStyle={slashRow.hoverStyle}
                      focusStyle={slashRow.focusStyle}
                      activeStyle={slashRow.activeStyle}
                    >
                      <Icon name={entry().isDir ? "folder" : "file"} size={13} tint={colors.muted} />
                      <Text
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 12,
                          fontFamily: mono,
                          color: colors.text,
                          numberOfLines: 1,
                        }}
                      >
                        {entry().path}
                      </Text>
                    </View>
                  )}
                </Each>
              </View>
            </Scroll>
          </Menu>

          {/* What Send will take: image thumbnails and the files already
              uploaded into the folder (their @mentions sit in the draft). */}
          <If when={pendingImages().length > 0 || pendingFiles().length > 0}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingBottom: 2 }}>
              <Each of={pendingImages()} key={(image: PendingImage) => image.id}>
                {(image) => (
                  <View style={{ width: 56, height: 56 }}>
                    <View
                      onPress={() => previewImage.set(image())}
                      role="button"
                      accessibilityLabel={t("chat.previewImage")}
                      style={{ width: 56, height: 56 }}
                    >
                      <Photo src={image().src} width={56} height={56} />
                    </View>
                    <View
                      onPress={() => removeImage(image().id)}
                      role="button"
                      accessibilityLabel={t("chat.removeImage")}
                      style={{
                        position: "absolute",
                        top: 2,
                        right: 2,
                        width: 18,
                        height: 18,
                        borderRadius: 9,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: alpha(colors.text, 0.6),
                      }}
                      hoverStyle={{ backgroundColor: alpha(colors.text, 0.8) }}
                    >
                      <Icon name="close" size={9} tint={colors.onLight} />
                    </View>
                  </View>
                )}
              </Each>
              <Each of={pendingFiles()} key={(file: PendingFile) => file.id}>
                {(file) => (
                  <FileChip
                    file={{ name: file().name, size: formatFileSize(file().size) }}
                    onRemove={() => removeFile(file().id)}
                  />
                )}
              </Each>
            </View>
          </If>

          <If when={prefsLoaded()} else={<View style={{ minHeight: TEXT_MIN_HEIGHT }} />}>
          <Input
            multiline
            ref={(node: FieldRef | null) => {
              field = node;
            }}
            testID="composer-input"
            value={draft()}
            readonly={props.disabled === true}
            submitBehavior={enterSendMode() === "ctrlEnter" ? "newline" : "submit"}
            placeholder={props.placeholder ?? t("chat.messagePlaceholder")}
            onChange={change}
            onSubmit={submitOrComplete}
            onKeyPress={keyPress}
            onPaste={(event) => void pasteImages(event)}
            onCompositionChange={({ composing: isComposing }) => composing.set(isComposing)}
            style={text.style}
          />
          </If>

          {/* The bottom bar: one "+" (the system picker, no upload menu),
              the model · strength chip, the free space, then one action at
              the far right. Idle it sends; while a turn runs it queues the
              draft (Shift-free, one rule), and with nothing to send it is
              the Stop button. */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View tooltip={<Tip label={t("chat.attachFiles")} />}>
              <Press
                disabled={props.disabled === true || attaching()}
                onPress={() => void attachFiles()}
                accessibilityLabel={t("chat.attachFiles")}
                hoverStyle={{ backgroundColor: colors.raised, borderColor: colors.faint }}
                style={{
                  width: PLUS_SIZE,
                  height: PLUS_SIZE,
                  borderRadius: PLUS_SIZE / 2,
                  borderWidth: 1,
                  borderColor: colors.fieldBorder,
                  backgroundColor: colors.field,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: props.disabled === true ? 0.5 : 1,
                }}
              >
                <If when={attaching()} else={<Icon name="plus" size={14} tint={colors.text} />}>
                  <Spinner size={12} tint={colors.accent} />
                </If>
              </Press>
            </View>

            <ModelPicker
              sessionId={sessionId()}
              cwd={props.cwd ?? activeCwd()}
              disabled={props.disabled === true}
              onModelChange={(model) => freshModel.set(model)}
              onThinkingChange={(level) => freshThinking.set(level)}
            />

            <View style={{ flex: 1 }} />

            <If
              when={running() && !canSend()}
              else={(
                <View tooltip={<Tip label={running() ? t("chat.queueAction") : t("chat.send")} />}>
                  <Press
                    disabled={!canSend() || pending() || props.disabled === true}
                    onPress={() => void submit()}
                    accessibilityLabel={t("chat.send")}
                    hoverStyle={{ opacity: 0.94 }}
                    style={{
                      width: SEND_SIZE,
                      height: SEND_SIZE,
                      borderRadius: SEND_SIZE / 2,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: colors.light,
                      boxShadow: finish.light.boxShadow,
                    }}
                  >
                    <View testID="composer-send">
                      <Icon name="arrow-up" size={14} tint={colors.onLight} />
                    </View>
                  </Press>
                </View>
              )}
            >
              <View tooltip={<Tip label={t("chat.stop")} />}>
                <Press
                  disabled={pending()}
                  onPress={abort}
                  accessibilityLabel={t("chat.stop")}
                  hoverStyle={{ opacity: 0.94 }}
                  style={{
                    width: SEND_SIZE,
                    height: SEND_SIZE,
                    borderRadius: SEND_SIZE / 2,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.light,
                    boxShadow: finish.light.boxShadow,
                  }}
                >
                  <View testID="composer-stop">
                    <Glyph name="stop" size={12} tint={colors.onLight} />
                  </View>
                </Press>
              </View>
            </If>
          </View>
        </View>
      </View>

      {/* A pasted or picked image, full size over the composer. */}
      <Dialog
        open={previewImage() !== null}
        onOpenChange={({ open }) => {
          if (!open) previewImage.set(null);
        }}
        closeOnEscape
        backdropStyle={backdrop()}
        style={{
          width: Math.min(1100, windowSize().width - 40),
          height: Math.min(800, windowSize().height - 40),
          borderRadius: 12,
          overflow: "hidden",
          backgroundColor: colors.background,
        }}
      >
        <View style={{ flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
          <Image
            src={previewImage()?.src ?? ""}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        </View>
      </Dialog>
    </View>
  );
}

/**
 * One poll. Kept outside the component body's reactive reads: the effect
 * passes the id, and the store's write does not subscribe the poll to itself.
 */
function refreshOnce(sessionId: string): void {
  void refreshComposerState(sessionId);
}
