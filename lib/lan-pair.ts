/**
 * 手机配对：6 位码 + 一次性消费。
 *
 * 用途：桌面端给出 6 位码（并画成二维码），手机打开局域网地址后输码/扫码，服务端把
 * 令牌种成 cookie，页面随后就是普通请求。整个流程同源 HTTP 一条 POST，不需要额外的
 * 无鉴权端口（那正是同类实现里最危险的一段）。
 *
 * 码本身**不存令牌**，只存 `full` / `readonly` 这个种类：兑码时按当时的令牌现算。
 * 换令牌等于让所有在飞的码立刻作废 —— 这正是想要的语义。
 */

import { randomInt } from "node:crypto";

const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_LENGTH = 6;

export type LanPairKind = "full" | "readonly";

interface PairEntry {
  kind: LanPairKind;
  expiresAt: number;
}

export class LanPairCodes {
  #entries = new Map<string, PairEntry>();

  /** 同一条码被 mint 两次就重抽，避免一个码对应两个持有者。 */
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
 * 进程级单例，挂在 `globalThis` 上：`next dev` 的热重载会重建模块作用域，
 * 普通模块级 Map 会被清空，用户刚拿到的码就废了。
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
 * 兑码失败次数的节流阀。
 *
 * `POST /api/lan/pair/redeem` 是唯一免令牌可达的写入路径，码只有 6 位数字 —— 不节流的话，
 * 同网段 anyone 可以在 TTL 内把空间打完，撞上一个在飞的码就换到了 cookie。这是信任边界。
 * 30 次 / 5 分钟：手误两三次绰绰有余，爆破在这个速率下打不完。
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

/** 客户端标识：有反代就用第一跳 `x-forwarded-for`，否则共用一个桶 —— 不给「换源即绕过」留口子。 */
export function attemptKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || "unknown";
}
