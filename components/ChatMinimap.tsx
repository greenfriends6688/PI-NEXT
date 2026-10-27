"use client";

import { memo, useEffect, useRef, useState, useCallback, useMemo, type RefObject } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown, { type Options as ReactMarkdownOptions } from "react-markdown";
import rehypeKatex from "rehype-katex";
import {
  markdownPreviewRemarkPlugins,
  normalizeDisplayMath,
} from "@/lib/markdown";
import { isMessageGroupAnchor, splitFinalAssistantBlocks } from "@/lib/message-display";
import type { AgentMessage, AssistantMessage, CustomMessage, TextContent, UserMessage } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import styles from "./ChatMinimap.module.css";

interface Props {
  messages: AgentMessage[];
  /** The reply being streamed, read when the turns are measured: it never re-renders the minimap. */
  getStreamingMessage: () => Partial<AgentMessage> | null;
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  /** Turns of the branch the server has not sent yet: numbers continue from it (#791). */
  turnsBefore: number;
}


interface AssistantPreview {
  markdown: string;
  element: HTMLDivElement | null;
}

interface TurnInfo {
  userMessage: UserMessage | CustomMessage;
  assistantPreviews: AssistantPreview[];
  scrollTop: number | null;
  /** Tool calls issued anywhere in this turn's assistant replies. */
  toolCount: number;
}

function getUserPreview(message: UserMessage | CustomMessage): string {
  if (typeof message.content === "string") return message.content.trim();
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** Tool calls in one assistant message. A reply can both answer and call
 *  tools, so this counts blocks rather than text-less messages. */
export function countToolCalls(message: AgentMessage | Partial<AgentMessage>): number {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return 0;
  return message.content.reduce(
    (total, block) => total + (block.type === "toolCall" ? 1 : 0),
    0,
  );
}

/** One short line of a reply: its first sentence or heading, for the tick's card. */
export function getAssistantExcerpt(markdown: string, max = 120): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>~]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function getAssistantAnswerMarkdown(message: AgentMessage | Partial<AgentMessage>): string {
  if (message.role !== "assistant") return "";
  const { answerBlocks } = splitFinalAssistantBlocks(message as AssistantMessage);
  return answerBlocks
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n\n")
    .trim();
}

function PreviewHeading({
  level,
  children,
  headingIndex,
  onClick,
}: {
  level: 1 | 2 | 3;
  children: React.ReactNode;
  headingIndex: number | null;
  onClick?: (headingIndex: number) => void;
}) {
  return (
    <button
      type="button"
      className={styles.heading}
      data-level={level}
      data-preview-heading-index={headingIndex ?? undefined}
      disabled={headingIndex === null || !onClick}
      onClick={(event) => {
        event.stopPropagation();
        if (headingIndex !== null) onClick?.(headingIndex);
      }}
    >
      {children}
    </button>
  );
}

interface PreviewAstNode {
  type?: string;
  depth?: number;
  data?: {
    hProperties?: Record<string, unknown>;
  };
}

function remarkPreviewOutline() {
  return (tree: { children?: PreviewAstNode[] }) => {
    if (!Array.isArray(tree.children)) return;
    const headings = tree.children.filter((node) => (
      node.type === "heading" && typeof node.depth === "number" && node.depth <= 3
    ));
    if (headings.length > 0) {
      headings.forEach((node, headingIndex) => {
        node.data = {
          ...node.data,
          hProperties: {
            ...node.data?.hProperties,
            "data-preview-heading-index": headingIndex,
          },
        };
      });
      tree.children = headings;
      return;
    }
    const firstParagraph = tree.children.find((node) => node.type === "paragraph");
    tree.children = firstParagraph ? [firstParagraph] : [];
  };
}

const previewRemarkPlugins = [
  ...(markdownPreviewRemarkPlugins ?? []),
  remarkPreviewOutline,
];
const previewRehypePlugins: ReactMarkdownOptions["rehypePlugins"] = [
  [rehypeKatex, { throwOnError: false, strict: false }],
];

