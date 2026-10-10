"use client";

import { Fragment, useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo } from "react";
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
import { copyText } from "@/lib/clipboard";
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

/**
 * fork:viewer-dedupe-request — 在途请求表：同一个 key 的第二条调用**共用第一条的
 * promise**，而不是再打一次接口。
 *
 * 为什么值得有：打开一个文件时两条路径会同时要同一份东西 —— 挂载读 + watch 的
 * `connected` 快照读要同一份正文，`gitRefreshKey` 那条 effect + 同一个 `connected`
 * 要同一份 diff（服务端每次都跑一遍 `git status` + `git diff HEAD -- <file>`，
 * 实测 175–450ms，且与同一时刻文件树的两次列目录抢同一个 Node 线程）。
 *
 * 关键的不变式：**「后来者作废前作」的那次自增必须发生在去重之后**（也就是在
 * `run` 里面），否则共用者会先把 owner 的 requestId 顶掉，owner 回来发现「我不是
 * 最新」就把结果丢了 —— 曾经真的这么坏过一次：diff 永远停在「加载中」。
 * 所以 `run` 是这条请求的**唯一** owner，它的自增与 guard 都在里面成对出现。
 */
export function shareInFlightRequest<T>(
  store: Map<string, { promise?: Promise<T> }>,
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const running = store.get(key);
  if (running?.promise) return running.promise;
  const entry: { promise?: Promise<T> } = {};
  store.set(key, entry);
  const promise = run().finally(() => {
    if (store.get(key) === entry) store.delete(key);
  });
  entry.promise = promise;
  return promise;
}

/* ── M-06 · 手机档类名对照 ──────────────────────────────────────────────────
   画板 M-06 帧 B / 帧 F：查看器是 `inset:0` 的**全屏覆盖**，顶栏 `.m-viewer-bar`
   写完整路径、模式是三等宽 `.m-seg`、正文 `.m-viewer-scroll`、底部 `.m-vbar`。
   桌面那份 `.d-viewer / .d-viewer-bar / .d-viewer-scroll / .d-seg` 原样保留，
   窄屏只换形态，不换语义（同一个 state、同一批 handler、同一份内容组件）。

   为什么这一处要显式写 `position: fixed`：`.m-viewer` 自己是 `position:absolute;
   inset:0`，而右栏宿主（`.secondary-workspace`）在手机上是 fixed 全屏、其下的
   `.file-panel-main` 带 `overflow:hidden` —— 绝对定位会被那一层裁掉。
   `position/inset/z-index` 属于铁律四允许的行内值（层级摆放与几何定位），颜色、
   字号、间距、圆角一律仍来自 system.css。 */
const MOBILE_VIEWER_STYLE: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: "var(--nx-z-panel)",
};

/**
 * M-06 · 一处取全套类名。桌面档与手机档是**同一块 DOM 的两个形态**，所以这里只做
 * 「类名随断点换」，语义、层级、状态类（`.is-on`）与数据流完全一致。
 */
function viewerSkin(isMobile: boolean) {
  return {
    shellClass: isMobile ? "m-viewer is-open" : "d-viewer",
    shellStyle: isMobile ? MOBILE_VIEWER_STYLE : { height: "100%" } as React.CSSProperties,
    barClass: isMobile ? "m-viewer-bar" : "d-viewer-bar",
    pathClass: isMobile ? "m-viewer-path" : "d-viewer-path",
    scrollClass: isMobile ? "m-viewer-scroll" : "d-viewer-scroll",
    badge: (tone: string) => (isMobile ? `m-badge ${tone}` : `d-badge ${tone}`),
    dot: isMobile ? "m-dot" : "d-dot",
    grow: isMobile ? "m-grow" : "d-grow",
    tinyFaint: isMobile ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint",
    // 触控下限：`.m-iconbtn` 的键帽是 36px，命中区由 `.m-touch-44` 抬到 44px
    // （库里现成的三档触控类，与画板 `.m-touch-44` 同一份规格）。
    iconBtn: isMobile ? "m-iconbtn m-touch-44" : "d-iconbtn",
    emptyClass: isMobile ? "m-empty" : "d-empty",
    emptyIco: isMobile ? "m-empty-ico" : "d-empty-ico",
    emptyTitle: isMobile ? "m-empty-t" : "d-empty-t",
    emptySub: isMobile ? "m-empty-s" : "d-empty-s",
    // M-06 帧 B —— 图片框：PWA 形态没有对应类（`.d-fileimg` 是 Web 形态值），
    // 手机档不挂这一层，边框 / 圆角交给 `.m-viewer-scroll` 自己的留白。
    fileImg: isMobile ? undefined : "d-fileimg",
  };
}

/**
 * D-06 帧 A / 帧 B 的面包屑：逐级目录 + 最后一段文件名（`.is-on`）。
 *
 * 查看器是**只读**的，目录段不做「跳转」（跳了就得有一套返回栈，那是新行为）；
 * 它点下去复制到那一层的路径 —— 与同一行「复制路径」是同一族动作
 * （`PathActions` / 手机顶栏那枚 link），末段复制完整路径。
 */
function viewerCrumbs(filePath: string, cwd?: string): { label: string; path: string }[] {
  const relative = getRelativeFilePath(filePath, cwd);
  const insideCwd = Boolean(cwd) && relative !== filePath && !relative.startsWith("/");
  const base = insideCwd && cwd ? cwd.replace(/\/+$/, "") : "";
  const parts = relative.split("/").filter(Boolean);
  if (parts.length === 0) return [{ label: relative || filePath, path: filePath }];
  return parts.map((label, index) => ({
    label,
    path: [base, ...parts.slice(0, index + 1)].filter(Boolean).join("/"),
  }));
}
// Matches the write endpoint's content cap in lib/file-mutations.ts.
// Display mode labels come from i18n now (`i18n.source` / `i18n.preview`).


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

