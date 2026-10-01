"use client";

import { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { FILE_CODE_STYLE, FILE_LINE_NUMBER_STYLE } from "@/lib/file-source-styles";
import { LazyFileSourceView, useHighlighterReady } from "./useLazyHighlighter";
import { useTheme } from "@/hooks/useTheme";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  DOCX_PREVIEW_MAX_BYTES,
  getFileExt,
  isAudioPath,
  isDocumentPreviewPath,
  isImagePath,
  isVideoPath,
} from "@/lib/file-types";
import { encodeFilePathForApi, getFileName, getRelativeFilePath, sameFilePath } from "@/lib/file-paths";
import { buildAtMentionText, buildFileLineMentionText } from "@/lib/file-fuzzy";
import { clearLocationTextHighlight, LOCATION_HIGHLIGHT_CLASS } from "@/lib/location-highlight";
import { clampZoom, formatZoomPercent, isZoomed, stepZoom, wheelZoom, withPdfZoom, ZOOM_MAX, ZOOM_MIN } from "@/lib/viewer-zoom";
import { shouldShowUnsupportedCard, isDelimitedTextPath } from "@/lib/file-preview-support";
import { UnsupportedFilePreview } from "./fork/UnsupportedFilePreview";
import { CsvPreview } from "./fork/CsvPreview";
import { PathActions } from "./fork/PathActions";
// fork:perf-highlighter — the markdown stack (react-markdown + rehype/remark plugins +
// frontmatter) rides along with the preview only; a plain text/image/office file must not
// download it. Same pattern (and reason) as CodeFileEditor below.
const MarkdownFilePreview = dynamic(() => import("./MarkdownFilePreview").then((mod) => mod.MarkdownFilePreview), {
  ssr: false,
  loading: () => (
    <div className="markdown-body markdown-file-preview markdown-readable-column" style={{ padding: "24px 32px" }} aria-busy="true" />
  ),
});
import type { MarkdownEditorLocationApi, MarkdownEditorSelection } from "@/lib/file-editor-types";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { parseUnifiedPatch } from "@/lib/patch";
// fork:zc-07 — 统一 diff 也复用词级行内差异（与 MessageView 的并排视图同一套纯函数）。
import { buildIntralineSegments, diffIntraline, type IntralineSpan } from "@/lib/diff-intraline";
import type { GitFileDiffResponse } from "@/lib/git-types";
import { useI18n } from "@/hooks/useI18n";
import {
  resolveInitialFileDisplayMode,
  type FileViewerDisplayMode as DisplayMode,
  type FileViewerState,
} from "@/lib/file-viewer-state";
import { TEXT } from "@/lib/typography";

export type { FileViewerState } from "@/lib/file-viewer-state";

export interface FileLocationTarget {
  filePath: string;
  sourceSessionId?: string | null;
  startLine?: number;
  endLine?: number;
  /** Quote for highlight; optional so a pure `#page=` jump needs no text. */
  text?: string;
  /** PDF Open Parameters page (`#page=N`) from the link that opened the file. */
  page?: number;
}

const CodeFileEditor = dynamic(() => import("./CodeFileEditor"), { ssr: false });

interface Props {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string, page?: number) => void;
  locationTarget?: FileLocationTarget | null;
  onLocationHandled?: (target: FileLocationTarget) => void;
  onLocationFailed?: (target: FileLocationTarget) => void;
  onMentionLines?: (selection: FileSelectionContext) => void;
  onAskInNewChat?: (prompt: string) => Promise<void>;
  /** Insert this file's relative path into the chat input (@ mention). */
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  gitRefreshKey?: number;
  initialDisplayMode?: DisplayMode;
  /** PDF page to open on first render (`#page=N` from a markdown link). */
  initialPage?: number;
  initialState?: FileViewerState;
  onStateChange?: (state: FileViewerState) => void;
  watchEnabled?: boolean;
  /** Called after the file is saved so panels showing Git state can refresh. */
  onFileMutated?: () => void;
}

interface FileData {
  content: string;
  language: string;
  size: number;
  nextOffset: number;
  truncated: boolean;
  editable?: boolean;
}

const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;
// Matches the write endpoint's content cap in lib/file-mutations.ts.
const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
  source: "Source",
  preview: "Preview",
};


interface SelectedLineRange {
  startLine: number;
  endLine: number;
}

interface PendingFileSelection extends SelectedLineRange {
  text: string;
  top: number;
  left: number;
}

export interface FileSelectionContext {
  relativePath: string;
  filePath: string;
  sourceSessionId?: string | null;
  text: string;
  startLine: number;
  endLine: number;
  language?: string;
}

function MentionIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </svg>
  );
}

function closestSourceLine(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
  return element?.closest<HTMLElement>(".file-source-line[data-line-number]") ?? null;
}

function getSelectedSourceLineRange(root: HTMLElement, selection: Selection | null): SelectedLineRange | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;

  let startElement = closestSourceLine(range.startContainer);
  let endElement = closestSourceLine(range.endContainer);
  if (!startElement || !endElement || !root.contains(startElement) || !root.contains(endElement)) return null;

  let startLine = Number(startElement.dataset.lineNumber);
  let endLine = Number(endElement.dataset.lineNumber);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return null;

  if (startLine < endLine) {
    // Browser ranges can start at the end of the preceding line or end at the
    // start of the following line. Exclude either boundary line when none of
    // its source text is actually selected.
    const startContent = startElement.querySelector<HTMLElement>(".file-source-line-content");
    if (startContent?.contains(range.startContainer)) {
      const selectedSuffix = document.createRange();
      selectedSuffix.selectNodeContents(startContent);
      selectedSuffix.setStart(range.startContainer, range.startOffset);
      if (selectedSuffix.toString().length === 0) {
        const nextLine = startElement.nextElementSibling;
        if (nextLine instanceof HTMLElement && nextLine.matches(".file-source-line[data-line-number]")) {
          startElement = nextLine;
          startLine = Number(startElement.dataset.lineNumber);
        }
      }
    }

    const endContent = endElement.querySelector<HTMLElement>(".file-source-line-content");
    if (endContent?.contains(range.endContainer)) {
      const selectedPrefix = document.createRange();
      selectedPrefix.selectNodeContents(endContent);
      selectedPrefix.setEnd(range.endContainer, range.endOffset);
      if (selectedPrefix.toString().length === 0) {
        const previousLine = endElement.previousElementSibling;
        if (previousLine instanceof HTMLElement && previousLine.matches(".file-source-line[data-line-number]")) {
          endElement = previousLine;
          endLine = Number(endElement.dataset.lineNumber);
        }
      }
    }
  }

  if (startLine > endLine) return null;
  return { startLine, endLine };
}

function closestMarkdownSourceRange(node: Node): HTMLElement | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  return element?.closest<HTMLElement>("[data-source-start-line][data-source-end-line]") ?? null;
}

function getSelectedMarkdownLineRange(root: HTMLElement, selection: Selection | null): SelectedLineRange | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const startElement = closestMarkdownSourceRange(range.startContainer);
  const endElement = closestMarkdownSourceRange(range.endContainer);
  const startLine = Number(startElement?.dataset.sourceStartLine);
  const endLine = Number(endElement?.dataset.sourceEndLine);
  return Number.isInteger(startLine) && Number.isInteger(endLine) && startLine > 0 && endLine >= startLine
    ? { startLine, endLine }
    : null;
}

interface LocationTextPoint {
  node: Text;
  offset: number;
}

function normalizeLocationText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Find a rendered-text range without relying on Markdown punctuation or the
 * source line breaks that the preview renderer intentionally removes. The
 * returned range is used for scrolling only; it never changes the user's
 * native selection.
 */
function findLocationTextRangeInRoots(roots: readonly Node[], text: string): Range | null {
  const target = normalizeLocationText(text);
  if (!target) return null;

  const points: LocationTextPoint[] = [];
  let normalized = "";
  let hasContent = false;
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        return parent?.closest("[hidden]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    const textNodes: Text[] = [];
    let node = walker.nextNode() as Text | null;
    while (node) {
      if (node.nodeValue) textNodes.push(node);
      node = walker.nextNode() as Text | null;
    }
    if (textNodes.length === 0) continue;

    // Treat adjacent source blocks as a whitespace boundary so a selection
    // spanning two paragraphs can still be located as one rendered range.
    if (hasContent && normalized && normalized.at(-1) !== " ") {
      normalized += " ";
      points.push({ node: textNodes[0], offset: 0 });
    }
    for (const textNode of textNodes) {
      const value = textNode.nodeValue ?? "";
      for (let offset = 0; offset < value.length; offset += 1) {
        const character = value[offset];
        if (/\s/.test(character)) {
          if (normalized && normalized.at(-1) !== " ") {
            normalized += " ";
            points.push({ node: textNode, offset });
          }
        } else {
          normalized += character;
          points.push({ node: textNode, offset });
        }
      }
    }
    hasContent = true;
  }

  const match = normalized.indexOf(target);
  if (match < 0) return null;
  const start = points[match];
  const end = points[match + target.length - 1];
  if (!start || !end) return null;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

function findLocationTextRange(root: Node, text: string) {
  return findLocationTextRangeInRoots([root], text);
}

function scrollLocationRangeIntoView(scroller: HTMLElement, range: Range) {
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) return false;

  const scrollerRect = scroller.getBoundingClientRect();
  const padding = Math.min(48, Math.max(16, scroller.clientHeight * 0.2));
  const visibleTop = scrollerRect.top + padding;
  const visibleBottom = scrollerRect.bottom - padding;
  if (rect.top >= visibleTop && rect.bottom <= visibleBottom) return true;

  scroller.scrollBy({
    top: (rect.top + rect.bottom) / 2 - (scrollerRect.top + scrollerRect.bottom) / 2,
    behavior: "auto",
  });
  return true;
}

function getFileApiUrl(
  filePath: string,
  type: "read" | "download" | "meta" | "preview" | "watch",
  sourceSessionId?: string | null,
  params: Record<string, string | number | undefined> = {},
): string {
  const baseUrl = getFileApiBaseUrl(filePath);
  const searchParams = new URLSearchParams({ type });
  if (sourceSessionId) searchParams.set("sessionId", sourceSessionId);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) searchParams.set(key, String(value));
  }
  return `${baseUrl}?${searchParams.toString()}`;
}

function getFileApiBaseUrl(filePath: string): string {
  return `/api/files/${encodeFilePathForApi(filePath)}`;
}

