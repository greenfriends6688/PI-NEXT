"use client";

import React, { useRef, useState, useCallback, useEffect, useLayoutEffect, useImperativeHandle, forwardRef, KeyboardEvent, useSyncExternalStore, type CSSProperties } from "react";
import type { BuiltinSlashCommandResult, CompactResultInfo, QueuedMessages, SlashCommandInfo } from "@/hooks/useAgentSession";
import type { SkillsResponse } from "@/lib/api-types";
import type { TextContent, UserMessage } from "@/lib/types";
import type { SessionStatsInfo } from "@/lib/pi-types";
// fork:ui-stats-ring — 环浮窗的完整会话明细（原 composer 下方的统计长条内容）。
import { SessionStatsDetails } from "./SessionStatsBar";
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
// fork:proma-34-mention — 引用触发符防误触发（URL / 色值 / HTML 实体 / Markdown 标题 / 绝对路径）。
import { shouldAllowMentionTrigger } from "@/lib/mention-trigger-guard";
import { useFileIndex, useSkillNames } from "@/hooks/useProjectContext";
import { FolderIcon, getFileIcon } from "./FileIcons";
import { ImagePreview } from "./ImagePreview";
import { useIsMobile, useIsCompact, useIsLandscapeShort } from "@/hooks/useIsMobile";
import { useResizableHeight } from "@/hooks/useResizableHeight";
import { useI18n } from "@/hooks/useI18n";
import { useChatAppearance } from "@/hooks/useChatAppearance";
// fork:send-key（G6 · 上游 `5df8278` #1001）—— 发送键可配（Enter 直发 / Ctrl+Enter 才发）。
import { useEnterSendMode } from "@/hooks/useEnterSendMode";
import { ThinkingIcon } from "./ThinkingIcon";
import type { ToolPreset } from "@/lib/tool-presets";
// fork:proma-02-mode — 会话权限模式
import { PERMISSION_MODES, PERMISSION_MODE_HINT_KEYS, PERMISSION_MODE_LABEL_KEYS, type PermissionMode } from "@/lib/permission-mode";
import { ModelSelector, type ModelSelectorOption } from "./ModelSelector";
// fork:quota-chip —— 模型选择器右侧的供应商配额芯片（上游 closed PR #867）。
import {
  favoriteModelKey,
  getFavoriteModelsServerSnapshot,
  getFavoriteModelsSnapshot,
  subscribeFavoriteModels,
  toggleFavoriteModelKey,
} from "@/lib/favorite-models";
import { ComposerContextStrip } from "./ComposerContextStrip";
// fork:v5-wave-b —— 窄屏（PWA 形态）输入卡那条线上的底部面板宿主（能力面板 / 模型面板）。
import { PwaComposerSheet, PwaComposerSheetRow } from "./pwa/PwaComposerSheet";
// fork:element-picker —— 浏览器面板「拾取元素」的交接口。
import { clearBrowserPick, subscribeBrowserPick, takeBrowserPick } from "@/lib/browser-element-pick";
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

export { filterModelOptions } from "./ModelSelector";

export interface AttachedImage {
  data: string;   // base64, no prefix
  mimeType: string;
  previewUrl: string; // object URL for display
}

interface Props {
  onSend: (message: string, images?: AttachedImage[], contexts?: SelectionContext[], question?: string, sessionReferences?: SessionReference[]) => void;
  onAbort: () => void;
  onFollowUp?: (message: string, images?: AttachedImage[], contexts?: SelectionContext[], question?: string, sessionReferences?: SessionReference[]) => void;
  onPromptWithStreamingBehavior?: (message: string, behavior: "steer" | "followUp", images?: AttachedImage[], contexts?: SelectionContext[], question?: string, sessionReferences?: SessionReference[]) => void;
  isStreaming: boolean;
  /** Text-only composer without the session controls or outer spacing. */
  compact?: boolean;
  /**
   * fork:mobile-action-panel（2026-10-03）—— 窄屏「更多动作」宫格的内容。
   * 由 AppShell 组装（那些动作的实现都在那边），本组件只负责触发钮 + 浮层壳。
   * 不传 = 不渲染那枚钮，桌面形态一字不变。
   */
  actionPanel?: React.ReactNode;
  model?: { provider: string; modelId: string } | null;
  isAutoModelSelection?: boolean;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string; input?: string[] }[];
  modelError?: string | null;
  /** Diagnostics from resolving `enabledModels`, e.g. a pattern that matched nothing. */
  modelScopeWarnings?: string[];
  onModelChange?: (provider: string, modelId: string) => void;
  modelSwitching?: boolean;
  /** fork:proma-37-deferred-model —— 运行中选中的模型，已排队、下一轮生效。
   *  非空时选择器旁边挂一枚「下轮生效」芯片（.d-chipbtn accent）。 */
  pendingModel?: { provider: string; modelId: string; name: string } | null;
  /** fork:proma-37-deferred-model —— 撤销排队（纯客户端，无需通知服务端）。 */
  onCancelPendingModel?: () => void;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  /** fork:composer-speed — AI 响应期间（流式）显示的实时输出速度（估算 token/秒），
   *  空 = 不显示；停流即隐。数据在 ChatWindow 算（见那里的注释：pi 的 usage 只在
   *  消息收尾才有，所以流式中途只能按已流出的文本估算）。 */
  streamSpeed?: number | null;
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
  /** fork:queue-edit — 移至输入框：从队列摘掉这一条并把原文放回输入框。 */
  onQueueEdit?: (kind: "steer" | "followUp", index: number, expect: string) => void;
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
  /** fork:design-components — 画板 20 的上下文环（.d-ring）及其浮窗的数据源。 */
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  sessionStats?: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }; cost: number; totalMessages: number } | null;
  /** fork:ui-stats-ring — 环浮窗里的完整会话明细（原 composer 下方的统计长条内容）。 */
  statsDetails?: SessionStatsInfo | null;
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
  /**
   * fork:mobile-action-panel —— 开**图片**选择器（`accept="image/*"`）。
   *
   * 与 `fileInputRef` 那个「任意文件」输入框是两个入口，不是重复：iOS 上不带
   * `accept` 的 input 弹的是「照片图库 / 拍照 / 选取文件」三选一，而手机用户说
   * 「发张图」时想要的是直接进图库。给现有那个加 `accept` 会反过来收窄能力
   * （它就再也选不了别的文件），所以另开一个只收图片的。
   */
  openImagePicker: () => void;
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
// fork:mobile-action-panel —— 宫格浮层的宽度：`.d-pop` 本身就是 320，
// 这里显式传给 PortalDropdown（它不传就跟随触发点宽度，而触发钮只有 24）。
const ACTION_PANEL_WIDTH = 320;

const MIN_MANUAL_HEIGHT_MOBILE = 80;
const MANUAL_MAX_HEIGHT_CAP = 480;
const MANUAL_MAX_HEIGHT_FRACTION = 0.55;
// fork:ui-composer-pop — 卡片窄于此宽度就把左侧控件收进「更多控件」：
// 全量工具条（最长的模型名 + 五个控件 + 右侧组）的自然宽度约 690px。
const NARROW_CONTROLS_SHELL_WIDTH = 700;
/**
 * fix:ring-pop-always-details —— 上下文环浮窗的宽度：明细常显，所以按内容取宽，
 * 只按视口收窄。
 * fork:stats-density（用户 2026-10-06「浮窗变小点，中间空白太多」）—— 原来恒取
 * 620（三栏并排时代的宽度）。现在明细只有两节，且每一节都被 CSS 封顶在 260、
 * 标签定宽 84、值紧跟其后（`.composer-ring-details`），最宽的一行是
 * 「平均缓存命中率 97.6%」/「缓存读取 3,518,946」，两节并排约 400 就装得下。
 * 别再往下收：`minmax(180px, 1fr)` 的网格按**最小** 180 数轨道，两列要
 * 2×180+间距 = 372 的内容宽，掉到一列就变成竖着叠两节、浮窗反而更高。
 */
const RING_POP_DETAILS_WIDTH = 440;
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
 * （image / file-text / file / music / play）。芯片是 .d-chipbtn，图标走 <i data-ico>，
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
  // fork:mcp-slash —— 裸 `/mcp` 打开「设置 › MCP」（上游同款；带子命令的照常发给会话）。
  { name: "mcp", description: "chat.commandMcp", source: "builtin", availableWhileStreaming: true },
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
 * fork:design-components —— 整行直接是画板 20「流式排队」那一行：`.d-menu-row`（行盒）
 * + `.d-badge mute`（序号）+ `.d-btn sm`（两个动作）。动作常驻而不是 hover 才现，
 * 因为画板就是这么画的，键盘用户也不再需要先 hover 才看得见可点的钮。
 */
function QueuedMessageRow({
  kind,
  text,
  index,
  promoteTitle,
  removeTitle,
  editTitle,
  onRemove,
  onPromote,
  onEdit,
  onDragStart,
  onDropOn,
  dragging,
}: {
  kind: "steer" | "follow-up";
  text: string;
  index: number;
  promoteTitle: string;
  removeTitle: string;
  editTitle: string;
  onRemove: () => void;
  onPromote?: () => void;
  /** fork:queue-edit — 移至输入框（可再次编辑）。 */
  onEdit?: () => void;
  onDragStart?: () => void;
  onDropOn?: () => void;
  dragging?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div
      title={text}
      draggable={Boolean(onDragStart)}
      onDragStart={onDragStart}
      onDragOver={(event) => { if (onDropOn) event.preventDefault(); }}
      onDrop={(event) => { if (onDropOn) { event.preventDefault(); onDropOn(); } }}
      className={`d-queue-row${kind === "steer" ? " steer" : ""}`}
      // 拖动中的那一行压暗（运行时状态，不进 system.css）。
      style={{ opacity: dragging ? 0.4 : 1, cursor: onDragStart ? "grab" : "default" }}
    >
      <span className="d-grip"><i data-ico="grip-vertical" data-size="13"></i></span>
      {/* 两个队列是两块平铺的列表、没有分组标题，这一枚徽章是**唯一**能分辨
          steer / follow-up 的地方，所以走 i18n（此前直接渲染英文 kind）。
          fork:v5-frame-audit D-04 帧 C —— steer 那一档改回画板的 `.d-badge.warn`
          （`<span class="d-badge warn">steer</span>`，琥珀色）；follow-up 保持
          `.d-badge.mute`。这不是配色偏好：板上 steer 行左侧那圈发丝边就是
          `.d-queue-row.steer` 的 warning 底，徽标跟它同色，两处读数才是一件事。
          改前两档都是 mute，底色变了而徽标没变 → 一行到底该按哪档处理读不出来。 */}
      <span className={`d-badge ${kind === "steer" ? "warn" : "mute"}`}>{kind === "steer" ? t("chat.queueKindSteer") : t("chat.queueKindFollowUp")}</span>
      <span className="d-queue-t">{text}</span>
      {/* fork:queue-edit（用户 2026-10-02）—— 「移至输入框」：用户说排好队的消息
          没法再编辑。放在「立即发送」之前，两者语义不同：一个是拿回来改，一个是
          提前发。 */}
      {onEdit && (
        <button
          type="button"
          className="d-iconbtn"
          onClick={onEdit}
          title={editTitle}
          aria-label={`${editTitle} #${index + 1}`}
        >
          <i data-ico="text-cursor" data-size="13" aria-hidden="true"></i>
        </button>
      )}
      {onPromote && (
        <button
          type="button"
          className="d-iconbtn"
          onClick={onPromote}
          title={promoteTitle}
          aria-label={promoteTitle}
        >
          <i data-ico="send" data-size="13"></i>
        </button>
      )}
      <button
        type="button"
        className="d-iconbtn"
        onClick={onRemove}
        title={removeTitle}
        aria-label={`${removeTitle} #${index + 1}`}
      >
        <i data-ico="x" data-size="13"></i>
      </button>
    </div>
  );
}

/**
 * fork:v5-wave-b —— 队列行（M-03 帧 D-2 / D-3 的 `.m-queue-row`）。
 *
 * 与桌面的 `QueuedMessageRow` 同名不同形：形状换成手机那一行（抓手 + 文案 +
 * 三个动作钮，命中区走 `.m-top-btn` 的 44px）。**动作与回调完全一样**
 * —— 移至输入框 / 立即发送（提升为 steer）/ 删除，外加同一套拖放排序
 * （`onDragStart` / `onDropOn` 原样接上，手机上不另造一套排序手势）。
 * 画板上那两枚状态徽标（自动接续 / 已暂停）在本仓没有对应功能，不画。
 */
function PwaQueueRow({
  kind,
  text,
  index,
  onRemove,
  onPromote,
  onEdit,
  onDragStart,
  onDropOn,
  dragging,
}: {
  kind: "steer" | "follow-up";
  text: string;
  index: number;
  onRemove: () => void;
  onPromote?: () => void;
  onEdit?: () => void;
  onDragStart?: () => void;
  onDropOn?: () => void;
  dragging?: boolean;
}) {
  const { t } = useI18n();
  const promoteTitle = t("chat.queueSendNow");
  const removeTitle = t("chat.queueRemove");
  const editTitle = t("chat.queueEditToInput");
  return (
    <div
      title={text}
      draggable={Boolean(onDragStart)}
      onDragStart={onDragStart}
      onDragOver={(event) => { if (onDropOn) event.preventDefault(); }}
      onDrop={(event) => { if (onDropOn) { event.preventDefault(); onDropOn(); } }}
      className="m-queue-row"
      // 拖动中的那一行压暗（运行时状态，不进 system.css）。
      style={{ opacity: dragging ? 0.4 : 1, cursor: onDragStart ? "grab" : "default" }}
    >
      <span className="m-grip"><i data-ico="grip-vertical" data-size="13"></i></span>
      <span className="m-grow m-setrow-body">
        <span className="m-setrow-t">{text}</span>
        <span className="m-setrow-s">{kind === "steer" ? t("chat.queueKindSteer") : t("chat.queueKindFollowUp")}</span>
      </span>
      {onEdit && (
        <button type="button" className="m-top-btn" onClick={onEdit} title={editTitle} aria-label={`${editTitle} #${index + 1}`}>
          <i data-ico="text-cursor" data-size="15" aria-hidden="true"></i>
        </button>
      )}
      {onPromote && (
        <button type="button" className="m-top-btn" onClick={onPromote} title={promoteTitle} aria-label={promoteTitle}>
          <i data-ico="arrow-up-right" data-size="15" aria-hidden="true"></i>
        </button>
      )}
      <button type="button" className="m-top-btn" onClick={onRemove} title={removeTitle} aria-label={`${removeTitle} #${index + 1}`}>
        <i data-ico="x" data-size="15" aria-hidden="true"></i>
      </button>
    </div>
  );
}

/**
 * fork:v5-wave-b —— 浮层「从输入卡上方落下」的定位壳（M-03 帧 C / 帧 D-1 原话：
 * `bottom: calc(100% + 8px)`，与卡片留 8px 呼吸，不推走消息流）。
 * 铁律四允许内联几何定位；其余一律由 `.m-pop-float` 自己给。
 */
const PWA_POP_SHELL: CSSProperties = { bottom: "calc(100% + 8px)" };

