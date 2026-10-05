"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useTheme } from "@/hooks/useTheme";
import { TEXT } from "@/lib/typography";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { type GitCommitFile, type GitLogResponse } from "@/lib/git-graph";
import type { GitLogCommit } from "@/lib/git-graph-parser";
import { buildGitGraphLayout, type GitGraphLayout } from "@/lib/git-graph-lanes";
import { gitGraphEdgePath } from "@/lib/git-graph-geometry";
import { deriveLanePalette } from "@/lib/git-graph-palette";
import { parseGitRefTags } from "@/lib/git-graph-refs";
import { RefTagList } from "./GitRefChips";

interface Props {
  /** Repository/worktree directory whose history the tab shows. */
  cwd: string;
  /** Open a file mentioned in a commit's changed-file list (source mode). */
  onOpenFile: (filePath: string, fileName: string) => void;
  /** 插入 @comment: 提交引用到输入框。本仓库还没有 @comment 体系（见 PR-08 后续），
   *  保留 prop 是为了接的时候不用再改组件内部。 */
  onMentionCommit?: (commit: GitLogCommit) => void;
}

/* fork:git-graph-tab — 右栏 Git 图谱。数据层见 lib/git-graph*（纯函数 + 自带测试），
   这里只负责画：泳道由 buildGitGraphLayout 算，几何由 gitGraphEdgePath 算，
   颜色由 deriveLanePalette 从主题 accent 派生后以 CSS 变量下发。

   fork:v5-skin D-05 帧 D —— 面板头照画板 .d-panel-head / .d-iconbtn，提交明细
   走 .d-git-row / .d-git-lane / .d-subhead；**泳道自绘 SVG 是登记例外**，保留。 */


const DEFAULT_LIMIT = 400;
const LIMIT_STEP = 400;
const MAX_LIMIT = 2000;

// Geometry (px): lane column width, node radii, and elbow corner radius. Rows
// have individual heights — only the newest commit (row 0) carries a second
// info line, so it is taller and its node is drawn as a slightly larger ring
// marking HEAD. The graph and the commit text are separate side-by-side
// columns joined by a draggable divider: the graph column hugs the drawn lanes
// (last lane center + node allowance) and scrolls horizontally on its own when
// dragged narrower than the drawn width.
const ROW_H = 26;
const FIRST_ROW_H = 44;
const COL_W = 18;
const NODE_R = 4;
const HEAD_NODE_R = 6;
const CORNER_R = 7;
const GRAPH_PAD_LEFT = 8;
const GRAPH_PAD_RIGHT = 8;
const TEXT_GAP = 10;
const MIN_TEXT_WIDTH = 140;
const GRAPH_COL_MIN = 28;
const GRAPH_COL_MAX = 480;
// The divider is a 5px hit strip with a 1px line centered inside it.
const DIVIDER_W = 5;
// Best-effort divider-position memory, following the desktop localStorage
// conventions (silently ignored when storage is unavailable).
const GRAPH_COL_WIDTH_KEY = "pi-git-graph-col-width";
// How close to the bottom edge (px) the scroll view must get before the
// floating "load more" button fades in.
const BOTTOM_THRESHOLD = 32;

const rowHeightOf = (row: number) => (row === 0 ? FIRST_ROW_H : ROW_H);

/** fork:v5-landing D-05 帧 D —— 提交行行首泳道格（`.d-git-lane`）的图标。
 *  只按**真实的父子关系**挑，挑不出来就不冒充分支：
 *  · 第一行（git log 的 HEAD）= `circle-dot`；
 *  · 多父提交 = `git-merge`；
 *  · 在已加载窗口里有 2 个以上子提交（分叉点）= `git-branch`；
 *  · 其余 = `git-commit-horizontal`。
 *  （泳道本身的连线仍是左列自绘 SVG —— DIVERGENCE 已登记例外，不动。） */
