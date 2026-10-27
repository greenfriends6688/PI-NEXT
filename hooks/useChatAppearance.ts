"use client";

import { useSyncExternalStore } from "react";

export const CHAT_CONTENT_WIDTH_DEFAULT = 820;
export const CHAT_CONTENT_WIDTH_MIN = 820;
export const CHAT_CONTENT_WIDTH_MAX = 2000;
export const CHAT_CONTENT_WIDTH_STORAGE_KEY = "pi-chat-content-width";
export const CHAT_CONTENT_FONT_SIZE_DEFAULT = 14;
export const CHAT_CONTENT_FONT_SIZE_MIN = 12;
export const CHAT_CONTENT_FONT_SIZE_MAX = 24;
export const CHAT_CONTENT_FONT_SIZE_STORAGE_KEY = "pi-chat-content-font-size";
export const TERMINAL_FONT_SIZE_DEFAULT = 13;
/** 窗口底色的不透明度（%）：100 是画板那种厚帘，越低越透出壁纸。 */
export const BACKGROUND_OPACITY_DEFAULT = 100;
export const BACKGROUND_OPACITY_MIN = 40;
export const BACKGROUND_OPACITY_MAX = 100;
export const BACKGROUND_OPACITY_STORAGE_KEY = "pi-background-opacity";

interface ChatAppearance {
  width: number;
  fontSize: number;
  backgroundOpacity: number;
}

const DEFAULT_APPEARANCE: ChatAppearance = {
  width: CHAT_CONTENT_WIDTH_DEFAULT,
  fontSize: CHAT_CONTENT_FONT_SIZE_DEFAULT,
  backgroundOpacity: BACKGROUND_OPACITY_DEFAULT,
};
let appearance: ChatAppearance | null = null;
const listeners = new Set<() => void>();

export function clampChatContentWidth(value: unknown): number {
  const width = Number(value);
  if (!Number.isFinite(width)) return CHAT_CONTENT_WIDTH_DEFAULT;
  return Math.max(CHAT_CONTENT_WIDTH_MIN, Math.min(CHAT_CONTENT_WIDTH_MAX, Math.round(width)));
}

export function clampChatContentFontSize(value: unknown): number {
  const size = Number(value ?? CHAT_CONTENT_FONT_SIZE_DEFAULT);
  if (!Number.isFinite(size)) return CHAT_CONTENT_FONT_SIZE_DEFAULT;
  return Math.max(CHAT_CONTENT_FONT_SIZE_MIN, Math.min(CHAT_CONTENT_FONT_SIZE_MAX, Math.round(size)));
}

/**
 * The terminal follows the chat font size as code blocks do: the same step, from its own 13px at
 * the chat default (14px chat is a 13px terminal, 18px chat a 17px one).
 */
export function terminalFontSize(chatFontSize: unknown): number {
  return clampChatContentFontSize(chatFontSize) - CHAT_CONTENT_FONT_SIZE_DEFAULT + TERMINAL_FONT_SIZE_DEFAULT;
}

export function clampBackgroundOpacity(value: unknown): number {
  const opacity = Number(value ?? BACKGROUND_OPACITY_DEFAULT);
  if (!Number.isFinite(opacity)) return BACKGROUND_OPACITY_DEFAULT;
  return Math.max(BACKGROUND_OPACITY_MIN, Math.min(BACKGROUND_OPACITY_MAX, Math.round(opacity)));
}

function readStoredPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function applyAppearance({ width, fontSize, backgroundOpacity }: ChatAppearance): void {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--chat-content-max-width", `${width}px`);
  document.documentElement.style.setProperty("--chat-content-font-size", `${fontSize}px`);
  // 窗与三块岛都读这一条：倍率乘在各自半透明的底色上（`--pane-alpha`）。
  document.documentElement.style.setProperty("--pane-alpha", String(backgroundOpacity / 100));
}

function getSnapshot(): ChatAppearance {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE;
  if (!appearance) {
    appearance = {
      width: clampChatContentWidth(readStoredPreference(CHAT_CONTENT_WIDTH_STORAGE_KEY)),
      fontSize: clampChatContentFontSize(readStoredPreference(CHAT_CONTENT_FONT_SIZE_STORAGE_KEY)),
      backgroundOpacity: clampBackgroundOpacity(readStoredPreference(BACKGROUND_OPACITY_STORAGE_KEY)),
    };
    applyAppearance(appearance);
  }
  return appearance;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const STORAGE_KEYS: Record<keyof ChatAppearance, string> = {
  width: CHAT_CONTENT_WIDTH_STORAGE_KEY,
  fontSize: CHAT_CONTENT_FONT_SIZE_STORAGE_KEY,
  backgroundOpacity: BACKGROUND_OPACITY_STORAGE_KEY,
};

function clampFor(key: keyof ChatAppearance, value: number): number {
  if (key === "width") return clampChatContentWidth(value);
  if (key === "backgroundOpacity") return clampBackgroundOpacity(value);
  return clampChatContentFontSize(value);
}

function setPreference(key: keyof ChatAppearance, value: number): void {
  const nextValue = clampFor(key, value);
  appearance = { ...getSnapshot(), [key]: nextValue };
  applyAppearance(appearance);
  try {
    window.localStorage.setItem(STORAGE_KEYS[key], String(nextValue));
  } catch {
    // Best-effort browser preference persistence.
  }
  listeners.forEach((listener) => listener());
}

const setWidth = (value: number) => setPreference("width", value);
const setFontSize = (value: number) => setPreference("fontSize", value);
const setBackgroundOpacity = (value: number) => setPreference("backgroundOpacity", value);

export function useChatAppearance() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_APPEARANCE);
  return { ...snapshot, setWidth, setFontSize, setBackgroundOpacity };
}
