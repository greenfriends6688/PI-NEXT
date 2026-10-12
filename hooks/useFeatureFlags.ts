"use client";

/**
 * fork:feature-toggles —— 「设置 → 界面与功能」的客户端读数。
 *
 * `ui` 类的开关（终端面板 / Git 图 / 调用轨迹 / 会话小地图）在渲染时读这里，所以
 * **立即生效**，不需要重载会话。`session` 类的开关服务端另有权威
 * （`lib/rpc-manager.ts` 在会话创建时读），这里读到的只用于把入口一起藏掉。
 *
 * **快照必须是同一引用**：这个 store 直接挂在 `useSyncExternalStore` 上，而
 * `resolveFeatureFlags()` 每次都返回新对象 —— 直接把它当快照会让 React 判定
 * 「快照没缓存」并无限重渲染（React #185，整个应用白屏，而 tsc / 单测 / lint / build
 * 全绿）。2026-10-13 刚被这件事咬过一次（`lib/session-ui-state-store.ts`），
 * 所以这里从一开始就把 `current` 做成**只在真的变了之后才替换**的模块级单一对象。
 */

import { useEffect, useSyncExternalStore } from "react";

import { resolveFeatureFlags, type FeatureFlags, type FeatureId } from "@/lib/feature-toggles";

const DEFAULT_FLAGS = resolveFeatureFlags(undefined);

let current: FeatureFlags = DEFAULT_FLAGS;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: FeatureFlags): void {
  // 逐键比较：内容一样就不换引用，避免无意义的重渲染。
  const changed = (Object.keys(next) as FeatureId[]).some((id) => next[id] !== current[id]);
  if (!changed) return;
  current = next;
  listeners.forEach((listener) => listener());
}

export function subscribeFeatureFlags(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** 当前开关表。**返回的一直是同一个引用**，除非某个开关真的变了。 */
export function getFeatureFlagsSnapshot(): FeatureFlags {
  return current;
}

/** 服务端 / 水合期与 `getFeatureFlagsSnapshot` 同源：两者都返回 `current`，所以永远不会不匹配。 */
export function getFeatureFlagsServerSnapshot(): FeatureFlags {
  return current;
}

/** 拉一次服务端开关（幂等；失败就保持默认值 —— 默认全开，不是「全关」）。 */
export function ensureFeatureFlags(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const response = await fetch("/api/features");
      if (!response.ok) return;
      const data = await response.json() as { flags?: unknown };
      publish(resolveFeatureFlags(data?.flags));
    } catch {
      // 读不到就用默认值：这一节不是真相源，失败不该让界面变形。
    }
  })();
  return loadPromise;
}

/** 设置页改完开关后本地立刻生效（不必等下一次 fetch）。 */
export function setFeatureFlags(next: FeatureFlags): void {
  publish(resolveFeatureFlags(next));
}

export function useFeatureFlags(): FeatureFlags {
  const flags = useSyncExternalStore(
    subscribeFeatureFlags,
    getFeatureFlagsSnapshot,
    getFeatureFlagsServerSnapshot,
  );
  useEffect(() => { void ensureFeatureFlags(); }, []);
  return flags;
}

/** 单个开关 —— 组件里只关心一处入口时用它。 */
export function useFeatureFlag(id: FeatureId): boolean {
  return useFeatureFlags()[id];
}