function getPreviewHeadingIndex(node: unknown): number | null {
  const properties = (node as { properties?: Record<string, unknown> } | undefined)?.properties;
  const value = properties?.dataPreviewHeadingIndex ?? properties?.["data-preview-heading-index"];
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

export const AssistantOutline = memo(function AssistantOutline({
  markdown,
  onHeadingClick,
  onAnswerClick,
}: {
  markdown: string;
  onHeadingClick?: (headingIndex: number) => void;
  onAnswerClick?: () => void;
}) {
  const normalizedMarkdown = useMemo(() => normalizeDisplayMath(markdown), [markdown]);
  if (!markdown) return null;
  return (
    <div className={styles.outline}>
      <ReactMarkdown
        remarkPlugins={previewRemarkPlugins}
        rehypePlugins={previewRehypePlugins}
        components={{
          h1: ({ children, node }) => <PreviewHeading level={1} headingIndex={getPreviewHeadingIndex(node)} onClick={onHeadingClick}>{children}</PreviewHeading>,
          h2: ({ children, node }) => <PreviewHeading level={2} headingIndex={getPreviewHeadingIndex(node)} onClick={onHeadingClick}>{children}</PreviewHeading>,
          h3: ({ children, node }) => <PreviewHeading level={3} headingIndex={getPreviewHeadingIndex(node)} onClick={onHeadingClick}>{children}</PreviewHeading>,
          h4: () => null,
          h5: () => null,
          h6: () => null,
          p: ({ children }) => (
            <button
              type="button"
              className={styles.paragraph}
              onClick={onAnswerClick}
            >
              {children}
            </button>
          ),
          blockquote: () => null,
          ul: () => null,
          ol: () => null,
          pre: () => null,
          table: () => null,
          hr: () => null,
          a: ({ children }) => <>{children}</>,
          code: ({ children }) => <>{children}</>,
        }}
      >
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
});


/** More than this many bars on a 700px rail is a solid line, not ticks. */
const MAX_TICKS = 120;
const MIN_ROW_HEIGHT = 10;
const MAX_ROW_HEIGHT = 50;
const PREVIEW_HIDE_DELAY = 180;
const NAVIGATION_ACTIVE_LOCK_MS = 1600;

interface NodeInfo {
  /** Null for a turn the server has not sent yet: its bar still shows. */
  targetTurn: TurnInfo | null;
  index: number;
}

function createTurnNodes(turns: TurnInfo[], turnsBefore: number): NodeInfo[] {
  // One bar per turn, including the ones whose text the server has not sent
  // yet: those are placeholders that page the history in when clicked.
  const earlier = Math.max(0, Math.min(turnsBefore, MAX_TICKS - turns.length));
  const placeholders: NodeInfo[] = Array.from({ length: earlier }, (_, index) => ({
    targetTurn: null,
    index,
  }));
  return [
    ...placeholders,
    ...turns.map((turn, offset) => ({ targetTurn: turn, index: earlier + offset })),
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export const ChatMinimap = memo(function ChatMinimap({
  messages,
  getStreamingMessage,
  scrollContainer,
  messageRefs,
  turnsBefore,
}: Props) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const [portalReady, setPortalReady] = useState(false);

  const railRef = useRef<HTMLElement>(null);
  const nodesRef = useRef<NodeInfo[]>([]);
  const previewHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeNodeLockRef = useRef<{ index: number; until: number } | null>(null);
  const scrubbingRef = useRef(false);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const lockActiveNode = useCallback((index: number) => {
    activeNodeLockRef.current = { index, until: Date.now() + NAVIGATION_ACTIVE_LOCK_MS };
    setActiveIndex(index);
  }, []);

  const syncActiveNode = useCallback((scrollEl: HTMLDivElement, nextNodes: NodeInfo[]) => {
    const activeLock = activeNodeLockRef.current;
    if (activeLock && Date.now() < activeLock.until) {
      setActiveIndex(activeLock.index);
      return;
    }
    activeNodeLockRef.current = null;

    const measured = nextNodes.filter((node) => node.targetTurn?.scrollTop != null);
    if (measured.length === 0) {
      setActiveIndex(null);
      return;
    }
    const focusTop = scrollEl.scrollTop + scrollEl.clientHeight * 0.3;
    const nextActive = measured.reduce((best, node) => (
      Math.abs((node.targetTurn?.scrollTop ?? 0) - focusTop)
        < Math.abs((best.targetTurn?.scrollTop ?? 0) - focusTop)
        ? node
        : best
    ), measured[0]);
    setActiveIndex(nextActive.index);
  }, []);

  const updateScroll = useCallback(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    setVisible(scrollEl.scrollHeight - scrollEl.clientHeight > 20);
    syncActiveNode(scrollEl, nodesRef.current);
  }, [scrollContainer, syncActiveNode]);

  const measureThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureNodes = useCallback(() => {
    if (measureThrottleRef.current) return;
    measureThrottleRef.current = setTimeout(() => {
      measureThrottleRef.current = null;
      const scrollEl = scrollContainer.current;
      if (!scrollEl) return;

      const refs = messageRefs.current;
      const containerRect = scrollEl.getBoundingClientRect();
      const turns: TurnInfo[] = [];
      let refIndex = 0;
      let currentTurn: TurnInfo | null = null;

      const streamingMessage = getStreamingMessage();
      const allMessages: (AgentMessage | Partial<AgentMessage>)[] = streamingMessage
        ? [...messagesRef.current, streamingMessage]
        : messagesRef.current;
      for (const message of allMessages) {
        const isAnchor = isMessageGroupAnchor(message);
        if (!isAnchor && message.role !== "assistant") continue;
        const element = refs?.[refIndex];
        refIndex++;

        if (isAnchor) {
          currentTurn = null;
          const elementRect = element?.getBoundingClientRect();
          currentTurn = {
            userMessage: message as UserMessage | CustomMessage,
            assistantPreviews: [],
            scrollTop: elementRect
              ? elementRect.top - containerRect.top + scrollEl.scrollTop
              : null,
            toolCount: 0,
          };
          turns.push(currentTurn);
          continue;
        }

        if (!currentTurn) continue;
        currentTurn.toolCount += countToolCalls(message);
        const answerMarkdown = getAssistantAnswerMarkdown(message);
        if (answerMarkdown) {
          currentTurn.assistantPreviews.push({ markdown: answerMarkdown, element });
        }
      }

      const nextNodes = createTurnNodes(turns, turnsBefore);
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      setVisible(scrollEl.scrollHeight - scrollEl.clientHeight > 20);
      syncActiveNode(scrollEl, nextNodes);
    }, 150);
  }, [getStreamingMessage, messageRefs, scrollContainer, syncActiveNode, turnsBefore]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    el.addEventListener("scroll", updateScroll, { passive: true });
    return () => el.removeEventListener("scroll", updateScroll);
  }, [scrollContainer, updateScroll]);

  useEffect(() => {
    const el = scrollContainer.current;
    if (!el) return;
    const syncLayout = () => {
      measureNodes();
      updateScroll();
    };
    const ro = new ResizeObserver(syncLayout);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    syncLayout();
    return () => {
      ro.disconnect();
      if (measureThrottleRef.current) {
        clearTimeout(measureThrottleRef.current);
        measureThrottleRef.current = null;
      }
    };
  }, [measureNodes, scrollContainer, updateScroll]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      measureNodes();
      updateScroll();
    }, 50);
    return () => clearTimeout(timeout);
  }, [messages.length, measureNodes, updateScroll]);

  const scrollToNode = useCallback((node: NodeInfo, behavior: ScrollBehavior) => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    lockActiveNode(node.index);
    if (!node.targetTurn || node.targetTurn.scrollTop == null) {
      scrollEl.scrollTo({ top: 0, behavior });
      return;
    }
    scrollEl.scrollTo({
      top: Math.max(0, node.targetTurn.scrollTop - scrollEl.clientHeight * 0.3),
      behavior,
    });
  }, [lockActiveNode, scrollContainer]);

  const scrollToAssistant = useCallback((node: NodeInfo, assistantIndex = 0) => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const assistantElement = node.targetTurn?.assistantPreviews[assistantIndex]?.element;
    lockActiveNode(node.index);
    if (!assistantElement) {
      scrollToNode(node, "smooth");
      return;
    }
    const containerRect = scrollEl.getBoundingClientRect();
    const assistantRect = assistantElement.getBoundingClientRect();
    scrollEl.scrollTo({
      top: Math.max(0, assistantRect.top - containerRect.top + scrollEl.scrollTop - scrollEl.clientHeight * 0.3),
      behavior: "smooth",
    });
  }, [lockActiveNode, scrollContainer, scrollToNode]);

  const cancelPreviewHide = useCallback(() => {
    if (!previewHideTimerRef.current) return;
    clearTimeout(previewHideTimerRef.current);
    previewHideTimerRef.current = null;
  }, []);

  const schedulePreviewHide = useCallback(() => {
    cancelPreviewHide();
    previewHideTimerRef.current = setTimeout(() => {
      previewHideTimerRef.current = null;
      if (scrubbingRef.current) return;
      setHoveredIndex(null);
      setTooltipPos(null);
    }, PREVIEW_HIDE_DELAY);
  }, [cancelPreviewHide]);

  useEffect(() => () => cancelPreviewHide(), [cancelPreviewHide]);

  const positionTooltipForRow = useCallback((row: HTMLElement) => {
    const rect = row.getBoundingClientRect();
    const tooltipWidth = Math.min(320, window.innerWidth - 16);
    setTooltipPos({
      top: clamp(rect.top + rect.height / 2, 24, window.innerHeight - 24),
      left: clamp(rect.right + 8, 8, window.innerWidth - tooltipWidth - 8),
    });
  }, []);

  const showNodePreview = useCallback((index: number, row: HTMLElement) => {
    cancelPreviewHide();
    setHoveredIndex(index);
    positionTooltipForRow(row);
  }, [cancelPreviewHide, positionTooltipForRow]);

  const findNearestRowIndex = useCallback((clientY: number): number | null => {
    const rail = railRef.current;
    if (!rail || nodesRef.current.length === 0) return null;
    const rows = rail.querySelectorAll<HTMLButtonElement>("[data-minimap-node-index]");
    if (rows.length === 0) return null;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    rows.forEach((row) => {
      const rect = row.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const distance = Math.abs(mid - clientY);
      const index = Number(row.dataset.minimapNodeIndex);
      if (!Number.isFinite(index)) return;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const rail = railRef.current;
    if (!rail) return;
    scrubbingRef.current = true;
    setScrubIndex(hoveredIndex);
    rail.setPointerCapture(event.pointerId);

    const jump = (clientY: number, behavior: ScrollBehavior) => {
      const index = findNearestRowIndex(clientY);
      if (index == null) return;
      const node = nodesRef.current[index];
      if (!node) return;
      setScrubIndex(index);
      setHoveredIndex(index);
      const row = rail.querySelector<HTMLElement>(`[data-minimap-node-index="${index}"]`);
      if (row) positionTooltipForRow(row);
      scrollToNode(node, behavior);
    };

    jump(event.clientY, "smooth");

    const onMove = (moveEvent: PointerEvent) => {
      if (!scrubbingRef.current) return;
      jump(moveEvent.clientY, "auto");
    };
    const onUp = (upEvent: PointerEvent) => {
      scrubbingRef.current = false;
      setScrubIndex(null);
      try {
        rail.releasePointerCapture(upEvent.pointerId);
      } catch {
        // The rail may have unmounted mid-scrub.
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, [findNearestRowIndex, hoveredIndex, positionTooltipForRow, scrollToNode]);

  if (!visible || nodes.length === 0) return null;

  const previewNode = hoveredIndex == null ? null : nodes.find((node) => node.index === hoveredIndex) ?? null;
  const userLabel = previewNode?.targetTurn ? getUserPreview(previewNode.targetTurn.userMessage) : "";
  const assistantPreview = previewNode?.targetTurn?.assistantPreviews[0]
    ? getAssistantExcerpt(previewNode.targetTurn.assistantPreviews[0].markdown, 220)
    : "";

  const rail = (
    <nav
      ref={railRef}
      data-chat-minimap=""
      data-scrubbing={scrubIndex != null ? "" : undefined}
      className={styles.rail}
      aria-label={t("chatMinimap.nav")}
      onPointerDown={handlePointerDown}
      onPointerLeave={() => {
        if (!scrubbingRef.current) schedulePreviewHide();
      }}
    >
      {nodes.map((node) => {
        const isCurrent = activeIndex === node.index;
        const isScrubTarget = scrubIndex === node.index;
        return (
          <button
            key={node.index}
            type="button"
            className={styles.row}
            data-minimap-node-index={node.index}
            data-minimap-node-active={isCurrent ? "" : undefined}
            data-scrub-target={isScrubTarget ? "" : undefined}
            aria-current={isCurrent ? "true" : undefined}
            aria-label={node.targetTurn
              ? t("chatMinimap.jumpToTurn", { index: node.index + 1 })
              : t("chatMinimap.earlierTurnsShort", { count: turnsBefore })}
            style={{ minHeight: MIN_ROW_HEIGHT, maxHeight: MAX_ROW_HEIGHT }}
            onMouseEnter={(event) => showNodePreview(node.index, event.currentTarget)}
            onFocus={(event) => showNodePreview(node.index, event.currentTarget)}
            onMouseLeave={() => {
              if (!scrubbingRef.current) schedulePreviewHide();
            }}
            onClick={() => scrollToNode(node, "smooth")}
          >
            <span className={styles.markerTrack}>
              <span className={styles.marker} />
            </span>
          </button>
        );
      })}
    </nav>
  );

  const tooltip = previewNode && tooltipPos && portalReady
    ? createPortal(
      <div
        className={styles.tooltip}
        data-minimap-preview-box=""
        style={{ top: tooltipPos.top, left: tooltipPos.left, transform: "translateY(-50%)" }}
        onMouseEnter={cancelPreviewHide}
        onMouseLeave={schedulePreviewHide}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {previewNode.targetTurn ? (
          <>
            <button
              type="button"
              className={styles.userLabel}
              data-minimap-preview-user={previewNode.index}
              onClick={() => scrollToNode(previewNode, "smooth")}
              title={userLabel || t("chatMinimap.noContent")}
            >
              {userLabel || <span className={styles.emptyLabel}>{t("chatMinimap.noContent")}</span>}
            </button>
            {assistantPreview ? (
              <div
                className={styles.assistantPreview}
                role="button"
                tabIndex={0}
                data-minimap-preview-assistant={`${previewNode.index}-0`}
                onClick={() => scrollToAssistant(previewNode, 0)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  scrollToAssistant(previewNode, 0);
                }}
              >
                {assistantPreview}
              </div>
            ) : null}
            {previewNode.targetTurn.toolCount > 0 && (
              <div className={styles.meta}>
                {t("chatMinimap.toolCalls", { count: previewNode.targetTurn.toolCount })}
              </div>
            )}
          </>
        ) : (
          <button
            type="button"
            className={styles.userLabel}
            data-minimap-preview-earlier=""
            onClick={() => scrollContainer.current?.scrollTo({ top: 0, behavior: "smooth" })}
          >
            {t("chatMinimap.earlierTurnsShort", { count: turnsBefore })}
          </button>
        )}
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      {rail}
      {tooltip}
    </>
  );
});

// Hook to create a stable array of refs for messages
export function useMessageRefs(count: number): RefObject<(HTMLDivElement | null)[]> {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  refs.current = Array(count).fill(null).map((_, i) => refs.current[i] ?? null);
  return refs;
}