function ModelNoticeBanner({ tone, title, body, onClose }: { tone: "error" | "warning"; title: string; body: string; onClose?: () => void }) {
  // fork:v5-wave-b —— 窄屏走 PWA 形态的通知条（画板 M-03 的 `.m-banner`，只有
  // `.warn` / `.err` 两档）：形状与桌面那条是同一件事，**内容与回调一字未改**。
  if (useIsMobile()) {
    return (
      <div
        role="alert"
        className={`m-banner ${tone === "error" ? "err" : "warn"}`}
        style={{
          // 几何定位（铁律四）：长错误正文自己滚动，不把整张卡顶出屏。
          maxHeight: 120,
          marginBottom: "var(--nx-sp-2)",
          overflowY: "auto",
        }}
      >
        <i data-ico={tone === "error" ? "circle-alert" : "triangle-alert"} data-size="14"></i>
        <div className="m-grow" style={{ minWidth: 0 }}>
          <b style={{ fontWeight: 500 }}>{title}</b>
          <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{body}</div>
        </div>
        {onClose && (
          <button type="button" className="m-iconbtn" onClick={onClose} aria-label="Dismiss" title="Dismiss">
            <i data-ico="x" data-size="13"></i>
          </button>
        )}
      </div>
    );
  }
  // fork:design-components —— 通知条 = 画板 50 的 .d-banner：error 是基态（软红底），
  // warning 走 .warn 变体。颜色不再在组件里拼三元组，语义色由 board.css 一处给出。
  return (
    <div
      role="alert"
      className={`d-banner${tone === "error" ? " err" : " warn"}`}
      style={{
        maxHeight: 120,
        marginBottom: "var(--nx-sp-2)",
        overflowY: "auto",
      }}
    >
      <i data-ico={tone === "error" ? "circle-alert" : "triangle-alert"} data-size="14"></i>
      <div className="d-grow" style={{ minWidth: 0 }}>
        <b style={{ fontWeight: 500 }}>{title}</b>
        <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{body}</div>
      </div>
      {onClose && (
        /* 关闭 = 画板 20/50 的 .d-iconbtn，不是符号字形。 */
        <button
          type="button"
          className="d-iconbtn"
          onClick={onClose}
          aria-label="Dismiss"
          title="Dismiss"
        >
          <i data-ico="x" data-size="13"></i>
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

/** fork:star-solid（用户 2026-10-06）—— 星标只有一档读法：**空心 = 未收藏、实心 = 已收藏**。
 *  原来是两枚图标（已收藏 `star` / 未收藏 `star-off`，后者是一颗**划掉**的星），三处入口
 *  （输入框触发钮 / 菜单里当前模型那枚 / 每条收藏项）都带着它，划线在长列表里读成「坏掉」。
 *  lucide 全是描边图标，没有填充变体 —— 实心由 `.fork-star.is-on > svg { fill }` 给
 *  （svg 上的 `fill="none"` 只是呈现属性，样式说算）。 */
function FavoriteStarIcon({ filled }: { filled: boolean }) {
  return (
    <i data-ico="star" data-size="14" className={filled ? "fork-star-on" : undefined}></i>
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
      {/* fork:design-components —— 触发器 = 画板 20/50 的 .d-iconbtn（22px 方钮 / hover 叠色 /
          is-on 选中），星标色继续由「已收藏」决定。 */}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("models.favorites")}
        title={t("models.favorites")}
        onClick={() => setOpen((current) => !current)}
        className={`d-iconbtn${open ? " is-on" : ""}`}
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
          className="d-pop is-open anim-popover"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            zIndex: 300,
            width: "var(--pop-w-sm)",
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          <div className="d-pop-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--s2)" }}>
            <span>{t("models.favorites")}</span>
            {currentKey && (
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={currentFavorited}
                aria-label={currentFavorited ? t("models.unfavoriteModel") : t("models.favoriteCurrent")}
                title={currentFavorited ? t("models.unfavoriteModel") : t("models.favoriteCurrent")}
                onClick={() => toggleFavoriteModelKey(currentKey)}
                className="d-iconbtn sm"
                style={{ color: currentFavorited ? "var(--accent)" : "var(--n-placeholder)", cursor: "pointer" }}
              >
                <FavoriteStarIcon filled={currentFavorited} />
              </button>
            )}
          </div>
          {entries.length === 0 ? (
            /* 空态与 / 菜单、@ 菜单同一条：.d-menu-row + .d-t-xs d-t-faint。 */
            <div className="d-menu-row d-t-xs d-t-faint">{t("models.noFavorites")}</div>
          ) : entries.map(({ key, option }) => (
            /* fork:design-components —— 行 = 画板 21 的 .d-menu-row：可用模型挂 sparkles 图标、
               下线模型按画板同一行（circle-off + 压暗）保留但不可点。 */
            <div key={key} className="d-row" style={{ opacity: option ? 1 : 0.45 }}>
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
                className="d-menu-row"
                style={{ flex: 1, minWidth: 0, cursor: option ? "pointer" : "not-allowed" }}
              >
                <i data-ico={option ? "sparkles" : "circle-off"} data-size="14"></i>
                <span className="d-grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {option?.name || option?.modelId || key.slice(key.indexOf(":") + 1)}
                </span>
              </button>
              <button
                type="button"
                className="d-iconbtn sm"
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

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({  onSend, onAbort, onFollowUp, isStreaming, model, isAutoModelSelection, modelNames, modelList, modelError, modelScopeWarnings, onModelChange, modelSwitching, pendingModel, onCancelPendingModel,
  onCompact, onAbortCompaction, isCompacting, streamSpeed, compactError, compactResult, toolPreset, onToolPresetChange,
  permissionMode, onPermissionModeChange,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  retryInfo, queuedMessages, inputHistory = [], onRecallQueue, todoSummary, currentSessionId,
  onQueueRemove, onQueueMove, onQueuePromote, onQueueEdit,
  slashCommands, slashCommandsLoading, onLoadSlashCommands,
  onBuiltinCommand,
  soundEnabled, onSoundToggle, onAudioUnlock,
  contextUsage, sessionStats, statsDetails = null,
  onPromptWithStreamingBehavior,
  draftKey,
  initialSelectionContexts,
  onLocateSelectionContext,
  onOpenSessionReference,
  cwd,
  protrusion,
  compact = false,
  actionPanel,
}: Props, ref) {
  const { t } = useI18n();
  const { fontSize } = useChatAppearance();
  const isMobile = useIsMobile();
  const enterSendMode = useEnterSendMode();
  // fork:pwa-tablet-tier — the composer's control strip is one non-wrapping row, so the
  // breakpoint that decides "inline or behind a button" has to be the tablet one, not the
  // phone one. Padding/width cosmetics below still key off `isMobile`: they are about
  // touch target size, not about whether the row fits.
  // fork:ui-composer-pop — 视口断点不够用：右栏一开，聊天列在 1440 视口下也只剩
  // ~390px，工具条的右侧组（圆环/声音/发送）被顶出卡片裁掉。折叠判据加上
  // 卡片自身的实测宽度：700px 是全量工具条的自然宽度上限（模型名最长时）。
  const viewportCompact = useIsCompact();
  // fork:pwa-landscape-composer — 横屏手机（≤1024 宽且 ≤500 高）宽度充足、高度是
  // 稀缺资源：两行控件条在 390 高里占掉 ~150px（实测 41%）。这里放行成桌面同一
  // 条单行工具条；模型芯片在横屏档允许收缩省略（fork-ui.css 同名段），长名字
  // 挤不下时收芯片而不是把行撑破。竖屏手机与平板照旧走两行。
  const landscapeShort = useIsLandscapeShort();
  const [shellNarrow, setShellNarrow] = useState(false);
  // fork:pwa-hit-slop-2（2026-10-03）—— `shellNarrow` 原来能推翻横屏档：横屏手机
  // 宽 844 看着够，但侧栏停靠后聊天列只剩 ~564，`shellNarrow` 就把它拉回两行 ——
  // 而横屏档存在的全部理由就是「高度是稀缺资源」（实测 844×390 下工具条 52px = 两行，
  // 注释里写着「两行控件条在 390 高里占掉 ~150px」）。两处都要让位给横屏档。
  const narrowControls = (viewportCompact || shellNarrow) && !landscapeShort;
  // fork:action-panel-phone-only（用户 2026-10-06）—— 「更多动作」宫格是**手机件**：
  // 电脑上那九个动作全在顶栏一行里，聊天列被右栏挤窄时它忽然冒出来等于把顶栏的入口
  // 复制一份到输入框旁边（用户原话「多出来这样一个按钮，感觉没啥用」）。而
  // `narrowControls` 回答的是另一个问题 —— 「控件条要不要收成两行」：它含
  // `shellNarrow`（容器窄），容器窄在桌面上也会发生。两件事各判各的：
  // 宫格看**形态**（useIsMobile，≤640，与 m-* 同一断点），两行布局看 narrowControls。
  // 顺带修掉一个潜在缺口：横屏手机（≤1024 宽 / ≤500 高）`narrowControls` 为 false，
  // 宫格跟着消失 → 顶栏放不下的九个动作在横屏上无处可点；改判形态后它们回来了。
  const showActionPanel = Boolean(actionPanel) && isMobile;
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
  /* fork:think-seg-scroll —— 档位尺要能横向滚动，就得先知道「能有多宽」：浮层左缘锚在
     思考芯片上，而能用的右边是**输入卡的右缘**（卡片 `overflow-x: clip`，超出即被裁
     掉 —— 那正是这一段要修的毛病）。CSS 拿不到这个距离（百分比的基准是芯片自己那
     一格），所以开层时量一次：卡右缘 − 芯片左缘 − 12 内距，封顶 420、下限 180。
     layout effect 在绘制前跑，这一次 setState 不会被人看见。 */
  const [thinkPopMaxWidth, setThinkPopMaxWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!thinkingDropdownOpen) return;
    const shell = inputShellRef.current;
    const chip = thinkingDropdownRef.current;
    if (!shell || !chip) return;
    const room = shell.getBoundingClientRect().right - chip.getBoundingClientRect().left - 12;
    setThinkPopMaxWidth(Math.max(180, Math.min(420, Math.round(room))));
    /* 能滑了就得看一眼当前档：档位多到要滑时，默认停在最左边，而选中档往往在末尾
       （max / xhigh）。`nearest` 只滚最近的可滚祖先，不会把整页带着动。 */
    const seg = chip.querySelector(".fork-think-seg");
    seg?.querySelector(".is-on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [thinkingDropdownOpen]);
  // 2026-10-03 用户裁定 —— 权限档也从「点一下循环」改成下拉（与思考档 / 工具档一致）。
  const [permissionDropdownOpen, setPermissionDropdownOpen] = useState(false);
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
  const permissionDropdownRef = useRef<HTMLDivElement>(null);
  // fork:mobile-action-panel —— 触发钮就是锚点（浮层 portal 到 body，位置由它算）。
  const [actionPanelOpen, setActionPanelOpen] = useState(false);
  const actionPanelAnchorRef = useRef<HTMLButtonElement>(null);
  const actionPanelPopRef = useRef<HTMLDivElement>(null);
  /* fork:v5-wave-b —— 窄屏的能力面板（M-03 帧 A 的 `.m-sheet`，M-01 帧 C 的第二屏）。
     手机输入卡只有一行，五项能力全部收在 `.m-cap-btn` 后面这一块面板里：
     `null` = 收着；`"root"` = 五行目录；其余四档是**目录里点进去的那一块**
     （思考 / 权限 / 工具 / 上下文占用）。模型那一行是 `<ModelSelector>` 自己
     渲染的 `.m-sheet-row`，点开是它自己的面板，所以不进这个状态。
     这里只管「现在显示哪一块」，回调仍是桌面那几个（行为零变化）。 */
  const [capSheet, setCapSheet] = useState<null | "root" | "thinking" | "permission" | "tools" | "context">(null);
  const closeCapSheet = useCallback(() => setCapSheet(null), []);
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // fork:mobile-action-panel —— 只收图片的那个入口（见 ChatInputHandle.openImagePicker）。
  const imageInputRef = useRef<HTMLInputElement>(null);
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

  /* fork:element-picker —— 浏览器面板点一个元素 → 这里变成一条 `@` 引用。
     面板在右栏 tab 里、输入框在中间，没有父子关系，所以走 `lib/browser-element-pick.ts`
     的模块级 store（与 `lib/session-unread.ts` 同形）。投递是**单次**的：取走即清，
     不会给下一个会话留下一条上一个页面点出来的元素。
     面板在已发送后仍可点，所以这里只进 strip、不动输入框文本。 */
  useEffect(() => subscribeBrowserPick(() => {
    const pick = takeBrowserPick();
    if (!pick) return;
    const context = normalizeSelectionContext({
      id: pick.id,
      text: pick.snippet,
      label: `${pick.role}「${pick.name}」`,
    });
    if (!context) return;
    setSelectionContexts((current) =>
      current.some((item) => item.id === context.id) ? current : [...current, context]);
  }), []);

  /*
   * fork:element-picker —— 换会话就丢掉**还没被消费**的那一条。
   *
   * 投递是单次的：正常情况下 `takeBrowserPick()` 在上面的订阅回调里立刻被取走，
   * 所以这里清的是**竞态** —— 用户在浏览器面板点了元素、还没切回输入框就切了会话。
   * 不清的话，那条 `@` 引用会落进新会话，而它的 `id` 里带的是**上一个会话的页面**。
   * 面板那一侧清不掉（它不知道会话变了），所以这一道必须在这儿。
   */
  useEffect(() => {
    return () => { clearBrowserPick(); };
  }, [currentSessionId]);

  // fork:ui-stats-ring —— 环浮窗支持点击圆环**钉住**（/session 命令与触屏也靠它打开）。
  const [ringPinned, setRingPinned] = useState(false);
  // fork:context-pop-portal —— 浮窗 portal 到 body 之后，CSS 的
  // `.composer-ring:hover .composer-ring-pop` 够不着它了，可见性改由状态驱动。
  const [ringHovered, setRingHovered] = useState(false);
  // fork:context-pop-portal —— 明细浮窗的宽度要跟着视口（原 inline style 是
  // `min(680px, 100vw - 48px)`）。PortalDropdown 按这个数算左缘，窄屏时不给它
  // 一个真实宽度就会把浮窗推到屏幕外。
  // fix:ring-pop-compact —— 680px 是**三栏并排**时代的宽度（信息区最小 168px × 3
  // + 间距才装得下）。默认状态下它读起来就是「一大块」：一屏宽的浮窗里三列数字
  // 铺开，而用户点环想看的往往只是「用了多少 / 花了多少」。默认收成画板 22 的
  // `.d-pop` 宽度（320），完整三节明细挂到「显示详情」后面按需展开。
  const [ringPopWidth, setRingPopWidth] = useState(RING_POP_DETAILS_WIDTH);
  useEffect(() => {
    // fix:ring-pop-always-details —— 明细常显，所以宽度恒取「三节并排」那一档（620），
    // 只按视口收窄。原来分 320 / 620 两档，是为了配合「显示详情」的折叠。
    const fit = () => setRingPopWidth(Math.min(RING_POP_DETAILS_WIDTH, Math.max(240, window.innerWidth - 24)));
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
    openImagePicker() {
      imageInputRef.current?.click();
    },
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
    // fork:proma-34-mention —— `/usr/bin` 这类绝对路径不弹命令菜单（规则见 lib/mention-trigger-guard.ts）。
    && shouldAllowMentionTrigger({ text: value, triggerOffset: 0, trigger: "/" })
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

  // 2026-10-02 用户裁定 —— 流式中发送只有一条路：**排队**（followUp）。原来还要在
  // 「引导（打断当前轮）/ 后续消息（跑完再发）」之间二选一，那两个按钮已删。
  // 需要立刻打断时走队列面板里那条「立即发送（提升为引导消息）」，它经服务端的
  // `queue_promote` 命令生效，不经过这里。
  const sendQueued = useCallback(() => {
    const question = value.trim();
    if (!question && !attachedImages.length) return;
    // fork:send-stop-one-slot —— 空闲态不该走这条路。`handleSend` 自己有
    // `if (isStreaming) return`（:1924），`sendQueued` 原来没有，于是任何在空闲时
    // 调到它的调用者都会被塞进 followUp 队列（而不是发出去）。按钮侧现在有守卫
    // （只有运行中才渲染 ↑ 并绑 sendQueued），这里补上服务端语义那一半，
    // 让「谁在什么时候调它」都收敛到同一条判据。
    if (!isStreaming) {
      handleSend();
      return;
    }
    const contexts = selectionContextsRef.current;
    const references = sessionReferencesRef.current;
    const msg = serializeComposerMessage(question, contexts, t("chat.quoteIntro"), references);
    onAudioUnlock?.();
    if (!attachedImages.length && onBuiltinCommand && canRunBuiltinSlashCommandWhileStreaming(msg)) {
      void runBuiltinCommand(msg);
      return;
    }
    if (msg.startsWith("/") && onPromptWithStreamingBehavior) {
      clearInput();
      onPromptWithStreamingBehavior(msg, "followUp", attachedImages.length ? attachedImages : undefined, contexts, question, references);
      return;
    }
    clearInput();
    onFollowUp?.(msg, attachedImages.length ? attachedImages : undefined, contexts, question, references);
  }, [value, attachedImages, isStreaming, handleSend, onBuiltinCommand, onPromptWithStreamingBehavior, onFollowUp, clearInput, onAudioUnlock, runBuiltinCommand, t]);

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
      // fork:send-key（G6）—— 两个不同的意图拆成两个量：
      //   sendShortcut     = 「发送」：Enter 直发（默认）或 Ctrl/Cmd+Enter 才发（设置里切）。
      //   acceptShortcut   = 「当前 Enter 是确认键」：桌面键盘上两个模式都是纯 Enter ——
      //                     弹层菜单与 IME 守卫都要它（上游 #1001 的修复：Ctrl+Enter 模式下
      //                     菜单不再吃掉 Enter 去换行）；手机键盘的 Enter 是换行键，
      //                     所以那里仍取 sendShortcut（Ctrl/Cmd+Enter）。
      const enterKey = e.key === "Enter" && !e.shiftKey;
      const sendShortcut = isMobile || enterSendMode === "ctrlEnter"
        ? enterKey && (e.ctrlKey || e.metaKey)
        : enterKey;
      const acceptShortcut = isMobile ? sendShortcut : enterKey;
      const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
      const isComposing =
        isComposingRef.current ||
        nativeEvent.isComposing ||
        nativeEvent.keyCode === 229;

      if (acceptShortcut && (isComposing || recentlyComposed)) {
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
        if ((e.key === "Tab" || acceptShortcut) && inputHistory[historyActiveIndex]) {
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
        if (acceptShortcut && selectedCommand) {
          e.preventDefault();
          const canSubmitNow = !isStreaming
            || (selectedCommand.source === "builtin" && selectedCommand.availableWhileStreaming === true);
          // fork:send-key（G6）—— Ctrl+Enter 模式下纯 Enter 是「选中这条命令」而不是
          // 直接发送，否则确认菜单的那一下就把消息发了。
          if (sendShortcut && canSubmitNow && isExactSlashCommand(value, selectedCommand)) {
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
        if ((e.key === "Tab" || acceptShortcut) && referenceItems[referenceActiveIndex]) {
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
        if ((e.key === "Tab" || acceptShortcut) && atMatches[atActiveIndex]) {
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

      // fork:markdown-continuation（G10 · 上游 `fd037e4` #884）—— Markdown 列表
      // 续行：无序列表、有序列表（序号 +1、补零）、中文顿号 `1、`、task 复选框（重置
      // `[ ]`）、引用 / 缩进 / 标记间距的组合；thematic break 与代码围栏里不续行；
      // 空项则删掉整段前缀（VS Code 行为）。没有结构前缀时返回 null，走原生换行。
      //
      // 绑在哪个键上：**换行键**。Shift+Enter 一直如此；把发送键改成 Ctrl+Enter
      // （fork:send-key）之后纯 Enter 也腾出来了，于是它也走这里 —— 这正是 G6
      // 腾出 Enter 的意义（依赖：设置里的发送键，默认档 Enter 仍然是发送）。
      //
      // `typeof` 守卫的原因：既有测试直接抽取这个回调在 VM 里执行，不会注入
      // continueMarkdownList；守卫让那些用例仍走原生行为。
      const wantsLineBreak = e.shiftKey || enterSendMode === "ctrlEnter";
      if (e.key === "Enter" && wantsLineBreak && !isComposing && !recentlyComposed
        && !sendShortcut && typeof continueMarkdownList === "function") {
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
        // 2026-10-02 用户裁定 —— 流式中发送就是排队（followUp），不再让用户选
        // 「引导」还是「后续消息」。要打断当前轮就走队列面板里的「立即发送」。
        if (isStreaming && onFollowUp) {
          sendQueued();
        } else {
          handleSend();
        }
      }
    },
    [isMobile, enterSendMode, isStreaming, onFollowUp, onAbort, slashMenuOpen, slashQuery, displayedSlashCommands, slashActiveIndex, applySlashCommand, sendQueued, handleSend, getNextSlashIndex, atMenuOpen, atQuery, atMatches, atActiveIndex, applyAtCompletion, referenceMenuOpen, referenceQuery, referenceItems, referenceActiveIndex, applyReferenceCompletion, historyMenuOpen, inputHistory, historyActiveIndex, applyHistoryInput, value]
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

  /* fork:v5-wave-n1 · D-27 帧 A / D-28 帧 C 的「翻卡」——
   * 推理档位是全系统最典型的「值被替换」位置：旧值翻下去、新值从背面翻上来，
   * 视线不用离开这块地方。DOM 逐字抄 D-28 帧 C：外壳 `.d-flap` 只包那一枚图标，
   * 两段接力 `.is-fall`（150ms）→ 换值 → `.is-rise`（230ms）→ 清场，
   * 时序与板内那段脚本一致。
   * 为什么必须清场：两段关键帧都带 `forwards`，不清场就永远停在「侧过去」那一态。
   * 减弱动效下 system.css 已把两段停成终态，所以这里连 setTimeout 都不起 ——
   * 值照常换，只是不播（不是「停在半路」）。
   * 行为零变化：档位怎么改、什么时候改、能不能改，全部还是下面那一个下拉。 */
  const [flapPhase, setFlapPhase] = useState<"" | "is-fall" | "is-rise">("");
  const prevThinkingLevelRef = useRef(thinkingLevel);
  const flapTimersRef = useRef<number[]>([]);
  useEffect(() => {
    const timers: number[] = [];
    flapTimersRef.current = timers;
    return () => {
      for (const id of timers) window.clearTimeout(id);
      timers.length = 0;
    };
  }, []);
  useEffect(() => {
    const previous = prevThinkingLevelRef.current;
    prevThinkingLevelRef.current = thinkingLevel;
    if (previous === thinkingLevel) return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    let reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      reduced = true;
    }
    if (reduced) return;
    setFlapPhase("is-fall");
    flapTimersRef.current.push(window.setTimeout(() => setFlapPhase("is-rise"), 150));
    flapTimersRef.current.push(window.setTimeout(() => setFlapPhase(""), 380));
  }, [thinkingLevel]);

  /* fork:v5-wave-n1 · D-27 帧 F / D-28 帧 C 的「标签上下交换」——
   * 权限档是「状态词变化」的位置（每次问 / 本会话内允许 / 全部自动允许）：
   * 旧标签上浮 5px 淡出、新标签从下方 5px 淡入，两个标签**必须叠在同一格里**，
   * 否则会看见框在长高（板内原话）。所以旧值绝对定位盖在仍在流内的新值上，
   * 宽度由新值撑着 —— 板里那枚写死 96px 的容器是尺寸占位，产品不写死。
   * 与 `.d-flap` 分开落在**另一个控件**上：D-28 帧 A 的判据是「被替换走位移」，
   * 而两种反馈不许同时用在同一处。
   * 减弱动效下两条动画都被停成终态，不起接力。 */
  const permissionLabel = permissionMode ? t(PERMISSION_MODE_LABEL_KEYS[permissionMode]) : "";
  const [permissionLabelOut, setPermissionLabelOut] = useState<string | null>(null);
  const prevPermissionLabelRef = useRef(permissionLabel);
  const labelSwapTimersRef = useRef<number[]>([]);
  useEffect(() => {
    const timers: number[] = [];
    labelSwapTimersRef.current = timers;
    return () => {
      for (const id of timers) window.clearTimeout(id);
      timers.length = 0;
    };
  }, []);
  useEffect(() => {
    const previous = prevPermissionLabelRef.current;
    prevPermissionLabelRef.current = permissionLabel;
    if (!permissionLabel || previous === permissionLabel) return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    let reduced = false;
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      reduced = true;
    }
    if (reduced) return;
    setPermissionLabelOut(previous);
    labelSwapTimersRef.current.push(window.setTimeout(() => setPermissionLabelOut(null), 220));
  }, [permissionLabel]);
  const rawToolPresetLabel = Object.entries(TOOL_PRESET_MAP).find(([, v]) => v === (toolPreset ?? "configured"))?.[0] ?? "configured";
  // fork:design-components —— 工具档在画板里是中文短标签（已配置 / 需审批 …），
  // 不再把内部枚举名直接印在控件上。
  const toolPresetLabel = t(`chat.toolPreset.${rawToolPresetLabel}`);
  // 上下文环的三档配色与文字（画板 20：>70% warning / >90% error）。
  const ringPercent = Math.max(0, Math.min(100, Math.round(contextUsage?.percent ?? 0)));
  // fork:v5-skin D-04 —— system.css 的 .d-ring 只有 .warn 一档（>90% 的 .bad 是缺件，
  // 已登记在汇报里）；两档都先落到 .warn，至少不误报成正常的强调色。
  const ringTier = ringPercent > 70 ? "warn" : "";
  const contextText = contextUsage?.contextWindow
    ? `${contextUsage.tokens != null ? formatTokenCount(contextUsage.tokens) : "?"} / ${formatTokenCount(contextUsage.contextWindow)}`
    : null;
  // fork:design-components —— 发送 / 停止直接使用画板 20 的 .d-send 组件
  //（board.css：28px / radius-4 / accent 底 / .stop 变 error 底 / .disabled 变中性底），
  // 结构与 20-composer.html 一字不差：<i data-ico="arrow-up|square">。
  const sendButton = (
    <button
      type="button"
      /* fork:zc-queue-2026-10-04 —— 运行中点这一枚 = **排队**（与回车同一条路）。
         原来这里死绑 `handleSend`，而它第一行就是 `if (isStreaming) return`：于是
         边跑边打字再点发送 = 静默无反应（用户报的「无法排队」）。
         鼠标这一条路以前只有回车能走，而回车不是能被看见的入口。 */
      onClick={isStreaming && onFollowUp ? sendQueued : handleSend}
      disabled={!value.trim() && !attachedImages.length}
      aria-label={isStreaming && onFollowUp ? t("chat.queuePlaceholder") : t("chat.send")}
      title={isStreaming && onFollowUp ? t("chat.queuePlaceholder") : t("chat.send")}
      className={`d-send${(value.trim() || attachedImages.length) ? "" : " disabled"}`}
      style={{ cursor: (value.trim() || attachedImages.length) ? "pointer" : "not-allowed" }}
    >
      <i data-ico="arrow-up" data-size="14"></i>
    </button>
  );
  // fork:zc-queue-2026-10-04 —— 运行中的那一枚（⏸）。
  const stopButton = (
    <button
      type="button"
      onClick={onAbort}
      title={t("chat.stopAgent")}
      aria-label={t("chat.stopAgent")}
      className="d-send stop"
      style={{ cursor: "pointer" }}
    >
      {/* fork:stop-pause-2026-10-02 —— 图标从实心方块（square）改成 ⏸：
          运行中这枚按钮的动作是「停下当前生成、对话可接着发」，方块读成「录屏停止 /
          终止会话」。用户裁定要暂停形。画板 01/20 用的是 square —— 记为分叉。 */}
      <i data-ico="pause" data-size="13"></i>
    </button>
  );
  // fork:send-stop-one-slot（用户 2026-10-05 裁定）—— **一格，不并排**。
  // 改前是 `{isStreaming ? stopButton : sendButton}`（运行中把发送钮**卸载**，只剩
  // ⏸，于是「边跑边打字再点发送」没有入口）；再改前的未提交实验 fork:zc-queue-2026-10-04
  // 把它拆成并排两枚，又多出一个位置。两者都不是画板 20 帧 B 画的形态 ——
  // 那帧的原话是「流式中 · 发送变停止，队列计数在左」，画的**就是**单格。
  //
  // 判据抄 ZCode（`packages/ui/src/v4/ConversationComposer.tsx:1135`）：
  //   // 旧 UI 状态机：streaming + 空草稿 → Stop；有草稿 → 发送键（入队）。
  //   const showStopControl = canStop && !hasDraftToSubmit;
  // 于是：跑着 + 空输入 = ⏸（中断本轮）；跑着 + 有可发内容 = ↑（点了就排队）；
  // 空闲 = ↑。**同一格，图标与动作一起换。**
  //
  // `hasDraftToSubmit` 与 ZCode 同构（那边是 7 项或）：文本 + 附件 + 代码批注 +
  // 网页元素 + pptx 引用 + 会话选区 + 待导入共享上下文。本仓对应的是前四类里
  // 实际存在的：文本、附件、选区引用（`selectionContexts`）、会话引用
  // （`sessionReferences`）—— 后两者本来就跟着 `onSend` 一起送出去，
  // 只排文本会把「只挂了引用、没打字」错判成空草稿，于是 ⏸ 盖掉那枚本该能点的 ↑。
  const hasDraftToSubmit = !!(
    value.trim()
    || attachedImages.length
    || selectionContexts.length
    || sessionReferences.length
  );
  const composerSendCluster = isStreaming && !hasDraftToSubmit ? stopButton : sendButton;
  // fork:design-components —— 上下文环 + 浮窗 = 画板 01 帧 C / 画板 20 的
  // .d-ring（三档配色）与 .d-pop + .d-menu-row 明细行。
  // 悬浮（鼠标 / 键盘焦点）才展开，不在输入框下面再放第二条横条。
  // fork:ui-stats-ring —— 浮窗内容升级为完整会话明细（原 composer 下方的
  // 统计长条已按用户裁定删除）。
  /* fork:context-pop-portal —— 环浮窗原来挂在 `.chat-input-shell.d-composer` 里，
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
        className={`d-ring${ringTier ? ` ${ringTier}` : ""}`}
        style={{ "--p": `${ringPercent}`, border: 0, padding: 0, cursor: "pointer" } as React.CSSProperties}
        aria-label={t("session.context")}
        title={t("session.context")}
        aria-expanded={ringPinned}
        onClick={() => setRingPinned((v) => !v)}
      >
        <span className="nx-sr" />
      </button>
      <PortalDropdown
        open={contextRingOpen}
        anchorRef={ringRef}
        align="right"
        width={ringPopWidth}
        panelRef={ringPopRef}
        /* fork:v5-landing —— 面板类必须给 **PortalDropdown 自己**：它才是拿得到
           `position:fixed` + 上/下锚点的那一层；之前 d-pop 挂在里面的 div 上，
           于是内层按 .d-pop 的 `position:absolute` 相对 portal 壳定位，整块掉到
           视口下沿之外（实测 316px 高的浮窗有 233px 在屏幕外 = “点不出浮窗”）。 */
        className="d-pop is-open composer-ring-pop"
      >
          {/* fork:v5-frame-audit D-04 帧 A（`m-ctx`）—— 补画板的标题行。板上这块浮窗
              第一件就是 `<div class="d-pop-title">上下文占用</div>`，产品此前没有标题：
              「上下文 12%」被塞进下面那行 `.d-row` 里，于是它与同屏另外四个浮层
              （模型 / 思考 / 权限 / 工具）不是一套。键用 `session.context`
              （板上写「上下文占用」，同一件事，三个语包都有）。 */}
          <div className="d-pop-title">{t("session.context")}</div>
          {/* fork:v5-frame-audit D-04 帧 A（`m-ctx`）—— 标题以下的内容按画板原文收进
              `.d-pop-body.d-col`（板上就是这一个盒子裹着「已用 / 进度条 / 命中率 / 费用 /
              耗时 / 分隔 / 动作」）。产品此前是把这些直接摊在 `.d-pop` 的 4px 内边距上，
              于是这块浮窗与另外四个浮层的**内边距口径**都不同（行贴着边、读数挤在角上）。
              `.d-pop-body` 的 padding 由 system.css 给，这里只补盒子与列间距。 */}
          <div className="d-pop-body d-col" style={{ gap: "var(--nx-sp-2)" }}>
          <div className="d-row">
            <span className={`d-ring${ringTier ? ` ${ringTier}` : ""}`} style={{ "--p": `${ringPercent}`, width: 18, height: 18 } as React.CSSProperties} />
            <b style={{ fontWeight: 500, fontSize: "var(--text-secondary)", color: "var(--n-strong)" }}>
              {t("session.context")} {ringPercent}%
            </b>
            <span className="d-grow" />
            {contextText && <span className="d-mono d-t-dim" style={{ fontSize: "var(--text-meta)" }}>{contextText}</span>}
          </div>
          {/* fork:v5-frame-audit D-04 帧 A（`m-ctx`）—— 补画板那一块**百分比进度条**：
              `<div class="d-bar"><i style="width:18%"></i></div>`。板上「已用 18.4k / 200k」
              下面就是它 —— 环只给形状，明细浮窗才给读数，而读数必须有一条**长度**可比的线，
              否则百分比只是一串和上下文里别处重复的字。宽度就是 `ringPercent`（与环上的
              `--p` 同一个数），不引入新数据源；`d-bar > i` 的底色由 system.css 给。 */}
          <div className="d-bar">
            <i style={{ width: `${ringPercent}%` }} />
          </div>
          {/* fix:ring-pop-always-details —— 只保留「本轮 ↑ / ↓」这一行：它是**本轮**用量，
              明细里的 Token 小节给的是会话累计（输入/输出/缓存/总计/花费/上下文），
              两者不重复。原来另外那三行（上下文 / 上下文已用 / 本会话花费）与明细重复，
              用户说的「为啥多一块」就是它们。 */}
          {sessionStats && (
            <div className="d-menu-row">
              <span className="d-grow">{t("chat.turnTokens")}</span>
              <span className="d-mono">{sessionStats.tokens.input.toLocaleString()} / {sessionStats.tokens.output.toLocaleString()}</span>
            </div>
          )}
          {statsDetails && (
            <div className="composer-ring-details">
              <SessionStatsDetails sessionStats={statsDetails} contextUsage={contextUsage ?? null} />
            </div>
          )}
          {onCompact && (
            <>
              <div className="d-sep" />
              <button
                type="button"
                onClick={isCompacting ? onAbortCompaction : onCompact}
                className="d-menu-row"
                style={{ width: "100%", color: isCompacting ? "var(--error)" : "var(--accent-text)" }}
              >
                <i data-ico={isCompacting ? "loader-circle" : "package"} data-size="14"></i>
                {isCompacting ? t("chat.compacting") : t("chat.compactContext")}
              </button>
            </>
          )}
          </div>
      </PortalDropdown>
    </span>
  ) : null;
  // 2026-10-02 用户裁定 —— 删掉「引导 / 后续消息」两个按钮。画板 20 帧 B（流式中）
  // 本来也没有它们：那一帧的右端只有「2 条排队」徽标 + 上下文环 + 停止键。
  // 现在流式中发送一律**自动排队**（见 sendQueued），不再让用户二选一；
  // 需要立刻打断时走队列面板里那条既有的「立即发送（提升为引导消息）」。

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolDropdownRef.current && !toolDropdownRef.current.contains(e.target as Node)) {
        setToolDropdownOpen(false);
      }
      if (thinkingDropdownRef.current && !thinkingDropdownRef.current.contains(e.target as Node)) {
        setThinkingDropdownOpen(false);
      }
      if (permissionDropdownRef.current && !permissionDropdownRef.current.contains(e.target as Node)) {
        setPermissionDropdownOpen(false);
      }
      // fork:mobile-action-panel —— 宫格浮层是 portal 到 body 的，
      // 所以要单独判一次（面板自己也会在格子被点时收起）。
      if (actionPanelPopRef.current && !actionPanelPopRef.current.contains(e.target as Node)
        && actionPanelAnchorRef.current && !actionPanelAnchorRef.current.contains(e.target as Node)) {
        setActionPanelOpen(false);
      }
      if (historyMenuRef.current && !historyMenuRef.current.contains(e.target as Node) && !textareaRef.current?.contains(e.target as Node)) {
        setHistoryMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    // fork:mobile-action-panel —— 这枚钮只在窄屏渲染，回到宽屏时把状态也清掉，
    // 否则下次变窄会带着一个「上次开着的浮层」出现。
    if (!showActionPanel) setActionPanelOpen(false);
  }, [showActionPanel]);

  /* ═══════════════════════════════════════════════════════════════════════════
   * fork:v5-wave-b —— 窄屏（PWA 形态）输入卡。
   *
   * DOM 原样取自 `design/v5/pwa/boards/M-03-composer-sheet.html` 与
   * `M-08-search-completion.html`：
   *   · `.m-composer-wrap` › `.m-composer` › `.m-composer-row`
   *     —— 一行结束：`+ · 输入 · 能力 · 声音 · 发送`（M-03 帧 A）；
   *   · 浮层一律 `.m-pop-float` 绝对定位在卡片**上方**（`bottom: calc(100% + 8px)`，
   *     M-03 帧 C「不是系统级下拉」）；
   *   · 队列 `.m-queue` / 附件 `.m-attachbar` 与 `.m-tray` / 能力面板 `.m-sheet`
   *     （M-03 帧 D-2 / M-01 帧 C）。
   *
   * 行为零变化：补全、队列、附件、`@` / `/` / `&#~` 菜单、键盘、模型 / 思考 /
   * 权限 / 工具浮层全部接回上面那些 state 与 handler，没有一个新状态管业务。
   * ═══════════════════════════════════════════════════════════════════════════ */

  /* 窄屏那一块整体是个函数而不是一个提前建好的元素：桌面每次渲染都去建一整棵
     `m-*` 树是白做的功，这段只在 `isMobile && !compact` 时才被调用。
     下面三组选项是能力面板要用的清单 —— 与桌面那一侧同源同算法，面板只负责摆
     `.m-sheet-row`，不碰任何业务判断。 */
  const renderPwaComposer = () => {
    const pwaThinkingLevels = THINKING_LEVELS.filter((lvl) => {
      if (!availableThinkingLevels) return true;
      if (lvl === "auto") return true;
      return availableThinkingLevels.includes(lvl);
    }).map((lvl) => {
      const mappedVal = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
      const showOriginal = mappedVal != null && mappedVal !== lvl;
      return {
        value: lvl,
        label: showOriginal ? `${mappedVal} (${lvl})` : (mappedVal ?? lvl),
        desc: t(THINKING_LEVEL_DESC_KEYS[lvl]),
        on: (thinkingLevel ?? "auto") === lvl,
      };
    });
    const pwaPermissionModes = PERMISSION_MODES.map((mode) => ({
      value: mode,
      label: t(PERMISSION_MODE_LABEL_KEYS[mode]),
      desc: t(PERMISSION_MODE_HINT_KEYS[mode]),
      on: mode === permissionMode,
    }));
    const pwaToolPresets = TOOL_PRESETS.map((lvl) => {
      const preset = TOOL_PRESET_MAP[lvl];
      let desc: string;
      if (lvl === "configured") desc = t("chat.configuredTools");
      else if (lvl === "chat-only") desc = t("chat.chatOnly");
      else if (lvl === "read-only") desc = t("chat.readOnlyTools", { count: 4 });
      else if (lvl === "default") desc = t("chat.builtInTools", { count: 4 });
      else desc = t("chat.allBuiltInTools");
      return { value: preset, label: t(`chat.toolPreset.${lvl}`), desc, on: (toolPreset ?? "configured") === preset };
    });
    const pwaQueueCount = (queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0);
    const pwaInputPlaceholder = isStreaming && onFollowUp
      ? t("chat.queuePlaceholder")
      : isStreaming ? t("chat.agentPlaceholder")
      /* fork:v5-landing —— 窄屏用短占位（M-03 帧 A 的输入胶囊是 390px 宽，
         桌面那句带「/ 与 @」的长提示会折行把胶囊撑高）。三态在前两态不变。 */
      : t("chat.messagePlaceholderPwa");

    return (
      <div
        /* `.m-composer-wrap` 在画板里是取景框内的绝对定位层（手机输入卡浮在消息流之上）；
           产品的输入卡是聊天列正常流里的最后一块，所以这里只改**定位**一项
           （铁律四：几何定位可以内联），其余（间距 / 玻璃 / 圆角 / 层级）全由类给。
           改成 relative 之后，`.m-pop-float` 的 `bottom: calc(100% + 8px)` 正好落在
           输入卡正上方 —— 「浮层从输入卡上方落下」这条纪律由这层定位兑现。 */
        className="m-composer-wrap"
        style={{ position: "relative" }}
      >
        {/* 队列 = M-03 帧 D-2：头一行写排了几条 + 召回，下面每条一行。
            动作（移至输入框 / 立即发送 / 删除 / 拖放排序）与桌面同一个回调。 */}
        {pwaQueueCount > 0 && (
          <div className="m-queue">
            <div className="m-queue-row">
              <i data-ico="layers" data-size="14"></i>
              <span className="m-grow m-t-b">{t("chat.queued", { count: pwaQueueCount })}</span>
              {onRecallQueue && (
                <button
                  type="button"
                  className="m-top-btn"
                  onClick={onRecallQueue}
                  title={t("chat.recallTitle")}
                  aria-label={t("chat.recallTitle")}
                >
                  <i data-ico="undo-2" data-size="15" aria-hidden="true"></i>
                </button>
              )}
            </div>
            {(queuedMessages?.steering ?? []).map((text, i) => (
              <PwaQueueRow
                key={`steer-${i}`}
                kind="steer"
                text={text}
                index={i}
                dragging={draggingQueue?.kind === "steer" && draggingQueue.index === i}
                onRemove={() => onQueueRemove?.("steer", i, text)}
                onEdit={onQueueEdit ? () => onQueueEdit("steer", i, text) : undefined}
                onDragStart={onQueueMove ? () => beginQueueDrag("steer", i) : undefined}
                onDropOn={onQueueMove ? () => {
                  const drag = draggingQueueRef.current;
                  if (!drag || drag.kind !== "steer" || drag.index === i) { endQueueDrag(); return; }
                  onQueueMove("steer", drag.index, queueDropTarget(drag.index, i), queuedMessages?.steering[drag.index] ?? "");
                  endQueueDrag();
                } : undefined}
              />
            ))}
            {(queuedMessages?.followUp ?? []).map((text, i) => (
              <PwaQueueRow
                key={`followup-${i}`}
                kind="follow-up"
                text={text}
                index={i}
                dragging={draggingQueue?.kind === "followUp" && draggingQueue.index === i}
                onRemove={() => onQueueRemove?.("followUp", i, text)}
                onEdit={onQueueEdit ? () => onQueueEdit("followUp", i, text) : undefined}
                onPromote={onQueuePromote ? () => onQueuePromote(i, text) : undefined}
                onDragStart={onQueueMove ? () => beginQueueDrag("followUp", i) : undefined}
                onDropOn={onQueueMove ? () => {
                  const drag = draggingQueueRef.current;
                  if (!drag || drag.kind !== "followUp" || drag.index === i) { endQueueDrag(); return; }
                  onQueueMove("followUp", drag.index, queueDropTarget(drag.index, i), queuedMessages?.followUp[drag.index] ?? "");
                  endQueueDrag();
                } : undefined}
              />
            ))}
          </div>
        )}

        {/* 新会话的上下文条与待办芯片（桌面走卡外的 `.d-ctxbar`，见下方桌面分支）。
            手机上没有 `.d-ctxbar` 的对应件，就落在一行 `.m-tray` 芯片里 —— 同一种 chip。 */}
        {(protrusion || (todoSummary && todoSummary.total > 0)) && (
          <div className="m-tray" style={{ marginBottom: "var(--nx-sp-2)" }}>
            {protrusion}
            {todoSummary && todoSummary.total > 0 && <TodoChip summary={todoSummary} />}
          </div>
        )}

        {/* ── 浮层：从输入卡上方落下（M-03 帧 C / 帧 D-1） ─────────────────── */}

        {/* 输入历史（↑ 召回上一条） */}
        {historyMenuOpen && inputHistory.length > 0 && (
          <div
            ref={historyMenuRef}
            className="m-pop-float is-open"
            style={{ ...PWA_POP_SHELL, maxHeight: "min(56vh, 420px)", display: "flex", flexDirection: "column" }}
          >
            <div className="m-pop-title" style={{ display: "flex", alignItems: "center", gap: "var(--nx-sp-1)" }}>
              <i data-ico="history" data-size="14"></i>
              <span className="m-grow">{t("chat.inputHistory")}</span>
            </div>
            <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
              {inputHistory.map((item, index) => {
                const active = index === historyActiveIndex;
                return (
                  <button
                    key={`${index}:${item}`}
                    ref={(node) => { historyItemRefs.current[index] = node; }}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); applyHistoryInput(item); }}
                    onMouseEnter={() => setHistoryActiveIndex(index)}
                    className={`m-sheet-row${active ? " is-on" : ""}`}
                  >
                    <span className="m-setrow-body">
                      <span className="m-setrow-t">{item}</span>
                      <span className="m-sheet-row-desc">#{index + 1}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* `/` 命令（M-03 帧 D-1 的「提命令」段；分组标题走 `.m-rowlabel`） */}
        {slashMenuOpen && slashQuery !== null && (
          <div
            ref={slashMenuRef}
            className="m-pop-float is-open"
            style={{
              ...PWA_POP_SHELL,
              maxHeight: slashMenuMaxHeight === null ? "min(62vh, 520px)" : `min(62vh, 520px, ${slashMenuMaxHeight}px)`,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* 搜索头回显前缀与已输入的名字（M-08 帧 B「前缀即分类」的同一形状）。 */}
            <div className="m-searchfield" style={{ margin: "0 0 var(--nx-sp-1)" }}>
              <i data-ico="slash" data-size="14"></i>
              <span className="m-grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {slashCommandsLoading ? t("chat.loadingCommands") : `/${slashQuery}`}
              </span>
            </div>
            <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
              {!slashCommandsLoading && filteredSlashCommands.length === 0 ? (
                <div className="m-sheet-row m-t-xs m-t-faint">{t("chat.noCommands")}</div>
              ) : (
                groupedSlashCommands.map((group) => (
                  <section key={group.source}>
                    <div className="m-rowlabel">{t(SLASH_SOURCE_GROUP_LABEL_KEYS[group.source])}</div>
                    {group.items.map(({ command, index }) => {
                      const active = index === slashActiveIndex;
                      const dormant = isDormantSkillCommand(command, skillDormancy);
                      return (
                        <button
                          key={`${command.source}:${command.name}`}
                          ref={(node) => { slashItemRefs.current[index] = node; }}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); applySlashCommand(command); }}
                          onMouseEnter={() => setSlashActiveIndex(index)}
                          className={`m-sheet-row${active ? " is-on" : ""}`}
                          title={command.description ? getSlashDescription(command, t) : undefined}
                        >
                          <i
                            data-ico={command.source === "skill" ? "box" : command.source === "prompt" ? "square-function" : "slash"}
                            data-size="16"
                            style={{ opacity: dormant ? 0.5 : 1 }}
                          ></i>
                          <span className="m-setrow-body">
                            <span className="m-setrow-t m-mono" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              /{command.name}
                            </span>
                            <span className="m-sheet-row-desc">
                              {command.description ? getSlashDescription(command, t) : ""}
                              {dormant ? ` · ${t("chat.dormant")}` : ""}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </section>
                ))
              )}
            </div>
          </div>
        )}

        {/* `&` 会话 / `#` MCP / `~` 待办 —— 外壳在 `ComposerReferenceMenu` 里，
            它自己按窄屏渲染 `.m-pop-float`。 */}
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

        {/* `@` 文件（M-03 帧 D-1 的「提文件」段） */}
        {atMenuOpen && atQuery !== null && (() => {
          const indexLoading = fileIndexLoading && (!fileIndex || fileIndex.cwd !== cwd);
          const matchCountLabel = atMatches.length === 1 ? t("chat.match") : t("chat.matches", { count: atMatches.length });
          const truncatedHint = fileIndex?.truncated && !serverResultInUse
            ? (atQuery.query ? t("chat.searchingAll") : t("chat.indexTruncated"))
            : "";
          return (
            <div
              ref={atMenuRef}
              className="m-pop-float is-open"
              style={{
                ...PWA_POP_SHELL,
                // 高度上限与桌面那一块**同一个实测契约**（`subscribeUpwardMenuMaxHeight`
                // 量的是触发点到上方可用空间）：换皮不改测量口径。
                maxHeight: atMenuMaxHeight === null
                  ? "min(48vh, 400px)"
                  : `min(48vh, 400px, ${atMenuMaxHeight}px)`,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div className="m-searchfield" style={{ margin: "0 0 var(--nx-sp-1)" }}>
                <i data-ico="search" data-size="14"></i>
                <span className="m-grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {indexLoading ? t("chat.loadingFiles") : `@${atQuery.query}`}
                </span>
              </div>
              <div className="m-pop-title">
                {indexLoading ? t("chat.loadingFiles") : t("chat.files", { label: matchCountLabel, hint: truncatedHint })}
              </div>
              <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
                {!indexLoading && atMatches.length === 0 ? (
                  <div className="m-sheet-row m-t-xs m-t-faint">
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
                        ref={(node) => { atItemRefs.current[index] = node; }}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); applyAtCompletion(entry); }}
                        onMouseEnter={() => setAtActiveIndex(index)}
                        className={`m-sheet-row${active ? " is-on" : ""}`}
                      >
                        <i data-ico={entry.isDir ? "folder" : "file-code"} data-size="16"></i>
                        <span className="m-setrow-body">
                          <span className="m-setrow-t m-mono" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {dirPrefix && <span className="m-t-xs m-t-faint">{dirPrefix}</span>}
                            {name}
                            {entry.isDir ? "/" : ""}
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          );
        })()}

        {/* 附件来源（M-01 帧 D：加号点开一块浮层，拍照 / 选图 · 从工作区挑文件）。
            产品里这两个入口是两个隐藏 input，浮层只是把它们摆出来 —— 回调没变。 */}
        {actionPanelOpen && (
          <div
                ref={actionPanelPopRef}
                className="m-pop-float is-open"
                /* 高度上限：宫格最多九格再加两条来源行，窄屏要能滚。 */
                style={{ ...PWA_POP_SHELL, maxHeight: "min(60vh, 420px)", overflowY: "auto" }}
              >
            <button
              type="button"
              className="m-menu-row"
              onClick={() => { setActionPanelOpen(false); imageInputRef.current?.click(); }}
            >
              <i data-ico="image" data-size="16"></i>
              {t("chat.sendImage")}
            </button>
            <button
              type="button"
              className="m-menu-row"
              onClick={() => { setActionPanelOpen(false); fileInputRef.current?.click(); }}
            >
              <i data-ico="folder-open" data-size="16"></i>
              {t("chat.attachFile")}
            </button>
            {/* 已挑进来的文件：画板 M-02 帧 B 的附件网格（`m-attach-grid` › `m-attach`
                ＋末格恒为 `m-attach.add`，占位本身就是一个动作）。接的是真实数据
                `referenceAttachments`（名字 + `attachmentChipIcon(kind)`）；
                末格是 M-11 帧 C 规格表里的 **56 档**（附件钮 / 图标网格单元）。 */}
            {referenceAttachments.length > 0 && (
              <>
                <div className="m-sep" />
                <div className="m-attach-grid">
                  {referenceAttachments.map((chip) => (
                    <div key={chip.path} className="m-attach" title={chip.path}>
                      <i data-ico={attachmentChipIcon(chip.kind)} data-size="18" aria-hidden="true"></i>
                      <span>{chip.name}</span>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="m-attach add m-touch-56"
                    onClick={() => { setActionPanelOpen(false); fileInputRef.current?.click(); }}
                  >
                    <i data-ico="plus" data-size="18" aria-hidden="true"></i>
                    <span>{t("chat.attachFile")}</span>
                  </button>
                </div>
              </>
            )}
            {actionPanel && <div className="m-sep" />}
            {actionPanel}
          </div>
        )}

        {/* 附件落盘结果：每次拖入都有可见交代（与桌面同一个数据源）。 */}
        {attachmentNotice && (
          <div role="status" aria-live="polite" className="m-banner" style={{ marginBottom: "var(--nx-sp-2)" }}>
            <i data-ico="info" data-size="14"></i>
            <div className="m-grow" style={{ display: "grid", gap: "var(--nx-sp-1)", minWidth: 0 }}>
              {attachmentNotice.added.length > 0 && (
                <span>{t("chat.attachmentAdded", { names: attachmentNotice.added.join("、") })}</span>
              )}
              {attachmentNotice.skipped.length > 0 && (
                <span style={{ color: "var(--nx-warning)" }}>
                  {t("chat.attachmentSkipped", {
                    limit: Math.round(MAX_ATTACHED_FILE_BYTES / (1024 * 1024)),
                    names: attachmentNotice.skipped.map((entry) => entry.name).join("、"),
                  })}
                </span>
              )}
              {attachmentNotice.failed.length > 0 && (
                <span style={{ color: "var(--nx-danger)" }}>
                  {t("chat.attachmentFailed", { names: attachmentNotice.failed.join("、") })}
                </span>
              )}
            </div>
            <button
              type="button"
              className="m-iconbtn"
              onClick={() => setAttachmentNotice(null)}
              aria-label={t("chat.close")}
              title={t("chat.close")}
              style={{ alignSelf: "flex-start" }}
            >
              <i data-ico="x" data-size="12"></i>
            </button>
          </div>
        )}

        {/* ── 输入卡本体（M-03 帧 A：一行结束） ─────────────────────────────── */}
        {/* fork:v5-landing-close —— 运行中挂 `.m-loader` 光带（画板 M-03 帧 D-1，
            与桌面 D-27 帧 B 同构）：此前窄屏运行中只有队列 + ⏸，卡片本身不亮。
            结构与桌面那条 `.d-loader` 逐字同构（glow 一层 + 一条 pathLength=100 的
            闭环 path），只有类名与圆角按 PWA 令牌走（--nx-r-xl = 24px）。
            SVG 的 viewBox 只是几何占位：`.m-loader-svg` 自己算尺寸 +
            preserveAspectRatio 把 path 拉满卡片边，pathLength=100 让 dashoffset
            走 -100 正好绕一圈（端点速度恒定、拐角也不变速）。 */}
        <div className={`m-composer${isStreaming ? " m-loader" : ""}`}>
          {isStreaming && (
            <>
              <div className="m-loader-glow"></div>
              <svg className="m-loader-svg" viewBox="0 0 366 96" preserveAspectRatio="none" aria-hidden="true">
                <path pathLength="100" d="M24,2 H342 A22,22 0 0 1 364,24 V72 A22,22 0 0 1 342,94 H24 A22,22 0 0 1 2,72 V24 A22,22 0 0 1 24,2 Z" />
              </svg>
            </>
          )}
          {/* 附件托盘（M-03 帧 D-2）：图片走 `.m-attachbar` 横滚，
              非图片附件走同一条 `.m-tray` 芯片行 —— 都是「卡片内横滚、不撑高卡片」。 */}
          {attachedImages.length > 0 && (
            <div className="m-attachbar">
              {attachedImages.map((img, i) => (
                <span key={i} className="m-attachbtn" style={{ position: "relative" }}>
                  <ImagePreview key={img.previewUrl} src={img.previewUrl}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.previewUrl}
                      alt=""
                      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "var(--nx-r-sm)", display: "block" }}
                    />
                  </ImagePreview>
                  <button
                    type="button"
                    className="m-iconbtn"
                    onClick={() => removeImage(i)}
                    title={t("chat.removeAttachment")}
                    aria-label={t("chat.removeAttachment")}
                    style={{ position: "absolute", top: -8, right: -8 }}
                  >
                    <i data-ico="x" data-size="12"></i>
                  </button>
                </span>
              ))}
            </div>
          )}
          {referenceAttachments.length > 0 && (
            <div className="m-tray">
              {referenceAttachments.map((chip) => (
                <span
                  key={chip.path}
                  className="m-tray-chip"
                  data-mention-previewable={chip.kind === "image" ? "true" : undefined}
                  style={{ paddingRight: 4 }}
                >
                  <AttachmentPreview
                    name={chip.name}
                    kind={chip.kind}
                    src={attachmentPreviewUrl(chip.path)}
                    previewSrc={chip.kind === "docx" ? attachmentPreviewUrl(chip.path, "preview") : undefined}
                    style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}
                  >
                    <i data-ico={attachmentChipIcon(chip.kind)} data-size="14"></i>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chip.name}</span>
                  </AttachmentPreview>
                  <button
                    type="button"
                    className="m-iconbtn"
                    onClick={() => removeReferenceAttachment(chip.path)}
                    title={t("chat.removeAttachment")}
                    aria-label={t("chat.removeAttachment")}
                  >
                    <i data-ico="x" data-size="12"></i>
                  </button>
                </span>
              ))}
            </div>
          )}
          {/* 引用芯片（选区 / 会话）：`ComposerContextStrip` 自己按窄屏渲染 `.m-tray` 芯片。 */}
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

          <div className="m-composer-row">
            {/* 附件来源（M-01 帧 D）：加号点开上面那块浮层，锚点就是它自己。 */}
            <button
              ref={actionPanelAnchorRef}
              type="button"
              className="m-composer-plus"
              onClick={() => setActionPanelOpen((open) => !open)}
              aria-expanded={actionPanelOpen}
              title={t("chat.attachFile")}
              aria-label={t("chat.attachFile")}
            >
              <i data-ico="plus" data-size="19"></i>
            </button>

            {/* 输入区：M-03 帧 A 的 `.m-input`。高亮 overlay（D2-PR-12）与透明
                textarea 共用一个内容盒，所以这一层包裹与桌面完全一致 —— 那是行为，
                不是形态。 */}
            <div className="chat-input-highlight-wrap" style={{ position: "relative", flex: 1, minWidth: 0, display: "flex" }}>
              <div ref={highlightViewportRef} className="chat-input-highlight-viewport" aria-hidden="true">
                <div ref={highlightLayerRef} className="chat-input-highlight">
                  {highlightSegments.map((segment, i) =>
                    segment.type === "text" || !segment.token.valid ? (
                      segment.text
                    ) : (
                      // fork:v5-landing-close —— 窄屏高亮 token 挂 `.m-mention`
                      // （PWA 库里已有），此前沿用桌面 `.d-mention`。
                      <span key={i} className="m-mention">{segment.text}</span>
                    )
                  )}
                </div>
              </div>
              <textarea
                ref={textareaRef}
                className="chat-input-textarea m-input"
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
                placeholder={pwaInputPlaceholder}
                rows={1}
                style={{
                  flex: 1,
                  minWidth: 0,
                  width: "100%",
                  background: "none",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  color: "transparent",
                  caretColor: "var(--text)",
                  position: "relative",
                  /* fork:composer-input-center（2026-10-06 用户反馈「发消息」没跟别的
                     控件在一排）—— 这里原来写的是 `padding: 0`，内联压过库里
                     `.m-composer-wrap .m-input` 的 `padding: 8px 4px`。那一格正是把
                     单行文字在 44px 触控行里居中用的（8 + 25.6 + 8 ≈ 44），
                     被清零后字就贴在盒顶，比加号/发送钮高出一截。
                     这一块 JSX 本来就是 PWA 分支（桌面那条在另一处），所以直接删掉。 */
                  fontSize: "var(--chat-content-font-size, 13px)",
                  lineHeight: 1.6,
                  fontFamily: "inherit",
                  // 高度**不**在这里定：`.m-composer-wrap .m-input` 给的是 M-03 那一档
                  // （最小 44px 触控行 / 上限 110px）。桌面那一行的 24/200 是
                  // `.d-composer-top` 的内边距配出来的，搬过来会把输入行压扁。
                  overflow: "auto",
                }}
              />
            </div>

            {/* 能力入口（M-03 帧 A 的 `.m-cap-btn`）：模型 / 思考强度 / 权限 /
                工具与上下文 / 上下文占用全在它后面那块面板里。 */}
            <button
              type="button"
              className="m-cap-btn"
              onClick={() => setCapSheet((current) => (current === null ? "root" : null))}
              aria-expanded={capSheet !== null}
              /* 文案走 `common.settings`：那条已拆掉的「⋯ 覆盖式工具条」的标题键
                 （AppShell.mobile-toolbar 的守卫盯着它不许回来）。 */
              title={t("common.settings")}
              aria-label={t("common.settings")}
            >
              <i data-ico="sliders-horizontal" data-size="17"></i>
            </button>

            {/* 完成提示音（M-03 帧 A 的 `.m-iconbtn`） */}
            {onSoundToggle !== undefined && (
              <button
                type="button"
                onClick={onSoundToggle}
                title={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
                aria-label={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
                className="m-iconbtn"
              >
                <i data-ico={soundEnabled ? "volume-2" : "volume-x"} data-size="17"></i>
              </button>
            )}

            {/* 发送 / 停止：同一个钮的两种含义（M-03 帧 D-3）。判据与桌面同一个
                `hasDraftToSubmit`：跑着 + 空草稿 = ⏸，跑着 + 有可发内容 = ↑（点了排队）。 */}
            {isStreaming && !hasDraftToSubmit ? (
              <button
                type="button"
                onClick={onAbort}
                title={t("chat.stopAgent")}
                aria-label={t("chat.stopAgent")}
                className="m-send stop"
              >
                <i data-ico="pause" data-size="16"></i>
              </button>
            ) : (
              <button
                type="button"
                onClick={isStreaming && onFollowUp ? sendQueued : handleSend}
                disabled={!value.trim() && !attachedImages.length}
                aria-label={isStreaming && onFollowUp ? t("chat.queuePlaceholder") : t("chat.send")}
                title={isStreaming && onFollowUp ? t("chat.queuePlaceholder") : t("chat.send")}
                className="m-send"
              >
                <i data-ico="arrow-up" data-size="18"></i>
              </button>
            )}
          </div>
        </div>

        {/* ── 能力面板（M-01 帧 C / M-03 帧 A）：五项能力一块面板 ───────────── */}
        <PwaComposerSheet
          open={capSheet !== null}
          title={capSheet === "thinking"
            ? t("chat.thinkingTitle")
            : capSheet === "permission"
              ? t("chat.permissionTitle")
              : capSheet === "tools"
                ? t("tools.label")
                : capSheet === "context"
                  ? t("session.context")
                  : t("common.settings")}
          onClose={closeCapSheet}
        >
          {capSheet === "root" && (
            <>
              {/* fork:v5-frame-audit —— 画板 M-03 帧 A / M-01 帧 C：五项能力上方
                  一行 `.m-group-title`（原来这块直接开第一行，少了这一层）。 */}
              <div className="m-group-title">{t("chat.capSheetGroupTitle")}</div>
              {/* 模型那一行就是桌面工具条里的同一个 `<ModelSelector>`：窄屏时它自己
                  渲染成 `.m-sheet-row`，点开是 M-01 帧 C 的模型面板。
                  点这一行时先把能力面板收掉：两块面板都是 portal 的底部面板，
                  同时开着会让一次 Esc 把两层一起关掉（两层各自一份捕获阶段的
                  监听，stopPropagation 拦不住同一个 document 上的另一份）。 */}
              {(modelOptions.length > 0 || model || modelError) && onModelChange && (
                <span onClick={() => setCapSheet(null)}>
                  <ModelSelector
                    options={modelOptions}
                    value={model}
                    onChange={onModelChange}
                    busy={modelSwitching}
                    isAutoSelection={isAutoModelSelection}
                  />
                </span>
              )}
              {/* 「已排队，下轮生效」：与桌面同一枚提示，同一个撤销回调。 */}
              {pendingModel && (
                <button
                  type="button"
                  className="m-tray-chip is-on"
                  style={{ margin: "0 6px 8px" }}
                  title={`${t("chat.modelQueuedNextTurnTitle", { model: pendingModel.name })} — ${t("chat.modelQueuedNextTurnCancel")}`}
                  onClick={onCancelPendingModel}
                >
                  <i data-ico="clock" data-size="12"></i>
                  {t("chat.modelQueuedNextTurn", { model: pendingModel.name })}
                </button>
              )}
              {onThinkingLevelChange && (
                <PwaComposerSheetRow
                  icon="brain"
                  descClass="m-setrow-s"
                  title={t("chat.thinkingTitle")}
                  desc={thinkingDisplayLabel}
                  trailing={<i data-ico="chevron-right" data-size="14" aria-hidden="true" />}
                  onClick={() => setCapSheet("thinking")}
                />
              )}
              {onPermissionModeChange && permissionMode && toolPreset !== "none" && (
                <PwaComposerSheetRow
                  icon={permissionMode === "bypass" ? "shield" : permissionMode === "ask" ? "shield-check" : "book-marked"}
                  descClass="m-setrow-s"
                  title={t("chat.permissionTitle")}
                  desc={t(PERMISSION_MODE_LABEL_KEYS[permissionMode])}
                  trailing={<i data-ico="chevron-right" data-size="14" aria-hidden="true" />}
                  onClick={() => setCapSheet("permission")}
                />
              )}
              {!isStreaming && onToolPresetChange && (
                <PwaComposerSheetRow
                  icon="wrench"
                  descClass="m-setrow-s"
                  title={t("tools.label")}
                  desc={toolPresetLabel}
                  trailing={<i data-ico="chevron-right" data-size="14" aria-hidden="true" />}
                  onClick={() => setCapSheet("tools")}
                />
              )}
              {(contextUsage || sessionStats) && (
                <PwaComposerSheetRow
                  /* fork:v5-frame-audit —— 画板把 `.m-ring` 放在**行首**（图标位），
                     产品原来挂在 trailing 里跟着 chevron 走，位置与板子不一致。 */
                  leading={(
                    <span className="m-ring" style={{ "--p": `${ringPercent}` } as React.CSSProperties} />
                  )}
                  descClass="m-setrow-s"
                  title={t("session.context")}
                  desc={contextText ?? `${ringPercent}%`}
                  trailing={<i data-ico="chevron-right" data-size="14" aria-hidden="true" />}
                  onClick={() => setCapSheet("context")}
                />
              )}
              {/* fork:v5-frame-audit —— 画板 M-03 帧 A 面板末尾的 `.m-sheet-foot`：
                  「五项只影响这一轮」这句不写，用户会以为改完就写进会话设置了。 */}
              <div className="m-sheet-foot">{t("chat.capSheetFootNote")}</div>
            </>
          )}

          {/* 三档清单：互斥单选，行尾挂画板的 `.m-radio`（M-01 帧 C 的模型 / 能力两栏、
              M-05 帧 C 的权限三档、M-09 帧 A 的插件权限都是这个形态）——
              `.is-on` 的 ✓ 与 `.m-radio` 是同一件事的两种说法，板上不共存，所以由
              `radio` 这一支决定只说一种。 */}
          {capSheet === "thinking" && pwaThinkingLevels.map((level) => (
            <PwaComposerSheetRow
              key={level.value}
              title={level.label}
              desc={level.desc}
              on={level.on}
              radio
              onClick={() => {
                if (!level.on) onThinkingLevelChange?.(level.value);
                closeCapSheet();
              }}
            />
          ))}

          {capSheet === "permission" && pwaPermissionModes.map((mode) => (
            <PwaComposerSheetRow
              key={mode.value}
                title={mode.label}
              desc={mode.desc}
              on={mode.on}
              radio
              onClick={() => {
                if (!mode.on) onPermissionModeChange?.(mode.value);
                closeCapSheet();
              }}
            />
          ))}

          {capSheet === "tools" && pwaToolPresets.map((preset) => (
            <PwaComposerSheetRow
              key={preset.value}
                title={preset.label}
              desc={preset.desc}
              on={preset.on}
              radio
              onClick={() => {
                if (!preset.on) onToolPresetChange?.(preset.value);
                closeCapSheet();
              }}
            />
          ))}

          {/* 上下文占用：桌面是环 + portal 浮窗，手机上这块面板本身就在卡片上方，
              于是明细直接铺在面板里（`.m-setrow` 行），不再套一层浮窗。 */}
          {capSheet === "context" && (
            <>
              <div className="m-ctx" style={{ padding: "var(--nx-sp-2) var(--nx-sp-3)" }}>
                <span className="m-ring" style={{ "--p": `${ringPercent}` } as React.CSSProperties} />
                <span className="m-grow">{t("session.context")} {ringPercent}%</span>
                {contextText && <span>{contextText}</span>}
              </div>
              {sessionStats && (
                <div className="m-sheet-row">
                  <span className="m-grow">{t("chat.turnTokens")}</span>
                  <span className="m-mono">{sessionStats.tokens.input.toLocaleString()} / {sessionStats.tokens.output.toLocaleString()}</span>
                </div>
              )}
              {statsDetails && <SessionStatsDetails sessionStats={statsDetails} contextUsage={contextUsage ?? null} />}
              {/* 已引用的文件：画板 M-02 帧 C 的 `.m-cites`（`.m-cite` 是**只读**的文件名
                  芯片，与托盘里的动作芯片 `.m-tray-chip` 分工不同）。接的是真实数据
                  `referenceAttachments`；`is-on` = 这个名字此刻还写在输入框里（真的“命中”），
                  删掉提及但附件还在时落回描边圆 —— 两种态都在 M-02 帧 C 上画着。 */}
              {referenceAttachments.length > 0 && (
                <div className="m-cites">
                  {referenceAttachments.map((chip) => {
                    const cited = value.includes(chip.name);
                    return (
                      <span
                        key={chip.path}
                        className={`m-cite${cited ? " is-on" : ""}`}
                        title={chip.path}
                      >
                        <i data-ico={cited ? "circle-dot" : "circle"} data-size="12" aria-hidden="true" />
                        {chip.name}
                      </span>
                    );
                  })}
                </div>
              )}
              {onCompact && (
                <>
                  <div className="m-sep" />
                  <button
                    type="button"
                    onClick={isCompacting ? onAbortCompaction : onCompact}
                    className="m-menu-row"
                    style={{ color: isCompacting ? "var(--nx-danger)" : "var(--nx-accent)" }}
                  >
                    <i data-ico={isCompacting ? "loader-circle" : "package"} data-size="16"></i>
                    <span className="m-grow">{isCompacting ? t("chat.compacting") : t("chat.compactContext")}</span>
                  </button>
                </>
              )}
            </>
          )}
        </PwaComposerSheet>
      </div>
    );
  };

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
        /* 横向内距**只归一处**：窄屏是 `.m-composer-wrap` 的 `0 12px 12px`
           （画板 M-01/M-02/M-04 每一帧），这里必须 0；桌面是本层的 `0 16px 8px`，
           因为桌面那条 wrap 不带内距。两处都写就成 12+16=28px，输入卡两侧各空一截。 */
        padding: compact || isMobile ? 0 : "0 16px 8px",
        paddingRight: compact || isMobile ? 0 : 16,
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
      {/* fork:mobile-action-panel —— 只收图片的第二个入口（手机「发送图片」那一格）。
          桌面不渲染：那枚格子只在窄屏出现，多挂一个 input 只是白占 DOM。 */}
      {!compact && narrowControls && <input
        ref={imageInputRef}
        type="file"
        multiple
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
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
        {/* fork:v5-wave-b —— 窄屏走 PWA 形态（`design/v5/pwa/system.css`）：通知条、队列、
            补全面板、附件托盘、能力面板与输入卡全部是 `pwaComposer` 那一块 `m-*` DOM。
            桌面那一整段原样保留在 `: (` 分支里，一个类名都没改。
            **例外**：`compact`（在当前会话里就选中的文字提问）那一小格输入框不在
            M-03 / M-08 任何一帧里，它只有一行 + 一枚发送钮，所以窄屏也继续走桌面
            那一段 —— 换皮不许顺手改形态。 */}
        {isMobile && !compact ? (
          <>
            {/* 瞬时提示 = `.m-banner`（画板 M-03 的窄屏通知条；只有 `.warn` / `.err` 两档，
                所以「压缩成功」落基态）。数据源与桌面那三行完全相同。 */}
            {retryInfo && (
              <div className="m-banner warn" style={{ marginBottom: "var(--nx-sp-2)" }}>
                <i data-ico="refresh-cw" data-size="14"></i>
                <span className="m-grow">
                  {t("chat.retrying", { attempt: retryInfo.attempt, maxAttempts: retryInfo.maxAttempts })}
                  {retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: "var(--nx-sp-1)" }}>— {retryInfo.errorMessage}</span>}
                </span>
              </div>
            )}
            {compactResultText && (
              <div className="m-banner" style={{ marginBottom: "var(--nx-sp-2)" }}>
                <i data-ico="circle-check" data-size="14"></i>
                <span className="m-grow">{compactResultText}</span>
              </div>
            )}
            {compactError && (
              <div
                role="alert"
                className="m-banner err"
                style={{
                  marginBottom: "var(--nx-sp-2)",
                  // 错误正文原样换行不断词（服务端可能回 HTML 片段），这两条不能交给组件类。
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                <i data-ico="circle-alert" data-size="14"></i>
                <span className="m-grow">{compactError}</span>
              </div>
            )}
            {renderPwaComposer()}
          </>
        ) : (
        <>
        {/* Queued steering / follow-up messages (delivered by pi on upcoming turns) */}
        {/* fork:design-components —— 队列 = 画板 20「流式排队」那一段：一行 .d-badge mute
            说明排了几条（+ 召回钮），下面每条消息一行 .d-menu-row。画板里没有外层盒子，
            所以这里也不再有自绘的描边 + 底色盒。 */}
        {((queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0)) > 0 && (
          <div className="d-queue">
            <div className="d-queue-head">
              <i data-ico="layers" data-size="14"></i>
              <span className="d-grow">
                {t("chat.queued", { count: (queuedMessages?.steering.length ?? 0) + (queuedMessages?.followUp.length ?? 0) })}
              </span>
              {onRecallQueue && (
                <button
                  type="button"
                  className="d-btn sm ghost"
                  onClick={onRecallQueue}
                  title={t("chat.recallTitle")}
                >
                  <i data-ico="undo-2" data-size="13"></i>
                  {t("chat.recall")}
                </button>
              )}
            </div>
            <div className="d-queue-body">
            {queuedMessages?.steering.map((text, i) => (
              <QueuedMessageRow
                key={`steer-${i}`}
                kind="steer"
                text={text}
                index={i}
                promoteTitle={t("chat.queueSendNow")}
                removeTitle={t("chat.queueRemove")}
                editTitle={t("chat.queueEditToInput")}
                dragging={draggingQueue?.kind === "steer" && draggingQueue.index === i}
                onRemove={() => onQueueRemove?.("steer", i, text)}
                onEdit={onQueueEdit ? () => onQueueEdit("steer", i, text) : undefined}
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
                editTitle={t("chat.queueEditToInput")}
                dragging={draggingQueue?.kind === "followUp" && draggingQueue.index === i}
                onRemove={() => onQueueRemove?.("followUp", i, text)}
                onEdit={onQueueEdit ? () => onQueueEdit("followUp", i, text) : undefined}
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
          </div>
        )}
        {/* fork:design-components —— 三条瞬时提示 = 画板 50 的 .d-banner 四态：
            重试 warn / 压缩成功 ok / 压缩失败 error（基态）。底色与文字色都由 board.css 给。 */}
        {retryInfo && (
          <div className="d-banner warn" style={{ marginBottom: "var(--nx-sp-2)" }}>
            <i data-ico="refresh-cw" data-size="14"></i>
            <span className="d-grow">
              {t("chat.retrying", { attempt: retryInfo.attempt, max: retryInfo.maxAttempts })}
              {retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: "var(--s1)" }}>— {retryInfo.errorMessage}</span>}
            </span>
          </div>
        )}
        {compactResultText && (
          <div className="d-banner ok" style={{ marginBottom: "var(--nx-sp-2)" }}>
            <i data-ico="circle-check" data-size="14"></i>
            <span className="d-grow">{compactResultText}</span>
          </div>
        )}
        {compactError && (
          <div
            role="alert"
            className="d-banner err"
            style={{
              marginBottom: "var(--nx-sp-2)",
              // 错误正文原样换行不断词（服务端可能回 HTML 片段），这两条不能交给组件类。
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            <i data-ico="circle-alert" data-size="14"></i>
            <span className="d-grow">{compactError}</span>
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
        {/* fork:ui-todo —— 待办芯片不再挂在卡内：阅读态塌陷时输入卡 `padding:0` 且
            去掉边框与圆角，卡内芯片会与下方那个可见的输入框错开一条边（实测左缘差
            16px，看起来像飞出卡片外）。现在它走**卡外**的 .d-ctxbar（见下方），
            与 .d-composer 同宽同居中，左缘必然对齐。 */}
        {/* Main input · fork:composer-chips-align（2026-10-06 用户反馈「上传的图片左边应该和输入框
            左边平齐，左侧咋超出这么多」）—— 附件芯片原来渲染在 `.d-composer-wrap`
            **之外**，而卡片 `.d-composer` 在 wrap 之内、wrap 自带 `padding: 0 32px`
            （`design/v5/web/system.css`），于是芯片左缘比卡片左缘多出整整 32px。
            现在两条芯片搬进 wrap 开头：与 `.d-composer` 同一个左缘。 */}
        <div className="d-composer-wrap" style={{ minWidth: 0 }}>
        {/* 附件区 = 画板 20「附件与引用」A 帧：一条 .d-chips，
            文件是 .d-chipbtn（类型图标 + 文件名 + 芯片内 data-ico="x" 移除钮）。
            图片保留 56px 缩略图（画板没画缩略图形态，而 ChatInput 的既有测试要求
            草稿图片必须渲染出 <img>），但它的行与移除钮同样由画板基件承载。 */}
        {attachedImages.length > 0 && (
          <div className="d-chips">
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
                  className="d-iconbtn sm composer-thumb-remove"
                  onClick={() => removeImage(i)}
                  title={t("chat.removeAttachment")}
                  aria-label={t("chat.removeAttachment")}
                  style={{ position: "absolute", top: -6, right: -6 }}
                >
                  <i data-ico="x" data-size="12"></i>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* fork:zc-08 — 非图片附件的 chips：点开按类型预览（PDF/DOCX/音视频/文本），
            X 移除时同步清掉输入框里的 `@文件名`。 */}
        {referenceAttachments.length > 0 && (
          <div className="d-chips">
            {referenceAttachments.map((chip) => (
              /* 芯片本身是静态盒（画板 20 的 .d-chipbtn 就是 span）：里面的预览触发器是
                 AttachmentPreview 自己渲染的 button，移除钮是芯片末尾的 .d-iconbtn。 */
              <span key={chip.path} className="d-chipbtn" data-mention-previewable={chip.kind === "image" ? "true" : undefined} style={{ maxWidth: 220 }}>
                <AttachmentPreview
                  name={chip.name}
                  kind={chip.kind}
                  src={attachmentPreviewUrl(chip.path)}
                  previewSrc={chip.kind === "docx" ? attachmentPreviewUrl(chip.path, "preview") : undefined}
                  style={{ flex: 1, minWidth: 0, overflow: "hidden", textAlign: "left" }}
                >
                  <i data-ico={attachmentChipIcon(chip.kind)} data-size="12"></i>
                  <span className="d-grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chip.name}</span>
                </AttachmentPreview>
                <button
                  type="button"
                  className="d-iconbtn"
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

          {historyMenuOpen && inputHistory.length > 0 && (
            <div
              ref={historyMenuRef}
              className="d-pop is-open anim-popover"
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
              {/* fork:design-components —— 浮窗 = 画板 21：.d-pop 壳 + .d-pop-title 头
                  （history 图标 + 标题）+ .d-menu-row 行（当前项 is-on）。滚动区改成
                  「flex 1 + overflow」的列，不再靠减一个魔数高度。 */}
              <div className="d-pop-title" style={{ display: "flex", alignItems: "center", gap: "var(--s2)", flexShrink: 0 }}>
                <i data-ico="history" data-size="14"></i>
                <span className="d-grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
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
                      className={`d-menu-row${active ? " is-on" : ""}`}
                      style={{ alignItems: "flex-start", cursor: "pointer" }}
                    >
                      <span className="d-badge mute">{index + 1}</span>
                      <span className="d-grow" style={{ minWidth: 0, display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden", overflowWrap: "anywhere" }}>
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
              className="d-pop is-open anim-popover"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: "calc(100% + 8px)",
                zIndex: 120,
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                // fork:ui-slash-pop —— .d-pop 在 board.css 里写死了 width:320px，
                // 但斜杠弹窗是 composer 内部的辅助面板，应当按卡片宽定上限，
                // 否则左下角命令列就被挤成单列、描述直接裁掉。
                // fix:slash-menu-wide —— 680 宽 × minmax(220px) 会排成 3 列、每列
                // 只有 ~218px：`/name` 那格带 `overflowWrap:anywhere`，稍长一点的
                // 技能命令就折成两行（用户实测「很多命令都换行了」）。放宽到 760 宽、
                // 每列下限 260，排 2 列 —— 名字与描述都能单行读完。
                width: "min(760px, calc(100vw - 24px))",
                maxWidth: "100%",
                maxHeight: slashMenuMaxHeight === null
                  ? "min(72.8vh, 598px)"
                  : `min(72.8vh, 598px, ${slashMenuMaxHeight}px)`,
              }}
            >
              {/* fork:design-components —— 搜索头 = 画板 21「/ 命令」那一行（.d-searchfield：
                  slash 图标 + 当前查询 + 分隔线）；右侧补计数徽标与 Tab/Enter 提示。 */}
              <div
                className="d-searchfield"
                style={{ borderBottom: "1px solid var(--n-border-subtle)", margin: "0 0 var(--s1)", flexShrink: 0 }}
              >
                <i data-ico="slash" data-size="14"></i>
                <span className="d-grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: "var(--n-text)" }}>
                  {slashCommandsLoading ? t("chat.loadingCommands") : `/${slashQuery}`}
                </span>
                {!slashCommandsLoading && (
                  <span className="d-badge mute" style={{ flexShrink: 0 }}>{slashCommandCountLabel}</span>
                )}
                <span className="d-kbd" style={{ flexShrink: 0 }}>{t("chat.tabEnter")}</span>
              </div>
              <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "0 4px 4px" }}>
                {!slashCommandsLoading && filteredSlashCommands.length === 0 ? (
                  <div className="d-menu-row d-t-xs d-t-faint">
                     {t("chat.noCommands")}
                  </div>
                ) : (
                  groupedSlashCommands.map((group) => (
                    <section key={group.source} style={{ marginBottom: "var(--s3)" }}>
                      {/* fork:design-system SW-02 —— 分组标题 = d-pop-title（sticky 钉顶）。 */}
                      <div
                        className="d-pop-title"
                        style={{
                          position: "sticky",
                          top: -4,
                          zIndex: 1,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "var(--s2)",
                          margin: "0 -4px",
                          padding: "4px 4px 6px",
                          background: "var(--surface-popover)",
                        }}
                      >
                           <span>{t(SLASH_SOURCE_GROUP_LABEL_KEYS[group.source])}</span>
                        <span className="d-badge mute">{group.items.length}</span>
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                          gap: "var(--s2)",
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
                              // 用户 2026-10-06 裁定：命令名独占一行、描述落到下一行（最多两行，
                              // 多余省略号）—— 同行排布时两列都要截断，技能描述（多数是长句）
                              // 只剩「将桌面应用…」，基本读不出这条命令干什么。换成画板为
                              // 「浮层里的两行行」准备的那件 `.d-pop-row`（.d-pop-row-t /
                              // .d-pop-row-s 就是标题 + 副行），不是新写一套样式。
                              className={`d-pop-row${active ? " is-on" : ""}`}
                              title={command.description ? getSlashDescription(command, t) : undefined}
                            >
                              <i
                                data-ico={command.source === "skill" ? "box" : command.source === "prompt" ? "square-function" : "slash"}
                                data-size="14"
                                style={{ flexShrink: 0, color: dormant ? "var(--n-placeholder)" : undefined }}
                              ></i>
                              <span className="d-grow d-col">
                                <span style={{ display: "flex", alignItems: "center", gap: "var(--s2)", minWidth: 0 }}>
                                  <span
                                    className="d-grow d-pop-row-t"
                                    style={{
                                      fontFamily: "var(--font-mono)",
                                      // fix:slash-menu-wide —— 命令名**不换行**：命令只有一个词，
                                      // 超出就省略号，读起来反而整齐。
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      color: dormant ? "var(--n-placeholder)" : undefined,
                                    }}
                                  >
                                    /{command.name}
                                  </span>
                                  {dormant && <span className="d-t-xs d-t-faint" style={{ flexShrink: 0 }}>{t("chat.dormant")}</span>}
                                </span>
                                {command.description && (
                                  <span
                                    className="d-pop-row-s"
                                    style={{
                                      display: "-webkit-box",
                                      WebkitBoxOrient: "vertical",
                                      WebkitLineClamp: 2,
                                      overflow: "hidden",
                                      overflowWrap: "anywhere",
                                    }}
                                  >
                                    {getSlashDescription(command, t)}
                                  </span>
                                )}
                              </span>
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
            // fork:v5-frame-audit D-04 帧 B（`m-mention`）—— 换回画板的外壳类 `d-pop-float`
            // （板上：`<div class="d-pop-float up" data-demo-pop="m-mention">`）。产品此前挂的
            // 是 `.d-pop`（按 class 算 `position: absolute`，与板上的 `fixed` 不同源），而**同一块
            // 补全区**里的 `&`/`#`/`~` 菜单（ComposerReferenceMenu）早就是 `.d-pop-float` ——
            // 于是同一个功能（打字即补全）在屏幕上挂了两套外壳类。定位不靠这个类：下面的
            // position/left/right/bottom 全是内联的，内联压过类，display:flex 同理，所以换壳
            // **不挪一个像素**，只把「这块补全区用哪件」对齐回画板。板上还带一个 `up`（向上展开），
            // system.css 只给 `.d-pop.up` 定义了位移，`d-pop-float.up` 没有对应规则 ——
            // 方向由内联几何负责，所以这里不挂那个空类。
            return (
              <div
                ref={atMenuRef}
                className="d-pop-float is-open anim-popover"
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
                {/* fork:v5-frame-audit D-04 帧 B（`m-mention`）—— 头行换成画板原文的那三件：
                    `.d-searchfield`（search 图标 + **你刚打的 token**）+ `.d-pop-body.d-t-xs.d-t-faint`
                    （结果集里有什么）+ `.d-sep`。
                    改前是一行 `.d-pop-title` 把「文件 · N 个匹配项」和 Tab/Enter 提示挤在一起 ——
                    两个问题：一是**看不到自己打了什么**（补全面板不回显查询串，命中没命中只能靠猜），
                    二是这块补全区与模型浮层、/ 命令面板的取件不一致（那两处都是 `.d-searchfield` 开头）。
                    三个键（`chat.tabEnter` / `chat.files` / 计数）都原样复用，文案与数据源不动。 */}
                <div
                  className="d-searchfield"
                  style={{ borderBottom: "1px solid var(--n-border-subtle)", margin: "0 0 var(--s1)", flexShrink: 0 }}
                >
                  <i data-ico="search" data-size="13"></i>
                  <span className="d-grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: "var(--n-text)" }}>
                    @{atQuery.query}
                  </span>
                  <span className="d-kbd" style={{ flexShrink: 0 }}>{t("chat.tabEnter")}</span>
                </div>
                <div className="d-pop-body d-t-xs d-t-faint" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {indexLoading
                     ? t("chat.loadingFiles")
                     : t("chat.files", { label: matchCountLabel, hint: truncatedHint })}
                </div>
                <div className="d-sep" />
                <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: "0 4px 4px" }}>
                  {!indexLoading && atMatches.length === 0 ? (
                    <div className="d-menu-row d-t-xs d-t-faint">
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
                          className={`d-menu-row${active ? " is-on" : ""}`}
                          style={{ width: "100%", fontFamily: "var(--font-mono)" }}
                        >
                          <span style={{ flexShrink: 0, display: "inline-flex" }}>
                            {entry.isDir ? <FolderIcon size={14} /> : getFileIcon(name, 14)}
                          </span>
                          <span className="d-grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {dirPrefix && <span className="d-t-xs d-t-faint">{dirPrefix}</span>}
                            {name}
                            {entry.isDir && <span className="d-t-xs d-t-faint">/</span>}
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
              // fork:design-components —— 落盘结果 = 画板 50 的 .d-banner info（中性底 +
              // info 字色）；行内的 warning / danger 语义色仍按结果逐行给。
              className="d-banner info"
              style={{
                // 宽度由外层 composer 容器（`--composer-max-width`）统一约束，
                // 这里不再声明自己的 maxWidth —— 上层的 ChatAppearance 测试
                // 就要求这个变量在文件里只出现一次。
                margin: "0 0 var(--nx-sp-2)",
              }}
            >
              <i data-ico="info" data-size="14"></i>
              <div className="d-grow" style={{ display: "grid", gap: "var(--space-tight)", minWidth: 0 }}>
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
                className="d-iconbtn sm"
                onClick={() => setAttachmentNotice(null)}
                aria-label={t("chat.close")}
                title={t("chat.close")}
                style={{ flexShrink: 0, alignSelf: "flex-start" }}
              >
                <i data-ico="x" data-size="12"></i>
              </button>
            </div>
          )}
          {/* fork:ui-ctxbar —— 新会话的上下文条（项目 / 分支）在输入卡**上方**：
              Codex 式的一条无铬信息条（.d-ctxbar，画板 20「新会话 · 上下文条」），
              不再是卡内顶行的一枚芯片行（.d-chips 的地盘是附件芯片）。
              阅读态塌陷（.is-compact 只剩一行）时整条不渲染：那时输入卡自己都收成
              一行了，上面再挂一条 24px 的信息行只会把「收起」这件事说反。 */}
          {protrusion && !compact && <div className="d-ctxbar">{protrusion}</div>}
          {/* fork:ui-todo —— 待办芯片与上下文条同行（同一张 .d-ctxbar）：它在卡外、与
              .d-composer 同宽（max-width 800 / margin 0 auto），所以左缘必然与输入框
              对齐（2026-10-04 用户裁定）。塌陷态不挂 —— 那时输入卡只收成一行，
              上面再挂一条信息行会把「收起」说反（同上下文条口径）。 */}
          {todoSummary && todoSummary.total > 0 && !compact && (
            <div className="d-ctxbar">
              <TodoChip summary={todoSummary} />
            </div>
          )}
          <div
            ref={inputShellRef}
            /* fork:v5-skin D-04 帧 C / D-27 帧 B —— 运行中给输入卡挂 .d-loader
               （边缘环绕光带，.d-loader-glow + .d-loader-svg）。 */
            className={`chat-input-shell d-composer${isStreaming ? " d-loader" : ""}${manualMode ? " is-manual-height" : ""}${readingCompact ? " is-compact" : ""}`}
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
              border: compact ? "none" : bashMode ? "1px solid var(--border-strong)" : isStreaming && onFollowUp
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
          {/* fork:v5-skin D-04 帧 C —— agent 在跑时输入框边缘亮起来。svg path 用
              pathLength=100，dash 走 -100 绕行一圈；这是画板点名的例外（图标仍走
              data-ico，只有这条光带是需要 pathLength 的原生 svg）。 */}
          {isStreaming && (
            <>
              <div className="d-loader-glow"></div>
              <svg className="d-loader-svg" viewBox="0 0 760 56" preserveAspectRatio="none" aria-hidden="true">
                <path pathLength="100" d="M16,2 H744 A14,14 0 0 1 758,16 V40 A14,14 0 0 1 744,54 H16 A14,14 0 0 1 2,40 V16 A14,14 0 0 1 16,2 Z" />
              </svg>
            </>
          )}
          {/* fork:pr23-resize — 手柄骑在卡片上边缘（向上拖变大）。移动端与引用回答
              形态不渲染；阅读态塌陷（.is-compact）时由 CSS 隐藏。 */}
          {!compact && !isMobile && (
            <div
              {...inputHeightResizer.separatorProps}
              className={`chat-input-resize-handle${inputHeightResizer.isResizing ? " is-resizing" : ""}`}
            />
          )}
          <div
            // fork:design-components —— 输入区 = 画板 01/20 的 .d-composer-top：
            // 同一套内边距（12px 12px 6px）与最小高度（46px），文字起点与画板一致。
            className="chat-input-editor-row d-composer-top"
            style={{
              minWidth: 0,
              display: "flex",
              flexDirection: compact ? "column" : "row",
              gap: "var(--s2)",
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
                {/* `.d-mention` = 画板 D-03b 帧 F 的正文提及芯片；窄屏那一段同一处
                    高亮挂 `.m-mention`（fork:v5-landing-close，两端等义）。 */}
                {highlightSegments.map((segment, i) =>
                  segment.type === "text" || !segment.token.valid ? (
                    segment.text
                  ) : (
                    <span key={i} className="d-mention">{segment.text}</span>
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
                isStreaming && onFollowUp
                  ? t("chat.queuePlaceholder")
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

          {/* fork:pwa-wb-composer —— 手机上「发送 / 停止」不再浮在编辑行右上角。
              改前：`(compact || isMobile)` 让窄屏走这一格，于是 390 下 send 落在
              y=689 的编辑行里（实测 `.chat-input-toolbar` 明明在 731–819），
              和桌面「发送在工具条右端」是两套位置语义，看上去像悬空的一枚。
              改后：窄屏由**工具条右端**那一格渲染（见下方 `narrowControls` 分支），
              与桌面同一个位置语义；这一格只留给 `compact`（引用回答）形态 ——
              那时整条工具条不渲染，发送钮没有别处可去。 */}
          {compact && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-row)", flexShrink: 0, alignSelf: "flex-end" }}>
              {composerSendCluster}
            </div>
          )}
          </div>

        {/* Bash mode status label */}
        {bashMode && (
          <div className="text-xs px-2 py-1" style={{ color: bashExcluded ? "var(--text-muted)" : "var(--accent)", marginTop: "var(--s1)" }}>
             {t("chat.shell")} · {bashExcluded ? t("chat.outputLocal") : t("chat.outputModel")}
          </div>
        )}

        {/* fork:design-components —— 工具栏 = 画板 20 的 .d-composer-bar：
            一行内是 附件 · 模型 · 思考 · 权限 · 工具档 ｜ 上下文环 · 声音 · 发送，
            与画板 20 A 的控件顺序一致（压缩已并入上下文环，见下面那处注释）。 */}
        {/* fork:pwa-wb-composer —— 窄屏（narrowControls，≤1024）把工具条收成**两行**：
            行一 = 附件 + 模型选择器（可省略号），行二 = 四枚模式芯片 + 更多 + 发送。
            改前这里只有 `minmax(0,1fr) auto` 两列，于是左组的全部控件挤在一行里
            （实测 390 下左组 min-content 338 > 可用 332，芯片被压到 27px 宽、
            彼此只隔 2px），右组被挤到第二行独苗一个「更多」——控件条 88px 高，
            其中大半是空档。行高交给 grid 的显式行轨（`--control-touch`），不再由
            内容撑出来；`display: contents` 让**桌面（≥1025）的 DOM 保持一条平铺的
            flex 行**（两个分组盒都不生成，盒模型一个像素不变）。 */}
        {!compact && <div className="chat-input-toolbar d-composer-bar" style={{
          display: narrowControls ? "grid" : "flex",
          gridTemplateColumns: narrowControls ? "minmax(0, 1fr) auto auto" : undefined,
          gridTemplateRows: narrowControls ? "var(--control-touch) var(--control-touch)" : undefined,
          gridTemplateAreas: narrowControls ? '"models models models" "chips actions send"' : undefined,
          rowGap: narrowControls ? "var(--s1)" : undefined,
          alignItems: narrowControls ? "center" : undefined,
        }}>

          {/* LEFT: attach + model selector (idle) or steer/followup toggle (streaming) */}
          <div style={{ flex: narrowControls ? undefined : "0 1 auto", minWidth: 0, display: narrowControls ? "contents" : "flex", alignItems: "center", gap: 2 }}>
            {/* fork:pwa-wb-composer —— 行一：附件 + 模型 + 供应商配额。
                窄屏下它是 grid 的 `models` 区；宽屏下 `display: contents` 摊平回
                左组（不生成盒子，桌面几何不变）。 */}
            <div
              className="fork-pwa-wb-models"
              style={{ display: narrowControls ? "flex" : "contents", alignItems: "center", gap: "calc(var(--s1) / 2)", minWidth: 0, gridArea: narrowControls ? "models" : undefined }}
            >
            {/* 附件 +：直接使用画板 20 的 .d-iconbtn 组件（board.css：无边框 / hover 叠色 / is-on 选中），
                有附件时挂 is-on（画板的选中态），图标与 20-composer.html 同款 plus。 */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title={t("chat.attachFile")}
              className={`d-iconbtn fork-pwa-wb-act${attachedImages.length ? " is-on" : ""}`}
              style={{ cursor: "pointer" }}
            >
              <i data-ico="plus" data-size="16"></i>
            </button>
            {/* fork:mobile-action-panel（2026-10-03）—— 窄屏「更多动作」：
                带文字的宫格浮层（内容由 AppShell 组装，这里只给触发钮 + 壳）。
                为什么不是「把 `+` 换成面板」（参照物的做法）：本仓 `+` 是**附件**，
                手机上最高频的动作，不该退一层。所以另给一枚 grid-2x2。
                格子点完就收起：壳上挂一个 onClick 让它冒泡到所有格子，
                这样 AppShell 那九个回调不用各自再带一个「关面板」。 */}
            {showActionPanel && (
              <>
                <button
                  ref={actionPanelAnchorRef}
                  type="button"
                  onClick={() => setActionPanelOpen((open) => !open)}
                  title={t("chat.moreActions")}
                  aria-label={t("chat.moreActions")}
                  aria-expanded={actionPanelOpen}
                  className={`d-iconbtn fork-pwa-wb-act${actionPanelOpen ? " is-on" : ""}`}
                  style={{ cursor: "pointer" }}
                >
                  <i data-ico="grid-2x2" data-size="15"></i>
                </button>
                <PortalDropdown
                  open={actionPanelOpen}
                  anchorRef={actionPanelAnchorRef}
                  panelRef={actionPanelPopRef}
                  align="left"
                  width={ACTION_PANEL_WIDTH}
                >
                  {/* fork:pwa-action-panel —— 手机专属宫格浮层的壳；DOM 只带 d-*，
                      行为钩子 fork-actpanel 保留（fork-ui.css 只给它定宽）。 */}
                  <div className="d-pop is-open fork-actpanel" onClick={() => setActionPanelOpen(false)}>
                    {actionPanel}
                  </div>
                </PortalDropdown>
              </>
            )}
            {/* Model selector - visible always, disabled while the session or switch is busy */}
            {/* fork:proma-37-deferred-model —— 模型选择器**不再因运行中而置灰**：
                Proma 的行为是「Agent 运行时可以预先切换模型，当前轮结束后自动按新模型
                执行下一轮」。改前这里是 disabled={isStreaming}，用户只能等本轮跑完；
                改后运行中选模型只把选择记到「下轮生效」，由 useAgentSession 在本轮
                真正结束时（settleTurn）才发 set_model，不打断当前轮。 */}
            {(modelOptions.length > 0 || model || modelError) && onModelChange && (
              <ModelSelector
                options={modelOptions}
                value={model}
                onChange={onModelChange}
                busy={modelSwitching}
                isAutoSelection={isAutoModelSelection}
              />
            )}
            {/* fork:proma-37-deferred-model —— 「已排队，下轮生效」提示。挂在选择器
                紧右侧，用画板既有的 .d-chipbtn is-on（不新增其它类），图标走 lucide
                的 clock。点一下撤销排队：纯客户端操作，本轮仍在用原来的模型。 */}
            {pendingModel && (
              <button
                type="button"
                className="d-chipbtn is-on"
                style={{ cursor: onCancelPendingModel ? "pointer" : "default", maxWidth: "calc(var(--s5) * 6)", minWidth: 0 }}
                title={`${t("chat.modelQueuedNextTurnTitle", { model: pendingModel.name })} — ${t("chat.modelQueuedNextTurnCancel")}`}
                onClick={onCancelPendingModel}
              >
                <i data-ico="clock" data-size="12"></i>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t("chat.modelQueuedNextTurn", { model: pendingModel.name })}
                </span>
              </button>
            )}
            {/* fork:ui — 输入框侧的独立收藏菜单已移除（用户要求）：收藏现在就在
                模型下拉里每行右侧的星标上（ModelSelector），不需要第二个入口。 */}
            {/* fork:quota-chip-removed（用户 2026-10-02）—— 这里原来挂着供应商配额芯片
                （`⟳ 1%` = 剩余额度，上游 #867）。用户裁定「放在这里没啥卵用」：额度在设置页
                的供应商用量里看得到，写代码时盯这条百分比只会分心。芯片与其纯函数库
                （`components/ProviderQuotaChip.tsx`、`lib/provider-usage-quota.ts` + 单测）
                一并删除，没有留孤儿代码。那一格留给**实时速度**徽标（已挪到行二，见下）。 */}
            </div>
            {/* fork:pwa-wb-composer —— 行二：思考 / 权限 / 工具预设 / 压缩四枚模式芯片。
                窄屏下是 grid 的 `chips` 区（间隙 `--s1`，芯片命中区由 CSS 给到
                `--control-touch + --s1`）；宽屏下 `display: contents` 摊平回左组。 */}
            <div
              className="fork-pwa-wb-modes"
              style={{ display: narrowControls ? "flex" : "contents", alignItems: "center", gap: "var(--s1)", minWidth: 0, gridArea: narrowControls ? "chips" : undefined }}
            >
            {/* fork:thinking-level-while-running（用户 2026-10-02，对齐上游 0.10）——
                上一轮运行中这枚芯片是**只读**的（注释写着「一轮之内改不了」），于是
                「运行中也能调推理等级」这条上游新增功能在本仓没有。上游把同一个控件在
                流式时保持可点，只把 title 换成「当前推理档」。真要改的是**下一轮**：
                pi 的 set_thinking_level 在 turn 中途生效于后续请求，这一轮的预算不变。 */}
            {onThinkingLevelChange && (
              <div ref={thinkingDropdownRef} style={{ position: "relative" }}>
                {/* fork:design-components —— 思考档直接用画板 20/21 的 .d-select + .d-pop/.d-menu-row。 */}
                <button
                  type="button"
                  onClick={() => setThinkingDropdownOpen((v) => !v)}
                   title={isStreaming
                    ? t("chat.currentReasoning", { level: thinkingDisplayLabel })
                    : t("chat.changeReasoning", { level: thinkingDisplayLabel })}
                   aria-label={t("chat.changeReasoningLabel")}
                  className="d-select"
                  style={{
                    cursor: "pointer",
                    background: thinkingDropdownOpen ? "var(--overlay-hover)" : undefined,
                    // fork:pwa-wb-composer —— `auto` 的触发条件从 isMobile 放宽到
                    // viewportCompact(≤1024)：app/fork-ui.css 的 `@layer fork-reset`
                    // 把 `button.d-select` 列入 `width: 100%` 的行式拉满清单，
                    // 而那只有在**容器宽度确定**时才咬人（grid 的 auto 列 / 1fr）。
                    // 桌面（≥1025）工具条是 shrink-to-fit，百分比按 auto 解，
                    // 所以这里放宽只影响平板档：实测 768 下「全自动」独占 500px。
                    width: isMobile || viewportCompact ? "auto" : undefined,
                  }}
                >
                  {/* fork:v5-wave-n1 · D-28 帧 C：`.d-flap` 外壳只包那枚图标，
                      文字是它的兄弟节点（板上就是这样分的两列）。 */}
                  <span className={`d-flap${flapPhase ? ` ${flapPhase}` : ""}`}>
                    <i data-ico="brain" data-size="13"></i>
                  </span>
                  {!narrowControls && <span style={{ whiteSpace: "nowrap" }}>{thinkingDisplayLabel}</span>}
                  {/* 2026-10-03 用户裁定 —— 有选项的芯片一律带向下箭头（与模型选择器同款
                      chevron-down），不然分不清「可点开」与「只是读数」。 */}
                  <i data-ico="chevron-down" data-size="12"></i>
                </button>
                {thinkingDropdownOpen && (
                  <div
                    className="anim-popover d-pop is-open fork-think-pop"
                    style={{
                      position: "absolute", bottom: "calc(100% + 6px)",
                      // fork:ui-composer-pop —— 左侧组的下拉一律左缘锚定：右缘锚定会把
                      // 320 宽的浮窗探出卡片左缘，被 overflow-x:clip 裁掉。
                      left: 0,
                      // fork:think-seg-scroll —— 宽度上限（见上面那个 state）：装得下时
                      // 这条不起作用，档位尺按内容走；装不下时封顶并让档位尺横滑。
                      maxWidth: thinkPopMaxWidth ?? undefined,
                      // fork:v5-frame-audit D-04 帧 A —— 不写死宽度：档位尺是内容撑的
                      // （`.d-seg` 一行排完当前模型可用的全部档位），写死 180 反而会折行。
                      zIndex: 100,
                    }}
                  >
                    {/* fork:design-components —— 画板 21 的弹层有**标题行**：
                        `<div class="d-pop-title">思考强度</div>`（board.css:622 一行纯文本，
                        meta 字号 / placeholder 色 / padding s2 s2 s1）。样式全部来自 board.css，
                        这里不加内联。 */}
                    <div className="d-pop-title">{t("chat.thinkingTitle")}</div>
                    {/* fork:v5-frame-audit D-04 帧 A（`m-think`）—— 思考档浮层按画板原文
                        收成**分段控件**：`.d-pop-body.d-col` 里一块 `.d-seg`，当前档 `is-on`，
                        下面一行 `.d-t-xs.d-t-faint` 说当前档的代价（板上那句话讲的是「中档」，
                        这里给的是用户**此刻**选中的那一档，位置与语义同格）。
                        改前是一串 `.d-menu-row`（与权限 / 工具档同形），那是权限与工具档的形态：
                        思考档在画板上从头到尾都不是「一列选项」，它是循环按钮展开后的档位尺。
                        行为零变化：档位集合仍是同一份 `THINKING_LEVELS`（同样过滤
                        `availableThinkingLevels`），回调仍是同一个 `onThinkingLevelChange`，
                        选中态仍是 `is-on`。档位被 `thinkingLevelMap` 改过时，原来行尾那个
                        `(lvl)` 括号注解挪到 `title` 上 —— 分段按钮放不下第二段文字，
                        但原值仍然可读（悬停可见），信息不丢。 */}
                    <div className="d-pop-body d-col" style={{ gap: "var(--nx-sp-1)" }}>
                      <div className="d-seg fork-think-seg">
                        {THINKING_LEVELS.filter((lvl) => {
                          if (!availableThinkingLevels) return true;
                          if (lvl === "auto") return true;
                          return availableThinkingLevels.includes(lvl);
                        }).map((lvl) => {
                          const isActive = (thinkingLevel ?? "auto") === lvl;
                          const mappedVal = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
                          const displayLabel = (mappedVal != null && mappedVal !== lvl) ? mappedVal : lvl;
                          const showOriginal = mappedVal != null && mappedVal !== lvl;
                          return (
                            <button
                              key={lvl}
                              type="button"
                              onClick={() => { setThinkingDropdownOpen(false); if (!isActive) onThinkingLevelChange(lvl); }}
                              className={isActive ? "is-on" : undefined}
                              title={showOriginal ? lvl : undefined}
                              style={{ cursor: "pointer" }}
                            >
                              {displayLabel}
                            </button>
                          );
                        })}
                      </div>
                      <div className="d-t-xs d-t-faint">
                        {t(THINKING_LEVEL_DESC_KEYS[
                          (THINKING_LEVELS.includes(thinkingLevel ?? "auto")
                            ? (thinkingLevel ?? "auto")
                            : "auto") as (typeof THINKING_LEVELS)[number]
                        ])}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* fork:proma-02-mode — 权限档位（Chat-only 会话没有意义，所以隐藏）。
                2026-10-03 用户裁定 —— 从「点一下循环」改成下拉：三个档并列在浮窗里，
                与思考档 / 工具档同一形态（`.d-select` + `.d-pop` / `.d-menu-row`），
                三档不用轮着点才知道现在在哪。循环切换的 `nextPermissionMode` 已退役。 */}
            {onPermissionModeChange && permissionMode && toolPreset !== "none" && (
              <div ref={permissionDropdownRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setPermissionDropdownOpen((v) => !v)}
                  title={`${t(PERMISSION_MODE_LABEL_KEYS[permissionMode])}：${t(PERMISSION_MODE_HINT_KEYS[permissionMode])}`}
                  aria-label={t(PERMISSION_MODE_LABEL_KEYS[permissionMode])}
                  aria-expanded={permissionDropdownOpen}
                  className="d-select"
                  style={{
                    cursor: "pointer",
                    // 非默认档位用强调色，因为「当前不全自动」是需要一眼看出来的状态
                    color: permissionMode === "bypass" ? undefined : "var(--accent-text)",
                    background: permissionDropdownOpen ? "var(--overlay-hover)" : undefined,
                    // fork:pwa-wb-composer —— `auto` 的触发条件从 isMobile 放宽到
                    // viewportCompact(≤1024)：app/fork-ui.css 的 `@layer fork-reset`
                    // 把 `button.d-select` 列入 `width: 100%` 的行式拉满清单，
                    // 而那只有在**容器宽度确定**时才咬人（grid 的 auto 列 / 1fr）。
                    // 桌面（≥1025）工具条是 shrink-to-fit，百分比按 auto 解，
                    // 所以这里放宽只影响平板档：实测 768 下「全自动」独占 500px。
                    width: isMobile || viewportCompact ? "auto" : undefined,
                  }}
                >
                  <i
                      data-ico={permissionMode === "bypass" ? "shield" : permissionMode === "ask" ? "shield-check" : "book-marked"}
                      data-size="13"
                    ></i>
                  {/* fork:v5-wave-n1 · D-28 帧 C 的标签交换：流内是新值（宽度撑着），
                      退场的旧值绝对定位盖在上面（板上两个标签都 absolute）。 */}
                  {!narrowControls && (
                    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                      {permissionLabelOut !== null && (
                        <span
                          className="d-label-out"
                          aria-hidden="true"
                          style={{
                            position: "absolute",
                            left: 0,
                            top: "50%",
                            transform: "translateY(-50%)",
                            whiteSpace: "nowrap",
                            pointerEvents: "none",
                          }}
                        >{permissionLabelOut}</span>
                      )}
                      <span
                        className={permissionLabelOut !== null ? "d-label-in" : undefined}
                        style={{ whiteSpace: "nowrap" }}
                      >{permissionLabel}</span>
                    </span>
                  )}
                  <i data-ico="chevron-down" data-size="12"></i>
                </button>
                {permissionDropdownOpen && (
                  <div
                    className="anim-popover d-pop is-open"
                    style={{
                      position: "absolute",
                      bottom: "calc(100% + 6px)",
                      // fork:ui-composer-pop —— 同思考档 / 工具档：左缘锚定，不探出卡片左缘。
                      left: 0,
                      zIndex: 100,
                      // 不写 minWidth：三档的说明句（`PERMISSION_MODE_HINT_KEYS`）本来就长，
                      // 弹层按内容收口；写死宽度只会多一条内联几何字面量。
                    }}
                  >
                    <div className="d-pop-title">{t("chat.permissionTitle")}</div>
                    {PERMISSION_MODES.map((mode) => {
                      const isActive = mode === permissionMode;
                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => { setPermissionDropdownOpen(false); if (!isActive) onPermissionModeChange(mode); }}
                          className="d-menu-row"
                          style={{ cursor: "pointer" }}
                        >
                          {/* fork:v5-frame-audit D-04 帧 A（`m-perm`）—— 当前档的写法改回
                              画板原文：`<span class="d-grow d-t-b">每次问</span>
                              <i data-ico="check" data-size="14">`。改前是「行上挂 is-on +
                              行首一枚对勾 + 给未选中行补一枚等宽占位 span」——
                              那是产品自己发明的第三种选中态：同屏的模型浮层
                              （ModelSelector 的 d-menu-row）走的就是画板这套（标签加粗 +
                              行尾对勾，行首对齐天然一致，不需要占位），而权限 / 工具两档
                              与它不一致，于是两个菜单的「当前档」读法不同。
                              现在三处统一成画板那一件；onClick / 档位集合 / 文案一律不动。 */}
                          <span
                            className={isActive ? "d-grow d-t-b" : "d-grow"}
                            style={{ whiteSpace: "nowrap" }}
                          >{t(PERMISSION_MODE_LABEL_KEYS[mode])}</span>
                          {/* 档位说明是整句（「工具调用一律直接执行，不询问」），放在一行里
                              必须能收缩 —— 否则 `.d-grow` 的标签被挤成两行（实测「全自
                              动」断行）。收缩成省略号，完整句子挂 `title` 上仍可读。 */}
                          <span
                            className="d-t-xs d-t-faint"
                            title={t(PERMISSION_MODE_HINT_KEYS[mode])}
                            style={{ flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          >{t(PERMISSION_MODE_HINT_KEYS[mode])}</span>
                          {isActive && <i data-ico="check" data-size="14"></i>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {!isStreaming && onToolPresetChange && (
              <div ref={toolDropdownRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => !isStreaming && setToolDropdownOpen((v) => !v)}
                  disabled={isStreaming}
                  title={t("chat.changeToolPreset") + `: ${toolPresetLabel}`}
                  aria-label={t("chat.changeToolPreset")}
                  className="d-select"
                  style={{
                    cursor: isStreaming ? "not-allowed" : "pointer",
                    opacity: isStreaming ? 0.5 : 1,
                    background: toolDropdownOpen ? "var(--overlay-hover)" : undefined,
                    // fork:pwa-wb-composer —— `auto` 的触发条件从 isMobile 放宽到
                    // viewportCompact(≤1024)：app/fork-ui.css 的 `@layer fork-reset`
                    // 把 `button.d-select` 列入 `width: 100%` 的行式拉满清单，
                    // 而那只有在**容器宽度确定**时才咬人（grid 的 auto 列 / 1fr）。
                    // 桌面（≥1025）工具条是 shrink-to-fit，百分比按 auto 解，
                    // 所以这里放宽只影响平板档：实测 768 下「全自动」独占 500px。
                    width: isMobile || viewportCompact ? "auto" : undefined,
                  }}
                >
                  <i data-ico="wrench" data-size="13"></i>
                  {!narrowControls && <span style={{ whiteSpace: "nowrap" }}>{toolPresetLabel}</span>}
                  {/* 2026-10-03 用户裁定 —— 同思考档：有选项就带箭头。 */}
                  <i data-ico="chevron-down" data-size="12"></i>
                </button>
                {toolDropdownOpen && (
                  <div
                    className="anim-popover d-pop is-open"
                    style={{
                      position: "absolute",
                      bottom: "calc(100% + 6px)",
                      // fork:ui-composer-pop —— 同思考档：左缘锚定，不探出卡片左缘。
                      left: 0,
                      zIndex: 100,
                      minWidth: 120,
                    }}
                  >
                    {/* fork:design-components —— 同思考档：标题行照画板 21。 */}
                    <div className="d-pop-title">{t("tools.label")}</div>
                    {TOOL_PRESETS.map((lvl) => {
                      const preset = TOOL_PRESET_MAP[lvl];
                      const isActive = (toolPreset ?? "configured") === preset;
                      let desc: string;
                      if (lvl === "configured") desc = t("chat.configuredTools");
                      else if (lvl === "chat-only") desc = t("chat.chatOnly");
                      else if (lvl === "read-only") desc = t("chat.readOnlyTools", { count: 4 });
                      else if (lvl === "default") desc = t("chat.builtInTools", { count: 4 });
                      else desc = t("chat.allBuiltInTools");
                      // fork:v5-frame-audit —— 工具档这一列原来直接印 `chat.toolPreset.full`，
                      // 而三个语包里只有 `chat.toolPreset.all`（= full 档），于是这一行在
                      // 菜单里**显示成英文键名**。同一张表里的其它四档都取同名键，
                      // 唯独 full 要落到 all —— 就是缺了一个别名，语义完全相同。
                      // 这里改用已存在的键，不新增语包条目（lib/i18n 不在本次可改文件内）。
                      const labelKey = lvl === "full" ? "chat.toolPreset.all" : `chat.toolPreset.${lvl}`;
                      return (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => { setToolDropdownOpen(false); if (!isActive) onToolPresetChange(preset); }}
                          className="d-menu-row"
                          style={{ cursor: "pointer" }}
                        >
                          {/* fork:v5-frame-audit D-04 帧 A（`m-tools`）—— 同权限档：
                              当前档 = `.d-grow.d-t-b` + 行尾对勾（画板原文），
                              不再是行首对勾 + 行内 is-on。 */}
                          <span
                            className={isActive ? "d-grow d-t-b" : "d-grow"}
                            style={{ whiteSpace: "nowrap" }}
                          >{t(labelKey)}</span>
                          {/* 同权限档：说明句可收缩、完整句子挂 title。 */}
                          <span
                            className="d-t-xs d-t-faint"
                            title={desc}
                            style={{ flexShrink: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          >{desc}</span>
                          {isActive && <i data-ico="check" data-size="14"></i>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* fork:upstream-2e66e40（#1008 移植）—— 压缩入口原在这行；2026-10-03 用户裁定
                **删除**：上下文环的浮窗底部已经有同一动作（`.d-menu-row` + `package` 字形，
                同一个 `onCompact` / `onAbortCompaction`，压缩中也翻成「停止压缩」——
                手工压缩与轮间自动压缩都够得着，见上面 `contextRing` 那段）。
                同一个动作在一块屏上摆两枚，压缩中那枚还得单独变红，一眼看去像两件事。
                真要挪回工具条，就把 contextRing 里那个 `d-menu-row` 搬过来，别再新增第三处。 */}
            </div>

          </div>

          {/* 画板 20 的 .d-composer-bar 用 .grow 顶开左右两组。 */}
          {/* fork:pwa-wb-composer —— 窄屏下 `.grow` 会占掉 grid 的一个自动列，
              改由 `grid-template-areas` 定位左右两组，所以这一格在窄屏不生成盒子。 */}
          <span className="d-grow" style={{ display: narrowControls ? "none" : undefined }} />

          {/* fork:pwa-wb-composer —— 窄屏：发送 / 停止作为工具条的第三个 grid 区
              （`send`，行二最右），和桌面同一个「控件行右端」的位置语义。
              改前它在 `.d-composer-top` 里（编辑行右上），两套形态不一致；
              改后它还在这一格之外 —— 桌面完全不受影响（`narrowControls` 为 false
              时不渲染，下方右组里的那一枚才是桌面的）。 */}
          {narrowControls && (
            <div className="fork-pwa-wb-send" style={{ gridArea: "send", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {composerSendCluster}
            </div>
          )}

          {/* RIGHT: 上下文环 + 声音 + 发送（停止） */}
          <div className="fork-pwa-wb-actions" style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            position: "relative",
            marginLeft: narrowControls ? 0 : "auto",
            gridArea: narrowControls ? "actions" : undefined,
          }}>
            {/* fork:pwa-composer-slim（2026-10-03）—— 这里原本是窄屏的「更多控件」
                ellipsis 钮 + 一条**覆盖式**工具条（把上下文环与声音藏起来、点 ⋯ 再铺
                一层浮层盖在行二上）。拆掉它的理由：
                  · 覆盖层是「藏在另一层里的图标」，与顶栏那条盖住标题的覆盖层同一个毛病；
                  · 声音开关搬进了输入区的「更多动作」宫格（那一格有文字，不用猜）；
                  · 上下文环是**读数**，本来就该常驻 —— 它是这块屏上唯一说「还剩多少上下文」
                    的地方（fork:ui-stats-ring 把完整统计也收进了它的浮窗）。
                所以行二现在是：思考 / 权限 / 工具预设 / 速度 / 上下文环 / 发送，一屏摆得下。 */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: narrowControls ? 1 : 2,
            }}>
            {streamSpeed != null && streamSpeed > 0 && (
              <span className="d-badge" title={t("chat.streamSpeed")} role="status" aria-live="off">
                <i data-ico="gauge" data-size="11"></i>
                {streamSpeed} t/s
              </span>
            )}
            {contextRing}

            {onSoundToggle !== undefined && (
              /* fork:design-components —— 声音开关 = 画板 20 的 .d-iconbtn（volume-2 / volume-x）。 */
              <button
                type="button"
                onClick={onSoundToggle}
                 title={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
                 aria-label={soundEnabled ? t("chat.disableSound") : t("chat.enableSound")}
                className={`d-iconbtn fork-pwa-wb-act${soundEnabled ? "" : " is-on"}`}
                style={{ width: "var(--control-md)", height: "var(--control-sm)", cursor: "pointer", opacity: soundEnabled ? 1 : 0.55 }}
              >
                <i data-ico={soundEnabled ? "volume-2" : "volume-x"} data-size="14"></i>
              </button>
            )}
            {/* fork:pwa-wb-composer —— 宽屏（≥1025）发送钮仍在右组里，与画板 20 一致；
                窄屏时发送钮在工具条的 `send` 区（上方），这里不再画第二枚。 */}
            {!narrowControls && composerSendCluster}
            </div>
          </div>

        </div>}
        {/* Close composer panel (wraps textarea + bottom controls) */}
        </div>
        {/* Close main-input relative wrapper (anchors history / @-mention menus) */}
        </div>
        </>
        )}
      </div>
    </fieldset>
  );
});
