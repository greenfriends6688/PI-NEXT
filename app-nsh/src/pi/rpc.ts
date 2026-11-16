// One `pi --mode rpc` child: the user's own pi, spoken to over JSONL.
//
// This replaces the SDK wrapper the bundled server carried (`lib/rpc-manager.ts`
// in pi-next): instead of hosting pi's Node agent inside a server process, the
// window starts the pi the machine already has and drives it through the
// protocol pi documents in `docs/rpc.md` and `docs/rpc-commands.md`.
//
// Three things are deliberate here:
//
// 1. Started through the login shell. `spawn()` may only run a granted name
//    (`pi`, `/bin/zsh`, …) and pi is usually a `#!/usr/bin/env node` script, so
//    a bare `pi` would miss nvm/fnm/volta's `node` — the same reason
//    `install.ts` asks the shell for `command -v pi`. `exec` makes the shell
//    *become* pi, so the pid (and `kill()`'s process group) is pi's own.
// 2. Strict JSONL framing. Records split on LF only and an optional trailing
//    CR is stripped (`docs/rpc.md` "Framing"); a generic line reader would also
//    split on U+2028/U+2029, which are legal inside JSON strings. Records we
//    write escape those two code points for the same reason.
// 3. One promise per command, settled by the `response` carrying its `id`.
//    Everything else pi writes is a session event and goes to the listeners;
//    `extension_ui_response` is the one command pi never answers, so
//    `SessionAgent` sends that one fire-and-forget (`sendRaw`).
import { spawn, type ChildProcess, type ExitResult } from "process";
import { describe } from "../local/request";
import { MIN_PI, checkPi, dataDirectory, loginShell, quoteShell, versionText } from "./install";
import { ensureBridgeExtension } from "./bridge";

/** One record pi wrote: a `response` or a session event (`docs/json.md`). */
export interface RpcRecord {
  /** `response`, `agent_start`, `message_update`, … */
  type?: string;
  [key: string]: unknown;
}

/** pi's answer to one command (`docs/rpc.md` "Protocol records"). */
export interface RpcResponse extends RpcRecord {
  type: "response";
  /** The command it answers, echoed back. */
  command?: string;
  success?: boolean;
  /** The command's result; absent for commands that answer nothing (`abort`). */
  data?: unknown;
  /** Why it failed, when `success` is false. */
  error?: string;
}

/** How the process ended, with the last lines it wrote to stderr. */
export interface RpcExit {
  /** The exit status, `null` when a signal ended it. */
  code: number | null;
  /** The signal that ended it, `null` when it exited. */
  signal: string | null;
  /** Why the runtime ended it (an over-long line, a deadline), when it did. */
  error: string | null;
  /** The last stderr lines: a startup failure explains itself there. */
  stderr: string;
}

/** What to start: a session file to resume, or nothing for a new session. */
export interface PiLaunchOptions {
  /**
   * The folder the pi *process* runs in (a granted one). A resumed session's
   * own folder comes from its JSONL header, not from here — pi resolves every
   * tool and resource path through `SessionManager.getCwd()`.
   */
  cwd?: string;
  /** Resume this session file (`--session <path>`); omitted starts a new session. */
  sessionFile?: string | null;
  /** `--provider` / `--model`, sent together (the CLI refuses one alone). */
  provider?: string;
  modelId?: string;
  /** `--thinking <level>`. */
  thinkingLevel?: string;
  /** `--tools <a,b,c>`, or `--no-tools` for an empty list. `undefined` keeps pi's defaults. */
  toolNames?: string[];
  /** Already-split extra flags. */
  args?: string[];
}

/** Listeners that see records as they arrive (registered before the spawn). */
export interface PiRpcHandlers {
  onEvent?: (record: RpcRecord) => void;
  onExit?: (exit: RpcExit) => void;
}

export interface RpcSendOptions {
  /**
   * How long to wait for the answer. `0`/omitted means no deadline: pi answers
   * every command with one record (a `compact` may take minutes), and the
   * caller's `signal` is the way out.
   */
  timeoutMs?: number | null;
  /** The caller's cancellation: settles the call and drops the pending id. */
  signal?: AbortSignal;
}

/** One command waiting for its `response`. */
interface Pending {
  resolve: (response: RpcResponse) => void;
  reject: (error: Error) => void;
}

/** How many stderr lines are kept to explain a failure. */
const STDERR_TAIL_LINES = 40;
/** How long pi gets to exit on its own after stdin closes, before SIGKILL. */
const SHUTDOWN_GRACE_MS = 1_500;

/** The CLI's requirement for a session pi refuses to resume (`lib/missing-cwd.ts`'s case). */
export const CWD_MISSING_PREFIX = "Stored session working directory does not exist:";

/**
 * The pi executable this machine has, or why there is none: `checkPi()`'s
 * judgement with the route's words for it. Cached: finding pi costs one login
 * shell plus one `pi --version` (~200-500 ms), and the answer cannot change
 * while the app is open.
 */
let executableCache: Promise<string> | null = null;

