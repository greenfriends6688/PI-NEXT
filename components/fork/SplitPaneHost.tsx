"use client";

/**
 * fork:pr40-split —— 右栏的双 Pane 壳（两个 Pane + 一条可拖分隔条 + 拖出落点）。
 *
 * fork:v5-skin D-05 —— 分屏外壳沿用接线层已有的 `.split-pane-grid`（fork-ui.css 的
 * grid 几何）；v5 没有 split 专属类，grid/flex 基座由行内布局值承担，不再借 v1 的
 * `.pw-split`。列宽用 CSS 变量按比例算，**不写死像素**：
 *   `--split-pane-columns = minmax(0, (100% - 分隔条) × 比例) 分隔条 minmax(0, 余下)`
 * 分隔条宽度取 `--s2`（8px，与 `lib/right-panel-split.ts` 的 `SPLIT_DIVIDER_WIDTH` 同值）。
 * 落点提示用画板的 `.d-drop`（虚线落区，system.css），不加新 `.pw-*`。
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
  const dropZone = (pane: RightPanelPane) => (
    dropTargetPane === pane ? (
      <div className="d-drop split-pane-drop" role="presentation" style={{ justifyContent: "center" }}>
        <i data-ico="columns-2" data-size={18} aria-hidden="true"></i>
        <span className="d-t-sm">{dropHint}</span>
      </div>
    ) : null
  );
  return (
    <div
      className="split-pane-grid"
      style={{
        /* v5 没有 split 类：grid/flex 基座放在行内（非设计的布局值）。 */
        display: "grid",
        flex: "1 1 auto",
        minHeight: 0,
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
        {dropZone("left")}
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
        {dropZone("right")}
      </section>
    </div>
  );
}