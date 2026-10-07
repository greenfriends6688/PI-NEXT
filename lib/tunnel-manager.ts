/**
 * fork:mobile-shell —— 「5G 控制」隧道管理器（服务端，加固版）。
 *
 * 加固点（对「动不动就关掉」的三个真弱点）：
 * 1. **地址跨服务重启存活**：cloudflared 以 detached 方式独立运行、stderr 落日志文件
 *    （不挂父进程的管道），pid+地址持久化在 `~/.pi/agent/tunnel-link.json`。服务重启后
 *    只要 pid 还活着就**收养**同一只隧道——地址不变、手机不用重新配对。
 * 2. **无限自动重连**：进程退出即重拉，退避封顶 2 分钟、不设次数上限（开关关掉才停）。
 * 3. **注册看门狗**：起隧道后 60 秒内必须出现 "Registered tunnel connection"，
 *    否则杀掉重来（覆盖「进程活着但没连上边缘」的挂死态）；运行期每 60 秒校验 pid 存活。
 *
 * 其余不变量：运行时放行（env 追加，每请求现读免重启）、显式 --metrics（本机 /etc/hosts
 * 可能缺 localhost，默认 metrics 会把进程拖死）、启动不依赖 PATH（npm 装的包按绝对路径解析，
 * JS 包装层用 process.execPath 执行）。
 */

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";

import { writePrivateFileAtomicSync } from "./atomic-file";
import { getAgentDir } from "./session-reader";

const READY_TIMEOUT_MS = 60_000;
const WATCHDOG_INTERVAL_MS = 60_000;
const RESPAWN_BASE_MS = 3_000;
const RESPAWN_MAX_MS = 120_000;
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

/**
 * 找一个空闲的 metrics 端口。cloudflared 的 metrics 监听失败是**致命错误**（进程直接退出），
 * 而 `--metrics 127.0.0.1:<固定端口>` 在「上一只还没断气就重拉」时会撞端口 → 新进程秒死 →
 * 无限重启循环（2026-10-07 实测）。动态探测从根上避开。
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

export interface TunnelState {
  enabled: boolean;
  running: boolean;
  url: string | null;
  phoneAddress: string | null;
  lastError: string | null;
  pid: number | null;
  restarts: number;
  cloudflaredMissing: boolean;
  /** true = 本轮服务从磁盘收养的既有隧道（地址没变过）。 */
  adopted: boolean;
}

interface TunnelLinkConfig {
  version: 2;
  enabled: boolean;
  pid?: number;
  url?: string;
  updatedAt?: string;
}

const STATE_KEY = Symbol.for("pi-web.tunnelState");
const TIMER_KEY = Symbol.for("pi-web.tunnelRespawnTimer");
const WATCHDOG_KEY = Symbol.for("pi-web.tunnelWatchdog");
const SPAWNED_PID_KEY = Symbol.for("pi-web.tunnelSpawnedPid");

interface Registry {
  [STATE_KEY]?: TunnelState;
  [TIMER_KEY]?: ReturnType<typeof setTimeout>;
  [WATCHDOG_KEY]?: ReturnType<typeof setInterval>;
  [SPAWNED_PID_KEY]?: number;
}

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

const registry: Registry = globalThis as unknown as Registry;

function getState(): TunnelState {
  return registry[STATE_KEY] ?? INITIAL_STATE;
}

function setState(patch: Partial<TunnelState>): void {
  registry[STATE_KEY] = { ...getState(), ...patch };
}

/** 从 cloudflared 输出解析 quick tunnel 地址（导出供测试）。 */
export function parseTunnelUrl(log: string): string | null {
  return URL_RE.exec(log)?.[0] ?? null;
}

// ---- 配置（v2：enabled + pid + url 一起持久化，供跨服务重启收养） --------------------

function configPath(): string {
  return join(getAgentDir(), "tunnel-link.json");
}

function readConfig(): TunnelLinkConfig {
  const path = configPath();
  if (!existsSync(path)) return { version: 2, enabled: false };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<TunnelLinkConfig>;
    return {
      version: 2,
      enabled: parsed.enabled === true,
      ...(typeof parsed.pid === "number" ? { pid: parsed.pid } : {}),
      ...(typeof parsed.url === "string" && parsed.url ? { url: parsed.url } : {}),
    };
  } catch {
    return { version: 2, enabled: false };
  }
}

function writeConfig(patch: Partial<TunnelLinkConfig>): void {
  const next: TunnelLinkConfig = { ...readConfig(), ...patch, version: 2, updatedAt: new Date().toISOString() };
  writePrivateFileAtomicSync(configPath(), `${JSON.stringify(next, null, 2)}\n`);
}

function localPort(): string {
  return process.env.PORT?.trim() || "30141";
}

function logFilePath(): string {
  return join(getAgentDir(), "tunnel.log");
}

/** 运行时放行：追加进 env 名单（幂等，不删旧）。 */
function allowHost(host: string): void {
  const current = new Set(
    (process.env.PI_WEB_ALLOWED_HOSTS ?? "").split(",").map((v) => v.trim()).filter(Boolean),
  );
  if (current.has(host)) return;
  current.add(host);
  process.env.PI_WEB_ALLOWED_HOSTS = [...current].join(",");
}

