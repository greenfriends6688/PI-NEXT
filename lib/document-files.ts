import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isExistingPathWithinRoots, isPathWithinRoots, resolveRealRoots } from "./path-security";

/**
 * fork:proma-53 — 文档工具的文件层：路径解析、授权、原子落盘。
 *
 * **授权只有这一处**，且判定全部交给 `lib/path-security.ts`：
 *   - 读 / 改已有文件 → `isExistingPathWithinRoots()`：先按 realpath 比对（符号链接
 *     指向 roots 之外就拒），并且它内部会拒掉带 `..` 的路径（#748）。
 *   - 新建文件 → 词法 `isPathWithinRoots()` 判断目标本身，再对**已存在的父目录**做
 *     `isExistingPathWithinRoots()`。顺序不能反：先确认父目录在 roots 内，才谈得上
 *     在它下面写一个新文件；这和 `/api/files` 的上传路径是同一套判定。
 *
 * 不在这里自己写路径校验 —— 那正是 #748 踩过的坑。
 */

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export class DocumentPathError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "DocumentPathError";
    this.status = status;
  }
}

/** 相对路径按会话 cwd 解析；绝对路径原样使用。 */
export function resolveDocumentTarget(input: string, cwd: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) throw new DocumentPathError("path 不能为空");
  return path.resolve(cwd, trimmed);
}

export function assertExpectedExtension(target: string, extension: string): void {
  if (path.extname(target).toLowerCase() !== extension) {
    throw new DocumentPathError(`这个工具只处理 ${extension} 文件，当前路径是 ${path.extname(target) || "无扩展名"}`);
  }
}

/** 读 / 改已有文件：目标必须是 roots 内一个已存在的普通文件。 */
export function authorizeExistingDocument(target: string, roots: Set<string>): void {
  if (!isPathWithinRoots(target, roots)) {
    throw new DocumentPathError(`路径不在允许访问的目录里：${target}`, 403);
  }
  if (!isExistingPathWithinRoots(target, roots)) {
    throw new DocumentPathError(`路径不存在、不是普通文件，或指向允许目录之外：${target}`, 403);
  }
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) throw new DocumentPathError(`不接受符号链接：${target}`);
  if (!stat.isFile()) throw new DocumentPathError(`不是一个文件：${target}`);
  if (stat.size > MAX_DOCUMENT_BYTES) {
    throw new DocumentPathError(`文件超过 ${MAX_DOCUMENT_BYTES / 1024 / 1024}MB 上限，拒绝读入`, 413);
  }
}

/** 新建文件：父目录必须已存在且在 roots 内，目标本身做词法包含检查。 */
export function authorizeNewDocument(target: string, roots: Set<string>, overwrite: boolean): void {
  const directory = path.dirname(target);
  if (!isExistingPathWithinRoots(directory, roots)) {
    throw new DocumentPathError(`目标目录不在允许访问的目录里（或不存在）：${directory}`, 403);
  }
  if (!isPathWithinRoots(target, roots)) {
    throw new DocumentPathError(`路径不在允许访问的目录里：${target}`, 403);
  }
  // 目录可能本身是链接，realpath 之后再比一次，与 /api/files 上传路径一致。
  const realDirectory = fs.realpathSync(directory);
  if (!isPathWithinRoots(realDirectory, resolveRealRoots(roots))) {
    throw new DocumentPathError(`目标目录解析符号链接后不在允许目录里：${directory}`, 403);
  }
  const existing = fs.lstatSync(target, { throwIfNoEntry: false });
  if (existing && !overwrite) {
    throw new DocumentPathError(`文件已存在：${target}。要覆盖就带 overwrite: true`, 409);
  }
  if (existing && existing.isSymbolicLink()) throw new DocumentPathError(`不接受符号链接：${target}`);
  if (existing && !existing.isFile()) throw new DocumentPathError(`目标不是一个文件：${target}`);
}

export function readDocumentBytes(target: string): Buffer {
  return fs.readFileSync(target);
}

/**
 * 同目录 staging + `renameSync` 原子落盘：失败时最多留下一个 `.name-*.tmp`，
 * 原文件字节不变，绝不会出现「写了一半的文档」。
 */
export function writeDocumentBytesAtomic(target: string, bytes: Buffer): void {
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    throw new DocumentPathError(`生成结果超过 ${MAX_DOCUMENT_BYTES / 1024 / 1024}MB 上限`, 413);
  }
  const directory = path.dirname(target);
  const staging = path.join(directory, `.${path.basename(target)}-${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(staging, bytes, { flag: "wx", flush: true });
    fs.renameSync(staging, target);
  } finally {
    try {
      fs.unlinkSync(staging);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}