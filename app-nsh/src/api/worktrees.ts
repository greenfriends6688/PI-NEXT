// The worktree routes: the project's checkouts and the two ways to change
// them.
//
// Shapes come from `app/api/worktrees/route.ts` (pi-next 0.0.4):
//
//   GET    ?cwd=        { projectRoot, projectKey, isGit, isTopLevel,
//                         currentWorktreePath, worktrees }   (`:18-52`)
//   POST   { cwd, branch } → { path, branch }                 (`:57-96`)
//   DELETE { cwd, path, force? } → { success: true }          (`:99-129`)
//
// A POST of a branch another checkout already has answers 409 with
// `code: "branch_in_use"`, `branch` and `worktreePath`; a branch whose
// worktree folder is gone answers `code: "branch_worktree_missing"` (the same
// fields, `:80-92`). A DELETE git refuses without `--force` answers 409 with
// `dirty: true` (`:123-127`), which the menu turns into a second question.

import { postJson, req, withQuery, type RequestOptions } from "./client";
import { ApiError } from "./client";
import { uiText } from "../ui/errors";

/** One checkout git registered (`lib/worktree.ts:29-33`). */
export interface WorktreeInfo {
  path: string;
  branch: string | null;
  /** The main checkout; it cannot be removed. */
  isMain: boolean;
}

/** `GET /api/worktrees?cwd=` (`app/api/worktrees/route.ts:18-52`). */
export interface WorktreesResponse {
  /** The main repository root shared by every checkout. */
  projectRoot: string;
  /** Stable project identity (the sidebar groups by it). */
  projectKey: string;
  /** False for a folder git does not know: only the project root is listed. */
  isGit: boolean;
  /** False for a repository subdirectory: the switcher is not meaningful. */
  isTopLevel: boolean;
  /** The listed checkout `cwd` is in, or null. */
  currentWorktreePath: string | null;
  worktrees: WorktreeInfo[];
}

/** `POST /api/worktrees` (`app/api/worktrees/route.ts:57-96`). */
export interface CreateWorktreeResponse {
  path: string;
  branch: string;
}

/** `GET /api/worktrees?cwd=`. */
export function listWorktrees(cwd: string, options: RequestOptions = {}): Promise<WorktreesResponse> {
  return req<WorktreesResponse>(withQuery("/api/worktrees", { cwd }), {}, options);
}

/**
 * `POST /api/worktrees { cwd, branch }`. Throws `ApiError` with status 409 for
 * a branch in use (see `worktreeErrorText`, which spells both codes out).
 */
export function createWorktree(
  cwd: string,
  branch: string,
  options: RequestOptions = {},
): Promise<CreateWorktreeResponse> {
  return postJson<CreateWorktreeResponse>("/api/worktrees", { cwd, branch }, options);
}

/**
 * `DELETE /api/worktrees { cwd, path }`. `force` is the second answer to a
 * 409 with `dirty: true` (the checkout has modified or untracked files, or
 * submodules).
 */
export function removeWorktree(
  cwd: string,
  path: string,
  force = false,
  options: RequestOptions = {},
): Promise<{ success: true }> {
  return req<{ success: true }>(
    "/api/worktrees",
    { method: "DELETE", body: JSON.stringify({ cwd, path, ...(force ? { force: true } : {}) }) },
    options,
  );
}

/** The route's `branch_in_use` / `branch_worktree_missing` refusal, readable. */
export function worktreeErrorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    const code = typeof error.body.code === "string" ? error.body.code : "";
    const branch = typeof error.body.branch === "string" ? error.body.branch : "";
    const path = typeof error.body.worktreePath === "string" ? error.body.worktreePath : "";
    if (code === "branch_in_use" && branch) {
      return path
        ? uiText("sidebar.worktreeBranchInUse", { branch, path })
        : uiText("workspace.worktreeBranchInUseNoPath", { branch });
    }
    if (code === "branch_worktree_missing" && branch) {
      return path
        ? uiText("sidebar.worktreeBranchMissing", { branch, path })
        : uiText("workspace.worktreeBranchMissingNoPath", { branch });
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

/** True for a DELETE refusal that asks for a forced removal (`dirty: true`). */
export function worktreeNeedsForce(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.body.dirty === true;
}
