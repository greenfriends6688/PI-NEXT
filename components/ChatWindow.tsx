"use client";
import { registerAbortHandler } from "@/hooks/useKeyboardShortcuts";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AgentMessage, AssistantContentBlock, AssistantMessage, BashExecutionMessage, BlockingExtensionUiRequest, ExtensionStatusItem, ExtensionUiRequest, ExtensionWidgetItem, SessionInfo, SessionTreeNode, ToolResultMessage, UserMessage } from "@/lib/types";
import { normalizeCustomPanelLines } from "@/lib/ansi";
import { splitDialogTitle, splitDialogTitleCode } from "@/lib/dialog-title";
import { asBracketedPaste, toTerminalKeyData } from "@/lib/terminal-input";
import { countToolCallBlocks, getAssistantErrorMessage, getDisplayableAssistantBlocks, isAssistantTruncated, isMessageGroupAnchor, splitFinalAssistantBlocks } from "@/lib/message-display";
// fork:pi-1.1（上游 981e270f1 / #1032）—— 扩展对话框按内容加宽。
import { EXTENSION_DIALOG_BASE_WIDTH, fitExtensionDialogWidth } from "@/lib/extension-dialog-fit";
import { extractTurnWrittenFiles, type WrittenFile } from "@/lib/turn-written-files";
import { collectSkillActivations, type SkillActivation } from "@/lib/skill-usage";
import { buildQuotedSelection } from "@/lib/quoted-selection";
import { createSelectionContextId, type SelectionContext } from "@/lib/composer-context";
import type { SessionReference } from "@/lib/composer-context";
import { clearLocationTextHighlight, LOCATION_HIGHLIGHT_CLASS, setLocationTextHighlight } from "@/lib/location-highlight";
import { setReadCursor, useReadCursors } from "@/lib/session-unread";
import { MessageView, TurnIdentityHead, formatDuration } from "./MessageView";
import { MarkdownBody } from "./MarkdownBody";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import type { FileLocationTarget } from "./FileViewer";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import { NewSessionHome } from "./fork/NewSessionHome";
import { ProjectChip, type NewSessionTargets } from "./fork/ProjectChip";
// fork:ui-ctxbar —— 新会话上下文条的分支项：与顶栏同一枚工作区（worktree）下拉。
import { BranchChip } from "./TopBarPopovers";
// fork:zc-02 — in-conversation find bar (⌘F): bar component + pure search index.
import { ConversationFindBar } from "./fork/ConversationFindBar";
import {
  buildSearchIndex,
  CONVERSATION_FIND_MAX_HITS,
  conversationFindHitKey,
  findHits,
  nextHitIndex,
  type ConversationFindHit,
} from "@/lib/conversation-find";
// fork:proma-05-explore — 分支会话的来源抬头条 + 带回结论
import { ExplorationBanner } from "./fork/ExplorationBanner";
// fork:proma-31-task-progress — 吸底任务进度浮层（PR-31）
// fork:proma-35-retry — 消息流里的重试提示（PR-35）
import { RetryNotice } from "./fork/RetryNotice";
import { extractTodoState } from "@/lib/todo-state";
import { AnsiText } from "./AnsiText";
import { useI18n } from "@/hooks/useI18n";
import { ProcessGroup, summarizeProcessBlocks, summarizeProcessParts } from "./ProcessGroup";
import { useCollapsePresence } from "@/hooks/useCollapsePresence";
import { messageToProcessContentBlocks, type ProcessContentBlock } from "@/lib/process-content";
import { useAgentSession, type AgentEndInfo, type NoticeItem } from "@/hooks/useAgentSession";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useIsMobile } from "@/hooks/useIsMobile";
// fork:v5-wave-b —— PWA 形态（≤640px）转录壳：过程摘要那一行走画板 M-02 的
// `.m-tool` / `.m-tool-head`（手机上「过程默认折叠成一行摘要」）。
import { usePwaSkin } from "@/components/pwa/skin";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { AppUpdateResponse } from "@/lib/api-types";
import type { ToolEntry } from "@/lib/tool-presets";
import { findChatScrollAnchor, type ChatScrollPosition } from "@/lib/chat-scroll-position";
import { computeTurnStats } from "@/lib/turn-stats";
import {
  captureScrollDistance,
  getPromptAnchorSpacerHeight,
  getVisibleRenderWindow,
  isScrollAtTail,
  restoreScrollTop,
  VISIBLE_PAGE_SIZE,
} from "@/lib/chat-lazy-load";
// fork:zm-03 — 滚动权状态机 / prepend 锚定 / 渐隐遮罩（纯逻辑见 lib/scroll-follow.ts）。
import {
  captureScrollAnchor,
  initialFollowing,
  keyboardScrollIntent,
  nextFollowingAfterIntent,
  resolveFollowingAfterScroll,
  resolvePrependRestoreScrollTop,
  shouldAllowProgrammaticScroll,
  touchScrollIntent,
  wheelScrollIntent,
  type ScrollAnchorSample,
  type ScrollEventSource,
  type ScrollIntent,
} from "@/lib/scroll-follow";
import { ScrollFadeViewport } from "./fork/ScrollFadeViewport";
// fork:zm-07 — 等待首 token 时的「串行滚动」状态行。
import { PhaseRoll, phaseKeyOf, phaseLabel } from "./fork/PhaseRoll";
// fork:zm-04 — 倒计时条共享同一个动效偏好守卫。
import { useMotionPreference } from "./fork/RollingNumber";
// fork:zc-17 — 零会话首屏的三条起步路径。
import { EmptyStateGuide } from "./fork/EmptyStateGuide";
import { TEXT } from "@/lib/typography";
import { APPROVAL_CHOICES } from "@/lib/approval-policy";
import { springEnter } from "@/lib/motion-pop";

interface Props {
  session: SessionInfo | null;
  searchTarget?: { sessionId: string; entryId: string; blockIndex?: number } | null;
  onSearchTargetHandled?: (target: { sessionId: string; entryId: string }) => void;
  initialScrollPosition?: ChatScrollPosition | null;
  onScrollPositionChange?: (sessionId: string, position: ChatScrollPosition) => void;
  sessionRunning?: boolean;
  /** 设置里改完东西点「重载会话」：AppShell +1 即可，**不再 remount 本组件**
   *  （板05 B 类转场：旧内容留在屏上降到 0.5，不做骨架屏）。 */
  reloadToken?: number;
  newSessionCwd: string | null;
  newSessionDraftKey: string | null;
  onAgentEnd?: (end: AgentEndInfo) => void;
  /** fork:zn-16 — 一轮运行以错误收场；设置里「任务失败时通知」接这里。 */
  onAgentError?: (message: string) => void;
  onAttentionNeeded?: (request: BlockingExtensionUiRequest) => void;
  onSessionCreated?: (session: SessionInfo, sourceDraftKey: string) => void;
  /** fork:zn-03 — reports empty-chat so AppShell can hide the top bar. */
  onEmptyChange?: (empty: boolean) => void;
  onSessionForked?: (newSessionId: string) => void;
  /** fork:proma-05-explore — 在右栏开一个分支的只读 tab（与主线并排看）。 */
  onOpenSessionPane?: (sessionId: string, parentSessionId?: string | null) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSystemToolsChange?: (tools: ToolEntry[] | null) => void;
  onSystemInfoLoaderChange?: (loader: (() => Promise<void>) | null) => void;
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onSessionStatsPanelOpen?: () => void;
  /** fork:mcp-slash —— `/mcp` 打开「设置 › MCP」。 */
  onOpenSettingsSection?: (section: string) => void;
  /** fork:mobile-action-panel —— 窄屏「更多动作」宫格的内容（AppShell 组装）。 */
  actionPanel?: ReactNode;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  /** fix:mcp-topbar-icons —— 扩展状态（MCP / 插件）上报给 AppShell：两枚图标改挂顶栏。 */
  onExtensionStatusChange?: (statuses: ExtensionStatusItem[], widgets: ExtensionWidgetItem[]) => void;
  onOpenFile?: (filePath: string, hint?: number | Omit<FileLocationTarget, "filePath">) => void;
  onOpenSession?: (sessionId: string) => void;
  /** fork:proma-32-skill-usage —— 点本轮的 skill chip 打开 Skills 分节并定位到该 slug。 */
  onOpenSkill?: (slug: string) => void;
  onAskInNewChat?: (prompt: string, sourceSessionId: string, sourceEntryId: string) => Promise<void>;
  quoteSelectionEnabled?: boolean;
  initialPrompt?: string;
  onInitialPromptConsumed?: () => void;
  /** fork:ui-projectchip — workspace selector shown on the new-session page. */
  newSessionTargets?: NewSessionTargets | null;
  /** Completion sound state + controls, owned by AppShell so tasks finishing in
   *  a non-active workspace can still ring. */
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  playDoneSound?: () => void;
  unlockAudio?: () => void;
}

/** fork:zm-03 — 滚动指标（纯读数，不触碰布局）。 */
function scrollMetricsOf(container: HTMLElement): { scrollTop: number; viewportHeight: number; contentHeight: number } {
  return {
    scrollTop: container.scrollTop,
    viewportHeight: container.clientHeight,
    contentHeight: container.scrollHeight,
  };
}

/**
 * fork:zm-03 — 把「视口顶部附近的第一条消息」采成锚点。
 *
 * 用 rect 差而不是 `offsetTop`：offsetParent 不一定是消息容器，rect 差在任何
 * 嵌套/滚动结构下都是同一坐标系。视口之上的最后一条作为兜底（整个视口都在两条消息之间）。
 */
function captureMessageAnchor(container: HTMLElement, content: HTMLElement | null): ScrollAnchorSample | null {
  if (!content) return null;
  const viewportTop = container.getBoundingClientRect().top;
  let fallback: ScrollAnchorSample | null = null;
  for (const item of content.querySelectorAll<HTMLElement>("[data-entry-id]")) {
    const entryId = item.dataset.entryId;
    if (!entryId) continue;
    const top = item.getBoundingClientRect().top;
    const sample = captureScrollAnchor({ entryId, elementViewportTop: top, viewportTop });
    if (top >= viewportTop - 1) return sample;
    fallback = sample;
  }
  return fallback;
}

function assistantTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current: Node | null = walker.nextNode();
  while (current) {
    const parent = current.parentElement;
    if (parent?.closest("[data-message-text]")) nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

function rangeFromTextOffsets(root: HTMLElement, startOffset: number, endOffset: number, fallbackText?: string): Range | null {
  const nodes = assistantTextNodes(root);
  if (nodes.length === 0) return null;
  const fullText = nodes.map((node) => node.data).join("");
  let start = Number.isFinite(startOffset) ? startOffset : -1;
  let end = Number.isFinite(endOffset) ? endOffset : -1;
  if (start < 0 || end <= start || end > fullText.length) {
    if (!fallbackText) return null;
    const match = fullText.indexOf(fallbackText);
    if (match < 0) return null;
    start = match;
    end = match + fallbackText.length;
  }
  const locate = (target: number): [Text, number] | null => {
    let cursor = 0;
    for (const node of nodes) {
      const next = cursor + node.data.length;
      if (target <= next) return [node, Math.max(0, target - cursor)];
      cursor = next;
    }
    const last = nodes[nodes.length - 1];
    return last ? [last, last.data.length] : null;
  };
  const startPoint = locate(start);
  const endPoint = locate(end);
  if (!startPoint || !endPoint) return null;
  const range = document.createRange();
  range.setStart(startPoint[0], startPoint[1]);
  range.setEnd(endPoint[0], endPoint[1]);
  return range;
}

// ---------------------------------------------------------------------------
// fork:zc-02 — CSS Custom Highlight painting for the in-conversation find bar.
//
// Why ranges instead of <mark> elements: MarkdownBody is memoized and re-rendered
// on every streamed chunk, so injecting highlight markup into its React tree would
// invalidate that memoization and fight incremental streaming. The CSS Custom
// Highlight API paints over the existing DOM without touching React. Environments
// without it (jsdom, older browsers) are a safe no-op: the bar still counts and
// navigates, it just cannot paint.
// ---------------------------------------------------------------------------
const CONVERSATION_FIND_HIGHLIGHT = "pi-conversation-find";
const CONVERSATION_FIND_ACTIVE_HIGHLIGHT = "pi-conversation-find-active";
const CONVERSATION_FIND_STYLE_ID = "pi-conversation-find-highlight-style";
const CONVERSATION_FIND_HIGHLIGHT_CSS = `
::highlight(${CONVERSATION_FIND_HIGHLIGHT}) {
  background-color: var(--accent-soft);
  color: var(--text);
}
::highlight(${CONVERSATION_FIND_ACTIVE_HIGHLIGHT}) {
  background-color: var(--accent);
  color: var(--bg);
}
`;

interface ConversationHighlightRegistryLike {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
}

interface ConversationHighlightLike {
  priority?: number;
}

type ConversationHighlightConstructor = new (...ranges: Range[]) => unknown;

function conversationHighlightSupport(): {
  registry: ConversationHighlightRegistryLike;
  Highlight: ConversationHighlightConstructor;
} | null {
  if (typeof document === "undefined" || typeof CSS === "undefined") return null;
  const registry = (CSS as unknown as { highlights?: ConversationHighlightRegistryLike }).highlights;
  const Highlight = (globalThis as unknown as { Highlight?: ConversationHighlightConstructor }).Highlight;
  if (!registry || typeof Highlight !== "function") return null;
  return { registry, Highlight };
}

function ensureConversationFindHighlightStyle(): void {
  if (typeof document === "undefined") return;
  let style = document.getElementById(CONVERSATION_FIND_STYLE_ID);
  if (!(style instanceof HTMLStyleElement)) {
    style = document.createElement("style");
    style.id = CONVERSATION_FIND_STYLE_ID;
    document.head.appendChild(style);
  }
  if (style.textContent !== CONVERSATION_FIND_HIGHLIGHT_CSS) {
    style.textContent = CONVERSATION_FIND_HIGHLIGHT_CSS;
  }
}

function isConversationFindIgnoredText(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return true;
  return Boolean(parent.closest(
    "button,input,textarea,select,script,style,[contenteditable='true'],[aria-hidden='true']",
  ));
}

/** All non-overlapping occurrences of `query` among the element's text nodes. */
function conversationFindRangesIn(
  root: HTMLElement,
  query: string,
  caseSensitive: boolean,
  limit = CONVERSATION_FIND_MAX_HITS,
): Range[] {
  const needle = query.trim();
  if (needle.length === 0 || limit <= 0) return [];
  const comparable = caseSensitive ? needle : needle.toLowerCase();
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    if (!isConversationFindIgnoredText(text)) {
      const haystack = caseSensitive ? text.data : text.data.toLowerCase();
      let from = 0;
      while (from <= haystack.length - comparable.length) {
        const start = haystack.indexOf(comparable, from);
        if (start < 0) break;
        const range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + comparable.length);
        ranges.push(range);
        if (ranges.length >= limit) return ranges;
        from = start + comparable.length;
      }
    }
    node = walker.nextNode();
  }
  return ranges;
}

function conversationFindAnchor(root: ParentNode, entryId: string | undefined | null): HTMLElement | null {
  if (!entryId || typeof CSS === "undefined" || typeof CSS.escape !== "function") return null;
  return root.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(entryId)}"]`);
}

/**
 * Closest anchored message to an entry that has no DOM anchor of its own.
 * Grouped process messages (thinking / tool calls / tool results) render inside
 * a shared process-group element, so a hit there can only be located by turn.
 */
function nearestConversationFindAnchor(
  root: HTMLElement,
  entryId: string,
  entryIds: readonly string[],
): HTMLElement | null {
  const targetIndex = entryIds.indexOf(entryId);
  if (targetIndex < 0) return null;
  let best: HTMLElement | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  root.querySelectorAll<HTMLElement>("[data-entry-id]").forEach((anchor) => {
    const anchorId = anchor.dataset.entryId;
    if (!anchorId) return;
    const anchorIndex = entryIds.indexOf(anchorId);
    if (anchorIndex < 0) return;
    const distance = Math.abs(anchorIndex - targetIndex);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = anchor;
    }
  });
  return best;
}

function applyConversationFindHighlights(
  root: HTMLElement,
  query: string,
  activeHit: ConversationFindHit | null,
): Range | null {
  ensureConversationFindHighlightStyle();
  const support = conversationHighlightSupport();
  if (!support) return null;

  const allRanges = conversationFindRangesIn(root, query, false);
  let activeRange: Range | null = null;
  const anchor = conversationFindAnchor(root, activeHit?.entryId);
  if (activeHit && anchor) {
    const anchorRanges = conversationFindRangesIn(anchor, query, false);
    if (anchorRanges.length > 0) {
      // `occurrence` counts model-level hits; collapsed or deferred blocks may
      // not be mounted, so clamp to the nearest rendered occurrence instead of
      // dropping the active highlight entirely.
      activeRange = anchorRanges[Math.min(Math.max(activeHit.occurrence, 0), anchorRanges.length - 1)] ?? null;
    }
  }

  const allHighlight = new support.Highlight(...allRanges) as ConversationHighlightLike;
  allHighlight.priority = 0;
  support.registry.set(CONVERSATION_FIND_HIGHLIGHT, allHighlight);

  const activeHighlight = new support.Highlight(...(activeRange ? [activeRange] : [])) as ConversationHighlightLike;
  activeHighlight.priority = 1;
  support.registry.set(CONVERSATION_FIND_ACTIVE_HIGHLIGHT, activeHighlight);

  return activeRange;
}

function clearConversationFindHighlights(): void {
  const support = conversationHighlightSupport();
  if (!support) return;
  support.registry.delete(CONVERSATION_FIND_HIGHLIGHT);
  support.registry.delete(CONVERSATION_FIND_ACTIVE_HIGHLIGHT);
}

// fork:zc-02 — cap on how much history the find bar pages in before it reports
// partial results; unbounded loading would turn a search in a 5k-message session
// into hundreds of requests.
const CONVERSATION_FIND_MAX_SEARCH_MESSAGES = 2000;
// fork:zc-02 — 把窗口撑到命中处时多带几条，避免命中恰好贴在可视区边缘。
const CONVERSATION_FIND_REVEAL_MARGIN = 8;

const CHAT_MINIMAP_WIDTH = 36;
const CHAT_COLUMN_PADDING = 16;
/* 消息列的定宽只有一个来源（ChatAppearance.test.mjs 钉着这一条）：窄屏只是把
   横向内距让给 `.m-scroll`，max-width 这一格两个形态是同一个值，所以只写一次。 */
const CHAT_COLUMN_MAX_WIDTH = "var(--chat-content-max-width, 800px)";
// fork:ui-22 — density scales the column gutter too; the value stays a CSS calc so
// the density hook only has to write one variable.
const CHAT_COLUMN_PADDING_CSS = `calc(${CHAT_COLUMN_PADDING}px * var(--fork-density, 1))`;
// A dialog replacing another one within this window is a single interaction
// (e.g. select followed by a free-text input) and must not re-ring.
const EXTENSION_DIALOG_SOUND_MIN_GAP_MS = 2000;
// fork:extension-ui-queue —— 两类弹层各自的叠层高度（对话框在 custom 面板之下，与改动前一致）。
const EXTENSION_DIALOG_STACK_Z_INDEX = 90;
const EXTENSION_CUSTOM_STACK_Z_INDEX = 95;

/**
 * fork:extension-ui-queue —— 扩展弹层的宿主叠层。
 *
 * 原来每个弹层自己带一份 `position: absolute; inset: 0` 的 overlay，只有一个弹层时与
 * 现在逐格同形；排队之后同一个宿主里摞着放，几格从上往下排、离输入框最近的是最新来的。
 *
 * 尺寸都留在各自那一格身上（这一层只有内边距与缝）：单条队列时几何与改动前逐像素相同，
 * `verify:boards` 的画板 50 量到的还是同一个框。
 */
function ExtensionOverlayStack({ zIndex, children }: { zIndex: number; children: ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex,
        display: "flex",
        flexDirection: "column",
        // 最新的那格贴在输入框正上方，与「折叠 / 展开都停在消息区底部」的旧行为同源。
        justifyContent: "flex-end",
        alignItems: "center",
        gap: "var(--s2)",
        padding: 20,
        // 两格加不下一屏时（并行审批的多个对话框）从这一层滚，弹层本身不缩。
        overflowY: "auto",
        pointerEvents: "none",
      }}
    >
      {children}
    </div>
  );
}

