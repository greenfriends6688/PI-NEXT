// `/api/files/*`: the file browser's requests.
//
// Shapes come from pi-next 0.0.4's route, branch by branch
// (`app/api/files/[...path]/route.ts`, `GET`):
//
//   ?type=list&hidden=1     `{ entries, path }`            (the `list` branch)
//   ?type=read&offset=N     `{ content, nextOffset, truncated, binary,
//                             language, size, mtime }`    (`read` + `lib/text-preview.ts`)
//   ?type=meta              `{ size, mtime, language, mime, previewKind }`
//   ?type=download          the bytes                      (`download`)
//   ?type=preview           a docx as a finished HTML page (`preview`; only
//                           docx: a PDF is `?type=read`'s `application/pdf`)
//   ?type=watch             SSE: `connected` `{filePath}`, then `change`
//                           `{mtime,size}`, or `error` `{message}`  (`watch`)
//
// `?type=read` answers JSON for a text file and bytes for an image, an audio,
// a video or a PDF (`route.ts:503-541`), so a viewer asks `?type=meta` first
// and reads the JSON only for what that reports as text.
//
// The path travels as URL segments, each `encodeURIComponent`d, so a name with
// a `#`, `?` or a space survives (`lib/file-paths.ts` `encodeFilePathForApi`).
// A file outside the browsable roots is authorized by naming the session that
// references it (`?sessionId=`), which is why every read takes one.

import { api, req, segment, withQuery, withToken } from "./client";
import { attachedMode, serverBacked } from "./mode";
import { openStream } from "./sse";
import type { DocumentPreviewKind } from "../lib/file-types";

/** The `type`s the route answers (`FILE_REQUEST_TYPES`, `route.ts:38`). */
export type FileRequestType = "list" | "read" | "download" | "meta" | "preview" | "watch";

/**
 * Why a listing leaves an entry out unless `hidden=1`
 * (`lib/file-tree-visibility.ts:22-27`). `"always"` (`.git`, `.DS_Store`) is
 * never listed, so it never arrives.
 */
export type FileHiddenReason = "ignored" | "excluded";

/**
 * One directory entry. Two fields are always empty in this server's shape: it
 * lists without a per-entry `stat` (`size: 0`, `modified: ""`), so the viewer
 * asks `?type=meta` for them.
 */
export interface FileEntry {
  name: string;
  isDir: boolean;
  /** Always 0 from `?type=list`; read `?type=meta` for a real size. */
  size: number;
  /** Always "" from `?type=list`. */
  modified: string;
  /** Why the `hidden=1` listing shows it dimmed. */
  hidden?: FileHiddenReason;
  /** Where a directory link leads when that is outside the browsable roots. */
  outsideLinkTarget?: string;
  /** That target contains the project or the home folder. */
  outsideLinkEncloses?: boolean;
}

/** `?type=list`. */
export interface FileList {
  entries: FileEntry[];
  /** The absolute directory the server listed. */
  path: string;
}

/**
 * One chunk of a text file (`lib/text-preview.ts` `TextPreviewChunk`, plus what
 * the route adds). A chunk is at most 256 KB (`TEXT_PREVIEW_MAX_BYTES`).
 */
export interface FileText {
  content: string;
  /** The offset the next chunk starts at. */
  nextOffset: number;
  /** More of the file is after this chunk. */
  truncated: boolean;
  /** The file sniffed as binary (a NUL among its first 8000 bytes): no content. */
  binary: boolean;
  /** The highlighter's language name (`EXT_TO_LANGUAGE` in the route). */
  language: string;
  size: number;
  /** ISO 8601; a write elsewhere changes it (the watch reports the same pair). */
  mtime: string;
}

/** `?type=meta`: what decides how the viewer shows the file. */
export interface FileMeta {
  size: number;
  mtime: string;
  /** A highlighter language name: "typescript", "markdown", "text", ... */
  language: string;
  /** `image/*`, `audio/*`, `video/*`, the document types, else "text/plain". */
  mime: string;
  /** "pdf" / "docx" for the two documents the route previews, else null. */
  previewKind: DocumentPreviewKind | null;
}

/** The parts every read shares. */
export interface FileRequestOptions {
  /** `?sessionId=`: authorizes a file outside the browsable roots. */
  sessionId?: string | null;
  signal?: AbortSignal;
}

/** A file path as the route's `[...path]` segments. */
export function filePathForApi(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  // URL routing drops a leading "//", so a UNC root has to live inside the
  // first segment (`lib/file-paths.ts:11-17`).
  if (normalized.startsWith("//") && segments.length > 0) segments[0] = `//${segments[0]}`;
  return segments.map(segment).join("/");
}

/** A route-relative path: `/api/files/<path>?type=…`. */
export function fileApiPath(
  filePath: string,
  type: FileRequestType,
  query: Record<string, string | number | boolean | null | undefined> = {},
): string {
  return withQuery(`/api/files/${filePathForApi(filePath)}`, { type, ...query });
}

/**
 * An absolute URL for what loads by URL rather than through `req()`: an
 * `Image`'s `src`. It carries the endpoint and the LAN token (`?t=`), as
 * `client.ts` sends them.
 */
