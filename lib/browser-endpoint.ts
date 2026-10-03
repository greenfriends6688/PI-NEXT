/**
 * fork:proma-42-browser · 桌面宿主（Electron 主进程）端点描述文件。
 *
 * Next 服务（跑 agent 的那个进程）与 Electron 主进程是两个进程，之间只能走
 * 127.0.0.1 上的一个极小的 JSON 行协议。端口与令牌写在 `~/.pi/agent/browser-host.json`：
 * 端口**动态分配**（不用固定端口，就不会被别的本机进程抢走或被记住后复用）。
 *
 * 三条安全约束：
 *   · 文件 0600 + 同目录 staging + `renameSync` 原子替换 —— 端口与令牌是能力凭据，
 *     半写的文件会让下一次启动连上一个已经退出的进程，或者读到半个 token；
 *   · 文件内容**只由桌面端写**；服务端（Next）只读，且读到就当作不可信输入重新校验；
 *   · 解析失败只回 `null`，绝不把文件内容回显到任何路由响应里（同 `lib/mcp-config-file.ts`）。
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const BROWSER_HOST_ENDPOINT_VERSION = 1;

export interface BrowserHostEndpoint {
  version: number;
  /** 恒为 loopback：受管浏览器的控制面永远不出本机。 */
  host: string;
  port: number;
  /** 每次启动重新生成的会话令牌。 */
  token: string;
  /** 写文件的主进程 pid；用来识别「文件比进程活得久」的陈旧端点。 */
  pid: number;
  startedAt: number;
}

export function browserHostEndpointPath(home: string = homedir()): string {
  return join(home, ".pi", "agent", "browser-host.json");
}

function isBrowserHostEndpoint(value: unknown): value is BrowserHostEndpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.version === BROWSER_HOST_ENDPOINT_VERSION
    && record.host === "127.0.0.1"
    && typeof record.port === "number"
    && Number.isInteger(record.port)
    && record.port > 0
    && record.port < 65536
    && typeof record.token === "string"
    && record.token.length >= 16
    && typeof record.pid === "number"
    && Number.isInteger(record.pid);
}

export function readBrowserHostEndpoint(path: string = browserHostEndpointPath()): BrowserHostEndpoint | null {
  try {
    if (!existsSync(path)) return null;
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return isBrowserHostEndpoint(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function createBrowserHostEndpoint(port: number, pid: number, now = Date.now()): BrowserHostEndpoint {
  return {
    version: BROWSER_HOST_ENDPOINT_VERSION,
    host: "127.0.0.1",
    port,
    token: randomBytes(32).toString("hex"),
    pid,
    startedAt: now,
  };
}

export function writeBrowserHostEndpoint(
  endpoint: BrowserHostEndpoint,
  path: string = browserHostEndpointPath(),
): void {
  mkdirSync(dirname(path), { recursive: true });
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, `${JSON.stringify(endpoint, null, 2)}\n`, { mode: 0o600 });
  chmodSync(staging, 0o600);
  renameSync(staging, path);
  chmodSync(path, 0o600);
}

/** 退出时清掉：留着会让下一次 `next start`（没有桌面端）连一个死进程。 */
export function clearBrowserHostEndpoint(path: string = browserHostEndpointPath()): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* 清不掉不是错误：读端会因连不上而自行失效。 */
  }
}

/** 进程还活着吗（`kill(pid, 0)` 不发信号）。陈旧端点必须被忽略。 */
export function isEndpointProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = 进程存在但不属于当前用户，仍然算活着。
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class BrowserHostUnavailableError extends Error {
  readonly reason: "no-endpoint" | "stale-endpoint" | "not-responding" | "rejected";

  constructor(reason: BrowserHostUnavailableError["reason"], message: string) {
    super(message);
    this.name = "BrowserHostUnavailableError";
    this.reason = reason;
  }
}

/**
 * 「这次能用吗」的单一判定。Web 部署（没有桌面端）会走 `no-endpoint`，
 * 工具据此给出一句人话，而不是把连接异常丢给模型。
 */
export function resolveBrowserHostEndpoint(path: string = browserHostEndpointPath()): BrowserHostEndpoint {
  const endpoint = readBrowserHostEndpoint(path);
  if (!endpoint) {
    throw new BrowserHostUnavailableError(
      "no-endpoint",
      "受管浏览器只在 Pi Web 桌面端可用（当前是 Web 部署，没有本地浏览器宿主）。网页仍可在「浏览器」标签里手动打开。",
    );
  }
  if (!isEndpointProcessAlive(endpoint.pid)) {
    throw new BrowserHostUnavailableError(
      "stale-endpoint",
      "本地浏览器宿主已退出，请重启桌面端后重试。",
    );
  }
  return endpoint;
}