function NewSessionUpdateLink({
  label,
}: {
  label: (version: string) => string;
}) {
  const [update, setUpdate] = useState<AppUpdateResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/app-update", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<AppUpdateResponse>;
      })
      .then((result) => {
        if (result?.updateAvailable && result.latestVersion && result.releaseUrl) {
          setUpdate(result);
        }
      })
      .catch(() => {
        // Update checks are best-effort and must not interrupt a new session.
      });
    return () => controller.abort();
  }, []);

  if (!update) return null;
  const accessibleLabel = label(update.latestVersion);

  return (
    <a
      href={update.releaseUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={accessibleLabel}
      aria-label={accessibleLabel}
      onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        alignSelf: "center",
        gap: "var(--space-icon)",
        minHeight: "var(--control-md)",
        minWidth: 0,
        padding: "0 4px",
        background: "transparent",
        borderRadius: "var(--radius-xs)",
        color: "var(--accent)",
        fontSize: TEXT.sm,
        fontWeight: 600,
        lineHeight: 1.2,
        textDecoration: "none",
        transition: "background 0.12s",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>v{update.latestVersion}</span>
      <i data-ico="arrow-up-right" data-size="12" aria-hidden="true"></i>
    </a>
  );
}

function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks.some((block) => (
    block.type === "image" || (block.type === "text" && block.text.trim().length > 0)
  ));
}

function findFinalAssistantIndex(messages: AgentMessage[], userIdx: number, endIdx: number): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (hasFinalAssistantAnswer(messages[candidateIdx])) return candidateIdx;
  }
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
  }
  return -1;
}

function getUserInputText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") {
    const text = message.content.trim();
    return text.length > 0 ? text : null;
  }
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

/** 一组过程的时间跨度（秒）：第一条落盘 → 最后一条落盘。
 *  画板 M-02 帧 A 的摘要行第三格就是它（`11.2s`）。`timestamp` 是毫秒
 *  （与 MessageView 的 `stepDurationSec` 同一口径，见 fix:turn-stats）。 */
function processSpanSec(list: readonly unknown[], from: number, to: number): number | null {
  let first: number | undefined;
  let last: number | undefined;
  for (let i = Math.max(0, from); i <= Math.min(list.length - 1, to); i++) {
    const ts = (list[i] as { timestamp?: number } | undefined)?.timestamp;
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    if (first === undefined) first = ts;
    last = ts;
  }
  if (first === undefined || last === undefined || last <= first) return null;
  return (last - first) / 1000;
}

function ProcessDetailsGroup({ messageCount, toolCallCount, defaultExpanded = false, reveal = false, summaryText, summaryParts, status = "done", durationSec = null, children, t }: { messageCount: number; toolCallCount: number; defaultExpanded?: boolean; reveal?: boolean; summaryText?: string; /** fork:v5-landing —— 摘要的**分段形**（失败格进 `.d-err`）。 */ summaryParts?: { text: string; err?: boolean }[]; status?: "running" | "done"; durationSec?: number | null; children: ReactNode; t: (key: string, params?: Record<string, string | number>) => string }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  // fork:v5-wave-b —— 手机上「过程默认**折叠成一行摘要**」（画板 M-02 帧 A 原话）：
  // 收起态就是一块 `.m-tool` 的 `.m-tool-head` —— 图标 + 摘要 + grow + chevron。
  // 桌面继续 D-03d 的 `.d-card` + `.d-card-head`。默认收起这件事本身两形态一致
  // （defaultExpanded=false），这里只换形状。
  const isPwa = usePwaSkin();
  useLayoutEffect(() => {
    if (reveal) setExpanded(true);
  }, [reveal]);
  // The grouped renderer supplies its own summary (tool count, failures,
  // thoughts). Composing the default label on top of it produced two stacked
  // count lines — "处理详情 · 29 条消息 · 29 次工具调用" above
  // "29 次工具调用 · 5 段思考" — so the caller can replace it wholesale.
  const parts = [t("chat.processDetails"), `${messageCount} ${t(messageCount === 1 ? "chat.message" : "chat.messages")}`];
  if (toolCallCount > 0) parts.push(`${toolCallCount} ${t(toolCallCount === 1 ? "chat.toolCall" : "chat.toolCalls")}`);
  const label = summaryText ?? parts.join(" · ");
  const open = expanded || reveal;
  // fork:design-motion —— 组体与步骤正文走同一套折叠动画（画板 11「展开折叠」）：
  // 外层 grid 壳常驻、行高 0fr↔1fr，正文在收起过渡结束后才卸载。
  const collapseRef = useRef<HTMLDivElement>(null);
  const bodyMounted = useCollapsePresence(open, undefined, collapseRef);
  // fork:design-components —— 状态徽标（画板 D-03d 帧 A：进行中为无修饰 `.d-badge` +
  // 旋转 loader，已完成为 `.d-badge.ok`）。没有「失败」档：一轮里有工具报错是**过程中**的
  // 事实，不是这一轮的终态 —— 抬头挂「失败」会把「跑完了、但有两条命令没跑通」直接读成
  // 「这一轮失败了」。画板也只画 进行中 / 已完成 两档，失败信息本来就在计数里。
  const badge = status === "running"
    ? { cls: "", icon: "loader-circle", text: t("process.running") }
    : { cls: "ok", icon: "check", text: t("process.done") };

  return (
    // fork:design-components —— 过程时间轴外壳 = 画板 D-03d 帧 A 的 `.d-card`：
    // 头行（chevron + 计数汇总 + 状态徽标 + 展开/收起）与 `.d-card-body` 都来自 system.css。
    // 折叠态把 `.d-card-head` 的下边线收掉（否则收起时像一条悬空分隔）。
    // fork:v5-wave-b —— 窄屏换成 M-02 帧 A 的 `.m-tool` + `.m-tool-head`：
    // 收起态那一行是「图标 + 过程摘要 + 徽章 + chevron」，没有展开/收起文字提示
    // （手机上那一句会把它顶成两行）。展开态的正文是 `.m-doc-body`。
    // fork:proc-card-weight —— 摘要行不是标题，字重回落正文（在
    // app/design/v5-forms.css 的接线层落，不改库里的 .d-card-head）。
    // fork:digest-weight（用户 2026-10-05）—— **不再加粗首格**：`.d-card-head` 已经是
    // 400，再套一个 `<b>` 只让「14 条命令」这一格跳出来，比旁边几格重一档（用户要
    // 「常规」）。竖线与 `.d-card-head` 同色（`.d-grow`）那一格仍留着，用来把摘要
    // 顶到行的左缘 —— 它不承担强调。
    <div className={`${isPwa ? "m-tool" : "d-card"} fork-proc-card`}>
      <button
        type="button"
        className={isPwa ? "m-tool-head" : "d-card-head"}
        aria-expanded={open}
        onClick={() => setExpanded((v) => !v)}
        title={open ? t("chat.collapseProcess") : t("chat.expandProcess")}
        style={{ width: "100%", cursor: "pointer", textAlign: "left", borderBottom: !isPwa && !open ? "none" : undefined }}
      >
        {isPwa && <i data-ico="list-checks" data-size="14" aria-hidden="true"></i>}
        {!isPwa && (
          <i
            data-ico="chevron-down"
            data-size="14"
            aria-hidden="true"
            style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform var(--nx-dur-2) var(--nx-ease)" }}
          ></i>
        )}
        <span className={isPwa ? "m-grow" : "d-grow"} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {/* fork:v5-landing —— 画板 D-03d 帧 A：`<b>2 个文件</b> · 5 条命令 · …
              <span class="d-err">1 次失败</span> · 2 段思考`。有分段就逐段渲染，
              没有（调用方只给了字符串）才回落到原来的单段文本。
              fork:digest-weight —— 首格的 `<b>` 已按用户裁定去掉（见上）。 */}
          {summaryParts
            ? summaryParts.map((part, index) => (
              <Fragment key={`${part.text}-${index}`}>
                {index > 0 && " · "}
                {part.err
                  ? <span className="d-err">{part.text}</span>
                  : part.text}
              </Fragment>
            ))
            : label}
        </span>
        {/* fork:v5-frame-audit（2026-10-05）—— 窄屏摘要行照画板 M-02 帧 A 逐节点抄：
            `图标 · 摘要 · 元信息 · 箭头`。元信息格（`.m-t-xs.m-t-faint`）装**这一组
            跑了多久**（帧 A 的 `11.2s`）；还在跑就写「运行中」——画板把状态徽章放在
            **单张工具卡**的抬头（帧 B/C 的 `.m-badge.ok` / `.m-badge.bad`），而产品的
            单步形态是 `.m-step-row`（帧 C 的 `.m-steps`），徽章落在那里；过程**组**这一层
            按帧 A 只留元信息格。桌面那一支一字未动（徽章 + 展开/收起提示仍在）。 */}
        {isPwa ? (
          <span className="m-t-xs m-t-faint">
            {status === "running" ? t("process.running") : durationSec !== null ? formatDuration(durationSec) : ""}
          </span>
        ) : (
          <>
            <span className="d-badge">
              {status === "running" ? (
                <span className="d-run"><i data-ico={badge.icon} data-size="11" aria-hidden="true"></i></span>
              ) : (
                <i data-ico={badge.icon} data-size="11" aria-hidden="true"></i>
              )}
              {badge.text}
            </span>
            <span className="d-t-xs d-t-faint">{open ? t("i18n.collapse") : t("i18n.expand")}</span>
          </>
        )}
        {isPwa && (
          <i
            data-ico="chevron-down"
            data-size="14"
            aria-hidden="true"
            style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform var(--nx-dur-2) var(--nx-ease)" }}
          ></i>
        )}
      </button>
      <div ref={collapseRef} className="fork-collapse" data-fork-collapse={open ? "open" : "closed"}>
        {bodyMounted && <div className={`fork-collapse-body ${isPwa ? "m-doc-body" : "d-card-body"}`}>{children}</div>}
      </div>
    </div>
  );
}

