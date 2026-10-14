import { readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import type { DirEntry } from "@shared/types";
import { uiText } from "./ui-text.ts";

/** Heavy directories the file tree never shows, even though the agent can touch them. */
const HIDDEN = new Set([".git", "node_modules"]);

/** One directory listing, directories first then files, alphabetical. */
export function readWorkspaceDir(dirPath: string): DirEntry[] {
  const entries: DirEntry[] = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (HIDDEN.has(entry.name)) continue;
    const kind = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : null;
    // Symlinks, sockets and the like are skipped: the tree only previews real files.
    if (!kind) continue;
    entries.push({ name: entry.name, path: join(dirPath, entry.name), kind });
  }
  entries.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "directory" ? -1 : 1,
  );
  return entries;
}

/**
 * Write a text file — but only inside a directory this host already recognises.
 *
 * The read side has no such rule: `readFilePreview` opens whatever path it is handed, and
 * that is defensible because reading is not destructive and the path came from the user's
 * own tree. Writing is different. The renderer is a remote client as far as this function
 * is concerned, so "the path it sent" cannot be the authorisation.
 *
 * `roots` is that authorisation: the working directories the engine already knows about
 * (project folders and open conversations). Both sides of the comparison are resolved
 * through `realpath` first, so a symlink that points out of a root does not carry a write
 * with it, and a path that only *looks* contained after `..` folding does not either.
 *
 * The file must already exist. This is an editor, not a creator: creating files is the
 * agent's job (through its own tools, where the approval engine sees it), and allowing it
 * here would make this the one path that can scatter files anywhere.
 */
export function writeWorkspaceFile(filePath: string, text: string, roots: readonly string[]): void {
  const target = realpathSync(filePath);
  if (!statSync(target).isFile()) throw new Error(uiText("只能写文件", "Only a file can be written"));
  const allowed = roots.some((root) => {
    let resolved: string;
    try {
      resolved = realpathSync(root);
    } catch {
      return false;
    }
    return target === resolved || target.startsWith(resolved + sep);
  });
  if (!allowed) {
    throw new Error(uiText(
      "拒绝写入：这个文件不在当前项目的目录里",
      "Refused: this file is outside the current project's directory",
    ));
  }
  writeFileSync(target, text, "utf8");
}
