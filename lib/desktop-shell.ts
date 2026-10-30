/**
 * The desktop shell's bridge (electron/preload.js). The web build has none of
 * this: every call must have a browser fallback, and this module is the only
 * place that looks at the global.
 */

export interface DesktopDirectoryPick {
  canceled: boolean;
  path: string | null;
}

export interface DesktopSettings {
  /** Offer a fixed Web endpoint (browser URL) instead of a random internal port. */
  webAccess: boolean;
  /** The port the running internal server is on. */
  webPort: number;
  /** The fixed port Web access uses when enabled. */
  webAccessPort: number;
  packaged: boolean;
}

interface DesktopShellBridge {
  isDesktop?: boolean;
  platform?: string;
  arch?: string;
  pickDirectory?: (options?: { title?: string; defaultPath?: string }) => Promise<DesktopDirectoryPick>;
  getDesktopSettings?: () => Promise<DesktopSettings>;
  setWebAccess?: (enabled: boolean) => Promise<{ webAccess: boolean; requiresRestart: boolean }>;
  focusWindow?: () => Promise<void>;
}

function bridge(): DesktopShellBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { piWebDesktop?: DesktopShellBridge }).piWebDesktop ?? null;
}

/** True inside the packaged desktop shell (macOS, Windows, Linux). */
export function isDesktopShell(): boolean {
  return bridge()?.isDesktop === true;
}

/**
 * The OS's own folder picker, when the shell has one. `null` means "no native
 * picker here" — the caller keeps its own directory browser.
 */
export async function pickDirectoryNatively(
  options?: { title?: string; defaultPath?: string },
): Promise<DesktopDirectoryPick | null> {
  const pick = bridge()?.pickDirectory;
  if (!pick) return null;
  try {
    return await pick(options);
  } catch {
    // An older shell without the handler: fall back to the web picker.
    return null;
  }
}

/** The desktop shell's settings; null in the browser or an older shell. */
export async function getDesktopSettings(): Promise<DesktopSettings | null> {
  const get = bridge()?.getDesktopSettings;
  if (!get) return null;
  try {
    return await get();
  } catch {
    return null;
  }
}

/** Saves the Web-access choice; the running server keeps its port until a restart. */
export async function setDesktopWebAccess(enabled: boolean): Promise<{ webAccess: boolean; requiresRestart: boolean } | null> {
  const set = bridge()?.setWebAccess;
  if (!set) return null;
  try {
    return await set(enabled);
  } catch {
    return null;
  }
}

/** Brings the desktop window to the front from a notification click. */
export async function focusDesktopWindow(): Promise<void> {
  const focus = bridge()?.focusWindow;
  if (!focus) return;
  try {
    await focus();
  } catch {
    // The browser build has no window to focus.
  }
}
