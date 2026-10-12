/**
 * fork:upstream-0.12-file-parity —— 文件树按项目（cwd）记住展开的目录（#3fe257f2）。
 *
 * 页内存里最多留这么多文件夹的展开目录，最先离开的那个先出。
 * 已经不存在的路径无害：只有列表里真出现的目录才会拿它去比，比不中就永远不命中。
 */

/** How many folders' open directories the file tree keeps in page memory. */
export const EXPANDED_PATHS_MEMORY_LIMIT = 20;

export interface ExpandedPathsMemory {
  /** Keeps `paths` as `cwd`'s open directories, the most recent entry; an empty set forgets the folder. */
  save(cwd: string, paths: ReadonlySet<string>): void;
  /** `cwd`'s open directories, or an empty set for a folder not kept. */
  restore(cwd: string): Set<string>;
}

/**
 * The file tree's open directories per cwd, least recently left first out. A
 * path that no longer exists stays harmless: only a listed directory looks
 * itself up, so it simply never matches.
 */
export function createExpandedPathsMemory(limit = EXPANDED_PATHS_MEMORY_LIMIT): ExpandedPathsMemory {
  // A Map iterates in insertion order: the first key is the oldest.
  const byCwd = new Map<string, ReadonlySet<string>>();
  return {
    save(cwd, paths) {
      byCwd.delete(cwd);
      if (paths.size === 0) return;
      byCwd.set(cwd, new Set(paths));
      for (const oldest of byCwd.keys()) {
        if (byCwd.size <= limit) break;
        byCwd.delete(oldest);
      }
    },
    restore(cwd) {
      return new Set(byCwd.get(cwd));
    },
  };
}
