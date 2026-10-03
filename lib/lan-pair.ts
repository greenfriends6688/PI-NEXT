/**
 * fork:lan-access —— 手机配对：6 位码 + 一次性消费。
 *
 * 抄 MusePi 的形状（`packages/coding-agent/src/collab/pair-codes.ts`：mint / spend /
 * 10 分钟 TTL，用掉即删），但砍掉他们那半个系统：他们要额外开一个 `0.0.0.0` 的
 * 8301 端口专门解析这个码（**而且那个端口完全无鉴权**），因为他们的桌面端和手机端是
 * 两套传输。这里同源 HTTP，手机扫/输完码直接 POST 到本服务，`?t=` 与 cookie 都省了。
 *
 * 码本身**不存令牌**，只存 `full` / `readonly` 这一个种类：兑码时按当时的
 * `PI_WEB_LAN_TOKEN` 现算。换令牌等于让所有在飞行的码立刻作废 —— 这正是想要的语义。
 */

import { randomInt } from "node:crypto";
import { networkInterfaces } from "node:os";

/** 与 MusePi 同档：10 分钟。 */
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_LENGTH = 6;

/** `readonly` 是 TS 保留字语境下的关键字，用大写避免噪声。 */
export type LanPairKind = "full" | "readonly";

interface PairEntry {
  kind: LanPairKind;
  expiresAt: number;
}

export class LanPairCodes {
  #entries = new Map<string, PairEntry>();

  /** 同一条码被 mint 出来两次就重抽，避免同一个码对应两个持有者。 */
  mint(kind: LanPairKind = "full", now: number = Date.now()): {
    code: string;
    kind: LanPairKind;
    expiresInSeconds: number;
  } {
    this.#prune(now);
    let code = this.#draw();
    while (this.#entries.has(code)) code = this.#draw();
    this.#entries.set(code, { kind, expiresAt: now + CODE_TTL_MS });
    return { code, kind, expiresInSeconds: Math.floor(CODE_TTL_MS / 1000) };
  }

  /** 用掉即删：同一个码被截图转发也只会被消费一次。 */
  spend(code: string, now: number = Date.now()): LanPairKind | null {
    this.#prune(now);
    const entry = this.#entries.get(code);
    if (!entry) return null;
    this.#entries.delete(code);
    return entry.kind;
  }

  get size(): number {
    this.#prune(Date.now());
    return this.#entries.size;
  }

  #draw(): string {
    let out = "";
    for (let i = 0; i < CODE_LENGTH; i++) out += String(randomInt(0, 10));
    return out;
  }

  #prune(now: number): void {
    for (const [code, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(code);
    }
  }
}

/**
 * 进程级单例，但挂在 `globalThis` 上：`next dev` 的热重载会重建模块作用域，
 * 普通模块级 Map 会被清空，用户刚拿到的码就废了（`AGENTS.md` 里
 * `__piSessions` / `__piStartLocks` 是同一个理由）。
 */
const PAIR_CODES_KEY = Symbol.for("pi-web.lanPairCodes");

export function lanPairCodes(): LanPairCodes {
  const registry = globalThis as unknown as Record<symbol, LanPairCodes | undefined>;
  const existing = registry[PAIR_CODES_KEY];
  if (existing) return existing;
  const created = new LanPairCodes();
  registry[PAIR_CODES_KEY] = created;
  return created;
}

/**
 * 本机能被手机打开的地址。`0.0.0.0` 是通配地址，不能给手机用；
 * 169.254 链路本地在没有 DHCP 时会指向空气。两类都剔掉，其余原样交给人选 ——
 * 猜错网卡比多列一行更麻烦。
 */
export function listLanUrls(port: number): string[] {
  const urls: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const info of addresses ?? []) {
      // `family` 在不同 Node/@types/node 版本里是数字 4 还是字符串 "IPv4"，两种都认。
      const isIpv4 = String(info.family) === "4" || info.family === "IPv4";
      if (!isIpv4 || info.internal) continue;
      if (info.address.startsWith("169.254.")) continue;
      urls.push(`http://${info.address}:${port}`);
    }
  }
  return urls;
}

/** 从请求的 Host 里取端口。Next 在反代后面可能改写，所以只认 Host 里的数字。 */
export function requestPort(request: Request, fallback: number): number {
  const host = request.headers.get("host") ?? "";
  const match = /:(\d{1,5})$/.exec(host);
  if (!match) return fallback;
  const port = Number(match[1]);
  return port >= 1 && port <= 65535 ? port : fallback;
}

/**
 * 兑码失败次数的节流阀。
 *
 * `POST /api/lan/pair/redeem` 是**唯一**免令牌可达的写入路径，码只有 6 位数字 ——
 * 不节流的话，同网段 anyone 可以用 ~28 req/s 把 10^6 的空间在 TTL 内打完，撞上一个
 * 在飞行的码就换到了 cookie。（MusePi 那边更松：8301 端口完全无鉴权。）这是信任边界，
 * 不能省。
 *
 * 30 次 / 5 分钟：真人手误输错两三次绰绰有余，爆破在这个速率下 10 分钟打不完 10^6。
 * 取不到客户端 IP 时（没有 `x-forwarded-for`）共用一个桶 —— 宁可偶尔误伤，也不给
 * 「换源即绕过」留口子。
 */
const MAX_FAILED_ATTEMPTS = 30;
const FAILED_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

export class PairAttemptLimiter {
  #buckets = new Map<string, { failures: number; resetAt: number }>();

  /** @returns 还能再试几次（<=0 就该拒了）。 */
  record(key: string, now: number = Date.now()): number {
    const bucket = this.#buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.#buckets.set(key, { failures: 1, resetAt: now + FAILED_ATTEMPT_WINDOW_MS });
      return MAX_FAILED_ATTEMPTS - 1;
    }
    bucket.failures += 1;
    return MAX_FAILED_ATTEMPTS - bucket.failures;
  }

  remaining(key: string, now: number = Date.now()): number {
    const bucket = this.#buckets.get(key);
    if (!bucket || bucket.resetAt <= now) return MAX_FAILED_ATTEMPTS;
    return Math.max(0, MAX_FAILED_ATTEMPTS - bucket.failures);
  }

  reset(key: string): void {
    this.#buckets.delete(key);
  }
}

const ATTEMPT_LIMITER_KEY = Symbol.for("pi-web.lanPairAttempts");

export function pairAttemptLimiter(): PairAttemptLimiter {
  const registry = globalThis as unknown as Record<symbol, PairAttemptLimiter | undefined>;
  const existing = registry[ATTEMPT_LIMITER_KEY];
  if (existing) return existing;
  const created = new PairAttemptLimiter();
  registry[ATTEMPT_LIMITER_KEY] = created;
  return created;
}

/** 客户端标识：有反代就用第一跳 `x-forwarded-for`，否则共用一个桶。 */
export function attemptKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || "unknown";
}
