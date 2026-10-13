/**
 * fork:fastvibe-stack (H4) —— 「用哪套主题」的持久化与解析。
 *
 * ## 三个键，各管一件事
 *
 * | 键 | 值 | 管什么 |
 * | --- | --- | --- |
 * | `pi-theme` | `light` / `dark` / `auto` | 亮暗模式（**老键，不动**） |
 * | `pi-theme-light` | 某个亮色 ThemeId | 「亮色时用哪一套」 |
 * | `pi-theme-dark` | 某个暗色 ThemeId | 「暗色时用哪一套」 |
 *
 * 为什么不合并成一个键：`pi-theme` 已经在几百个用户的 localStorage 里，值是
 * 三值枚举；把「模式」与「长相」塞进一个字段就要写迁移，而迁移这一步一旦出错
 * 就是白屏。拆成两个新键后，老数据**不需要迁移** —— 没写过新键时用默认主题
 * （github-light / github-dark，也是 FastVibe 的默认）。
 *
 * 为什么不跟着模式走：用户把亮色主题从 github-light 换成 one-light 时，
 * 不应该顺带把「跟随系统」改成「固定亮色」—— 那是两件事。
 *
 * ## 为什么解析逻辑单独一个纯模块
 *
 * 它有三个调用面：`useTheme`（React）、`THEME_INIT_SCRIPT`（首帧前的内联脚本）、
 * 设置页的主题选择器。三处必须是同一套判定，否则会出现「首帧亮、hydrate 后闪
 * 一下变暗」这类只有肉眼能发现的 bug。纯函数 + 单测是唯一能锁住的形状。
 */

import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, isThemeId, THEMES, type ThemeId } from "./themes-fastvibe";
import { isThemePreference, type ThemePreference, type ResolvedTheme } from "./theme";

export const THEME_LIGHT_KEY = "pi-theme-light";
export const THEME_DARK_KEY = "pi-theme-dark";

/** 两个新键没有写过时用的默认（与 FastVibe 的默认一致）。 */
export const DEFAULT_THEME_IDS = {
  light: DEFAULT_LIGHT_THEME,
  dark: DEFAULT_DARK_THEME,
} as const;

/** 从存储里读出来的东西，全部可选（可能没写过、可能写坏了）。 */
export interface StoredThemeSelection {
  light?: unknown;
  dark?: unknown;
}

/**
 * 把存储值收敛成一个「一定能用」的主题 id。
 *
 * 三层回落，每层都有理由：
 *   1. 值不是合法 ThemeId（老版本写的、手改的、别的应用写的）→ 默认；
 *   2. 值合法但**不属于该明暗阵营**（比如把 dracula 存进了亮色槽）→ 默认；
 *   3. 没有默认时（理论上不会）→ 该阵营的第一套。
 *
 * 不抛错：主题是外观，任何解析失败都不该让应用起不来。
 */
export function resolveThemeId(kind: ResolvedTheme, stored: unknown): ThemeId {
  if (isThemeId(stored) && THEMES[stored].kind === kind) return stored;
  const fallback = DEFAULT_THEME_IDS[kind];
  if (isThemeId(fallback) && THEMES[fallback].kind === kind) return fallback;
  const first = Object.values(THEMES).find((theme) => theme.kind === kind);
  // 24 套里必然有该阵营的成员；这个分支只是让类型收窄，不是预期路径。
  return first ? first.id : fallback;
}

/** 存储值 → 两个确定可用的主题 id。 */
export function resolveSelection(stored: StoredThemeSelection): { light: ThemeId; dark: ThemeId } {
  return {
    light: resolveThemeId("light", stored.light),
    dark: resolveThemeId("dark", stored.dark),
  };
}

/**
 * 模式 + 两个主题 id → 最终生效的那一套。
 *
 * `auto` 时按 `prefersDark` 选阵营 —— 这与 `hooks/useTheme.ts` 里那套
 * `resolveTheme(preference)` 是同一件事，但那个只看模式（旧 API 的语义），
 * 这里要把「哪一套」也解出来。
 */
export function resolveActiveThemeId(
  preference: ThemePreference,
  selection: { light: ThemeId; dark: ThemeId },
  prefersDark: boolean,
): ThemeId {
  const kind: ResolvedTheme = preference === "auto" ? (prefersDark ? "dark" : "light") : preference;
  return selection[kind];
}

/**
 * 首帧前写入选择。必须在任何 React 代码之前跑，否则会看到一次颜色闪烁。
 *
 * 与原版 `THEME_INIT_SCRIPT` 的差别：那个只写 `data-theme` 与 `.dark`；这里
 * 多写 `data-theme-id`（具体是哪一套）。**不写 41 个 token** —— 首帧脚本要
 * 尽量小，而且 token 的写入在 `useTheme` 挂载时会立刻补上；在此之前 CSS 里
 * 的 `:root` 回退值会先顶着（见 `app/globals.css` 的 `fork:fastvibe-stack` 块）。
 */
export const THEME_SELECTION_INIT_SCRIPT = `(function(){try{
var ids=${JSON.stringify({ light: DEFAULT_LIGHT_THEME, dark: DEFAULT_DARK_THEME })};
var pref="auto";try{var s=localStorage.getItem("pi-theme");if(${JSON.stringify(["light", "dark", "auto"])}.includes(s))pref=s}catch(e){}
var dark=pref==="dark"||(pref==="auto"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
var kind=dark?"dark":"light";
var id=ids[kind];
try{var v=localStorage.getItem(kind==="dark"?"${THEME_DARK_KEY}":"${THEME_LIGHT_KEY}");if(v)id=v}catch(e){}
var r=document.documentElement;
r.dataset.theme=kind;r.dataset.themeId=id;r.classList.toggle("dark",kind==="dark");
}catch(e){}})();`;

/** 运行时读取（`useTheme` 用）。存储被禁时返回默认，不抛。 */
export function readStoredSelection(): StoredThemeSelection {
  if (typeof window === "undefined") return {};
  try {
    return {
      light: window.localStorage.getItem(THEME_LIGHT_KEY),
      dark: window.localStorage.getItem(THEME_DARK_KEY),
    };
  } catch {
    // 隐私模式 / 配额满：外观回默认，不影响使用。
    return {};
  }
}

/** 运行时写入。存储被禁时静默失败 —— 主题当次仍然生效，只是不记忆。 */
export function writeStoredThemeId(kind: ResolvedTheme, id: ThemeId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(kind === "dark" ? THEME_DARK_KEY : THEME_LIGHT_KEY, id);
  } catch {
    // 同上：不因为存不下就报错。
  }
}

/** 仅供测试与调试：这套选择是否自洽（两个 id 都属于各自阵营）。 */
export function isSelectionConsistent(selection: { light: ThemeId; dark: ThemeId }): boolean {
  return THEMES[selection.light]?.kind === "light" && THEMES[selection.dark]?.kind === "dark";
}

export { isThemePreference };
