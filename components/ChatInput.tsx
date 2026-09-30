"use client";

import React, { useRef, useState, useCallback, useEffect, useLayoutEffect, useImperativeHandle, forwardRef, KeyboardEvent, useSyncExternalStore } from "react";
import type { BuiltinSlashCommandResult, CompactResultInfo, QueuedMessages, SlashCommandInfo } from "@/hooks/useAgentSession";
import type { SkillsResponse } from "@/lib/api-types";
import type { TextContent, UserMessage } from "@/lib/types";
import type { SessionStatsInfo } from "@/lib/pi-types";
// fork:ui-stats-ring — 环浮窗的完整会话明细（原 composer 下方的统计长条内容）。
import { SessionStatsDetails, type SessionStatsSessionInfo } from "./SessionStatsBar";
import {
  clearDraft,
  getDraft,
  mergeRestoredSubmissionDraft,
  mergeRestoredSubmissionText,
  rekeyDraft as rekeyStoredDraft,
  setDraft,
  type ChatDraftImage,
} from "@/lib/draft-store";
import {
  MAX_ATTACHED_IMAGE_BYTES,
  MAX_ATTACHED_IMAGES,
  isBase64ImageWithinLimits,
} from "@/lib/image-attachments";
import {
  buildEntriesFromFiles, buildAtInsertText, extractAtQuery, filterFileEntries,
  type AtQueryMatch, type FileIndexEntry,
} from "@/lib/file-fuzzy";
// D2-PR-12 — mention 高亮：输入框 overlay 与消息正文共用同一套切词/校验。
import { tokenizeMentions } from "@/lib/mention-tokens";
import { useFileIndex, useSkillNames } from "@/hooks/useProjectContext";
import { FolderIcon, getFileIcon } from "./FileIcons";
import { ImagePreview } from "./ImagePreview";
import { useIsMobile, useIsCompact } from "@/hooks/useIsMobile";
import { useResizableHeight } from "@/hooks/useResizableHeight";
import { useI18n } from "@/hooks/useI18n";
import { useChatAppearance } from "@/hooks/useChatAppearance";
import { ThinkingIcon } from "./ThinkingIcon";
import type { ToolPreset } from "@/lib/tool-presets";
// fork:proma-02-mode — 会话权限模式
import { nextPermissionMode, PERMISSION_MODE_HINT_KEYS, PERMISSION_MODE_LABEL_KEYS, type PermissionMode } from "@/lib/permission-mode";
import { ModelSelector, type ModelSelectorOption } from "./ModelSelector";
import {
  favoriteModelKey,
  getFavoriteModelsServerSnapshot,
  getFavoriteModelsSnapshot,
  subscribeFavoriteModels,
  toggleFavoriteModelKey,
} from "@/lib/favorite-models";
import { ComposerContextStrip } from "./ComposerContextStrip";
import { TodoChip } from "./fork/TodoChip";
// fork:zc-08 — 附件 chip 的多类型预览（PDF / DOCX / 音视频 / 文本）。
import { AttachmentPreview } from "./fork/AttachmentPreview";
import type { TodoSummary } from "@/lib/todo-state";
import {
  normalizeSelectionContext,
  normalizeSessionReference,
  parseSessionReferenceClipboard,
  serializeComposerMessage,
  type SelectionContext,
  type SessionReference,
} from "@/lib/composer-context";
// fork:gap06-references — `&` 会话 / `#` MCP / `~` 待办 的行内引用 token
import {
  COMPOSER_REFERENCE_TRIGGERS,
  buildMcpReferenceItems,
  buildReferenceInsertText,
  buildSessionReferenceItems,
  buildTodoReferenceItems,
  extractReferenceQuery,
  filterMcpReferenceItems,
  filterSessionReferenceItems,
  filterTodoReferenceItems,
  replaceReferenceToken,
  sessionReferenceFromItem,
  type ComposerReferenceItem,
  type ComposerReferenceQuery,
  type ReferenceMcpItem,
  type ReferenceMcpSource,
  type ReferenceSessionItem,
  type ReferenceSessionSource,
} from "@/lib/composer-references";
import { ComposerReferenceMenu } from "./ComposerReferenceMenu";
import { PortalDropdown } from "./PortalDropdown";
// fork:gap07-attachments — 任意文件：分类 / 上限 / 路径引用
import {
  MAX_ATTACHED_FILE_BYTES,
  attachmentPreviewKind,
  buildAttachmentReference,
  expandAttachmentReferences,
  nextAvailableAttachmentName,
  planAttachments,
  type AttachmentPreviewKind,
  type AttachmentSkipReason,
} from "@/lib/composer-attachments";
import { encodeFilePathForApi, getFileName, joinFilePath } from "@/lib/file-paths";
import { desktopFilePathFor } from "@/lib/desktop-shell";
// fork:pr13-composer — 拖入文件 cwd 相对化 + Markdown 列表续行
import { toCwdRelativeMentions } from "@/lib/file-mentions";
import { continueMarkdownList } from "@/lib/markdown-list";
// fork:pr14-compact — 阅读态输入框塌陷（振荡坑见 lib/input-compact.ts 的注释）
import {
  nextInputCompactState,
  scrollRemaining,
  type InputCompactScrollDirection,
} from "@/lib/input-compact";
import { TEXT } from "@/lib/typography";

export { filterModelOptions } from "./ModelSelector";

export interface AttachedImage {
  data: string;   // base64, no prefix
  mimeType: string;
  previewUrl: string; // object URL for display
}

interface Props {
  onSend: (message: string, images?: AttachedImage[], contexts?: SelectionContext[], question?: string, sessionReferences?: SessionReference[]) => void;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[], contexts?: SelectionContext[], question?: string, sessionReferences?: SessionReference[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[], contexts?: SelectionContext[], question?: string, sessionReferences?: SessionReference[]) => void;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp", images?: AttachedImage[], contexts?: SelectionContext[], question?: string, sessionReferences?: SessionReference[]) => void;
  isStreaming: boolean;
  /** Text-only composer without the session controls or outer spacing. */
  compact?: boolean;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string; input?: string[] }[];
  modelError?: string | null;
  /** Diagnostics from resolving `enabledModels`, e.g. a pattern that matched nothing. */
  modelScopeWarnings?: string[];
  onModelChange?: (provider: string, modelId: string) => void;
  modelSwitching?: boolean;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  compactResult?: CompactResultInfo | null;
  toolPreset?: ToolPreset;
  onToolPresetChange?: (preset: ToolPreset) => void;
  /** fork:proma-02-mode — 会话权限模式（Chat-only 会话不显示这个控件）。 */
  permissionMode?: PermissionMode;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  /** fork:gap04-queue — 队列逐条操控（移除 / 拖拽排序 / 立即发送）。 */
  onQueueRemove?: (kind: "steer" | "followUp", index: number, expect: string) => void;
  onQueueMove?: (kind: "steer" | "followUp", from: number, to: number, expect: string) => void;
  onQueuePromote?: (index: number, expect: string) => void;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  queuedMessages?: QueuedMessages | null;
  /** fork:ui-todo — task list of this session, derived from the transcript. */
  todoSummary?: TodoSummary | null;
  /** fork:gap06-references — 当前会话 id，用于把“自己”从 `&` 建议里剔除。 */
  currentSessionId?: string | null;
  inputHistory?: string[];
  onRecallQueue?: () => void;
  slashCommands?: SlashCommandInfo[];
  slashCommandsLoading?: boolean;
  onLoadSlashCommands?: () => Promise<SlashCommandInfo[]> | SlashCommandInfo[];
  onBuiltinCommand?: (message: string) => Promise<BuiltinSlashCommandResult>;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  /** fork:design-components — 画板 20 的上下文环（.pw-ring）及其浮窗的数据源。 */
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  sessionStats?: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }; cost: number; totalMessages: number } | null;
  /** fork:ui-stats-ring — 环浮窗里的完整会话明细（原 composer 下方的统计长条内容）。 */
  statsDetails?: SessionStatsInfo | null;
  statsSession?: SessionStatsSessionInfo | null;
  /** 上一轮的结束原因（画板 01 帧 C 的浮窗末行）。 */
  lastStopReason?: string | null;
  onAudioUnlock?: () => void;
  draftKey?: string;
  /** Initial context items for a focused composer, such as the new-chat quote popover. */
  initialSelectionContexts?: SelectionContext[];
  /** Locate the original assistant message for a saved selection context. */
  onLocateSelectionContext?: (context: SelectionContext) => void;
  /** Open a referenced historical session when its composer chip is clicked. */
  onOpenSessionReference?: (reference: SessionReference) => void;
  /** Session working directory — enables the @ file autocomplete menu */
  cwd?: string | null;
  /** fork:zn-04 — the composer protrusion strip. Rendered by the caller but
   *  placed here, immediately above the card, because that adjacency is what the
   *  weld needs: any model banner between the two would break the joined shape
   *  (banner → strip → card is the only order that holds). */
  protrusion?: React.ReactNode;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  replaceMessage: (message: UserMessage) => void;
  prependText: (text: string) => void;
  addImages: (files: File[]) => void;
  /** fork:gap07-attachments — 任意文件（图片内联，其余落盘后插路径引用）。 */
  addFiles: (files: File[]) => void;
  addSelectionContext: (context: SelectionContext) => void;
  removeSelectionContext: (id: string) => void;
  clearSelectionContexts: () => void;
  addSessionReference: (reference: SessionReference) => void;
  removeSessionReference: (id: string) => void;
  clearSessionReferences: () => void;
  rekeyDraft: (previousKey: string, nextKey: string) => void;
  restoreSubmission: (
    text: string,
    images?: ChatDraftImage[],
    targetDraftKey?: string,
    contexts?: SelectionContext[],
    question?: string,
    sessionReferences?: SessionReference[],
  ) => void;
  /** fork:ui-stats-ring — 钉住上下文环浮窗（/session 命令与触屏入口）。 */
  openStatsPopover: () => void;
}

// "configured" sends no override, so the session follows settings.json defaultTools.
const TOOL_PRESETS = ["configured", "chat-only", "read-only", "default", "full"] as const;
type ToolPresetLabel = typeof TOOL_PRESETS[number];
const TOOL_PRESET_MAP: Record<ToolPresetLabel, ToolPreset> = {
  configured: "configured",
  "chat-only": "none",
  "read-only": "read-only",
  default: "default",
  full: "full",
};
const COMPOSITION_END_ENTER_GRACE_MS = 100;
const TEXT_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const ANCHORED_MENU_GAP = 8;

// fork:pr23-resize — composer 手动高度（竖向缩放）。
// 自动增高的 200px 上限是内容驱动的轴；手动高度是用户接管的另一条轴，因此下限/
// 上限单独定义。最小高度保底让工具栏在一行文本时仍然能完整放下。
const MIN_MANUAL_HEIGHT_DESKTOP = 104;
const MIN_MANUAL_HEIGHT_MOBILE = 80;
const MANUAL_MAX_HEIGHT_CAP = 480;
const MANUAL_MAX_HEIGHT_FRACTION = 0.55;
// fork:ui-composer-pop — 卡片窄于此宽度就把左侧控件收进「更多控件」：
// 全量工具条（最长的模型名 + 五个控件 + 右侧组）的自然宽度约 690px。
const NARROW_CONTROLS_SHELL_WIDTH = 700;
const INPUT_HEIGHT_STORAGE_KEY = "pi-chat-input-height";

// fork:pr14-compact — 真实用户滚动的「意图窗口」：wheel / touch / pointer / 滚动
// 按键之后这段时间内的 scroll 事件才被当作用户意图，程序化定位一概不算。
const COMPACT_INTENT_MS = 1200;
// 消息区能引发滚动的按键（焦点不在输入框 / 可编辑区域时才算阅读滚动）。
const COMPACT_SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Space", "Spacebar"]);

export function getUpwardMenuMaxHeight(menuBottom: number, visibleTop: number, gap = ANCHORED_MENU_GAP): number {
  return Math.max(0, Math.floor(menuBottom - visibleTop - gap));
}

export function cycleListIndex(index: number, length: number, delta: number): number {
  if (length <= 0) return 0;
  return ((index + delta) % length + length) % length;
}

export function replaceLinksWithMarkdown(
  text: string,
  links: Iterable<{ label: string; href: string; occurrence: number }>,
): string | null {
  let result = "";
  let searchFrom = 0;
  let replaced = false;

  for (const { label, href, occurrence } of links) {
    if (!label || !href) continue;
    let index = 0;
    for (let match = 0; match <= occurrence; match++) {
      index = text.indexOf(label, match ? index + label.length : 0);
      if (index < 0) break;
    }
    if (index < searchFrom) continue;
    const escapedLabel = label.replace(/([\\[\]])/g, "\\$1");
    const escapedHref = href.replace(/([\\()])/g, "\\$1");
    result += `${text.slice(searchFrom, index)}[${escapedLabel}](${escapedHref})`;
    searchFrom = index + label.length;
    replaced = true;
  }

  return replaced ? result + text.slice(searchFrom) : null;
}

function getVisibleTopBoundary(element: HTMLElement): number {
  let visibleTop = window.visualViewport?.offsetTop ?? 0;

  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden" || overflowY === "clip") {
      visibleTop = Math.max(visibleTop, parent.getBoundingClientRect().top + parent.clientTop);
    }
  }

  return visibleTop;
}

function subscribeUpwardMenuMaxHeight(
  menu: HTMLElement,
  onChange: (height: number) => void,
): () => void {
  let frameId: number | null = null;
  const update = () => {
    frameId = null;
    onChange(getUpwardMenuMaxHeight(
      menu.getBoundingClientRect().bottom,
      getVisibleTopBoundary(menu),
    ));
  };
  const scheduleUpdate = () => {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(update);
  };

  update();
  const parent = menu.parentElement;
  const layoutContainer = parent?.parentElement;
  const anchorObserver = typeof ResizeObserver === "undefined" || !parent
    ? null
    : new ResizeObserver(scheduleUpdate);
  if (parent) anchorObserver?.observe(parent);
  if (layoutContainer) anchorObserver?.observe(layoutContainer);
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", scheduleUpdate);
  viewport?.addEventListener("scroll", scheduleUpdate);
  window.addEventListener("resize", scheduleUpdate);
  window.addEventListener("scroll", scheduleUpdate, true);

  return () => {
    anchorObserver?.disconnect();
    viewport?.removeEventListener("resize", scheduleUpdate);
    viewport?.removeEventListener("scroll", scheduleUpdate);
    window.removeEventListener("resize", scheduleUpdate);
    window.removeEventListener("scroll", scheduleUpdate, true);
    if (frameId !== null) cancelAnimationFrame(frameId);
  };
}

/** 在 root 里找面积最大的「在文档流里的」纵向滚动元素；绝对定位（弹层 / 面板）
 *  一律排除，避免把 stats 浮层、菜单当消息区。composer 自身及其内部同样排除。 */
function largestFlowScrollable(root: HTMLElement, composerRoot: HTMLElement, classHint: boolean): HTMLElement | null {
  const selector = classHint
    ? "[class*='overflow-y-auto'], [class*='overflow-auto']"
    : "*";
  let best: HTMLElement | null = null;
  let bestArea = 0;
  for (const element of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
    if (composerRoot.contains(element) || element.contains(composerRoot)) continue;
    const style = window.getComputedStyle(element);
    if (style.overflowY !== "auto" && style.overflowY !== "scroll") continue;
    if (style.position === "absolute" || style.position === "fixed") continue;
    if (style.display === "none" || style.visibility === "hidden") continue;
    const area = element.clientHeight * element.clientWidth;
    if (element.clientHeight > 0 && element.clientWidth > 0 && area > bestArea) {
      best = element;
      bestArea = area;
    }
  }
  return best;
}

/**
 * fork:pr14-compact — 从 composer 出发定位 ChatWindow 的消息滚动容器。
 *
 * 本仓库不允许改 ChatWindow（拿不到 scroll ref），所以按 DOM 结构找：从 composer
 * 向上逐层找最近的、含有「在流中的纵向滚动元素」的祖先，并在其中取面积最大者
 *  —— 消息列是主区里面积最大的滚动区；先用 Tailwind 的 overflow-y-auto 类名
 * 缩小扫描范围，类名不匹配时再回退到全量扫描。
 */
function findMessagesScrollContainer(composerRoot: HTMLElement): HTMLElement | null {
  if (typeof window === "undefined") return null;
  let node: HTMLElement | null = composerRoot.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    const best = largestFlowScrollable(node, composerRoot, true) ?? largestFlowScrollable(node, composerRoot, false);
    if (best) return best;
    node = node.parentElement;
  }
  return null;
}

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_LEVEL_DESC_KEYS: Record<typeof THINKING_LEVELS[number], string> = {
  auto: "chat.thinkingUseDefault", off: "chat.thinkingOff", minimal: "chat.thinkingMinimal", low: "chat.thinkingLow",
  medium: "chat.thinkingMedium", high: "chat.thinkingHigh", xhigh: "chat.thinkingXhigh", max: "chat.thinkingMax",
};

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return tokens.toLocaleString();
}

/**
 * fork:design-components —— 附件芯片的图标名 = 画板 20「附件与引用」用的那组 lucide
 * （image / file-text / file / music / play）。芯片是 .pw-chip，图标走 <i data-ico>，
 * 不再按扩展名去调 getFileIcon 的 catppuccin 图标集 —— 画板里没有第二套图标。
 */
function attachmentChipIcon(kind: AttachmentPreviewKind): string {
  switch (kind) {
    case "image": return "image";
    case "audio": return "music";
    case "video": return "play";
    case "pdf":
    case "docx":
    case "text": return "file-text";
    default: return "file";
  }
}

type BuiltinSlashCommand = {
  name: string;
  description: string;
  source: "builtin";
  availableWhileStreaming?: boolean;
};

type SlashCommandPaletteItem = SlashCommandInfo | BuiltinSlashCommand;

type SlashCommandSource = SlashCommandPaletteItem["source"];

const BUILTIN_SLASH_COMMANDS: BuiltinSlashCommand[] = [
  { name: "compact", description: "chat.commandCompact", source: "builtin" },
  // fork:upstream-0.9.2-auto-compact — 处理分支早就有了，调色板里没列出来，等于用户看不到。
  { name: "auto-compact", description: "chat.commandAutoCompact", source: "builtin" },
  { name: "reload", description: "chat.commandReload", source: "builtin" },
  { name: "name", description: "chat.commandName", source: "builtin" },
  { name: "session", description: "chat.commandSession", source: "builtin", availableWhileStreaming: true },
  { name: "copy", description: "chat.commandCopy", source: "builtin", availableWhileStreaming: true },
  { name: "clone", description: "chat.commandClone", source: "builtin" },
];

function getBuiltinSlashCommand(message: string): BuiltinSlashCommand | undefined {
  const match = message.trim().match(/^\/([^\s]+)(?:\s|$)/);
  if (!match) return undefined;
  return BUILTIN_SLASH_COMMANDS.find((command) => command.name === match[1]);
}

export function canRunBuiltinSlashCommandWhileStreaming(message: string): boolean {
  return getBuiltinSlashCommand(message)?.availableWhileStreaming === true;
}

export function isExactSlashCommand(message: string, command: SlashCommandPaletteItem): boolean {
  return command.source === "builtin" && message.trim() === `/${command.name}`;
}

export function canClearBuiltinCommandInput(message: string, imageCount: number, submittedMessage: string): boolean {
  return imageCount === 0 && message.trim() === submittedMessage;
}

const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt", "skill"];

const SLASH_SOURCE_GROUP_LABEL_KEYS: Record<SlashCommandSource, string> = {
  builtin: "chat.builtIn",
  extension: "chat.extensions",
  prompt: "chat.prompts",
  skill: "chat.skills",
};

const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
  skill: 3,
};

