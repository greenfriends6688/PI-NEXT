"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getFileIcon } from "../FileIcons";
import { useI18n } from "@/hooks/useI18n";
import type { RestorableTab } from "@/lib/recent-closed-tabs";

/*
 * fork:zc-06 — 右栏 tab 概览。
 *
 * 对照项目（ZCode）把「tab 总览」与「最近关闭的标签页」放在同一个浮层里
 * （`app-shell/SidePaneTabOverview.tsx`）。本仓原来只有一个「…」溢出菜单，且
 * 只在 tab 放不下时才出现 —— 也就是说 tab 少的时候**没有任何地方能看到全部
 * tab**，关错了也没得救。这个浮层补的就是这两件事。
 *
 * 为什么是 fixed 定位：宿主 tab 栏是 `overflow-x: hidden`（横向裁切），
 * 任何 in-flow 的下拉都会被裁掉 —— 与既有「…」菜单同一个理由。
 *
 * 为什么覆盖全部 tab 而不是只列被折叠的：概览的用途是「找」与「批量关」，
 * 只列折叠项时用户还得先判断某个 tab 在不在被折叠的那部分里。
 */

export interface TabOverviewEntry {
  id: string;
  label: string;
  filePath: string;
  kind?: "terminal" | "browser" | "session" | "git-graph";
}

interface Props {
  open: boolean;
  anchor: { top: number; left: number } | null;
  tabs: TabOverviewEntry[];
  activeTabId: string;
  recentClosed: RestorableTab[];
  onClose: () => void;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAll: () => void;
  onCloseOthers: () => void;
  onRestore: (tab: RestorableTab) => void;
  onClearRecent: () => void;
}

const PANEL_WIDTH = 300;

/* fork:design-system —— 标签字形改画板 31 的图标实名：终端 `terminal`、浏览器
 * `globe`、会话 `bot`、Git 图 `git-branch`（画板 31 注释里定的就是这四个）。
 * 文件标签仍走 FileIcons 的按扩展名取图。 */
const TAB_KIND_ICON: Record<string, string> = {
  terminal: "terminal",
  browser: "globe",
  session: "bot",
  "git-graph": "git-branch",
};

function TabGlyph({ tab }: { tab: TabOverviewEntry }) {
  const icon = tab.kind ? TAB_KIND_ICON[tab.kind] : undefined;
  if (icon) {
    return <span className="pw-ico"><i data-ico={icon} data-size="14"></i></span>;
  }
  return <span className="pw-ico">{getFileIcon(tab.label, 12)}</span>;
}

