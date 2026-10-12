"use client";

/**
 * fork:ai-identity —— 客户端读数：聊天里显示成谁。
 *
 * 与 `hooks/useFeatureFlags.ts` 同一条纪律：**快照必须是同一引用**。
 * `resolveIdentity()` 每次都返回新对象，直接把它当 `useSyncExternalStore` 的快照会让
 * React 判定「快照没缓存」并无限重渲染（React #185 —— 2026-10-13 刚被咬过一次）。
 * 所以只在三态真的变了之后才替换 `current`。
 */

import { useEffect, useSyncExternalStore } from "react";

import { EMPTY_IDENTITY, resolveIdentity, type AgentIdentity } from "@/lib/identity";

let current: AgentIdentity = EMPTY_IDENTITY;
let userName = "";
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: AgentIdentity, nextUserName: string): void {
  const changed = next.name !== current.name
    || next.avatar !== current.avatar
    || next.syncWithUserProfile !== current.syncWithUserProfile
    || nextUserName !== userName;
  if (!changed) return;
  current = next;
  userName = nextUserName;
  listeners.forEach((listener) => listener());
}

export function subscribeIdentity(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 同一个引用，除非三态真的变了。 */
export function getIdentitySnapshot(): AgentIdentity {
  return current;
}

export function getIdentityServerSnapshot(): AgentIdentity {
  return current;
}

export function getIdentityUserName(): string {
  return userName;
}

/** 拉一次（幂等）。读不到就保持空态 —— 回退品牌名与品牌头像，界面不变形。 */
export function ensureIdentity(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const response = await fetch("/api/identity");
      if (!response.ok) return;
      const data = await response.json() as { identity?: unknown; userName?: unknown };
      publish(resolveIdentity(data?.identity), typeof data?.userName === "string" ? data.userName : "");
    } catch {
      // 失败保持空态。
    }
  })();
  return loadPromise;
}

/** 设置页保存成功后立刻生效 —— 聊天里的身份行不必等下一次 fetch。 */
export function setIdentity(next: AgentIdentity): void {
  publish(resolveIdentity(next), userName);
}

export function useAgentIdentity(): AgentIdentity {
  const identity = useSyncExternalStore(subscribeIdentity, getIdentitySnapshot, getIdentityServerSnapshot);
  useEffect(() => { void ensureIdentity(); }, []);
  return identity;
}
