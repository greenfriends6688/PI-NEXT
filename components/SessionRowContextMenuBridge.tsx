"use client";

import { useEffect } from "react";
import { useContextMenu } from "./ContextMenu";
import { useI18n } from "@/hooks/useI18n";
import { SESSION_ROW_CONTEXT_MENU_EVENT, type SessionRowContextMenuDetail } from "@/lib/session-row-context-menu";
import { getSessionFlags, toggleArchived, togglePinned } from "@/lib/session-flags";

/**
 * Bridges the session sidebar's legacy window event onto the generic
 * `ContextMenuProvider`.
 *
 * The sidebar dispatches `SESSION_ROW_CONTEXT_MENU_EVENT` instead of using the
 * context hook directly, because the sidebar row and the menu live in different
 * subtrees and the sidebar must not depend on `AppShell`'s internals. Keeping
 * the event as the seam means the menu implementation can change without
 * touching the sidebar.
 */
export function SessionRowContextMenuBridge({
  onCopyReference,
  onFork,
}: {
  onCopyReference: (detail: SessionRowContextMenuDetail) => void | Promise<void>;
  /** fork:pi-1.1（上游 085fba902）—— 侧栏行菜单的「分叉」。 */
  onFork?: (detail: SessionRowContextMenuDetail) => void | Promise<void>;
}) {
  const { openMenu } = useContextMenu();
  const { t } = useI18n();

  useEffect(() => {
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<SessionRowContextMenuDetail>).detail;
      if (!detail) return;
      event.preventDefault();
      const flags = getSessionFlags();
      const isPinned = flags.pinned.includes(detail.id);
      const isArchived = flags.archived.includes(detail.id);
      openMenu(detail.clientX, detail.clientY, [
        {
          label: t(isPinned ? "session.unpin" : "session.pin"),
          icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 17v5M9 4h6l-1 6 3 3v2H7v-2l3-3z" />
            </svg>
          ),
          onSelect: () => {
            togglePinned(detail.id);
            // The sidebar owns the session list; ask it to re-read its data.
            detail.refresh();
          },
        },
        {
          label: t(isArchived ? "session.unarchive" : "session.archive"),
          icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="4" rx="1" />
              <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
            </svg>
          ),
          onSelect: () => {
            toggleArchived(detail.id);
            detail.refresh();
          },
        },
        { type: "separator" },
        ...(onFork ? [{
          label: t("session.fork"),
          icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="6" cy="5" r="2.5" />
              <circle cx="18" cy="5" r="2.5" />
              <circle cx="12" cy="19" r="2.5" />
              <path d="M6 7.5v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3v-3M12 13.5v3" />
            </svg>
          ),
          onSelect: () => onFork(detail),
        }] : []),
        {
          // fork:design-system PR-25 — 设计 51 画板：会话行菜单里的「导出为 HTML」。
          // 复用既有的导出路由（HTML 用 inline=1），只是把入口补到菜单里。
          label: t("session.exportHtml"),
          icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 3h6v6" />
              <path d="M10 14 21 3" />
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            </svg>
          ),
          onSelect: () => {
            window.open(
              `/api/sessions/${encodeURIComponent(detail.id)}/export?inline=1`,
              "_blank",
              "noopener,noreferrer",
            );
          },
        },
        {
          label: t("session.copyReference"),
          feedbackLabel: t("session.copied"),
          icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          ),
          onSelect: () => onCopyReference(detail),
        },
      ]);
    };
    window.addEventListener(SESSION_ROW_CONTEXT_MENU_EVENT, handle as EventListener);
    return () => window.removeEventListener(SESSION_ROW_CONTEXT_MENU_EVENT, handle as EventListener);
  }, [openMenu, onCopyReference, onFork, t]);

  return null;
}
