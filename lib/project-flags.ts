"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * fork:project-archive — project-level archive flag.
 *
 * Same hard rule as `lib/session-flags.ts`: this is **presentation only**. Archiving a
 * project hides its row from the sidebar; it never renames, moves or deletes a `.jsonl`,
 * and it never touches the directory on disk.
 *
 * The key is `SessionInfo.projectKey` — the **server-computed** project identity
 * (`projectIdentityKey(projectRoot)`, see `/api/worktrees`), not a path we assemble in
 * the browser. Two reasons:
 *
 *   1. It is the same identity the sidebar already groups by, so "an archived project"
 *      is exactly one row in the sidebar, worktrees included.
 *   2. Windows keys are case- and separator-insensitive on the server, so this store
 *      never has to re-implement path normalisation. (The reference implementation
 *      keyed its archive on a client-side normalised path and hit a real element-id
 *      collision when two spellings of one path slugged to the same id.)
 */

const STORAGE_KEY = "pi-project-flags";
const CHANGE_EVENT = "pi-project-flags-change";

export interface ProjectFlags {
  /** projectKey values. */
  archived: string[];
  /** projectKey → archive time (ISO). Older records may not have one. */
  archivedAt: Record<string, string>;
}

const EMPTY: ProjectFlags = { archived: [], archivedAt: {} };

const listeners = new Set<() => void>();
let cache: ProjectFlags | null = null;

function emit(): void {
  for (const cb of listeners) cb();
}

function sanitizeProjectKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))];
}

function sanitizeArchivedAt(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, at] of Object.entries(value as Record<string, unknown>)) {
    if (key && typeof at === "string" && at) out[key] = at;
  }
  return out;
}

export function parseProjectFlags(raw: string | null): ProjectFlags {
  if (!raw) return { ...EMPTY };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ...EMPTY };
    const record = parsed as Record<string, unknown>;
    return {
      archived: sanitizeProjectKeys(record.archived),
      archivedAt: sanitizeArchivedAt(record.archivedAt),
    };
  } catch {
    return { ...EMPTY };
  }
}

function read(): ProjectFlags {
  if (typeof window === "undefined") return EMPTY;
  try {
    return parseProjectFlags(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return EMPTY;
  }
}

function ensure(): ProjectFlags {
  if (cache === null) cache = read();
  return cache;
}

function write(next: ProjectFlags): void {
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — the in-memory flags still apply for this session.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  emit();
}

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    cache = null;
    emit();
  };
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** Archive or restore one project. The time is recorded only on archive. */
export function setProjectArchived(projectKey: string, archived: boolean): void {
  if (!projectKey || typeof window === "undefined") return;
  const current = ensure();
  if (archived === current.archived.includes(projectKey)) return;
  const next: ProjectFlags = {
    archived: archived
      ? [...current.archived, projectKey]
      : current.archived.filter((key) => key !== projectKey),
    archivedAt: { ...current.archivedAt },
  };
  if (archived) next.archivedAt[projectKey] = new Date().toISOString();
  else delete next.archivedAt[projectKey];
  write(next);
}

export function toggleProjectArchived(projectKey: string): void {
  setProjectArchived(projectKey, !ensure().archived.includes(projectKey));
}

export function getProjectFlags(): ProjectFlags {
  return ensure();
}

export function isProjectArchived(projectKey: string, flags: ProjectFlags): boolean {
  return flags.archived.includes(projectKey);
}

/** Split projects into the sidebar-visible set and the archived set. */
export function partitionProjects<T extends { key: string }>(
  projects: readonly T[],
  flags: ProjectFlags,
): { visible: T[]; archived: T[] } {
  if (flags.archived.length === 0) return { visible: [...projects], archived: [] };
  const archived = new Set(flags.archived);
  const visible: T[] = [];
  const hidden: T[] = [];
  for (const project of projects) {
    if (archived.has(project.key)) hidden.push(project);
    else visible.push(project);
  }
  return { visible, archived: hidden };
}

/**
 * Drop archived projects, keeping `keepKey` regardless.
 *
 * The selected project always stays visible — hiding the row the user is currently
 * working in would leave them unable to see where they are (the same rule
 * `filterHiddenProjects` follows for its own "remove from list" pref).
 */
export function filterArchivedProjects<T extends { key: string }>(
  projects: readonly T[],
  flags: ProjectFlags,
  keepKey?: string | null,
): T[] {
  if (flags.archived.length === 0) return [...projects];
  const archived = new Set(flags.archived);
  return projects.filter((project) => !archived.has(project.key) || project.key === keepKey);
}

export function useProjectFlags() {
  const flags = useSyncExternalStore(subscribe, ensure, () => EMPTY);

  const archive = useCallback((projectKey: string) => toggleProjectArchived(projectKey), []);
  const restore = useCallback((projectKey: string) => setProjectArchived(projectKey, false), []);

  return { flags, archive, restore };
}
