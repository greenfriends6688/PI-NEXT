// A child process that does not freeze the window.
//
// `process.run()` reports through a promise but blocks the JS thread while the
// child runs: QuickJS has one thread, and the host's call returns only when the
// child does. Asking for `git status` with it froze the right panel for as long
// as git took — a press that "did nothing" and then suddenly landed. `spawn` is
// the streaming form: the host keeps the child on its own thread and delivers
// its output as events, so the UI keeps drawing.
//
// This is `run`'s shape — `{ code, signal, stdout, stderr }`, a deadline, an
// 8 MiB cap — built on `spawn`.
import { spawn, type ChildProcess } from "process";
import { dataDirectory } from "../pi/install";

export interface CommandOutput {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string | null;
  timeoutMs?: number | null;
}

/** How much of one stream is kept (`run`'s own 8 MiB). */
const MAX_OUTPUT = 8 * 1024 * 1024;

/**
 * Runs `command` (granted by `capabilities.process.execute`) and answers its
 * output once it exits. A deadline kills the process tree; a command that never
 * started rejects with the OS's code.
 */
export async function runAsync(
  command: string,
  args: readonly string[] = [],
  options: RunOptions = {},
): Promise<CommandOutput> {
  const cwd = options.cwd === undefined ? await dataDirectory() : (options.cwd ?? undefined);
  const child: ChildProcess = spawn(command, [...args], { lines: false, cwd });
  const stdout: string[] = [];
  let stdoutBytes = 0;
  const stderr: string[] = [];
  let stderrBytes = 0;
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill();
    } catch {
      // Already gone.
    }
  }, options.timeoutMs ?? 30_000);

  return new Promise<CommandOutput>((resolve) => {
    child.on("stdout", (chunk: string) => {
      if (stdoutBytes >= MAX_OUTPUT) return;
      stdoutBytes += chunk.length;
      stdout.push(chunk);
    });
    child.on("stderr", (chunk: string) => {
      if (stderrBytes >= MAX_OUTPUT) return;
      stderrBytes += chunk.length;
      stderr.push(chunk);
    });
    child.on("exit", (result) => {
      clearTimeout(timer);
      resolve({
        code: result.code ?? null,
        signal: result.signal ?? null,
        stdout: stdout.join(""),
        stderr: timedOut ? `${stderr.join("")}\n(timed out)` : stderr.join(""),
      });
    });
  });
}

/** `runAsync`'s stdout, trimmed — `loginShellRun`'s shape over `spawn`. */
export async function shellRun(
  shell: string,
  script: string,
  timeoutMs = 30_000,
): Promise<CommandOutput> {
  return runAsync(shell, ["-ilc", script], { timeoutMs });
}
