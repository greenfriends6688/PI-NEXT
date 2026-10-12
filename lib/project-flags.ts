"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  applySessionUiState,
  ensureSessionUiState,
  getSessionUiStateSnapshot,
  subscribeSessionUiState,
  type SessionUiStateApi,
} from "./session-ui-state-store";
import type { SessionUiState } from "./session-ui-state-shared";

/**
 * fork:project-archive —— 项目级的「归档」与「置顶」。
 *
 * 与 `lib/session-flags.ts` 同一条硬规矩：**纯展示**。归档一个项目只是把它的行
 * 从侧栏藏起来；绝不改名、移动、删除任何 `.jsonl`，也绝不碰磁盘上的目录。
 *
 * fork:upstream-0.12-session-state（PR-3b）—— 拆成两个来源：
 *   · **置顶**走服务端（上游 `SessionUiState.projects` 只有它：`pinnedAt` + `root`），
 *     所以换浏览器也跟着走；
 *   · **归档**上游没有这个概念（`SessionUiState` 里没有项目归档字段），是本仓
 *     独有的，仍留 `localStorage`。
 */

const STORAGE_KEY = "pi-project-flags";

export interface ProjectFlags {
  /** projectKey values.（本机） */
  archived: string[];
  /** projectKey → archive time (ISO). Older records may not have one.（本机） */
  archivedAt: Record<string, string>;
  /** 置顶的项目 key（服务端）。 */
  pinned: string[];
}

const EMPTY: ProjectFlags = { archived: [], archivedAt: {}, pinned: [] };

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

/** 老 localStorage 形状的兼容解析器（迁移 / 测试用）。 */
export function parseProjectFlags(raw: string | null): ProjectFlags {
  if (!raw) return { ...EMPTY };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ...EMPTY };
    const record = parsed as Record<string, unknown>;
    return {
      archived: sanitizeProjectKeys(record.archived),
      archivedAt: sanitizeArchivedAt(record.archivedAt),
      pinned: sanitizeProjectKeys(record.pinned),
    };
  } catch {
    return { ...EMPTY };
  }
}

/** 本机那份（只有归档）。 */
function readArchive(): { archived: string[]; archivedAt: Record<string, string> } {
  if (typeof window === "undefined") return { archived: [], archivedAt: {} };
  try {
    const parsed = parseProjectFlags(window.localStorage.getItem(STORAGE_KEY));
    return { archived: parsed.archived, archivedAt: parsed.archivedAt };
  } catch {
    return { archived: [], archivedAt: {} };
  }
}

function writeArchive(next: { archived: string[]; archivedAt: Record<string, string> }): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — the in-memory flags still apply for this session.
  }
}

/** 派生缓存：state 对象身份 → 归档 + 服务端置顶。 */
let archiveCache: { archived: string[]; archivedAt: Record<string, string> } | null = null;
let flagsCache: { api: SessionUiStateApi; flags: ProjectFlags } | null = null;

function snapshotFlags(api: SessionUiStateApi): ProjectFlags {
  if (flagsCache !== null && flagsCache.api.state === api.state) return flagsCache.flags;
  if (archiveCache === null) archiveCache = readArchive();
  const flags: ProjectFlags = {
    archived: archiveCache.archived,
    archivedAt: archiveCache.archivedAt,
    pinned: Object.keys(api.state.projects),
  };
  flagsCache = { api, flags };
  return flags;
}

/** Archive or restore one project. The time is recorded only on archive. */
export function setProjectArchived(projectKey: string, archived: boolean): void {
  if (!projectKey || typeof window === "undefined") return;
  const current = readArchive();
  if (archived === current.archived.includes(projectKey)) return;
  const archivedAt = { ...current.archivedAt };
  if (archived) archivedAt[projectKey] = new Date().toISOString();
  else delete archivedAt[projectKey];
  archiveCache = {
    archived: archived ? [...current.archived, projectKey] : current.archived.filter((key) => key !== projectKey),
    archivedAt,
  };
  writeArchive(archiveCache);
  flagsCache = null;
  emitLocal();
}

export function toggleProjectArchived(projectKey: string): void {
  setProjectArchived(projectKey, !readArchive().archived.includes(projectKey));
}

/** 置顶 / 取消置顶一个项目。走服务端（`root` 是服务端状态的一部分）。 */
export function setProjectPinned(projectKey: string, pinned: boolean, root: string): void {
  if (!projectKey || !root) return;
  ensureSessionUiState();
  if (pinned === getProjectFlags().pinned.includes(projectKey)) return;
  void applySessionUiState({ action: "pin-project", projectKey, root, pinned });
}

export function toggleProjectPinned(projectKey: string, root: string): void {
  setProjectPinned(projectKey, !getProjectFlags().pinned.includes(projectKey), root);
}

/**
 * fork:pi-1.1 —— 置顶的项目排在最前，其余保持原顺序（稳定分区，与
 * `applySessionFlags` 的会话置顶同一套语义）。
 */
export function applyProjectPins<T extends { key: string }>(
  projects: readonly T[],
  flags: ProjectFlags,
): T[] {
  if (flags.pinned.length === 0) return [...projects];
  const pinned = new Set(flags.pinned);
  const top: T[] = [];
  const rest: T[] = [];
  for (const project of projects) {
    if (pinned.has(project.key)) top.push(project);
    else rest.push(project);
  }
  return [...top, ...rest];
}

export function getProjectFlags(): ProjectFlags {
  return snapshotFlags(getSessionUiStateSnapshot());
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

// 本机归档的变更事件（`storage` 事件不在发起标签触发，所以另有自定义事件）。
const listeners = new Set<() => void>();
const CHANGE_EVENT = "pi-project-flags-change";
function emitLocal(): void {
  for (const cb of listeners) cb();
}
function subscribeLocal(cb: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    archiveCache = null;
    flagsCache = null;
    cb();
  };
  window.addEventListener(CHANGE_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  ensureSessionUiState();
  const offStore = subscribeSessionUiState(() => {
    flagsCache = null;
    cb();
  });
  const offLocal = subscribeLocal(() => {
    flagsCache = null;
    cb();
  });
  return () => {
    offStore();
    offLocal();
  };
}

export function useProjectFlags() {
  const flags = useSyncExternalStore(subscribe, getProjectFlags, () => EMPTY);
  const archive = useCallback((projectKey: string) => toggleProjectArchived(projectKey), []);
  const restore = useCallback((projectKey: string) => setProjectArchived(projectKey, false), []);
  const pin = useCallback((projectKey: string, root: string) => toggleProjectPinned(projectKey, root), []);
  return { flags, archive, restore, pin };
}
