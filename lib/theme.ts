// fork:boardui — 只保留 light / dark / auto：雾青、蔷薇、松夜三套 palette 已退役
// （颜色槽位现在由 BoardUI 的语义 token 接管，不再按 palette 取值）。
//
// fork:fastvibe-stack (H4) —— 这三值是**亮暗模式**，而不是「长相」。
// 从 H4 起另有 24 套具名主题（`lib/themes-fastvibe.ts`），上面那三个 id 决定
// 用「亮那一套」还是「暗那一套」，具体是哪一套由 `pi-theme-light` /
// `pi-theme-dark` 两个键各自指定（见 `lib/theme-selection.ts`）。
// 这样老的 `pi-theme = "light" | "dark" | "auto"` 数据不用迁移，
// 用户换个亮色主题也不会把「跟随系统」一起改掉。
export const THEME_OPTIONS = [
  { id: "light", label: "settings.themeLight" },
  { id: "dark", label: "settings.themeDark" },
  { id: "auto", label: "settings.themeSystem" },
] as const;

export type ThemePreference = (typeof THEME_OPTIONS)[number]["id"];
export type ResolvedTheme = Exclude<ThemePreference, "auto">;

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_OPTIONS.some((option) => option.id === value);
}

export function isDarkTheme(theme: ResolvedTheme): boolean {
  return theme === "dark";
}

// Apply the saved palette before first paint, including when storage is blocked.
//
// fork:fastvibe-stack (H4) —— 具体实现搬到 `lib/theme-selection.ts` 的
// `THEME_SELECTION_INIT_SCRIPT`：它除了亮/暗还要解出「具体是哪一套」
// （`data-theme-id`），而两个存储键名得与运行时那套保持一致。
// 这里保留同名导出，外部只从 `@/lib/theme` 取（`app/layout.tsx` 就是）。
//
export { THEME_SELECTION_INIT_SCRIPT as THEME_INIT_SCRIPT } from "./theme-selection";