function gitLaneIcon(
  commit: GitLogCommit,
  row: number,
  childCounts: Map<string, number>,
): "circle-dot" | "git-merge" | "git-branch" | "git-commit-horizontal" {
  if (row === 0) return "circle-dot";
  if (commit.parents.length > 1) return "git-merge";
  if ((childCounts.get(commit.hash) ?? 0) > 1) return "git-branch";
  return "git-commit-horizontal";
}

/** Cumulative top offset of each row; rows are not uniformly tall. */
function computeRowTops(rowCount: number): number[] {
  const tops: number[] = [];
  let top = 0;
  for (let row = 0; row < rowCount; row += 1) {
    tops.push(top);
    top += rowHeightOf(row);
  }
  return tops;
}

const laneX = (lane: number) => GRAPH_PAD_LEFT + lane * COL_W + COL_W / 2;

/**
 * Clamp a requested graph-column width. The upper bound is additionally
 * limited by the visible body width so the text column always keeps
 * MIN_TEXT_WIDTH; when the body is not measurable yet (first paint) only the
 * absolute cap applies.
 */
function clampGraphColWidth(value: number, bodyWidth: number): number {
  const absoluteMax = bodyWidth > 0
    ? Math.min(GRAPH_COL_MAX, bodyWidth - MIN_TEXT_WIDTH)
    : GRAPH_COL_MAX;
  return Math.round(Math.min(Math.max(value, GRAPH_COL_MIN), Math.max(absoluteMax, GRAPH_COL_MIN)));
}

