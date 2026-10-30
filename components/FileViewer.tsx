"use client";

import { useEffect, useState, useRef, useCallback, useMemo, type CSSProperties, type MouseEvent } from "react";
import type { SyntaxHighlighterProps } from "react-syntax-highlighter";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light";
import renderSyntaxNode from "react-syntax-highlighter/dist/esm/create-element";
import { vs } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";
import ReactMarkdown from "react-markdown";
import { useTheme } from "@/hooks/useTheme";
import { usePrismLanguages } from "@/hooks/usePrismLanguages";
import {
  DOCX_PREVIEW_MAX_BYTES,
  HTML_PREVIEW_MAX_BYTES,
  getFileExt,
  isAudioPath,
  isDocumentPreviewPath,
  isImagePath,
  isVideoPath,
} from "@/lib/file-types";
import { encodeFilePathForApi, getFileDirectory, getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { fileVersion, fileVersionChanged } from "@/lib/file-version";
import { HIDDEN_PAGE_GRACE_MS, usePageHiddenFor } from "@/hooks/usePageHidden";
import { pageId, trackEventSource } from "@/lib/page-debug";
import { parsePdfPageFragment, resolveLocalFileHref, shouldOpenLocalFileInApp } from "@/lib/file-links";
import { parseFrontmatter } from "@/lib/frontmatter";
import { isExternalMarkdownHref, jumpToMarkdownFragment, markdownAppUrlTransform, markdownPreviewRehypePlugins, markdownPreviewRemarkPlugins, markdownUrlTransform, normalizeDisplayMath } from "@/lib/markdown";
import { CodeBlock, MermaidBlock } from "./MermaidBlock";
import { DelimitedTable } from "./DelimitedTable";
import { isDelimitedTablePath } from "@/lib/delimited-table";
import { FrontmatterCard } from "./FrontmatterCard";
import { diffGapLabel, parseUnifiedPatch, unifiedDiffLines, type SplitDiffGap, type UnifiedDiffLine } from "@/lib/patch";
import type { GitFileDiffResponse } from "@/lib/git-types";
import { useI18n } from "@/hooks/useI18n";
import {
  resolveInitialFileDisplayMode,
  type FileViewerDisplayMode as DisplayMode,
  type FileViewerState,
} from "@/lib/file-viewer-state";

export type { FileViewerState } from "@/lib/file-viewer-state";

interface Props {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string, page?: number) => void;
  onMentionLines?: (relativePath: string, startLine: number, endLine: number) => void;
  /** Insert this file's relative path into the chat input (@ mention). */
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  gitRefreshKey?: number;
  initialDisplayMode?: DisplayMode;
  /** PDF page to open on first render (`#page=N` from a markdown link). */
  initialPage?: number;
  initialState?: FileViewerState;
  onStateChange?: (state: FileViewerState) => void;
  watchEnabled?: boolean;
}

interface FileData {
  content: string;
  language: string;
  size: number;
  nextOffset: number;
  truncated: boolean;
  // A NUL in the first bytes (lib/text-preview.ts): no text view, only the download.
  binary?: boolean;
}

const SOURCE_HIGHLIGHT_MAX_LINES = 1_000;
const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
  source: "Source",
  preview: "Preview",
  diff: "Diff",
};

const FILE_CODE_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontWeight: "var(--font-mono-weight)",
  fontSize: 13,
  lineHeight: 1.6,
};

// Prism's light theme colors <pre> with backgroundColor, its dark theme with
// the background shorthand. The source view sets backgroundColor itself and the
// dark theme's shorthand is dropped, as CodeBlock does: a theme switch then never
// makes React remove one beside the other (it warned, and the view lost its
// background).
const fileViewerDarkTheme = {
  ...vscDarkPlus,
  'pre[class*="language-"]': {
    ...vscDarkPlus['pre[class*="language-"]'],
  },
};
delete fileViewerDarkTheme['pre[class*="language-"]'].background;

// `lineHeight` is FILE_CODE_STYLE's 13px * 1.6, so both columns share one line
// box; a code-font change must move it with fontSize.
// 画板 `.cline__no` 的栏位：34 宽、右对齐、只读。底色仍是内容区的 --bg，
// 因为横向滚动时这一栏 `position: sticky` 钉在左缘，底下要挡住滑过的正文。
const FILE_LINE_NUMBER_STYLE: CSSProperties = {
  width: 34,
  minWidth: 34,
  padding: 0,
  textAlign: "right",
  color: "var(--ink-4)",
  background: "var(--bg)",
  fontFamily: "var(--font-mono)",
  fontWeight: "var(--font-mono-weight)",
  fontSize: 11,
  fontStyle: "normal",
  fontVariantNumeric: "tabular-nums",
  lineHeight: "20.8px",
  userSelect: "none",
  flexShrink: 0,
  verticalAlign: "top",
};

// The gutter stays put while a wide line scrolls sideways: `position: sticky`
// against the viewer's own scrolling box (`.file-viewer-content`; the
// highlighted <pre> sets `overflow: visible`, so it is the nearest scroller in
// every view). It has room to travel because every row spans the widest line
// (the <pre> or wrapper is `width: max-content` and a row is `min-width:
// 100%`), so no line's number scrolls away behind its text.
// The browser repositions every sticky number on each scroll, vertical too, so
// only views of at most SOURCE_HIGHLIGHT_MAX_LINES rows pin it: the highlighted
// Source view and a diff that short. Pinned, a 24,000-line log in the plain
// fallback scrolled with 50-67 ms frames; it and longer diffs keep the plain
// gutter.
const FILE_PINNED_LINE_NUMBER_STYLE: CSSProperties = {
  ...FILE_LINE_NUMBER_STYLE,
  position: "sticky",
  left: 0,
  zIndex: 1,
};

