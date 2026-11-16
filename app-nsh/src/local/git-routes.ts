// `/api/git/**`, `/api/cwd/**`, `/api/home`, `/api/default-cwd` and
// `/api/worktrees`: the changes panel, the folder picker and the project
// checkouts, read from this window's own filesystem and `git`.
//
// Shapes come from pi-web's routes (`app/api/git/*`, `app/api/cwd/*`,
// `app/api/home`, `app/api/default-cwd`, `app/api/worktrees`) and its
// `lib/git-changes.ts`, `lib/worktree.ts`, `lib/directory-browser.ts` and
// `lib/default-cwd.ts`. Only native Git is used: the isomorphic-git fallback
// would be a Node dependency this window does not carry.
import { exists, lstat, mkdir, readFile, readdir, stat } from "fs/promises";
import path from "path";
import { platform, spawn } from "process";
import { runAsync as run } from "./run-async";
import { TEXT_PREVIEW_MAX_BYTES } from "../lib/file-types";
import {
  describe,
  errorResponse,
  homeDirectory,
  jsonResponse,
  type LocalRequest,
  type LocalResponse,
} from "./request";
import {
  authorizePath,
  hasParentDirectorySegment,
  isAbsolutePath,
  resolveExistingPath,
} from "./file-routes";

const GIT_TIMEOUT_MS = 10_000;
const WORKTREE_TIMEOUT_MS = 5 * 60_000;
const GIT_HINT = "brew install git / xcode-select --install";
const PATCH_MAX_CHARS = TEXT_PREVIEW_MAX_BYTES * 4;

type GitFileStatusKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflict";

interface GitFileStatus {
  filePath: string;
  status: GitFileStatusKind;
  code: "M" | "A" | "D" | "R" | "U" | "C";
  indexStatus: string;
  worktreeStatus: string;
}

interface GitStatusResponse {
  isGitRepository: boolean;
  repositoryRoot: string | null;
  files: GitFileStatus[];
  additions: number;
  deletions: number;
  error?: string;
  hint?: string;
}

interface GitFileDiffResponse {
  supported: boolean;
  status?: GitFileStatusKind;
  patch?: string;
  error?: string;
  hint?: string;
}

interface GitPorcelainEntry {
  path: string;
  originalPath?: string;
  indexStatus: string;
  worktreeStatus: string;
}

interface GitRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

class GitFailure extends Error {
  readonly stderr: string;

  constructor(message: string, stderr = "") {
    super(message);
    this.name = "GitFailure";
    this.stderr = stderr;
  }
}

function failureText(result: GitRunResult): string {
  const stderr = result.stderr.trim();
  if (stderr) return stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(" ");
  return `git exited with code ${result.code ?? "?"}`;
}

function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function gitRun(cwd: string, args: readonly string[], timeoutMs = GIT_TIMEOUT_MS): Promise<GitRunResult> {
  try {
    const result = await run("git", ["-C", cwd, ...args], { cwd: homeDirectory(), timeoutMs });
    return { code: result.code ?? null, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    throw new GitFailure(describe(error));
  }
}

async function gitText(cwd: string, args: readonly string[], timeoutMs = GIT_TIMEOUT_MS): Promise<string> {
  const result = await gitRun(cwd, args, timeoutMs);
  if (result.code !== 0) throw new GitFailure(failureText(result), result.stderr);
  return result.stdout;
}

function isNotRepositoryError(error: unknown): boolean {
  return /not a git repository/i.test(errorText(error));
}

function isMissingHeadError(error: unknown): boolean {
  return /ambiguous argument 'HEAD'|unknown revision|bad revision|needed a single revision/i.test(errorText(error));
}

function parseGitPorcelainV1(output: string): GitPorcelainEntry[] {
  const records = output.split("\0");
  const entries: GitPorcelainEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record || record.length < 4 || record[2] !== " ") continue;
    const indexStatus = record[0];
    const worktreeStatus = record[1];
    const entry: GitPorcelainEntry = {
      path: record.slice(3),
      indexStatus,
      worktreeStatus,
    };
    if (indexStatus === "R" || indexStatus === "C" || worktreeStatus === "R" || worktreeStatus === "C") {
      entry.originalPath = records[++index] || undefined;
    }
    entries.push(entry);
  }
  return entries;
}

const CONFLICT_STATUSES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

