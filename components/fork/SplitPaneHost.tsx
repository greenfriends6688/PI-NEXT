"use client";

/**
 * fork:pr40-split —— 右栏的双 Pane 壳（两个 Pane + 一条可拖分隔条 + 拖出落点）。
 *
 * 结构直接复用画板的 `.pw-split`（board.css 的 grid 右栏结构），
 * 列宽用 CSS 变量按比例算，**不写死像素**：
 *   `--split-pane-columns = minmax(0, (100% - 分隔条) × 比例) 分隔条 minmax(0, 余下)`
 * 分隔条宽度取 `--s2`（8px，与 `lib/right-panel-split.ts` 的 `SPLIT_DIVIDER_WIDTH` 同值）。
 * 落点提示复用画板 30 的 `.pw-drop`（虚线强调色落区），不加新 `.pw-*`。
 */

import type { ReactNode } from "react";
import type { SplitPaneDividerProps } from "@/hooks/useSplitPanes";
import type { RightPanelPane } from "@/lib/right-panel-split";

interface SplitPaneHostProps {
  ratio: number;
  leftTabId: string;
  rightTabId: string;
  focusedPane: RightPanelPane;
  /** 正在被拖出的 tab 要落到哪一侧（null = 不显示落点）。 */
  dropTargetPane: RightPanelPane | null;
  isDividerResizing: boolean;
  dividerProps: SplitPaneDividerProps;
  /** 两侧的可读名字（tab 标题），给 Pane 标 `aria-label`。 */
  paneLabels: Record<RightPanelPane, string>;
  /** 落点提示的文案（纯图标之外的一句说明）。 */
  dropHint: string;
  children: (pane: RightPanelPane, tabId: string) => ReactNode;
}

export function SplitPaneHost({
  ratio,
  leftTabId,
  rightTabId,
  focusedPane,
  dropTargetPane,
  isDividerResizing,
  dividerProps,
  paneLabels,
  dropHint,
  children,
}: SplitPaneHostProps) {
  const leftShare = Math.max(0, Math.min(1, ratio));
  return (
    <div
      className="pw-split split-pane-grid"
      style={{
        "--split-pane-columns":
          `minmax(0, calc((100% - var(--split-gutter)) * ${leftShare.toFixed(4)}))`
          + " var(--split-gutter)"
          + ` minmax(0, calc((100% - var(--split-gutter)) * ${(1 - leftShare).toFixed(4)}))`,
      } as React.CSSProperties}
    >
      <section
        className={`split-pane${focusedPane === "left" ? " is-focused" : ""}`}
        data-split-pane="left"
        aria-label={paneLabels.left || undefined}
      >
        {children("left", leftTabId)}
        {dropTargetPane === "left" ? (
          <div className="pw-drop split-pane-drop" role="presentation">
            <span className="mark"><i data-ico="columns-2" data-size={18}></i></span>
            <span className="pw-dim">{dropHint}</span>
          </div>
        ) : null}
      </section>
      <div
        {...dividerProps}
        className={`split-pane-divider${isDividerResizing ? " is-resizing" : ""}`}
        data-resize-handle="right-panel-split"
      />
      <section
        className={`split-pane${focusedPane === "right" ? " is-focused" : ""}`}
        data-split-pane="right"
        aria-label={paneLabels.right || undefined}
      >
        {children("right", rightTabId)}
        {dropTargetPane === "right" ? (
          <div className="pw-drop split-pane-drop" role="presentation">
            <span className="mark"><i data-ico="columns-2" data-size={18}></i></span>
            <span className="pw-dim">{dropHint}</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}