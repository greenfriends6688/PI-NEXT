import { useCallback, useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Cancel01Icon, FileAddIcon, FolderAddIcon, Search01Icon, SourceCodeIcon, ViewIcon } from "@hugeicons/core-free-icons";
import { editableFileText, prefersSourceEditor } from "@shared/editable-preview";
import { IconButton } from "@/components/icon-button";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { copyPath, revealPath } from "@/components/path-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileIcon } from "@/components/file-icon";
import { PreviewSurface, previewText } from "@/components/chat/preview-panel";
import { HighlightedEditor } from "@/components/chat/highlighted-editor";
import { FileBreadcrumb } from "@/components/layout/file-breadcrumb";
import { cn } from "@/lib/utils";
import { SplitHandle, splitStyle, useSplitWidth } from "@/components/layout/split-handle";
import { useSidePaneStore, type SidePaneTab } from "@/stores/side-pane";
import type { DirEntry, FilePreview } from "@shared/types";
import type { FileMutation } from "@shared/file-mutation";

import { createTextAttachment } from "@/lib/attachments";
import { useSessionStore } from "@/stores/session";
import { toast } from "sonner";

type DirMap = Record<string, DirEntry[]>;

function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/** Project-relative path, or null when `path` is the project root or outside it. */
/**
 * Join a child name onto a directory.
 *
 * Slash-aware on purpose: the paths this pane carries are POSIX-flavoured on every platform
 * (`projectRelative` normalises the same way), so `node:path`'s `join` — which uses the host
 * separator — is the wrong tool here.
 */
function joinPath(parent: string, name: string): string {
  return `${parent.replace(/\/+$/, "")}/${name}`;
}

/** The parent of a path, POSIX-style — the paths here are slash-normalised. */
function dirnameOf(path: string): string {
  const cut = path.replace(/\/+$/, "").lastIndexOf("/");
  return cut <= 0 ? "/" : path.slice(0, cut);
}

function projectRelative(cwd: string, path: string): string | null {
  const root = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const file = path.replace(/\\/g, "/");
  const prefix = `${root}/`;
  if (!file.startsWith(prefix)) return null;
  const relative = file.slice(prefix.length);
  return relative === "" ? null : relative;
}

/**
 * The grammar the source editor should colour with.
 *
 * A Markdown or HTML file being edited is still that language — the pane's own rendering
 * of it is the other mode. A diff has no grammar of its own to edit against, so it falls
 * back to plain text rather than colouring it as one.
 */
function editorLanguage(preview: FilePreview): string | undefined {
  if (preview.kind === "code") return preview.language;
  if (preview.kind === "markdown") return "markdown";
  if (preview.kind === "html") return "html";
  return undefined;
}

/** Directories between `cwd` and `filePath` that the tree must expand to reveal the file. */
function ancestorDirs(cwd: string, filePath: string): string[] {
  const root = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  let current = filePath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (current !== root && !current.startsWith(`${root}/`)) return [];
  const dirs: string[] = [];
  while (current.length > root.length) {
    const slash = current.lastIndexOf("/");
    if (slash <= root.length) break;
    current = current.slice(0, slash);
    if (current === root) break;
    dirs.push(current);
  }
  return dirs;
}

/** The editor speaks `\n`. Comparing against the file's CRLF would mark every save dirty. */
function editorNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function withText(preview: FilePreview, text: string): FilePreview {
  if (preview.kind === "code" || preview.kind === "markdown" || preview.kind === "html" || preview.kind === "diff") {
    return { ...preview, text };
  }
  return preview;
}

/**
 * The right pane's project file view. Narrow panes swap between the tree and the
 * open file; when the pane is wide enough the tree stays on the left and the file
 * on the right. Text that is the file itself can be edited and saved; a rendered
 * office document cannot, because writing it back would replace the original.
 */