type SourceCodeRendererProps = Parameters<NonNullable<SyntaxHighlighterProps["renderer"]>>[0] & {
  wrapLines: boolean;
};

interface SelectedLineRange {
  startLine: number;
  endLine: number;
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

// 画板的五个 token 色（running.css 的 `.tok-*`）就是这套皮肤的高亮主题：
// 只把 Prism 的这五类 token 映射到对应类名，其余 token 不上色、继承正文色。
// 引擎没换（还是 react-syntax-highlighter + Prism），只是不再走 vs / vscDarkPlus
// 的内联色 —— 那两套主题的写死色和 v3 令牌对不上，且切主题时会闪。
const BOARD_TOKEN_CLASS: Record<string, string> = {
  keyword: "tok-kw",
  string: "tok-str",
  number: "tok-num",
  comment: "tok-com",
  function: "tok-fn",
};

type CodeNode = Parameters<typeof renderSyntaxNode>[0]["node"];

// 把一棵 Prism 节点树里的 token 类名换成 `.tok-*`；行号节点由调用方单独处理，
// 不进这里（它带着 `comment` / `linenumber`，映射了会变斜体灰字）。
function withBoardTokenClasses(node: CodeNode): CodeNode {
  if (node.type === "text" || !node.children) return node;
  const classes = node.properties?.className;
  const mapped = Array.isArray(classes)
    ? classes.map((name) => BOARD_TOKEN_CLASS[name]).filter((name): name is string => Boolean(name))
    : undefined;
  return {
    ...node,
    properties: { ...node.properties, className: mapped ?? [] },
    children: node.children.map(withBoardTokenClasses),
  };
}

function SourceCodeRenderer({ rows, stylesheet, wrapLines }: SourceCodeRendererProps) {
  return rows.map((row, lineIndex) => {
    const children = row.children ?? [];
    const firstChildClasses = children[0]?.properties?.className;
    const hasLineNumber = Array.isArray(firstChildClasses)
      && firstChildClasses.includes("react-syntax-highlighter-line-number");
    // 画板的行号栏是 `.cline__no`：拿行号节点自己的内联样式（sticky 钉左缘），
    // 只补类名。Prism 给它的 `comment` / `linenumber` 在这里没有样式可挂，去掉。
    const lineNumberNode = hasLineNumber
      ? {
        ...children[0],
        properties: {
          ...children[0].properties,
          className: ["react-syntax-highlighter-line-number", "cline__no"],
        },
      }
      : null;
    const contentNodes = (hasLineNumber ? children.slice(1) : children).map(withBoardTokenClasses);

    return (
      <span
        className="file-source-line cline"
        data-line-number={lineIndex + 1}
        key={`source-line-${lineIndex}`}
        style={{ minWidth: "100%" }}
      >
        {lineNumberNode && renderSyntaxNode({
          node: lineNumberNode,
          stylesheet,
          // 类名即主题：内联色来自 prism 主题，会盖掉 `.tok-*`。
          useInlineStyles: false,
          key: `source-line-number-${lineIndex}`,
        })}
        <span
          className="file-source-line-content"
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            overflowWrap: wrapLines ? "anywhere" : "normal",
            whiteSpace: wrapLines ? "pre-wrap" : "pre",
          }}
        >
          {contentNodes.map((node, tokenIndex) => renderSyntaxNode({
            node,
            stylesheet,
            useInlineStyles: false,
            key: `source-token-${lineIndex}-${tokenIndex}`,
          }))}
        </span>
      </span>
    );
  });
}

function getFileApiUrl(
  filePath: string,
  type: "read" | "download" | "meta" | "preview" | "watch",
  sourceSessionId?: string | null,
  params: Record<string, string | number | undefined> = {},
): string {
  const encoded = encodeFilePathForApi(filePath);
  const searchParams = new URLSearchParams({ type });
  if (sourceSessionId) searchParams.set("sessionId", sourceSessionId);
  // A watch is a stream: the page that holds it, for the Debug panel's connected pages.
  if (type === "watch") searchParams.set("holder", pageId());
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) searchParams.set(key, String(value));
  }
  return `/api/files/${encoded}?${searchParams.toString()}`;
}

function DownloadLink({ filePath, sourceSessionId }: { filePath: string; sourceSessionId?: string | null }) {
  const { t } = useI18n();
  return (
    <a
      href={getFileApiUrl(filePath, "download", sourceSessionId)}
      download={getFileName(filePath)}
      title={t("i18n.downloadFile")}
      aria-label={t("i18n.downloadFile")}
      className="file-viewer-icon-button"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </a>
  );
}

// The same rows the tool card's split diff parses, in one column; see `unifiedDiffLines()`.
type DiffLine = UnifiedDiffLine;

// Unchanged lines the patch leaves out between two hunks.
type DiffGap = SplitDiffGap;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function diffLines(patch: string): Array<DiffLine | DiffGap> {
  const files = parseUnifiedPatch(patch);
  if (!files) return [];
  return files.flatMap(unifiedDiffLines);
}

