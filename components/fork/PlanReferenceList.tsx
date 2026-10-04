"use client";

import { useMemo } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { findPlanDocumentReferences, type PlanDocumentReference } from "@/lib/plan-documents";
import { PlanDocumentCard, type PlanDocumentOpenHandler } from "./PlanDocumentCard";

/*
 * fork:pr52-plan-tools —— 「从消息引用计划」：正文里提到某个计划文件 → 一排可点的卡片。
 *
 * 为什么需要它：`write_plan` 之后，模型会在**下一条**消息里说「计划写在 .pi/plans/xxx.md」，
 * 用户也会在提问时直接粘一个计划路径。没有这一层，那个路径就是一行死文本 ——
 * 要么用户手抄到文件预览器，要么（更糟）模型下一轮又去搜一遍。
 *
 * 认路径的规则全在 `lib/plan-documents.ts:findPlanDocumentReferences`（纯函数，有单测）：
 * 只认 `.pi/plans/*.md`，不认 URL，不粘句末标点，相对路径必须有 `cwd` 才解析。
 * 组件这一侧**不做任何路径校验** —— 能不能打开由服务端的 allowed roots 说了算，
 * 点开一个被拒的路径就是 FileViewer 自己报 403，浏览器这边不猜。
 *
 * 宿主接线（本 PR 不动共享组件）：
 * · agent 写的计划 —— `MessageView` 的工具卡读 `result.details`（`isPlanToolDetails`），
 *   或在卡头加一个 `.d-iconbtn` 跳转钮（与子代理卡的 `external-link` 同一位置）；
 * · 任意消息正文 —— 在 `MessageView` / `MarkdownBody` 之下挂这个组件，
 *   `onOpenFile` 传宿主既有的打开回调（AppShell 的 `handleOpenFile(filePath, fileName)`）。
 */

export interface PlanReferenceListProps {
  /** 消息正文（markdown 原文即可，路径识别是纯文本扫描）。 */
  text: string;
  /** 会话 cwd：相对路径（`.pi/plans/x.md`）只有给了它才解析得出来。 */
  cwd?: string;
  onOpenFile?: PlanDocumentOpenHandler;
}

export function PlanReferenceList({ text, cwd, onOpenFile }: PlanReferenceListProps) {
  const { t } = useI18n();
  const mobile = useIsMobile();
  const references = useMemo<PlanDocumentReference[]>(
    () => findPlanDocumentReferences(text, cwd ? { cwd } : {}),
    [text, cwd],
  );

  if (references.length === 0) return null;

  // fork:v5-landing Wave B · M-05：窄屏上那排卡片是 `.m-storecard` 纵列
  // （一张卡 = 一份计划），语义（role="group" + aria-label）两端一致。
  if (mobile) {
    return (
      <div role="group" aria-label={t("chat.planReferences")}>
        {references.map((reference) => (
          <PlanDocumentCard key={reference.filePath} plan={reference} onOpenFile={onOpenFile} />
        ))}
      </div>
    );
  }

  return (
    <div role="group" aria-label={t("chat.planReferences")} className="d-col" style={{ gap: "var(--nx-sp-2)" }}>
      {references.map((reference) => (
        <PlanDocumentCard key={reference.filePath} plan={reference} onOpenFile={onOpenFile} />
      ))}
    </div>
  );
}