function DownloadLink({ filePath, sourceSessionId }: { filePath: string; sourceSessionId?: string | null }) {
  const { t } = useI18n();
  return (
    <a
      href={getFileApiUrl(filePath, "download", sourceSessionId)}
      download={getFileName(filePath)}
      title={t("i18n.downloadFile")}
      aria-label={t("i18n.downloadFile")}
      className="pw-iconbtn sm"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </a>
  );
}

type DiffLine = {
  type: "unchanged" | "removed" | "added";
  text: string;
  oldLineNo: number | null;
  newLineNo: number | null;
  /** fork:zc-07 — 行内词级差异；undefined=不标，null=整行回退。 */
  intraline?: IntralineSpan[] | null;
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function diffLines(patch: string): DiffLine[] {
  const files = parseUnifiedPatch(patch);
  if (!files) return [];

  return files.flatMap((file) => file.rows.flatMap((row): DiffLine[] => {
    if (row.type === "hunk") return [];
    if (row.left.type === "context" && row.right.type === "context") {
      return [{
        type: "unchanged",
        text: row.right.text,
        oldLineNo: row.left.lineNo,
        newLineNo: row.right.lineNo,
      }];
    }

    const lines: DiffLine[] = [];
    // fork:zc-07 — 双边改动只算一次词级差异，删除/新增两行各取自己那一侧。
    const pair = row.left.type === "removed" && row.right.type === "added"
      ? diffIntraline(row.left.text, row.right.text)
      : undefined;
    if (row.left.type === "removed") {
      lines.push({
        type: "removed",
        text: row.left.text,
        oldLineNo: row.left.lineNo,
        newLineNo: null,
        intraline: pair === undefined ? undefined : pair?.left ?? null,
      });
    }
    if (row.right.type === "added") {
      lines.push({
        type: "added",
        text: row.right.text,
        oldLineNo: null,
        newLineNo: row.right.lineNo,
        intraline: pair === undefined ? undefined : pair?.right ?? null,
      });
    }
    return lines;
  }));
}

/** Collapse the diff to 3 lines of context around every change. */
function diffSegments(diff: readonly DiffLine[]): Array<{ hidden: true; count: number } | { hidden: false; lines: DiffLine[] }> {
  const CONTEXT = 3;
  const visible = new Set<number>();
  diff.forEach((line, index) => {
    if (line.type === "unchanged") return;
    for (let j = Math.max(0, index - CONTEXT); j <= Math.min(diff.length - 1, index + CONTEXT); j++) {
      visible.add(j);
    }
  });

  const segments: Array<{ hidden: true; count: number } | { hidden: false; lines: DiffLine[] }> = [];
  let i = 0;
  while (i < diff.length) {
    const blockIsVisible = visible.has(i);
    let end = i;
    while (end < diff.length && visible.has(end) === blockIsVisible) end++;
    segments.push(blockIsVisible
      ? { hidden: false, lines: diff.slice(i, end) }
      : { hidden: true, count: end - i });
    i = end;
  }
  return segments;
}

function DiffView({ patch }: { patch: string }) {
  const { t } = useI18n();
  // fork:perf-viewer-keepalive — `diffLines` parses the patch and runs a word-level
  // LCS for every changed pair. It used to run again on each render of the viewer
  // (selection changes, save state, theme), so the parsed rows and the context
  // blocks are memoized on the patch itself now.
  const diff = useMemo(() => diffLines(patch), [patch]);
  const segments = useMemo(() => diffSegments(diff), [diff]);
  const hasChanges = diff.some((l) => l.type !== "unchanged");

  if (!hasChanges) {
    return (
      <div style={{ padding: "12px 16px", fontSize: TEXT.sm, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
        {t("i18n.noChanges")}
      </div>
    );
  }

  return (
    <div
      className="file-diff-view"
      style={{
        width: "max-content",
        minWidth: "100%",
        ...FILE_CODE_STYLE,
      }}
    >
      {segments.map((seg, si) => {
        if (seg.hidden) {
          const result = (
            <div
              key={si}
              style={{
                padding: "2px 16px",
                color: "var(--text-dim)",
                background: "var(--bg-panel)",
                fontSize: TEXT.xs,
                borderTop: "1px solid var(--border)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              ... {seg.count} unchanged lines ...
            </div>
          );
          return result;
        }
        const lines = seg.lines.map((line, li) => {
          const bg =
            line.type === "added"
              ? "var(--diff-added)"
              : line.type === "removed"
              ? "var(--diff-removed)"
              : "transparent";
          const prefix =
            line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
          const prefixColor =
            line.type === "added" ? "var(--success)" : line.type === "removed" ? "var(--danger)" : "var(--text-dim)";
          // fork:zc-07 — 行内差异段；空行（或无可显示字符）仍用 nbsp 占位。
          const segments = line.intraline === undefined ? null : buildIntralineSegments(line.text, line.intraline);
          const hasVisibleSegments = segments?.some((segment) => segment.text.length > 0) ?? false;
          const changedBackground = line.type === "added"
            ? "color-mix(in srgb, var(--success) 30%, transparent)"
            : "color-mix(in srgb, var(--danger) 30%, transparent)";

          return (
            <div
              key={li}
              className="file-diff-line"
              style={{
                display: "flex",
                minWidth: "100%",
                background: bg,
                borderLeft: line.type === "added"
                  ? "3px solid var(--success)"
                  : line.type === "removed"
                  ? "3px solid var(--danger)"
                  : "3px solid transparent",
              }}
            >
              <span
                style={FILE_LINE_NUMBER_STYLE}
              >
                {line.type === "removed" ? line.oldLineNo : line.newLineNo}
              </span>
              <span
                style={{
                  minWidth: 16,
                  padding: "0 6px",
                  color: prefixColor,
                  userSelect: "none",
                  flexShrink: 0,
                  fontWeight: 600,
                }}
              >
                {prefix}
              </span>
              <span
                className="file-diff-line-content"
                style={{
                  flexShrink: 0,
                  padding: "0 8px 0 0",
                  whiteSpace: "pre",
                  color: "var(--text)",
                }}
              >
                {segments && hasVisibleSegments
                  ? segments.map((segment, index) => (
                      <span
                        key={index}
                        style={segment.changed ? { background: changedBackground, borderRadius: "var(--radius-xs)" } : undefined}
                      >
                        {segment.text}
                      </span>
                    ))
                  : (line.text || "\u00a0")}
              </span>
            </div>
          );
        });
        return <div key={si}>{lines}</div>;
      })}
    </div>
  );
}

function ImageViewer({ filePath, cwd, sourceSessionId, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const syncRequestRef = useRef(0);
  // fork:gap-viewer-zoom — 图片缩放与平移。
  // 之前只有 maxWidth/maxHeight 自适应，放大细节（截图、设计稿）没有办法看。
  // 手势沿用常见约定：Ctrl/⌘ + 滚轮缩放、1:1 之外可拖拽平移、双击复位。
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setNaturalSize(null);
    setError(null);
    setWatching(false);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [filePath, sourceSessionId]);

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!watchEnabled) return;

    let active = true;
    const synchronize = () => {
      const requestId = ++syncRequestRef.current;
      fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
        .then((response) => response.json())
        .then((next: { size?: number; error?: string }) => {
          if (!active || requestId !== syncRequestRef.current) return;
          if (next.error) {
            setError(next.error);
            return;
          }
          if (typeof next.size === "number") setSize(next.size);
          setNaturalSize(null);
          setError(null);
          setBust((value) => value + 1);
        })
        .catch((nextError) => {
          if (active && requestId === syncRequestRef.current) setError(String(nextError));
        });
    };

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      synchronize();
    });
    es.addEventListener("change", (e) => {
      syncRequestRef.current += 1;
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setNaturalSize(null);
      setError(null);
      setBust((b) => b + 1);
    });
    const markDisconnected = () => {
      setWatching(false);
    };
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      active = false;
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, sourceSessionId, watchEnabled]);

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  const formatSizeStr = size != null ? formatSize(size) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--s3)",
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: TEXT.xs,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || "image"}</span>
        {naturalSize && <span>{naturalSize.w} × {naturalSize.h}</span>}
        {formatSizeStr && <span>{formatSizeStr}</span>}
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{ display: "flex", alignItems: "center", gap: "var(--s1)", color: watching ? "var(--success)" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "var(--success)" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px var(--success)" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
        {/* fork:gap-viewer-zoom — 缩放控件（键盘可达，带 aria-label）。 */}
        <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
          <button
            type="button"
            className="pw-iconbtn sm"
            onClick={() => setZoom((value) => stepZoom(value, -1))}
            disabled={zoom <= ZOOM_MIN}
            aria-label={t("i18n.zoomOut")}
            title={t("i18n.zoomOut")}
          >
            −
          </button>
          <button
            type="button"
            className="pw-iconbtn sm"
            onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}
            aria-label={t("i18n.zoomReset")}
            title={t("i18n.zoomReset")}
            style={{ fontVariantNumeric: "tabular-nums", minWidth: 44 }}
          >
            {formatZoomPercent(zoom)}
          </button>
          <button
            type="button"
            className="pw-iconbtn sm"
            onClick={() => setZoom((value) => stepZoom(value, 1))}
            disabled={zoom >= ZOOM_MAX}
            aria-label={t("i18n.zoomIn")}
            title={t("i18n.zoomIn")}
          >
            +
          </button>
        </span>
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div
        onWheel={(event) => {
          // 只有 Ctrl/⌘ + 滚轮才缩放，否则交给容器滚动（触控板用户不该被劫持）。
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          setZoom((value) => wheelZoom(value, event.deltaY));
        }}
        style={{
          flex: 1,
          overflow: "auto",
          background: "var(--bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--s4)",
          cursor: isZoomed(zoom) ? "grab" : "default",
          backgroundImage:
            "linear-gradient(45deg, var(--bg) 25%, transparent 25%), linear-gradient(-45deg, var(--bg) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--bg) 75%), linear-gradient(-45deg, transparent 75%, var(--bg) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
        }}
      >
        {error ? (
          <div style={{ color: "var(--danger)", fontSize: TEXT.md }}>{error}</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={filePath}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setError("Failed to load image")}
            onDoubleClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}
            onPointerDown={(event) => {
              // 未放大时不接管指针事件，保留容器的原生滚动。
              if (!isZoomed(zoom)) return;
              panRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const pan = panRef.current;
              if (!pan || pan.pointerId !== event.pointerId) return;
              setOffset({ x: pan.originX + (event.clientX - pan.startX), y: pan.originY + (event.clientY - pan.startY) });
            }}
            onPointerUp={(event) => {
              if (panRef.current?.pointerId !== event.pointerId) return;
              panRef.current = null;
              event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            style={{
              maxWidth: isZoomed(zoom) ? "none" : "100%",
              maxHeight: isZoomed(zoom) ? "none" : "100%",
              objectFit: "contain",
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${clampZoom(zoom)})`,
              transformOrigin: "center",
              transition: panRef.current ? "none" : "transform 120ms ease-out",
              boxShadow: "var(--shadow-popover)",
              userSelect: "none",
              touchAction: "none",
            }}
          />
        )}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function AudioViewer({ filePath, cwd, sourceSessionId, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const syncRequestRef = useRef(0);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setDuration(null);
    setError(null);
    setWatching(false);
  }, [filePath, sourceSessionId]);

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!watchEnabled) return;

    let active = true;
    const synchronize = () => {
      const requestId = ++syncRequestRef.current;
      fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
        .then((response) => response.json())
        .then((next: { size?: number; error?: string }) => {
          if (!active || requestId !== syncRequestRef.current) return;
          if (next.error) {
            setError(next.error);
            return;
          }
          if (typeof next.size === "number") setSize(next.size);
          setDuration(null);
          setError(null);
          setBust((value) => value + 1);
        })
        .catch((nextError) => {
          if (active && requestId === syncRequestRef.current) setError(String(nextError));
        });
    };

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      synchronize();
    });
    es.addEventListener("change", (e) => {
      syncRequestRef.current += 1;
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setDuration(null);
      setError(null);
      setBust((b) => b + 1);
    });
    const markDisconnected = () => {
      setWatching(false);
    };
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      active = false;
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, sourceSessionId, watchEnabled]);

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--s3)",
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: TEXT.xs,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || "audio"}</span>
        {duration != null && <span>{formatDuration(duration)}</span>}
        {size != null && <span>{formatSize(size)}</span>}
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{ display: "flex", alignItems: "center", gap: "var(--s1)", color: watching ? "var(--success)" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "var(--success)" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px var(--success)" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--s5)",
          background: "var(--bg)",
        }}
      >
        <div style={{ width: "min(680px, 100%)" }}>
          {error && (
            <div style={{ color: "var(--danger)", fontSize: TEXT.md, marginBottom: "var(--s3)", textAlign: "center" }}>
              {error}
            </div>
          )}
          <audio
            key={src}
            controls
            preload="metadata"
            src={src}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setError("Failed to load audio")}
            style={{ width: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}

function VideoViewer({ filePath, cwd, sourceSessionId, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const syncRequestRef = useRef(0);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setDuration(null);
    setError(null);
    setWatching(false);
  }, [filePath, sourceSessionId]);

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!watchEnabled) return;

    let active = true;
    const synchronize = () => {
      const requestId = ++syncRequestRef.current;
      fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
        .then((response) => response.json())
        .then((next: { size?: number; error?: string }) => {
          if (!active || requestId !== syncRequestRef.current) return;
          if (next.error) {
            setError(next.error);
            return;
          }
          if (typeof next.size === "number") setSize(next.size);
          setDuration(null);
          setError(null);
          setBust((value) => value + 1);
        })
        .catch((nextError) => {
          if (active && requestId === syncRequestRef.current) setError(String(nextError));
        });
    };

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      synchronize();
    });
    es.addEventListener("change", (e) => {
      syncRequestRef.current += 1;
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setDuration(null);
      setError(null);
      setBust((b) => b + 1);
    });
    const markDisconnected = () => {
      setWatching(false);
    };
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      active = false;
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, sourceSessionId, watchEnabled]);

  const src = getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--s3)",
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: TEXT.xs,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || "video"}</span>
        {duration != null && <span>{formatDuration(duration)}</span>}
        {size != null && <span>{formatSize(size)}</span>}
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{ display: "flex", alignItems: "center", gap: "var(--s1)", color: watching ? "var(--success)" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "var(--success)" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px var(--success)" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--s5)",
          background: "var(--bg-panel)",
          minHeight: 0,
        }}
      >
        <div style={{ width: "min(960px, 100%)", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
          {error && (
            <div style={{ color: "var(--danger)", fontSize: TEXT.md, marginBottom: "var(--s3)", textAlign: "center" }}>
              {error}
            </div>
          )}
          <video
            key={src}
            controls
            playsInline
            preload="metadata"
            src={src}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setError("Failed to load video")}
            style={{ maxWidth: "100%", maxHeight: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}

interface FileSelectionQuotePopoverProps {
  top: number;
  left: number;
  /** Prefilled into the new-chat composer, e.g. an @file mention. */
  mentionText: string;
  onAskInCurrent: () => void;
  onAskInNewChat?: (prompt: string) => Promise<void>;
  onClose: () => void;
  onInputOpenChange?: (open: boolean) => void;
}

/**
 * Toolbar anchored to a text selection: quote it into the open composer, or
 * open a small composer that asks about it in a fresh chat. Shared by the text
 * viewer and the document (docx) viewer, whose selection lives in an iframe.
 */
function FileSelectionQuotePopover({
  top,
  left,
  mentionText,
  onAskInCurrent,
  onAskInNewChat,
  onClose,
  onInputOpenChange,
}: FileSelectionQuotePopoverProps) {
  const { t } = useI18n();
  const [inputOpen, setInputOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<ChatInputHandle | null>(null);

  const toggleInput = useCallback((open: boolean) => {
    setInputOpen(open);
    onInputOpenChange?.(open);
  }, [onInputOpenChange]);

  const closeInput = useCallback(() => {
    if (submitting) return;
    setError(null);
    toggleInput(false);
  }, [submitting, toggleInput]);

  // Keep the file selector's menu pixel-for-pixel aligned with the chat
  // selector: fixed popovers need a measured left edge, not a transform that
  // lets the browser shrink buttons near a viewport edge.
  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    const anchorTop = top;
    const anchorLeft = left;
    const viewport = window.visualViewport;
    const position = () => {
      const rect = popover.getBoundingClientRect();
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      popover.style.top = `${Math.max(viewportTop + 8, Math.min(anchorTop, viewportTop + (viewport?.height ?? window.innerHeight) - rect.height - 8))}px`;
      popover.style.left = `${Math.max(viewportLeft + 8, Math.min(anchorLeft - rect.width / 2, viewportLeft + (viewport?.width ?? window.innerWidth) - rect.width - 8))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(popover);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  }, [error, inputOpen, left, top]);

  useEffect(() => {
    if (!inputOpen) return;
    chatInputRef.current?.insertIfEmpty(mentionText);
  }, [inputOpen, mentionText]);

  const askInNewChat = useCallback(async (prompt: string) => {
    if (!onAskInNewChat || !prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await onAskInNewChat(prompt);
      toggleInput(false);
      onClose();
    } catch (nextError) {
      chatInputRef.current?.restoreSubmission(prompt);
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSubmitting(false);
    }
  }, [onAskInNewChat, onClose, toggleInput]);

  return createPortal(
    <div
      ref={popoverRef}
      role={inputOpen ? "dialog" : "toolbar"}
      aria-label={t(inputOpen ? "chat.newQuoteChat" : "chat.askSelection")}
      style={{
        position: "fixed",
        top,
        left,
        zIndex: 130,
        display: "flex",
        // fix:sel-pop-nowrap —— 选中文字的浮窗**不许折行**。原来 `flexWrap: "wrap"`
        // 且宽度交给 shrink-to-fit：两个按钮（「@ 在当前对话询问」/「↗ 在新对话询问」）
        // 一超宽就各自占一行，浮窗变成两行高、还带一条竖向滚动条（用户实测：
        // 「这俩按钮显示还换行呢」）。宽度改成 max-content，两个按钮恒在同一行。
        flexWrap: "nowrap",
        whiteSpace: "nowrap",
        gap: 3,
        width: inputOpen ? "min(420px, calc(100vw - 16px))" : "max-content",
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "calc(var(--app-viewport-height, 100dvh) - 16px)",
        overflowY: "auto",
        padding: inputOpen ? 12 : 3,
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        background: "var(--bg)",
        boxShadow: "var(--shadow-popover)",
      }}
    >
      {inputOpen ? (
        <fieldset disabled={submitting} aria-busy={submitting} style={{ width: "100%", minWidth: 0, margin: 0, padding: 0, border: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)" }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: TEXT.sm, fontWeight: 600 }}>{t("chat.askInNewChat")}</span>
            <button type="button" className="pw-iconbtn sm" title={t("i18n.close")} aria-label={t("i18n.close")} disabled={submitting} onClick={closeInput} style={{ border: "none" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <ChatInput ref={chatInputRef} compact onSend={askInNewChat} onAbort={closeInput} isStreaming={false} />
          {error && <div role="alert" style={{ color: "var(--danger)", fontSize: TEXT.sm, overflowWrap: "anywhere" }}>{error}</div>}
        </fieldset>
      ) : <>
        <button
          type="button"
          className="pw-iconbtn sm"
          title={t("chat.askInCurrent")}
          aria-label={t("chat.askInCurrent")}
          onPointerDown={(event) => event.preventDefault()}
          onClick={onAskInCurrent}
          style={{ width: "auto", height: 35, flex: "0 0 auto", gap: 5, padding: "0 10px", border: "none", fontSize: TEXT.sm, fontWeight: 500, whiteSpace: "nowrap" }}
        >
          <span aria-hidden="true" style={{ fontSize: TEXT.xl }}>@</span>
          <span>{t("chat.askInCurrent")}</span>
        </button>
        {onAskInNewChat && (
          <button
            type="button"
            className="pw-iconbtn sm"
            title={t("chat.askInNewChat")}
            aria-label={t("chat.askInNewChat")}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => toggleInput(true)}
            style={{ width: "auto", height: 35, flex: "0 0 auto", gap: 5, padding: "0 10px", border: "none", fontSize: TEXT.sm, fontWeight: 500, whiteSpace: "nowrap" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 3v12M18 9a9 9 0 0 1-9 9" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
            </svg>
            <span>{t("chat.askInNewChat")}</span>
          </button>
        )}
      </>}
    </div>,
    document.body,
  );
}

function DocumentViewer({ filePath, cwd, sourceSessionId, initialPage, onMentionLines, onAskInNewChat, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frameSelection, setFrameSelection] = useState<{ text: string; top: number; left: number } | null>(null);
  const [frameQuoteInputOpen, setFrameQuoteInputOpen] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const syncRequestRef = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const frameDocRef = useRef<Document | null>(null);
  const frameQuoteInputOpenRef = useRef(false);

  const ext = getFileExt(filePath);
  const isPdf = ext === "pdf";
  // fork:gap-viewer-zoom — PDF 缩放。
  // 这里仍然是浏览器内置的 PDF 阅读器（不引 pdfjs），但通过 `#zoom=<percent>`
  // fragment 给它一个缩放档位，于是至少有了和图片一致的 −/+/100% 控件。
  const [pdfZoom, setPdfZoom] = useState(1);
  const pageFragment = isPdf && initialPage && initialPage > 0 ? `#page=${initialPage}` : "";
  const rawPreviewUrl = isPdf
    ? `${getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined)}${pageFragment}`
    : getFileApiUrl(filePath, "preview", sourceSessionId, bust ? { v: bust } : undefined);
  const previewUrl = isPdf ? withPdfZoom(rawPreviewUrl, pdfZoom) : rawPreviewUrl;

  useEffect(() => {
    setBust(0);
    setSize(null);
    setError(null);
    setWatching(false);
    setPdfZoom(1);

    let active = true;
    const requestId = ++syncRequestRef.current;
    fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
      .then((r) => r.json())
      .then((d: { size?: number; error?: string }) => {
        if (!active || requestId !== syncRequestRef.current) return;
        if (d.error) setError(d.error);
        if (typeof d.size === "number") {
          setSize(d.size);
          if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
            setError("DOCX too large for preview (>10MB)");
          }
        }
      })
      .catch((nextError) => {
        if (active && requestId === syncRequestRef.current) setError(String(nextError));
      });

    return () => {
      active = false;
    };
  }, [filePath, isPdf, sourceSessionId]);

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!watchEnabled) return;

    let active = true;
    const synchronize = () => {
      const requestId = ++syncRequestRef.current;
      fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
        .then((r) => r.json())
        .then((d: { size?: number; error?: string }) => {
          if (!active || requestId !== syncRequestRef.current) return;
          if (d.error) {
            setError(d.error);
            return;
          }
          if (typeof d.size === "number") {
            setSize(d.size);
            if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
              setError("DOCX too large for preview (>10MB)");
              return;
            }
          }
          setError(null);
          setBust((value) => value + 1);
        })
        .catch((nextError) => {
          if (active && requestId === syncRequestRef.current) setError(String(nextError));
        });
    };

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      synchronize();
    });
    es.addEventListener("change", (e) => {
      syncRequestRef.current += 1;
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") {
          setSize(d.size);
          if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
            setError("DOCX too large for preview (>10MB)");
            return;
          }
        }
      } catch { /* ignore */ }
      setError(null);
      setBust((b) => b + 1);
    });
    const markDisconnected = () => {
      setWatching(false);
    };
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      active = false;
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, isPdf, sourceSessionId, watchEnabled]);

  // The docx preview is a same-origin iframe, so its selection is invisible to
  // the parent document. Read it straight out of the frame and anchor the
  // quote toolbar to the frame's own coordinates.
  const syncFrameSelection = useCallback(() => {
    if (isPdf || !onMentionLines || frameQuoteInputOpenRef.current) return;
    const frame = iframeRef.current;
    let doc: Document | null = null;
    try {
      doc = frame?.contentDocument ?? null;
    } catch {
      doc = null;
    }
    const selection = doc?.getSelection() ?? null;
    const text = selection?.toString().trim() ?? "";
    if (!frame || !selection || !text || selection.rangeCount === 0) {
      setFrameSelection(null);
      return;
    }
    const frameRect = frame.getBoundingClientRect();
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const next = {
      text,
      top: Math.min(window.innerHeight - 44, frameRect.top + rect.bottom + 8),
      left: Math.max(8, Math.min(window.innerWidth - 8, frameRect.left + rect.left + rect.width / 2)),
    };
    setFrameSelection((current) => current
      && current.text === next.text
      && current.top === next.top
      && current.left === next.left
      ? current
      : next);
  }, [isPdf, onMentionLines]);

  const detachFrameSelection = useCallback(() => {
    const doc = frameDocRef.current;
    if (doc) {
      doc.removeEventListener("selectionchange", syncFrameSelection);
      doc.removeEventListener("mouseup", syncFrameSelection);
    }
    try {
      iframeRef.current?.contentWindow?.removeEventListener("scroll", syncFrameSelection, true);
    } catch { /* the frame is already gone */ }
    frameDocRef.current = null;
  }, [syncFrameSelection]);

  const attachFrameSelection = useCallback(() => {
    detachFrameSelection();
    const frame = iframeRef.current;
    let doc: Document | null = null;
    try {
      doc = frame?.contentDocument ?? null;
    } catch {
      doc = null;
    }
    if (!frame || !doc) return;
    frameDocRef.current = doc;
    doc.addEventListener("selectionchange", syncFrameSelection);
    doc.addEventListener("mouseup", syncFrameSelection);
    try {
      frame.contentWindow?.addEventListener("scroll", syncFrameSelection, true);
    } catch { /* the frame is already gone */ }
  }, [detachFrameSelection, syncFrameSelection]);

  useEffect(() => {
    frameQuoteInputOpenRef.current = frameQuoteInputOpen;
  }, [frameQuoteInputOpen]);

  useEffect(() => {
    setFrameSelection(null);
    return () => detachFrameSelection();
  }, [detachFrameSelection, filePath, previewUrl]);

  useEffect(() => {
    if (!frameSelection) return;
    const resync = () => syncFrameSelection();
    window.addEventListener("scroll", resync, true);
    window.addEventListener("resize", resync);
    return () => {
      window.removeEventListener("scroll", resync, true);
      window.removeEventListener("resize", resync);
    };
  }, [frameSelection, syncFrameSelection]);

  const clearFrameSelection = useCallback(() => {
    try {
      iframeRef.current?.contentWindow?.getSelection()?.removeAllRanges();
    } catch { /* the frame is already gone */ }
    setFrameSelection(null);
  }, []);

  const addFrameSelectionContext = useCallback(() => {
    if (!onMentionLines || !frameSelection) return;
    // No line numbers in a rendered document: the composer falls back to an
    // unlocated @path snapshot.
    onMentionLines({
      relativePath: getRelativeFilePath(filePath, cwd),
      filePath,
      sourceSessionId,
      text: frameSelection.text,
      startLine: 0,
      endLine: 0,
    });
    clearFrameSelection();
  }, [clearFrameSelection, cwd, filePath, frameSelection, onMentionLines, sourceSessionId]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--s3)",
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: TEXT.xs,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext === "docx" ? "docx preview" : "pdf"}</span>
        {size != null && <span>{formatSize(size)}</span>}
        {/* fork:gap-viewer-zoom — 只给 PDF 加缩放：DOCX 走的是自己排版的 HTML，不需要。
            通过 fragment 驱动内置阅读器，按钮步进避免每次滚轮都重载文档。 */}
        {isPdf && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
            <button
              type="button"
              className="pw-iconbtn sm"
              onClick={() => setPdfZoom((value) => stepZoom(value, -1))}
              disabled={pdfZoom <= ZOOM_MIN}
              aria-label={t("i18n.zoomOut")}
              title={t("i18n.zoomOut")}
            >
              −
            </button>
            <button
              type="button"
              className="pw-iconbtn sm"
              onClick={() => setPdfZoom(1)}
              aria-label={t("i18n.zoomReset")}
              title={t("i18n.zoomReset")}
              style={{ fontVariantNumeric: "tabular-nums", minWidth: 44 }}
            >
              {formatZoomPercent(pdfZoom)}
            </button>
            <button
              type="button"
              className="pw-iconbtn sm"
              onClick={() => setPdfZoom((value) => stepZoom(value, 1))}
              disabled={pdfZoom >= ZOOM_MAX}
              aria-label={t("i18n.zoomIn")}
              title={t("i18n.zoomIn")}
            >
              +
            </button>
          </span>
        )}
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{ display: "flex", alignItems: "center", gap: "var(--s1)", color: watching ? "var(--success)" : "var(--text-dim)", flexShrink: 0 }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "var(--success)" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px var(--success)" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, background: "var(--bg-panel)" }}>
        {error ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--s5)", color: "var(--danger)", fontSize: TEXT.md, textAlign: "center" }}>
            {error}
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            key={previewUrl}
            src={previewUrl}
            sandbox={isPdf ? undefined : "allow-same-origin"}
            title={t("i18n.previewFile", { file: getFileName(filePath) })}
            onLoad={isPdf ? undefined : attachFrameSelection}
            style={{ width: "100%", height: "100%", border: "none", background: isPdf ? "var(--bg)" : "var(--n-surface)" }}
          />
        )}
      </div>
      {frameSelection && onMentionLines && (
        <FileSelectionQuotePopover
          top={frameSelection.top}
          left={frameSelection.left}
          mentionText={buildAtMentionText(getRelativeFilePath(filePath, cwd), false)}
          onAskInCurrent={addFrameSelectionContext}
          onAskInNewChat={onAskInNewChat}
          onClose={clearFrameSelection}
          onInputOpenChange={setFrameQuoteInputOpen}
        />
      )}
    </div>
  );
}