export function DiffView({ patch }: { patch: string }) {
  const { t } = useI18n();
  const diff = diffLines(patch);

  const isChange = (l: DiffLine | DiffGap) => l.type === "added" || l.type === "removed";
  const hasChanges = diff.some(isChange);
  if (!hasChanges) {
    return (
      <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
        {t("i18n.noChanges")}
      </div>
    );
  }

  // Render with context: show 3 lines around each change, collapse the rest
  const CONTEXT = 3;
  const changed = new Set(diff.flatMap((l, i) => (isChange(l) ? [i] : [])));
  const visible = new Set<number>();
  for (const ci of changed) {
    for (let j = Math.max(0, ci - CONTEXT); j <= Math.min(diff.length - 1, ci + CONTEXT); j++) {
      visible.add(j);
    }
  }
  // Collapsed lines and the lines the patch leaves out between hunks share one
  // marker; its count is unknown when a gap's is.
  const isShown = (j: number) => diff[j].type !== "gap" && visible.has(j);
  const segments: Array<{ hidden: true; count: number | null } | { hidden: false; lines: DiffLine[] }> = [];
  let i = 0;
  while (i < diff.length) {
    if (isShown(i)) {
      const block: DiffLine[] = [];
      while (i < diff.length && isShown(i)) {
        const line = diff[i];
        if (line.type !== "gap") block.push(line);
        i++;
      }
      segments.push({ hidden: false, lines: block });
    } else {
      let count: number | null = 0;
      while (i < diff.length && !isShown(i)) {
        const item = diff[i];
        const skipped = item.type === "gap" ? item.count : 1;
        count = count === null || skipped === null ? null : count + skipped;
        i++;
      }
      segments.push({ hidden: true, count });
    }
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
          // 画板的 `.dline.hunk`：被折起来的行用同一种淡底行报数。
          const result = (
            <div key={si} className="dline hunk" style={{ minWidth: "100%" }}>
              <span className="dline__sign">⋯</span>
              <span>{seg.count === null ? "" : diffGapLabel(seg.count, t)}</span>
            </div>
          );
          return result;
        }
        const lines = seg.lines.map((line, li) => {
          // 画板的 diff 行：`.dline` + `.add / .del`，行号与符号各占一栏，
          // 颜色全部来自 token（以前的 rgba 绿/红是旧皮肤的写死值）。
          const kind = line.type === "added" ? " add" : line.type === "removed" ? " del" : "";
          const prefix = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";

          return (
            <div key={li} className={`dline${kind}`} style={{ minWidth: "100%" }}>
              <span className="dline__no">
                {line.type === "removed" ? line.oldLineNo : line.newLineNo}
              </span>
              <span className="dline__sign">{prefix}</span>
              <span className="file-diff-line-content" style={{ whiteSpace: "pre", color: "var(--ink)" }}>
                {line.text || "\u00a0"}
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
  // The version on screen; a reconnect that finds it unchanged loads nothing.
  const shownVersionRef = useRef<string | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setNaturalSize(null);
    setError(null);
    setWatching(false);
    shownVersionRef.current = null;
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
        .then((next: { size?: number; mtime?: string; error?: string }) => {
          if (!active || requestId !== syncRequestRef.current) return;
          if (next.error) {
            setError(next.error);
            return;
          }
          if (typeof next.size === "number") setSize(next.size);
          setError(null);
          const version = fileVersion(next);
          if (!fileVersionChanged(shownVersionRef.current, version)) return;
          shownVersionRef.current = version;
          setNaturalSize(null);
          setBust((value) => value + 1);
        })
        .catch((nextError) => {
          if (active && requestId === syncRequestRef.current) setError(String(nextError));
        });
    };

    const es = trackEventSource("file-watch", new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId)), filePath);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      synchronize();
    });
    es.addEventListener("change", (e) => {
      syncRequestRef.current += 1;
      shownVersionRef.current = null;
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number; mtime?: string };
        shownVersionRef.current = fileVersion(d);
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
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
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
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          background: "var(--bg-panel)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          backgroundImage:
            "linear-gradient(45deg, var(--bg) 25%, transparent 25%), linear-gradient(-45deg, var(--bg) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--bg) 75%), linear-gradient(-45deg, transparent 75%, var(--bg) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
        }}
      >
        {error ? (
          <div style={{ color: "#f87171", fontSize: 13 }}>{error}</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={filePath}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setError(t("files.imageLoadFailed"))}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
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
  // The version on screen; a reconnect that finds it unchanged loads nothing.
  const shownVersionRef = useRef<string | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setDuration(null);
    setError(null);
    setWatching(false);
    shownVersionRef.current = null;
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
        .then((next: { size?: number; mtime?: string; error?: string }) => {
          if (!active || requestId !== syncRequestRef.current) return;
          if (next.error) {
            setError(next.error);
            return;
          }
          if (typeof next.size === "number") setSize(next.size);
          setError(null);
          const version = fileVersion(next);
          if (!fileVersionChanged(shownVersionRef.current, version)) return;
          shownVersionRef.current = version;
          setDuration(null);
          setBust((value) => value + 1);
        })
        .catch((nextError) => {
          if (active && requestId === syncRequestRef.current) setError(String(nextError));
        });
    };

    const es = trackEventSource("file-watch", new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId)), filePath);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      synchronize();
    });
    es.addEventListener("change", (e) => {
      syncRequestRef.current += 1;
      shownVersionRef.current = null;
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number; mtime?: string };
        shownVersionRef.current = fileVersion(d);
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
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
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
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
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
          padding: 24,
          background: "var(--bg-panel)",
        }}
      >
        <div style={{ width: "min(680px, 100%)" }}>
          {error && (
            <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12, textAlign: "center" }}>
              {error}
            </div>
          )}
          <audio
            key={src}
            controls
            preload="metadata"
            src={src}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setError(t("files.audioLoadFailed"))}
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
  // The version on screen; a reconnect that finds it unchanged loads nothing.
  const shownVersionRef = useRef<string | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setDuration(null);
    setError(null);
    setWatching(false);
    shownVersionRef.current = null;
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
        .then((next: { size?: number; mtime?: string; error?: string }) => {
          if (!active || requestId !== syncRequestRef.current) return;
          if (next.error) {
            setError(next.error);
            return;
          }
          if (typeof next.size === "number") setSize(next.size);
          setError(null);
          const version = fileVersion(next);
          if (!fileVersionChanged(shownVersionRef.current, version)) return;
          shownVersionRef.current = version;
          setDuration(null);
          setBust((value) => value + 1);
        })
        .catch((nextError) => {
          if (active && requestId === syncRequestRef.current) setError(String(nextError));
        });
    };

    const es = trackEventSource("file-watch", new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId)), filePath);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      synchronize();
    });
    es.addEventListener("change", (e) => {
      syncRequestRef.current += 1;
      shownVersionRef.current = null;
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number; mtime?: string };
        shownVersionRef.current = fileVersion(d);
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
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
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
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
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
          padding: 24,
          background: "var(--bg-panel)",
          minHeight: 0,
        }}
      >
        <div style={{ width: "min(960px, 100%)", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
          {error && (
            <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12, textAlign: "center" }}>
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
            onError={() => setError(t("files.videoLoadFailed"))}
            style={{ maxWidth: "100%", maxHeight: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}

function DocumentViewer({ filePath, cwd, sourceSessionId, initialPage, watchEnabled = true }: Props) {
  const { t } = useI18n();
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const syncRequestRef = useRef(0);
  // The version on screen; a reconnect that finds it unchanged loads nothing.
  const shownVersionRef = useRef<string | null>(null);

  const ext = getFileExt(filePath);
  const isPdf = ext === "pdf";
  const pageFragment = isPdf && initialPage && initialPage > 0 ? `#page=${initialPage}` : "";
  const previewUrl = isPdf
    ? `${getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined)}${pageFragment}`
    : getFileApiUrl(filePath, "preview", sourceSessionId, bust ? { v: bust } : undefined);

  useEffect(() => {
    setBust(0);
    setSize(null);
    setError(null);
    setWatching(false);
    shownVersionRef.current = null;

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
        .then((d: { size?: number; mtime?: string; error?: string }) => {
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
          const version = fileVersion(d);
          if (!fileVersionChanged(shownVersionRef.current, version)) return;
          shownVersionRef.current = version;
          setBust((value) => value + 1);
        })
        .catch((nextError) => {
          if (active && requestId === syncRequestRef.current) setError(String(nextError));
        });
    };

    const es = trackEventSource("file-watch", new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId)), filePath);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      synchronize();
    });
    es.addEventListener("change", (e) => {
      syncRequestRef.current += 1;
      shownVersionRef.current = null;
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number; mtime?: string };
        shownVersionRef.current = fileVersion(d);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
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
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} />
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)", flexShrink: 0 }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, background: "var(--bg-panel)" }}>
        {error ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, color: "#f87171", fontSize: 13, textAlign: "center" }}>
            {error}
          </div>
        ) : (
          <iframe
            key={previewUrl}
            src={previewUrl}
            sandbox={isPdf ? undefined : "allow-same-origin"}
            title={t("i18n.previewFile", { file: getFileName(filePath) })}
            style={{ width: "100%", height: "100%", border: "none", background: isPdf ? "var(--bg)" : "#eef1f5" }}
          />
        )}
      </div>
    </div>
  );
}

