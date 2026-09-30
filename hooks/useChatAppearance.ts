"use client";

import { useSyncExternalStore } from "react";
import { DESIGN_TEXT_PX, snapUserTextSize } from "@/lib/typography";

export const CHAT_CONTENT_WIDTH_DEFAULT = 800;
export const CHAT_CONTENT_WIDTH_MIN = 640;
export const CHAT_CONTENT_WIDTH_MAX = 2000;
export const CHAT_CONTENT_WIDTH_STORAGE_KEY = "pi-chat-content-width";
/** 默认 = 规范的正文档 `--text-body`(13)。以前是 14（Zeno 的正文尺寸），不在五档里。 */
export const CHAT_CONTENT_FONT_SIZE_DEFAULT = DESIGN_TEXT_PX.body;
export const CHAT_CONTENT_FONT_SIZE_STORAGE_KEY = "pi-chat-content-font-size";
export const EXTENSION_WIDGET_FONT_SIZE_DEFAULT = DESIGN_TEXT_PX.body;
export const EXTENSION_WIDGET_FONT_SIZE_STORAGE_KEY = "pi-extension-widget-font-size";

interface ChatAppearance {
  width: number;
  fontSize: number;
  extensionWidgetFontSize: number;
}

const DEFAULT_APPEARANCE: ChatAppearance = {
  width: CHAT_CONTENT_WIDTH_DEFAULT,
  fontSize: CHAT_CONTENT_FONT_SIZE_DEFAULT,
  extensionWidgetFontSize: EXTENSION_WIDGET_FONT_SIZE_DEFAULT,
};
let appearance: ChatAppearance | null = null;
const listeners = new Set<() => void>();

export function clampChatContentWidth(value: unknown): number {
  const width = Number(value ?? CHAT_CONTENT_WIDTH_DEFAULT);
  if (!Number.isFinite(width)) return CHAT_CONTENT_WIDTH_DEFAULT;
  return Math.max(CHAT_CONTENT_WIDTH_MIN, Math.min(CHAT_CONTENT_WIDTH_MAX, Math.round(width)));
}

/**
 * fork:type-scale（2026-09-30）—— 字号只允许停在规范的档位上。
 *
 * 改动前是 `clamp(12, round(值), 24)`：14 / 16 / 24 都能活下来，而这三个值不在设计
 * 的五档（11 / 12 / 13 / 15 / 20）里。现在统一走 `snapUserTextSize`：
 * 存过的旧值归并到**最近的规范档**（14 → 13、16 → 15、24 → 20）。
 */
export function clampChatContentFontSize(value: unknown): number {
  const size = Number(value ?? CHAT_CONTENT_FONT_SIZE_DEFAULT);
  if (!Number.isFinite(size)) return CHAT_CONTENT_FONT_SIZE_DEFAULT;
  return snapUserTextSize(size);
}

export function clampExtensionWidgetFontSize(value: unknown): number {
  const size = Number(value ?? EXTENSION_WIDGET_FONT_SIZE_DEFAULT);
  if (!Number.isFinite(size)) return EXTENSION_WIDGET_FONT_SIZE_DEFAULT;
  return snapUserTextSize(size);
}

function readStoredPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function applyAppearance({ width, fontSize, extensionWidgetFontSize }: ChatAppearance): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--chat-content-max-width", `${width}px`);
  document.documentElement.style.setProperty("--chat-content-font-size", `${fontSize}px`);
  document.documentElement.style.setProperty("--extension-widget-font-size", `${extensionWidgetFontSize}px`);
}

function getSnapshot(): ChatAppearance {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE;
  if (!appearance) {
    appearance = {
      width: clampChatContentWidth(readStoredPreference(CHAT_CONTENT_WIDTH_STORAGE_KEY)),
      fontSize: clampChatContentFontSize(readStoredPreference(CHAT_CONTENT_FONT_SIZE_STORAGE_KEY)),
      extensionWidgetFontSize: clampExtensionWidgetFontSize(readStoredPreference(EXTENSION_WIDGET_FONT_SIZE_STORAGE_KEY)),
    };
    applyAppearance(appearance);
  }
  return appearance;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function clampByKey(key: keyof ChatAppearance, value: number): number {
  switch (key) {
    case "width": return clampChatContentWidth(value);
    case "fontSize": return clampChatContentFontSize(value);
    case "extensionWidgetFontSize": return clampExtensionWidgetFontSize(value);
  }
}

function storageKeyFor(key: keyof ChatAppearance): string {
  switch (key) {
    case "width": return CHAT_CONTENT_WIDTH_STORAGE_KEY;
    case "fontSize": return CHAT_CONTENT_FONT_SIZE_STORAGE_KEY;
    case "extensionWidgetFontSize": return EXTENSION_WIDGET_FONT_SIZE_STORAGE_KEY;
  }
}

function setPreference(key: keyof ChatAppearance, value: number): void {
  const nextValue = clampByKey(key, value);
  appearance = { ...getSnapshot(), [key]: nextValue };
  applyAppearance(appearance);
  try {
    window.localStorage.setItem(storageKeyFor(key), String(nextValue));
  } catch {
    // Best-effort browser preference persistence.
  }
  listeners.forEach((listener) => listener());
}

const setWidth = (value: number) => setPreference("width", value);
const setFontSize = (value: number) => setPreference("fontSize", value);
const setExtensionWidgetFontSize = (value: number) => setPreference("extensionWidgetFontSize", value);

export function useChatAppearance() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_APPEARANCE);
  return { ...snapshot, setWidth, setFontSize, setExtensionWidgetFontSize };
}