function DownloadLink({ filePath, sourceSessionId, mobile = false }: { filePath: string; sourceSessionId?: string | null; mobile?: boolean }) {
  const { t } = useI18n();
  return (
    <a
      href={getFileApiUrl(filePath, "download", sourceSessionId)}
      download={getFileName(filePath)}
      title={t("i18n.downloadFile")}
      aria-label={t("i18n.downloadFile")}
      className={mobile ? "m-iconbtn m-touch-44" : "d-iconbtn"}
    >
      <i data-ico="download" data-size="14"></i>
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

/** 一个差异片段：要么是一串要画的行，要么是一行「… N unchanged lines …」占位。 */
export type DiffSegment =
  | { hidden: true; count: number }
  | { hidden: false; lines: DiffLine[] };

/** Collapse the diff to 3 lines of context around every change. */
function diffSegments(diff: readonly DiffLine[]): DiffSegment[] {
  const CONTEXT = 3;
  const visible = new Set<number>();
  diff.forEach((line, index) => {
    if (line.type === "unchanged") return;
    for (let j = Math.max(0, index - CONTEXT); j <= Math.min(diff.length - 1, index + CONTEXT); j++) {
      visible.add(j);
    }
  });

  const segments: DiffSegment[] = [];
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

/** fork:perf-viewer-diff-pages —— 先画这么多行，点一次「加载更多」再加这么多。 */
const DIFF_PAGE_LINES = 400;

/**
 * Cut a collapsed diff down to `maxLines` rendered lines.
 *
 * A file under an active rewrite has almost every line in the diff, so the 3-line
 * context window hides nothing and the whole thing lands in the DOM at once: one
 * `+1148-101` file is 1412 rows / +6.4k nodes, and building them is ~200ms of
 * main thread in the same commit that mounts the editor — which is what the
 * "loading…" state is still on screen for. The text viewer already pages past its
 * 256KB chunk the same way (`.d-banner` + 加载更多); this is the diff doing the
 * same. `remaining` counts the lines still behind the cut so the caller can offer
 * more; the collapsed "… N unchanged lines …" rows ahead of the cut stay put,
 * and the ones behind it are dropped (they belong to rows nobody has asked for).
 */
export function limitDiffSegments(
  segments: readonly DiffSegment[],
  maxLines: number,
): { items: DiffSegment[]; remaining: number } {
  const items: DiffSegment[] = [];
  let used = 0;
  let remaining = 0;
  let cut = false;
  for (const segment of segments) {
    if (cut) {
      if (!segment.hidden) remaining += segment.lines.length;
      continue;
    }
    if (segment.hidden) {
      items.push(segment);
      continue;
    }
    const room = maxLines - used;
    if (segment.lines.length <= room) {
      items.push(segment);
      used += segment.lines.length;
      continue;
    }
    items.push({ hidden: false, lines: segment.lines.slice(0, room) });
    used += room;
    remaining += segment.lines.length - room;
    cut = true;
  }
  return { items, remaining };
}

function DiffView({ patch }: { patch: string }) {
  const { t } = useI18n();
  /* M-06 帧 B —— 手机档的差异行换 PWA 形态：`.m-code-add` / `.m-code-del`
     （横滚不折行、`+ / −` 前缀写在行里；`.m-code-scroll` 的 overflow 由外层
     `.m-code-body m-code-scroll` 承担）。桌面仍是 `.d-diff-line` + 行号列。
     两档同一份 `diffLines` 结果，只换画法。 */
  const isMobile = useIsMobile();
  // fork:perf-viewer-keepalive — `diffLines` parses the patch and runs a word-level
  // LCS for every changed pair. It used to run again on each render of the viewer
  // (selection changes, save state, theme), so the parsed rows and the context
  // blocks are memoized on the patch itself now.
  const diff = useMemo(() => diffLines(patch), [patch]);
  const segments = useMemo(() => diffSegments(diff), [diff]);
  // fork:perf-viewer-diff-pages —— 分批画；换文件回到第一页（见 limitDiffSegments 的理由）。
  const [shownLines, setShownLines] = useState(DIFF_PAGE_LINES);
  useEffect(() => { setShownLines(DIFF_PAGE_LINES); }, [patch]);
  const { items, remaining } = useMemo(
    () => limitDiffSegments(segments, shownLines),
    [segments, shownLines],
  );
  const hasChanges = diff.some((l) => l.type !== "unchanged");

  if (!hasChanges) {
    return (
      <div
        className={isMobile ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint"}
        style={{ padding: "12px 16px", fontFamily: "var(--font-mono)" }}
      >
        {t("i18n.noChanges")}
      </div>
    );
  }

  return (
    <div
      /* 手机档没有 `.d-diff` 这一层壳：等宽与横滚由 `.m-code-body m-code-scroll` 给
         （M-06 帧 B 的 `.m-code` 结构），桌面仍是画板 D-06 的 `.d-diff`。 */
      className={isMobile ? undefined : "d-diff"}
      style={isMobile ? undefined : {
        width: "max-content",
        minWidth: "100%",
      }}
    >
      {items.map((seg, si) => {
        if (seg.hidden) {
          return (
            <div
              key={si}
              className={isMobile ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint"}
              style={{
                padding: "var(--nx-sp-1) 16px",
                background: "var(--nx-panel)",
                borderTop: "1px solid var(--nx-line)",
                borderBottom: "1px solid var(--nx-line)",
              }}
            >
              ... {seg.count} unchanged lines ...
            </div>
          );
        }
        const lines = seg.lines.map((line, li) => {
          const prefix =
            line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
          const prefixColor =
            line.type === "added" ? "var(--nx-success)" : line.type === "removed" ? "var(--nx-danger)" : "var(--nx-text-3)";
          // fork:zc-07 — 行内差异段；空行（或无可显示字符）仍用 nbsp 占位。
          const segments = line.intraline === undefined ? null : buildIntralineSegments(line.text, line.intraline);
          const hasVisibleSegments = segments?.some((segment) => segment.text.length > 0) ?? false;

          /* M-06 帧 B：手机档的差异行就是一块 `.m-code-add` / `.m-code-del`
             （前缀在行内、不带行号列）；词级高亮在手机档不做 —— 那套分段 span
             是配桌面行号列的，手机上一行一块底色已经说清了。 */
          if (isMobile) {
            return (
              <span
                key={li}
                className={line.type === "added" ? "m-code-add" : line.type === "removed" ? "m-code-del" : undefined}
              >
                {line.type === "unchanged" ? line.text : `${prefix}${line.text}`}
              </span>
            );
          }
          const changedBackground = line.type === "added"
            ? "color-mix(in srgb, var(--nx-success) 30%, transparent)"
            : "color-mix(in srgb, var(--nx-danger) 30%, transparent)";

          return (
            <div
              key={li}
              className={`d-diff-line${line.type === "added" ? " add" : line.type === "removed" ? " del" : ""}`}
            >
              <span className="d-ln">
                {line.type === "removed" ? line.oldLineNo : line.newLineNo}
              </span>
              <span
                style={{
                  minWidth: "var(--icon-md)",
                  padding: "0 6px",
                  color: prefixColor,
                  userSelect: "none",
                  fontWeight: 600,
                }}
              >
                {prefix}
              </span>
              <span
                className="file-diff-line-content"
                style={{
                  padding: "0 8px 0 0",
                  whiteSpace: "pre",
                  color: "inherit",
                }}
              >
                {segments && hasVisibleSegments
                  ? segments.map((segment, index) => (
                      <span
                        key={index}
                        style={segment.changed ? { background: changedBackground, borderRadius: "var(--nx-r-xs)" } : undefined}
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
      {remaining > 0 && (
        /* fork:perf-viewer-diff-pages —— 剩下的行还没进 DOM；沿用正文分块那块
           「加载更多」的说法（同一个 key、同一颗钮），不新造文案也不新造类。 */
        <div
          className={isMobile ? "m-t-xs m-t-faint" : "d-t-xs d-t-faint"}
          style={{
            padding: "var(--nx-sp-1) 16px",
            background: "var(--nx-panel)",
            borderTop: "1px solid var(--nx-line)",
            textAlign: "center",
          }}
        >
          <button
            type="button"
            className="d-btn sm"
            onClick={() => setShownLines((lines) => lines + DIFF_PAGE_LINES)}
          >
            {t("i18n.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}

function ImageViewer({ filePath, cwd, sourceSessionId, watchEnabled = true }: Props) {
  const { t } = useI18n();
  // M-06 —— 手机档同一个查看器换 m-* 形态（帧 B 的全屏覆盖 + 帧 F 的降级卡壳）。
  const isMobile = useIsMobile();
  const skin = viewerSkin(isMobile);
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
    <div className={skin.shellClass} style={skin.shellStyle}>
      <div className={skin.barClass}>
        <i data-ico="image" data-size="13"></i>
        <span className={skin.pathClass} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span className={skin.badge("mute")}>{ext || "image"}</span>
        {naturalSize && <span className={skin.badge("mute")}>{naturalSize.w} × {naturalSize.h}</span>}
        {formatSizeStr && <span className={skin.badge("mute")}>{formatSizeStr}</span>}
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{ display: "inline-flex", alignItems: "center", gap: "var(--nx-sp-1)" }}
        >
          <span className={`${skin.dot}${watching ? " ok" : ""}`} />
          <span className={skin.tinyFaint}>{watching ? "live" : "static"}</span>
        </span>
        <span className={skin.grow} />
        {/* fork:gap-viewer-zoom — 缩放控件（键盘可达，带 aria-label）。 */}
        <span style={{ display: "flex", alignItems: "center", gap: "var(--nx-sp-1)" }}>
          <button
            type="button"
            className={skin.iconBtn}
            onClick={() => setZoom((value) => stepZoom(value, -1))}
            disabled={zoom <= ZOOM_MIN}
            aria-label={t("i18n.zoomOut")}
            title={t("i18n.zoomOut")}
          >
            <i data-ico="zoom-out" data-size="14"></i>
          </button>
          <button
            type="button"
            className={skin.badge("mute")}
            onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }}
            aria-label={t("i18n.zoomReset")}
            title={t("i18n.zoomReset")}
            style={{ fontVariantNumeric: "tabular-nums", minWidth: 44, cursor: "pointer" }}
          >
            {formatZoomPercent(zoom)}
          </button>
          <button
            type="button"
            className={skin.iconBtn}
            onClick={() => setZoom((value) => stepZoom(value, 1))}
            disabled={zoom >= ZOOM_MAX}
            aria-label={t("i18n.zoomIn")}
            title={t("i18n.zoomIn")}
          >
            <i data-ico="zoom-in" data-size="14"></i>
          </button>
        </span>
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} mobile={isMobile} />
      </div>
      <div
        className={skin.scrollClass}
        onWheel={(event) => {
          // 只有 Ctrl/⌘ + 滚轮才缩放，否则交给容器滚动（触控板用户不该被劫持）。
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          setZoom((value) => wheelZoom(value, event.deltaY));
        }}
        style={{
          background: "var(--nx-canvas)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--nx-sp-4)",
          cursor: isZoomed(zoom) ? "grab" : "default",
          backgroundImage:
            "linear-gradient(45deg, var(--nx-canvas) 25%, transparent 25%), linear-gradient(-45deg, var(--nx-canvas) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--nx-canvas) 75%), linear-gradient(-45deg, transparent 75%, var(--nx-canvas) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
        }}
      >
        {error ? (
          <div style={{ color: "var(--nx-danger)", fontSize: TEXT.md }}>{error}</div>
        ) : (
          /* D-06 帧 C / D-06b 帧 C 的 `d-fileimg`（Web 形态的图片格：圆角 + 描边）——
             只在桌面档挂。PWA 形态库里的图片格是 m-viewbox（帧 F），不套这一格，
             手机档保持原样。内联的居中 / 尺寸是几何，不是设计值。 */
          <div
            className={skin.fileImg}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", maxHeight: "100%" }}
          >
          {/* eslint-disable-next-line @next/next/no-img-element */}
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
              boxShadow: "var(--nx-sh-2)",
              userSelect: "none",
              touchAction: "none",
            }}
          />
          </div>
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
  const isMobile = useIsMobile();
  const skin = viewerSkin(isMobile);
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
    <div className={skin.shellClass} style={skin.shellStyle}>
      <div className={skin.barClass}>
        <i data-ico="music" data-size="13"></i>
        <span className={skin.pathClass} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span className={skin.badge("mute")}>{ext || "audio"}</span>
        {duration != null && <span className={skin.badge("mute")}>{formatDuration(duration)}</span>}
        {size != null && <span className={skin.badge("mute")}>{formatSize(size)}</span>}
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{ display: "inline-flex", alignItems: "center", gap: "var(--nx-sp-1)" }}
        >
          <span className={`${skin.dot}${watching ? " ok" : ""}`} />
          <span className={skin.tinyFaint}>{watching ? "live" : "static"}</span>
        </span>
        <span className={skin.grow} />
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} mobile={isMobile} />
      </div>
      <div
        className={skin.scrollClass}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--nx-sp-5)",
        }}
      >
        <div style={{ width: "min(680px, 100%)" }}>
          {error && (
            <div style={{ color: "var(--nx-danger)", fontSize: TEXT.md, marginBottom: "var(--nx-sp-3)", textAlign: "center" }}>
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
  const isMobile = useIsMobile();
  const skin = viewerSkin(isMobile);
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
    <div className={skin.shellClass} style={skin.shellStyle}>
      <div className={skin.barClass}>
        <i data-ico="circle-play" data-size="13"></i>
        <span className={skin.pathClass} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span className={skin.badge("mute")}>{ext || "video"}</span>
        {duration != null && <span className={skin.badge("mute")}>{formatDuration(duration)}</span>}
        {size != null && <span className={skin.badge("mute")}>{formatSize(size)}</span>}
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{ display: "inline-flex", alignItems: "center", gap: "var(--nx-sp-1)" }}
        >
          <span className={`${skin.dot}${watching ? " ok" : ""}`} />
          <span className={skin.tinyFaint}>{watching ? "live" : "static"}</span>
        </span>
        <span className={skin.grow} />
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} mobile={isMobile} />
      </div>
      <div
        className={skin.scrollClass}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--nx-sp-5)",
          minHeight: 0,
        }}
      >
        <div style={{ width: "min(960px, 100%)", height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
          {error && (
            <div style={{ color: "var(--nx-danger)", fontSize: TEXT.md, marginBottom: "var(--nx-sp-3)", textAlign: "center" }}>
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
      // fork:v5-landing —— 壳与两个动作钮改用 D-06 查看器的原件：
      //   壳 = `.d-pop`（发丝边框 / surface / `.is-open` 带 board 入场动效），
      //   动作钮 = `.d-btn`（inline-flex + align-items:center）。
      // 原来壳是手绘的四行内联，动作钮用方形图标钮会把图标 + 文案各放一格。
      className="d-pop is-open"
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
        flexWrap: inputOpen ? "wrap" : "nowrap",
        whiteSpace: inputOpen ? undefined : "nowrap",
        gap: "var(--nx-sp-1)",
        width: inputOpen ? "min(420px, calc(100vw - 16px))" : "max-content",
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "calc(var(--app-viewport-height, 100dvh) - 16px)",
        overflowY: "auto",
        padding: inputOpen ? 12 : 3,
      }}
    >
      {inputOpen ? (
        <fieldset disabled={submitting} aria-busy={submitting} style={{ width: "100%", minWidth: 0, margin: 0, padding: 0, border: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--nx-sp-2)" }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: TEXT.sm, fontWeight: 600 }}>{t("chat.askInNewChat")}</span>
            <button type="button" className="d-iconbtn" title={t("i18n.close")} aria-label={t("i18n.close")} disabled={submitting} onClick={closeInput}>
              <i data-ico="x" data-size="14"></i>
            </button>
          </div>
          <ChatInput ref={chatInputRef} compact onSend={askInNewChat} onAbort={closeInput} isStreaming={false} />
          {error && <div role="alert" style={{ color: "var(--nx-danger)", fontSize: TEXT.sm, overflowWrap: "anywhere" }}>{error}</div>}
        </fieldset>
      ) : <>
        <button
          type="button"
          className="d-btn sm"
          title={t("chat.askInCurrent")}
          aria-label={t("chat.askInCurrent")}
          onPointerDown={(event) => event.preventDefault()}
          onClick={onAskInCurrent}
        >
          <i data-ico="at-sign" data-size="14"></i>
          <span>{t("chat.askInCurrent")}</span>
        </button>
        {onAskInNewChat && (
          <button
            type="button"
            className="d-btn sm"
            title={t("chat.askInNewChat")}
            aria-label={t("chat.askInNewChat")}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => toggleInput(true)}
          >
            <i data-ico="git-fork" data-size="14"></i>
            <span>{t("chat.askInNewChat")}</span>
          </button>
        )}
      </>}
    </div>,
    document.body,
  );
}

function DocumentViewer({ filePath, cwd, sourceSessionId, initialPage, onMentionLines, onAskInNewChat, watchEnabled = true }: Props) {
  const { t, locale } = useI18n();
  // M-06 —— 手机档同一个查看器换 m-* 形态。
  const isMobile = useIsMobile();
  const { theme } = useTheme();
  const skin = viewerSkin(isMobile);
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frameSelection, setFrameSelection] = useState<{ text: string; top: number; left: number } | null>(null);
  const [frameQuoteInputOpen, setFrameQuoteInputOpen] = useState(false);
  // fork:office-editor —— docx 可在只读预览（mammoth）与 GenOffice 编辑器之间切换。
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [tooLarge, setTooLarge] = useState(false);
  const editFrameRef = useRef<HTMLIFrameElement | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const syncRequestRef = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const frameDocRef = useRef<Document | null>(null);
  const frameQuoteInputOpenRef = useRef(false);

  const ext = getFileExt(filePath);
  const isPdf = ext === "pdf";
  const canEdit = ext === "docx";
  // fork:gap-viewer-zoom — PDF 缩放。
  // 这里仍然是浏览器内置的 PDF 阅读器（不引 pdfjs），但通过 `#zoom=<percent>`
  // fragment 给它一个缩放档位，于是至少有了和图片一致的 −/+/100% 控件。
  const [pdfZoom, setPdfZoom] = useState(1);
  const pageFragment = isPdf && initialPage && initialPage > 0 ? `#page=${initialPage}` : "";
  const rawPreviewUrl = isPdf
    ? `${getFileApiUrl(filePath, "read", sourceSessionId, bust ? { v: bust } : undefined)}${pageFragment}`
    : getFileApiUrl(filePath, "preview", sourceSessionId, bust ? { v: bust } : undefined);
  const previewUrl = isPdf ? withPdfZoom(rawPreviewUrl, pdfZoom) : rawPreviewUrl;

  // fork:office-editor —— 编辑态挂在同源 iframe（public/office/host.html）里，
  // 语言/主题随宿主，保存走 /api/files 的 upload 通路（见 public/office/host.js）。
  const officeSrc = useMemo(() => {
    if (!canEdit) return "";
    const search = new URLSearchParams({
      path: filePath,
      lang: locale.startsWith("zh") ? "zh" : "en",
      theme: theme === "dark" ? "dark" : "light",
    });
    if (sourceSessionId) search.set("sessionId", sourceSessionId);
    return `/office/host.html?${search.toString()}`;
  }, [canEdit, filePath, locale, sourceSessionId, theme]);

  // 离开编辑态前让编辑器把未保存改动写回；没有响应最多等 60s。
  const flushEditor = useCallback(() => new Promise<void>((resolve) => {
    const target = editFrameRef.current?.contentWindow;
    if (!target) {
      resolve();
      return;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = window.setTimeout(finish, 60000);
    function finish() {
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve();
    }
    function onMessage(event: MessageEvent) {
      if (event.source !== target) return;
      const data = event.data as { type?: string; id?: string } | null;
      if (data?.type !== "pi-office:flush-result" || data.id !== id) return;
      finish();
    }
    window.addEventListener("message", onMessage);
    target.postMessage({ type: "pi-office:flush", id }, window.location.origin);
  }), []);

  const toggleMode = useCallback(async () => {
    if (mode === "edit") await flushEditor();
    setMode((current) => (current === "edit" ? "preview" : "edit"));
  }, [mode, flushEditor]);

  useEffect(() => {
    setBust(0);
    setSize(null);
    setError(null);
    setTooLarge(false);
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
            setTooLarge(true);
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

    if (!watchEnabled || mode === "edit") return;

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
              setTooLarge(true);
              return;
            }
          }
          setTooLarge(false);
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
            setTooLarge(true);
            return;
          }
        }
      } catch { /* ignore */ }
      setTooLarge(false);
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
  }, [filePath, isPdf, mode, sourceSessionId, watchEnabled]);

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
    <div className={skin.shellClass} style={skin.shellStyle}>
      <div className={skin.barClass}>
        <i data-ico="file-text" data-size="13"></i>
        <span className={skin.pathClass} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span className={skin.badge("mute")}>{ext === "docx" ? "docx preview" : "pdf"}</span>
        {size != null && <span className={skin.badge("mute")}>{formatSize(size)}</span>}
        <span className={skin.grow} />
        {/* fork:gap-viewer-zoom — 只给 PDF 加缩放：DOCX 走的是自己排版的 HTML，不需要。
            通过 fragment 驱动内置阅读器，按钮步进避免每次滚轮都重载文档。 */}
        {isPdf && (
          <span style={{ display: "flex", alignItems: "center", gap: "var(--nx-sp-1)" }}>
            <button
              type="button"
              className={skin.iconBtn}
              onClick={() => setPdfZoom((value) => stepZoom(value, -1))}
              disabled={pdfZoom <= ZOOM_MIN}
              aria-label={t("i18n.zoomOut")}
              title={t("i18n.zoomOut")}
            >
              <i data-ico="zoom-out" data-size="13"></i>
            </button>
            <button
              type="button"
              className={skin.badge("mute")}
              onClick={() => setPdfZoom(1)}
              aria-label={t("i18n.zoomReset")}
              title={t("i18n.zoomReset")}
              style={{ fontVariantNumeric: "tabular-nums", minWidth: 44, cursor: "pointer" }}
            >
              {formatZoomPercent(pdfZoom)}
            </button>
            <button
              type="button"
              className={skin.iconBtn}
              onClick={() => setPdfZoom((value) => stepZoom(value, 1))}
              disabled={pdfZoom >= ZOOM_MAX}
              aria-label={t("i18n.zoomIn")}
              title={t("i18n.zoomIn")}
            >
              <i data-ico="zoom-in" data-size="13"></i>
            </button>
          </span>
        )}
        {canEdit && (
          <button
            type="button"
            className={skin.iconBtn}
            onClick={toggleMode}
            aria-label={mode === "edit" ? t("i18n.preview") : t("i18n.edit")}
            title={mode === "edit" ? t("i18n.preview") : t("i18n.edit")}
          >
            <i data-ico={mode === "edit" ? "eye" : "pencil"} data-size="13"></i>
          </button>
        )}
        <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} mobile={isMobile} />
        <span
          title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
          style={{ display: "inline-flex", alignItems: "center", gap: "var(--nx-sp-1)", flexShrink: 0 }}
        >
          <span className={`${skin.dot}${watching ? " ok" : ""}`} />
          <span className={skin.tinyFaint}>{watching ? "live" : "static"}</span>
        </span>
      </div>
      <div className={skin.scrollClass} style={{ background: "var(--nx-panel)" }}>
        {error || (tooLarge && mode !== "edit") ? (
          <div className={skin.emptyClass} style={{ height: "100%" }}>
            <div className={skin.emptyIco}><i data-ico="triangle-alert" data-size="20"></i></div>
            <div className={skin.emptyTitle}>{error ?? "DOCX too large for preview (>10MB)"}</div>
          </div>
        ) : mode === "edit" ? (
          <iframe
            ref={editFrameRef}
            src={officeSrc}
            sandbox="allow-scripts allow-same-origin allow-downloads allow-modals allow-forms allow-popups"
            title={getFileName(filePath)}
            style={{ width: "100%", height: "100%", border: "none", background: "var(--n-surface)" }}
          />
        ) : (
          <iframe
            ref={iframeRef}
            key={previewUrl}
            src={previewUrl}
            sandbox={isPdf ? undefined : "allow-same-origin"}
            title={t("i18n.previewFile", { file: getFileName(filePath) })}
            onLoad={isPdf ? undefined : attachFrameSelection}
            style={{ width: "100%", height: "100%", border: "none", background: isPdf ? "var(--nx-canvas)" : "var(--n-surface)" }}
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
  // D-06 帧 A：模式文案走 i18n（源码 / 预览），不再是硬编码英文。
  const displayModeLabel = (mode: DisplayMode) => (mode === "source" ? t("i18n.source") : t("i18n.preview"));
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
  /* fork:viewer-dedupe-request —— 在途请求表：同一个 key 的第二条请求复用第一条的
     promise，而不是再打一次接口。请求 id（上面两个计数器）仍逐条自增，所以「新来的
     那条才是当前答案」这条时序不变。 */
  const contentRequestsRef = useRef(new Map<string, { promise?: Promise<FileData | null> }>());
  const gitDiffRequestsRef = useRef(new Map<string, { promise?: Promise<void> }>());
  const loadedFilePathRef = useRef<string | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  /* fork:v5-boards D-06b 帧 C —— 长列表的上下渐隐（`.d-fade` / `.d-fade-tail`）：
     只在桌面档画（PWA 形态同一件事由顶栏的 `.m-fade` 承担），两条都不吃指针、
     不占布局，滚到那一端就消失 —— 它是「上面还有 / 下面还有」的指示，不是装饰。 */
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false });
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
    /* fork:viewer-dedupe-request —— 同一份内容的两条路径（挂载读 + watch 的
       `connected` 快照读）在慢文件上会重叠，于是把整份文本取两遍、渲染两遍。
       requestId 的自增在 `run` 里面，也就是**去重之后**：共用者不顶掉 owner 的
       id，owner 回来仍认得自己是最新（见 shareInFlightRequest 的注释）。 */
    return shareInFlightRequest(
      contentRequestsRef.current,
      `${filePath}\0${offset}`,
      () => {
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
      },
    );
  }, [sourceSessionId]);

  const fetchGitDiff = useCallback(async (targetPath: string) => {
    if (!cwd) {
      const requestId = ++gitDiffRequestRef.current;
      setGitDiff(null);
      setGitDiffLoading(false);
      if (requestId === gitDiffRequestRef.current) setGitDiffResolved(true);
      return;
    }

    /* fork:viewer-dedupe-request —— 打开一个文件时两条 effect 都会要这份 diff
       （`gitRefreshKey` 那条 + watch 的 `connected` 快照），而服务端每次都要跑一遍
       `git status` + `git diff HEAD -- <file>`（实测 175–450ms，且与同一时刻文件树
       的两次列目录抢同一个 Node 线程）。在途的同一个 (cwd, 路径) 共用一次；
       requestId 的自增在 `run` 里面（去重之后），共用者不会顶掉 owner 的 id。 */
    await shareInFlightRequest(gitDiffRequestsRef.current, `${cwd}\0${targetPath}`, async () => {
      const requestId = ++gitDiffRequestRef.current;
      setGitDiffLoading(true);
      try {
        const params = new URLSearchParams({ cwd: cwd!, path: targetPath });
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
    });
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

  /* fork:v5-boards D-06b 帧 C —— 渐隐的两端跟着滚动位置与内容高度走。
     监听挂在**已有的那个滚动容器**上（`contentRef`），不新开观察者：容器自身
     尺寸不变时 ResizeObserver 不会响，所以连它的直接子节点一起看，正文高度变了
     就会重算。判断逻辑与 `lib/scroll-follow` 的 `computeScrollMaskState` 同一口径
     （到头 4px 内就算到底），只是这里要的是「是否显示」而不是遮罩渐变。 */
  useEffect(() => {
    if (isMobile) {
      setScrollEdges((current) => (current.top || current.bottom ? { top: false, bottom: false } : current));
      return;
    }
    const element = contentRef.current;
    if (!element) return;
    const update = () => {
      const scrollable = element.scrollHeight - element.clientHeight;
      const next = {
        top: element.scrollTop > 4,
        bottom: scrollable > 4 && element.scrollTop < scrollable - 4,
      };
      setScrollEdges((current) => (current.top === next.top && current.bottom === next.bottom ? current : next));
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(update);
      observer.observe(element);
      for (const child of Array.from(element.children)) observer.observe(child);
    }
    return () => {
      element.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [isMobile, filePath, effectiveDisplayMode, diffOpen, data]);

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

  const skin = viewerSkin(isMobile);

  if ((loading && !data) || (diffOpen && gitDiffLoading && !data)) {
    return (
      <div className={skin.shellClass} style={skin.shellStyle}>
        <div className={skin.barClass}>
          <span className={skin.pathClass} title={filePath}>{getRelativeFilePath(filePath, cwd)}</span>
        </div>
        <div className={skin.scrollClass} style={{ padding: "var(--nx-sp-2)" }}>
          <div className={isMobile ? "m-skel-list" : "d-skel-list"}>
            <div className={isMobile ? "m-skel m-skel-50" : "d-skel d-skel-40"} />
            <div className={isMobile ? "m-skel m-skel-50" : "d-skel d-skel-40"} />
            <div className={isMobile ? "m-skel m-skel-block" : "d-skel d-skel-40"} />
          </div>
        </div>
      </div>
    );
  }

  if (error && !isDeletedDiff) {
    return (
      <div className={skin.shellClass} style={skin.shellStyle}>
        <div className={skin.barClass}>
          <i data-ico="triangle-alert" data-size="13" style={{ color: "var(--nx-danger)" }}></i>
          <span className={skin.pathClass} title={filePath}>{getRelativeFilePath(filePath, cwd)}</span>
        </div>
        <div className={skin.emptyClass} style={{ flex: 1 }}>
          <div className={skin.emptyIco}><i data-ico="triangle-alert" data-size="20"></i></div>
          <div className={skin.emptyTitle}>{error}</div>
        </div>
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

  /* M-06 帧 B · 手机档的分段：源码 / 差异 / 预览，三等宽，默认落在第一格「源码」。
     与 Web 的顺序一致（画板页脚第三条）。差异在手机上**只读**——它就是桌面那份
     `diffOpen` 覆盖层，同一个 state、同一份 patch 解析，所以行为完全一致，
     只是从「头行里的一枚钮」升成「分段里的第三格」。 */
  const mobileSegments: Array<{ key: string; label: string; active: boolean; onSelect: () => void }> = [
    {
      key: "source",
      label: displayModeLabel("source"),
      active: !diffOpen && effectiveDisplayMode === "source",
      onSelect: () => { updateDisplayMode("source"); if (diffOpen) updateDiffOpen(false); },
    },
    ...(hasGitDiff || isDeletedDiff
      ? [{
          key: "diff",
          label: t("files.compareHead"),
          active: diffOpen,
          onSelect: () => updateDiffOpen(!diffOpen),
        }]
      : []),
    ...(hasPreview || isDelimitedText
      ? [{
          key: "preview",
          label: displayModeLabel("preview"),
          active: !diffOpen && effectiveDisplayMode === "preview",
          onSelect: () => { updateDisplayMode("preview"); if (diffOpen) updateDiffOpen(false); },
        }]
      : []),
  ];

  return (
    <div
      data-expanded={isExpanded || undefined}
      /* M-06 —— 手机档是 `inset:0` 全屏覆盖（帧 B 第一条）；`.file-viewer-shell`
         保留：globals.css 的 `[data-expanded]` 全屏规则与 e2e 选择器都挂在它上面。 */
      className={`file-viewer-shell ${isMobile ? "m-viewer is-open" : "d-viewer"}`}
      style={isMobile ? MOBILE_VIEWER_STYLE : undefined}
    >
      {/* M-06 帧 B —— 手机档顶栏：完整路径（等宽、单行省略）+ 复制路径 + 下载。
          桌面那条 `.d-viewer-bar`（元信息徽章 / 同步点 / 模式组 / 动作簇）在
          手机上换成 `.m-viewer-bar` + 下面的 `.m-seg` + 底部 `.m-vbar`。 */}
      {isMobile ? (
        <>
          <div className="m-viewer-bar">
            <span className="file-viewer-path m-viewer-path" title={filePath}>
              {getRelativeFilePath(filePath, cwd)}
            </span>
            <button
              type="button"
              className="m-top-btn"
              title={t("files.copyPath")}
              aria-label={t("files.copyPath")}
              onClick={() => { void copyText(filePath); }}
            >
              <i data-ico="link" data-size="15" aria-hidden="true"></i>
            </button>
            {!isDeletedDiff && (
              <DownloadLink filePath={filePath} sourceSessionId={sourceSessionId} mobile />
            )}
          </div>
          {mobileSegments.length > 1 && (
            <div className="m-seg" style={{ margin: "0 12px" }} aria-label={t("i18n.fileViewMode")}>
              {mobileSegments.map((segment) => (
                <button
                  key={segment.key}
                  type="button"
                  className={segment.active ? "is-on" : undefined}
                  aria-pressed={segment.active}
                  onClick={segment.onSelect}
                >
                  {segment.label}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
      <>
      {/* fork:v5-landing —— 头行 = D-06 帧 A 的 `.d-viewer-bar`：
          面包屑 + 元信息徽章 + 同步点 + 动作区 + 模式 `.d-seg`。 */}
      <div className="d-viewer-bar">
        {/* D-06 帧 A / 帧 B 的 `.d-crumb` —— 目录段逐级、末段 `.is-on`。
            `file-viewer-path` 留着：globals.css 的 flex / 省略号挂它上面。 */}
        <div className="file-viewer-path d-crumb" title={filePath}>
          {viewerCrumbs(filePath, cwd).map((crumb, index, all) => (
            <Fragment key={crumb.path}>
              {index > 0 && <i data-ico="chevron-right" data-size="11" aria-hidden="true"></i>}
              <button
                type="button"
                className={index === all.length - 1 ? "is-on" : undefined}
                title={crumb.path}
                aria-label={`${t("files.copyPath")} ${crumb.path}`}
                onClick={() => { void copyText(crumb.path); }}
              >
                {crumb.label}
              </button>
            </Fragment>
          ))}
        </div>

        <span className="file-viewer-meta d-badge mute" title={metadata}>{metadata}</span>
        {!isDeletedDiff && (
          <span
            title={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
            aria-label={watching ? t("i18n.liveSync") : t("i18n.notWatching")}
            className={`d-dot${watching ? " ok" : ""}`}
          />
        )}

        <div className="file-viewer-controls d-row">
          {/* fork:ui-20 — copy path / reveal in the file manager / open with the default app. */}
          <PathActions path={filePath} />
          {displayModes.length > 1 && (
            /* e2e/file-viewer-modes.mjs 用 `.file-viewer-mode-switch` /
               `.file-viewer-mode-button` 定位模式组；旧视觉由 `.d-seg` 覆盖，
               只有它没声明的 border 需要归零。 */
            <div className="d-seg file-viewer-mode-switch" style={{ border: 0 }} aria-label={t("i18n.fileViewMode")}>
              {displayModes.map((mode) => {
                const active = !diffOpen && effectiveDisplayMode === mode;
                // D-06 帧 A：模式组里当前项带 `.is-on`；点自己等价于重选。
                return (
                  <button
                    key={mode}
                    type="button"
                    className={`file-viewer-mode-button${active ? " is-on" : ""}`}
                    onClick={() => {
                      updateDisplayMode(mode);
                      if (diffOpen) updateDiffOpen(false);
                    }}
                  >
                    {displayModeLabel(mode)}
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
              className={`d-btn sm file-viewer-diff-toggle${diffOpen ? " is-on" : ""}`}
              style={diffOpen ? { background: "var(--nx-accent-soft)", borderColor: "var(--nx-accent)", color: "var(--nx-accent)" } : undefined}
            >
              <i data-ico="git-compare" data-size="13"></i>
              {t("files.compareHead")}
            </button>
          )}

          <div className="file-viewer-actions d-row">
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
                className="d-iconbtn"
              >
                <i data-ico="at-sign" data-size="14"></i>
              </button>
            )}
            <button
              type="button"
              className="d-iconbtn"
              title={t(isExpanded ? "files.collapse" : "files.expand")}
              aria-label={t(isExpanded ? "files.collapse" : "files.expand")}
              aria-pressed={isExpanded}
              onClick={() => setIsExpanded((value) => !value)}
            >
              {/* fork:ui-expand — ⤢ 把文档铺满整个应用窗口（原来的 Fullscreen API 按钮已并入这里）。 */}
              <i data-ico={isExpanded ? "minimize-2" : "maximize-2"} data-size="14"></i>
            </button>
            {!liveEditing && !diffOpen && effectiveDisplayMode === "source" && (
              <>
                <button
                  type="button"
                  onClick={toggleWrapLines}
                  title={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
                  aria-label={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
                  aria-pressed={wrapLines}
                  className="d-iconbtn"
                  style={{
                    background: wrapLines ? "var(--nx-selected)" : "transparent",
                    color: wrapLines ? "var(--nx-text)" : "var(--nx-text-3)",
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
      </>
      )}

      {data?.truncated && (
        isMobile ? (
          <div className="m-banner" style={{ margin: "8px 12px 0" }}>
            <span className="m-t-xs m-t-faint">{formatSize(data.nextOffset)} / {formatSize(data.size)}</span>
            <span className="m-grow" />
            <button
              type="button"
              className="m-picktag"
              disabled={loadingMore}
              onClick={() => {
                setLoadingMore(true);
                void fetchContent(filePath, data.nextOffset).finally(() => setLoadingMore(false));
              }}
            >
              {loadingMore ? t("i18n.loading") : t("i18n.loadMore")}
            </button>
          </div>
        ) : (
        <div className="d-banner">
          <span className="d-t-xs d-t-faint">{formatSize(data.nextOffset)} / {formatSize(data.size)}</span>
          <span className="d-grow" />
          <button
            type="button"
            className="d-btn sm"
            disabled={loadingMore}
            onClick={() => {
              setLoadingMore(true);
              void fetchContent(filePath, data.nextOffset).finally(() => setLoadingMore(false));
            }}
          >
            {loadingMore ? t("i18n.loading") : t("i18n.loadMore")}
          </button>
        </div>
        )
      )}

      {/* Content area */}
      {/* 渐隐条需要一块定位宿主，所以滚动区外面套一层：`position: relative` 与 flex
          基座都是几何（铁律四允许内联），不引入任何视觉值。手机档不画渐隐条
          （PWA 形态同一件事由顶栏的 `.m-fade` 承担）。 */}
      <div
        style={{ position: "relative", flex: "1 1 auto", minHeight: 0, display: "flex", flexDirection: "column" }}
      >
      <div
        ref={contentRef}
        /* `file-viewer-content` 是 e2e / 脚本的选择器（`file-viewer-content` 非 pw 钩子），
           两种形态都保留；视觉壳按断点在 `.d-viewer-scroll` / `.m-viewer-scroll` 之间换。 */
        /* fork:v5-boards D-06b 帧 C —— 长列表滚动区 = `.d-viewer-scroll.d-row-in`：
           打开一个文件就是一次「列表进入」（FileViewer 由 AppShell 按 fileTab 键控，
           换文件即重挂载），档案打开时列表从上方 6px 淡入，与板面同一条 nx-list-in。
           只在 Web 形态挂 d- 类，不往 PWA 形态里混 d-*。 */
        className={`file-viewer-content ${isMobile ? "m-viewer-scroll" : "d-viewer-scroll d-row-in"}`}
        onScroll={(event) => {
          viewerStateRef.current.scrollTop = event.currentTarget.scrollTop;
          viewerStateRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
        style={{ background: "var(--nx-canvas)", paddingBottom: data?.truncated ? 48 : undefined }}
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
                    `.d-viewer`（flex 列 + `height: 100%`），而本层原来是 auto 高度，
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
                      background: "var(--nx-canvas)",
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
              /* fix:viewer-html-stage-fill（用户 2026-10-06 截图）—— 预览层**不能**整体
                 锁高度：`fix:viewer-stage-fill` 已经写过原因，里面的 markdown / CSV 是随
                 内容长的，锁死就滚不动。但 HTML 那一支不一样：预览器是
                 `<iframe style="height:100%">`，挂在 auto 高度的层上时百分比落回 auto，
                 浏览器给它 UA 默认的 **150px** —— 于是那张签约表单被切成一条 150px 的
                 窄带（只剩标题和第一个字段），下面一大片空白（用户实测）。所以**只有
                 HTML 这一支**给这一层确定高度，让 iframe 铺满面板、自己滚。 */
              <div
                data-file-stage="preview"
                hidden={diffOpen || effectiveDisplayMode !== "preview"}
                style={isHtml ? { height: "100%", minHeight: 0 } : undefined}
              >
                {isHtml ? (
                  <iframe
                    srcDoc={content}
                    sandbox="allow-scripts"
                    style={{ width: "100%", height: "100%", border: "none", background: "var(--nx-canvas)" }}
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
              <div className="d-empty" role="status">
                <div className="d-empty-ico"><i data-ico="file-clock" data-size="20"></i></div>
                <div className="d-empty-t">{t("files.deletedNotice")}</div>
              </div>
            )}
            {diffOpen && (
              <div className="file-viewer-diff-overlay">
                {/* fork:v5-landing —— 覆盖层横幅 = D-06b 帧 B 的 `.d-banner`（ico + 文案 + grow + `.d-btn`）。 */}
                <div className="file-viewer-diff-banner d-banner" role="status">
                  <i data-ico={isDeletedDiff ? "file-diff" : "git-compare"} data-size="14"></i>
                  <span className="d-grow">{isDeletedDiff ? t("files.deletedNotice") : t("files.compareHead")}</span>
                  <button
                    type="button"
                    onClick={() => updateDiffOpen(false)}
                    className="d-btn sm d-banner-btn"
                  >
                    {t("files.backToSource")}
                  </button>
                </div>
                {/* M-06 帧 B —— 手机档换 PWA 形态的代码壳（`.m-code` / `.m-code-body`
                    + `.m-code-scroll` 横滚不折行）；桌面仍是 D-06 的 `.d-code`。 */}
                <div className={isMobile ? "m-code" : "d-code"} style={{ border: 0, borderRadius: 0 }}>
                  <div
                    className={isMobile ? "m-code-body m-code-scroll" : "d-code-body"}
                    style={isMobile ? { padding: 0 } : { padding: "var(--nx-sp-2) 0" }}
                  >
                    {hasGitDiff
                      ? <DiffView patch={gitDiff.patch!} />
                      : <div className="d-t-xs d-t-faint" style={{ padding: "12px 16px" }}>{t("i18n.loading")}</div>}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
        {/* D-06b 帧 C —— 上下两条渐隐：只提示「上面还有 / 下面还有」。库里已把它们
            定义成 `pointer-events: none` 的绝对定位条，所以这里既不吃点击也不占布局；
            滚到那一端自动消失。 */}
        {!isMobile && scrollEdges.top && <div className="d-fade" aria-hidden="true" />}
        {!isMobile && scrollEdges.bottom && <div className="d-fade-tail" aria-hidden="true" />}
      </div>
      {/* M-06 帧 B · 底部动作条三项等分。桌面上这些动作挤在 `.d-viewer-bar` 的
          动作簇里（44px 命中区在 390 宽上不够），手机上搬到常驻底条：
            复制路径 = 顶栏那枚 link 的同一个动作；
            交给会话 = 头行那枚 `at-sign` 的同一个 handler（有选区就提选区，
              否则提整个文件 —— 与桌面逐字一致）；
            折行 = 头行那枚折行开关的同一个 toggle。
          画板第三格写的是「分享」，本产品没有分享动作（那是新行为），换成已存在的
          「折行」—— 折行的代码没法复制，所以它在手机上比分享更该在这一排里。
          `file-viewer-shell` 保留：globals.css 的 `[data-expanded]` 全屏规则挂在它上面。 */}
      {isMobile && (
        <div className="m-vbar">
          <button
            type="button"
            className="m-menu-row"
            onClick={() => { void copyText(filePath); }}
          >
            <i data-ico="copy" data-size="15" aria-hidden="true"></i>{t("files.copyPath")}
          </button>
          <button
            type="button"
            className="m-menu-row"
            disabled={!onAtMention && !onMentionLines}
            onClick={() => {
              if (selectedLineRange && onMentionLines) mentionLineRange(selectedLineRange);
              else onAtMention?.(getRelativeFilePath(filePath, cwd), false);
            }}
          >
            <i data-ico="square-pen" data-size="15" aria-hidden="true"></i>{t("files.mention")}
          </button>
          {!liveEditing && effectiveDisplayMode === "source" && (
            <button
              type="button"
              className={`m-menu-row${wrapLines ? " is-on" : ""}`}
              aria-pressed={wrapLines}
              title={wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
              onClick={toggleWrapLines}
            >
              {/* icons.js 未注册 wrap-text（lucide 官名 text-wrap），与头行那枚
                  同款登记缺口：这里复用同一段内联 lucide 路径。 */}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M3 12h15a3 3 0 1 1 0 6h-4" />
                <path d="m16 16-2 2 2 2" />
                <path d="M3 18h7" />
              </svg>
              {wrapLines ? t("i18n.disableWrap") : t("i18n.enableWrap")}
            </button>
          )}
        </div>
      )}

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
