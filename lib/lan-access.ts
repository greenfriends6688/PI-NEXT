/**
 * fork:lan-access —— 局域网可达性的**唯一**闸门（2026-10-03）。
 *
 * 背景：本产品**没有登录**（`proxy.ts` 里记着 2026-09-28 的用户裁定，`app/login/` 与
 * `app/api/web-auth/` 已整段删除）。但 `isApiRequestHostAllowed()` 为了保留局域网访问，
 * 把任意 IP 字面量都判为可信 —— 于是 `pi-web -H 0.0.0.0` 之后，同网段任何人都是管理员：
 * 发消息、跑工具、写删文件、改 `mcp.json`。实测 `http://<LAN-IP>:30141/` 直接 200。
 *
 * 借的是 MusePi 的那条规则（`packages/coding-agent/src/daemon/server.ts:9595-9597`）：
 * **有没有令牌，决定要不要暴露到网卡上**。这里落成 `PI_WEB_LAN_TOKEN`：
 *
 * - **未设置** → 一字不改地保持今天的行为（本机随便用；`-H 0.0.0.0` 时启动器照旧告警）。
 *   默认零登录这条裁定不受影响。
 * - **已设置** → loopback 请求照旧放行（桌面 App、`npm run prod`、e2e 都不受影响），
 *   只有从别的机器来的请求需要出示令牌。
 *
 * 两种令牌，一个 env：
 * - **完整令牌** = `PI_WEB_LAN_TOKEN` 本身，任何方法都放行。
 * - **只读令牌** = `HMAC-SHA256(完整令牌, "pi-web-lan-readonly:v1")`，**只放行 GET/HEAD**。
 *   派生的好处：不需要任何存储，换台机器/重启进程照样能凭 env 重新算出来。
 *
 * 取令牌的三处（顺序即优先级，`Authorization` → cookie → `?t=`）：浏览器发不了自定义头，
 * 而 EventSource 连 cookie 都来不及带，所以 `?t=` 是手机配对链接必须的入口。
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { writePrivateFileAtomicSync } from "./atomic-file";
import { isLoopbackRequest } from "./request-security";

/** 承载令牌的 cookie 名。httpOnly：JS 读不到，XSS 也偷不走。 */
export const LAN_COOKIE_NAME = "pi-web-lan";

/** HMAC 的固定标签。改它 = 旧只读链接全部失效，这正是我们想要的轮换方式。 */
const READ_ONLY_LABEL = "pi-web-lan-readonly:v1";

/** cookie 里的令牌直接就是令牌本身，所以有效期就是令牌的轮换周期。30 天。 */
export const LAN_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * LAN cookie 的 `secure` 标志。局域网直连是明文 http，标了 Secure 浏览器直接不存 ——
 * 所以缺省 false。但走隧道/反代（`tailscale serve`、cloudflared、devtunnel）到达时是
 * 公网 https，此时 cookie 应该标 Secure，不该被降级成可被明文截获的形态。
 * 终端直连看不到 `x-forwarded-proto`，这个头缺失 = 明文，恒 false。
 * 多级代理会把每跳都追加进去（"https,http"），第一跳才是浏览器到边缘的 scheme。
 */
export function lanCookieSecure(request: {
  headers: { get(name: string): string | null };
}): boolean {
  const firstHop = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return firstHop === "https";
}

/**
 * 换令牌时必须能免登录到达的那一条路径：手机只有 6 位码，没有令牌。
 * 这里只放行这一个 POST，其余 `/api/**` 一律照常要令牌。
 */
const PAIR_EXEMPT_PATHS = new Set(["/api/lan/pair/redeem"]);

/**
 * 局域网接入的**自有配置**（用户 2026-10-03 裁定：默认就该能用，不该让人先去敲 env）。
 *
 * 之前只有 `PI_WEB_LAN_TOKEN` 一个 env：用户必须记住它、重启、还得自己加 `-H 0.0.0.0`，
 * 于是「配对」默认是**暂停**状态 —— 这正是被骂的那点。现在令牌由应用自己生成并存到
 * `~/.pi/agent/lan-access.json`（0600）：启动器看到它就把服务绑到 0.0.0.0，闸门同时生效，
 * 所以「开箱能用」与「不裸奔」不再二选一。
 *
 * - env `PI_WEB_LAN_TOKEN` 仍然优先（headless / CI / 显式覆盖）。
 * - `enabled: false` = 用户点了「停止」→ 下次启动只绑 loopback（fail closed）。
 * - 文件损坏或被删 → 当作没令牌 → 启动器退回 loopback，而不是退回裸奔。
 */
export interface LanAccessConfig {
  version: 1;
  /** 48 位十六进制随机串。 */
  token: string;
  /** 用户是否要开着。缺省 true（有令牌就开着）。 */
  enabled: boolean;
}

function lanAccessConfigPath(): string {
  return join(getAgentDir(), "lan-access.json");
}

/** 进程内缓存：令牌只在应用自己写它的时候变（同进程），所以不必每次请求都读盘。 */
const CACHE_KEY = Symbol.for("pi-web.lanAccessConfig");

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
  // 令牌形状自己也要认：别人手写了这个文件、或旧版本留下的空壳，都当没配。
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

