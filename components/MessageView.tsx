"use client";

import { memo, useCallback, useState, useRef, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { MarkdownBody } from "./MarkdownBody";
import { useFileIndex, useSkillInfo } from "@/hooks/useProjectContext";
import { useCollapsePresence } from "@/hooks/useCollapsePresence";
import type { MentionValidators } from "@/lib/mention-tokens";
import { CopyStateIcon } from "./fork/CopyStateIcon";
import { ImagePreview } from "./ImagePreview";
import { ThinkingIcon } from "./ThinkingIcon";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/hooks/useI18n";
import { parseCompactionSummary } from "@/lib/compaction-summary";
import { getAssistantErrorMessage, getThinkingPreview, isEmptyThinkingBlock } from "@/lib/message-display";
import { parseUnifiedPatch, type SplitDiffCell, type SplitDiffFile } from "@/lib/patch";
// fork:zc-07 — 词级行内 diff：并排 diff 里只标记真正变化的字/词。
import { buildIntralineSegments, diffIntraline, type IntralineSpan } from "@/lib/diff-intraline";
import { applyPatchPreviewToFiles, extractApplyPatchPaths, getApplyPatchInputText, parseApplyPatchInput } from "@/lib/apply-patch";
import { isApplyPatchToolName, isEditToolName } from "@/lib/tool-names";
import { isThinkingExpandedByDefault, THINKING_EXPANDED_EVENT } from "@/lib/thinking-expansion-preference";
import type { TurnStats } from "@/lib/turn-stats";
import { TurnWrittenFiles } from "./TurnWrittenFiles";
import { TurnSkillUsageSummary } from "./fork/TurnSkillUsageSummary";
import type { WrittenFile } from "@/lib/turn-written-files";
import type { SkillActivation } from "@/lib/skill-usage";
import { skillExpansionToCommand } from "@/lib/slash-display";
import type { SubagentToolDetails } from "@/lib/subagent-extension";
import type {
  AgentMessage,
  AgentUsage,
  UserMessage,
  AssistantMessage,
  CustomMessage,
  ToolResultMessage,
  BashExecutionMessage,
  AssistantContentBlock,
  TextContent,
  ImageContent,
  ToolCallContent,
  ThinkingContent,
} from "@/lib/types";
import { TEXT } from "@/lib/typography";

// CJK chars ~1 token each (GLM/DeepSeek/GPT-o200k); other chars ~4 chars/token.
const CJK_PATTERN = /[\u3000-\u30ff\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}\uac00-\ud7af]/u;
function estimateTokens(text: string): number {
  let cjk = 0;
  let rest = 0;
  for (const ch of text) {
    if (CJK_PATTERN.test(ch)) cjk++;
    else rest++;
  }
  return cjk + rest / 4;
}

interface TokenEstimateCacheEntry {
  text: string;
  tokens: number;
}

export function getTokenEstimateText(block: AssistantContentBlock): string | null {
  if (block.type === "text") return block.text;
  if (block.type === "thinking") return block.thinking;
  if (block.type === "toolCall") return block.rawInput ?? JSON.stringify(block.input ?? {}) ?? "";
  return null;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function estimateUpdatedTokens(previous: TokenEstimateCacheEntry | undefined, text: string): number {
  if (!previous || !text.startsWith(previous.text)) return estimateTokens(text);

  let baseTokens = previous.tokens;
  let suffixStart = previous.text.length;
  // A streamed delta can complete a surrogate pair that was counted as two
  // non-CJK code points in the previous update.
  if (
    suffixStart > 0
    && suffixStart < text.length
    && isHighSurrogate(previous.text.charCodeAt(suffixStart - 1))
    && isLowSurrogate(text.charCodeAt(suffixStart))
  ) {
    baseTokens -= 1 / 4;
    suffixStart--;
  }
  return baseTokens + estimateTokens(text.slice(suffixStart));
}

const MAX_THINKING_CACHE_ENTRIES = 100;
const thinkingContentCache = new Map<string, Promise<string>>();

// Messages larger than this skip markdown rendering entirely. react-markdown +
// KaTeX + syntax highlighting on multi-hundred-KB payloads (e.g. pasted HAR or
// log dumps) freezes the browser main thread.
const MAX_MARKDOWN_CHARS = 100_000;

function formatMessageBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} KB`;
  return `${n} B`;
}

/**
 * MarkdownBody with an oversized-content guard: huge messages render as a
 * click-to-reveal plain-text <pre> instead of running the markdown pipeline.
 */
/**
 * Provider errors routinely carry an actionable URL ("opt in at …", "see …").
 * Rendering the whole box as plain text made the user copy it by hand, so any
 * http(s) token inside the message becomes a link. Everything else stays as it
 * was, including the `pre-wrap` layout.
 */
export function splitErrorLinks(text: string): { text: string; link: boolean }[] {
  return text.split(/(https?:\/\/[^\s"'<>()]+)/g).filter((part) => part !== "").map((part) => ({
    text: part,
    link: /^https?:\/\//.test(part),
  }));
}

function SafeMarkdownBody({ children, className, ...props }: React.ComponentProps<typeof MarkdownBody>) {
  const { t } = useI18n();
  const [showRaw, setShowRaw] = useState(false);

  if (children.length <= MAX_MARKDOWN_CHARS) {
    return <MarkdownBody className={className} {...props}>{children}</MarkdownBody>;
  }
  if (!showRaw) {
    /* fork:design-components —— 超长消息折叠用画板 12 的 `.pw-alert`（info 态）：
       整条是一个按钮，`pw-ico` 起首 + `pw-grow` 承载文案（board 10/12 同款结构）。
       `button.pw-alert` 的 UA 归零见 app/fork-ui.css（本次报告第 2 节）。
       展开后是画板 12 E 的「内嵌文本」形态：`pw-term` 一块。 */
    return (
      <button
        type="button"
        className="pw-alert info"
        onClick={() => setShowRaw(true)}
      >
        <span className="pw-ico"><i data-ico="info" data-size="14"></i></span>
        <span className="pw-grow">{t("i18n.largeMessageReveal", { size: formatMessageBytes(children.length) })}</span>
      </button>
    );
  }
  return (
    <div className={className} style={{ maxHeight: 420, overflow: "auto" }}>
      <div className="pw-term" style={{ fontSize: "calc(12.5px + var(--chat-font-size-offset, 0px))" }}>
        {children}
      </div>
    </div>
  );
}

// Cap the user "sent" bubble's height so an abnormally long message does not
// push the conversation off screen; overflow scrolls inside the bubble.
const USER_BUBBLE_MAX_HEIGHT = 300;

/**
 * fork:fix-thinking-affordance — 流式结束后多久自动折叠思考块。
 * 取 1s：足够让用户看到"思考结束"这个状态变化，又不会一直占着版面。
 */
const THINKING_AUTO_COLLAPSE_MS = 1_000;

function loadThinkingContent(sessionId: string, entryId: string, blockIndex: number): Promise<string> {
  const key = `${sessionId}:${entryId}:${blockIndex}`;
  const cached = thinkingContentCache.get(key);
  if (cached) {
    thinkingContentCache.delete(key);
    thinkingContentCache.set(key, cached);
    return cached;
  }

  const request = fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/entries/${encodeURIComponent(entryId)}/thinking?blockIndex=${blockIndex}`,
  ).then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json() as { thinking?: unknown };
    if (typeof data.thinking !== "string") throw new Error("Invalid thinking response");
    return data.thinking;
  }).catch((error) => {
    thinkingContentCache.delete(key);
    throw error;
  });

  thinkingContentCache.set(key, request);
  if (thinkingContentCache.size > MAX_THINKING_CACHE_ENTRIES) {
    const oldestKey = thinkingContentCache.keys().next().value;
    if (oldestKey) thinkingContentCache.delete(oldestKey);
  }
  return request;
}

interface Props {
  message: AgentMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  onOpenSession?: (sessionId: string) => void;
  entryId?: string;
  searchBlock?: AssistantContentBlock;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  /** fork:proma-04-rewind — 「回退到此处」：截断这条之后的所有对话。 */
  onRewind?: (entryId: string) => void;
  rewinding?: boolean;
  onNavigate?: (entryId: string) => Promise<boolean>;
  onEditContent?: (message: UserMessage) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  /** fix:turn-stats —— 本轮（用户消息 → 这条助手消息结束）的累计统计，由 ChatWindow 算好。 */
  turnStats?: TurnStats;
  sessionId?: string;
  /**
   * Files this turn wrote, derived by the caller from the whole turn's
   * successful write/edit tool calls. ChatWindow computes this because the
   * saved-message path splits tool calls into their own entries, leaving the
   * final answer text-only.
   */
  writtenFiles?: WrittenFile[];
  /** fork:proma-32-skill-usage —— 本轮用到的 skill（同上，由 ChatWindow 从整轮推导）。 */
  skillUsage?: SkillActivation[];
  /** fork:proma-32-skill-usage —— 点 chip 打开 Skills 分节并定位到该 slug。 */
  onOpenSkill?: (slug: string) => void;
  /** Lifted expanded state for tool calls — when provided, ToolCallBlock becomes controlled. */
  expandedToolIds?: Set<string>;
  onToggleTool?: (toolCallId: string) => void;
}

export function getModelDisplayName(
  provider: string,
  responseModel: string,
  modelNames?: Record<string, string>,
): string {
  const normalizedProvider = provider.toLowerCase();
  const normalizedResponse = responseModel.toLowerCase();
  const configured = Object.entries(modelNames ?? {}).flatMap(([key, name]) => {
    const separator = key.indexOf(":");
    return separator > 0 && key.slice(0, separator).toLowerCase() === normalizedProvider
      ? [{ id: key.slice(separator + 1).toLowerCase(), name }]
      : [];
  });
  return configured.find((model) => model.id === normalizedResponse)?.name
    ?? configured.find((model) => normalizedResponse.endsWith(`/${model.id}`))?.name
    ?? Object.entries(modelNames ?? {}).find(([key]) => key.toLowerCase() === normalizedResponse)?.[1]
    ?? `${provider}/${responseModel}`;
}

function formatTime(ts?: number): string | null {
  if (!ts) return null;
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (isToday) return time;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
  return `${date} ${time}`;
}

/* fork:fix-clipboard —— 三个消息视图（用户 / 助手 / 扩展自定义卡）共用的复制三态。
 *
 * 之前三处都是 `copyText(x).then(() => setCopied(true))`：返回值被丢掉，而
 * `copyText` 现在**永不 reject**、只会 resolve 成 `{ok:false,reason}`，于是
 * 写剪贴板被拒时按钮纹丝不动 —— 用户点完什么反馈都没有。
 *
 * 收敛规则与 components/MermaidBlock.tsx 的 CodeBlock 一致：
 *  - 成功档观感一个字没动（CopyStateIcon 形变 + 「已复制」，1500ms 复位）；
 *  - 失败档 2600ms，给用户留出读完一句话的时间；
 *  - 复位走函数式 setState 且只复位**自己刚写下**的那一档，连点两次时
 *    上一次的定时器不会把新状态抹掉。 */
type CopyState = "idle" | "copied" | "failed";

const COPY_RESET_MS = 1500;
const COPY_FAILED_RESET_MS = 2600;

