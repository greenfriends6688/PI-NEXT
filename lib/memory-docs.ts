/**
 * fork:memory-docs —— 「设置 → 记忆」里那份**可读、可编辑**的文档清单。
 *
 * 记忆分两处落盘（`lib/memory-package.ts` 定的路径）：
 *   · 全局：`<agentDir>/pi-hermes-memory/` —— `MEMORY.md` / `failures.md` / `daily/*.md`
 *   · 项目：`<agentDir>/projects-memory/<项目名>/` —— 每个项目一份 `MEMORY.md`
 *
 * 这一页只认 **`.md`**。同目录里还有 `sessions.db`（36 MB 的 sqlite）、
 * `.pi-hermes-locks.sqlite*`、`.skills-migrated-*`、`.*.recovery-*` / `.*.retired-*`
 * 与 `recovery/*.json` —— 那些是扩展自己的内部件，不是给人改的记忆，列出来只会让人
 * 以为「点开能编辑」。所以：跳过点开头的条目、跳过非 `.md`。
 *
 * **安全边界（这一层是唯一的授权点）**：面板传上来的是 `scope` + `project` + `name`
 * 三段，路径在服务端拼。`project` 必须是单个目录名、`name` 必须是相对路径且每段都不是
 * `.` / `..`、不含分隔符与 NUL，最后还要 realpath 复核一遍目标确实落在根内 ——
 * 记忆目录里可以出现符号链接，而 `resolve()` 不跟链接（`AGENTS.md` 的
 * `fork:linked-directory` 记过同一类坑：字典序上在根内、实际却指到根外）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, type Dirent } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { writePrivateFileAtomicSync } from "./atomic-file";
import { memoryDirPath, memoryProjectsDirPath } from "./memory-package";

export type MemoryDocScope = "global" | "project";

export interface MemoryDocument {
  scope: MemoryDocScope;
  /** 项目记忆才有：`projects-memory/<project>` 的那个目录名（面板要显示它）。 */
  project: string | null;
  /** 相对所在根的路径，如 `MEMORY.md` / `daily/2026-09-18.md`。 */
  name: string;
  bytes: number;
  mtimeMs: number;
}

/** 只认 markdown —— 见头注。 */
const DOC_EXTENSION = ".md";
/** 目录递归深度上限：记忆是一层（+ `daily/`），再深只可能是有人塞了别的东西。 */
const MAX_DEPTH = 3;
/** 单份文档的读写上限：记忆是「一行一条」，几 MB 的 .md 只可能是事故。 */
export const MEMORY_DOC_MAX_BYTES = 2 * 1024 * 1024;

/** 一段路径必须是个普通名字：非空、不是 `.` / `..`、不含分隔符与 NUL。 */
function isPlainSegment(segment: string): boolean {
  return segment.length > 0
    && segment !== "."
    && segment !== ".."
    && !segment.includes("/")
    && !segment.includes("\\")
    && !segment.includes("\0");
}

/** `name` 是相对路径：每段都得干净，且整体是 `.md`。 */
function isDocumentName(name: string): boolean {
  if (!name || name.includes("\0")) return false;
  if (!name.toLowerCase().endsWith(DOC_EXTENSION)) return false;
  return name.split("/").every(isPlainSegment);
}

/** 真实路径复核：目标（或它还不存在时的父目录）必须落在根内。 */
function isWithinRoot(root: string, target: string): boolean {
  const realRoot = existsSync(root) ? realpathSync(root) : root;
  const probe = existsSync(target) ? target : dirname(target);
  const realProbe = existsSync(probe) ? realpathSync(probe) : probe;
  return realProbe === realRoot || realProbe.startsWith(realRoot + sep);
}

