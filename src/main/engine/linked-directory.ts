import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * fork:linked-directory —— 项目之外的符号链接目录。
 *
 * 克隆来的仓库里常有指向项目外的符号链接目录。边界不动：**仓库内容不得自己放宽
 * roots**（否则一条提交的软链就能让 `~/.ssh`、`/` 变得可读）。这类链接照常列出来，
 * 但带 `outsideLinkTarget`；在操作员显式点一次「允许浏览」之前，它下面一律读不到。
 *
 * 授权只放行**那一个目标**，进程重启即失效（与 PI NEXT 同一口径）。它是内存里的
 * 一次性放行，不写任何配置文件。
 */

/** A resolved path is within `root` when it is the root itself or below it. */
function isWithin(target: string, root: string): boolean {
  return target === root || target.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`);
}

function realpathOrNull(value: string): string | null {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

/** The roots after resolving links; a missing root is dropped. */
export function resolveRealRoots(roots: Iterable<string>): Set<string> {
  const resolved = new Set<string>();
  for (const root of roots) {
    const real = realpathOrNull(root);
    if (real) resolved.add(real);
  }
  return resolved;
}

export function isPathWithinRoots(target: string, realRoots: Set<string>): boolean {
  const real = realpathOrNull(target);
  if (!real) return false;
  for (const root of realRoots) if (isWithin(real, root)) return true;
  return false;
}

/** The real target of a directory link that resolves outside the roots, else null. */
export function getOutsideLinkTarget(linkPath: string, realRoots: Set<string>): string | null {
  const target = realpathOrNull(linkPath);
  if (!target) return null;
  return isPathWithinRoots(target, realRoots) ? null : target;
}

/**
 * Whether allowing `target` would also open the project or the home folder (a link
 * to `/`, `~`, or a parent of the project can arrive inside a cloned repository).
 */
function enclosesProjectOrHome(target: string, realRoots: Set<string>): boolean {
  const enclosed = [...realRoots];
  const home = realpathOrNull(os.homedir());
  if (home) enclosed.push(home);
  return enclosed.some((candidate) => isWithin(candidate, target));
}

/** Runtime, one-off allowances. Never written to disk; gone on restart. */
const allowedOutsideLinks = new Set<string>();

export function allowOutsideLink(target: string): void {
  allowedOutsideLinks.add(path.resolve(target));
}

export function isOutsideLinkAllowed(target: string): boolean {
  return allowedOutsideLinks.has(path.resolve(target));
}

/**
 * Thrown when listing a directory that leads outside the roots without an allowance.
 * The message carries the resolved target so the renderer can offer 「允许浏览」.
 */
export class OutsideLinkError extends Error {
  readonly target: string;
  constructor(target: string) {
    super(`OUTSIDE_LINK:${target}`);
    this.name = "OutsideLinkError";
    this.target = target;
  }
}

/** One listed directory that leads outside the roots. */
export interface OutsideLinkInfo {
  outsideLinkTarget: string;
  outsideLinkEncloses?: true;
}

/**
 * Add `outsideLinkTarget` to the listed directories that lead outside the roots.
 *
 * The listed directory was itself authorized after resolving links, so only an entry
 * that is a directory through stat alone (a link, a junction, or a filesystem without
 * type information) can lead outside.
 */
export function withOutsideLinkTargets<T extends { name: string; kind: "file" | "directory" }>(
  directory: string,
  entries: T[],
  dirents: Array<Pick<fs.Dirent, "name" | "isDirectory">>,
  roots: Iterable<string>,
): Array<T & Partial<OutsideLinkInfo>> {
  const statDirectories = new Set(dirents.filter((entry) => !entry.isDirectory()).map((entry) => entry.name));
  const realRoots = resolveRealRoots(roots);
  return entries.map((entry) => {
    if (entry.kind !== "directory" || !statDirectories.has(entry.name)) return entry;
    const outsideLinkTarget = getOutsideLinkTarget(path.join(directory, entry.name), realRoots);
    if (!outsideLinkTarget) return entry;
    return enclosesProjectOrHome(outsideLinkTarget, realRoots)
      ? { ...entry, outsideLinkTarget, outsideLinkEncloses: true as const }
      : { ...entry, outsideLinkTarget };
  });
}

export type LinkedDirectoryApproval =
  | { ok: true; target: string }
  | { ok: false; error: string };

/**
 * Validate the operator's request to browse the target of a directory link.
 *
 * Only reached from an explicit click. The link itself must sit directly in a directory
 * that is inside the roots after resolving links (a link reached through another,
 * unapproved link does not qualify), must still be a symlink to a directory, and must
 * still point at the target the listing showed the operator.
 */
export function checkLinkedDirectoryApproval(
  requestedPath: string,
  expectedTarget: string,
  roots: Iterable<string>,
): LinkedDirectoryApproval {
  const linkPath = path.resolve(requestedPath);
  const realRoots = resolveRealRoots(roots);
  const parentReal = realpathOrNull(path.dirname(linkPath));
  if (!parentReal || ![...realRoots].some((root) => isWithin(parentReal, root))) {
    return { ok: false, error: "Access denied" };
  }
  let linkStat: fs.Stats;
  try {
    linkStat = fs.lstatSync(linkPath);
  } catch {
    return { ok: false, error: "Not found" };
  }
  if (!linkStat.isSymbolicLink()) return { ok: false, error: "Not a linked directory" };
  let target: string;
  try {
    target = fs.realpathSync(linkPath);
    if (!fs.statSync(target).isDirectory()) return { ok: false, error: "Not a linked directory" };
  } catch {
    return { ok: false, error: "Link target not found" };
  }
  if (path.resolve(target) !== path.resolve(expectedTarget)) {
    return { ok: false, error: "Link target changed; refresh the file list" };
  }
  return { ok: true, target };
}
