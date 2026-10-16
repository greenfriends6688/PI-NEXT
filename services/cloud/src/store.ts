import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Accounts, device tokens and registered devices — the only state this service persists.
 *
 * A JSON file, written whole through a temp file and a rename. That is enough for what is
 * actually stored (one row per account, per device, per signed-in install) and it keeps the
 * service to a single dependency; the write happens under a lock, so two requests cannot
 * interleave two copies of the file. Calls in flight — `cid → {phone, desktop}` — are *not*
 * here: they live for as long as the sockets do, and a restart is meant to drop them, because
 * both ends reconnect and ask again.
 *
 * The token is never stored. What is kept is its SHA-256, so a copy of this file cannot be
 * replayed as a credential — and the file is written 0600 for the same reason.
 */

export type Account = {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
  role: "user" | "admin";
  createdAt: number;
  /** Set by an operator to refuse sign-in with 403 `account_disabled`. */
  disabled?: boolean;
};

export type Device = {
  id: string;
  accountId: string;
  /** The install this device is, from `rtc-device.json`. Stable across rename and re-login. */
  installId: string;
  name: string;
  platform: string;
  createdAt: number;
};

type StoredToken = {
  hash: string;
  accountId: string;
  createdAt: number;
  lastUsedAt: number;
};

type FileShape = {
  version: 1;
  /** Signs the browser's sign-in cookie, so it survives a restart without a session table. */
  secret: string;
  accounts: Account[];
  tokens: StoredToken[];
  devices: Device[];
};

export type TokenIssue = { token: string; accountId: string };

/** One in-memory copy, written through on every change. */
export class CloudStore {
  #file: string;
  #data: FileShape;
  #writing = false;

  constructor(file: string) {
    this.#file = file;
    this.#data = read(file);
  }

  /** The signing key behind the browser cookie. Created on first run, never rotated silently. */
  secret(): string {
    return this.#data.secret;
  }

  account(id: string): Account | null {
    return this.#data.accounts.find((item) => item.id === id) ?? null;
  }

  accountByLogin(login: string): Account | null {
    const wanted = login.toLowerCase();
    return this.#data.accounts.find((item) => item.login.toLowerCase() === wanted) ?? null;
  }

  /**
   * Create the account for a sign-in, or update the profile of the one that exists.
   *
   * Keyed on the IdP login, so the same GitHub user signing in from a second computer is the
   * same account — which is the entire point: two devices of one account are the two ends the
   * signaling exists to introduce.
   */
  upsertAccount(profile: { login: string; name?: string | null; avatarUrl?: string | null; email?: string | null }): Account {
    const existing = this.accountByLogin(profile.login);
    if (existing) {
      existing.name = profile.name ?? existing.name;
      existing.avatarUrl = profile.avatarUrl ?? existing.avatarUrl;
      existing.email = profile.email ?? existing.email;
      this.#write();
      return existing;
    }
    const account: Account = {
      id: `u_${randomBytes(8).toString("hex")}`,
      login: profile.login,
      name: profile.name ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      email: profile.email ?? null,
      role: "user",
      createdAt: Date.now(),
    };
    this.#data.accounts.push(account);
    this.#write();
    return account;
  }

  /**
   * Refuse or restore an account.
   *
   * The flag exists so an operator can cut somebody off without deleting their data, and an
   * operator reachable only through a hand-edited JSON file is not a switch — this is the one
   * way it is set. Every entry point reads it: signing in, exchanging a code, `/api/me`, the
   * device endpoints and the signaling handshake.
   */
  setDisabled(login: string, disabled: boolean): Account | null {
    const account = this.accountByLogin(login);
    if (!account) return null;
    if (disabled) account.disabled = true;
    else delete account.disabled;
    this.#write();
    return account;
  }

  /** Mint a device token. The plaintext is returned once and never recoverable from here. */
  issueToken(accountId: string): TokenIssue {
    const token = `fvs_${randomBytes(32).toString("base64url")}`;
    const now = Date.now();
    this.#data.tokens.push({ hash: hashToken(token), accountId, createdAt: now, lastUsedAt: now });
    // A token that no longer identifies anybody is kept nowhere: an expired row is only a
    // credential somebody could still try.
    this.#pruneTokens();
    this.#write();
    return { token, accountId };
  }

