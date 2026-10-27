"use client";

import { useSyncExternalStore } from "react";

/**
 * 完成通知：这一轮跑完（或扩展在等输入）时弹一条系统通知，页面在后台时才有用。
 *
 * 默认开：产品里通知本来就一直在发，只是从来没有一个开关，也没有人主动申请过
 * 权限——于是「设置里找不到」、浏览器里也永远不弹。现在默认开，并在开关为开时
 * 申请一次权限（申请过就不再打扰）。
 */
export const COMPLETION_NOTIFICATIONS_STORAGE_KEY = "pi-completion-notifications";

let enabled: boolean | null = null;
const listeners = new Set<() => void>();

function readStored(): boolean {
  try {
    const stored = window.localStorage.getItem(COMPLETION_NOTIFICATIONS_STORAGE_KEY);
    // 只有明确存成 "false" 才算关：首次打开（没有这个键）是开。
    return stored !== "false";
  } catch {
    return true;
  }
}

function getSnapshot(): boolean {
  if (typeof window === "undefined") return true;
  if (enabled === null) enabled = readStored();
  return enabled;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function completionNotificationsEnabled(): boolean {
  return getSnapshot();
}

export function setCompletionNotificationsEnabled(next: boolean): void {
  enabled = next;
  try {
    window.localStorage.setItem(COMPLETION_NOTIFICATIONS_STORAGE_KEY, String(next));
  } catch {
    // Best-effort browser preference persistence.
  }
  listeners.forEach((listener) => listener());
}

/**
 * 开关打开且还没决定过权限时申请一次。浏览器要求用户手势才弹权限框的地方
 * （Safari）会直接返回 `default`，那边调用方保持静默，不重复弹。
 */
export async function ensureNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function useCompletionNotifications(): { enabled: boolean; setEnabled: (next: boolean) => void } {
  const value = useSyncExternalStore(subscribe, getSnapshot, () => true);
  return { enabled: value, setEnabled: setCompletionNotificationsEnabled };
}
