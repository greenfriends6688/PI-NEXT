"use client";

import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import type { PlanDocumentReference } from "@/lib/plan-documents";

/*
 * fork:pr52-plan-tools —— 计划文档卡片（消息流里那张「可点的计划」）。
 *
 * DOM 原样取自 v5 画板 **D-25 帧 A** 的计划卡 `.d-plan`（`.d-plan-head` 图标 + 标题 + 徽章；
 * `.d-plan-foot` 等宽路径 + 右侧 `预览` 钮）：计划文档是**文件**，它的预览就该走文件预览器，
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
  const mobile = useIsMobile();
  const label = t("chat.planOpen");

  // fork:v5-landing Wave B · M-05 · 窄屏：计划卡 = `.m-storecard`
  // （图标块 + 标题 + 徽章 + 路径 + 预览钮）。零内联几何、零新类名。
  if (mobile) {
    return (
      <div className="m-storecard">
        <div className="m-store-cover">
          <i data-ico="file-text" data-size="20" aria-hidden="true" />
        </div>
        <span className="m-t-lg m-t-b">{plan.title ?? plan.fileName}</span>
        <span className="m-t-xs m-t-dim">{plan.relativePath}</span>
        <div className="m-hist-row">
          {plan.title ? <span className="m-badge mute">{plan.fileName}</span> : null}
          <span className="m-grow" />
          <button
            type="button"
            className="m-btn sm"
            disabled={!onOpenFile}
            onClick={() => onOpenFile?.(plan.filePath, plan.fileName)}
            title={`${label} · ${plan.filePath}`}
            aria-label={label}
          >
            <i data-ico="eye" data-size="13" aria-hidden="true" />
            {t("chat.planPreview")}
          </button>
        </div>
      </div>
    );
  }

  return (
    // fork:v5-landing —— 结构 = v5 画板 **D-25 帧 A** 的 `.d-plan`（计划卡）：
    // `.d-plan-head`（图标 + 标题 + 徽章）+ `.d-plan-foot`（等宽 meta + 预览钮）。
    // 计划文档卡没有分步进度，所以只用 head/foot 两段；类名与嵌套照画板原文。
    <div className="d-plan">
      <div className="d-plan-head">
        <i data-ico="file-text" data-size="15" aria-hidden="true"></i>
        <span className="d-grow">{plan.title ?? plan.fileName}</span>
        {plan.title ? <span className="d-badge mute">{plan.fileName}</span> : null}
      </div>
      <div className="d-plan-foot">
        <span className="d-plan-meta d-mono">{plan.relativePath}</span>
        {/* fork:v5-boards D-25 帧 A —— 底栏除路径外还写一行元信息（板上是「已用 41 分钟 /
            工具调用 128 次」这类）。计划文档这边能如实给的只有**落盘日期**，
            宿主（MessageView 的工具卡）已经把 `updatedAt` 递进来了，之前没人用。
            写 ISO 日期（`2026-10-02`）而不是「3 天前」：相对时间要 locale 与词表，
            而日期在三语里都是同一串数字 —— 不为一行 meta 新造一套本地化词汇。
            正文里的步进轨道 / 时间线需要计划**步骤**数据（产品那条是 todo 扩展，
            见 lib/plan-documents.ts 头注「不合并」），不在这里凭空造。 */}
        {plan.updatedAt ? <span className="d-plan-meta d-mono">{plan.updatedAt.slice(0, 10)}</span> : null}
        <span className="d-grow" />
        <button
          type="button"
          className="d-btn sm"
          disabled={!onOpenFile}
          onClick={() => onOpenFile?.(plan.filePath, plan.fileName)}
          title={`${label} · ${plan.filePath}`}
          aria-label={label}
        >
          <i data-ico="eye" data-size="13" aria-hidden="true"></i>
          {t("chat.planPreview")}
        </button>
      </div>
    </div>
  );
}