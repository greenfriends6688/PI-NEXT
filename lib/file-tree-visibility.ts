import { execFile } from "child_process";

// ============================================================================
// Which directory entries the file tree lists.
//
// Inside a Git work tree the repository decides: an entry is hidden only when
// Git ignores it, so a tracked `build/` or `dist/` stays browsable (#677).
// Where Git has no view of a directory, a fixed list of conventionally
// generated names stands in for a .gitignore. `.git` and Finder's `.DS_Store`
// are hidden either way, as in VS Code's default excludes.
//
// This is visibility only. Hidden entries stay readable through /api/files,
// which authorizes by allowed root and never consults this module.
// ============================================================================

const HIDDEN_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store",
]);

const HIDDEN_SUFFIXES = [".pyc"];

// Never worth listing, whatever a repository says about them.
const ALWAYS_HIDDEN_NAMES = new Set([".git", ".DS_Store"]);

// The listing waits on git, so a slow one degrades to the name list rather
// than stalling the tree.
const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;
// Stays well inside Windows' 32K command line when names go to ls-files.
const MAX_PATHSPEC_CHARS = 16_000;

/** The name-based rule for directories no Git work tree covers. */
export function isHiddenOutsideGit(name: string): boolean {
  return HIDDEN_NAMES.has(name) || HIDDEN_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

// Reading the index runs a repository-configured fsmonitor hook, and expanding
// a folder (a nested checkout, say) must not execute commands.
const GIT_SAFE_CONFIG = ["-c", "core.fsmonitor=false"];

/** Run git in `directory`; null when it is missing, fails or times out. */
function runGit(
  directory: string,
  args: readonly string[],
  input?: string,
  okExitCodes: readonly number[] = [0],
  signal?: AbortSignal,
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(
      "git",
      ["-C", directory, ...GIT_SAFE_CONFIG, ...args],
      { timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, signal, env: { ...process.env, LC_ALL: "C" } },
      (error, stdout) => {
        const exitCode = error && typeof error.code === "number" ? error.code : error ? null : 0;
        resolve(exitCode !== null && okExitCodes.includes(exitCode) ? stdout : null);
      },
    );
    // Outside a repository git exits without reading its input; the resulting
    // EPIPE must not surface as an unhandled stream error.
    child.stdin?.on("error", () => {});
    child.stdin?.end(input ?? "");
  });
}