export function piExecutable(): Promise<string> {
  executableCache ??= locatePi().catch((cause: unknown) => {
    // A refused or failed lookup may be worth retrying (the shell was busy).
    executableCache = null;
    throw cause;
  });
  return executableCache;
}

async function locatePi(): Promise<string> {
  const check = await checkPi();
  switch (check.kind) {
    case "ready":
      return check.executable;
    case "platform":
      throw new Error("This build cannot run pi on this platform.");
    case "missing":
      throw new Error("pi was not found. Install pi, or set PI_EXECUTABLE to its path.");
    case "unreadable":
      throw new Error(`Could not read the version of pi: ${check.details}`);
    case "too-old":
      throw new Error(
        `Installed pi ${versionText(check.version)} (${check.executable}) is too old: `
        + `this app needs pi ${versionText(MIN_PI)} or newer.`,
      );
    case "too-new":
      throw new Error(
        `Installed pi ${versionText(check.version)} (${check.executable}) is a new major version: `
        + `this app supports pi ${MIN_PI.major}.x.`,
      );
  }
}

/** One line of the protocol, UTF-8 with a trailing LF. */
function serialize(value: unknown): string {
  const text = JSON.stringify(value);
  // Legal inside JSON, but a line reader that also splits on them would cut the
  // record in half; pi's own writer escapes them (`modes/rpc/jsonl.ts`).
  return `${text.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")}\n`;
}

function exitMessage(exit: RpcExit): string {
  const how = exit.code !== null ? ` (exit ${exit.code})` : exit.signal ? ` (${exit.signal})` : "";
  const why = exit.error ? `: ${exit.error}` : "";
  const tail = exit.stderr.trim();
  return `pi stopped${how}${why}${tail ? `\n${tail}` : ""}`;
}

/** A running `pi --mode rpc` process. */
export class PiRpc {
  private readonly child: ChildProcess;
  private readonly pending = new Map<string, Pending>();
  private readonly eventListeners = new Set<(record: RpcRecord) => void>();
  private readonly exitListeners = new Set<(exit: RpcExit) => void>();
  private readonly stderrLines: string[] = [];
  private nextId = 1;
  /** False once pi exited (or was stopped): no command can be sent any more. */
  private alive = true;
  /** True between `stop()` and pi's exit. */
  private stopping = false;
  private exit: RpcExit | null = null;
  private killTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor(child: ChildProcess, handlers: PiRpcHandlers) {
    this.child = child;
    child.on("stdout", (line: string) => this.onLine(line));
    child.on("stderr", (line: string) => this.onStderr(line));
    child.on("exit", (result: ExitResult) => this.handleExit(result));
    if (handlers.onEvent) this.eventListeners.add(handlers.onEvent);
    if (handlers.onExit) this.exitListeners.add(handlers.onExit);
  }

  /**
   * Starts pi through the login shell: `exec "$(command -v pi)" --mode rpc …`
   * (the executable `checkPi()` found, quoted, so `PI_EXECUTABLE` works too).
   */
  static async start(options: PiLaunchOptions & PiRpcHandlers = {}): Promise<PiRpc> {
    const executable = await piExecutable();
    const shell = loginShell();
    if (shell === null) throw new Error("this platform has no login shell to find node and pi in");

    const args: string[] = ["--mode", "rpc"];
    if (options.sessionFile) args.push("--session", options.sessionFile);
    if (options.provider) args.push("--provider", options.provider);
    if (options.modelId) args.push("--model", options.modelId);
    if (options.thinkingLevel) args.push("--thinking", options.thinkingLevel);
    if (options.toolNames !== undefined) {
      // `[]` is pi-web's "Chat only" (`--no-tools`); a list is the pinned preset.
      if (options.toolNames.length === 0) args.push("--no-tools");
      else args.push("--tools", options.toolNames.join(","));
    }
    // The app's own extension: the system prompt, the tool set and moving in
    // the session tree, none of which RPC exposes (`src/pi/bridge.ts`).
    const bridge = await ensureBridgeExtension();
    if (bridge !== null) args.push("--extension", bridge);
    for (const extra of options.args ?? []) args.push(extra);

    const script = ["exec", quoteShell(executable), ...args.map(quoteShell)].join(" ");
    // The child's cwd must be a granted write root, and it must exist. A new
    // session passes its own folder (`/api/agent/new`); a resumed one needs no
    // folder here at all — pi reads the session's cwd from its JSONL header and
    // runs every tool there, so the app's data directory is enough.
    const cwd = options.cwd ?? (await dataDirectory());
    const child = spawn(shell, ["-ilc", script], {
      stdin: "pipe",
      lines: true,
      ...(cwd !== undefined ? { cwd } : {}),
    });
    return new PiRpc(child, options);
  }

  /** The last stderr lines, for an error message or the connection card. */
  get stderrTail(): string {
    return this.stderrLines.join("\n");
  }

  /** False once pi exited or `stop()` was called. */
  get exited(): boolean {
    return !this.alive || this.stopping;
  }

