import { useEffect, useState, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowUp02Icon,
  GitBranchIcon,
  MagicWand02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { IconButton } from "@/components/icon-button";
import { cn } from "@/lib/utils";
import { useGitStatus } from "@/lib/use-git-status";
import { useSidePaneStore } from "@/stores/side-pane";
import type { GitStatus, GitWorktree } from "@shared/ipc";

type BusyAction =
  | "generate"
  | "commit"
  | "commit-push"
  | "pull"
  | "push"
  | "unbind"
  | "worktree-create"
  | "worktree-bind"
  | "worktree-remove";

/**
 * Persistent, lightweight repository status for the conversation header.
 * Detailed file review stays in the right pane; this popover only hosts the
 * small operations that are useful without leaving the conversation.
 */
export function GitStatusPopover({
  cwd,
  conversationId,
  worktree,
  refreshKey,
  canReview = true,
}: {
  cwd?: string;
  conversationId?: string;
  worktree?: { path: string; branch: string };
  refreshKey?: unknown;
  canReview?: boolean;
}): JSX.Element | null {
  const { t } = useTranslation("sidepane");
  const openGit = useSidePaneStore((state) => state.openGit);
  const [open, setOpen] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<GitWorktree[] | null>(null);
  /** The worktree 删除 is armed for, cleared by a second click elsewhere or a timeout. */
  const [armedRemoval, setArmedRemoval] = useState<string | null>(null);
  const status = useGitStatus(cwd, `${String(refreshKey)}:${epoch}`);

  // **Every hook above the early return.** This one used to sit below it, which is a hook
  // count that changes between renders: the first render has no status yet and returns
  // null, the next one has one and reaches the effect — React sees more hooks than last
  // time and replaces the window with error #310. Nothing below here may call a hook.
  // A fresh list every time the popover opens: worktrees move under us — the agent creates
  // them, a branch gets checked out elsewhere, the user removes one in a terminal — so a
  // cached list would offer a path that is no longer a worktree.
  useEffect(() => {
    if (!open || !conversationId) return;
    let cancelled = false;
    setWorktrees(null);
    void window.pinext.conversations
      .listWorktrees(conversationId)
      .then((list) => {
        if (!cancelled) setWorktrees(list);
      })
      .catch(() => {
        if (!cancelled) setWorktrees([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, conversationId, worktree?.path, epoch, refreshKey]);

  if (!status?.isRepository || !status.branch) return null;
  const repository = status;

  const title = t("git.headerStatus", {
    branch: repository.branch,
    additions: repository.additions,
    deletions: repository.deletions,
  });
  const changeSummary = (
    <>
      <span>{status.changed ? t("git.changedCount", { count: status.changed }) : t("git.clean")}</span>
      {status.changed ? (
        <>
          <span className="text-success tabular-nums">+{status.additions}</span>
          <span className="text-destructive tabular-nums">-{status.deletions}</span>
        </>
      ) : null}
      {status.staged ? <span className="ml-auto">{t("git.stagedCount", { count: status.staged })}</span> : null}
      {status.behind ? <span className="tabular-nums">↓{status.behind}</span> : null}
      {status.ahead ? <span className="tabular-nums">↑{status.ahead}</span> : null}
    </>
  );

  function refreshed(_next?: GitStatus): void {
    setEpoch((value) => value + 1);
  }

  async function run(
    action: BusyAction,
    operation: () => Promise<GitStatus>,
    fallback: string,
    done: (next: GitStatus) => string,
  ): Promise<GitStatus | null> {
    if (busy || !cwd) return null;
    setBusy(action);
    setError(null);
    try {
      const next = await operation();
      refreshed(next);
      toast.success(done(next));
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : fallback);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function createWorktree(): Promise<void> {
    if (busy || !conversationId) return;
    setBusy("worktree-create");
    setError(null);
    try {
      // No name asked for: the engine derives the branch and the directory from the
      // conversation's own title, which is the name the reader already has for this work.
      await window.pinext.conversations.createWorktree(conversationId);
      setOpen(false);
      toast.success(t("git.newWorktreeDone"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("git.newWorktreeFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function bindWorktreeAt(path: string): Promise<void> {
    if (busy || !conversationId) return;
    setBusy("worktree-bind");
    setError(null);
    try {
      await window.pinext.conversations.bindWorktree(conversationId, path);
      setOpen(false);
      toast.success(t("git.bindWorktreeDone"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("git.bindWorktreeFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function removeWorktreeAt(path: string): Promise<void> {
    if (busy || !conversationId) return;
    // Two clicks on purpose: `git worktree remove --force` does not ask, and a checkout with
    // uncommitted work in it is exactly what someone would be about to lose. Nothing here
    // can tell whether it is dirty, so the second click is the confirmation.
    if (armedRemoval !== path) {
      setArmedRemoval(path);
      window.setTimeout(() => setArmedRemoval((current) => (current === path ? null : current)), 5000);
      return;
    }
    setArmedRemoval(null);
    setBusy("worktree-remove");
    setError(null);
    try {
      // Unbind first (the bound one cannot be removed under a live session), then delete.
      await window.pinext.conversations.unbindWorktree(conversationId, { remove: true });
      setWorktrees((list) => (list ?? []).filter((item) => item.path !== path));
      toast.success(t("git.removeWorktreeDone"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("git.removeWorktreeFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function unbindWorktree(): Promise<void> {
    if (busy || !conversationId) return;
    setBusy("unbind");
    setError(null);
    try {
      await window.pinext.conversations.unbindWorktree(conversationId);
      setOpen(false);
      toast.success(t("git.unbindWorktreeDone"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("git.unbindWorktreeFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function generateMessage(): Promise<void> {
    if (busy || !cwd) return;
    setBusy("generate");
    setError(null);
    try {
      setMessage(await window.pinext.workspace.gitGenerateCommitMessage(repository.cwd, conversationId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("git.generateFailed"));
    } finally {
      setBusy(null);
    }
  }

  async function commit(push: boolean): Promise<void> {
    const subject = message.trim();
    if (!cwd || busy) return;
    if (!subject) {
      setError(t("git.commitMessageRequired"));
      return;
    }
    const action = push ? "commit-push" : "commit";
    setBusy(action);
    setError(null);
    let committed = false;
    try {
      await window.pinext.workspace.gitStage(repository.cwd, undefined, true);
      refreshed();
      await window.pinext.workspace.gitCommit(repository.cwd, subject);
      committed = true;
      setMessage("");
      refreshed();
      if (push) await window.pinext.workspace.gitPush(repository.cwd);
      refreshed();
      toast.success(t(push ? "git.commitPushDone" : "git.commitDone", { subject }));
    } catch (cause) {
      const detail = cause instanceof Error
        ? cause.message
        : push ? t("git.commitPushFailed") : t("git.commitFailed");
      setError(committed ? t("git.pushAfterCommitFailed", { error: detail }) : detail);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next) {
        setError(null);
        refreshed();
      }
    }}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={title}
            title={title}
            className="h-7 min-w-0 max-w-60 gap-1.5 rounded-md px-1.5 text-xs font-normal text-muted-foreground hover:bg-muted/60 hover:text-foreground aria-expanded:bg-muted/60 aria-expanded:text-foreground"
          />
        }
      >
        <HugeiconsIcon strokeWidth={1.8} icon={GitBranchIcon} className="size-3.5 shrink-0" />
        <span className="hidden min-w-0 truncate font-medium sm:inline">{status.branch}</span>
        {status.changed > 0 ? (
          <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
            <span className="text-success">+{status.additions}</span>
            <span className="text-destructive">-{status.deletions}</span>
          </span>
        ) : (
          <HugeiconsIcon strokeWidth={2} icon={Tick02Icon} className="size-3 shrink-0 text-success" />
        )}
      </PopoverTrigger>

      <PopoverContent align="start" sideOffset={8} className="w-80 gap-0 rounded-xl p-1 shadow-lg">
        <div className="px-2 py-2">
          <div className="flex items-center gap-2">
            <HugeiconsIcon strokeWidth={2} icon={GitBranchIcon} className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={worktree ? `${status.branch} · ${worktree.path}` : status.branch}>{status.branch}</span>
            <div className="flex shrink-0 items-center gap-0.5 rounded-lg bg-muted/50 p-0.5">
              <IconButton
                type="button"
                variant="ghost"
                size="icon-xs"
                label={t("git.pull")}
                disabled={Boolean(busy)}
                onClick={() => void run("pull", () => window.pinext.workspace.gitPull(status.cwd), t("git.pullFailed"), (next) => t("git.pullDone", { branch: next.branch ?? status.branch }))}
              >
                {busy === "pull" ? <Spinner className="size-3.5" /> : <HugeiconsIcon strokeWidth={2} icon={ArrowDown02Icon} />}
              </IconButton>
              <IconButton
                type="button"
                variant="ghost"
                size="icon-xs"
                label={t("git.push")}
                disabled={Boolean(busy)}
                onClick={() => void run("push", () => window.pinext.workspace.gitPush(status.cwd), t("git.pushFailed"), (next) => t("git.pushDone", { branch: next.branch ?? status.branch }))}
              >
                {busy === "push" ? <Spinner className="size-3.5" /> : <HugeiconsIcon strokeWidth={2} icon={ArrowUp02Icon} />}
              </IconButton>
            </div>
          </div>
          {canReview ? (
            <button
              type="button"
              aria-label={t("git.reviewChanges")}
              className="mt-1 flex w-full items-center gap-2 rounded-md py-1 pr-1 pl-5.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              onClick={() => { setOpen(false); openGit(); }}
            >
              {changeSummary}
            </button>
          ) : (
            <div className="mt-1 flex items-center gap-2 py-1 pr-1 pl-5.5 text-xs text-muted-foreground">
              {changeSummary}
            </div>
          )}
          {worktree ? (
            <div className="mt-1 flex items-center gap-2 pl-5.5">
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={worktree.path}>
                {t("git.worktree")}: {worktree.path}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="h-6 shrink-0 px-1.5 text-xs font-normal"
                disabled={Boolean(busy) || !conversationId}
                onClick={() => void unbindWorktree()}
              >
                {busy === "unbind" ? <Spinner className="size-3" /> : null}
                {t("git.unbindWorktree")}
              </Button>
            </div>
          ) : null}
        </div>

        {conversationId && worktrees !== null ? (
          <div className="mt-1 border-t border-border/60 px-2 pt-2">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">{t("git.worktrees")}</span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="h-6 shrink-0 px-1.5 text-xs font-normal"
                disabled={Boolean(busy) || Boolean(worktree)}
                title={worktree ? t("git.newWorktreeBound") : undefined}
                onClick={() => void createWorktree()}
              >
                {busy === "worktree-create" ? <Spinner className="size-3" /> : null}
                {t("git.newWorktree")}
              </Button>
            </div>
            {worktrees.length === 0 ? (
              <p className="py-1 text-xs text-muted-foreground">{t("git.worktreesNone")}</p>
            ) : (
              <div className="max-h-40 overflow-y-auto py-0.5">
                {worktrees.map((item) => (
                  <div key={item.path} className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={Boolean(busy) || item.current}
                      title={item.path}
                      className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-muted/50 disabled:hover:bg-transparent"
                      onClick={() => void bindWorktreeAt(item.path)}
                    >
                      {item.current ? (
                        <HugeiconsIcon strokeWidth={2} icon={Tick02Icon} className="size-3 shrink-0 text-success" />
                      ) : (
                        <HugeiconsIcon strokeWidth={2} icon={GitBranchIcon} className="size-3 shrink-0 text-muted-foreground" />
                      )}
                      <span className={cn("min-w-0 truncate", item.current && "font-medium")}>
                        {item.branch ?? worktreeName(item.path)}
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className={cn("h-6 shrink-0 px-1.5 text-xs font-normal", armedRemoval === item.path && "text-destructive")}
                      disabled={Boolean(busy)}
                      onClick={() => void removeWorktreeAt(item.path)}
                    >
                      {armedRemoval === item.path ? t("git.removeWorktreeConfirm") : t("git.removeWorktree")}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}

        <div className="mt-1 flex items-center gap-2 px-2 pb-2">
          <div className="relative min-w-0 flex-1">
            <Input
              value={message}
              placeholder={t("git.commitMessage")}
              disabled={Boolean(busy)}
              className="h-8 bg-background pr-8 text-sm"
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && message.trim()) void commit(false);
              }}
            />
            <IconButton
              type="button"
              variant="ghost"
              size="icon-xs"
              label={t("git.generateMessage")}
              disabled={Boolean(busy) || !status.changed}
              className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
              onClick={() => void generateMessage()}
            >
              {busy === "generate" ? <Spinner className="size-3.5" /> : <HugeiconsIcon strokeWidth={2} icon={MagicWand02Icon} />}
            </IconButton>
          </div>
          <div className="flex shrink-0 items-center overflow-hidden rounded-lg bg-primary">
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-none pr-0.5 pl-1.5"
              disabled={Boolean(busy)}
              onClick={() => void commit(false)}
            >
              {busy === "commit" ? <Spinner className="size-3.5" /> : null}
              {t("git.commit")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    size="sm"
                    aria-label={t("git.commitOptions")}
                    className="h-8 rounded-none px-1"
                    disabled={Boolean(busy)}
                  />
                }
              >
                <HugeiconsIcon strokeWidth={2} icon={ArrowDown01Icon} className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6} className="w-max min-w-max">
                <DropdownMenuItem className="whitespace-nowrap" onClick={() => void commit(true)}>
                  <HugeiconsIcon strokeWidth={2} icon={ArrowUp02Icon} />
                  {t("git.commitPush")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {error ? <p className="mx-1 mt-1 rounded-md bg-destructive/10 px-2 py-1.5 text-xs leading-5 text-destructive">{error}</p> : null}
      </PopoverContent>
    </Popover>
  );
}

/** The last path segment, for a worktree whose branch cannot be read (a detached head). */
function worktreeName(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}
