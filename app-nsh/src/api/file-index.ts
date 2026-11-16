// The project's file index, for `@` mentions in the composer
// (`app/api/file-index/route.ts`).
//
// The parsing and ranking are the TUI's own, ported in `lib/file-fuzzy.ts`:
// this module only fetches and caches.
import { req, withQuery, type RequestOptions } from "./client";
import { buildEntriesFromFiles, filterFileEntries, type FileIndexEntry } from "../lib/file-fuzzy";

/** `GET /api/file-index` with no query: every tracked or walked path of `cwd`. */
export interface FileIndexListing {
  files: string[];
  truncated?: boolean;
}

/** One ranked match the server answered for a query. */
export interface FileIndexMatch {
  path: string;
  isDir: boolean;
}

/** `GET /api/file-index?q=`: the server's own ranking (finds deep files). */
export interface FileIndexMatches {
  matches: FileIndexMatch[];
}

/**
 * The index of `cwd`. Without `q` the whole listing comes back (`files`,
 * relative to `cwd`, capped — `route.ts:103-108`); with it, the server ranks
 * against the full listing so a repository past the cap still finds a deep
 * file.
 */
export async function loadFileIndex(
  cwd: string,
  q = "",
  options: RequestOptions = {},
): Promise<FileIndexListing | FileIndexMatches> {
  return req<FileIndexListing | FileIndexMatches>(
    withQuery("/api/file-index", { cwd, q: q.trim() || undefined }),
    {},
    options,
  );
}

/**
 * The listing as the `@` menu's entries (`buildEntriesFromFiles`), or the
 * server's matches in the same shape.
 *
 * One `cwd` keeps one listing for the app's life: the composer opens this menu
 * on every `@`, and a repository's index changes rarely enough that a stale
 * entry costs a failed read, not a wrong answer. `force` reloads it (the `@`
 * menu's "Reload" row).
 */
const listings = new Map<string, FileIndexEntry[]>();

export function cachedListing(cwd: string): FileIndexEntry[] | undefined {
  return listings.get(cwd);
}

/** Loads (and caches) the listing of `cwd`; a failure leaves the cache alone. */
export async function ensureListing(cwd: string, force = false): Promise<FileIndexEntry[]> {
  if (!force) {
    const cached = listings.get(cwd);
    if (cached !== undefined) return cached;
  }
  const answer = await loadFileIndex(cwd);
  const files = "files" in answer ? answer.files : answer.matches.map((match) => match.path);
  const entries = buildEntriesFromFiles(files);
  listings.set(cwd, entries);
  return entries;
}

/** Drops a cached listing (a session moved, the tree changed a lot). */
export function forgetListing(cwd: string): void {
  listings.delete(cwd);
}

/**
 * The `@` menu's rows for `query`: the cached listing filtered and ranked as
 * the TUI does (`filterFileEntries`).
 */
export function mentionEntries(cwd: string, query: string, limit?: number): FileIndexEntry[] {
  const entries = listings.get(cwd);
  if (entries === undefined) return [];
  return filterFileEntries(entries, query, limit);
}
