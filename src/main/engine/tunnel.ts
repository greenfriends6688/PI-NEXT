/**
 * 5G 控制 —— Cloudflare quick tunnel（`cloudflared tunnel --url http://127.0.0.1:<port>`）。
 *
 * Ported from the old PI NEXT web server's `tunnel-manager.ts`, including the three
 * hardening points that were found the hard way and must travel together:
 *
 * 1. **The address survives a restart.** `cloudflared` is spawned detached with its
 *    stdout/stderr going to a log file rather than to our pipes, and its pid + address
 *    are persisted in `tunnel-link.json`. On the next launch, if that pid is still
 *    alive the app *adopts* the same tunnel — the address is unchanged and the phone
 *    does not have to be re-paired.
 * 2. **Unlimited reconnect.** The process exiting schedules a respawn with a backoff
 *    capped at two minutes and no attempt limit; only switching the feature off stops
 *    it. A crash at 4am should not silently end the tunnel.
 * 3. **A registration watchdog.** Within 60 seconds of starting, the log must show a
 *    `Registered tunnel connection` line, else the process is killed and retried — that
 *    covers the "alive but never reached the edge" hang that a live pid hides. While
 *    running, the pid is checked every 60 seconds.
 *
 * Two smaller invariants the old file learned the same way: `--metrics` is bound to a
 * **freshly probed free port** (cloudflared treats a metrics bind failure as fatal, and
 * reusing one fixed port right after a respawn made the new process exit instantly and
 * the supervisor loop forever), and the binary is resolved **without relying on PATH**
 * (an npm-installed `cloudflared` is a Node wrapper whose shebang needs a node the app
 * may never have loaded; the package's real binary is preferred, then the wrapper via
 * `process.execPath`).
 *
 * Deliberately *not* ported: the old `PI_WEB_ALLOWED_HOSTS` allow-list. Pinext's
 * `RemoteServer` decides origin itself (`isOwnOrigin`: the request's Origin must match
 * its Host), and a browser arriving through the tunnel sends both as the same
 * `*.trycloudflare.com` host, so it passes without any allow-list. The old
 * `/api/web-token` shortcut required the peer to be loopback; over a tunnel the peer is
 * Cloudflare, so it is refused and the browser falls back to typing the remote-access
 * password — which is *correct*: the tunnel puts the service on the public internet, and
 * the password is the door. Nothing is missing here.
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import type { TunnelState } from "@shared/ipc";
import { getPinextPaths } from "./paths.ts";
import { uiText } from "./ui-text.ts";

const READY_TIMEOUT_MS = 60_000;
const WATCHDOG_INTERVAL_MS = 60_000;
const RESPAWN_BASE_MS = 3_000;
const RESPAWN_MAX_MS = 120_000;
/** The address cloudflared prints for a quick tunnel. */
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

const INITIAL_STATE: TunnelState = {
  enabled: false,
  running: false,
  url: null,
  phoneAddress: null,
  lastError: null,
  pid: null,
  restarts: 0,
  cloudflaredMissing: false,
  adopted: false,
};

interface TunnelLinkConfig {
  version: 1;
  enabled: boolean;
  /** Local port the tunnel forwards to; a change retargets the tunnel on next bring-up. */
  port?: number;
  pid?: number;
  url?: string;
  updatedAt?: string;
}

let state: TunnelState = { ...INITIAL_STATE };
/** The port the live `cloudflared` was launched against, so a respawn keeps targeting it. */
let activePort: number | null = null;
/** Bumped on each respawn so the backoff grows. Reset when a tunnel registers. */
let respawnAttempt = 0;
let respawnTimer: ReturnType<typeof setTimeout> | undefined;
let watchdog: ReturnType<typeof setInterval> | undefined;
/**
 * The pid of the process *this* module spawned. `exit` compares against it so a process
 * replaced by stop / a relaunch does not schedule a respawn for the one that is gone.
 */
let spawnedPid: number | undefined;

// ---- config + log paths -------------------------------------------------------------

function configPath(): string {
  return getPinextPaths().tunnelFile;
}

function logFilePath(): string {
  return getPinextPaths().tunnelLogFile;
}

function writeFileAtomic(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, contents, { mode: 0o600 });
  renameSync(temp, path);
}

function readConfig(): TunnelLinkConfig {
  const path = configPath();
  if (!existsSync(path)) return { version: 1, enabled: false };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<TunnelLinkConfig>;
    return {
      version: 1,
      enabled: parsed.enabled === true,
      ...(typeof parsed.port === "number" ? { port: parsed.port } : {}),
      ...(typeof parsed.pid === "number" ? { pid: parsed.pid } : {}),
      ...(typeof parsed.url === "string" && parsed.url ? { url: parsed.url } : {}),
    };
  } catch {
    return { version: 1, enabled: false };
  }
}

