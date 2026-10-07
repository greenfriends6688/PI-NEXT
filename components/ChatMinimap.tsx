"use client";

import { useEffect, useRef, useState, useCallback, useMemo, type RefObject } from "react";
import { isMessageGroupAnchor, splitFinalAssistantBlocks } from "@/lib/message-display";
import type { AgentMessage, AssistantMessage, CustomMessage, TextContent, UserMessage } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";


interface Props {
  messages: AgentMessage[];
  streamingMessage: Partial<AgentMessage> | null;
  scrollContainer: RefObject<HTMLDivElement | null>;
  messageRefs: RefObject<(HTMLDivElement | null)[]>;
  onRevealHistory: () => void;
}

/*
 * fork:v5-wave-b —— **本组件刻意不加 m-* 分支**（不是漏做）。
 *
 * 导轨（`.pw-minimap-rail` + `.d-navtick`）是**鼠标悬停**装置：算 `topRatio`、
 * 绑 mousemove/mousedown 拖拽、悬停出 `.d-navpop` 预览卡。PWA 的 M-01~M-12
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

/*
 * fork:v6-landing —— **导轨形态 = 画板 D-32 / D-33 帧 D**（2026-10-07 用户两轮实拍）。
 *
 * 第一轮（「V6 三件全落」）：刻度换成 `.d-navtick`，悬停卡换成 `.d-navpop`，
 * 容器几何仍归 `.pw-minimap-rail`（grid 第二列）。
 * 第二轮实拍又定两件：
 *   · 「这些横杆不是从顶部开始的，应该是上下居中」→ 刻度组垂直居中（见 `layoutNodes`）；
 *   · 「这个浮窗，你也没有按照设计的来」→ board 53 的 **320px 大纲面板**
 *     （`.pw-minimap-pop` / `.pin` / `.load-earlier` / `.turn` / `AssistantOutline`）
 *     整块退场，悬停就出画板的 `.d-navpop` 小卡。「加载更早」本来就有「滚到顶自动
 *     加载」兑底（ChatWindow 的 sentinel IntersectionObserver），大纲级跳转一并退场。
 *
 * 保留下来的行为：props、悬停与拖拽、`activeIndex` 定位锁、
 * `data-minimap-*` 钩子（e2e 与 `scripts/verify-against-boards.mjs` 都按这些属性选）。
 */

/** 导轨宽 36px 由 board.css 的 `.pw-minimap-rail` 给，产品侧不再写死。 */
/* fork:v6-landing —— 刻度间距 = 画板 D-32/D-33 帧 D 的 `.d-navrail` 节奏：
   `gap: var(--nx-sp-2)`（8px）+ 刻度高 2px ⇒ 中心距 10px。用户 2026-10-07 实拍
   「这些间距不对啊…太宽了」—— 旧值 50px 把几轮会话铺满整条轨道。
   命中靠 `findNearestNode` 的取整，10px 相邻也选得中。 */
