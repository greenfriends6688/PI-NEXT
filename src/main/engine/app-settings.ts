import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { THINKING_EFFORT_LEVELS, type EngineModel, type ProjectModelDefault, type ThinkingLevel } from "@shared/types";
import { isGlassEnabled } from "@shared/glass";
import type { PinextPaths } from "./paths";

/**
 * The OS appearance, with the one thing that needs Electron removed from this module's
 * import graph.
 *
 * `nativeTheme` is a *runtime* Electron import, and this file sits on the path the
 * headless Agent loads — the built entry died on it (`import { nativeTheme } from
 * "electron"` under plain Node, where `electron` is a CommonJS package with no such
 * named export). The native half is registered once by the Electron host
 * (`src/main/index.ts`); everywhere else — the Agent, a test, a future browser host —
 * the defaults below are what is used instead.
 *
 * A headless runtime has no OS theme to follow and no window to repaint, so "system"
 * resolving to light is the honest answer rather than a stub.
 */
export type NativeAppearance = {
  /** Apply a theme mode to the OS-facing chrome (the window frame, native menus). */
  setThemeSource(mode: "light" | "dark" | "system"): void;
  /** Whether the OS currently draws dark. Used only for the pre-paint window colour. */
  prefersDark(): boolean;
};

const headlessAppearance: NativeAppearance = {
  setThemeSource: () => undefined,
  prefersDark: () => false,
};

let appearance: NativeAppearance = headlessAppearance;

/** Installed once by the Electron host; the Agent and tests keep the headless default. */
export function setNativeAppearance(next: NativeAppearance): void {
  appearance = next;
}

const VERSION = 1;

type SettingsFile = {
  version: number;
  settings: Record<string, unknown>;
};

/** Loose bag of renderer UI prefs. Main interprets `themeMode`, the global and
 * project model defaults and `keepAwake`; everything else is the renderer's. */
export type PersistedSettings = Record<string, unknown>;

/**
 * Last parse of `settings.json`, validated against the file's own mtime/size.
 *
 * Read-heavy: several main-process paths ask for one preference at a time, and the
 * engine's event fan-out used to re-read (and re-parse) the whole file per streamed
 * event. A `statSync` is roughly two orders of magnitude cheaper than the read plus
 * `JSON.parse`, and keying on the stat keeps the previous semantics — a file edited
 * behind the app's back is still picked up, which an invalidate-on-write cache alone
 * would have lost.
 */
let cache: { mtimeMs: number; size: number; settings: PersistedSettings } | null = null;

export function readAppSettings(paths: PinextPaths): PersistedSettings {
  try {
    const stat = statSync(paths.settingsFile);
    if (cache && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.settings;
    const parsed = JSON.parse(readFileSync(paths.settingsFile, "utf8")) as SettingsFile;
    if (!parsed || parsed.version !== VERSION || !parsed.settings || typeof parsed.settings !== "object") {
      return {};
    }
    cache = { mtimeMs: stat.mtimeMs, size: stat.size, settings: parsed.settings };
    return parsed.settings;
  } catch {
    return {};
  }
}

/**
 * The model a brand-new conversation should start on, if the user pinned one.
 *
 * Deliberately separate from the SDK's own `defaultProvider`/`defaultModel`:
 * `AgentSession.setModel` rewrites those to the last used model on every switch, so
 * they can never hold a preference.
 */
export function readDefaultModel(paths: PinextPaths): EngineModel | undefined {
  return readPreferredModelSettings(paths).model;
}

/**
 * Resolve the model and reasoning defaults for a new conversation. A project pin
 * overrides the global default, while a missing or malformed pin falls back cleanly.
 */
export function readPreferredModelSettings(paths: PinextPaths, project?: string): {
  model?: EngineModel;
  thinkingLevel?: ThinkingLevel | "auto";
} {
  const settings = readAppSettings(paths);
  const projectDefaults = settings.projectDefaults;
  const projectDefault = project && typeof projectDefaults === "object" && projectDefaults !== null && !Array.isArray(projectDefaults)
    ? (projectDefaults as Record<string, unknown>)[project]
    : undefined;
  const projectPreference = isProjectModelDefault(projectDefault) ? projectDefault : undefined;
  return {
    model: projectPreference?.model ?? readEngineModel(settings.defaultModel),
    thinkingLevel: projectPreference?.thinkingLevel ?? readThinkingLevel(settings.thinkingLevel),
  };
}

function readEngineModel(value: unknown): EngineModel | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { provider, id } = value as Partial<EngineModel>;
  if (typeof provider !== "string" || typeof id !== "string" || !provider || !id) return undefined;
  return { provider, id };
}

