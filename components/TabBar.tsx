"use client";

import { useEffect, useRef, useState } from "react";
import { getFileIcon } from "./FileIcons";
import { useI18n } from "@/hooks/useI18n";
import type { FileViewerDisplayMode, FileViewerState } from "@/lib/file-viewer-state";

export interface Tab {
  id: string;
  label: string;
  filePath: string;
  /** The pane a tab shows: a file (default), the file tree, the git review, a terminal, a subagent run. */
  kind?: "terminal" | "agent" | "files" | "review" | "agents";
  closing?: boolean;
  sourceSessionId?: string | null;
  initialDisplayMode?: FileViewerDisplayMode;
  /** PDF page requested by the link that opened this tab (`#page=N`). */
  page?: number;
  viewerState?: FileViewerState;
  viewerRevision?: number;
}

interface Props {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  /** fastvibe 的页签右键菜单：关闭 · 关闭其他 · 全部关闭。 */
  onCloseOthers?: (id: string) => void;
  onCloseAll?: () => void;
}

export function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onCloseOthers, onCloseAll }: Props) {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement>(null);
  // 右键菜单：哪一颗页签、锚在哪儿。点外面或 Esc 收起。
  const [menu, setMenu] = useState<{ tabId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menu) return;
    // 原生监听不受 React 的 stopPropagation 管：菜单内部的点击要自己放过，
    // 否则按下菜单项的那一刻菜单就没了，onClick 落不到它身上。
    const close = (event: MouseEvent) => {
      if ((event.target as HTMLElement | null)?.closest(".tab-context-menu")) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // The strip has no scrollbar (globals.css), so a vertical wheel scrolls it
  // sideways. Non-passive: the page must not scroll as well.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || list.scrollWidth <= list.clientWidth) return;
      event.preventDefault();
      list.scrollLeft += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientWidth : 1);
    };
    list.addEventListener("wheel", onWheel, { passive: false });
    return () => list.removeEventListener("wheel", onWheel);
  }, []);

  // Bring an opened or selected tab into view by moving the strip only:
  // scrollIntoView could also scroll the panels around it.
  useEffect(() => {
    const list = listRef.current;
    const tab = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!list || !tab) return;
    const strip = list.getBoundingClientRect();
    const { left, right } = tab.getBoundingClientRect();
    if (left < strip.left) list.scrollLeft -= strip.left - left;
    else if (right > strip.right) list.scrollLeft += right - strip.right;
  }, [activeTabId, tabs.length]);

  return (
    <div
      ref={listRef}
      role="tablist"
      className="tabbar app-tabbar"
      style={{
        // Scrollbar hidden (globals.css); 36px keeps the 28px 页签不贴边。
        overflowX: "auto",
        overflowY: "hidden",
        flexShrink: 0,
        height: 36,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            className={`ftab app-tab${isActive ? " is-on" : ""}`}
            role="tab"
            aria-label={tab.kind === "terminal" ? t("terminal.tabLabel", { name: tab.label }) : tab.kind === "agent" ? t("subagent.tabLabel", { name: tab.label }) : tab.label}
            aria-selected={isActive}
            tabIndex={isActive || (!activeTabId && tabs[0].id === tab.id) ? 0 : -1}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectTab(tab.id);
              } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const index = tabs.findIndex((item) => item.id === tab.id);
                const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                onSelectTab(tabs[next].id);
                (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus();
              }
            }}
            onClick={() => onSelectTab(tab.id)}
            onContextMenu={(event) => {
              if (!onCloseOthers && !onCloseAll) return;
              event.preventDefault();
              onSelectTab(tab.id);
              setMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
            }}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              if (!tab.closing) onCloseTab(tab.id);
            }}
            style={{
              maxWidth: 180,
              minWidth: 80,
              flexShrink: 0,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <span style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7, display: "flex", alignItems: "center" }}>
              {tab.kind === "agents" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19a5.6 5.6 0 0 0-2-4.3" />
                </svg>
              ) : tab.kind === "files" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                </svg>
              ) : tab.kind === "review" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="6" cy="6" r="2.4" /><circle cx="18" cy="18" r="2.4" /><path d="M6 8.4V15a3 3 0 0 0 3 3h6.6M18 15.6V9a3 3 0 0 0-3-3H8.4" />
                </svg>
              ) : tab.kind === "terminal" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              ) : tab.kind === "agent" ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="5" y="7" width="14" height="11" rx="2" /><path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" />
                </svg>
              ) : getFileIcon(tab.label, 12)}
            </span>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                flex: 1,
              }}
              title={tab.filePath}
            >
              {tab.label}
            </span>
            <button
              className="ftab__x app-tab-close"
              disabled={tab.closing}
              onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 18, height: 18,
                background: "none",
                border: "none",
                borderRadius: 4,
                color: "inherit",
                cursor: "pointer",
                padding: 0,
                flexShrink: 0,
              }}
               title={t(tab.kind === "terminal" ? "terminal.close" : "i18n.close")}
               aria-label={`${t(tab.kind === "terminal" ? "terminal.close" : "i18n.close")} ${tab.label}`}
            >
              <svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <line x1="2" y1="2" x2="8" y2="8" />
                <line x1="8" y1="2" x2="2" y2="8" />
              </svg>
            </button>
          </div>
        );
      })}
      {menu && (
        <div
          role="menu"
          className="tab-context-menu"
          style={{ position: "fixed", left: menu.x, top: menu.y, zIndex: 700 }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button type="button" role="menuitem" className="chrome-more-row" onClick={() => { setMenu(null); onCloseTab(menu.tabId); }}>
            {t("i18n.close")}
          </button>
          {onCloseOthers && (
            <button type="button" role="menuitem" className="chrome-more-row" disabled={tabs.length < 2} onClick={() => { setMenu(null); onCloseOthers(menu.tabId); }}>
              {t("files.closeOthers")}
            </button>
          )}
          {onCloseAll && (
            <button type="button" role="menuitem" className="chrome-more-row" onClick={() => { setMenu(null); onCloseAll(); }}>
              {t("files.closeAll")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
