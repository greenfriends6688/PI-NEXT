"use client";

import { useCallback, useSyncExternalStore } from "react";
import { isDarkTheme, isThemePreference, type ThemePreference, type ResolvedTheme } from "@/lib/theme";
import { applyStoredUiDensity } from "@/hooks/useUiDensity";
// fork:zn-15 — 侧边栏半透明也随主题生效（主题切换会重算这一层）。
import { applyStoredRailTranslucent } from "@/hooks/useRailTranslucent";
import { applyStoredUiFont } from "@/hooks/useUiFont";
// fork:zn-19 — 皮肤也是「启动时要落地一次」的一层（改动面板/卡片/画布的变量）。
import { applyStoredThemeSkins } from "@/hooks/useThemeSkins";
// fork:fastvibe-stack (H4) —— 24 套主题体系（数据 + 桥）。
import { THEMES, type ThemeId } from "@/lib/themes-fastvibe";
import { fastvibeTokenVars } from "@/lib/theme-bridge";
import {
  readStoredSelection,
  resolveActiveThemeId,
  resolveSelection,
  writeStoredThemeId,
  type StoredThemeSelection,
} from "@/lib/theme-selection";

export type { ThemePreference, ResolvedTheme } from "@/lib/theme";

type ThemeState = {
  preference: ThemePreference;
  theme: ResolvedTheme;
  /** 亮色槽选中的主题（与当前明暗无关）。 */
  lightId: ThemeId;
  /** 暗色槽选中的主题。 */
  darkId: ThemeId;
  /** 当前实际生效的主题 id（= 上面两个里与 `theme` 同阵营的那个）。 */
  themeId: ThemeId;
};

type ToggleOrigin = { x: number; y: number };

const STORAGE_KEY = "pi-theme";
const SERVER_SNAPSHOT: ThemeState = {
  preference: "auto",
  theme: "light",
  lightId: "github-light",
  darkId: "github-dark",
  themeId: "github-light",
};

const listeners = new Set<() => void>();
let state: ThemeState | null = null;
let systemListening = false;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (isThemePreference(value)) return value;
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
  return "auto";
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "auto" ? getSystemTheme() : preference;
}

/**
 * fork:fastvibe-stack (H4) —— 把一套 FastVibe 主题的 token 写到 `<html>` 的行内样式。
 *
 * 顺序是本函数唯一微妙的地方：**先写基础 token，再跑皮肤层**。
 * 皮肤（`applyStoredThemeSkins`）是用户自己的覆盖（四基色 + 自定义 CSS），
 * 它的值写在同一个元素的行内样式上 —— 后写的赢。所以它必须在基础主题之后。
 * 把这个顺序搞反，表现是「选了皮肤但主题把皮肤盖掉了」，而两边各自都「工作正常」。
 */
function applyFastvibeTokens(themeId: ThemeId): void {
  if (typeof document === "undefined") return;
  const theme = THEMES[themeId];
  if (!theme) return;
  const root = document.documentElement;
  const vars = fastvibeTokenVars(theme);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  // `data-theme-id` 是「当前具体是哪一套」—— 与 `data-theme`（亮/暗）不同。
  // 有别的模块（主题选择器高亮、调试）要读它，而不是去比对一堆颜色值。
  root.dataset.themeId = themeId;
}

function applyDomTheme(theme: ResolvedTheme, themeId: ThemeId): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", isDarkTheme(theme));
  /* 顺序：主题 token 必须在皮肤之前（皮肤是覆盖层，见 `applyFastvibeTokens`）。
     密度 / 侧栏半透 / 字体也都在皮肤之前 —— 它们改的是另一批变量
     （--ui-density / --rail-* / --ui-font-*），与主题的颜色槽不重叠。 */
  applyFastvibeTokens(themeId);
  applyStoredUiDensity();
  applyStoredRailTranslucent();
  applyStoredUiFont();
  applyStoredThemeSkins();
}

function ensureState(): ThemeState {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  if (state) return state;

  const preference = readStoredPreference();
  const theme = resolveTheme(preference);
  const selection = resolveSelection(readStoredSelection());
  const themeId = resolveActiveThemeId(preference, selection, theme === "dark");
  applyDomTheme(theme, themeId);
  state = { preference, theme, lightId: selection.light, darkId: selection.dark, themeId };
  return state;
}