export function FileViewer({
  filePath,
  cwd,
  sourceSessionId,
  onOpenFile,
  locationTarget,
  onLocationHandled,
  onLocationFailed,
  onMentionLines,
  onAskInNewChat,
  onAtMention,
  gitRefreshKey,
  initialDisplayMode,
  initialPage,
  initialState,
  onStateChange,
  watchEnabled = true,
  onFileMutated,
}: Props) {
  if (isImagePath(filePath)) {
    return <ImageViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} watchEnabled={watchEnabled} />;
  }
  if (isAudioPath(filePath)) {
    return <AudioViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} watchEnabled={watchEnabled} />;
  }
  if (isVideoPath(filePath)) {
    return <VideoViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} watchEnabled={watchEnabled} />;
  }
  if (isDocumentPreviewPath(filePath)) {
    return (
      <DocumentViewer
        filePath={filePath}
        cwd={cwd}
        sourceSessionId={sourceSessionId}
        initialPage={initialPage}
        onMentionLines={onMentionLines}
        onAskInNewChat={onAskInNewChat}
        watchEnabled={watchEnabled}
      />
    );
  }
  return (
    <TextFileViewer
      filePath={filePath}
      cwd={cwd}
      sourceSessionId={sourceSessionId}
      onOpenFile={onOpenFile}
      locationTarget={locationTarget}
      onLocationHandled={onLocationHandled}
      onLocationFailed={onLocationFailed}
      onMentionLines={onMentionLines}
      onAskInNewChat={onAskInNewChat}
      onAtMention={onAtMention}
      gitRefreshKey={gitRefreshKey}
      initialDisplayMode={initialDisplayMode}
      initialState={initialState}
      onStateChange={onStateChange}
      watchEnabled={watchEnabled}
      onFileMutated={onFileMutated}
    />
  );
}

