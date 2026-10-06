"use client";

import { forwardRef, Fragment, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getFileIcon, FolderIcon } from "./FileIcons";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  encodeFilePathForApi,
  getFileDirectory,
  getFileName,
  getRelativeFilePath,
  joinFilePath,
  normalizeFilePathSlashes,
} from "@/lib/file-paths";
import type { GitFileStatus, GitFileStatusKind, GitStatusResponse } from "@/lib/git-types";
import type { FileIndexEntry } from "@/lib/file-fuzzy";
import { buildSearchTree, type SearchTreeNode } from "@/lib/search-tree";
// fork:gap08-roots — 多根（会话 cwd + 项目根并存 + 作用域徽标）
import {
  buildFileBrowserRoots,
  fileBrowserRootName,
  type FileBrowserRoot,
} from "@/lib/file-browser-roots";
import { DismissButton } from "./DismissButton";
import { isArchivePath } from "@/lib/archive-names";
import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/hooks/useI18n";
import { TEXT } from "@/lib/typography";
type Translate = ReturnType<typeof useI18n>["t"];

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
  /** fork:linked-directory — 指向 roots 之外的目录链接（#748）：列得出来，点进去要操作员先放行。 */
  outsideLinkTarget?: string;
  /** 目标还包着本项目或主目录，界面要额外警告并确认。 */
  outsideLinkEncloses?: boolean;
}

interface FileNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  children?: FileNode[];
  loaded?: boolean;
  /** fork:linked-directory — 服务端在列表里报的目标。 */
  outsideLinkTarget?: string;
  outsideLinkEncloses?: boolean;
}

/* ── fork:file-tree-slot-swap ────────────────────────────────────────────────
   右栏把**同一棵树**画在两个槽里（见 `AppShell` 的 `explorerPanel`）：还没开文件
   时它就是整块面板，第一个文件一打开它就变成 `.explorer-column` 里的那一列。React
   认的是父节点，所以这一搬就是一次**卸载 + 重挂**——后果全在这一搬上：
     · roots / 展开目录 / git 状态 / 改动列表状态全丢，要重新列两次（`type=list`
       与 `/api/git/status` 各两遍）、重新订阅 `file-watch`；
     · 新实例第一帧 `roots` 是空的，于是树先闪「0 个条目」，再闪「未找到文件」。
   快照把「上一次列到的样子」按 cwd 留在模块里，重挂时先读回来当初值，后台照旧重取：
   数据仍然以服务端为准（可见性不是授权，见 lib/file-tree-visibility.ts），但用户
   看不到一次清空。**只认新鲜快照**：超过 TTL 宁可显示加载态，也不要展示一份可能
   已经过期的目录。 */

/** 一棵树上一次列到的样子（按 cwd 存一份，重挂时用来当初值）。 */
export interface FileTreeSnapshot {
  roots: FileNode[];
  gitFiles: GitFileStatus[];
  additions: number;
  deletions: number;
  savedAt: number;
}

/** 只影响「重挂后有多久看不到内容」，不影响任何授权或数据正确性。 */
const TREE_SNAPSHOT_TTL_MS = 15_000;
const TREE_SNAPSHOT_MAX_ENTRIES = 8;

const treeSnapshots = new Map<string, FileTreeSnapshot>();

/** 挂载（或换 cwd）时读一次；太旧 / 没有就是 null。`now` 显式传入是为了可测。 */
export function readFileTreeSnapshot(cwd: string, now: number = Date.now()): FileTreeSnapshot | null {
  const snapshot = treeSnapshots.get(cwd);
  if (!snapshot) return null;
  if (now - snapshot.savedAt > TREE_SNAPSHOT_TTL_MS) {
    treeSnapshots.delete(cwd);
    return null;
  }
  return snapshot;
}

/** 写入一份快照；`savedAt` 由这里盖上，调用方不必关心时钟。 */
export function writeFileTreeSnapshot(
  cwd: string,
  snapshot: Omit<FileTreeSnapshot, "savedAt">,
  now: number = Date.now(),
): void {
  // 满了先扫一遍过期的，还满就整体换掉（这份缓存只服务**同时开着的那一块**面板）。
  if (treeSnapshots.size >= TREE_SNAPSHOT_MAX_ENTRIES) {
    for (const [key, entry] of treeSnapshots) {
      if (now - entry.savedAt > TREE_SNAPSHOT_TTL_MS) treeSnapshots.delete(key);
      if (treeSnapshots.size < TREE_SNAPSHOT_MAX_ENTRIES / 2) break;
    }
    if (treeSnapshots.size >= TREE_SNAPSHOT_MAX_ENTRIES) treeSnapshots.clear();
  }
  treeSnapshots.set(cwd, { ...snapshot, savedAt: now });
}

/** 宿主（ExplorerPanel）那几个开关的快照：改动列表 / 筛选条开着还是关着。 */
export interface ExplorerPanelViewState {
  changesCollapsed?: boolean;
  fileSearchOpen?: boolean;
}

const panelViewStates = new Map<string, ExplorerPanelViewState>();

export function readExplorerPanelViewState(cwd: string): ExplorerPanelViewState | null {
  return panelViewStates.get(cwd) ?? null;
}

export function writeExplorerPanelViewState(cwd: string, state: ExplorerPanelViewState): void {
  if (panelViewStates.size >= TREE_SNAPSHOT_MAX_ENTRIES) panelViewStates.clear();
  panelViewStates.set(cwd, { ...panelViewStates.get(cwd), ...state });
}

interface Props {
  cwd: string;
  /** fork:gap08-roots — 会话所属项目的根；与 cwd 不同时（worktree 会话）多出一个「项目」根。 */
  projectRoot?: string | null;
  onOpenFile: (filePath: string, fileName: string, options?: OpenFileOptions) => void;
  refreshKey?: number;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  onUploadBusyChange?: (busy: boolean) => void;
  /** Called after a successful file mutation (create/rename/delete) so panels showing Git state can refresh. */
  onFileMutated?: () => void;
  changesCollapsed: boolean;
  /* fork:search-off-by-default —— 「只看改动 / 审查改动」此前在筛选条里还有第二枚
     钮（与头行 `file-diff` 同一个动作），删掉之后本组件不再自己切折叠态，
     `onChangesToggle` 随之退场：折叠态的归属一直在宿主（它还管着头行那枚钮与移动档）。 */
  onChangesCountChange?: (count: number) => void;
  fileSearchOpen?: boolean;
  onFileSearchOpenChange?: (open: boolean) => void;
  /**
   * M-06 · 手机档：`.m-top` 顶栏右侧那一小段动作（搜索 / 终端 / 更多 …）。
   * 手机上「层级由顶栏路径承担」，所以顶栏归这棵树自己画，而宿主（`ExplorerPanel`）
   * 把自己原有的那一排动作原样递进来 —— 动作还是同一批、处理器还是同一批，
   * 只是从 `.d-panel-head` 挪到了 `.m-top` 里。
   */
  mobileTopBar?: React.ReactNode;
  /* fork:v5-m12-pane —— 这棵树被挂在 M-12 那个 pane 里时（`.m-panel-scroll`），
     上头已经有一条六项横滚的切换条（`.m-viewer-bar`）了。此时再画一条
     `.m-top`（绝对定位 + 渐隐底 + 50px 状态栏让位）就是**第二条顶栏**，
     在 390×844 上两条吃掉约 200px，而画板 M-12 帧 B 的 pane 里只有一层内容。
     所以：这一支不画 `.m-fade`，顶栏改成一条普通的行（`fork-pane-bar`），
     尺寸全部取库里已有的角色值。桌面与「文件面板自己当整屏」的那一支不动。 */
  inPanel?: boolean;
}

export interface FileExplorerHandle {
  openUploadPicker: () => void;
}

type UploadPhase = "idle" | "checking" | "uploading";
type UploadConflictStrategy = "error" | "overwrite" | "skip";

interface UploadError {
  name: string;
  error: string;
}

interface UploadResponse {
  uploaded?: string[];
  skipped?: string[];
  errors?: UploadError[];
  conflicts?: string[];
  nonReplaceable?: string[];
  error?: string;
}

interface UploadSummary {
  uploaded: string[];
  skipped: string[];
  errors: UploadError[];
}

interface PendingConflict {
  files: File[];
  conflicts: string[];
  nonReplaceable: string[];
}

interface ContextMenuTarget {
  x: number;
  y: number;
  fullPath: string;
  name: string;
  isDir: boolean;
}

/** 树右键菜单每一项的图标名 —— 全部取自画板 30 的两份菜单（见 contextMenuItems）。 */
type ContextMenuIconName =
  | "download"
  | "external-link"
  | "file-archive"
  | "file-plus"
  | "folder-plus"
  | "scissors"
  | "square-pen"
  | "trash-2";

interface RenameState {
  fullPath: string;
  isDir: boolean;
  name: string;
  value: string;
}

interface CreateState {
  parentDir: string;
  type: "file" | "dir";
  value: string;
}

/** POST a mutation action against the files API and normalize the error surface. */
async function mutateFileEntry(
  targetPath: string,
  type: "write" | "touch" | "mkdir" | "rename" | "delete" | "extract" | "compress",
  body: Record<string, unknown> = {},
): Promise<{ ok: boolean; error?: string; data?: { extractedTo?: string; archive?: string } }> {
  const res = await fetch(`/api/files/${encodeFilePathForApi(targetPath)}?type=${type}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}) as { error?: string; extractedTo?: string; archive?: string });
  if (res.ok) return { ok: true, data };
  return { ok: false, error: data.error ?? `Request failed (HTTP ${res.status})` };
}

async function responseError(res: Response, fallback: string): Promise<Error> {
  let message = `${fallback} (HTTP ${res.status})`;
  try {
    const data = await res.json() as { error?: string };
    if (data.error) message = data.error;
  } catch {
    // ignore non-JSON error bodies
  }
  return new Error(message);
}

async function fetchEntries(dirPath: string): Promise<FileNode[]> {
  const encoded = encodeFilePathForApi(dirPath);
  const res = await fetch(`/api/files/${encoded}?type=list`);
  if (!res.ok) throw await responseError(res, "Failed to load files");
  const data = await res.json() as { entries?: FileEntry[] };
  // A response without an entries array is a failure, not an empty directory:
  // silently rendering "no files" made a broken listing look like an empty folder.
  if (!Array.isArray(data.entries)) {
    throw new Error("Directory listing was unavailable");
  }
  return (data.entries ?? []).map((e) => ({
    name: e.name,
    fullPath: joinFilePath(dirPath, e.name),
    isDir: e.isDir,
    size: e.size,
    children: e.isDir ? [] : undefined,
    loaded: !e.isDir,
    // fork:linked-directory — 把服务端报的目标带下去，展开时才问要不要放行。
    outsideLinkTarget: e.outsideLinkTarget,
    outsideLinkEncloses: e.outsideLinkEncloses,
  }));
}

// fork:linked-directory — 带上操作员**当时看到**的目标，服务端据此比对 realpath：
// 链接被改指到别处就 409，而不是授权一个没人看过的目录。
async function allowOutsideLink(linkPath: string, target: string): Promise<void> {
  const res = await fetch(`/api/files/${encodeFilePathForApi(linkPath)}?type=allow-link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  if (!res.ok) throw await responseError(res, "Failed to allow the linked folder");
}

async function fetchGitStatus(cwd: string): Promise<GitStatusResponse> {
  const params = new URLSearchParams({ cwd });
  const res = await fetch(`/api/git/status?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to load Git status (HTTP ${res.status})`);
  return res.json() as Promise<GitStatusResponse>;
}

const GIT_STATUS_KEYS: Record<GitFileStatusKind, string> = {
  modified: "files.modified",
  added: "files.added",
  deleted: "files.deleted",
  renamed: "files.renamed",
  untracked: "files.untracked",
  conflict: "files.conflict",
};

const GIT_STATUS_COLORS: Record<GitFileStatusKind, string> = {
  modified: "var(--nx-warning)",
  added: "var(--nx-success)",
  deleted: "var(--nx-danger)",
  renamed: "var(--nx-accent)",
  untracked: "var(--nx-success)",
  conflict: "var(--nx-danger)",
};

function GitStatusBadge({ status, t }: { status: GitFileStatus; t: Translate }) {
  return (
    <span
      title={t(GIT_STATUS_KEYS[status.status])}
      aria-label={t(GIT_STATUS_KEYS[status.status])}
      style={{
        width: "var(--icon-sm)",
        height: "var(--icon-sm)",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: GIT_STATUS_COLORS[status.status],
        fontFamily: "var(--font-mono)",
        fontSize: TEXT.xs,
        fontWeight: 600,
      }}
    >
      {status.code}
    </span>
  );
}

function uploadFiles(
  targetDirectory: string,
  files: File[],
  strategy: UploadConflictStrategy,
  onProgress: (progress: number) => void,
): Promise<{ status: number; data: UploadResponse }> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file, file.name));

    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `/api/files/${encodeFilePathForApi(targetDirectory)}?type=upload&conflict=${strategy}`,
    );
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onerror = () => reject(new Error("Network error while uploading files"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.onload = () => {
      let data: UploadResponse = {};
      try {
        data = JSON.parse(xhr.responseText) as UploadResponse;
      } catch {
        if (xhr.responseText) data.error = xhr.responseText;
      }
      resolve({ status: xhr.status, data });
    };
    xhr.send(formData);
  });
}