export function ChatWindow({ session, searchTarget, onSearchTargetHandled, initialScrollPosition, onScrollPositionChange, sessionRunning, reloadToken, newSessionCwd, newSessionDraftKey, onAgentEnd, onAgentError, onAttentionNeeded, onSessionCreated, onSessionForked, onOpenSessionPane, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSystemToolsChange, onSystemInfoLoaderChange, onSessionStatsChange, onSessionStatsPanelOpen, onOpenSettingsSection, onContextUsageChange, onExtensionStatusChange, actionPanel, onOpenFile, onOpenSession, onOpenSkill, onAskInNewChat, quoteSelectionEnabled = false, initialPrompt, onInitialPromptConsumed, newSessionTargets = null, soundEnabled = true, onSoundToggle, playDoneSound = () => {}, unlockAudio, onEmptyChange, }: Props) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  // fork:v5-wave-n1 —— 窄屏形态（画板 M-02 / M-11）：m-* 分支的信号，与
  // components/pwa/skin 的约定一致（窄屏 = ≤640px = PWA 形态）。
  const isPwa = usePwaSkin();
  const completionNotificationsEnabled = session?.relation?.kind !== "subagent";

  // Wrap onAgentEnd to play the completion sound. This is more reliable than
  // wrapping handleAgentEventRef because useAgentSession overwrites that ref
  // on every render (it syncs the latest callback), which would blow away an
  // externally-installed wrapper after the first re-render.
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;
  const soundedExtensionDialogIdRef = useRef<string | null>(null);
  const extensionDialogLastSoundAtRef = useRef(0);
  const wrappedOnAgentEnd = useCallback((end: AgentEndInfo) => {
    // fork:pi-1.1 —— 被停掉的运行不播完成音（pi 的 agent_settled.aborted）。
    if (completionNotificationsEnabled && soundEnabledRef.current && !end.aborted) {
      playDoneSoundRef.current();
    }
    onAgentEnd?.(end);
  }, [completionNotificationsEnabled, onAgentEnd]);

  // 稳定化 onEditContent 引用，配合 React.memo 防止历史消息重渲染
  const handleEditContent = useCallback((message: UserMessage) => {
    chatInputRef?.current?.replaceMessage(message);
  }, [chatInputRef]);

  const initialScrollPositionRef = useRef(searchTarget ? null : initialScrollPosition ?? null);
  const [pendingScrollRestore, setPendingScrollRestore] = useState<Extract<ChatScrollPosition, { atBottom: false }> | null>(() => {
    const position = initialScrollPositionRef.current;
    return position && !position.atBottom ? position : null;
  });
  const [restoreAnchorReady, setRestoreAnchorReady] = useState(false);
  // Lifted expanded state for tool calls — survives streaming re-renders and
  // stream → history promotion (keyed by toolCallId, fallback to stream/entry index).
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(() => new Set());
  const handleToggleTool = useCallback((id: string) => {
    setExpandedToolIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  useEffect(() => {
    setExpandedToolIds(new Set());
  }, [session?.id]);

  // fork:design-system PR-05 — 切会话属于设计里的「整块替换」：
  // 新内容 200ms（--motion-transition）+ 8px 上移（--motion-rise）。
  // 用 class 重播而不是换 key，避免把整棵转录 DOM 重建（展开态、滚动位置都在里面）。
  const [turnSwapping, setTurnSwapping] = useState(false);
  const turnSwapSkippedRef = useRef(true);
  useEffect(() => {
    if (turnSwapSkippedRef.current) {
      turnSwapSkippedRef.current = false;
      return;
    }
    setTurnSwapping(true);
    // 200 与 --motion-transition 同值；这里只需要在动画播完时摘掉 class。
    const id = window.setTimeout(() => setTurnSwapping(false), 200);
    return () => window.clearTimeout(id);
  }, [session?.id]);

  // fork:ui-stats-ring — composer 下方的统计长条已删除（用户裁定：输入框下面
  // 不再放任何常驻行），完整统计收进上下文环浮窗；/session 与外部入口改为钉住浮窗。
  const handleSessionStatsPanelOpen = useCallback(() => {
    chatInputRef?.current?.openStatsPopover();
    onSessionStatsPanelOpen?.();
  }, [chatInputRef, onSessionStatsPanelOpen]);

  const {
    loading, error, messages, activeToolResults, entryIds, historyCursor, hasEarlierMessages, streamState,
    refreshing, refreshAfterReload,
    agentRunning, bashRunning, pendingBash, modelNames, modelList, modelError, modelScopeWarnings, modelThinkingLevels, modelThinkingLevelMaps, toolPreset, thinkingLevel,
    retryInfo, retryNotices, contextUsage, forkingEntryId,
    isCompacting, compactError, compactResult, displayModel: displayModelValue, modelSwitching, sessionStats,
    // fork:proma-37-deferred-model
    nextTurnModel: nextTurnModelValue,
    slashCommands, slashCommandsLoading, queuedMessages,
    notices, extensionDialogs, extensionCustomUis, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput, setNoticePaused,
    isAutoModelSelection,
    agentPhase,
    isNew,
    showScrollToBottom,
    sessionIdRef, scrollContainerRef,
    lastUserMsgRef, promptAnchorActive,
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue,
    // fork:proma-04-rewind
    handleRewind, rewinding,
    // fork:proma-02-mode
    permissionMode, handlePermissionModeChange,
    // fork:gap04-queue
    handleQueueRemove, handleQueueMove, handleQueuePromote, handleQueueEdit,
    handleBuiltinSlashCommand,
    handleToolPresetChange, handleThinkingLevelChange, loadSlashCommands, scrollUserMsgToTop,
    loadContext, activeLeafId, scrollToBottom, scrollToMessage,
    // fork:proma-37-deferred-model
    handlePendingModelCancel,
  } = useAgentSession({
    session, sessionRunning, newSessionCwd, newSessionDraftKey, onAgentEnd: wrappedOnAgentEnd, onAgentError, onAttentionNeeded, onSessionCreated, onSessionForked,
    modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSystemToolsChange, onSystemInfoLoaderChange, onSessionStatsPanelOpen: handleSessionStatsPanelOpen, onOpenSettings: onOpenSettingsSection,
    deferInitialScroll: Boolean(pendingScrollRestore),
  });
  const sessionBusy = agentRunning || bashRunning;

  const locateSelectionContext = useCallback((context: SelectionContext) => {
    const clearConversationLocation = () => {
      scrollContainerRef.current?.querySelectorAll<HTMLElement>(`.${LOCATION_HIGHLIGHT_CLASS}`).forEach((highlight) => {
        highlight.classList.remove(LOCATION_HIGHLIGHT_CLASS);
      });
      // Do this before the workspace starts switching tabs. Otherwise the
      // source/preview viewer can interpret the old chat selection as a new
      // workspace selection and open its action popover.
      window.getSelection()?.removeAllRanges();
      clearLocationTextHighlight();
    };
    clearConversationLocation();
    if (context.sourceFilePath) {
      onOpenFile?.(context.sourceAbsolutePath ?? context.sourceFilePath, {
        sourceSessionId: context.sourceSessionId,
        startLine: context.sourceStartLine,
        endLine: context.sourceEndLine,
        text: context.text,
      });
      return;
    }
    if (!context.sourceEntryId) return;
    const selector = `[data-entry-id="${CSS.escape(context.sourceEntryId)}"]`;
    const element = scrollContainerRef.current?.querySelector<HTMLElement>(selector);
    if (!element) return;
    scrollToMessage(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    const range = rangeFromTextOffsets(
      element,
      context.sourceStartOffset ?? -1,
      context.sourceEndOffset ?? -1,
      context.text,
    );
    if (!range) return;
    element.classList.add(LOCATION_HIGHLIGHT_CLASS);
    setLocationTextHighlight(range);
    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const rangeRect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const padding = 16;
      const delta = rangeRect.top < containerRect.top + padding
        ? rangeRect.top - (containerRect.top + padding)
        : rangeRect.bottom > containerRect.bottom - padding
          ? rangeRect.bottom - (containerRect.bottom - padding)
          : 0;
      if (delta) container.scrollBy({ top: delta, behavior: "instant" });
    });
  }, [onOpenFile, scrollContainerRef, scrollToMessage]);

  useEffect(() => {
    const clearConversationLocation = () => {
      scrollContainerRef.current?.querySelectorAll<HTMLElement>(`.${LOCATION_HIGHLIGHT_CLASS}`).forEach((highlight) => {
        highlight.classList.remove(LOCATION_HIGHLIGHT_CLASS);
      });
      clearLocationTextHighlight();
    };
    const clearOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearConversationLocation();
    };
    document.addEventListener("pointerdown", clearConversationLocation, true);
    document.addEventListener("keydown", clearOnKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", clearConversationLocation, true);
      document.removeEventListener("keydown", clearOnKeyDown, true);
      clearConversationLocation();
    };
  }, [scrollContainerRef]);

  const [quotedSelection, setQuotedSelection] = useState<{
    text: string;
    top: number;
    left: number;
    sourceEntryId?: string;
  } | null>(null);
  const [quoteInputOpen, setQuoteInputOpen] = useState(false);
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quotePopoverRef = useRef<HTMLDivElement | null>(null);
  const quoteChatInputRef = useRef<ChatInputHandle | null>(null);
  const closeQuotedSelection = useCallback(() => {
    setQuotedSelection(null);
    setQuoteInputOpen(false);
    setQuoteError(null);
  }, []);

  useEffect(() => {
    if (!quoteSelectionEnabled) closeQuotedSelection();
  }, [quoteSelectionEnabled, closeQuotedSelection]);

  const captureQuotedSelection = useCallback(() => {
    if (!quoteSelectionEnabled || quoteInputOpen) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const root = messageContentRef.current;
    if (!selection || selection.isCollapsed || !range || !root || !root.contains(range.commonAncestorContainer)) {
      setQuotedSelection(null);
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      setQuotedSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer as Element
      : range.commonAncestorContainer.parentElement;
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element
      : range.startContainer.parentElement;
    const end = range.endContainer.nodeType === Node.ELEMENT_NODE
      ? range.endContainer as Element
      : range.endContainer.parentElement;
    const sourceEntryId = [ancestor, start, end]
      .map((element) => element?.closest<HTMLElement>("[data-message-role=\"assistant\"]")?.dataset.entryId)
      .find((entryId): entryId is string => Boolean(entryId));
    setQuotedSelection({
      text,
      top: Math.min(window.innerHeight - 44, rect.bottom + 8),
      left: Math.max(64, Math.min(window.innerWidth - 64, rect.left + rect.width / 2)),
      sourceEntryId,
    });
  }, [quoteSelectionEnabled, quoteInputOpen]);

  useEffect(() => {
    if (!quoteInputOpen || !quotedSelection) return;
    quoteChatInputRef.current?.insertIfEmpty(buildQuotedSelection(
      quotedSelection.text,
      t("chat.quoteIntro"),
      t("chat.quoteQuestion"),
    ));
  }, [quoteInputOpen, quotedSelection, t]);

  useLayoutEffect(() => {
    const popover = quotePopoverRef.current;
    if (!popover || !quotedSelection) return;
    const viewport = window.visualViewport;
    const position = () => {
      const rect = popover.getBoundingClientRect();
      const top = viewport?.offsetTop ?? 0;
      const left = viewport?.offsetLeft ?? 0;
      popover.style.top = `${Math.max(top + 8, Math.min(quotedSelection.top, top + (viewport?.height ?? window.innerHeight) - rect.height - 8))}px`;
      popover.style.left = `${Math.max(left + 8, Math.min(quotedSelection.left - rect.width / 2, left + (viewport?.width ?? window.innerWidth) - rect.width - 8))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(popover);
    window.addEventListener("resize", position);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  }, [quotedSelection, quoteInputOpen, quoteError]);

  useEffect(() => {
    if (!quotedSelection) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!quoteInputOpen && !quotePopoverRef.current?.contains(event.target as Node)) closeQuotedSelection();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      if (!quoteSubmitting) closeQuotedSelection();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [quotedSelection, quoteInputOpen, quoteSubmitting, closeQuotedSelection]);

  const askSelectionHere = useCallback(() => {
    if (!quotedSelection) return;
    chatInputRef?.current?.addSelectionContext({
      id: createSelectionContextId(),
      text: quotedSelection.text,
      sourceSessionId: sessionIdRef.current ?? session?.id,
      sourceEntryId: quotedSelection.sourceEntryId,
      label: t("chat.selectedText"),
    });
    window.getSelection()?.removeAllRanges();
    closeQuotedSelection();
  }, [chatInputRef, quotedSelection, closeQuotedSelection, session?.id, sessionIdRef, t]);

  const askSelectionInNewChat = useCallback(async (prompt: string) => {
    const sourceSessionId = sessionIdRef.current ?? session?.id;
    if (quoteSubmitting || !prompt.trim() || !quotedSelection?.sourceEntryId || !sourceSessionId || !onAskInNewChat) return;
    setQuoteSubmitting(true);
    setQuoteError(null);
    unlockAudio?.();
    try {
      await onAskInNewChat(
        prompt,
        sourceSessionId,
        quotedSelection.sourceEntryId,
      );
      closeQuotedSelection();
    } catch (error) {
      quoteChatInputRef.current?.restoreSubmission(prompt);
      setQuoteError(error instanceof Error ? error.message : String(error));
    } finally {
      setQuoteSubmitting(false);
    }
  }, [onAskInNewChat, quotedSelection, quoteSubmitting, session?.id, sessionIdRef, closeQuotedSelection, unlockAudio]);

  const initialPromptSentRef = useRef(false);
  useEffect(() => {
    if (loading || error || !initialPrompt || initialPromptSentRef.current) return;
    initialPromptSentRef.current = true;
    onInitialPromptConsumed?.();
    void handleSend(initialPrompt);
  }, [initialPrompt, loading, error, handleSend, onInitialPromptConsumed]);

  useEffect(() => {
    // fork:extension-ui-queue —— 队列的队首上屏才响：答掉一个之后下一个才冒出来，
    // 由下面那个最短间隔兼掉这一串连锁响。
    const headDialogId = extensionDialogs[0]?.id ?? null;
    if (
      !completionNotificationsEnabled
      || !headDialogId
      || soundedExtensionDialogIdRef.current === headDialogId
    ) return;
    soundedExtensionDialogIdRef.current = headDialogId;
    const now = Date.now();
    if (now - extensionDialogLastSoundAtRef.current < EXTENSION_DIALOG_SOUND_MIN_GAP_MS) return;
    extensionDialogLastSoundAtRef.current = now;
    playDoneSoundRef.current();
  }, [completionNotificationsEnabled, extensionDialogs]);

  // Register the abort handler for the global Esc shortcut
  useEffect(() => {
    registerAbortHandler(sessionBusy ? handleAbort : null);
  }, [sessionBusy, handleAbort]);

  // --- Lazy-load historical messages ---
  // Only render the last N messages initially. When the user scrolls to the
  // top, load another page while keeping the scroll position stable.
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const messageContentRef = useRef<HTMLDivElement | null>(null);
  const prevScrollDistanceRef = useRef<number | null>(null);
  // fork:zm-03 — 滚动跟随权 + prepend 锚点（纯逻辑见 lib/scroll-follow.ts）。
  // followingRef 只由真实用户输入改变；程序化滚动（流式贴底 / resize / prepend）读取它。
  const followingRef = useRef(initialFollowing());
  const prependAnchorRef = useRef<ScrollAnchorSample | null>(null);
  const programmaticScrollTargetRef = useRef<number | null>(null);
  const layoutShiftUntilRef = useRef(0);
  const userIntentRef = useRef<ScrollIntent>("none");
  const touchYRef = useRef<number | null>(null);
  // fork:zm-03 — 发消息后 `scrollUserMsgToTop` 会把消息顶到视口顶部（远离底部）；
  // 这次程序化滚动必须保持 following=true，否则随后的流式内容会被否决权挡住。
  // 用短窗口而不是布尔量：万一那次滚动没产生事件，窗口过期后不会误判用户滚动。
  const sendFollowUntilRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const restoreStartedRef = useRef(false);
  const pendingScrollRestoreRef = useRef(pendingScrollRestore);
  pendingScrollRestoreRef.current = pendingScrollRestore;
  const [pendingSearchScroll, setPendingSearchScroll] = useState<Props["searchTarget"]>(null);
  const searchMessage = messages[entryIds.indexOf(pendingSearchScroll?.entryId ?? "")];
  const searchBlock = searchMessage?.role === "assistant"
    ? (pendingSearchScroll?.blockIndex === undefined
      ? searchMessage.content.find((block) => block.type === "text")
      : searchMessage.content[pendingSearchScroll.blockIndex])
    : undefined;
  const searchHistoryRef = useRef({ entryIds, historyCursor, hasEarlierMessages });
  searchHistoryRef.current = { entryIds, historyCursor, hasEarlierMessages };

  useLayoutEffect(() => {
    const sessionId = session?.id;
    const container = scrollContainerRef.current;
    const content = messageContentRef.current;
    if (!sessionId || !onScrollPositionChange || !container || !content) return;
    return () => {
      if (pendingScrollRestoreRef.current) return;
      if (isScrollAtTail(container.scrollTop, container.clientHeight, container.scrollHeight)) {
        onScrollPositionChange(sessionId, { atBottom: true });
        return;
      }
      const viewportTop = container.getBoundingClientRect().top;
      const candidates = Array.from(content.children).flatMap((element) => {
        if (!(element instanceof HTMLElement) || !element.dataset.entryId) return [];
        const rect = element.getBoundingClientRect();
        return [{ entryId: element.dataset.entryId, top: rect.top, bottom: rect.bottom }];
      });
      const anchor = findChatScrollAnchor(candidates, viewportTop);
      if (!anchor) return;
      onScrollPositionChange(sessionId, {
        atBottom: false,
        ...anchor,
        oldestEntryId: searchHistoryRef.current.historyCursor,
      });
    };
  }, [loading, onScrollPositionChange, scrollContainerRef, session?.id]);

  useEffect(() => {
    if (searchTarget) setPendingScrollRestore(null);
  }, [searchTarget]);

  useEffect(() => {
    const position = pendingScrollRestore;
    const sessionId = session?.id;
    if (!position || !sessionId || loading || searchTarget || restoreStartedRef.current) return;
    restoreStartedRef.current = true;
    const controller = new AbortController();

    const locate = async () => {
      const initialHistory = searchHistoryRef.current;
      if (initialHistory.entryIds.includes(position.anchorEntryId)) {
        setVisibleCount((current) => Math.max(current, initialHistory.entryIds.length * 2));
        setRestoreAnchorReady(true);
        return;
      }

      loadingOlderRef.current = true;
      let before = initialHistory.historyCursor;
      let hasMore = initialHistory.hasEarlierMessages;
      try {
        while (hasMore && before && !controller.signal.aborted) {
          const context = await loadContext(sessionId, activeLeafId, before, { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (!context) {
            scrollToBottom("instant");
            setPendingScrollRestore(null);
            return;
          }
          setVisibleCount((current) => current + Math.max(VISIBLE_PAGE_SIZE, context.messages.length * 2));
          if (context.entryIds.includes(position.anchorEntryId)) {
            setRestoreAnchorReady(true);
            return;
          }
          if (context.oldestEntryId === position.oldestEntryId) break;
          before = context.oldestEntryId;
          hasMore = context.hasMore;
        }
        if (!controller.signal.aborted) {
          scrollToBottom("instant");
          setPendingScrollRestore(null);
        }
      } finally {
        loadingOlderRef.current = false;
      }
    };

    void locate();
    return () => {
      controller.abort();
      // A branch change cancels restoration and must reveal the new context.
      setPendingScrollRestore(null);
    };
  }, [activeLeafId, loadContext, loading, pendingScrollRestore, scrollToBottom, searchTarget, session?.id]);

  useLayoutEffect(() => {
    const position = pendingScrollRestore;
    const content = messageContentRef.current;
    if (!position || !content || searchTarget) return;
    const element = Array.from(content.children).find((candidate) => (
      candidate instanceof HTMLElement && candidate.dataset.entryId === position.anchorEntryId
    ));
    if (element instanceof HTMLElement) {
      scrollToMessage(element, position.anchorOffset);
      setPendingScrollRestore(null);
      return;
    }
    if (restoreAnchorReady) {
      scrollToBottom("instant");
      setPendingScrollRestore(null);
    }
  }, [entryIds, pendingScrollRestore, restoreAnchorReady, scrollToBottom, scrollToMessage, searchTarget, visibleCount]);

  // 设置里的「重载会话」：就地刷新（转录列降到 0.5 等着），不再 remount 整个窗口。
  const lastReloadToken = useRef(reloadToken);
  useEffect(() => {
    if (reloadToken === lastReloadToken.current) return;
    lastReloadToken.current = reloadToken;
    void refreshAfterReload();
  }, [reloadToken, refreshAfterReload]);

  useEffect(() => {
    if (!searchTarget || loading) return;
    const controller = new AbortController();
    const locate = async () => {
      const history = searchHistoryRef.current;
      let found = history.entryIds.includes(searchTarget.entryId);
      if (!found && !sessionBusy && history.hasEarlierMessages && history.historyCursor && !loadingOlderRef.current) {
        loadingOlderRef.current = true;
        const container = scrollContainerRef.current;
        if (container) prevScrollDistanceRef.current = captureScrollDistance(container.scrollHeight, container.scrollTop);
        // ponytail: one extra page of 200 entries; deeper or other-branch hits just open the session.
        const context = await loadContext(searchTarget.sessionId, activeLeafId, history.historyCursor, { tail: 200, signal: controller.signal });
        loadingOlderRef.current = false;
        found = Boolean(context?.entryIds.includes(searchTarget.entryId));
      }
      if (controller.signal.aborted) return;
      if (found) {
        prevScrollDistanceRef.current = null;
        setVisibleCount((current) => Math.max(current, (searchHistoryRef.current.entryIds.length + 200) * 2));
        setPendingSearchScroll(searchTarget);
      } else {
        onSearchTargetHandled?.(searchTarget);
      }
    };
    void locate();
    return () => controller.abort();
  }, [searchTarget, loading, activeLeafId, sessionBusy, loadContext, onSearchTargetHandled, scrollContainerRef]);

  useLayoutEffect(() => {
    if (!pendingSearchScroll || pendingSearchScroll !== searchTarget) return;
    const selector = `[data-entry-id="${CSS.escape(pendingSearchScroll.entryId)}"]`;
    const element = scrollContainerRef.current?.querySelector<HTMLElement>(searchMessage?.role === "user" ? selector : `${selector} [data-search-target]`);
    if (element) {
      scrollToMessage(element);
      // 画板 05 第 14 项：跳转高亮 1.6s 一次性。此前是一段 WAAPI（2500ms、无强调色边线），
      // 现在是 .fork-jump-flash —— reduced-motion 由 CSS 自己停。
      element.classList.remove("fork-jump-flash");
      void element.offsetWidth;
      element.classList.add("fork-jump-flash");
    }
    setPendingSearchScroll(null);
    onSearchTargetHandled?.(pendingSearchScroll);
  }, [pendingSearchScroll, searchTarget, searchMessage, scrollContainerRef, scrollToMessage, onSearchTargetHandled]);

  // Load one older page of history. Shared by the top sentinel (triggered by
  // scrolling) and the minimap's "Load earlier" row so both paths keep a
  // single in-flight guard and the same scroll-anchoring capture.
  const loadOlderPage = useCallback(async () => {
    // Skip while a page is already loading or nothing older exists.
    if (loadingOlderRef.current) return;
    if (!hasEarlierMessages) return;
    const oldestId = historyCursor;
    if (!oldestId) return;
    const sid = session?.id ?? sessionIdRef.current;
    if (!sid) return;
    const container = scrollContainerRef.current;
    if (container) {
      prevScrollDistanceRef.current = captureScrollDistance(container.scrollHeight, container.scrollTop);
      // fork:zm-03 — prepend 锚定：先记下「视口顶部附近那条消息」的像素偏移，
      // 插入后按同一元素的实时位置把它放回去，而不是只补总高度差。
      prependAnchorRef.current = captureMessageAnchor(container, messageContentRef.current);
    }
    loadingOlderRef.current = true;
    setLoadingEarlier(true);
    try {
      // loadContext handles prepend + scroll anchoring.
      const context = await loadContext(sid, activeLeafId, oldestId);
      if (!context) {
        // 拉取失败：不要让本次采样留给下一次无关的 visibleCount 变化。
        prevScrollDistanceRef.current = null;
        prependAnchorRef.current = null;
      }
    } finally {
      loadingOlderRef.current = false;
      setLoadingEarlier(false);
    }
  }, [activeLeafId, hasEarlierMessages, historyCursor, loadContext, scrollContainerRef, session?.id, sessionIdRef]);

  /* fork:d03-frame-c —— 「读到哪」（画板 D-03 帧 C 的未读分割）。
     离开这条会话时把当前渲染窗口的**末尾**写进 store，回来时凡是排在那个位置
     之后的就是「你离开后发生的」，在它前面画分割线。写末尾而不是「当前视口那条」
     是有意的：分割线是一个稳定的锚点，而滚到哪儿是当下的事。 */
  const latestCountRef = useRef(0);
  latestCountRef.current = messages.length;
  useEffect(() => {
    const sid = session?.id ?? sessionIdRef.current;
    const count = latestCountRef.current;
    return () => {
      if (sid && count > 0) setReadCursor(sid, count);
    };
  }, [session?.id, sessionIdRef]);

  /* fork:d03-frame-c —— 分割线画在第几条：上次离开时看到的末尾（`readCursor`），
     且它必须**已经落在当前渲染窗口里**（窗口没翻到那里就不画 —— 画一条看不见的
     分割线等于没画，而顶栏那枚「N 条新消息」已经告诉用户有更新了）。
     没读数（第一次打开这条会话）给 -1。 */
  const readCursors = useReadCursors();
  const readCursor = (session?.id ?? sessionIdRef.current) ? readCursors[session?.id ?? sessionIdRef.current ?? ""] ?? -1 : -1;
  const unreadDividerIdx = readCursor > 0 && readCursor < messages.length ? readCursor : -1;

  // IntersectionObserver on the sentinel div at the top of the message list.
  // When it becomes visible, load the next page of older messages.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        void loadOlderPage();
      },
      { root: container, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadOlderPage, scrollContainerRef]);

  // Keep the rendered window at least as large as what's loaded, so prepended
  // (older) pages stay visible instead of being sliced off the top.
  useEffect(() => {
    setVisibleCount((current) => Math.max(current, messages.length));
  }, [messages.length]);

  // After visibleCount increases (more messages prepended), restore the
  // scroll position so the viewport doesn't jump.
  //
  // fork:zm-03 — 优先用消息锚点（offsetTop 语义）而不是「距底距离」：图片异步加载、
  // 折叠展开都会改变高度，距底补偿会漂；锚点按像素把同一条消息放回原视口偏移。
  useEffect(() => {
    if (prevScrollDistanceRef.current == null) {
      // 搜索跳转等显式导航会清掉这个 ref 来取消本次恢复；锚点同样清掉。
      prependAnchorRef.current = null;
      return;
    }
    const container = scrollContainerRef.current;
    if (!container) return;
    const savedDistance = prevScrollDistanceRef.current;
    const anchor = prependAnchorRef.current;
    prevScrollDistanceRef.current = null;
    prependAnchorRef.current = null;

    if (anchor) {
      const element = messageContentRef.current?.querySelector<HTMLElement>(
        `[data-entry-id="${CSS.escape(anchor.entryId)}"]`,
      );
      if (element) {
        const target = resolvePrependRestoreScrollTop(anchor, {
          elementViewportTop: element.getBoundingClientRect().top,
          viewportTop: container.getBoundingClientRect().top,
          scrollTop: container.scrollTop,
        });
        if (target !== null) {
          programmaticScrollTargetRef.current = target;
          container.scrollTop = target;
          return;
        }
      }
    }

    const fallback = restoreScrollTop(container.scrollHeight, savedDistance);
    programmaticScrollTargetRef.current = fallback;
    container.scrollTop = fallback;
  }, [visibleCount, scrollContainerRef]);

  // ---------------------------------------------------------------------------
  // fork:zm-03 — 滚动跟随状态机（用户意图优先）。
  //
  // 背景：`useAgentSession` 里的 live-follow 只看自己的 near-bottom 旗标；
  // 一次程序化滚动（流式追加 / 窗口 resize / prepend）就可能把用户读到的位置拉回底部。
  // 这里按来源拆分（user / programmatic / layout）：只有 wheel / touch / 键盘 + 用户
  // 落点能改变 following；此外一律不动。并在 following=false 时否决
  // 「滚到最底」的程序化请求（lib/scroll-follow.ts 的 shouldAllowProgrammaticScroll）。
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const applyFollowing = (next: boolean) => {
      if (followingRef.current === next) return;
      followingRef.current = next;
      // data 属性方便调试与以后按需做样式分支，不参与渲染。
      container.dataset.forkFollowing = next ? "true" : "false";
    };

    const onWheel = (event: WheelEvent) => {
      const intent = wheelScrollIntent(event.deltaY);
      if (intent === "none") return;
      userIntentRef.current = intent;
      layoutShiftUntilRef.current = 0;
      applyFollowing(nextFollowingAfterIntent({
        following: followingRef.current,
        intent,
        metrics: scrollMetricsOf(container),
      }));
    };

    const onTouchStart = (event: TouchEvent) => {
      touchYRef.current = event.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (event: TouchEvent) => {
      const nextY = event.touches[0]?.clientY ?? null;
      const previousY = touchYRef.current;
      touchYRef.current = nextY;
      if (nextY === null || previousY === null) return;
      const intent = touchScrollIntent(previousY, nextY);
      if (intent === "none") return;
      userIntentRef.current = intent;
      layoutShiftUntilRef.current = 0;
      applyFollowing(nextFollowingAfterIntent({
        following: followingRef.current,
        intent,
        metrics: scrollMetricsOf(container),
      }));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editableTarget = Boolean(target && (
        target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.tagName === "SELECT"
        || target.isContentEditable
      ));
      const intent = keyboardScrollIntent({ key: event.key, shiftKey: event.shiftKey, editableTarget });
      if (intent === "none") return;
      userIntentRef.current = intent;
      layoutShiftUntilRef.current = 0;
      applyFollowing(nextFollowingAfterIntent({
        following: followingRef.current,
        intent,
        metrics: scrollMetricsOf(container),
      }));
    };

    const onScroll = () => {
      // 任何带用户意图的滚动都取消「刚发消息」窗口，用户操作永远优先。
      if (userIntentRef.current !== "none") sendFollowUntilRef.current = 0;
      if (
        sendFollowUntilRef.current > Date.now()
        && userIntentRef.current === "none"
        && programmaticScrollTargetRef.current === null
      ) {
        sendFollowUntilRef.current = 0;
        applyFollowing(true);
        return;
      }
      const metrics = scrollMetricsOf(container);
      const pendingTarget = programmaticScrollTargetRef.current;
      let source: ScrollEventSource = "user";
      if (pendingTarget !== null) {
        // 任何 scroll 事件都消费掉待定目标，避免它留给之后的用户滚动误判。
        programmaticScrollTargetRef.current = null;
        if (Math.abs(metrics.scrollTop - pendingTarget) <= 2 || userIntentRef.current === "none") {
          source = "programmatic";
        }
      } else if (userIntentRef.current === "none" && layoutShiftUntilRef.current > Date.now()) {
        source = "layout";
      }
      const intent = userIntentRef.current;
      userIntentRef.current = "none";
      if (source === "user" && intent === "awayFromBottom") {
        // 上滑意图立即生效（哪怕只滑了 10px，仍在 48px 容差内）。
        applyFollowing(false);
        return;
      }
      applyFollowing(resolveFollowingAfterScroll({
        following: followingRef.current,
        metrics,
        source,
      }));
    };

    container.addEventListener("wheel", onWheel, { passive: true });
    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchmove", onTouchMove, { passive: true });
    container.addEventListener("keydown", onKeyDown);
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchmove", onTouchMove);
      container.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("scroll", onScroll);
    };
  }, [scrollContainerRef, session?.id]);

  // fork:zm-03 — 程序化「滚到最底」的否决权。
  // live-follow 在 `useAgentSession` 里调用 `container.scrollTo({ top: scrollHeight })`；
  // 用户已上滑时把它拦住，流式追加就不再抢走阅读位置。其它滚动目标（跳转到某条消息、
  // prepend 锚定）不受影响。
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const originalScrollTo = container.scrollTo;
    const guarded = ((...args: unknown[]) => {
      const first = args[0] as ScrollToOptions | number | undefined;
      const requestedTop = typeof first === "number" ? first : first?.top;
      if (typeof requestedTop === "number" && !shouldAllowProgrammaticScroll({
        requestedTop,
        contentHeight: container.scrollHeight,
        following: followingRef.current,
      })) {
        // 被否决的贴底不会产生 scroll 事件；清掉目标，别留给下一次用户滚动误判。
        programmaticScrollTargetRef.current = null;
        return;
      }
      return (originalScrollTo as (...inner: unknown[]) => void).apply(container, args);
    }) as typeof container.scrollTo;
    container.scrollTo = guarded;
    return () => {
      if (container.scrollTo === guarded) container.scrollTo = originalScrollTo;
    };
  }, [scrollContainerRef, session?.id]);

  // fork:zm-03 — 视口尺寸变化（窗口 resize / 移动端键盘）会让内容重排：
  // 跟随时贴回底部，不跟随时不动（浏览器原生 overflow-anchor 会保住阅读位置）。
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      layoutShiftUntilRef.current = Date.now() + 150;
      if (!followingRef.current) return;
      programmaticScrollTargetRef.current = container.scrollHeight;
      scrollToBottom("auto");
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollContainerRef, scrollToBottom, session?.id]);
  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? [
      sessionStats.sessionId,
      sessionStats.sessionFile ?? "",
      sessionStats.sessionName ?? "",
      sessionStats.userMessages,
      sessionStats.assistantMessages,
      sessionStats.toolCalls,
      sessionStats.toolResults,
      sessionStats.totalMessages,
      sessionStats.tokens.input,
      sessionStats.tokens.output,
      sessionStats.tokens.cacheRead,
      sessionStats.tokens.cacheWrite,
      sessionStats.tokens.total,
      sessionStats.cost ?? 0,
      sessionStats.totalActiveMs ?? 0,
    ].join("|")
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);

  // fix:mcp-topbar-icons —— 把扩展状态（MCP / 插件）上报给 AppShell：两枚图标改挂
  // 顶栏（悬停/点击出浮窗）。键用「状态条数 + 插件条数 + 状态文本」拼，避免每次
  // 轮询都把 AppShell 重渲一遍。
  const extensionKey = `${extensionStatuses.length}|${extensionWidgets.length}|${extensionStatuses.map((status) => status.text).join("\u0001")}`;
  const extensionRef = useRef({ statuses: extensionStatuses, widgets: extensionWidgets });
  extensionRef.current = { statuses: extensionStatuses, widgets: extensionWidgets };
  useEffect(() => {
    const { statuses, widgets } = extensionRef.current;
    onExtensionStatusChange?.(statuses, widgets);
  }, [extensionKey, onExtensionStatusChange]);
  useEffect(() => () => { onExtensionStatusChange?.([], []); }, [onExtensionStatusChange]);

  const onDrop = useCallback((files: File[]) => {
    // fork:gap07-attachments — 拖拽入口与其他入口统一：图片内联，其余落盘后插路径引用
    chatInputRef?.current?.addFiles(files);
  }, [chatInputRef]);

  const { isDragOver, isRejectedDrag, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const visibleMessages = messages.filter((m) => isMessageGroupAnchor(m) || m.role === "assistant");
  // Stable Map identity: `messages` doesn't change during streaming updates
  // (the streaming message lives in streamState), so memoized MessageViews
  // skip re-rendering on every message_update event. An inline `new Map()`
  // here used to defeat MessageView's memo() on each streamed chunk.
  const toolResultsMap = useMemo(() => {
    const map = new Map(activeToolResults);
    for (const msg of messages) {
      if (msg.role === "toolResult") {
        map.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
      }
    }
    return map;
  }, [activeToolResults, messages]);
  // fix:turn-stats —— 回合结束行的四格（耗时 / 输入 / 输出 / 费用）用**同一个口径**：
  // 一轮任务 = 最后一条用户消息 → 这条助手消息结束（见 lib/turn-stats.ts）。
  const turnStatsByIndex = useMemo(() => computeTurnStats(messages), [messages]);
  const inputHistory = useMemo(() => {
    const seen = new Set<string>();
    const history: string[] = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const text = getUserInputText(messages[i]);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      history.push(text);
      if (history.length >= 50) break;
    }
    return history.reverse();
  }, [messages]);
  const messageRefs = useMessageRefs(visibleMessages.length);
  // fork:fix-render-split — 见下方 attachVisibleRefCached：ref 回调按 (idx, refIndex) 缓存，
  // 避免每次渲染都新建 N 个函数导致逐帧 ref 抖动。
  const visibleRefCacheRef = useRef<Map<string, (el: HTMLDivElement | null) => void> | null>(null);
  const revealHistoryForMinimap = useCallback(() => {
    setVisibleCount((current) => Math.max(current, messages.length * 2));
  }, [messages.length]);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !sessionBusy;
  // fork:zc-17 — 零会话首屏引导：新会话页 + 已知项目为空（= 侧栏一个会话都没有）才出现。
  const showEmptyStateGuide = isEmptyNew && (newSessionTargets?.projects.length ?? -1) === 0;
  // fork:zn-03 — report emptiness up (Zeno shows ThreadHeader only once the
  // timeline has activity). Effect, not render-time call: the parent setState
  // must not run during this render.
  useEffect(() => {
    onEmptyChange?.(isEmptyNew);
  }, [isEmptyNew, onEmptyChange]);

  // ---------------------------------------------------------------------------
  // fork:zc-10 — 计划快照广播 + 权限档位请求（右栏 PlanPane 的接线）。
  //
  // pi 不写计划文件，所以「当前计划」= 最后一条 assistant 消息里的编号列表；
  // 流式中的消息也并进来，右栏能看着计划逐条长出来。签名相同就不重复广播。
  // ---------------------------------------------------------------------------
  // 已提交消息里的计划：只在 messages 变化时重算（大多数帧都命中缓存）。
  // -------------------------------------------------------------------------
  // fork:zc-02 — in-conversation find (⌘F).
  //
  // The chat renders a paged window, not a virtualized list, and only the newest
  // ~50 messages are loaded at first; a DOM-only search would answer "no results"
  // for exactly the old hits long sessions contain. The model index
  // (lib/conversation-find.ts) is therefore the source of truth for counting and
  // stepping; `loadOlderPage` is reused to page history in until the search cap is
  // hit, and the DOM is only painted (ranges above) and scrolled.
  // -------------------------------------------------------------------------
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findActiveKey, setFindActiveKey] = useState<string | null>(null);
  const [findNavSeq, setFindNavSeq] = useState(0);
  const [findFocusSeq, setFindFocusSeq] = useState(0);
  const findOpenRef = useRef(findOpen);
  findOpenRef.current = findOpen;
  const findPreviousFocusRef = useRef<HTMLElement | null>(null);
  const findLastScrollKeyRef = useRef("");

  const findIndex = useMemo(() => buildSearchIndex(messages, entryIds), [messages, entryIds]);
  const findResult = useMemo(() => findHits(findIndex, findQuery), [findIndex, findQuery]);
  const findHitsList = findResult.hits;
  const findActiveIndex = useMemo(() => {
    if (findHitsList.length === 0) return -1;
    if (findActiveKey) {
      const index = findHitsList.findIndex((hit) => conversationFindHitKey(hit) === findActiveKey);
      if (index >= 0) return index;
    }
    return 0;
  }, [findActiveKey, findHitsList]);
  const activeFindHit = findActiveIndex >= 0 ? findHitsList[findActiveIndex] ?? null : null;
  // fork:zc-02 — 把当前命中转成既有的 `searchBlock`（会话搜索跳转用的同一条通路）：
  // 它会让那个块展开（thinking 触发惰性加载、工具卡展开结果），正文进 DOM 后
  // 高亮与滚动才有 Range 可用。命中里 194/197 落在 thinking / 工具输出上，
  // 不走这一步就只是「计数在动、画面不动」。
  const findSearchBlock = useMemo(() => {
    if (!activeFindHit || activeFindHit.blockIndex < 0) return undefined;
    const message = messages[entryIds.indexOf(activeFindHit.entryId)];
    if (!message || !Array.isArray((message as { content?: unknown }).content)) return undefined;
    return (message as { content: AssistantContentBlock[] }).content[activeFindHit.blockIndex];
  }, [activeFindHit, entryIds, messages]);
  // fork:zc-02 — 命中落在工具结果里时，要展开的是**那个具体的工具卡**：
  // 分组（timeline）路径下 ToolCallBlock 自带一层折叠，只靠组级 reveal 不够。
  const findRevealToolCallId = findSearchBlock?.type === "toolCall" ? findSearchBlock.toolCallId : undefined;
  // 惰性加载的思考正文要等一次往返才进 DOM，所以命中后允许有限次重绘（上限 3 次）。
  const [findPaintSeq, setFindPaintSeq] = useState(0);
  const findPaintTriesRef = useRef(0);
  // 换命中就重置重绘预算，否则步进几次后就没预算了。
  useEffect(() => {
    findPaintTriesRef.current = 0;
  }, [activeFindHit]);
  const findSearchIncomplete = findOpen
    && findQuery.trim().length > 0
    && hasEarlierMessages
    && messages.length >= CONVERSATION_FIND_MAX_SEARCH_MESSAGES;

  // Rebase the active key onto the resolved hit. When older pages prepend, the
  // numeric index of the active hit shifts; pinning the key keeps the viewport on
  // the same message instead of jumping to whatever is now hit #0.
  const activeFindKey = conversationFindHitKey(activeFindHit);
  useEffect(() => {
    if (activeFindKey && activeFindKey !== findActiveKey) setFindActiveKey(activeFindKey);
  }, [activeFindKey, findActiveKey]);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    const previous = findPreviousFocusRef.current;
    findPreviousFocusRef.current = null;
    if (previous && previous.isConnected) {
      // Defer past the unmount so focus does not land on a removed input.
      window.requestAnimationFrame(() => previous.focus());
    }
  }, []);

  const stepFind = useCallback((direction: -1 | 1) => {
    if (findHitsList.length === 0) return;
    const next = nextHitIndex(findActiveIndex, findHitsList.length, direction);
    setFindNavSeq((sequence) => sequence + 1);
    setFindActiveKey(conversationFindHitKey(findHitsList[next] ?? null));
  }, [findActiveIndex, findHitsList]);

  const handleFindQueryChange = useCallback((nextQuery: string) => {
    setFindQuery(nextQuery);
    setFindActiveKey(null);
    setFindNavSeq((sequence) => sequence + 1);
  }, []);

  // Page older history in while a query is active so hits outside the initially
  // loaded tail are found. Same loadOlderPage path (and in-flight guard) as the
  // minimap; stops at the search cap or once every page is in.
  useEffect(() => {
    if (!findOpen || findQuery.trim().length === 0) return;
    if (!hasEarlierMessages || loadingEarlier || loadingOlderRef.current) return;
    if (messages.length >= CONVERSATION_FIND_MAX_SEARCH_MESSAGES) return;
    if (findResult.truncated) return;
    void loadOlderPage();
  }, [
    findOpen,
    findQuery,
    findResult.truncated,
    hasEarlierMessages,
    loadOlderPage,
    loadingEarlier,
    messages.length,
  ]);

  // fork:zc-02 — 命中落在**渲染窗口之外**时，把窗口撑到能容纳它。
  //
  // 这是必需的一步，不是优化：命中计数基于「已加载的全部消息」（messages），
  // 而聊天列只渲染尾部 visibleCount 条（getVisibleRenderWindow 是**后缀窗口**：
  // startIndex = total - visibleCount）。不撑窗口的话，跳到较早的命中时计数会动、
  // 画面不动 —— 既没有高亮也滚不过去，看起来就是坏了。
  //
  // 上界故意用 messages.length 而不是 rendered.length：rendered 会把一轮里的过程
  // 消息合并成一个单元（长度 ≤ messages.length），按 messages 算只会多渲染一点，
  // 不会少渲染。宁可多渲染，不能漏。
  useEffect(() => {
    if (!findOpen || !activeFindHit) return;
    const hitIndex = entryIds.indexOf(activeFindHit.entryId);
    if (hitIndex < 0) return;
    const needed = messages.length - hitIndex + CONVERSATION_FIND_REVEAL_MARGIN;
    if (needed > visibleCount) setVisibleCount(Math.min(needed, messages.length));
  }, [activeFindHit, entryIds, findOpen, messages.length, visibleCount]);

  // Paint ranges and bring the active hit into view. `visibleCount` and `messages`
  // are dependencies so this re-runs after a page prepend or window expansion has
  // committed; the scroll key keeps streaming re-renders from yanking the viewport
  // back to the same hit.
  useEffect(() => {
    if (!findOpen || findQuery.trim().length === 0) {
      clearConversationFindHighlights();
      return;
    }
    const root = scrollContainerRef.current;
    if (!root) return;
    const frame = window.requestAnimationFrame(() => {
      const range = applyConversationFindHighlights(root, findQuery, activeFindHit);
      // fork:zc-02 — 思考正文是惰性加载的（展开后才拉），所以第一次重绘可能还在等
      // 那一次往返。拿不到 Range 就有限次重绘（上限 3），拿到就归零。
      if (range) {
        findPaintTriesRef.current = 0;
      } else if (activeFindHit && findPaintTriesRef.current < 3) {
        findPaintTriesRef.current += 1;
        window.setTimeout(() => setFindPaintSeq((sequence) => sequence + 1), 220);
      }
      const scrollKey = [
        findQuery,
        activeFindHit?.entryId ?? "",
        String(activeFindHit?.occurrence ?? -1),
        String(findNavSeq),
        String(findPaintSeq),
      ].join("\u0000");
      if (findLastScrollKeyRef.current === scrollKey) return;
      findLastScrollKeyRef.current = scrollKey;
      if (!activeFindHit) return;

      const anchor = conversationFindAnchor(root, activeFindHit.entryId);
      if (range && anchor) {
        // Center the matched range instead of the message top: a hit can sit deep
        // inside a long message, where top-aligning would leave it offscreen.
        const rangeRect = range.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        const offset = (root.clientHeight - rangeRect.height) / 2 - (rangeRect.top - anchorRect.top);
        // Same trick as the session-search jump: cancel the pending prepend
        // scroll-anchor restore so it cannot land on top of this jump.
        prevScrollDistanceRef.current = null;
        scrollToMessage(anchor, offset);
        return;
      }
      // Grouped process messages have no `data-entry-id` anchor of their own; fall
      // back to the closest anchored message so the turn is at least shown.
      const fallback = anchor ?? nearestConversationFindAnchor(root, activeFindHit.entryId, entryIds);
      if (fallback) {
        prevScrollDistanceRef.current = null;
        scrollToMessage(fallback);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeFindHit,
    entryIds,
    findNavSeq,
    findOpen,
    findPaintSeq,
    findQuery,
    findRevealToolCallId,
    findSearchBlock,
    messages,
    scrollContainerRef,
    scrollToMessage,
    visibleCount,
  ]);

  // Clear the browser-wide highlight registry when this chat unmounts.
  useEffect(() => () => clearConversationFindHighlights(), []);

  // ⌘F / Ctrl+F opens (or refocuses) the bar. Events originating from a
  // textarea/input/contenteditable are deliberately ignored so the composer's own
  // semantics and every settings field keep native ⌘F.
  useEffect(() => {
    const onFindShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "f") return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      if (isEmptyNew || extensionDialogs.length > 0) return;
      if (!findOpenRef.current) {
        findPreviousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      }
      event.preventDefault();
      setFindOpen(true);
      setFindFocusSeq((sequence) => sequence + 1);
      setFindNavSeq((sequence) => sequence + 1);
    };
    window.addEventListener("keydown", onFindShortcut);
    return () => window.removeEventListener("keydown", onFindShortcut);
  }, [extensionDialogs, isEmptyNew]);

  // fork:ui-todo — the session's task list, read back from the transcript (the
  // built-in `todo` tool stores each list in its tool result). Memoized: the scan
  // walks the message list and the transcript re-renders on every streamed chunk.
  const todoSummary = useMemo(() => extractTodoState(messages), [messages]);
  const hasChatMinimap = !isEmptyNew && !isMobile && !pendingScrollRestore;
  const hasStreamingContent = Boolean(streamState.streamingMessage?.content.length);
  // fork:process-live-2 — the in-flight message's process blocks, converted once.
  // The running turn's timeline is assembled from two sources (the committed
  // messages of the turn and this partial one), so both call sites read the same
  // memo instead of converting the streaming message twice.
  const streamingProcess = useMemo(() => {
    const live = streamState.streamingMessage as AgentMessage | undefined;
    if (!streamState.isStreaming || !live || live.role !== "assistant") return null;
    const split = splitFinalAssistantBlocks(live);
    return {
      answerBlocks: split.answerBlocks,
      blocks: messageToProcessContentBlocks(
        { ...live, content: split.processBlocks } as AgentMessage,
        { messageIndex: messages.length, phase: "process", toolResults: toolResultsMap, isStreaming: true },
      ),
    };
  }, [streamState.isStreaming, streamState.streamingMessage, messages.length, toolResultsMap]);
  // fork:composer-speed —— 输入区那枚「实时速度」徽标的数据源。
  //
  // 为什么不能直接用 usage：pi 只在消息**收尾**时把 usage 落到 result 上
  // （agent-loop.js:658 `finalized.result.usage`），流式中途 streamingMessage.usage
  // 恒为空，所以真 token 数在整个流式期间拿不到。于是按已流出文本估算：
  // CJK 一字≈1 token，其余四字符≈1 token（混合中英的实测误差 ~±20%）。
  // 速率 = 估算 token ÷ 首字节以来的秒数，随每个 delta 重算（不额外起 interval）。
  const streamingAnswerText = useMemo(() => {    const live = streamState.streamingMessage as AgentMessage | undefined;
    if (!streamState.isStreaming || !live || live.role !== "assistant") return "";
    let text = "";
    for (const block of streamingProcess?.answerBlocks ?? live.content) {
      if (block.type === "text") text += block.text;
    }
    return text;
  }, [streamState.isStreaming, streamState.streamingMessage, streamingProcess]);
  // fork:turn-head-order —— 底部那段（流式回答）**这一帧**会不会渲染。过程组要么当它的
  // `prefix`，要么就地自己渲染 —— 判据与下面那段 JSX 的守卫逐字相同，两处共用一个值，
  // 否则会出现「组被存起来没人取」的帧（组凭空消失）。
  const streamingTailRenders = Boolean(streamState.isStreaming && hasStreamingContent && streamState.streamingMessage && streamingProcess);
  const streamSpeedRef = useRef<{ startedAt: number; chars: number } | null>(null);
  const streamSpeed = (() => {
    if (!streamState.isStreaming) {
      streamSpeedRef.current = null;
      return null;
    }
    const chars = streamingAnswerText.length;
    // 文本变短 = 新的一条助手消息（流式被重置），重新计时。
    if (!streamSpeedRef.current || chars < streamSpeedRef.current.chars) {
      streamSpeedRef.current = { startedAt: performance.now(), chars };
    }
    const live = streamSpeedRef.current;
    live.chars = chars;
    const seconds = (performance.now() - live.startedAt) / 1000;
    if (chars === 0 || seconds < 0.5) return null;
    const cjk = (streamingAnswerText.match(/[\u3000-\u9fff]/g) ?? []).length;
    return Math.round((cjk + (chars - cjk) / 4) / seconds);
  })();
  // fork:turn-head-order —— 那一组过程卡本身，由 `isLiveTail` 分支存进来。它不作为
  // 独立块渲染，而是当**回答消息的 `prefix`**（身份行之后、正文之前，画板 D-03 帧 A 的
  // 顺序）；为 null 表示尾部那段不渲染，组已经在自己的位置上。
  let liveTurnGroup: ReactNode = null;
  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;
  const promptAnchorSpacerRef = useRef<HTMLDivElement | null>(null);
  const promptAnchorSpacerHeightRef = useRef(0);
  const promptAnchorMeasureFrameRef = useRef<number | null>(null);
  const promptAnchorAdjustmentDoneRef = useRef(false);
  const promptAnchorUpdateRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const spacer = promptAnchorSpacerRef.current;
    if (!agentRunning || !promptAnchorActive) {
      promptAnchorUpdateRef.current = null;
      promptAnchorSpacerHeightRef.current = 0;
      promptAnchorAdjustmentDoneRef.current = false;
      if (spacer) spacer.style.height = "";
      return;
    }

    const container = scrollContainerRef.current;
    const messageContent = messageContentRef.current;
    const userMessage = lastUserMsgRef.current;
    if (!container || !messageContent || !userMessage || !spacer) return;

    let disposed = false;
    const updatePromptAnchorSpacer = () => {
      if (
        disposed
        || scrollContainerRef.current !== container
        || messageContentRef.current !== messageContent
        || lastUserMsgRef.current !== userMessage
        || promptAnchorSpacerRef.current !== spacer
      ) return;

      const containerTop = container.getBoundingClientRect().top;
      const userMessageTop = userMessage.getBoundingClientRect().top
        - containerTop
        + container.scrollTop;
      const targetTop = Math.max(0, userMessageTop - 16);
      const contentEnd = spacer.getBoundingClientRect().top
        - containerTop
        + container.scrollTop;
      const nextPromptAnchorSpacerHeight = getPromptAnchorSpacerHeight(
        targetTop,
        contentEnd,
        container.clientHeight,
      );

      const isInitialMeasurement = !promptAnchorAdjustmentDoneRef.current;
      const needsInitialAdjustment = isInitialMeasurement
        && nextPromptAnchorSpacerHeight > 0;
      if (isInitialMeasurement) promptAnchorAdjustmentDoneRef.current = true;
      if (nextPromptAnchorSpacerHeight === promptAnchorSpacerHeightRef.current) return;

      promptAnchorSpacerHeightRef.current = nextPromptAnchorSpacerHeight;
      spacer.style.height = nextPromptAnchorSpacerHeight > 0
        ? `${nextPromptAnchorSpacerHeight}px`
        : "";
      if (needsInitialAdjustment) scrollUserMsgToTop();
    };

    promptAnchorUpdateRef.current = updatePromptAnchorSpacer;
    const schedulePromptAnchorMeasure = () => {
      if (disposed || promptAnchorMeasureFrameRef.current !== null) return;
      promptAnchorMeasureFrameRef.current = requestAnimationFrame(() => {
        promptAnchorMeasureFrameRef.current = null;
        updatePromptAnchorSpacer();
      });
    };

    updatePromptAnchorSpacer();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(schedulePromptAnchorMeasure);
    observer?.observe(container);
    observer?.observe(messageContent);
    observer?.observe(userMessage);
    return () => {
      disposed = true;
      if (promptAnchorUpdateRef.current === updatePromptAnchorSpacer) {
        promptAnchorUpdateRef.current = null;
      }
      observer?.disconnect();
      if (promptAnchorMeasureFrameRef.current !== null) {
        cancelAnimationFrame(promptAnchorMeasureFrameRef.current);
        promptAnchorMeasureFrameRef.current = null;
      }
    };
  }, [
    agentRunning,
    lastUserMsgRef,
    messages.length,
    promptAnchorActive,
    scrollContainerRef,
    scrollUserMsgToTop,
  ]);

  useLayoutEffect(() => {
    promptAnchorUpdateRef.current?.();
  }, [streamState.streamingMessage]);

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  // fork:zn-04 — protrusion strip for the empty new-session state. Built here but
  // rendered by ChatInput immediately above the card; see the `protrusion` prop.
  // It only exists on the new-session page, so a normal session never renders one
  // (and therefore never loses the card's top corners).
  // fork:ui-ctxbar — 新会话的上下文条 = 画板 20 的「工作区 + 分支」两项。
  // 分支从 `/api/git/branch` 读（`resolveProject()` 一次 git rev-parse，带缓存；
  // 不是 /api/git/status 的 status+diff 全量）。读不到（非 git 目录 / 无权限）
  // 就不渲染这一项，不是错误态。
  const ctxbarCwd = newSessionTargets?.activeCwd ?? newSessionCwd ?? null;
  const [ctxbarBranch, setCtxbarBranch] = useState<string | null>(null);
  useEffect(() => {
    if (!isEmptyNew || !ctxbarCwd) {
      setCtxbarBranch(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/git/branch?cwd=${encodeURIComponent(ctxbarCwd)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { branch?: string | null } | null) => {
        if (!cancelled) setCtxbarBranch(data?.branch?.trim() || null);
      })
      .catch(() => { if (!cancelled) setCtxbarBranch(null); });
    return () => { cancelled = true; };
  }, [isEmptyNew, ctxbarCwd]);

  const composerProtrusion = isEmptyNew && newSessionTargets ? (
    <>
      <ProjectChip targets={newSessionTargets} />
      {/* fix:new-session-pick-dir —— 「选目录」那枚按钮原来是自造的 `.pw-chip`，
          用户裁定换成**分支**（画板 20 上下文条本来画的就是工作区 + 分支两项）：
          选目录的入口还在工作区芯片的菜单里，分支则换回顶部那枚芯片撤掉后的位置。 */}
      {ctxbarBranch && ctxbarCwd && (
        <BranchChip
          branch={ctxbarBranch}
          cwd={ctxbarCwd}
          onSelectWorkspace={newSessionTargets.onPickWorkspace}
        />
      )}
      {newSessionTargets.error && (
        <span role="alert" className="d-banner err" style={{ flex: "0 0 auto" }}>
          {newSessionTargets.error}
        </span>
      )}
    </>
  ) : null;

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
      protrusion={composerProtrusion}
      actionPanel={actionPanel}
      onSend={(message, images, contexts, question, sessionReferences) => {
        // fork:zm-03 — 发消息是「回到最新」的用户意图：先恢复跟随，再走原路径。
        followingRef.current = true;
        sendFollowUntilRef.current = Date.now() + 600;
        void handleSend(message, images, contexts, question, sessionReferences);
      }}
      onAbort={handleAbort}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      onPromptWithStreamingBehavior={agentRunning ? handlePromptWithStreamingBehavior : undefined}
      isStreaming={sessionBusy}
      model={displayModelValue}
      isAutoModelSelection={isAutoModelSelection}
      modelNames={modelNames}
      modelList={modelList}
      modelError={modelError}
      modelScopeWarnings={modelScopeWarnings}
      onModelChange={handleModelChange}
      modelSwitching={modelSwitching}
      // fork:proma-37-deferred-model —— 运行中改模型不打断当前轮，只排队；
      // 界面上的「下轮生效」提示就挂在 ChatInput 的模型选择器旁边。
      pendingModel={nextTurnModelValue}
      onCancelPendingModel={handlePendingModelCancel}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      streamSpeed={streamSpeed}
      compactError={compactError}
      compactResult={compactResult}
      toolPreset={toolPreset}
      onToolPresetChange={session || isNew ? handleToolPresetChange : undefined}
      // fork:proma-02-mode — 权限档位控件（Chat-only 会话由 ChatInput 自行隐藏）
      permissionMode={permissionMode}
      onPermissionModeChange={handlePermissionModeChange}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      retryInfo={retryInfo}
      queuedMessages={queuedMessages}
      inputHistory={inputHistory}
      onRecallQueue={handleRecallQueue}
      // fork:gap04-queue — 队列逐条操控
      onQueueRemove={handleQueueRemove}
      onQueueMove={handleQueueMove}
      onQueuePromote={handleQueuePromote}
      onQueueEdit={handleQueueEdit}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      todoSummary={todoSummary}
      // fork:gap06-references — 让 `&` 建议列表知道当前会话，把它自己剔除
      currentSessionId={session?.id ?? null}
      // fork:design-components — 画板 20 的上下文环（.pw-ring）与它的浮窗数据。
      contextUsage={contextUsage ?? sessionStats?.contextUsage ?? null}
      sessionStats={sessionStats}
      // fork:ui-stats-ring — 环浮窗里的完整会话明细（原 composer 下方的统计长条）。
      statsDetails={sessionStats}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? newSessionDraftKey ?? undefined}
      onLocateSelectionContext={locateSelectionContext}
      onOpenSessionReference={onOpenSession ? (reference: SessionReference) => onOpenSession(reference.id) : undefined}
      cwd={session?.cwd ?? newSessionCwd}
    />
  );

  if (loading && !refreshing) {
    return (
      // fork:design-components —— 骨架 = 画板 D-03c 帧 D「会话正在加载」那一格：
      // 上方一句「正在加载会话...」（`.d-banner` + `.d-run`），下方 `.d-skel-list` 灰条。
      // reduced-motion 由 system.css 统一关掉扫掠。
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8" role="status" aria-live="polite" aria-label={t("chat.loadingSession")}>
        <div className="d-banner" style={{ width: "min(100%, 480px)" }}>
          <span className="d-run">
            <i data-ico="loader-circle" data-size="14" aria-hidden="true"></i>
            {t("chat.loadingSession")}
          </span>
        </div>
        <div className="d-skel-list" style={{ width: "min(100%, 480px)", opacity: 0.7 }} aria-hidden="true">
          <div className="d-skel d-skel-40" style={{ width: "78%" }} />
          <div className="d-skel d-skel-block" />
          <div className="d-skel d-skel-70" style={{ width: "64%" }} />
          <div className="d-skel d-skel-40" style={{ width: "86%" }} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div
      className={`chat-content relative h-full min-w-0 overflow-hidden${hasChatMinimap ? " grid" : " flex flex-col"}`}
      style={{
        paddingBottom: "var(--safe-bottom)",
        gridTemplateColumns: hasChatMinimap ? `minmax(0, 1fr) ${CHAT_MINIMAP_WIDTH}px` : undefined,
        gridTemplateRows: hasChatMinimap ? "minmax(0, 1fr) auto" : undefined,
      }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* fork:design-components —— 拖放落区 = 画板 61「拖放落区」A/B 两件：
          可接受 = .pw-drop（强调虚线 + 纸夹 mark），拒绝 = .pw-drop.reject（红虚线 + ban mark）。
          涟漪与淡入用画板同一套 .pw-anim-drop + .ripple，替掉原来手绘的三圆环 + 280px 内联 svg。
          文案沿用既有 i18n key，不新增：可接受 = chat.attachFile，拒绝 = chat.dropFilesOnly。
          「拖到输入框」那一态（画板 61 C）由输入卡自己接 drop，见本文件外。 */}
      {isRejectedDrag && !isDragOver && (
        <div
          role="status"
          aria-live="polite"
          className="d-drop reject anim-popover-down pointer-events-none absolute inset-3 z-50"
        >
          <i data-ico="ban" data-size="20" aria-hidden="true"></i>
          <div className="d-t-b">{t("chat.dropFilesOnly")}</div>
        </div>
      )}
      {isDragOver && (
        <div
          role="status"
          aria-live="polite"
          className="d-drop over anim-popover-down pointer-events-none absolute inset-3 z-50"
        >
          <i data-ico="paperclip" data-size="20" aria-hidden="true"></i>
          <div className="d-t-b">{t("chat.attachFile")}</div>
        </div>
      )}

      <div
        style={{
          position: "absolute",
          top: "var(--s3)",
          left: 0,
          right: isMobile ? 0 : CHAT_MINIMAP_WIDTH,
          zIndex: 40,
          display: "flex",
          // Toasts live in the top-right corner
          justifyContent: "flex-end",
          padding: `0 ${CHAT_COLUMN_PADDING_CSS}`,
          pointerEvents: "none",
        }}
      >
        <NoticeShelf notices={notices} floating onPauseChange={setNoticePaused} />
      </div>

      {/* fix:mcp-topbar-icons —— 原来聊天区右上角的扩展状态胶囊（MCP / 插件）整块搬去
          顶栏的图标（AppShell 渲染 `PluginStatusButton`，悬停或点击出画板 22 的浮窗）。
          这里不再有常驻浮标，转录区右上角让给通知条。 */}

      <div
        /* fork:design-components —— 转录区宿主：内部滚动容器用画板 D-03 的 `.d-chat`
           （见下方 ScrollFadeViewport），这层只保留定位与列向布局。 */
        className="relative min-w-0 flex-1 min-h-0 overflow-hidden flex flex-col"
        style={hasChatMinimap ? { gridColumn: "1", gridRow: "1" } : undefined}
      >
        {/* fork:zc-02 — in-conversation find bar (⌘F); state/effects live above. */}
        {findOpen && !isEmptyNew && (
          <ConversationFindBar
            query={findQuery}
            onQueryChange={handleFindQueryChange}
            hitCount={findHitsList.length}
            activeIndex={findActiveIndex}
            onNext={() => stepFind(1)}
            onPrevious={() => stepFind(-1)}
            onClose={closeFind}
            truncated={findResult.truncated || findIndex.truncated || findSearchIncomplete}
            focusSignal={findFocusSeq}
          />
        )}
        {extensionDialogs.length > 0 && (
          /* fork:extension-ui-queue —— 一条队列一格，按到达顺序自上而下排开，最新的
             离输入框最近；单条时与改动前同一格（容器不占位，高度/边距都在弹层自己身上）。 */
          <ExtensionOverlayStack zIndex={EXTENSION_DIALOG_STACK_Z_INDEX}>
            {extensionDialogs.map((request) => (
              <ExtensionDialog key={request.id} request={request} onRespond={respondToExtensionUi} />
            ))}
          </ExtensionOverlayStack>
        )}
        {extensionCustomUis.length > 0 && (
          <ExtensionOverlayStack zIndex={EXTENSION_CUSTOM_STACK_Z_INDEX}>
            {extensionCustomUis.map((request) => (
              <ExtensionCustomPanel key={request.id} request={request} onInput={sendExtensionCustomInput} />
            ))}
          </ExtensionOverlayStack>
        )}
        {/* fork:ui-newhome — hero + starter cards for a brand new session. */}
        {isEmptyNew && (
          // fork:zc-17 — 零会话首屏在 hero 之上再给三条起步路径；有项目/会话时
          // EmptyStateGuide 自己渲染成 null，布局与改动前一致。
          <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
            <EmptyStateGuide
              targets={newSessionTargets}
              onOpenSession={onOpenSession}
              visible={showEmptyStateGuide}
            />
            <NewSessionHome
              cwd={messageCwd ?? null}
              isMobile={isMobile}
              onInsertPrompt={(text) => chatInputRef?.current?.insertIfEmpty(text)}
            />
          </div>
        )}
        {!isEmptyNew && <>
        {/* fork:zm-03 — 消息列改用 ScrollFadeViewport：顶部/底部渐隐遮罩由它按滚动位置
            自己算（inline maskImage + rAF + ResizeObserver），同时把 DOM 节点回填给
            scrollContainerRef，既有 scroll 监听与 minimap 引用保持不变。 */}
        <ScrollFadeViewport
          viewportRef={scrollContainerRef}
          // fork:upstream-0.9.2-scrollbar — 消息列是唯一必须用长输出拖动的位置，
          // 所以显示自己的滚动条而不是藏起来（minimap 只标回合）；
          // stable gutter 让短会话长出屏幕时居中列不会横向跳动。
          className={`d-chat${isPwa ? " m-scroll" : ""} min-w-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]${refreshing ? " fork-pending" : ""}`}
          aria-busy={refreshing || undefined}
          /* 横向内距：桌面由内层 `.d-chat-inner` 按用户密度给，所以这里清掉画板的
             sp-8 避免双内距；**窄屏相反** —— 画板 M-01/M-02/M-04 每一帧的滚动区
             就是 `padding: 108px 18px 140px`，那一格才是横向留白（`.d-chat-inner`
             在 PWA 下 `padding: 0`）。清零等于让消息顶到屏幕边：17px 满宽正文看起来
             比画板大一圈，`.m-msg-user` 的 82% 也从 289px 涨到 320px，右贴边。 */
          style={isPwa
            ? { visibility: pendingScrollRestore ? "hidden" : undefined }
            : { visibility: pendingScrollRestore ? "hidden" : undefined, paddingLeft: 0, paddingRight: 0 }}
        >
          {/* fork:design-components —— 消息列 = 画板 D-03 的 .d-chat-inner
              （居中定宽 + flex 列 + gap sp-6）。原先这里是两层 div：
              外层只写 padding、内层写 maxWidth/margin，各自复刻了画板的一半；
              合成一层后行间距交给画板的 gap，消息根上那两处 marginBottom:20 随之删除。
              --chat-content-max-width 是产品设置项（画板写死 760），仍内联覆盖。 */}
          <div
            ref={messageContentRef}
            onPointerUp={captureQuotedSelection}
            className={`d-chat-inner${turnSwapping ? " fork-turn-enter" : ""}`}
            /* fork:v5-frame-audit —— 横向内距在窄屏归 `.m-scroll`（画板 M-01/M-02/M-04
               每一帧的滚动区都是 `padding: 108px 18px 140px`，那一格就是横向留白）；
               产品此前在消息列自己再垫一层 16px，窄屏上就成了 34px。桌面不动。 */
            style={isPwa
              ? { maxWidth: CHAT_COLUMN_MAX_WIDTH, padding: 0 }
              : { maxWidth: CHAT_COLUMN_MAX_WIDTH, padding: `0 ${CHAT_COLUMN_PADDING_CSS}` }}
          >
            {/* fork:proma-05-explore — 从主线某条消息 fork 出来的分支：显示来源 + 把结论带回父会话草稿 */}
            {session && session.parentSessionId && (
              <ExplorationBanner
                branchSessionId={session.id}
                parentSessionId={session.parentSessionId}
                branchEntryIds={entryIds}
                branchMessages={messages}
                onOpenParent={onOpenSession}
                onOpenPane={onOpenSessionPane ? () => onOpenSessionPane(session.id, session.parentSessionId) : undefined}
              />
            )}
            {(() => {
              let lastUserIdx = -1;
              for (let i = messages.length - 1; i >= 0; i--) {
                if (messages[i].role === "user") { lastUserIdx = i; break; }
              }
              // Anchor for live-tail detection: the last user message, or a
              // compaction summary when compaction has replaced it mid-turn.
              // Computed independently from lastUserIdx (which is kept for the
              // scroll-to-user ref) because a compaction summary can sit after
              // the last user message and anchor the still-streaming segment.
              let lastAnchorIdx = -1;
              for (let i = messages.length - 1; i >= 0; i--) {
                if (isMessageGroupAnchor(messages[i])) { lastAnchorIdx = i; break; }
              }

              const visibleRefIndexByMessage = new Map<number, number>();
              let refIdx = 0;
              messages.forEach((msg, idx) => {
                if (isMessageGroupAnchor(msg) || msg.role === "assistant") {
                  visibleRefIndexByMessage.set(idx, refIdx++);
                }
              });

              // fork:fix-render-split — 稳定的 ref 回调。
              //
              // 原来每次渲染都会新建 N 个箭头函数作为 `ref`，React 因此每帧都要
              // 对每个可见消息执行「旧 ref(null) + 新 ref(node)」，流式期间就是每秒几十次
              // 与消息数成正比的无效赋值。改成按 (idx, refIndex) 缓存后，ref 只在消息
              // 真正增删时才会变动。（缓存上界 = 会话消息数 × 2，随会话增长但不会泄漏到其他会话。）
              const visibleRefCallbacks = (visibleRefCacheRef.current ??= new Map());
              const attachVisibleRefCached = (idx: number, refIndex: number, isLastUser: boolean) => {
                const cacheKey = `${refIndex}:${idx}:${isLastUser ? 1 : 0}`;
                let callback = visibleRefCallbacks.get(cacheKey);
                if (!callback) {
                  callback = (el: HTMLDivElement | null) => {
                    messageRefs.current[refIndex] = el;
                    if (isLastUser) { (lastUserMsgRef as { current: HTMLDivElement | null }).current = el; }
                  };
                  visibleRefCallbacks.set(cacheKey, callback);
                }
                return callback;
              };

              const renderMessage = (idx: number, options: { attachRef?: boolean; keyPrefix?: string; messageOverride?: AgentMessage; showTimestamp?: boolean; writtenFiles?: WrittenFile[]; skillUsage?: SkillActivation[]; prefix?: ReactNode } = {}): ReactNode => {
                const msg = options.messageOverride ?? messages[idx];
                const isVisible = isMessageGroupAnchor(msg) || msg.role === "assistant";
                const currentRefIdx = visibleRefIndexByMessage.get(idx);
                const keyPrefix = options.keyPrefix ?? "message";
                const messageKey = entryIds[idx] ?? idx;
                /* fork:d03-frame-c —— 未读分割线（帧 C：`d-sep` + 一行居中说明 + `d-sep`）。
                   只在「有读数、且确实还有新条目」时画；首次进入（没读数）与没有新
                   条目都不画。索引对齐的是渲染窗口，所以历史翻页（`prepend`）会把
                   分割线往前推 —— 那正是想要的行为：它标的是「你上次读到的位置」。
                   三件是**兄弟节点**（不套容器类）：行高与间距全在 `.d-sep` 自己的
                   margin 上，只有那行说明需要居中 —— 板面用 flex 子项的
                   `align-self:center`，我们这里是块级流，所以同一件事写成
                   `textAlign:center`。于是这一整块不新增任何类。 */
                const divider = unreadDividerIdx === idx ? (
                  <>
                    <div className="d-sep" />
                    <div className="d-t-xs d-t-faint" style={{ textAlign: "center" }}>{t("chat.unreadDivider")}</div>
                    <div className="d-sep" />
                  </>
                ) : null;
                let showTimestamp = false;
                if (msg.role === "assistant") {
                  showTimestamp = true;
                  for (let j = idx + 1; j < messages.length; j++) {
                    const r = messages[j].role;
                    if (r === "user") break;
                    if (r === "assistant") { showTimestamp = false; break; }
                  }
                  // Hide on the currently-streaming tail (the streaming bubble owns the live timestamp)
                  if (showTimestamp && streamState.isStreaming && idx === messages.length - 1) {
                    showTimestamp = false;
                  }
                }
                if (options.showTimestamp !== undefined) showTimestamp = options.showTimestamp;
                const view = (
                  <MessageView
                    key={`${keyPrefix}-view-${messageKey}`}
                    message={msg}
                    toolResults={toolResultsMap}
                    modelNames={modelNames}
                    cwd={messageCwd}
                    onOpenFile={onOpenFile}
                    onOpenSession={onOpenSession}
                    entryId={entryIds[idx]}
                    searchBlock={entryIds[idx] === pendingSearchScroll?.entryId
                      ? searchBlock
                      // fork:zc-02 — 当前查找命中所在的块，走同一条 reveal 通路。
                      : entryIds[idx] === activeFindHit?.entryId
                        ? findSearchBlock
                        : undefined}
                    // fork:upstream-fork-while-running — #1023 移植：fork 只复制磁盘上已完成的
                    // entry，不碰正在跑的那个 AgentSession，所以只有 `!` shell 命令要拦。
                    onFork={bashRunning || isNew ? undefined : handleFork}
      // fork:proma-04-rewind — 回退是破坏性操作，先弹一道警示确认（回退不可撤销）
      onRewind={sessionBusy || isNew ? undefined : (entryId) => {
        if (!window.confirm(t("rewind.confirm"))) return;
        void handleRewind(entryId);
      }}
      rewinding={rewinding}
                    forking={forkingEntryId === entryIds[idx]}
                    onNavigate={sessionBusy ? undefined : handleNavigate}
                    onEditContent={handleEditContent}
                    showTimestamp={showTimestamp}
                    prevTimestamp={idx > 0 ? (messages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp : undefined}
                    turnStats={turnStatsByIndex.get(idx)}
                    sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                    writtenFiles={options.writtenFiles}
                    skillUsage={options.skillUsage}
                    onOpenSkill={onOpenSkill}
                    expandedToolIds={expandedToolIds}
                    onToggleTool={handleToggleTool}
                    prefix={options.prefix}
                  />
                );
                if (!isVisible || currentRefIdx === undefined) {
                  return divider ? <>{divider}{view}</> : view;
                }
                return (
                  <div key={`${keyPrefix}-${messageKey}`} data-entry-id={entryIds[idx]} ref={options.attachRef === false ? undefined : attachVisibleRefCached(idx, currentRefIdx, idx === lastUserIdx)}>
                    {divider}
                    {view}
                  </div>
                );
              };

              const rendered: ReactNode[] = [];
              for (let idx = 0; idx < messages.length;) {
                const msg = messages[idx];
                // fork:process-window-group — 渲染窗口是按条数切的（会话接口给的是最后 N 条），
                // 一个长回合可能比窗口还长，于是窗口的第一条就不是用户消息。这段以前走下面这条
                // 平铺分支：工具行 + 每条助手消息各一行 token 用量，整屏看下来就是一本流水账。
                // 现在把它当成一个虚拟回合起点，和正常回合走同一条分组路径（只是不渲染「用户消息」）。
                const virtualAnchor = idx === 0 && !isMessageGroupAnchor(msg);
                if (!isMessageGroupAnchor(msg) && !virtualAnchor) {
                  rendered.push(renderMessage(idx));
                  idx += 1;
                  continue;
                }

                const userIdx = idx;
                const firstProcessIdx = virtualAnchor ? userIdx : userIdx + 1;
                let endIdx = userIdx + 1;
                while (endIdx < messages.length && !isMessageGroupAnchor(messages[endIdx])) endIdx += 1;

                const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);

                if (finalAssistantIdx === -1) {
                  for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
                    rendered.push(renderMessage(renderIdx));
                  }
                  idx = endIdx;
                  continue;
                }

                // fork:process-live-2 — a running turn used to render flat here, and
                // only the in-flight message reached the grouped renderer. The timeline
                // therefore vanished the moment the turn's first tool call was committed
                // to `messages` and only came back once the turn finished — the "it
                // flips back to the flat list" report. The whole running turn is now one
                // timeline: its committed steps and the in-flight blocks share a group.
                const isLiveTail = (sessionBusy || streamState.isStreaming) && endIdx === messages.length && userIdx === lastAnchorIdx;
                if (isLiveTail) {
                  rendered.push(renderMessage(userIdx));

                  const liveBlocks: ProcessContentBlock[] = [];
                  let liveToolCalls = 0;
                  let liveRefIdx: number | undefined;
                  for (let processIdx = userIdx + 1; processIdx < endIdx; processIdx++) {
                    const processMessage = messages[processIdx];
                    if (processMessage.role !== "assistant" && processMessage.role !== "custom") continue;
                    const blocks = processMessage.role === "assistant"
                      ? getDisplayableAssistantBlocks(processMessage)
                      : [];
                    if (processMessage.role === "assistant" && blocks.length === 0) continue;
                    liveRefIdx ??= visibleRefIndexByMessage.get(processIdx);
                    if (processMessage.role === "assistant") liveToolCalls += countToolCallBlocks(blocks);
                    liveBlocks.push(...messageToProcessContentBlocks(processMessage, {
                      messageIndex: processIdx,
                      entryId: entryIds[processIdx],
                      phase: "process",
                      toolResults: toolResultsMap,
                    }));
                  }
                  if (streamingProcess) {
                    liveBlocks.push(...streamingProcess.blocks);
                    liveToolCalls += streamingProcess.blocks.filter((block) => block.type === "toolCall").length;
                  }

                  if (liveBlocks.length > 0) {
                    const liveRefIndex = liveRefIdx;
                    const liveGroupNode = (
                      <div
                        key="process-group-live"
                        ref={liveRefIndex === undefined ? undefined : (el) => { messageRefs.current[liveRefIndex] = el; }}
                      >
                        <ProcessDetailsGroup
                          messageCount={Math.max(1, liveToolCalls)}
                          toolCallCount={liveToolCalls}
                          // Open while the model is still working, collapse once the answer
                          // starts — the same rule the finalized group uses.
                          defaultExpanded={!streamingProcess || streamingProcess.answerBlocks.length === 0}
                          summaryText={summarizeProcessBlocks(liveBlocks, (key, params) => t(key, params), (key) => t(key))}
                          summaryParts={summarizeProcessParts(liveBlocks, (key, params) => t(key, params), (key) => t(key))}
                          // fork:proc-badge-running（用户 2026-10-02）—— 这一组就是**正在跑
                          // 的那一轮**（`isLiveTail` 为真才走到这里，判据见上：`sessionBusy`
                          // 或流式中 + 它是尾巴）。徽标原来没接 `status`，默认落到「已完成」，
                          // 于是用户看着一条在跑的过程抬头写着「已完成」。
                          status="running"
                          t={t}
                        >
                          <ProcessGroup
                            blocks={liveBlocks}
                            isStreaming={streamState.isStreaming}
                            toolResults={toolResultsMap}
                            onOpenFile={onOpenFile ? (filePath: string) => onOpenFile(filePath) : undefined}
                            onOpenSession={onOpenSession}
                          />
                        </ProcessDetailsGroup>
                      </div>
                    );
                    if (streamingTailRenders) liveTurnGroup = liveGroupNode;
                    else rendered.push(liveGroupNode);
                  }
                  idx = endIdx;
                  continue;
                }

                if (!virtualAnchor) rendered.push(renderMessage(userIdx));

                const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;
                const finalSplit = splitFinalAssistantBlocks(finalAssistant);
                const finalAnswerMessage = finalSplit.answerBlocks.length > 0 || getAssistantErrorMessage(finalAssistant) || isAssistantTruncated(finalAssistant)
                  ? withAssistantBlocks(finalAssistant, finalSplit.answerBlocks)
                  : null;

                const finalProcessEnd = finalAssistant.content.indexOf(finalSplit.answerBlocks[0]);
                // Keep the original prefix so deferred thinking retains its stored block indices.
                const finalProcessBlocks = finalAssistant.content.slice(0, finalProcessEnd < 0 ? undefined : finalProcessEnd);

                const groupedProcessBlocks: ProcessContentBlock[] = [];
                let processToolCount = 0;
                let processRefIdx: number | undefined;
                // fork:turn-head-order —— 本轮的过程组节点，见下面 `if (groupedProcessBlocks.length > 0)`。
                let processGroupNode: ReactNode = null;
                // fork:zc-02 — 在查找条开着且有查询词时，把每一轮的过程步骤都展开。
                //
                // 不只是「顺手」，而是这个功能能不能用的前提：命中计数建在**模型里的正文**
                // （thinking / 工具输出都在内），而折叠着的步骤正文**不在 DOM 里**
                // （MessageView 两段式挂载 + 惰性加载），于是高亮与滚动都拿不到 Range ——
                // 表现就是计数在动、画面不动。ProcessGroup 的 `reveal` 会把该组每个 step
                // 都置为打开（ProcessGroup.tsx 的 isStepOpen），正文随之进 DOM。
                // 复用会话搜索跳转已有的那条通路，不另建一套 reveal 状态。
                const revealForFind = findOpen && findQuery.trim().length > 0;
                let revealProcess = revealForFind;

                for (let processIdx = firstProcessIdx; processIdx <= finalAssistantIdx; processIdx++) {
                  const processMessage = messages[processIdx];
                  if (processMessage.role === "custom") {
                    const customReveal = Boolean(pendingSearchScroll && pendingSearchScroll.entryId === entryIds[processIdx]);
                    revealProcess ||= customReveal;
                    processRefIdx ??= visibleRefIndexByMessage.get(processIdx);
                    groupedProcessBlocks.push(...messageToProcessContentBlocks(processMessage, {
                      messageIndex: processIdx,
                      entryId: entryIds[processIdx],
                      phase: "process",
                      toolResults: toolResultsMap,
                    }));
                    continue;
                  }
                  if (processMessage.role !== "assistant") continue;
                  const message = processIdx === finalAssistantIdx
                    ? withAssistantBlocks(processMessage, finalProcessBlocks, { omitUsage: Boolean(finalAnswerMessage) })
                    : processMessage;
                  const blocks = getDisplayableAssistantBlocks(message);
                  if (blocks.length === 0) continue;
                  processRefIdx ??= visibleRefIndexByMessage.get(processIdx);
                  processToolCount += countToolCallBlocks(blocks);
                  revealProcess ||= Boolean(pendingSearchScroll && entryIds[processIdx] === pendingSearchScroll.entryId && (!searchBlock || blocks.includes(searchBlock)));
                  groupedProcessBlocks.push(...messageToProcessContentBlocks(message, {
                    messageIndex: processIdx,
                    entryId: entryIds[processIdx],
                    phase: "process",
                    toolResults: toolResultsMap,
                  }));
                  continue;
                }

                if (groupedProcessBlocks.length > 0) {
                  // The group header is the only place a summary is rendered, so
                  // the grouped renderer computes its digest here and hands it
                  // down instead of printing a second count line inside itself.
                  const groupedSummary = summarizeProcessBlocks(groupedProcessBlocks, (key, params) => t(key, params), (key) => t(key));
                  // fork:turn-head-order —— 过程组当**回答消息的 prefix**（见
                  // MessageView Props.prefix），于是身份行仍在最上面（画板 D-03 帧 A）。
                  // 没有回答可挂（`finalAnswerMessage` 为空）时它就是自己那一块。
                  processGroupNode = (
                    <div
                      key={`process-group-${entryIds[userIdx] ?? userIdx}`}
                      ref={processRefIdx === undefined ? undefined : (el) => { messageRefs.current[processRefIdx] = el; }}
                    >
                      <ProcessDetailsGroup
                        messageCount={Math.max(1, processToolCount)}
                        toolCallCount={processToolCount}
                        defaultExpanded={!finalAnswerMessage}
                        reveal={revealProcess}
                        summaryText={groupedSummary}
                        summaryParts={summarizeProcessParts(groupedProcessBlocks, (key, params) => t(key, params), (key) => t(key))}
                        // fork:proc-badge-running（用户 2026-10-02）—— 徽标原来只看
                        // `streamState.isStreaming`，而它在「模型发完一条消息 → 下一条
                        // 还没来」的窗口里是 false（长命令执行期间尤其如此）：于是正在跑
                        // 的那一轮抬头恒显「已完成」，用户问「怎么没有运行中」。
                        // 两个信号单用都不够：`sessionBusy` 会把**上一轮**也点亮；
                        // 「本轮是尾巴」也不能用 `finalAssistantIdx ===
                        // messages.length - 1` —— 工具执行时最后一条是 toolResult，
                        // 索引永远对不上（改完仍显示「已完成」就是漏在这一条）。
                        // 真正的判据是**这一轮还没有最终回答**（finalAnswerMessage
                        // 为空）**且它还是尾巴**（只缺前者会把上一条被中断的旧轮次
                        // 一起点亮），liveness 用会话忙（与顶栏芯片、stop 按钮同源）。
                        status={sessionBusy && !finalAnswerMessage && userIdx === lastAnchorIdx ? "running" : "done"}
                        durationSec={processSpanSec(messages, firstProcessIdx, finalAssistantIdx)}
                        t={t}
                      >
                        <ProcessGroup
                          blocks={groupedProcessBlocks}
                          isStreaming={streamState.isStreaming && finalAssistantIdx === messages.length - 1}
                          toolResults={toolResultsMap}
                          onOpenFile={onOpenFile ? (filePath: string) => onOpenFile(filePath) : undefined}
                          onOpenSession={onOpenSession}
                          reveal={revealProcess}
                          revealToolCallId={findRevealToolCallId}
                        />
                      </ProcessDetailsGroup>
                    </div>
                  );
                }

                if (finalAnswerMessage) {
                  // Each tool call is stored as its own assistant entry, so the
                  // final answer alone carries no record of what the turn wrote.
                  // Gather the turn's assistant blocks and derive the file list
                  // from the write/edit calls among them.
                  const turnContent: AssistantContentBlock[] = [];
                  for (let i = firstProcessIdx; i <= finalAssistantIdx; i++) {
                    const m = messages[i];
                    if (m?.role === "assistant") {
                      for (const b of (m as AssistantMessage).content ?? []) turnContent.push(b);
                    }
                  }
                  const writtenFiles = extractTurnWrittenFiles(turnContent, toolResultsMap, messageCwd);
                  // fork:proma-32-skill-usage —— 与 writtenFiles 同一条推导口径：整轮
                  // （用户消息 + 全部助手/工具结果条目）一起看，只有配对成功的
                  // `skills/<slug>/SKILL.md` 读才产生 chip（lib/skill-usage.ts）。
                  const skillUsage = collectSkillActivations(messages.slice(userIdx, finalAssistantIdx + 1));
                  rendered.push(renderMessage(finalAssistantIdx, {
                    messageOverride: finalAnswerMessage,
                    writtenFiles,
                    skillUsage,
                    // fork:turn-head-order —— 过程组挂进这条消息，身份行因此仍在最上面。
                    prefix: processGroupNode,
                  }));
                } else if (processGroupNode) {
                  // 没有正文可挂（被中断 / 只有工具）：过程组自己就是那一块。
                  // fork:turn-head-first —— 同上，身份行仍然先画：这一轮发生过，就是
                  // 有人说过话，哪怕最后没有正文。壳用 `.d-msg-ai`（与 MessageView
                  // 同款间距），所以它与「有正文」那一支的读法一致。
                  rendered.push(
                    <div key={`process-head-${entryIds[userIdx] ?? userIdx}`} className={isPwa ? "m-msg-ai" : "d-msg-ai"}>
                      <TurnIdentityHead message={finalAssistant} modelNames={modelNames} isPwa={isPwa} />
                      {processGroupNode}
                    </div>,
                  );
                }
                for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
                  rendered.push(renderMessage(renderIdx));
                }
                idx = endIdx;
              }
              const { startIndex } = getVisibleRenderWindow(rendered.length, visibleCount);
              const hasMore = startIndex > 0 || hasEarlierMessages;
              return (
                <>
                  {hasMore && (
                     <div ref={sentinelRef} className="py-3 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                       {t("chat.loadEarlier")}
                    </div>
                  )}
                  {rendered.slice(startIndex)}
                </>
              );
            })()}
            {streamingTailRenders && (
              (() => {
                // fork:process-live — the in-flight message used to render through the flat
                // MessageView, so switching the process-display setting mid-run changed
                // nothing until the turn finished and the finalized message reached the
                // grouped path below. Build the same group from the streaming message and
                // keep the flat renderer only for `legacy`.
                //
                // fork:process-live-2 — when the running turn's timeline has already been
                // emitted above (`liveTurnGroup`), these process blocks are part of it
                // and only the answer half is still owed here.
                const live = streamState.streamingMessage as AgentMessage;
                if (!streamingProcess || (streamingProcess.blocks.length === 0 && !liveTurnGroup)) {
                  // Unchanged flat renderer (and unchanged expression): the streaming
                  // message must keep receiving `toolResultsMap` so live shell output
                  // stays attached to its tool call.
                  return <MessageView message={streamState.streamingMessage as AgentMessage} toolResults={toolResultsMap} isStreaming modelNames={modelNames} cwd={messageCwd} onOpenFile={onOpenFile} onOpenSession={onOpenSession} expandedToolIds={expandedToolIds} onToggleTool={handleToggleTool} />;
                }
                // fork:turn-head-order —— 过程组当回答消息的 `prefix`（身份行之后），
                // 还没有回答可挂时就自己渲染出去 —— 两种情况都只出一块。
                // fork:turn-head-first（用户 2026-10-05）—— 「还没有回答」的那段里
                // **也把身份行画出来**：整轮只有它时（工具在跑、等首条正文），
                // 用户看到的是一张无主的卡片，「PI NEXT」要等正文到了才出现 ——
                // 读成「最后才出现」。这一支仍然不出 MessageView（正文没有，消息壳
                // 也没有正文可渲染），所以身份行按它自己的组件画一份，外层仍用
                // `.d-msg-ai` / `.m-msg-ai` 拿到与 MessageView 一样的 12px 间距。
                let groupNode: ReactNode = liveTurnGroup;
                if (!groupNode) {
                  const liveToolCalls = streamingProcess.blocks.filter((block) => block.type === "toolCall").length;
                  groupNode = (
                    <div key="process-group-live">
                      <ProcessDetailsGroup
                        messageCount={Math.max(1, liveToolCalls)}
                        toolCallCount={liveToolCalls}
                        // Open while the model is still working, collapse once the answer
                        // starts — the same rule the finalized group uses.
                        defaultExpanded={streamingProcess.answerBlocks.length === 0}
                        summaryText={summarizeProcessBlocks(streamingProcess.blocks, (key, params) => t(key, params), (key) => t(key))}
                        summaryParts={summarizeProcessParts(streamingProcess.blocks, (key, params) => t(key, params), (key) => t(key))}
                        status={streamState.isStreaming ? "running" : "done"}
                        t={t}
                      >
                        <ProcessGroup
                          blocks={streamingProcess.blocks}
                          isStreaming
                          toolResults={toolResultsMap}
                          onOpenFile={onOpenFile ? (filePath: string) => onOpenFile(filePath) : undefined}
                          onOpenSession={onOpenSession}
                        />
                      </ProcessDetailsGroup>
                    </div>
                  );
                }
                /* fork:no-head-flicker（2026-10-06 用户实拍「一会儿有一会儿没有，还会闪现」）
                   —— 这里原本有一个 `answerBlocks.length === 0` 的提前返回，
                   自己拿一个固定 key 的 `<div>` + `TurnIdentityHead` 画身份行；
                   正文一到就改走下面的 `<MessageView>`（它自己再画一个身份行）。
                   两支的**元素类型不同**（`div` vs 组件）、key 也不同，React 不会原地
                   复用 —— 旧节点整个拆掉、新节点重建：那枚 `<img src="/pi-next-logo.png">`
                   重新解码、`.m-msg-ai` 重排，于是「空正文 → 有正文」每切一次就闪一次。
                   现在两支合一：**始终**走 `<MessageView>`，`answerBlocks` 为空时正文那半
                   自然是空的，而 `prefix={groupNode}` 保证过程组照旧挂在身份行之后
                   （`MessageView` 对 `prefix` 有豁免：挂了它就绝不返回 null）。
                   元素类型与位置恒定，React 原地复用同一个 DOM —— 不闪、也不重排。 */
                return (
                  <MessageView
                    message={{ ...live, content: streamingProcess.answerBlocks } as AgentMessage}
                    toolResults={toolResultsMap}
                    isStreaming
                    modelNames={modelNames}
                    cwd={messageCwd}
                    onOpenFile={onOpenFile}
                    onOpenSession={onOpenSession}
                    expandedToolIds={expandedToolIds}
                    onToggleTool={handleToggleTool}
                    prefix={groupNode}
                  />
                );
              })()
            )}

            {agentRunning && !hasStreamingContent && (agentPhase || isCompacting) && (
              // fork:zm-07 — 垂直间距放在 PhaseRoll 自己身上，不放在这层 wrapper 上：
              // PhaseRoll 在“没有相位可显”时返回 null（与改动前同一契约），
              // 而 wrapper 带着 py-2 渲染就会在等待结束后留下一条看不见的空隙。
              // fork:zm-08 — 压缩中即便相位为空也显一行（上游 2e66e40 / #1008）。
              // fork:v5-frame-audit — 宿主抄画板 D-03e 帧 B：阶段行是**一张卡**
              // （`.d-card` › `.d-card-body` › `.d-step`），不是一行裸文字 ——
              // 板面注释写明「阶段行只占一行，高度永远不变」，那件事由卡片体 +
              // 唯一的 `.d-step` 承担；此前宿主是 `div.break-words.text-xs`，
              // 结构对不上（structdiff：板 `.d-card`/`.d-card-body` 产品完全没有）。
              <div className="d-card">
                <div className="d-card-body">
                  <PhaseRoll
                    text={phaseLabel(agentPhase, t, isCompacting)}
                    phaseKey={phaseKeyOf(agentPhase, isCompacting)}
                    lineHeightEm={1.4}
                  />
                </div>
              </div>
            )}

            {bashRunning && !pendingBash && (
              <div className="py-2 text-xs" style={{ color: "var(--text-muted)" }} role="status" aria-live="polite">
                <span>{t("chat.runningCommand")}</span>
              </div>
            )}

            {pendingBash && (
              <MessageView
                message={{
                  role: "bashExecution",
                  command: pendingBash.command,
                  output: "",
                  excludeFromContext: pendingBash.excludeFromContext,
                } as BashExecutionMessage}
                sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                onOpenSession={onOpenSession}
              />
            )}

            {/* fork:proma-35-retry — 重试提示挂在消息流尾部（最后一条消息之后、
                prompt 锚点之前）；只在 attempt > 5 时才有内容，run 结束由 hook 清空。 */}
            <RetryNotice notices={retryNotices} />

            <div ref={promptAnchorSpacerRef} aria-hidden="true" />
          </div>
        </ScrollFadeViewport>
        </>}
      </div>

      {quoteSelectionEnabled && quotedSelection && createPortal(
        // fork:design-components —— 选区引用工具条 = 画板 21/02 的浮层壳 .pw-pop
        // （发丝边框 / radius-6 / surface-popover / shadow-popover / padding-s1），
        // 两个动作按钮走 .pw-btn（sm 高度），图标一律 data-ico。
        // 定位（左上角贴选区、fixed、portal 到 body）仍是内联，行为照旧。
        <div
          ref={quotePopoverRef}
          role={quoteInputOpen ? "dialog" : "toolbar"}
          aria-label={t(quoteInputOpen ? "chat.newQuoteChat" : "chat.askSelection")}
          className="d-pop-float anim-popover-down"
          style={{
            position: "fixed",
            top: quotedSelection.top,
            left: quotedSelection.left,
            zIndex: 260,
            display: "flex",
            // fix:sel-pop-nowrap —— 收起态是**两枚带文案的动作钮**：恒定同一行、宽度
            // 交给内容（`.d-pop-float` 自带的 padding 只适合列表型弹层）。展开态是 420 宽的
            // 小编辑器，内部的 ChatInput 需要自己换行，所以 nowrap 只作用在收起态。
            flexWrap: quoteInputOpen ? "wrap" : "nowrap",
            whiteSpace: quoteInputOpen ? undefined : "nowrap",
            gap: "var(--nx-sp-2)",
            width: quoteInputOpen ? "min(420px, calc(100vw - 16px))" : "max-content",
            maxWidth: "calc(100vw - 16px)",
            maxHeight: "calc(var(--app-viewport-height, 100dvh) - 16px)",
            overflowY: "auto",
            padding: quoteInputOpen ? 12 : 3,
          }}
        >
          {quoteInputOpen ? (
            <fieldset
              disabled={quoteSubmitting}
              aria-busy={quoteSubmitting}
              style={{ width: "100%", minWidth: 0, margin: 0, padding: 0, border: "none", display: "flex", flexDirection: "column", gap: 10 }}
            >
              <div className="d-row" style={{ gap: "var(--nx-sp-2)" }}>
                <span className="d-grow d-t-b" style={{ minWidth: 0, fontSize: TEXT.sm }}>{t("chat.askInNewChat")}</span>
                <button type="button" className="d-iconbtn" title={t("i18n.close")} aria-label={t("i18n.close")} disabled={quoteSubmitting} onClick={closeQuotedSelection}>
                  <i data-ico="x" data-size="14" aria-hidden="true"></i>
                </button>
              </div>
              <ChatInput
                ref={quoteChatInputRef}
                compact
                onSend={askSelectionInNewChat}
                onAbort={closeQuotedSelection}
                isStreaming={false}
              />
              {quoteError && <div role="alert" className="d-banner err" style={{ fontSize: TEXT.sm, overflowWrap: "anywhere" }}><i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i><span className="d-grow">{quoteError}</span></div>}
            </fieldset>
          ) : <>
          <button
            type="button"
            className="d-btn sm"
            title={t("chat.askInCurrent")}
            aria-label={t("chat.askInCurrent")}
            onPointerDown={(event) => event.preventDefault()}
            onClick={askSelectionHere}
            style={{ height: 35, flex: "0 0 auto", padding: "0 10px", fontSize: TEXT.sm, fontWeight: 500 }}
          >
            <i data-ico="at-sign" data-size="14" aria-hidden="true"></i>
            <span>{t("chat.askInCurrent")}</span>
          </button>
          {onAskInNewChat && quotedSelection.sourceEntryId && !sessionBusy && (
            <button
              type="button"
              className="d-btn sm"
              title={t("chat.askInNewChat")}
              aria-label={t("chat.askInNewChat")}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => { setQuoteInputOpen(true); window.getSelection()?.removeAllRanges(); }}
              style={{ height: 35, flex: "0 0 auto", padding: "0 10px", fontSize: TEXT.sm, fontWeight: 500 }}
            >
              <i data-ico="git-fork" data-size="14" aria-hidden="true"></i>
              <span>{t("chat.askInNewChat")}</span>
            </button>
          )}
          </>}
        </div>,
        document.body,
      )}

      <div
        /* fork:design-components —— composer 行 = 画板 D-03/D-04 的 .d-composer-wrap
           （flex:none / padding 0 sp-8 sp-4）。原先只内联了 paddingBottom，
           上方与两侧的呼吸位靠一条 max-width 层去猜；换成画板类后卡片自身的
           width: min(--composer-max,100%) 也不再需要外层重复写一遍。
           fork:v5-frame-audit —— 窄屏换成画板 M-01/M-02/M-04 每一帧的
           `.m-composer-wrap`：**浮在转录之上**（absolute / bottom:0），滚动区靠
           `.m-scroll` 的 `padding-bottom: 140px` 让位。产品在窄屏此前把它留在流里，
           于是「顶栏浮在内容上、输入卡也浮在内容上」这组对称只落地了一半。 */
        className={isPwa ? "fork-composer-anchor" : "d-composer-wrap relative shrink-0"}
        style={{
          ...(isPwa
            /* 定位是几何，铁律四许内联；**类不给**：画板 M-01/M-02/M-04 的
               `.m-composer-wrap` 只有一个，就在 ChatInput 里那个 —— 它直接托着
               `.m-composer`。这里再挂一次就成了两层 wrap，两份 `padding: 0 12px 12px`
               叠成 24px，输入卡从 364px 缩到 310px，两侧各少 27px。
               本层只负责把输入卡抬到转录之上（board-diff 也只量 ChatInput 那一枚）。 */
            ? { position: "absolute", left: 0, right: 0, bottom: 0, zIndex: "var(--nx-z-panel)" }
            : {
              gridColumn: "1",
              gridRow: "2",
              // The minimap preview may expand leftward, but it must never cover
              // or intercept the composer at the bottom of the chat.
              zIndex: 2,
              background: "var(--bg)",
            }),
        }}
      >
        {/* fork:v5-wave-n1 —— 手机上转录区的下端渐隐（画板 M-02 帧 A/B/C 每一帧里
            `</div>`（m-scroll 收尾）与 `.m-composer-wrap` 之间那一块 `.m-fade-tail`：
            「滚动到顶也不出现硬边」）。`.m-fade-tail` 自带 bottom:0 与
            pointer-events:none；这里把它钉在输入卡的**上缘**（bottom:100% + left/right 0），
            位置是几何值。z-index 比 sticky 低一档，正好在转录正文之上、输入卡之下，
            不挡滚动也不挡「回到最下方」那枚钮（它 z-index:20）。 */}
        {isPwa && <div className="m-fade-tail" style={{ bottom: "100%", left: 0, right: 0 }} aria-hidden="true" />}
        {!isEmptyNew && (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              left: 0,
              right: isMobile ? 0 : CHAT_MINIMAP_WIDTH,
              display: "flex",
              justifyContent: "center",
              gap: "var(--space-row)",
              paddingBottom: "var(--space-loose)",
              pointerEvents: "none",
              zIndex: 20,
            }}
          >
            {/* 2026-10-02 用户裁定 —— 原来这里挂过一枚吸底任务进度浮层（PR-31）。
                它和输入框左上角的 `TodoChip` 读同一份 `extractTodoState`，
                待办清单在屏幕上出现两遍，而且浮层不可点。已整块删除，
                这条定位带现在只装「回到最下方」。 */}
            <button
              type="button"
              /* fork:v6-landing —— 换成画板 D-35 帧 A 的 `.d-jump`（beUI message-scroller
                 的「滚到最新」悬浮钮）：毛玻璃 pill + 图标 + 文字。显隐与定位仍由
                 产品类 `chat-scroll-to-bottom` 的 is-visible 通道管（zm-03 的跟随
                 状态机没动），`.d-jump` 只接管视觉。 */
              className={`chat-scroll-to-bottom d-jump${showScrollToBottom && !pendingScrollRestore ? " is-visible" : ""}`}
              title={t("chat.scrollToLatest")}
              aria-label={t("chat.scrollToLatest")}
              onPointerDown={() => { followingRef.current = true; }}
              onKeyDown={(event) => {
                // 键盘触发 click 前先恢复跟随（zm-03 的回底否决权需要它）。
                if (event.key === "Enter" || event.key === " ") followingRef.current = true;
              }}
              onClick={() => scrollToBottom("smooth")}
            >
              {/* 用户 2026-10-07 实拍：「你只需要箭头就行了，为啥还有文字啊」——
                  只留箭头（`.chat-scroll-to-bottom` 本来就是定宽方钮，文字在里面
                  会被挤成一列竖排）。文案仍挂在 `title` / `aria-label` 上。 */}
              <i data-ico="arrow-down" data-size="13" aria-hidden="true"></i>
            </button>
          </div>
        )}
        {isEmptyNew && (
          <div className="mx-auto w-full" style={{ maxWidth: "var(--composer-max-width, 892px)", paddingLeft: "var(--s4)", paddingRight: "var(--s4)" }}>
            <NewSessionUpdateLink label={(version) => t("appUpdate.releaseNotes", { version })} />
          </div>
        )}
        {chatInputElement}
        {/* fork:ui-stats-ring —— 输入框下方不再有任何常驻行：统计长条与扩展状态条
            都已移走（统计进上下文环浮窗，扩展状态进聊天区右上角浮标）。 */}
      </div>
      {hasChatMinimap && (
        <ChatMinimap
          messages={messages}
          streamingMessage={streamState.streamingMessage}
          scrollContainer={scrollContainerRef}
          messageRefs={messageRefs}
          onRevealHistory={revealHistoryForMinimap}
        />
      )}
      {/* fork:ui-newhome — the composer used to be vertically centred by a
          trailing flex spacer. Upstream and Wegent both put the hero above a
          bottom-anchored composer, which is what the empty state now does. */}
    </div>
  );
}