const MAX_NODE_GAP = 10;
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
 * fork:design-system SW-15 —— 导轨节点的语义分类（旧 `.node.heading` 那套；V6 刻度
 * 不再按 kind 换外观，它只落在 `data-minimap-node-kind` 上供 e2e / 排查用）。
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
  /* fork:v6-landing —— 刻度组**垂直居中**（画板 D-32/D-33 帧 D 的 `.d-navrail` 就是
     `justify-content: center`）：原来从 `MINIMAP_PADDING` 起往下排，几轮会话时整组
     贴在轨道顶部（用户 2026-10-07 实拍「这些横杆不是从顶部开始的，应该是最右侧的
     上下居中」）。组高超出可用高度时回落成贴顶（与旧行为一致）。 */
  if (allNodes.length === 1) {
    return {
      nodes: [{ ...allNodes[0], topRatio: 0.5 }],
      gap: MAX_NODE_GAP,
      fillsHeight: false,
    };
  }

  const naturalGap = usableHeight / (allNodes.length - 1);
  const gap = Math.min(MAX_NODE_GAP, naturalGap);
  const span = gap * (allNodes.length - 1);
  const start = Math.max(MINIMAP_PADDING, (height - span) / 2);
  return {
    nodes: allNodes.map((node, index) => ({
      ...node,
      topRatio: (start + index * gap) / height,
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
}: Props) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [allNodes, setAllNodes] = useState<NodeInfo[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [minimapHeight, setMinimapHeight] = useState(600);
  const [minimapHovered, setMinimapHovered] = useState(false);
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
  const previewHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeNodeLockRef = useRef<{ index: number; until: number } | null>(null);
  const pendingNavigationRef = useRef<{ nodeIndex: number } | null>(null);

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
        const targetTop: number | null = pendingNode.targetTurn.scrollTop;
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
      pendingNavigationRef.current = { nodeIndex: node.index };
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
    previewHideTimerRef.current = setTimeout(() => {
      previewHideTimerRef.current = null;
      setMinimapHovered(false);
      setMouseYRatio(null);
    }, PREVIEW_HIDE_DELAY);
  }, [cancelPreviewHide]);

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
  /* fork:v6-landing —— 悬停卡瞄准的是「离指针最近的那道刻度」。
     不能给刻度挂 onMouseEnter：标记层整体 `pointer-events: none`，悬停位置由
     整条轨道的 mousemove + `findNearestNode` 算出来（见上面 onMouseMove）。
     所以复用同一个 `nearestNode`，不另开一套命中逻辑。

     悬停就出卡（画板 D-32 的 `.d-navpop`），不再需要「先钉住」那个前置 ——
     320px 大纲面板整块退场（用户 2026-10-07 实拍「这个浮窗，你也没有按照设计
     的来」），它的「加载更早」本来就有滚动到顶自动加载兑底，大纲跳转一并退场。 */
  const tooltipTurn = minimapHovered && nearestNode
    ? nearestNode.targetTurn
    : null;

  if (!visible) return null;

  return (
    <div
      ref={containerRef}
      /* fork:v6-landing —— 容器挂上画板 D-32/D-33 帧 D 的 `.d-navrail`：刻度形态
         （`.d-navtick`）与悬停卡（`.d-navpop`）都是 V6 的，**容器几何仍归
         `.pw-minimap-rail`**（跨 grid 两行 / 宽 36 / 左边线，画板 53 那套布局）。
         双类覆盖（0-2-0）在 app/fork-ui.css，顶掉 `.d-navrail` 自带的 absolute。 */
      className="pw-minimap-rail d-navrail"
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
      {/* fork:v6-landing —— 悬停预览卡（画板 D-32 的 `.d-navpop`）：头行是
          角色 + 工具数，体是这一轮的首段。定位仍挂在导轨坐标系里（top: topRatio%），
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
            className="d-navpop"
            data-minimap-tooltip=""
            style={{
              position: "absolute",
              // 导轨在最右缘，卡片朝**左**展开（`right: 100% + 8px` = 贴导轨左缘）。
              right: "calc(100% + var(--nx-sp-2))",
              top: `calc(${node.topRatio * 100}% + ${MINIMAP_PADDING}px)`,
              zIndex: 3,
              transform: "translateY(-50%)",
              pointerEvents: "none",
            }}
          >
            <div className="d-navpop-t">
              <i data-ico={isUser ? "message-square" : "bot"} data-size="11" aria-hidden="true"></i>
              {/* 画板 D-32 的 `.d-navpop-t` 写的是「第 N 轮 · 你 / PI NEXT」，不是
                  「用户消息 / 助手回复」。 */}
              {t(isUser ? "chatMinimap.turnUser" : "chatMinimap.turnAssistant", { index: node.index + 1 })}
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
            <div data-minimap-tooltip-text="">{body}</div>
          </div>
        );
      })()}

      {/* fork:v6-landing —— 导轨刻度：画板 D-32/D-33 帧 D 的 `.d-navtick`（beUI
          preview-rail）：细刻度按「与当前轮的关系」分三档 —— 过去（done，长）、
          当前（now，中）、未来（far，短），取代 board 53 的 6px 圆点。
          `kind`（`deriveTurnNodeKind` 纯前端派生）仍照旧落在 `data-minimap-node-kind`
          上，只是不再影响刻度外观（标题轮与普通回答轮用同一档长度）。
          fix:minimap-hover —— 「指针最近的那一颗」照旧挂 data 属性，悬停时变色，
          配合左侧浮层里对应轮的高亮，回答「我 hover 的是哪一轮」。
          （`data-minimap-*` 四个钩子与 0.1.8 一致：e2e / `scripts/verify-against-boards.mjs`
          都按它们选元素，所以一个都不能少。） */}
      {positionedNodes.map((node) => (
        <span
          key={node.index}
          className={activeIndex === null
            ? "d-navtick far"
            : node.index === activeIndex
              ? "d-navtick now mid"
              : node.index < activeIndex
                ? "d-navtick done near"
                : "d-navtick far"}
          data-minimap-node-index={node.index}
          data-minimap-node-kind={node.kind}
          data-minimap-node-active={activeIndex === node.index ? "" : undefined}
          data-minimap-node-hover={minimapHovered && nearestNodeIndex === node.index ? "" : undefined}
          style={{ top: `${node.topRatio * 100}%` }}
        />
      ))}
    </div>
  );
}

// Hook to create a stable array of refs for messages
export function useMessageRefs(count: number): RefObject<(HTMLDivElement | null)[]> {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  refs.current = Array(count).fill(null).map((_, i) => refs.current[i] ?? null);
  return refs;
}