export function SidePaneFiles({
  tab,
  cwd,
  remote,
  onError,
}: {
  tab: SidePaneTab;
  cwd?: string;
  remote?: boolean;
  onError: (message: string) => void;
}): JSX.Element {
  const { t } = useTranslation("sidepane");
  const patchTab = useSidePaneStore((state) => state.patchTab);
  const [children, setChildren] = useState<DirMap>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /** 树里的过滤词。空 = 原样的树。 */
  const [filter, setFilter] = useState("");
  /** 正在输入的「新增 / 重命名」目标：null = 没有在输入。 */
  const [naming, setNaming] = useState<{ kind: "mkdir" | "touch" | "rename"; parent: string; from?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const split = useSplitWidth("files", 224);
  const preview = tab.preview;
  const previewPath = preview?.path ?? null;
  // A new file picks its own default (source for code, rendered for Markdown).
  // Keeping the previous file's toggle would hide a document the reader just opened.
  const [modeFor, setModeFor] = useState<string | null>(previewPath);
  const [editingPath, setEditingPath] = useState<string | null>(
    preview && prefersSourceEditor(preview) ? preview.path : null,
  );
  if (previewPath !== modeFor) {
    setModeFor(previewPath);
    setEditingPath(preview && previewPath && prefersSourceEditor(preview) ? previewPath : null);
  }
  const openPath = useRef(tab.path);
  openPath.current = tab.path;
  // A file opened from this tree (or its breadcrumb) must not collapse the folders
  // the reader just walked. A preview click from the transcript is the other path.
  const openedHere = useRef<string | null>(null);

  const loadDir = useCallback(async (path: string): Promise<void> => {
    try {
      const entries = await window.pinext.workspace.readDir(path);
      setChildren((prev) => ({ ...prev, [path]: entries }));
    } catch {
      setChildren((prev) => ({ ...prev, [path]: [] }));
    }
  }, []);

  // A project opens collapsed. Previously expanded folders are not brought back:
  // opening a file should not dump the whole tree open.
  const reset = useCallback(
    (path: string | undefined): void => {
      setChildren({});
      setExpanded(new Set());
      if (!path) return;
      void loadDir(path);
    },
    [loadDir],
  );

  useEffect(() => {
    reset(cwd);
  }, [cwd, reset]);

  // A preview click (or a file already on the tab when it mounts) reveals only that
  // file. A click inside this tree sets `openedHere` and leaves the folders as they are.
  useEffect(() => {
    const path = tab.path;
    if (!cwd || !path) return;
    if (openedHere.current === path) {
      openedHere.current = null;
      return;
    }
    const dirs = ancestorDirs(cwd, path);
    setExpanded(new Set(dirs));
    for (const dir of dirs) void loadDir(dir);
  }, [cwd, tab.path, loadDir]);

  function refreshTree(): void {
    if (!cwd) return;
    void loadDir(cwd);
    for (const dir of expanded) void loadDir(dir);
  }

  function toggleDir(path: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!children[path]) void loadDir(path);
  }

  async function openFile(path: string): Promise<void> {
    try {
      const next = await window.pinext.workspace.preview(path);
      openedHere.current = path;
      patchTab(tab.id, { path, preview: next, title: next.name });
      const saved = editableFileText(next);
      if (saved === null) return;
      const baseline = editorNewlines(saved);
      setDrafts((prev) => {
        if (prev[path] === undefined || prev[path] !== baseline) return prev;
        const rest = { ...prev };
        delete rest[path];
        return rest;
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : t("files.previewFailed"));
    }
  }

  /**
   * 树的新增 / 重命名 / 删除。
   *
   * 三条都走 `workspace.mutate`，授权在**引擎**那边（路径必须落在项目或会话的工作目录里）——
   * 前台只负责把用户想要的那件事说清楚，并在他做错时如实报出来。
   */
  async function mutate(mutation: FileMutation): Promise<void> {
    try {
      await window.pinext.workspace.mutate(mutation);
      await refreshTree();
    } catch (error) {
      onError(error instanceof Error ? error.message : t("files.mutateFailed"));
    }
  }

  /** 「新增 / 重命名」输入框提交。名字里出现分隔符就是越界，直接拦下。 */
  async function submitName(name: string): Promise<void> {
    const trimmed = name.trim();
    const pending = naming;
    setNaming(null);
    if (!pending || trimmed.length === 0) return;
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      onError(t("files.nameNoSlash"));
      return;
    }
    if (pending.kind === "rename" && pending.from) {
      await mutate({ kind: "rename", path: pending.from, to: joinPath(pending.parent, trimmed) });
      return;
    }
    if (pending.kind !== "rename") await mutate({ kind: pending.kind, path: joinPath(pending.parent, trimmed) });
  }

  function clearPreview(): void {
    patchTab(tab.id, { path: undefined, preview: undefined });
  }

  function changeDraft(path: string, text: string, baseline: string): void {
    setDrafts((prev) => {
      if (text === baseline) {
        if (!(path in prev)) return prev;
        const rest = { ...prev };
        delete rest[path];
        return rest;
      }
      if (prev[path] === text) return prev;
      return { ...prev, [path]: text };
    });
  }

  async function saveFile(): Promise<void> {
    if (!preview || saving) return;
    const draft = drafts[preview.path];
    if (draft === undefined) return;
    const savedPath = preview.path;
    setSaving(true);
    try {
      await window.pinext.workspace.writeFile(savedPath, draft);
      if (openPath.current === savedPath) patchTab(tab.id, { preview: withText(preview, draft) });
      setDrafts((prev) => {
        if (prev[savedPath] !== draft) return prev;
        const rest = { ...prev };
        delete rest[savedPath];
        return rest;
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : t("files.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (!cwd) {
    if (preview) {
      return (
        <FilePreviewPane
          preview={preview}
          draft={drafts[preview.path]}
          editing={editingPath === preview.path}
          onEdit={(editing) => setEditingPath(editing ? preview.path : null)}
          onDraft={(text, baseline) => changeDraft(preview.path, text, baseline)}
          onSave={() => void saveFile()}
          onBack={clearPreview}
          onOpenFile={(path) => void openFile(path)}
        />
      );
    }
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-8 text-center text-xs leading-5 text-muted-foreground">
        {t("files.unbound")}
      </div>
    );
  }

  const dirty = new Set(Object.keys(drafts));

  return (
    <div className="@container/files flex min-h-0 flex-1 flex-col">
      {/* 预览在左、文件树在右（用户裁定）。`flex-row-reverse` 比搬 DOM 更稳：两个子块的
            顺序、`listSide`、拖拽的符号都不动，只有绘制顺序反过来。窄屏仍是上下两段。 */}
        <div className="flex min-h-0 flex-1 flex-col @min-[32rem]/files:flex-row-reverse">
        <div
          style={splitStyle(split.width)}
          className={cn(
            "min-h-0 flex-col @min-[32rem]/files:w-(--split-w) @min-[32rem]/files:max-w-[75%] @min-[32rem]/files:flex-none",
            preview ? "hidden @min-[32rem]/files:flex" : "flex flex-1",
          )}
        >
          <ContextMenu>
            <ContextMenuTrigger className="flex h-10 w-full shrink-0 items-center gap-1.5 border-b border-border px-2">
              <FileIcon name={baseName(cwd)} kind="folder" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium" title={cwd}>
                {baseName(cwd)}
              </span>
              {/* 新增与搜索都放在标题行右侧：它们作用于**整棵树**，不是某个条目。 */}
              <IconButton
                size="icon-xs"
                variant="ghost"
                label={t("files.newFile")}
                disabled={Boolean(remote)}
                onClick={(event) => {
                  event.stopPropagation();
                  setNaming({ kind: "touch", parent: cwd });
                }}
              >
                <HugeiconsIcon strokeWidth={2} icon={FileAddIcon} />
              </IconButton>
              <IconButton
                size="icon-xs"
                variant="ghost"
                label={t("files.newFolder")}
                disabled={Boolean(remote)}
                onClick={(event) => {
                  event.stopPropagation();
                  setNaming({ kind: "mkdir", parent: cwd });
                }}
              >
                <HugeiconsIcon strokeWidth={2} icon={FolderAddIcon} />
              </IconButton>
              <IconButton
                size="icon-xs"
                variant="ghost"
                label={t("files.search")}
                onClick={(event) => {
                  event.stopPropagation();
                  setFilter((value) => (value ? "" : " "));
                }}
              >
                <HugeiconsIcon strokeWidth={2} icon={Search01Icon} />
              </IconButton>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-44">
              <PathContextItems path={cwd} cwd={cwd} remote={remote} onRefresh={refreshTree} />
            </ContextMenuContent>
          </ContextMenu>
          {filter.trim().length > 0 || filter === " " ? (
            <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border px-2">
              <HugeiconsIcon strokeWidth={2} icon={Search01Icon} className="size-3.5 shrink-0 text-muted-foreground" />
              <Input
                autoFocus
                className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                placeholder={t("files.searchPlaceholder")}
                value={filter.trim()}
                onChange={(event) => setFilter(event.target.value.length > 0 ? event.target.value : " ")}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setFilter("");
                }}
              />
              <IconButton size="icon-xs" variant="ghost" label={t("files.searchClose")} onClick={() => setFilter("")}>
                <HugeiconsIcon strokeWidth={2} icon={Cancel01Icon} />
              </IconButton>
            </div>
          ) : null}
          {naming ? (
            <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-border bg-muted/30 px-2">
              <FileIcon name={naming.kind === "mkdir" ? "folder" : "file"} kind={naming.kind === "mkdir" ? "folder" : "file"} />
              <Input
                autoFocus
                className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                placeholder={naming.kind === "rename" ? t("files.renamePlaceholder") : naming.kind === "mkdir" ? t("files.newFolderPlaceholder") : t("files.newFilePlaceholder")}
                defaultValue={naming.kind === "rename" && naming.from ? baseName(naming.from) : ""}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitName(event.currentTarget.value);
                  if (event.key === "Escape") setNaming(null);
                }}
                onBlur={(event) => void submitName(event.currentTarget.value)}
              />
            </div>
          ) : null}
          <ScrollArea className="h-full min-h-0 flex-1">
            <div className="flex min-h-full flex-col">
              <div className="py-1.5">
                <TreeLevel
                  dir={cwd}
                  depth={0}
                  children={children}
                  expanded={expanded}
                  selected={preview?.path}
                  dirty={dirty}
                  cwd={cwd}
                  remote={remote}
                  filter={filter}
                  onRename={(path) => setNaming({ kind: "rename", parent: dirnameOf(path), from: path })}
                  onDelete={(path) => {
                    // 删除不是可撤销的动作，所以先问一句 —— 目录还会连带里面的东西。
                    void (async () => {
                      const ok = window.confirm(t("files.deleteConfirm", { name: baseName(path) }));
                      if (ok) await mutate({ kind: "delete", path });
                    })();
                  }}
                  onToggle={toggleDir}
                  onOpen={openFile}
                  onRefresh={refreshTree}
                />
              </div>
              {/* Blank space under the list is the project root, same menu as the header. */}
              <ContextMenu>
                <ContextMenuTrigger className="min-h-8 w-full flex-1" />
                <ContextMenuContent className="w-44">
                  <PathContextItems path={cwd} cwd={cwd} remote={remote} onRefresh={refreshTree} />
                </ContextMenuContent>
              </ContextMenu>
            </div>
          </ScrollArea>
        </div>
        {/* 预览在左、文件树在右（用户裁定：0.19.6 把树挪到了左边，他更习惯原来那个）。
            `listSide="end"` 是 SplitHandle 本来就有的那一档 —— 拖宽的仍是「列表那一列」。 */}
        {preview ? (
          <FilePreviewPane
            preview={preview}
            draft={drafts[preview.path]}
            editing={editingPath === preview.path}
            root={cwd}
            onEdit={(editing) => setEditingPath(editing ? preview.path : null)}
            onDraft={(text, baseline) => changeDraft(preview.path, text, baseline)}
            onSave={() => void saveFile()}
            onBack={clearPreview}
            onOpenFile={(path) => void openFile(path)}
            backClassName="@min-[32rem]/files:hidden"
          />
        ) : (
          <div className="hidden min-h-0 min-w-0 flex-1 items-center justify-center px-8 text-center text-xs leading-5 text-muted-foreground @min-[32rem]/files:flex">
            {t("files.pick")}
          </div>
        )}
        <SplitHandle listSide="end" label={t("files.resize")} className="hidden @min-[32rem]/files:block" {...split} />
      </div>
    </div>
  );
}

