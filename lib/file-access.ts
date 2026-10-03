import { readdirSync } from "fs";
import { homedir } from "os";
import path from "path";
import { getAdditionalAllowedRoots, normalizeSlashes } from "./allowed-roots";
import { isExistingPathWithinRoots, isPathWithinRoots } from "./path-security";
import { listAllSessions } from "./session-reader";
// fork:chat-workspace — standalone chat workspace root (see docs/patches/0001-chat-workspace.md)
import { getChatWorkspacePath } from "./chat-workspace";
export { allowFileRoot, normalizeSlashes } from "./allowed-roots";
export { isWindowsAbsolutePath } from "./paths";

// Short-TTL cache for the allowed-roots set. Without this, every file list/read
// request re-scans every pi session on disk just to check access. 5s is short
// enough that newly-created cwds appear promptly; stored on globalThis so it
// survives Next.js hot-reload.
declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
}

const ALLOWED_ROOTS_TTL_MS = 5_000;

export async function getAllowedFileRoots(): Promise<Set<string>> {
  const now = Date.now();
  const cached = globalThis.__piAllowedRootsCache;
  if (cached && cached.expiresAt > now) return cached.roots;

  const sessions = await listAllSessions();
  const roots = new Set<string>();
  for (const s of sessions) {
    if (s.cwd) roots.add(normalizeSlashes(s.cwd));
    // The project root (main repo shared by all worktrees) is browsable too —
    // the project dropdown lists it even when only worktrees have sessions.
    if (s.projectRoot) roots.add(normalizeSlashes(s.projectRoot));
  }

  // Also allow the per-day folders the default-cwd endpoint creates:
  // `~/pi-cwd/<YYYYMMDD>`（fork:default-cwd-local-date：父目录 + 本地日期，与上游一致）。
  // 只认这一种形状；旧的 `~/pi-cwd-<YYYYMMDD>` 平铺目录**不再**自动进白名单 ——
  // 它是靠「家目录里有什么」推断出来的，宽到任何本地进程都能创建同名目录就混进来。
  // 旧的那些目录仍然可用：走 `/api/cwd/validate` 选过一次就进白名单（与其它项目一致）。
  try {
    const parent = path.join(homedir(), "pi-cwd");
    for (const name of readdirSync(parent)) {
      if (/^\d{8}$/.test(name)) {
        roots.add(normalizeSlashes(path.join(parent, name)));
      }
    }
  } catch {
    // ignore if the folder does not exist yet or home is unreadable
  }

  // fork:chat-workspace — browsable before its first session exists, so the file
  // explorer works while composing the very first standalone chat.
  roots.add(normalizeSlashes(getChatWorkspacePath()));

  for (const root of getAdditionalAllowedRoots()) roots.add(root);

  globalThis.__piAllowedRootsCache = { roots, expiresAt: now + ALLOWED_ROOTS_TTL_MS };
  return roots;
}

/** Authorize a path lexically, without touching the filesystem. */
export function isFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isPathWithinRoots(target, allowedRoots);
}

/** Authorize an existing path after resolving symbolic links. */
export function isExistingFilePathAllowed(target: string, allowedRoots: Set<string>): boolean {
  return isExistingPathWithinRoots(target, allowedRoots);
}
