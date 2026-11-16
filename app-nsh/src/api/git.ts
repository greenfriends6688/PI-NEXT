// `/api/git/status` and `/api/git/diff`: the changes panel's two reads.
//
// Both routes answer with pi-next 0.0.4's shapes (`lib/git-types.ts`):
//
//   GET /api/git/status?cwd=<absolute>[&refresh=1]
//     { isGitRepository, repositoryRoot, files, additions, deletions,
//       error?, hint? }
//   GET /api/git/diff?cwd=<absolute>&path=<absolute>
//     { supported, status?, patch?, error?, hint? }
//
// `error`/`hint` come back inside a 200 body when Git itself could not be read
// (not merely "not a repository"), so a caller shows them like a message. A
// missing Git binary, a broken Command Line Tools install and a folder that is
// not a checkout are three different states (`lib/git-changes.ts` `getGitStatus`).

import { req, withQuery } from "./client";

/** The six states the server classifies a changed file into (`lib/git-status.ts`). */
export type GitFileStatusKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflict";

/** One changed file. `filePath` is absolute; `path` is not reported. */
export interface GitFileStatus {
  filePath: string;
  status: GitFileStatusKind;
  /** The one-letter badge: M, A, D, R, U (untracked), C (conflict). */
  code: "M" | "A" | "D" | "R" | "U" | "C";
  /** Porcelain v1's two columns (`entry.indexStatus`, `entry.worktreeStatus`). */
  indexStatus: string;
  worktreeStatus: string;
}

/** `GET /api/git/status`. */
export interface GitStatus {
  isGitRepository: boolean;
  repositoryRoot: string | null;
  files: GitFileStatus[];
  /** Additions and deletions of the tracked files under `cwd` (`--numstat HEAD`). */
  additions: number;
  deletions: number;
  /** Git could not be read at all (missing binary, a broken checkout): a message. */
  error?: string;
  /** An actionable suggestion to show with `error` ("brew install git / ..."). */
  hint?: string;
}

/** `GET /api/git/diff`: one file's unified patch. */
export interface GitFileDiff {
  /** The server has a patch for it; false for a binary, or when Git refused. */
  supported: boolean;
  status?: GitFileStatusKind;
  /** Unified diff text (`lib/patch.ts` parses it). */
  patch?: string;
  error?: string;
  hint?: string;
}

export interface GitRequestOptions {
  signal?: AbortSignal;
}

/**
 * The repository's changes under `cwd`. `refresh` (`?refresh=1`) makes the
 * server check PATH for Git again: the retry a user presses after installing it.
 */
export async function getGitStatus(
  cwd: string,
  options: GitRequestOptions & { refresh?: boolean } = {},
): Promise<GitStatus> {
  return req<GitStatus>(withQuery("/api/git/status", {
    cwd,
    refresh: options.refresh ? 1 : undefined,
  }), {}, { signal: options.signal });
}

/** One file's diff; `filePath` is the absolute path `getGitStatus` reported. */
export async function getGitFileDiff(
  cwd: string,
  filePath: string,
  options: GitRequestOptions = {},
): Promise<GitFileDiff> {
  return req<GitFileDiff>(withQuery("/api/git/diff", { cwd, path: filePath }), {}, { signal: options.signal });
}
