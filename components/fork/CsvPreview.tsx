"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { getFileExt } from "@/lib/file-types";
import { parseDelimitedText } from "@/lib/csv-preview";

/**
 * fork:zc-12 — CSV / TSV 表格预览。
 *
 * WHY：宽表按逐行文本渲染时列对不齐，几百行的文件也没法快速扫。这里把解析交给
 * 纯函数 `lib/csv-preview.ts`，组件只负责画：
 *
 *   - 行窗口化：只挂载视口内 + 少量 overscan 的行，滚动时按固定行高换窗口，
 *     不引虚拟化库（表格行高固定，计算比测量便宜也更稳）；
 *   - 表头粘顶，单元格 nowrap + ellipsis，hover 出完整值；
 *   - 解析层的截断 / 行宽不齐 / 源内容截断都在顶部给出提示条。
 *
 * fork:v5-landing —— 元信息条 = D-06 帧 C 的 `.d-viewer-bar`，
 * 表格骨架 = `.d-tbl-wrap` + `.d-table`，空表走 `.d-empty`，提示条走 `.d-banner`。
 */

const ROW_HEIGHT = 26;
const OVERSCAN = 12;
const FALLBACK_VIEWPORT_HEIGHT = 480;
/** 首列放源码行号，右对齐 + 压暗，和 D-06b 帧 B 的 `.d-table .d-mono` 同款。 */
const ROW_NUMBER_WIDTH = 36;

interface Props {
  content: string;
  filePath: string;
  /** fork:zc-12 — 文件接口在 256KB 处截断了源内容，解析结果不代表整个文件。 */
  sourceTruncated?: boolean;
}

function WarningBar({ children, mobile = false }: { children: React.ReactNode; mobile?: boolean }) {
  // M-06 —— 手机档提示条走 `.m-banner`（PWA 形态里没有 `.d-banner.info`，warning
  // 档由 `.m-banner.warn` 承担，语义相同：这是提示不是错误）。
  return (
    <div role="status" className={mobile ? "m-banner" : "d-banner info"}>
      <i data-ico="info" data-size="14"></i>
      <span className={mobile ? "m-grow" : "d-grow"}>{children}</span>
    </div>
  );
}