  /**
   * The account a token belongs to, sliding its window forward — or null.
   *
   * `null` is answered for an unknown token and for one older than the TTL alike, and the
   * caller turns it into 401: the contract is explicit that anything else makes a client keep
   * a credential the server will never accept again.
   */
  verifyToken(token: string, ttlMs: number): { account: Account; token: StoredToken } | null {
    const hash = hashToken(token);
    const found = this.#data.tokens.find((item) => equals(item.hash, hash));
    if (!found) return null;
    const now = Date.now();
    if (now - found.lastUsedAt > ttlMs) {
      this.#data.tokens = this.#data.tokens.filter((item) => item !== found);
      this.#write();
      return null;
    }
    const account = this.account(found.accountId);
    if (!account) return null;
    found.lastUsedAt = now;
    this.#write();
    return { account, token: found };
  }

  revokeToken(token: string): void {
    const hash = hashToken(token);
    const before = this.#data.tokens.length;
    this.#data.tokens = this.#data.tokens.filter((item) => !equals(item.hash, hash));
    if (this.#data.tokens.length !== before) this.#write();
  }

  devicesOf(accountId: string): Device[] {
    return this.#data.devices.filter((item) => item.accountId === accountId);
  }

  device(id: string): Device | null {
    return this.#data.devices.find((item) => item.id === id) ?? null;
  }

  /** How many devices this account has. Counted before an upsert so a rename cannot hit the cap. */
  deviceCount(accountId: string): number {
    return this.devicesOf(accountId).length;
  }

  /**
   * Register this install, or rename the device it already is.
   *
   * Idempotent on `(account, install_id)`: the id is minted once and kept, because it is what a
   * phone saved and what a running desktop is addressed by. Re-registering after a rename —
   * or after signing in again — must not orphan either.
   */
  upsertDevice(input: { accountId: string; installId: string; name: string; platform: string }): Device {
    const existing = this.#data.devices.find((item) => item.accountId === input.accountId && item.installId === input.installId);
    if (existing) {
      existing.name = input.name;
      existing.platform = input.platform;
      this.#write();
      return existing;
    }
    const device: Device = {
      id: `dev_${randomBytes(8).toString("hex")}`,
      accountId: input.accountId,
      installId: input.installId,
      name: input.name,
      platform: input.platform,
      createdAt: Date.now(),
    };
    this.#data.devices.push(device);
    this.#write();
    return device;
  }

  removeDevice(id: string): Device | null {
    const found = this.device(id);
    if (!found) return null;
    this.#data.devices = this.#data.devices.filter((item) => item.id !== id);
    this.#write();
    return found;
  }

  #pruneTokens(): void {
    // An hour is short enough that the file cannot grow without bound and long enough that a
    // client mid-retry keeps the token it has.
    const cutoff = Date.now() - 60 * 60 * 1000;
    this.#data.tokens = this.#data.tokens.filter((item) => item.lastUsedAt >= cutoff);
  }

  /**
   * Write the whole file through a temp file and a rename.
   *
   * Synchronous, and deliberately: every caller is a request that has already decided the new
   * state is true, and answering "done" before it is on disk is how a restart loses a device
   * registration the phone was told about.
   */
  #write(): void {
    if (this.#writing) return;
    this.#writing = true;
    try {
      const dir = dirname(this.#file);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const temp = `${this.#file}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(this.#data, null, 2)}\n`, { mode: 0o600 });
      renameSync(temp, this.#file);
      chmodSync(this.#file, 0o600);
    } finally {
      this.#writing = false;
    }
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time compare, so a token cannot be guessed a byte at a time. */
export function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The browser cookie's contents: which account, signed so it cannot be typed by hand. */
export function signSession(secret: string, accountId: string, issuedAt: number): string {
  const payload = `${accountId}.${issuedAt}`;
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function readSession(secret: string, cookie: string | undefined, ttlMs: number): string | null {
  if (!cookie) return null;
  const parts = cookie.split(".");
  if (parts.length !== 3) return null;
  const [accountId, issuedAt, signature] = parts as [string, string, string];
  if (!equals(signature, createHmac("sha256", secret).update(`${accountId}.${issuedAt}`).digest("base64url"))) return null;
  const at = Number(issuedAt);
  if (!Number.isFinite(at) || Date.now() - at > ttlMs) return null;
  return accountId;
}

function read(file: string): FileShape {
  const empty = (): FileShape => ({ version: 1, secret: randomBytes(32).toString("hex"), accounts: [], tokens: [], devices: [] });
  if (!existsSync(file)) return empty();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<FileShape>;
    return {
      version: 1,
      // A file without a secret would otherwise sign cookies with a fresh key on every start,
      // invalidating every browser session for no reason.
      secret: typeof parsed.secret === "string" && parsed.secret ? parsed.secret : randomBytes(32).toString("hex"),
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
    };
  } catch {
    // A corrupt file is not worth guessing at: refusing to serve is safer than starting with
    // no accounts and letting the first sign-in silently replace them.
    throw new Error(`${file} 无法解析，拒绝启动（先备份或删除它）`);
  }
}
