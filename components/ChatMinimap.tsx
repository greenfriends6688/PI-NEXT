"use client";

import { memo, useEffect, useRef, useState, useCallback, useMemo, type RefObject } from "react";
import ReactMarkdown, { type Options as ReactMarkdownOptions } from "react-markdown";
import rehypeKatex from "rehype-katex";
import {
  markdownPreviewRemarkPlugins,
  normalizeDisplayMath,
} from "@/lib/markdown";
import { isMessageGroupAnchor, splitFinalAssistantBlocks } from "@/lib/message-display";
import type { AgentMessage, AssistantMessage, CustomMessage, TextContent, UserMessage } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";


interface Props {
  messages: AgentMessage[];
  streamingMessage: Partial<AgentMessage> | null;
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  onRevealHistory: () => void;
  /** Whether the server has user turns older than the loaded page. */
  hasEarlierMessages: boolean;
  /** True while a page of older history is being fetched. */
  loadingEarlier: boolean;
  /** Fetch the previous page of older history into the chat. */
  onLoadEarlier: () => void | Promise<void>;
}

/** 导轨宽 36px 由 board.css 的 `.pw-minimap-rail` 给（画板 53），产品侧不再写死。 */
const MAX_NODE_GAP = 50;
const MINIMAP_PADDING = 12;
const MINIMAP_TRIGGER_TAIL = 16;
const PREVIEW_HIDE_DELAY = 250;
const NAVIGATION_ACTIVE_LOCK_MS = 1600;

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

interface NodeInfo {
  topRatio: number;
  targetTurn: TurnInfo;
  index: number;
  /** Board 53 `.node.heading` — front-end derived, never persisted. */
  kind: TurnNodeKind;
}

/**
 * fork:design-system SW-15 —— 导轨节点的语义分类（画板 53 的 `.node.heading`）。
 *
 * **纯前端派生**：只看这一轮已渲染出来的内容，不回读会话文件、不新增任何持久字段。
 * 判定顺序即视觉优先级：
 *   1. `heading` —— 这一轮的回答以 Markdown 标题开场（回答本身就是一节）；
 *   2. `tool`    —— 没有任何回答正文、只有工具调用；
 *   3. `assistant` —— 有回答正文；
 *   4. `user`    —— 还没有回答（正在跑 / 被中断）。
 */
export type TurnNodeKind = "user" | "assistant" | "tool" | "heading";

