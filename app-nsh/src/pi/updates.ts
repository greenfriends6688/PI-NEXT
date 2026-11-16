// Updating pi from inside the app, the way pi-gpui does it: ask the npm
// registry what the newest version is, and run pi's *own* updater (`pi update`)
// only when the user asks. Nothing here installs anything by itself.
//
// `curl` runs through the login shell rather than a granted absolute path:
// macOS and Linux both ship it, and the shell is already the app's one way to
// reach the user's real PATH (`install.ts`).
import { spawn } from "process";
import {
  PI_PACKAGE,
  dataDirectory,
  loginShell,
  loginShellRun,
  quoteShell,
} from "./install";

/** The registry's `latest` tag, or `null` when it cannot be read (offline). */
export async function latestPiVersion(): Promise<string | null> {
  try {
    const text = await loginShellRun(
      `curl -fsSL --max-time 15 "https://registry.npmjs.org/${PI_PACKAGE}/latest"`,
      20_000,
    );
    const manifest = JSON.parse(text) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

export interface PiUpdateResult {
  ok: boolean;
  /** Everything the updater printed, for the failure case. */
  output: string;
}

/**
 * Runs `pi update` (pi only; `pi update --extensions` is a separate ask) and
 * reports each output line as it arrives, so the row can show the work.
 *
 * `pi update` starts npm, which takes as long as npm takes: a spawned child has
 * no deadline of its own, and the caller shows a busy state until the promise
 * settles.
 */
export async function updatePi(
  executable: string,
  onLine: (line: string) => void,
): Promise<PiUpdateResult> {
  const shell = loginShell();
  if (shell === null) throw new Error("this platform has no login shell");
  const cwd = await dataDirectory();
  return new Promise((resolve) => {
    const lines: string[] = [];
    const collect = (text: string): void => {
      if (text.trim() === "") return;
      lines.push(text);
      onLine(text);
    };
    const child = spawn(shell, ["-ilc", `exec ${quoteShell(executable)} update`], { lines: true, cwd });
    child.on("stdout", collect);
    child.on("stderr", collect);
    child.on("exit", (result) => resolve({ ok: result.code === 0, output: lines.join("\n") }));
  });
}
