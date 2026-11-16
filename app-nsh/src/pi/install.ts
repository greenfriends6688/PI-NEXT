// The `pi` CLI on this machine: where it is and which version it is.
//
// The search order is pi-gpui's (`src/pi.rs:discover`): `PI_EXECUTABLE`, then
// the login shell's `command -v pi`. The shell is the point — Finder starts a
// GUI app with a minimal PATH, so `~/.local/bin`, nvm, fnm and volta are only
// reachable through the rc files an interactive shell reads. `nsh`'s
// capabilities grant executable *names* or absolute paths, so a bare `pi`
// cannot work and an absolute path differs per install; running
// `zsh -ilc 'command -v pi'` asks the user's own shell instead.
//
// Everything here blocks on a child process (~200 ms). Call it from an
// `effect` or `resource`, never from a binding.
import { mkdir } from "fs/promises";
import process, { run, type CommandOutput } from "process";

export interface Version {
  major: number;
  minor: number;
  patch: number;
}

/** The oldest pi this app was written against (the SDK it carries is 1.5). */
export const MIN_PI: Version = { major: 1, minor: 4, patch: 0 };
/** The newest minor it was tried with; a newer minor still runs, with a note. */
export const TESTED_PI = { major: 1, minor: 5 } as const;
/** What `pi update` updates, and what the registry check asks about. */
export const PI_PACKAGE = "@earendil-works/pi-coding-agent";

/** A short deadline: `pi --version` starts Node, but says nothing more. */
const COMMAND_TIMEOUT = 10_000;

/** pi, or why there is none. `platform` is a web / mobile build. */
export type PiCheck =
  | { kind: "platform" }
  | { kind: "missing" }
  | { kind: "unreadable"; details: string }
  | { kind: "too-old"; executable: string; version: Version }
  | { kind: "too-new"; executable: string; version: Version }
  | { kind: "ready"; executable: string; version: Version; untested: boolean };

/** `1.4.0`. */
export function versionText(version: Version): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/** The first `x.y.z` in `text`, ignoring prefixes such as `pi v` (`pi --version`
 *  prints `1.4.0`; a shell shim may add a line of its own). */
export function parseVersion(text: string): Version | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Negative when `a` is older than `b`, as `Version`'s derived ordering is. */
export function compareVersions(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * The shell whose rc files add the user's own PATH entries: the configured
 * `SHELL`, else the platform's. `null` when there is no shell to ask — a web
 * or mobile build, and Windows (whose `pi` is a `pi.cmd` found by `where`, not
 * a script the POSIX shell returns; `ponytail:` add that when the Windows
 * package ships pi support).
 */
export function loginShell(): string | null {
  const os = process.platform;
  if (os !== "macos" && os !== "linux") return null;
  const configured = process.env.SHELL as string | undefined;
  if (configured !== undefined && configured.startsWith("/")) return configured;
  return os === "macos" ? "/bin/zsh" : "/bin/bash";
}

/** One word for `sh -c`, quoted so a path with spaces survives. */
export function quoteShell(value: string): string {
  return `"${value.replace(/["\\$`]/g, "\\$&")}"`;
}

/**
 * Runs `script` in the login shell. A shell that prints a banner (zsh with an
 * oh-my-zsh theme does) leaves it in the text; callers take the line they need.
 * A refusal by the sandbox (`ERR_ACCESS_DENIED`) rejects here, so callers can
 * tell "the shell said no" from "the command said no".
 */
export async function loginShellCommand(
  script: string,
  timeoutMs = COMMAND_TIMEOUT,
): Promise<CommandOutput> {
  const shell = loginShell();
  if (shell === null) throw new Error("this platform has no login shell");
  // `run` here on purpose: finding pi is one short command before any session
  // exists, and the shell it starts wants its rc files read in order
  // (`spawn`'s streaming form is for `git`, `npm` and the rest of the routes).
  return run(shell, ["-ilc", script], { timeoutMs, cwd: await dataDirectory() });
}

/**
 * A cwd for a child process: the app's data directory, the only root
 * `capabilities.fs.write` grants, created here when a first launch has not made
 * it yet (the child's cwd must exist). `undefined` on a host without one.
 */
export async function dataDirectory(): Promise<string | undefined> {
  const dataDir = process.dataDir;
  if (dataDir === null) return undefined;
  try {
    await mkdir(dataDir, { recursive: true });
  } catch {
    // A cwd the launch rejects is reported by that launch.
  }
  return dataDir;
}

/** `loginShellCommand`'s stdout, trimmed. */
export async function loginShellRun(script: string, timeoutMs = COMMAND_TIMEOUT): Promise<string> {
  const result = await loginShellCommand(script, timeoutMs);
  return result.stdout.trim();
}

/** The last non-empty line of `text`. */
function lastLine(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (line !== "") return line;
  }
  return null;
}

/** The last line of `text` that is an absolute path (`command -v`'s answer
 *  under a chatty shell). */
function lastAbsoluteLine(text: string): string | null {
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (line.startsWith("/")) return line;
  }
  return null;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Finds pi, reads its version and judges it against this app's range. */
export async function checkPi(): Promise<PiCheck> {
  if (loginShell() === null) return { kind: "platform" };

  const explicit = (process.env.PI_EXECUTABLE as string | undefined) ?? "";
  let executable: string | null = explicit !== "" ? explicit : null;
  if (executable === null) {
    let found: CommandOutput;
    try {
      found = await loginShellCommand("command -v pi");
    } catch (cause) {
      // The shell could not even be started (a missing grant, no /bin/zsh): a
      // different problem from "pi is not installed", and worth saying so.
      return { kind: "unreadable", details: describe(cause) };
    }
    executable = lastAbsoluteLine(found.stdout);
  }
  if (executable === null) return { kind: "missing" };

  let output: string;
  try {
    const version = await loginShellCommand(`${quoteShell(executable)} --version`);
    if (version.code !== 0) {
      return { kind: "unreadable", details: lastLine(version.stderr) ?? `exit ${version.code}` };
    }
    output = version.stdout;
  } catch (cause) {
    return { kind: "unreadable", details: describe(cause) };
  }
  const version = parseVersion(output);
  if (version === null) {
    return { kind: "unreadable", details: output !== "" ? output : "no output" };
  }

  if (compareVersions(version, MIN_PI) < 0) return { kind: "too-old", executable, version };
  if (version.major !== MIN_PI.major) return { kind: "too-new", executable, version };
  return { kind: "ready", executable, version, untested: version.minor > TESTED_PI.minor };
}
