// `/api/files/**` and `/api/file-index`: the file tree, the viewer and the
// composer's `@` mentions, read from this window's own filesystem.
//
// The shapes are the ones `src/api/files.ts` and `src/api/file-index.ts`
// describe, copied branch by branch from pi-web's
// `app/api/files/[...path]/route.ts` and `app/api/file-index/route.ts`. The
// server's allowed-root set came from its session list; here projects live
// under the home folder the window can already read, so that (and the app's
// data folder) is the allow-list.
//
// Paths from a URL are authorized after their symlinks are resolved. `fs` in
// this runtime has lstat/readlink but no realpath, so `resolveExistingPath()`
// below walks the components itself. Every read is capped: a directory lists
// at most 10 000 entries, a text preview/chunk is 256 KB, and a file whose
// chunk we would have to read whole is refused past 16 MB.
import { lstat, readFile, readdir, readlink, stat } from "fs/promises";
import path from "path";
import process, { spawn, type ChildProcess } from "process";
import { runAsync as run } from "./run-async";
import { buildEntriesFromFiles, filterFileEntries, type FileIndexEntry } from "../lib/file-fuzzy";
import {
  DOCX_PREVIEW_MAX_BYTES,
  IMAGE_PREVIEW_MAX_BYTES,
  TEXT_PREVIEW_MAX_BYTES,
  documentPreviewKind,
  getAudioMime,
  getDocumentMime,
  getFileExt,
  getImageMime,
  getVideoMime,
} from "../lib/file-types";
import {
  describe,
  errorResponse,
  homeDirectory,
  isInside,
  jsonResponse,
  textResponse,
  type LocalRequest,
  type LocalResponse,
} from "./request";

const FILE_REQUEST_TYPES = ["list", "read", "download", "meta", "preview", "watch"] as const;
type FileRequestType = (typeof FILE_REQUEST_TYPES)[number];
const FILE_REQUEST_TYPE_SET = new Set<string>(FILE_REQUEST_TYPES);

/** A directory with more entries than this is listed as its first 10 000. */
const MAX_LIST_ENTRIES = 10_000;
/** `fs.readFile` has no offset, so a chunk read loads the file whole first. */
const MAX_TEXT_READ_BYTES = 16 * 1024 * 1024;
/** `?type=download` for a text file; binary downloads need a byte response. */
const MAX_TEXT_DOWNLOAD_BYTES = 16 * 1024 * 1024;

const MAX_FILES = 5_000;
const GIT_HARD_CAP = 200_000;
const WALK_HARD_CAP = 50_000;
const MAX_WALK_DEPTH = 8;
const MAX_QUERY_LENGTH = 500;
const CACHE_TTL_MS = 10_000;
const CACHE_MAX_ENTRIES = 20;
const GIT_TIMEOUT_MS = 5_000;
const MAX_PATHSPEC_CHARS = 16_000;

// The source view highlights every language here. "html" and "markdown" also
// turn on the viewer's preview, so templates that are not pages take "markup".
const EXT_TO_LANGUAGE: Record<string, string> = {
  ts: "typescript", tsx: "tsx", mts: "typescript", cts: "typescript",
  js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  py: "python", rb: "ruby", php: "php", lua: "lua", pl: "perl", r: "r",
  go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin", swift: "swift",
  scala: "scala", groovy: "groovy", gradle: "groovy", dart: "dart", zig: "zig",
  c: "c", cpp: "cpp", h: "c", hpp: "cpp", cs: "csharp", mm: "objectivec",
  ex: "elixir", exs: "elixir", hs: "haskell", ml: "ocaml", clj: "clojure", nix: "nix",
  html: "html", htm: "html", vue: "markup", svelte: "markup", astro: "markup",
  css: "css", scss: "scss", less: "less",
  json: "json", jsonl: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", ini: "ini", cfg: "ini", properties: "properties",
  xml: "xml", md: "markdown", mdx: "markdown", tex: "latex",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  ps1: "powershell", psm1: "powershell", bat: "batch", cmd: "batch",
  sql: "sql", graphql: "graphql", gql: "graphql", proto: "protobuf",
  dockerfile: "dockerfile", tf: "hcl", hcl: "hcl", diff: "diff", patch: "diff",
  env: "bash", gitignore: "bash", txt: "text",
  pdf: "pdf", docx: "word",
};