function useMessageCopy() {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimerRef = useRef<number | null>(null);

  // 复制完立刻切会话/滚走这条消息是常事，卸载后别再 setState。
  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
  }, []);

  const copy = useCallback((text: string) => {
    // `copyText` 永不 reject：读 `ok` 决定给不给反馈，所以这里不写 .catch。
    void copyText(text).then((result) => {
      const next: CopyState = result.ok ? "copied" : "failed";
      setState(next);
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null;
        setState((current) => (current === next ? "idle" : current));
      }, result.ok ? COPY_RESET_MS : COPY_FAILED_RESET_MS);
    });
  }, []);

  return { copied: state === "copied", failed: state === "failed", copy };
}

/*
 * fork:fix-clipboard —— 失败提示挂在**消息列**里，不挂在动作行里。
 * `.pw-msg-acts` 在 `@media (hover: hover)` 下是 `opacity:0`（app/fork-ui.css），
 * 失败徽标放进去等于没提示：鼠标一移开就消失，读屏用户也拿不到位置。
 *
 * 形态复用本文件**已有**的失败态 —— provider 错误框那条 `.pw-alert`（error 底 +
 * `circle-x` 图标槽 + `.pw-grow` 正文，components/MessageView.tsx:800）：
 * 不另造提示系统。文案用仓库里已存在、此前无人引用的 `chat.todosCopyFailed`
 * （三语齐全，与 MermaidBlock 同一枚键）。
 */
function CopyFailedNotice({ style }: { style?: React.CSSProperties }) {
  const { t } = useI18n();
  return (
    <div role="status" className="pw-alert" style={style}>
      <span className="pw-ico"><i data-ico="circle-x" data-size="14"></i></span>
      <span className="pw-grow">{t("chat.todosCopyFailed")}</span>
    </div>
  );
}

export function replaceUserMessageText(message: UserMessage, text: string): UserMessage {
  if (typeof message.content === "string") return { ...message, content: text };

  const content: Array<TextContent | ImageContent> = [];
  let replaced = false;
  for (const block of message.content) {
    if (block.type !== "text") {
      content.push(block);
      continue;
    }
    if (!replaced) {
      content.push({ ...block, text });
      replaced = true;
    }
  }
  if (!replaced) content.unshift({ type: "text", text });
  return { ...message, content };
}

function haveSameRelevantToolResults(
  message: AgentMessage,
  previous: Map<string, ToolResultMessage> | undefined,
  next: Map<string, ToolResultMessage> | undefined,
): boolean {
  if (previous === next || message.role !== "assistant") return true;
  for (const block of (message as AssistantMessage).content ?? []) {
    if (block.type === "toolCall" && previous?.get(block.toolCallId) !== next?.get(block.toolCallId)) {
      return false;
    }
  }
  return true;
}

export const MessageView = memo(function MessageView({ message, isStreaming, toolResults, modelNames, cwd, onOpenFile, onOpenSession, entryId, searchBlock, onFork, forking, onRewind, rewinding, onNavigate, onEditContent, showTimestamp, prevTimestamp, turnStats, sessionId, writtenFiles, skillUsage, onOpenSkill, expandedToolIds, onToggleTool }: Props) {
  if (message.role === "user") {
    return <UserMessageView message={message as UserMessage} cwd={cwd} onOpenFile={onOpenFile} entryId={entryId} onFork={onFork} forking={forking} onRewind={onRewind} rewinding={rewinding} onNavigate={onNavigate} onEditContent={onEditContent} />;
  }
  if (message.role === "assistant") {
    return <AssistantMessageView message={message as AssistantMessage} isStreaming={isStreaming} toolResults={toolResults} modelNames={modelNames} cwd={cwd} onOpenFile={onOpenFile} onOpenSession={onOpenSession} showTimestamp={showTimestamp} prevTimestamp={prevTimestamp} turnStats={turnStats} sessionId={sessionId} entryId={entryId} searchBlock={searchBlock} writtenFiles={writtenFiles} skillUsage={skillUsage} onOpenSkill={onOpenSkill} expandedToolIds={expandedToolIds} onToggleTool={onToggleTool} />;
  }
  if (message.role === "toolResult") {
    // Rendered inline under its toolCall — skip standalone rendering if paired
    return null;
  }
  if (message.role === "custom") {
    if ((message as CustomMessage).customType === "compaction") {
      return <CompactionMessageView message={message as CustomMessage} />;
    }
    return <CustomMessageView message={message as CustomMessage} cwd={cwd} onOpenFile={onOpenFile} />;
  }
  if (message.role === "bashExecution") {
    return <BashExecutionView message={message as BashExecutionMessage} sessionId={sessionId} />;
  }
  return null;
}, (prev, next) => {
  return prev.message === next.message
    && prev.isStreaming === next.isStreaming
    && haveSameRelevantToolResults(prev.message, prev.toolResults, next.toolResults)
    && prev.modelNames === next.modelNames
    && prev.cwd === next.cwd
    && prev.onOpenFile === next.onOpenFile
    && prev.onOpenSession === next.onOpenSession
    && prev.entryId === next.entryId
    && prev.searchBlock === next.searchBlock
    && prev.onFork === next.onFork
    && prev.forking === next.forking
    // fork:proma-04-rewind
    && prev.onRewind === next.onRewind
    && prev.rewinding === next.rewinding
    && prev.onNavigate === next.onNavigate
    && prev.onEditContent === next.onEditContent
    && prev.showTimestamp === next.showTimestamp
    && prev.prevTimestamp === next.prevTimestamp
    && prev.turnStats === next.turnStats
    && prev.writtenFiles === next.writtenFiles
    // fork:proma-32-skill-usage
    && prev.skillUsage === next.skillUsage
    && prev.onOpenSkill === next.onOpenSkill
    && prev.sessionId === next.sessionId
    && prev.expandedToolIds === next.expandedToolIds
    && prev.onToggleTool === next.onToggleTool;
});

function UserMessageView({ message, cwd, onOpenFile, entryId, onFork, forking, onRewind, rewinding, onNavigate, onEditContent }: {
  message: UserMessage;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  entryId?: string;
  onFork?: (entryId: string) => void;
  forking?: boolean;
  // fork:proma-04-rewind — 「回退到此处」（UserMessageView 自己的 props 类型）
  onRewind?: (entryId: string) => void;
  rewinding?: boolean;
  onNavigate?: (entryId: string) => Promise<boolean>;
  onEditContent?: (message: UserMessage) => void;
}) {
  const { t } = useI18n();
  // fork:fix-clipboard —— 三态而不是 `copied: boolean`：复制**可能失败**。
  const { copied, failed, copy } = useMessageCopy();
  const [expanded, setExpanded] = useState(false);
  // fork:zm-01 — 折叠正文的两段式存在性：grid wrapper 常驻负责行高动画，正文在
  // 收起过渡结束后才卸载（见 hooks/useCollapsePresence.ts）。
  const collapseRef = useRef<HTMLDivElement>(null);
  const bodyMounted = useCollapsePresence(expanded, undefined, collapseRef);

  // fork:fix-user-line-breaks (#680) —— 会话文件里可能是 `\r\n` 或落单的 `\r`。
  // Chrome 即使在 pre-wrap 下也把落单 `\r` 渲染成空格，于是粘贴的老式 Mac 换行
  // 会被折成一段。命令参数、超长消息的原始视图、复制都走这份文本；
  // 会话文件里保存的仍是原文。
  const content = (
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((b): b is TextContent => b.type === "text")
          .map((b) => b.text)
          .join("\n")
  ).replace(/\r\n?/g, "\n");

  const imageBlocks: ImageContent[] =
    typeof message.content === "string"
      ? []
      : message.content.filter((b): b is ImageContent => b.type === "image");

  // D2-PR-12 — 用户消息正文里的 @file / /skill: 高亮。
  // 校验数据来自共享缓存（模块级 + 30s TTL + 并发去重）；未加载时返回 undefined，
  // 高亮一律不猜。代码块禁改由 remark 插件只遍历 text 节点保证。
  const fileIndex = useFileIndex(cwd);
  const skillInfo = useSkillInfo(cwd);
  const mentionValidators = useMemo<MentionValidators>(() => ({
    fileExists: (path) => {
      if (!fileIndex) return undefined;
      const key = path.toLowerCase();
      return fileIndex.paths.has(key) || fileIndex.dirs.has(key);
    },
    isSkill: (name) => (skillInfo ? skillInfo.has(name) : undefined),
  }), [fileIndex, skillInfo]);
  const userMessageMarkdownProps = { cwd, onOpenFile, highlightMentions: true, mentionValidators, keepLineBreaks: true } as const;

  const commandText = skillExpansionToCommand(content);
  const commandSeparator = commandText?.search(/\s/) ?? -1;
  const commandName = commandText
    ? commandSeparator === -1 ? commandText : commandText.slice(0, commandSeparator)
    : "";
  const commandArgs = commandText && commandSeparator !== -1
    ? commandText.slice(commandSeparator + 1)
    : "";

  const time = formatTime(message.timestamp);
  const canFork = !!entryId && !!onFork;
  // fork:proma-04-rewind — 回退同样是「按 entryId」的会话级操作
  const canRewind = !!entryId && !!onRewind;
  const copyTarget = commandText ?? content;
  const editTarget = commandText ? replaceUserMessageText(message, commandText) : message;

  const imageBlocksNode = imageBlocks.length > 0 && (
    <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap", marginBottom: content ? "var(--s2)" : 0 }}>
      {imageBlocks.map((img, i) => {
        // lib/types.ts ImageContent uses {source:{type,data,media_type,url}}
        // pi-ai on-disk format uses flat {data, mimeType} — handle both
        const src = imageSource(img);
        return (
          /* fork:design-components —— 图片内容块 = 画板 12 A 的 `.pw-img`
             （发丝框 / radius-6 / overflow hidden），真实图片取代画板的斜纹占位。 */
          <div className="pw-img" key={i}>
            <ImagePreview src={src}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                style={{ maxWidth: "var(--img-max)", maxHeight: "var(--img-max)", objectFit: "contain", display: "block" }}
              />
            </ImagePreview>
          </div>
        );
      })}
    </div>
  );
  const canNavigate = !!entryId && !!onNavigate;

  const copyContent = () => copy(copyTarget);

  return (
    <div
      data-message-role="user"
      style={{ marginBottom: 20, display: "flex", flexDirection: "column", alignItems: "flex-end" }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "flex-end", gap: "var(--space-row)", width: "100%", maxWidth: "100%" }}>
        <div
          /* fork:design-components —— 用户气泡直接用画板 10 的 .pw-msg-user
             （右对齐 78% / 发丝边框 / 面板底 / radius-6，board.css 承担全部视觉）。 */
          className="pw-msg-user"
          style={{
            minWidth: 0,
            fontSize: "calc(14px + var(--chat-font-size-offset, 0px))",
            lineHeight: 1.65,
            color: "var(--text)",
            wordBreak: "break-word",
            maxHeight: USER_BUBBLE_MAX_HEIGHT,
            overflowY: "auto",
          }}
        >
          {commandText ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-row)", minWidth: 0 }}>
              {imageBlocksNode}
              <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--s2)", flexWrap: "wrap" }}>
                <button
                  onClick={() => setExpanded((prev) => !prev)}
                  title={expanded ? t("i18n.collapse") : t("i18n.expand")}
                  aria-expanded={expanded}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-row)",
                    flexShrink: 0,
                    padding: 0,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "var(--accent)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "calc(12px + var(--chat-font-size-offset, 0px))",
                    textAlign: "left",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {commandName}
                  </span>
                  <span className="pw-ico" style={{ flexShrink: 0, opacity: 0.75, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
                    <i data-ico="chevron-down" data-size="11"></i>
                  </span>
                </button>
                {commandArgs && (
                  <span style={{
                    color: "var(--text)",
                    fontSize: "calc(14px + var(--chat-font-size-offset, 0px))",
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    minWidth: 0,
                    flex: 1,
                  }}>
                    {commandArgs}
                  </span>
                )}
              </div>
              {/* fork:zm-01 — 常驻 grid wrapper（0fr↔1fr）；正文只在收起动画期间保留。
                  marginTop:-6 抵消父级 flex gap:6：收起时 wrapper 不额外占 6px，
                  展开时由内层 marginTop:6 还回，展开态间距与原来一致。 */}
              <div
                ref={collapseRef}
                className="fork-collapse"
                data-fork-collapse={expanded ? "open" : "closed"}
                style={{ marginTop: -6 }}
              >
                {bodyMounted && (
                  <div className="fork-collapse-body" style={{ marginTop: "var(--space-row)" }}>
                    <MarkdownBody className="markdown-user-message" {...userMessageMarkdownProps}>{content}</MarkdownBody>
                  </div>
                )}
              </div>
            </div>
          ) : (
          <>
          {imageBlocksNode}
          {content && <SafeMarkdownBody className="markdown-user-message" {...userMessageMarkdownProps}>{content}</SafeMarkdownBody>}
          </>
          )}
        </div>

      </div>

      {/* fork:design-components —— 消息动作行换成画板 10 B 的 `.pw-msg-acts`：
          整行右对齐，成员一律 `.pw-btn sm` + `.pw-ico` + `i[data-ico]`。
          hover/焦点显隐仍由 app/fork-ui.css 承担（画板的 `.pw-msg-user:hover` 规则
          在产品里不成立 —— 动作行是消息列的兄弟节点，不在气泡内；需要的片段见报告）。 */}
      {/* fork:fix-clipboard —— 失败提示在**动作行外面**（见 CopyFailedNotice 的
          注释）：动作行 hover 才显形，提示放里面等于没提示。按钮本身照旧只说
          「复制 / 已复制」，失败档走 `.pw-btn.sm.danger` + title，另由那枚
          role=status 提示条承担文案。 */}
      <div className="pw-msg-acts">
        <button
          type="button"
          onClick={copyContent}
          title={failed ? t("chat.todosCopyFailed") : t("i18n.copyMessage")}
          className={failed ? "pw-btn sm danger" : "pw-btn sm"}
        >
          <span className="pw-ico">{CopyStateIcon({ copied })}</span>
          {copied ? t("i18n.copied") : t("i18n.copy")}
        </button>
        {canNavigate && (
          <button
            type="button"
            onClick={() => void onNavigate!(entryId!).then((navigated) => {
              if (navigated) onEditContent?.(editTarget);
            })}
            title={t("i18n.editFromHereTitle")}
            className="pw-btn sm"
          >
            <span className="pw-ico"><i data-ico="pencil-line" data-size="13"></i></span>
            {t("i18n.editFromHere")}
          </button>
        )}
        {canFork && (
          <button
            type="button"
            onClick={() => { onFork!(entryId!); }}
            disabled={forking}
            title={forking ? t("i18n.creatingSession") : t("i18n.newSessionTitle")}
            className={forking ? "pw-btn sm pw-dim" : "pw-btn sm"}
          >
            <span className="pw-ico"><i data-ico="git-branch" data-size="13"></i></span>
            {forking ? t("i18n.creating") : t("i18n.newSession")}
          </button>
        )}
        {/* fork:proma-04-rewind — 回退到此处（放在 fork 旁：两者都是「从这条消息出发」的会话级操作） */}
        {canRewind && (
          <button
            type="button"
            onClick={() => { onRewind!(entryId!); }}
            disabled={rewinding}
            title={t("rewind.actionTitle")}
            className={rewinding ? "pw-btn sm pw-dim" : "pw-btn sm"}
          >
            <span className="pw-ico"><i data-ico="undo-2" data-size="13"></i></span>
            {t("rewind.action")}
          </button>
        )}
        {time && <span className="pw-dim">{time}</span>}
      </div>
      {failed && <CopyFailedNotice style={{ marginTop: "var(--s1)" }} />}
    </div>
  );
}

