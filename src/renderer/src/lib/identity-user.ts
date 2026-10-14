/**
 * fork:ai-identity —— 本机用户名的一个只读缓存。
 *
 * 「AI 身份 → 同步用户资料」要用它画 initials，聊天里的身份行和设置页的预览读的必须是
 * **同一份** —— 预览与实际不一致是这类页面最常见的谎。它来自 Main（`os.userInfo()`），
 * 一次取用、进程内缓存；取不到时保持空串，那一态就退回名字/头像。
 *
 * 与 `stores/settings` 同一条纪律：`useSyncExternalStore` 的快照必须是同一引用，
 * 这里缓存的就是一个字符串本身，天然满足。
 */

import { useEffect, useSyncExternalStore } from "react";

let cached = "";
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: string): void {
  if (next === cached) return;
  cached = next;
  for (const listener of listeners) listener();
}

export function getUserName(): string {
  return cached;
}

/** 拉一次（幂等）。读不到就保持空串。 */
export function ensureUserName(): void {
  if (loading) return;
  loading = window.pinext.app
    .getInfo()
    .then((info) => publish(typeof info.userName === "string" ? info.userName : ""))
    .catch(() => undefined);
}

export function useUserName(): string {
  const userName = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getUserName,
    getUserName,
  );
  useEffect(() => {
    ensureUserName();
  }, []);
  return userName;
}
