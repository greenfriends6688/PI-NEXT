"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { AgentMessage, ToolResultMessage } from "@/lib/types";
import { MessageView } from "../MessageView";
import { ExplorationBanner } from "./ExplorationBanner";

/**
 * fork:proma-05-explore — 右栏的探索分支视图（只读）。
 *
 * 规格要的是「分支在右栏以独立 tab 打开、可与主线并排看」。这里刻意**不做**第二个可交互
 * 的聊天面板：那要把 ChatWindow 的全套接线（SSE、composer、模型选择……）在右栏再搭一遍，
 * 成本高且容易和主线状态打架。要做到的是「边看主线边看分支、看完就带回」：
 *
 * - 只读渲染分支转录（复用主线同款 `MessageView`，所以工具卡/排版一致）；
 * - 抬头条也在这里（所以**不用离开主线**就能把结论带回父会话草稿）；
 * - 想接着聊就「在主线打开」，走既有的 ?session= 路由。
 */
export function ExplorationPane({
  sessionId,
  parentSessionId,
  onOpenAsMain,
}: {
  sessionId: string;
  /** 已知父会话时传进来：抬头条要它来推「从哪条消息探索来的」。 */
  parentSessionId?: string | null;
  onOpenAsMain?: (sessionId: string) => void;
}) {
  const { t } = useI18n();
  const [context, setContext] = useState<{ messages: AgentMessage[]; entryIds: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContext(null);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/context`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { context?: { messages?: AgentMessage[]; entryIds?: string[] } };
        if (cancelled) return;
        setContext({ messages: data.context?.messages ?? [], entryIds: data.context?.entryIds ?? [] });
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const toolResults = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const message of context?.messages ?? []) {
      if (message.role === "toolResult") {
        map.set((message as ToolResultMessage).toolCallId, message as ToolResultMessage);
      }
    }
    return map;
  }, [context]);

  return (
    /* fork:design-components —— 右栏探索视图 = 画板 D-03e 帧 D 的只读并排面板：
       `.d-panel`（列向 + 左边线）+ `.d-panel-head`（git-fork + 标题 + `.d-badge.mute` 只读 +
       `.d-btn.sm` 在主线打开）+ `.d-panel-body`（滚动正文）。
       加载/错误态分别是 `.d-banner.info` / `.d-banner.err`，转录容器是 `.d-col`。 */
    <div className="d-panel" style={{ height: "100%", minWidth: 0, width: "100%", flex: "1 1 auto" }}>
      <div className="d-panel-head">
        <i data-ico="git-fork" data-size="14" aria-hidden="true"></i>
        <span className="d-t-b">{t("explore.title")}</span>
        <span className="d-badge mute">{t("chat.toolPreset.read-only")}</span>
        <span className="d-grow" />
        {onOpenAsMain && (
          <button
            type="button"
            className="d-btn sm"
            onClick={() => onOpenAsMain(sessionId)}
            title={t("explore.openInMain")}
          >
            {t("explore.openInMain")}
          </button>
        )}
      </div>

      {/* fork:v5-wave-n1 —— 面板体换成画板 D-03e 帧 D 那一段的 `.d-drawer-body`
          （flex:1 + min-height:0 + overflow-y:auto —— 就是板上写在抽屉里的滚动体，
          内边距由板上的行内 padding 给）。**根节点仍是 `.d-panel` 不换**：
          板上那枚 `.d-drawer` 是 `position:absolute; width:360px; transform:translateX(100%)`
          的覆盖式抽屉，而产品这一格是右栏 tab 的 flex 子项（右栏容器内的一个槽位），
          换过去会把整块抽离布局；宿主形态的差异已登记，见汇报。 */}
      <div className="d-drawer-body" style={{ padding: "var(--nx-sp-3)" }}>
        {error && (
          <div role="alert" className="d-banner err">
            <i data-ico="circle-alert" data-size="14" aria-hidden="true"></i>
            <span className="d-grow">{t("explore.paneFailed")}：{error}</span>
          </div>
        )}
        {!error && context === null && (
          <div className="d-banner info">
            <i data-ico="info" data-size="14" aria-hidden="true"></i>
            <span className="d-grow">{t("i18n.loading")}</span>
          </div>
        )}

        {context && (
          <div className="d-col" style={{ gap: "var(--nx-sp-3)", minWidth: 0 }}>
            {parentSessionId && (
              <ExplorationBanner
                branchSessionId={sessionId}
                parentSessionId={parentSessionId}
                branchEntryIds={context.entryIds}
                branchMessages={context.messages}
                onOpenParent={onOpenAsMain}
              />
            )}
            <div style={{ minWidth: 0 }}>
              {context.messages.map((message, index) => (
                <MessageView
                  key={context.entryIds[index] ?? index}
                  message={message}
                  toolResults={toolResults}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