function writeConfig(patch: Partial<TunnelLinkConfig>): void {
  const next: TunnelLinkConfig = { ...readConfig(), ...patch, version: 1, updatedAt: new Date().toISOString() };
  writeFileAtomic(configPath(), `${JSON.stringify(next, null, 2)}\n`);
}

// ---- pure helpers (tested) ----------------------------------------------------------

/** Extract the quick-tunnel address from `cloudflared`'s output, or null while it is absent. */
export function parseTunnelUrl(log: string): string | null {
  return URL_RE.exec(log)?.[0] ?? null;
}

/**
 * The respawn backoff: linear in the attempt count, capped. Exported so the growth is
 * pinned by a test rather than discovered as "it restarts every two minutes forever".
 */
export function respawnDelayMs(attempt: number): number {
  return Math.min(RESPAWN_BASE_MS * Math.max(1, attempt), RESPAWN_MAX_MS);
}

export type CloudflaredCommand = {
  command: string;
  /** Arguments that go before `tunnel`; non-empty only for the npm JS wrapper. */
  prefix: string[];
  /** True when `command` is our own Node/Electron binary running a `.js` wrapper. */
  viaNode: boolean;
};

export type CloudflaredResolveOptions = {
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  home?: string;
  /** Extra package roots to inspect (a fake tree in tests). */
  packageRoots?: string[];
  /** Extra standalone binary paths, replacing the Homebrew / usr-local defaults. */
  binDirs?: string[];
};

/**
 * Locate `cloudflared` without depending on PATH.
 *
 * npm's `cloudflared` package installs a Node wrapper (`lib/cloudflared.js`) whose
 * shebang needs a `node` on PATH; an app launched without the shell that installed nvm
 * does not have one, and `spawn("cloudflared")` dies with ENOENT. So, in order:
 *
 *   1. `$CLOUDFLARED_BIN`, if set;
 *   2. a **real binary** inside an npm package root (`<pkg>/bin/cloudflared`) — one
 *      process, clean signals;
 *   3. `/opt/homebrew/bin/cloudflared`, `/usr/local/bin/cloudflared`;
 *   4. the package's **JS wrapper**, run through `process.execPath` (the Node/Electron
 *      already running is always available).
 *
 * A real binary anywhere beats a JS wrapper, which is why the two are collected
 * separately and only then concatenated.
 */
export function resolveCloudflared(options: CloudflaredResolveOptions = {}): CloudflaredCommand {
  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  const home = options.home ?? env.HOME ?? "";
  const direct: CloudflaredCommand[] = [];
  const viaJs: CloudflaredCommand[] = [];

  const fromEnv = env.CLOUDFLARED_BIN?.trim();
  if (fromEnv) direct.push({ command: fromEnv, prefix: [], viaNode: false });

  const packageRoots = new Set<string>(options.packageRoots ?? []);
  // `<node>/bin/cloudflared` is `<node>/lib/node_modules/cloudflared`.
  packageRoots.add(join(dirname(execPath), "..", "lib", "node_modules", "cloudflared"));
  try {
    const nvmNodeDir = join(home, ".nvm", "versions", "node");
    for (const version of readdirSync(nvmNodeDir)) {
      packageRoots.add(join(nvmNodeDir, version, "lib", "node_modules", "cloudflared"));
    }
  } catch {
    /* no nvm directory */
  }

  for (const root of packageRoots) {
    const binary = join(root, "bin", "cloudflared");
    if (existsSync(binary)) direct.push({ command: binary, prefix: [], viaNode: false });
    const js = join(root, "lib", "cloudflared.js");
    if (existsSync(js)) viaJs.push({ command: execPath, prefix: [js], viaNode: true });
  }
  for (const binary of options.binDirs ?? ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"]) {
    if (existsSync(binary)) direct.push({ command: binary, prefix: [], viaNode: false });
  }

  return direct[0] ?? viaJs[0] ?? { command: "cloudflared", prefix: [], viaNode: false };
}

/** Whether a real `cloudflared` (binary or npm wrapper) can be found without PATH. */
function cloudflaredAvailable(): boolean {
  const resolved = resolveCloudflared();
  if (resolved.viaNode) return resolved.prefix.length > 0 && existsSync(resolved.prefix[0]!);
  return existsSync(resolved.command);
}