/** 「插入为引用」的 @ 字形 = 画板右键菜单里的 `at-sign`。 */
function MentionIcon({ size = 11 }: { size?: number }) {
  return <i data-ico="at-sign" data-size={size} aria-hidden="true"></i>;
}

/**
 * M-06 帧 A —— 行尾那一小段读数。桌面树行右边是 git 徽标，手机上没有那一列，
 * 空出来的位置写文件大小（目录写它含未提交改动时的提示点）。
 * 单位与 `FileViewer` 的 `formatSize` 同一套（KB / MB 一位小数）。
 */
function mobileSizeLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


function CreateEntryInput({
  depth,
  type,
  value,
  inputRef,
  onValueChange,
  onSubmit,
  onCancel,
  t,
}: {
  depth: number;
  type: "file" | "dir";
  value: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  t: Translate;
}) {
  return (
    <div
      /* fork:pwa-sb —— 手机档这一行比别处高：.d-trow 的 --tree-row 收到
         --control-touch，这一格跟着抬（内联 height 24 要用 !important 压，
         同 globals.css 皮肤层的做法）。否则输入框上下各剩 2px，手指点不中。 */
      className="fork-pwa-sb-edit-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--s1)",
        paddingLeft: 8 + depth * 14,
        paddingRight: "var(--s2)",
        height: "var(--control-xs)",
        borderRadius: "var(--radius-sm)",
        userSelect: "none",
      }}
    >
      {type === "dir" ? <FolderIcon size={14} open={false} /> : <span style={{ width: 10, flexShrink: 0 }} />}
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        onBlur={onCancel}
        placeholder={type === "dir" ? t("files.newFolderName") : t("files.newFileName")}
        aria-label={type === "dir" ? t("files.newFolderName") : t("files.newFileName")}
        className="fork-pwa-sb-edit"
        style={{
          flex: 1,
          minWidth: 0,
          height: 20,
          padding: "0 4px",
          border: "1px solid var(--accent)",
          borderRadius: "var(--radius-xs)",
          outline: "none",
          background: "var(--bg)",
          color: "var(--text)",
          fontFamily: "var(--font-mono)",
          fontSize: TEXT.sm,
        }}
      />
    </div>
  );
}

export function TreeNode({
  node,
  depth,
  cwd,
  onOpenFile,
  onAtMention,
  expandedPaths,
  onToggleExpanded,
  refreshToken,
  highlightedPaths,
  gitStatusByPath,
  changedDirectoryPaths,
  scrollToPath,
  onNodeContextMenu,
  renaming,
  onRenameValueChange,
  onRenameSubmit,
  onRenameCancel,
  creating,
  onCreateValueChange,
  onCreateSubmit,
  onCreateCancel,
  /** fork:pwa-sb —— 手机上没有 hover：行内两枚动作常驻（从 `FileExplorer` 传下来，
   *  避免每行各自挂一个 matchMedia 监听）。桌面恒 false，行为一字未变。 */
  isMobile,
  t,
}: {
  node: FileNode;
  depth: number;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string, options?: OpenFileOptions) => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (fullPath: string, open: boolean) => void;
  refreshToken?: string;
  highlightedPaths: Set<string>;
  gitStatusByPath: Map<string, GitFileStatus>;
  changedDirectoryPaths: Set<string>;
  /** fork:gap10-search-scroll — 非空时，与它相等的行会滚到视口中间。 */
  scrollToPath?: string | null;
  onNodeContextMenu?: (node: FileNode, x: number, y: number) => void;
  renaming: RenameState | null;
  onRenameValueChange: (value: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  creating: CreateState | null;
  onCreateValueChange: (value: string) => void;
  onCreateSubmit: () => void;
  onCreateCancel: () => void;
  isMobile: boolean;
  t: Translate;
}) {
  const open = expandedPaths.has(node.fullPath);
  const highlighted = highlightedPaths.has(node.fullPath);
  const normalizedPath = normalizeFilePathSlashes(node.fullPath);
  const gitStatus = gitStatusByPath.get(normalizedPath);
  const containsGitChanges = node.isDir && (
    gitStatus !== undefined || changedDirectoryPaths.has(normalizedPath)
  );
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded, setLoaded] = useState(node.loaded ?? false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  // fork:pwa-sb —— 行尾两枚动作在桌面靠 `hovered` 出现；手机上 hover 不存在，等
  // 合成 mouseenter 亮起来时这一行已经被点开了。取舍：
  //   · 「下载」是 23px 的小图标芯片 —— 手机上常驻，代价只是行尾让出 40px；
  //   · 「@ 提及」是 55px 宽的**文字**芯片，每行都常驻就是满屏蓝字（手机上文件树
  //     一屏十几行），所以它留在 hover，但**进了这一行的长按菜单**
  //     （contextMenuItems 的 `files.insertPath`，菜单项在这一档 44px 高）。
  const showRowActions = hovered;
  const showDownload = hovered || isMobile;
  // fork:linked-directory — 放行只对本次操作员点过的那一条生效，重启即失效。
  const [allowedLinkTarget, setAllowedLinkTarget] = useState<string | null>(null);
  const [allowingLink, setAllowingLink] = useState(false);
  const [allowLinkError, setAllowLinkError] = useState<string | null>(null);
  // fork:linked-directory — 通向项目之外的链接默认不列（列了也只是 403），改为
  // 在行下问一次「要不要放行这个目标」。
  const pendingLinkTarget = node.outsideLinkTarget && node.outsideLinkTarget !== allowedLinkTarget
    ? node.outsideLinkTarget
    : null;
  const rowRef = useRef<HTMLDivElement>(null);
  const emptyRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRenaming = renaming?.fullPath === node.fullPath;
  const renameInputRef = useRef<HTMLInputElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [isRenaming]);

  const isCreatingHere = creating !== null && creating.parentDir === node.fullPath;
  useEffect(() => {
    if (isCreatingHere) createInputRef.current?.focus();
  }, [isCreatingHere]);

  // fork:linked-directory — 列表又报出同一个目标（服务端重启忘了刚才的放行，或链接
  // 被改指）时，需要操作员重新做一次决定。
  useEffect(() => {
    setAllowedLinkTarget(null);
    setAllowLinkError(null);
  }, [node.outsideLinkTarget]);

  const loadChildren = useCallback(async (force = false, isRetry = false) => {
    if (loaded && !force) return;
    setLoading(true);
    setLoadError(null);
    try {
      const entries = await fetchEntries(node.fullPath);
      setChildren(entries);
      setLoaded(true);
      // fork:gap10-tree-retry — 空目录 800ms 后重试一次。agent 刚 mkdir / 刚写文件时，
      // 列表很容易在它落盘前返回空，而用户看到的就是一个永远空着的目录。
      if (entries.length === 0 && !isRetry) {
        if (emptyRetryRef.current) clearTimeout(emptyRetryRef.current);
        emptyRetryRef.current = setTimeout(() => { void loadChildren(true, true); }, 800);
      }
    } catch (error) {
      // fork:linked-directory — 以前这里是空 catch，目录展开失败就变成一个永远
      // 空着的文件夹（#748）。现在把原因显示在那一行下面。
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, [loaded, node.fullPath]);

  // 卸载时收掉重试定时器，避免对已卸载的组件 setState
  useEffect(() => () => {
    if (emptyRetryRef.current) clearTimeout(emptyRetryRef.current);
  }, []);

  // fork:gap10-search-scroll — 搜索命中后把它带到视口中间
  useEffect(() => {
    if (!scrollToPath || scrollToPath !== node.fullPath) return;
    rowRef.current?.scrollIntoView({ block: "center" });
  }, [scrollToPath, node.fullPath]);

  // Re-fetch children when the tree refreshes and the directory is open.
  useEffect(() => {
    if (refreshToken !== undefined && open && loaded && !pendingLinkTarget) {
      loadChildren(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const handleClick = useCallback(() => {
    if (node.isDir) {
      const next = !open;
      onToggleExpanded(node.fullPath, next);
      // fork:linked-directory — 待放行的链接不去列（列了也只是 403）。
      if (next && !loaded && !pendingLinkTarget) loadChildren();
    } else {
      onOpenFile(node.fullPath, node.name);
    }
  }, [node.isDir, node.fullPath, node.name, loaded, open, pendingLinkTarget, loadChildren, onOpenFile, onToggleExpanded]);

  const handleAllowLink = useCallback(async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!pendingLinkTarget) return;
    // fork:linked-directory — 通向 `/`、`~` 或项目父目录的链接一口气开出去的东西太多，
    // 而克隆下来的仓库就可能带着这样一条，所以先警告 + 确认。
    if (
      node.outsideLinkEncloses
      && !window.confirm(t("files.allowEnclosingLinkConfirm", { target: pendingLinkTarget }))
    ) {
      return;
    }
    setAllowingLink(true);
    setAllowLinkError(null);
    try {
      await allowOutsideLink(node.fullPath, pendingLinkTarget);
      setAllowedLinkTarget(pendingLinkTarget);
      await loadChildren(true);
    } catch (error) {
      setAllowLinkError(error instanceof Error ? error.message : String(error));
    } finally {
      setAllowingLink(false);
    }
  }, [node.fullPath, node.outsideLinkEncloses, pendingLinkTarget, loadChildren, t]);

  return (
    /* fork:v5-landing D-05 帧 A —— 树是**平**的：板面 `.d-tree` 的直接子节点就是
       那一排 `.d-trow`（目录行与它的子行同级，靠 `.l1/.l2` 缩进表达层级）。
       产品此前给每个节点套了一层没有样式的 `<div>` 把「行 + 子树」包起来，于是
       `.d-tree > div > .d-trow` 比板面多一级 —— 行骨架怎么改都对不上。
       这里换成 fragment：`.d-tree` 的子节点回到「行 / 子行」同一层，
       行本身的 ref / 事件一个没动。 */
    <>
      <div
        ref={rowRef}
        role="treeitem"
        /* fork:v5-skin D-05 帧 A —— 文件行 = 画板 .d-trow（26px / hover 叠色 / l1-l3 缩进），
           `fork-pwa-sb-tree-row` 是本文件私有的手机档钩子（≤640px 抬行高 + 补命中区）。 */
        className={`d-trow fork-pwa-sb-tree-row${depth >= 1 ? ` l${Math.min(depth, 3)}` : ""}${showDownload && !node.isDir ? " fork-pwa-sb-tree-row-acts" : ""}`}
        aria-expanded={node.isDir ? open : undefined}
        aria-selected={false}
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          handleClick();
        }}
        onContextMenu={(event) => {
          if (!onNodeContextMenu) return;
          // Inside the rename/create inputs the native menu (copy/paste) wins.
          if ((event.target as HTMLElement).closest("input, textarea")) return;
          event.preventDefault();
          event.stopPropagation();
          onNodeContextMenu(node, event.clientX, event.clientY);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        style={{
          // fork:gap10-sticky-dir — 展开的目录行在它自己的子项滚动时粘住。
          // `top` 按深度错开（封顶 3 层），否则子目录会盖到父目录上；背景不透明，
          // 否则会看穿到下面的行。
          // fork:pwa-sb —— 行内两枚（插入路径 / 下载）是组件内联的绝对定位
          // （`position` 已有，这里只补选择器命中），`download` 一枚只有 23×20。
          // 粘顶偏移原来写死 `depth * 24`（= 树行高）：手机档行高抬到
          // --control-touch 后会逐层少错开一半，改成跟着 token 走。
          ...(node.isDir && open
            ? {
                position: "sticky" as const,
                top: `calc(var(--tree-row) * ${Math.min(depth, 3)})`,
                zIndex: 5,
                background: "var(--bg-panel)",
              }
            : { position: "relative" as const }),
          // 缩进交给画板 .l1 / .l2 / .l3，这里只留粘顶与可点性。
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        {node.isDir && (
          <i
            data-ico="chevron-right"
            data-size="12"
            aria-hidden="true"
            style={{ flexShrink: 0, color: "var(--nx-text-3)", transform: open ? "rotate(90deg)" : "none", transition: "transform var(--nx-dur-1)" }}
          ></i>
        )}
        {!node.isDir && <span style={{ width: 10, flexShrink: 0 }} />}
        {/* fork:v5-landing D-05 帧 A —— 图标直接挂在行上（板面原文是
            `<i data-ico="…">` 直接做 `.d-trow` 的子节点）；此前多一层
            `<span style="flexShrink:0;display:flex">` 壳，行骨架与板面差一级。 */}
        {node.isDir ? <FolderIcon size={14} open={open} /> : getFileIcon(node.name, 14)}
        {isRenaming ? (
          <input
            ref={renameInputRef}
            value={renaming.value}
            onChange={(event) => onRenameValueChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onRenameSubmit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onRenameCancel();
              }
            }}
            onBlur={onRenameCancel}
            aria-label={t("files.renameEntry")}
            className="fork-pwa-sb-edit"
            style={{
              flex: 1,
              minWidth: 0,
              height: 20,
              padding: "0 4px",
              border: "1px solid var(--accent)",
              borderRadius: "var(--radius-xs)",
              outline: "none",
              background: "var(--bg)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: TEXT.sm,
            }}
          />
        ) : (
      <span
        className="d-grow"
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={node.fullPath}
      >
        {node.name}
      </span>
        )}
        {highlighted && (
          <span
            title={t("files.newlyUploaded")}
            aria-label={t("files.newlyUploaded")}
            style={{ width: "var(--icon-sm)", height: "var(--icon-sm)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <span style={{ width: "var(--dot-sm)", height: "var(--dot-sm)", borderRadius: "50%", background: "var(--accent)" }} />
          </span>
        )}
        {/* fork:linked-directory — 行上的「通向项目外」标记（不占 hover 位置）。 */}
        {!showRowActions && pendingLinkTarget && (
          <i
            data-ico="external-link"
            data-size="11"
            aria-hidden="true"
            title={t("files.outsideLink", { target: pendingLinkTarget })}
            aria-label={t("files.outsideLink", { target: pendingLinkTarget })}
            className="d-t-faint"
            style={{ flexShrink: 0 }}
          ></i>
        )}
        {!showRowActions && !node.isDir && gitStatus && (
          <GitStatusBadge status={gitStatus} t={t} />
        )}
        {!showRowActions && containsGitChanges && (
          <span
            title={t("files.containsChangedFiles")}
            aria-label={t("files.containsChangedFiles")}
            style={{
              width: "var(--icon-sm)",
              height: "var(--icon-sm)",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span className="d-dot warn" />
          </span>
        )}
        {loading && (
          <i data-ico="loader-circle" data-size="10" className="d-t-faint animate-spin" aria-hidden="true"></i>
        )}
        {onAtMention && showRowActions && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAtMention(getRelativeFilePath(node.fullPath, cwd), node.isDir);
            }}
            title={t("files.insertPath")}
            style={{
              position: "absolute",
              right: !node.isDir ? 28 : 4,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--s1)",
              padding: "0 8px",
              height: 20,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-xs)",
              color: "var(--accent)",
              cursor: "pointer",
              fontSize: TEXT.xs,
              fontWeight: 600,
              whiteSpace: "nowrap",
            }}
          >
            <MentionIcon />
            {t("files.mention")}
          </button>
        )}
        {showDownload && !node.isDir && (
          <a
            href={`/api/files/${encodeFilePathForApi(node.fullPath)}?type=download`}
            download
            onClick={(e) => e.stopPropagation()}
            title={t("files.download")}
            style={{
              position: "absolute",
              right: "var(--s1)",
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "var(--s1)",
              padding: "0 5px",
              height: 20,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-xs)",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: TEXT.xs,
              fontWeight: 600,
              whiteSpace: "nowrap",
              textDecoration: "none",
            }}
          >
            <i data-ico="download" data-size="11" aria-hidden="true"></i>
          </a>
        )}
      </div>
      {/* fork:v5-skin D-05 —— 待放行的链用画板的权限卡 .d-perm / .d-perm-body
          把「目标在哪 / 会打开多大范围 / 放行哪一条」讲清楚。 */}
      {node.isDir && open && pendingLinkTarget && (
        <div className="d-perm" style={{ margin: "0 var(--nx-sp-2) var(--nx-sp-2)" }}>
          <div className="d-perm-body">
            <div className="d-row">
              <i data-ico="external-link" data-size="12" aria-hidden="true"></i>
              <span className="d-t-b d-grow">{t("files.outsideLink", { target: pendingLinkTarget })}</span>
            </div>
            {node.outsideLinkEncloses && (
              <div role="note" className="d-banner err">
                <i data-ico="triangle-alert" data-size="12" aria-hidden="true"></i>
                <span className="d-grow">{t("files.outsideLinkEncloses")}</span>
              </div>
            )}
            <div className="d-mono d-t-xs" style={{ wordBreak: "break-all" }}>{pendingLinkTarget}</div>
            <div className="d-row">
              <button
                type="button"
                className="d-btn sm primary"
                onClick={handleAllowLink}
                disabled={allowingLink}
                title={t("files.allowOutsideLinkTitle", { target: pendingLinkTarget })}
              >
                {t("files.allowOutsideLink")}
              </button>
              {allowLinkError && (
                <span role="alert" className="d-t-faint d-t-xs">{allowLinkError}</span>
              )}
            </div>
          </div>
        </div>
      )}
      {node.isDir && open && !pendingLinkTarget && loadError && (
        <div
          role="alert"
          className="d-banner err"
          style={{ margin: "0 var(--nx-sp-2) var(--nx-sp-2)", wordBreak: "break-word" }}
        >
          <i data-ico="circle-alert" data-size="13" aria-hidden="true"></i>
          <span className="d-grow">{loadError}</span>
        </div>
      )}
      {node.isDir && open && !pendingLinkTarget && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              cwd={cwd}
              onOpenFile={onOpenFile}
              onAtMention={onAtMention}
              expandedPaths={expandedPaths}
              onToggleExpanded={onToggleExpanded}
              refreshToken={refreshToken}
              highlightedPaths={highlightedPaths}
              gitStatusByPath={gitStatusByPath}
              changedDirectoryPaths={changedDirectoryPaths}
              onNodeContextMenu={onNodeContextMenu}
              renaming={renaming}
              onRenameValueChange={onRenameValueChange}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
              creating={creating}
              onCreateValueChange={onCreateValueChange}
              onCreateSubmit={onCreateSubmit}
              onCreateCancel={onCreateCancel}
              scrollToPath={scrollToPath}
              isMobile={isMobile}
              t={t}
            />
          ))}
          {creating && creating.parentDir === node.fullPath && (
            <CreateEntryInput
              depth={depth + 1}
              type={creating.type}
              value={creating.value}
              inputRef={createInputRef}
              onValueChange={onCreateValueChange}
              onSubmit={onCreateSubmit}
              onCancel={onCreateCancel}
              t={t}
            />
          )}
          {children.length === 0 && loaded && !(creating && creating.parentDir === node.fullPath) && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14, fontSize: TEXT.xs, color: "var(--text-dim)", height: 22, display: "flex", alignItems: "center" }}>
              {t("files.emptyDirectory")}
            </div>
          )}
        </div>
      )}
    </>
  );
}

