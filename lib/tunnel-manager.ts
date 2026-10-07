/**
 * fork:mobile-shell —— 「5G 控制」隧道管理器（服务端）。
 *
 * 从设置页启停 cloudflared quick tunnel（零账号）：spawn → 从 stderr 解析
 * `https://xxx.trycloudflare.com` → **运行时放行**（把 host 追加进
 * `process.env.PI_WEB_ALLOWED_HOSTS`，名单每请求现读 env，免重启）→ 崩溃自动重试。
 *
 * - 开关持久化在 `~/.pi/agent/tunnel-link.json`（0600）：enabled 时服务重启会自动拉起
 *   （与 bot-channel 的「重启即消失」教训同一条），地址每次都会变，手机重新配对一次。
 * - 每次地址变更都追加放行、不删旧的：旧 host 留在名单里无害（闸门在令牌层）。
 * - cloudflared 用显式 `--metrics 127.0.0.1:<port>`：本机 /etc/hosts 可能缺 localhost，
   默认 metrics 会解析失败并拖死进程（实测）。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { writePrivateFileAtomicSync } from "./atomic-file";
import { getAgentDir } from "./session-reader";

const METRICS_PORT = 36501;
const MAX_RESTARTS = 5;
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

export interface TunnelState {
  /** 配置开关：重启后是否自动拉起。 */
  enabled: boolean;
  /** 进程活着且已解析出地址。 */
  running: boolean;
  url: string | null;
  phoneAddress: string | null;
  lastError: string | null;
  pid: number | null;
  restarts: number;
  cloudflaredMissing: boolean;
}

const STATE_KEY = Symbol.for("pi-web.tunnelState");
const CHILD_KEY = Symbol.for("pi-web.tunnelChild");
const TIMER_KEY = Symbol.for("pi-web.tunnelRestartTimer");

interface Registry {
  [STATE_KEY]?: TunnelState;
  [CHILD_KEY]?: ChildProcess;
  [TIMER_KEY]?: ReturnType<typeof setTimeout>;
}

function registry(): Registry {
  return globalThis as unknown as Registry;
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
};

function getState(): TunnelState {
  return registry()[STATE_KEY] ?? INITIAL_STATE;
}

function setState(patch: Partial<TunnelState>): void {
  registry()[STATE_KEY] = { ...getState(), ...patch };
}

/** 从 cloudflared 输出解析 quick tunnel 地址（导出供测试）。 */
export function parseTunnelUrl(log: string): string | null {
  return URL_RE.exec(log)?.[0] ?? null;
}

function configPath(): string {
  return join(getAgentDir(), "tunnel-link.json");
}

function readEnabled(): boolean {
  const path = configPath();
  if (!existsSync(path)) return false;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { enabled?: unknown };
    return parsed.enabled === true;
  } catch {
    return false;
  }
}

function writeEnabled(enabled: boolean): void {
  writePrivateFileAtomicSync(configPath(), `${JSON.stringify({ version: 1, enabled }, null, 2)}\n`);
}

