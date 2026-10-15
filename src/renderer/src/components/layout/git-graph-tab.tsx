import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitBranchIcon, GitCommitIcon, GitMergeIcon, RefreshIcon, Tag01Icon } from "@hugeicons/core-free-icons";
import { IconButton } from "@/components/icon-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { buildGitGraphLayout, type GitGraphLayout } from "@/lib/git-graph-lanes";
import { gitGraphEdgePath } from "@/lib/git-graph-geometry";
import { deriveLanePalette } from "@/lib/git-graph-palette";
import { parseGitRefTags, type GitRefTag } from "@/lib/git-graph-refs";
import { useSettingsStore } from "@/stores/settings";
import type { GitCommitFile, GitLogCommit, GitLogResponse } from "@shared/types";

/**
 * fork:git-graph —— 右栏 Git 图谱（P10）。
 *
 * 只画两件事：一条有上限的 `git log`（服务端 `engine/git-graph.ts`），以及某个提交
 * 改了哪些文件。车道（列与父子连线）由 `lib/git-graph-lanes.ts` 的纯函数从父链接推导，
 * 几何由 `lib/git-graph-geometry.ts` 算 —— 两者都自带单测，这里只负责画。
 */

const ROW_H = 26;
const COL_W = 16;
const NODE_R = 3.5;
const GRAPH_PAD_LEFT = 6;
const CORNER_R = 6;

const laneX = (lane: number) => GRAPH_PAD_LEFT + lane * COL_W + COL_W / 2;

