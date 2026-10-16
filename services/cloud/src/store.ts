/**
 * Accounts, device tokens and registered devices — the only state this service persists.
 *
 * The document is cached in memory in full and written back whole on every change. That is
 * enough for what is actually stored (one row per account, per device, per signed-in install)
 * and it keeps the service to a single dependency. Where the bytes go is the host's business:
 * a Node process hands in a small JSON file, a Worker can hand in Durable Object storage, and
 * this module only ever calls `load` / `save`. Calls in flight — `cid → {phone, desktop}` — are
 * *not* here: they live in the relay for as long as the sockets do, and a restart is meant to
 * drop them, because both ends reconnect and ask again.
 *
 * The token is never stored. What is kept is its SHA-256, so a copy of the document cannot be
 * replayed as a credential. Hashing and signing go through Web Crypto (`crypto.subtle`), which
 * is the one implementation both hosts have.
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

/** The whole persisted document, as one value. */
export type CloudData = {
  version: 1;
  /** Signs the browser's sign-in cookie, so it survives a restart without a session table. */
  secret: string;
  accounts: Account[];
  tokens: StoredToken[];
  devices: Device[];
};

/**
 * Where a host keeps the document.
 *
 * The store caches the document and only ever calls these two methods, so a host that cannot
 * offer a file path (a Worker with Durable Object storage) implements the same pair.
 */
export interface CloudStorage {
  /** The stored document, or null when there is none yet. A corrupt document should throw. */
  load(): Promise<CloudData | null>;
  /** Persist the whole document. */
  save(data: CloudData): Promise<void>;
}

export type TokenIssue = { token: string; accountId: string };

/** One in-memory copy, written through on every change. */
export class CloudStore {
  #storage: CloudStorage;
  #data: CloudData;
  /** Saves are serialised, so two changes cannot land in the host out of order. */
  #queue: Promise<void> = Promise.resolve();

  private constructor(storage: CloudStorage, data: CloudData) {
    this.#storage = storage;
    this.#data = data;
  }

