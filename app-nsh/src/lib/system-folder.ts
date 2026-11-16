// The system's folder chooser: Finder's own sheet on macOS (`osascript`'s
// `choose folder`), so a project is picked where the user's other folders are
// — Recents, iCloud, network volumes — not in a browser drawn by the app.
//
// The NSH picker has files and images but no directory chooser; macOS's
// Standard Additions do. Where that is not available (Windows, Linux, a host
// that denies the process), or when it answers nothing, the caller falls back
// to the app's directory browser (`CwdPicker`).
import { platform, run } from "process";

export type FolderPick =
  | { status: "picked"; path: string }
  | { status: "cancelled" }
  | { status: "unavailable" };

/** The granted path, not a PATH lookup: `capabilities.process.execute` names it. */
const OSASCRIPT = "/usr/bin/osascript";

/** AppleScript string literal contents (backslash and quote escaped). */
function appleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Whether the platform has a native folder chooser this app may run. */
export function systemFolderAvailable(): boolean {
  return platform === "macos";
}

/** AppleScript's user cancel: exit `-128`, with this wording on stderr. */
function cancelledByUser(code: number | null | undefined, stderr: string, message = ""): boolean {
  return code === -128 || /User canceled|\(-128\)/.test(stderr) || /User canceled|\(-128\)/.test(message);
}

/**
 * Shows the system's folder chooser. Resolves with the chosen folder (no
 * trailing separator), `cancelled` when the user dismissed it, or
 * `unavailable` when the platform or the host cannot show one — or the
 * chooser returned no path, so the caller can use its own browser.
 */
export async function pickSystemFolder(title: string): Promise<FolderPick> {
  if (!systemFolderAvailable()) return { status: "unavailable" };
  const script = `POSIX path of (choose folder with prompt "${appleScriptString(title)}")`;
  try {
    const result = await run(OSASCRIPT, ["-e", script], { timeoutMs: 600_000 });
    const path = result.stdout.trim().replace(/\/+$/, "");
    if (result.code === 0) {
      // Nothing (or only the root, whose trailing slash we stripped): there is
      // no folder to hand back, so the caller's browser is the fallback.
      return path ? { status: "picked", path } : { status: "unavailable" };
    }
    if (cancelledByUser(result.code, result.stderr)) return { status: "cancelled" };
    // A refusal or an AppleScript failure is not a cancel: let the app's own
    // browser take over instead of leaving the press with no dialog.
    return { status: "unavailable" };
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message = error instanceof Error ? error.message : String(error);
    if (cancelledByUser(undefined, "", message)) return { status: "cancelled" };
    if (
      code === "ERR_ACCESS_DENIED"
      || code === "ENOENT"
      || code === "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM"
      || code === "ETIMEDOUT"
    ) {
      return { status: "unavailable" };
    }
    // An unexpected failure: fall back rather than hide the folder choice.
    return { status: "unavailable" };
  }
}
