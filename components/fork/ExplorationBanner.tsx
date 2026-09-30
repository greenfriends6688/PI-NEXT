"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getDraft, setDraft } from "@/lib/draft-store";
import {
  deriveExplorationOrigin,
  explorationDelta,
  planBringBack,
  type ExplorationMessageLike,
} from "@/lib/exploration";

/**
 * fork:proma-05-explore — 探索分支的抬头条。
 *
 * 当前会话是「从某条主线消息 fork 出来的分支」时显示：来源那条消息 + 一个「带回结论」。
 *
 * - **来源不靠元数据**：父子 entry id 的公共前缀就是被复制过来那段历史（见
 *   `lib/exploration.ts` 的说明），所以这里只需要拉父会话的 context 比一下。
 * - **带回结论只写草稿、不自动发送**：把 fork 点之后的 assistant 文本追加到父会话草稿，
 *   并带上一条 `&session:<分支 id>` 引用，然后切到父会话让用户自己决定发不发。
 * - 拉不到父会话 / 推不出来源时**什么都不显示**：宁可不显示，也不要给一个假来源。
 */
export function ExplorationBanner({
  branchSessionId,
  parentSessionId,
  branchEntryIds,
  branchMessages,
  onOpenParent,
  onOpenPane,
}: {
  branchSessionId: string;
  parentSessionId: string;
  branchEntryIds: readonly string[];
  branchMessages: readonly ExplorationMessageLike[];
  onOpenParent?: (sessionId: string) => void;
  /** 有右栏面板时传进来：在右栏开一个只读 tab，与主线并排看（可选）。 */
  onOpenPane?: () => void;
}) {
  const { t } = useI18n();
  const [parent, setParent] = useState<{ entryIds: string[]; messages: ExplorationMessageLike[] } | null>(null);
  const [broughtBack, setBroughtBack] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(parentSessionId)}/context`);
        if (!res.ok) return;
        const data = await res.json() as { context?: { messages?: ExplorationMessageLike[]; entryIds?: string[] } };
        if (cancelled || !data.context?.entryIds) return;
        setParent({ entryIds: data.context.entryIds, messages: data.context.messages ?? [] });
      } catch {
        // 父会话读不到就当不是探索分支（不显示比显示错好）
      }
    })();
    return () => { cancelled = true; };
  }, [parentSessionId]);

  const origin = useMemo(() => (parent
    ? deriveExplorationOrigin({
      parentSessionId,
      parentEntryIds: parent.entryIds,
      parentMessages: parent.messages,
      branchEntryIds,
    })
    : null), [parent, parentSessionId, branchEntryIds]);

  const delta = useMemo(() => explorationDelta({
    branchEntryIds,
    branchMessages,
    boundaryEntryId: origin?.boundaryEntryId ?? null,
  }), [branchEntryIds, branchMessages, origin?.boundaryEntryId]);

  if (!origin) return null;

  const canBringBack = delta.assistantMessages > 0;
  const sourceLabel = origin.sourceLabel || t("explore.fromStart");

  const handleBringBack = () => {
    const existing = getDraft(parentSessionId);
    const plan = planBringBack({ delta, branch: { id: branchSessionId }, existingText: existing?.value });
    if (!plan) return;
    setDraft(parentSessionId, {
      value: plan.value,
      images: existing?.images ?? [],
      ...(existing?.contexts ? { contexts: existing.contexts } : {}),
      sessionReferences: [
        ...(existing?.sessionReferences ?? []).filter((reference) => reference.id !== plan.sessionReference.id),
        plan.sessionReference,
      ],
    });
    setBroughtBack(true);
    onOpenParent?.(parentSessionId);
  };

  return (
    /* fork:design-components —— 画板 54 的探索抬头条：一行 `.pw-inline`（图标 + `.pw-strong`
       标题 + `.pw-dim` 来源 + grow + 状态文案 + 两个 `.pw-btn.outline.sm` + 一个
       `.pw-btn.primary.sm`）。旧的内联边框/底色/圆角由 board.css 承担。 */
    <div
      role="status"
      className="pw-inline"
      style={{ flexWrap: "wrap", gap: "var(--s2)", margin: "0 0 10px" }}
    >
      <span className="pw-ico" style={{ color: "var(--accent-text)" }} aria-hidden="true">
        <i data-ico="git-fork" data-size="14"></i>
      </span>
      <b className="pw-strong">{t("explore.title")}</b>
      <span className="pw-dim" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 420 }}>
        {t("explore.from", { label: sourceLabel })}
      </span>
      <span className="grow" />
      {broughtBack && <span className="pw-dim">{t("explore.broughtBack")}</span>}
      {!broughtBack && !canBringBack && <span className="pw-dim">{t("explore.nothingYet")}</span>}
      {onOpenPane && (
        <button
          type="button"
          className="pw-btn outline sm"
          onClick={onOpenPane}
          title={t("explore.openPane")}
        >
          {t("explore.openPane")}
        </button>
      )}
      {onOpenParent && (
        <button
          type="button"
          className="pw-btn outline sm"
          onClick={() => onOpenParent(parentSessionId)}
          title={t("explore.openParent")}
        >
          {t("explore.openParent")}
        </button>
      )}
      <button
        type="button"
        /* 不可带回时退成 `.pw-btn.outline`（画板的中性描边形态），语义仍在 disabled 上。 */
        className={`pw-btn sm ${canBringBack ? "primary" : "outline"}`}
        onClick={handleBringBack}
        disabled={!canBringBack}
        title={t("explore.bringBackHint")}
      >
        {t("explore.bringBack")}
      </button>
    </div>
  );
}
