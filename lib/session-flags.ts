"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { SessionInfo } from "./types";
import {
  applySessionUiState,
  ensureSessionUiState,
  getSessionUiStateSnapshot,
  subscribeSessionUiState,
  whenSessionUiStateSettled,
  type SessionUiStateApi,
} from "./session-ui-state-store";
import type { SessionUiState } from "./session-ui-state-shared";

/**
 * fork:upstream-0.12-session-state（PR-3b）—— 会话的置顶 / 归档。
 *
 * 两者仍是**纯展示**：这里不改名、不移动、不删任何 `.jsonl` 文件。区别只在
 * 权威从 `localStorage` 换成了服务端状态（`/api/sessions/ui-state`，见
 * `lib/session-ui-state.ts`），于是换浏览器、换设备都跟着走，跨端同步也由
 * 服务端的 revision 兜住。
 *
 * 对外仍是**同步**接口（`getSessionFlags()` / `applySessionFlags()` 到处都是），
 * 从 store 的快照派生；`parseSessionFlags` 只是老数据的兼容解析器，保留给测试。
 */

export interface SessionFlags {
  pinned: string[];
  archived: string[];
  /**
   * fork:ui-archive-history — session id → 归档时间（ISO）。
   *
   * 「归档历史」页要按时间排序并显示「多久前归档」。服务端存的是 epoch ms，
   * 这里转成 ISO 保持老形状。
   */
  archivedAt: Record<string, string>;
}

// 派生缓存：state 对象身份 → flags。
let cache: { state: SessionUiState; flags: SessionFlags } | null = null;

const EMPTY: SessionFlags = { pinned: [], archived: [], archivedAt: {} };

function sanitizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))];
}

/** 老 localStorage 形状的兼容解析器（迁移 / 测试用）。 */
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

/** 服务端状态 → 老形状。 */
function flagsFromState(state: SessionUiState): SessionFlags {
  const pinned: string[] = [];
  const archived: string[] = [];
  const archivedAt: Record<string, string> = {};
  for (const [id, entry] of Object.entries(state.sessions)) {
    if (entry.pinnedAt !== undefined) pinned.push(id);
    if (entry.archivedAt !== undefined) {
      archived.push(id);
      archivedAt[id] = new Date(entry.archivedAt).toISOString();
    }
  }
  return { pinned, archived, archivedAt };
}

function snapshotFlags(api: SessionUiStateApi): SessionFlags {
  // store 每次 publish 都会新建对象；派生的 flags 按 state 对象身份缓存。
  if (cache !== null && cache.state === api.state) return cache.flags;
  const flags = flagsFromState(api.state);
  cache = { state: api.state, flags };
  return flags;
}

/** Non-hook accessor for imperative callers (context menu actions). */
export function getSessionFlags(): SessionFlags {
  return snapshotFlags(getSessionUiStateSnapshot());
}

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  ensureSessionUiState();
  return subscribeSessionUiState(() => {
    cache = null;
    cb();
  });
}

function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

export function togglePinned(id: string): void {
  ensureSessionUiState();
  const flags = getSessionFlags();
  void applySessionUiState({ action: "set", ids: [id], pinned: !flags.pinned.includes(id) });
}

export function toggleArchived(id: string): void {
  ensureSessionUiState();
  const flags = getSessionFlags();
  void applySessionUiState({ action: "set", ids: [id], archived: !flags.archived.includes(id) });
}

/**
 * fork:pi-1.1（上游 archiveFamilies / sidebar.archiveOlderThanWeek）—— 批量归档。
 *
 * 返回真正被新归档的 id，调用方据此决定要不要弹撤销条。乐观：本地立刻生效，
 * 服务端写异步跟上。
 */
export function archiveSessions(ids: readonly string[]): string[] {
  ensureSessionUiState();
  const current = getSessionFlags();
  const known = new Set(current.archived);
  const added = [...new Set(ids)].filter((id) => id && !known.has(id));
  if (added.length === 0) return [];
  void applySessionUiState({ action: "set", ids: added, archived: true });
  return added;
}

/** 批量撤销（归档条上的 Undo）：只恢复确实在归档里的那几个。 */
export function restoreSessions(ids: readonly string[]): string[] {
  ensureSessionUiState();
  const current = getSessionFlags();
  const known = new Set(current.archived);
  const restored = ids.filter((id) => known.has(id));
  if (restored.length === 0) return [];
  void applySessionUiState({ action: "set", ids: restored, archived: false });
  return restored;
}

/** 一行（或其家族）是否被钉在顶部。 */
export function isPinnedSession(id: string, flags: SessionFlags): boolean {
  return flags.pinned.includes(id);
}

/**
 * fork:pi-1.1（上游 2e87ddb1b）—— 「归档着且没有新动静」。
 *
 * 归档后**又收到新消息**的会话自动回到列表：拿 `modified` 与归档时间比。
 * 老数据没有归档时间（或时间解析不出来）时保守保持归档。
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
 * while keeping the existing relative order (a stable partition).
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
 */
export function archivedSessions<T extends Pick<SessionInfo, "id" | "modified">>(
  sessions: readonly T[],
  flags: SessionFlags,
): T[] {
  if (flags.archived.length === 0) return [];
  return sessions.filter((session) => isArchivedAndQuiet(session, flags));
}

/** 首次取状态（弱网/无网时也能拿到已缓存的那份）。 */
export { whenSessionUiStateSettled, ensureSessionUiState };

export function useSessionFlags() {
  const api = useSyncExternalStore(
    subscribeSessionUiState,
    getSessionUiStateSnapshot,
    getSessionUiStateSnapshot,
  );
  // 第一个订阅者触发 hydrate（不在模块加载时打网络）。
  ensureSessionUiState();
  const flags = useMemo(() => snapshotFlags(api), [api]);

  const pin = useCallback((id: string) => togglePinned(id), []);
  const archive = useCallback((id: string) => toggleArchived(id), []);

  return { flags, pin, archive, synced: api.synced, loaded: api.loaded, error: api.error };
}