function AssistantMessageView({
  message,
  isStreaming,
  toolResults,
  modelNames,
  cwd,
  onOpenFile,
  onOpenSession,
  showTimestamp,
  prevTimestamp,
  turnStats,
  sessionId,
  entryId,
  searchBlock,
  writtenFiles,
  skillUsage,
  onOpenSkill,
  expandedToolIds,
  onToggleTool,
}: {
  message: AssistantMessage;
  isStreaming?: boolean;
  toolResults?: Map<string, ToolResultMessage>;
  modelNames?: Record<string, string>;
  cwd?: string;
  onOpenFile?: (filePath: string, page?: number) => void;
  onOpenSession?: (sessionId: string) => void;
  showTimestamp?: boolean;
  prevTimestamp?: number;
  turnStats?: TurnStats;
  sessionId?: string;
  entryId?: string;
  searchBlock?: AssistantContentBlock;
  writtenFiles?: WrittenFile[];
  skillUsage?: SkillActivation[];
  onOpenSkill?: (slug: string) => void;
  expandedToolIds?: Set<string>;
  onToggleTool?: (toolCallId: string) => void;
}) {
  const { t } = useI18n();
  const time = showTimestamp ? formatTime(message.timestamp) : null;
  const blockItems = useMemo(() => (message.content ?? [])
    .map((block, originalIndex) => ({ block, originalIndex }))
    .filter(({ block }) => !isEmptyThinkingBlock(block, { isStreaming })), [message.content, isStreaming]);
  const blocks = useMemo(() => blockItems.map(({ block }) => block), [blockItems]);
  const providerError = getAssistantErrorMessage(message, { isStreaming });
  // fork:design-system PR-11 — 「输出被上限截断」不再单开告警块，改由回合结束行
  // 的 `length` 徽章 + `chat.truncatedByOutputLimit` 解释表达（设计 12 画板）。
  // fork:fix-clipboard —— 复制改成三态（见 useMessageCopy）。
  const { copied, failed, copy } = useMessageCopy();
  const streamStartRef = useRef<number | null>(null);
  const [tps, setTps] = useState<number | null>(null);
  const blockItemsRef = useRef(blockItems);
  blockItemsRef.current = blockItems;
  const tokenEstimateCacheRef = useRef<Map<number, TokenEstimateCacheEntry>>(new Map());
  const estimatedTokens = useMemo(() => {
    if (!isStreaming) {
      tokenEstimateCacheRef.current = new Map();
      return 0;
    }
    const nextCache = new Map<number, TokenEstimateCacheEntry>();
    let total = 0;
    for (const { block, originalIndex } of blockItems) {
      const text = getTokenEstimateText(block);
      if (text === null) continue;
      const tokens = estimateUpdatedTokens(tokenEstimateCacheRef.current.get(originalIndex), text);
      nextCache.set(originalIndex, { text, tokens });
      total += tokens;
    }
    tokenEstimateCacheRef.current = nextCache;
    return total;
  }, [blockItems, isStreaming]);
  const estimatedTokensRef = useRef(estimatedTokens);
  estimatedTokensRef.current = estimatedTokens;

  // Streaming-based timing for thinking blocks
  const blockStartTimesRef = useRef<Map<number, number>>(new Map());
  const [streamingDurations, setStreamingDurations] = useState<Map<number, number>>(new Map());

  // fix:turn-stats —— `message.timestamp` 是**调用开始**，`completedAt`（条目落盘）是响应写完。
  // 这一步模型真正跑了多久 = 两者之差。旧数据没有 `completedAt`（旧会话文件 / 不带该字段的
  // 消息）时回落到“与上一条消息的间隔”，那是个 3–10ms 的噪声，但至少不是错的。
  const generationEnd = (message as { completedAt?: number }).completedAt ?? null;
  const stepDurationSec = message.timestamp && generationEnd
    ? Math.max(0, (generationEnd - message.timestamp) / 1000)
    : null;
  const thinkingDurationFromFile = useMemo<number | undefined>(() => {
    if (stepDurationSec !== null) return stepDurationSec > 0 ? stepDurationSec : undefined;
    if (!message.timestamp || !prevTimestamp) return undefined;
    // 不取整：亚秒的思考/工具耗时只有保留小数才量得出来（取整后一律变 0s 被丢掉）。
    const secs = (message.timestamp - prevTimestamp) / 1000;
    return secs > 0 ? secs : undefined;
  }, [stepDurationSec, message.timestamp, prevTimestamp]);

  // Tool call durations: the tools start when generation ends, so the end point
  // is `completedAt` (the entry's append time), not `timestamp` (the call start).
  // fix:turn-stats —— 旧公式把生成时间算进了每个工具（实测 0.3s 的工具显示 6.5s）。
  const toolCallDurations = useMemo<Map<string, number>>(() => {
    const map = new Map<string, number>();
    const toolStart = generationEnd ?? message.timestamp;
    if (!toolResults || !toolStart) return map;
    for (const [callId, result] of toolResults) {
      if (result.timestamp) {
        const secs = (result.timestamp - toolStart) / 1000;
        if (secs > 0) map.set(callId, secs);
      }
    }
    return map;
  }, [toolResults, message.timestamp, generationEnd]);

  const textContent = blocks
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const copyContent = () => copy(textContent);

  useEffect(() => {
    if (!isStreaming) {
      // Finalise any un-finished thinking block durations on stream end
      const now = new Date().getTime();
      setStreamingDurations((prev: Map<number, number>) => {
        const next = new Map(prev);
        for (const [idx, start] of blockStartTimesRef.current) {
          if (!next.has(idx)) next.set(idx, (now - start) / 1000);
        }
        return next;
      });
      streamStartRef.current = null;
      setTps(null);
      return;
    }
    const tick = () => {
      const items = blockItemsRef.current;
      const now = Date.now();

      // Record start time for each block the first time we see it
      items.forEach(({ originalIndex }) => {
        if (!blockStartTimesRef.current.has(originalIndex)) blockStartTimesRef.current.set(originalIndex, now);
      });

      // When a non-last block has a successor already started, finalise its duration
      setStreamingDurations((prev: Map<number, number>) => {
        let changed = false;
        const next = new Map(prev);
        for (let i = 0; i < items.length - 1; i++) {
          const originalIndex = items[i].originalIndex;
          const nextOriginalIndex = items[i + 1].originalIndex;
          if (!next.has(originalIndex) && blockStartTimesRef.current.has(originalIndex)) {
            const start = blockStartTimesRef.current.get(originalIndex)!;
            const nextStart = blockStartTimesRef.current.get(nextOriginalIndex) ?? now;
            next.set(originalIndex, (nextStart - start) / 1000);
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      const tokens = estimatedTokensRef.current;
      if (tokens === 0) return;
      if (streamStartRef.current === null) streamStartRef.current = now;
      const elapsed = (now - streamStartRef.current) / 1000;
      if (elapsed > 0.5) setTps(tokens / elapsed);
    };
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
  }, [isStreaming]);

  // fork:design-system PR-11 — 只有「输出被截断」这一种空内容结束态需要留下
  // 回合结束行（旧实现是 `!truncated` 的截断告警块，现由结束行的 length 徽章接管）。
  if (blocks.length === 0 && !isStreaming && !providerError && message.stopReason !== "length") return null;

  return (
    <div
      data-message-role="assistant"
      data-entry-id={entryId}
      style={{ marginBottom: 20 }}
    >
      {/* fork:design-components —— 流式元信息行用画板的排版基元：
          `.pw-muted`（次要文字）+ `.pw-mono`（数字等宽）+ `.pw-badge.count`（t/s 计数）。
          图标换成 `i[data-ico="arrow-down"]`（lucide 单线 1.5px），不再手绘。 */}
      {isStreaming && (
        <div
          className="pw-muted"
          style={{
            fontSize: TEXT.xs,
            marginBottom: "var(--s1)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-row)",
          }}
        >
          {message.provider && (
            <span>{getModelDisplayName(message.provider, message.model, modelNames)}</span>
          )}
          {(() => {
            const est = Math.round(estimatedTokens);
            return (
              <>
                {est > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: "var(--s1)" }} title={t("i18n.estimatedTokens")}>
                    <span className="pw-mono" style={{ display: "flex", alignItems: "center", gap: "var(--space-tight)" }}>
                      <span className="pw-ico"><i data-ico="arrow-down" data-size="10"></i></span>
                      {est}
                    </span>
                    {tps !== null && (() => {
                      // fork:design-system —— 只用四个语义色，不再自造青/黄绿/琥珀/洋红四个色相。
                      const tone = tps >= 50 ? "ok" : tps >= 30 ? "accent" : tps >= 15 ? "warn" : "bad";
                      return (
                        <span className={`pw-badge count ${tone}`}>
                          {tps.toFixed(1)} t/s
                        </span>
                      );
                    })()}
                  </span>
                )}
              </>
            );
          })()}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--s2)" }}>
        {blockItems.map(({ block, originalIndex }) => (
          <BlockView key={`${entryId ?? "stream"}-${originalIndex}`} block={block} searchTarget={block === searchBlock} toolResults={toolResults} isStreaming={isStreaming} streamingDuration={streamingDurations.get(originalIndex) ?? (block.type === "thinking" ? thinkingDurationFromFile : undefined)} toolCallDurations={toolCallDurations} cwd={cwd} onOpenFile={onOpenFile} onOpenSession={onOpenSession} sessionId={sessionId} entryId={entryId} blockIndex={originalIndex} expandedToolIds={expandedToolIds} onToggleTool={onToggleTool} />
        ))}
      </div>

      {/* fork:design-components —— provider 错误框换成画板的 `.pw-alert`（error 态：
          容器自带 error-soft 底 / error 文字 / radius-4；首列 `.pw-ico` + `circle-x`，
          正文 `.pw-grow` 里放 `.pw-term`（等宽 + pre-wrap，错误原文的换行语义由它承担）。
          `role="alert"` 与链接拆分照旧。`/ 报告见第 2 节。 */}
      {providerError && (
        <div
          role="alert"
          className="pw-alert"
          style={{ marginTop: blocks.length > 0 ? 8 : 0 }}
        >
          <span className="pw-ico"><i data-ico="circle-x" data-size="14"></i></span>
          <span className="pw-grow">
            <span className="pw-term">Error: {splitErrorLinks(providerError).map((part, index) => part.link ? (
              <a
                key={index}
                href={part.text}
                target="_blank"
                rel="noreferrer noopener"
                style={{ color: "inherit", textDecoration: "underline", overflowWrap: "anywhere" }}
              >
                {part.text}
              </a>
            ) : part.text)}</span>
          </span>
        </div>
      )}

      {/* fork:proma-32-skill-usage —— 「本轮用到的 skill」与「改动过的文件」同一行 chips
          （同一个 wrap 行，不另起区块）：外层这一行 flex 让两组 chips 先横向排列，
          放不下才各自换行。间距/几何全走 token，样式在 app/fork-ui.css 的
          `.fork-turn-summary`；chip 本身是画板既有的 `.pw-wrap` + `.pw-chip`。 */}
      {((writtenFiles && writtenFiles.length > 0) || (skillUsage && skillUsage.length > 0)) && (
        <div className="fork-turn-summary">
          {writtenFiles && writtenFiles.length > 0 && (
            <TurnWrittenFiles files={writtenFiles} onOpenFile={onOpenFile} />
          )}
          {skillUsage && skillUsage.length > 0 && (
            <TurnSkillUsageSummary skills={skillUsage} isStreaming={isStreaming} onOpenSkill={onOpenSkill} />
          )}
        </div>
      )}

      {/* fork:design-components PR-11 —— 回合结束行直接使用画板 12 的组件：
          样式全部来自 design/pi-web-design/assets/board.css 的
          .pw-turn-end / .pw-badge(.ok/.warn/.bad/.accent) / .pw-mono / .rule，
          图标走 <i data-ico>（icons.js hydrate），本组件不再写一行视觉样式。 */}
      {!isStreaming && (() => {
        const stopReason = message.stopReason ?? "stop";
        // fix:turn-stats —— 这一格原来是 `message.timestamp - 上一条消息.timestamp`，
        // 量的是“条目落盘的间隔”（实测恒为 3–10ms，用户：“这个咋又是毫秒啊，
        // 统计的一点都不准”）。先改成“这一步模型跑了多久”（落盘 − 调用开始），再按用户裁定
        // 升级为**本轮**口径：“从每轮思考一直到本轮结束”，与输入 / 输出 / 费用同口径
        // （见 lib/turn-stats.ts）。缺本轮快照时退回单步值。
        const durationSec = turnStats?.elapsedSec ?? stepDurationSec;
        const badgeClass = stopReason === "stop" ? "ok"
          : stopReason === "length" ? "warn"
            : stopReason === "error" ? "bad"
              : stopReason === "toolUse" ? "accent"
                : "";
        const icon = stopReason === "stop" ? "check"
          : stopReason === "toolUse" ? "wrench"
            : stopReason === "length" ? "triangle-alert"
              : stopReason === "deferred" ? "clock"
                : stopReason === "aborted" ? "circle-stop"
                  : stopReason === "error" ? "circle-x"
                    : "ellipsis";
        // 用量与费用同样按**本轮**累加：四格必须是同一个口径，否则「17k 输入 + 161 输出」
        // 配一个 4.4s 的耗时读起来自相矛盾。缺快照时退回这条消息自己的 usage。
        const rowUsage = rowUsageOf(turnStats, message.usage);
        const usageText = rowUsage ? formatUsage(rowUsage) : "";
        const costText = rowUsage ? formatUsageCost(rowUsage) : null;
        const note = stopReason === "toolUse" ? t("chat.turnEnd.toolUse")
          : stopReason === "length" ? t("chat.truncatedByOutputLimit")
            : stopReason === "deferred" ? t("chat.turnEnd.deferred")
              : stopReason === "aborted" ? t("chat.turnEnd.aborted")
                : stopReason === "error" ? t("chat.turnEnd.error")
                  : null;
        return (
          <div className="pw-turn-end" style={{ marginTop: "var(--space-row)" }}>
            <span className={`pw-badge ${badgeClass}`}>
              <span className="pw-ico"><i data-ico={icon} data-size="12"></i></span>
              {stopReason}
            </span>
            {durationSec !== null && (
              <>
                <span
                  className="pw-mono"
                  title={turnStats && turnStats.steps > 1 && stepDurationSec !== null
                    ? t("chat.turnEnd.durationHintTurnSteps", {
                      turn: formatDuration(durationSec),
                      step: formatDuration(stepDurationSec),
                      steps: turnStats.steps,
                    })
                    : t("chat.turnEnd.durationHintTurn", { turn: formatDuration(durationSec) })}
                >
                  {formatDuration(durationSec)}
                </span>
                <span>·</span>
              </>
            )}
            {usageText && rowUsage && (
              <>
                <span className="pw-mono" title={usageTitle(rowUsage, t)}>{usageText}</span>
                <span>·</span>
              </>
            )}
            {/* 金额只在真的有费用时出现（画板 12 的 `$0.021`）。`$0.000` 不画 ——
                用户裁定 2026-10-01「那就把这个金额去掉吧」：免费 / 不上报价格的模型
                （单价为 0）常年显示一格 0 纯属噪声，还让人以为漏算了。 */}
            {costText && (
              <>
                <span className="pw-mono">{costText}</span>
                <span>·</span>
              </>
            )}
            {note && <span className="pw-muted">{note}</span>}
            <span className="rule"></span>
          </div>
        );
      })()}

      {/* fork:design-components —— 助手消息的动作行同样换成画板 10 的 `.pw-msg-acts`：
          复制按钮 = `.pw-btn sm` + `.pw-ico`（CopyStateIcon 保留形变）+ 文字；
          时间戳用 `.pw-grow` 顶到行尾（与原 `margin-left:auto` 等价）。
          fork:fix-clipboard —— 失败提示条挂在这一行**外面**（见 CopyFailedNotice）。 */}
      <div className="pw-msg-acts">
        {textContent && !isStreaming && (
          <button
            type="button"
            onClick={copyContent}
            title={failed ? t("chat.todosCopyFailed") : t("i18n.copyMessage")}
            className={failed ? "pw-btn sm danger" : "pw-btn sm"}
          >
            <span className="pw-ico">{CopyStateIcon({ copied })}</span>
            {copied ? t("i18n.copied") : t("i18n.copy")}
          </button>
        )}
        {time && !isStreaming && (
          <span className="pw-grow" />
        )}
        {time && !isStreaming && (
          <span className="pw-dim">{time}</span>
        )}
      </div>
      {failed && <CopyFailedNotice style={{ marginTop: "var(--s1)" }} />}
    </div>
  );
}

function BlockView({ block, searchTarget, toolResults, isStreaming, streamingDuration, toolCallDurations, cwd, onOpenFile, onOpenSession, sessionId, entryId, blockIndex, expandedToolIds, onToggleTool }: { block: AssistantContentBlock; searchTarget?: boolean; toolResults?: Map<string, ToolResultMessage>; isStreaming?: boolean; streamingDuration?: number; toolCallDurations?: Map<string, number>; cwd?: string; onOpenFile?: (filePath: string, page?: number) => void; onOpenSession?: (sessionId: string) => void; sessionId?: string; entryId?: string; blockIndex: number; expandedToolIds?: Set<string>; onToggleTool?: (toolCallId: string) => void }) {
  if (block.type === "text") {
    return <div data-message-text data-search-target={searchTarget || undefined}><TextBlock block={block as TextContent} isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile} /></div>;
  }
  if (block.type === "thinking") {
    // fork:zc-02 — searchTarget 必须传到 ThinkingBlock：否则被搜到的思考正文在折叠态
    // 下不在 DOM 里（两段式挂载 + 惰性加载），高亮与滚动都拿不到 Range。
    // 注意 ThinkingBlock 的惰性加载副作用依赖 `expanded`，reveal 参与派生后会一并触发加载。
    return <ThinkingBlock block={block as ThinkingContent} duration={streamingDuration} sessionId={sessionId} entryId={entryId} blockIndex={blockIndex} isStreaming={isStreaming} reveal={searchTarget} />;
  }
  if (block.type === "toolCall") {
    const tc = block as ToolCallContent;
    const result = toolResults?.get(tc.toolCallId);
    const duration = toolCallDurations?.get(tc.toolCallId);
    const fallbackKey = `${entryId ?? "stream"}-${blockIndex}`;
    const toggleId = tc.toolCallId || fallbackKey;
    const isExpanded = expandedToolIds ? expandedToolIds.has(toggleId) : undefined;
    const handleToggle = onToggleTool ? () => onToggleTool(toggleId) : undefined;
    return <ToolCallBlock block={tc} result={result} duration={duration} onOpenSession={onOpenSession} expanded={isExpanded} onToggle={handleToggle} reveal={searchTarget} />;
  }
  return null;
}

function TextBlock({ block, isStreaming, cwd, onOpenFile }: { block: TextContent; isStreaming?: boolean; cwd?: string; onOpenFile?: (filePath: string, page?: number) => void }) {
  return <SafeMarkdownBody isStreaming={isStreaming} cwd={cwd} onOpenFile={onOpenFile}>{block.text}</SafeMarkdownBody>;
}

export function ThinkingBlock({ block, duration, sessionId, entryId, blockIndex, isStreaming, reveal }: {
  block: ThinkingContent;
  duration?: number;
  sessionId?: string;
  entryId?: string;
  blockIndex: number;
  isStreaming?: boolean;
  /** fork:zc-02 — 被查找/搜索命中时强制展开（派生，不改用户的手动折叠状态）。 */
  reveal?: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(isThinkingExpandedByDefault);
  // fork:zc-02 — 被查找/搜索命中时强制展开。派生 `expandedView` 而不改 state：
  // 1) 不动用户的手动折叠选择，命中消失（换查询/关查找条）后回到原状态；
  // 2) 惰性加载的副作用判的是 `expanded`，所以下面把此副作用的读取口也改成 expandedView。
  const expandedView = expanded || Boolean(reveal);
  // fork:zm-01 — wrapper 常驻、正文两段式挂载。惰性加载的触发条件仍是 expanded，
  // 收起态（正文已卸载）不会为每条历史消息拉 reasoning（lib/chat-lazy-load.ts）。
  const collapseRef = useRef<HTMLDivElement>(null);
  const bodyMounted = useCollapsePresence(expandedView, undefined, collapseRef);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const preview = getThinkingPreview(block.thinking);

  // fork:fix-thinking-affordance — 两个只在本次运行内有意义的标记。
  // `autoOpenedRef`：展开是"流式期间被自动打开的"，结束后才允许自动收回；
  // `manualOverrideRef`：用户手动点过（或改过全局偏好），此后不再替他决定。
  const autoOpenedRef = useRef(false);
  const manualOverrideRef = useRef(false);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep already-mounted blocks in sync when the preference changes.
  useEffect(() => {
    const onChange = () => {
      manualOverrideRef.current = true;
      setExpanded(isThinkingExpandedByDefault());
    };
    window.addEventListener(THINKING_EXPANDED_EVENT, onChange);
    return () => window.removeEventListener(THINKING_EXPANDED_EVENT, onChange);
  }, []);

  // fork:fix-thinking-affordance — 流式期间强制展开，结束后自动收起（1s）。
  // 之前思考块全程跟随持久化偏好：偏若是折叠，用户在流式期间看不到推理；
  // 偏若是展开，一轮结束后整屏还留着上一条的思考。现在的行为与对照项目一致。
  useEffect(() => {
    if (isStreaming) {
      if (autoCloseTimerRef.current) {
        clearTimeout(autoCloseTimerRef.current);
        autoCloseTimerRef.current = null;
      }
      setExpanded((current) => {
        if (!current) autoOpenedRef.current = true;
        return true;
      });
      return;
    }
    if (!autoOpenedRef.current || manualOverrideRef.current) return;
    autoOpenedRef.current = false;
    autoCloseTimerRef.current = setTimeout(() => {
      autoCloseTimerRef.current = null;
      setExpanded(isThinkingExpandedByDefault());
    }, THINKING_AUTO_COLLAPSE_MS);
  }, [isStreaming]);

  useEffect(() => () => {
    if (autoCloseTimerRef.current) clearTimeout(autoCloseTimerRef.current);
  }, []);

  // fork:fix-thinking-affordance — 展开前预取。
  // 惰性加载本身是对的（长思考不随列表全量渲染），但代价是展开时要等一次往返、
  // 期间只有骨架屏。悬停/聚焦就开始拉，真正点开时内容已经在了。
  const prefetch = useCallback(() => {
    if (!block.deferred || content !== null || !sessionId || !entryId) return;
    void loadThinkingContent(sessionId, entryId, blockIndex)
      .then((value) => setContent(value))
      .catch(() => {
        // 失败留给展开时的正常路径报错，预取不打扰用户。
      });
  }, [block.deferred, blockIndex, content, entryId, sessionId]);

  // Load deferred history content whenever the block is expanded.
  // loadThinkingContent() memoizes in-flight promises and drops failed ones
  // from its cache, so re-running this effect is cheap and a failed load can
  // be retried by collapsing and expanding the block again.
  useEffect(() => {
    if (!expandedView || !block.deferred || content !== null) return;
    if (!sessionId || !entryId) {
      setError(tRef.current("i18n.thinkingUnavailable"));
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadThinkingContent(sessionId, entryId, blockIndex)
      .then((value) => {
        if (!cancelled) {
          setContent(value);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [expandedView, block.deferred, content, sessionId, entryId, blockIndex]);

  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: "var(--space-row)", minWidth: 0,
      border: "none",
      borderRadius: "0",
      padding: "var(--space-tight) 0",
      background: "transparent",
      fontFamily: "var(--font-mono)",
      fontSize: "calc(12px + var(--chat-font-size-offset, 0px))",
      lineHeight: 1.45,
    }}>
      <button
        type="button"
        aria-expanded={expandedView}
        aria-label={`${t("i18n.thinking")}${preview ? `: ${preview}` : ""}`}
        title={t("i18n.thinking")}
        onClick={() => {
          manualOverrideRef.current = true;
          setExpanded((v) => !v);
        }}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--space-row)",
          width: expandedView ? 14 : "100%",
          flexShrink: expandedView ? 0 : 1,
          minWidth: 0,
          minHeight: "1.5em",
          padding: 0,
          background: "transparent",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          font: "inherit",
          textAlign: "left",
        }}
      >
        <ThinkingIcon active={expandedView} />
        {!expandedView && (
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {preview ? <ReactMarkdown allowedElements={[]} unwrapDisallowed skipHtml>{preview}</ReactMarkdown> : "..."}
          </span>
        )}
      </button>
      {/* fork:zm-01 — 常驻 grid wrapper；正文在收起过渡结束后卸载。展开时正文与
          wrapper 同一帧挂载，grid 从 0fr 过渡到 1fr（不是动画一个空行）。 */}
      <div
        ref={collapseRef}
        className="fork-collapse"
        data-fork-collapse={expandedView ? "open" : "closed"}
        style={{ flex: 1, minWidth: 0 }}
      >
        {bodyMounted && (
          /* fork:design-components —— 思考正文 = 画板 10 的 `.pw-think`（推理体的
             muted 底色与排版由 board.css 承担）；`.pw-muted` 保留在 class 里，
             错误态仍按原样转 `--error`。时长在下面一行，已经挂 `.pw-dim`。 */
          <div
            className="fork-collapse-body pw-muted pw-think"
            style={error ? { color: "var(--error)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" } : { whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
          >
            {loading ? (
              <span style={{ display: "flex", flexDirection: "column", gap: "var(--space-row)", padding: "var(--space-tight) 0" }} aria-hidden="true">
                <span className="skeleton-line" style={{ height: 10, width: "92%" }} />
                <span className="skeleton-line" style={{ height: 10, width: "78%" }} />
              </span>
            ) : error ?? (block.deferred ? content : block.thinking)}
          </div>
        )}
      </div>
      {duration !== undefined && (
        <span className="pw-dim" style={{ flexShrink: 0 }}>{formatDuration(duration)}</span>
      )}
    </div>
  );
}

function isSubagentToolDetails(value: unknown): value is SubagentToolDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as Partial<SubagentToolDetails>;
  return details.kind === "pi-web-subagent" && typeof details.sessionId === "string";
}

/** fork:design-components —— 工具卡首列图标走画板的 `<i data-ico>`（lucide 路径表）。
    四个分支与原手绘 SVG 一一对应：读=book-open / 写=pencil / 搜=search /
    兜底=square-terminal（画板 11 的终端卡图标）。 */
function ToolCallIcon({ toolName }: { toolName: string }) {
  const name = toolName.toLowerCase();

  if (name.includes("read") || name.includes("view") || name.includes("open")) {
    return <i data-ico="book-open" data-size="12"></i>;
  }
  if (name.includes("edit") || name.includes("write") || name.includes("patch")) {
    return <i data-ico="pencil" data-size="12"></i>;
  }
  if (name.includes("search") || name.includes("grep") || name.includes("find")) {
    return <i data-ico="search" data-size="12"></i>;
  }
  return <i data-ico="square-terminal" data-size="12"></i>;
}

/** Exported for `components/ProcessGroup.tsx`, which reuses the exact same
 *  tool-call surface so the grouped and flat renderers cannot drift apart. */
export function ToolCallBlock({ block, result, duration, onOpenSession, expanded: controlledExpanded, onToggle, reveal }: { block: ToolCallContent; result?: ToolResultMessage; duration?: number; onOpenSession?: (sessionId: string) => void; expanded?: boolean; onToggle?: () => void; /** fork:zc-02 — 被查找/搜索命中时强制展开（不改用户的展开集合）。 */ reveal?: boolean }) {
  const { t } = useI18n();
  const [localExpanded, setLocalExpanded] = useState(false);
  const isControlled = controlledExpanded !== undefined && onToggle !== undefined;
  // fork:zc-02 — reveal 参与派生：命中在工具结果里时正文必须进 DOM，否则高亮拿不到 Range。
  const expanded = (isControlled ? controlledExpanded : localExpanded) || Boolean(reveal);
  const handleToggle = isControlled ? onToggle! : () => setLocalExpanded((v) => !v);
  // fork:zm-01 — 参数区与结果区各一条 grid（图片常显，必须留在两个 wrapper 之外
  // 维持原 DOM 顺序）；两条同时 0fr↔1fr，正文在收起过渡结束后才卸载。
  const argsCollapseRef = useRef<HTMLDivElement>(null);
  const argsMounted = useCollapsePresence(expanded, undefined, argsCollapseRef);
  const resultCollapseRef = useRef<HTMLDivElement>(null);
  const resultMounted = useCollapsePresence(expanded, undefined, resultCollapseRef);
  const inputStr = getToolCallInputText(block);
  const isStreamingInput = block.rawInput !== undefined;
  const isEditTool = isEditToolName(block.toolName);
  const resultDiff = result && !result.isError ? getResultDiff(result) : null;
  const patchFiles = getApplyPatchFiles(block, result);
  const patchLabel = isApplyPatchToolName(block.toolName)
    ? summarizeApplyPatchInput(block)
    : null;

  // Result display
  const resultText = result
    ? result.content.filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text).join("\n")
    : null;
  const resultImages = getMessageImages(result?.content ?? []);
  const resultIsEmpty = resultText === null ? false : (resultText.trim() === "(no output)" || resultText.trim() === "");
  const isError = result?.isError ?? false;
  const subagent = isSubagentToolDetails(result?.details) ? result.details : null;
  const showExpandedSurface = expanded || isError;

  return (
    /* fork:design-components —— 工具卡直接用画板 11 的 .pw-card（展开/错误时上卡，
       收起态保持时间轴行的透明形态，与画板「过程时间轴是收起形态」一致）。
       fork:design-components —— 失败态**不再整卡描红**：画板 11 帧 B 只换两处
       （卡头状态图标 + 输出区底色），卡体自己保持发丝边框 + 画布底。 */
    <div
      className={showExpandedSurface ? "pw-card" : undefined}
      style={showExpandedSurface
        ? { fontSize: TEXT.sm }
        : { fontSize: TEXT.sm, border: "none", background: "transparent", borderRadius: "var(--radius-lg)", overflow: "visible" }}
    >
      {/* ── Tool call header ── */}
      <div style={{ display: "flex", alignItems: "stretch", minWidth: 0 }}>
        <button
          onClick={handleToggle}
          className="pw-card-head"
          style={{
            // fork:board-diff-2026-10-01 —— 头行的几何（gap / padding / 圆角）全部
            // 由 board.css 的 `.pw-card-head` 承担（gap var(--s2) / padding 7px var(--s3) / 无圆角），
            // 这里只留交互态与「展开时多一行内容」要的内收。原先的 gap:7 / 7px 10px /
            // borderRadius var(--radius-md) 是内联压过画板，`12-transcript-interactive`
            // 的 spec 把它报成了漂移（radius 0→4 / padding 12→10 / gap 8→7）。
            display: "flex",
            alignItems: "center",
            flex: 1,
            minWidth: 0,
            padding: expanded ? undefined : "5px 8px",
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: TEXT.sm,
            textAlign: "left",
          }}
          onMouseEnter={(e) => {
            if (!expanded) e.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(e) => {
            if (!expanded) e.currentTarget.style.background = "none";
          }}
        >
          <span className="pw-ico" style={{ color: isError ? "var(--error)" : undefined, flexShrink: 0 }}>
            <ToolCallIcon toolName={block.toolName} />
          </span>
          <span className="pw-tool" style={{ flexShrink: 0 }}>
            {block.toolName}
          </span>
          <span className="pw-path" style={{ flex: 1 }}>
            {isStreamingInput ? t("chat.generatingToolInput") : (patchLabel ?? getToolPreview(block))}
          </span>
          {duration !== undefined && (
            <span className="pw-dim" style={{ flexShrink: 0 }}>{formatDuration(duration)}</span>
          )}
          <span className="pw-ico" style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform var(--motion-fast)" }}>
            <i data-ico="chevron-down" data-size="11"></i>
          </span>
        </button>
        {subagent && onOpenSession && (
          /* fork:design-components —— 子代理「打开会话」钮 = 画板 11 卡头的 `.pw-iconbtn`
             （24px 方钮 / radius-4 / hover 出容器）。子代理卡本体仍按 DIVERGENCE 登记
             「呈现形态等价」，本轮不改（只多这一个跳转钮）。 */
          <button
            type="button"
            className="pw-iconbtn"
            onClick={() => onOpenSession(subagent.sessionId)}
            title={t("subagent.open")}
            aria-label={t("subagent.open")}
            style={{ borderLeft: "1px solid var(--n-border-subtle)", alignSelf: "stretch" }}
          >
            <span className="pw-ico"><i data-ico="external-link" data-size="14"></i></span>
          </button>
        )}
      </div>

      {/* fork:zm-01 — 参数区：grid wrapper 常驻，行高 0fr↔1fr；正文在收起过渡结束
          后才卸载，折叠态的 DOM 里仍然没有流式参数文本。 */}
      <div
        ref={argsCollapseRef}
        className="fork-collapse"
        data-fork-collapse={expanded ? "open" : "closed"}
      >
        {argsMounted && !isEditTool && !patchFiles && (
          <div className="fork-collapse-body">
            {/* fork:design-components —— 工具入参 = 画板 11 的 `.pw-card-body` + `.pw-term`
                （顶部发丝线 + 面板底 + 等宽 pre-wrap 全部由 board.css 承担）。
                产品保留 `word-break: break-all`（入参是 JSON，长串不折行会溢出）。 */}
            <div className="pw-card-body">
              <div className="pw-term" style={{ wordBreak: "break-all", overflow: "auto" }}>
                {inputStr}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Result images — always visible, independent of the collapsed details ── */}
      {resultImages.length > 0 && <ResultImages images={resultImages} />}
      {/* fork:zm-01 — 结果区（patch diff + paired result）与参数区同时过渡。 */}
      <div
        ref={resultCollapseRef}
        className="fork-collapse"
        data-fork-collapse={expanded ? "open" : "closed"}
      >
        {resultMounted && (
          <div className="fork-collapse-body">
            {/* ── Applied-patch split diff（画板 11：`.pw-card-body` 里直接放 diff 体） ── */}
            {patchFiles && (
              <div className="pw-card-body">
                <SplitFilesView files={patchFiles} />
              </div>
            )}

            {/* ── Paired result ── */}
            {result && patchFiles && isError && (
              <PairedResult
                text={resultText ?? ""}
                isEmpty={resultIsEmpty}
                isError={isError}
              />
            )}
            {result && !patchFiles && (
              resultDiff ? (
                <PairedDiffResult
                  diff={resultDiff}
                />
              ) : (!resultIsEmpty || resultImages.length === 0) && (
                <PairedResult
                  text={resultText ?? ""}
                  isEmpty={resultIsEmpty}
                  isError={isError}
                />
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface ResultDiff {
  text: string;
}

/* fork:design-components —— 工具结果里的 diff 外面挂画板 11 的 `.pw-card-body`
   （顶部发丝线 + 面板底），里面的 diff 体由 SplitFilesView / PatchTextView 承担。 */
function PairedDiffResult({ diff }: {
  diff: ResultDiff;
}) {
  return (
    <div className="pw-card-body">
      <SplitPatchView text={diff.text} />
    </div>
  );
}

function SplitPatchView({ text }: { text: string }) {
  const files = useMemo(() => parseUnifiedPatch(text), [text]);
  if (!files) return <PatchTextView text={text} />;
  return <SplitFilesView files={files} />;
}

/* fork:design-components —— diff 换成画板 11 B「分栏视图」的三件套：
   `.pw-diff-head`（文件头）/ `.pw-diff-body`（等宽正文）/ `.pw-diff-line(.add/.del)`
   + 行内 `.no`（行号）/ `.sign`（±）。
   **词级高亮不动**：fork:zc-07 的 `buildIntralineSegments` + `--diff-*` 配色保持自有实现
   （DIVERGENCE 已登记等价）。左右两栏的行对结构（left/right cell）是产品语义，也保持不变。 */
function SplitFilesView({ files }: { files: SplitDiffFile[] }) {
  const { t } = useI18n();
  const showFileHeaders = files.length > 1;
  // fork:zc-07 — 每个「删除 + 新增」行对只算一次词级差异，左右两格共用结果。
  // undefined = 这对不是双边改动（纯增/纯删），保持原有整行底色。
  const intraline = useMemo(() => files.map((file) => file.rows.map((row) => {
    if (row.type !== "line" || row.left.type !== "removed" || row.right.type !== "added") return undefined;
    return diffIntraline(row.left.text, row.right.text);
  })), [files]);

  return (
    <div className="pw-diff-body" style={{ maxHeight: "var(--content-cap-lg)", overflowY: "auto", overflowX: "hidden" }}>
      {files.map((file, fileIndex) => (
        <div
          key={fileIndex}
          style={fileIndex === 0 ? undefined : { borderTop: "1px solid var(--n-border-subtle)" }}
        >
          {showFileHeaders && (
            <div
              className="pw-diff-head"
              style={{ position: "sticky", top: 0, zIndex: 1, background: "var(--surface-panel)" }}
            >
              <SplitDiffHeader title={file.oldPath || t("i18n.before")} side="left" />
              <SplitDiffHeader title={file.newPath || t("i18n.after")} side="right" />
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
            {file.rows.map((row, rowIndex) => {
              if (row.type === "hunk") {
                return null;
              }

              const pair = intraline[fileIndex]?.[rowIndex];
              return (
                <div key={rowIndex} style={{ display: "contents" }}>
                  <SplitDiffCellView cell={row.left} side="left" intraline={pair === undefined ? undefined : pair?.left ?? null} />
                  <SplitDiffCellView cell={row.right} side="right" intraline={pair === undefined ? undefined : pair?.right ?? null} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function SplitDiffHeader({ title, side }: { title: string; side: "left" | "right" }) {
  return (
    <span
      className="pw-path"
      title={title}
      style={side === "left"
        ? { flex: "1 1 0", borderRight: "1px solid var(--n-border-subtle)", paddingRight: "var(--s2)" }
        : { flex: "1 1 0", paddingLeft: "var(--s2)" }}
    >
      {title}
    </span>
  );
}

function SplitDiffCellView({ cell, side, intraline }: {
  cell: SplitDiffCell;
  side: "left" | "right";
  /** fork:zc-07 — undefined=不做行内标记；null=整行回退；数组=具体字符区间。 */
  intraline?: IntralineSpan[] | null;
}) {
  // fork:zc-07 — 词级差异段。空文本（例如空行）仍然按原来的 nbsp 占位。
  const segments = intraline === undefined ? null : buildIntralineSegments(cell.text, intraline);
  const hasVisibleSegments = segments?.some((segment) => segment.text.length > 0) ?? false;
  const changedBackground = cell.type === "added"
    ? "color-mix(in srgb, var(--success) 30%, transparent)"
    : "color-mix(in srgb, var(--danger) 30%, transparent)";

  return (
    <div
      className={`pw-diff-line${cell.type === "added" ? " add" : cell.type === "removed" ? " del" : ""}`}
      style={side === "left" ? { borderRight: "1px solid var(--n-border-subtle)" } : undefined}
    >
      <span className="no">{cell.lineNo ?? ""}</span>
      <span className="sign">{cell.type === "added" ? "+" : cell.type === "removed" ? "−" : ""}</span>
      <span
        className={cell.type === "empty" ? "pw-dim" : undefined}
        style={{ flex: 1, minWidth: 0, paddingRight: "var(--s2)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
      >
        {segments && hasVisibleSegments
          ? segments.map((segment, index) => (
              <span
                key={index}
                style={segment.changed ? { background: changedBackground, borderRadius: "var(--radius-3)" } : undefined}
              >
                {segment.text}
              </span>
            ))
          : (cell.text || " ")}
      </span>
    </div>
  );
}

/* fork:design-components —— 未解析的统一 patch 文本（parseUnifiedPatch 失败时的兜底）
   同样挂画板 11 的 `.pw-diff-body` + `.pw-diff-line(.add/.del)`，hunk 行走 `.pw-term`
   的强调色（`--accent-text`）。行号列用 `.no`，± 走 `.sign`。 */
function PatchTextView({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);

  return (
    <div className="pw-diff-body" style={{ maxHeight: 520, overflowY: "auto", overflowX: "hidden", minWidth: 0 }}>
      {lines.map((line, i) => {
        const kind =
          line.startsWith("@@") ? "hunk" :
          line.startsWith("+") && !line.startsWith("+++") ? "added" :
          line.startsWith("-") && !line.startsWith("---") ? "removed" :
          "context";

        return (
          <div
            key={i}
            className={`pw-diff-line${kind === "added" ? " add" : kind === "removed" ? " del" : ""}`}
          >
            <span className="no">{i + 1}</span>
            <span className="sign" />
            <span
              className={kind === "hunk" ? "pw-muted" : undefined}
              style={{ flex: 1, minWidth: 0, paddingRight: "var(--s2)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
            >
              {line || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Split diff rows for an apply_patch-style tool call.
 *
 * Prefers parsing the V4A patch document from the call input. The extension's
 * applied result preview contains the complete old/new file with unchanged
 * lines, so it is only used as a fallback when the call input is unavailable.
 * A single call may contain several file operations — each becomes its own
 * file section.
 */
function getApplyPatchFiles(block: ToolCallContent, result?: ToolResultMessage): SplitDiffFile[] | null {
  if (!isApplyPatchToolName(block.toolName)) return null;

  const fromInput = parseApplyPatchInput(getApplyPatchInputText(block.input, block.rawInput));
  if (fromInput) return fromInput;

  const details = result && !result.isError ? (result as ToolResultMessage & { details?: unknown }).details : undefined;
  if (isRecord(details)) {
    const fromPreview = applyPatchPreviewToFiles(details.preview);
    if (fromPreview) return fromPreview;
  }

  return null;
}

/** Header label listing the files targeted by an apply_patch call. */
function summarizeApplyPatchInput(block: ToolCallContent): string | null {
  const paths = extractApplyPatchPaths(getApplyPatchInputText(block.input, block.rawInput));
  if (paths.length === 0) return null;
  return paths.join(", ").slice(0, 120);
}

function getResultDiff(result: ToolResultMessage): ResultDiff | null {
  const details = (result as ToolResultMessage & { details?: unknown }).details;
  if (!isRecord(details)) return null;

  const patch = typeof details.patch === "string" ? details.patch : null;
  if (patch) return { text: patch };

  const diff = typeof details.diff === "string" ? details.diff : null;
  if (diff) return { text: diff };

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* fork:design-components —— 内容块按画板 12「非文本内容块」给形状：
   - 图片 → `.pw-img`（1px 发丝框 / radius-6 / overflow hidden / max-width 420），
     真实图片取代画板的斜纹占位（DIVERGENCE §B 8 已登记）；点图仍由 ImagePreview 放大。
   - 工具输出（paired result）→ 画板 11 的 `.pw-card-body` + `.pw-term`：
     成功走面板底、失败走 `.pw-term .err`（画板 11 B 的失败态写法）。 */
function ResultImages({ images }: { images: ImageContent[] }) {
  return (
    <div
      className="pw-card-body"
      style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap", padding: "var(--s3)" }}
    >
      {images.map((image, index) => {
        const src = imageSource(image);
        if (!src) return null;
        return (
          <div className="pw-img" key={`${src}-${index}`}>
            <ImagePreview
              src={src}
              style={{ maxWidth: "100%" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt=""
                loading="lazy"
                style={{
                  display: "block",
                  maxWidth: "100%",
                  maxHeight: 520,
                  objectFit: "contain",
                }}
              />
            </ImagePreview>
          </div>
        );
      })}
    </div>
  );
}

function PairedResult({ text, isEmpty, isError }: {
  text: string;
  isEmpty: boolean;
  isError: boolean;
}) {
  const { t } = useI18n();
  return (
    /* fork:design-components —— 失败**只**由两处表达：卡头状态图标转 error，
       输出区底色转 `error.soft`（画板 11 工具卡帧 B：「不给整卡着色」——
       卡边框仍是发丝线、不加左侧彩条、不加整卡描红）。 */
    <div className="pw-card-body" style={isError ? { background: "var(--error-soft)" } : undefined}>
      <div
        className="pw-term"
        style={{ maxHeight: "var(--content-cap-md)", overflow: "auto", color: isEmpty ? "var(--n-placeholder)" : undefined }}
      >
        {isError ? <span className="err">{isEmpty ? t("i18n.noOutput") : text}</span> : (isEmpty ? t("i18n.noOutput") : text)}
      </div>
    </div>
  );
}

function CompactionMessageView({ message }: { message: CustomMessage }) {
  const { t } = useI18n();
  // fork:pr15-compaction — 压缩卡默认收起：折叠态只留一行概览 + caret，展开后
  // 正文限高滚动。文件清单（CompactionFileMetadata）原样保留在展开区里。
  const [expanded, setExpanded] = useState(false);
  // fork:zm-01 — 压缩正文同样走 grid 行高两段式折叠：wrapper 常驻，正文在收起
  // 过渡结束后才卸载。
  const collapseRef = useRef<HTMLDivElement>(null);
  const bodyMounted = useCollapsePresence(expanded, undefined, collapseRef);
  const summary = getMessageText(message.content);
  const parsedSummary = useMemo(() => parseCompactionSummary(summary), [summary]);
  const time = formatTime(message.timestamp);

  return (
    <div style={{ marginBottom: "var(--s4)" }}>
      {/* fork:design-components —— 压缩卡直接用画板 12 的 .pw-compact（发丝边框 / 面板底）。 */}
      <div className="pw-compact" style={{ flexDirection: "column", alignItems: "stretch", padding: 0, overflow: "hidden" }}>
        {/* fork:design-components —— 卡头用画板 11 的 `.pw-card-head`（flex / gap / 字号 /
            padding 全部由 board.css 承担），展开区用 `.pw-card-body`（顶部发丝线 + 面板底）。
            `.pw-compact` 外壳与折叠行为不变。 */}
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="pw-card-head"
        >
          <span className="pw-ico" style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform var(--motion-fast)" }}>
            <i data-ico="chevron-right" data-size="13"></i>
          </span>
          <span className="pw-tool">compaction</span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("i18n.conversationCompacted")}
          </span>
          <span className="grow" />
          {time && <span className="pw-dim">{time}</span>}
        </button>

        {/* fork:zm-01 — 常驻 grid wrapper（0fr↔1fr）；正文在收起过渡结束后卸载。 */}
        <div
          ref={collapseRef}
          className="fork-collapse"
          data-fork-collapse={expanded ? "open" : "closed"}
        >
          {bodyMounted && (
            <div className="fork-collapse-body">
              <div className="pw-card-body" style={{ maxHeight: 280, overflowY: "auto", padding: "var(--s3) var(--s4)" }}>
                <div className="pw-strong" style={{ fontSize: "calc(15px + var(--chat-font-size-offset, 0px))", fontWeight: 500, lineHeight: 1.35 }}>
                   {t("i18n.conversationCompacted")}
                </div>
                <div style={{ marginBottom: "var(--s2)", fontSize: "calc(14px + var(--chat-font-size-offset, 0px))", lineHeight: 1.5 }}>
                   {t("i18n.compactionDescription")}
                </div>
                {parsedSummary.body ? (
                  <MarkdownBody className="markdown-compaction-message">{parsedSummary.body}</MarkdownBody>
                ) : (
                   <span className="pw-dim">{t("i18n.noSummary")}</span>
                )}
                <CompactionFileMetadata readFiles={parsedSummary.readFiles} modifiedFiles={parsedSummary.modifiedFiles} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CompactionFileMetadata({ readFiles, modifiedFiles }: { readFiles: string[]; modifiedFiles: string[] }) {
  const { t } = useI18n();
  const total = readFiles.length + modifiedFiles.length;
  if (total === 0) return null;

  const parts = [];
  if (readFiles.length > 0) parts.push(`${readFiles.length} read`);
  if (modifiedFiles.length > 0) parts.push(`${modifiedFiles.length} modified`);

  return (
    <details className="compaction-file-details">
       <summary>{t("i18n.fileContext", { details: parts.join(", ") })}</summary>
       {modifiedFiles.length > 0 && <CompactionFileList title={t("i18n.modifiedFiles")} files={modifiedFiles} />}
       {readFiles.length > 0 && <CompactionFileList title={t("i18n.readFiles")} files={readFiles} />}
    </details>
  );
}

/**
 * fork:design-components —— 文件/资源卡 = 画板 12 的 `.pw-filecard`（发丝框 / radius-6 /
 * 名称 `.pw-fname` + 右侧 `.pw-meta`）。产品没有 mime/大小可用，右槽放文件后缀
 * （`.pw-meta` 本来就是等宽小字）；点开动作仍不在这里（压缩卡是只读摘要）。
 */
function fileExtension(file: string): string {
  const name = file.slice(file.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "";
}

function CompactionFileList({ title, files }: { title: string; files: string[] }) {
  return (
    <div className="compaction-file-section">
      <div className="compaction-file-title">{title}</div>
      <ul className="pw-list" style={{ maxHeight: 180, overflow: "auto" }}>
        {files.map((file) => (
          <li key={file} className="pw-filecard">
            <span className="pw-ico"><i data-ico="file" data-size="14" aria-hidden="true"></i></span>
            <span className="pw-fname">{file}</span>
            {fileExtension(file) && <span className="pw-meta">{fileExtension(file)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CustomMessageView({ message, cwd, onOpenFile }: { message: CustomMessage; cwd?: string; onOpenFile?: (filePath: string, page?: number) => void }) {
  const { t } = useI18n();
  const isHiddenDisplay = message.display === false;
  const [contentExpanded, setContentExpanded] = useState(!isHiddenDisplay);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  // fork:fix-clipboard —— 复制改成三态（见 useMessageCopy）。
  const { copied, failed, copy } = useMessageCopy();
  const text = getMessageText(message.content);
  const images = getMessageImages(message.content);
  const hasDetails = message.details !== undefined;
  // fork:zm-01 — 正文区与 details 区各一条 grid。正文收起时先保留到过渡结束，
  // 预览按钮等正文真正卸载后再出现（避免收起过程中按钮提前弹回）。
  const contentCollapseRef = useRef<HTMLDivElement>(null);
  const contentMounted = useCollapsePresence(contentExpanded, undefined, contentCollapseRef);
  const detailsCollapseRef = useRef<HTMLDivElement>(null);
  const showDetails = hasDetails && (isHiddenDisplay ? contentExpanded : detailsExpanded);
  const detailsMounted = useCollapsePresence(showDetails, undefined, detailsCollapseRef);
  const detailsText = hasDetails ? safeJson(message.details) : "";
  const title = formatCustomType(message.customType);
  const time = formatTime(message.timestamp);

  const copyContent = () => copy(text || detailsText);

  return (
    /* fork:design-components —— 扩展自定义消息卡换成画板 11 的通用卡三段：
       `.pw-card`（发丝框 / radius-6 / overflow hidden）+ `.pw-card-head` +
       `.pw-card-body`（正文与图片）+ `.pw-card-foot`（复制 / 展开）。
       隐藏消息的「点标题看内容」预览行 = 画板 12 C 压缩卡的「看摘要」按钮形态
       （`.pw-btn sm` + `chevron-down`）。details JSON 走 `.pw-card-body` + `.pw-term`。 */
    <div style={{ marginBottom: "var(--s4)" }}>
      <div className="pw-card">
        <div className="pw-card-head">
          <span className="pw-mono">{title}</span>
          {isHiddenDisplay && <span className="pw-dim">{t("i18n.hiddenExtensionMessage")}</span>}
          <span className="grow" />
          {time && <span className="pw-dim">{time}</span>}
        </div>

        {/* fork:zm-01 — 正文区的常驻 grid；折叠态由下面的预览按钮承担，正文在收起
            过渡结束后才卸载，按钮随后才出现。 */}
        <div
          ref={contentCollapseRef}
          className="fork-collapse"
          data-fork-collapse={contentExpanded ? "open" : "closed"}
        >
          {contentMounted && (
            <div className="fork-collapse-body">
              <div className="pw-card-body" style={{ padding: "var(--s2) var(--s3)" }}>
                {images.length > 0 && (
                  <div style={{ display: "flex", gap: "var(--s2)", flexWrap: "wrap", marginBottom: text ? "var(--s2)" : 0 }}>
                    {images.map((img, i) => {
                      const src = imageSource(img);
                      if (!src) return null;
                      return (
                        <div className="pw-img" key={i}>
                          <ImagePreview src={src}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={src}
                              alt=""
                              style={{ maxWidth: "var(--img-max)", maxHeight: "var(--img-max)", objectFit: "contain", display: "block" }}
                            />
                          </ImagePreview>
                        </div>
                      );
                    })}
                  </div>
                )}
                {text
                  ? <MarkdownBody className="markdown-custom-message" cwd={cwd} onOpenFile={onOpenFile}>{text}</MarkdownBody>
                  : <span className="pw-dim">{t("i18n.noMessage")}</span>}
              </div>
            </div>
          )}
        </div>
        {!contentExpanded && !contentMounted && (
          <div className="pw-card-body">
            <button type="button" onClick={() => setContentExpanded(true)} className="pw-btn sm">
              <span className="pw-ico"><i data-ico="chevron-down" data-size="13"></i></span>
              {text ? previewText(text) : t("i18n.showExtensionMessage")}
            </button>
          </div>
        )}

        <div className="pw-card-foot">
          {text || detailsText ? (
            /* fork:fix-clipboard —— 失败档：按钮挂 `.pw-btn.sm.danger`，文案由下面
               那条 role=status 提示条承担（卡脚是常驻的，不像 `.pw-msg-acts`
               那样 hover 才显形，所以失败提示直接接在脚下面这一段里）。 */
            <button
              type="button"
              onClick={copyContent}
              title={failed ? t("chat.todosCopyFailed") : undefined}
              className={failed ? "pw-btn sm danger" : "pw-btn sm"}
            >
              <span className="pw-ico">{CopyStateIcon({ copied })}</span>
              {copied ? t("i18n.copied") : t("i18n.copy")}
            </button>
          ) : null}
          <span className="grow" />
          {(hasDetails || isHiddenDisplay) && (
            <button
              type="button"
              onClick={() => {
                if (isHiddenDisplay) setContentExpanded((v) => !v);
                else setDetailsExpanded((v) => !v);
              }}
              className="pw-btn sm"
            >
              {isHiddenDisplay
                 ? (contentExpanded ? t("i18n.collapse") : t("i18n.expand"))
                 : (detailsExpanded ? t("i18n.hideDetails") : t("i18n.showDetails"))}
            </button>
          )}
        </div>

        {/* fork:fix-clipboard —— 复制失败的提示条：挂在卡脚正下方的一段 `.pw-card-body`
            （本卡正文区已经这么分段，padding 也取同一档），失败时多出一行。 */}
        {failed && (
          <div className="pw-card-body" style={{ padding: "var(--s2) var(--s3)" }}>
            <CopyFailedNotice />
          </div>
        )}

        {/* fork:zm-01 — details 区的常驻 grid；折叠时不渲染 pre，收起过渡期间保留。 */}
        <div
          ref={detailsCollapseRef}
          className="fork-collapse"
          data-fork-collapse={showDetails ? "open" : "closed"}
        >
          {detailsMounted && (
            <div className="fork-collapse-body">
              <div className="pw-card-body">
                <div className="pw-term" style={{ maxHeight: 360, overflow: "auto" }}>
                  {detailsText}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function getMessageText(content: CustomMessage["content"] | UserMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export function getMessageImages(content: CustomMessage["content"] | UserMessage["content"]): ImageContent[] {
  if (typeof content === "string") return [];
  return content.filter((b): b is ImageContent => b.type === "image");
}

export function imageSource(img: ImageContent): string {
  const flat = img as unknown as { data?: string; mimeType?: string };
  if (img.source) {
    return img.source.type === "base64"
      ? `data:${img.source.media_type};base64,${img.source.data}`
      : img.source.url ?? "";
  }
  return flat.data ? `data:${flat.mimeType};base64,${flat.data}` : "";
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function getToolCallInputText(block: ToolCallContent): string {
  return block.rawInput ?? JSON.stringify(block.input, null, 2);
}

function formatCustomType(type: string): string {
  return type || "extension";
}

function previewText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "Show extension message";
  return normalized.length > 140 ? `${normalized.slice(0, 140)}...` : normalized;
}


function getToolPreview(block: ToolCallContent): string {
  const input = block.input;
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";

  // Common tool input patterns
  if ("command" in input) return String(input.command).slice(0, 120);
  if ("path" in input) return String(input.path).slice(0, 120);
  if ("file_path" in input) return String(input.file_path).slice(0, 120);
  if ("pattern" in input) return String(input.pattern).slice(0, 120);
  if ("query" in input) return String(input.query).slice(0, 120);

  const first = input[keys[0]];
  return String(first).slice(0, 120);
}

/**
 * 回合结束行那一格用的归一形状：本轮累计（`TurnStats`）与单条消息的 `usage` 都归到它，
 * 两个来源共用一套格式化 —— 免得「本轮口径」上线后单步路径悄悄走另一套。
 */
export interface RowUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** 本轮费用合计；0 / undefined = 不画这一格（免费或没上报价格）。 */
  costTotal: number;
}

export function formatUsage(usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}): string {
  // fork:design-components —— 回合用量行 = 画板 12 的「↑ 8,912 · ↓ 1,328 tok」。
  //
  // fix:turn-stats —— `↑` 是**这一次请求真的送进去的 prompt token**：光报
  // `usage.input` 是不准的（实测一次真实回合 input=71、cacheRead=240,830，却显示
  // 「↑ 71」—— 看上去只有 71 个 token，而模型读了 24 万）。所以上行 = input +
  // cacheRead + cacheWrite，过万走紧凑写法；精确拆分放在 title 里。
  // 缓存读写不再整项丢失（画板没画，但这一行本来就只放“这一轮花了多少”）。
  const prompt = usage.input + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  if (!prompt && !usage.output) return "";
  return `↑ ${formatCompactTokens(prompt)} · ↓ ${formatCompactTokens(usage.output)} tok`;
}

/** 用量格 title：把紧凑显示的三个数说清楚。 */
function usageTitle(usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}, t: (key: string, params?: Record<string, string | number>) => string): string {
  const parts = [
    `${t("chat.turnEnd.inputTokens", { count: usage.input.toLocaleString() })}`,
    `${t("chat.turnEnd.cacheRead", { count: (usage.cacheRead ?? 0).toLocaleString() })}`,
    `${t("chat.turnEnd.cacheWrite", { count: (usage.cacheWrite ?? 0).toLocaleString() })}`,
    `${t("chat.turnEnd.outputTokens", { count: usage.output.toLocaleString() })}`,
  ];
  return parts.join(" · ");
}

/** 费用（画板 12：用量与费用之间有一个 `·`）。
 *  fix:turn-stats —— **只有真的有费用才画**：单价为 0 的模型（`space-bunny-free` 这类免费档，
 *  pi 的价格表里 cost 全是 0）恒为 `$0.000`，一格常年 0 是噪声而不是信息
 *  （用户裁定 2026-10-01：“那就把这个金额去掉吧”）。上游报了 0 就是没花钱，不画。 */
export function formatUsageCost(usage: { costTotal: number }): string | null {
  return usage.costTotal > 0 ? `$${usage.costTotal.toFixed(3)}` : null;
}

/** 本轮累计优先，缺快照退回这条消息自己的 usage（老调用方 / 单条渲染）。 */
export function rowUsageOf(turn: TurnStats | undefined, usage: AgentUsage | undefined): RowUsage | null {
  if (turn && turn.steps > 0) {
    return {
      input: turn.input,
      output: turn.output,
      cacheRead: turn.cacheRead,
      cacheWrite: turn.cacheWrite,
      costTotal: turn.cost,
    };
  }
  if (!usage) return null;
  return {
    input: usage.input ?? 0,
    output: usage.output ?? 0,
    cacheRead: usage.cacheRead ?? 0,
    cacheWrite: usage.cacheWrite ?? 0,
    costTotal: usage.cost?.total ?? 0,
  };
}

/** 回合行的 token 写法：< 10k 保留精确数字（画板 12 写的是 `8,912`），过万才紧凑。
 *  与统计浮窗的 `formatCompactTokens`（components/SessionStatsBar.tsx）阈值不同是有意的：
 *  那边是**会话累计**（要短），这边是**单轮**（1,328 显示成 “1k” 就是错信息）。 */
function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 10_000) return `${Math.round(value / 1000)}k`;
  return value.toLocaleString();
}

/** 耗时（回合结束行 / 思考块 / 工具卡头共用）：
 *  < 1s 给毫秒（820ms，快工具不再一律显示「0.0s」或干脆不显示），
 *  < 60s 给一位小数（4.2s），≥ 60s 给 3m40s。 */
export function formatDuration(seconds: number): string {
  if (seconds < 1) {
    const ms = Math.round(seconds * 1000);
    return ms < 1 ? "<1ms" : `${ms}ms`;
  }
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m${String(rest).padStart(2, "0")}s`;
}

function BashExecutionView({ message, sessionId }: { message: BashExecutionMessage; sessionId?: string }) {
  const [fullOutput, setFullOutput] = useState<string | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [fullError, setFullError] = useState<string | null>(null);

  const isPending = !message.output && message.exitCode === undefined && !message.cancelled;
  const isError = message.cancelled || (message.exitCode !== undefined && message.exitCode !== 0);
  const fullOutputUrl = sessionId && message.fullOutputPath
    ? `/api/agent/${encodeURIComponent(sessionId)}/bash-output?path=${encodeURIComponent(message.fullOutputPath)}`
    : null;
  const showFullButton = message.truncated && fullOutputUrl && fullOutput === null;
  const displayOutput = fullOutput ?? message.output;

  async function loadFullOutput() {
    if (!fullOutputUrl) return;
    setLoadingFull(true);
    setFullError(null);
    try {
      const res = await fetch(fullOutputUrl);
      const d = await res.json() as { success?: boolean; data?: { output?: string }; error?: string };
      if (d.success) {
        setFullOutput(d.data?.output ?? "");
      } else {
        setFullError(d.error ?? "failed");
      }
    } catch (e) {
      setFullError(String(e));
    } finally {
      setLoadingFull(false);
    }
  }

  // Reuse the existing ToolCallBlock so user-run bash looks identical to an
  // agent-run bash tool call: same header, collapse behavior, result pane.
  // Synthesize an equivalent ToolCallContent + ToolResultMessage pair.
  const toolName = message.excludeFromContext ? "bash (local)" : "bash";
  const block: ToolCallContent = {
    type: "toolCall",
    toolCallId: `bash-${message.timestamp ?? ""}`,
    toolName,
    input: { command: message.command },
  };
  const result: ToolResultMessage | undefined = isPending
    ? undefined
    : {
        role: "toolResult",
        toolCallId: block.toolCallId,
        toolName,
        content: displayOutput ? [{ type: "text", text: displayOutput }] : [],
        isError,
        timestamp: message.timestamp,
      };

  return (
    <div style={{ margin: "var(--space-row) 0" }}>
      <ToolCallBlock block={block} result={result} />
      {/* fork:design-components —— 截断提示行用画板的 `.pw-btn sm`（复制 / 下载这类
          小动作的统一形态）+ `.pw-dim` 报错文案。i18n 文案与行为照旧。 */}
      {message.truncated && fullOutputUrl && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
          {showFullButton && (
            <button
              type="button"
              onClick={loadFullOutput}
              disabled={loadingFull}
              className="pw-btn sm"
            >
              {loadingFull ? "loading…" : "view full output"}
            </button>
          )}
          <a href={`${fullOutputUrl}&download=1`} className="pw-btn sm">
            download full output
          </a>
          {fullError && <span className="pw-dim">({fullError})</span>}
        </div>
      )}
    </div>
  );
}