export function FileViewer({
  filePath,
  cwd,
  sourceSessionId,
  onOpenFile,
  onMentionLines,
  onAtMention,
  gitRefreshKey,
  initialDisplayMode,
  initialState,
  initialPage,
  onStateChange,
  watchEnabled: watchRequested = true,
}: Props) {
  // A page hidden past the grace lets go of its file watch (#1283: one browser
  // connection each); the watch's `connected` on return re-reads the file if it
  // changed meanwhile.
  const pageHidden = usePageHiddenFor(HIDDEN_PAGE_GRACE_MS);
  const watchEnabled = watchRequested && !pageHidden;
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
    return <DocumentViewer filePath={filePath} cwd={cwd} sourceSessionId={sourceSessionId} initialPage={initialPage} watchEnabled={watchEnabled} />;
  }
  return (
    <TextFileViewer
      filePath={filePath}
      cwd={cwd}
      sourceSessionId={sourceSessionId}
      onOpenFile={onOpenFile}
      onMentionLines={onMentionLines}
      onAtMention={onAtMention}
      gitRefreshKey={gitRefreshKey}
      initialDisplayMode={initialDisplayMode}
      initialState={initialState}
      onStateChange={onStateChange}
      watchEnabled={watchEnabled}
    />
  );
}

function TextFileViewer({
  filePath,
  cwd,
  sourceSessionId,
  onOpenFile,
  onMentionLines,
  onAtMention,
  gitRefreshKey,
  initialDisplayMode,
  initialState,
  onStateChange,
  watchEnabled = true,
}: Props) {
  const { isDark } = useTheme();
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
  const [wrapLines, setWrapLines] = useState(initialWrapLines);
  const [watching, setWatching] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const contentRequestRef = useRef(0);
  // The version of the content on screen; a reconnect that finds it unchanged
  // keeps what is loaded (Load more chunks, scroll, highlighting).
  const shownVersionRef = useRef<string | null>(null);
  const gitDiffRequestRef = useRef(0);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const autoDiffAppliedRef = useRef(false);
  const defaultPreviewEligibleRef = useRef(
    initialState === undefined && initialDisplayMode === undefined,
  );
  const scrollRestorePendingRef = useRef(true);
  const viewerStateRef = useRef<FileViewerState>({
    displayMode: requestedInitialDisplayMode,
    wrapLines: initialWrapLines,
    scrollTop: initialScrollTop,
    scrollLeft: initialScrollLeft,
  });
  const onStateChangeRef = useRef(onStateChange);
  const [selectedLineRange, setSelectedLineRange] = useState<SelectedLineRange | null>(null);
  // Whole file for an HTML preview whose source view is still chunked.
  const [htmlFull, setHtmlFull] = useState<{ text?: string; error?: string } | null>(null);
  // Inline text editing: the draft, whether it is saving, and the mtime the
  // draft started from (the save refuses to clobber a file changed elsewhere).
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fileMtime, setFileMtime] = useState<string | null>(null);

  onStateChangeRef.current = onStateChange;

  const updateDisplayMode = useCallback((nextDisplayMode: DisplayMode) => {
    viewerStateRef.current.displayMode = nextDisplayMode;
    setDisplayMode(nextDisplayMode);
  }, []);

  const toggleWrapLines = useCallback(() => {
    setWrapLines((current) => {
      const next = !current;
      viewerStateRef.current.wrapLines = next;
      return next;
    });
  }, []);

  useEffect(() => {
    setEditing(false);
    setDraft("");
    setSaveError(null);
  }, [filePath, sourceSessionId]);

  useEffect(() => {
    const nextState: FileViewerState = {
      displayMode: requestedInitialDisplayMode,
      wrapLines: initialWrapLines,
      scrollTop: initialScrollTop,
      scrollLeft: initialScrollLeft,
    };

    viewerStateRef.current = nextState;
    scrollRestorePendingRef.current = true;
    autoDiffAppliedRef.current = false;
    setDisplayMode(requestedInitialDisplayMode);
    setWrapLines(initialWrapLines);

    return () => {
      onStateChangeRef.current?.({ ...viewerStateRef.current });
    };
  }, [
    filePath,
    sourceSessionId,
    requestedInitialDisplayMode,
    initialWrapLines,
    initialScrollTop,
    initialScrollLeft,
  ]);

  const fetchContent = useCallback((filePath: string, offset = 0) => {
    const requestId = ++contentRequestRef.current;
    return fetch(getFileApiUrl(filePath, "read", sourceSessionId, { offset: offset || undefined }))
      .then((r) => r.json())
      .then((d: FileData & { mtime?: string; error?: string }) => {
        if (requestId !== contentRequestRef.current) return null;
        if (d.error) {
          setError(d.error);
          return null;
        }
        shownVersionRef.current = fileVersion(d);
        setFileMtime(d.mtime ?? null);
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

  // Reset and load the file itself when its identity changes. Live watching is
  // managed separately so pausing it never clears the displayed content.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setData(null);
    setGitDiff(null);
    setGitDiffResolved(false);
    setWatching(false);
    shownVersionRef.current = null;

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

    let active = true;
    const synchronize = () => {
      void fetchContent(filePath);
      void fetchGitDiff(filePath);
    };

    const es = trackEventSource("file-watch", new EventSource(getFileApiUrl(filePath, "watch", sourceSessionId)), filePath);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
      // The server emits connected only after its watcher exists. Reading now
      // closes the gap between the last snapshot and live events, unless the
      // file on screen is still the one on disk (a reconnect). The diff is read
      // again either way: a commit made meanwhile changes it, not the file.
      const shown = shownVersionRef.current;
      if (shown === null) {
        synchronize();
        return;
      }
      fetch(getFileApiUrl(filePath, "meta", sourceSessionId))
        .then((response) => response.json())
        .then((meta: { size?: number; mtime?: string }) => {
          if (!active) return;
          if (fileVersionChanged(shownVersionRef.current, fileVersion(meta))) synchronize();
          else void fetchGitDiff(filePath);
        })
        .catch(() => {
          if (active) synchronize();
        });
    });

    es.addEventListener("change", synchronize);

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
  }, [filePath, fetchContent, fetchGitDiff, sourceSessionId, watchEnabled]);

  useEffect(() => {
    void fetchGitDiff(filePath);
  }, [fetchGitDiff, filePath, gitRefreshKey]);

  const isBinary = data?.binary === true;
  const isDelimitedTable = !isBinary && isDelimitedTablePath(filePath);

  useEffect(() => {
    // HTML gets the same rendered-first treatment as markdown: a generated page
    // is usually more useful viewed than read as source. Both have a preview
    // mode already; the source tab stays one click away. A restored choice or
    // explicit mode hint always wins over this default. A CSV/TSV file opens
    // as its table, even while only its first chunk is loaded.
    if (
      defaultPreviewEligibleRef.current
      && data
      && !data.binary
      && (
        isDelimitedTable
        || (data.language === "markdown" && !data.truncated)
        || (data.language === "html" && (!data.truncated || data.size <= HTML_PREVIEW_MAX_BYTES))
      )
    ) {
      defaultPreviewEligibleRef.current = false;
      updateDisplayMode("preview");
    }
  }, [data, isDelimitedTable, updateDisplayMode]);

  // Large HTML: the source view loads 256 KB chunks, but a half document cannot
  // render, so the preview fetches the whole file once. A new `data` (watch
  // change, reload) refetches it; the previous page stays up meanwhile, so a
  // live change does not flash "Loading".
  const needsHtmlFull = displayMode === "preview"
    && data?.language === "html"
    && data.truncated
    && data.size <= HTML_PREVIEW_MAX_BYTES;
  useEffect(() => {
    if (!needsHtmlFull) {
      setHtmlFull(null);
      return;
    }
    const controller = new AbortController();
    fetch(getFileApiUrl(filePath, "download", sourceSessionId), { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setHtmlFull({ text: await r.text() });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setHtmlFull({ error: String(e) });
      });
    return () => controller.abort();
  }, [needsHtmlFull, data, filePath, sourceSessionId]);

  const hasGitDiff = gitDiff?.supported === true && typeof gitDiff.patch === "string";
  const isDeletedDiff = hasGitDiff && gitDiff.status === "deleted";

  useEffect(() => {
    if (gitDiffResolved && !hasGitDiff && displayMode === "diff") updateDisplayMode("source");
  }, [displayMode, gitDiffResolved, hasGitDiff, updateDisplayMode]);

  // Wait for the git request before restoring diff mode so the unresolved
  // placeholder cannot immediately demote it back to source.
  useEffect(() => {
    if (requestedInitialDisplayMode === "diff" && hasGitDiff && !autoDiffAppliedRef.current) {
      autoDiffAppliedRef.current = true;
      updateDisplayMode("diff");
    }
  }, [requestedInitialDisplayMode, hasGitDiff, updateDisplayMode]);

  const markdownPreview = useMemo(
    () => (data?.language === "markdown" ? normalizeDisplayMath(data.content) : ""),
    [data],
  );

  const frontmatter = useMemo(
    () => (data?.language === "markdown" ? parseFrontmatter(data.content) : null),
    [data],
  );

  const viewerContent = data?.content ?? "";
  const sourceLines = useMemo(() => viewerContent.split("\n"), [viewerContent]);
  const language = data?.language ?? "text";
  // Plain text needs no Prism languages; any other file loads them once.
  const prismReady = usePrismLanguages(Boolean(data) && language !== "text");
  const isHtml = !isBinary && language === "html";
  const isMarkdown = !isBinary && language === "markdown";
  // A table shows a loaded prefix too, without its cut last record; an HTML
  // preview fetches the whole file up to HTML_PREVIEW_MAX_BYTES.
  const hasPreview = isDelimitedTable || (isHtml
    ? !!data && (!data.truncated || data.size <= HTML_PREVIEW_MAX_BYTES)
    : isMarkdown && !data?.truncated);
  const effectiveDisplayMode = isDeletedDiff ? "diff" : displayMode;
  // A partly loaded HTML file previews whole, so Load more belongs to its source view.
  const showLoadMore = !!data?.truncated && !(isHtml && effectiveDisplayMode === "preview");
  // A text file small enough to edit; a file the source view loads in chunks
  // fetches its whole text when the editor opens.
  const canEdit = !!data && !isDeletedDiff && data.language !== "binary"
    && data.size <= 2 * 1024 * 1024;
  const useLightweightSource = sourceLines.length > SOURCE_HIGHLIGHT_MAX_LINES
    && !(effectiveDisplayMode === "diff" && hasGitDiff)
    && !(effectiveDisplayMode === "preview" && hasPreview);
  // react-syntax-highlighter rebuilds every token element on each render, which
  // costs hundreds of milliseconds on large files. Cache the rendered trees so
  // unrelated re-renders (panel open/close, selection changes) reuse them as-is.
  const highlightedSource = useMemo(
    () => (
      <SyntaxHighlighter
        className={wrapLines ? "file-source-view is-wrapped" : "file-source-view"}
        language={language === "text" || !prismReady ? "plaintext" : language}
        style={isDark ? fileViewerDarkTheme : vs}
        showLineNumbers
        lineNumberStyle={{
          ...FILE_PINNED_LINE_NUMBER_STYLE,
        }}
        customStyle={{
          margin: 0,
          padding: 0,
          border: 0,
          backgroundColor: "var(--bg)",
          // token 不再走主题色，正文色就是令牌的墨色（主题的 pre 色是写死的）。
          color: "var(--ink)",
          ...FILE_CODE_STYLE,
          width: wrapLines ? "100%" : "max-content",
          minWidth: "100%",
          minHeight: "100%",
          overflow: "visible",
        }}
        codeTagProps={{
          style: {
            fontFamily: "var(--font-mono)",
            fontWeight: "var(--font-mono-weight)",
            overflowWrap: wrapLines ? "anywhere" : "normal",
          },
        }}
        renderer={(rendererProps) => (
          <SourceCodeRenderer {...rendererProps} wrapLines={wrapLines} />
        )}
        wrapLongLines={wrapLines}
      >
        {viewerContent}
      </SyntaxHighlighter>
    ),
    [isDark, language, prismReady, viewerContent, wrapLines],
  );
  const lightweightSourceLines = useMemo(
    () => useLightweightSource ? sourceLines.map((line, lineIndex) => (
      <span
        className="file-source-line cline"
        data-line-number={lineIndex + 1}
        key={`source-line-${lineIndex}`}
        style={{ minWidth: "100%" }}
      >
        <span aria-hidden="true" className="cline__no" style={FILE_LINE_NUMBER_STYLE}>
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
      const root = contentRef.current;
      setSelectedLineRange((current) => {
        const next = onMentionLines && displayMode === "source" && root
          ? getSelectedSourceLineRange(root, window.getSelection())
          : null;
        // Skip no-op updates: selectionchange fires continuously while dragging,
        // and a fresh-but-equal range object would re-render the whole viewer.
        if (current === null && next === null) return current;
        if (current && next && current.startLine === next.startLine && current.endLine === next.endLine) return current;
        return next;
      });
    };

    updateSelectedLineRange();
    if (!onMentionLines || displayMode !== "source") return;

    document.addEventListener("selectionchange", updateSelectedLineRange);
    return () => document.removeEventListener("selectionchange", updateSelectedLineRange);
  }, [data?.content, displayMode, onMentionLines]);

  const mentionLineRange = useCallback((lineRange: SelectedLineRange | null) => {
    if (!onMentionLines || !lineRange) return;
    onMentionLines(
      getRelativeFilePath(filePath, cwd),
      lineRange.startLine,
      lineRange.endLine,
    );
  }, [cwd, filePath, onMentionLines]);

  useEffect(() => {
    if (!onMentionLines || displayMode !== "source") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.key.toLowerCase() !== "i" || (!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) return;

      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")) return;

      const root = contentRef.current;
      const lineRange = root ? getSelectedSourceLineRange(root, window.getSelection()) : null;
      if (!lineRange) return;

      event.preventDefault();
      mentionLineRange(lineRange);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [displayMode, mentionLineRange, onMentionLines]);

  useEffect(() => {
    if (!scrollRestorePendingRef.current || loading) return;
    if (error && !isDeletedDiff) return;
    if (requestedInitialDisplayMode === "diff" && !gitDiffResolved) return;
    if (requestedInitialDisplayMode === "diff" && hasGitDiff && displayMode !== "diff") return;

    const content = contentRef.current;
    if (!content) return;

    content.scrollTop = viewerStateRef.current.scrollTop;
    content.scrollLeft = viewerStateRef.current.scrollLeft;
    scrollRestorePendingRef.current = false;
  }, [
    data?.content,
    displayMode,
    error,
    gitDiffResolved,
    hasGitDiff,
    isDeletedDiff,
    loading,
    requestedInitialDisplayMode,
  ]);

  if (loading || (requestedInitialDisplayMode === "diff" && gitDiffLoading && !data)) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
        {t("i18n.loading")}
      </div>
    );
  }

  if (error && !isDeletedDiff) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (!data && !isDeletedDiff) return null;

  const content = viewerContent;
  const markdownDirectory = getFileDirectory(filePath);
  const lines = sourceLines;
  const displayModes: DisplayMode[] = isDeletedDiff
    ? ["diff"]
    : [
        "source",
        ...(hasPreview ? ["preview" as const] : []),
        ...(hasGitDiff ? ["diff" as const] : []),
      ];
  // 画板 `.code-head` 的三段：路径 · 行数 · 变更状态。语言与体积不进这一行
  // （画板没有），留给 title，鼠标停上去仍是完整元数据。
  const metadata = isDeletedDiff
    ? t("files.deleted")
    : isBinary
      ? `${t("files.binary")} · ${formatSize(data!.size)}`
      : `${language} · ${lines.length} lines · ${formatSize(data!.size)}`;
  const changeLabel = isDeletedDiff
    ? t("files.deleted")
    : !hasGitDiff
      ? null
      : gitDiff?.status === "added"
        ? t("files.added")
        : gitDiff?.status === "renamed"
          ? t("files.modified")
          : gitDiff?.status === "untracked"
            ? t("files.added")
            : t("files.modified");

  // Plain functions, not hooks: they sit below this component's early returns.
  const beginEdit = async () => {
    if (!data || !canEdit) return;
    setSaveError(null);
    updateDisplayMode("source");
    let text = data.content;
    if (data.truncated) {
      try {
        const response = await fetch(getFileApiUrl(filePath, "download", sourceSessionId));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        text = await response.text();
      } catch (cause) {
        setSaveError(cause instanceof Error ? cause.message : String(cause));
        return;
      }
    }
    setDraft(text);
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft("");
    setSaveError(null);
  };

  const saveEdit = async () => {
    if (!data || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/files/${encodeFilePathForApi(filePath)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft, mtime: fileMtime ?? undefined }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; mtime?: string };
      if (response.status === 409) {
        setSaveError(t("files.editConflict"));
        return;
      }
      if (!response.ok || result.error) throw new Error(result.error ?? `HTTP ${response.status}`);
      setEditing(false);
      setDraft("");
      await fetchContent(filePath);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="file-viewer-shell" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}>
      <div className="code-head" style={{ flexShrink: 0 }}>
        <span
          title={filePath}
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span>·</span>
        <span title={metadata} style={{ flex: "none" }}>{t("chat.extensionWidgetLines", { count: lines.length })}</span>
        {changeLabel && (
          <>
            <span>·</span>
            <span style={{ color: "var(--warning)", flex: "none" }}>{changeLabel}</span>
          </>
        )}
        <span style={{ flex: 1 }} />
        {!isDeletedDiff && (
          <span
            title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
            aria-label={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
            className="file-viewer-live-indicator"
            style={{
              background: watching ? "#4ade80" : "var(--border)",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
        )}

        <div className="file-viewer-controls">
          {editing ? (
            <div className="file-editor-actions">
              <button
                type="button"
                className="file-viewer-mode-button"
                onClick={cancelEdit}
                disabled={saving}
              >
                {t("files.cancelEdit")}
              </button>
              <button
                type="button"
                className="file-viewer-mode-button is-primary"
                onClick={() => void saveEdit()}
                disabled={saving}
              >
                {saving ? t("files.saving") : t("files.save")}
              </button>
            </div>
          ) : canEdit && (
            <button
              type="button"
              className="file-viewer-icon-button"
              onClick={() => void beginEdit()}
              title={t("files.edit")}
              aria-label={t("files.edit")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15.4 3.8a2 2 0 0 1 2.8 0l1 1a2 2 0 0 1 0 2.8L8.6 18.2l-4.2 1.2 1.2-4.2Z" />
                <path d="m13.6 5.6 3.8 3.8" />
              </svg>
            </button>
          )}
          {displayModes.length > 1 && !editing && (
            <div className="file-viewer-mode-switch" aria-label={t("i18n.fileViewMode")}>
              {displayModes.map((mode) => {
                const active = effectiveDisplayMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => updateDisplayMode(mode)}
                    title={mode === "diff" ? t("i18n.compareHead") : undefined}
                    aria-pressed={active}
                    className="file-viewer-mode-button"
                    style={{
                      background: active ? "var(--bg-selected)" : "transparent",
                      color: active ? "var(--text)" : "var(--text-muted)",
                    }}
                  >
                    {DISPLAY_MODE_LABELS[mode]}
                  </button>
                );
              })}
            </div>
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
                className="file-viewer-icon-button"
              >
                <MentionIcon />
              </button>
            )}
            {effectiveDisplayMode === "source" && !isBinary && (
              <>
                <button
                  type="button"
                  onClick={toggleWrapLines}
                  title={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
                  aria-label={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
                  aria-pressed={wrapLines}
                  className="file-viewer-icon-button"
                  style={{
                    background: wrapLines ? "var(--bg-selected)" : "transparent",
                    color: wrapLines ? "var(--text)" : "var(--text-muted)",
                  }}
                >
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

      {showLoadMore && data?.truncated && (
        <div
          className="file-viewer-load-more"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: "5px 8px",
            border: "1px solid var(--border)",
            borderRadius: 6,
            color: "var(--text-dim)",
            fontSize: 11,
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
        style={{ flex: 1, overflow: "auto", background: "var(--file-viewer-surface, var(--bg))", paddingBottom: showLoadMore ? 48 : undefined }}
      >
        {saveError && (
          <div role="alert" className="file-editor-error">{saveError}</div>
        )}
        {editing ? (
          <textarea
            className="file-editor"
            aria-label={t("files.editContents")}
            value={draft}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelEdit();
                return;
              }
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                void saveEdit();
              }
            }}
          />
        ) : effectiveDisplayMode === "diff" && hasGitDiff ? (
          <DiffView patch={gitDiff.patch!} />
        ) : isHtml && effectiveDisplayMode === "preview" && data?.truncated && !htmlFull?.text ? (
          <div style={{ padding: 24, color: "var(--text-dim)", fontSize: 12 }}>
            {htmlFull?.error ?? t("i18n.loading")}
          </div>
        ) : isHtml && effectiveDisplayMode === "preview" ? (
          <iframe
            srcDoc={data?.truncated ? htmlFull?.text : content}
            sandbox="allow-scripts"
            style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
             title={t("i18n.htmlPreview")}
          />
        ) : isMarkdown && effectiveDisplayMode === "preview" ? (
          <div
            className="markdown-body markdown-file-preview"
            style={{ padding: "24px 32px" }}
          >
            {frontmatter?.data && <FrontmatterCard data={frontmatter.data} />}
            <ReactMarkdown
              remarkPlugins={markdownPreviewRemarkPlugins}
              rehypePlugins={markdownPreviewRehypePlugins}
              urlTransform={onOpenFile ? markdownUrlTransform : markdownAppUrlTransform}
              components={{
                code({ className, children, ...props }) {
                  const lang = className?.replace("language-", "").toLowerCase() ?? "";
                  const raw = String(children);
                  const isBlock = className?.includes("language-") || raw.includes("\n");
                  if (isBlock) {
                    if (lang === "mermaid") {
                      return <MermaidBlock code={raw.replace(/\n$/, "")} defaultPreview />;
                    }
                    return <CodeBlock code={raw.replace(/\n$/, "")} lang={lang} />;
                  }
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
                pre({ children }) {
                  // Render the code block directly — CodeBlock provides its own wrapping.
                  // For non-mermaid blocks, pass through to default pre rendering.
                  return <>{children}</>;
                },
                a({ href, children, ...props }) {
                  delete props.node;
                  const linkedFile = onOpenFile
                    ? resolveLocalFileHref(href, markdownDirectory, cwd ?? markdownDirectory)
                    : null;
                  if (!linkedFile || !onOpenFile) {
                    // Like chat links: a web or app link must not replace Pi Web.
                    return isExternalMarkdownHref(href)
                      ? <a href={href} {...props} target="_blank" rel="noopener noreferrer">{children}</a>
                      : <a href={href} {...props} onClick={jumpToMarkdownFragment}>{children}</a>;
                  }

                  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
                    if (!shouldOpenLocalFileInApp(event)) return;
                    event.preventDefault();
                    onOpenFile(linkedFile, parsePdfPageFragment(href) ?? undefined);
                  };

                  return <a href={href} {...props} onClick={handleClick}>{children}</a>;
                },
                img({ src, alt, ...props }) {
                  delete props.node;
                  const imagePath = typeof src === "string"
                    ? resolveLocalFileHref(src, markdownDirectory, cwd ?? markdownDirectory)
                    : null;
                  const imageSrc = imagePath
                    ? getFileApiUrl(imagePath, "read", sourceSessionId)
                    : src;
                  // Dynamic local paths are served directly by the file API.
                  // eslint-disable-next-line @next/next/no-img-element
                  return <img src={imageSrc} alt={alt ?? ""} loading="lazy" {...props} />;
                },
              }}
            >
              {markdownPreview}
            </ReactMarkdown>
          </div>
        ) : isDelimitedTable && effectiveDisplayMode === "preview" ? (
          <DelimitedTable
            content={content}
            filePath={filePath}
            complete={!data?.truncated}
            scrollRef={contentRef}
          />
        ) : isBinary ? (
          // Decoded bytes are noise; opening a file never downloads it on its own (#1401).
          <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 24, color: "var(--text-muted)", fontSize: 13, textAlign: "center" }}>
            <span>{t("files.binaryNoPreview")}</span>
            <a
              href={getFileApiUrl(filePath, "download", sourceSessionId)}
              download={getFileName(filePath)}
              className="file-viewer-mode-button"
              style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", textDecoration: "none" }}
            >
              {t("files.download")}
            </a>
          </div>
        ) : useLightweightSource ? (
          <div className="code">
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
          </div>
        ) : (
          <div className="code">{highlightedSource}</div>
        )}
      </div>
    </div>
  );
}