// Toast 整体高度上限；文本区高度上限 = 整体上限 - 上下 padding(14*2) - 上下边框(1*2)
const NOTICE_MAX_HEIGHT_PX = 500;
const NOTICE_TEXT_MAX_HEIGHT_PX = NOTICE_MAX_HEIGHT_PX - 30;

function NoticeShelf({ notices, floating = false, onPauseChange }: { notices: NoticeItem[]; floating?: boolean; onPauseChange?: (id: string | null) => void }) {
  if (notices.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        // Right-anchored: every toast's right edge aligns here, widths extend leftward
        alignItems: "flex-end",
        marginBottom: floating ? 0 : 10,
      }}
    >
      {notices.map((notice, index) => {
        // fork:design-components —— 通知条直接使用画板 D-03c 帧 D 的 .d-toast 组件：
        // 边框 / 弹层底 / 阴影 / 图标首行对齐 / .bad·.warn·.ok 三色全部来自 system.css，
        // 这里只保留产品的动画类（notice-shelf-*）与 hover 暂停关闭逻辑。
        const toastClass = notice.type === "error" ? "bad"
          : notice.type === "warning" ? "warn"
            : notice.type === "success" ? "ok"
              : "";
        const typeIcon = notice.type === "error" ? "circle-x"
          : notice.type === "warning" ? "triangle-alert"
            : notice.type === "success" ? "circle-check"
              : "info";
        return (
          <div
            key={notice.id}
            className={`notice-shelf-item d-toast ${toastClass}`}
            onMouseEnter={() => onPauseChange?.(notice.id)}
            onMouseLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement)) onPauseChange?.(null);
            }}
            onFocus={() => onPauseChange?.(notice.id)}
            onBlur={(event) => {
              if (!event.currentTarget.matches(":hover")) onPauseChange?.(null);
            }}
            style={{
              // `.d-toast` 默认是底部居中的 fixed 浮条；通知架是右上角的一列，
              // 所以把定位拆回文档流（纯几何覆盖，颜色/字号/边距仍走类）。
              position: "relative",
              left: "auto",
              bottom: "auto",
              transform: "none",
              // The floating wrapper is pointerEvents:"none" (click-through by design),
              // so the toast itself must opt back into interactivity or hover events never reach it
              pointerEvents: "auto",
              maxWidth: "100%",
              marginBottom: index === notices.length - 1 ? 0 : 6,
              overflow: "hidden",
              maxHeight: NOTICE_MAX_HEIGHT_PX,
              transformOrigin: "top right",
              // Use backwards fill for the entrance animation so height styles return to
              // inline styles once it finishes. 180ms/ease-out → 设计 §1.6 弹层档
              // (`--motion-base` + 全系统唯一曲线 `--ease`).
              animation: notice.exiting
                ? "notice-shelf-out var(--motion-base) var(--ease) forwards"
                : "notice-shelf-in var(--motion-base) var(--ease) backwards",
            }}
          >
            <span className={`d-badge ${notice.type === "error" ? "bad" : notice.type === "warning" ? "warn" : notice.type === "success" ? "ok" : "info"}`}>
              <i data-ico={typeIcon} data-size="12" aria-hidden="true"></i>
            </span>
            {/* Full text by default: pre-line preserves \n and long lines wrap instead of
                truncating; content taller than the cap scrolls inside the text area */}
            <span
              tabIndex={0}
              style={{ minWidth: 0, maxWidth: "100%", maxHeight: NOTICE_TEXT_MAX_HEIGHT_PX, overflowY: "auto", scrollbarWidth: "thin", whiteSpace: "pre-line", wordBreak: "break-word" }}
            >
              {notice.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}

type ExtensionDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;

function getExtensionDialogSummary(request: ExtensionDialogRequest): string | undefined {
  if (request.method === "select" && request.options.length > 0) return request.options[0];
  if (request.method === "confirm") {
    const firstLine = request.message.split("\n").find((line) => line.trim());
    return firstLine?.trim();
  }
  return undefined;
}

/**
 * Render the scrollable portion of a dialog title: ```sh / ```bash code fences are
 * rendered as highlighted code blocks (red border + red tint to flag risky commands),
 * and all other text keeps pre-wrap multi-line rendering.
 */
function renderDialogTitle(title: string): ReactNode {
  const segments = splitDialogTitleCode(title);
  if (segments.length === 1 && !segments[0].isCode) return title;
  return segments.map((seg, i) => {
    if (seg.isCode) {
      return (
        <pre
          key={i}
          style={{
            margin: "var(--space-row) 0",
            padding: "8px 10px",
            borderRadius: "var(--radius-sm)",
            background: "color-mix(in srgb, var(--danger) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)",
            borderLeft: "3px solid var(--danger)",
            fontFamily: "var(--font-mono)",
            fontSize: TEXT.sm,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            overflowX: "auto",
            color: "var(--text)",
          }}
        >
          {seg.text}
        </pre>
      );
    }
    return (
      <span key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {seg.text}
      </span>
    );
  });
}

