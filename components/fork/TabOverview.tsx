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
 *
 * fork:v5-landing —— 外观照 `design/v5/web/boards/D-02c-menus-atlas.html` 帧 C
 * 「标签页总览浮层」原样落地：`d-pop-float` 壳 › `d-searchfield` 搜索头 ›
 * `d-pop-title`「全部标签」› `d-col` 里的 `d-row`（`d-trow` 行 + `d-iconbtn` 关闭钮）
 * › `d-sep` ›「最近关闭」`d-row`（`d-menu-row` + `d-btn.sm` 恢复）› `d-sep` ›
 * 三个 `d-menu-row`（清空最近关闭是 `danger`）。定位仍是 fixed（宿主横向裁切）。
 */

export interface TabOverviewEntry {
  id: string;
  label: string;
  filePath: string;
  /** fork:trace-pane — `trace` 与图谱同属单例视图 tab。 */
  kind?: "terminal" | "browser" | "session" | "git-graph" | "trace";
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

/* fork:board-diff-2026-10-01 —— 画板「标签概览」样张是 340px 宽（旧壳默认 320）。
   300 是拍脑袋值，实测比画板窄 40px，导致分隔线等子件跟着窄（318 vs 278）。按画板对齐。 */
const PANEL_WIDTH = 340;

/* fork:design-system —— 标签字形改画板 31 的图标实名：终端 `terminal`、浏览器
 * `globe`、会话 `bot`、Git 图 `git-branch`（画板 31 注释里定的就是这四个）。
 * 文件标签仍走 FileIcons 的按扩展名取图。 */
const TAB_KIND_ICON: Record<string, string> = {
  terminal: "terminal",
  browser: "globe",
  session: "bot",
  "git-graph": "git-branch",
  changes: "file-diff",
  // fork:trace-pane —— 调用轨迹 tab 的字形（与面板头一致）。
  trace: "activity",
};

function TabGlyph({ tab }: { tab: TabOverviewEntry }) {
  const icon = tab.kind ? TAB_KIND_ICON[tab.kind] : undefined;
  if (icon) {
    return <i data-ico={icon} data-size="14"></i>;
  }
  return getFileIcon(tab.label, 14);
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
    <div
      ref={panelRef}
      data-tab-overview="true"
      role="dialog"
      aria-label={t("tabs.overview")}
      className="d-pop-float"
      style={{
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
      <div className="d-searchfield" style={{ margin: "0 var(--nx-sp-1)", flexShrink: 0 }}>
        <i data-ico="search" data-size="13"></i>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("tabs.overviewSearch")}
          aria-label={t("tabs.overviewSearch")}
        />
      </div>

      <div style={{ overflowY: "auto", minHeight: 0, flex: 1 }}>
        <div className="d-pop-title">
          <span className="d-row">
            <span>{t("tabs.overview")}</span>
            <span className="d-grow" />
            <span className="d-badge mute">{visibleTabs.length}</span>
          </span>
        </div>
        {visibleTabs.length === 0 && (
          <div className="d-pop-foot" role="status">
            {t("tabs.overviewEmpty")}
          </div>
        )}
        <div className="d-col" style={{ padding: "0 var(--nx-sp-1)" }}>
          {visibleTabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            // 单例标签（Git 图谱 / 调用轨迹）不挂关闭钮 —— 它们不是「开着的标签」，
            // 是面板本身（画板 D-02c 帧 C 的注释口径）。
            const singleton = tab.kind === "git-graph" || tab.kind === "trace";
            return (
              <div key={tab.id} className="d-row">
                <button
                  type="button"
                  onClick={() => { onSelectTab(tab.id); onClose(); }}
                  title={tab.filePath}
                  aria-current={isActive ? "true" : undefined}
                  className={`d-trow d-grow${isActive ? " is-on" : ""}`}
                >
                  <TabGlyph tab={tab} />
                  <span className="d-grow">{tab.label}</span>
                  {isActive && <span className="d-t-xs d-t-faint">{t("agentSwitcher.current")}</span>}
                </button>
                {singleton ? (
                  <span className="d-iconbtn" aria-hidden="true" />
                ) : (
                  <button
                    type="button"
                    onClick={() => onCloseTab(tab.id)}
                    title={t("i18n.close")}
                    aria-label={`${t("i18n.close")} ${tab.label}`}
                    className="d-iconbtn"
                  >
                    <i data-ico="x" data-size="13"></i>
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="d-sep" />
        <div className="d-pop-title">{t("tabs.recentlyClosed")}</div>
        {recentClosed.length === 0 ? (
          <div className="d-pop-foot" role="status">
            {t("tabs.recentlyClosedEmpty")}
          </div>
        ) : (
          recentClosed.map((tab) => (
            <div key={`recent:${tab.id}`} className="d-row" style={{ padding: "0 var(--nx-sp-1)" }}>
              <button
                type="button"
                onClick={() => { onRestore(tab); onClose(); }}
                title={tab.filePath}
                className="d-menu-row d-grow"
              >
                <i data-ico="history" data-size="14"></i>
                <span className="d-grow">{tab.label}</span>
              </button>
              <button
                type="button"
                onClick={() => { onRestore(tab); onClose(); }}
                className="d-btn sm"
                style={{ whiteSpace: "nowrap" }}
              >
                {t("tabs.restore")}
              </button>
            </div>
          ))
        )}

        <div className="d-sep" />
        <button
          type="button"
          onClick={onCloseOthers}
          disabled={tabs.length < 2}
          className="d-menu-row"
        >
          <i data-ico="x" data-size="14"></i>
          <span className="d-grow">{t("tabs.closeOthers")}</span>
        </button>
        <button
          type="button"
          onClick={onCloseAll}
          className="d-menu-row"
        >
          <i data-ico="x" data-size="14"></i>
          <span className="d-grow">{t("tabs.closeAll")}</span>
        </button>
        {recentClosed.length > 0 && (
          <button
            type="button"
            onClick={onClearRecent}
            className="d-menu-row danger"
          >
            <i data-ico="eraser" data-size="14"></i>
            <span className="d-grow">{t("tabs.clearRecent")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
