import { isAbsolute, relative, sep } from "node:path";
import { samePath, toNativePath } from "./paths";
import type { GitFileStatusKind, GitStatusResponse } from "./git-types";
import type { WrittenFile } from "./turn-written-files";

/**
 * fork:proma-39-changes — 右栏「改动」面板的三路来源合并（纯函数优先）。
 *
 * 依据 Proma `components/diff/diff-change-sources.ts` 与
 * `apps/electron/src/main/lib/git-diff-service.ts`：
 *
 *   1. Git 工作区变更 —— `getGitStatus()` 已经按会话 cwd 收敛过（lib/git-changes.ts）。
 *   2. 非 Git 项目下本会话工具写入的文件 —— `lib/turn-written-files.ts` 的
 *      `WrittenFile[]`（调用方从 ChatWindow 的逐轮推导里聚合上来）。
 *   3. 项目记忆变更 —— Proma 用 `memory/` 停靠区展示。本仓还没有这个数据源
 *      （PR-51 knowledge-maintenance 才引入），所以 `memoryFiles` 目前恒为空，
 *      接口先立在这里，接入时不用再改合并逻辑。
 *
 * 两条硬约束写在这里，不散给 UI：
 *
 *   · **过滤 dotfile 目录**（Proma v0.17.59）：只看父目录分段，根目录的
 *     `.gitignore` / `.env.example` 是真实改动，照常显示。
 *   · **路径比较只用 `samePath()`**：Windows 上 git 吐 POSIX 分隔符、大小写
 *     也不敏感，`===` 会把同一个文件算成两条。
 */

export type ChangeSource = "git" | "session" | "memory";

export interface ChangeEntry {
  /** 绝对路径（native 分隔符）。 */
  filePath: string;
  source: ChangeSource;
  /** 仅 `source === "git"` 时有值。 */
  status?: GitFileStatusKind;
  additions?: number | null;
  deletions?: number | null;
  repositoryRoot?: string | null;
}

export interface ProjectChanges {
  isGitRepository: boolean;
  repositoryRoot: string | null;
  changes: ChangeEntry[];
  additions: number;
  deletions: number;
}

export interface ChangeSourcesInput {
  /** 会话工作目录（改动路径相对它判断 dotfile 目录）。 */
  cwd: string;
  git?: GitStatusResponse | null;
  writtenFiles?: readonly WrittenFile[];
  memoryFiles?: readonly { filePath: string }[];
}

/**
 * 把绝对路径收敛成「相对工作目录」的形式，供 dotfile 过滤使用。
 *
 * 工作目录本身在某个点开头的目录下时（例如 `~/.config/proj`），不能把
 * `cwd` 自己的分段也算进去，否则整个项目的改动都会被隐藏。落在工作目录之外
 * 的路径保留原样：它的点目录仍应被过滤。
 */
export function workspaceRelativePath(filePath: string, cwd: string): string {
  const target = toNativePath(filePath);
  const base = toNativePath(cwd);
  const rel = relative(base, target);
  if (!rel) return "";
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return target;
  return rel;
}

/**
 * 父目录里只要有一段以点开头，这个改动就隐藏；文件自己的名字可以是点文件。
 *
 * 直接照搬 Proma `shouldDisplayChangedFile()` 的判据
 * （`pathParts.slice(0, -1).every((part) => !part.startsWith('.'))`），
 * 只把分隔符归一化以便跨平台。
 */
export function isHiddenChangePath(filePath: string): boolean {
  const parts = filePath.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.slice(0, -1).some((part) => part.startsWith("."));
}

/**
 * 合并三路来源成一张列表，按「Git → 本会话 → 记忆」的稳定顺序。
 *
 * - 项目是 Git 仓库时，**不**再叠加本会话写入的文件：工作区改动已经覆盖它们，
 *   叠加只会得到重复行。非 Git 项目才用会话写入兜底（计划 PR-39 第 2 条）。
 * - 记忆变更始终参与，且排在最后（Proma 的停靠区就在列表底部）。
 * - 去重以 `samePath()` 为准，先到先得；Git 行因此压过同路径的会话 / 记忆行。
 */
export function mergeChangeSources(input: ChangeSourcesInput): ChangeEntry[] {
  const entries: ChangeEntry[] = [];
  const seen: string[] = [];

  const add = (entry: ChangeEntry) => {
    if (isHiddenChangePath(workspaceRelativePath(entry.filePath, input.cwd))) return;
    if (seen.some((known) => samePath(known, entry.filePath))) return;
    seen.push(entry.filePath);
    entries.push(entry);
  };

  const git = input.git;
  if (git?.isGitRepository) {
    for (const file of git.files) {
      add({
        filePath: file.filePath,
        source: "git",
        status: file.status,
        additions: file.additions ?? null,
        deletions: file.deletions ?? null,
        repositoryRoot: git.repositoryRoot,
      });
    }
  } else {
    for (const file of input.writtenFiles ?? []) {
      add({ filePath: file.filePath, source: "session" });
    }
  }

  for (const file of input.memoryFiles ?? []) {
    add({ filePath: file.filePath, source: "memory" });
  }

  return entries;
}

/** 面板顶部汇总，与列表行同源（只对已经过滤 / 去重后的条目求和）。 */
export function summarizeChanges(changes: readonly ChangeEntry[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const change of changes) {
    additions += change.additions ?? 0;
    deletions += change.deletions ?? 0;
  }
  return { additions, deletions };
}