/** fork:zm-04 — 剩余秒数（组件外，避免在 render 里直接调用 Date.now）。 */
function remainingSecondsUntil(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}

/**
 * fork:zm-04 —— 倒计时秒数（1 Hz 的 **DOM 写入**，不触发 React 渲染）。
 *
 * 原来 `now` state 挂在 ExtensionDialog 上，每秒重渲染整张卡（含 MarkdownBody
 * 与选项列表）。现在只在这里写一个 text node；父组件在倒计时期间渲染次数为 0。
 *
 * fork:design-components —— className 由调用点给：对话框头部传 .pw-badge.count
 * （画板 50「倒计时数字在标题右端」），折叠条那处不传（保持行内小字）。
 */
function ExtensionCountdownText({ expiresAt, className }: { expiresAt: number; className?: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLSpanElement | null>(null);
  const initialSeconds = remainingSecondsUntil(expiresAt);

  useEffect(() => {
    const write = () => {
      const node = ref.current;
      if (!node) return;
      node.textContent = t("chat.extensionExpiresIn", { seconds: remainingSecondsUntil(expiresAt) });
    };
    write();
    const timer = setInterval(write, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, t]);

  return (
    <span
      ref={ref}
      className={className ?? "d-t-xs d-t-faint"}
      style={{ whiteSpace: "nowrap", flexShrink: 0 }}
    >
      {t("chat.extensionExpiresIn", { seconds: initialSeconds })}
    </span>
  );
}

/**
 * fork:zm-04 —— 审批倒计时进度条（WAAPI，零每秒渲染）。
 *
 * `scaleX(1) → scaleX(0)` 的线性动画，duration = 剩余毫秒，`fill: forwards`。
 * 只在显式 `no-preference` 时播放；reduced-motion / SSR / jsdom 直接隐藏填充
 * （静态满格条会让人误以为时间还在多，不如只留秒数文本）。
 *
 * fork:design-components —— 壳走画板 D-26b 帧 D 的 `.d-bar`（头部正下方一条强调色
 * 进度条，`.d-bar > i` 自带 3px 填充与强调色），动画仍落在内层 `<i>` 上（scaleX）。
 */
function ExtensionCountdownBar({ expiresAt }: { expiresAt: number }) {
  const motion = useMotionPreference();
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const remainingMs = expiresAt - Date.now();
    if (motion !== "no-preference" || remainingMs <= 0 || typeof node.animate !== "function") {
      node.style.opacity = "0";
      return;
    }
    const animation = node.animate(
      [{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }],
      { duration: remainingMs, easing: "linear", fill: "forwards" },
    );
    return () => animation.cancel();
  }, [expiresAt, motion]);

  return (
    <div className="d-bar" aria-hidden="true" style={{ borderRadius: 0, flexShrink: 0 }}>
      <i
        ref={ref}
        data-fork-countdown-bar
        style={{ width: "100%", transformOrigin: "left center", pointerEvents: "none" }}
      />
    </div>
  );
}

