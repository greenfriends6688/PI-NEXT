import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { GitCommitFile, GitCommitFilesResponse, GitLogCommit, GitLogResponse } from "@shared/types";

/**
 * fork:git-graph —— Git 图谱的服务端数据层。
 *
 * 一条有上限的 `git log`（不需要 `--graph`，车道几何由客户端的
 * `lib/git-graph-lanes.ts` 从父链接推导），以及详情卡要的「某个提交改了哪些文件」。
 *
 * 复用本仓既有的 execFile 姿势（超时 / maxBuffer 一处配置），不另起一套封装。
 */

const execFileAsync = promisify(execFile);
const GIT_GRAPH_MAX_BUFFER = 16 * 1024 * 1024;

/** 字段分隔符用 `\x1f`（ASCII Unit Separator）：subject 里出现 `|` 也不会拆错行。 */
const FIELD_SEPARATOR = "\x1f";

async function repositoryRoot(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      timeout: 5_000,
      maxBuffer: 128 * 1024,
    });
    const root = stdout.trim();
    return root || null;
  } catch {
    return null;
  }
}

function formatGitLogCommand(limit: number): string[] {
  return [
    "log",
    `--max-count=${limit}`,
    // --topo-order：子提交一定排在父提交之前，车道状态机只需要单遍扫描。
    "--topo-order",
    `--format=%H${FIELD_SEPARATOR}%P${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%at${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%D`,
  ];
}

export function parseGitLog(raw: string): GitLogCommit[] {
  const commits: GitLogCommit[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    const fields = line.split(FIELD_SEPARATOR);
    if (fields.length < 6) continue;
    const [hash, parents, author, timestamp, subject, refs] = fields;
    if (!hash) continue;
    commits.push({
      hash,
      parents: parents.split(" ").filter(Boolean),
      author,
      timestamp: Number(timestamp) || 0,
      subject,
      refs: refs ? refs.split(", ").filter(Boolean) : [],
    });
  }
  return commits;
}

export async function readGitLog(cwd: string, limit = 300): Promise<GitLogResponse> {
  const root = await repositoryRoot(cwd);
  if (!root) return { isGitRepository: false, commits: [], truncated: false };
  try {
    // 多取一条用于判断截断，避免再跑一次 count 查询。
    const { stdout } = await execFileAsync("git", ["-C", root, ...formatGitLogCommand(limit + 1)], {
      timeout: 15_000,
      maxBuffer: GIT_GRAPH_MAX_BUFFER,
    });
    const commits = parseGitLog(stdout);
    return { isGitRepository: true, commits: commits.slice(0, limit), truncated: commits.length > limit };
  } catch {
    // 空仓库（unborn HEAD）或 git 执行失败：显示空图，不当成错误弹给用户。
    return { isGitRepository: true, commits: [], truncated: false };
  }
}

function parseNameStatus(output: string): Array<{ code: string; repoPath: string; originalPath?: string }> {
  const fields = output.split("\0");
  const records: Array<{ code: string; repoPath: string; originalPath?: string }> = [];
  for (let i = 0; i < fields.length; i += 1) {
    const status = fields[i];
    if (!status) continue;
    const letter = status[0]!;
    const isRenameLike = letter === "R" || letter === "C";
    const originalPath = isRenameLike ? fields[++i] : undefined;
    const repoPath = fields[++i];
    if (!repoPath) continue;
    records.push({ code: letter, repoPath, originalPath: originalPath || undefined });
  }
  return records;
}

export async function readGitCommitFiles(cwd: string, hash: string): Promise<GitCommitFilesResponse> {
  // hash 只允许十六进制：拒绝任意 revision 语法与参数注入。
  if (!/^[0-9a-f]{6,40}$/i.test(hash)) return { supported: false, files: [] };
  const root = await repositoryRoot(cwd);
  if (!root) return { supported: false, files: [] };
  try {
    const { stdout: parentsOutput } = await execFileAsync("git", ["-C", root, "log", "-1", "--format=%P", hash], {
      timeout: 10_000,
      maxBuffer: 128 * 1024,
    });
    const parents = parentsOutput.trim().split(" ").filter(Boolean);
    // 一律和第一个 parent 比（root commit 和空树比），与常见图谱工具对 merge 的口径一致。
    const { stdout } = parents.length === 0
      ? await execFileAsync("git", ["-C", root, "diff-tree", "--root", "--no-commit-id", "--name-status", "-r", "-z", "--find-renames", hash], { timeout: 15_000, maxBuffer: GIT_GRAPH_MAX_BUFFER })
      : await execFileAsync("git", ["-C", root, "diff", "--name-status", "-z", "--find-renames", parents[0]!, hash], { timeout: 15_000, maxBuffer: GIT_GRAPH_MAX_BUFFER });
    const files: GitCommitFile[] = parseNameStatus(stdout).map((record) => ({
      filePath: path.resolve(root, record.repoPath),
      code: record.code,
      ...(record.originalPath ? { originalPath: path.resolve(root, record.originalPath) } : {}),
    }));
    return { supported: true, files };
  } catch {
    return { supported: false, files: [] };
  }
}
