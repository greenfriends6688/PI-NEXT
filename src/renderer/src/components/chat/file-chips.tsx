import { useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowRight01Icon, FileEditIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { collectChangedFiles, type ChangedFile } from "@/lib/changed-files";
import { DiffStatBadge } from "@/components/chat/diff-stat";
import { useSidePaneStore } from "@/stores/side-pane";
import { useSessionStore, useWorkspacePath } from "@/stores/session";
import { displayProjectPath, projectFolderPaths } from "@shared/project-folders";
import { displayPath, resolvePath } from "@/lib/workspace-path";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export type { ChangedFile };
export { collectChangedFiles };

function fileLabel(path: string, cwd?: string): string {
  const { conversations, projects, activeId } = useSessionStore.getState();
  const bound = conversations.find((item) => item.id === activeId)?.project;
  const project = projects.find((item) => item.cwd === bound);
  const folders = project ? projectFolderPaths(project) : [];
  const shown = folders.length > 1 ? displayProjectPath(path, cwd, folders) : displayPath(path, cwd);
  return shown.replace(/\\/g, "/");
}

/** Split a label so the directory ellipsizes and the file name stays whole. */
function splitLabel(label: string): { dir: string; base: string } {
  const slash = label.lastIndexOf("/");
  return slash >= 0
    ? { dir: label.slice(0, slash + 1), base: label.slice(slash + 1) }
    : { dir: "", base: label };
}

/**
 * The absolute path a chip's rows act on.
 *
 * Tool arguments are often project-relative, and Main's preview/reveal `stat` the string
 * as given, so a relative path would miss the file the file tree can still open.
 */
function absolutePath(file: ChangedFile): string {
  const { conversations, activeId } = useSessionStore.getState();
  return resolvePath(file.path, conversations.find((item) => item.id === activeId)?.cwd);
}

function FileRow({
  file,
  cwd,
  onOpen,
}: {
  file: ChangedFile;
  cwd?: string;
  onOpen: (file: ChangedFile) => void;
}): JSX.Element {
  const { t } = useTranslation("chat");
  const label = fileLabel(file.path, cwd);
  const { dir, base } = splitLabel(label);
  const reveal = async (): Promise<void> => {
    const result = await window.pinext.workspace.reveal(absolutePath(file));
    if (result && result.ok === false) toast.error(t("preview.pathMissing"));
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            type="button"
            title={file.path}
            onClick={() => onOpen(file)}
            className="flex w-full items-center gap-3 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted"
          />
        }
      >
        {/* The directory ellipsizes; the file name never does. Truncating the whole
            path hid the one thing the row exists to name. */}
        <span className="flex min-w-0 flex-1 items-baseline text-sm text-foreground">
          {dir ? <span className="min-w-0 truncate text-muted-foreground">{dir}</span> : null}
          <span className="shrink-0">{base}</span>
        </span>
        <DiffStatBadge added={file.added} removed={file.removed} />
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={() => void useSessionStore.getState().openPreview(absolutePath(file))}>
          {t("preview.pathPreview")}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void reveal()}>{t("preview.pathReveal")}</ContextMenuItem>
        <ContextMenuItem onClick={() => void navigator.clipboard?.writeText(absolutePath(file))}>
          {t("preview.pathCopy")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * One turn's writes, as the Codex card: a header naming how many files changed
 * and the line totals, with the paths underneath.
 *
 * Two ways in, and they are different questions:
 *
 * - **审查** opens the turn's own diff (not the working tree's): what changed this turn,
 *   which is what reviewing a reply is about.
 * - Clicking a path opens that file in the right pane. The list is the other answer, and
 *   it is already on screen — a button beside it that opened the *project's* file tree was
 *   answering a question nobody had asked about the turn.
 *
 * Clicking a path does the first — the list names files, so a click on one should show
 * that file. It used to open the diff, which meant the card had no way to read a file.
 */
export function TurnFileChips({ files, className }: { files: ChangedFile[]; className?: string }): JSX.Element | null {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(true);
  const cwd = useWorkspacePath();
  const openTurnChanges = useSidePaneStore((state) => state.openTurnChanges);
  if (files.length === 0) return null;
  const added = files.reduce((sum, file) => sum + file.added, 0);
  const removed = files.reduce((sum, file) => sum + file.removed, 0);
  const review = (): void => openTurnChanges(files, files[0].path);
  const openContent = (file: ChangedFile): void => void useSessionStore.getState().openPreview(absolutePath(file));
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("w-full overflow-hidden rounded-xl border border-border bg-muted/40", className)}
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <CollapsibleTrigger
          className={cn(
            "flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-md text-left",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <HugeiconsIcon strokeWidth={2} icon={FileEditIcon} className="size-4" />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-1 text-sm font-medium text-foreground">
              <span className="truncate">{t("files.edited", { count: files.length })}</span>
              <HugeiconsIcon
                strokeWidth={2}
                aria-hidden
                icon={ArrowRight01Icon}
                className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-90")}
              />
            </span>
            <DiffStatBadge added={added} removed={removed} />
          </span>
        </CollapsibleTrigger>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Only 审查. A 「文件」 button sat here and opened the project's file tree, which is
              not what a card counting *this turn's* changed files is about — the paths below
              are already the list, and each one opens its own file. */}
          <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={review}>
            {t("files.review")}
          </Button>
        </div>
      </div>
      <CollapsibleContent>
        <div className="max-h-60 overflow-y-auto px-1.5 pb-1.5">
          {files.map((file) => (
            <FileRow key={file.path} file={file} cwd={cwd} onOpen={openContent} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