function localPort(): string {
  return process.env.PORT?.trim() || "30141";
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

let restartAttempt = 0;

/**
 * 解析 cloudflared 的启动方式 —— **不依赖 PATH**。
 *
 * 坑：npm 装的 `cloudflared` 可执行文件是个 Node 脚本（shebang `#!/usr/bin/env node`），
 * 双重依赖 PATH（脚本位置 + node 本身）。服务若是从没加载 nvm 的 shell 拉起来的
 * （2026-10-07 实测：13:41 那代进程 env 里没有 nvm），spawn("cloudflared") 直接 ENOENT。
 * 所以按候选绝对路径解析：JS 入口 → 用**正在跑的这只 node**（process.execPath）执行；
 * 真二进制 → 直接 spawn；都找不到才回落 PATH。
 */
function resolveCloudflared(): { command: string; prefix: string[] } {
  const candidates: Array<{ command: string; prefix: string[] }> = [];
  const fromEnv = process.env.CLOUDFLARED_BIN?.trim();
  if (fromEnv) candidates.push({ command: fromEnv, prefix: [] });

  // 1) 与"正在跑的 node"同级的 npm -g 布局（无需枚举）
  const nodeBin = dirname(process.execPath);
  const fromNodeLib = join(nodeBin, "..", "lib", "node_modules", "cloudflared", "lib", "cloudflared.js");
  if (existsSync(fromNodeLib)) candidates.push({ command: process.execPath, prefix: [fromNodeLib] });

  // 2) 用户 nvm 里所有 node 版本的 npm -g 布局（服务可能不是用 nvm 那只 node 跑的）
  try {
    const nvmNodeDir = join(process.env.HOME ?? "", ".nvm", "versions", "node");
    for (const version of readdirSync(nvmNodeDir)) {
      const entry = join(nvmNodeDir, version, "lib", "node_modules", "cloudflared", "lib", "cloudflared.js");
      if (existsSync(entry)) candidates.push({ command: process.execPath, prefix: [entry] });
    }
  } catch { /* 没有 nvm 目录 */ }

  // 3) 家酿/系统真二进制
  for (const binary of ["/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared"]) {
    if (existsSync(binary)) candidates.push({ command: binary, prefix: [] });
  }

  return candidates[0] ?? { command: "cloudflared", prefix: [] };
}

function launch(): void {
  const resolved = resolveCloudflared();
  const child = spawn(
    resolved.command,
    [
      ...resolved.prefix,
      "tunnel",
      "--url", `http://127.0.0.1:${localPort()}`,
      "--no-autoupdate",
      "--metrics", `127.0.0.1:${METRICS_PORT}`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  registry()[CHILD_KEY] = child;
  setState({ running: false, pid: child.pid ?? null, lastError: null });

  let log = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    log += chunk;
    if (log.length > 64 * 1024) log = log.slice(-32 * 1024);
    const url = parseTunnelUrl(log);
    if (url && !getState().running) {
      restartAttempt = 0;
      const host = new URL(url).host;
      allowHost(host);
      setState({
        running: true,
        url,
        phoneAddress: `${url}/pair`,
        lastError: null,
      });
    }
    if (/Cannot resolve|failed to connect|Unable to reach/.test(chunk)) {
      setState({ lastError: chunk.trim().slice(0, 160) });
    }
  });

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

  child.on("exit", (code) => {
    if (registry()[CHILD_KEY] !== child) return; // 已被 stop/新进程取代
    registry()[CHILD_KEY] = undefined;
    // 崩溃自动重试（手动停止时 enabled 已被置 false，不会走到这）。
    if (getState().enabled && restartAttempt < MAX_RESTARTS) {
      restartAttempt += 1;
      setState({ running: false, pid: null, restarts: getState().restarts + 1 });
      const timer = setTimeout(() => {
        registry()[TIMER_KEY] = undefined;
        if (getState().enabled) launch();
      }, 3000 * restartAttempt);
      if (typeof timer === "object" && "unref" in timer) timer.unref();
      registry()[TIMER_KEY] = timer;
    } else {
      setState({ running: false, pid: null });
    }
    void code;
  });
}

/** 启动隧道（幂等）。写 enabled 配置，服务重启后由 instrumentation 自动拉起。 */
export function startTunnel(): TunnelState {
  if (getState().running) return getState();
  writeEnabled(true);
  setState({ enabled: true, cloudflaredMissing: false, lastError: null });
  launch();
  return getState();
}

/** 停止隧道并关掉自动拉起。 */
export function stopTunnel(): TunnelState {
  writeEnabled(false);
  const timer = registry()[TIMER_KEY];
  if (timer) clearTimeout(timer);
  registry()[TIMER_KEY] = undefined;
  setState({ enabled: false, restarts: 0 });
  killChild();
  setState({ running: false, pid: null });
  return getState();
}

/** 杀掉 cloudflared 子进程（不改配置）——进程退出时兜底，防止孤儿隧道。 */
export function stopTunnelProcess(): void {
  killChild();
}

function killChild(): void {
  const child = registry()[CHILD_KEY];
  if (!child) return;
  registry()[CHILD_KEY] = undefined;
  child.removeAllListeners("exit");
  try { child.kill("SIGTERM"); } catch { /* gone */ }
}

/** 服务启动时：配置 enabled 才自动拉起（幂等）。 */
export function maybeAutoStartTunnel(): void {
  if (readEnabled()) {
    setState({ enabled: true });
    launch();
  } else {
    setState({ enabled: false });
  }
}

export function getTunnelState(): TunnelState {
  return getState();
}