function missingMessage(): string {
  return uiText(
    "cloudflared 未安装：终端执行 npm i -g cloudflared",
    "cloudflared is not installed. Run `npm i -g cloudflared` in a terminal.",
  );
}

/** Does `pid` belong to a live `cloudflared`? `kill(pid, 0)` alone says only "a process". */
function isCloudflaredPid(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0); // existence
  } catch {
    return false;
  }
  try {
    const command =
      process.platform === "win32"
        ? execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { timeout: 2000 }).toString()
        : execFileSync("ps", ["-p", String(pid), "-o", "comm="], { timeout: 2000 }).toString().trim();
    return command.toLowerCase().includes("cloudflared");
  } catch {
    return false;
  }
}

/**
 * A free port for `--metrics`.
 *
 * cloudflared treats a metrics bind failure as fatal (it exits), and a fixed port is
 * still held for a moment when a respawn starts before the previous process has fully
 * died — the new process then exits instantly and the supervisor loops forever. Probing
 * a fresh port avoids the collision entirely.
 */
async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.on("error", () => resolve(36510));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 36510;
      server.close(() => resolve(port));
    });
  });
}

// ---- lifecycle -----------------------------------------------------------------------

async function launch(port: number): Promise<void> {
  // Bury the previous process before starting a new one: a pid left alive by a SIGTERM
  // that did not take will otherwise race the new one (and metrics port conflicts used
  // to turn that into an endless restart loop).
  const stalePid = state.pid ?? readConfig().pid;
  if (stalePid && isCloudflaredPid(stalePid)) {
    spawnedPid = undefined; // this process is no longer ours to watch
    try {
      process.kill(stalePid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }

  activePort = port;
  const resolved = resolveCloudflared();
  const metricsPort = await findFreePort();
  const logPath = logFilePath();
  let logFd: number;
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    logFd = openSync(logPath, "a");
  } catch {
    state = { ...state, lastError: uiText(`无法写入隧道日志：${logPath}`, `Cannot write the tunnel log: ${logPath}`) };
    return;
  }
  let offsetBefore = 0;
  try {
    offsetBefore = statSync(logPath).size;
  } catch {
    /* brand new */
  }

  let child: ChildProcess;
  try {
    const spawnEnv =
      resolved.viaNode && process.versions.electron
        ? { ...process.env, ELECTRON_RUN_AS_NODE: "1" }
        : process.env;
    child = spawn(
      resolved.command,
      [
        ...resolved.prefix,
        "tunnel",
        "--url", `http://127.0.0.1:${port}`,
        "--no-autoupdate",
        "--metrics", `127.0.0.1:${metricsPort}`,
      ],
      // detached: cloudflared gets its own session, so this app exiting or restarting
      // does not take it down — that is what lets the next launch adopt the same
      // address instead of minting a new one.
      { detached: true, stdio: ["ignore", "ignore", logFd], env: spawnEnv },
    );
  } finally {
    closeSync(logFd);
  }
  child.unref();

  spawnedPid = child.pid;
  state = { ...state, running: false, pid: child.pid ?? null, url: null, phoneAddress: null, lastError: null, adopted: false };
  writeConfig({ enabled: true, pid: child.pid, url: undefined, port });

  child.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      state = { ...state, running: false, cloudflaredMissing: true, lastError: missingMessage() };
      return;
    }
    state = { ...state, lastError: error.message };
  });

  child.on("exit", () => {
    if (spawnedPid !== child.pid) return; // stop / relaunch already replaced us
    spawnedPid = undefined;
    scheduleRespawn(uiText("cloudflared 退出", "cloudflared exited"));
  });

  void waitForReady(child, logPath, offsetBefore);
}