/** Group names into ls-files argument lists that stay under the size limit. */
function pathspecBatches(names: readonly string[]): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let size = 0;
  for (const name of names) {
    if (batch.length > 0 && size + name.length + 1 > MAX_PATHSPEC_CHARS) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(name);
    size += name.length + 1;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/**
 * Which of `names` hold something Git tracks: the name itself or any path
 * below it. Null when git fails.
 */
async function readTrackedNames(
  directory: string,
  names: readonly string[],
  signal?: AbortSignal,
): Promise<Set<string> | null> {
  const tracked = new Set<string>();
  for (const batch of pathspecBatches(names)) {
    // `--literal-pathspecs` keeps `*`, `[id]` and a leading `:(` literal.
    // ls-files starts from the index range under `directory`, so the cost
    // follows what is tracked below it, not the whole repository.
    const stdout = await runGit(
      directory,
      ["--literal-pathspecs", "ls-files", "-z", "--cached", "--", ...batch],
      undefined,
      [0],
      signal,
    );
    if (stdout === null) return null;
    for (const record of stdout.split("\0")) {
      if (record) tracked.add(record.split("/", 1)[0]);
    }
  }
  return tracked;
}

/**
 * Ask Git which of `names` (entries of `directory`) it ignores.
 *
 * `git check-ignore --no-index` matches every name against the ignore files
 * in one process without reading the index. Asking it with the index instead
 * scans the whole index once per name, which took seconds for a large folder
 * in a large repository. Ignoring never applies to what Git tracks, so a
 * matched name is shown after all when `git ls-files` finds a tracked path at
 * or below it: a tracked `build/`, or an ignored directory with a force-added
 * file. Only bare names cross the process boundary, so git's POSIX-style
 * paths never need converting back.
 *
 * Resolves null when Git has no view of `directory`: outside a work tree
 * (including inside `.git`), when git is missing, fails or times out, and when
 * `directory` is itself ignored with nothing tracked below it. That last case
 * is a scratch directory under a repository that ignores `*`, which would
 * otherwise list as empty.
 */
export async function readGitIgnoredNames(
  directory: string,
  names: readonly string[],
  signal?: AbortSignal,
): Promise<Set<string> | null> {
  // `./` keeps a name such as `:(glob)x` from parsing as pathspec magic, which
  // check-ignore rejects for the whole batch. `.` asks about `directory`.
  const input = [".", ...names.map((name) => `./${name}`)]
    .map((entry) => `${entry}\0`)
    .join("");
  // Exit status 1 means nothing is ignored: an answer, not a failure.
  const stdout = await runGit(
    directory,
    ["check-ignore", "--no-index", "-z", "--stdin"],
    input,
    [0, 1],
    signal,
  );
  if (stdout === null) return null;

  let directoryIgnored = false;
  const matched: string[] = [];
  for (const record of stdout.split("\0")) {
    if (record === ".") directoryIgnored = true;
    else if (record.startsWith("./")) matched.push(record.slice(2));
  }
  if (matched.length === 0) return directoryIgnored ? null : new Set();

  const tracked = await readTrackedNames(directory, matched, signal);
  if (tracked === null || (directoryIgnored && tracked.size === 0)) return null;
  return new Set(matched.filter((name) => !tracked.has(name)));
}

// fork:file-tree-visibility — 同一个（目录 + 条目名集合）的判定共用一次 git 调用。
//
// 为什么需要：文件树每收到一次目录变更（`/api/file-watch` 端 250ms 去抖）就把
// **所有已展开的目录逐个重取**，而这次变更往往与其中大多数目录无关。于是每个请求
// 都要 fork 两个 git 进程；一次 agent 连写十几个文件就能把进程数顶起来。
//
// 两个层次，都不削弱边界：
//   · 在途合并：同一 (目录 + 条目名) 只跑一次 git，后来者共享结果；
//   · 1s 结果缓存：条目名没变说明目录内容没变，忽略规则的答案也就没变。
// 缓存只覆盖**可见性**，而可见性不是授权（隐藏的条目照样能按路径读到），所以 1s
// 的陈旧窗口最多让一次刚被忽略的条目多显示一秒，不会漏权。缓存键含条目名，新增
// 条目立刻重新判定，不存在「目录变了还用旧答案」。
declare global {
  var __piFileTreeVisibilityCache: Map<string, { ignored: Set<string> | null; expiresAt: number }> | undefined;
  var __piFileTreeVisibilityInFlight: Map<string, Promise<Set<string> | null>> | undefined;
}

const VISIBILITY_CACHE_TTL_MS = 1_000;
const VISIBILITY_CACHE_MAX_ENTRIES = 200;

function visibilityCache(): Map<string, { ignored: Set<string> | null; expiresAt: number }> {
  globalThis.__piFileTreeVisibilityCache ??= new Map();
  return globalThis.__piFileTreeVisibilityCache;
}

function inFlight(): Map<string, Promise<Set<string> | null>> {
  globalThis.__piFileTreeVisibilityInFlight ??= new Map();
  return globalThis.__piFileTreeVisibilityInFlight;
}

async function readCachedOrRun(
  key: string,
  directory: string,
  names: readonly string[],
  signal?: AbortSignal,
): Promise<Set<string> | null> {
  const cache = visibilityCache();
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.ignored;
  if (cached) cache.delete(key);

  const pending = inFlight().get(key);
  const run = pending ?? readGitIgnoredNames(directory, names, signal);
  if (!pending) {
    inFlight().set(key, run);
    // 只有自己那条 settled 的记录能清掉槽位，后来者留下的必须留下。
    void run.finally(() => {
      if (inFlight().get(key) === run) inFlight().delete(key);
    });
  }
  const ignored = await run;

  if (cache.size >= VISIBILITY_CACHE_MAX_ENTRIES) {
    for (const [cachedKey, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(cachedKey);
      if (cache.size < VISIBILITY_CACHE_MAX_ENTRIES / 2) break;
    }
    if (cache.size >= VISIBILITY_CACHE_MAX_ENTRIES) cache.clear();
  }
  cache.set(key, { ignored, expiresAt: Date.now() + VISIBILITY_CACHE_TTL_MS });
  return ignored;
}

/**
 * Build the visibility test for one listing of `directory`.
 *
 * `signal` is the request's own abort signal: a browser that navigated away
 * mid-listing must not leave a git process waiting out the 5s timeout.
 */
export async function getFileTreeVisibility(
  directory: string,
  names: readonly string[],
  signal?: AbortSignal,
): Promise<(name: string) => boolean> {
  const candidates = names.filter((name) => !ALWAYS_HIDDEN_NAMES.has(name));
  if (candidates.length === 0) return (name) => !ALWAYS_HIDDEN_NAMES.has(name);

  const ignored = await readCachedOrRun(
    `${directory}\0${candidates.join("\0")}`,
    directory,
    candidates,
    signal,
  );
  if (!ignored) return (name) => !isHiddenOutsideGit(name);
  return (name) => !ALWAYS_HIDDEN_NAMES.has(name) && !ignored.has(name);
}