function getLanguage(filePath: string): string {
  const base = path.basename(filePath).toLowerCase();
  if (base === "dockerfile" || base.startsWith("dockerfile.")) return "dockerfile";
  if (base === ".env" || base.startsWith(".env.")) return "bash";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  const ext = base.split(".").pop() ?? "";
  return EXT_TO_LANGUAGE[ext] ?? "text";
}

const HIDDEN_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store",
]);
const HIDDEN_SUFFIXES = [".pyc"];
const ALWAYS_HIDDEN_NAMES = new Set([".git", ".DS_Store"]);

type FileTreeHiddenReason = "ignored" | "excluded" | "always";

function isHiddenOutsideGit(name: string): boolean {
  return HIDDEN_NAMES.has(name) || HIDDEN_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/** Rebuild an absolute path from `/api/files/<path>`'s decoded segments. */
export function filePathFromSegments(segments: readonly string[]): string {
  const joined = segments.join("/").replace(/\\/g, "/");
  if (/^[a-zA-Z]:$/.test(joined)) return `${joined}/`;
  if (/^(?:[a-zA-Z]:[\\/]|\/\/)/.test(joined)) return joined;
  return `/${joined.replace(/^\/+/, "")}`;
}

/** Whether a path has a literal `..` component (URL parsing may hide one in `%2F`). */
export function hasParentDirectorySegment(target: string): boolean {
  const separator = process.platform === "windows" ? /[\\/]/ : /\//;
  return target.split(separator).includes("..");
}

export function isAbsolutePath(target: string): boolean {
  return path.isAbsolute(target) || /^[a-zA-Z]:[\\/]/.test(target) || target.startsWith("\\\\");
}

async function canonicalExisting(target: string, depth = 0): Promise<string> {
  if (depth > 40) throw new Error("Too many symbolic links");
  const absolute = path.resolve(target);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    // The walk starts at `/`, and the grant only covers the home folder: a
    // segment the sandbox will not let us inspect is kept as written. That is
    // the safe answer — an unresolved symlink can only make the path *look*
    // inside a root it is not, never the reverse, and these routes are the
    // app's own calls, not a network surface.
    let info;
    try {
      info = await lstat(current);
    } catch {
      continue;
    }
    if (info.isSymbolicLink()) {
      try {
        const link = await readlink(current);
        current = await canonicalExisting(path.resolve(path.dirname(current), link), depth + 1);
      } catch {
        continue;
      }
    }
  }
  return current;
}

/**
 * Every symlink in an existing path resolved; a missing tail is kept as
 * written (a deleted file has only its nearest existing ancestor to resolve).
 */
