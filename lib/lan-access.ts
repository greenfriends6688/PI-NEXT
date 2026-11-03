/**
 * 局域网访问的令牌闸门（手机/平板通过同一局域网打开 Pi Web 时用）。
 *
 * 背景：Pi Web **没有登录**（proxy.ts 里记着这条裁定）。而 `isApiRequestHostAllowed()`
 * 为了保留局域网访问，把任意 IP 字面量都判为可信 —— 于是 `pi-web -H 0.0.0.0` 之后，
 * 同网段任何人都能发消息、跑工具、改文件。产品默认绑 127.0.0.1，所以平时没有这个问题。
 *
 * 这条闸门只在**设置了令牌**时存在：
 * - 没设置 → 一字不改（本机与显式 `-H 0.0.0.0` 的老行为都不变）。
 * - 已设置 → loopback 请求照旧放行（桌面 App、e2e 不受影响），只有从别的机器来的请求
 *   要出示令牌。
 *
 * 令牌存在 `<agentDir>/lan-access.json`（0600），由 /api/lan/access 打开时现生成；
 * `PI_WEB_LAN_TOKEN` 仍可覆盖（headless / CI）。
 *
 * 取令牌的三处（顺序即优先级）：`Authorization` → cookie → `?t=`。浏览器发不了自定义头，
 * EventSource 连 cookie 都来不及带，所以 `?t=` 是手机扫码/点链接进来的入口。
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { networkInterfaces } from "node:os";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";

/** 承载令牌的 cookie 名。httpOnly：JS 读不到，XSS 也偷不走。 */
export const LAN_COOKIE_NAME = "pi-web-lan";
/** 局域网直连是明文 http，cookie 30 天有效 = 令牌的轮换周期。 */
export const LAN_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
/** HMAC 的固定标签。改它 = 旧只读链接全部失效，这正是想要的轮换方式。 */
const READ_ONLY_LABEL = "pi-web-lan-readonly:v1";
/** 免令牌可达的唯一写入路径：手机只有 6 位码，没有令牌。 */
const PAIR_EXEMPT_PATHS = new Set(["/api/lan/pair/redeem"]);

export interface LanAccessConfig {
  version: 1;
  /** 48 位十六进制随机串。 */
  token: string;
  /** 用户是否要开着。缺省 true（有令牌就开着）。 */
  enabled: boolean;
}

const CACHE_KEY = Symbol.for("pi-web.lanAccessConfig");

function lanAccessConfigPath(): string {
  return join(getAgentDir(), "lan-access.json");
}

function readLanAccessConfigUncached(): LanAccessConfig | null {
  const path = lanAccessConfigPath();
  if (!existsSync(path)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const entry = parsed as Record<string, unknown>;
  const token = typeof entry.token === "string" ? entry.token.trim() : "";
  // 令牌形状自己也要认：手写的、旧版本留下的空壳都当没配。
  if (!/^[0-9a-f]{32,128}$/i.test(token)) return null;
  return { version: 1, token, enabled: entry.enabled !== false };
}

export function readLanAccessConfig(): LanAccessConfig | null {
  const registry = globalThis as unknown as Record<symbol, { path: string; mtimeMs: number; value: LanAccessConfig | null } | undefined>;
  const path = lanAccessConfigPath();
  let mtimeMs = 0;
  try {
    mtimeMs = existsSync(path) ? statSync(path).mtimeMs : 0;
  } catch {
    return null;
  }
  const cached = registry[CACHE_KEY];
  if (cached && cached.path === path && cached.mtimeMs === mtimeMs) return cached.value;
  const value = readLanAccessConfigUncached();
  registry[CACHE_KEY] = { path, mtimeMs, value };
  return value;
}

export function writeLanAccessConfig(config: LanAccessConfig): LanAccessConfig {
  mkdirSync(dirname(lanAccessConfigPath()), { recursive: true });
  writePrivateFileAtomicSync(lanAccessConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
  // 立刻失效缓存：mtime 的同一毫秒分辨率下会拿到旧值。
  delete (globalThis as unknown as Record<symbol, unknown>)[CACHE_KEY];
  return config;
}

/** 幂等：已有可用配置就原样返回，没有就生成一个并落盘（0600）。 */
export function ensureLanAccessConfig(): LanAccessConfig {
  const existing = readLanAccessConfig();
  if (existing) return existing;
  const created: LanAccessConfig = { version: 1, token: randomBytes(24).toString("hex"), enabled: true };
  writeLanAccessConfig(created);
  return created;
}

export function readLanToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const fromEnv = env.PI_WEB_LAN_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const stored = readLanAccessConfig();
  if (!stored || !stored.enabled) return undefined;
  return stored.token;
}

/** 只读令牌：由完整令牌确定性派生，不落盘。只放行 GET/HEAD。 */
export function deriveReadOnlyToken(fullToken: string): string {
  return createHmac("sha256", fullToken).update(READ_ONLY_LABEL).digest("base64url");
}

function safeEqual(presented: string, expected: string): boolean {
  const left = Buffer.from(presented, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.byteLength !== right.byteLength) return false;
  return timingSafeEqual(left, right);
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    if (value) return value;
  }
  return null;
}