function FilePreviewPane({
  preview,
  draft,
  editing,
  root,
  onEdit,
  onDraft,
  onSave,
  onBack,
  onOpenFile,
  backClassName,
}: {
  preview: FilePreview;
  draft?: string;
  editing: boolean;
  /** The project directory, so the breadcrumb can drop everything above it. */
  root?: string;
  onEdit: (editing: boolean) => void;
  onDraft: (text: string, baseline: string) => void;
  onSave: () => void;
  onBack: () => void;
  /** A crumb popover opened another file. */
  onOpenFile: (path: string) => void;
  backClassName?: string;
}): JSX.Element {
  const { t } = useTranslation("sidepane");
  const saved = editableFileText(preview);
  const baseline = saved === null ? undefined : editorNewlines(saved);
  const editable = baseline !== undefined;
  const value = draft ?? baseline ?? "";
  const dirty = draft !== undefined && draft !== baseline;
  const shown = draft !== undefined && saved !== null ? withText(preview, draft) : preview;
  const text = previewText(shown);
  const source = editing && editable;

  function attachSelection(code: string): void {
    const store = useSessionStore.getState();
    if (!store.activeId) return;
    store.setComposer(store.draft, [...store.attachments, createTextAttachment(code, preview.name)]);
    toast.success(t("files.attached"));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
    event.preventDefault();
    if (dirty) onSave();
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" onKeyDown={onKeyDown}>
      <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2">
        <IconButton
          size="icon-xs"
          variant="ghost"
          label={t("files.back")}
          className={backClassName}
          onClick={onBack}
        >
          <HugeiconsIcon strokeWidth={2} icon={ArrowLeft01Icon} />
        </IconButton>
        {/* The path leads the header: the tree beside it is for browsing, and this says
            where the file on screen actually is — and is how a reader moves between
            folders once one is open. */}
        <FileBreadcrumb
          filePath={preview.path}
          root={root}
          onOpenFile={onOpenFile}
        />
        {dirty ? <span className="size-1.5 shrink-0 rounded-full bg-warning" title={t("files.unsaved")} /> : null}
        {/* The source toggle is the only control left. It keeps its own width so the
            path can use the rest of the row. */}
        <div className="flex shrink-0 items-center gap-1.5">
          {editable ? (
            // The one control the viewer keeps, at the end of the row: it names what the
            // click will show — a `</>` while the document is rendered, an eye while the
            // source is. Saving is ⌘S; a button for it is a second way to do what the
            // keyboard already does.
            <IconButton
              size="icon-xs"
              variant="ghost"
              aria-pressed={source}
              label={source ? t("files.previewMode") : t("files.viewSource")}
              onClick={() => onEdit(!source)}
            >
              <HugeiconsIcon strokeWidth={2} icon={source ? ViewIcon : SourceCodeIcon} />
            </IconButton>
          ) : null}
        </div>
      </div>
      {source && baseline !== undefined ? (
        <HighlightedEditor
          value={value}
          language={editorLanguage(preview)}
          wrap={preview.kind === "markdown" || preview.kind === "html"}
          label={preview.name}
          onChange={(text) => onDraft(text, baseline)}
        />
      ) : (
        <PreviewSurface
          preview={shown}
          document
          onAttachToContext={text !== undefined ? attachSelection : undefined}
        />
      )}
    </div>
  );
}

