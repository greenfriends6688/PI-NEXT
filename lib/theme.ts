// Settings shows these as swatches. design/v3's theme grid: System on its own row,
// then the light group, then the dark group, then the high-contrast pair and Zenburn.
// The first five light/dark pairs are the app's own palettes; the rest are the
// editor palettes design/v3 ported from DroppyCode's AppTheme.swift, kept as-is
// (their names are proper nouns). Old ids stay in place, so a saved preference
// never falls back.
export const THEME_OPTIONS = [
  { id: "auto", label: "settings.themeSystem", scheme: null },
  { id: "light", label: "settings.themeLight", scheme: "light" },
  { id: "mist", label: "settings.themeMist", scheme: "light" },
  { id: "lilac", label: "settings.themeLilac", scheme: "light" },
  { id: "sand", label: "settings.themeSand", scheme: "light" },
  { id: "rose", label: "settings.themeRose", scheme: "light" },
  { id: "catppuccinLatte", label: "settings.themeCatppuccinLatte", scheme: "light" },
  { id: "gruvboxLight", label: "settings.themeGruvboxLight", scheme: "light" },
  { id: "solarizedLight", label: "settings.themeSolarizedLight", scheme: "light" },
  { id: "githubLight", label: "settings.themeGithubLight", scheme: "light" },
  { id: "claudeLight", label: "settings.themeClaudeLight", scheme: "light" },
  { id: "dark", label: "settings.themeDark", scheme: "dark" },
  { id: "pine", label: "settings.themePine", scheme: "dark" },
  { id: "dusk", label: "settings.themeDusk", scheme: "dark" },
  { id: "ember", label: "settings.themeEmber", scheme: "dark" },
  { id: "slate", label: "settings.themeSlate", scheme: "dark" },
  { id: "catppuccinMocha", label: "settings.themeCatppuccinMocha", scheme: "dark" },
  { id: "dracula", label: "settings.themeDracula", scheme: "dark" },
  { id: "tokyoNight", label: "settings.themeTokyoNight", scheme: "dark" },
  { id: "nord", label: "settings.themeNord", scheme: "dark" },
  { id: "gruvbox", label: "settings.themeGruvbox", scheme: "dark" },
  { id: "oneDark", label: "settings.themeOneDark", scheme: "dark" },
  { id: "everforest", label: "settings.themeEverforest", scheme: "dark" },
  { id: "kanagawa", label: "settings.themeKanagawa", scheme: "dark" },
  { id: "rosePine", label: "settings.themeRosePine", scheme: "dark" },
  { id: "solarizedDark", label: "settings.themeSolarizedDark", scheme: "dark" },
  { id: "githubDark", label: "settings.themeGithubDark", scheme: "dark" },
  { id: "ayu", label: "settings.themeAyu", scheme: "dark" },
  { id: "nightOwl", label: "settings.themeNightOwl", scheme: "dark" },
  { id: "monokai", label: "settings.themeMonokai", scheme: "dark" },
  { id: "claude", label: "settings.themeClaude", scheme: "dark" },
  { id: "codex", label: "settings.themeCodex", scheme: "dark" },
  { id: "cursor", label: "settings.themeCursor", scheme: "dark" },
  { id: "matrix", label: "settings.themeMatrix", scheme: "dark" },
  { id: "contrast-light", label: "settings.themeContrastLight", scheme: "light" },
  { id: "contrast-dark", label: "settings.themeContrastDark", scheme: "dark" },
  { id: "zenburn", label: "settings.themeZenburn", scheme: "dark" },
] as const;

export type ThemePreference = (typeof THEME_OPTIONS)[number]["id"];
export type ResolvedTheme = Exclude<ThemePreference, "auto">;

export const LIGHT_THEMES: readonly ResolvedTheme[] = THEME_OPTIONS.flatMap((option) => (option.scheme === "light" ? [option.id] : []));
export const DARK_THEMES: readonly ResolvedTheme[] = THEME_OPTIONS.flatMap((option) => (option.scheme === "dark" ? [option.id] : []));

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_OPTIONS.some((option) => option.id === value);
}

export function isDarkTheme(theme: ResolvedTheme): boolean {
  return DARK_THEMES.includes(theme);
}

// Apply the saved palette before first paint, including when storage is blocked.
// `data-theme` is the palette id (design/v3's palettes.css keys off it);
// `data-scheme` is its light/dark half (design/v3's running.css keys off that).
export const THEME_INIT_SCRIPT = `(function(){var t="auto";try{var s=localStorage.getItem("pi-theme");if(${JSON.stringify(THEME_OPTIONS.map((option) => option.id))}.includes(s))t=s}catch(e){}if(t==="auto")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=document.documentElement;var d=${JSON.stringify(DARK_THEMES)}.includes(t);r.dataset.theme=t;r.dataset.scheme=d?"dark":"light";r.classList.toggle("dark",d)})();`;