function newLanToken(): string {
  return randomBytes(24).toString("hex");
}

/** 幂等：已有可用配置就原样返回，没有就生成一个并落盘（0600）。 */
export function ensureLanAccessConfig(): LanAccessConfig {
  const existing = readLanAccessConfig();
  if (existing) return existing;
  const created: LanAccessConfig = { version: 1, token: newLanToken(), enabled: true };
  writeLanAccessConfig(created);
  return created;
}

export function writeLanAccessConfig(config: LanAccessConfig): LanAccessConfig {
  mkdirSync(dirname(lanAccessConfigPath()), { recursive: true });
  writePrivateFileAtomicSync(lanAccessConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
  // 立刻失效缓存：进程内读的是 mtime，mtime 相同的时间分辨率下会拿到旧值。
  const registry = globalThis as unknown as Record<symbol, unknown>;
  delete registry[CACHE_KEY];
  return config;
}

export function lanAccessConfigExists(): boolean {
  return readLanAccessConfig() !== null;
}

export function readLanToken(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnv = env.PI_WEB_LAN_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const stored = readLanAccessConfig();
  if (!stored || !stored.enabled) return undefined;
  return stored.token;
}

/**
 * 给界面用：这次运行到底是「开着」「开着但还没绑网卡」还是「没开」。
 *
 * `needsRebind` 必须是「**有令牌且真的没绑**」。第一版写成「有令牌且令牌不是 env 来的」，
 * 于是启动器自动重启成功之后它仍然是 true，界面上永远写着「正在开启…」—— 状态报错的代价
 * 是用户不再相信这个提示，所以两个字段都由实测状态推出来。
 */
export function lanAccessState(): {
  token: string | undefined;
  needsRebind: boolean;
  boundLan: boolean;
} {
  const fromEnv = process.env.PI_WEB_LAN_TOKEN?.trim();
  const stored = readLanAccessConfig();
  const token = fromEnv ?? (stored?.enabled ? stored.token : undefined);
  const boundLan = Boolean(token) && isBoundToLan();
  return { token, boundLan, needsRebind: Boolean(token) && !boundLan };
}

function isBoundToLan(): boolean {
  const hostname = process.env.PI_WEB_HOSTNAME?.trim();
  return Boolean(hostname) && hostname !== "127.0.0.1" && hostname !== "localhost" && hostname !== "::1";
}

/** 只读令牌：由完整令牌确定性派生，不落盘、不进 registry。 */
export function deriveReadOnlyToken(fullToken: string): string {
  return createHmac("sha256", fullToken)
    .update(READ_ONLY_LABEL)
    .digest("base64url");
}

function safeEqual(presented: string, expected: string): boolean {
  const left = Buffer.from(presented, "utf8");
  const right = Buffer.from(expected, "utf8");
  // timingSafeEqual 长度不等会抛，长度本身不是秘密。
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

function queryToken(request: Request): string | null {
  try {
    return new URL(request.url).searchParams.get("t");
  } catch {
    return null;
  }
}

export interface PresentedLanToken {
  value: string;
  /** 从 `?t=` 拿到的话，响应要把它种成 cookie，页面随后就能用普通请求了。 */
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
  const query = queryToken(request);
  if (query) return { value: query, fromQuery: true };
  return null;
}

export type LanAccessDecision =
  | { ok: true; readOnly: boolean; plantCookie?: string }
  | { ok: false; status: 401 | 403; reason: string };

function isReadOnlyMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function isPairExemptPath(pathname: string): boolean {
  return PAIR_EXEMPT_PATHS.has(pathname);
}

/**
 * 请求能不能过。`PI_WEB_LAN_TOKEN` 没设置时永远放行 —— 默认行为不变是硬约束。
 */
export function checkLanAccess(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): LanAccessDecision {
  const fullToken = readLanToken(env);
  if (!fullToken) return { ok: true, readOnly: false };
  if (isLoopbackRequest(request)) return { ok: true, readOnly: false };
  if (isPairExemptPath(safePathname(request))) return { ok: true, readOnly: false };

  const presented = presentedLanToken(request);
  if (!presented) {
    return {
      ok: false,
      status: 401,
      reason: "PI_WEB_LAN_TOKEN is set and this request did not come from this machine",
    };
  }

  if (safeEqual(presented.value, fullToken)) {
    return presented.fromQuery
      ? { ok: true, readOnly: false, plantCookie: presented.value }
      : { ok: true, readOnly: false };
  }

  if (safeEqual(presented.value, deriveReadOnlyToken(fullToken))) {
    if (!isReadOnlyMethod(request.method)) {
      return {
        ok: false,
        status: 403,
        reason: "the read-only LAN token may only use GET and HEAD",
      };
    }
    return presented.fromQuery
      ? { ok: true, readOnly: true, plantCookie: presented.value }
      : { ok: true, readOnly: true };
  }

  return { ok: false, status: 401, reason: "invalid LAN token" };
}

function safePathname(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "";
  }
}
