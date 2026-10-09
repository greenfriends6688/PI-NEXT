"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { SessionInfo } from "./types";

/**
 * Client-side session flags: pinned and archived.
 *
 * Both are **presentation-only**. Nothing here renames, moves or deletes a
 * `.jsonl` file — that is a hard rule for this app (a session the user cannot
 * see is still a session the user owns), and it is why these flags live in
 * `localStorage` rather than in the session file.
 *
 * Stored as two id arrays under one key so a flag write is a single atomic
 * `setItem`. Cross-tab changes arrive through the `storage` event; same-tab
 * changes through a custom event (the `storage` event does not fire in the
 * originating tab).
 */

const STORAGE_KEY = "pi-session-flags";
const CHANGE_EVENT = "pi-session-flags-change";

/*
 * fork:no-session-tag（用户 2026-10-01）—— 手动「状态标记」（`SESSION_TAGS` / `tags` /
 * 彩色点）整块退役：它只改 localStorage，刷新后没人再看，右侧那个点也没人认得。
 * `parseSessionFlags` 照旧忽略老 payload 里残留的 `tags` 字段。
 */

export interface SessionFlags {
  pinned: string[];
  archived: string[];
  /**
   * fork:ui-archive-history — session id → 归档时间（ISO）。
   *
   * 「归档历史」页要按时间排序并显示「多久前归档」，光有一串 id 排不出来。老数据没有这个
   * 字段，解析时按缺失处理（这些行按 id 顺序排在末尾）。
   */
  archivedAt: Record<string, string>;
}

const EMPTY: SessionFlags = { pinned: [], archived: [], archivedAt: {} };

const listeners = new Set<() => void>();
let cache: SessionFlags | null = null;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function sanitizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))];
}

export function parseSessionFlags(raw: string | null): SessionFlags {
  if (!raw) return { ...EMPTY };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ...EMPTY };
    const record = parsed as Record<string, unknown>;
    return {
      pinned: sanitizeIdList(record.pinned),
      archived: sanitizeIdList(record.archived),
      archivedAt: sanitizeArchivedAt(record.archivedAt),
    };
  } catch {
    return { ...EMPTY };
  }
}

/** id → ISO 时间戳；坏值丢掉（历史页会按「未知时间」渲染）。 */
function sanitizeArchivedAt(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [id, at] of Object.entries(value as Record<string, unknown>)) {
    if (id && typeof at === "string" && at) out[id] = at;
  }
  return out;
}

function read(): SessionFlags {
  if (typeof window === "undefined") return EMPTY;
  try {
    return parseSessionFlags(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return EMPTY;
  }
}

function ensure(): SessionFlags {
  if (cache === null) cache = read();
  return cache;
}

function write(next: SessionFlags): void {
  cache = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable — the in-memory flags still apply for this session
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

function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

export function togglePinned(id: string): void {
  const current = ensure();
  write({ ...current, pinned: toggleIn(current.pinned, id) });
}

export function toggleArchived(id: string): void {
  const current = ensure();
  const archived = toggleIn(current.archived, id);
  const archivedAt = { ...current.archivedAt };
  if (archived.includes(id)) archivedAt[id] = new Date().toISOString();
  else delete archivedAt[id];
  write({ ...current, archived, archivedAt });
}

/**
 * fork:pi-1.1（上游 archiveFamilies / sidebar.archiveOlderThanWeek）—— 批量归档。
 *
 * 一次写盘的原子操作：给每个 id 记同一个归档时刻，**不存在的 id 不写**（归档一个
 * 已经不在列表里的会话是空操作）。返回真正被新归档的 id，调用方据此决定要不要弹
 * 撤销条。
 */
export function archiveSessions(ids: readonly string[]): string[] {
  const current = ensure();
  const known = new Set(current.archived);
  // 入参可能带重复（家族展开 / 两次点击）：先去重再筛，否则同一个 id 会被写两遍。
  const added = [...new Set(ids)].filter((id) => id && !known.has(id));
  if (added.length === 0) return [];
  const at = new Date().toISOString();
  const archivedAt = { ...current.archivedAt };
  for (const id of added) archivedAt[id] = at;
  write({ ...current, archived: [...current.archived, ...added], archivedAt });
  return added;
}

/** 批量撤销（归档条上的 Undo）：只恢复确实在归档里的那几个。 */
export function restoreSessions(ids: readonly string[]): string[] {
  const current = ensure();
  const known = new Set(current.archived);
  const restored = ids.filter((id) => known.has(id));
  if (restored.length === 0) return [];
  const drop = new Set(restored);
  const archivedAt = { ...current.archivedAt };
  for (const id of restored) delete archivedAt[id];
  write({ ...current, archived: current.archived.filter((id) => !drop.has(id)), archivedAt });
  return restored;
}

/** 一行（或其家族）是否被钉在顶部。 */
export function isPinnedSession(id: string, flags: SessionFlags): boolean {
  return flags.pinned.includes(id);
}

/** Non-hook accessor for imperative callers (context menu actions). */
export function getSessionFlags(): SessionFlags {
  return ensure();
}

/**
 * fork:pi-1.1（上游 2e87ddb1b）—— 「归档着且没有新动静」。
 *
 * 归档后**又收到新消息**的会话自动回到列表：拿 `modified` 与归档时间（`archivedAt`）
 * 比。老数据没有归档时间（或时间解析不出来）时保守保持归档，不会把用户手动的归档
 * 当成自动回退。
 */
export function isArchivedAndQuiet(
  session: Pick<SessionInfo, "id" | "modified">,
  flags: SessionFlags,
): boolean {
  if (!flags.archived.includes(session.id)) return false;
  const archivedAt = Date.parse(flags.archivedAt?.[session.id] ?? "");
  const modified = Date.parse(session.modified);
  if (!Number.isFinite(archivedAt) || !Number.isFinite(modified)) return true;
  return modified <= archivedAt;
}

/**
 * Filter + order one project's sessions.
 *
 * Archived sessions are dropped from the main list; pinned ones move to the top
 * while keeping the existing relative order (a stable partition, so the list
 * does not reshuffle when a second session is pinned).
 */
export function applySessionFlags<T extends Pick<SessionInfo, "id" | "modified">>(
  sessions: readonly T[],
  flags: SessionFlags,
): T[] {
  if (flags.archived.length === 0 && flags.pinned.length === 0) return [...sessions];
  const pinned = new Set(flags.pinned);
  const visible: T[] = [];
  const pinnedRows: T[] = [];
  for (const session of sessions) {
    if (isArchivedAndQuiet(session, flags)) continue;
    if (pinned.has(session.id)) pinnedRows.push(session);
    else visible.push(session);
  }
  return [...pinnedRows, ...visible];
}

/**
 * The archived rows of one session list.
 *
 * `applySessionFlags` intentionally drops archived sessions from the main
 * list; this is the explicit counterpart a caller uses to surface them again
 * (the sidebar's per-project "Archived" section), so the two behaviours stay
 * independent instead of weakening the filter for existing callers.
 */
export function archivedSessions<T extends Pick<SessionInfo, "id" | "modified">>(
  sessions: readonly T[],
  flags: SessionFlags,
): T[] {
  if (flags.archived.length === 0) return [];
  return sessions.filter((session) => isArchivedAndQuiet(session, flags));
}

export function useSessionFlags() {
  const flags = useSyncExternalStore(subscribe, ensure, () => EMPTY);

  const pin = useCallback((id: string) => togglePinned(id), []);
  const archive = useCallback((id: string) => toggleArchived(id), []);

  return { flags, pin, archive };
}