export function CsvPreview({ content, filePath, sourceTruncated = false }: Props) {
  const { t } = useI18n();
  // M-06 —— 手机档：D-06 帧 C 在 PWA 形态下的表格 = `.m-viewer-bar` + `.m-tbl-scroll`
  // + `.m-tbl`（横滚不折行，窗口化 / 粘顶表头 / 截断提示这些几何一行没动）。
  const isMobile = useIsMobile();
  // 扩展名是比内容更强的意图信号：.tsv 恒用 tab，其余交给嗅探。
  const parsed = useMemo(
    () => parseDelimitedText(content, getFileExt(filePath) === "tsv" ? { delimiter: "\t" } : undefined),
    [content, filePath],
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => setViewportHeight(element.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rows = parsed.rows;
  const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const lastRow = Math.min(
    rows.length,
    firstRow + Math.max(1, Math.ceil((viewportHeight || FALLBACK_VIEWPORT_HEIGHT) / ROW_HEIGHT)) + OVERSCAN * 2,
  );
  const visibleRows = rows.slice(firstRow, lastRow);
  const columnCount = Math.max(parsed.header.length, parsed.columnCount, 1);

  const headerCellStyle: CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 1,
    padding: "4px 10px",
    background: "var(--nx-panel)",
    borderBottom: "1px solid var(--nx-line)",
    borderRight: "1px solid var(--nx-line)",
    color: "var(--nx-text-3)",
    fontWeight: 600,
    textAlign: "left",
    whiteSpace: "nowrap",
    maxWidth: "var(--nx-ctl-lg)",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
  const bodyCellStyle: CSSProperties = {
    padding: "4px 10px",
    borderBottom: "1px solid var(--nx-line)",
    borderRight: "1px solid var(--nx-line)",
    color: "var(--nx-text)",
    whiteSpace: "nowrap",
    maxWidth: "var(--nx-ctl-lg)",
    overflow: "hidden",
    textOverflow: "ellipsis",
  };
  const rowNumberHeadStyle: CSSProperties = { ...headerCellStyle, width: ROW_NUMBER_WIDTH, textAlign: "right" };
  const rowNumberBodyStyle: CSSProperties = {
    padding: "4px 10px",
    borderBottom: "1px solid var(--nx-line)",
    borderRight: "1px solid var(--nx-line)",
    textAlign: "right",
    width: ROW_NUMBER_WIDTH,
  };
  const spacerCellStyle = (height: number): CSSProperties => ({ padding: 0, border: "none", height });

  return (
    <div
      className={isMobile ? "m-viewer is-open" : "d-viewer"}
      style={isMobile
        ? { position: "fixed", inset: 0, zIndex: "var(--nx-z-panel)" }
        : { height: "100%" }}
    >
      <div className={isMobile ? "m-viewer-bar" : "d-viewer-bar"}>
        <i data-ico="table" data-size="13"></i>
        <span className={isMobile ? "m-badge mute" : "d-badge mute"}>{parsed.delimiter === "\t" ? t("csv.delimiterTab") : t("csv.delimiterComma")}</span>
        <span className="d-badge mute">{t("csv.rows", { count: parsed.rowCount })}</span>
        <span className="d-badge mute">{t("csv.columns", { count: columnCount })}</span>
        <span className={isMobile ? "m-grow" : "d-grow"} />
      </div>

      {sourceTruncated && <WarningBar mobile={isMobile}>{t("csv.sourceTruncated")}</WarningBar>}
      {parsed.columnsTruncated && <WarningBar mobile={isMobile}>{t("csv.truncatedColumns", { count: columnCount })}</WarningBar>}
      {parsed.rowsTruncated && <WarningBar mobile={isMobile}>{t("csv.truncatedRows", { count: parsed.rowCount })}</WarningBar>}
      {parsed.ragged && (
        <WarningBar mobile={isMobile}>{t("csv.raggedRows", { count: parsed.raggedRows })}</WarningBar>
      )}

      {parsed.header.length === 0 ? (
        <div className={isMobile ? "m-empty" : "d-empty"} style={{ flex: 1 }}>
          <div className={isMobile ? "m-empty-ico" : "d-empty-ico"}><i data-ico="table" data-size="20"></i></div>
          <div className={isMobile ? "m-empty-t" : "d-empty-t"}>{t("csv.empty")}</div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className={isMobile ? "m-tbl-scroll" : "d-tbl-wrap"}
          style={{ flex: 1, minHeight: 0, overflow: "auto" }}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          {/* fork:v5-landing —— 表格骨架 = D-06 帧 C / D-06b 帧 B 的 `.d-table`
              （边框 / 表头底 / hover 来自 system.css）；窗口化的固定行高与
              首列行宽是与设计无关的几何，仍留在内联。 */}
          <table className={isMobile ? "m-tbl" : "d-table"} style={{ fontFamily: "var(--font-mono)", width: "max-content", minWidth: "100%" }}>
            <thead>
              <tr>
                <th className="d-mono" style={rowNumberHeadStyle} title="#">#</th>
                {parsed.header.map((cell, columnIndex) => (
                  <th key={columnIndex} style={headerCellStyle} title={cell}>
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {firstRow > 0 && (
                <tr style={{ height: firstRow * ROW_HEIGHT }} aria-hidden="true">
                  <td colSpan={columnCount + 1} style={spacerCellStyle(firstRow * ROW_HEIGHT)} />
                </tr>
              )}
              {visibleRows.map((row, visibleIndex) => (
                <tr key={firstRow + visibleIndex} style={{ height: ROW_HEIGHT }}>
                  <td className="d-mono d-t-faint" style={rowNumberBodyStyle}>{firstRow + visibleIndex + 1}</td>
                  {parsed.header.map((_, columnIndex) => {
                    const cell = row[columnIndex] ?? "";
                    return (
                      <td key={columnIndex} style={bodyCellStyle} title={cell}>
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {lastRow < rows.length && (
                <tr style={{ height: (rows.length - lastRow) * ROW_HEIGHT }} aria-hidden="true">
                  <td colSpan={columnCount + 1} style={spacerCellStyle((rows.length - lastRow) * ROW_HEIGHT)} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