function slashMatchRank(command: SlashCommandPaletteItem, query: string, t: (key: string) => string): number {
  const name = command.name.toLowerCase();
  const description = getSlashDescription(command, t).toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (description.includes(query)) return 3;
  return 4;
}

function getSlashDescription(command: SlashCommandPaletteItem, t: (key: string) => string): string {
  return command.source === "builtin" ? t(command.description) : command.description ?? "";
}

// Skill slash commands are named "skill:<skillName>"; look the skill up in the
// dormancy map fetched from /api/skills. Unknown skills are treated as active.
function isDormantSkillCommand(command: SlashCommandPaletteItem, dormancy: Record<string, boolean>): boolean {
  if (command.source !== "skill" || !command.name.startsWith("skill:")) return false;
  return dormancy[command.name.slice("skill:".length)] === true;
}

export function buildSlashCommandLayout(
  commands: SlashCommandPaletteItem[],
  dormancy: Record<string, boolean>,
) {
  let index = 0;
  const groups = SLASH_SOURCES
    .map((source) => {
      const sourceCommands = commands.filter((command) => command.source === source);
      const orderedCommands = source === "skill"
        ? [
            ...sourceCommands.filter((command) => !isDormantSkillCommand(command, dormancy)),
            ...sourceCommands.filter((command) => isDormantSkillCommand(command, dormancy)),
          ]
        : sourceCommands;
      return {
        source,
        items: orderedCommands.map((command) => ({ command, index: index++ })),
      };
    })
    .filter((group) => group.items.length > 0);

  return {
    commands: groups.flatMap((group) => group.items.map(({ command }) => command)),
    groups,
  };
}

const CLIENT_IMAGE_COMPRESSION_THRESHOLD_BYTES = 1024 * 1024;
const CLIENT_MAX_IMAGE_SIDE = 1024;
const CLIENT_JPEG_QUALITY = 0.85;

export function shouldCompressImageFile(file: Pick<File, "size" | "type">): boolean {
  return file.size > CLIENT_IMAGE_COMPRESSION_THRESHOLD_BYTES && file.type !== "image/gif";
}