function TextFileViewer({
  filePath,
  cwd,
  sourceSessionId,
  onOpenFile,
  locationTarget,
  onLocationHandled,
  onLocationFailed,
  onMentionLines,
  onAskInNewChat,
  onAtMention,
  gitRefreshKey,
  initialDisplayMode,
  initialState,
  onStateChange,
  watchEnabled = true,
  onFileMutated,
}: Props) {
  const { isDark } = useTheme();
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const [data, setData] = useState<FileData | null>(null);
  const [gitDiff, setGitDiff] = useState<GitFileDiffResponse | null>(null);
  const [gitDiffLoading, setGitDiffLoading] = useState(false);
  const [gitDiffResolved, setGitDiffResolved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedInitialDisplayMode = resolveInitialFileDisplayMode(initialState, initialDisplayMode);
  const initialWrapLines = initialState?.wrapLines ?? false;
  const initialScrollTop = initialState?.scrollTop ?? 0;
  const initialScrollLeft = initialState?.scrollLeft ?? 0;
  const [displayMode, setDisplayMode] = useState<DisplayMode>(requestedInitialDisplayMode);
  // Fullscreen support for the whole viewer shell (toolbar + content), so a
  // document can be read or edited without the surrounding panels.
  // "Expand" fills the whole app window now (fork:ui-expand-fullscreen): the shell
  // becomes a fixed overlay via CSS, so nothing else in the layout has to move. Esc
  // exits. The tree column still yields its room underneath, which is what you see
  // again once the overlay closes.
  const [isExpanded, setIsExpanded] = useState(false);
  useEffect(() => {
    if (!isExpanded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // 弹层（设置等）自己会 preventDefault 拿走 Esc，这里不抢。
      if (event.key !== "Escape" || event.defaultPrevented) return;
      setIsExpanded(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isExpanded]);
  const [wrapLines, setWrapLines] = useState(initialWrapLines);
  const [watching, setWatching] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const contentRequestRef = useRef(0);
  const gitDiffRequestRef = useRef(0);
  const loadedFilePathRef = useRef<string | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const liveEditingRef = useRef(false);
  const previousModeRef = useRef(displayMode);
  const defaultPreviewEligibleRef = useRef(
    initialState === undefined && initialDisplayMode === undefined,
  );
  const scrollRestorePendingRef = useRef(true);
  const initialDiffOpen = initialState?.diffOpen === true;
  const [diffOpen, setDiffOpen] = useState(initialDiffOpen);
  const viewerStateRef = useRef<FileViewerState>({
    displayMode: requestedInitialDisplayMode,
    wrapLines: initialWrapLines,
    scrollTop: initialScrollTop,
    scrollLeft: initialScrollLeft,
    diffOpen: initialDiffOpen,
  });
  const onStateChangeRef = useRef(onStateChange);
  const [selectedLineRange, setSelectedLineRange] = useState<SelectedLineRange | null>(null);
  const [selectionAction, setSelectionAction] = useState<PendingFileSelection | null>(null);
  const [fileQuoteInputOpen, setFileQuoteInputOpen] = useState(false);
  const locationHighlightRef = useRef<HTMLElement[]>([]);
  const markdownLocationApiRef = useRef<MarkdownEditorLocationApi | null>(null);
  const [markdownLocationReadyVersion, setMarkdownLocationReadyVersion] = useState(0);

  const handleMarkdownLocationReady = useCallback((api: MarkdownEditorLocationApi | null) => {
    markdownLocationApiRef.current = api;
    setMarkdownLocationReadyVersion((version) => version + 1);
  }, []);

  onStateChangeRef.current = onStateChange;

  const updateDisplayMode = useCallback((nextDisplayMode: DisplayMode) => {
    viewerStateRef.current.displayMode = nextDisplayMode;
    setDisplayMode(nextDisplayMode);
    // Keep the tab's lightweight state current while the viewer remains
    // mounted. A later location request can then reuse the live preview
    // instead of treating its preview mode as a fresh mount.
    onStateChangeRef.current?.({ ...viewerStateRef.current });
  }, []);

  // fork:perf-viewer-two-modes — the HEAD comparison is a view *on top of* the two
  // display modes, not a third one: it is opened from the Git changes panel, the Git
  // graph or the toolbar, and dismissed from its own banner. Keeping it in the tab's
  // persisted state means a restored tab comes back with it still open.
  const updateDiffOpen = useCallback((nextDiffOpen: boolean) => {
    viewerStateRef.current.diffOpen = nextDiffOpen;
    setDiffOpen(nextDiffOpen);
    onStateChangeRef.current?.({ ...viewerStateRef.current });
  }, []);

  const toggleWrapLines = useCallback(() => {
    setWrapLines((current) => {
      const next = !current;
      viewerStateRef.current.wrapLines = next;
      return next;
    });
  }, []);

  useEffect(() => {
    const nextState: FileViewerState = {
      displayMode: requestedInitialDisplayMode,
      wrapLines: initialWrapLines,
      scrollTop: initialScrollTop,
      scrollLeft: initialScrollLeft,
      diffOpen: initialDiffOpen,
    };

    viewerStateRef.current = nextState;
    scrollRestorePendingRef.current = true;
    setDiffOpen(initialDiffOpen);
    setDisplayMode(requestedInitialDisplayMode);
    setWrapLines(initialWrapLines);

    return () => {
      onStateChangeRef.current?.({ ...viewerStateRef.current });
    };
  }, [
    filePath,
    sourceSessionId,
    requestedInitialDisplayMode,
    initialDiffOpen,
    initialWrapLines,
    initialScrollTop,
    initialScrollLeft,
  ]);

  const fetchContent = useCallback((filePath: string, offset = 0) => {
    const requestId = ++contentRequestRef.current;
    return fetch(getFileApiUrl(filePath, "read", sourceSessionId, { offset: offset || undefined }))
      .then((r) => r.json())
      .then((d: FileData & { error?: string }) => {
        if (requestId !== contentRequestRef.current) return null;
        if (d.error) {
          setError(d.error);
          return null;
        }
        setError(null);
        setData((current) => offset && current
          ? { ...d, content: current.content + d.content }
          : d);
        return d;
      })
      .catch((e) => {
        if (requestId !== contentRequestRef.current) return null;
        setError(String(e));
        return null;
      });
  }, [sourceSessionId]);

  const fetchGitDiff = useCallback(async (targetPath: string) => {
    const requestId = ++gitDiffRequestRef.current;
    setGitDiffLoading(true);
    if (!cwd) {
      setGitDiff(null);
      setGitDiffLoading(false);
      setGitDiffResolved(true);
      return;
    }

    try {
      const params = new URLSearchParams({ cwd, path: targetPath });
      const response = await fetch(`/api/git/diff?${params.toString()}`);
      const next = await response.json() as GitFileDiffResponse & { error?: string };
      if (requestId !== gitDiffRequestRef.current) return;
      setGitDiff(response.ok && next.supported && typeof next.patch === "string" ? next : null);
    } catch {
      if (requestId === gitDiffRequestRef.current) setGitDiff(null);
    } finally {
      if (requestId === gitDiffRequestRef.current) {
        setGitDiffLoading(false);
        setGitDiffResolved(true);
      }
    }
  }, [cwd]);

  useEffect(() => {
    if (previousModeRef.current === "preview" && displayMode !== "preview" && getFileExt(filePath) === "md") {
      void fetchContent(filePath);
    }
    previousModeRef.current = displayMode;
  }, [displayMode, fetchContent, filePath]);

  // Reset and load the file itself when its identity changes. Live watching is
  // managed separately so pausing it never clears the displayed content.
  useEffect(() => {
    let active = true;
    const fileChanged = loadedFilePathRef.current !== filePath;
    loadedFilePathRef.current = filePath;
    setLoading(true);
    setError(null);
    // A location request can add a source session id to an already-open file.
    // Keep the current document mounted while that same file is revalidated;
    // clearing it here makes the whole editor flash and jump on first locate.
    if (fileChanged) setData(null);
    setGitDiff(null);
    setGitDiffResolved(false);
    setWatching(false);

    fetchContent(filePath).finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [filePath, fetchContent, sourceSessionId]);

  useEffect(() => {
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    if (!watchEnabled) return;

    const synchronize = () => {
      if (!liveEditingRef.current) void fetchContent(filePath);
      void fetchGitDiff(filePath);
    };

    const es = new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId));
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      // The server emits connected only after its watcher exists. Reading now
      // closes the gap between the last snapshot and live events.
      synchronize();
    });

    es.addEventListener("change", synchronize);

    const markDisconnected = () => {
      setWatching(false);
    };
    es.addEventListener("error", markDisconnected);
    es.onerror = markDisconnected;

    return () => {
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [filePath, fetchContent, fetchGitDiff, sourceSessionId, watchEnabled]);

  useEffect(() => {
    void fetchGitDiff(filePath);
  }, [fetchGitDiff, filePath, gitRefreshKey]);

  useEffect(() => {
    // HTML gets the same rendered-first treatment as markdown: a generated page
    // is usually more useful viewed than read as source. Both have a preview
    // mode already; the source tab stays one click away. A restored choice or
    // explicit mode hint always wins over this default.
    // fork:zc-12 — CSV/TSV 同样默认预览：解析层自带行/列上限与截断标记，
    // 所以 256KB 源截断也不阻止表格预览。
    if (
      defaultPreviewEligibleRef.current
      && data !== null
      && (isDelimitedTextPath(filePath)
        || (!data.truncated && (data.language === "markdown" || data.language === "html")))
    ) {
      defaultPreviewEligibleRef.current = false;
      updateDisplayMode("preview");
    }
  }, [data, filePath, updateDisplayMode]);

  const hasGitDiff = gitDiff?.supported === true && typeof gitDiff.patch === "string";
  const isDeletedDiff = hasGitDiff && gitDiff.status === "deleted";

  const viewerContent = data?.content ?? "";
  const sourceLines = useMemo(() => viewerContent.split("\n"), [viewerContent]);
  const language = data?.language ?? "text";
  const isHtml = language === "html";
  const isMarkdown = language === "markdown";
  // fork:zc-12 — .csv/.tsv 的表格预览（与 language 无关，语言映射里它们是 text）。
  const isDelimitedText = isDelimitedTextPath(filePath);
  const hasPreview = !data?.truncated && (isHtml || isMarkdown);
  const effectiveDisplayMode = displayMode;
  // fork:perf-viewer-keepalive — source / preview / diff are mounted on first visit
  // and then kept, with `hidden` doing the switching. Unmounting them on every toggle
  // threw away Prism's token tree, the markdown parse and the diff DOM, so each return
  // paid to rebuild it (Prism alone is ~130ms for a 2800-line file). This mirrors the
  // reference file view, which never destroys its editor and toggles `display: none`.
  // Adjust-during-render keeps the first paint of a newly selected stage in the same
  // commit — an effect would render an empty frame first.
  const [mountedStages, setMountedStages] = useState<readonly DisplayMode[]>(
    () => [requestedInitialDisplayMode],
  );
  if (!mountedStages.includes(effectiveDisplayMode)) {
    setMountedStages([...mountedStages, effectiveDisplayMode]);
  }
  // fork:perf-viewer-two-modes — Source is the only writing surface, so the live
  // editor is the *surface of one stage* rather than a mode of its own. It used to sit
  // above the stages in the exclusive chain, which unmounted and rebuilt a ProseMirror
  // document on every Source↔Preview toggle (~1.6s for a 27KB markdown file). Preview is
  // a read-only render now; markdown included, which is also why `.md` gained an
  // editable source view instead of only a WYSIWYG one.
  const useCodeEditor = !isMobile && data?.editable === true && !data.truncated
    && !isDeletedDiff;
  const liveEditing = useCodeEditor && effectiveDisplayMode === "source";
  liveEditingRef.current = liveEditing;

  useEffect(() => () => {
    for (const element of locationHighlightRef.current) element.classList.remove(LOCATION_HIGHLIGHT_CLASS);
    markdownLocationApiRef.current?.clearLocation();
    clearLocationTextHighlight();
    locationHighlightRef.current = [];
  }, []);

  // A file annotation stays in the viewer's current mode. Markdown preview and
  // editing are one persistent instance, so navigation must wait for that
  // instance's DOM instead of switching modes and remounting it.
  useEffect(() => {
    if (!locationTarget || !data || loading || error) return;

    let cancelled = false;
    let frame: number | null = null;
    let attempts = 0;
    let observer: MutationObserver | null = null;
    let locationVisible = false;
    const MAX_LOCATION_ATTEMPTS = 120;

    const stopObserver = () => {
      observer?.disconnect();
      observer = null;
    };

    const finishLocation = (handled: boolean) => {
      stopObserver();
      locationVisible = false;
      for (const element of locationHighlightRef.current) element.classList.remove(LOCATION_HIGHLIGHT_CLASS);
      markdownLocationApiRef.current?.clearLocation();
      clearLocationTextHighlight();
      locationHighlightRef.current = [];
      if (handled) onLocationHandled?.(locationTarget);
      else onLocationFailed?.(locationTarget);
    };

    const completeLocation = (elements: HTMLElement[], editorOwnsHighlight = false) => {
      stopObserver();
      locationVisible = true;
      for (const element of locationHighlightRef.current) element.classList.remove(LOCATION_HIGHLIGHT_CLASS);
      if (editorOwnsHighlight) {
        // The ProseMirror editor owns its block DOM. It applies and clears the
        // class itself so the parent effect cannot remove it during the
        // location callback or when the pending target is consumed.
        locationHighlightRef.current = [];
      } else {
        for (const element of elements) element.classList.add(LOCATION_HIGHLIGHT_CLASS);
        locationHighlightRef.current = elements;
      }
    };

    const dismissOnPointerDown = (event: PointerEvent) => {
      if (event.button === 0 && locationVisible) finishLocation(true);
    };
    const dismissOnKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && locationVisible) finishLocation(true);
    };
    document.addEventListener("pointerdown", dismissOnPointerDown, true);
    document.addEventListener("keydown", dismissOnKeyDown, true);

    const locate = () => {
      if (cancelled) return;
      const root = contentRef.current;
      if (!root) {
        if (attempts++ < MAX_LOCATION_ATTEMPTS) frame = window.requestAnimationFrame(locate);
        else finishLocation(false);
        return;
      }

      // A live editor is dynamically imported and owns its own location API.
      // Keep the request pending until its reveal API is ready instead of
      // treating a slow import as a failed location.
      if (liveEditing && !markdownLocationApiRef.current) {
        frame = window.requestAnimationFrame(locate);
        return;
      }

      // Observe the short mounting window so a slow dynamic import or a late
      // editor DOM update cannot consume the location request.
      if (!observer && typeof MutationObserver !== "undefined") {
        observer = new MutationObserver(() => locate());
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["data-source-line", "data-source-start-line", "data-source-end-line"],
        });
      }

      // Location navigation should behave like conversation navigation: it
      // highlights the target without creating a native text selection (and
      // therefore without opening the selection action popover).
      window.getSelection()?.removeAllRanges();

      const lines = data.content.split("\n");
      const requestedStart = Number.isInteger(locationTarget.startLine) ? locationTarget.startLine! : 0;
      const requestedEnd = Number.isInteger(locationTarget.endLine) ? locationTarget.endLine! : requestedStart;
      let startLine = requestedStart;
      let endLine = requestedEnd;
      const snapshot = (locationTarget.text ?? "").trim();
      // The snapshot comes from rendered Preview text, while `data.content`
      // still contains Markdown syntax (and may have different soft-breaks).
      // A valid line hint must therefore not be rejected just because the raw
      // source does not literally contain the rendered snapshot. Doing so
      // previously fell back to the first global text match, which was wrong
      // whenever the same phrase appeared more than once.
      const hasValidLineRange = startLine > 0 && endLine >= startLine && startLine <= lines.length;
      if (!hasValidLineRange && snapshot) {
        const match = data.content.indexOf(snapshot);
        if (match >= 0) {
          startLine = data.content.slice(0, match).split("\n").length;
          endLine = startLine + snapshot.split("\n").length - 1;
        }
      }

      let elements: HTMLElement[] = [];
      if (liveEditing) {
        elements = markdownLocationApiRef.current?.revealLocation({
          text: snapshot,
          startLine,
          endLine,
        }) ?? [];
        if (elements.length > 0) {
          completeLocation(elements, true);
          return;
        }
      } else if (isMarkdown && effectiveDisplayMode === "preview") {
        const sourceLineElements = Array.from(root.querySelectorAll<HTMLElement>(".markdown-source-line[data-source-line]"));
        const sourceRangeElements = Array.from(root.querySelectorAll<HTMLElement>("[data-source-start-line][data-source-end-line]")).filter((element) => {
          const blockStart = Number(element.dataset.sourceStartLine);
          const blockEnd = Number(element.dataset.sourceEndLine);
          return Number.isInteger(blockStart) && Number.isInteger(blockEnd)
            && (!startLine || blockEnd >= startLine) && (!endLine || blockStart <= endLine);
        });
        const outerSourceRangeElements = sourceRangeElements.filter((element) =>
          !element.parentElement?.closest("[data-source-start-line][data-source-end-line]"),
        );
        if (startLine > 0 && endLine >= startLine) {
          elements = sourceLineElements.filter((element) => {
            const line = Number(element.dataset.sourceLine);
            return Number.isInteger(line) && line >= startLine && line <= endLine;
          });
        }
        // Older rendered nodes and complex blocks may not expose per-line
        // spans. Keep the previous block-range behavior as a safe fallback.
        if (elements.length === 0) elements = outerSourceRangeElements;
        if (elements.length === 0 && snapshot) {
          elements = Array.from(root.querySelectorAll<HTMLElement>("[data-source-start-line][data-source-end-line]"))
            .filter((element) => !element.parentElement?.closest("[data-source-start-line][data-source-end-line]"))
            .filter((element) => findLocationTextRange(element, snapshot) !== null);
        }

        // Line metadata chooses the right block; the rendered text range then
        // chooses the exact phrase inside that block. This is what makes a
        // multiline paragraph or formatted text land at the actual selection
        // instead of merely centering the paragraph's first line.
        const textCandidates = outerSourceRangeElements.length > 0 ? outerSourceRangeElements : elements;
        const locationRange = snapshot ? findLocationTextRangeInRoots(textCandidates, snapshot) : null;
        if (locationRange && scrollLocationRangeIntoView(root, locationRange)) {
          completeLocation(elements);
          return;
        }
      } else if (!diffOpen && effectiveDisplayMode === "source" && startLine > 0) {
        elements = Array.from({ length: Math.max(1, endLine - startLine + 1) }, (_, index) =>
          root.querySelector<HTMLElement>(`.file-source-line[data-line-number=\"${startLine + index}\"]`),
        ).filter((element): element is HTMLElement => Boolean(element));
      }

      const first = elements[0];
      if (!first) {
        if (attempts++ < MAX_LOCATION_ATTEMPTS) {
          frame = window.requestAnimationFrame(locate);
        } else {
          finishLocation(false);
        }
        return;
      }
      const scroller = first.closest<HTMLElement>(".file-viewer-content") ?? root;
      const firstRect = first.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const padding = Math.min(48, Math.max(16, scroller.clientHeight * 0.2));
      const visibleTop = scrollerRect.top + padding;
      const visibleBottom = scrollerRect.bottom - padding;
      if (firstRect.top < visibleTop || firstRect.bottom > visibleBottom) {
        scroller.scrollBy({
          top: (firstRect.top + firstRect.bottom) / 2 - (scrollerRect.top + scrollerRect.bottom) / 2,
          behavior: "auto",
        });
      }
      completeLocation(elements);
    };

    frame = window.requestAnimationFrame(locate);
    return () => {
      cancelled = true;
      stopObserver();
      document.removeEventListener("pointerdown", dismissOnPointerDown, true);
      document.removeEventListener("keydown", dismissOnKeyDown, true);
      if (frame !== null) window.cancelAnimationFrame(frame);
      for (const element of locationHighlightRef.current) element.classList.remove(LOCATION_HIGHLIGHT_CLASS);
      markdownLocationApiRef.current?.clearLocation();
      clearLocationTextHighlight();
      locationHighlightRef.current = [];
    };
  }, [
    data,
    diffOpen,
    displayMode,
    effectiveDisplayMode,
    error,
    isMarkdown,
    liveEditing,
    loading,
    locationTarget,
    markdownLocationReadyVersion,
    onLocationFailed,
    onLocationHandled,
  ]);

  // fork:perf-viewer-two-modes — Source is the only writer, so its completed saves have
  // to update the viewer's own copy: otherwise the read-only Preview beside it keeps
  // rendering the pre-edit text. A refetch would work too, but the watch stream is
  // deliberately skipped while an editor is live, and the buffer is already in hand here.
  const handleEditorContentSaved = useCallback((nextContent: string) => {
    setData((current) => {
      if (!current || current.content === nextContent) return current;
      return {
        ...current,
        content: nextContent,
        size: new TextEncoder().encode(nextContent).byteLength,
        nextOffset: 0,
        truncated: false,
      };
    });
  }, []);

  const handleEditorSelectionChange = useCallback((selection: MarkdownEditorSelection | null) => {
    if (!selection) {
      setSelectedLineRange(null);
      setSelectionAction(null);
      return;
    }
    setSelectedLineRange({ startLine: selection.startLine, endLine: selection.endLine });
    setSelectionAction(selection);
  }, []);

  const highlighterReady = useHighlighterReady();
  // fork:perf-highlighter — `!highlighterReady` reuses the huge-file fallback: same line
  // numbers and layout, no tokens, and it is replaced by the highlighted view as soon as
  // the lazily imported Prism chunk arrives.
  // fork:perf-viewer-keepalive — this used to also go `false` while diff/preview was on
  // screen, to skip building the source rows the user could not see. The source view now
  // stays mounted across mode switches (see the content area below), so that clause is
  // gone: the rows are built once and survive instead of being rebuilt on every return.
  const useLightweightSource = !highlighterReady || sourceLines.length > SOURCE_HIGHLIGHT_MAX_LINES;
  // react-syntax-highlighter rebuilds every token element on each render, which
  // costs hundreds of milliseconds on large files. Cache the rendered trees so
  // unrelated re-renders (panel open/close, selection changes) reuse them as-is.
  // fork:perf-highlighter — the Prism chunk is not part of the initial bundle any more,
  // so a file that is opened before it lands renders through the lightweight line view
  // below (same styles, no tokens) and is upgraded in place once it arrives.
  const highlightedSource = useMemo(
    () => (
      <LazyFileSourceView
        code={viewerContent}
        language={language}
        isDark={isDark}
        wrapLines={wrapLines}
      />
    ),
    [isDark, language, viewerContent, wrapLines],
  );
  const lightweightSourceLines = useMemo(
    () => useLightweightSource ? sourceLines.map((line, lineIndex) => (
      <span
        className="file-source-line"
        data-line-number={lineIndex + 1}
        key={`source-line-${lineIndex}`}
        style={{ display: "flex", minWidth: "100%" }}
      >
        <span aria-hidden="true" style={FILE_LINE_NUMBER_STYLE}>
          {lineIndex + 1}
        </span>
        <span
          className="file-source-line-content"
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            overflowWrap: wrapLines ? "anywhere" : "normal",
            whiteSpace: wrapLines ? "pre-wrap" : "pre",
          }}
        >
          {line}
        </span>
      </span>
    )) : null,
    [sourceLines, useLightweightSource, wrapLines],
  );

  useEffect(() => {
    const updateSelectedLineRange = () => {
      if (locationTarget && sameFilePath(locationTarget.filePath, filePath)) {
        setSelectedLineRange(null);
        setSelectionAction(null);
        return;
      }
      const root = contentRef.current;
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const supportsDomSelection = !diffOpen
        && (displayMode === "source" || (isMarkdown && effectiveDisplayMode === "preview" && !liveEditing));
      if (fileQuoteInputOpen) return;
      if (liveEditing) return;
      const lineRange = onMentionLines && supportsDomSelection && root
        ? displayMode === "source"
          ? getSelectedSourceLineRange(root, selection)
          : getSelectedMarkdownLineRange(root, selection)
        : null;
      setSelectedLineRange((current) => {
        const next = lineRange;
        // Skip no-op updates: selectionchange fires continuously while dragging,
        // and a fresh-but-equal range object would re-render the whole viewer.
        if (current === null && next === null) return current;
        if (current && next && current.startLine === next.startLine && current.endLine === next.endLine) return current;
        return next;
      });
      if (!onMentionLines || !supportsDomSelection || !root || !range) {
        setSelectionAction(null);
        return;
      }
      const text = selection?.toString().trim();
      if (!lineRange || !text) {
        setSelectionAction(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setSelectionAction((current) => {
        const next = {
          ...lineRange,
          text,
          top: Math.min(window.innerHeight - 44, rect.bottom + 8),
          left: Math.max(8, Math.min(window.innerWidth - 8, rect.left + rect.width / 2)),
        };
        return current
          && current.startLine === next.startLine
          && current.endLine === next.endLine
          && current.text === next.text
          && current.top === next.top
          && current.left === next.left
          ? current
          : next;
      });
    };

    updateSelectedLineRange();
    const supportsDomSelection = !diffOpen
      && (displayMode === "source" || (isMarkdown && effectiveDisplayMode === "preview" && !liveEditing));
    if (!onMentionLines || !supportsDomSelection) return;

    document.addEventListener("selectionchange", updateSelectedLineRange);
    return () => document.removeEventListener("selectionchange", updateSelectedLineRange);
  }, [data?.content, diffOpen, displayMode, effectiveDisplayMode, filePath, fileQuoteInputOpen, isMarkdown, liveEditing, locationTarget, onMentionLines]);

  const addFileSelection = useCallback((lineRange: SelectedLineRange | null, text: string) => {
    if (!onMentionLines || !lineRange) return;
    if (!text) return;
    onMentionLines({
      relativePath: getRelativeFilePath(filePath, cwd),
      filePath,
      sourceSessionId,
      text,
      startLine: lineRange.startLine,
      endLine: lineRange.endLine,
      language: data?.language,
    });
  }, [cwd, data?.language, filePath, onMentionLines, sourceSessionId]);

  const mentionLineRange = useCallback((lineRange: SelectedLineRange | null) => {
    const text = selectionAction
      && lineRange
      && selectionAction.startLine === lineRange.startLine
      && selectionAction.endLine === lineRange.endLine
      ? selectionAction.text
      : window.getSelection()?.toString().trim() ?? "";
    addFileSelection(lineRange, text);
  }, [addFileSelection, selectionAction]);

  const clearFileSelection = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelectionAction(null);
  }, []);

  const addSelectedFileContext = useCallback(() => {
    if (!selectionAction) return;
    addFileSelection(selectionAction, selectionAction.text);
    clearFileSelection();
  }, [addFileSelection, clearFileSelection, selectionAction]);

  useEffect(() => {
    if (!onMentionLines || displayMode !== "source") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.key.toLowerCase() !== "i" || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return;

      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")
        && !target.closest(".cm-editor")) return;

      const root = contentRef.current;
      const lineRange = liveEditing
        ? selectedLineRange
        : root ? getSelectedSourceLineRange(root, window.getSelection()) : null;
      if (!lineRange) return;

      event.preventDefault();
      mentionLineRange(lineRange);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [displayMode, liveEditing, mentionLineRange, onMentionLines, selectedLineRange]);

  useEffect(() => {
    if (!scrollRestorePendingRef.current || loading) return;
    if (error && !isDeletedDiff) return;
    // The comparison overlay renders in place of the stages, so restore the
    // scroll only once it is either closed or has its patch.
    if (diffOpen && !gitDiffResolved) return;

    const content = contentRef.current;
    if (!content) return;

    content.scrollTop = viewerStateRef.current.scrollTop;
    content.scrollLeft = viewerStateRef.current.scrollLeft;
    scrollRestorePendingRef.current = false;
  }, [
    data?.content,
    diffOpen,
    displayMode,
    error,
    gitDiffResolved,
    isDeletedDiff,
    loading,
  ]);

  if ((loading && !data) || (diffOpen && gitDiffLoading && !data)) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: TEXT.md }}>
        {t("i18n.loading")}
      </div>
    );
  }

  if (error && !isDeletedDiff) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--danger)", fontSize: TEXT.md }}>
        {error}
      </div>
    );
  }

  if (!data && !isDeletedDiff) return null;

  const content = viewerContent;
  const lines = sourceLines;
  const displayModes: DisplayMode[] = [
    "source",
    ...(hasPreview || isDelimitedText ? ["preview" as const] : []),
  ];
  // The comparison overlay replaces the file content, so it only needs the metadata
  // line to say so; it is no longer one of the switchable display modes.
  const metadata = data === null
    ? t("files.deleted")
    : `${language} · ${lines.length} lines · ${formatSize(data.size)}`;

  return (
    <div data-expanded={isExpanded || undefined} className="file-viewer-shell" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* fork:design-system SW-04 —— 头行 = 画板 30/52 的 pw-viewer-head：
          pw-ico + pw-mono 路径 + pw-badge 元信息 + 6px 同步点 + grow + 动作区。 */}
      <div className="pw-viewer-head" style={{ flexShrink: 0 }}>
        <span className="file-viewer-path pw-mono" title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>

        <span className="file-viewer-meta pw-badge" title={metadata}>{metadata}</span>
        {!isDeletedDiff && (
          <span
            title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
            aria-label={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
            className={`pw-live${watching ? " on" : ""}`}
          />
        )}

        <div className="file-viewer-controls">
          {/* fork:ui-20 — copy path / reveal in the file manager / open with the default app. */}
          <PathActions path={filePath} compact />
          {displayModes.length > 1 && (
            <div className="file-viewer-mode-switch" aria-label={t("i18n.fileViewMode")}>
              {displayModes.map((mode) => {
                const active = !diffOpen && effectiveDisplayMode === mode;
                // 画板 52 帧 D：当前模式是 accent 徽章，其余模式才是可点按钮。
                return active ? (
                  <span key={mode} className="pw-badge accent">{DISPLAY_MODE_LABELS[mode]}</span>
                ) : (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      updateDisplayMode(mode);
                      if (diffOpen) updateDiffOpen(false);
                    }}
                    className="pw-btn sm"
                  >
                    {DISPLAY_MODE_LABELS[mode]}
                  </button>
                );
              })}
            </div>
          )}
          {/* fork:perf-viewer-two-modes — the HEAD comparison is an action that opens an
              overlay, not a third mode, so it sits next to the switch instead of inside
              it. Only offered when the file actually has a comparison to show. */}
          {(hasGitDiff || isDeletedDiff) && (
            <button
              type="button"
              onClick={() => updateDiffOpen(!diffOpen)}
              title={t("files.compareHead")}
              aria-label={t("files.compareHead")}
              aria-pressed={diffOpen}
              className="pw-btn sm"
              style={diffOpen ? { background: "var(--accent-soft)", borderColor: "var(--accent)", color: "var(--accent-text)" } : undefined}
            >
              <span className="pw-ico"><i data-ico="git-compare" data-size="13"></i></span>
              {t("files.compareHead")}
            </button>
          )}

          <div className="file-viewer-actions">
            {(onAtMention || onMentionLines) && (
              <button
                type="button"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => {
                  // Mention selected lines when a range is active (and line
                  // mention is wired up); otherwise fall back to a whole-file
                  // @mention. Same button, behavior follows the selection.
                  if (selectedLineRange && onMentionLines) {
                    mentionLineRange(selectedLineRange);
                  } else {
                    onAtMention?.(getRelativeFilePath(filePath, cwd), false);
                  }
                }}
                title={
                  selectedLineRange && onMentionLines
                    ? `${t("i18n.mentionSelectedLines")} (L${selectedLineRange.startLine}${selectedLineRange.startLine !== selectedLineRange.endLine ? `-L${selectedLineRange.endLine}` : ""})`
                    : t("files.insertPath")
                }
                aria-label={t("files.mention")}
                disabled={!onAtMention && !onMentionLines}
                className="pw-iconbtn sm"
              >
                <MentionIcon />
              </button>
            )}
            <button
              type="button"
              className="pw-iconbtn sm"
              title={t(isExpanded ? "files.collapse" : "files.expand")}
              aria-label={t(isExpanded ? "files.collapse" : "files.expand")}
              aria-pressed={isExpanded}
              onClick={() => setIsExpanded((value) => !value)}
            >
              {/* fork:ui-expand — ⤢ 把文档铺满整个应用窗口（原来的 Fullscreen API 按钮已并入这里）。 */}
              <span className="pw-ico"><i data-ico={isExpanded ? "minimize-2" : "maximize-2"} data-size="14"></i></span>
            </button>
            {!liveEditing && !diffOpen && effectiveDisplayMode === "source" && (
              <>
                <button
                  type="button"
                  onClick={toggleWrapLines}
                  title={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
                  aria-label={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
                  aria-pressed={wrapLines}
                  className="pw-iconbtn sm"
                  style={{
                    background: wrapLines ? "var(--bg-selected)" : "transparent",
                    color: wrapLines ? "var(--text)" : "var(--text-muted)",
                  }}
                >
                  {/* icons.js 未注册 wrap-text（lucide 官名 text-wrap），此处保留内联 lucide 路径 —— 登记图标集缺口 */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 6h18" />
                    <path d="M3 12h15a3 3 0 1 1 0 6h-4" />
                    <path d="m16 16-2 2 2 2" />
                    <path d="M3 18h7" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {!isDeletedDiff && <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />}
        </div>
      </div>

      {data?.truncated && (
        <div
          className="file-viewer-load-more"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: "5px 8px",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            color: "var(--text-dim)",
            fontSize: TEXT.xs,
          }}
        >
          <span>{formatSize(data.nextOffset)} / {formatSize(data.size)}</span>
          <button
            type="button"
            className="file-viewer-mode-button"
            disabled={loadingMore}
            onClick={() => {
              setLoadingMore(true);
              void fetchContent(filePath, data.nextOffset).finally(() => setLoadingMore(false));
            }}
          >
            {loadingMore ? t("i18n.loading") : t("i18n.loadMore")}
          </button>
        </div>
      )}

      {/* Content area */}
      <div
        ref={contentRef}
        className="file-viewer-content"
        onScroll={(event) => {
          viewerStateRef.current.scrollTop = event.currentTarget.scrollTop;
          viewerStateRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        style={{ flex: 1, overflow: "auto", background: "var(--bg)", paddingBottom: data?.truncated ? 48 : undefined }}
      >
        {shouldShowUnsupportedCard(filePath) ? (
          // fork:gap-unsupported-preview — 二进制/未知类型不再以文本呈现（那是乱码），
          // 改为带元数据与"用默认应用打开"的卡片。
          <UnsupportedFilePreview
            filePath={filePath}
            cwd={cwd}
            size={typeof data?.size === "number" ? data.size : null}
            sourceSessionId={sourceSessionId}
          />
        ) : (
          // fork:perf-viewer-keepalive — 展示态并存，`hidden` 做切换。
          //
          // 每个 stage 首次被选中时才挂载，之后就常驻：回到源码不再重跑 Prism，
          // 回到预览不再重新解析 markdown。不支持预览的卡片仍是互斥覆盖层，上面的
          // 分支已处理。
          // fork:perf-viewer-two-modes — HEAD 对比是盖在两者之上的覆盖层（`diffOpen`），
          // 所以打开它时把 stage 遮蔽而不是卸载：关掉对比后编辑器还要原样回来。
          <>
            {data !== null && mountedStages.includes("source") && (
              <div data-file-stage="source" hidden={diffOpen || effectiveDisplayMode !== "source"} style={{ height: "100%", minHeight: 0 }}>
                {/* fix:viewer-stage-fill —— 这一层必须**自己给高度**。`CodeFileEditor` 的根是
                    `.pw-viewer`（flex 列 + `height: 100%`），而本层原来是 auto 高度，
                    于是 100% 落回 auto：编辑器只剩内容高，底栏（Ln/Col · EOL · UTF-8）
                    浮在面板中间，下面留一大片空白（用户实测：「编辑页面为啥下面空白那么多」）。
                    只给 source 层高度：preview 层里的 markdown 是**随内容长**的，
                    高度锁 100% 会让长文档再也滚不动。 */}
                {useCodeEditor ? (
                  <CodeFileEditor
                    filePath={filePath}
                    content={content}
                    sourceSessionId={sourceSessionId}
                    watchEnabled={watchEnabled}
                    initialScrollTop={initialScrollTop}
                    initialScrollLeft={initialScrollLeft}
                    hasPendingLocation={Boolean(locationTarget)}
                    active={effectiveDisplayMode === "source"}
                    onScrollPositionChange={({ scrollTop, scrollLeft }) => {
                      viewerStateRef.current.scrollTop = scrollTop;
                      viewerStateRef.current.scrollLeft = scrollLeft;
                      onStateChangeRef.current?.({ ...viewerStateRef.current });
                    }}
                    onLocationReady={handleMarkdownLocationReady}
                    onSelectionChange={handleEditorSelectionChange}
                    onContentSaved={handleEditorContentSaved}
                  />
                ) : useLightweightSource ? (
                  <div
                    className="file-source-view is-lightweight"
                    style={{
                      width: wrapLines ? "100%" : "max-content",
                      minWidth: "100%",
                      minHeight: "100%",
                      background: "var(--bg)",
                      ...FILE_CODE_STYLE,
                    }}
                  >
                    {lightweightSourceLines}
                  </div>
                ) : (
                  highlightedSource
                )}
              </div>
            )}
            {(hasPreview || isDelimitedText) && mountedStages.includes("preview") && (
              <div data-file-stage="preview" hidden={diffOpen || effectiveDisplayMode !== "preview"}>
                {isHtml ? (
                  <iframe
                    srcDoc={content}
                    sandbox="allow-scripts"
                    style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
                    title={t("i18n.htmlPreview")}
                  />
                ) : isMarkdown ? (
                  <div className="markdown-body markdown-file-preview markdown-readable-column" style={{ padding: "24px 32px" }}>
                    <MarkdownFilePreview content={content} filePath={filePath} cwd={cwd}
                      sourceSessionId={sourceSessionId} onOpenFile={onOpenFile}
                      sourceLines={Boolean(locationTarget)} />
                  </div>
                ) : (
                  // fork:zc-12 — CSV/TSV 表格预览（行窗口化、ragged/截断提示都在组件内）。
                  <CsvPreview content={content} filePath={filePath} sourceTruncated={data?.truncated === true} />
                )}
              </div>
            )}
            {/* A deleted file has no content to render behind the overlay, so say what
                happened instead of leaving an empty pane when the comparison is closed. */}
            {data === null && isDeletedDiff && !diffOpen && (
              <div className="file-viewer-deleted-notice pw-prow pw-desc" role="status">{t("files.deletedNotice")}</div>
            )}
            {diffOpen && (
              <div className="file-viewer-diff-overlay">
                {/* fork:design-system SW-05 —— 覆盖层横幅 = pw-viewer-head 变体（ico + 文案 + grow + pw-btn sm）。 */}
                <div className="file-viewer-diff-banner pw-viewer-head" role="status">
                  <span className="pw-ico"><i data-ico={isDeletedDiff ? "file-diff" : "git-compare"} data-size="14"></i></span>
                  <span>{isDeletedDiff ? t("files.deletedNotice") : t("files.compareHead")}</span>
                  <span className="grow" />
                  <button
                    type="button"
                    onClick={() => updateDiffOpen(false)}
                    className="pw-btn sm"
                  >
                    {t("files.backToSource")}
                  </button>
                </div>
                {hasGitDiff
                  ? <DiffView patch={gitDiff.patch!} />
                  : <div style={{ padding: "12px 16px", fontSize: TEXT.sm, color: "var(--text-dim)" }}>{t("i18n.loading")}</div>}
              </div>
            )}
          </>
        )}
      </div>
      {selectionAction && !locationTarget && onMentionLines && (
        <FileSelectionQuotePopover
          top={selectionAction.top}
          left={selectionAction.left}
          mentionText={buildFileLineMentionText(getRelativeFilePath(filePath, cwd), selectionAction.startLine, selectionAction.endLine)}
          onAskInCurrent={addSelectedFileContext}
          onAskInNewChat={onAskInNewChat}
          onClose={clearFileSelection}
          onInputOpenChange={setFileQuoteInputOpen}
        />
      )}
    </div>
  );
}