export function fileApiUrl(
  filePath: string,
  type: FileRequestType,
  query: Record<string, string | number | boolean | null | undefined> = {},
): string {
  // Attached to the machine's pi with no server behind it: there is no URL to
  // ask, and the runtime's loaders (`Image`, `Video`, `AudioPlayer`) read a
  // local file themselves.
  if (attachedMode() && !serverBacked()) {
    const absolute = filePath.startsWith("/") ? filePath : `/${filePath}`;
    return `file://${absolute.split("/").map(encodeURIComponent).join("/")}`;
  }
  return withToken(api.base(), fileApiPath(filePath, type, query), api.token());
}

/** `?type=list` of one directory; `hidden` also lists what Git ignores. */
export async function listFiles(
  directory: string,
  options: FileRequestOptions & { hidden?: boolean } = {},
): Promise<FileList> {
  return req<FileList>(fileApiPath(directory, "list", {
    hidden: options.hidden ? 1 : undefined,
    sessionId: options.sessionId ?? undefined,
  }), {}, { signal: options.signal });
}

/** `?type=meta`: size, mtime, language, mime and the preview kind. */
export async function readFileMeta(
  filePath: string,
  options: FileRequestOptions = {},
): Promise<FileMeta> {
  return req<FileMeta>(fileApiPath(filePath, "meta", {
    sessionId: options.sessionId ?? undefined,
  }), {}, { signal: options.signal });
}

/**
 * `?type=read`: one chunk of a text file, from `offset`. Images, audio, video
 * and documents come back as their bytes from this same `type`, so only call
 * it for a file `?type=meta` says is text.
 */
export async function readFile(
  filePath: string,
  options: FileRequestOptions & { offset?: number } = {},
): Promise<FileText> {
  return req<FileText>(fileApiPath(filePath, "read", {
    offset: options.offset || undefined,
    sessionId: options.sessionId ?? undefined,
  }), {}, { signal: options.signal });
}

/**
 * The first `pages` chunks of a text file, joined. The viewer's "Load more"
 * asks for one more page, which reads the file again from the start: a chunk
 * is 256 KB, so a handful of pages is a few requests, and the result never
 * disagrees with itself.
 */
export async function readText(
  filePath: string,
  options: FileRequestOptions & { pages?: number } = {},
): Promise<FileText> {
  const pages = Math.max(1, options.pages ?? 1);
  let offset = 0;
  let content = "";
  let chunk: FileText | null = null;
  for (let index = 0; index < pages; index += 1) {
    chunk = await readFile(filePath, { ...options, offset });
    if (chunk.binary) return chunk;
    content += chunk.content;
    offset = chunk.nextOffset;
    if (!chunk.truncated) break;
  }
  if (!chunk) throw new Error("readText: no chunk was read");
  return { ...chunk, content };
}

/** One `?type=watch` frame, its `data` parsed. */
export interface FileWatchEvent {
  /** "connected" once the server's watcher exists, then "change", or "error". */
  event: string;
  /** `{}` when the frame's data is not a JSON object. */
  data: Record<string, unknown>;
}

/**
 * The server's file watch sends no keep-alive, so the stream is expected to be
 * silent between writes; the reconnect watchdog waits minutes rather than the
 * 75 s an agent stream's heartbeat allows (`sse.ts` `DEFAULT_STALE_MS`).
 */
export const FILE_WATCH_STALE_MS = 5 * 60_000;

function parseObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * `?type=watch` as a stream (`sse.ts` `openStream`): `change` on every write of
 * the file, the pair `{ mtime, size }` the `?type=meta` read would give.
 * Returns the `close()` that ends it (an effect can return it as its cleanup).
 */
export function watchFile(
  filePath: string,
  onEvent: (event: FileWatchEvent) => void,
  options: { signal?: AbortSignal; staleMs?: number } = {},
): () => void {
  return openStream(
    fileApiPath(filePath, "watch"),
    (frame) => onEvent({ event: frame.event ?? "message", data: parseObject(frame.data) }),
    { signal: options.signal, staleMs: options.staleMs ?? FILE_WATCH_STALE_MS },
  );
}

/** What `?type=upload` answers for the files it took (`POST`, multipart). */
export interface FileUploadResult {
  uploaded: string[];
  skipped: string[];
  errors: Array<{ name: string; error: string }>;
}


/**
 * How a name already in the folder is treated (`lib/file-upload.ts`).
 * `"rename"` is the attached route's addition: keep the old file and write
 * this one as `name (1).ext`.
 */
export type UploadConflict = "skip" | "rename" | "overwrite" | "error";

/**
 * `POST /api/files/<dir>?type=upload&conflict=…`: one multipart `files` field
 * per file, into `directory`. The route answers 207 when some files failed,
 * which is still an accepted upload (`req` reads 2xx as ok); the failures ride
 * in `errors`.
 */
export async function uploadFiles(
  directory: string,
  files: File[],
  conflict: UploadConflict = "skip",
): Promise<FileUploadResult> {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  return req<FileUploadResult>(
    `${withQuery(`/api/files/${filePathForApi(directory)}`, { type: "upload", conflict })}`,
    { method: "POST", body: form },
    { timeoutMs: 120_000 },
  );
}