// ---- 进程解析（不依赖 PATH） ---------------------------------------------------------

/**
 * npm 装的 `cloudflared` 可执行文件是 **Node 包装脚本**（shebang `#!/usr/bin/env node`），
 * 双重依赖 PATH（脚本位置 + node 本身）；服务若是从没加载 nvm 的 shell 拉起来（2026-10-07
 * 实测），spawn("cloudflared") 直接 ENOENT。所以：
 * 优先解析出包内**真二进制**（`<pkg>/bin/cloudflared`，单进程、信号干净），
 * 拿不到再退回 JS 包装层 + `process.execPath`（正在跑的 node 必然可用）。
 */
function resolveCloudflared(): { command: string; prefix: string[] } {
  const direct: Array<{ command: string; prefix: string[] }> = [];
  const viaJs: Array<{ command: string; prefix: string[] }> = [];
  const fromEnv = process.env.CLOUDFLARED_BIN?.trim();
  if (fromEnv) direct.push({ command: fromEnv, prefix: [] });

  const packageRoots = new Set<string>();
  const nodeBin = dirname(process.execPath);
  packageRoots.add(join(nodeBin, "..", "lib", "node_modules", "cloudflared"));
  try {
    const nvmNodeDir = join(process.env.HOME ?? "", ".nvm", "versions", "node");
    for (const version of readdirSync(nvmNodeDir)) {
      packageRoots.add(join(nvmNodeDir, version, "lib", "node_modules", "cloudflared"));
    }
  } catch { /* 没有 nvm 目录 */ }

  for (const root of packageRoots) {
    const binary = join(root, "bin", "cloudflared");
    if (existsSync(binary)) direct.push({ command: binary, prefix: [] });
    const js = join(root, "lib", "cloudflared.js");
    if (existsSync(js)) viaJs.push({ command: process.execPath, prefix: [js] });
  }
  for (const binary of ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"]) {
    if (existsSync(binary)) direct.push({ command: binary, prefix: [] });
  }
  return direct[0] ?? viaJs[0] ?? { command: "cloudflared", prefix: [] };
}

function isCloudflaredPid(pid: number | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0); // 存在性
  } catch {
    return false;
  }
  try {
    const comm = execFileSync("ps", ["-p", String(pid), "-o", "comm="], { timeout: 2000 })
      .toString().trim();
    return comm.toLowerCase().includes("cloudflared");
  } catch {
    return false;
  }
}

// ---- 生命周期 ------------------------------------------------------------------------

let respawnAttempt = 0;

async function launch(): Promise<void> {
  // 重拉前先收尸：配置里记的那只若还活着（SIGTERM 未生效/收养后失控），先杀掉，
  // 否则会与新进程抢资源（曾经因此被 metrics 端口冲突打成无限重启循环）。
  const stalePid = getState().pid ?? readConfig().pid;
  if (stalePid && isCloudflaredPid(stalePid)) {
    try { process.kill(stalePid, "SIGKILL"); } catch { /* gone */ }
  }

  const resolved = resolveCloudflared();
  const metricsPort = await findFreePort();
  const logPath = logFilePath();
  let logFd: number;
  try {
    logFd = openSync(logPath, "a");
  } catch {
    setState({ lastError: `无法写入隧道日志：${logPath}` });
    return;
  }
  const offsetBefore = (() => {
    try { return statSync(logPath).size; } catch { return 0; }
  })();

  let child: ChildProcess;
  try {
    child = spawn(
      resolved.command,
      [
        ...resolved.prefix,
        "tunnel",
        "--url", `http://127.0.0.1:${localPort()}`,
        "--no-autoupdate",
        "--metrics", `127.0.0.1:${metricsPort}`,
      ],
      // detached：cloudflared 独立成会话，服务进程重启/退出都不带走它——
      // 地址因此能跨服务重启存活（下次启动按持久化的 pid 收养）。
      { detached: true, stdio: ["ignore", "ignore", logFd] },
    );
  } finally {
    closeSync(logFd);
  }
  child.unref();

  registry[SPAWNED_PID_KEY] = child.pid ?? undefined;
  setState({ running: false, pid: child.pid ?? null, lastError: null, adopted: false });
  writeConfig({ enabled: true, pid: child.pid, url: undefined });

  child.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      setState({
        running: false,
        cloudflaredMissing: true,
        lastError: "cloudflared 未安装：终端执行 npm i -g cloudflared",
      });
      return;
    }
    setState({ lastError: error.message });
  });

  child.on("exit", () => {
    if (registry[SPAWNED_PID_KEY] !== child.pid) return; // 已被 stop/新进程取代
    registry[SPAWNED_PID_KEY] = undefined;
    scheduleRespawn("cloudflared 退出");
  });

  void waitForReady(child, logPath, offsetBefore);
}