function setThemeState(preference: ThemePreference, theme: ResolvedTheme, persist: boolean): void {
  const selection = state
    ? { light: state.lightId, dark: state.darkId }
    : resolveSelection(readStoredSelection());
  const themeId = resolveActiveThemeId(preference, selection, theme === "dark");
  applyDomTheme(theme, themeId);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }
  state = { preference, theme, lightId: selection.light, darkId: selection.dark, themeId };
  emit();
}

/**
 * fork:fastvibe-stack (H4) —— 换一只具体主题（不是换亮暗模式）。
 *
 * 写盘只写对应的那个键（亮或暗），不碰 `pi-theme` —— 换主题不该改掉「跟随系统」，
 * 这是拆两个键的全部理由（见 `lib/theme-selection.ts`）。
 */
function setThemeId(id: ThemeId): void {
  const current = ensureState();
  const kind = THEMES[id]?.kind;
  if (!kind) return;
  const nextSelection = kind === "dark"
    ? { light: current.lightId, dark: id }
    : { light: id, dark: current.darkId };
  writeStoredThemeId(kind, id);

  /* 两件事分开看：
       · `nextSelection` 是「两个槽各自选了哪套」—— 总是更新（否则选择器显示旧值）；
       · 是否**重画 DOM** 取决于当前生效的阵营是否就是刚改的那个 ——
         改暗色槽时正在用亮色，观感本来就不该变（它要到切到暗色时才生效）。
     早期写错过一次：拿 `current.theme` 当阵营去解 `themeId`，于是改暗色槽
     会把 `state.themeId` 写成亮色的那套，选择器高亮暉一下。 */
  const effectiveId = current.theme === "dark" ? nextSelection.dark : nextSelection.light;
  if (current.theme === kind) applyDomTheme(current.theme, effectiveId);
  state = {
    preference: current.preference,
    theme: current.theme,
    lightId: nextSelection.light,
    darkId: nextSelection.dark,
    themeId: effectiveId,
  };
  emit();
}

function syncAutoThemeFromSystem(): void {
  const current = ensureState();
  if (current.preference !== "auto") return;
  const theme = getSystemTheme();
  if (theme === current.theme) return;
  setThemeState("auto", theme, false);
}

function ensureSystemListener(): void {
  if (systemListening || typeof window === "undefined" || !window.matchMedia) return;

  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", syncAutoThemeFromSystem);
  // Some browsers delay or miss scheme events while backgrounded.
  window.addEventListener("focus", syncAutoThemeFromSystem);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncAutoThemeFromSystem();
  });
  systemListening = true;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  ensureState();
  ensureSystemListener();
  syncAutoThemeFromSystem();
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): ThemeState {
  return ensureState();
}

function getServerSnapshot(): ThemeState {
  return SERVER_SNAPSHOT;
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setThemePreference = useCallback((nextPreference: ThemePreference, origin?: ToggleOrigin) => {
    const current = ensureState();
    if (current.preference === nextPreference) return;
    const nextTheme = resolveTheme(nextPreference);

    const apply = () => {
      setThemeState(nextPreference, nextTheme, true);
    };

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const supportsVT = typeof document.startViewTransition === "function";

    if (!supportsVT || reduceMotion) {
      apply();
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 450,
            easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        // transition cancelled — ignore
      });
  }, []);

  return {
    theme: snapshot.theme,
    preference: snapshot.preference,
    setThemePreference,
    isDark: isDarkTheme(snapshot.theme),
    /* fork:fastvibe-stack (H4) —— 24 套主题体系新增的三个读数 + 一个动作。
       旧字段（theme / preference / setThemePreference / isDark）**形状与语义一字未改**，
       所以 15 处 `isDark` 与 2 处 `theme === "light"` 的消费方不用动。 */
    /** 当前实际生效的主题 id（具体哪一套）。 */
    themeId: snapshot.themeId,
    /** 亮色槽选中的主题（与当前明暗无关 —— 选择器要显示它）。 */
    lightId: snapshot.lightId,
    /** 暗色槽选中的主题。 */
    darkId: snapshot.darkId,
    /** 换一只具体主题（自动按它的 kind 落到对应槽）。 */
    setThemeId,
  };
}
