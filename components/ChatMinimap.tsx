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

/*
 * fork:v5-wave-b —— **本组件刻意不加 m-* 分支**（不是漏做）。
 *
 * 导轨（`.d-minimap` + `.d-mm-node` + `.d-minimap-pop`）是画板 D-03e 的**鼠标悬停**
 * 装置：算 `topRatio`、绑 mousemove/mousedown 拖拽、悬停出浮层。PWA 的 M-01~M-12
 * 十二张板里**没有这一件**（手机的「回看更早 / 切分支」在 M-04 会话抽屉与 M-02
 * 输入卡上方的 `.m-pickbar` 分支条上，属于别的波次与别的文件）。
 *
 * 没有画板可抄就不抄 —— 硬套一枚 `m-*` 只会造出第二个视觉来源，正是 LANDING §0
 * 记的三次翻车。而且换掉 DOM 会连带改掉槽位计算（`getVisibleRenderWindow` 的
 * 虚拟列表锚点在这里读 `messageRefs`），违反「行为零变化」。
 *
 * 缺件登记：设计侧若要给手机一个转录导航，请先补画板（建议 M-02 追加一帧：
 * 顶部一条可横滑的回合刻度），产品再照抄。
 */

/** 导轨宽 36px 由 system.css 的 `.d-minimap` 给（画板 D-03e），产品侧不再写死。 */
const MAX_NODE_GAP = 50;
const MINIMAP_PADDING = 12;
const MINIMAP_TRIGGER_TAIL = 16;
const PREVIEW_HIDE_DELAY = 250;
const NAVIGATION_ACTIVE_LOCK_MS = 1600;
/** fix:minimap-hover —— 时间线浮层宽（画板 53：320），tooltip 要避让它的宽度。 */
const MINIMAP_POP_WIDTH = 320;

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
      className="d-t-xs d-t-b"
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
              className="d-t-xs d-t-faint"
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
      className="d-minimap"
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
      {/* fork:design-system SW-15 —— 悬停 tooltip 用通用卡片（画板 D-03e 的
          `.d-card` + `.d-card-head` + `.d-card-body`）：头是角色 + 工具数徽章，
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
            className="d-card"
            data-minimap-tooltip=""
            style={{
              position: "absolute",
              // fix:minimap-hover —— 导轨在最右缘，`left: 34`（导轨右侧）等于把卡片
              // 推到屏外、再被 `.chat-content` 的 overflow 裁掉。改成朝**左**展开，
              // 并且让开 320px 的时间线浮层 —— 卡片落在浮层左边，两者不叠加。
              right: `calc(100% + ${MINIMAP_POP_WIDTH + 8}px)`,
              top: `calc(${node.topRatio * 100}% + ${MINIMAP_PADDING}px)`,
              zIndex: 3,
              transform: "translateY(-50%)",
              pointerEvents: "none",
            }}
          >
            <div className="d-card-head">
              <i data-ico={isUser ? "message-square" : "bot"} data-size="14" aria-hidden="true"></i>
              <span className="d-t-sm d-t-b">
                {t(isUser ? "chatMinimap.userMessage" : "chatMinimap.assistantReply")}
              </span>
              <span className="d-grow" />
              {tooltipTurn.toolCount > 0 && (
                <span
                  className="d-badge mute"
                  role="img"
                  title={t("chatMinimap.toolCalls", { count: tooltipTurn.toolCount })}
                  aria-label={t("chatMinimap.toolCalls", { count: tooltipTurn.toolCount })}
                >
                  {tooltipTurn.toolCount > 99 ? "99+" : tooltipTurn.toolCount}
                </span>
              )}
            </div>
            <div className="d-card-body" data-minimap-tooltip-text="">{body}</div>
          </div>
        );
      })()}

      {/* 导轨节点：画板 D-03e 的 `.d-mm-node`（已完成 `.done` / 当前轮 `.now`）。
          kind 由 `deriveTurnNodeKind` 纯前端派生，仍挂在 data 属性上。
          `top` 是几何定位（产品按 topRatio 映射转录位置），不是设计值。 */}
      {positionedNodes.map((node) => {
        const isDone = activeIndex !== null && node.index < activeIndex;
        return (
          <span
            key={node.index}
            className={`d-mm-node${isDone ? " done" : ""}${activeIndex === node.index ? " now" : ""}`}
            data-minimap-node-index={node.index}
            data-minimap-node-kind={node.kind}
            data-minimap-node-active={activeIndex === node.index ? "" : undefined}
            data-minimap-node-hover={minimapHovered && nearestNodeIndex === node.index ? "" : undefined}
            style={{ position: "absolute", left: 0, right: 0, top: `${node.topRatio * 100}%` }}
          />
        );
      })}

      {/* 320px 时间线浮层（画板 D-03e 帧 A）：`.d-minimap-pop` 外壳 + `.d-row` 图钉头
          + `.d-tree` 列表（加载更早 + 逐轮编号列/内容列）。定位（锚在导轨左侧）
          是几何，走内联；板的排布由 system.css 的 `.d-minimap-pop` 承担。 */}
      {minimapHovered && (allNodes.length > 0 || hasEarlierMessages) && (
        <div
          className="d-minimap-pop"
          data-minimap-preview-box=""
          data-pinned={previewPinned || undefined}
          onMouseEnter={showPreview}
          onMouseDown={(event) => event.stopPropagation()}
          onMouseMove={(event) => event.stopPropagation()}
          style={{ position: "absolute", right: "100%", top: 0, maxHeight: "100%", zIndex: 3 }}
        >
          <div
            className="d-row"
            style={{ padding: "var(--nx-sp-2) var(--nx-sp-3)", borderBottom: "1px solid var(--nx-line)" }}
          >
            <button
              type="button"
              className={`d-iconbtn${previewPinned ? " is-on" : ""}`}
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
              <i data-ico={previewPinned ? "pin" : "pin-off"} data-size="13" aria-hidden="true"></i>
            </button>
            <span className="d-t-xs d-grow">
              {t(previewPinned ? "chatMinimap.unpinPreview" : "chatMinimap.pinPreview")}
            </span>
            <button
              type="button"
              className="d-iconbtn"
              title={t("i18n.close")}
              aria-label={t("i18n.close")}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setPreviewPinned(false);
                setMinimapHovered(false);
                setMouseYRatio(null);
              }}
            >
              <i data-ico="x" data-size="13" aria-hidden="true"></i>
            </button>
          </div>
          <div
            ref={previewBoxRef}
            className="d-tree"
            data-minimap-preview-list=""
            style={{ gap: 0, minHeight: 0, overflow: "hidden" }}
          >
            {hasEarlierMessages && (
              <button
                type="button"
                className="d-trow"
                data-minimap-load-earlier=""
                disabled={loadingEarlier}
                onClick={() => { void onLoadEarlier(); }}
                style={{
                  gridTemplateColumns: "34px minmax(0, 1fr)",
                  borderBottom: "1px solid var(--nx-line)",
                  borderRadius: 0,
                }}
              >
                <span style={{ textAlign: "center" }} aria-hidden="true">
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
                  className={`d-trow${isLocated ? " is-on" : ""}`}
                  data-minimap-preview-index={node.index}
                  data-minimap-turn-kind={node.kind}
                  data-located={isLocated ? "true" : undefined}
                  style={{
                    gridTemplateColumns: "34px minmax(0, 1fr)",
                    height: "auto",
                    padding: "var(--nx-sp-2) var(--nx-sp-2)",
                    alignItems: "flex-start",
                  }}
                >
                  <span className="d-col" style={{ alignItems: "center", gap: "var(--nx-sp-1)" }}>
                    <span className="d-mono d-t-xs d-t-faint" style={{ textAlign: "center" }}>
                      {String(node.index + 1).padStart(2, "0")}
                    </span>
                    {node.targetTurn.toolCount > 0 && (
                      <span
                        className="d-badge mute"
                        role="img"
                        title={t("chatMinimap.toolCalls", { count: node.targetTurn.toolCount })}
                        aria-label={t("chatMinimap.toolCalls", { count: node.targetTurn.toolCount })}
                      >
                        <i data-ico="wrench" data-size="10" aria-hidden="true"></i>
                        {node.targetTurn.toolCount > 99 ? "99+" : node.targetTurn.toolCount}
                      </span>
                    )}
                    {node.targetTurn.assistantPreviews.length > 0 && (
                      <button
                        type="button"
                        className="d-mono d-t-xs d-t-faint"
                        style={{ cursor: "pointer" }}
                        data-minimap-preview-assistant={`${node.index}-0`}
                        onClick={() => scrollToAssistant(node, 0)}
                        aria-label={t("chatMinimap.locateAssistant")}
                        title={t("chatMinimap.locateAssistant")}
                      >
                        A
                      </button>
                    )}
                  </span>
                  <span className="d-col" style={{ gap: "var(--nx-sp-1)", minWidth: 0 }}>
                    <button
                      type="button"
                      className="d-t-xs"
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
                        className="d-t-xs d-t-faint"
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