  /** The exit, once there was one. */
  get ended(): RpcExit | null {
    return this.exit;
  }

  /** Session events (everything pi writes that is not a `response`). */
  onEvent(listener: (record: RpcRecord) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /** The process's exit (once per process). */
  onExit(listener: (exit: RpcExit) => void): () => void {
    if (this.exit !== null) {
      listener(this.exit);
      return () => {};
    }
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  /** Sends one command and resolves with the `response` carrying its id. */
  send(command: Record<string, unknown>, options: RpcSendOptions = {}): Promise<RpcResponse> {
    if (!this.alive || this.stopping) return Promise.reject(this.goneError());

    const id = `nsh-${this.nextId++}`;
    const type = typeof command.type === "string" ? command.type : "command";
    const signal = options.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cleanup = (): void => {};

    return new Promise<RpcResponse>((resolve, reject) => {
      const pending: Pending = {
        resolve: (response) => {
          cleanup();
          resolve(response);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      };
      const aborted = () => {
        pending.reject(new Error(`The ${type} command was cancelled`));
      };
      cleanup = () => {
        if (this.pending.get(id) === pending) this.pending.delete(id);
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        try {
          signal?.removeEventListener("abort", aborted);
        } catch {
          // A signal from another realm: nothing to detach.
        }
      };

      this.pending.set(id, pending);
      if (typeof options.timeoutMs === "number" && options.timeoutMs > 0) {
        const deadline = options.timeoutMs;
        timer = setTimeout(() => {
          pending.reject(new Error(`pi did not answer the ${type} command within ${Math.round(deadline / 1000)} s`));
        }, deadline);
      }
      if (signal) {
        if (signal.aborted) {
          aborted();
          return;
        }
        signal.addEventListener("abort", aborted);
      }
      try {
        this.child.write(serialize({ ...command, id }));
      } catch (cause) {
        pending.reject(new Error(describe(cause)));
      }
    });
  }

  /**
   * Writes one command without waiting for a `response`. Only
   * `extension_ui_response` needs this: pi answers it through the extension,
   * never with a protocol record (`docs/rpc-extension-ui.md`).
   */
  sendRaw(command: Record<string, unknown>): void {
    if (!this.alive || this.stopping) throw this.goneError();
    this.child.write(serialize(command));
  }

  /** Closes stdin (pi's orderly shutdown), then kills it if it lingers. */
  stop(): void {
    if (this.stopping || !this.alive) return;
    this.stopping = true;
    this.rejectAll(new Error("the agent stopped"));
    try {
      this.child.end();
    } catch {
      // Already closed.
    }
    this.killTimer = setTimeout(() => {
      this.killTimer = undefined;
      try {
        this.child.kill();
      } catch {
        // Already gone.
      }
    }, SHUTDOWN_GRACE_MS);
  }

  // ---------------------------------------------------------------- internal

  private goneError(): Error {
    return this.exit !== null ? new Error(exitMessage(this.exit)) : new Error("the agent stopped");
  }

  private onLine(line: string): void {
    // A record is one line; LF is the only terminator (`docs/rpc.md` framing).
    const text = line.trim();
    if (text === "") return;
    let record: RpcRecord;
    try {
      record = JSON.parse(text) as RpcRecord;
    } catch {
      // Not a protocol record (a stray print on stdout). Diagnostics go to
      // stderr, so this is a bug in something pi loaded; keep it visible in the
      // tail rather than dropping it silently.
      this.pushStderr(`[stdout] ${text.slice(0, 2_000)}`);
      return;
    }
    if (record === null || typeof record !== "object") return;

    if (record.type === "response" && typeof record.id === "string") {
      const waiter = this.pending.get(record.id);
      // A response for a call the caller gave up on has nowhere to go.
      if (waiter) waiter.resolve(record as RpcResponse);
      return;
    }
    for (const listener of [...this.eventListeners]) {
      try {
        listener(record);
      } catch {
        // One listener's bug must not stop the others (or the reader).
      }
    }
  }

  private onStderr(line: string): void {
    this.pushStderr(line);
  }

  private pushStderr(line: string): void {
    this.stderrLines.push(line);
    while (this.stderrLines.length > STDERR_TAIL_LINES) this.stderrLines.shift();
  }

  private handleExit(result: ExitResult): void {
    if (this.killTimer !== undefined) {
      clearTimeout(this.killTimer);
      this.killTimer = undefined;
    }
    if (!this.alive) return;
    this.alive = false;
    this.stopping = false;
    this.exit = {
      code: result.code ?? null,
      signal: result.signal ?? null,
      error: result.error ?? null,
      stderr: this.stderrTail,
    };
    this.rejectAll(new Error(exitMessage(this.exit)));
    const listeners = [...this.exitListeners];
    this.exitListeners.clear();
    for (const listener of listeners) {
      try {
        listener(this.exit);
      } catch {
        // The process is gone either way.
      }
    }
  }

  private rejectAll(error: Error): void {
    const waiters = [...this.pending.values()];
    this.pending.clear();
    for (const waiter of waiters) waiter.reject(error);
  }
}
