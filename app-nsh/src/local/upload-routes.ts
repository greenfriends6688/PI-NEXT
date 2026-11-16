// Uploads: the composer's "+" and the file tree hand their files to
// `POST /api/files/<dir>?type=upload`, with the multipart body already in
// `request.bytes` and its boundary in `request.contentType` (`api/link.ts`
// writes the browser's multipart form). The old route is
// `app/api/files/[...path]/route.ts:POST` in pi-web; the conflict rules, size
// limits and answer shapes are copied from `lib/file-upload.ts` there, with one
// addition: `conflict=rename` keeps the existing file and writes the upload as
// `name (1).ext`, `name (2).ext`, ...
//
// `?type=upload-check` is the preflight: `{ fileNames }` in, the names that
// already exist (`conflicts`) and the ones that cannot be replaced because they
// are directories or links (`nonReplaceable`) out.
//
// `?type=allow-link` is deliberately left to the caller's fallback: it exists
// to add a directory outside the browsable roots to that server's allow-list,
// and this window has neither the modal nor an allow-list that can change. Every
// write here is authorized by the same home/data-root check as `file-routes`.
import { lstat, mkdir, readdir, rename, rmdir, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import process, { spawn, type ChildProcess } from "process";
import { runAsync as run } from "./run-async";
import { authorizePath, filePathFromSegments, hasParentDirectorySegment } from "./file-routes";
import {
  describe,
  errorResponse,
  jsonResponse,
  type LocalRequest,
  type LocalResponse,
} from "./request";

/** The old route's limits (`route.ts:41-46`). */
const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_UPLOAD_REQUEST_BYTES = MAX_UPLOAD_TOTAL_BYTES + 1024 * 1024;

/** `fs.writeFile` in this runtime accepts at most 8 MiB; larger files are written in parts. */
const MAX_WRITE_BYTES = 8 * 1024 * 1024;

type UploadConflict = "skip" | "rename" | "overwrite" | "error";
const UPLOAD_CONFLICTS = new Set<string>(["skip", "rename", "overwrite", "error"]);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A malformed multipart body: the caller's request, not this route's bug. */
class MultipartError extends Error {}

interface UploadPart {
  filename: string;
  bytes: Uint8Array;
}

interface UploadTargetInspection {
  conflicts: string[];
  nonReplaceable: string[];
}

interface StagedUpload {
  directory: string;
  file: string;
}

function parseConflict(value: string | null): UploadConflict | null {
  // The old route defaults to "error" (`lib/file-upload.ts:17-21`); the
  // composer always sends "skip".
  const candidate = value ?? "error";
  return UPLOAD_CONFLICTS.has(candidate) ? (candidate as UploadConflict) : null;
}

function validateFileNames(fileNames: readonly string[]): string | null {
  if (fileNames.length === 0) return "No files selected";

  const seen = new Set<string>();
  for (const fileName of fileNames) {
    if (!fileName || fileName === "." || fileName === ".." || fileName.includes("\0")) {
      return `Invalid file name: ${fileName || "(empty)"}`;
    }
    if (fileName.includes("/") || fileName.includes("\\") || path.basename(fileName) !== fileName) {
      return `File names must not contain a path: ${fileName}`;
    }
    if (seen.has(fileName)) return `Duplicate file name in upload: ${fileName}`;
    seen.add(fileName);
  }

  return null;
}

async function uploadDirectory(
  segments: readonly string[],
): Promise<{ directory: string } | { response: LocalResponse }> {
  const rawDirectory = filePathFromSegments(segments);
  if (hasParentDirectorySegment(rawDirectory)) {
    return { response: errorResponse("Access denied", 403) };
  }

  const directory = await authorizePath(rawDirectory);
  if (directory === null) return { response: errorResponse("Access denied", 403) };

  let info;
  try {
    info = await stat(directory);
  } catch {
    return { response: errorResponse("Upload directory not found", 404) };
  }
  if (!info.isDirectory()) {
    return { response: errorResponse("Upload target is not a directory", 400) };
  }
  return { directory };
}

async function inspectUploadTargets(directory: string, fileNames: readonly string[]): Promise<UploadTargetInspection> {
  const conflicts: string[] = [];
  const nonReplaceable: string[] = [];

  for (const fileName of fileNames) {
    let info;
    try {
      info = await lstat(path.join(directory, fileName));
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") continue;
      throw error;
    }
    conflicts.push(fileName);
    if (!info.isFile() || info.isSymbolicLink()) nonReplaceable.push(fileName);
  }
  return { conflicts, nonReplaceable };
}

async function entryExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

/** `name.txt` → `name (1).txt`; the first candidate not on disk. */
async function unusedName(directory: string, name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  for (let index = 1; index <= 10_000; index += 1) {
    if (!(await entryExists(path.join(directory, candidate)))) return candidate;
    candidate = `${stem} (${index})${extension}`;
  }
  throw new Error("Could not find an unused upload name");
}

async function makeStagingDirectory(directory: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const candidate = path.join(directory, `.pi-upload-${suffix}`);
    try {
      await mkdir(candidate);
      return candidate;
    } catch (error) {
      if ((error as { code?: string }).code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("Could not create an upload staging directory");
}

async function removeStaging(directory: string): Promise<void> {
  for (const entry of await readdir(directory).catch(() => [] as string[])) {
    await unlink(path.join(directory, entry)).catch(() => undefined);
  }
  await rmdir(directory).catch(() => undefined);
}

/**
 * Writes the bytes into a private directory beside the destination, so a failed
 * write never leaves a partial destination and an overwrite keeps the old file
 * until the complete replacement is renamed over it (`lib/file-upload.ts:61-83`).
 */
async function stageUpload(directory: string, bytes: Uint8Array): Promise<StagedUpload> {
  const stagingDirectory = await makeStagingDirectory(directory);
  const stagingFile = path.join(stagingDirectory, "upload");
  try {
    if (bytes.length <= MAX_WRITE_BYTES) {
      await writeFile(stagingFile, bytes);
    } else {
      // `writeFile` caps at 8 MiB, so a file the old route accepts (25 MiB)
      // is written as parts and assembled by the shell into the staged file.
      const parts: string[] = [];
      for (let offset = 0, index = 0; offset < bytes.length; offset += MAX_WRITE_BYTES, index += 1) {
        const part = `part-${index}`;
        await writeFile(path.join(stagingDirectory, part), bytes.subarray(offset, offset + MAX_WRITE_BYTES));
        parts.push(part);
      }
      const command = process.platform === "windows"
        ? `copy /b ${parts.join("+")} upload`
        : `cat -- ${parts.join(" ")} > upload`;
      const result = process.platform === "windows"
        ? await run("cmd", ["/d", "/c", command], { cwd: stagingDirectory, timeoutMs: 60_000 })
        : await run("/bin/bash", ["-c", command], { cwd: stagingDirectory, timeoutMs: 60_000 });
      if (result.code !== 0) {
        throw new Error(result.stderr.trim() || `Could not assemble the upload (exit ${result.code ?? "?"})`);
      }
      for (const part of parts) {
        await unlink(path.join(stagingDirectory, part)).catch(() => undefined);
      }
    }
    return { directory: stagingDirectory, file: stagingFile };
  } catch (error) {
    await removeStaging(stagingDirectory);
    throw error;
  }
}

// --- multipart -------------------------------------------------------------

function boundaryOf(contentType: string | undefined): string | null {
  if (!contentType) return null;
  const match = /(?:^|;)\s*boundary\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(contentType);
  const value = (match?.[1] ?? match?.[2] ?? "").trim();
  return value || null;
}

function findBytes(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  const last = haystack.length - needle.length;
  for (let index = Math.max(0, from); index <= last; index += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return index;
  }
  return -1;
}

interface Delimiter {
  /** Where `--boundary` starts. */
  index: number;
  /** Where the next part's headers start (after the boundary's line ending). */
  after: number;
  final: boolean;
}

/** The next real boundary: at a line start and followed by CRLF or `--`. */
function findDelimiter(bytes: Uint8Array, marker: Uint8Array, from: number): Delimiter | null {
  let at = Math.max(0, from);
  for (;;) {
    const index = findBytes(bytes, marker, at);
    if (index < 0) return null;
    if (index > 0 && bytes[index - 1] !== 10) {
      at = index + 1;
      continue;
    }

    let cursor = index + marker.length;
    let final = false;
    if (bytes[cursor] === 45 && bytes[cursor + 1] === 45) {
      final = true;
      cursor += 2;
    }
    // RFC 2046 allows whitespace between the boundary and its line ending.
    while (bytes[cursor] === 32 || bytes[cursor] === 9) cursor += 1;
    if (bytes[cursor] === 13 && bytes[cursor + 1] === 10) {
      return { index, after: cursor + 2, final };
    }
    if (bytes[cursor] === 10) return { index, after: cursor + 1, final };
    if (final && cursor >= bytes.length) return { index, after: cursor, final };
    at = index + 1;
  }
}

function headerValue(headers: string, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const line of headers.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    if (line.slice(0, colon).trim().toLowerCase() === wanted) {
      return line.slice(colon + 1).trim();
    }
  }
  return null;
}

function unquote(value: string): string {
  return value.replace(/\\(["\\])/g, "$1");
}

function filenameFromDisposition(disposition: string): string | null {
  const extended = /;\s*filename\*\s*=\s*(?:"([^"]*)"|([^;]*))/i.exec(disposition);
  if (extended) {
    let value = (extended[1] ?? extended[2] ?? "").trim();
    // RFC 5987's `charset'language'value`; the first two apostrophes are not
    // part of the name.
    const first = value.indexOf("'");
    if (first >= 0) {
      const second = value.indexOf("'", first + 1);
      if (second >= 0) value = value.slice(second + 1);
    }
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  const quoted = /;\s*filename\s*=\s*"((?:\\.|[^"\\])*)"/i.exec(disposition);
  if (quoted) return unquote(quoted[1]);
  const bare = /;\s*filename\s*=\s*([^;]*)/i.exec(disposition);
  if (bare) return unquote(bare[1].trim().replace(/^"(.*)"$/, "$1"));
  return null;
}

function parsePart(raw: Uint8Array): UploadPart | null {
  const crlf = findBytes(raw, encoder.encode("\r\n\r\n"), 0);
  const lf = crlf < 0 ? findBytes(raw, encoder.encode("\n\n"), 0) : -1;
  const headerEnd = crlf >= 0 ? crlf : lf;
  if (headerEnd < 0) throw new MultipartError("Invalid multipart part");

  const headerText = decoder.decode(raw.subarray(0, headerEnd));
  const disposition = headerValue(headerText, "content-disposition");
  const filename = disposition === null ? null : filenameFromDisposition(disposition);
  // A file field always has a filename; a plain text field is not an upload.
  if (filename === null) return null;

  const contentStart = headerEnd + (crlf >= 0 ? 4 : 2);
  return { filename, bytes: raw.subarray(contentStart) };
}

function parseMultipart(bytes: Uint8Array, contentType: string | undefined): UploadPart[] {
  const boundary = boundaryOf(contentType);
  if (!boundary) throw new MultipartError("Expected a multipart/form-data body");

  const marker = encoder.encode(`--${boundary}`);
  const first = findDelimiter(bytes, marker, 0);
  if (!first) throw new MultipartError("Invalid multipart body");
  if (first.final) return [];

  const parts: UploadPart[] = [];
  let cursor = first.after;
  for (;;) {
    const next = findDelimiter(bytes, marker, cursor);
    if (!next) throw new MultipartError("Invalid multipart body");

    // The CRLF before a boundary belongs to the boundary, not to the part.
    let end = next.index;
    if (end >= 2 && bytes[end - 2] === 13 && bytes[end - 1] === 10) end -= 2;
    else if (end >= 1 && bytes[end - 1] === 10) end -= 1;

    const part = parsePart(bytes.subarray(cursor, end));
    if (part) parts.push(part);
    if (next.final) break;
    cursor = next.after;
  }
  return parts;
}

function requestBodyBytes(request: LocalRequest): Uint8Array | undefined {
  if (request.bytes) return request.bytes;
  if (request.body !== null) return encoder.encode(request.body);
  return undefined;
}

// --- upload branches -------------------------------------------------------

async function uploadCheck(request: LocalRequest, directory: string): Promise<LocalResponse> {
  const text = request.body ?? (request.bytes ? decoder.decode(request.bytes) : null);
  let value: unknown;
  try {
    value = text === null ? null : JSON.parse(text);
  } catch {
    value = null;
  }
  const fileNames = typeof value === "object" && value !== null
    ? (value as { fileNames?: unknown }).fileNames
    : undefined;
  if (!Array.isArray(fileNames) || !fileNames.every((name) => typeof name === "string")) {
    return errorResponse("fileNames must be an array of strings", 400);
  }

  const names = fileNames as string[];
  const validationError = validateFileNames(names);
  if (validationError) return errorResponse(validationError, 400);
  return jsonResponse(await inspectUploadTargets(directory, names));
}

async function upload(request: LocalRequest, directory: string): Promise<LocalResponse> {
  const strategy = parseConflict(request.params.get("conflict"));
  if (!strategy) return errorResponse("Invalid conflict strategy", 400);

  const bytes = requestBodyBytes(request);
  if (!bytes) return errorResponse("Expected a multipart/form-data body", 400);
  if (bytes.length > MAX_UPLOAD_REQUEST_BYTES) {
    return errorResponse("Uploads must total 100MB or less", 413);
  }

  const contentType = request.contentType ?? request.headers["content-type"];
  const files = parseMultipart(bytes, contentType);
  const names = files.map((file) => file.filename);
  const validationError = validateFileNames(names);
  if (validationError) return errorResponse(validationError, 400);
  if (files.some((file) => file.bytes.length > MAX_UPLOAD_FILE_BYTES)) {
    return errorResponse("Each upload must be 25MB or smaller", 413);
  }
  if (files.reduce((total, file) => total + file.bytes.length, 0) > MAX_UPLOAD_TOTAL_BYTES) {
    return errorResponse("Uploads must total 100MB or less", 413);
  }

  const inspection = await inspectUploadTargets(directory, names);
  if (strategy === "error" && inspection.conflicts.length > 0) {
    return errorResponse("One or more files already exist", 409, {
      conflicts: inspection.conflicts,
      nonReplaceable: inspection.nonReplaceable,
    });
  }

  const conflictSet = new Set(inspection.conflicts);
  const nonReplaceableSet = new Set(inspection.nonReplaceable);
  const uploaded: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ name: string; error: string }> = [];

  for (const file of files) {
    const name = file.filename;
    const conflict = conflictSet.has(name);
    if (conflict && strategy === "skip") {
      skipped.push(name);
      continue;
    }
    if (conflict && strategy === "overwrite" && nonReplaceableSet.has(name)) {
      errors.push({ name, error: "Cannot replace a directory or symbolic link" });
      continue;
    }

    let destinationName = name;
    if (conflict && strategy === "rename") {
      try {
        destinationName = await unusedName(directory, name);
      } catch (error) {
        errors.push({ name, error: describe(error) });
        continue;
      }
    }

    let staged: StagedUpload | null = null;
    try {
      staged = await stageUpload(directory, file.bytes);
      let destination = path.join(directory, destinationName);

      if (conflict && strategy === "overwrite") {
        // The destination may have changed since the upload was inspected.
        const current = await lstat(destination);
        if (!current.isFile() || current.isSymbolicLink()) {
          throw new Error("Cannot replace a directory or symbolic link");
        }
      } else if (conflict && strategy === "rename" && (await entryExists(destination))) {
        // Something took the chosen name while this part was staged.
        destinationName = await unusedName(directory, name);
        destination = path.join(directory, destinationName);
      } else if (!conflict && (await entryExists(destination))) {
        // A fresh upload never replaces an entry that appeared meanwhile.
        throw new Error(`File already exists: ${destinationName}`);
      }

      await rename(staged.file, destination);
      uploaded.push(destinationName);
    } catch (error) {
      errors.push({ name, error: describe(error) });
    } finally {
      if (staged) await removeStaging(staged.directory);
    }
  }

  return jsonResponse(
    { uploaded, skipped, errors },
    errors.length > 0 ? 207 : 200,
  );
}

export async function handleUpload(request: LocalRequest): Promise<LocalResponse | null> {
  const segments = request.segments;
  if (segments[0] !== "api" || segments[1] !== "files") return null;
  if (request.method !== "POST") return null;

  const type = request.params.get("type") ?? "upload";
  // `allow-link` (and any newer branch) belongs to the old server or the
  // caller's fallback.
  if (type !== "upload" && type !== "upload-check") return null;

  try {
    const resolved = await uploadDirectory(segments.slice(2));
    if ("response" in resolved) return resolved.response;
    return type === "upload-check"
      ? await uploadCheck(request, resolved.directory)
      : await upload(request, resolved.directory);
  } catch (cause) {
    if (cause instanceof MultipartError) return errorResponse(cause.message, 400);
    return errorResponse(describe(cause), 500);
  }
}
