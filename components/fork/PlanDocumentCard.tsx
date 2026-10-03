"use client";

import { useI18n } from "@/hooks/useI18n";
import type { PlanDocumentReference } from "@/lib/plan-documents";

/*
 * fork:pr52-plan-tools —— 计划文档卡片（消息流里那张「可点的计划」）。
 *
 * DOM 原样取自画板 54 B「附件预览」那一行的 `.pw-filecard`（file-text 图标 + 文件名 + 等宽
 * 相对路径 + 右侧 `预览` 钮）：计划文档是**文件**，它的预览就该走文件预览器，
 * 所以这里**不自写预览器** —— 点一下把绝对路径交给宿主已有的 `onOpenFile`
 * （AppShell 的 `handleOpenFile` → `openFileTab` → FileViewer），和文件树里点一个文件完全同一条路。
 *
 * 为什么它值得有一张卡：计划文档落盘之后，聊天里那一句「计划写在 xxx」如果只是一行纯文本，
 * 用户就得手抄路径去别处找。「计划模式给编号列表」与「计划文档给人读」之间缺的就是这一跳。
 *
 * 刻意**没有**做的事：不预览内容（那是 FileViewer 的活）、不提供编辑（改计划走会话里的
 * `write_plan`，界面改动会绕过会话记录）、不新增任何类名（判据⑦）。
 */

export type PlanDocumentOpenHandler = (filePath: string, fileName: string) => void;

export function PlanDocumentCard({
  plan,
  onOpenFile,
}: {
  plan: PlanDocumentReference;
  /** 宿主的打开回调；不传就只显示路径，按钮禁用（没有第二条预览通道）。 */
  onOpenFile?: PlanDocumentOpenHandler;
}) {
  const { t } = useI18n();
  const label = t("chat.planOpen");

  return (
    // fork:design-components —— 结构 = 画板 54 B 的 `.pw-filecard`，一个字没改：
    // 图标 / 文件名 / 等宽 meta / grow / `预览` 钮。组件只接数据与事件。
    <div className="pw-filecard">
      <span className="pw-ico" style={{ color: "var(--accent-text)" }}>
        <i data-ico="file-text" data-size="14" aria-hidden="true"></i>
      </span>
      <span className="pw-fname">{plan.fileName}</span>
      <span className="pw-meta">{plan.relativePath}</span>
      <span className="grow" />
      <button
        type="button"
        className="pw-btn sm"
        disabled={!onOpenFile}
        onClick={() => onOpenFile?.(plan.filePath, plan.fileName)}
        title={`${label} · ${plan.filePath}`}
        aria-label={label}
      >
        <span className="pw-ico"><i data-ico="eye" data-size="13" aria-hidden="true"></i></span>
        {t("chat.planPreview")}
      </button>
    </div>
  );
}