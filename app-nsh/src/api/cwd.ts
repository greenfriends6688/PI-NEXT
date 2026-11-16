// The directory routes a fresh session chooses its folder with: the home
// folder, today's `~/pi-cwd` folder, the browser and the validation that makes
// a folder usable (and allowed for `/api/files`), plus the desktop file
// manager's availability.
//
// Every shape is copied from the route that writes it
// (`app/api/home/route.ts:4-6`, `app/api/default-cwd/route.ts:8-15`,
// `app/api/cwd/browse/route.ts:19-48`, `:76-77`,
// `app/api/cwd/validate/route.ts:40-45`,
// `app/api/open-in-explorer/route.ts:18-21`, `:24-48`); requests go through
// `client.req` / `client.postJson`, so they inherit the endpoint, the LAN
// token, the timeout and `ApiError` (which keeps the route's `{ error }`).

import { postJson, req, withQuery, type RequestOptions } from "./client";

/** One folder of a browse answer (`lib/directory-browser.ts:5-8`). */
export interface DirectoryEntry {
  name: string;
  path: string;
}

/**
 * `GET /api/cwd/browse?path=` (route :19-48). The Windows drive picker
 * (route :20-25) answers `path: ""`, `parentPath: null`, the drives and no
 * directories; every other answer carries the resolved folder, its parent
 * (`null` at a root) and its readable subdirectories.
 */
export interface BrowseResponse {
  path: string;
  parentPath: string | null;
  directories: DirectoryEntry[];
  /** Present only for the Windows drive picker, possibly empty. */
  drives?: DirectoryEntry[];
}

/** `GET /api/home` (route :4-6). */
export interface HomeResponse {
  home: string;
}

/** `POST /api/default-cwd` (route :8-15): `~/pi-cwd/<YYYYMMDD>`, created. */
export interface DefaultCwdResponse {
  cwd: string;
}

/** `POST /api/cwd/browse` body `{ path, name }` (route :54-77). */
export interface CreateDirectoryResponse {
  success: true;
  /** The created folder's real path. */
  path: string;
}

/**
 * `POST /api/cwd/validate` (route :15-45). `cwd` is normalized (`~` resolved,
 * a relative path made absolute), `projectRoot`/`projectKey` are Git's
 * project identity (`resolveProject()` + `projectIdentityKey()`), and the
 * folder becomes an allowed root for `/api/files`.
 */
export interface ValidatedCwd {
  success: true;
  cwd: string;
  projectRoot: string;
  projectKey: string;
}

/** `GET /api/open-in-explorer` (route :10-21). */
export interface ExplorerAvailability {
  supported: boolean;
  /** `"remote"`, `"unsupported-platform"`, or null when supported. */
  reason: string | null;
  platform: string;
}

/** `POST /api/open-in-explorer` (route :24-48). */
export interface ExplorerOpened {
  opened: true;
}

/** `GET /api/home` — the server process's home folder. */
export function getHome(options: RequestOptions = {}): Promise<HomeResponse> {
  return req<HomeResponse>("/api/home", {}, options);
}

/** `POST /api/default-cwd` — creates and answers today's `~/pi-cwd/<YYYYMMDD>`. */
export function createDefaultCwd(options: RequestOptions = {}): Promise<DefaultCwdResponse> {
  return req<DefaultCwdResponse>("/api/default-cwd", { method: "POST" }, options);
}

/**
 * `GET /api/cwd/browse` — lists `path`'s readable subdirectories. No path (or
 * an empty one) answers the home folder, except on Windows, where the server
 * answers the drive picker instead.
 */
export function browseDirectory(
  path?: string | null,
  options: RequestOptions = {},
): Promise<BrowseResponse> {
  return req<BrowseResponse>(withQuery("/api/cwd/browse", { path }), {}, options);
}

/** `POST /api/cwd/browse` — creates one direct child of `parentPath`. */
export function createDirectory(
  parentPath: string,
  name: string,
  options: RequestOptions = {},
): Promise<CreateDirectoryResponse> {
  return postJson<CreateDirectoryResponse>("/api/cwd/browse", { path: parentPath, name }, options);
}

/** `POST /api/cwd/validate` — the normalized folder and its project identity. */
export function validateCwd(cwd: string, options: RequestOptions = {}): Promise<ValidatedCwd> {
  return postJson<ValidatedCwd>("/api/cwd/validate", { cwd }, options);
}

/**
 * `GET /api/open-in-explorer` — whether this connection may open a file
 * manager on the server: only a loopback request on a platform with one
 * (`isLoopbackHost()` + `isFileManagerSupported()`).
 */
export function openInExplorerAvailability(options: RequestOptions = {}): Promise<ExplorerAvailability> {
  return req<ExplorerAvailability>("/api/open-in-explorer", {}, options);
}

/** `POST /api/open-in-explorer` — opens `cwd` in the server's file manager. */
export function openInExplorer(cwd: string, options: RequestOptions = {}): Promise<ExplorerOpened> {
  return postJson<ExplorerOpened>("/api/open-in-explorer", { cwd }, options);
}