export function TabOverview({
  open,
  anchor,
  tabs,
  activeTabId,
  recentClosed,
  onClose,
  onSelectTab,
  onCloseTab,
  onCloseAll,
  onCloseOthers,
  onRestore,
  onClearRecent,
}: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 每次打开都是新的一次查找：留下上一条查询会让人以为列表被过滤坏了。
  useEffect(() => {
    if (!open) return;
    setQuery("");
    // 焦点进搜索框，打开就能直接打字。
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-tab-overview]")) return;
      // 触发按钮自己负责开关，否则一次点击会「关掉又打开」。
      if (target?.closest("[data-tab-overview-trigger]")) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, onClose]);

  const needle = query.trim().toLowerCase();
  const visibleTabs = useMemo(() => {
    if (!needle) return tabs;
    return tabs.filter((tab) => (
      tab.label.toLowerCase().includes(needle) || tab.filePath.toLowerCase().includes(needle)
    ));
  }, [needle, tabs]);

  if (!open || !anchor) return null;

  return (
    // fork:design-system SW-02 —— 整个浮层就是画板 31-B 的那一个长菜单：
    // pw-pop 壳 › pw-pop-search（search 图标 + 过滤输入）› pw-pop-title「全部标签」
    // › pw-prow 行（当前项 is-on，末位一枚 pw-iconbtn.sm 关闭）› pw-sep ›
    // pw-pop-title「最近关闭」› pw-prow 行（history 图标 + pw-btn.sm 恢复）›
    // pw-sep › 三个 pw-prow 动作行（关闭其他 / 关闭全部 / 清空最近关闭）。
    // 定位仍然是 fixed：宿主 tab 栏 overflow-x:hidden，任何 in-flow 下拉都会被裁掉。
    <div
      ref={panelRef}
      data-tab-overview="true"
      role="dialog"
      aria-label={t("tabs.overview")}
      className="pw-pop"
      style={{
        position: "fixed",
        top: anchor.top,
        left: anchor.left,
        zIndex: 400,
        width: PANEL_WIDTH,
        maxHeight: "min(70vh, 480px)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div className="pw-pop-search" style={{ flexShrink: 0 }}>
        <span className="pw-ico"><i data-ico="search" data-size="14"></i></span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("tabs.overviewSearch")}
          aria-label={t("tabs.overviewSearch")}
          style={{
            minWidth: 0, flex: 1, height: 24, border: 0, background: "transparent",
            font: "inherit", color: "inherit",
          }}
        />
      </div>

      <div style={{ overflowY: "auto", minHeight: 0, flex: 1 }}>
        <div className="pw-pop-title" style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
          <span>{t("tabs.overview")}</span>
          <span className="grow" />
          <span className="pw-badge count">{visibleTabs.length}</span>
        </div>
        {visibleTabs.length === 0 && (
          <div className="pw-prow pw-desc" role="status">
            {t("tabs.overviewEmpty")}
          </div>
        )}
        {visibleTabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div key={tab.id} style={{ display: "flex", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => { onSelectTab(tab.id); onClose(); }}
                title={tab.filePath}
                aria-current={isActive ? "true" : undefined}
                className={`pw-prow${isActive ? " is-on" : ""}`}
                style={{ flex: 1, minWidth: 0 }}
              >
                <TabGlyph tab={tab} />
                <span className="grow">{tab.label}</span>
              </button>
              <button
                type="button"
                onClick={() => onCloseTab(tab.id)}
                title={t("i18n.close")}
                aria-label={`${t("i18n.close")} ${tab.label}`}
                className="pw-iconbtn sm"
              >
                <span className="pw-ico"><i data-ico="x" data-size="13"></i></span>
              </button>
            </div>
          );
        })}

        <div className="pw-sep" />
        <div className="pw-pop-title">{t("tabs.recentlyClosed")}</div>
        {recentClosed.length === 0 ? (
          <div className="pw-prow pw-desc" role="status">
            {t("tabs.recentlyClosedEmpty")}
          </div>
        ) : (
          recentClosed.map((tab) => (
            <button
              key={`recent:${tab.id}`}
              type="button"
              onClick={() => { onRestore(tab); onClose(); }}
              title={tab.filePath}
              className="pw-prow"
            >
              <span className="pw-ico pw-dim"><i data-ico="history" data-size="14"></i></span>
              <span className="grow">{tab.label}</span>
              <span className="pw-btn sm">{t("tabs.restore")}</span>
            </button>
          ))
        )}

        <div className="pw-sep" />
        <button
          type="button"
          onClick={onCloseOthers}
          disabled={tabs.length < 2}
          className="pw-prow"
          style={tabs.length < 2 ? { opacity: 0.45 } : undefined}
        >
          <span className="pw-ico"><i data-ico="x" data-size="14"></i></span>
          <span className="grow">{t("tabs.closeOthers")}</span>
        </button>
        <button
          type="button"
          onClick={onCloseAll}
          className="pw-prow"
        >
          <span className="pw-ico"><i data-ico="x" data-size="14"></i></span>
          <span className="grow">{t("tabs.closeAll")}</span>
        </button>
        {recentClosed.length > 0 && (
          <button
            type="button"
            onClick={onClearRecent}
            className="pw-prow"
            style={{ color: "var(--error)" }}
          >
            <span className="pw-ico" style={{ color: "var(--error)" }}>
              <i data-ico="eraser" data-size="14"></i>
            </span>
            <span className="grow">{t("tabs.clearRecent")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