export function deriveTurnNodeKind(turn: TurnInfo): TurnNodeKind {
  const hasAnswer = turn.assistantPreviews.some((preview) => preview.markdown.trim().length > 0);
  if (hasAnswer && turn.assistantPreviews.some((preview) => /^#{1,3}\s/m.test(preview.markdown))) {
    return "heading";
  }
  if (!hasAnswer && turn.toolCount > 0) return "tool";
  if (hasAnswer) return "assistant";
  return "user";
}

/** fork:upstream-0.9.2-minimap-tools — tool calls in one assistant message. A reply can
 *  both answer and call tools, so this counts blocks rather than text-less messages. */
export function countToolCalls(message: AgentMessage | Partial<AgentMessage>): number {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return 0;
  return message.content.reduce(
    (total, block) => total + (block.type === "toolCall" ? 1 : 0),
    0,
  );
}

function getUserPreview(message: UserMessage | CustomMessage): string {
  if (typeof message.content === "string") return message.content.trim();
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
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
      data-minimap-line=""

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
    <div data-minimap-outline="">

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
              data-minimap-line=""
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

function createTurnNodes(turns: TurnInfo[]): NodeInfo[] {
  return turns.map((turn, index) => ({
    topRatio: 0,
    targetTurn: turn,
    index,
    kind: deriveTurnNodeKind(turn),
  }));
}

interface NodeLayout {
  nodes: NodeInfo[];
  gap: number;
  fillsHeight: boolean;
}

function layoutNodes(allNodes: NodeInfo[], minimapHeight: number): NodeLayout {
  if (allNodes.length === 0) {
    return { nodes: [], gap: MAX_NODE_GAP, fillsHeight: false };
  }

  const height = Math.max(1, minimapHeight);
  const usableHeight = Math.max(0, height - MINIMAP_PADDING * 2);
  if (allNodes.length === 1) {
    return {
      nodes: [{ ...allNodes[0], topRatio: MINIMAP_PADDING / height }],
      gap: MAX_NODE_GAP,
      fillsHeight: false,
    };
  }

  const naturalGap = usableHeight / (allNodes.length - 1);
  const gap = Math.min(MAX_NODE_GAP, naturalGap);
  return {
    nodes: allNodes.map((node, index) => ({
      ...node,
      topRatio: (MINIMAP_PADDING + index * gap) / height,
    })),
    gap,
    fillsHeight: naturalGap <= MAX_NODE_GAP,
  };
}

export function ChatMinimap({
  messages,
  streamingMessage,
  scrollContainer,
  messageRefs,
  onRevealHistory,
  hasEarlierMessages,
  loadingEarlier,
  onLoadEarlier,
}: Props) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [allNodes, setAllNodes] = useState<NodeInfo[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [minimapHeight, setMinimapHeight] = useState(600);
  const [minimapHovered, setMinimapHovered] = useState(false);
  const [previewPinned, setPreviewPinned] = useState(false);
  /* fork:zn-17 — 单根 dash 的悬停 tooltip（Zeno `.minimap-popover`）。
     与既有的 outline 预览面板（hover 整条轨道才出、可钉住）并存：tooltip 回答
     「这一根是什么」，预览面板回答「整段结构长什么样」。 */
  const [mouseYRatio, setMouseYRatio] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const allNodesRef = useRef<NodeInfo[]>([]);
  const nodeLayoutRef = useRef<NodeLayout>({
    nodes: [],
    gap: MAX_NODE_GAP,
    fillsHeight: false,
  });
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const previewItemRefs = useRef(new Map<number, HTMLDivElement>());
  const previewHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeNodeLockRef = useRef<{ index: number; until: number } | null>(null);
  const pendingNavigationRef = useRef<{
    nodeIndex: number;
    target: "user" | "assistant" | "heading";
    assistantIndex?: number;
    headingIndex?: number;
  } | null>(null);

  const allMessages = useMemo(
    () => (streamingMessage ? [...messages, streamingMessage] : messages) as (AgentMessage | Partial<AgentMessage>)[],
    [messages, streamingMessage],
  );
  const allMessagesRef = useRef(allMessages);
  allMessagesRef.current = allMessages;

  const nodeLayout = useMemo(
    () => layoutNodes(allNodes, minimapHeight),
    [allNodes, minimapHeight],
  );
  const { nodes: positionedNodes } = nodeLayout;
  nodeLayoutRef.current = nodeLayout;

  const lockActiveNode = useCallback((index: number) => {
    activeNodeLockRef.current = {
      index,
      until: Date.now() + NAVIGATION_ACTIVE_LOCK_MS,
    };
    setActiveIndex(index);
  }, []);

  const syncActiveNode = useCallback((scrollEl: HTMLDivElement, nextNodes: NodeInfo[]) => {
    const activeLock = activeNodeLockRef.current;
    if (activeLock && Date.now() < activeLock.until) {
      setActiveIndex(activeLock.index);
      return;
    }
    activeNodeLockRef.current = null;

    const measuredNodes = nextNodes.filter((node) => node.targetTurn.scrollTop !== null);
    if (measuredNodes.length === 0) {
      setActiveIndex(null);
      return;
    }
    const focusTop = scrollEl.scrollTop + scrollEl.clientHeight * 0.3;
    const nextActiveNode = measuredNodes.reduce((bestNode, node) => (
      Math.abs((node.targetTurn.scrollTop ?? 0) - focusTop)
        < Math.abs((bestNode.targetTurn.scrollTop ?? 0) - focusTop)
        ? node
        : bestNode
    ), measuredNodes[0]);
    setActiveIndex(nextActiveNode.index);
  }, []);

  const updateScroll = useCallback(() => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const scrollable = scrollEl.scrollHeight - scrollEl.clientHeight;
    const currentNodes = allNodesRef.current;
    setVisible(scrollable > 20);
    syncActiveNode(scrollEl, currentNodes);
  }, [scrollContainer, syncActiveNode]);

  const measureThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const measureNodes = useCallback(() => {
    if (measureThrottleRef.current) return;
    measureThrottleRef.current = setTimeout(() => {
      measureThrottleRef.current = null;
      const scrollEl = scrollContainer.current;
      const minimapEl = containerRef.current;
      if (!scrollEl || !minimapEl) return;

      const refs = messageRefs.current;
      const containerRect = scrollEl.getBoundingClientRect();
      const turns: TurnInfo[] = [];
      let refIndex = 0;
      let currentTurn: TurnInfo | null = null;

      for (const message of allMessagesRef.current) {
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
            toolCount: 0,
            scrollTop: elementRect
              ? elementRect.top - containerRect.top + scrollEl.scrollTop
              : null,
          };
          turns.push(currentTurn);
          continue;
        }

        if (!currentTurn) continue;
        currentTurn.toolCount += countToolCalls(message);
        const answerMarkdown = getAssistantAnswerMarkdown(message);
        if (answerMarkdown) {
          currentTurn.assistantPreviews.push({
            markdown: answerMarkdown,
            element,
          });
        }
      }

      const nextNodes = createTurnNodes(turns);
      setMinimapHeight(minimapEl.clientHeight);
      allNodesRef.current = nextNodes;
      setAllNodes(nextNodes);
      setVisible(scrollEl.scrollHeight - scrollEl.clientHeight > 20);
      syncActiveNode(scrollEl, nextNodes);

      const pendingNavigation = pendingNavigationRef.current;
      const pendingNode = pendingNavigation
        ? nextNodes[pendingNavigation.nodeIndex]
        : null;
      if (pendingNavigation && pendingNode) {
        const assistant = pendingNavigation.assistantIndex === undefined
          ? null
          : pendingNode.targetTurn.assistantPreviews[pendingNavigation.assistantIndex];
        let targetTop: number | null = pendingNode.targetTurn.scrollTop;
        if (pendingNavigation.target === "assistant") {
          const assistantRect = assistant?.element?.getBoundingClientRect();
          targetTop = assistantRect
            ? assistantRect.top - containerRect.top + scrollEl.scrollTop
            : null;
        } else if (pendingNavigation.target === "heading") {
          const heading = (
            pendingNavigation.headingIndex === undefined
              ? null
              : assistant?.element
                ?.querySelectorAll<HTMLElement>("h1, h2, h3")
                .item(pendingNavigation.headingIndex)
          );
          const headingRect = heading?.getBoundingClientRect();
          targetTop = headingRect
            ? headingRect.top - containerRect.top + scrollEl.scrollTop
            : null;
        }
        if (targetTop === null) return;
        pendingNavigationRef.current = null;
        lockActiveNode(pendingNode.index);
        const targetOffset = scrollEl.clientHeight * 0.3;
        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        scrollEl.scrollTo({ top: Math.max(0, targetTop - targetOffset), behavior: reduceMotion ? "auto" : "smooth" });
      }
    }, 150);
  }, [lockActiveNode, messageRefs, scrollContainer, syncActiveNode]);

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
    if (node.targetTurn.scrollTop === null) {
      pendingNavigationRef.current = { nodeIndex: node.index, target: "user" };
      onRevealHistory();
      return;
    }
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const targetTop = Math.max(
      0,
      node.targetTurn.scrollTop - scrollEl.clientHeight * 0.3,
    );
    scrollEl.scrollTo({ top: targetTop, behavior: reduceMotion ? "auto" : behavior });
  }, [lockActiveNode, onRevealHistory, scrollContainer]);

  const scrollToAssistant = useCallback((node: NodeInfo, assistantIndex: number) => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const assistantElement = node.targetTurn.assistantPreviews[assistantIndex]?.element;
    if (!assistantElement) {
      pendingNavigationRef.current = {
        nodeIndex: node.index,
        target: "assistant",
        assistantIndex,
      };
      onRevealHistory();
      return;
    }
    const containerRect = scrollEl.getBoundingClientRect();
    const assistantRect = assistantElement.getBoundingClientRect();
    const targetTop = (
      assistantRect.top
      - containerRect.top
      + scrollEl.scrollTop
      - scrollEl.clientHeight * 0.3
    );
    lockActiveNode(node.index);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    scrollEl.scrollTo({ top: Math.max(0, targetTop), behavior: reduceMotion ? "auto" : "smooth" });
  }, [lockActiveNode, onRevealHistory, scrollContainer]);

  const findNearestNode = useCallback((ratio: number): NodeInfo | null => {
    const { nodes, gap, fillsHeight } = nodeLayoutRef.current;
    const height = containerRef.current?.clientHeight ?? 0;
    if (nodes.length === 0 || height <= 0) return null;

    const pointerY = Math.max(0, Math.min(height, ratio * height));
    const firstNodeY = nodes[0].topRatio * height;
    const rawIndex = gap > 0 ? Math.round((pointerY - firstNodeY) / gap) : 0;
    const nodeIndex = Math.max(0, Math.min(nodes.length - 1, rawIndex));
    const nearestNode = nodes[nodeIndex];

    if (!fillsHeight) {
      const nodeY = nearestNode.topRatio * height;
      const hitRadius = Math.max(10, gap / 2);
      if (Math.abs(pointerY - nodeY) > hitRadius) return null;
    }
    return nearestNode;
  }, []);

  const scrollToHeading = useCallback((
    node: NodeInfo,
    assistantIndex: number,
    headingIndex: number,
  ) => {
    const scrollEl = scrollContainer.current;
    if (!scrollEl) return;
    const answerElement = node.targetTurn.assistantPreviews[assistantIndex]?.element;
    if (!answerElement) {
      pendingNavigationRef.current = {
        nodeIndex: node.index,
        target: "heading",
        assistantIndex,
        headingIndex,
      };
      onRevealHistory();
      return;
    }
    const heading = answerElement.querySelectorAll<HTMLElement>("h1, h2, h3").item(headingIndex);
    if (!heading) return;
    const containerRect = scrollEl.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    const targetTop = (
      headingRect.top
      - containerRect.top
      + scrollEl.scrollTop
      - scrollEl.clientHeight * 0.3
    );
    lockActiveNode(node.index);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    scrollEl.scrollTo({ top: Math.max(0, targetTop), behavior: reduceMotion ? "auto" : "smooth" });
  }, [lockActiveNode, onRevealHistory, scrollContainer]);

  const cancelPreviewHide = useCallback(() => {
    if (!previewHideTimerRef.current) return;
    clearTimeout(previewHideTimerRef.current);
    previewHideTimerRef.current = null;
  }, []);

  const showPreview = useCallback(() => {
    cancelPreviewHide();
    setMinimapHovered(true);
  }, [cancelPreviewHide]);

  const schedulePreviewHide = useCallback(() => {
    cancelPreviewHide();
    if (previewPinned) return;
    previewHideTimerRef.current = setTimeout(() => {
      previewHideTimerRef.current = null;
      setMinimapHovered(false);
      setMouseYRatio(null);
    }, PREVIEW_HIDE_DELAY);
  }, [cancelPreviewHide, previewPinned]);

  useEffect(() => () => cancelPreviewHide(), [cancelPreviewHide]);

  const getTriggerBottom = useCallback(() => {
    const height = containerRef.current?.clientHeight ?? minimapHeight;
    const lastNode = nodeLayoutRef.current.nodes.at(-1);
    if (!lastNode || height <= 0) return 0;
    return Math.min(
      height,
      lastNode.topRatio * height + MINIMAP_TRIGGER_TAIL,
    );
  }, [minimapHeight]);

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!visible) return;

    draggingRef.current = true;
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerRatio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const pointerY = event.clientY - rect.top;
    if (pointerY <= getTriggerBottom()) {
      showPreview();
    } else {
      schedulePreviewHide();
    }
    setMouseYRatio(pointerRatio);
    const jumpToPointer = (clientY: number, behavior: ScrollBehavior) => {
      const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      const node = findNearestNode(ratio);
      if (node) {
        scrollToNode(node, behavior);
      }
    };

    jumpToPointer(event.clientY, "smooth");
    const onMove = (moveEvent: MouseEvent) => {
      if (!draggingRef.current) return;
      jumpToPointer(moveEvent.clientY, "auto");
    };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [findNearestNode, getTriggerBottom, schedulePreviewHide, scrollToNode, showPreview, visible]);

  const nearestNode = mouseYRatio === null ? null : findNearestNode(mouseYRatio);
  const nearestNodeIndex = nearestNode?.index ?? null;
  /* fork:zn-17 — tooltip 瞄准的是「离指针最近的那根 dash」。
     不能给 dash 挂 onMouseEnter：标记层整体 `pointer-events: none`，悬停位置由
     整条轨道的 mousemove + `findNearestNode` 算出来（见上面 onMouseMove）。
     所以复用同一个 `nearestNode`，不另开一套命中逻辑。

     只在**预览面板已钉住**时显示：面板没钉住时，悬停轨道本身就会弹出大纲面板，
     那种情况下再叠一个 tooltip 是两块内容互相盖。钉住后指针落在面板上，
     `minimapHovered` 仍为真，这时 tooltip 才回答「这几根 dash 分别是哪一回合」。 */
  const tooltipTurn = previewPinned && minimapHovered && nearestNode
    ? nearestNode.targetTurn
    : null;


  useEffect(() => {
    if (!minimapHovered || nearestNodeIndex === null) return;
    const previewBox = previewBoxRef.current;
    const previewItem = previewItemRefs.current.get(nearestNodeIndex);
    if (!previewBox || !previewItem) return;
    const targetTop = previewItem.offsetTop
      - (previewBox.clientHeight - previewItem.offsetHeight) / 2;
    previewBox.scrollTop = Math.max(0, targetTop);
  }, [allNodes, minimapHovered, nearestNodeIndex]);

  if (!visible) return null;

  return (
    <div
      ref={containerRef}
      className="pw-minimap-rail"
      onMouseDown={handleMouseDown}
      onMouseEnter={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const pointerY = event.clientY - rect.top;
        if (pointerY > getTriggerBottom()) return;
        showPreview();
        setMouseYRatio(Math.max(0, Math.min(1, pointerY / rect.height)));
      }}
      onMouseLeave={schedulePreviewHide}
      onMouseMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const pointerY = event.clientY - rect.top;
        if (!draggingRef.current && pointerY > getTriggerBottom()) {
          schedulePreviewHide();
          return;
        }
        if (!draggingRef.current) showPreview();
        setMouseYRatio(Math.max(0, Math.min(1, pointerY / rect.height)));
      }}
      style={{
        gridColumn: "2",
        gridRow: "1 / span 2",
        // Keep preview content above messages but beneath the composer.
        zIndex: 1,
        cursor: "pointer",
        userSelect: "none",
        overflow: "visible",
      }}
    >
      {/* fork:design-system SW-15 —— 悬停 tooltip 用通用工具卡（画板 22/53 的
          `.pw-card` + `.pw-card-head` + `.pw-card-body`）：头是角色 + 工具数徽章，
          体是这一轮的首段。定位仍挂在导轨坐标系里（top: topRatio%），
          `pointer-events: none` 是必需的，否则鼠标进卡就触发 mouseleave 闪烁。 */}
      {tooltipTurn && nearestNode && (() => {
        const node = nearestNode;
        const userText = getUserPreview(tooltipTurn.userMessage);
        const assistantText = tooltipTurn.assistantPreviews
          .map((preview) => preview.markdown)
          .join("\n\n")
          .trim();
        const isUser = userText.length > 0;
        const body = isUser ? userText : assistantText;
        if (!body) return null;
        return (
          <div
            className="pw-card"
            data-minimap-tooltip=""
            style={{
              position: "absolute",
              left: 34,
              top: `calc(${node.topRatio * 100}% + ${MINIMAP_PADDING}px)`,
              zIndex: 3,
              transform: "translateY(-50%)",
              pointerEvents: "none",
            }}
          >
            <div className="pw-card-head">
              <span className="pw-ico">
                <i data-ico={isUser ? "message-square" : "bot"} data-size="14"></i>
              </span>
              <span className="pw-tool">
                {t(isUser ? "chatMinimap.userMessage" : "chatMinimap.assistantReply")}
              </span>
              <span className="grow" style={{ flex: 1 }} />
              {tooltipTurn.toolCount > 0 && (
                <span
                  className="pw-badge count"
                  role="img"
                  title={t("chatMinimap.toolCalls", { count: tooltipTurn.toolCount })}
                  aria-label={t("chatMinimap.toolCalls", { count: tooltipTurn.toolCount })}
                >
                  {tooltipTurn.toolCount > 99 ? "99+" : tooltipTurn.toolCount}
                </span>
              )}
            </div>
            <div className="pw-card-body" data-minimap-tooltip-text="">{body}</div>
          </div>
        );
      })()}

      {/* 导轨节点：6px 圆点，当前 8px 转 accent（`.node.on`），标题轮走 muted
          （`.node.heading`）。kind 由 `deriveTurnNodeKind` 纯前端派生。 */}
      {positionedNodes.map((node) => (
        <span
          key={node.index}
          className={`node${node.kind === "heading" ? " heading" : ""}${activeIndex === node.index ? " on" : ""}`}
          data-minimap-node-index={node.index}
          data-minimap-node-kind={node.kind}
          data-minimap-node-active={activeIndex === node.index ? "" : undefined}
          style={{ top: `${node.topRatio * 100}%` }}
        />
      ))}

      {/* 320px 时间线浮层：图钉头 + 列表（加载更早 + 逐轮编号列/内容列）。 */}
      {minimapHovered && (allNodes.length > 0 || hasEarlierMessages) && (
        <div
          className="pw-minimap-pop"
          data-minimap-preview-box=""
          data-pinned={previewPinned || undefined}
          onMouseEnter={showPreview}
          onMouseDown={(event) => event.stopPropagation()}
          onMouseMove={(event) => event.stopPropagation()}
        >
          {/* 固定态只把图钉图标转 accent + 下边线染一档（画板 53 `.pin.on`），
              整条铺底色会盖过内容。 */}
          <button
            type="button"
            className={`pin${previewPinned ? " on" : ""}`}
            aria-pressed={previewPinned}
            aria-label={t(previewPinned ? "chatMinimap.unpinPreview" : "chatMinimap.pinPreview")}
            title={t(previewPinned ? "chatMinimap.unpinPreview" : "chatMinimap.pinPreview")}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setPreviewPinned((pinned) => !pinned);
              showPreview();
            }}
          >
            <span className="pw-ico">
              <i data-ico={previewPinned ? "pin" : "pin-off"} data-size="14"></i>
            </span>
            <span className="grow" style={{ flex: 1 }}>
              {t(previewPinned ? "chatMinimap.unpinPreview" : "chatMinimap.pinPreview")}
            </span>
            <span className="pw-ico">
              <i data-ico="x" data-size="13"></i>
            </span>
          </button>
          <div ref={previewBoxRef} className="list" data-minimap-preview-list="">
            {hasEarlierMessages && (
              <button
                type="button"
                className="load-earlier"
                data-minimap-load-earlier=""
                disabled={loadingEarlier}
                onClick={() => { void onLoadEarlier(); }}
              >
                <span className="pw-ico" aria-hidden="true">
                  <i data-ico="arrow-up" data-size="13"></i>
                </span>
                <span>
                  {loadingEarlier ? t("i18n.loading") : t("chatMinimap.loadEarlier")}
                </span>
              </button>
            )}
            {allNodes.map((node) => {
              const isLocated = nearestNodeIndex === node.index;
              return (
                <div
                  key={node.index}
                  ref={(element) => {
                    if (element) previewItemRefs.current.set(node.index, element);
                    else previewItemRefs.current.delete(node.index);
                  }}
                  className={`turn${isLocated ? " on" : ""}`}
                  data-minimap-preview-index={node.index}
                  data-minimap-turn-kind={node.kind}
                  data-located={isLocated ? "true" : undefined}
                >
                  <span className="gutter">
                    <span className="no">
                      {String(node.index + 1).padStart(2, "0")}
                      {node.targetTurn.toolCount > 0 && (
                        <span
                          className="tool"
                          role="img"
                          title={t("chatMinimap.toolCalls", { count: node.targetTurn.toolCount })}
                          aria-label={t("chatMinimap.toolCalls", { count: node.targetTurn.toolCount })}
                        >
                          {node.targetTurn.toolCount > 99 ? "99+" : node.targetTurn.toolCount}
                        </span>
                      )}
                    </span>
                    {node.targetTurn.assistantPreviews.length > 0 && (
                      <button
                        type="button"
                        className="no anchor"
                        data-minimap-preview-assistant={`${node.index}-0`}
                        onClick={() => scrollToAssistant(node, 0)}
                        aria-label={t("chatMinimap.locateAssistant")}
                        title={t("chatMinimap.locateAssistant")}
                      >
                        A
                      </button>
                    )}
                  </span>
                  <span className="body">
                    <button
                      type="button"
                      className="u"
                      data-minimap-preview-user={node.index}
                      onClick={() => {
                        scrollToNode(node, "smooth");
                      }}
                    >
                      {getUserPreview(node.targetTurn.userMessage)}
                    </button>

                    {node.targetTurn.assistantPreviews.map((assistant, assistantIndex) => (
                      <span
                        key={assistantIndex}
                        className="a"
                        data-minimap-answer-index={assistantIndex}
                      >
                        <AssistantOutline
                          markdown={assistant.markdown}
                          onAnswerClick={() => scrollToAssistant(node, assistantIndex)}
                          onHeadingClick={(headingIndex) => (
                            scrollToHeading(node, assistantIndex, headingIndex)
                          )}
                        />
                      </span>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Hook to create a stable array of refs for messages
export function useMessageRefs(count: number): RefObject<(HTMLDivElement | null)[]> {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  refs.current = Array(count).fill(null).map((_, i) => refs.current[i] ?? null);
  return refs;
}
