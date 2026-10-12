/**
 * fork:ui-project-actions — 项目行的本地偏好：**显示名**与**从列表中移除**。
 *
 * fork:upstream-0.12-session-state（PR-3b）—— 拆成两个来源：
 *   · **显示名**走服务端（上游 `SessionUiState.projectNames`，键是 `projectKey`），
 *     所以换浏览器也跟着走，与分组菜单里的「重命名…」是同一个入口；
 *   · **从列表中移除**是本仓 fork 独有的（`hidden`，纯前端概念，跟着路径走），
 *     仍留 `localStorage`。
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  applySessionUiState,
  ensureSessionUiState,
  getSessionUiStateSnapshot,
  subscribeSessionUiState,
  type SessionUiStateApi,
} from "./session-ui-state-store";
import type { SessionUiState } from "./session-ui-state-shared";

export const PROJECT_PREFS_STORAGE_KEY = "pi-project-prefs";
const CHANGE_EVENT = "pi-project-prefs-change";

export interface ProjectPrefs {
  /** projectKey → 显示名（服务端）。 */
  aliases: Record<string, string>;
  /** 从列表中移除过的项目根路径（本机）。 */
  hidden: string[];
}

const EMPTY: ProjectPrefs = { aliases: {}, hidden: [] };

export function parseProjectPrefs(raw: string | null): ProjectPrefs {
  if (!raw) return { ...EMPTY, aliases: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ...EMPTY, aliases: {} };
    const record = parsed as Record<string, unknown>;
    const aliases: Record<string, string> = {};
    if (record.aliases && typeof record.aliases === "object" && !Array.isArray(record.aliases)) {
      for (const [key, name] of Object.entries(record.aliases as Record<string, unknown>)) {
        if (key && typeof name === "string" && name.trim()) aliases[key] = name.trim();
      }
    }
    const hidden = Array.isArray(record.hidden)
      ? [...new Set(record.hidden.filter((item): item is string => typeof item === "string" && item.length > 0))]
      : [];
    return { aliases, hidden };
  } catch {
    return { ...EMPTY, aliases: {} };
  }
}

/**
 * 路径最后一段。单独拎出来是因为这条规则不止项目行在用
 * （fork:mobile-tb-subtitle 的顶栏副行也要显示 cwd 的目录名）。
 */
export function pathBasename(root: string): string {
  return root.split(/[/\\]/).filter(Boolean).at(-1) ?? root;
}

/** 项目行的显示名：有别名（服务端 `projectNames`，键 projectKey）用别名，否则用目录名。 */
export function projectDisplayName(projectKey: string, root: string, prefs: ProjectPrefs): string {
  const alias = prefs.aliases[projectKey];
  if (alias) return alias;
  return pathBasename(root);
}

/** 过滤掉「从列表中移除」过的项目（当前选中的那个始终保留）。 */
export function filterHiddenProjects<T extends { root: string }>(
  projects: readonly T[],
  prefs: ProjectPrefs,
  keepRoot?: string | null,
): T[] {
  if (prefs.hidden.length === 0) return [...projects];
  const hidden = new Set(prefs.hidden);
  return projects.filter((project) => !hidden.has(project.root) || project.root === keepRoot);
}

// ── 本机那份（只有 hidden）──────────────────────────────────────────────────
let hiddenCache: { hidden: string[] } | null = null;

function readHidden(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return parseProjectPrefs(window.localStorage.getItem(PROJECT_PREFS_STORAGE_KEY)).hidden;
  } catch {
    return [];
  }
}

function writeHidden(hidden: string[]): void {
  hiddenCache = { hidden };
  try {
    window.localStorage.setItem(PROJECT_PREFS_STORAGE_KEY, JSON.stringify({ hidden }));
  } catch {
    // 存储不可用：本次会话内仍然生效
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

// ── 派生（服务端名字 + 本机 hidden）────────────────────────────────────────
let cache: { state: SessionUiState; prefs: ProjectPrefs } | null = null;

function snapshotPrefs(api: SessionUiStateApi): ProjectPrefs {
  if (cache !== null && cache.state === api.state) return cache.prefs;
  if (hiddenCache === null) hiddenCache = { hidden: readHidden() };
  const prefs: ProjectPrefs = {
    aliases: { ...(api.state.projectNames ?? {}) },
    hidden: hiddenCache.hidden,
  };
  cache = { state: api.state, prefs };
  return prefs;
}

export function getProjectPrefs(): ProjectPrefs {
  return snapshotPrefs(getSessionUiStateSnapshot());
}

// 本机 hidden 的变更事件。
const listeners = new Set<() => void>();
function subscribeLocal(cb: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PROJECT_PREFS_STORAGE_KEY) return;
    hiddenCache = null;
    cache = null;
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
    cache = null;
    cb();
  });
  const offLocal = subscribeLocal(() => {
    cache = null;
    cb();
  });
  return () => {
    offStore();
    offLocal();
  };
}

export function useProjectPrefs() {
  const prefs = useSyncExternalStore(subscribe, getProjectPrefs, () => EMPTY);

  /** 设置显示名（服务端；空名 = 清掉，回到目录名）。 */
  const setAlias = useCallback((projectKey: string, name: string) => {
    ensureSessionUiState();
    const trimmed = name.trim();
    void applySessionUiState({ action: "rename-project", projectKey, name: trimmed || null });
  }, []);

  const hideProject = useCallback((root: string) => {
    const current = readHidden();
    if (current.includes(root)) return;
    writeHidden([...current, root]);
  }, []);

  const restoreProject = useCallback((root: string) => {
    const current = readHidden();
    if (!current.includes(root)) return;
    writeHidden(current.filter((item) => item !== root));
  }, []);

  return { prefs, setAlias, hideProject, restoreProject };
}