function timeLabel(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function refIcon(kind: GitRefTag["kind"]): typeof Tag01Icon {
  return kind === "tag" ? Tag01Icon : GitBranchIcon;
}

export function GitGraphTab({
  cwd,
  onOpenFile,
}: {
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
}): JSX.Element {
  const { t } = useTranslation("sidepane");
  const themeMode = useSettingsStore((state) => state.settings.themeMode);
  const lightTheme = useSettingsStore((state) => state.settings.lightTheme);
  const darkTheme = useSettingsStore((state) => state.settings.darkTheme);
  const [data, setData] = useState<GitLogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [commitFiles, setCommitFiles] = useState<GitCommitFile[] | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const fetchRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setCommitFiles(null);
    setSelectedHash(null);
    try {
      const response = await window.pinext.workspace.gitLog(cwd, 300);
      setData(response);
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void load();
  }, [load]);

  const layout: GitGraphLayout | null = useMemo(
    () => (data && data.commits.length > 0 ? buildGitGraphLayout(data.commits, "compact") : null),
    [data],
  );

  // Theme changes re-render through the settings store; read the accent then so
  // the lane palette follows the current theme instead of freezing at first paint.
  const accent = useMemo(() => {
    if (typeof window === "undefined") return "";
    return getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  }, [themeMode, lightTheme, darkTheme]);
  const isDark = typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const palette = useMemo(() => deriveLanePalette(accent, isDark), [accent, isDark]);
  const laneVar = (index: number) => `var(--git-graph-lane-${index % palette.length})`;

  const laneVars = useMemo(() => {
    const vars: Record<string, string> = {};
    palette.forEach((color, index) => {
      vars[`--git-graph-lane-${index}`] = color;
    });
    return vars as CSSProperties;
  }, [palette]);

  async function selectCommit(commit: GitLogCommit): Promise<void> {
    if (selectedHash === commit.hash) {
      setSelectedHash(null);
      setCommitFiles(null);
      return;
    }
    setSelectedHash(commit.hash);
    setCommitFiles(null);
    setFilesLoading(true);
    fetchRef.current = commit.hash;
    try {
      const result = await window.pinext.workspace.gitCommitFiles(cwd, commit.hash);
      if (fetchRef.current !== commit.hash) return;
      setCommitFiles(result.files);
    } catch {
      if (fetchRef.current === commit.hash) setCommitFiles([]);
    } finally {
      if (fetchRef.current === commit.hash) setFilesLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        <HugeiconsIcon strokeWidth={2} icon={RefreshIcon} className="mr-2 size-3.5 animate-spin" />
        {t("gitGraph.loading")}
      </div>
    );
  }

  if (error) {
    return <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground">{error}</div>;
  }

  if (!data || !data.isGitRepository) {
    return <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground">{t("gitGraph.notRepo")}</div>;
  }

  const commits = data.commits;
  const rowTops = commits.map((_, row) => row * ROW_H);
  const graphWidth = GRAPH_PAD_LEFT * 2 + Math.max(1, layout?.laneCount ?? 1) * COL_W;
  const graphHeight = commits.length * ROW_H;

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={laneVars}>
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <HugeiconsIcon strokeWidth={2} icon={GitBranchIcon} className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={cwd}>
          {t("gitGraph.title")}
          {data.truncated ? <span className="text-muted-foreground"> · {t("gitGraph.truncated")}</span> : null}
        </span>
        <IconButton size="icon-xs" variant="ghost" label={t("files.refresh")} onClick={() => void load()}>
          <HugeiconsIcon strokeWidth={2} icon={RefreshIcon} />
        </IconButton>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="relative pr-2" style={{ minWidth: graphWidth }}>
          <svg
            aria-hidden
            className="pointer-events-none absolute left-0 top-0"
            width={graphWidth}
            height={graphHeight}
          >
            {layout?.edges.map((edge, index) => (
              <path
                key={`e${index}`}
                d={gitGraphEdgePath(edge, {
                  laneX,
                  rowTops,
                  rowHeight: () => ROW_H,
                  cornerRadius: CORNER_R,
                })}
                fill="none"
                stroke={laneVar(edge.colorIndex)}
                strokeWidth={1.5}
              />
            ))}
            {layout?.nodes.map((node) => (
              <circle
                key={node.hash}
                cx={laneX(node.lane)}
                cy={rowTops[node.row]! + ROW_H / 2}
                r={node.row === 0 ? NODE_R + 1.5 : NODE_R}
                fill={laneVar(node.colorIndex)}
              />
            ))}
          </svg>
          <div className="flex flex-col" style={{ paddingLeft: graphWidth }}>
            {commits.map((commit, row) => {
              const node = layout?.nodes[row];
              const tags = parseGitRefTags(commit.refs);
              const selected = selectedHash === commit.hash;
              return (
                <div key={commit.hash}>
                  <button
                    type="button"
                    onClick={() => void selectCommit(commit)}
                    aria-current={selected ? "true" : undefined}
                    className={cn(
                      "flex h-[26px] w-full items-center gap-1.5 overflow-hidden text-left",
                      selected ? "bg-muted" : "hover:bg-muted/60",
                    )}
                    title={commit.hash}
                  >
                    <HugeiconsIcon
                      strokeWidth={2}
                      icon={commit.parents.length > 1 ? GitMergeIcon : GitCommitIcon}
                      className="size-3 shrink-0 text-muted-foreground"
                    />
                    {tags.slice(0, 2).map((tag) => (
                      <span
                        key={tag.ref}
                        className={cn(
                          "inline-flex max-w-[120px] shrink-0 items-center gap-1 rounded px-1 py-0.5 text-[10px]",
                          tag.kind === "head" ? "text-primary-foreground" : "bg-muted text-foreground",
                        )}
                        style={tag.kind === "head" ? { background: node ? laneVar(node.colorIndex) : "var(--primary)" } : undefined}
                        title={tag.ref}
                      >
                        <HugeiconsIcon strokeWidth={2} icon={refIcon(tag.kind)} className="size-2.5 shrink-0" />
                        <span className="truncate">{tag.label}</span>
                      </span>
                    ))}
                    <span className="min-w-0 flex-1 truncate text-xs">{commit.subject || commit.hash.slice(0, 8)}</span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{timeLabel(commit.timestamp)}</span>
                  </button>
                  {selected ? (
                    <div className="ml-4 border-l border-border pl-2 pb-1">
                      <div className="py-1 font-mono text-[10px] text-muted-foreground">
                        {commit.hash.slice(0, 10)} · {commit.author}
                      </div>
                      {filesLoading ? (
                        <div className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
                          <Spinner className="size-3" /> {t("gitGraph.files")}
                        </div>
                      ) : (commitFiles?.length ?? 0) === 0 ? (
                        <div className="py-1 text-xs text-muted-foreground">{t("gitGraph.noFiles")}</div>
                      ) : (
                        commitFiles!.map((file) => {
                          const name = file.filePath.split("/").pop() ?? file.filePath;
                          const relative = file.filePath.startsWith(`${cwd}/`) ? file.filePath.slice(cwd.length + 1) : file.filePath;
                          return (
                            <button
                              key={`${file.code}:${file.filePath}`}
                              type="button"
                              onClick={() => onOpenFile(file.filePath, name)}
                              className="flex h-6 w-full items-center gap-1.5 overflow-hidden text-left hover:bg-muted/60"
                              title={file.filePath}
                            >
                              <span className="w-3 shrink-0 text-center font-mono text-[10px] font-semibold text-warning">{file.code}</span>
                              <span className="min-w-0 flex-1 truncate text-xs">{relative}</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