function TreeLevel({
  dir,
  depth,
  children,
  expanded,
  selected,
  dirty,
  cwd,
  remote,
  onToggle,
  onOpen,
  onRefresh,
  filter,
  onRename,
  onDelete,
}: {
  dir: string;
  depth: number;
  children: DirMap;
  expanded: Set<string>;
  selected?: string;
  dirty: Set<string>;
  cwd: string;
  remote?: boolean;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
  onRefresh: () => void;
  /** 过滤词；空 = 原样。命中的目录整棵保留，其余按名字筛。 */
  filter?: string;
  onRename?: (path: string) => void;
  onDelete?: (path: string) => void;
}): JSX.Element {
  const { t } = useTranslation("sidepane");
  const needle = (filter ?? "").trim().toLowerCase();
  const entries = (children[dir] ?? []).filter((entry) =>
    // 目录始终保留：命中可能在它下面，而树是懒加载的 —— 按名字砍掉目录会让搜索结果
    // 取决于哪些目录恰好被展开过。
    needle.length === 0 || entry.kind === "directory" || entry.name.toLowerCase().includes(needle),
  );
  return (
    <>
      {entries.map((entry) => {
        const isDir = entry.kind === "directory";
        const open = isDir && expanded.has(entry.path);
        const active = !isDir && selected === entry.path;
        const unsaved = !isDir && dirty.has(entry.path);
        return (
          <div key={entry.path}>
            {/* An indent guide per level. The line is drawn on the trailing edge of the
                indent slot so it passes through the parent folder icon, not to its left. */}
            <ContextMenu>
              <ContextMenuTrigger className="block w-full">
                <button
                  type="button"
                  aria-current={active ? "true" : undefined}
                  className={cn("chat-tree-row", active && "is-active")}
                  title={entry.path}
                  onClick={() => (isDir ? onToggle(entry.path) : onOpen(entry.path))}
                >
                  <span aria-hidden className="chat-tree-guides">
                    {Array.from({ length: depth }, (_, level) => (
                      <span key={level} />
                    ))}
                  </span>
                  <FileIcon name={entry.name} kind={isDir ? "folder" : "file"} expanded={open} />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                  {unsaved ? (
                    <span className="size-1.5 shrink-0 rounded-full bg-warning" title={t("files.unsaved")} />
                  ) : null}
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-44">
                <PathContextItems
                  path={entry.path}
                  cwd={cwd}
                  remote={remote}
                  onOpen={isDir ? undefined : () => onOpen(entry.path)}
                  onRefresh={onRefresh}
                  onRename={onRename ? () => onRename(entry.path) : undefined}
                  onDelete={onDelete ? () => onDelete(entry.path) : undefined}
                />
              </ContextMenuContent>
            </ContextMenu>
            {open ? (
              <TreeLevel
                dir={entry.path}
                depth={depth + 1}
                children={children}
                expanded={expanded}
                selected={selected}
                filter={filter}
                onRename={onRename}
                onDelete={onDelete}
                dirty={dirty}
                cwd={cwd}
                remote={remote}
                onToggle={onToggle}
                onOpen={onOpen}
                onRefresh={onRefresh}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

/** Right-click actions for a tree row, the project header, or the empty list. */
function PathContextItems({
  path,
  cwd,
  remote,
  onOpen,
  onRefresh,
  onRename,
  onDelete,
}: {
  path: string;
  cwd: string;
  remote?: boolean;
  onOpen?: () => void;
  onRefresh: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}): JSX.Element {
  const { t } = useTranslation("sidepane");
  const relative = projectRelative(cwd, path);
  return (
    <>
      {onOpen ? <ContextMenuItem onClick={onOpen}>{t("files.open")}</ContextMenuItem> : null}
      {remote ? null : (
        <ContextMenuItem onClick={() => void revealPath(path, t("files.notFound"))}>
          {t("files.reveal")}
        </ContextMenuItem>
      )}
      <ContextMenuItem onClick={() => void copyPath(path, t("files.pathCopied"))}>
        {t("files.copyPath")}
      </ContextMenuItem>
      {relative ? (
        <ContextMenuItem onClick={() => void copyPath(relative, t("files.pathCopied"))}>
          {t("files.copyRelativePath")}
        </ContextMenuItem>
      ) : null}
      {onRename || onDelete ? <ContextMenuSeparator /> : null}
      {onRename ? <ContextMenuItem onClick={onRename}>{t("files.rename")}</ContextMenuItem> : null}
      {onDelete ? (
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          {t("files.delete")}
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onRefresh}>{t("files.refresh")}</ContextMenuItem>
    </>
  );
}