/** 轮询日志文件：等 URL 出现、等边缘注册完成；超时/进程死亡则交由重试。 */
async function waitForReady(child: ChildProcess, logPath: string, offset: number): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let seen = "";
  while (Date.now() < deadline) {
    if (registry[SPAWNED_PID_KEY] !== child.pid) return; // stop 已接管
    if (child.exitCode != null || !isCloudflaredPid(child.pid)) {
      return; // exit 回调会安排重试
    }
    let text = "";
    try {
      const size = statSync(logPath).size;
      const from = offset;
      const length = Math.max(0, Math.min(size - from, 256 * 1024));
      if (length > 0) {
        const buffer = Buffer.alloc(length);
        const fd = openSync(logPath, "r");
        try { readSync(fd, buffer, 0, length, from); } finally { closeSync(fd); }
        text = buffer.toString("utf8");
      }
    } catch { /* 还没写 */ }
    if (text) seen += text;
    const url = parseTunnelUrl(seen);
    const registered = /Registered tunnel connection/.test(seen);
    if (url && registered && !getState().running) {
      respawnAttempt = 0;
      allowHost(new URL(url).host);
      writeConfig({ enabled: true, pid: child.pid, url });
      setState({ running: true, url, phoneAddress: `${url}/pair`, lastError: null, pid: child.pid ?? null });
      ensureWatchdog();
      return;
    }
    if (url && !getState().running) {
      // URL 有了但还没注册：先让卡片能看到地址（标注未就绪由 running 表达）。
      setState({ url, phoneAddress: `${url}/pair` });
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  // 60 秒都没注册成功：杀掉重来（覆盖「进程活着但挂死」）。
  setState({ lastError: "隧道 60 秒内未注册到边缘，正在重试" });
  try { process.kill(child.pid ?? 0, "SIGTERM"); } catch { /* gone */ }
  scheduleRespawn("注册超时");
}

function scheduleRespawn(reason: string): void {
  if (!getState().enabled) return;
  if (registry[TIMER_KEY]) return;
  respawnAttempt += 1;
  const delay = Math.min(RESPAWN_BASE_MS * respawnAttempt, RESPAWN_MAX_MS);
  setState({
    running: false,
    lastError: getState().lastError ?? reason,
    restarts: getState().restarts + 1,
  });
  const timer = setTimeout(() => {
    registry[TIMER_KEY] = undefined;
    if (getState().enabled) void launch();
  }, delay);
  timer.unref?.();
  registry[TIMER_KEY] = timer;
}

/** 运行期看门狗：pid 死了（事件没等到）就重拉。单例。 */
function ensureWatchdog(): void {
  if (registry[WATCHDOG_KEY]) return;
  const timer = setInterval(() => {
    const state = getState();
    if (!state.enabled) return;
    if (state.pid && !isCloudflaredPid(state.pid)) {
      scheduleRespawn("看门狗：进程消失");
    }
  }, WATCHDOG_INTERVAL_MS);
  timer.unref?.();
  registry[WATCHDOG_KEY] = timer;
}

/** 启动隧道（幂等）。写 enabled 配置，服务重启后由 instrumentation 自动拉起。 */
export function startTunnel(): TunnelState {
  if (getState().running) return getState();
  stopTimers();
  writeConfig({ enabled: true });
  setState({ enabled: true, cloudflaredMissing: false, lastError: null, restarts: 0 });
  respawnAttempt = 0;
  void launch();
  return getState();
}

/** 停止隧道并关掉自动拉起（杀掉独立进程、清掉持久化的 pid/url）。 */
export function stopTunnel(): TunnelState {
  writeConfig({ enabled: false, pid: undefined, url: undefined });
  stopTimers();
  const pid = getState().pid ?? registry[SPAWNED_PID_KEY];
  if (pid) {
    registry[SPAWNED_PID_KEY] = undefined; // 防 exit 回调误触发重拉
    try { process.kill(pid, "SIGTERM"); } catch { /* gone */ }
    try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
  }
  setState({ enabled: false, running: false, pid: null, restarts: 0, adopted: false });
  return getState();
}

function stopTimers(): void {
  const respawn = registry[TIMER_KEY];
  if (respawn) clearTimeout(respawn);
  registry[TIMER_KEY] = undefined;
}

/** 兼容旧调用（服务关停时不再杀隧道——独立性正是加固点 1）。保留为显式操作。 */
export function stopTunnelProcess(): TunnelState {
  return stopTunnel();
}

/** 服务启动时：enabled 才动。pid 活着就**收养**（地址不变），否则新拉一只。 */
export function maybeAutoStartTunnel(): void {
  const config = readConfig();
  if (!config.enabled) {
    setState({ enabled: false });
    return;
  }
  setState({ enabled: true });
  if (config.pid && config.url && isCloudflaredPid(config.pid)) {
    try {
      allowHost(new URL(config.url).host);
      setState({
        running: true,
        adopted: true,
        pid: config.pid,
        url: config.url,
        phoneAddress: `${config.url}/pair`,
        lastError: null,
      });
      registry[SPAWNED_PID_KEY] = config.pid;
      ensureWatchdog();
      return;
    } catch {
      // url 坏了，走新拉
    }
  }
  void launch();
}

export function getTunnelState(): TunnelState {
  return getState();
}