  /** Hydrate once from the host, then serve from memory. */
  static async open(storage: CloudStorage): Promise<CloudStore> {
    const loaded = await storage.load();
    return new CloudStore(storage, hydrate(loaded));
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
  async upsertAccount(profile: { login: string; name?: string | null; avatarUrl?: string | null; email?: string | null }): Promise<Account> {
    const existing = this.accountByLogin(profile.login);
    if (existing) {
      existing.name = profile.name ?? existing.name;
      existing.avatarUrl = profile.avatarUrl ?? existing.avatarUrl;
      existing.email = profile.email ?? existing.email;
      await this.#persist();
      return existing;
    }
    const account: Account = {
      id: `u_${randomHex(8)}`,
      login: profile.login,
      name: profile.name ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      email: profile.email ?? null,
      role: "user",
      createdAt: Date.now(),
    };
    this.#data.accounts.push(account);
    await this.#persist();
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
  async setDisabled(login: string, disabled: boolean): Promise<Account | null> {
    const account = this.accountByLogin(login);
    if (!account) return null;
    if (disabled) account.disabled = true;
    else delete account.disabled;
    await this.#persist();
    return account;
  }

  /** Mint a device token. The plaintext is returned once and never recoverable from here. */
  async issueToken(accountId: string): Promise<TokenIssue> {
    const token = `fvs_${randomBase64Url(32)}`;
    const now = Date.now();
    this.#data.tokens.push({ hash: await hashToken(token), accountId, createdAt: now, lastUsedAt: now });
    // A token that no longer identifies anybody is kept nowhere: an expired row is only a
    // credential somebody could still try.
    this.#pruneTokens();
    await this.#persist();
    return { token, accountId };
  }

  /**
   * The account a token belongs to, sliding its window forward — or null.
   *
   * `null` is answered for an unknown token and for one older than the TTL alike, and the
   * caller turns it into 401: the contract is explicit that anything else makes a client keep
   * a credential the server will never accept again.
   */
  async verifyToken(token: string, ttlMs: number): Promise<{ account: Account; token: StoredToken } | null> {
    const hash = await hashToken(token);
    const found = this.#data.tokens.find((item) => equals(item.hash, hash));
    if (!found) return null;
    const now = Date.now();
    if (now - found.lastUsedAt > ttlMs) {
      this.#data.tokens = this.#data.tokens.filter((item) => item !== found);
      await this.#persist();
      return null;
    }
    const account = this.account(found.accountId);
    if (!account) return null;
    found.lastUsedAt = now;
    await this.#persist();
    return { account, token: found };
  }

  async revokeToken(token: string): Promise<void> {
    const hash = await hashToken(token);
    const before = this.#data.tokens.length;
    this.#data.tokens = this.#data.tokens.filter((item) => !equals(item.hash, hash));
    if (this.#data.tokens.length !== before) await this.#persist();
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
  async upsertDevice(input: { accountId: string; installId: string; name: string; platform: string }): Promise<Device> {
    const existing = this.#data.devices.find((item) => item.accountId === input.accountId && item.installId === input.installId);
    if (existing) {
      existing.name = input.name;
      existing.platform = input.platform;
      await this.#persist();
      return existing;
    }
    const device: Device = {
      id: `dev_${randomHex(8)}`,
      accountId: input.accountId,
      installId: input.installId,
      name: input.name,
      platform: input.platform,
      createdAt: Date.now(),
    };
    this.#data.devices.push(device);
    await this.#persist();
    return device;
  }

  async removeDevice(id: string): Promise<Device | null> {
    const found = this.device(id);
    if (!found) return null;
    this.#data.devices = this.#data.devices.filter((item) => item.id !== id);
    await this.#persist();
    return found;
  }

  /**
   * Wait for the writes queued so far to land.
   *
   * Every mutation queues its save and returns; a host whose storage is a file can let that
   * run on its own. A host whose storage is somewhere the process can be evicted from cannot:
   * a Worker's Durable Object is torn down between requests, so answering before the write
   * landed means the answer was a promise the object did not keep.
   */
  async flush(): Promise<void> {
    await this.#queue;
  }

  #pruneTokens(): void {
    // An hour is short enough that the document cannot grow without bound and long enough that a
    // client mid-retry keeps the token it has.
    const cutoff = Date.now() - 60 * 60 * 1000;
    this.#data.tokens = this.#data.tokens.filter((item) => item.lastUsedAt >= cutoff);
  }

  /**
   * Hand the whole document to the host, one save at a time.
   *
   * The document is mutated in memory first and the write reads it at the moment it runs, so a
   * burst of changes coalesces into the last state rather than a queue of stale copies.
   */
  #persist(): Promise<void> {
    const run = this.#queue.then(() => this.#storage.save(this.#data));
    this.#queue = run.catch(() => undefined);
    return run;
  }
}

export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

/** Constant-time compare, so a token cannot be guessed a byte at a time. */
export function equals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The browser cookie's contents: which account, signed so it cannot be typed by hand. */
export async function signSession(secret: string, accountId: string, issuedAt: number): Promise<string> {
  const payload = `${accountId}.${issuedAt}`;
  return `${payload}.${await hmacSha256Base64Url(secret, payload)}`;
}

export async function readSession(secret: string, cookie: string | undefined, ttlMs: number): Promise<string | null> {
  if (!cookie) return null;
  const parts = cookie.split(".");
  if (parts.length !== 3) return null;
  const [accountId, issuedAt, signature] = parts as [string, string, string];
  if (!equals(signature, await hmacSha256Base64Url(secret, `${accountId}.${issuedAt}`))) return null;
  const at = Number(issuedAt);
  if (!Number.isFinite(at) || Date.now() - at > ttlMs) return null;
  return accountId;
}

const encoder = new TextEncoder();

function hydrate(data: CloudData | null): CloudData {
  return {
    version: 1,
    // A document without a secret would otherwise sign cookies with a fresh key on every start,
    // invalidating every browser session for no reason.
    secret: typeof data?.secret === "string" && data.secret ? data.secret : randomHex(32),
    accounts: Array.isArray(data?.accounts) ? data.accounts : [],
    tokens: Array.isArray(data?.tokens) ? data.tokens : [],
    devices: Array.isArray(data?.devices) ? data.devices : [],
  };
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function randomHex(length: number): string {
  return [...randomBytes(length)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomBase64Url(length: number): string {
  return base64Url(randomBytes(length));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256Base64Url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return base64Url(new Uint8Array(signature));
}