function readThinkingLevel(value: unknown): ThinkingLevel | "auto" | undefined {
  return value === "auto" || (typeof value === "string" && (THINKING_EFFORT_LEVELS as readonly string[]).includes(value))
    ? value as ThinkingLevel | "auto"
    : undefined;
}

function isProjectModelDefault(value: unknown): value is ProjectModelDefault {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ProjectModelDefault>;
  return Boolean(readEngineModel(candidate.model)) && readThinkingLevel(candidate.thinkingLevel) !== undefined;
}

export function writeAppSettings(paths: PinextPaths, settings: PersistedSettings): void {
  const payload: SettingsFile = { version: VERSION, settings };
  writeFileSync(paths.settingsFile, `${JSON.stringify(payload, null, 2)}\n`);
  // A write within the same millisecond as the cached stat would otherwise be
  // invisible to the mtime check; drop the entry rather than trusting the clock.
  cache = null;
}

export function clearAppSettings(paths: PinextPaths): void {
  cache = null;
  if (existsSync(paths.settingsFile)) unlinkSync(paths.settingsFile);
}

export function applyNativeTheme(settings: PersistedSettings): void {
  const mode = settings.themeMode;
  appearance.setThemeSource(mode === "light" || mode === "dark" || mode === "system" ? mode : "system");
}

/**
 * Whether this window is drawn over the OS blur: macOS only, and only while 玻璃效果 is
 * on (`shared/glass.ts`). Windows and Linux have no vibrancy, so the setting is not
 * offered there and every theme keeps its solid surfaces.
 *
 * Read from the saved settings rather than told by the renderer, so a window is already
 * the right kind when it is created and there is no call a remote client could forge.
 */
export function windowIsGlass(settings: Record<string, unknown>): boolean {
  return process.platform === "darwin" && isGlassEnabled(settings);
}

export function windowBackgroundColor(glass = false): string {
  // Fully transparent, not merely `transparent`: the window's own fill is what would
  // otherwise sit between the blur and the page.
  if (glass) return "#00000000";
  // Pre-paint only: the colour the window shows before the renderer applies a theme
  // (the default GitHub Light / Dark background).
  return appearance.prefersDark() ? "#0d1117" : "#ffffff";
}

/** The macOS material behind a Glass window. */
const GLASS_MATERIAL = "under-window" as const;

/** The `BrowserWindow` option that turns the blur on at creation. */
export function windowVibrancy(glass: boolean): typeof GLASS_MATERIAL | undefined {
  return glass ? GLASS_MATERIAL : undefined;
}

/**
 * Where macOS draws the traffic lights. The side panels float as panes inset 8px from
 * the window edge (index.css, floating panes), so the lights sit 8px further in to stay
 * inside the sidebar pane's first row instead of on its corner.
 */
export const WINDOW_BUTTON_POSITION = { x: 24, y: 24 } as const;

/**
 * The window a paint may touch. Structural for the same reason `NativeAppearance` is:
 * this module is loaded by the headless Agent, which has no Electron windows at all.
 */
export type PaintedWindow = {
  isDestroyed(): boolean;
  setBackgroundColor(color: string): void;
  setVibrancy(material: string | null): void;
};

export function paintWindows(windows: Iterable<PaintedWindow>, settings: Record<string, unknown>): void {
  const glass = windowIsGlass(settings);
  const color = windowBackgroundColor(glass);
  for (const window of windows) {
    if (window.isDestroyed()) continue;
    // Order matters: dropping the vibrancy first leaves a frame of the old transparent
    // fill, which on a solid theme reads as a flash of the desktop.
    window.setBackgroundColor(color);
    if (process.platform === "darwin") {
      window.setVibrancy(glass ? GLASS_MATERIAL : null);
    }
  }
}
