"use client";

import { useSyncExternalStore } from "react";

/**
 * fork:send-key（G6 · 上游 `5df8278` #1001）—— 发送键可配。
 *
 * `enter`：Enter 直发（默认，与改动前一致），Shift+Enter 换行。
 * `ctrlEnter`：Ctrl/Cmd+Enter 才发，Enter 空出来换行 —— G10 的 Markdown 列表
 * 续行就挂在这条上（`components/ChatInput.tsx` 的 handleKeyDown）。
 *
 * 手机端不受这个偏好影响：那里 sendShortcut 恒为 Ctrl/Cmd+Enter（软键盘的
 * Enter 是换行键），所以设置项只对桌面键盘有意义。
 *
 * 形态照 `hooks/useChatAppearance.ts`：模块级快照 + 订阅者集合 +
 * `useSyncExternalStore`，localStorage 读写都包在 try 里（隐私模式）。
 */

export type EnterSendMode = "enter" | "ctrlEnter";

export const ENTER_SEND_MODE_STORAGE_KEY = "pi-enter-send-mode";
export const ENTER_SEND_MODE_DEFAULT: EnterSendMode = "enter";

/** 存过的坏值（老版本、手改的）一律回落到默认，不猜。 */
export function parseEnterSendMode(value: unknown): EnterSendMode {
  return value === "ctrlEnter" ? "ctrlEnter" : ENTER_SEND_MODE_DEFAULT;
}

function readStoredMode(): EnterSendMode {
  try {
    return parseEnterSendMode(window.localStorage.getItem(ENTER_SEND_MODE_STORAGE_KEY));
  } catch {
    return ENTER_SEND_MODE_DEFAULT;
  }
}

let mode: EnterSendMode | null = null;
const listeners = new Set<() => void>();

function getSnapshot(): EnterSendMode {
  if (mode === null) mode = readStoredMode();
  return mode;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setEnterSendMode(next: EnterSendMode): void {
  mode = next;
  try {
    window.localStorage.setItem(ENTER_SEND_MODE_STORAGE_KEY, next);
  } catch {
    // Best-effort browser preference persistence.
  }
  listeners.forEach((listener) => listener());
}

export function useEnterSendMode(): EnterSendMode {
  return useSyncExternalStore(subscribe, getSnapshot, () => ENTER_SEND_MODE_DEFAULT);
}