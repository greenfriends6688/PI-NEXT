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

/** fork:react-18-snapshot —— 同一个引用：内联 `new Set()` 每次都是新对象，
 * React 会认为快照一直在变（见 hooks/useUiFont.ts 同一条）。 */
const EMPTY_UNREAD: ReadonlySet<string> = new Set<string>();

export function useUnreadSessions(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getUnreadSessionIds, () => EMPTY_UNREAD);
}

export function useUnreadActions(): {
  mark: (id: string) => void;
  clear: (id: string) => void;
} {
  const mark = useCallback((id: string) => markSessionUnread(id), []);
  const clear = useCallback((id: string) => clearSessionUnread(id), []);
  return { mark, clear };
}

/* ── 读到哪（画板 D-03 帧 C 的未读分割）──────────────────────────────────
 * 未读点只能回答「这条会话有新东西」，回答不了「读到哪一行了」——而画板那一帧的
 * 主体是转录里的分割线（两条发丝线 + 「↓ 以下是你离开后发生的」）与顶栏那枚
 * 「3 条新消息」徽标，两者都要一个数：**上次离开这条会话时看到的条数**。
 *
 * 与上面的未读点是两件事，不合并：未读点回答「要不要点进去」，读到哪回答
 * 「点进去之后从哪读」。所以是第二个 store（同一个文件、同一形状），键是
 * `sessionId → 条数`，ChatWindow 离开时写、转录里读。
 */
const CURSOR_KEY = "pi-web:session-read-cursors";

type CursorListener = () => void;

const cursorListeners = new Set<CursorListener>();
let cursorCache: Record<string, number> | null = null;

function cursorEmit(): void {
  cursorListeners.forEach((listener) => listener());
}

function cursorSubscribe(listener: CursorListener): () => void {
  cursorListeners.add(listener);
  return () => cursorListeners.delete(listener);
}

function readCursors(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CURSOR_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[id] = Math.floor(value);
    }
    return out;
  } catch {
    return {};
  }
}

function writeCursors(value: Record<string, number>): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(value).length === 0) window.localStorage.removeItem(CURSOR_KEY);
    else window.localStorage.setItem(CURSOR_KEY, JSON.stringify(value));
  } catch {
    // 写不进去就只在本次会话内有效（与未读点同一条策略）。
  }
}

export function getReadCursors(): Record<string, number> {
  cursorCache ??= readCursors();
  return cursorCache;
}

/** 离开一条会话时写「我看到这里了」。删除的会话在这里顺手丢掉（不增长）。 */
export function setReadCursor(id: string, count: number): void {
  if (!id || !Number.isFinite(count) || count < 0) return;
  const previous = getReadCursors();
  const rounded = Math.floor(count);
  if (previous[id] === rounded) return;
  const next = { ...previous, [id]: rounded };
  cursorCache = next;
  writeCursors(next);
  cursorEmit();
}

/** 丢掉已删除会话的读数（会话列表刷新后调用）。 */
export function pruneReadCursors(eligibleIds: ReadonlySet<string>): void {
  const previous = getReadCursors();
  const next: Record<string, number> = {};
  for (const [id, value] of Object.entries(previous)) if (eligibleIds.has(id)) next[id] = value;
  if (Object.keys(next).length === Object.keys(previous).length) return;
  cursorCache = next;
  writeCursors(next);
  cursorEmit();
}

/** 没写过读数（第一次打开）给 0：全部都是「上次离开后发生的」，但那正是首次进入，
 * 不该在开头画一条分割线 —— 调用方拿它与总数比较后自行决定要不要画。 */
const EMPTY_CURSORS: Record<string, number> = {};

export function useReadCursors(): Readonly<Record<string, number>> {
  return useSyncExternalStore(cursorSubscribe, getReadCursors, () => EMPTY_CURSORS);
}