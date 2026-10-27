/**
 * The desktop shell's bridge (electron/preload.js). The web build has none of
 * this: every call must have a browser fallback, and this module is the only
 * place that looks at the global.
 */

export interface DesktopDirectoryPick {
  canceled: boolean;
  path: string | null;
}

interface DesktopShellBridge {
  isDesktop?: boolean;
  platform?: string;
  arch?: string;
  pickDirectory?: (options?: { title?: string; defaultPath?: string }) => Promise<DesktopDirectoryPick>;
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
