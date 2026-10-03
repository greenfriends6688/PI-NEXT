"use client";

import { useCallback, useRef } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useSessionFlags } from "@/lib/session-flags";
import { useContextMenu, type ContextMenuEntry } from "../ContextMenu";

/**
 * fork:trace-menu —— 顶栏的会话动作 ⋯ 菜单（借鉴 ZCode 的任务菜单，
 * docs/trace-pane-and-session-menu-plan-2026-10-02.md §4.2）。顺序照那张图分组：
 * 置顶 / 重命名 / 归档 / 标记未读 ‖ 在访达打开 / 复制路径 / 复制会话文件路径 /
 * 复制会话 ID / 前往配置 ‖ 系统提示词 / 工具定义 / 调用轨迹 ‖ 导出 HTML / 导出 Markdown。
 *
 * 这个组件**只负责摆条目**，动作都在 props 里：复制/导出/打开面板都带可见结果或
 * 可见失败（AppShell 侧那条 `.pw-toast`），菜单自己不吞异常。
 *
 * 菜单本体用既有的 `ContextMenuProvider`（不是再画一个下拉）：键盘导航、
 * 越界翻转、复制后的 `feedbackLabel` 都是它的既有行为。
 */

export interface SessionActionsTarget {
  id: string;
  /** 会话文件绝对路径（`SessionInfo.path`）。 */
  path?: string | null;
  cwd: string;
  projectRoot?: string | null;
}

export function SessionActionsMenu({
  session,
  onExportHtml,
  onExportMarkdown,
  onRename,
  onMarkUnread,
  onReveal,
  onCopyProjectPath,
  onCopySessionFilePath,
  onCopySessionId,
  onOpenSettings,
  onViewSystemPrompt,
  onViewTools,
  onViewTrace,
  mobile = false,
}: {
  session: SessionActionsTarget | null;
  onExportHtml: () => void;
  onExportMarkdown: () => void;
  onRename: () => void;
  onMarkUnread: () => void;
  /** 在文件管理器里打开项目目录；失败由调用方弹通知。 */
  onReveal: () => void;
  onCopyProjectPath: () => void;
  onCopySessionFilePath: () => void;
  onCopySessionId: () => void;
  onOpenSettings: () => void;
  /** 打开「系统提示词」「工具定义」两个只读面板，trigger 是定位锚点（⋯ 按钮）。 */
  onViewSystemPrompt: (trigger: HTMLElement) => void;
  onViewTools: (trigger: HTMLElement) => void;
  onViewTrace: () => void;
  mobile?: boolean;
}) {
  const { t } = useI18n();
  const { openMenu } = useContextMenu();
  const { flags, pin, archive } = useSessionFlags();
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const handleOpen = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    if (!session) return;
    buttonRef.current = event.currentTarget;
    // 菜单右缘大致贴着触发钮右缘（ContextMenu 自己会在视口边缘翻转）。
    const rect = event.currentTarget.getBoundingClientRect();
    const isPinned = flags.pinned.includes(session.id);
    const isArchived = flags.archived.includes(session.id);
    const projectDir = session.projectRoot ?? session.cwd;

    const entries: ContextMenuEntry[] = [
      {
        label: t(isPinned ? "session.unpin" : "session.pin"),
        icon: <span className="pw-ico"><i data-ico={isPinned ? "pin-off" : "pin"} data-size="14" aria-hidden="true"></i></span>,
        onSelect: () => pin(session.id),
      },
      {
        label: t("session.rename"),
        icon: <span className="pw-ico"><i data-ico="square-pen" data-size="14" aria-hidden="true"></i></span>,
        onSelect: onRename,
      },
      {
        label: t(isArchived ? "session.unarchive" : "session.archive"),
        icon: <span className="pw-ico"><i data-ico={isArchived ? "archive-restore" : "archive"} data-size="14" aria-hidden="true"></i></span>,
        onSelect: () => archive(session.id),
      },
      {
        label: t("session.markUnread"),
        icon: <span className="pw-ico"><i data-ico="message-circle" data-size="14" aria-hidden="true"></i></span>,
        onSelect: onMarkUnread,
      },
      { type: "separator" },
      {
        label: t("session.openInFileManager"),
        disabled: !projectDir,
        icon: <span className="pw-ico"><i data-ico="folder-open" data-size="14" aria-hidden="true"></i></span>,
        onSelect: onReveal,
      },
      {
        label: t("session.copyPath"),
        disabled: !projectDir,
        feedbackLabel: t("session.copied"),
        icon: <span className="pw-ico"><i data-ico="folder" data-size="14" aria-hidden="true"></i></span>,
        onSelect: () => { onCopyProjectPath(); },
      },
      {
        label: t("session.copyTaskPath"),
        disabled: !session.path,
        feedbackLabel: t("session.copied"),
        icon: <span className="pw-ico"><i data-ico="file-text" data-size="14" aria-hidden="true"></i></span>,
        onSelect: () => { onCopySessionFilePath(); },
      },
      {
        label: t("session.copyId"),
        feedbackLabel: t("session.copied"),
        icon: <span className="pw-ico"><i data-ico="hash" data-size="14" aria-hidden="true"></i></span>,
        onSelect: () => { onCopySessionId(); },
      },
      {
        label: t("session.openSettings"),
        icon: <span className="pw-ico"><i data-ico="settings" data-size="14" aria-hidden="true"></i></span>,
        onSelect: onOpenSettings,
      },
      { type: "separator" },
      {
        // fork:trace-menu-2026-10-02 —— 这两枚原来常驻顶栏，现在从 ⋯ 进（低频只读诊断）。
        label: t("system.prompt"),
        icon: <span className="pw-ico"><i data-ico="file-text" data-size="14" aria-hidden="true"></i></span>,
        onSelect: () => { if (buttonRef.current) onViewSystemPrompt(buttonRef.current); },
      },
      {
        label: t("tools.title"),
        icon: <span className="pw-ico"><i data-ico="wrench" data-size="14" aria-hidden="true"></i></span>,
        onSelect: () => { if (buttonRef.current) onViewTools(buttonRef.current); },
      },
      {
        label: t("trace.title"),
        icon: <span className="pw-ico"><i data-ico="activity" data-size="14" aria-hidden="true"></i></span>,
        onSelect: onViewTrace,
      },
      { type: "separator" },
      {
        label: t("session.exportHtml"),
        icon: <span className="pw-ico"><i data-ico="download" data-size="14" aria-hidden="true"></i></span>,
        onSelect: onExportHtml,
      },
      {
        label: t("session.exportMarkdown"),
        icon: <span className="pw-ico"><i data-ico="download" data-size="14" aria-hidden="true"></i></span>,
        onSelect: onExportMarkdown,
      },
    ];

    openMenu(Math.max(8, rect.right - 200), rect.bottom, entries);
  }, [archive, flags, onCopyProjectPath, onCopySessionFilePath, onCopySessionId, onExportHtml, onExportMarkdown, onMarkUnread, onOpenSettings, onRename, onReveal, onViewSystemPrompt, onViewTools, onViewTrace, openMenu, pin, session, t]);

  if (!session) return null;

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={handleOpen}
      title={t("session.actions")}
      aria-label={t("session.actions")}
      /* fork:design-components —— 画板 .pw-iconbtn / .pw-touch；data-ico=ellipsis。 */
      style={{ alignSelf: "center", margin: 0, color: "var(--text-muted)" }}
      className={mobile ? "pw-touch" : "pw-iconbtn"}
    >
      <span className="pw-ico"><i data-ico="ellipsis" data-size="14" aria-hidden="true"></i></span>
    </button>
  );
}