type OpenFileOptions = { sourceSessionId?: string | null; modeHint?: "preview" | "diff" };

// 额外根的 TreeNode 不参与 git 徽标 / 上传高亮，用模块级空集合避免每次渲染新建引用。
const EMPTY_PATHS: Set<string> = new Set();
const EMPTY_GIT_STATUS: Map<string, GitFileStatus> = new Map();
/** PR #899 — 额外根那棵树不接右键/重命名/新建，用同一个空实现。 */
const NOOP = () => {};

/**
 * fork:file-tree-slot-swap — 按 cwd 取一次快照，只有 cwd 真的变了才重取。
 *
 * 同一 cwd 上的重挂（面板把树从整块搬进 `.explorer-column`）拿到的是同一份快照，
 * 于是新实例第一帧就有内容；换了会话则重新按新 cwd 读，读不到就是 null（走加载态）。
 */
function useTreeSnapshot(cwd: string): FileTreeSnapshot | null {
  const ref = useRef<{ cwd: string; snapshot: FileTreeSnapshot | null } | null>(null);
  if (ref.current === null || ref.current.cwd !== cwd) {
    ref.current = { cwd, snapshot: readFileTreeSnapshot(cwd) };
  }
  return ref.current.snapshot;
}

/**
 * fork:gap08-roots — 除会话 cwd 之外的根（目前只有「项目」）的独立分区。
 *
 * 为什么不把主根也改成循环：主根的渲染缠着上传回执、git 徽标、上传高亮、刷新脉冲与搜索，
 * 拆出来风险远大于收益；而额外根只需要「列目录 + 展开 + 打开文件」。
 * 于是额外根走这条轻量路径，单根会话的界面与行为完全不变。
 */
function RootSection({
  root,
  onOpenFile,
  refreshToken,
  isMobile,
  t,
}: {
  root: FileBrowserRoot;
  onOpenFile: OpenFileHandler;
  refreshToken: string;
  isMobile: boolean;
  t: Translate;
}) {
  const [entries, setEntries] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchEntries(root.path)
      .then((next) => { if (!cancelled) setEntries(next); })
      .catch(() => { if (!cancelled) setEntries([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [root.path, refreshToken]);

  return (
    <div style={{ padding: "var(--space-tight) 4px" }}>
      {/* fork:v5-skin D-05 —— 分区头 = 画板 .d-row（作用域 .d-badge + 根目录名 .d-viewer-path）。 */}
      <div className="d-row" style={{ padding: "0 var(--nx-sp-1) var(--nx-sp-1)" }}>
        <span className="d-badge mute">
          {t(root.scope === "project" ? "files.scopeProject" : "files.scopeSession")}
        </span>
        <span
          className="d-viewer-path d-grow"
          title={root.path}
          style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {fileBrowserRootName(root.path)}
        </span>
      </div>
      {loading ? (
        <div style={{ padding: "4px 12px", fontSize: TEXT.xs, color: "var(--text-dim)" }}>Loading files...</div>
      ) : (
        entries.map((node) => (
          <TreeNode
            key={node.fullPath}
            node={node}
            depth={0}
            cwd={root.path}
            onOpenFile={onOpenFile}
            expandedPaths={expandedPaths}
            onToggleExpanded={(fullPath, open) => {
              setExpandedPaths((prev) => {
                const next = new Set(prev);
                if (open) next.add(fullPath); else next.delete(fullPath);
                return next;
              });
            }}
            refreshToken={refreshToken}
            highlightedPaths={EMPTY_PATHS}
            gitStatusByPath={EMPTY_GIT_STATUS}
            changedDirectoryPaths={EMPTY_PATHS}
            /* PR #899 的新增动作（右键菜单 / 重命名 / 新建）只接在会话 cwd 那棵树上。
               额外的「项目」根与 git 徒标同一处理：传空实现，行为与改动前一致。 */
            onNodeContextMenu={undefined}
            renaming={null}
            onRenameValueChange={NOOP}
            onRenameSubmit={NOOP}
            onRenameCancel={NOOP}
            creating={null}
            onCreateValueChange={NOOP}
            onCreateSubmit={NOOP}
            onCreateCancel={NOOP}
            isMobile={isMobile}
            t={t}
          />
        ))
      )}
    </div>
  );
}

type OpenFileHandler = (filePath: string, fileName: string, options?: OpenFileOptions) => void;

function ChangeRow({
  status,
  cwd,
  onOpenFile,
  onAtMention,
  t,
}: {
  status: GitFileStatus;
  cwd: string;
  onOpenFile: OpenFileHandler;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  t: Translate;
}) {
  const [hovered, setHovered] = useState(false);
  const name = getFileName(status.filePath);
  const rel = getRelativeFilePath(status.filePath, cwd);
  // fork:pr09 — 逐文件 ± 统计；null/undefined 表示 diff 不可用（二进制、预算耗尽），整组省略。
  const hasDiffStat = status.additions != null || status.deletions != null;
  // Split the path so the directory part ellipsizes while the file name stays fully visible
  const lastSlash = rel.lastIndexOf("/");
  const dirPart = lastSlash >= 0 ? rel.slice(0, lastSlash + 1) : "";
  const baseName = lastSlash >= 0 ? rel.slice(lastSlash + 1) : rel;
  return (
    <div
      onClick={() => onOpenFile(status.filePath, name, { modeHint: "diff" })}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={status.filePath}
      className="d-trow"
      style={{ cursor: "pointer", userSelect: "none", position: "relative" }}
    >
      <GitStatusBadge status={status} t={t} />
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center", opacity: 0.85 }}>
        {getFileIcon(name, 13)}
      </span>
      <span
        title={status.filePath}
        className="d-grow"
        style={{
          display: "flex",
          alignItems: "center",
          minWidth: 0,
        }}
      >
        {dirPart && (
          <span
            className="d-t-faint"
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: "0 1 auto",
              minWidth: 0,
            }}
          >
            {dirPart}
          </span>
        )}
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flexShrink: 0,
            maxWidth: "100%",
          }}
        >
          {baseName}
        </span>
      </span>
      {hasDiffStat && (
        <span
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: "var(--space-ctrl)",
            marginLeft: "var(--s1)",
            fontFamily: "var(--font-mono)",
            fontSize: TEXT["2xs"],
            lineHeight: 1,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {status.additions != null && status.additions > 0 && (
            <span style={{ color: GIT_STATUS_COLORS.added, opacity: 0.9 }}>+{status.additions}</span>
          )}
          {status.deletions != null && status.deletions > 0 && (
            <span style={{ color: GIT_STATUS_COLORS.deleted, opacity: 0.9 }}>-{status.deletions}</span>
          )}
          {status.additions === 0 && status.deletions === 0 && (
            <span style={{ color: "var(--text-dim)", opacity: 0.6 }}>±0</span>
          )}
        </span>
      )}
      {onAtMention && hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAtMention(rel, false);
          }}
          title={t("files.insertPath")}
          style={{
            position: "absolute",
            right: "var(--s1)",
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "var(--s1)",
            padding: "0 8px",
            height: 20,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-xs)",
            color: "var(--accent)",
            cursor: "pointer",
            fontSize: TEXT.xs,
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          <MentionIcon />
          {t("files.mention")}
        </button>
      )}
    </div>
  );
}