function ExtensionDialog({
  request,
  onRespond,
}: {
  request: ExtensionDialogRequest;
  onRespond: (request: ExtensionDialogRequest, response: { value: string } | { confirmed: boolean } | { cancelled: true }) => void;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(request.method === "editor" ? request.prefill ?? "" : "");
  const [collapsed, setCollapsed] = useState(false);
  // fork:pi-1.1（#1032）—— 对话框默认 560px，只在自身内容装不下（代码块/表格会横滚）
  // 时才长宽；「最大化」是用户对这一张的覆盖。
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [fitWidth, setFitWidth] = useState<number | null>(null);
  const [full, setFull] = useState(false);
  const toggleFull = useCallback(() => setFull((prev) => !prev), []);
  const focusFirstOption = useCallback((element: HTMLDivElement | null) => element?.focus(), []);
  const summary = getExtensionDialogSummary(request);
  const { head: titleHead, rest: titleRest } = splitDialogTitle(request.title);

  useLayoutEffect(() => {
    if (collapsed) return;
    const dialog = dialogRef.current;
    const body = bodyRef.current;
    if (!dialog || !body) return;
    let disposed = false;
    const fit = () => {
      if (disposed) return;
      const blocks = body.querySelectorAll<HTMLElement>("pre, .markdown-table-wrap");
      if (blocks.length === 0) return;
      const needed = fitExtensionDialogWidth(
        dialog.offsetWidth,
        Array.from(blocks, (block) => block.scrollWidth - block.clientWidth),
      );
      // Only ever grow: shrinking again would make the dialog jump while it is read.
      if (needed !== null) setFitWidth((prev) => (prev !== null && prev >= needed ? prev : needed));
    };
    fit();
    // Highlighted code replaces its plain fallback after the first paint, and a web
    // font can change glyph widths once it arrives.
    const mutations = new MutationObserver(fit);
    mutations.observe(body, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(fit);
    return () => {
      disposed = true;
      mutations.disconnect();
    };
  }, [collapsed]);

  const submitValue = () => {
    if (request.method === "confirm") {
      onRespond(request, { confirmed: true });
    } else {
      onRespond(request, { value });
    }
  };

  /* fork:v6-landing —— 审批请求（lib/approval-extension.ts 的 ctx.ui.select）渲染成
     决策卡；三枚动作钮就是卡片本身，底部那条「取消 + 提交」foot 不再渲染
     （Esc 仍然取消，语义同拒绝）。 */
  const isApproval = request.method === "select" && isApprovalSelect(request);

  return (
    <div
      ref={dialogRef}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        onRespond(request, { cancelled: true });
      }}
      style={{
        // fork:extension-ui-queue —— 这一格是宿主叠层里的一个 flex item，尺寸在这一格定，
        // 叠层只管把它们排开。
        pointerEvents: "auto",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        // fork:pi-1.1（#1032）—— 「最大化」铺满叠层；否则按内容宽度（默认 560）。
        width: full ? "100%" : `min(${fitWidth ?? EXTENSION_DIALOG_BASE_WIDTH}px, 100%)`,
        // 百分比相对叠层那个定高盒子解析，所以这一格能撑满消息区又不越界。
        maxHeight: full ? "100%" : "min(760px, 100%)",
      }}
    >
      {collapsed ? (
        <button
          type="button"
          className="d-banner"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          style={{ pointerEvents: "auto", position: "relative", overflow: "hidden", width: "100%", font: "inherit", cursor: "pointer", textAlign: "left" }}
        >
          <span className="d-badge warn" style={{ flexShrink: 0 }}>
            {t("chat.extensionPending")}
          </span>
          <span className="d-grow d-t-b" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {titleHead}
          </span>
          {summary && (
            <span className="d-t-xs d-t-faint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "34%", flexShrink: 1 }}>
              {summary}
            </span>
          )}
          {request.expiresAt !== undefined && <ExtensionCountdownText expiresAt={request.expiresAt} />}
          <span className="d-t-xs d-t-faint" style={{ flexShrink: 0 }}>
            {t("chat.extensionExpand")}
          </span>
          {/* fork:zm-04 — WAAPI 进度条；倒计时不产生任何 React 渲染。
              折叠态没有头部，倒计时条仍贴在卡片底边（按钮的 overflow:hidden 会裁住）。 */}
          {request.expiresAt !== undefined && (
            <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "block" }}>
              <ExtensionCountdownBar expiresAt={request.expiresAt} />
            </span>
          )}
        </button>
      ) : (
      <div
        role="dialog"
        aria-label={request.title}
        aria-modal="true"
        className="anim-dialog d-modal-box"
        style={{
          pointerEvents: "auto",
          position: "relative",
          // 这一格已经量好宽高上限（maxHeight 在宿主叠层那一格），卡片只在里面撑满。
          flex: "1 1 auto",
          minHeight: 0,
          width: "100%",
          maxHeight: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* fork:design-components —— 扩展请求对话框 = 画板 D-26b 帧 D「来自扩展的请求」：
            `.d-modal-box` › `.d-modal-head`（blocks 图标 + 标题 + 收起 `.d-iconbtn`）›
            `.d-bar` 倒计时条 › `.d-modal-body`（选择 / 确认 / 输入 / 编辑器四态共用）›
            `.d-modal-foot`（取消 `.d-btn.ghost` + 提交 `.d-btn.primary`）。
            fork:extension-dialog-title（上游 #961 / #890 移植）—— 两个 fork-* 钩子把
            「标题过长时收缩」交给 app/fork-ui.css：头部可收缩 + 限高可滚（选项列表与
            取消键不再被顶出对话框），标题本体钳成省略号。`whiteSpace: "pre-wrap"`
            原样留着 —— splitDialogTitle 给出的 head 仍按扩展给的换行分行，一个换行都
            不吞；完整标题另有 title / aria-label。 */}
        <div
          className="d-modal-head d-row fork-ext-dialog-head"
          style={{ alignItems: "flex-start" }}
        >
          <div className="d-col d-grow" style={{ gap: "var(--nx-sp-1)" }}>
            <div className="d-row">
              <i data-ico="blocks" data-size="15" aria-hidden="true" style={{ color: "var(--nx-accent)", flexShrink: 0 }} />
              <span
                className="d-grow d-t-b fork-ext-dialog-title"
                title={titleHead}
                style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {titleHead}
              </span>
            </div>
            <div className="d-row d-t-xs d-t-faint" style={{ gap: "var(--nx-sp-2)" }}>
              <span>{t("chat.extensionRequest")}</span>
              {request.expiresAt !== undefined && <ExtensionCountdownText className="d-badge warn" expiresAt={request.expiresAt} />}
            </div>
          </div>
          <button
            type="button"
            className="d-iconbtn"
            onClick={toggleFull}
            aria-pressed={full}
            title={full ? t("chat.extensionRestoreSize") : t("chat.extensionMaximize")}
            aria-label={full ? t("chat.extensionRestoreSize") : t("chat.extensionMaximize")}
            style={{ flexShrink: 0 }}
          >
            <i data-ico={full ? "minimize-2" : "maximize-2"} data-size="14" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="d-iconbtn"
            onClick={() => setCollapsed(true)}
            aria-expanded={true}
            title={t("chat.extensionCollapse")}
            aria-label={t("chat.extensionCollapse")}
            style={{ flexShrink: 0 }}
          >
            <i data-ico="chevron-down" data-size="14" aria-hidden="true" />
          </button>
        </div>
        {request.expiresAt !== undefined && <ExtensionCountdownBar expiresAt={request.expiresAt} />}

        {/* fork:design-components —— 正文区 = 画板 D-26b 帧 D 的 `.d-modal-body`：
            选择态走 `.d-tree` + `.d-menu-row`，确认态直接 Markdown，输入态 `.d-input`，
            编辑器态 `.d-textarea`；四态共用同一个壳。滚动容器需要的
            flex/minHeight/overflowY 仍是内联，滚动行为照旧。 */}
        <div
          ref={bodyRef}
          className="d-modal-body"
          style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}
        >
          {titleRest && (
            <div className="d-t-cap d-t-dim" style={{ lineHeight: 1.55 }}>
              {renderDialogTitle(titleRest)}
            </div>
          )}
          {request.method === "confirm" && (
            <MarkdownBody>{request.message}</MarkdownBody>
          )}
          {request.method === "select" && (
            isApprovalSelect(request) ? (
              /* fork:v6-landing —— 工具审批走画板 D-32 帧 A 的 `.d-approve`（beUI
                 approval-card 的 V5 化）：决策卡三钮横排，卡身中性、危险只在命令与
                 「拒绝」钮上。数据从 approvalPrompt 的固定形状拆出（第一段=风险原因，
                 第二段=label:摘要）；键盘沿用 data-extension-option 通道。 */
                <ApprovalCardBody request={request} onRespond={onRespond} />
            ) : (
            <div
              onKeyDown={(event) => {
                if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) return;
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-extension-option]"));
                const index = buttons.indexOf(event.target as HTMLElement);
                if (index < 0) return;
                event.preventDefault();
                const next = event.key === "Home" ? 0
                  : event.key === "End" ? buttons.length - 1
                  : (index + (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next].focus({ preventScroll: true });
                buttons[next].scrollIntoView({ block: "nearest" });
              }}
              className="d-tree"
              style={{ gap: "var(--nx-sp-1)" }}
            >
              {request.options.map((option, index) => (
                <div
                  key={option}
                  role="button"
                  tabIndex={0}
                  data-extension-option
                  aria-label={option}
                  /* fork:design-components —— 选项行挂画板 `.d-menu-row`（文本行，
                     不裁切 Markdown；内含 MarkdownBody 需要更大的触达面）。 */
                  className="d-menu-row"
                  ref={index === 0 ? focusFirstOption : undefined}
                  onClick={() => onRespond(request, { value: option })}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onRespond(request, { value: option });
                  }}
                  style={{
                    overflowWrap: "anywhere",
                    // fork:upstream-0.9.2-ext-select — 等于滚动容器的内边距，
                    // 键盘选中项就不会被吸附到边缘而截掉 focus ring。
                    scrollMargin: 14,
                  }}
                >
                  <div inert>
                    <MarkdownBody>{option}</MarkdownBody>
                  </div>
                </div>
              ))}
            </div>
            )
          )}
          {request.method === "input" && (
            /* fork:design-components —— 输入框 = 画板 D-26b 帧 D「输入」那一件的 `.d-input`。 */
            <input
              className="d-input"
              autoFocus
              value={value}
              placeholder={request.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) submitValue();
              }}
              style={{ width: "100%", flex: "0 0 auto" }}
            />
          )}
          {request.method === "editor" && (
            /* fork:design-components —— 编辑器 = 画板 D-26b 帧 D「编辑器」那一件的
               `.d-textarea`（等宽 · 可纵向拉伸）；只留布局需要的内联。 */
            <textarea
              className="d-textarea d-mono"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.nativeEvent.isComposing) submitValue();
              }}
              style={{ width: "100%", minHeight: 220, maxHeight: "100%", flex: "0 0 auto" }}
            />
          )}
        </div>

        {/* fork:design-components —— 动作行 = 画板 D-26b 帧 D 的 `.d-modal-foot`（上边框 +
            右对齐 + gap）。取消 = `.d-btn.ghost`，确认/提交 = `.d-btn.primary`（强调填充）。
            danger 留给不可逆动作，扩展请求的取消只是收起这次请求，所以仍是普通 ghost。
            倒计时条已移到头部下方，此处不再重复渲染。 */}
        {!isApproval && (
        <div className="d-modal-foot">
          <button
            type="button"
            className="d-btn ghost"
            autoFocus={request.method === "confirm" || (request.method === "select" && request.options.length === 0)}
            onClick={() => onRespond(request, { cancelled: true })}
          >
            {t("chat.cancel")}
          </button>
          <span className="d-grow" />
          {request.method === "confirm" ? (
            <button
              type="button"
              className="d-btn primary"
              onClick={submitValue}
            >
              {t("chat.confirm")}
            </button>
          ) : request.method !== "select" ? (
            <button
              type="button"
              className="d-btn primary"
              onClick={submitValue}
            >
              {t("chat.submit")}
            </button>
          ) : null}
        </div>
        )}
      </div>
      )}
    </div>
  );
}