function loadStoredGraphColWidth(): number | null {
  try {
    const parsed = Number(window.localStorage.getItem(GRAPH_COL_WIDTH_KEY));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function storeGraphColWidth(value: number): void {
  try {
    window.localStorage.setItem(GRAPH_COL_WIDTH_KEY, String(value));
  } catch {
    // Storage unavailable (private mode, quota) — the divider just won't persist.
  }
}

// Commit file status letters → the git status colors the rest of the UI uses.
const COMMIT_CODE_COLORS: Record<string, string> = {
  M: "var(--nx-warning)",
  R: "var(--nx-warning)",
  T: "var(--nx-warning)",
  A: "var(--nx-success)",
  C: "var(--nx-success)",
  D: "var(--nx-danger)",
  U: "var(--nx-danger)",
};

function CommitFileRow({ file, cwd, onOpenFile }: {
  file: GitCommitFile;
  cwd: string;
  onOpenFile: Props["onOpenFile"];
}) {
  const relativePath = getRelativeFilePath(file.filePath, cwd);
  const fileName = getFileName(file.filePath);
  const trailingDirectory = relativePath.endsWith(fileName)
    ? relativePath.slice(0, relativePath.length - fileName.length)
    : null;
  const directoryText = trailingDirectory !== null ? trailingDirectory : relativePath;
  const color = COMMIT_CODE_COLORS[file.code] ?? "var(--nx-warning)";

  return (
    <button
      type="button"
      onClick={() => onOpenFile(file.filePath, fileName)}
      title={file.filePath}
      /* fork:v5-skin D-05 帧 D —— 提交文件行 = 画板 .d-git-row（26px 行高 + hover 叠色）。
         button 的 UA 归零在 fork:design-components 的按钮归零层做。 */
      className="d-git-row"
      style={{ width: "100%", border: 0, background: "none", font: "inherit", textAlign: "left", cursor: "pointer" }}
    >
      <span className="d-mono" style={{ width: "var(--icon-sm)", flexShrink: 0, color, fontWeight: 600, textAlign: "center" }}>{file.code}</span>
      <span className="d-grow" style={{ minWidth: 0, overflow: "hidden", display: "flex", alignItems: "baseline", whiteSpace: "nowrap" }}>
        <span style={{ flexShrink: 0 }}>{fileName}</span>
        {directoryText && directoryText !== fileName && (
          <span className="d-t-faint" style={{ overflow: "hidden", textOverflow: "ellipsis", marginLeft: "var(--nx-sp-1)" }}>{directoryText}</span>
        )}
      </span>
    </button>
  );
}

export function GitGraphTab({ cwd, onOpenFile }: Props) {
  const { t, locale } = useI18n();
  // M-07 帧 D —— 手机档：只读泳道清单（`.m-cardgroup` + `.m-setrow`）。
  const isMobile = useIsMobile();
  const { theme, isDark } = useTheme();
  // accent 是 BoardUI 桥接后的 CSS 变量；主题切换会换 <html> 上的类，所以以
  // theme/isDark 作为重算信号即可（不必再订阅一份 token 表）。
  const accent = useMemo(
    () => (typeof window === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()),
    [theme, isDark],
  );
  const [data, setData] = useState<GitLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<GitCommitFile[] | null>(null);
  const [commitLoading, setCommitLoading] = useState(false);
  // Per-hash file-list cache: re-selecting a viewed commit restores its
  // detail instantly instead of re-fetching with a spinner round-trip. The
  // in-flight slot discards stale responses when a different row is clicked
  // mid-fetch (otherwise a slow A response would overwrite selected B).
  const commitFilesCacheRef = useRef<Map<string, GitCommitFile[]>>(new Map());
  const commitFetchRef = useRef<string | null>(null);
  // null = "hug the drawn lanes"; a number means the user picked a width.
  const [graphColWidth, setGraphColWidth] = useState<number | null>(loadStoredGraphColWidth);
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const load = useCallback(async (requestedLimit: number) => {
    setLoading(true);
    // History may have changed (new commits, rebase); cached per-commit file
    // lists are no longer trustworthy.
    commitFilesCacheRef.current.clear();
    try {
      const response = await fetch(`/api/git/log?${new URLSearchParams({ cwd, limit: String(requestedLimit) }).toString()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json() as GitLogResponse);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void load(limit);
  }, [load, limit]);

  const layout: GitGraphLayout | null = useMemo(
    () => (data && data.commits.length > 0 ? buildGitGraphLayout(data.commits, "compact") : null),
    [data],
  );

  // Lane colors follow the theme applied to the DOM: useTheme re-publishes
  // the accent after every theme/mode application, so this recomputes
  // reactively — including while the tab sits hidden in the keep-alive cache.
  // deriveLanePalette inherits the variant's own accent tuning (lightness
  // passthrough); isDark only picks the fallback palette family.
  const palette = useMemo(() => deriveLanePalette(accent, isDark), [accent, isDark]);

  const timeFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
    [locale],
  );

  // The derived palette is published as CSS custom properties on the tab root,
  // so every visible color (edges, nodes, ref chips) resolves from a var() and
  // stays overridable from the theme layer.
  const laneVars = useMemo(() => {
    const vars: Record<string, string> = {};
    palette.forEach((color, index) => {
      vars[`--git-graph-lane-${index}`] = color;
    });
    // CSS custom properties are valid style keys but not in React's CSSProperties index.
    return vars as CSSProperties;
  }, [palette]);
  const laneVar = (colorIndex: number) => `var(--git-graph-lane-${colorIndex % palette.length})`;

  const selectedNode = layout?.nodes.find((node) => node.hash === selectedHash) ?? null;
  const selectedCommit = selectedNode ? data?.commits[selectedNode.row] ?? null : null;

  const selectCommit = useCallback(async (hash: string) => {
    setSelectedHash(hash);
    const cached = commitFilesCacheRef.current.get(hash);
    if (cached) {
      setCommitFiles(cached);
      setCommitLoading(false);
      return;
    }
    // Same-hash fetch already in flight (rapid re-click): keep waiting on it.
    if (commitFetchRef.current === hash) return;
    commitFetchRef.current = hash;
    setCommitFiles(null);
    setCommitLoading(true);
    try {
      const response = await fetch(`/api/git/log?${new URLSearchParams({ cwd, commit: hash }).toString()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const files = (await response.json() as { files?: GitCommitFile[] }).files ?? [];
      // Cache regardless of what is selected — the list is valid data.
      commitFilesCacheRef.current.set(hash, files);
      // Apply only if this hash is still the latest request; a newer click
      // owns the detail panel now.
      if (commitFetchRef.current === hash) setCommitFiles(files);
    } catch {
      if (commitFetchRef.current === hash) setCommitFiles(null);
    } finally {
      if (commitFetchRef.current === hash) {
        setCommitLoading(false);
        commitFetchRef.current = null;
      }
    }
  }, [cwd]);

  const closeDetail = useCallback(() => {
    setSelectedHash(null);
    setCommitFiles(null);
  }, []);

  // The "load more" button lives inside the scroll view as a sticky footer and
  // only appears once the list is scrolled to (near) its bottom, so it does
  // not permanently occupy space under the graph.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [atListBottom, setAtListBottom] = useState(false);
  const updateAtListBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtListBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - BOTTOM_THRESHOLD);
  }, []);

  useEffect(() => {
    updateAtListBottom();
  }, [data, layout, updateAtListBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => updateAtListBottom());
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateAtListBottom]);

  const graphWidth = layout
    ? GRAPH_PAD_LEFT + Math.max(layout.laneCount - 1, 0) * COL_W + COL_W / 2 + GRAPH_PAD_RIGHT
    : 0;
  // While the user has not picked a width, the graph column hugs the drawn
  // lanes so sparse histories never waste text space.
  const graphColW = clampGraphColWidth(graphColWidth ?? graphWidth, scrollRef.current?.clientWidth ?? 0);
  /* D-05 帧 D —— 分叉点必须「真能对上父子关系」才标 `git-branch`：只数**已加载窗口**
     里的子提交数。历史被截断时宁可不标，也不凭空指一条分支。 */
  const childCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const commit of data?.commits ?? []) {
      for (const parent of commit.parents) counts.set(parent, (counts.get(parent) ?? 0) + 1);
    }
    return counts;
  }, [data]);
  const rowTops = useMemo(() => computeRowTops(data?.commits.length ?? 0), [data]);
  const svgHeight = rowTops.length > 0 ? rowTops[rowTops.length - 1] + rowHeightOf(rowTops.length - 1) + 8 : 0;

  const applyGraphColWidth = useCallback((value: number) => {
    const next = clampGraphColWidth(value, scrollRef.current?.clientWidth ?? 0);
    setGraphColWidth(next);
    storeGraphColWidth(next);
  }, []);

  // Pointer-capture drag: move/up keep firing on the divider even when the
  // cursor leaves it, so no window-level listeners are needed.
  const dividerDragRef = useRef<{ startX: number; startWidth: number; width: number } | null>(null);

  const startDividerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dividerDragRef.current = { startX: event.clientX, startWidth: graphColW, width: graphColW };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
  };

  const moveDividerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dividerDragRef.current;
    if (!drag) return;
    drag.width = clampGraphColWidth(drag.startWidth + event.clientX - drag.startX, scrollRef.current?.clientWidth ?? 0);
    setGraphColWidth(drag.width);
  };

  const endDividerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dividerDragRef.current;
    if (!drag) return;
    dividerDragRef.current = null;
    setIsResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    storeGraphColWidth(drag.width);
  };

  // Both columns render one hit-row per commit; sharing the hover state keeps
  // the highlight continuous across the divider. Hover is only cleared when
  // the pointer leaves the whole body, so crossing the 5px divider does not
  // blink the band off.
  const rowBackground = (hash: string) =>
    hash === selectedHash ? "var(--nx-selected)" : hash === hoveredHash ? "var(--nx-surface)" : "transparent";
  const rowHitProps = (hash: string) => ({
    onClick: () => void selectCommit(hash),
    onMouseEnter: () => setHoveredHash(hash),
  });


  /* ── M-07 帧 D · 手机档 ────────────────────────────────────────────────────
     画板原话：「泳道顺序 + 未提交改动 + 分支关系，提交 / 推送 / rebase 一个按钮都
     不下放到手机」。桌面那一版的泳道是自绘 SVG（**登记例外**，保留），手机上没有
     第二套绘制：改成画板画的那张清单 —— `.m-cardgroup` 里一行一个提交，
     `.m-setrow` + `.m-setrow-t`（等宽短 hash）+ `.m-setrow-s`（标题），
     HEAD / 本轮 用 `.m-badge`。
     行为一字未变：还是同一个 `selectCommit`（含按 hash 缓存）、同一个
     `CommitFileRow` → `onOpenFile`、同一个 `load` 与「加载更多」。
     泳道列宽拖拽（桌面）这一档在手机上不画 —— 画板手机形态没有分隔条，
     它属于桌面那份分栏几何，报给父会话。 */
  if (isMobile) {
    const commits = data?.commits ?? [];
    return (
      <div
        style={{ display: "flex", flexDirection: "column", position: "relative", flex: "1 1 auto", minHeight: 0 }}
      >
        <div className="m-fade" aria-hidden="true" />
        <div className="m-top">
          <span className="m-top-title m-grow" title={cwd}>Git · {getFileName(cwd)}</span>
          <button
            type="button"
            className="m-top-btn"
            onClick={() => void load(limit)}
            disabled={loading}
            title={t("git.refresh")}
            aria-label={t("git.refresh")}
          >
            <i data-ico="refresh-cw" data-size="16" className={loading ? "animate-spin" : undefined} aria-hidden="true"></i>
          </button>
        </div>

        <div className="m-settings">
          {data && data.isGitRepository && (
            <div className="m-banner">
              <i data-ico="git-branch" data-size="14" aria-hidden="true"></i>
              <span className="m-grow m-t-xs">{t("git.graph")}</span>
              <span className="m-badge mute">{commits.length}</span>
            </div>
          )}

          {data === null ? null : !data.isGitRepository ? (
            <div className="m-empty">
              <div className="m-empty-ico"><i data-ico="git-branch" data-size="20" aria-hidden="true"></i></div>
              <div className="m-empty-s">{t("git.notRepository")}</div>
            </div>
          ) : commits.length === 0 ? (
            <div className="m-empty">
              <div className="m-empty-ico"><i data-ico="git-commit-horizontal" data-size="20" aria-hidden="true"></i></div>
              <div className="m-empty-s">{t("git.empty")}</div>
            </div>
          ) : (
            <>
              <div className="m-cardgroup">
                <div className="m-group-title">{t("git.graph")}</div>
                {commits.map((commit, row) => {
                  const selected = commit.hash === selectedHash;
                  return (
                    <button
                      key={commit.hash}
                      type="button"
                      className={`m-setrow${selected ? " is-on" : ""}`}
                      aria-pressed={selected}
                      title={commit.subject}
                      onClick={() => void selectCommit(commit.hash)}
                    >
                      <i data-ico={row === 0 ? "circle-dot" : "git-commit-horizontal"} data-size="16" aria-hidden="true"></i>
                      <span className="m-setrow-body">
                        <span className="m-setrow-t m-mono">{commit.hash.slice(0, 10)}</span>
                        <span className="m-setrow-s">{commit.subject}</span>
                      </span>
                      {/* HEAD 是 git 自己的术语，两端语言都不翻译（同画板帧 D 的写法）。 */}
                      {row === 0 && <span className="m-badge ok">HEAD</span>}
                    </button>
                  );
                })}
              </div>

              {selectedCommit && (
                <div className="m-cardgroup">
                  <div className="m-group-title">{t("git.commitFiles")}</div>
                  <div className="m-setrow">
                    <i data-ico="git-commit-horizontal" data-size="16" aria-hidden="true"></i>
                    <span className="m-setrow-body">
                      <span className="m-setrow-t">{selectedCommit.subject}</span>
                      <span className="m-setrow-s">
                        {`${selectedCommit.author} · ${timeFormat.format(new Date(selectedCommit.timestamp * 1000))} · ${selectedCommit.hash.slice(0, 10)}`}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="m-iconbtn m-touch-44"
                      onClick={closeDetail}
                      title={t("i18n.close")}
                      aria-label={t("i18n.close")}
                    >
                      <i data-ico="x" data-size="14" aria-hidden="true"></i>
                    </button>
                  </div>
                  {commitLoading ? (
                    <div className="m-setrow"><span className="m-grow m-t-faint">{t("i18n.loading")}</span></div>
                  ) : commitFiles && commitFiles.length > 0 ? (
                    commitFiles.map((file) => {
                      const fileName = getFileName(file.filePath);
                      return (
                        <button
                          key={`${file.code}:${file.filePath}`}
                          type="button"
                          className="m-setrow"
                          title={file.filePath}
                          onClick={() => onOpenFile(file.filePath, fileName)}
                        >
                          <i data-ico="file-code" data-size="16" aria-hidden="true"></i>
                          <span className="m-setrow-body">
                            <span className="m-setrow-t m-mono">{getRelativeFilePath(file.filePath, cwd)}</span>
                            <span className="m-setrow-s">{file.code}</span>
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="m-setrow"><span className="m-grow m-t-faint">-</span></div>
                  )}
                </div>
              )}

              {data.truncated && (
                <div className="m-pickbar">
                  <button
                    type="button"
                    className="m-picktag"
                    disabled={loading}
                    onClick={() => setLimit((current) => Math.min(current + LIMIT_STEP, MAX_LIMIT))}
                  >
                    {t("git.loadMore")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...laneVars, height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", userSelect: isResizing ? "none" : undefined }}>
      <div className="d-panel-head">
        <i data-ico="git-branch" data-size="14" aria-hidden="true"></i>
        <span className="d-grow d-viewer-path" title={cwd}>{cwd}</span>
        <button
          type="button"
          className="d-iconbtn"
          onClick={() => void load(limit)}
          disabled={loading}
          title={t("git.refresh")}
          aria-label={t("git.refresh")}
        >
          <i data-ico="refresh-cw" data-size="14" className={loading ? "animate-spin" : undefined} aria-hidden="true"></i>
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={updateAtListBottom}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}
      >
        {data === null ? null : !data.isGitRepository ? (
          <div className="d-empty compact" style={{ height: "100%" }}>
            <div className="d-empty-s">{t("git.notRepository")}</div>
          </div>
        ) : data.commits.length === 0 ? (
          <div className="d-empty compact" style={{ height: "100%" }}>
            <div className="d-empty-s">{t("git.empty")}</div>
          </div>
        ) : layout && (
          <div
            style={{ position: "relative", display: "flex", alignItems: "stretch", height: svgHeight }}
            onMouseLeave={() => setHoveredHash(null)}
          >
            {/* Row highlight layer spans the full body width behind both
                columns and the divider, so hover/selection reads as one
                continuous band instead of breaking at the divider. The
                columns and the divider stay transparent above it. */}
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              {layout.nodes.map((node) => (
                <div
                  key={`hl-${node.hash}`}
                  style={{ position: "absolute", left: 0, right: 0, top: rowTops[node.row], height: rowHeightOf(node.row), background: rowBackground(node.hash) }}
                />
              ))}
            </div>
            {/* Graph column: it owns the horizontal scrolling, so dragging it
                narrower than the drawn lanes scrolls instead of truncating.
                The SVG sits above the row hit-areas but ignores pointer
                events, so the highlight band stays behind the lines. */}
            <div style={{ width: graphColW, flexShrink: 0, overflowX: "auto", overflowY: "hidden" }}>
              <div
                style={{ position: "relative", width: "100%", minWidth: graphWidth, height: svgHeight }}
                role="img"
                aria-label={t("git.graph")}
              >
                <svg
                  width={graphWidth}
                  height={svgHeight}
                  style={{ position: "absolute", top: 0, left: 0, zIndex: 1, pointerEvents: "none", display: "block" }}
                  aria-hidden="true"
                >
                  {layout.edges.map((edge, index) => (
                    <path
                      key={`edge-${index}`}
                      d={gitGraphEdgePath(edge, { laneX, rowTops, rowHeight: rowHeightOf, cornerRadius: CORNER_R })}
                      fill="none"
                      stroke={laneVar(edge.colorIndex)}
                      strokeWidth={1.5}
                    />
                  ))}
                  {layout.nodes.map((node) => {
                    const isHeadRow = node.row === 0;
                    return (
                      <circle
                        key={`node-${node.hash}`}
                        cx={laneX(node.lane)}
                        cy={rowTops[node.row] + rowHeightOf(node.row) / 2}
                        r={isHeadRow ? HEAD_NODE_R : NODE_R}
                        fill={isHeadRow ? "var(--nx-panel)" : laneVar(node.colorIndex)}
                        stroke={isHeadRow ? laneVar(node.colorIndex) : "var(--nx-panel)"}
                        strokeWidth={isHeadRow ? 2 : 1.5}
                      />
                    );
                  })}
                </svg>
                {layout.nodes.map((node) => (
                  <div
                    key={`hit-${node.hash}`}
                    {...rowHitProps(node.hash)}
                    title={data.commits[node.row].subject}
                    style={{ position: "absolute", left: 0, right: 0, top: rowTops[node.row], height: rowHeightOf(node.row), cursor: "pointer" }}
                  />
                ))}
              </div>
            </div>

            {/* Draggable divider between graph and text columns. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t("git.resizeGraph")}
              aria-valuemin={GRAPH_COL_MIN}
              aria-valuemax={GRAPH_COL_MAX}
              aria-valuenow={graphColW}
              tabIndex={0}
              onPointerDown={startDividerDrag}
              onPointerMove={moveDividerDrag}
              onPointerUp={endDividerDrag}
              onPointerCancel={endDividerDrag}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                applyGraphColWidth(graphColW + (event.key === "ArrowLeft" ? -COL_W : COL_W));
              }}
              style={{ flexShrink: 0, width: DIVIDER_W, display: "flex", justifyContent: "center", cursor: "col-resize", touchAction: "none" }}
            >
              <div style={{ width: 1, height: "100%", background: "color-mix(in srgb, var(--nx-line) 55%, transparent)" }} />
            </div>

            {/* Text column: takes whatever width the divider leaves. */}
            <div style={{ flex: 1, minWidth: 0, position: "relative", height: svgHeight, overflow: "hidden" }}>
              {layout.nodes.map((node) => {
                const commit = data.commits[node.row];
                const isHeadRow = node.row === 0;
                return (
                  <div
                    key={`row-${node.hash}`}
                    {...rowHitProps(node.hash)}
                    title={commit.subject}
                    style={{ position: "absolute", left: 0, right: 0, top: rowTops[node.row], height: rowHeightOf(node.row), display: "flex", alignItems: "center", cursor: "pointer" }}
                  >
                    <div style={{ flex: 1, minWidth: 0, paddingLeft: TEXT_GAP, paddingRight: 10, display: "flex", flexDirection: "column", justifyContent: "center", gap: 2 }}>
                      {/* fork:v5-landing D-05 帧 D —— 提交行 = 画板 `.d-git-row` 的骨架：
                          泳道格 `.d-git-lane`（图标按真实拓扑挑）+ `.d-mono` 短哈希 +
                          `.d-grow` 说明 + 行尾 ref 徽章。 */}
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-ctrl)", minWidth: 0 }}>
                        <span className="d-git-lane">
                          <i data-ico={gitLaneIcon(commit, node.row, childCounts)} data-size={14} aria-hidden="true"></i>
                        </span>
                        <span className="d-mono" style={{ flexShrink: 0, color: "var(--nx-text-3)" }}>{commit.hash.slice(0, 7)}</span>
                        <span className="d-grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: TEXT.md, fontWeight: 500, color: "var(--nx-text)" }}>
                          {commit.subject}
                        </span>
                        <RefTagList tags={parseGitRefTags(commit.refs)} laneColor={laneVar(node.colorIndex)} />
                      </div>
                      {isHeadRow && (
                        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "var(--nx-font-mono)", fontSize: TEXT["2xs"], color: "var(--nx-text-2)" }}>
                          {commit.author} · {timeFormat.format(new Date(commit.timestamp * 1000))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {data?.isGitRepository && data.truncated && (
          <div
            style={{
              position: "sticky",
              bottom: 0,
              zIndex: 2,
              display: "flex",
              justifyContent: "center",
              padding: "var(--space-row) 0 8px",
              // Opaque backing so pinned graph rows/text don't show through.
              background: "var(--nx-panel)",
              pointerEvents: atListBottom ? "auto" : "none",
              opacity: atListBottom ? 1 : 0,
              visibility: atListBottom ? "visible" : "hidden",
              transition: "opacity 0.15s ease, visibility 0.15s ease",
            }}
          >
            <button
              type="button"
              className="d-btn sm"
              onClick={() => setLimit((current) => Math.min(current + LIMIT_STEP, MAX_LIMIT))}
              disabled={loading}
            >
              {t("git.loadMore")}
            </button>
          </div>
        )}
      </div>

      {selectedCommit && (
        <div style={{ flexShrink: 0, maxHeight: "45%", overflowY: "auto", overflowX: "hidden", borderTop: "1px solid var(--nx-line)", padding: "8px 10px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-row)" }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: TEXT.md, fontWeight: 500, color: "var(--nx-text)", wordBreak: "break-word" }}>
              {selectedCommit.subject}
              {selectedCommit.refs.length > 0 && selectedNode && (
                <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: "var(--s1)", marginLeft: "var(--space-row)", verticalAlign: "middle" }}>
                  <RefTagList tags={parseGitRefTags(selectedCommit.refs)} laneColor={laneVar(selectedNode.colorIndex)} />
                </span>
              )}
            </span>
            <button
              type="button"
              className="d-iconbtn"
              onClick={closeDetail}
              title={t("i18n.close")}
              aria-label={t("i18n.close")}
            >
              <i data-ico="x" data-size="14" aria-hidden="true"></i>
            </button>
          </div>
          <div className="d-mono d-t-faint" style={{ marginTop: "var(--nx-sp-1)" }}>
            {selectedCommit.author} · {timeFormat.format(new Date(selectedCommit.timestamp * 1000))} · {selectedCommit.hash.slice(0, 10)}
          </div>
          <div className="d-subhead" style={{ marginTop: "var(--nx-sp-1)" }}>
            {t("git.commitFiles")}
          </div>
          <div style={{ marginTop: "var(--space-tight)" }}>
            {commitLoading ? (
              <div className="d-t-dim d-t-sm" style={{ padding: "2px 5px" }}>
                <i data-ico="refresh-cw" data-size="13" className="animate-spin" aria-hidden="true"></i>
              </div>
            ) : commitFiles && commitFiles.length > 0 ? (
              commitFiles.map((file) => (
                <CommitFileRow key={`${file.code}:${file.filePath}`} file={file} cwd={cwd} onOpenFile={onOpenFile} />
              ))
            ) : (
              <div className="d-t-dim d-t-sm" style={{ padding: "2px 5px" }}>-</div>
            )}
          </div>
        </div>
      )}

      {/* fork:v5-landing D-05 帧 D —— 面板体最后一句 `.d-pop-foot`：这个面板只做
          「看」（图谱 / 改动 / 远端），会改写历史的操作不给按钮。此前面板没有这句，
          板面上它是 MISSING —— 少了它，「为什么这里没有 rebase 按钮」只能靠猜。 */}
      <div role="note" className="d-pop-foot">{t("git.panelFootnote")}</div>
    </div>
  );
}
