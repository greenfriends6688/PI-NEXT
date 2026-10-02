"use client";

import { useCallback } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { useSessionFlags } from "@/lib/session-flags";
import { useContextMenu, type ContextMenuEntry } from "../ContextMenu";

/**
 * fork:trace-menu —— 顶栏的会话动作 ⋯ 菜单（借鉴 ZCode 的任务菜单，
 * docs/trace-pane-and-session-menu-plan-2026-10-02.md §4.2）。顺序照那张图：
 * 置顶 / 重命名 / 归档 / 标记未读 ‖ 在访达打开 / 复制路径 / 复制任务路径 /
 * 复制会话 ID / 前往配置 ‖ 查看调用轨迹 ‖ 导出 HTML / 导出 Markdown。
 *
 * pi 没有的东西就不摆：ZCode 的「复制日志路径」「反馈问题」在 pi-web 没有对应物
 * （pi 不写会话日志，也没有反馈中心）。轨迹入口既在这里也在顶栏那枚图标钮上，
 * 两处是同一个动作。
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
  onOpenSettings,
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
  onOpenSettings: () => void;
  onViewTrace: () => void;
  mobile?: boolean;
}) {
  const { t } = useI18n();
  const { openMenu } = useContextMenu();
  const { flags, pin, archive } = useSessionFlags();

  const handleOpen = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!session) return;
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
        onSelect: async () => { await copyText(projectDir); },
      },
      {
        label: t("session.copyTaskPath"),
        disabled: !session.path,
        feedbackLabel: t("session.copied"),
        icon: <span className="pw-ico"><i data-ico="file-text" data-size="14" aria-hidden="true"></i></span>,
        onSelect: async () => { await copyText(session.path ?? ""); },
      },
      {
        label: t("session.copyId"),
        feedbackLabel: t("session.copied"),
        icon: <span className="pw-ico"><i data-ico="hash" data-size="14" aria-hidden="true"></i></span>,
        onSelect: async () => { await copyText(session.id); },
      },
      {
        label: t("session.openSettings"),
        icon: <span className="pw-ico"><i data-ico="settings" data-size="14" aria-hidden="true"></i></span>,
        onSelect: onOpenSettings,
      },
      { type: "separator" },
      {
        label: t("trace.title"),
        icon: <span className="pw-ico"><i data-ico="activity" data-size="14" aria-hidden="true"></i></span>,
        onSelect: onViewTrace,
      },
      {
        label: t("session.exportHtml"),
        icon: <span className="pw-ico"><i data-ico="globe" data-size="14" aria-hidden="true"></i></span>,
        onSelect: onExportHtml,
      },
      {
        label: t("session.exportMarkdown"),
        icon: <span className="pw-ico"><i data-ico="download" data-size="14" aria-hidden="true"></i></span>,
        onSelect: onExportMarkdown,
      },
    ];

    openMenu(Math.max(8, rect.right - 200), rect.bottom, entries);
  }, [archive, flags, onExportHtml, onExportMarkdown, onMarkUnread, onOpenSettings, onRename, onReveal, onViewTrace, openMenu, pin, session, t]);

  if (!session) return null;

  return (
    <button
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