function safePathname(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "";
  }
}

/** 请求是不是从本机发出的。看 Host：局域网 IP、隧道域名都不算 loopback。 */
export function isLoopbackRequest(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return false;
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  return hostname === "::1" || hostname.startsWith("127.");
}

/** 局域网直连是明文 http；走 https 隧道/反代时才翻 Secure，否则浏览器根本不存 cookie。 */
export function lanCookieSecure(request: { headers: { get(name: string): string | null } }): boolean {
  return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
}

export interface PresentedLanToken {
  value: string;
  /** 从 `?t=` 拿到的话，响应要把它种成 cookie，页面随后就是普通请求了。 */
  fromQuery: boolean;
}

export function presentedLanToken(request: Request): PresentedLanToken | null {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match) return { value: match[1].trim(), fromQuery: false };
  }
  const cookie = cookieValue(request, LAN_COOKIE_NAME);
  if (cookie) return { value: cookie, fromQuery: false };
  let query: string | null = null;
  try {
    query = new URL(request.url).searchParams.get("t");
  } catch {
    query = null;
  }
  if (query) return { value: query, fromQuery: true };
  return null;
}

export type LanAccessDecision =
  | { ok: true; readOnly: boolean; plantCookie?: string }
  | { ok: false; status: 401 | 403; reason: string };

/**
 * 请求能不能过。没设令牌时永远放行 —— 默认行为不变是硬约束。
 *
 * `readToken` 是留给测试的注入点：默认实现会去读 `~/.pi/agent/lan-access.json`，
 * 而测试机器上可能真有一份（用户自己开过局域网），那会让「没设令牌」这条基线测不出来。
 */
export function checkLanAccess(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
  readToken: (env: NodeJS.ProcessEnv) => string | undefined = readLanToken,
): LanAccessDecision {
  const fullToken = readToken(env);
  if (!fullToken) return { ok: true, readOnly: false };
  if (isLoopbackRequest(request)) return { ok: true, readOnly: false };
  if (PAIR_EXEMPT_PATHS.has(safePathname(request))) return { ok: true, readOnly: false };

  const presented = presentedLanToken(request);
  if (!presented) {
    return { ok: false, status: 401, reason: "This Pi Web requires a LAN token. Pair this device from the desktop (Settings → Phone)." };
  }
  if (safeEqual(presented.value, fullToken)) {
    return presented.fromQuery ? { ok: true, readOnly: false, plantCookie: presented.value } : { ok: true, readOnly: false };
  }
  if (safeEqual(presented.value, deriveReadOnlyToken(fullToken))) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return { ok: false, status: 403, reason: "the read-only LAN token may only use GET and HEAD" };
    }
    return presented.fromQuery ? { ok: true, readOnly: true, plantCookie: presented.value } : { ok: true, readOnly: true };
  }
  return { ok: false, status: 401, reason: "invalid LAN token" };
}

/** 本次运行是不是已经绑到网卡上（有令牌但还绑在 loopback 时，界面提示「重启后生效」）。 */
export function lanAccessState(): { token: string | undefined; boundLan: boolean; needsRebind: boolean } {
  const token = readLanToken();
  const hostname = process.env.PI_WEB_HOSTNAME?.trim() ?? "";
  const boundLan = Boolean(hostname) && hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1";
  return { token, boundLan, needsRebind: Boolean(token) && !boundLan };
}

/**
 * 本机能被手机打开的地址。通配地址不能给手机用，169.254 链路本地在没有 DHCP 时指向空气，
 * 两类都剔掉，其余原样交给人选 —— 猜错网卡比多列一行更麻烦。
 */
export function listLanUrls(port: number): string[] {
  const urls: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const info of addresses ?? []) {
      const isIpv4 = String(info.family) === "4" || info.family === "IPv4";
      if (!isIpv4 || info.internal) continue;
      if (info.address.startsWith("169.254.")) continue;
      urls.push(`http://${info.address}:${port}`);
    }
  }
  return urls;
}

/** 从请求的 Host 里取端口。反代可能改写 Host，所以只认其中的数字。 */
export function requestPort(request: Request, fallback: number): number {
  const host = request.headers.get("host") ?? "";
  const match = /:(\d{1,5})$/.exec(host);
  if (!match) return fallback;
  const port = Number(match[1]);
  return port >= 1 && port <= 65535 ? port : fallback;
}