type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

/* fork:v6-landing —— 审批请求的辨识口径：lib/approval-extension.ts 的 approvalPrompt
   把 title 拼成固定两段（首行「需要确认这笔操作（原因）」），且选项恰为
   APPROVAL_CHOICES 三项。两条同时成立才走决策卡，其余 select 一律走通用对话框。 */
function isApprovalSelect(request: ExtensionDialogRequest): boolean {
  if (request.method !== "select") return false;
  if (request.options.length !== APPROVAL_CHOICES.length) return false;
  if (!APPROVAL_CHOICES.every((choice, index) => request.options[index] === choice)) return false;
  return request.title.startsWith("需要确认这笔操作");
}

/* fork:v6-landing —— 审批决策卡 = 画板 D-32 帧 A 的 `.d-approve`（beUI approval-card
   的 V5 化）。卡身中性（panel 底 + 发丝线），危险语义只在命令代码与「拒绝」钮上；
   三枚动作钮横排底部（首钮 = 允许一次 primary，末钮 = 拒绝 danger ghost，选项顺序
   就是 APPROVAL_CHOICES）。挂载时 Motion 弹簧入场（lib/motion-pop.ts 的 springEnter）。
   data-extension-option 保留：折叠横幅的键盘/焦点通道与通用对话框同一份。 */
function ApprovalCardBody({
  request,
  onRespond,
}: {
  request: Extract<ExtensionDialogRequest, { method: "select" }>;
  onRespond: (request: ExtensionDialogRequest, response: { value: string }) => void;
}) {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // 与通用对话框的 focusFirstOption 同语义:打开时焦点落首钮(方向键从它出发)
    firstOptionRef.current?.focus();
  }, []);

  useEffect(() => {
    springEnter(cardRef.current);
  }, []);

  /* approvalPrompt 的形状：`需要确认这笔操作（原因）\n\n命令：<summary>`。
     label 决定头标题（命令 / 工具），摘要做等宽代码块，原因做小字。 */
  const [reasonLine, detailLine] = request.title.split("\n\n");
  const separator = (detailLine ?? "").indexOf("：") >= 0 ? "：" : ":";
  const labelEnd = (detailLine ?? "").indexOf(separator);
  const label = labelEnd > 0 ? (detailLine ?? "").slice(0, labelEnd) : "";
  const detailText = labelEnd > 0 ? (detailLine ?? "").slice(labelEnd + separator.length).trim() : (detailLine ?? "").trim();
  const isCommand = label.includes("命令");

  const optionClass = (option: string) => {
    if (option === APPROVAL_CHOICES[APPROVAL_CHOICES.length - 1]) return "d-btn sm danger ghost";
    if (option === APPROVAL_CHOICES[0]) return "d-btn sm primary";
    return "d-btn sm";
  };

  return (
    <div className="d-approve" ref={cardRef}>
      <div className="d-approve-head">
        <i data-ico="shield-alert" data-size="14" aria-hidden="true"></i>
        <span>{isCommand ? t("chat.approvalCommand") : t("chat.approvalTool")}</span>
      </div>
      <div className="d-approve-body d-col" style={{ gap: "var(--nx-sp-2)" }}>
        {detailText && (
          <div className="d-term plain d-mono" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {detailText}
          </div>
        )}
        {reasonLine && <span className="d-t-xs d-t-faint">{reasonLine}</span>}
      </div>
      <div
        className="d-approve-acts"
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) return;
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-extension-option]"));
          const index = buttons.indexOf(event.target as HTMLElement);
          if (index < 0) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0
            : event.key === "End" ? buttons.length - 1
            : (index + (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
          buttons[next].focus({ preventScroll: true });
        }}
      >
        {request.options.map((option, index) => (
          <button
            key={option}
            type="button"
            data-extension-option
            aria-label={option}
            className={optionClass(option)}
            ref={index === 0 ? firstOptionRef : undefined}
            onClick={() => onRespond(request, { value: option })}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              onRespond(request, { value: option });
            }}
          >
            {option}
          </button>
        ))}
        <span className="d-grow"></span>
        <span className="d-t-xs d-t-faint">
          <span className="d-kbd">Esc</span> {t("chat.approvalEscHint")}
        </span>
      </div>
    </div>
  );
}

function ExtensionCustomPanel({
  request,
  onInput,
}: {
  request: ExtensionCustomRequest;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const displayLines = normalizeCustomPanelLines(request.lines);
  const summary = displayLines.find((line) => line.trim())?.trim();

  useEffect(() => {
    if (!collapsed) inputRef.current?.focus();
  }, [collapsed]);

  return (
    <div
      style={{
        // fork:extension-ui-queue —— 同对话框：宿主叠层里的一格，尺寸在这一格定。
        pointerEvents: "auto",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        width: "min(920px, 100%)",
        maxHeight: "min(760px, 100%)",
      }}
    >
      {collapsed ? (
        <button
          type="button"
          className="d-banner"
          onClick={() => setCollapsed(false)}
          aria-expanded={false}
          style={{ pointerEvents: "auto", width: "100%", font: "inherit", cursor: "pointer", textAlign: "left" }}
        >
          <span className="d-badge warn" style={{ flexShrink: 0 }}>
            {t("chat.extensionPending")}
          </span>
          <span className="d-grow d-t-b" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("chat.extensionPanel")}
          </span>
          {summary && (
            <span className="d-t-xs d-t-faint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "34%", flexShrink: 1 }}>
              {summary}
            </span>
          )}
          <span className="d-t-xs d-t-faint" style={{ flexShrink: 0 }}>
            {t("chat.extensionExpand")}
          </span>
        </button>
      ) : (
      <div
        role="dialog"
        onClick={(event) => {
          if (!(event.target as HTMLElement).closest("button")) inputRef.current?.focus();
        }}
        className="anim-dialog d-modal-box"
        style={{
          pointerEvents: "auto",
          position: "relative",
          flex: "1 1 auto",
          minHeight: 0,
          width: "100%",
          maxHeight: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          outline: "none",
        }}
      >
        <textarea
          ref={inputRef}
           aria-label={t("chat.extensionInput")}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const data = toTerminalKeyData(event);
            if (!data) return;
            event.preventDefault();
            event.stopPropagation();
            onInput(request, data);
          }}
          onInput={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing) return;
            const text = event.currentTarget.value;
            event.currentTarget.value = "";
            if (text) onInput(request, text);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            const input = event.currentTarget;
            queueMicrotask(() => {
              const text = input.value;
              input.value = "";
              if (text) onInput(request, text);
            });
          }}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text");
            if (text) onInput(request, asBracketedPaste(text));
          }}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            border: 0,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
        {/* fork:design-components —— 终端面板头与扩展请求对话框同一个壳
            （画板 D-26b 帧 D 的 `.d-modal-head`）：下边框 + gap，动作走 `.d-iconbtn` / `.d-btn.sm`。 */}
        <div className="d-modal-head d-row">
          <i data-ico="terminal" data-size="16" aria-hidden="true" style={{ color: "var(--nx-accent)", flexShrink: 0 }} />
          <span className="d-grow d-t-b">{t("chat.extensionPanel")}</span>
          <button
            type="button"
            className="d-iconbtn"
            onClick={() => setCollapsed(true)}
            aria-expanded={true}
            title={t("chat.extensionCollapse")}
            aria-label={t("chat.extensionCollapse")}
          >
            <i data-ico="chevron-down" data-size="14" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="d-btn sm"
            onClick={() => onInput(request, "\x03")}
          >
            {t("chat.close")}
          </button>
        </div>
        {/* fork:design-components —— 正文是 ANSI 终端输出，交给画板 D-05 的 `.d-term`
            （等宽 · --nx-code-bg · 圆角）；只留滚动与不换行两处内联。 */}
        <pre
          className="d-term"
          style={{
            margin: 0,
            flex: "1 1 auto",
            minHeight: 0,
            overflow: "auto",
            whiteSpace: "pre",
            borderRadius: 0,
          }}
        >
          <AnsiText text={displayLines.join("\n")} />
        </pre>
      </div>
      )}
    </div>
  );
}