/** Poll the log: wait for the address, wait for edge registration; time out into a retry. */
async function waitForReady(child: ChildProcess, logPath: string, offset: number): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let seen = "";
  while (Date.now() < deadline) {
    if (spawnedPid !== child.pid) return; // stop took over
    if (child.exitCode != null || !isCloudflaredPid(child.pid)) return; // exit handler retries

    let text = "";
    try {
      const size = statSync(logPath).size;
      const from = offset;
      const length = Math.max(0, Math.min(size - from, 256 * 1024));
      if (length > 0) {
        const buffer = Buffer.alloc(length);
        const fd = openSync(logPath, "r");
        try {
          readSync(fd, buffer, 0, length, from);
        } finally {
          closeSync(fd);
        }
        text = buffer.toString("utf8");
      }
    } catch {
      /* not written yet */
    }
    if (text) seen += text;

    const url = parseTunnelUrl(seen);
    const registered = /Registered tunnel connection/.test(seen);
    if (url && registered && !state.running) {
      respawnAttempt = 0;
      writeConfig({ enabled: true, pid: child.pid, url });
      state = {
        ...state,
        running: true,
        url,
        // Pinext serves its web client at the root, so the address itself is where the
        // phone goes; there is no separate pairing path.
        phoneAddress: url,
        lastError: null,
        pid: child.pid ?? null,
      };
      ensureWatchdog();
      return;
    }
    if (url && !state.running) {
      // Address is known but the edge is not registered yet; show it, keep `running` false.
      state = { ...state, url, phoneAddress: url };
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  state = { ...state, lastError: uiText("隧道 60 秒内未注册到边缘，正在重试", "The tunnel did not register at the edge within 60 seconds; retrying") };
  try {
    process.kill(child.pid ?? 0, "SIGTERM");
  } catch {
    /* gone */
  }
  scheduleRespawn(uiText("注册超时", "registration timed out"));
}

function clearRespawnTimer(): void {
  if (respawnTimer) clearTimeout(respawnTimer);
  respawnTimer = undefined;
}

function scheduleRespawn(reason: string): void {
  if (!state.enabled) return;
  if (respawnTimer) return;
  respawnAttempt += 1;
  state = {
    ...state,
    running: false,
    lastError: state.lastError ?? reason,
    restarts: state.restarts + 1,
  };
  const timer = setTimeout(() => {
    respawnTimer = undefined;
    const port = activePort ?? readConfig().port;
    if (state.enabled && port) void launch(port);
  }, respawnDelayMs(respawnAttempt));
  timer.unref?.();
  respawnTimer = timer;
}

/** Runtime watchdog: a pid that vanished without an exit event still gets a retry. Single instance. */
function ensureWatchdog(): void {
  if (watchdog) return;
  watchdog = setInterval(() => {
    if (!state.enabled) return;
    if (state.pid && !isCloudflaredPid(state.pid)) {
      scheduleRespawn(uiText("看门狗：进程消失", "watchdog: the process is gone"));
    }
  }, WATCHDOG_INTERVAL_MS);
  watchdog.unref?.();
}

// ---- public surface ------------------------------------------------------------------

/** Start the tunnel (idempotent). Persists `enabled` so a restart brings it back. */
export function startTunnel(port: number): TunnelState {
  if (state.running) return getTunnelState();
  clearRespawnTimer();
  writeConfig({ enabled: true, port });
  state = { ...state, enabled: true, cloudflaredMissing: false, lastError: null, restarts: 0 };
  respawnAttempt = 0;
  void launch(port);
  return getTunnelState();
}

/** Stop the tunnel and switch off auto-restart (kills the detached process, clears pid/url). */
export function stopTunnel(): TunnelState {
  writeConfig({ enabled: false, pid: undefined, url: undefined });
  clearRespawnTimer();
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = undefined;
  }
  const pid = state.pid ?? spawnedPid;
  if (pid) {
    spawnedPid = undefined; // keep the exit handler from scheduling a respawn
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* gone */
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already dead */
    }
  }
  state = { ...state, enabled: false, running: false, pid: null, url: null, phoneAddress: null, restarts: 0, adopted: false };
  return getTunnelState();
}

/**
 * Called as remote access comes up. If the tunnel was on and its pid is still alive, the
 * same tunnel is **adopted** (address unchanged); otherwise — including when the local
 * port changed — a fresh one is launched.
 */
export function maybeAutoStartTunnel(port: number): void {
  const config = readConfig();
  if (!config.enabled) {
    state = { ...state, enabled: false };
    return;
  }
  state = { ...state, enabled: true };
  const samePort = config.port === port;
  if (samePort && state.running && state.pid !== null && state.pid === config.pid) return; // already ours
  if (samePort && config.pid && config.url && isCloudflaredPid(config.pid)) {
    activePort = port;
    state = {
      ...state,
      running: true,
      adopted: true,
      pid: config.pid,
      url: config.url,
      phoneAddress: config.url,
      lastError: null,
    };
    spawnedPid = config.pid;
    ensureWatchdog();
    return;
  }
  void launch(port);
}

/** The state the settings pane draws. `cloudflaredMissing` is re-derived so installing it while the app runs is seen. */
export function getTunnelState(): TunnelState {
  if (cloudflaredAvailable()) return state;
  return {
    ...state,
    cloudflaredMissing: true,
    lastError: state.lastError ?? missingMessage(),
  };
}