function classifyGitStatus(entry: GitPorcelainEntry): Pick<GitFileStatus, "status" | "code"> {
  const pair = `${entry.indexStatus}${entry.worktreeStatus}`;
  if (pair === "??") return { status: "untracked", code: "U" };
  if (CONFLICT_STATUSES.has(pair) || pair.includes("U")) return { status: "conflict", code: "C" };
  if (pair.includes("D")) return { status: "deleted", code: "D" };
  if (pair.includes("R") || pair.includes("C")) return { status: "renamed", code: "R" };
  if (pair.includes("A")) return { status: "added", code: "A" };
  return { status: "modified", code: "M" };
}

function relativeFrom(from: string, to: string): string {
  return (path.relative as (from: string, to: string) => string)(from, to);
}

function isWithinPath(parent: string, target: string): boolean {
  const relative = relativeFrom(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function toNativePath(filePath: string): string {
  if (!filePath || platform !== "windows") return filePath;
  return path.normalize(filePath);
}

function samePath(left: string, right: string): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const normalize = (value: string): string => {
    const normalized = path.normalize(value);
    const rootLength = path.parse(normalized).root.length;
    let end = normalized.length;
    while (end > rootLength && normalized[end - 1] === path.sep) end -= 1;
    return normalized.slice(0, end);
  };
  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  return platform === "windows"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

async function realPathOrSelf(filePath: string): Promise<string> {
  try {
    return await resolveExistingPath(filePath);
  } catch {
    return filePath;
  }
}

/** The main repo root from a repository's common git dir. */
async function repoRootFromCommonDir(commonDir: string): Promise<string> {
  const parent = path.dirname(commonDir);
  if (path.basename(commonDir) === ".git") return parent;
  try {
    const text = await readFile(path.join(parent, ".git"), "utf8");
    const match = /^gitdir:\s*(.+?)\s*$/m.exec(text);
    if (match && samePath(await realPathOrSelf(path.resolve(parent, match[1])), await realPathOrSelf(commonDir))) {
      return parent;
    }
  } catch {
    // No `.git` file beside it; the common dir is the project root itself.
  }
  return commonDir;
}

async function findRepositoryRoot(cwd: string): Promise<string | null> {
  const result = await gitRun(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.code !== 0) {
    const text = failureText(result);
    if (/not a git repository/i.test(text)) return null;
    throw new GitFailure(text, result.stderr);
  }
  return result.stdout.trim() || null;
}

async function readStatusEntries(
  repositoryRoot: string,
  gitConfig: readonly string[] = [],
): Promise<GitPorcelainEntry[]> {
  const output = await gitText(repositoryRoot, [
    ...gitConfig,
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return parseGitPorcelainV1(output);
}

async function readTrackedLineStats(
  repositoryRoot: string,
  cwd: string,
): Promise<{ additions: number; deletions: number }> {
  const relativeCwd = toGitPath(relativeFrom(repositoryRoot, cwd));
  const pathspec = relativeCwd || ".";
  try {
    const output = await gitText(repositoryRoot, [
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--numstat",
      "HEAD",
      "--",
      pathspec,
    ]);
    let additions = 0;
    let deletions = 0;
    for (const line of output.split(/\r?\n/)) {
      if (!line) continue;
      const [added, deleted] = line.split("\t", 2);
      const addedCount = Number(added);
      const deletedCount = Number(deleted);
      if (Number.isInteger(addedCount)) additions += addedCount;
      if (Number.isInteger(deletedCount)) deletions += deletedCount;
    }
    return { additions, deletions };
  } catch (error) {
    // A repository with no commits has no HEAD; its files are all untracked.
    if (isMissingHeadError(error)) return { additions: 0, deletions: 0 };
    throw error;
  }
}

function hasNullByte(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (byte === 0) return true;
  }
  return false;
}

async function countUntrackedTextLines(filePath: string): Promise<number> {
  try {
    const info = await lstat(filePath);
    if (!info.isFile() || info.size > TEXT_PREVIEW_MAX_BYTES) return 0;
    const bytes = await readFile(filePath);
    if (hasNullByte(bytes) || bytes.length === 0) return 0;
    const text = new TextDecoder().decode(bytes);
    return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
  } catch {
    return 0;
  }
}

function emptyStatus(): GitStatusResponse {
  return {
    isGitRepository: false,
    repositoryRoot: null,
    files: [],
    additions: 0,
    deletions: 0,
  };
}

async function getGitStatus(cwd: string): Promise<GitStatusResponse> {
  try {
    const repositoryRoot = await findRepositoryRoot(cwd);
    if (!repositoryRoot) return emptyStatus();

    // Git names the repository by its real path; report each file under the cwd
    // as given, the way the file tree lists it.
    const realRoot = await resolveExistingPath(repositoryRoot);
    const realCwd = await resolveExistingPath(cwd);
    const [entries, trackedLineStats] = await Promise.all([
      readStatusEntries(repositoryRoot),
      readTrackedLineStats(realRoot, realCwd),
    ]);

    const files: GitFileStatus[] = [];
    for (const entry of entries) {
      const realFilePath = path.resolve(realRoot, entry.path);
      if (!isWithinPath(realCwd, realFilePath)) continue;
      files.push({
        filePath: path.join(cwd, relativeFrom(realCwd, realFilePath)),
        ...classifyGitStatus(entry),
        indexStatus: entry.indexStatus,
        worktreeStatus: entry.worktreeStatus,
      });
    }

    // Counting an untracked file's lines reads it. This checkout has thousands
    // of them (the copied subtrees), which took longer than the pane waits, so
    // the number comes from the first hundred and the rest count zero — they
    // still appear in the list, and `--numstat HEAD` covers everything tracked.
    let untrackedAdditions = 0;
    let untrackedBudget = 100;
    for (const file of files) {
      if (file.status !== "untracked" || untrackedBudget <= 0) continue;
      untrackedBudget -= 1;
      untrackedAdditions += await countUntrackedTextLines(file.filePath);
    }

    return {
      isGitRepository: true,
      repositoryRoot,
      files,
      additions: trackedLineStats.additions + untrackedAdditions,
      deletions: trackedLineStats.deletions,
    };
  } catch (error) {
    return {
      ...emptyStatus(),
      error: `无法读取 Git 状态：${errorText(error)}`,
      hint: GIT_HINT,
    };
  }
}

function createAddedFilePatch(gitPath: string, content: string): string {
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasTrailingNewline) lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const noNewlineMarker = !hasTrailingNewline && lines.length > 0
    ? "\n\\ No newline at end of file"
    : "";
  return [
    `diff --git a/${gitPath} b/${gitPath}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${gitPath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    `${body}${noNewlineMarker}`,
  ].join("\n");
}

async function createTrackedFilePatch(
  repositoryRoot: string,
  relativePath: string,
  originalPath?: string,
  gitConfig: readonly string[] = [],
): Promise<string | null> {
  const paths = originalPath && originalPath !== relativePath
    ? [originalPath, relativePath]
    : [relativePath];
  try {
    const patch = await gitText(repositoryRoot, [
      ...gitConfig,
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--unified=3",
      "HEAD",
      "--",
      ...paths,
    ]);
    return patch.length > PATCH_MAX_CHARS ? null : patch;
  } catch {
    return null;
  }
}

// The file's own repository, not the cwd's: a session may start in a plain
// folder holding several repositories. A deleted file's folder may be gone too.
async function findFileRepositoryRoot(cwd: string, filePath: string): Promise<string | null> {
  let directory = path.dirname(path.resolve(filePath));
  while (!(await exists(directory))) {
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return (await findRepositoryRoot(directory)) ?? (await findRepositoryRoot(cwd));
}

async function getGitFileDiff(cwd: string, filePath: string): Promise<GitFileDiffResponse> {
  try {
    const repositoryRoot = await findFileRepositoryRoot(cwd, filePath);
    if (!repositoryRoot) return { supported: false };

    const realRoot = await resolveExistingPath(repositoryRoot);
    const realFilePath = await resolveExistingPath(filePath);
    if (!isWithinPath(realRoot, realFilePath)) return { supported: false };
    // Opening a file in another checkout must not run its fsmonitor hook.
    const gitConfig = isWithinPath(realRoot, await resolveExistingPath(cwd))
      ? []
      : ["-c", "core.fsmonitor=false"];

    const resolvedFilePath = path.resolve(filePath);
    const relativePath = toGitPath(relativeFrom(realRoot, realFilePath));
    const entries = await readStatusEntries(repositoryRoot, gitConfig);
    const entry = entries.find((candidate) => candidate.path === relativePath);
    if (!entry) return { supported: false };

    const { status } = classifyGitStatus(entry);
    if (status === "deleted") {
      const patch = await createTrackedFilePatch(repositoryRoot, relativePath, entry.originalPath, gitConfig);
      if (!patch?.includes("\n@@ ")) return { supported: false };
      return { supported: true, status, patch };
    }

    let info;
    try {
      info = await lstat(resolvedFilePath);
    } catch {
      return { supported: false };
    }
    if (!info.isFile() || info.size > TEXT_PREVIEW_MAX_BYTES) return { supported: false };

    const currentBuffer = await readFile(resolvedFilePath);
    if (hasNullByte(currentBuffer)) return { supported: false };
    const newContent = new TextDecoder().decode(currentBuffer);

    let patch: string;
    if (status === "untracked") {
      patch = createAddedFilePatch(relativePath, newContent);
    } else {
      const trackedPatch = await createTrackedFilePatch(repositoryRoot, relativePath, entry.originalPath, gitConfig);
      if (trackedPatch === null) {
        if (status !== "added") return { supported: false };
        patch = createAddedFilePatch(relativePath, newContent);
      } else {
        patch = trackedPatch;
      }
    }

    if (!patch.includes("\n@@ ")) return { supported: false };
    return { supported: true, status, patch };
  } catch (error) {
    return {
      supported: false,
      error: `无法读取 Git 差异：${errorText(error)}`,
      hint: GIT_HINT,
    };
  }
}

// ---------------------------------------------------------------- projects
interface ProjectInfo {
  projectRoot: string;
  branch: string | null;
  isWorktree: boolean;
  isTopLevel: boolean;
}

function inferRemovedWorktree(cwd: string): ProjectInfo | null {
  const parent = path.dirname(cwd);
  if (!parent.endsWith("-worktrees")) return null;
  const repoRoot = parent.slice(0, -"-worktrees".length);
  if (!repoRoot) return null;
  return { projectRoot: repoRoot, branch: path.basename(cwd), isWorktree: true, isTopLevel: true };
}

async function isRepositoryFolder(candidate: string): Promise<boolean> {
  if (await exists(path.join(candidate, ".git"))) return true;
  // A bare clone has no `.git`; git takes HEAD, objects/ and refs/ for a git dir.
  for (const name of ["HEAD", "objects", "refs"]) {
    if (!(await exists(path.join(candidate, name)))) return false;
  }
  return true;
}

async function resolveProject(cwd: string): Promise<ProjectInfo> {
  try {
    if (!(await exists(cwd))) {
      const inferred = inferRemovedWorktree(cwd);
      if (inferred && (await isRepositoryFolder(inferred.projectRoot))) {
        inferred.projectRoot = await realPathOrSelf(inferred.projectRoot);
        return inferred;
      }
      return { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
    }

    const output = await gitText(cwd, [
      "rev-parse", "--path-format=absolute",
      "--git-common-dir", "--git-dir", "--show-toplevel",
      "--abbrev-ref", "HEAD",
    ]);
    const [commonDirRaw, gitDirRaw, toplevelRaw, ref] = output.split("\n").map((line) => line.trim());
    const commonDir = toNativePath(commonDirRaw ?? "");
    const gitDir = toNativePath(gitDirRaw ?? "");
    const toplevel = toNativePath(toplevelRaw ?? "");
    const realCwd = await realPathOrSelf(cwd);
    const isTopLevel = samePath(toplevel, realCwd);
    const isWorktreeTopLevel = !samePath(gitDir, commonDir) && isTopLevel;
    const topLevelProjectRoot = isWorktreeTopLevel
      ? await repoRootFromCommonDir(commonDir)
      : toplevel;
    return {
      projectRoot: isTopLevel ? await realPathOrSelf(topLevelProjectRoot) : cwd,
      branch: ref && ref !== "HEAD" ? ref : null,
      isWorktree: isWorktreeTopLevel,
      isTopLevel,
    };
  } catch {
    return { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
  }
}

function projectIdentityKey(projectRoot: string): string {
  if (!projectRoot) return projectRoot;
  const normalized = path.normalize(projectRoot);
  const rootLength = path.parse(normalized).root.length;
  let end = normalized.length;
  while (end > rootLength && normalized[end - 1] === path.sep) end -= 1;
  const withoutTrailingSeparators = normalized.slice(0, end);
  return platform === "windows" ? withoutTrailingSeparators.toLowerCase() : withoutTrailingSeparators;
}

// --------------------------------------------------------------- worktrees
interface WorktreeInfo {
  path: string;
  branch: string | null;
  isMain: boolean;
}

async function getRepoRoot(cwd: string): Promise<string> {
  const commonDir = await gitText(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return realPathOrSelf(await repoRootFromCommonDir(toNativePath(commonDir.trim())));
}

async function listRegisteredWorktrees(cwd: string): Promise<Array<{ path: string; branch: string | null; missing: boolean }>> {
  const output = await gitText(cwd, ["worktree", "list", "--porcelain"]);
  const records: Array<{ path?: string; branch?: string; prunable?: boolean }> = [];
  let current: { path?: string; branch?: string; prunable?: boolean } | null = null;
  const flush = (): void => {
    if (current?.path) records.push(current);
    current = null;
  };
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: toNativePath(line.slice("worktree ".length).trim()) };
    } else if (line.startsWith("branch ") && current) {
      current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
    } else if (line.startsWith("prunable") && current) {
      current.prunable = true;
    } else if (line.trim() === "") {
      flush();
    }
  }
  flush();

  const worktrees: Array<{ path: string; branch: string | null; missing: boolean }> = [];
  for (const record of records) {
    if (!record.path) continue;
    worktrees.push({
      path: record.path,
      branch: record.branch ?? null,
      missing: record.prunable === true || !(await exists(record.path)),
    });
  }
  return worktrees;
}

async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  return (await listRegisteredWorktrees(cwd))
    .filter((worktree) => !worktree.missing)
    .map(({ path: worktreePath, branch }, index) => ({ path: worktreePath, branch, isMain: index === 0 }));
}

function findWorktreeByPath(worktrees: readonly WorktreeInfo[], candidate: string): WorktreeInfo | undefined {
  return worktrees.find((worktree) => samePath(worktree.path, candidate));
}

async function findCurrentWorktreePath(worktrees: readonly WorktreeInfo[], cwd: string): Promise<string | null> {
  return findWorktreeByPath(worktrees, await realPathOrSelf(cwd))?.path ?? null;
}

function sanitizeBranchForDir(branch: string): string {
  return branch.replace(/[\/\\:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
}

class WorktreeBranchInUseError extends Error {
  readonly branch: string;
  readonly worktreePath: string;
  readonly missing: boolean;

  constructor(branch: string, worktreePath: string, missing: boolean) {
    super(missing
      ? `Branch '${branch}' belongs to a worktree whose folder is gone: ${worktreePath}; git worktree prune clears it`
      : `Branch '${branch}' is already checked out at ${worktreePath}`);
    this.name = "WorktreeBranchInUseError";
    this.branch = branch;
    this.worktreePath = worktreePath;
    this.missing = missing;
  }
}

function extractGitError(error: unknown): string {
  if (error instanceof GitFailure && error.stderr.trim()) return error.stderr.trim();
  return errorText(error);
}

async function addWorktree(cwd: string, branch: string): Promise<{ path: string; branch: string }> {
  const trimmed = branch.trim();
  if (!trimmed) throw new Error("Branch name is required");

  const dirName = sanitizeBranchForDir(trimmed);
  if (!dirName || dirName === "." || dirName === "..") throw new Error(`Invalid branch name: ${branch}`);

  const repoRoot = await getRepoRoot(cwd);
  const holder = (await listRegisteredWorktrees(repoRoot)).find((worktree) => worktree.branch === trimmed);
  if (holder) throw new WorktreeBranchInUseError(trimmed, holder.path, holder.missing);

  const baseDir = `${path.resolve(repoRoot)}-worktrees`;
  const worktreePath = path.join(baseDir, dirName);
  if (await exists(worktreePath)) throw new Error(`Directory already exists: ${worktreePath}`);
  await mkdir(baseDir, { recursive: true });

  let branchExists = false;
  try {
    await gitText(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/heads/${trimmed}`]);
    branchExists = true;
  } catch {
    branchExists = false;
  }

  try {
    if (branchExists) {
      await gitText(repoRoot, ["worktree", "add", "--", worktreePath, trimmed], WORKTREE_TIMEOUT_MS);
    } else {
      // Prefer an already-fetched remote tip over local HEAD; never fetch here.
      let startFrom: string | undefined;
      try {
        await gitText(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${trimmed}`]);
        startFrom = `refs/remotes/origin/${trimmed}`;
      } catch {
        startFrom = undefined;
      }
      const args = ["worktree", "add", "-b", trimmed, "--", worktreePath];
      if (startFrom) args.push(startFrom);
      await gitText(repoRoot, args, WORKTREE_TIMEOUT_MS);
    }
  } catch (error) {
    throw new Error(extractGitError(error));
  }

  return { path: worktreePath, branch: trimmed };
}

async function removeWorktree(cwd: string, worktreePath: string, force: boolean): Promise<void> {
  const worktrees = await listWorktrees(cwd);
  const target = findWorktreeByPath(worktrees, await realPathOrSelf(worktreePath));
  if (!target) throw new Error(`Not a worktree of this repository: ${worktreePath}`);
  if (target.isMain) throw new Error("Cannot remove the main worktree");

  try {
    await gitText(cwd, ["worktree", "remove", ...(force ? ["--force"] : []), target.path]);
  } catch (error) {
    throw new Error(extractGitError(error));
  }
}

function worktreeRemovalRequiresForce(message: string): boolean {
  return /contains modified or untracked files|is dirty|containing submodules/i.test(message);
}

// ------------------------------------------------------------------ folders
function normalizeCwd(cwd: string): string {
  const home = homeDirectory();
  if (cwd === "~") return home;
  if (cwd.startsWith("~/")) return path.resolve(home, cwd.slice(2));
  return path.isAbsolute(cwd) ? cwd : path.resolve(cwd);
}

function normalizeDirectory(directory: string): string {
  const home = homeDirectory();
  if (directory === "~") return home;
  if (directory.startsWith("~/")) return path.resolve(home, directory.slice(2));
  return path.resolve(directory);
}

function getParentDirectory(directory: string): string | null {
  const normalized = path.normalize(directory);
  const parent = path.dirname(normalized);
  return parent === normalized ? null : parent;
}

function isValidDirectoryName(name: string): boolean {
  return Boolean(name) && name !== "." && name !== ".." && !/[\\/\0]/.test(name);
}

interface BrowsableDirectory {
  name: string;
  path: string;
}

async function listWindowsDrives(): Promise<BrowsableDirectory[]> {
  const drives: BrowsableDirectory[] = [];
  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const drive = { name: `${letter}:`, path: `${letter}:\\` };
    try {
      if ((await stat(drive.path)).isDirectory()) drives.push(drive);
    } catch {
      // No such drive.
    }
  }
  return drives;
}

async function listDirectories(directory: string): Promise<BrowsableDirectory[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  type Candidate = { name: string; path: string; isDir: boolean; drop: boolean };
  const candidates: Candidate[] = entries.map((entry) => ({
    name: entry.name,
    path: path.join(directory, entry.name),
    isDir: entry.isDirectory(),
    drop: false,
  }));
  // A symlink to a folder counts; a broken one or a plain file does not.
  for (let start = 0; start < candidates.length; start += 32) {
    await Promise.all(candidates.slice(start, start + 32).map(async (candidate) => {
      if (candidate.isDir) return;
      try {
        candidate.isDir = (await stat(candidate.path)).isDirectory();
      } catch {
        candidate.drop = true;
      }
    }));
  }
  return candidates
    .filter((candidate) => !candidate.drop && candidate.isDir)
    .map(({ name, path: entryPath }) => ({ name, path: entryPath }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function parseBody(request: LocalRequest): Record<string, unknown> | null {
  if (!request.body) return null;
  try {
    const value: unknown = JSON.parse(request.body);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------- routes
async function homeGet(): Promise<LocalResponse> {
  return jsonResponse({ home: homeDirectory() });
}

async function defaultCwdPost(): Promise<LocalResponse> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const directory = path.join(homeDirectory(), "pi-cwd", `${year}${month}${day}`);
  try {
    await mkdir(directory, { recursive: true });
    return jsonResponse({ cwd: directory });
  } catch (error) {
    return errorResponse(String(error), 500);
  }
}

async function validateCwdPost(request: LocalRequest): Promise<LocalResponse> {
  const body = parseBody(request);
  const cwd = typeof body?.cwd === "string" ? body.cwd.trim() : "";
  if (!cwd) return errorResponse("Path is required", 400);

  if (hasParentDirectorySegment(cwd)) return errorResponse("Access denied", 403);
  const normalizedCwd = normalizeCwd(cwd);
  if (hasParentDirectorySegment(normalizedCwd)) return errorResponse("Access denied", 403);
  if ((await authorizePath(normalizedCwd)) === null) return errorResponse("Access denied", 403);

  let info;
  try {
    info = await stat(normalizedCwd);
  } catch {
    return errorResponse(`Directory does not exist: ${cwd}`, 400);
  }
  if (!info.isDirectory()) return errorResponse(`Path is not a directory: ${cwd}`, 400);

  const project = await resolveProject(normalizedCwd);
  return jsonResponse({
    success: true,
    cwd: normalizedCwd,
    projectRoot: project.projectRoot,
    projectKey: projectIdentityKey(project.projectRoot),
  });
}

async function browseGet(request: LocalRequest): Promise<LocalResponse> {
  const requested = request.params.get("path")?.trim();
  if (platform === "windows" && !requested) {
    return jsonResponse({
      path: "",
      parentPath: null,
      drives: await listWindowsDrives(),
      directories: [],
    });
  }

  const candidate = requested || homeDirectory();
  if (hasParentDirectorySegment(candidate)) return errorResponse("Access denied", 403);
  const normalized = normalizeDirectory(candidate);
  if (hasParentDirectorySegment(normalized)) return errorResponse("Access denied", 403);
  if ((await authorizePath(normalized)) === null) return errorResponse("Access denied", 403);

  let info;
  try {
    info = await stat(normalized);
  } catch {
    return errorResponse("Directory does not exist", 404);
  }
  if (!info.isDirectory()) return errorResponse("Path is not a directory", 400);

  const resolved = await resolveExistingPath(normalized);
  return jsonResponse({
    path: resolved,
    parentPath: getParentDirectory(resolved),
    directories: await listDirectories(resolved),
  });
}

async function browsePost(request: LocalRequest): Promise<LocalResponse> {
  const body = parseBody(request);
  const parentPath = typeof body?.path === "string" ? body.path.trim() : "";
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!parentPath) return errorResponse("Parent path is required", 400);
  if (!name) return errorResponse("Directory name is required", 400);
  if (!isValidDirectoryName(name)) return errorResponse("Directory name must be a single folder name", 400);

  if (hasParentDirectorySegment(parentPath)) return errorResponse("Access denied", 403);
  const normalizedParent = normalizeDirectory(parentPath);
  if (hasParentDirectorySegment(normalizedParent)) return errorResponse("Access denied", 403);
  if ((await authorizePath(normalizedParent)) === null) return errorResponse("Access denied", 403);

  let parentInfo;
  try {
    parentInfo = await stat(normalizedParent);
  } catch {
    return errorResponse("Parent directory does not exist", 404);
  }
  if (!parentInfo.isDirectory()) return errorResponse("Parent path is not a directory", 400);

  const resolvedParent = await resolveExistingPath(normalizedParent);
  const createdPath = path.join(resolvedParent, name);
  try {
    await mkdir(createdPath);
    return jsonResponse({ success: true, path: await resolveExistingPath(createdPath) });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    if (code === "EEXIST") return errorResponse("A file or directory with this name already exists", 409);
    if (code === "ENOENT") return errorResponse("Parent directory does not exist", 404);
    if (code === "EACCES" || code === "EPERM") return errorResponse("Permission denied", 403);
    if (code === "EINVAL" || code === "ENAMETOOLONG") return errorResponse("Directory name is invalid", 400);
    return errorResponse(String(error), 500);
  }
}

async function gitStatusGet(request: LocalRequest): Promise<LocalResponse> {
  const cwd = request.params.get("cwd")?.trim() ?? "";
  if (!cwd || !isAbsolutePath(cwd)) return errorResponse("cwd must be an absolute path", 400);
  if ((await authorizePath(cwd)) === null) return errorResponse("Access denied", 403);

  let info;
  try {
    info = await stat(cwd);
  } catch {
    return errorResponse("Directory not found", 404);
  }
  if (!info.isDirectory()) return errorResponse("Not a directory", 400);

  return jsonResponse(await getGitStatus(cwd));
}

async function gitDiffGet(request: LocalRequest): Promise<LocalResponse> {
  const cwd = request.params.get("cwd")?.trim() ?? "";
  const filePath = request.params.get("path")?.trim() ?? "";
  if (!cwd || !isAbsolutePath(cwd)) return errorResponse("cwd must be an absolute path", 400);
  if (!filePath || !isAbsolutePath(filePath)) return errorResponse("path must be an absolute path", 400);

  if ((await authorizePath(cwd)) === null || (await authorizePath(filePath)) === null) {
    return errorResponse("Access denied", 403);
  }

  return jsonResponse(await getGitFileDiff(cwd, filePath));
}

async function worktreesGet(request: LocalRequest): Promise<LocalResponse> {
  const cwd = request.params.get("cwd")?.trim() ?? "";
  if (!cwd) return errorResponse("cwd is required", 400);
  if ((await authorizePath(cwd)) === null) return errorResponse("Access denied", 403);

  const project = await resolveProject(cwd);
  let worktrees: WorktreeInfo[] = [];
  let currentWorktreePath: string | null = null;
  let isGit = true;
  try {
    worktrees = await listWorktrees((await exists(cwd)) ? cwd : project.projectRoot);
    currentWorktreePath = await findCurrentWorktreePath(worktrees, cwd);
  } catch {
    isGit = false;
  }

  return jsonResponse({
    projectRoot: project.projectRoot,
    projectKey: projectIdentityKey(project.projectRoot),
    isGit,
    isTopLevel: project.isTopLevel,
    currentWorktreePath,
    worktrees,
  });
}

async function worktreesPost(request: LocalRequest): Promise<LocalResponse> {
  const body = parseBody(request);
  const cwd = typeof body?.cwd === "string" ? body.cwd : "";
  const branch = typeof body?.branch === "string" ? body.branch : "";
  if (!cwd) return errorResponse("cwd is required", 400);
  if (!branch) return errorResponse("branch is required", 400);
  if ((await authorizePath(cwd)) === null) return errorResponse("Access denied", 403);
  if (!(await exists(cwd))) return errorResponse(`Directory does not exist: ${cwd}`, 400);

  try {
    return jsonResponse(await addWorktree(cwd, branch));
  } catch (error) {
    const message = errorText(error);
    if (error instanceof WorktreeBranchInUseError) {
      return jsonResponse({
        error: message,
        code: error.missing ? "branch_worktree_missing" : "branch_in_use",
        branch: error.branch,
        worktreePath: error.worktreePath,
      }, 409);
    }
    return errorResponse(message, 400);
  }
}

async function worktreesDelete(request: LocalRequest): Promise<LocalResponse> {
  const body = parseBody(request);
  const cwd = typeof body?.cwd === "string" ? body.cwd : "";
  const worktreePath = typeof body?.path === "string" ? body.path : "";
  if (!cwd) return errorResponse("cwd is required", 400);
  if (!worktreePath) return errorResponse("path is required", 400);
  if ((await authorizePath(cwd)) === null || (await authorizePath(worktreePath)) === null) {
    return errorResponse("Access denied", 403);
  }

  try {
    await removeWorktree(cwd, worktreePath, body?.force === true);
    return jsonResponse({ success: true });
  } catch (error) {
    const message = errorText(error);
    const dirty = worktreeRemovalRequiresForce(message);
    return jsonResponse({ error: message, dirty }, dirty ? 409 : 400);
  }
}

export async function handleGit(request: LocalRequest): Promise<LocalResponse | null> {
  const segments = request.segments;
  if (segments[0] !== "api") return null;
  const route = segments.slice(1).join("/");

  try {
    if (route === "home" && request.method === "GET") return await homeGet();
    if (route === "default-cwd" && request.method === "POST") return await defaultCwdPost();
    if (route === "cwd/validate" && request.method === "POST") return await validateCwdPost(request);
    if (route === "cwd/browse") {
      if (request.method === "GET") return await browseGet(request);
      if (request.method === "POST") return await browsePost(request);
      return null;
    }
    if (route === "git/status" && request.method === "GET") return await gitStatusGet(request);
    if (route === "git/diff" && request.method === "GET") return await gitDiffGet(request);
    if (route === "worktrees") {
      if (request.method === "GET") return await worktreesGet(request);
      if (request.method === "POST") return await worktreesPost(request);
      if (request.method === "DELETE") return await worktreesDelete(request);
      return null;
    }
    // `/api/open-in-explorer` is a platform call, and anything else here is
    // still the pipe's.
    return null;
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
}