export async function resolveExistingPath(target: string): Promise<string> {
  const absolute = path.resolve(target);
  let candidate = absolute;
  const missing: string[] = [];
  for (;;) {
    try {
      const resolved = await canonicalExisting(candidate);
      return missing.length > 0 ? path.join(resolved, ...missing.slice().reverse()) : resolved;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) return absolute;
      missing.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

let allowedRootsPromise: Promise<string[]> | null = null;

function allowedRoots(): Promise<string[]> {
  if (!allowedRootsPromise) {
    allowedRootsPromise = (async () => {
      const candidates = [homeDirectory()];
      if (process.dataDir) candidates.push(process.dataDir);
      const roots: string[] = [];
      for (const candidate of candidates) {
        try {
          roots.push(await resolveExistingPath(candidate));
        } catch {
          // A root that cannot be resolved grants nothing.
        }
      }
      return roots;
    })();
  }
  return allowedRootsPromise;
}

/**
 * The path's canonical form when it is under the home or app-data folder,
 * otherwise null (403 at the route). `..` is refused before resolving so an
 * encoded one cannot be hidden by a link on the way.
 */
export async function authorizePath(target: string): Promise<string | null> {
  if (!target || target.includes("\0") || hasParentDirectorySegment(target)) return null;
  let resolved: string;
  try {
    resolved = await resolveExistingPath(target);
  } catch {
    return null;
  }
  const roots = await allowedRoots();
  return roots.some((root) => isInside(root, resolved)) ? resolved : null;
}

interface GitRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Git with the tree's invisible configs pinned; null when it could not run. */
async function runTreeGit(directory: string, args: readonly string[], timeoutMs = GIT_TIMEOUT_MS): Promise<GitRunResult | null> {
  try {
    const result = await run("git", [
      "-C", directory,
      "-c", "core.fsmonitor=false",
      "-c", "core.quotePath=false",
      ...args,
    ], { cwd: homeDirectory(), timeoutMs });
    return { code: result.code ?? null, stdout: result.stdout, stderr: result.stderr };
  } catch {
    return null;
  }
}

function pathspecBatches(names: readonly string[]): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let size = 0;
  for (const name of names) {
    if (batch.length > 0 && size + name.length + 1 > MAX_PATHSPEC_CHARS) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(name);
    size += name.length + 1;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

/** Which names hold something Git tracks (the name or a path below it). */
async function readTrackedNames(directory: string, names: readonly string[]): Promise<Set<string> | null> {
  const tracked = new Set<string>();
  for (const batch of pathspecBatches(names)) {
    const result = await runTreeGit(directory, ["--literal-pathspecs", "ls-files", "-z", "--cached", "--", ...batch]);
    if (!result || result.code !== 0) return null;
    for (const record of result.stdout.split("\0")) {
      if (record) tracked.add(record.split("/", 1)[0]);
    }
  }
  return tracked;
}

/**
 * The names Git ignores in `directory`. `check-ignore --no-index` is asked
 * about the directory itself too: when that is ignored (a scratch folder under
 * a repository that ignores `*`) the name-list rule is the better answer.
 * Null means Git has no view of the directory.
 */
async function readGitIgnoredNames(directory: string, names: readonly string[]): Promise<Set<string> | null> {
  let directoryIgnored = false;
  const matched: string[] = [];
  const batches = pathspecBatches(names);
  for (let index = 0; index < batches.length; index += 1) {
    // `./` keeps a name such as `:(glob)x` literal instead of pathspec magic.
    const args = ["check-ignore", "--no-index", "--"];
    if (index === 0) args.push(".");
    args.push(...batches[index].map((name) => `./${name}`));
    const result = await runTreeGit(directory, args);
    // Exit status 1 means nothing is ignored: an answer, not a failure.
    if (!result || (result.code !== 0 && result.code !== 1)) return null;
    for (const record of result.stdout.split(/\r?\n/)) {
      if (!record) continue;
      if (record === ".") directoryIgnored = true;
      else if (record.startsWith("./")) matched.push(record.slice(2));
      else matched.push(record);
    }
  }
  if (matched.length === 0) return directoryIgnored ? null : new Set();

  const tracked = await readTrackedNames(directory, matched);
  if (tracked === null || (directoryIgnored && tracked.size === 0)) return null;
  return new Set(matched.filter((name) => !tracked.has(name)));
}

async function getFileTreeHiddenReasons(
  directory: string,
  names: readonly string[],
): Promise<(name: string) => FileTreeHiddenReason | null> {
  const candidates = names.filter((name) => !ALWAYS_HIDDEN_NAMES.has(name));
  const ignored = candidates.length > 0 ? await readGitIgnoredNames(directory, candidates) : null;
  return (name) => {
    if (ALWAYS_HIDDEN_NAMES.has(name)) return "always";
    if (!ignored) return isHiddenOutsideGit(name) ? "excluded" : null;
    return ignored.has(name) ? "ignored" : null;
  };
}

function parseFileRequestType(value: string): FileRequestType | null {
  return FILE_REQUEST_TYPE_SET.has(value) ? (value as FileRequestType) : null;
}

function looksBinary(bytes: Uint8Array, length: number): boolean {
  // UTF-16 text is full of NULs; a byte order mark keeps it the text view.
  if (length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
    return false;
  }
  const sniffed = Math.min(length, 8_000);
  for (let index = 0; index < sniffed; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}

function utf8SequenceLength(byte: number): number {
  if ((byte & 0xe0) === 0xc0) return 2;
  if ((byte & 0xf0) === 0xe0) return 3;
  if ((byte & 0xf8) === 0xf0) return 4;
  return 1;
}

interface TextPreviewChunk {
  content: string;
  nextOffset: number;
  truncated: boolean;
  binary: boolean;
}

/** The original `readTextPreviewChunk`, over bytes `fs.readFile` returned. */
function readTextPreviewChunk(bytes: Uint8Array, offset: number): TextPreviewChunk {
  const fileSize = bytes.length;
  if (offset >= fileSize) {
    return { content: "", nextOffset: fileSize, truncated: false, binary: false };
  }
  // Only the start of a file decides; Load more continues a file shown as text.
  if (offset === 0 && looksBinary(bytes, fileSize)) {
    return { content: "", nextOffset: 0, truncated: false, binary: true };
  }

  const available = Math.min(TEXT_PREVIEW_MAX_BYTES + 1, fileSize - offset);
  const chunk = bytes.subarray(offset, offset + available);
  let end = Math.min(available, TEXT_PREVIEW_MAX_BYTES);
  if (offset + end < fileSize) {
    let sequenceStart = end;
    while (sequenceStart > end - 3 && sequenceStart > 0 && ((chunk[sequenceStart] ?? 0) & 0xc0) === 0x80) {
      sequenceStart -= 1;
    }
    if (utf8SequenceLength(chunk[sequenceStart] ?? 0) > end - sequenceStart) end = sequenceStart;
  }
  const nextOffset = offset + end;
  return {
    content: new TextDecoder().decode(chunk.subarray(0, end)),
    nextOffset,
    truncated: nextOffset < fileSize,
    binary: false,
  };
}

function contentDisposition(filePath: string): string {
  const fileName = path.basename(filePath);
  const fallback = fileName.replace(/[^\x20-\x7E]|["\\;\r\n]/g, "_") || "download";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function svgResponse(filePath: string, bytes: Uint8Array): LocalResponse {
  return {
    status: 200,
    headers: {
      "content-type": "image/svg+xml",
      "cache-control": "no-cache",
      "content-disposition": `inline; filename="${path.basename(filePath).replace(/["\\\r\n]/g, "_")}"`,
      "content-security-policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
    body: new TextDecoder().decode(bytes),
  };
}

function watchResponse(filePath: string): LocalResponse {
  return {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
    stream: (stream) => {
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let lastMtimeMs = 0;
      let lastSize = 0;
      let lastExists = false;

      const send = (event: string, data: Record<string, unknown>): void => {
        if (!stopped) stream.emit(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const cleanup = (): void => {
        if (stopped) return;
        stopped = true;
        if (timer !== null) clearTimeout(timer);
      };
      const tick = async (): Promise<void> => {
        if (stopped) return;
        try {
          const current = await stat(filePath);
          if (!lastExists || current.mtimeMs !== lastMtimeMs || current.size !== lastSize) {
            lastExists = true;
            lastMtimeMs = current.mtimeMs;
            lastSize = current.size;
            send("change", { mtime: current.mtime.toISOString(), size: current.size });
          }
        } catch {
          if (lastExists) {
            lastExists = false;
            send("change", { mtime: new Date().toISOString(), size: 0 });
          }
        }
        if (!stopped) timer = setTimeout(() => void tick(), 1_000);
      };

      void (async () => {
        try {
          const initial = await stat(filePath);
          lastExists = true;
          lastMtimeMs = initial.mtimeMs;
          lastSize = initial.size;
        } catch {
          // A missing file's watch starts absent and reports its creation.
        }
        if (stopped) return;
        send("connected", { filePath });
        timer = setTimeout(() => void tick(), 1_000);
      })();
      void stream.closed.then(cleanup);
      return cleanup;
    },
  };
}

async function fileGet(request: LocalRequest, segments: readonly string[]): Promise<LocalResponse | null> {
  const rawType = request.params.get("type") ?? "list";
  const type = parseFileRequestType(rawType);
  if (!type) return errorResponse("Invalid file request type", 400);

  const rawFilePath = filePathFromSegments(segments);
  if (hasParentDirectorySegment(rawFilePath)) return errorResponse("Access denied", 403);
  const filePath = path.resolve(rawFilePath);
  if ((await authorizePath(rawFilePath)) === null) return errorResponse("Access denied", 403);

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    if (type !== "watch") return errorResponse("Not found", 404);
  }

  if (type === "watch") {
    if (fileStat && !fileStat.isFile()) return errorResponse("Not a file", 400);
    return watchResponse(filePath);
  }
  if (!fileStat) return errorResponse("Not found", 404);

  if (type === "read") {
    if (!fileStat.isFile()) return errorResponse("Not a file", 400);
    const imageMime = getImageMime(filePath);
    if (imageMime) {
      if (fileStat.size > IMAGE_PREVIEW_MAX_BYTES) {
        return errorResponse("Image too large (>10MB)", 413);
      }
      // SVG is text and survives the string transport; other images need bytes.
      if (getFileExt(filePath) === "svg") return svgResponse(filePath, await readFile(filePath));
      return null;
    }
    // Audio, video and documents are byte responses too. The viewer asks for
    // them by URL (`fileApiUrl`), not through `req()`, and this transport only
    // carries text: returning null leaves them to the old pipe (or a build
    // with a server) until the response can carry bytes.
    if (getAudioMime(filePath) || getVideoMime(filePath) || getDocumentMime(filePath)) return null;

    const rawOffset = request.params.get("offset");
    if (rawOffset !== null && !/^\d+$/.test(rawOffset)) {
      return errorResponse("Invalid text preview offset", 400);
    }
    const offset = Number(rawOffset ?? 0);
    if (!Number.isSafeInteger(offset) || offset > fileStat.size) {
      return errorResponse("Invalid text preview offset", 400);
    }
    if (fileStat.size > MAX_TEXT_READ_BYTES) {
      return errorResponse(`File too large to preview (>${MAX_TEXT_READ_BYTES / (1024 * 1024)}MB)`, 413);
    }
    const bytes = await readFile(filePath);
    const chunk = readTextPreviewChunk(bytes, offset);
    return jsonResponse({
      ...chunk,
      language: getLanguage(filePath),
      size: fileStat.size,
      mtime: fileStat.mtime.toISOString(),
    });
  }

  if (type === "download") {
    if (!fileStat.isFile()) return errorResponse("Not a file", 400);
    const imageMime = getImageMime(filePath);
    const audioMime = getAudioMime(filePath);
    const videoMime = getVideoMime(filePath);
    const documentMime = getDocumentMime(filePath);
    const mime = imageMime || audioMime || videoMime || documentMime || "application/octet-stream";
    // A binary download has the same problem as a binary read: the response
    // contract below its callers is text, so let the old server stream it.
    if ((imageMime && getFileExt(filePath) !== "svg") || audioMime || videoMime || documentMime) return null;
    if (fileStat.size > MAX_TEXT_DOWNLOAD_BYTES) return null;
    const bytes = await readFile(filePath);
    if (looksBinary(bytes, bytes.length)) return null;
    const response = textResponse(new TextDecoder().decode(bytes), 200, mime);
    return {
      ...response,
      headers: {
        ...response.headers,
        "cache-control": "no-cache",
        "content-disposition": contentDisposition(filePath),
        "x-content-type-options": "nosniff",
      },
    };
  }

  if (type === "meta") {
    if (!fileStat.isFile()) return errorResponse("Not a file", 400);
    const imageMime = getImageMime(filePath);
    const audioMime = getAudioMime(filePath);
    const videoMime = getVideoMime(filePath);
    const documentMime = getDocumentMime(filePath);
    return jsonResponse({
      size: fileStat.size,
      mtime: fileStat.mtime.toISOString(),
      language: getLanguage(filePath),
      mime: imageMime || audioMime || videoMime || documentMime || "text/plain",
      previewKind: documentPreviewKind(filePath),
    });
  }

  // docx previews need a converter this runtime does not carry; the pipe still
  // answers them, and a PDF is `?type=read`'s byte stream.
  if (type === "preview") return null;

  // type === "list"
  if (!fileStat.isDirectory()) return errorResponse("Not a directory", 400);
  const showHidden = request.params.get("hidden") === "1";
  const dirents = await readdir(filePath, { withFileTypes: true });
  const hiddenReason = await getFileTreeHiddenReasons(filePath, dirents.map((entry) => entry.name));
  type Candidate = { name: string; hidden: "ignored" | "excluded" | null; isDir: boolean; drop: boolean };
  const candidates: Candidate[] = [];
  for (const dirent of dirents) {
    if (candidates.length >= MAX_LIST_ENTRIES) break;
    const hidden = hiddenReason(dirent.name);
    if (hidden === "always" || (hidden !== null && !showHidden)) continue;
    candidates.push({ name: dirent.name, hidden, isDir: dirent.isDirectory(), drop: false });
  }
  // Dirent only tells whether an entry is a directory here; the rest need one
  // stat to find symlinked folders. A few at a time keeps a 10 000-entry
  // folder from serializing 10 000 syscalls.
  for (let start = 0; start < candidates.length; start += 32) {
    await Promise.all(candidates.slice(start, start + 32).map(async (candidate) => {
      if (candidate.isDir) return;
      try {
        candidate.isDir = (await stat(path.join(filePath, candidate.name))).isDirectory();
      } catch {
        candidate.drop = true;
      }
    }));
  }
  const entries: Array<{ name: string; isDir: boolean; size: number; modified: string; hidden?: "ignored" | "excluded" }> = [];
  for (const candidate of candidates) {
    if (candidate.drop) continue;
    const entry = { name: candidate.name, isDir: candidate.isDir, size: 0, modified: "" };
    if (candidate.hidden !== null) entries.push({ ...entry, hidden: candidate.hidden });
    else entries.push(entry);
  }
  entries.sort((left, right) => {
    if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  return jsonResponse({ entries, path: filePath });
}

interface FileListing {
  files: string[];
  hardTruncated: boolean;
}

interface CacheEntry {
  listing: FileListing;
  entries?: FileIndexEntry[];
  expiresAt: number;
}

const indexCache = new Map<string, CacheEntry>();

async function listWithGit(cwd: string): Promise<FileListing | null> {
  const result = await runTreeGit(cwd, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], 10_000);
  if (!result || result.code !== 0) return null;
  const all = result.stdout.split("\0").filter(Boolean);
  if (all.length > GIT_HARD_CAP) {
    return { files: all.slice(0, GIT_HARD_CAP), hardTruncated: true };
  }
  return { files: all, hardTruncated: false };
}

async function listWithWalk(cwd: string): Promise<FileListing> {
  const files: string[] = [];
  // BFS so shallow files win when the cap truncates the listing.
  const queue: Array<{ abs: string; rel: string; depth: number }> = [{ abs: cwd, rel: "", depth: 0 }];
  for (let head = 0; head < queue.length; head += 1) {
    const { abs, rel, depth } = queue[head];
    let dirents;
    try {
      dirents = await readdir(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      if (isHiddenOutsideGit(dirent.name)) continue;
      const childRel = rel ? `${rel}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (depth + 1 <= MAX_WALK_DEPTH) {
          queue.push({ abs: path.join(abs, dirent.name), rel: childRel, depth: depth + 1 });
        }
      } else {
        if (files.length >= WALK_HARD_CAP) return { files, hardTruncated: true };
        files.push(childRel);
      }
    }
  }
  return { files, hardTruncated: false };
}

async function fileIndexGet(request: LocalRequest): Promise<LocalResponse> {
  const cwd = request.params.get("cwd")?.trim() ?? "";
  if (!cwd || !isAbsolutePath(cwd)) return errorResponse("cwd must be an absolute path", 400);
  const query = request.params.get("q")?.slice(0, MAX_QUERY_LENGTH) ?? "";

  if ((await authorizePath(cwd)) === null) return errorResponse("Access denied", 403);

  const absolute = path.resolve(cwd);
  let directoryStat;
  try {
    directoryStat = await stat(absolute);
  } catch {
    return errorResponse("Directory not found", 404);
  }
  if (!directoryStat.isDirectory()) return errorResponse("Not a directory", 400);

  const now = Date.now();
  let cached = indexCache.get(absolute);
  if (!cached || cached.expiresAt <= now) {
    const listing = (await listWithGit(absolute)) ?? (await listWithWalk(absolute));
    for (const [key, entry] of indexCache) {
      if (entry.expiresAt <= now) indexCache.delete(key);
    }
    if (indexCache.size >= CACHE_MAX_ENTRIES) indexCache.clear();
    cached = { listing, expiresAt: now + CACHE_TTL_MS };
    indexCache.set(absolute, cached);
  }

  if (query) {
    cached.entries ??= buildEntriesFromFiles(cached.listing.files);
    return jsonResponse({ matches: filterFileEntries(cached.entries, query) });
  }

  const { files, hardTruncated } = cached.listing;
  return jsonResponse({
    files: files.slice(0, MAX_FILES),
    truncated: hardTruncated || files.length > MAX_FILES,
  });
}

export async function handleFiles(request: LocalRequest): Promise<LocalResponse | null> {
  const segments = request.segments;
  if (segments[0] !== "api") return null;

  try {
    if (segments[1] === "file-index" && segments.length === 2) {
      if (request.method !== "GET") return null;
      return await fileIndexGet(request);
    }
    if (segments[1] !== "files") return null;

    if (request.method === "GET") return await fileGet(request, segments.slice(2));
    // POST is `upload`/`upload-check`/`allow-link`. `upload-routes.ts` answers
    // the first two later in the handler list; returning null here lets the
    // dispatch reach it (and leaves `allow-link` to the old server).
    if (request.method === "POST") return null;
    return null;
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
}