function readImageFile(file: Blob, mimeType: string): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = typeof reader.result === "string" ? reader.result.split(",")[1] : undefined;
      if (!data) {
        reject(new Error("Failed to read image"));
        return;
      }
      resolve({ data, mimeType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function compressImageFile(file: File): Promise<{ data: string; mimeType: string }> {
  const original = () => readImageFile(file, file.type);
  if (!shouldCompressImageFile(file) || typeof createImageBitmap !== "function") return original();

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return original();

  try {
    const scale = Math.min(1, CLIENT_MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return original();
    // 非主题值：JPEG 没有透明通道，重编码前必须铺一层不透明底色。
    // 这里刻意不用 token —— 它是图像处理的常量，跟着主题变会让同一张图
    // 在深浅主题下编出不同字节。
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", CLIENT_JPEG_QUALITY).split(",")[1];
    return data && data.length < Math.ceil(file.size / 3) * 4
      ? { data, mimeType: "image/jpeg" }
      : original();
  } catch {
    return original();
  } finally {
    bitmap.close();
  }
}

function imageToDraftImage(image: AttachedImage): ChatDraftImage {
  return { data: image.data, mimeType: image.mimeType };
}

function draftImageToAttachedImage(image: ChatDraftImage): AttachedImage {
  return {
    ...image,
    previewUrl: `data:${image.mimeType};base64,${image.data}`,
  };
}

function draftImagesToAttachedImages(images: ChatDraftImage[] | undefined): AttachedImage[] {
  return (images ?? [])
    .filter(isBase64ImageWithinLimits)
    .slice(0, MAX_ATTACHED_IMAGES)
    .map(draftImageToAttachedImage);
}

export function canRestoreUserMessage(
  value: string,
  attachedImageCount: number,
  pendingImageCount: number,
): boolean {
  return !value.trim() && attachedImageCount === 0 && pendingImageCount === 0;
}

export function getUserMessageText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function getUserMessageDraftImages(message: UserMessage): ChatDraftImage[] {
  if (typeof message.content === "string") return [];
  return message.content.flatMap((block) => {
    if (block.type !== "image") return [];

    // Support both the current nested image format and older flat pi-ai entries.
    const flat = block as unknown as { data?: unknown; mimeType?: unknown };
    const data = block.source?.type === "base64" ? block.source.data : flat.data;
    const mimeType = block.source?.type === "base64" ? block.source.media_type : flat.mimeType;
    if (typeof data !== "string" || typeof mimeType !== "string") return [];

    const image = { data, mimeType };
    return isBase64ImageWithinLimits(image) ? [image] : [];
  });
}

function revokeImagePreview(image: AttachedImage): void {
  if (image.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(image.previewUrl);
  }
}

/**
 * fork:gap04-queue — 队列里的一行：可拖拽排序，带「立即发送」（仅 follow-up）与「移除」。
 *
 * fork:design-components —— 整行直接是画板 20「流式排队」那一行：`.pw-prow`（行盒）
 * + `.pw-badge count`（序号）+ `.pw-btn sm`（两个动作）。动作常驻而不是 hover 才现，
 * 因为画板就是这么画的，键盘用户也不再需要先 hover 才看得见可点的钮。
 */
function QueuedMessageRow({
  kind,
  text,
  index,
  promoteTitle,
  removeTitle,
  onRemove,
  onPromote,
  onDragStart,
  onDropOn,
  dragging,
}: {
  kind: "steer" | "follow-up";
  text: string;
  index: number;
  promoteTitle: string;
  removeTitle: string;
  onRemove: () => void;
  onPromote?: () => void;
  onDragStart?: () => void;
  onDropOn?: () => void;
  dragging?: boolean;
}) {
  return (
    <div
      title={text}
      draggable={Boolean(onDragStart)}
      onDragStart={onDragStart}
      onDragOver={(event) => { if (onDropOn) event.preventDefault(); }}
      onDrop={(event) => { if (onDropOn) { event.preventDefault(); onDropOn(); } }}
      className="pw-prow"
      // 拖动中的那一行压暗（运行时状态，不进 board.css）。
      style={{ opacity: dragging ? 0.4 : 1, cursor: onDragStart ? "grab" : "default" }}
    >
      <span className="pw-badge count">{index + 1}</span>
      <span className="pw-badge">{kind}</span>
      <span className="grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</span>
      {onPromote && (
        <button
          type="button"
          className="pw-btn sm"
          onClick={onPromote}
          title={promoteTitle}
          aria-label={promoteTitle}
        >
          <span className="pw-ico"><i data-ico="send" data-size="13"></i></span>
        </button>
      )}
      <button
        type="button"
        className="pw-btn sm"
        onClick={onRemove}
        title={removeTitle}
        aria-label={`${removeTitle} #${index + 1}`}
      >
        <span className="pw-ico"><i data-ico="x" data-size="13"></i></span>
      </button>
    </div>
  );
}

function ModelNoticeBanner({ tone, title, body, onClose }: { tone: "error" | "warning"; title: string; body: string; onClose?: () => void }) {
  // fork:design-components —— 通知条 = 画板 50 的 .pw-alert：error 是基态（软红底），
  // warning 走 .warn 变体。颜色不再在组件里拼三元组，语义色由 board.css 一处给出。
  return (
    <div
      role="alert"
      className={`pw-alert${tone === "error" ? "" : " warn"}`}
      style={{
        maxHeight: 120,
        marginBottom: 8,
        overflowY: "auto",
      }}
    >
      <span className="pw-ico"><i data-ico={tone === "error" ? "circle-alert" : "triangle-alert"} data-size="14"></i></span>
      <div className="grow" style={{ minWidth: 0 }}>
        <b style={{ fontWeight: 500 }}>{title}</b>
        <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{body}</div>
      </div>
      {onClose && (
        /* 关闭 = 画板 20/50 的 .pw-iconbtn（22px 方钮 / hover 叠色），不是符号字形。 */
        <button
          type="button"
          className="pw-iconbtn"
          onClick={onClose}
          aria-label="Dismiss"
          title="Dismiss"
        >
          <span className="pw-ico"><i data-ico="x" data-size="13"></i></span>
        </button>
      )}
    </div>
  );
}

export function ModelErrorBanner({ error }: { error?: string | null }) {
  const { t } = useI18n();
  if (!error) return null;
  return <ModelNoticeBanner tone="error" title={t("chat.modelError")} body={error} />;
}

/** True when the selected model is known to accept image input (#584). Unknown modality info never blocks the user. */
export function modelSupportsImageInput(
  model: { provider: string; modelId: string } | null | undefined,
  modelList: { id: string; name: string; provider: string; input?: string[] }[] | undefined
): boolean {
  if (!model) return true;
  const entry = modelList?.find((m) => m.provider === model.provider && m.id === model.modelId);
  if (!entry || !entry.input) return true;
  return entry.input.includes("image");
}

/** Surfaces `enabledModels` patterns that matched nothing, so a typo is visible (#307). */
export function ModelScopeWarningBanner({ warnings }: { warnings?: string[] }) {
  const { t } = useI18n();
  if (!warnings || warnings.length === 0) return null;
  return (
    <ModelNoticeBanner
      tone="warning"
      title={warnings.length > 1 ? t("chat.modelScopeWarnings") : t("chat.modelScopeWarning")}
      body={warnings.join("\n")}
    />
  );
}

/** 星标图标；已收藏填星、未收藏画星划（画板图标集是 lucide 描边，没有填充变体）。 */
function FavoriteStarIcon({ filled }: { filled: boolean }) {
  return (
    <span className="pw-ico" aria-hidden="true">
      <i data-ico={filled ? "star" : "star-off"} data-size="14"></i>
    </span>
  );
}

/**
 * fork:pr17-favorites — 输入框侧的收藏模型菜单。
 *
 * 与设置页 ModelsConfig 共用 lib/favorite-models 单一 store：任一入口的星标写入
 * 都会主动 notify，本组件通过 useSyncExternalStore 立即刷新；跨标签页则由
 * window storage 事件同步。模型下线的收藏项仍保留（置灰且不可点选），避免收藏被
 * 静默清掉。
 */
function FavoriteModelMenu({
  model,
  options,
  favorites,
  onSelect,
}: {
  model: { provider: string; modelId: string } | null | undefined;
  options: ModelSelectorOption[];
  favorites: Set<string>;
  onSelect: (provider: string, modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  const optionByKey = new Map(options.map((option) => [favoriteModelKey(option.provider, option.modelId), option]));
  // 可用模型排在前面；下线条目保持收藏顺序并置灰保留。
  const entries = [...favorites]
    .map((key) => ({ key, option: optionByKey.get(key) }))
    .sort((a, b) => (a.option ? 0 : 1) - (b.option ? 0 : 1));
  const currentKey = model ? favoriteModelKey(model.provider, model.modelId) : null;
  const currentFavorited = currentKey !== null && favorites.has(currentKey);

  return (
    <div ref={rootRef} style={{ position: "relative", flexShrink: 0 }}>
      {/* fork:design-components —— 触发器 = 画板 20/50 的 .pw-iconbtn（22px 方钮 / hover 叠色 /
          is-on 选中），星标色继续由「已收藏」决定。 */}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("models.favorites")}
        title={t("models.favorites")}
        onClick={() => setOpen((current) => !current)}
        className={`pw-iconbtn${open ? " is-on" : ""}`}
        style={{
          width: "var(--spacing-token-button-composer, 28px)",
          height: "var(--spacing-token-button-composer, 28px)",
          cursor: "pointer",
          color: currentFavorited ? "var(--accent)" : "var(--n-muted)",
        }}
      >
        <FavoriteStarIcon filled={currentFavorited} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("models.favorites")}
          className="pw-pop anim-popover"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            zIndex: 300,
            width: 240,
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          <div className="pw-pop-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span>{t("models.favorites")}</span>
            {currentKey && (
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={currentFavorited}
                aria-label={currentFavorited ? t("models.unfavoriteModel") : t("models.favoriteCurrent")}
                title={currentFavorited ? t("models.unfavoriteModel") : t("models.favoriteCurrent")}
                onClick={() => toggleFavoriteModelKey(currentKey)}
                className="pw-iconbtn sm"
                style={{ color: currentFavorited ? "var(--accent)" : "var(--n-placeholder)", cursor: "pointer" }}
              >
                <FavoriteStarIcon filled={currentFavorited} />
              </button>
            )}
          </div>
          {entries.length === 0 ? (
            /* 空态与 / 菜单、@ 菜单同一条：.pw-prow + .pw-desc。 */
            <div className="pw-prow pw-desc">{t("models.noFavorites")}</div>
          ) : entries.map(({ key, option }) => (
            /* fork:design-components —— 行 = 画板 21 的 .pw-prow：可用模型挂 sparkles 图标、
               下线模型按画板同一行（circle-off + 压暗）保留但不可点。 */
            <div key={key} className="pw-inline" style={{ opacity: option ? 1 : 0.45 }}>
              <button
                type="button"
                role="menuitem"
                disabled={!option}
                onClick={() => {
                  if (!option) return;
                  setOpen(false);
                  onSelect(option.provider, option.modelId);
                }}
                title={option ? `${option.name} · ${option.provider}` : `${key} · ${t("models.unavailableModel")}`}
                className="pw-prow"
                style={{ flex: 1, minWidth: 0, cursor: option ? "pointer" : "not-allowed" }}
              >
                <span className="pw-ico"><i data-ico={option ? "sparkles" : "circle-off"} data-size="14"></i></span>
                <span className="grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {option?.name || option?.modelId || key.slice(key.indexOf(":") + 1)}
                </span>
              </button>
              <button
                type="button"
                className="pw-iconbtn sm"
                aria-label={t("models.unfavoriteModel")}
                title={t("models.unfavoriteModel")}
                onClick={() => toggleFavoriteModelKey(key)}
                style={{ color: "var(--accent)", cursor: "pointer" }}
              >
                <FavoriteStarIcon filled />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({  onSend, onAbort, onSteer, onFollowUp, isStreaming, model, isAutoModelSelection, modelNames, modelList, modelError, modelScopeWarnings, onModelChange, modelSwitching,
  onCompact, onAbortCompaction, isCompacting, compactError, compactResult, toolPreset, onToolPresetChange,
  permissionMode, onPermissionModeChange,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  retryInfo, queuedMessages, inputHistory = [], onRecallQueue, todoSummary, currentSessionId,
  onQueueRemove, onQueueMove, onQueuePromote,
  slashCommands, slashCommandsLoading, onLoadSlashCommands,
  onBuiltinCommand,
  soundEnabled, onSoundToggle, onAudioUnlock,
  contextUsage, sessionStats, lastStopReason, statsDetails = null, statsSession = null,
  onPromptWithStreamingBehavior,
  draftKey,
  initialSelectionContexts,
  onLocateSelectionContext,
  onOpenSessionReference,
  cwd,
  protrusion,
  compact = false,
}: Props, ref) {
  const { t } = useI18n();
  const { fontSize } = useChatAppearance();
  const isMobile = useIsMobile();
  // fork:pwa-tablet-tier — the composer's control strip is one non-wrapping row, so the
  // breakpoint that decides "inline or behind a button" has to be the tablet one, not the
  // phone one. Padding/width cosmetics below still key off `isMobile`: they are about
  // touch target size, not about whether the row fits.
  // fork:ui-composer-pop — 视口断点不够用：右栏一开，聊天列在 1440 视口下也只剩
  // ~390px，工具条的右侧组（圆环/声音/发送）被顶出卡片裁掉。折叠判据加上
  // 卡片自身的实测宽度：700px 是全量工具条的自然宽度上限（模型名最长时）。
  const viewportCompact = useIsCompact();
  const [shellNarrow, setShellNarrow] = useState(false);
  const narrowControls = viewportCompact || shellNarrow;
  // fork:pr23-resize — 顶部手柄竖向缩放。`height === null` 保持内容驱动的自动
  // 高度；数字表示用户已接管。manualMode 时卡片挂内联固定高度，textarea 交给
  // `.is-manual-height` 的 CSS（`height: 100% !important`）填充并内部滚动，
  // 从而与自动增高互斥；引用回答形态（compact prop）与移动端不接管，避免旧的
  // 持久化高度破坏小布局。
  const inputShellRef = useRef<HTMLDivElement>(null);
  const manualModeRef = useRef(false);
  const minManualHeight = isMobile ? MIN_MANUAL_HEIGHT_MOBILE : MIN_MANUAL_HEIGHT_DESKTOP;
  const getMaxManualHeight = useCallback(() => {
    if (typeof window === "undefined") return MANUAL_MAX_HEIGHT_CAP;
    return Math.max(
      minManualHeight,
      Math.min(MANUAL_MAX_HEIGHT_CAP, Math.floor(window.innerHeight * MANUAL_MAX_HEIGHT_FRACTION)),
    );
  }, [minManualHeight]);
  const inputHeightResizer = useResizableHeight({
    ariaLabel: t("layout.resizeHint"),
    minHeight: minManualHeight,
    getMaxHeight: getMaxManualHeight,
    storageKey: INPUT_HEIGHT_STORAGE_KEY,
    targetRef: inputShellRef,
  });
  const manualHeight = inputHeightResizer.height;
  const manualMode = !compact && !isMobile && manualHeight !== null;
  manualModeRef.current = manualMode;

  // fork:ui-composer-pop — 实测卡片宽度驱动控件折叠。compact（引用回答）形态
  // 没有工具条，不参与；ref 未挂载时保持 false，避免首帧闪折叠态。
  useEffect(() => {
    if (compact || typeof ResizeObserver === "undefined") return;
    const el = inputShellRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth;
      setShellNarrow(width > 0 && width < NARROW_CONTROLS_SHELL_WIDTH);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [compact]);

  // fork:pr14-compact — 阅读态塌陷。状态机在 lib/input-compact.ts：只有
  // 「真实用户意图 + 向上滚 + 离底 > 120px」才收起；到底只认同向下的滚动；
  // ResizeObserver 复算一律传 "none"；focus 一定展开。这样收缩引起的
  // “浏览器把视口夹回底部”就不会把状态来回翻转。
  const [readingCompact, setReadingCompact] = useState(false);
  /** wheel / touch / pointer / 滚动按键触发的意图窗口（Date.now 上限）。 */
  const compactIntentUntilRef = useRef(0);
  /** 上一次 scroll 事件的 scrollTop，用来求方向。 */
  const lastScrollTopRef = useRef(0);
  /** 定位到的消息滚动容器（DOM 发现，见 findMessagesScrollContainer）。 */
  const messagesScrollRef = useRef<HTMLElement | null>(null);
  /** 输入区是否聚焦；聚焦期间不收起，且 focus 一定展开。 */
  const inputFocusedRef = useRef(false);
  // fork:pr17-favorites — 与设置页 ModelsConfig 共用同一个收藏 store；
  // 同文档写入由 store 主动 notify，跨标签页由 window storage 事件同步。
  const favoriteModels = useSyncExternalStore(subscribeFavoriteModels, getFavoriteModelsSnapshot, getFavoriteModelsServerSnapshot);
  const initialDraft = draftKey ? getDraft(draftKey) : null;
  const [value, setValue] = useState(() => initialDraft?.value ?? "");
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const [controlsMenuOpen, setControlsMenuOpen] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(() => (
    draftImagesToAttachedImages(initialDraft?.images)
  ));
  const [selectionContexts, setSelectionContexts] = useState<SelectionContext[]>(() => (
    (initialDraft?.contexts ?? initialSelectionContexts ?? []).flatMap((context) => {
      const normalized = normalizeSelectionContext(context);
      return normalized ? [normalized] : [];
    })
  ));
  const [sessionReferences, setSessionReferences] = useState<SessionReference[]>(() => (
    (initialDraft?.sessionReferences ?? []).flatMap((reference) => {
      const normalized = normalizeSessionReference(reference);
      return normalized ? [normalized] : [];
    })
  ));
  const trimmedValue = value.trimStart();
  const bashMode = attachedImages.length === 0 && trimmedValue.startsWith("!");
  const bashExcluded = bashMode && trimmedValue.startsWith("!!");
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [slashMenuMaxHeight, setSlashMenuMaxHeight] = useState<number | null>(null);
  const [atQuery, setAtQuery] = useState<AtQueryMatch | null>(null);
  const [atMenuOpen, setAtMenuOpen] = useState(false);
  const [atMenuMaxHeight, setAtMenuMaxHeight] = useState<number | null>(null);
  const [atActiveIndex, setAtActiveIndex] = useState(0);
  // fork:gap06-references — 行内引用菜单（& 会话 / # MCP / ~ 待办）。
  // 与 `@` 菜单平行：两个抽取器都锚定光标，所以同一时刻最多只有一个能命中（见
  // lib/composer-references.ts 的 extractReferenceQuery）。
  const [referenceQuery, setReferenceQuery] = useState<ComposerReferenceQuery | null>(null);
  const [referenceMenuOpen, setReferenceMenuOpen] = useState(false);
  const [referenceActiveIndex, setReferenceActiveIndex] = useState(0);
  const [referenceMenuMaxHeight, setReferenceMenuMaxHeight] = useState<number | null>(null);
  const [referenceSessions, setReferenceSessions] = useState<ReferenceSessionItem[] | null>(null);
  const [referenceMcp, setReferenceMcp] = useState<ReferenceMcpItem[] | null>(null);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const referenceMenuRef = useRef<HTMLDivElement>(null);
  const referenceItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** 数据源缓存时间戳（10s，与文件索引同款策略）。 */
  const referenceMetaRef = useRef<{ sessions?: number; mcp?: string }>({});
  /** 防止同一个数据源被并发拉取。 */
  const referenceFetchRef = useRef<{ sessions: boolean; mcp: string | null }>({ sessions: false, mcp: null });
  const [imageWarningDismissed, setImageWarningDismissed] = useState(false);
  /**
   * fork:gap04-queue — 正在拖拽的队列行。
   *
   * 载荷用 **ref** 存：drop 可能在 dragstart 的同一个 tick 里发生（真实拖拽里也有极快的
   * 甩拖），这时 React 还没重渲染，state 读到的是旧值（null）→ 拖拽会静默失效。
   * state 只负责置灰的视觉效果。
   */
  const [draggingQueue, setDraggingQueue] = useState<{ kind: "steer" | "followUp"; index: number } | null>(null);
  const draggingQueueRef = useRef<{ kind: "steer" | "followUp"; index: number } | null>(null);
  const beginQueueDrag = (kind: "steer" | "followUp", index: number) => {
    draggingQueueRef.current = { kind, index };
    setDraggingQueue({ kind, index });
  };
  const endQueueDrag = () => {
    draggingQueueRef.current = null;
    setDraggingQueue(null);
  };
  /** 拖拽落点 → 插入下标：往下拖落在目标行之后，往上拖落在它之前（“所见即所得”）。 */
  const queueDropTarget = (from: number, hovered: number) => (from < hovered ? hovered + 1 : hovered);
  /** fork:gap07-attachments — 附件落盘结果提示；每一次拖入都有可见交代，不静默丢。 */
  const [attachmentNotice, setAttachmentNotice] = useState<{
    added: string[];
    skipped: Array<{ name: string; reason: AttachmentSkipReason }>;
    failed: string[];
  } | null>(null);
  // fork:zc-08 — 已插入输入框的 `@文件名` 附件 chips（点开预览 / X 移除）。
  // 发送用的完整路径真相仍由 attachedReferencePathsRef 持有，这里只为渲染。
  const [referenceAttachments, setReferenceAttachments] = useState<Array<{ path: string; name: string; kind: AttachmentPreviewKind }>>([]);
  const [historyMenuOpen, setHistoryMenuOpen] = useState(false);
  const [historyActiveIndex, setHistoryActiveIndex] = useState(0);
  const [builtinCommandPending, setBuiltinCommandPending] = useState(false);
  const builtinCommandPendingRef = useRef(false);
  const [fileIndex, setFileIndex] = useState<{ cwd: string; entries: FileIndexEntry[]; truncated: boolean } | null>(null);
  const [fileIndexLoading, setFileIndexLoading] = useState(false);
  const [atServerResult, setAtServerResult] = useState<{ cwd: string; query: string; matches: FileIndexEntry[] } | null>(null);
  // D2-PR-12 — 高亮用的共享索引/技能缓存（模块级 + 30s TTL + 并发去重）。
  // 上方 @ 菜单继续用它自己的 10s TTL 状态：两条取数路径互不影响，避免动到补全行为。
  const fileIndexSnapshot = useFileIndex(cwd);
  const skillNames = useSkillNames(cwd);
  const [skillDormancyState, setSkillDormancyState] = useState<{
    cwd: string;
    values: Record<string, boolean>;
  } | null>(null);
  const skillDormancy = cwd && skillDormancyState?.cwd === cwd
    ? skillDormancyState.values
    : {};

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // D2-PR-12 — 高亮层：viewport 精确盖住 textarea 的内容盒，layer 随滚动位移。
  const highlightViewportRef = useRef<HTMLDivElement>(null);
  const highlightLayerRef = useRef<HTMLDivElement>(null);
  const toolDropdownRef = useRef<HTMLDivElement>(null);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const controlsMenuRef = useRef<HTMLDivElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const slashCommandsRequestedRef = useRef(false);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const slashItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const atMenuRef = useRef<HTMLDivElement>(null);
  const atItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const historyItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const fileIndexMetaRef = useRef<{ cwd: string; fetchedAt: number } | null>(null);
  const fileIndexFetchingRef = useRef<string | null>(null);
  const draftKeyRef = useRef(draftKey);
  const initialSelectionContextsRef = useRef(initialSelectionContexts);
  const valueRef = useRef(value);
  // fork:ui — 本次输入里插入过的附件完整路径（`@文件名` ↔ 完整路径 的还原表）。
  // 输入框里只显示短名，发出去的是路径（见 expandAttachmentReferences）。
  const attachedReferencePathsRef = useRef<string[]>([]);
  const attachedImagesRef = useRef(attachedImages);
  const selectionContextsRef = useRef(selectionContexts);
  const sessionReferencesRef = useRef(sessionReferences);
  const pendingImageCountRef = useRef(0);
  valueRef.current = value;
  attachedImagesRef.current = attachedImages;
  selectionContextsRef.current = selectionContexts;
  sessionReferencesRef.current = sessionReferences;
  initialSelectionContextsRef.current = initialSelectionContexts;

  // fork:ui-stats-ring —— 环浮窗支持点击圆环**钉住**（/session 命令与触屏也靠它打开）。
  const [ringPinned, setRingPinned] = useState(false);
  // fork:context-pop-portal —— 浮窗 portal 到 body 之后，CSS 的
  // `.composer-ring:hover .composer-ring-pop` 够不着它了，可见性改由状态驱动。
  const [ringHovered, setRingHovered] = useState(false);
  // fork:context-pop-portal —— 明细浮窗的宽度要跟着视口（原 inline style 是
  // `min(680px, 100vw - 48px)`）。PortalDropdown 按这个数算左缘，窄屏时不给它
  // 一个真实宽度就会把浮窗推到屏幕外。
  const [ringPopWidth, setRingPopWidth] = useState(680);
  useEffect(() => {
    const fit = () => setRingPopWidth(Math.min(680, Math.max(320, window.innerWidth - 48)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  const ringRef = useRef<HTMLSpanElement>(null);
  const ringPopRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ringPinned) return;
    const onPointerDown = (event: MouseEvent) => {
      // 浮窗已经不在 ringRef 里面了，点外部要连它一起算。
      const target = event.target as Node;
      if (!ringRef.current?.contains(target) && !ringPopRef.current?.contains(target)) setRingPinned(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [ringPinned]);

  useImperativeHandle(ref, () => ({
    openStatsPopover() {
      setRingPinned(true);
    },
    insertIfEmpty(text: string) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (current.trim()) return;
      valueRef.current = text;
      setValue(text);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    replaceMessage(message: UserMessage) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (!canRestoreUserMessage(current, attachedImagesRef.current.length, pendingImageCountRef.current)) return;

      const restoredText = getUserMessageText(message);
      const restoredImages = draftImagesToAttachedImages(getUserMessageDraftImages(message));
      valueRef.current = restoredText;
      attachedImagesRef.current = restoredImages;
      // fork:zc-08 — 恢复历史消息会整段替换文本，旧 chip 不能再指向旧输入。
      setReferenceAttachments([]);
      setValue(restoredText);
      setAtQuery(null);
      setHistoryMenuOpen(false);
      selectionContextsRef.current = [];
      setSelectionContexts([]);
      setAttachedImages((prev) => {
        prev.forEach(revokeImagePreview);
        return restoredImages;
      });
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    prependText(text: string) {
      if (!text.trim()) return;
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      // Mirrors the TUI's queue restore: queued text first, then whatever
      // the user already typed, separated by a blank line.
      const combined = [text, current].filter((t) => t.trim()).join("\n\n");
      valueRef.current = combined;
      setValue(combined);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(combined.length, combined.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    rekeyDraft(previousKey: string, nextKey: string) {
      if (previousKey === nextKey) return;
      if (draftKeyRef.current !== previousKey) {
        rekeyStoredDraft(previousKey, nextKey);
        return;
      }

      const currentDraft = {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
        contexts: selectionContextsRef.current,
        sessionReferences: sessionReferencesRef.current,
      };
      const moved = rekeyStoredDraft(previousKey, nextKey, currentDraft) ?? { value: "", images: [], contexts: [], sessionReferences: [] };
      const unchanged = moved.value === currentDraft.value
        && moved.images.length === currentDraft.images.length
        && moved.images.every((image, index) => (
          image.data === currentDraft.images[index]?.data
          && image.mimeType === currentDraft.images[index]?.mimeType
        ))
        && (moved.contexts?.length ?? 0) === currentDraft.contexts.length
        && (moved.contexts ?? []).every((context, index) => {
          const current = currentDraft.contexts[index];
          return current
            && context.id === current.id
            && context.text === current.text
            && context.sourceFilePath === current.sourceFilePath
            && context.sourceAbsolutePath === current.sourceAbsolutePath
            && context.sourceSessionId === current.sourceSessionId
            && context.sourceEntryId === current.sourceEntryId
            && context.sourceStartOffset === current.sourceStartOffset
            && context.sourceEndOffset === current.sourceEndOffset
            && context.label === current.label;
        })
        && (moved.sessionReferences?.length ?? 0) === currentDraft.sessionReferences.length
        && (moved.sessionReferences ?? []).every((reference, index) => (
          reference.id === currentDraft.sessionReferences[index]?.id
          && reference.title === currentDraft.sessionReferences[index]?.title
          && reference.cwd === currentDraft.sessionReferences[index]?.cwd
        ));
      draftKeyRef.current = nextKey;
      if (unchanged) return;

      const movedImages = draftImagesToAttachedImages(moved.images);
      valueRef.current = moved.value;
      attachedImagesRef.current = movedImages;
      // fork:zc-08 — 草稿换 key 后输入框文本整段换了，chip 不跟随。
      setReferenceAttachments([]);
      setValue(moved.value);
      setAttachedImages((current) => {
        current.forEach(revokeImagePreview);
        return movedImages;
      });
      const movedContexts = (moved.contexts ?? []).flatMap((context) => {
        const normalized = normalizeSelectionContext(context);
        return normalized ? [normalized] : [];
      });
      selectionContextsRef.current = movedContexts;
      setSelectionContexts(movedContexts);
      const movedSessionReferences = (moved.sessionReferences ?? []).flatMap((reference) => {
        const normalized = normalizeSessionReference(reference);
        return normalized ? [normalized] : [];
      });
      sessionReferencesRef.current = movedSessionReferences;
      setSessionReferences(movedSessionReferences);
      setAtQuery(null);
      setHistoryMenuOpen(false);
    },
    restoreSubmission(
      text: string,
      images?: ChatDraftImage[],
      targetDraftKey?: string,
      contexts?: SelectionContext[],
      question?: string,
      submittedSessionReferences?: SessionReference[],
    ) {
      if (!text.trim() && !images?.length) return;

      // clearInput is queued before the submission handler runs. Compose with
      // that queued state so a fast rejection cannot observe stale DOM text and
      // then get overwritten by the clear.
      const currentDraftKey = draftKeyRef.current;
      const destinationDraftKey = targetDraftKey ?? currentDraftKey;
      const targetsCurrentComposer = destinationDraftKey === currentDraftKey;
      const storedDraft = !targetsCurrentComposer && destinationDraftKey
        ? getDraft(destinationDraftKey)
        : null;
      const restoredDraft = mergeRestoredSubmissionDraft(
        question ?? text,
        images,
        targetsCurrentComposer ? valueRef.current : (storedDraft?.value ?? ""),
        targetsCurrentComposer
          ? attachedImagesRef.current.map(imageToDraftImage)
          : (storedDraft?.images ?? []),
        contexts,
        targetsCurrentComposer ? selectionContextsRef.current : storedDraft?.contexts,
        submittedSessionReferences,
        targetsCurrentComposer ? sessionReferencesRef.current : storedDraft?.sessionReferences,
      );
      // The first optimistic message switches ChatWindow out of its empty-state
      // layout and remounts this component. Persist synchronously so recovery is
      // not lost if this instance is the one being unmounted.
      if (destinationDraftKey) setDraft(destinationDraftKey, restoredDraft);
      if (!targetsCurrentComposer) return;
      const restoredImages = images?.length
        ? [
            ...draftImagesToAttachedImages(images).slice(
              0,
              Math.max(0, MAX_ATTACHED_IMAGES - attachedImagesRef.current.length),
            ),
            ...attachedImagesRef.current,
          ].slice(0, MAX_ATTACHED_IMAGES)
        : attachedImagesRef.current;
      // Session promotion can rekey this composer before React flushes the
      // functional updates below, so update the imperative snapshot first.
      valueRef.current = restoredDraft.value;
      attachedImagesRef.current = restoredImages;
      setValue((current) => {
        const restored = mergeRestoredSubmissionText(question ?? text, current);
        valueRef.current = restored;
        return restored;
      });
      setAtQuery(null);
      setHistoryMenuOpen(false);
      if (restoredDraft.contexts !== undefined) {
        const normalizedContexts = restoredDraft.contexts.flatMap((context) => {
          const normalized = normalizeSelectionContext(context);
          return normalized ? [normalized] : [];
        });
        selectionContextsRef.current = normalizedContexts;
        setSelectionContexts(normalizedContexts);
      }
      if (restoredDraft.sessionReferences !== undefined) {
        const normalizedReferences = restoredDraft.sessionReferences.flatMap((reference) => {
          const normalized = normalizeSessionReference(reference);
          return normalized ? [normalized] : [];
        });
        sessionReferencesRef.current = normalizedReferences;
        setSessionReferences(normalizedReferences);
      }
      if (images?.length) {
        setAttachedImages((current) => {
          const available = Math.max(0, MAX_ATTACHED_IMAGES - current.length);
          const restored = draftImagesToAttachedImages(images)
            .slice(0, available);
          const next = restored.length > 0 ? [...restored, ...current] : current;
          attachedImagesRef.current = next;
          return next;
        });
      }
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    insertText(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((v) => v + (v ? " " : "") + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const newVal = before + sep + text + after;
      valueRef.current = newVal;
      setValue(newVal);
      setAtQuery(null);
      requestAnimationFrame(() => {
        if (!ta) return;
        const pos = start + sep.length + text.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    addImages(files: File[]) {
      processImageFiles(files);
    },
    addFiles(files: File[]) {
      void attachFiles(files);
    },
    addSelectionContext(context: SelectionContext) {
      const normalized = normalizeSelectionContext(context);
      if (!normalized) return;
      setSelectionContexts((current) => {
        if (current.some((item) => (
          item.sourceFilePath === normalized.sourceFilePath
          && item.sourceAbsolutePath === normalized.sourceAbsolutePath
          && item.sourceStartLine === normalized.sourceStartLine
          && item.sourceEndLine === normalized.sourceEndLine
          && item.sourceSessionId === normalized.sourceSessionId
          && item.sourceEntryId === normalized.sourceEntryId
          && item.sourceStartOffset === normalized.sourceStartOffset
          && item.sourceEndOffset === normalized.sourceEndOffset
          && item.text === normalized.text
        ))) {
          return current;
        }
        const next = [...current, normalized];
        selectionContextsRef.current = next;
        return next;
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    removeSelectionContext(id: string) {
      setSelectionContexts((current) => {
        const next = current.filter((context) => context.id !== id);
        selectionContextsRef.current = next;
        return next;
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    clearSelectionContexts() {
      selectionContextsRef.current = [];
      setSelectionContexts([]);
    },
    addSessionReference(reference: SessionReference) {
      const normalized = normalizeSessionReference(reference);
      if (!normalized) return;
      setSessionReferences((current) => {
        if (current.some((item) => item.id === normalized.id)) return current;
        const next = [...current, normalized];
        sessionReferencesRef.current = next;
        return next;
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    removeSessionReference(id: string) {
      setSessionReferences((current) => {
        const next = current.filter((reference) => reference.id !== id);
        sessionReferencesRef.current = next;
        return next;
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    clearSessionReferences() {
      sessionReferencesRef.current = [];
      setSessionReferences([]);
    },
  }));

  const processImageFiles = useCallback(async (files: File[]) => {
    if (compact) return;
    const remaining = Math.max(
      0,
      MAX_ATTACHED_IMAGES - attachedImagesRef.current.length - pendingImageCountRef.current,
    );
    const imageFiles = files
      .filter((f) => f.type.startsWith("image/") && f.size <= MAX_ATTACHED_IMAGE_BYTES)
      .slice(0, remaining);
    if (!imageFiles.length) return;
    pendingImageCountRef.current += imageFiles.length;
    try {
      const newImages = await Promise.all(
        imageFiles.map(async (file) => ({
          ...await compressImageFile(file),
          previewUrl: URL.createObjectURL(file),
        }))
      );
      setAttachedImages((prev) => {
        const accepted = newImages.slice(0, Math.max(0, MAX_ATTACHED_IMAGES - prev.length));
        newImages.slice(accepted.length).forEach(revokeImagePreview);
        const next = [...prev, ...accepted];
        attachedImagesRef.current = next;
        return next;
      });
    } finally {
      pendingImageCountRef.current -= imageFiles.length;
    }
  }, [compact]);

  // ---------------------------------------------------------------------------
  // fork:gap07-attachments — 任意文件 → 落盘（或就地引用）→ 插入 `@路径`
  // ---------------------------------------------------------------------------

  /** 把引用路径插到光标处（与 `@` 菜单插入的文本同构，所以 agent 侧无需特殊处理）。 */
  const appendAttachmentReferences = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    const current = valueRef.current;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? current.length;
    const insert = paths.map((path) => buildAttachmentReference(path).text).join("");
    // fork:ui — 记下这批附件的完整路径：输入框里只会出现 `@文件名`，
    // 发送时再还原成路径（expandAttachmentReferences）。
    for (const path of paths) {
      if (!attachedReferencePathsRef.current.includes(path)) attachedReferencePathsRef.current.push(path);
    }
    // fork:zc-08 — 同步 chip 状态：按完整路径去重，同一附件插两次不会出现两个 chip。
    setReferenceAttachments((prev) => {
      const known = new Set(prev.map((chip) => chip.path));
      const additions = paths
        .filter((path) => !known.has(path))
        .map((path) => ({ path, name: getFileName(path), kind: attachmentPreviewKind({ name: path }) }));
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
    const needsSpace = cursor > 0 && !/\s/.test(current.slice(cursor - 1, cursor));
    const next = current.slice(0, cursor) + (needsSpace ? " " : "") + insert + current.slice(cursor);
    const nextCursor = cursor + (needsSpace ? 1 : 0) + insert.length;
    valueRef.current = next;
    setValue(next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    });
  }, []);

  /**
   * 上传到附件目录。字节走的是**既有**文件上传路由（同一个 25MB/文件、100MB/单次封套、
   * 同一个冲突策略校验），这里只负责把目录要到手、把结果拼回绝对路径。
   *
   * 同名不覆盖：先用 `conflict=skip`，被跳过的那几个改名重试（`report.csv` →
   * `report-2.csv` → `report-3.csv`）。覆盖会让**旧消息里的引用指向新内容**，
   * 那种错误事后很难发现。
   *
   * 待重试的队列必须同时带着「本地 File」——只记服务端名字会丢了对应关系（名字被改过）。
   */
  const uploadAttachmentFiles = useCallback(async (files: File[]) => {
    const dirResponse = await fetch("/api/attachments");
    if (!dirResponse.ok) throw new Error(`attachments directory failed: ${dirResponse.status}`);
    const { dir } = await dirResponse.json() as { dir?: string };
    if (!dir) throw new Error("attachments directory missing");
    const url = `/api/files/${encodeFilePathForApi(dir)}?type=upload&conflict=skip`;

    const send = async (entries: Array<{ file: File; name: string }>) => {
      const form = new FormData();
      for (const entry of entries) {
        form.append(
          "files",
          entry.name === entry.file.name
            ? entry.file
            : new File([entry.file], entry.name, { type: entry.file.type }),
        );
      }
      const response = await fetch(url, { method: "POST", body: form });
      const body = await response.json().catch(() => null) as {
        uploaded?: string[];
        skipped?: string[];
        errors?: Array<{ name: string; error: string }>;
        error?: string;
      } | null;
      if (!response.ok && !(body?.uploaded?.length)) {
        throw new Error(body?.error ?? `upload failed: ${response.status}`);
      }
      return body ?? {};
    };

    const uploaded: string[] = [];
    const failed: string[] = [];
    const taken = new Set<string>();
    let pending: Array<{ file: File; name: string }> = files.map((file) => ({ file, name: file.name }));

    for (let attempt = 0; attempt < 5 && pending.length > 0; attempt += 1) {
      const body = await send(pending);
      uploaded.push(...(body.uploaded ?? []));
      failed.push(...(body.errors ?? []).map((entry) => entry.name));
      const conflicts = new Set(body.skipped ?? []);
      pending = pending.flatMap((entry) => {
        if (!conflicts.has(entry.name)) return [];
        taken.add(entry.name);
        return [{ file: entry.file, name: nextAvailableAttachmentName(entry.name, taken) }];
      });
    }

    return {
      paths: uploaded.map((name) => joinFilePath(dir, name)),
      names: uploaded,
      failed: [...failed, ...pending.map((entry) => entry.name)],
    };
  }, []);

  /**
   * 所有入口（按钮 / 拖拽 / 粘贴）统一走这里。
   *
   * 图片先走既有内联管道（10MB/10 张 + 压缩，**保持不变**）；剩下的 —— 包括超出图片
   * 上限的那部分 —— 按 `planAttachments` 分成上传 / 就地引用 / 跳过。
   */
  const attachFiles = useCallback(async (files: File[]) => {
    if (compact || files.length === 0) return;
    const imageSlots = Math.max(
      0,
      MAX_ATTACHED_IMAGES - attachedImagesRef.current.length - pendingImageCountRef.current,
    );
    const inlineImages = files
      .filter((file) => file.type.startsWith("image/") && file.size <= MAX_ATTACHED_IMAGE_BYTES)
      .slice(0, imageSlots);
    const rest = files.filter((file) => !inlineImages.includes(file));

    if (inlineImages.length > 0) await processImageFiles(inlineImages);
    if (rest.length === 0) return;

    // fork:pr13-composer — 先做 cwd 相对化：桌面外壳能拿到磁盘绝对路径时，
    // cwd 内的文件直接插 `@相对路径`（零拷贝，不经过附件目录）；cwd 外（含
    // `..` 逃逸、前缀相似的兄弟目录）才回退到原有上传 / 就地引用管线。
    const cwdMentionPaths: string[] = [];
    const uploadCandidates: File[] = [];
    for (const file of rest) {
      const absolutePath = desktopFilePathFor(file);
      const mentions = absolutePath && cwd ? toCwdRelativeMentions([absolutePath], cwd).mentions : [];
      if (mentions.length > 0) {
        cwdMentionPaths.push(...mentions);
      } else {
        uploadCandidates.push(file);
      }
    }

    if (uploadCandidates.length === 0) {
      appendAttachmentReferences(cwdMentionPaths);
      setAttachmentNotice({
        added: cwdMentionPaths.map((path) => path.split("/").pop() ?? path),
        skipped: [],
        failed: [],
      });
      return;
    }

    const entries = uploadCandidates.map((file) => ({ file, facts: { name: file.name, size: file.size, type: file.type } }));
    const plan = planAttachments(entries.map((entry) => entry.facts), {
      pathOf: (facts) => {
        const match = entries.find((entry) => entry.facts === facts);
        return match ? desktopFilePathFor(match.file) : null;
      },
    });

    const added = [
      ...cwdMentionPaths.map((path) => path.split("/").pop() ?? path),
      ...plan.referenceInPlace.map((entry) => entry.file.name),
    ];
    const paths = [...cwdMentionPaths, ...plan.referenceInPlace.map((entry) => entry.path)];
    const skipped = plan.skipped.map((entry) => ({ name: entry.file.name, reason: entry.reason }));
    const failed: string[] = [];

    if (plan.upload.length > 0) {
      const uploadFiles = plan.upload.flatMap((facts) => {
        const match = entries.find((entry) => entry.facts === facts);
        return match ? [match.file] : [];
      });
      try {
        const result = await uploadAttachmentFiles(uploadFiles);
        paths.push(...result.paths);
        added.push(...result.names);
        failed.push(...result.failed);
      } catch {
        failed.push(...plan.upload.map((facts) => facts.name));
      }
    }

    appendAttachmentReferences(paths);
    if (added.length > 0 || skipped.length > 0 || failed.length > 0) {
      setAttachmentNotice({ added, skipped, failed });
    }
  }, [appendAttachmentReferences, compact, cwd, processImageFiles, uploadAttachmentFiles]);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) revokeImagePreview(removed);
      attachedImagesRef.current = next;
      return next;
    });
  }, []);

  // fork:zc-08 — 附件内容 URL（复用 FileViewer 的 /api/files 路由与查询参数约定）。
  // cwd 相对引用（fork:pr13-composer）先补回绝对路径；桌面路径与 POSIX 路径都认。
  const attachmentPreviewUrl = useCallback((path: string, type: "read" | "preview" = "read") => {
    const absolute = /^([a-zA-Z]:[\\/]|\/)/.test(path) ? path : (cwd ? joinFilePath(cwd, path) : path);
    return `/api/files/${encodeFilePathForApi(absolute)}?type=${type}`;
  }, [cwd]);

  // fork:zc-08 — 移除附件 chip：同时清掉还原表、chip 状态和输入框里的 `@文件名` token，
  // 三者保持一致；若用户已手动删了文本，则只清 chip。
  const removeReferenceAttachment = useCallback((path: string) => {
    attachedReferencePathsRef.current = attachedReferencePathsRef.current.filter((item) => item !== path);
    setReferenceAttachments((prev) => prev.filter((chip) => chip.path !== path));
    const token = buildAttachmentReference(path).text.trimEnd();
    const current = valueRef.current;
    const index = current.indexOf(token);
    if (index === -1) return;
    const next = current.slice(0, index) + current.slice(index + token.length);
    valueRef.current = next;
    setValue(next);
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      if (next) textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    }
  }, []);

  const clearImages = useCallback(() => {
    attachedImagesRef.current = [];
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return [];
    });
  }, []);

  const clearInput = useCallback(() => {
    valueRef.current = "";
    setValue("");
    // fork:ui — 清掉附件路径还原表：下一轮输入里若出现同名 `@文件`，不应再
    // 被当成上一轮的附件还原成路径。
    attachedReferencePathsRef.current = [];
    // fork:zc-08 — chip 与还原表同生命周期。
    setReferenceAttachments([]);
    selectionContextsRef.current = [];
    setSelectionContexts([]);
    sessionReferencesRef.current = [];
    setSessionReferences([]);
    setAtQuery(null);
    setHistoryMenuOpen(false);
    if (draftKey) clearDraft(draftKey);
    if (draftKeyRef.current && draftKeyRef.current !== draftKey) clearDraft(draftKeyRef.current);
    clearImages();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [clearImages, draftKey]);

  useEffect(() => {
    if (!draftKey || draftKeyRef.current !== draftKey) return;
    setDraft(draftKey, {
      value,
      images: attachedImages.map(imageToDraftImage),
      contexts: selectionContexts,
      sessionReferences,
    });
  }, [attachedImages, draftKey, selectionContexts, sessionReferences, value]);

  useEffect(() => {
    const previousDraftKey = draftKeyRef.current;
    if (previousDraftKey === draftKey) return;

    if (previousDraftKey) {
      setDraft(previousDraftKey, {
        value: valueRef.current,
        images: attachedImagesRef.current.map(imageToDraftImage),
        contexts: selectionContextsRef.current,
        sessionReferences: sessionReferencesRef.current,
      });
    }

    const draft = draftKey ? getDraft(draftKey) : null;
    draftKeyRef.current = draftKey;
    const nextValue = draft?.value ?? "";
    const nextImages = draftImagesToAttachedImages(draft?.images);
    const nextContexts = (draft?.contexts ?? initialSelectionContextsRef.current ?? []).flatMap((context) => {
      const normalized = normalizeSelectionContext(context);
      return normalized ? [normalized] : [];
    });
    const nextSessionReferences = (draft?.sessionReferences ?? []).flatMap((reference) => {
      const normalized = normalizeSessionReference(reference);
      return normalized ? [normalized] : [];
    });
    valueRef.current = nextValue;
    attachedImagesRef.current = nextImages;
    selectionContextsRef.current = nextContexts;
    sessionReferencesRef.current = nextSessionReferences;
    // fork:zc-08 — 切换会话/草稿后附件 chips 不再适用（引用表也没有持久化）。
    setReferenceAttachments([]);
    setValue(nextValue);
    setSelectionContexts(nextContexts);
    setSessionReferences(nextSessionReferences);
    setAtQuery(null);
    setHistoryMenuOpen(false);
    setAttachedImages((prev) => {
      prev.forEach(revokeImagePreview);
      return nextImages;
    });
  }, [draftKey]);

  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    if (ta.value) ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  useLayoutEffect(resizeTextarea, [value, fontSize, resizeTextarea]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    let previousWidth = -1;
    const observer = new ResizeObserver(([entry]) => {
      // Height updates also notify the observer; only remeasure on width changes.
      if (entry.contentRect.width === previousWidth) return;
      previousWidth = entry.contentRect.width;
      resizeTextarea();
    });
    observer.observe(ta);
    return () => observer.disconnect();
  }, [resizeTextarea]);

  useEffect(() => {
    return () => {
      attachedImagesRef.current.forEach(revokeImagePreview);
    };
  }, []);

  const runBuiltinCommand = useCallback(async (msg: string): Promise<boolean> => {
    if (attachedImages.length || !msg.startsWith("/") || !onBuiltinCommand) return false;
    if (builtinCommandPendingRef.current) return true;
    builtinCommandPendingRef.current = true;
    setBuiltinCommandPending(true);
    try {
      const result = await onBuiltinCommand(msg);
      if (!result.handled) return false;
      if (!result.error && canClearBuiltinCommandInput(valueRef.current, attachedImagesRef.current.length, msg)) clearInput();
      return true;
    } finally {
      builtinCommandPendingRef.current = false;
      setBuiltinCommandPending(false);
    }
  }, [attachedImages.length, clearInput, onBuiltinCommand]);

  const handleSend = useCallback(async () => {
    // fork:ui — 附件在输入框里显示为 `@文件名`，发给模型前还原成完整路径
    // （pi 的 prompt 只支持 text/image 两种内容块，文件必须靠路径引用）。
    const question = expandAttachmentReferences(value.trim(), attachedReferencePathsRef.current);
    if (!question && !attachedImages.length) return;
    const contexts = selectionContextsRef.current;
    const references = sessionReferencesRef.current;
    const msg = serializeComposerMessage(question, contexts, t("chat.quoteIntro"), references);
    onAudioUnlock?.();
    const builtinAllowed = !isStreaming || canRunBuiltinSlashCommandWhileStreaming(msg);
    if (builtinAllowed && await runBuiltinCommand(msg)) return;
    if (isStreaming) return;
    clearInput();
    onSend(msg, attachedImages.length ? attachedImages : undefined, contexts, question, references);
  }, [value, attachedImages, isStreaming, runBuiltinCommand, onSend, clearInput, onAudioUnlock, t]);

  const slashQuery = !compact && value.startsWith("/") && !/\s/.test(value.slice(1))
    ? value.slice(1).toLowerCase()
    : null;

  const filteredSlashCommands = (() => {
    if (slashQuery === null) return [];
    const builtinCommands = isStreaming
      ? BUILTIN_SLASH_COMMANDS.filter((command) => command.availableWhileStreaming)
      : BUILTIN_SLASH_COMMANDS;
    const commands = [...builtinCommands, ...(slashCommands ?? [])];
    return [...commands]
      .filter((command) => {
        const name = command.name.toLowerCase();
        const description = getSlashDescription(command, t).toLowerCase();
        return name.includes(slashQuery) || description.includes(slashQuery);
      })
      .sort((a, b) => {
        const rankDelta = slashMatchRank(a, slashQuery, t) - slashMatchRank(b, slashQuery, t);
        if (rankDelta !== 0) return rankDelta;
        return SLASH_SOURCE_ORDER[a.source] - SLASH_SOURCE_ORDER[b.source]
          || TEXT_COLLATOR.compare(a.name, b.name);
      });
  })();

  const {
    commands: displayedSlashCommands,
    groups: groupedSlashCommands,
  } = buildSlashCommandLayout(filteredSlashCommands, skillDormancy);

  const slashCommandCountLabel = filteredSlashCommands.length === 1
    ? t(slashQuery ? "chat.match" : "chat.command")
    : t(slashQuery ? "chat.matches" : "chat.commands", { count: filteredSlashCommands.length });
  const hasInputText = Boolean(value.trim());
  const canQueueStreamingMessage = hasInputText || attachedImages.length > 0;
  // Warn when images are attached but the selected model is known not to accept
  // image input (#584), including a resolved default. Unknown models stay silent.
  const showImageUnsupportedWarning = (
    attachedImages.length > 0
    && !modelSupportsImageInput(model, modelList)
    && !imageWarningDismissed
  );
  useEffect(() => {
    if (attachedImages.length === 0) setImageWarningDismissed(false);
  }, [attachedImages.length]);

  // ── @ file autocomplete ──────────────────────────────────────────────────
  // Recomputed from the text before the caret on every change/caret move.
  // Disabled entirely when there is no cwd (new session without a directory).
  const updateAtQuery = useCallback((text: string, cursor: number | null) => {
    const pos = cursor ?? text.length;
    const before = text.slice(0, pos);
    const fileToken = cwd ? extractAtQuery(before) : null;
    setAtQuery(fileToken);
    // fork:gap06-references — 同一次光标解析也产出引用 token。两个抽取器都锚定光标，
    // 所以 `@` 命中时引用 token 必然为空（无需仲裁）。没有 cwd 时 `@` 菜单整体不可用，
    // 但会话/待办引用不需要 cwd，所以它不受这个门控。
    setReferenceQuery(fileToken ? null : extractReferenceQuery(before));
  }, [cwd]);

  // D2-PR-12 — 输入框高亮 token。三条硬规则：
  // 1. **valid 才高亮**：索引/技能未加载时 validator 返回 undefined，tokenizeMentions
  //    按 invalid 处理（高亮绝不猜）；
  // 2. **光标所在 token 保持纯文本**：`activeTokenStart` 取正在编辑的 @ token 起点，
  //    否则半截 token 会在打字时闪高亮；
  // 3. **代码块内不改**：这条针对消息体（remark 插件只改 text 节点）；输入框本身
  //    就是纯文本，不存在 code 节点。
  const highlightSegments = React.useMemo(() => tokenizeMentions(value, {
    fileExists: (path) => {
      if (!fileIndexSnapshot) return undefined;
      const key = path.toLowerCase();
      return fileIndexSnapshot.paths.has(key) || fileIndexSnapshot.dirs.has(key);
    },
    isSkill: (name) => (skillNames ? skillNames.has(name) : undefined),
  }, atQuery?.start ?? null), [value, fileIndexSnapshot, skillNames, atQuery]);

  // D2-PR-12 — 高亮层对齐（AGENTS.md 记的坑：文本域与高亮层必须共享字号，否则错位）。
  //
  // 文本域自己的文字是透明的（caret 保持可见），高亮层必须和它逐像素对齐：
  // - 字号/行高/字体在 CSS 里与 textarea 内联样式共用 --chat-content-font-size；
  // - viewport 的宽高镜像 textarea 的 clientWidth/clientHeight（滚动条出现时内容盒
  //   变窄，不同步就会每行漂移半个字）；
  // - 内层 layer 用 transform 平移 textarea 的滚动偏移，viewport 负责裁剪。
  const syncHighlightScroll = useCallback(() => {
    const ta = textareaRef.current;
    const viewport = highlightViewportRef.current;
    const layer = highlightLayerRef.current;
    if (!ta || !viewport || !layer) return;
    const width = ta.clientWidth;
    const height = ta.clientHeight;
    if (width > 0 && viewport.style.width !== `${width}px`) viewport.style.width = `${width}px`;
    if (height > 0 && viewport.style.height !== `${height}px`) viewport.style.height = `${height}px`;
    const x = ta.scrollLeft > 0 ? -ta.scrollLeft : 0;
    const y = ta.scrollTop > 0 ? -ta.scrollTop : 0;
    layer.style.transform = x || y ? `translate(${x}px, ${y}px)` : "";
  }, []);
  // 每次渲染后同步：打字、模式切换、自动增高都会走渲染。
  useEffect(() => { syncHighlightScroll(); });
  // textarea 的尺寸也可能在没有 React 渲染时变化（滚动条出现、容器 resize、
  // rAF 里的自动增高），ResizeObserver 负责补同步。
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const observer = new ResizeObserver(() => syncHighlightScroll());
    observer.observe(ta);
    return () => observer.disconnect();
  }, [syncHighlightScroll]);

  // fork:gap06-references — 程序化改文本的路径（发送后清空、插入引用、草稿恢复…）
  // 都会 `setValue(...)` 但不走 updateAtQuery，上游那里逐个 `setAtQuery(null)` 是 11 处。
  // 与其一个个跟着改，不如让 token 自己校验：记录的区间里不再是对应的 token 文本，就关掉
  // 菜单。以后的任何新重置路径也自动被覆盖。
  useEffect(() => {
    if (!referenceQuery) return;
    const token = `${COMPOSER_REFERENCE_TRIGGERS[referenceQuery.kind]}${referenceQuery.query}`;
    const end = referenceQuery.start + token.length;
    if (value.slice(referenceQuery.start, end) !== token) setReferenceQuery(null);
  }, [value, referenceQuery]);

  const atQueryText = atQuery?.query ?? null;
  const atLocalMatches: FileIndexEntry[] = React.useMemo(() => (
    atQueryText !== null && fileIndex && fileIndex.cwd === cwd
      ? filterFileEntries(fileIndex.entries, atQueryText)
      : []
  ), [atQueryText, fileIndex, cwd]);

  // When the client index is truncated (repo larger than the index cap),
  // local filtering cannot see deep files, so queries are also ranked
  // server-side against the full listing. Local matches render immediately
  // and are replaced when the (debounced) server result for the current
  // query arrives; stale responses are ignored via the query/cwd tag.
  const needsServerSearch = Boolean(atQueryText && fileIndex?.truncated && fileIndex.cwd === cwd);
  useEffect(() => {
    if (!needsServerSearch || !cwd || !atQueryText) return;
    const fetchCwd = cwd;
    const query = atQueryText;
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}&q=${encodeURIComponent(query)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`file search failed: ${res.status}`);
          return res.json() as Promise<{ matches?: FileIndexEntry[] }>;
        })
        .then((data) => setAtServerResult({ cwd: fetchCwd, query, matches: data.matches ?? [] }))
        .catch(() => {
          // Keep showing local matches; the next keystroke retries.
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [needsServerSearch, atQueryText, cwd]);

  const serverResultInUse = needsServerSearch
    && atServerResult !== null
    && atServerResult.cwd === cwd
    && atServerResult.query === atQueryText;
  const atMatches: FileIndexEntry[] = serverResultInUse ? atServerResult.matches : atLocalMatches;

  // Open/reset the menu whenever the @token appears or changes (mirrors the
  // slash menu: Escape closes it, the next keystroke re-opens it).
  const atTokenKey = atQuery === null ? null : `${atQuery.start}:${atQuery.quoted ? 1 : 0}:${atQuery.query}`;
  useEffect(() => {
    if (atTokenKey === null) {
      setAtMenuOpen(false);
      setAtActiveIndex(0);
      return;
    }
    setAtMenuOpen(true);
    setAtActiveIndex(0);
  }, [atTokenKey]);

  // Fetch the file index when the menu opens. The server caches per cwd for
  // ~10s, so re-opening refreshes cheaply; while typing nothing refetches.
  const atTokenActive = atQuery !== null;
  useEffect(() => {
    if (!atTokenActive || !cwd) return;
    const meta = fileIndexMetaRef.current;
    if (meta && meta.cwd === cwd && Date.now() - meta.fetchedAt < 10_000) return;
    if (fileIndexFetchingRef.current === cwd) return;
    fileIndexFetchingRef.current = cwd;
    const fetchCwd = cwd;
    setFileIndexLoading(true);
    fetch(`/api/file-index?cwd=${encodeURIComponent(fetchCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`file index failed: ${res.status}`);
        return res.json() as Promise<{ files?: string[]; truncated?: boolean }>;
      })
      .then((data) => {
        setFileIndex({ cwd: fetchCwd, entries: buildEntriesFromFiles(data.files ?? []), truncated: !!data.truncated });
        fileIndexMetaRef.current = { cwd: fetchCwd, fetchedAt: Date.now() };
      })
      .catch(() => {
        // Leave any previous index in place; next open retries.
        fileIndexMetaRef.current = null;
      })
      .finally(() => {
        fileIndexFetchingRef.current = null;
        setFileIndexLoading(false);
      });
  }, [atTokenActive, cwd]);

  const applyAtCompletion = useCallback((entry: FileIndexEntry) => {
    if (!atQuery) return;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? value.length;
    const before = value.slice(0, atQuery.start);
    let after = value.slice(cursor);
    // Completing inside a quoted token (@"my dir/… with the caret before the
    // closing quote): the replacement carries its own closing quote, so drop
    // the old one right after the caret (mirrors the TUI's applyCompletion).
    if (atQuery.quoted && after.startsWith('"')) {
      after = after.slice(1);
    }
    const insert = buildAtInsertText(entry.path, entry.isDir, atQuery.quoted);
    const newValue = before + insert.text + after;
    const newPos = before.length + insert.cursorOffset;
    setValue(newValue);
    // setValue alone does not fire onChange — re-derive the token here. Files
    // end with a space (token closes, menu hides); directories end with "/"
    // before the caret (token stays open for drill-down into the directory).
    setAtQuery(extractAtQuery(newValue.slice(0, newPos)));
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newPos, newPos);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    });
  }, [atQuery, value]);

  // ---------------------------------------------------------------------------
  // fork:gap06-references — `&` 会话 / `#` MCP / `~` 待办
  // ---------------------------------------------------------------------------

  /** 当前该展示哪些候选。待办直接来自 prop（无需拉取）。 */
  const referenceItems: ComposerReferenceItem[] = React.useMemo(() => {
    if (!referenceQuery) return [];
    if (referenceQuery.kind === "session") {
      return filterSessionReferenceItems(referenceSessions ?? [], referenceQuery.query);
    }
    if (referenceQuery.kind === "mcp") {
      return filterMcpReferenceItems(referenceMcp ?? [], referenceQuery.query);
    }
    return filterTodoReferenceItems(buildTodoReferenceItems(todoSummary?.todos ?? []), referenceQuery.query);
  }, [referenceQuery, referenceSessions, referenceMcp, todoSummary]);

  // 拉取数据源：只在对应触发符真的被敲出来时才请求，命中缓存则不重复请求。
  useEffect(() => {
    if (!referenceQuery) return;
    if (referenceQuery.kind === "session") {
      const fetchedAt = referenceMetaRef.current.sessions;
      if (fetchedAt !== undefined && Date.now() - fetchedAt < 10_000) return;
      if (referenceFetchRef.current.sessions) return;
      referenceFetchRef.current.sessions = true;
      setReferenceLoading(true);
      fetch("/api/sessions")
        .then((res) => (res.ok ? (res.json() as Promise<{ sessions?: ReferenceSessionSource[] }>) : null))
        .then((data) => {
          setReferenceSessions(buildSessionReferenceItems(data?.sessions ?? [], { currentSessionId }));
          referenceMetaRef.current.sessions = Date.now();
        })
        .catch(() => {
          // 下次敲触发符重试；不要在菜单里空转
          referenceMetaRef.current.sessions = undefined;
        })
        .finally(() => {
          referenceFetchRef.current.sessions = false;
          setReferenceLoading(false);
        });
      return;
    }
    if (referenceQuery.kind === "mcp") {
      if (!cwd) return;
      if (referenceMetaRef.current.mcp === cwd) return;
      if (referenceFetchRef.current.mcp === cwd) return;
      referenceFetchRef.current.mcp = cwd;
      setReferenceLoading(true);
      fetch(`/api/mcp?cwd=${encodeURIComponent(cwd)}`)
        .then((res) => (res.ok ? (res.json() as Promise<{ servers?: ReferenceMcpSource[] }>) : null))
        .then((data) => {
          setReferenceMcp(buildMcpReferenceItems(data?.servers ?? []));
          referenceMetaRef.current.mcp = cwd;
        })
        .catch(() => {
          referenceMetaRef.current.mcp = undefined;
        })
        .finally(() => {
          referenceFetchRef.current.mcp = null;
          setReferenceLoading(false);
        });
    }
  }, [referenceQuery, cwd, currentSessionId]);

  // 敲出/改写触发符时开菜单（与 `@` 菜单同款规则：Escape 关掉，下一次按键重开）。
  const referenceTokenKey = referenceQuery === null
    ? null
    : `${referenceQuery.kind}:${referenceQuery.start}:${referenceQuery.query}`;
  useEffect(() => {
    if (referenceTokenKey === null) {
      setReferenceMenuOpen(false);
      setReferenceActiveIndex(0);
      return;
    }
    setReferenceMenuOpen(true);
    setReferenceActiveIndex(0);
  }, [referenceTokenKey]);

  useEffect(() => {
    if (referenceActiveIndex >= referenceItems.length) {
      setReferenceActiveIndex(Math.max(0, referenceItems.length - 1));
    }
  }, [referenceItems.length, referenceActiveIndex]);

  useEffect(() => {
    referenceItemRefs.current.length = referenceItems.length;
  }, [referenceItems.length]);

  useEffect(() => {
    if (!referenceMenuOpen) return;
    referenceItemRefs.current[referenceActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [referenceActiveIndex, referenceMenuOpen]);

  useLayoutEffect(() => {
    if (!referenceMenuOpen || referenceQuery === null) {
      setReferenceMenuMaxHeight(null);
      return;
    }
    const menu = referenceMenuRef.current;
    if (!menu) return;
    return subscribeUpwardMenuMaxHeight(menu, (nextHeight) => {
      setReferenceMenuMaxHeight((current) => current === nextHeight ? current : nextHeight);
    });
  }, [referenceMenuOpen, referenceQuery]);

  /**
   * 确认一条候选：
   * - 会话 → 吃掉 token 并加一个 chip（复用已有 SessionReference 管道）；
   * - MCP / 待办 → 把 token 换成行内文本（与 `@path` 同构）。
   */
  const applyReferenceCompletion = useCallback((item: ComposerReferenceItem) => {
    if (!referenceQuery) return;
    const ta = textareaRef.current;
    const cursor = ta?.selectionStart ?? value.length;
    let newValue: string;
    let newPos: number;
    if (item.kind === "session") {
      newValue = value.slice(0, referenceQuery.start) + value.slice(cursor);
      newPos = referenceQuery.start;
      const reference = normalizeSessionReference(sessionReferenceFromItem(item));
      if (reference) {
        setSessionReferences((current) => {
          if (current.some((existing) => existing.id === reference.id)) return current;
          const next = [...current, reference];
          sessionReferencesRef.current = next;
          return next;
        });
      }
    } else {
      const replaced = replaceReferenceToken(value, referenceQuery.start, cursor, buildReferenceInsertText(item));
      newValue = replaced.value;
      newPos = replaced.cursor;
    }
    valueRef.current = newValue;
    setValue(newValue);
    setReferenceQuery(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(newPos, newPos);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    });
  }, [referenceQuery, value]);

  useEffect(() => {
    if (atActiveIndex >= atMatches.length) {
      setAtActiveIndex(Math.max(0, atMatches.length - 1));
    }
  }, [atMatches.length, atActiveIndex]);

  useEffect(() => {
    atItemRefs.current.length = atMatches.length;
  }, [atMatches.length]);

  useEffect(() => {
    if (!atMenuOpen) return;
    atItemRefs.current[atActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [atActiveIndex, atMenuOpen]);

  useEffect(() => {
    if (historyActiveIndex >= inputHistory.length) {
      setHistoryActiveIndex(Math.max(0, inputHistory.length - 1));
    }
  }, [inputHistory.length, historyActiveIndex]);

  useEffect(() => {
    historyItemRefs.current.length = inputHistory.length;
  }, [inputHistory.length]);

  useEffect(() => {
    if (!historyMenuOpen) return;
    historyItemRefs.current[historyActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [historyActiveIndex, historyMenuOpen]);

  const applyHistoryInput = useCallback((text: string) => {
    setValue(text);
    setHistoryMenuOpen(false);
    setHistoryActiveIndex(0);
    setAtQuery(null);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(text.length, text.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, []);

  const applySlashCommand = useCallback((command: SlashCommandPaletteItem) => {
    const nextValue = `/${command.name} `;
    setValue(nextValue);
    setSlashMenuOpen(false);
    setSlashActiveIndex(0);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(nextValue.length, nextValue.length);
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
    });
  }, []);

  const sendQueued = useCallback((mode: "steer" | "followup") => {
    const question = value.trim();
    if (!question && !attachedImages.length) return;
    const contexts = selectionContextsRef.current;
    const references = sessionReferencesRef.current;
    const msg = serializeComposerMessage(question, contexts, t("chat.quoteIntro"), references);
    onAudioUnlock?.();
    if (!attachedImages.length && onBuiltinCommand && canRunBuiltinSlashCommandWhileStreaming(msg)) {
      void runBuiltinCommand(msg);
      return;
    }
    const streamingBehavior = mode === "steer" ? "steer" : "followUp";
    if (msg.startsWith("/") && onPromptWithStreamingBehavior) {
      clearInput();
      onPromptWithStreamingBehavior(msg, streamingBehavior, attachedImages.length ? attachedImages : undefined, contexts, question, references);
      return;
    }
    clearInput();
    if (mode === "steer" && onSteer) {
      onSteer(msg, attachedImages.length ? attachedImages : undefined, contexts, question, references);
    } else if (mode === "followup" && onFollowUp) {
      onFollowUp(msg, attachedImages.length ? attachedImages : undefined, contexts, question, references);
    }
  }, [value, attachedImages, onBuiltinCommand, onPromptWithStreamingBehavior, onSteer, onFollowUp, clearInput, onAudioUnlock, runBuiltinCommand, t]);

  const getNextSlashIndex = useCallback((direction: "up" | "down" | "left" | "right") => {
    const lastIndex = displayedSlashCommands.length - 1;
    if (lastIndex < 0) return 0;

    if (direction === "left") return Math.max(0, slashActiveIndex - 1);
    if (direction === "right") return Math.min(lastIndex, slashActiveIndex + 1);

    const currentNode = slashItemRefs.current[slashActiveIndex];
    if (!currentNode) {
      return direction === "down"
        ? Math.min(lastIndex, slashActiveIndex + 1)
        : Math.max(0, slashActiveIndex - 1);
    }

    const currentRect = currentNode.getBoundingClientRect();
    const currentX = currentRect.left + currentRect.width / 2;
    const currentY = currentRect.top + currentRect.height / 2;
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index <= lastIndex; index += 1) {
      if (index === slashActiveIndex) continue;
      const node = slashItemRefs.current[index];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const candidateY = rect.top + rect.height / 2;
      const verticalDelta = candidateY - currentY;
      if (direction === "down" ? verticalDelta <= 4 : verticalDelta >= -4) continue;

      const candidateX = rect.left + rect.width / 2;
      const score = Math.abs(verticalDelta) * 1000 + Math.abs(candidateX - currentX);
      if (score < bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    if (bestIndex >= 0) return bestIndex;
    return direction === "down"
      ? Math.min(lastIndex, slashActiveIndex + 1)
      : Math.max(0, slashActiveIndex - 1);
  }, [displayedSlashCommands.length, slashActiveIndex]);

  // ── fork:pr14-compact — 阅读态塌陷接线 ────────────────────────────────
  // 方向由 scrollTop delta 求；ResizeObserver / 首次评估都传 "none"。
  const updateCompactFromScroll = useCallback((direction: InputCompactScrollDirection = "none") => {
    if (isMobile || compact) return;
    const container = messagesScrollRef.current;
    if (!container || inputFocusedRef.current) return;
    setReadingCompact((prev) => nextInputCompactState(prev, {
      kind: "scroll",
      remaining: scrollRemaining(container),
      direction,
      userIntent: Date.now() < compactIntentUntilRef.current,
    }));
  }, [compact, isMobile]);

  useEffect(() => {
    if (isMobile || compact) return;
    const composerRoot = inputShellRef.current?.closest("fieldset") ?? inputShellRef.current;
    if (!composerRoot) return;

    let container: HTMLElement | null = messagesScrollRef.current;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let disposed = false;

    const markScrollIntent = () => {
      compactIntentUntilRef.current = Date.now() + COMPACT_INTENT_MS;
    };

    const handleScroll = () => {
      if (!container) return;
      const delta = container.scrollTop - lastScrollTopRef.current;
      lastScrollTopRef.current = container.scrollTop;
      updateCompactFromScroll(delta > 0 ? "down" : delta < 0 ? "up" : "none");
    };

    const onGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!COMPACT_SCROLL_KEYS.has(event.key)) return;
      // 输入框 / 可编辑区域里的方向键属于编辑行为（翻历史、移光标），不算阅读滚动。
      if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']")) return;
      markScrollIntent();
    };

    const attach = (element: HTMLElement) => {
      container = element;
      messagesScrollRef.current = element;
      lastScrollTopRef.current = element.scrollTop;
      element.addEventListener("scroll", handleScroll, { passive: true });
      element.addEventListener("wheel", markScrollIntent, { passive: true });
      element.addEventListener("touchstart", markScrollIntent, { passive: true });
      element.addEventListener("pointerdown", markScrollIntent, { passive: true });
      if (typeof ResizeObserver !== "undefined") {
        // 容器高度会随 composer 塌陷/展开放生变化，必须复算底部位置；但这里
        // 拿不到方向，一律用 "none"，绝不能让它自己把状态翻回去（振荡坑）。
        resizeObserver = new ResizeObserver(() => updateCompactFromScroll("none"));
        resizeObserver.observe(element);
      }
      // 首次评估不塌陷：会话打开时可能本来就不在底部（锚点定位），那不算
      // 用户意图，等真实的向上滚动再收。
      updateCompactFromScroll("none");
    };

    const detach = () => {
      if (!container) return;
      container.removeEventListener("scroll", handleScroll);
      container.removeEventListener("wheel", markScrollIntent);
      container.removeEventListener("touchstart", markScrollIntent);
      container.removeEventListener("pointerdown", markScrollIntent);
      resizeObserver?.disconnect();
      resizeObserver = null;
      container = null;
      messagesScrollRef.current = null;
    };

    const discovered = findMessagesScrollContainer(composerRoot);
    if (discovered) {
      attach(discovered);
    } else if (typeof MutationObserver !== "undefined") {
      // 新会话的消息列要等首条消息才挂载；消息列与 composer 同属上一层主区，
      // 所以观察 composer 所在列的父级（包含两者的共同祖先），发现后立刻断开。
      const watchRoot = composerRoot.parentElement?.parentElement ?? composerRoot.parentElement ?? composerRoot;
      mutationObserver = new MutationObserver(() => {
        if (disposed || messagesScrollRef.current) return;
        const found = findMessagesScrollContainer(composerRoot);
        if (found) {
          mutationObserver?.disconnect();
          mutationObserver = null;
          attach(found);
        }
      });
      mutationObserver.observe(watchRoot, { childList: true, subtree: true });
    }

    window.addEventListener("keydown", onGlobalKeyDown);
    return () => {
      disposed = true;
      window.removeEventListener("keydown", onGlobalKeyDown);
      mutationObserver?.disconnect();
      mutationObserver = null;
      detach();
    };
  }, [compact, isMobile, updateCompactFromScroll]);

  // 展开后把塌陷期间被 CSS 压成一行高度的 textarea 恢复为内容高度（手动高度模式
  // 由 .is-manual-height 接管，跳过）。
  const wasReadingCompactRef = useRef(false);
  useEffect(() => {
    if (wasReadingCompactRef.current && !readingCompact) {
      const ta = textareaRef.current;
      if (ta && !manualModeRef.current) {
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      }
    }
    wasReadingCompactRef.current = readingCompact;
  }, [readingCompact]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      const nativeEvent = e.nativeEvent;
      const sendShortcut = e.key === "Enter" && !e.shiftKey && (!isMobile || e.ctrlKey || e.metaKey);
      const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
      const isComposing =
        isComposingRef.current ||
        nativeEvent.isComposing ||
        nativeEvent.keyCode === 229;

      if (sendShortcut && (isComposing || recentlyComposed)) {
        if (recentlyComposed) e.preventDefault();
        return;
      }

      if (historyMenuOpen && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setHistoryActiveIndex((i) => Math.min(Math.max(0, inputHistory.length - 1), i + 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setHistoryActiveIndex((i) => Math.max(0, i - 1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setHistoryMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || sendShortcut) && inputHistory[historyActiveIndex]) {
          e.preventDefault();
          applyHistoryInput(inputHistory[historyActiveIndex]);
          return;
        }
      }

      if (slashMenuOpen && slashQuery !== null) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("down"));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("up"));
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("right"));
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setSlashActiveIndex(getNextSlashIndex("left"));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashMenuOpen(false);
          return;
        }
        const selectedCommand = displayedSlashCommands[slashActiveIndex];
        if (e.key === "Tab" && selectedCommand) {
          e.preventDefault();
          applySlashCommand(selectedCommand);
          return;
        }
        if (sendShortcut && selectedCommand) {
          e.preventDefault();
          const canSubmitNow = !isStreaming
            || (selectedCommand.source === "builtin" && selectedCommand.availableWhileStreaming === true);
          if (canSubmitNow && isExactSlashCommand(value, selectedCommand)) {
            setSlashMenuOpen(false);
            void handleSend();
          } else {
            applySlashCommand(selectedCommand);
          }
          return;
        }
      }

      // fork:gap06-references — 引用菜单（& / # / ~）与 `@` 菜单同款按键，
      // 同样在 IME 合成期间跳过。
      if (referenceMenuOpen && referenceQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setReferenceActiveIndex((i) => cycleListIndex(i, referenceItems.length, 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setReferenceActiveIndex((i) => cycleListIndex(i, referenceItems.length, -1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setReferenceMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || sendShortcut) && referenceItems[referenceActiveIndex]) {
          e.preventDefault();
          applyReferenceCompletion(referenceItems[referenceActiveIndex]);
          return;
        }
      }

      // @ file menu — skip while composing so IME candidate navigation
      // (arrows/Enter/Tab) is never intercepted.
      if (atMenuOpen && atQuery !== null && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtActiveIndex((i) => cycleListIndex(i, atMatches.length, 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtActiveIndex((i) => cycleListIndex(i, atMatches.length, -1));
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setAtMenuOpen(false);
          return;
        }
        if ((e.key === "Tab" || sendShortcut) && atMatches[atActiveIndex]) {
          e.preventDefault();
          applyAtCompletion(atMatches[atActiveIndex]);
          return;
        }
      }

      if (e.key === "ArrowUp" && !isComposing && !isStreaming && inputHistory.length > 0 && value.trim().length === 0) {
        e.preventDefault();
        setSlashMenuOpen(false);
        setAtMenuOpen(false);
        setHistoryActiveIndex(inputHistory.length - 1);
        setHistoryMenuOpen(true);
        return;
      }

      // Esc stops the agent when no slash/@/history menu or IME composition is active.
      if (e.key === "Escape" && !isComposing && isStreaming && onAbort) {
        e.preventDefault();
        onAbort();
        return;
      }

      // fork:pr13-composer — Shift+Enter 的 Markdown 列表续行：无序列表、有序
      // 列表（序号 +1）、task 复选框（重置 `[ ]`）、引用 / 缩进组合；空项则删除整
      // 段前缀（VS Code 行为）。没有结构前缀时返回 null，回退到原生换行。
      //
      // `typeof` 守卫的原因：既有测试直接抽取这个回调在 VM 里执行，不会注入
      // continueMarkdownList；守卫让那些 Shift+Enter 用例仍走原生行为。
      if (e.key === "Enter" && e.shiftKey && !isComposing && !recentlyComposed
        && typeof continueMarkdownList === "function") {
        const ta = textareaRef.current;
        const start = ta?.selectionStart ?? value.length;
        const end = ta?.selectionEnd ?? start;
        const continuation = continueMarkdownList(value, start, end);
        if (continuation) {
          e.preventDefault();
          valueRef.current = continuation.value;
          setValue(continuation.value);
          setAtQuery(null);
          requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (!el) return;
            el.focus();
            el.setSelectionRange(continuation.caret, continuation.caret);
            el.style.height = "auto";
            el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
          });
          return;
        }
      }

      if (sendShortcut) {
        e.preventDefault();
        if (isStreaming && (onSteer || onFollowUp)) {
          sendQueued((e.altKey && onFollowUp) || !onSteer ? "followup" : "steer");
        } else {
          handleSend();
        }
      }
    },
    [isMobile, isStreaming, onSteer, onFollowUp, onAbort, slashMenuOpen, slashQuery, displayedSlashCommands, slashActiveIndex, applySlashCommand, sendQueued, handleSend, getNextSlashIndex, atMenuOpen, atQuery, atMatches, atActiveIndex, applyAtCompletion, referenceMenuOpen, referenceQuery, referenceItems, referenceActiveIndex, applyReferenceCompletion, historyMenuOpen, inputHistory, historyActiveIndex, applyHistoryInput, value]
  );

  const handleInput = useCallback(() => {
    // fork:pr23-resize — 手动高度生效时禁用自动增高：高度归手柄所有，textarea
    // 由 CSS 填满卡片；继续写 style.height 不仅无效（CSS !important 覆盖），
    // 还会让后续 reset 时残留旧值。
    if (manualModeRef.current) return;
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    // fork:gap07-attachments — 粘贴的文件不再限定图片：图片内联，其余落盘后插路径引用。
    const fileItems = items.filter((item) => item.kind === "file");
    if (!compact && fileItems.length) {
      e.preventDefault();
      const files = fileItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
      void attachFiles(files);
      return;
    }

    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    const sessionReference = parseSessionReferenceClipboard(text);
    if (sessionReference) {
      e.preventDefault();
      const normalized = normalizeSessionReference(sessionReference);
      if (normalized) {
        setSessionReferences((current) => {
          if (current.some((reference) => reference.id === normalized.id)) return current;
          const next = [...current, normalized];
          sessionReferencesRef.current = next;
          return next;
        });
      }
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    if (!html || !text) return;
    const document = new DOMParser().parseFromString(html, "text/html");
    const links = Array.from(document.querySelectorAll("a[href]"), (link) => {
      const label = link.textContent ?? "";
      const range = document.createRange();
      range.setStart(document.body, 0);
      range.setEndBefore(link);
      return {
        label,
        href: link.getAttribute("href")?.trim() ?? "",
        occurrence: label ? range.toString().split(label).length - 1 : 0,
      };
    });
    const markdown = replaceLinksWithMarkdown(text, links);
    if (markdown === null) return;

    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const nextValue = ta.value.slice(0, start) + markdown + ta.value.slice(ta.selectionEnd);
    e.preventDefault();
    valueRef.current = nextValue;
    setValue(nextValue);
    setHistoryMenuOpen(false);
    updateAtQuery(nextValue, start + markdown.length);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + markdown.length, start + markdown.length);
    });
  }, [attachFiles, compact, updateAtQuery]);

  useEffect(() => {
    if (slashQuery === null) {
      setSlashMenuOpen(false);
      setSlashActiveIndex(0);
      slashCommandsRequestedRef.current = false;
      return;
    }
    setSlashMenuOpen(true);
    setSlashActiveIndex(0);
    if (!slashCommandsRequestedRef.current && onLoadSlashCommands) {
      slashCommandsRequestedRef.current = true;
      Promise.resolve(onLoadSlashCommands()).catch(() => {
        slashCommandsRequestedRef.current = false;
      });
    }
  }, [slashQuery, onLoadSlashCommands]);

  // Lazy-load skill dormancy (disable-model-invocation) each time the slash
  // palette opens, so toggles made in the skills panel are reflected on the
  // next open. Failures degrade silently to the unannotated palette.
  useEffect(() => {
    if (!slashMenuOpen || !cwd) return;
    const requestCwd = cwd;
    let cancelled = false;
    setSkillDormancyState({ cwd: requestCwd, values: {} });
    fetch(`/api/skills?cwd=${encodeURIComponent(requestCwd)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`skills fetch failed: ${res.status}`);
        return res.json() as Promise<Partial<SkillsResponse>>;
      })
      .then((data) => {
        if (cancelled) return;
        const dormancy: Record<string, boolean> = {};
        for (const skill of data.skills ?? []) dormancy[skill.name] = skill.disableModelInvocation;
        setSkillDormancyState({ cwd: requestCwd, values: dormancy });
      })
      .catch(() => {
        if (!cancelled) setSkillDormancyState({ cwd: requestCwd, values: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [slashMenuOpen, cwd]);

  useEffect(() => {
    if (slashActiveIndex >= displayedSlashCommands.length) {
      setSlashActiveIndex(Math.max(0, displayedSlashCommands.length - 1));
    }
  }, [displayedSlashCommands.length, slashActiveIndex]);

  useEffect(() => {
    slashItemRefs.current.length = displayedSlashCommands.length;
  }, [displayedSlashCommands.length]);

  useEffect(() => {
    if (!slashMenuOpen) return;
    slashItemRefs.current[slashActiveIndex]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [slashActiveIndex, slashMenuOpen]);

  useLayoutEffect(() => {
    if (!slashMenuOpen || slashQuery === null) {
      setSlashMenuMaxHeight(null);
      return;
    }
    const menu = slashMenuRef.current;
    if (!menu) return;
    return subscribeUpwardMenuMaxHeight(menu, (nextHeight) => {
      setSlashMenuMaxHeight((current) => current === nextHeight ? current : nextHeight);
    });
  }, [slashMenuOpen, slashQuery]);

  useLayoutEffect(() => {
    if (!atMenuOpen || atQuery === null) {
      setAtMenuMaxHeight(null);
      return;
    }
    const menu = atMenuRef.current;
    if (!menu) return;
    return subscribeUpwardMenuMaxHeight(menu, (nextHeight) => {
      setAtMenuMaxHeight((current) => current === nextHeight ? current : nextHeight);
    });
  }, [atMenuOpen, atQuery]);

  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelSelectorOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name }));
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
    }));
  })();

  const compactSavedTokens = compactResult
    ? Math.max(0, compactResult.tokensBefore - compactResult.estimatedTokensAfter)
    : 0;
  const compactResultText = compactResult
    ? `${compactResult.reason && compactResult.reason !== "manual" ? `${compactResult.reason[0].toUpperCase()}${compactResult.reason.slice(1)} ` : t("chat.compacted")} ${formatTokenCount(compactResult.tokensBefore)} -> ${formatTokenCount(compactResult.estimatedTokensAfter)} tokens (${t("chat.tokensSaved", { saved: formatTokenCount(compactSavedTokens) })})`
    : null;
  const thinkingDisplayLabel = (() => {
    const lvl = thinkingLevel ?? "auto";
    if (lvl === "auto" || !thinkingLevelMap) return lvl;
    return thinkingLevelMap[lvl] ?? lvl;
  })();
  const rawToolPresetLabel = Object.entries(TOOL_PRESET_MAP).find(([, v]) => v === (toolPreset ?? "configured"))?.[0] ?? "configured";
  // fork:design-components —— 工具档在画板里是中文短标签（已配置 / 需审批 …），
  // 不再把内部枚举名直接印在控件上。
  const toolPresetLabel = t(`chat.toolPreset.${rawToolPresetLabel}`);
  // 上下文环的三档配色与文字（画板 20：>70% warning / >90% error）。
  const ringPercent = Math.max(0, Math.min(100, Math.round(contextUsage?.percent ?? 0)));
  const ringTier = ringPercent > 90 ? "bad" : ringPercent > 70 ? "warn" : "";
  const contextText = contextUsage?.contextWindow
    ? `${contextUsage.tokens != null ? formatTokenCount(contextUsage.tokens) : "?"} / ${formatTokenCount(contextUsage.contextWindow)}`
    : null;
  // fork:design-components —— 发送 / 停止直接使用画板 20 的 .pw-send 组件
  //（board.css：28px / radius-4 / accent 底 / .stop 变 error 底 / .disabled 变中性底），
  // 结构与 20-composer.html 一字不差：<i data-ico="arrow-up|square">。
  const sendButton = (
    <button
      type="button"
      onClick={handleSend}
      disabled={!value.trim() && !attachedImages.length}
      aria-label={t("chat.send")}
      title={t("chat.send")}
      className={`pw-send${(value.trim() || attachedImages.length) ? "" : " disabled"}`}
      style={{ cursor: (value.trim() || attachedImages.length) ? "pointer" : "not-allowed" }}
    >
      <span className="pw-ico"><i data-ico="arrow-up" data-size="14"></i></span>
    </button>
  );
  const stopButton = (
    <button
      type="button"
      onClick={onAbort}
      title={t("chat.stopAgent")}
      aria-label={t("chat.stopAgent")}
      className="pw-send stop"
      style={{ cursor: "pointer" }}
    >
      <span className="pw-ico"><i data-ico="square" data-size="13"></i></span>
    </button>
  );
  // fork:design-components —— 上下文环 + 浮窗 = 画板 01 帧 C / 画板 20 的
  // .pw-ring（三档配色）与 .pw-pop + .pw-prow 明细行。
  // 悬浮（鼠标 / 键盘焦点）才展开，不在输入框下面再放第二条横条。
  // fork:ui-stats-ring —— 浮窗内容升级为完整会话明细（原 composer 下方的
  // 统计长条已按用户裁定删除）。
  /* fork:context-pop-portal —— 环浮窗原来挂在 `.chat-input-shell.pw-composer` 里，
     而 composer 有 `overflow-x: clip`（为了让工具条芯片不横着溢出卡片）。
     浮窗宽 680px、又是右对齐，环的右边还跟着声音与发送两枚按钮，于是它的左缘
     必然越过 composer 左边界，被 `overflow-x: clip` 齐根切掉一长条。
     改成 portal 到 body（复用 `PortalDropdown`）就脱离全部裁切祖先；
     展开方向仍朝上 —— 环在窗口底部，下面没有空间。 */
  const contextRingOpen = ringHovered || ringPinned;
  const contextRing = contextUsage || sessionStats ? (
    <span
      ref={ringRef}
      className={`composer-ring${ringPinned ? " is-pinned" : ""}`}
      style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setRingHovered(true)}
      onMouseLeave={() => setRingHovered(false)}
    >
      <button
        type="button"
        className={`pw-ring${ringTier ? ` ${ringTier}` : ""}`}
        style={{ "--p": `${ringPercent}%`, border: 0, padding: 0, cursor: "pointer" } as React.CSSProperties}
        aria-label={t("session.context")}
        title={t("session.context")}
        aria-expanded={ringPinned}
        onClick={() => setRingPinned((v) => !v)}
      >
        <span className="sr-only" />
      </button>
      <PortalDropdown open={contextRingOpen} anchorRef={ringRef} align="right" width={ringPopWidth} panelRef={ringPopRef}>
        <div className="pw-pop composer-ring-pop">
          <div className="pw-inline" style={{ padding: "var(--s2) var(--s2) var(--s1)", gap: "var(--s2)" }}>
            <span className={`pw-ring${ringTier ? ` ${ringTier}` : ""}`} style={{ "--p": `${ringPercent}%`, width: 18, height: 18 } as React.CSSProperties} />
            <b style={{ fontWeight: 500, fontSize: "var(--text-secondary)", color: "var(--n-strong)" }}>
              {t("session.context")} {ringPercent}%
            </b>
            <span className="grow" />
            {contextText && <span className="pw-mono pw-dim" style={{ fontSize: "var(--text-meta)" }}>{contextText}</span>}
          </div>
          {statsDetails ? (
            // 完整明细（会话信息 / 消息 / Token），与原统计长条展开面板同源。
            <div style={{ display: "flex", flexWrap: "wrap", gap: "14px 28px", padding: "0 var(--s2) var(--s1)", fontSize: TEXT.sm, lineHeight: 1.5 }}>
              <SessionStatsDetails sessionStats={statsDetails} contextUsage={contextUsage ?? null} session={statsSession} />
            </div>
          ) : (
            <>
              {contextUsage?.tokens != null && (
                <div className="pw-prow"><span className="grow">Context</span><span className="pw-mono">{contextUsage.tokens.toLocaleString()}</span></div>
              )}
              {sessionStats && (
                <div className="pw-prow">
                  <span className="grow">{t("chat.turnTokens")}</span>
                  <span className="pw-mono">{sessionStats.tokens.input.toLocaleString()} / {sessionStats.tokens.output.toLocaleString()}</span>
                </div>
              )}
              {sessionStats && sessionStats.cost > 0 && (
                <div className="pw-prow"><span className="grow">{t("chat.sessionCost")}</span><span className="pw-mono">${sessionStats.cost.toFixed(4)}</span></div>
              )}
            </>
          )}
          {lastStopReason && (
            <div className="pw-prow"><span className="grow">{t("chat.stopReason")}</span><span className="pw-mono">{lastStopReason}</span></div>
          )}
          {onCompact && (
            <>
              <div className="pw-sep" />
              <button
                type="button"
                onClick={isCompacting ? onAbortCompaction : onCompact}
                className="pw-prow"
                style={{ width: "100%", color: isCompacting ? "var(--error)" : "var(--accent-text)" }}
              >
                <span className="pw-ico"><i data-ico={isCompacting ? "loader-circle" : "package"} data-size="14"></i></span>
                {isCompacting ? t("chat.compacting") : t("chat.compactContext")}
              </button>
            </>
          )}
        </div>
      </PortalDropdown>
    </span>
  ) : null;
  // fork:design-components —— 排队两个动作 = 画板 20/50 的 .pw-btn（28px / radius-4 /
  // 无铬），三态色（可用 / 不可用 / 强调）继续在组件里给：设计系统只有 4 个语义色，
  // 「立刻打断」是 warning、「跑完再发」是 accent，这条语义色差是运行时状态，不进 board.css。
  const queueControls = isStreaming ? (
    <>
      {onSteer && (
        <button
          type="button"
          className="pw-btn"
          onClick={() => sendQueued("steer")}
          disabled={!canQueueStreamingMessage}
          title={t("chat.steerHint")}
          style={{
            background: canQueueStreamingMessage ? "var(--warning-soft)" : undefined,
            color: canQueueStreamingMessage ? "var(--warning)" : undefined,
            cursor: canQueueStreamingMessage ? "pointer" : "not-allowed",
            opacity: canQueueStreamingMessage ? 1 : 0.5,
          }}
        >
          <span className="pw-ico"><i data-ico="arrow-right" data-size="13"></i></span>
          {t("chat.steer")}
        </button>
      )}
      {onFollowUp && (
        <button
          type="button"
          className="pw-btn"
          onClick={() => sendQueued("followup")}
          disabled={!canQueueStreamingMessage}
          title={`${t("chat.followUpHint")} (${isMobile ? "Ctrl/Cmd+" : ""}Alt/Option+Enter)`}
          aria-keyshortcuts={isMobile ? "Control+Alt+Enter Meta+Alt+Enter" : "Alt+Enter"}
          style={{
            background: canQueueStreamingMessage ? "var(--accent-soft)" : undefined,
            color: canQueueStreamingMessage ? "var(--accent-text)" : undefined,
            cursor: canQueueStreamingMessage ? "pointer" : "not-allowed",
            opacity: canQueueStreamingMessage ? 1 : 0.5,
          }}
        >
          <span className="pw-ico"><i data-ico="arrow-up" data-size="13"></i></span>
          {t("chat.followUp")}
        </button>
      )}
    </>
  ) : null;

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolDropdownRef.current && !toolDropdownRef.current.contains(e.target as Node)) {
        setToolDropdownOpen(false);
      }
      if (thinkingDropdownRef.current && !thinkingDropdownRef.current.contains(e.target as Node)) {
        setThinkingDropdownOpen(false);
      }
      if (controlsMenuRef.current && !controlsMenuRef.current.contains(e.target as Node)) {
        setControlsMenuOpen(false);
      }
      if (historyMenuRef.current && !historyMenuRef.current.contains(e.target as Node) && !textareaRef.current?.contains(e.target as Node)) {
        setHistoryMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (!narrowControls) setControlsMenuOpen(false);
  }, [isMobile]);



  return (
    <fieldset
      disabled={builtinCommandPending}
      aria-busy={builtinCommandPending}
      style={{
        flexShrink: 0,
        minWidth: 0,
        margin: 0,
        border: 0,
        background: "transparent",
        padding: compact ? 0 : "0 16px 8px",
        paddingRight: compact ? 0 : 16,
        opacity: builtinCommandPending ? 0.5 : 1,
        transition: "opacity 0.15s",
      }}
    >
      {/* Hidden file input */}
      {!compact && <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // fork:gap07-attachments — 任意文件（原来只收图片，其余静默丢弃）
          void attachFiles(files);
          e.target.value = "";
        }}
      />}
      <div style={{ maxWidth: "var(--composer-max-width, 892px)", margin: "0 auto" }}>
        {/* fork:zn-04 — banners sit above the strip and the strip stays welded to
            the card. Banners are transient alerts, the strip is chrome, so an
            alert must never come between the strip and the card (it would break
            the joined shape). The strip element itself is placed below, right
            before the card. */}
        <ModelErrorBanner error={modelError} />
        <ModelScopeWarningBanner warnings={modelScopeWarnings} />
        {showImageUnsupportedWarning && (() => {
          const entry = modelList?.find((m) => m.provider === model?.provider && m.id === model?.modelId);
          return (
            <ModelNoticeBanner
              tone="warning"
              title={t("chat.imageNotSupportedTitle")}
              body={t("chat.imageNotSupportedBody", { model: entry?.name || model?.modelId || "" })}
              onClose={() => setImageWarningDismissed(true)}
            />
          );
        })()}
        {/* Queued steering / follow-up messages (delivered by pi on upcoming turns) */}
        {/* fork:design-components —— 队列 = 画板 20「流式排队」那一段：一行 .pw-badge count
            说明排了几条（+ 召回钮），下面每条消息一行 .pw-prow。画板里没有外层盒子，
            所以这里也不再有自绘的描边 + 底色盒。 */}
        {((queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0)) > 0 && (
          <div className="anim-popover-down pw-rowgap" style={{ marginBottom: 8 }}>
            <div className="pw-inline">
              <span className="pw-badge count">
                {t("chat.queued", { count: (queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0) })}
              </span>
              <span className="pw-grow" />
              {onRecallQueue && (
                <button
                  type="button"
                  className="pw-btn sm"
                  onClick={onRecallQueue}
                  title={t("chat.recallTitle")}
                >
                  <span className="pw-ico"><i data-ico="undo-2" data-size="13"></i></span>
                  {t("chat.recall")}
                </button>
              )}
            </div>
            {queuedMessages?.steering.map((text, i) => (
              <QueuedMessageRow
                key={`steer-${i}`}
                kind="steer"
                text={text}
                index={i}
                promoteTitle={t("chat.queueSendNow")}
                removeTitle={t("chat.queueRemove")}
                dragging={draggingQueue?.kind === "steer" && draggingQueue.index === i}
                onRemove={() => onQueueRemove?.("steer", i, text)}
                onDragStart={onQueueMove ? () => beginQueueDrag("steer", i) : undefined}
                onDropOn={onQueueMove ? () => {
                  const drag = draggingQueueRef.current;
                  if (drag?.kind !== "steer" || drag.index === i) { endQueueDrag(); return; }
                  onQueueMove("steer", drag.index, queueDropTarget(drag.index, i), queuedMessages.steering[drag.index] ?? "");
                  endQueueDrag();
                } : undefined}
              />
            ))}
            {queuedMessages?.followUp.map((text, i) => (
              <QueuedMessageRow
                key={`followup-${i}`}
                kind="follow-up"
                text={text}
                index={i}
                promoteTitle={t("chat.queueSendNow")}
                removeTitle={t("chat.queueRemove")}
                dragging={draggingQueue?.kind === "followUp" && draggingQueue.index === i}
                onRemove={() => onQueueRemove?.("followUp", i, text)}
                onPromote={onQueuePromote ? () => onQueuePromote(i, text) : undefined}
                onDragStart={onQueueMove ? () => beginQueueDrag("followUp", i) : undefined}
                onDropOn={onQueueMove ? () => {
                  const drag = draggingQueueRef.current;
                  if (drag?.kind !== "followUp" || drag.index === i) { endQueueDrag(); return; }
                  onQueueMove("followUp", drag.index, queueDropTarget(drag.index, i), queuedMessages.followUp[drag.index] ?? "");
                  endQueueDrag();
                } : undefined}
              />
            ))}
          </div>
        )}
        {/* fork:design-components —— 三条瞬时提示 = 画板 50 的 .pw-alert 四态：
            重试 warn / 压缩成功 ok / 压缩失败 error（基态）。底色与文字色都由 board.css 给。 */}
        {retryInfo && (
          <div className="pw-alert warn" style={{ marginBottom: 8 }}>
            <span className="pw-ico"><i data-ico="refresh-cw" data-size="14"></i></span>
            <span className="grow">
              {t("chat.retrying", { attempt: retryInfo.attempt, max: retryInfo.maxAttempts })}
              {retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>}
            </span>
          </div>
        )}
        {compactResultText && (
          <div className="pw-alert ok" style={{ marginBottom: 8 }}>
            <span className="pw-ico"><i data-ico="circle-check" data-size="14"></i></span>
            <span className="grow">{compactResultText}</span>
          </div>
        )}
        {compactError && (
          <div
            role="alert"
            className="pw-alert"
            style={{
              marginBottom: 8,
              // 错误正文原样换行不断词（服务端可能回 HTML 片段），这两条不能交给组件类。
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            <span className="pw-ico"><i data-ico="circle-alert" data-size="14"></i></span>
            <span className="grow">{compactError}</span>
          </div>
        )}
        <ComposerContextStrip
          contexts={selectionContexts}
          sessionReferences={sessionReferences}
          disabled={builtinCommandPending || isStreaming}
          onLocate={onLocateSelectionContext}
          onOpenSessionReference={onOpenSessionReference}
          onRemove={(id) => {
            setSelectionContexts((current) => {
              const next = current.filter((context) => context.id !== id);
              selectionContextsRef.current = next;
              return next;
            });
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
          onRemoveSessionReference={(id) => {
            setSessionReferences((current) => {
              const next = current.filter((reference) => reference.id !== id);
              sessionReferencesRef.current = next;
              return next;
            });
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
        />
        {todoSummary && todoSummary.total > 0 && (
          <div className="pw-rowgap" style={{ marginBottom: 6 }}>
            <TodoChip summary={todoSummary} />
          </div>
        )}
        {/* fork:design-components —— 附件区 = 画板 20「附件与引用」A 帧：一条 .pw-chips，
            文件是 .pw-chip（类型图标 + 文件名 + 芯片内 data-ico="x" 移除钮）。
            图片保留 56px 缩略图（画板没画缩略图形态，而 ChatInput 的既有测试要求
            草稿图片必须渲染出 <img>），但它的行与移除钮同样由画板基件承载。 */}
        {attachedImages.length > 0 && (
          <div className="pw-chips">
            {attachedImages.map((img, i) => (
              <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                <ImagePreview key={img.previewUrl} src={img.previewUrl}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.previewUrl}
                    alt=""
                    style={{ width: 56, height: 56, objectFit: "cover", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "block" }}
                  />
                </ImagePreview>
                <button
                  type="button"
                  className="pw-iconbtn sm composer-thumb-remove"
                  onClick={() => removeImage(i)}
                  title={t("chat.removeAttachment")}
                  aria-label={t("chat.removeAttachment")}
                  style={{ position: "absolute", top: -6, right: -6 }}
                >
                  <span className="pw-ico"><i data-ico="x" data-size="12"></i></span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* fork:zc-08 — 非图片附件的 chips：点开按类型预览（PDF/DOCX/音视频/文本），
            X 移除时同步清掉输入框里的 `@文件名`。 */}
        {referenceAttachments.length > 0 && (
          <div className="pw-chips">
            {referenceAttachments.map((chip) => (
              /* 芯片本身是静态盒（画板 20 的 .pw-chip 就是 span）：里面的预览触发器是
                 AttachmentPreview 自己渲染的 button，移除钮是芯片末尾的 .pw-ico 按钮。 */
              <span key={chip.path} className="pw-chip" style={{ maxWidth: 220 }}>
                <AttachmentPreview
                  name={chip.name}
                  kind={chip.kind}
                  src={attachmentPreviewUrl(chip.path)}
                  previewSrc={chip.kind === "docx" ? attachmentPreviewUrl(chip.path, "preview") : undefined}
                  style={{ flex: 1, minWidth: 0, overflow: "hidden", textAlign: "left" }}
                >
                  <span className="pw-ico"><i data-ico={attachmentChipIcon(chip.kind)} data-size="12"></i></span>
                  <span className="grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chip.name}</span>
                </AttachmentPreview>
                <button
                  type="button"
                  className="pw-ico"
                  onClick={() => removeReferenceAttachment(chip.path)}
                  title={t("chat.removeAttachment")}
                  aria-label={t("chat.removeAttachment")}
                >
                  <i data-ico="x" data-size="11"></i>
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Main input */}
        <div style={{ position: "relative", minWidth: 0 }}>
          {historyMenuOpen && inputHistory.length > 0 && (
            <div
              ref={historyMenuRef}
              className="pw-pop anim-popover"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(100% + 8px)",
                zIndex: 120,
                display: "flex",
                flexDirection: "column",
                boxSizing: "border-box",
                maxHeight: "min(44vh, 360px)",
              }}
            >
              {/* fork:design-components —— 浮窗 = 画板 21：.pw-pop 壳 + .pw-pop-title 头
                  （history 图标 + 标题）+ .pw-prow 行（当前项 is-on）。滚动区改成
                  「flex 1 + overflow」的列，不再靠减一个魔数高度。 */}
              <div className="pw-pop-title" style={{ display: "flex", alignItems: "center", gap: "var(--s2)", flexShrink: 0 }}>
                <span className="pw-ico"><i data-ico="history" data-size="14"></i></span>
                <span className="grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t("chat.inputHistory")}
                </span>
              </div>
              <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "0 4px 4px" }}>
                {inputHistory.map((item, index) => {
                  const active = index === historyActiveIndex;
                  return (
                    <button
                      key={`${index}:${item}`}
                      ref={(node) => {
                        historyItemRefs.current[index] = node;
                      }}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyHistoryInput(item);
                      }}
                      onMouseEnter={() => setHistoryActiveIndex(index)}
                      className={`pw-prow${active ? " is-on" : ""}`}
                      style={{ alignItems: "flex-start", cursor: "pointer" }}
                    >
                      <span className="pw-badge count">{index + 1}</span>
                      <span className="grow" style={{ minWidth: 0, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden", overflowWrap: "anywhere" }}>
                        {item}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {slashMenuOpen && slashQuery !== null && (
            <div
              ref={slashMenuRef}
              className="pw-pop anim-popover"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(100% + 8px)",
                zIndex: 120,
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                // fork:ui-slash-pop —— .pw-pop 在 board.css 里写死了 width:320px，
                // 但斜杠弹窗是 composer 内部的辅助面板，应当按卡片宽定上限，
                // 否则左下角命令列就被挤成单列、描述直接裁掉。
                width: "min(680px, calc(100vw - 24px))",
                maxWidth: "100%",
                maxHeight: slashMenuMaxHeight === null
                  ? "min(72.8vh, 598px)"
                  : `min(72.8vh, 598px, ${slashMenuMaxHeight}px)`,
              }}
            >
              {/* fork:design-components —— 搜索头 = 画板 21「/ 命令」那一行（.pw-pop-search：
                  slash 图标 + 当前查询 + 分隔线）；右侧补计数徽标与 Tab/Enter 提示。 */}
              <div
                className="pw-pop-search"
                style={{ borderBottom: "1px solid var(--n-border-subtle)", margin: "0 0 var(--s1)", flexShrink: 0 }}
              >
                <span className="pw-ico"><i data-ico="slash" data-size="14"></i></span>
                <span className="pw-grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: "var(--n-text)" }}>
                  {slashCommandsLoading ? t("chat.loadingCommands") : `/${slashQuery}`}
                </span>
                {!slashCommandsLoading && (
                  <span className="pw-badge count" style={{ flexShrink: 0 }}>{slashCommandCountLabel}</span>
                )}
                <span className="pw-kbd" style={{ flexShrink: 0 }}>{t("chat.tabEnter")}</span>
              </div>
              <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "0 4px 4px" }}>
                {!slashCommandsLoading && filteredSlashCommands.length === 0 ? (
                  <div className="pw-prow pw-desc">
                     {t("chat.noCommands")}
                  </div>
                ) : (
                  groupedSlashCommands.map((group) => (
                    <section key={group.source} style={{ marginBottom: 12 }}>
                      {/* fork:design-system SW-02 —— 分组标题 = pw-pop-title（sticky 钉顶）。 */}
                      <div
                        className="pw-pop-title"
                        style={{
                          position: "sticky",
                          top: -4,
                          zIndex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          margin: "0 -4px",
                          padding: "4px 4px 6px",
                          background: "var(--surface-popover)",
                        }}
                      >
                           <span>{t(SLASH_SOURCE_GROUP_LABEL_KEYS[group.source])}</span>
                        <span className="pw-badge count">{group.items.length}</span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                          gap: 8,
                        }}
                      >
                        {group.items.map(({ command, index }) => {
                          const active = index === slashActiveIndex;
                          const dormant = isDormantSkillCommand(command, skillDormancy);
                          return (
                            <button
                              key={`${command.source}:${command.name}`}
                              ref={(node) => {
                                slashItemRefs.current[index] = node;
                              }}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                applySlashCommand(command);
                              }}
                              onMouseEnter={() => setSlashActiveIndex(index)}
                              className={`pw-prow${active ? " is-on" : ""}`}
                              style={{ width: "100%", minWidth: 0, height: "auto", minHeight: 0 }}
                              title={command.description ? getSlashDescription(command, t) : undefined}
                            >
                              <span className="pw-ico" style={{ flexShrink: 0, color: dormant ? "var(--n-placeholder)" : undefined }}>
                                <i data-ico={command.source === "skill" ? "box" : command.source === "prompt" ? "square-function" : "slash"} data-size="14"></i>
                              </span>
                              <span
                                className="grow"
                                style={{
                                  minWidth: 0,
                                  fontFamily: "var(--font-mono)",
                                  overflowWrap: "anywhere",
                                  color: dormant ? "var(--n-placeholder)" : undefined,
                                }}
                              >
                                /{command.name}
                              </span>
                              {command.description && (
                                <span
                                  className="pw-desc"
                                  style={{ flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "50%" }}
                                >
                                   {getSlashDescription(command, t)}
                                </span>
                              )}
                              {dormant && <span className="pw-desc" style={{ flexShrink: 0 }}>{t("chat.dormant")}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))
                )}
              </div>
            </div>
          )}
          {referenceMenuOpen && referenceQuery !== null && (
            <ComposerReferenceMenu
              kind={referenceQuery.kind}
              items={referenceItems}
              activeIndex={referenceActiveIndex}
              loading={referenceLoading && referenceItems.length === 0}
              maxHeight={referenceMenuMaxHeight}
              menuRef={referenceMenuRef}
              itemRefs={referenceItemRefs}
              onHover={setReferenceActiveIndex}
              onPick={applyReferenceCompletion}
            />
          )}
          {atMenuOpen && atQuery !== null && (() => {
            const indexLoading = fileIndexLoading && (!fileIndex || fileIndex.cwd !== cwd);
             const matchCountLabel = atMatches.length === 1 ? t("chat.match") : t("chat.matches", { count: atMatches.length });
            // With a truncated index, local results are provisional — the
            // debounced server search over the full listing replaces them.
            const truncatedHint = fileIndex?.truncated && !serverResultInUse
               ? (atQuery.query ? t("chat.searchingAll") : t("chat.indexTruncated"))
              : "";
            return (
              <div
                ref={atMenuRef}
                className="pw-pop anim-popover"
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: "calc(100% + 8px)",
                  zIndex: 120,
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                  maxHeight: atMenuMaxHeight === null
                    ? "min(48vh, 400px)"
                    : `min(48vh, 400px, ${atMenuMaxHeight}px)`,
                }}
              >
                {/* fork:design-system SW-02 —— 头行 = 画板 21 的 pw-pop-title（标题 + grow + kbd）。 */}
                <div className="pw-pop-title" style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {indexLoading
                       ? t("chat.loadingFiles")
                       : t("chat.files", { label: matchCountLabel, hint: truncatedHint })}
                  </span>
                  <span className="grow" />
                  <span className="pw-kbd">{t("chat.tabEnter")}</span>
                </div>
                <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "0 4px 4px" }}>
                  {!indexLoading && atMatches.length === 0 ? (
                    <div className="pw-prow pw-desc">
                       {needsServerSearch && !serverResultInUse ? t("chat.searching") : t("chat.noMatchingFiles")}
                    </div>
                  ) : (
                    atMatches.map((entry, index) => {
                      const active = index === atActiveIndex;
                      const name = entry.path.split("/").pop() ?? entry.path;
                      const dirPrefix = entry.path.slice(0, entry.path.length - name.length);
                      return (
                        <button
                          key={`${entry.isDir ? "d" : "f"}:${entry.path}`}
                          ref={(node) => {
                            atItemRefs.current[index] = node;
                          }}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyAtCompletion(entry);
                          }}
                          onMouseEnter={() => setAtActiveIndex(index)}
                          className={`pw-prow${active ? " is-on" : ""}`}
                          style={{ width: "100%", fontFamily: "var(--font-mono)" }}
                        >
                          <span className="pw-ico" style={{ flexShrink: 0 }}>
                            {entry.isDir ? <FolderIcon size={14} /> : getFileIcon(name, 14)}
                          </span>
                          <span className="grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {dirPrefix && <span className="pw-desc">{dirPrefix}</span>}
                            {name}
                            {entry.isDir && <span className="pw-desc">/</span>}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}
          {/* fork:gap07-attachments — 附件落盘结果：每次拖入都有可见交代（新增了什么、跳过了什么） */}
          {attachmentNotice && (
            <div
              role="status"
              aria-live="polite"
              // fork:design-components —— 落盘结果 = 画板 50 的 .pw-alert info（中性底 +
              // info 字色）；行内的 warning / danger 语义色仍按结果逐行给。
              className="pw-alert info"
              style={{
                // 宽度由外层 composer 容器（`--composer-max-width`）统一约束，
                // 这里不再声明自己的 maxWidth —— 上层的 ChatAppearance 测试
                // 就要求这个变量在文件里只出现一次。
                margin: "0 0 6px",
              }}
            >
              <span className="pw-ico"><i data-ico="info" data-size="14"></i></span>
              <div className="grow" style={{ display: "grid", gap: 2, minWidth: 0 }}>
                {attachmentNotice.added.length > 0 && (
                  <span>{t("chat.attachmentAdded", { names: attachmentNotice.added.join("、") })}</span>
                )}
                {attachmentNotice.skipped.length > 0 && (
                  <span style={{ color: "var(--warning)" }}>
                    {t("chat.attachmentSkipped", {
                      limit: Math.round(MAX_ATTACHED_FILE_BYTES / (1024 * 1024)),
                      names: attachmentNotice.skipped.map((entry) => entry.name).join("、"),
                    })}
                  </span>
                )}
                {attachmentNotice.failed.length > 0 && (
                  <span style={{ color: "var(--error)" }}>
                    {t("chat.attachmentFailed", { names: attachmentNotice.failed.join("、") })}
                  </span>
                )}
              </div>
              <button
                type="button"
                className="pw-iconbtn sm"
                onClick={() => setAttachmentNotice(null)}
                aria-label={t("chat.close")}
                title={t("chat.close")}
                style={{ flexShrink: 0, alignSelf: "flex-start" }}
              >
                <span className="pw-ico"><i data-ico="x" data-size="12"></i></span>
              </button>
            </div>
          )}
          {/* fork:ui-ctxbar —— 新会话的上下文条（项目 / 分支）在输入卡**上方**：
              Codex 式的一条无铬信息条（.pw-ctxbar，画板 20「新会话 · 上下文条」），
              不再是卡内顶行的一枚芯片行（.pw-chips 的地盘是附件芯片）。
              阅读态塌陷（.is-compact 只剩一行）时整条不渲染：那时输入卡自己都收成
              一行了，上面再挂一条 24px 的信息行只会把「收起」这件事说反。 */}
          {protrusion && !compact && <div className="pw-ctxbar">{protrusion}</div>}
          <div
            ref={inputShellRef}
            /* fork:design-components —— 输入框外壳直接用画板 20 的 .pw-composer
               （面板底 / 发丝边框 / radius-6 / 弹层阴影来自 board.css）；
               compact 阅读态与 bash/流式边框色作为状态覆盖保留。 */
            className={`chat-input-shell pw-composer${manualMode ? " is-manual-height" : ""}${readingCompact ? " is-compact" : ""}`}
            // fork:pr14-compact — focus 一定展开（状态机 kind: "focus"），
            // 焦点在 composer 内时也不允许塌陷。
            onFocus={() => {
              inputFocusedRef.current = true;
              setReadingCompact((prev) => nextInputCompactState(prev, { kind: "focus" }));
            }}
            onBlur={() => {
              inputFocusedRef.current = false;
            }}
            style={{
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              background: compact ? "none" : undefined,
              border: compact ? "none" : bashMode ? "1px solid var(--border-strong)" : isStreaming && (onSteer || onFollowUp)
                ? "1px solid var(--warning)"
                : undefined,
              borderRadius: compact ? 0 : undefined,
              padding: compact ? 0 : undefined,
              boxShadow: compact ? "none" : undefined,
              // fork:pr23-resize — 手动高度直接挂在这里；自动模式不写 height，
              // 保持卡片随内容收缩。
              height: manualMode ? `${manualHeight}px` : undefined,
            } as React.CSSProperties}
          >
          {/* fork:pr23-resize — 手柄骑在卡片上边缘（向上拖变大）。移动端与引用回答
              形态不渲染；阅读态塌陷（.is-compact）时由 CSS 隐藏。 */}
          {!compact && !isMobile && (
            <div
              {...inputHeightResizer.separatorProps}
              className={`chat-input-resize-handle${inputHeightResizer.isResizing ? " is-resizing" : ""}`}
            />
          )}
          <div
            // fork:design-components —— 输入区 = 画板 01/20 的 .pw-composer-top：
            // 同一套内边距（12px 12px 6px）与最小高度（46px），文字起点与画板一致。
            className="chat-input-editor-row pw-composer-top"
            style={{
              minWidth: 0,
              display: "flex",
              flexDirection: compact ? "column" : "row",
              gap: 8,
              alignItems: compact ? "stretch" : "flex-start",
            }}
          >
          <div
            className="chat-input-highlight-wrap"
            style={{
              position: "relative",
              flex: compact ? "none" : 1,
              minWidth: 0,
              width: "100%",
              display: "flex",
            }}
          >
            {/* D2-PR-12 — 高亮 overlay（透明 textarea + 高亮层）。
                viewport 盖住 textarea 的内容盒并负责裁剪，layer 随滚动平移；
                textarea 自己的文字透明（caret 单独设色），所以可见字形全部来自
                高亮层。只有 valid 的 token 才渲染 .mention-token；正在输入（光标
                所在）的 token 由 activeTokenStart 判定为纯文本，避免半截 token 闪高亮。 */}
            <div
              ref={highlightViewportRef}
              className="chat-input-highlight-viewport"
              aria-hidden="true"
            >
              <div ref={highlightLayerRef} className="chat-input-highlight">
                {highlightSegments.map((segment, i) =>
                  segment.type === "text" || !segment.token.valid ? (
                    segment.text
                  ) : (
                    <span key={i} className="pw-tok-ref">{segment.text}</span>
                  )
                )}
              </div>
            </div>
            <textarea
              ref={textareaRef}
              className="chat-input-textarea"
              aria-label={compact ? t("chat.quoteQuestion") : undefined}
              value={value}
              onChange={(e) => {
                valueRef.current = e.target.value;
                setValue(e.target.value);
                setHistoryMenuOpen(false);
                updateAtQuery(e.target.value, e.target.selectionStart);
              }}
              onSelect={(e) => {
                const el = e.currentTarget;
                updateAtQuery(el.value, el.selectionStart);
              }}
              onScroll={syncHighlightScroll}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={(e) => {
                isComposingRef.current = false;
                lastCompositionEndAtRef.current = Date.now();
                const el = e.currentTarget;
                updateAtQuery(el.value, el.selectionStart);
              }}
              onInput={handleInput}
              onPaste={handlePaste}
              placeholder={
                isStreaming && (onSteer || onFollowUp)
                  ? t("chat.steerPlaceholder")
                  : isStreaming ? t("chat.agentPlaceholder")
                  : t("chat.messagePlaceholder")
              }
              rows={1}
              style={{
                flex: compact ? "none" : 1,
                minWidth: 0,
                width: "100%",
                background: "none",
                border: "none",
                outline: "none",
                resize: "none",
                // D2-PR-12 — 透明文字 + 可见 caret：字形由下方高亮层提供。
                color: "transparent",
                caretColor: "var(--text)",
                // 盖在高亮层之上（两者都是定位元素，DOM 顺序靠后者获胜），
                // 这样选区与 caret 不会被高亮层遮住。
                position: "relative",
                // 与高亮层共用同一个内容盒：UA 默认 padding 会让两层错位。
                padding: 0,
                fontSize: "var(--chat-content-font-size, 13px)",
                lineHeight: 1.6,
                fontFamily: "inherit",
                minHeight: compact ? 96 : 24,
                maxHeight: 200,
                overflow: "auto",
              }}
            />
          </div>

          {(compact || isMobile) && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, alignSelf: "flex-end" }}>
              {isStreaming ? stopButton : sendButton}
            </div>
          )}
          </div>

        {/* Bash mode status label */}
        {bashMode && (
          <div className="text-xs px-2 py-1" style={{ color: bashExcluded ? "var(--text-muted)" : "var(--accent)", marginTop: 4 }}>
             {t("chat.shell")} · {bashExcluded ? t("chat.outputLocal") : t("chat.outputModel")}
          </div>
        )}

        {/* fork:design-components —— 工具栏 = 画板 20 的 .pw-composer-bar：
            一行内是 附件 · 模型 · 思考 · 权限 · 工具档 · 压缩 ｜ 上下文环 · 声音 · 发送，
            与画板 20 A 的控件顺序一致。 */}
        {!compact && <div className="chat-input-toolbar pw-composer-bar" style={{
          display: narrowControls ? "grid" : "flex",
          gridTemplateColumns: narrowControls ? "minmax(0, 1fr) auto" : undefined,
        }}>

          {/* LEFT: attach + model selector (idle) or steer/followup toggle (streaming) */}
          <div style={{ flex: narrowControls ? "1 1 auto" : "0 1 auto", minWidth: 0, display: "flex", alignItems: "center", gap: 2 }}>
            {/* 附件 +：直接使用画板 20 的 .pw-iconbtn 组件（board.css：无边框 / hover 叠色 / is-on 选中），
                有附件时挂 is-on（画板的选中态），图标与 20-composer.html 同款 plus。 */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title={t("chat.attachFile")}
              className={`pw-iconbtn${attachedImages.length ? " is-on" : ""}`}
              style={{ width: "var(--control-sm)", height: "var(--control-sm)", cursor: "pointer" }}
            >
              <span className="pw-ico"><i data-ico="plus" data-size="16"></i></span>
            </button>
            {/* Model selector - visible always, disabled while the session or switch is busy */}
            {(modelOptions.length > 0 || model || modelError) && onModelChange && (
              <ModelSelector
                options={modelOptions}
                value={model}
                onChange={onModelChange}
                disabled={isStreaming}
                busy={modelSwitching}
                isAutoSelection={isAutoModelSelection}
              />
            )}
            {/* fork:ui — 输入框侧的独立收藏菜单已移除（用户要求）：收藏现在就在
                模型下拉里每行右侧的星标上（ModelSelector），不需要第二个入口。 */}
            {isStreaming && onThinkingLevelChange && (
              // The level cannot change mid-turn, so this is read-only: a button here
              // would invite clicks that do nothing. It still answers the question
              // that matters while a turn runs, which budget is this one spending.
              // fork:design-components —— 只读态也用画板 .pw-select：尺寸/内边距
              // 与旁边可点的思考档完全一致，不会因为「这个不能点」就换一套尺寸。
              <span
                className="pw-select"
                title={t("chat.currentReasoning", { level: thinkingDisplayLabel })}
                style={{ color: "var(--n-placeholder)" }}
              >
                <span className="pw-ico"><i data-ico="brain" data-size="13"></i></span>
                {(!narrowControls || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{thinkingDisplayLabel}</span>}
              </span>
            )}
            {!isStreaming && onThinkingLevelChange && (
              <div ref={thinkingDropdownRef} style={{ position: "relative" }}>
                {/* fork:design-components —— 思考档直接用画板 20/21 的 .pw-select + .pw-pop/.pw-prow。 */}
                <button
                  type="button"
                  onClick={() => !isStreaming && setThinkingDropdownOpen((v) => !v)}
                  disabled={isStreaming}
                   title={t("chat.changeReasoning", { level: thinkingDisplayLabel })}
                   aria-label={t("chat.changeReasoningLabel")}
                  className="pw-select"
                  style={{
                    cursor: isStreaming ? "not-allowed" : "pointer",
                    opacity: isStreaming ? 0.5 : 1,
                    background: thinkingDropdownOpen ? "var(--overlay-hover)" : undefined,
                    width: isMobile ? "auto" : undefined,
                  }}
                >
                  <span className="pw-ico"><i data-ico="brain" data-size="13"></i></span>
                  {(!narrowControls || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{thinkingDisplayLabel}</span>}
                </button>
                {thinkingDropdownOpen && (
                  <div
                    className="anim-popover pw-pop"
                    style={{
                      position: "absolute", bottom: "calc(100% + 6px)",
                      // fork:ui-composer-pop —— 左侧组的下拉一律左缘锚定：右缘锚定会把
                      // 320 宽的浮窗探出卡片左缘，被 overflow-x:clip 裁掉。
                      left: 0,
                      zIndex: 100, minWidth: 180,
                    }}
                  >
                    {THINKING_LEVELS.filter((lvl) => {
                      if (!availableThinkingLevels) return true;
                      if (lvl === "auto") return true;
                      return availableThinkingLevels.includes(lvl);
                    }).map((lvl) => {
                      const isActive = (thinkingLevel ?? "auto") === lvl;
                       const desc = t(THINKING_LEVEL_DESC_KEYS[lvl]);
                      const mappedVal = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
                      const displayLabel = (mappedVal != null && mappedVal !== lvl) ? mappedVal : lvl;
                      const showOriginal = mappedVal != null && mappedVal !== lvl;
                      return (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => { setThinkingDropdownOpen(false); if (!isActive) onThinkingLevelChange(lvl); }}
                          className={`pw-prow${isActive ? " is-on" : ""}`}
                          style={{ cursor: "pointer" }}
                        >
                          {isActive
                            ? <span className="pw-ico" style={{ color: "var(--accent)" }}><i data-ico="check" data-size="12"></i></span>
                            : <span style={{ width: 14, flexShrink: 0 }} />}
                          <span className="grow">
                            {displayLabel}
                            {showOriginal && <span className="pw-mono" style={{ fontSize: TEXT["2xs"], marginLeft: 5 }}>({lvl})</span>}
                          </span>
                          <span className="pw-desc">{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {/* fork:proma-02-mode — 权限档位（Chat-only 会话没有意义，所以隐藏）。
                点一下循环切换：全自动 → 需审批 → 计划。 */}
            {onPermissionModeChange && permissionMode && toolPreset !== "none" && (
              /* fork:design-components —— 权限档直接用画板 20/21 的 .pw-select 组件
                 （board.css：28px / 无边框 / hover 叠色；非默认档走强调色文字）。 */
              <button
                type="button"
                onClick={() => onPermissionModeChange(nextPermissionMode(permissionMode))}
                title={`${t(PERMISSION_MODE_LABEL_KEYS[permissionMode])}：${t(PERMISSION_MODE_HINT_KEYS[permissionMode])}`}
                aria-label={t(PERMISSION_MODE_LABEL_KEYS[permissionMode])}
                className="pw-select"
                style={{
                  cursor: "pointer",
                  // 非默认档位用强调色，因为「当前不全自动」是需要一眼看出来的状态
                  color: permissionMode === "bypass" ? undefined : "var(--accent-text)",
                  width: isMobile ? "auto" : undefined,
                }}
              >
                <span className="pw-ico">
                  <i
                    data-ico={permissionMode === "bypass" ? "shield" : permissionMode === "ask" ? "shield-check" : "book-marked"}
                    data-size="13"
                  ></i>
                </span>
                {(!narrowControls || controlsMenuOpen) && (
                  <span style={{ whiteSpace: "nowrap" }}>{t(PERMISSION_MODE_LABEL_KEYS[permissionMode])}</span>
                )}
              </button>
            )}
            {!isStreaming && onToolPresetChange && (
              <div ref={toolDropdownRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => !isStreaming && setToolDropdownOpen((v) => !v)}
                  disabled={isStreaming}
                  title={t("chat.changeToolPreset") + `: ${toolPresetLabel}`}
                  aria-label={t("chat.changeToolPreset")}
                  className="pw-select"
                  style={{
                    cursor: isStreaming ? "not-allowed" : "pointer",
                    opacity: isStreaming ? 0.5 : 1,
                    background: toolDropdownOpen ? "var(--overlay-hover)" : undefined,
                    width: isMobile ? "auto" : undefined,
                  }}
                >
                  <span className="pw-ico"><i data-ico="wrench" data-size="13"></i></span>
                  {(!narrowControls || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{toolPresetLabel}</span>}
                </button>
                {toolDropdownOpen && (
                  <div
                    className="anim-popover pw-pop"
                    style={{
                      position: "absolute",
                      bottom: "calc(100% + 6px)",
                      // fork:ui-composer-pop —— 同思考档：左缘锚定，不探出卡片左缘。
                      left: 0,
                      zIndex: 100,
                      minWidth: 120,
                    }}
                  >
                    {TOOL_PRESETS.map((lvl) => {
                      const preset = TOOL_PRESET_MAP[lvl];
                      const isActive = (toolPreset ?? "configured") === preset;
                      let desc: string;
                      if (lvl === "configured") desc = t("chat.configuredTools");
                      else if (lvl === "chat-only") desc = t("chat.chatOnly");
                      else if (lvl === "read-only") desc = t("chat.readOnlyTools", { count: 4 });
                      else if (lvl === "default") desc = t("chat.builtInTools", { count: 4 });
                      else desc = t("chat.allBuiltInTools");
                      return (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => { setToolDropdownOpen(false); if (!isActive) onToolPresetChange(preset); }}
                          className={`pw-prow${isActive ? " is-on" : ""}`}
                          style={{ cursor: "pointer" }}
                        >
                          {isActive
                            ? <span className="pw-ico" style={{ color: "var(--accent)" }}><i data-ico="check" data-size="12"></i></span>
                            : <span style={{ width: 14, flexShrink: 0 }} />}
                          <span className="grow">{t(`chat.toolPreset.${lvl}`)}</span>
                          <span className="pw-desc">{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {!isStreaming && onCompact && (
              <div>
                {/* fork:design-components —— 压缩按钮 = 画板 .pw-select；进行中转 error 色 + loader。 */}
                <button
                  type="button"
                  onClick={isCompacting ? onAbortCompaction : onCompact}
                  disabled={isStreaming && !isCompacting}
                  className="pw-select"
                  style={{
                    cursor: (isStreaming && !isCompacting) ? "not-allowed" : "pointer",
                    opacity: (isStreaming && !isCompacting) ? 0.5 : 1,
                    color: isCompacting ? "var(--error)" : undefined,
                    background: isCompacting ? "var(--error-soft)" : undefined,
                    width: isMobile ? "auto" : undefined,
                  }}
                  title={isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
                  aria-label={isCompacting ? t("chat.stopCompaction") : t("chat.compactContext")}
                >
                  {isCompacting ? (
                    <>
                      <span className="pw-ico"><i data-ico="loader-circle" data-size="13"></i></span>
                      {(!narrowControls || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{t("chat.compacting")}</span>}
                    </>
                  ) : (
                    <>
                      <span className="pw-ico"><i data-ico="minimize-2" data-size="13"></i></span>
                      {(!narrowControls || controlsMenuOpen) && <span style={{ whiteSpace: "nowrap" }}>{t("chat.compact")}</span>}
                    </>
                  )}
                </button>
              </div>
            )}

          </div>

          {/* 画板 20 的 .pw-composer-bar 用 .grow 顶开左右两组。 */}
          <span className="grow" />

          {/* RIGHT: 上下文环 + 声音 + 发送（停止） */}
          <div ref={controlsMenuRef} style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            position: "relative",
            marginLeft: narrowControls ? 0 : "auto",
          }}>
            {narrowControls && (
              /* fork:design-components —— 窄屏「更多控件」= 画板 60 C 帧的 ellipsis 图标钮（.pw-iconbtn），点开是覆盖式工具条、末尾一个 x 收起。 */
              <button
                type="button"
                 title={controlsMenuOpen ? undefined : t("chat.moreControls")}
                 aria-label={t("chat.moreControls")}
                aria-expanded={controlsMenuOpen}
                aria-hidden={controlsMenuOpen || undefined}
                tabIndex={controlsMenuOpen ? -1 : undefined}
                onClick={() => {
                  setControlsMenuOpen(true);
                }}
                className="pw-iconbtn"
                style={{
                  cursor: controlsMenuOpen ? "default" : "pointer",
                  visibility: controlsMenuOpen ? "hidden" : "visible",
                  pointerEvents: controlsMenuOpen ? "none" : "auto",
                }}
              >
                <span className="pw-ico"><i data-ico="ellipsis" data-size="15"></i></span>
              </button>
            )}
            <div style={{
              display: narrowControls ? (controlsMenuOpen ? "flex" : "none") : "flex",
              alignItems: "center",
              gap: narrowControls ? 1 : 2,
              ...(narrowControls ? {
                position: "absolute",
                right: 0,
                bottom: 0,
                zIndex: 60,
                padding: 1,
                width: "max-content",
                maxWidth: "calc(100vw - 32px)",
                flexWrap: "nowrap",
                justifyContent: "flex-end",
                border: "1px solid color-mix(in srgb, var(--border) 72%, transparent)",
                borderRadius: "var(--radius-md)",
                background: "color-mix(in srgb, var(--bg-panel) 92%, var(--bg))",
                boxShadow: "var(--shadow-popover)",
                backdropFilter: "blur(10px)",
              } : null),
            }}>
            {isStreaming && queueControls}

            {contextRing}

            {onSoundToggle !== undefined && (
              /* fork:design-components —— 声音开关 = 画板 20 的 .pw-iconbtn（volume-2 / volume-x）。 */
              <button
                type="button"
                onClick={onSoundToggle}
                 title={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
                 aria-label={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
                className={`pw-iconbtn${soundEnabled ? "" : " is-on"}`}
                style={{ width: 32, height: "var(--control-sm)", cursor: "pointer", opacity: soundEnabled ? 1 : 0.55 }}
              >
                <span className="pw-ico"><i data-ico={soundEnabled ? "volume-2" : "volume-x"} data-size="14"></i></span>
              </button>
            )}
            {narrowControls && controlsMenuOpen && (
              <button
                type="button"
                 title={t("chat.collapseControls")}
                 aria-label={t("chat.collapseControls")}
                aria-expanded={true}
                onClick={() => {
                  setToolDropdownOpen(false);
                  setThinkingDropdownOpen(false);
                  setControlsMenuOpen(false);
                }}
                className="pw-iconbtn"
                style={{ cursor: "pointer" }}
              >
                <span className="pw-ico"><i data-ico="x" data-size="13"></i></span>
              </button>
            )}
            {!isMobile && (isStreaming ? stopButton : sendButton)}
            </div>
          </div>

        </div>}
        {/* Close composer panel (wraps textarea + bottom controls) */}
        </div>
        {/* Close main-input relative wrapper (anchors history / @-mention menus) */}
        </div>
      </div>
    </fieldset>
  );
});
