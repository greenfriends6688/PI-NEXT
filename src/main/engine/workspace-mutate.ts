import {
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { uiText } from "./ui-text.ts";
import type { FileMutation } from "../../shared/file-mutation.ts";

/**
 * Creating, renaming and deleting entries in the file tree, plus the flat listing the `@`
 * menu searches.
 *
 * **Every path goes through the same guard as writing a file**, and for the same reason: the
 * caller may be a browser on another machine, so "the path it sent" cannot be the
 * authorisation. `roots` — the project folders and open conversations this engine already
 * knows — is that authorisation, resolved through `realpath` on both sides so a symlink or a
 * `..` cannot carry an operation out of a root.
 *
 * The three operations differ from writing in one respect worth naming: they act on paths
 * that **do not exist yet** (a new folder), so containment has to be decided on the *parent*
 * for a create, on the entry itself for the rest.
 */

export type { FileMutation } from "../../shared/file-mutation.ts";

/** How many entries the `@` menu is willing to consider. */
const MAX_LISTING = 20000;
/** Directories never worth walking for a mention menu. */
const SKIP_DIRS = new Set([".git", "node_modules", ".next", "out", "dist", "build"]);

/**
 * `realpath` on the nearest existing ancestor, then re-attach the missing tail.
 *
 * A create targets a path that does not exist yet, so `realpathSync` would throw on exactly
 * the case this has to decide. Resolving the ancestor is also what makes a symlinked parent
 * count: a new file under `link/` is judged by where `link` really points.
 */
function realpathRoot(path: string): string {
  let current = resolve(path);
  const missing: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return resolve(path);
    missing.unshift(basename(current));
    current = parent;
  }
  try {
    return join(realpathSync(current), ...missing);
  } catch {
    return resolve(path);
  }
}

function insideRoots(target: string, roots: readonly string[]): boolean {
  const resolved = realpathRoot(target);
  return roots.some((root) => {
    if (!existsSync(root)) return false;
    let base: string;
    try {
      base = realpathSync(root);
    } catch {
      return false;
    }
    return resolved === base || resolved.startsWith(base + sep);
  });
}

function refusal(): Error {
  return new Error(uiText(
    "拒绝操作：这个路径不在当前项目的目录里",
    "Refused: this path is outside the current project's directory",
  ));
}

function asPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new Error(uiText("路径无效", "Invalid path"));
  }
  return value;
}

/**
 * One mutation, authorised against the roots.
 *
 * A create is checked on its **parent** (the entry does not exist yet) and refuses to clobber
 * something already there; a rename checks both ends, so it can neither move a file out of the
 * project nor overwrite one inside it.
 */
export function mutateWorkspaceFile(mutation: FileMutation, roots: readonly string[]): void {
  const path = asPath(mutation.path);
  if (!insideRoots(path, roots)) throw refusal();

  if (mutation.kind === "mkdir") {
    if (!insideRoots(dirname(path), roots)) throw refusal();
    if (existsSync(path)) throw new Error(uiText("同名文件夹已存在", "A folder with that name exists"));
    mkdirSync(path, { recursive: false });
    return;
  }

  if (mutation.kind === "touch") {
    if (!insideRoots(dirname(path), roots)) throw refusal();
    if (existsSync(path)) throw new Error(uiText("同名文件已存在", "A file with that name exists"));
    // `wx` so the check above and the write cannot be raced apart.
    writeFileSync(path, "", { flag: "wx" });
    return;
  }

  // The two below act on something that must already be there. `touch` is the one that
  // creates, and it was reaching this line first — which made "new file" report that the
  // path it was about to create did not exist.
  if (!existsSync(path)) throw new Error(uiText("路径不存在", "That path does not exist"));

  if (mutation.kind === "rename") {
    const to = asPath(mutation.to);
    if (!insideRoots(to, roots)) throw refusal();
    if (existsSync(to)) throw new Error(uiText("目标已存在", "The target already exists"));
    renameSync(path, to);
    return;
  }

  // Deleting the project root itself would take every other operation with it.
  const parentInside = roots.some((root) => existsSync(root) && resolve(root) === resolve(path));
  if (parentInside) throw new Error(uiText("不能删除项目根目录", "The project root cannot be deleted"));
  rmSync(path, { recursive: true, force: false });
}

/**
 * A flat, relative listing of one root, for the `@` menu.
 *
 * Bounded twice — by count and by skipping the directories nobody means to mention — because
 * this runs on a keystroke. A repository big enough to blow past either is one where the
 * query narrows things faster than a longer walk would.
 */
export function listWorkspaceFiles(root: string, limit = MAX_LISTING): string[] {
  if (!existsSync(root)) return [];
  const base = resolve(root);
  const files: string[] = [];
  const walk = (dir: string): void => {
    if (files.length >= limit) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      // A directory that cannot be read is one this listing skips, not an error worth
      // failing the whole menu over.
      return;
    }
    for (const entry of entries) {
      if (files.length >= limit) return;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const full = join(dir, entry.name);
      files.push(relative(base, full).split(sep).join("/"));
    }
  };
  walk(base);
  return files;
}