/** 逐层收集 `.md`（跳过点开头的条目 —— 内部件全在那儿）。 */
function collectDocs(root: string, depth = 0): { name: string; bytes: number; mtimeMs: number }[] {
  if (depth > MAX_DEPTH || !existsSync(root)) return [];
  const out: { name: string; bytes: number; mtimeMs: number }[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      for (const nested of collectDocs(full, depth + 1)) {
        out.push({ ...nested, name: `${entry.name}/${nested.name}` });
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(DOC_EXTENSION)) continue;
    try {
      const stat = statSync(full);
      out.push({ name: entry.name, bytes: stat.size, mtimeMs: stat.mtimeMs });
    } catch {
      // 读不到就跳过：一份坏文件不该让整页列不出来
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** 项目记忆目录下有哪些项目（按名字排序）。 */
export function listMemoryProjects(agentDir = getAgentDir()): string[] {
  const root = memoryProjectsDirPath(agentDir);
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** 面板要的那份清单：全局在前，然后逐个项目。 */
export function listMemoryDocuments(agentDir = getAgentDir()): MemoryDocument[] {
  const documents: MemoryDocument[] = collectDocs(memoryDirPath(agentDir)).map((doc) => ({
    scope: "global" as const,
    project: null,
    ...doc,
  }));
  for (const project of listMemoryProjects(agentDir)) {
    const root = join(memoryProjectsDirPath(agentDir), project);
    for (const doc of collectDocs(root)) {
      documents.push({ scope: "project", project, ...doc });
    }
  }
  return documents;
}

export type MemoryDocResolution =
  | { ok: true; path: string; root: string }
  | { ok: false; error: string; status: number };

/**
 * 三段输入 → 磁盘路径。**所有**读 / 写都必须先过这里 —— 面板不许自己拼路径。
 * 校验失败一律 400（形状不对）或 404（根不存在），不回显用户给的原始串。
 */
export function resolveMemoryDocument(
  input: { scope?: unknown; project?: unknown; name?: unknown },
  agentDir = getAgentDir(),
): MemoryDocResolution {
  const scope = input.scope;
  if (scope !== "global" && scope !== "project") {
    return { ok: false, error: "scope must be global or project", status: 400 };
  }
  if (typeof input.name !== "string" || !isDocumentName(input.name)) {
    return { ok: false, error: "name must be a relative .md path without .. segments", status: 400 };
  }

  let root: string;
  if (scope === "global") {
    root = memoryDirPath(agentDir);
  } else {
    if (typeof input.project !== "string" || !isPlainSegment(input.project)) {
      return { ok: false, error: "project must be a single directory name", status: 400 };
    }
    root = join(memoryProjectsDirPath(agentDir), input.project);
  }
  if (!existsSync(root)) {
    return { ok: false, error: "memory directory does not exist yet", status: 404 };
  }

  const target = resolve(root, input.name);
  // 段已经校验过，这里再按**真实路径**复核一次：记忆目录里可以有符号链接。
  if (!isWithinRoot(root, target)) {
    return { ok: false, error: "resolved path escapes the memory directory", status: 400 };
  }
  return { ok: true, path: target, root };
}

export type MemoryDocRead =
  | { ok: true; document: { scope: MemoryDocScope; project: string | null; name: string; path: string; content: string; bytes: number; mtimeMs: number } }
  | { ok: false; error: string; status: number };

export function readMemoryDocument(
  input: { scope?: unknown; project?: unknown; name?: unknown },
  agentDir = getAgentDir(),
): MemoryDocRead {
  const resolved = resolveMemoryDocument(input, agentDir);
  if (!resolved.ok) return resolved;
  if (!existsSync(resolved.path)) {
    return { ok: false, error: "document not found", status: 404 };
  }
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(resolved.path);
  } catch {
    return { ok: false, error: "document not readable", status: 500 };
  }
  if (stat.size > MEMORY_DOC_MAX_BYTES) {
    return { ok: false, error: `document is larger than ${MEMORY_DOC_MAX_BYTES} bytes`, status: 413 };
  }
  try {
    return {
      ok: true,
      document: {
        scope: input.scope as MemoryDocScope,
        project: typeof input.project === "string" ? input.project : null,
        name: input.name as string,
        path: resolved.path,
        content: readFileSync(resolved.path, "utf8"),
        bytes: stat.size,
        mtimeMs: stat.mtimeMs,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), status: 500 };
  }
}

export type MemoryDocWrite =
  | { ok: true; bytes: number; mtimeMs: number }
  | { ok: false; error: string; status: number };

/**
 * 写回。**原子写（0600 + staging + rename）**：记忆是「下次会话要读回来」的东西，
 * 写一半被打断比写失败更糟 —— 那会让扩展读到半截文件。新建文档时目录一并建出来
 * （`daily/` 可能还不存在）。
 */
export function writeMemoryDocument(
  input: { scope?: unknown; project?: unknown; name?: unknown; content?: unknown },
  agentDir = getAgentDir(),
): MemoryDocWrite {
  if (typeof input.content !== "string") {
    return { ok: false, error: "content must be a string", status: 400 };
  }
  if (Buffer.byteLength(input.content, "utf8") > MEMORY_DOC_MAX_BYTES) {
    return { ok: false, error: `content is larger than ${MEMORY_DOC_MAX_BYTES} bytes`, status: 413 };
  }
  const resolved = resolveMemoryDocument(input, agentDir);
  if (!resolved.ok) return resolved;
  try {
    mkdirSync(dirname(resolved.path), { recursive: true });
    writePrivateFileAtomicSync(resolved.path, input.content);
    const stat = statSync(resolved.path);
    return { ok: true, bytes: stat.size, mtimeMs: stat.mtimeMs };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), status: 500 };
  }
}
