"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * lib/session-unread.ts — fork:trace-menu
 *
 * 「标记为未读」的共享存储。ZCode 的任务菜单里有这一项，而未读点一直只活在
 * SessionSidebar 的 `useState` 里，外部点不到。抽成和 `lib/session-flags.ts`
 * 同形状的小 store（localStorage + 自定义事件 + `useSyncExternalStore`）：
 * 侧栏继续画它已有的未读点，菜单这一侧能写。
 *
 * 语义不变：会话被打开时清掉它的未读标记（SessionSidebar 的那个 effect 负责），
 * 子代理完成不标未读。
 */

const STORAGE_KEY = "pi-web:unread-session-ids";

type Listener = () => void;

const listeners = new Set<Listener>();
let cache: Set<string> | null = null;

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0));
  } catch {
    // 隐私模式 / 配额错误：未读标记是提示，丢了不该拦住任何功能。
    return new Set();
  }
}

function write(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    if (ids.size === 0) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // 同上：写不进去就只在本次会话里有效。
  }
}

/** 当前未读会话 id（缓存一份，避免每次渲染都读一遍 localStorage）。 */
export function getUnreadSessionIds(): Set<string> {
  cache ??= read();
  return cache;
}

function update(mutate: (previous: Set<string>) => Set<string>): void {
  const previous = getUnreadSessionIds();
  const next = mutate(previous);
  if (next === previous) return;
  cache = next;
  write(next);
  emit();
}

export function markSessionUnread(id: string): void {
  if (!id) return;
  update((previous) => (previous.has(id) ? previous : new Set(previous).add(id)));
}

export function clearSessionUnread(id: string): void {
  update((previous) => {
    if (!previous.has(id)) return previous;
    const next = new Set(previous);
    next.delete(id);
    return next;
  });
}

/** 丢掉已删除 / 不再符合条件的会话的标记（侧栏刷新列表后调用）。 */
export function pruneSessionUnread(eligibleIds: ReadonlySet<string>): void {
  update((previous) => {
    if (previous.size === 0) return previous;
    const next = new Set([...previous].filter((id) => eligibleIds.has(id)));
    return next.size === previous.size ? previous : next;
  });
}

export function useUnreadSessions(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getUnreadSessionIds, () => new Set<string>());
}

export function useUnreadActions(): {
  mark: (id: string) => void;
  clear: (id: string) => void;
} {
  const mark = useCallback((id: string) => markSessionUnread(id), []);
  const clear = useCallback((id: string) => clearSessionUnread(id), []);
  return { mark, clear };
}