export const FileExplorer = forwardRef<FileExplorerHandle, Props>(function FileExplorer({
  cwd,
  projectRoot,
  onOpenFile,
  refreshKey,
  onAtMention,
  onAtMentions,
  onUploadBusyChange,
  onFileMutated,
  changesCollapsed,
  onChangesCountChange,
  fileSearchOpen = false,
  onFileSearchOpenChange,
  mobileTopBar,
  inPanel,
}, ref) {
  const { t } = useI18n();
  // fork:pwa-sb —— 一处读断点，往下传给每一棵树行（手机上没有 hover，行尾那两枚
  // 动作得常驻）。挂在宿主这一层而不是每个 TreeNode，是为了不让上百行各挂一个
  // matchMedia 监听。桌面恒 false。
  const isMobile = useIsMobile();
  /* fork:file-tree-slot-swap —— 重挂的那一个实例从快照当初值，所以下面几个 useState
     拿到的是**上一次列到的样子**而不是空数组；没有新鲜快照时才走加载态。
     `useTreeSnapshot` 只在 cwd 真的变了时重读，所以同一 cwd 的重挂不会丢。 */
  const snapshot = useTreeSnapshot(cwd);
  const [roots, setRoots] = useState<FileNode[]>(() => snapshot?.roots ?? []);
  const [loading, setLoading] = useState(() => snapshot === null);
  const [error, setError] = useState<string | null>(null);
  /* 展开目录**不进快照**：子节点住在各个 `TreeNode` 自己的 state 里（`node.children`
     一直是空的），快照里恢复「展开」只会得到一排空文件夹。要留住展开就得连带把
     每一层的子节点也存下来 —— 那是一份真正的树缓存，超出这次要解决的问题，所以这里
     只还原根层 + 改动列表：换槽回来时看到的是同一棵树与同一份改动，展开态重来。 */
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [treeRefreshKey, setTreeRefreshKey] = useState(0);
  // fork:fix-tree-watch — 目录变更脉冲。外部（agent/终端/编辑器）改了文件后，
  // 服务端 SSE 推一次，这里自增把已展开目录的重取带动起来。
  const [watchPulse, setWatchPulse] = useState(0);
  const [watchDegraded, setWatchDegraded] = useState(false);
  // fork:fix-tree-git-debounce — git status 单独一条节流脉冲。
  // 目录事件可能连续来（一次写入触发多个事件），而 `git status` 要起进程、扫索引，
  // 不能跟着每次事件重拉；这里用 1.2s 去抖，保证「最终一致」而不跟着抖。
  const [gitPulse, setGitPulse] = useState(0);
  const [highlightedPaths, setHighlightedPaths] = useState<Set<string>>(new Set());
  const [gitFiles, setGitFiles] = useState<GitFileStatus[]>(() => snapshot?.gitFiles ?? []);
  const [gitLineStats, setGitLineStats] = useState(
    () => (snapshot ? { additions: snapshot.additions, deletions: snapshot.deletions } : { additions: 0, deletions: 0 }),
  );
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSummary, setUploadSummary] = useState<UploadSummary | null>(null);
  const [pendingConflict, setPendingConflict] = useState<PendingConflict | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPaths, setSearchPaths] = useState<string[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState<Set<string>>(new Set());
  // fork:gap10-search-scroll — 搜索命中后滚到它并居中（祖先展开已由上面的 effect 负责）
  const [scrollToPath, setScrollToPath] = useState<string | null>(null);
  /**
   * fork:gap08-roots — 多根：会话 cwd 始终是第一个根；`projectRoot` 与它不同时
   * （会话跑在 worktree 里）再补一个「项目」根。相同时只有一个根，界面与改动前一致。
   */
  const browserRoots = useMemo<FileBrowserRoot[]>(
    () => buildFileBrowserRoots({ cwd, projectRoot }),
    [cwd, projectRoot],
  );
  const extraRoots = useMemo(
    () => browserRoots.filter((root) => root.scope === "project"),
    [browserRoots],
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);
  const [renaming, setRenaming] = useState<RenameState | null>(null);
  const [creating, setCreating] = useState<CreateState | null>(null);
  const [mutating, setMutating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const rootCreateInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // fork:file-tree-slot-swap —— 有了快照就说明这是**同一个 cwd 的重挂**，`prevCwdRef`
  // 直接认下当前 cwd，下面那条 effect 便不会把展开目录清空、也不会回到加载态。
  const prevCwdRef = useRef<string | null>(snapshot ? cwd : null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const refreshToken = `${refreshKey ?? 0}:${treeRefreshKey}:${watchPulse}`;
  /** fork:gap08-roots — 额外根自己的变更脉冲（watch 必须按根建立）。 */
  const [extraWatchPulse, setExtraWatchPulse] = useState(0);
  const uploadBusy = uploadPhase !== "idle";
  const hasSearchQuery = searchQuery.trim().length > 0;


  const handleNodeContextMenu = useCallback((node: FileNode, x: number, y: number) => {
    setRenaming(null);
    setContextMenu({ x, y, fullPath: node.fullPath, name: node.name, isDir: node.isDir });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  /* ── M-06 帧 A · 手机档：文件树一次只显示一层 ──────────────────────────────
     画板原话（页脚第一条）：「一屏一层，不做多级展开树」—— 手机上点文件夹「进去」
     比点展开三角准，缩进还会挤掉右侧的条数与操作；层级改由顶栏路径 + 返回箭头承担。
     所以手机档不是「把桌面那棵树缩小」，而是**换一台机器**：同一个列表接口
     （`fetchEntries`）、同一套 git 徽标 / 上传 / 重命名 / 新建 / 删除 / 右键菜单，
     只是把 `expandedPaths` 换成了 `mobileDir` 这一个游标。
     桌面分支（`isMobile === false`）一个字都没动。 */
  const [mobileDir, setMobileDir] = useState(cwd);
  const [mobileEntries, setMobileEntries] = useState<FileNode[]>([]);
  const [mobileLoading, setMobileLoading] = useState(true);
  const [mobileError, setMobileError] = useState<string | null>(null);
  const [mobileSelected, setMobileSelected] = useState<string | null>(null);
  const [mobileNewMenuOpen, setMobileNewMenuOpen] = useState(false);
  const mobileCreateInputRef = useRef<HTMLInputElement>(null);
  /** 底部动作条的「更多」要在**选中行**的位置开菜单，所以留着那一行的节点。 */
  const mobileRowAnchors = useRef(new Map<string, HTMLButtonElement>());
  const mobileParent = mobileDir === cwd ? null : getFileDirectory(mobileDir);
  // 顶栏路径：根那层只写目录名（单行省略），深一层写相对 cwd 的整条路径。
  const mobileDirTitle = mobileDir === cwd
    ? (cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd)
    : getRelativeFilePath(mobileDir, cwd);

  useEffect(() => {
    if (creating && creating.parentDir === cwd) rootCreateInputRef.current?.focus();
  }, [creating, cwd]);

  // 手机档的新建输入框挂在 `.m-list` 上方（这一层没有子节点可插进去），单独聚焦。
  useEffect(() => {
    if (creating && creating.parentDir === mobileDir) mobileCreateInputRef.current?.focus();
  }, [creating, mobileDir]);

  useEffect(() => {
    if (!isMobile) return;
    let cancelled = false;
    setMobileLoading(true);
    setMobileError(null);
    fetchEntries(mobileDir)
      .then((entries) => { if (!cancelled) setMobileEntries(entries); })
      .catch((error) => {
        if (cancelled) return;
        setMobileEntries([]);
        setMobileError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!cancelled) setMobileLoading(false); });
    return () => { cancelled = true; };
  }, [isMobile, mobileDir, gitPulse, refreshKey, treeRefreshKey]);

  const enterMobileDir = useCallback((node: FileNode) => {
    setMobileDir(node.fullPath);
    setMobileSelected(node.fullPath);
    setSearchQuery("");
  }, []);

  const leaveMobileDir = useCallback(() => {
    if (!mobileParent) return;
    setMobileDir(mobileParent);
    setMobileSelected(mobileParent);
  }, [mobileParent]);

  // 桌面那份右键菜单在手机上按不出来（没有右键），所以底部动作条三项直接复用
  // **同一个 `handleNodeContextMenu`** —— 菜单内容、分组、危险项、以及每个动作的
  // 实现全是桌面那份，一处都没另写。
  const openMobileMenu = useCallback((entry: FileNode, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    handleNodeContextMenu(entry, rect.left, rect.bottom);
  }, [handleNodeContextMenu]);

  const copyMobilePath = useCallback((fullPath: string) => {
    // `copyText` 永不 reject：失败只是一个明确结果，桌面树没有失败提示位，
    // 手机档也不新造一个（复制失败在系统层面本来就有回执）。
    void copyText(fullPath);
  }, []);

  const mobileDirs = useMemo(() => mobileEntries.filter((entry) => entry.isDir), [mobileEntries]);
  const mobileFiles = useMemo(() => mobileEntries.filter((entry) => !entry.isDir), [mobileEntries]);

  const refreshTree = useCallback(() => {
    setTreeRefreshKey((key) => key + 1);
    onFileMutated?.();
  }, [onFileMutated]);

  const submitRename = useCallback(async () => {
    if (!renaming) return;
    const target = renaming;
    const nextName = target.value.trim();
    setRenaming(null);
    if (!nextName || nextName === target.name) return;
    setMutating(true);
    try {
      const result = await mutateFileEntry(target.fullPath, "rename", { name: nextName });
      if (result.ok) {
        setExpandedPaths((prev) => {
          if (!prev.has(target.fullPath)) return prev;
          const next = new Set(prev);
          next.delete(target.fullPath);
          next.add(joinFilePath(getFileDirectory(target.fullPath), nextName));
          return next;
        });
        refreshTree();
      } else {
        setActionError(result.error ?? null);
      }
    } finally {
      setMutating(false);
    }
  }, [renaming, refreshTree]);

  const cancelRename = useCallback(() => setRenaming(null), []);

  const handleRenameValueChange = useCallback((value: string) => {
    setRenaming((current) => current ? { ...current, value } : current);
  }, []);

  const handleCreateValueChange = useCallback((value: string) => {
    setCreating((current) => current ? { ...current, value } : current);
  }, []);

  const startCreate = useCallback((parentDir: string, type: "file" | "dir") => {
    setContextMenu(null);
    setRenaming(null);
    // The inline input lives in the real tree, not the search results tree —
    // leave search mode so the destination row is actually rendered.
    setSearchQuery("");
    setCreating({ parentDir, type, value: "" });
    if (parentDir !== cwd) {
      // The inline input lives inside the directory's row, so open it first.
      setExpandedPaths((prev) => {
        if (prev.has(parentDir)) return prev;
        const next = new Set(prev);
        next.add(parentDir);
        return next;
      });
    }
  }, [cwd]);

  const cancelCreate = useCallback(() => setCreating(null), []);

  const submitCreate = useCallback(async () => {
    if (!creating) return;
    const target = creating;
    const name = target.value.trim();
    if (!name) {
      setCreating(null);
      return;
    }
    setMutating(true);
    try {
      const result = await mutateFileEntry(
        target.parentDir,
        target.type === "file" ? "touch" : "mkdir",
        { name },
      );
      if (result.ok) {
        setCreating(null);
        if (target.parentDir !== cwd) {
          setExpandedPaths((prev) => {
            if (prev.has(target.parentDir)) return prev;
            const next = new Set(prev);
            next.add(target.parentDir);
            return next;
          });
        }
        setHighlightedPaths(new Set([joinFilePath(target.parentDir, name)]));
        refreshTree();
      } else {
        setActionError(result.error ?? null);
      }
    } finally {
      setMutating(false);
    }
  }, [creating, cwd, refreshTree]);

  const deleteNode = useCallback(async (node: ContextMenuTarget) => {
    setContextMenu(null);
    const message = node.isDir
      ? t("files.confirmDeleteFolder", { name: node.name })
      : t("files.confirmDeleteFile", { name: node.name });
    if (!window.confirm(message)) return;
    setMutating(true);
    try {
      const result = await mutateFileEntry(node.fullPath, "delete", { recursive: node.isDir });
      if (result.ok) {
        setExpandedPaths((prev) => {
          if (!prev.has(node.fullPath)) return prev;
          const next = new Set(prev);
          next.delete(node.fullPath);
          return next;
        });
        refreshTree();
      } else {
        setActionError(result.error ?? null);
      }
    } finally {
      setMutating(false);
    }
  }, [refreshTree, t]);

  const extractNode = useCallback(async (node: ContextMenuTarget) => {
    setContextMenu(null);
    setMutating(true);
    try {
      const result = await mutateFileEntry(node.fullPath, "extract");
      if (result.ok) {
        const extractedTo = result.data?.extractedTo;
        if (extractedTo) setHighlightedPaths(new Set([extractedTo]));
        refreshTree();
      } else {
        setActionError(result.error ?? null);
      }
    } finally {
      setMutating(false);
    }
  }, [refreshTree]);

  const compressNode = useCallback(async (node: ContextMenuTarget) => {
    setContextMenu(null);
    setMutating(true);
    try {
      const result = await mutateFileEntry(node.fullPath, "compress");
      if (result.ok) {
        const archive = result.data?.archive;
        if (archive) setHighlightedPaths(new Set([archive]));
        refreshTree();
      } else {
        setActionError(result.error ?? null);
      }
    } finally {
      setMutating(false);
    }
  }, [refreshTree]);

  const contextMenuItems = useMemo(() => {
    if (!contextMenu) return [];
    const parentDir = contextMenu.isDir
      ? contextMenu.fullPath
      : getFileDirectory(contextMenu.fullPath);
    /* fork:design-components —— 每项的图标与分组都取画板 30 的树右键菜单
       （行 305-312 文件菜单 / 319-328 目录菜单）：危险项在末尾并单独成组，
       图标是 `external-link` / `download` / `file-plus` / `folder-plus` /
       `square-pen` / `file-archive` / `scissors` / `trash-2`。 */
    const items: Array<{
      key: string;
      label: string;
      icon: ContextMenuIconName;
      danger?: boolean;
      /** 画板 .d-sep：这一项之前插一条分组线。 */
      sepBefore?: boolean;
      action: () => void;
    }> = [];
    if (!contextMenu.isDir) {
      items.push(
        {
          key: "open",
          label: t("files.menuOpen"),
          icon: "external-link",
          action: () => {
            setContextMenu(null);
            onOpenFile(contextMenu.fullPath, contextMenu.name);
          },
        },
        {
          key: "download",
          label: t("files.menuDownload"),
          icon: "download",
          action: () => {
            setContextMenu(null);
            const anchor = document.createElement("a");
            anchor.href = `/api/files/${encodeFilePathForApi(contextMenu.fullPath)}?type=download`;
            anchor.download = contextMenu.name;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
          },
        },
      );
    }
    items.push(
      {
        key: "new-file",
        label: t("files.menuNewFile"),
        icon: "file-plus",
        action: () => startCreate(parentDir, "file"),
      },
      {
        key: "new-folder",
        label: t("files.menuNewFolder"),
        icon: "folder-plus",
        action: () => startCreate(parentDir, "dir"),
      },
      {
        key: "rename",
        label: t("files.menuRename"),
        icon: "square-pen",
        sepBefore: true,
        action: () => {
          setContextMenu(null);
          setRenaming({ fullPath: contextMenu.fullPath, isDir: contextMenu.isDir, name: contextMenu.name, value: contextMenu.name });
        },
      },
    );
    if (!contextMenu.isDir && isArchivePath(contextMenu.name)) {
      items.push({
        key: "extract",
        label: t("files.menuExtract"),
        icon: "file-archive",
        action: () => void extractNode(contextMenu),
      });
    }
    items.push(
      {
        key: "compress",
        label: t("files.menuCompressZip"),
        icon: "scissors",
        action: () => void compressNode(contextMenu),
      },
      {
        key: "delete",
        label: t("files.menuDelete"),
        icon: "trash-2",
        danger: true,
        sepBefore: true,
        action: () => void deleteNode(contextMenu),
      },
    );
    return items;
  }, [compressNode, contextMenu, deleteNode, extractNode, onOpenFile, startCreate, t]);

  useEffect(() => {
    if (!contextMenu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contextMenu]);

  // Reuse the cached, bounded file index used by @ mentions.
  useEffect(() => {
    if (!fileSearchOpen) return;
    const query = searchQuery.trim();
    if (!query) {
      setSearchPaths([]);
      setSearchLoading(false);
      setSearchError(false);
      return;
    }
    const controller = new AbortController();
    setSearchLoading(true);
    setSearchError(false);
    const timer = setTimeout(() => {
      fetch(`/api/file-index?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<{ matches?: FileIndexEntry[] }> : Promise.reject(new Error("Search failed")))
        .then((data) => setSearchPaths((data.matches ?? []).filter((entry) => !entry.isDir).map((entry) => entry.path)))
        .catch(() => {
          if (!controller.signal.aborted) {
            setSearchPaths([]);
            setSearchError(true);
          }
        })
        .finally(() => { if (!controller.signal.aborted) setSearchLoading(false); });
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [cwd, fileSearchOpen, searchQuery]);

  // Focus the search input whenever the search panel opens.
  useEffect(() => {
    if (fileSearchOpen) searchInputRef.current?.focus();
  }, [fileSearchOpen]);

  // Results render as a tree; keep every directory that contains a match
  // expanded, while preserving the user's manual collapses as they type.
  useEffect(() => {
    if (searchPaths.length === 0) return;
    const dirs = new Set<string>();
    for (const relative of searchPaths) {
      const parts = relative.split("/");
      let path = "";
      for (let i = 0; i < parts.length - 1; i++) {
        path = path ? `${path}/${parts[i]}` : parts[i];
        dirs.add(joinFilePath(cwd, path));
      }
    }
    setSearchExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const dir of dirs) {
        if (!next.has(dir)) { next.add(dir); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [cwd, searchPaths]);

  const searchRoots = useMemo(() => {
    const toFileNode = (node: SearchTreeNode): FileNode => ({
      name: node.name,
      fullPath: joinFilePath(cwd, node.path),
      isDir: node.isDir,
      size: 0,
      children: node.children.map(toFileNode),
      loaded: true,
    });
    return buildSearchTree(searchPaths).map(toFileNode);
  }, [cwd, searchPaths]);

  const gitStatusByPath = useMemo(() => new Map(
    gitFiles.map((status) => [normalizeFilePathSlashes(status.filePath), status]),
  ), [gitFiles]);

  const changedDirectoryPaths = useMemo(() => {
    const directories = new Set<string>();
    const normalizedCwd = normalizeFilePathSlashes(cwd).replace(/\/$/, "");
    for (const status of gitFiles) {
      let directory = getFileDirectory(normalizeFilePathSlashes(status.filePath));
      while (directory === normalizedCwd || directory.startsWith(`${normalizedCwd}/`)) {
        directories.add(directory);
        if (directory === normalizedCwd) break;
        const parent = getFileDirectory(directory);
        if (parent === directory) break;
        directory = parent;
      }
    }
    return directories;
  }, [cwd, gitFiles]);

  const handleToggleExpanded = useCallback((fullPath: string, open: boolean) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (open) next.add(fullPath); else next.delete(fullPath);
      return next;
    });
  }, []);

  const applyUploadResult = useCallback((data: UploadResponse) => {
    const uploaded = data.uploaded ?? [];
    const skipped = data.skipped ?? [];
    const errors = data.errors ?? [];
    setUploadSummary({ uploaded, skipped, errors });

    if (uploaded.length > 0) {
      setHighlightedPaths(new Set(uploaded.map((name) => joinFilePath(cwd, name))));
      setTreeRefreshKey((key) => key + 1);
    }
  }, [cwd]);

  const performUpload = useCallback(async (
    files: File[],
    strategy: UploadConflictStrategy,
  ) => {
    setPendingConflict(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploadPhase("uploading");

    try {
      const { status, data } = await uploadFiles(cwd, files, strategy, setUploadProgress);
      if (status === 409 && data.conflicts?.length) {
        setPendingConflict({
          files,
          conflicts: data.conflicts,
          nonReplaceable: data.nonReplaceable ?? [],
        });
        return;
      }
      if (status < 200 || status >= 300) {
        throw new Error(data.error ?? `Upload failed (HTTP ${status})`);
      }
      setUploadProgress(100);
      applyUploadResult(data);
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : String(uploadFailure));
    } finally {
      setUploadPhase("idle");
    }
  }, [applyUploadResult, cwd]);

  const prepareUpload = useCallback(async (files: File[]) => {
    if (files.length === 0 || uploadBusy) return;
    setUploadSummary(null);
    setHighlightedPaths(new Set());
    setPendingConflict(null);
    setUploadError(null);
    setUploadProgress(0);
    setUploadPhase("checking");

    try {
      const res = await fetch(
        `/api/files/${encodeFilePathForApi(cwd)}?type=upload-check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileNames: files.map((file) => file.name) }),
        },
      );
      const data = await res.json().catch(() => ({})) as UploadResponse;
      if (!res.ok) throw new Error(data.error ?? `Upload check failed (HTTP ${res.status})`);

      if (data.conflicts?.length) {
        setPendingConflict({
          files,
          conflicts: data.conflicts,
          nonReplaceable: data.nonReplaceable ?? [],
        });
        return;
      }

      await performUpload(files, "error");
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : String(uploadFailure));
    } finally {
      setUploadPhase("idle");
    }
  }, [cwd, performUpload, uploadBusy]);

  const handleUploadInput = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    void prepareUpload(files);
  }, [prepareUpload]);

  useImperativeHandle(ref, () => ({
    openUploadPicker() {
      if (!uploadBusy) uploadInputRef.current?.click();
    },
  }), [uploadBusy]);

  useEffect(() => {
    onUploadBusyChange?.(uploadBusy);
  }, [onUploadBusyChange, uploadBusy]);

  useEffect(() => () => onUploadBusyChange?.(false), [onUploadBusyChange]);

  useEffect(() => {
    const cwdChanged = prevCwdRef.current !== cwd;
    prevCwdRef.current = cwd;

    // Reset expanded state only when cwd changes, not on refreshKey bumps
    if (cwdChanged) {
      setExpandedPaths(new Set());
      // M-06 —— 手机档的游标也回根，否则换项目后还停在上一个项目的子目录里。
      setMobileDir(cwd);
      setMobileSelected(null);
      setHighlightedPaths(new Set());
      setUploadSummary(null);
      setPendingConflict(null);
      setUploadError(null);
      setContextMenu(null);
      setRenaming(null);
      setCreating(null);
      setActionError(null);
    }

    setLoading(cwdChanged);
    setError(null);
    let cancelled = false;
    fetchEntries(cwd)
      .then((entries) => { if (!cancelled) setRoots(entries); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [cwd, gitPulse, refreshKey, treeRefreshKey]);

  /* fork:file-tree-slot-swap —— 记住这棵树现在长什么样，供下一次重挂当初值。
     只在**真的列到了东西**时记：空列表不该覆盖掉上一次那份（否则一次失败的列目录
     会把快照也清成空，重挂后就变成「0 个条目」）。 */
  useEffect(() => {
    if (roots.length === 0) return;
    writeFileTreeSnapshot(cwd, {
      roots,
      gitFiles,
      ...gitLineStats,
    });
  }, [cwd, roots, gitFiles, gitLineStats]);

  // fork:fix-tree-git-debounce — 目录事件 → git 状态刷新的去抖桥。
  useEffect(() => {
    if (watchPulse === 0) return;
    const timer = setTimeout(() => setGitPulse((pulse) => pulse + 1), 1200);
    return () => clearTimeout(timer);
  }, [watchPulse]);

  // fork:fix-tree-watch — 订阅目录变更。原先刷新只靠父级 refreshKey 自上而下重取，
  // 组件从未订阅任何事件流，所以外部改动后文件树不会自己更新。
  //
  // 注意与 git status 那条 effect 的分工：这里只在**收到服务端事件**时自增脉冲，
  // 不做轮询；SSE 断开由 EventSource 自己按浏览器默认节奏重连。
  useEffect(() => {
    if (!cwd || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/file-watch?path=${encodeURIComponent(cwd)}`);
    let disconnected = false;
    source.addEventListener("change", () => {
      if (disconnected) return;
      setWatchPulse((pulse) => pulse + 1);
    });
    source.addEventListener("degraded", () => { setWatchDegraded(true); });
    source.addEventListener("error", () => {
      // 这里是服务端主动 close（非 404 等 HTTP 错误）：不再重连，改用原有刷新路径。
      disconnected = true;
      source.close();
    });
    return () => source.close();
  }, [cwd]);

  // fork:gap08-roots — 额外根各自订阅目录变更。主根的订阅在下面（挂在 cwd 上），
  // 这里只负责「项目」根：FIX-08 的 watch 是**按路径**建立的，多根就必须多条订阅。
  useEffect(() => {
    if (extraRoots.length === 0 || typeof EventSource === "undefined") return;
    const sources = extraRoots.map((root) => {
      const source = new EventSource(`/api/file-watch?path=${encodeURIComponent(root.path)}`);
      source.addEventListener("change", () => setExtraWatchPulse((pulse) => pulse + 1));
      return source;
    });
    return () => { sources.forEach((source) => source.close()); };
  }, [extraRoots]);

  useEffect(() => {
    let cancelled = false;
    fetchGitStatus(cwd)      .then((status) => {
        if (!cancelled) {
          setGitFiles(status.isGitRepository ? status.files : []);
          setGitLineStats(status.isGitRepository
            ? { additions: status.additions, deletions: status.deletions }
            : { additions: 0, deletions: 0 });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGitFiles([]);
          setGitLineStats({ additions: 0, deletions: 0 });
        }
      });
    return () => { cancelled = true; };
  }, [cwd, refreshKey, treeRefreshKey]);

  useEffect(() => {
    onChangesCountChange?.(gitFiles.length);
  }, [gitFiles, onChangesCountChange]);

  const showUploadFeedback = uploadBusy || pendingConflict !== null || uploadError !== null || uploadSummary !== null;

  const addUploadedFilesToChat = useCallback(() => {
    if (!uploadSummary || uploadSummary.uploaded.length === 0) return;
    onAtMentions?.(
      uploadSummary.uploaded.map((name) => getRelativeFilePath(joinFilePath(cwd, name), cwd)),
    );
  }, [cwd, onAtMentions, uploadSummary]);

  /* ══ M-06 帧 A · 手机档整页 ═══════════════════════════════════════════════
     DOM 抄自 `design/v5/pwa/boards/M-06-files-terminal.html` 帧 A：
       `.m-fade` → `.m-top`（返回 / 路径 / 筛选 / 新建）→ `.m-list`
       （`.m-group-title` + `.m-trow`，选中挂 `.is-on`）→ `.m-vbar`（三项等分）。
     底部动作条三项 = 重命名 / 复制路径 / 更多：前两项是桌面右键菜单里的同名动作，
     第三项**直接打开同一份菜单**（`handleNodeContextMenu`），所以删除 / 解压 /
     压缩 / 新建子项 / @ 插入在手机上一样在，一处实现都没另写。
     下面 desktop 分支保持原样，`.d-trow` / `.d-tree` / `.d-tinybar` 一个不动。 */
  if (isMobile) {
    const selectedEntry = mobileEntries.find((entry) => entry.fullPath === mobileSelected) ?? null;
    const renderMobileRow = (entry: FileNode) => {
      const selected = entry.fullPath === mobileSelected;
      const gitStatus = gitStatusByPath.get(normalizeFilePathSlashes(entry.fullPath));
      const dirChanged = entry.isDir && changedDirectoryPaths.has(normalizeFilePathSlashes(entry.fullPath));
      const highlighted = highlightedPaths.has(entry.fullPath);
      return (
        <button
          key={entry.fullPath}
          type="button"
          className={`m-trow${selected ? " is-on" : ""}`}
          aria-current={selected}
          title={entry.fullPath}
          ref={(node) => {
            if (!node || !selected) return;
            mobileRowAnchors.current.set(entry.fullPath, node);
          }}
          onClick={() => {
            setMobileSelected(entry.fullPath);
            if (entry.isDir) enterMobileDir(entry);
            else onOpenFile(entry.fullPath, entry.name);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            setMobileSelected(entry.fullPath);
            openMobileMenu(entry, event.currentTarget);
          }}
        >
          <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            {entry.isDir
              ? <FolderIcon size={15} />
              : getFileIcon(entry.name, 15)}
          </span>
          {renaming?.fullPath === entry.fullPath ? (
            <input
              value={renaming.value}
              onChange={(event) => handleRenameValueChange(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); void submitRename(); }
                else if (event.key === "Escape") { event.preventDefault(); cancelRename(); }
              }}
              onBlur={cancelRename}
              aria-label={t("files.renameEntry")}
              style={{
                minWidth: 0,
                flex: "0 1 auto",
                height: "var(--control-xs)",
                border: 0,
                borderRadius: "var(--radius-xs)",
                outline: "none",
                background: "var(--bg)",
                color: "var(--text)",
                fontFamily: "var(--font-mono)",
                fontSize: TEXT.sm,
              }}
            />
          ) : (
            <>
              <span className="m-grow">{entry.name}</span>
              {dirChanged && <span className="m-dot warn" aria-label={t("files.containsChangedFiles")} />}
              {highlighted && <span className="m-badge ok">{t("files.newlyUploaded")}</span>}
              {!dirChanged && !entry.isDir && gitStatus && <GitStatusBadge status={gitStatus} t={t} />}
              {!entry.isDir && mobileSizeLabel(entry.size) && (
                <span className="m-t-xs m-t-faint">{mobileSizeLabel(entry.size)}</span>
              )}
            </>
          )}
        </button>
      );
    };

    return (
      <div
        /* 只承担与设计无关的定位 / 伸缩：`.m-top` 与 `.m-fade` 是绝对定位的，
           需要一层 `position: relative` 当参照，否则会贴到整个右栏宿主顶上。 */
        style={{ position: "relative", display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 }}
      >
        <input ref={uploadInputRef} type="file" multiple hidden onChange={handleUploadInput} />
        {inPanel ? null : <div className="m-fade" aria-hidden="true" />}

        <div className={inPanel ? "fork-pane-bar" : "m-top"}>
          <button
            type="button"
            className="m-top-btn"
            title={t("directoryPicker.goToParent")}
            aria-label={t("directoryPicker.goToParent")}
            disabled={!mobileParent}
            onClick={leaveMobileDir}
          >
            <i data-ico="chevron-left" data-size="16" aria-hidden="true"></i>
          </button>
          <span className="m-top-title m-grow" title={mobileDir}>{mobileDirTitle}</span>
          {mobileTopBar}
          <button
            type="button"
            className="m-top-btn"
            title={t("sidebar.searchFiles")}
            aria-label={t("sidebar.searchFiles")}
            aria-pressed={fileSearchOpen}
            onClick={() => onFileSearchOpenChange?.(!fileSearchOpen)}
          >
            <i data-ico="list-filter" data-size="16" aria-hidden="true"></i>
          </button>
          <button
            type="button"
            className="m-top-btn"
            title={t("files.newFile")}
            aria-label={t("files.newFile")}
            aria-expanded={mobileNewMenuOpen}
            onClick={() => setMobileNewMenuOpen((open) => !open)}
          >
            <i data-ico="plus" data-size="16" aria-hidden="true"></i>
          </button>
        </div>

        {mobileNewMenuOpen && (
          // 非主题值：top 抄画板帧 A 的 `style="top:52px"`（菜单落在顶栏之下）。
          <div className="m-pop-float is-open" style={{ top: 52 }}>
            <div className="m-doc-label">{mobileDirTitle}</div>
            <button
              type="button"
              className="m-menu-row"
              onClick={() => { setMobileNewMenuOpen(false); setRenaming(null); startCreate(mobileDir, "file"); }}
            >
              <i data-ico="file-plus" data-size="15" aria-hidden="true"></i>{t("files.menuNewFile")}
            </button>
            <button
              type="button"
              className="m-menu-row"
              onClick={() => { setMobileNewMenuOpen(false); setRenaming(null); startCreate(mobileDir, "dir"); }}
            >
              <i data-ico="folder-plus" data-size="15" aria-hidden="true"></i>{t("files.menuNewFolder")}
            </button>
          </div>
        )}

        {fileSearchOpen && (
          <div className="m-searchfield" style={{ margin: "0 12px" }}>
            <i data-ico="search" data-size="14" aria-hidden="true"></i>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") onFileSearchOpenChange?.(false); }}
              placeholder={t("sidebar.searchFilesPlaceholder")}
              aria-label={t("sidebar.searchFiles")}
            />
            {searchQuery && (
              <button
                type="button"
                className="m-iconbtn"
                onClick={() => setSearchQuery("")}
                title={t("sidebar.clearSearch")}
                aria-label={t("sidebar.clearSearch")}
              >
                <i data-ico="x" data-size="11" aria-hidden="true"></i>
              </button>
            )}
          </div>
        )}

        {fileSearchOpen && hasSearchQuery && (
          <div className="m-panel-scroll" style={{ padding: "0 0 8px" }}>
            {searchLoading && <div className="m-t-xs m-t-faint">{t("sidebar.searchingFiles")}</div>}
            {!searchLoading && searchError && (
              <div className="m-t-xs" style={{ color: "var(--nx-danger)" }}>{t("i18n.networkError")}</div>
            )}
            {!searchLoading && !searchError && searchPaths.length === 0 && (
              <div className="m-group-title">{t("sidebar.noMatchingFiles")}</div>
            )}
            {!searchLoading && !searchError && searchPaths.length > 0 && searchRoots.map((node) => (
              <button
                key={`${searchQuery}:${node.fullPath}`}
                type="button"
                className="m-trow"
                onClick={() => {
                  setScrollToPath(node.fullPath);
                  onOpenFile(node.fullPath, node.name);
                }}
              >
                <span className="m-grow">{getRelativeFilePath(node.fullPath, cwd)}</span>
              </button>
            ))}
          </div>
        )}

        {showUploadFeedback && (
          <div style={{ padding: "8px 12px" }}>
            {uploadBusy && (
              <div role="status" className="m-banner">
                <i data-ico="upload" data-size="13" aria-hidden="true"></i>
                <span className="m-grow">
                  {uploadPhase === "checking" ? t("files.checking") : t("files.uploading", { progress: uploadProgress })}
                </span>
              </div>
            )}
            {pendingConflict && (
              <div role="alert" className="m-banner warn">
                <i data-ico="triangle-alert" data-size="14" aria-hidden="true"></i>
                <span className="m-grow">
                  {t("files.conflictSummary", {
                    count: pendingConflict.conflicts.length,
                    countSuffix: pendingConflict.conflicts.length === 1 ? "" : "s",
                    files: pendingConflict.conflicts.join(", "),
                  })}
                </span>
                <button
                  type="button"
                  className="m-picktag"
                  onClick={() => void performUpload(pendingConflict.files, "overwrite")}
                >
                  {t("files.replace")}
                </button>
                <button
                  type="button"
                  className="m-picktag"
                  onClick={() => void performUpload(pendingConflict.files, "skip")}
                >
                  {t("files.skipExisting")}
                </button>
              </div>
            )}
            {uploadError && (
              <div role="alert" className="m-banner err">
                <i data-ico="circle-alert" data-size="14" aria-hidden="true"></i>
                <span className="m-grow">{uploadError}</span>
              </div>
            )}
            {uploadSummary && (
              <div aria-live="polite" className="m-banner">
                <span className="m-grow">
                  {uploadSummary.uploaded.length > 0 && `${uploadSummary.uploaded.length} · `}
                  {uploadSummary.skipped.length > 0 && `${uploadSummary.skipped.length} · `}
                  {uploadSummary.errors.length > 0 && `${uploadSummary.errors.length}`}
                </span>
                {uploadSummary.uploaded.length > 0 && onAtMentions && (
                  <button
                    type="button"
                    className="m-picktag is-on"
                    onClick={addUploadedFilesToChat}
                    title={t("files.addUploadedFile")}
                  >
                    {t("files.mention")}
                  </button>
                )}
                <button
                  type="button"
                  className="m-iconbtn"
                  onClick={() => setUploadSummary(null)}
                  title={t("files.dismissUploadResults")}
                  aria-label={t("files.dismissUploadResults")}
                >
                  <i data-ico="x" data-size="11" aria-hidden="true"></i>
                </button>
              </div>
            )}
          </div>
        )}

        {creating && creating.parentDir === mobileDir && (
          <div style={{ padding: "4px 12px" }}>
            <div className="m-trow" style={{ cursor: "default" }}>
              {creating.type === "dir"
                ? <FolderIcon size={15} />
                : <i data-ico="file" data-size="15" aria-hidden="true"></i>}
              <input
                ref={mobileCreateInputRef}
                value={creating.value}
                onChange={(event) => handleCreateValueChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") { event.preventDefault(); void submitCreate(); }
                  else if (event.key === "Escape") { event.preventDefault(); cancelCreate(); }
                }}
                onBlur={cancelCreate}
                placeholder={creating.type === "dir" ? t("files.newFolderName") : t("files.newFileName")}
                aria-label={creating.type === "dir" ? t("files.newFolderName") : t("files.newFileName")}
                style={{
                  minWidth: 0,
                  flex: "0 1 auto",
                  height: "var(--control-xs)",
                  border: 0,
                  borderRadius: "var(--radius-xs)",
                  outline: "none",
                  background: "var(--bg)",
                  color: "var(--text)",
                  fontFamily: "var(--font-mono)",
                  fontSize: TEXT.sm,
                }}
              />
            </div>
          </div>
        )}

        <div className="m-list">
          {mobileLoading && <div className="m-t-xs m-t-faint" style={{ padding: "4px 12px" }}>{t("i18n.loading")}</div>}
          {mobileError && <div className="m-t-xs" style={{ padding: "4px 12px", color: "var(--nx-danger)" }}>{mobileError}</div>}
          {mobileDirs.map(renderMobileRow)}
          {mobileFiles.map(renderMobileRow)}

          {!mobileLoading && !mobileError && mobileEntries.length === 0 && (
            <div className="m-empty">
              <div className="m-empty-ico"><i data-ico="folder-search" data-size="20" aria-hidden="true"></i></div>
              <div className="m-empty-s">{t("files.emptyDirectory")}</div>
            </div>
          )}

          {gitFiles.length > 0 && (
            <>
              <div className="m-group-title">
                {t("files.changeStats", {
                  count: gitFiles.length,
                  additions: gitLineStats.additions,
                  deletions: gitLineStats.deletions,
                })}
              </div>
              {gitFiles.map((status) => (
                <button
                  key={status.filePath}
                  type="button"
                  className={`m-trow${status.filePath === mobileSelected ? " is-on" : ""}`}
                  title={status.filePath}
                  onClick={() => {
                    setMobileSelected(status.filePath);
                    onOpenFile(status.filePath, getFileName(status.filePath), { modeHint: "diff" });
                  }}
                >
                  <GitStatusBadge status={status} t={t} />
                  <span className="m-grow m-mono">{getRelativeFilePath(status.filePath, cwd)}</span>
                  <span className="m-badge warn">
                    {status.additions != null && status.additions > 0 ? `+${status.additions} ` : ""}
                    {status.deletions != null && status.deletions > 0 ? `−${status.deletions}` : ""}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>

        {/* M-06 帧 A · 底部动作条三项等分。 */}
        <div className="m-vbar">
          <button
            type="button"
            className="m-menu-row"
            disabled={!selectedEntry}
            onClick={() => {
              if (!selectedEntry) return;
              setRenaming({ fullPath: selectedEntry.fullPath, isDir: selectedEntry.isDir, name: selectedEntry.name, value: selectedEntry.name });
            }}
          >
            <i data-ico="pencil" data-size="15" aria-hidden="true"></i>{t("files.menuRename")}
          </button>
          <button
            type="button"
            className="m-menu-row"
            disabled={!selectedEntry}
            onClick={() => selectedEntry && copyMobilePath(selectedEntry.fullPath)}
          >
            <i data-ico="copy" data-size="15" aria-hidden="true"></i>{t("files.copyPath")}
          </button>
          <button
            type="button"
            className="m-menu-row"
            disabled={!selectedEntry}
            onClick={() => {
              const anchor = selectedEntry ? mobileRowAnchors.current.get(selectedEntry.fullPath) : null;
              if (selectedEntry && anchor) openMobileMenu(selectedEntry, anchor);
            }}
          >
            <i data-ico="ellipsis" data-size="15" aria-hidden="true"></i>{t("files.moreActions")}
          </button>
        </div>

        {contextMenu && createPortal(
          <>
            <div
              style={{ position: "fixed", inset: 0, zIndex: 1200 }}
              onClick={closeContextMenu}
              onContextMenu={(event) => { event.preventDefault(); closeContextMenu(); }}
            />
            <div
              role="menu"
              /* 与桌面同一份菜单壳：框 / 圆角 / 阴影 / 行全部来自 system.css。 */
              className="m-menu-sheet is-open"
              style={{ zIndex: 1201 }}
            >
              <div className="m-menu-sheet-title">{contextMenu.name}</div>
              {contextMenuItems.map((item) => (
                <Fragment key={item.key}>
                  {item.sepBefore && <div className="m-sep" />}
                  <button type="button" role="menuitem" className="m-menu-row" onClick={item.action}>
                    <i data-ico={item.icon} data-size="15" aria-hidden="true"></i>
                    {item.label}
                  </button>
                </Fragment>
              ))}
            </div>
          </>,
          document.body,
        )}
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100%" }}>
      <input ref={uploadInputRef} type="file" multiple hidden onChange={handleUploadInput} />
      {/* fork:search-off-by-default（2026-10-05 用户裁定）—— 筛选条与头行那枚
          search 钮是**同一个开关**：进来时收起（不进文件面板就先看见搜索框 =
          用户反馈「默认选中搜索按钮」），点钮才展开。此前是常驻，于是进来即选中。
          同时**删掉**这一行里那枚 `git-commit-horizontal`（「只看改动 / 审查改动」）：
          它与头行那枚 `file-diff` 是同一个动作的两处入口（都切 `changesCollapsed`），
          用户反馈「重复了」；头行那枚带改动计数，是产品侧选定的唯一入口。 */}
      {fileSearchOpen && (
      <div className="d-tinybar">
        <div className="d-searchfield d-grow">
          <i data-ico="search" data-size="12" aria-hidden="true"></i>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") onFileSearchOpenChange?.(false); }}
            placeholder={t("sidebar.searchFilesPlaceholder")}
            aria-label={t("sidebar.searchFiles")}
          />
          {searchQuery && (
            <button
              type="button"
              className="d-iconbtn"
              onClick={() => setSearchQuery("")}
              title={t("sidebar.clearSearch")}
              aria-label={t("sidebar.clearSearch")}
            >
              <i data-ico="x" data-size="11" aria-hidden="true"></i>
            </button>
          )}
        </div>
      </div>
      )}
      {/* fork:v5-landing D-05 帧 A —— 板面在动作条下面还有两行弱化说明：副头
          `.d-subhead`（「N 个条目 · 索引于 刚刚 · 已忽略 .git / node_modules」）与一行
          `.d-t-xs.d-t-faint`（新建后就地改名 / Enter 提交 / 空名不落盘）。
          **用户 2026-10-05 裁定删掉这两行**：它们讲的是规则不是动作，夹在动作条与树
          之间把树压下去；「就地改名」这件事等真进到重命名时输入框自带提示。
          动作条与树现在紧挨着。i18n 的两个 key 留着（画板 D-05 帧 A 上仍有这句，
          要回滚只要把这两块 DOM 放回去）。 */}
      {/* fork:v5-skin D-05 帧 A —— 树内动作条 = 画板 .d-tinybar + 两枚 .d-btn.sm.ghost
          （file-plus / folder-plus + 文字）。 */}
      <div className="d-tinybar fork-pwa-sb-tree-tools">
        <button
          type="button"
          className="d-btn sm ghost"
          onClick={() => { setRenaming(null); startCreate(cwd, "file"); }}
          disabled={mutating || creating !== null}
          title={t("files.newFile")}
          aria-label={t("files.newFile")}
        >
          <i data-ico="file-plus" data-size="13" aria-hidden="true"></i>
          {t("files.newFile")}
        </button>
        <button
          type="button"
          className="d-btn sm ghost"
          onClick={() => { setRenaming(null); startCreate(cwd, "dir"); }}
          disabled={mutating || creating !== null}
          title={t("files.newFolder")}
          aria-label={t("files.newFolder")}
        >
          <i data-ico="folder-plus" data-size="13" aria-hidden="true"></i>
          {t("files.newFolder")}
        </button>
        {actionError && (
          <span role="alert" className="d-grow d-t-xs d-t-faint" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={actionError}>
            {actionError}
          </span>
        )}
        {actionError && (
          <DismissButton onClick={() => setActionError(null)} title={t("files.dismissError")} />
        )}
      </div>
      {creating && creating.parentDir === cwd && (
        <div style={{ padding: "var(--space-tight) 4px" }}>
          <CreateEntryInput
            depth={0}
            type={creating.type}
            value={creating.value}
            inputRef={rootCreateInputRef}
            onValueChange={handleCreateValueChange}
            onSubmit={() => void submitCreate()}
            onCancel={cancelCreate}
            t={t}
          />
        </div>
      )}
      {watchDegraded && (
        <div role="status" className="d-t-xs d-t-faint" style={{ padding: "4px 8px" }}>
          {t("files.watchDegraded")}
        </div>
      )}
      {showUploadFeedback && (
        <div style={{ padding: "var(--space-row) 8px", borderBottom: "1px solid var(--border)" }}>
        {uploadBusy && (
          <div role="status" aria-live="polite" aria-label={uploadPhase === "checking" ? t("files.checking") : t("files.uploading", { progress: uploadProgress })}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--s2)", minHeight: "var(--icon-sm)", color: "var(--text-muted)" }}>
              {uploadPhase === "checking" ? (
                <i data-ico="loader-circle" data-size="13" className="d-t-faint animate-spin" aria-hidden="true"></i>
              ) : (
                <i data-ico="upload" data-size="13" className="d-t-faint" aria-hidden="true"></i>
              )}
              {uploadPhase === "uploading" && <span className="d-mono d-t-faint">{uploadProgress}%</span>}
            </div>
            {uploadPhase === "uploading" && (
              <div style={{ height: 3, marginTop: "var(--s1)", overflow: "hidden", borderRadius: "var(--radius-xs)", background: "var(--border)" }}>
                <div style={{ width: "100%", height: "100%", background: "var(--text-muted)", transform: `scaleX(${Math.max(0, Math.min(100, uploadProgress)) / 100})`, transformOrigin: "left", transition: "transform 120ms ease" }} />
              </div>
            )}
          </div>
        )}

        {pendingConflict && (
          <div role="alert" className="d-card" style={{ padding: 7, borderColor: "color-mix(in srgb, var(--nx-warning) 55%, var(--nx-line))", background: "color-mix(in srgb, var(--nx-warning) 9%, var(--nx-panel))" }}>
            <div className="d-t-xs" style={{ color: "var(--nx-text)", lineHeight: 1.35, overflowWrap: "anywhere" }}>
              {t("files.conflictSummary", { count: pendingConflict.conflicts.length, countSuffix: pendingConflict.conflicts.length === 1 ? "" : "s", files: pendingConflict.conflicts.join(", ") })}
            </div>
            {pendingConflict.nonReplaceable.length > 0 && (
              <div className="d-t-xs" style={{ marginTop: "var(--nx-sp-1)", color: "var(--nx-warning)", lineHeight: 1.35, overflowWrap: "anywhere" }}>
                {t("files.cannotReplace", { files: pendingConflict.nonReplaceable.join(", ") })}
              </div>
            )}
            <div className="d-row" style={{ marginTop: "var(--nx-sp-1)" }}>
              <button type="button" className="d-btn sm danger" onClick={() => void performUpload(pendingConflict.files, "overwrite")}>
                {t("files.replace")}
              </button>
              <button type="button" className="d-btn sm" onClick={() => void performUpload(pendingConflict.files, "skip")}>
                {t("files.skipExisting")}
              </button>
              <button type="button" className="d-btn sm ghost" onClick={() => setPendingConflict(null)}>
                {t("files.cancel")}
              </button>
            </div>
          </div>
        )}

        {uploadError && (
          <div role="alert" className="d-banner err">
            <i data-ico="circle-alert" data-size="13" aria-hidden="true"></i>
            <span className="d-grow" style={{ overflowWrap: "anywhere" }}>{uploadError}</span>
            <DismissButton onClick={() => setUploadError(null)} title={t("files.dismissError")} />
          </div>
        )}

        {uploadSummary && (
          <div aria-live="polite">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--s2)", minHeight: 22, fontSize: TEXT.xs }}>
              <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: "var(--s2)" }}>
                {uploadSummary.uploaded.length > 0 && (
                  <span className="d-row d-t-xs" style={{ color: "var(--nx-success)" }} title={`${uploadSummary.uploaded.length} uploaded`} aria-label={`${uploadSummary.uploaded.length} uploaded`}>
                    <i data-ico="check" data-size="13" aria-hidden="true"></i>
                    <span>{uploadSummary.uploaded.length}</span>
                  </span>
                )}
                {uploadSummary.skipped.length > 0 && (
                  <span className="d-row d-t-xs d-t-faint" title={`${uploadSummary.skipped.length} skipped`} aria-label={`${uploadSummary.skipped.length} skipped`}>
                    <i data-ico="circle-minus" data-size="13" aria-hidden="true"></i>
                    <span>{uploadSummary.skipped.length}</span>
                  </span>
                )}
                {uploadSummary.errors.length > 0 && (
                  <span className="d-row d-t-xs" style={{ color: "var(--nx-danger)" }} title={`${uploadSummary.errors.length} failed`} aria-label={`${uploadSummary.errors.length} failed`}>
                    <i data-ico="triangle-alert" data-size="13" aria-hidden="true"></i>
                    <span>{uploadSummary.errors.length}</span>
                  </span>
                )}
              </div>
              {uploadSummary.uploaded.length > 0 && onAtMentions && (
                <button
                  type="button"
                  onClick={addUploadedFilesToChat}
                  title={uploadSummary.uploaded.length === 1 ? t("files.addUploadedFile") : t("files.addAllUploadedFiles")}
                  aria-label={uploadSummary.uploaded.length === 1 ? t("files.addUploadedFile") : t("files.addAllUploadedFiles")}
                  style={{ height: "var(--control-2xs)", padding: "0 7px", display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--s1)", flexShrink: 0, border: "1px solid var(--border)", borderRadius: "var(--radius-xs)", background: "var(--bg-panel)", color: "var(--accent)", cursor: "pointer", fontSize: TEXT.xs, fontWeight: 600, whiteSpace: "nowrap" }}
                >
                  <MentionIcon />
                  {t("files.mention")}
                </button>
              )}
              <DismissButton onClick={() => setUploadSummary(null)} title={t("files.dismissUploadResults")} />
            </div>
            {uploadSummary.errors.map((item) => (
              <div key={item.name} title={item.error} className="d-row d-t-xs" style={{ color: "var(--nx-danger)", minWidth: 0, marginTop: "var(--nx-sp-1)" }}>
                <i data-ico="circle-alert" data-size="11" aria-hidden="true"></i>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</span>
              </div>
            ))}
          </div>
        )}
        </div>
      )}

      {fileSearchOpen && hasSearchQuery && (
      <div style={{ padding: "var(--nx-sp-2) var(--nx-sp-2) 0" }}>
        {hasSearchQuery && (
          <div style={{ paddingTop: "var(--nx-sp-1)" }}>
            {searchLoading && <div role="status" className="d-t-xs d-t-faint" style={{ padding: "var(--nx-sp-2) 2px" }}>{t("sidebar.searchingFiles")}</div>}
            {!searchLoading && searchError && <div role="alert" className="d-t-xs" style={{ padding: "var(--nx-sp-2) 2px", color: "var(--nx-danger)" }}>{t("i18n.networkError")}</div>}
            {!searchLoading && !searchError && searchPaths.length === 0 && (
              /* 同画板的「过滤无结果」那一格。 */
              <div className="d-empty compact">
                <div className="d-empty-ico"><i data-ico="folder-search" data-size="16" aria-hidden="true"></i></div>
                <p className="d-empty-s">{t("sidebar.noMatchingFiles")}</p>
              </div>
            )}
            {!searchLoading && !searchError && searchPaths.length > 0 && (
              <div className="d-tree">
                {searchRoots.map((node) => (
                  <TreeNode
                    key={`${searchQuery}:${node.fullPath}`}
                    node={node}
                    depth={0}
                    cwd={cwd}
                onOpenFile={(filePath, fileName, options) => {
                  // fork:gap10-search-scroll — 先把命中行滚到中间，再开文件
                  setScrollToPath(filePath);
                  onOpenFile(filePath, fileName, options);
                }}
                onAtMention={onAtMention}
                expandedPaths={searchExpanded}
                onToggleExpanded={(fullPath, open) => {
                      setSearchExpanded((prev) => {
                        const next = new Set(prev);
                        if (open) next.add(fullPath); else next.delete(fullPath);
                        return next;
                      });
                    }}
                    highlightedPaths={highlightedPaths}
                    gitStatusByPath={gitStatusByPath}
                    changedDirectoryPaths={changedDirectoryPaths}
                    scrollToPath={scrollToPath}
                    onNodeContextMenu={handleNodeContextMenu}
                    renaming={renaming}
                    onRenameValueChange={handleRenameValueChange}
                    onRenameSubmit={() => void submitRename()}
                    onRenameCancel={cancelRename}
                    creating={creating}
                    onCreateValueChange={handleCreateValueChange}
                    onCreateSubmit={() => void submitCreate()}
                    onCreateCancel={cancelCreate}
                    isMobile={isMobile}
                    t={t}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {!changesCollapsed && gitFiles.length > 0 && (
        <div className="d-tree" style={{ padding: "0 4px 2px" }}>
          {/* fork:v5-skin D-05 帧 D/A —— 改动分组头 = 画板 .d-row（.d-badge + 弱化说明 + 增删行数）。 */}
          <div
            className="d-row"
            aria-label={t("files.changeStats", {
              count: gitFiles.length,
              additions: gitLineStats.additions,
              deletions: gitLineStats.deletions,
            })}
            style={{ padding: "0 var(--nx-sp-1) var(--nx-sp-1)" }}
          >
            <span className="d-badge mute">
              <i data-ico="git-commit-horizontal" data-size="11" aria-hidden="true"></i>
              {gitFiles.length}
            </span>
            <span className="d-t-xs d-t-faint">
              {t("files.changedCount", { count: gitFiles.length })}
            </span>
            <span className="d-grow" />
            <span className="d-mono" style={{ color: GIT_STATUS_COLORS.added }}>+{gitLineStats.additions}</span>
            <span className="d-mono" style={{ color: GIT_STATUS_COLORS.deleted }}>-{gitLineStats.deletions}</span>
          </div>
          {gitFiles.map((status) => (
            <ChangeRow
              key={status.filePath}
              status={status}
              cwd={cwd}
              onOpenFile={onOpenFile}
              onAtMention={onAtMention}
              t={t}
            />
          ))}
        </div>
      )}

      {(changesCollapsed || gitFiles.length === 0) && (!fileSearchOpen || !hasSearchQuery) && (
        <div className="d-tree" style={{ padding: "var(--space-tight) 4px" }}>
          {loading ? (
            <div className="d-t-xs d-t-faint" style={{ padding: "8px 12px" }}>Loading files...</div>
          ) : error ? (
            <div className="d-t-xs" style={{ padding: "8px 12px", color: "var(--nx-danger)" }}>{error}</div>
          ) : (
            roots.map((node) => (
              <TreeNode
                key={node.fullPath}
                node={node}
                depth={0}
                cwd={cwd}
                onOpenFile={onOpenFile}
                onAtMention={onAtMention}
                expandedPaths={expandedPaths}
                onToggleExpanded={handleToggleExpanded}
                refreshToken={refreshToken}
                highlightedPaths={highlightedPaths}
                gitStatusByPath={gitStatusByPath}
                changedDirectoryPaths={changedDirectoryPaths}
                onNodeContextMenu={handleNodeContextMenu}
                renaming={renaming}
                onRenameValueChange={handleRenameValueChange}
                onRenameSubmit={() => void submitRename()}
                onRenameCancel={cancelRename}
                creating={creating}
                onCreateValueChange={handleCreateValueChange}
                onCreateSubmit={() => void submitCreate()}
                onCreateCancel={cancelCreate}
                isMobile={isMobile}
                t={t}
              />
            ))
          )}
          {/* fork:gap08-roots — 项目根分区（仅当会话 cwd 与项目根不同，例如 worktree 会话） */}
          {extraRoots.map((root) => (
            <RootSection
              key={root.path}
              root={root}
              onOpenFile={onOpenFile}
              refreshToken={`${refreshToken}:${extraWatchPulse}`}
              isMobile={isMobile}
              t={t}
            />
          ))}
          {!loading && !error && roots.length === 0 && (
            /* fork:v5-skin D-05 —— 文件树空态 = 画板 .d-empty。 */
            <div className="d-empty compact">
              <div className="d-empty-ico"><i data-ico="folder-search" data-size="16" aria-hidden="true"></i></div>
              <p className="d-empty-s">{t("files.noFiles")}</p>
            </div>
          )}
        </div>
      )}

      {/* fork:v5-landing D-05 帧 A —— 树下面是板面的 `.d-sep` + `.d-pop-foot`：
          一条分隔线 + 一句脚注（改动可以单独忽略、agent 仍能读到全文）。
          role="note" 让脚注与它说明的那棵树在无障碍树上挂在一起。 */}
      <div className="d-sep" />
      <div role="note" className="d-pop-foot">{t("files.treeFootnote")}</div>

      {contextMenu && createPortal(
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 1200 }}
            onClick={closeContextMenu}
            onContextMenu={(event) => { event.preventDefault(); closeContextMenu(); }}
          />
          <div
            role="menu"
            /* fork:v5-skin D-05 —— 菜单壳 = 画板 .d-pop（框、圆角、阴影、底色全来自 system.css）；
               行 = .d-menu-row（图标 + 文字），分组之间是 .d-sep。
               定位值（fixed / left / top / z-index）仍是产品自己的：
               菜单挂在 document.body 上，祖先没有 overflow 裁切问题。 */
            className="d-pop fork-pwa-sb-menu"
            style={{
              position: "fixed",
              left: Math.min(contextMenu.x, (typeof window !== "undefined" ? window.innerWidth : 0) - 230),
              top: Math.min(contextMenu.y, (typeof window !== "undefined" ? window.innerHeight : 0) - 40 - contextMenuItems.length * 30),
              zIndex: 1201,
              width: 230,
            }}
          >
            {contextMenuItems.map((item) => (
              <Fragment key={item.key}>
                {item.sepBefore && <div className="d-sep" />}
                <button
                  type="button"
                  role="menuitem"
                  onClick={item.action}
                  className={`d-menu-row${item.danger ? " danger" : ""}`}
                >
                  <i data-ico={item.icon} data-size="14" aria-hidden="true"></i>
                  {item.label}
                </button>
              </Fragment>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
});
