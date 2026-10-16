/**
 * Everything the service reads from its environment, in one place.
 *
 * Read once at startup and frozen: a service that re-read the environment while it ran would
 * answer two requests differently, and the pieces that matter (the token lifetime, the ICE
 * list) are exactly the ones a phone caches.
 *
 * The file itself touches nothing outside the Web platform: it is handed the environment as a
 * plain string map and the one host path it cannot derive (where the document lives), so the
 * same reading of `PORT` / `PUBLIC_ORIGIN` / … serves a Node process and, later, a Worker.
 */
export type CloudConfig = {
  port: number;
  host: string;
  /**
   * The origin clients reach this service at, e.g. `https://app.aiandchat.cloud`.
   *
   * Used to build the GitHub callback URL and the 控制台 link. It has to be what the browser
   * actually sees, because GitHub compares the callback it is given against the one registered
   * on the OAuth app — a mismatch is a redirect_uri error before any of our code runs.
   */
  publicOrigin: string;
  /**
   * Where accounts, token hashes and devices are kept.
   *
   * A host path, opaque here — the core never opens it, the host turns it into a `CloudStorage`.
   * A worker with no file system simply leaves it unset in practice.
   */
  dataFile: string;
  /** How long a device token stays valid, extended on every use (the contract's 90 days). */
  tokenTtlMs: number;
  /** How long an authorization code lives. Short: it is exchanged immediately. */
  codeTtlMs: number;
  /** How long a browser sign-in cookie lives. */
  sessionTtlMs: number;
  /**
   * A GitHub OAuth app, or null to refuse GitHub sign-in.
   *
   * Null plus `devLogin` is the local-development shape: a real browser flow needs an OAuth
   * app registered against a reachable callback, which a laptop on 127.0.0.1 does not have.
   */
  github: { clientId: string; clientSecret: string } | null;
  /** Offer a sign-in page that trusts the visitor. Local development only. */
  devLogin: boolean;
  /** At most this many devices per account before `PUT /api/devices/me` answers 409. */
  maxDevicesPerAccount: number;
  /** STUN servers handed out to every client. */
  stunUrls: string[];
  /**
   * coturn's `use-auth-secret` mode, when a TURN server was configured.
   *
   * The credential is derived rather than stored: `username` is `<expiry>:<account>`, and the
   * password is `base64(HMAC-SHA1(secret, username))`. coturn computes the same thing from the
   * same secret, so nothing has to be provisioned per user and an expired credential stops
   * working by itself.
   */
  turn: { secret: string; urls: string[]; ttlSeconds: number } | null;
  /**
   * How many relayed calls the account may hold at once.
   *
   * The contract's number, and it is shared between the two ends: TURN bandwidth is what a
   * relayed call costs, and a client that leaked calls would spend the month's allowance while
   * nobody was watching.
   */
  relayLimit: number;
};

/** The environment as a plain string map, so this module needs nothing from Node. */
export type CloudEnv = Record<string, string | undefined>;

function env(source: CloudEnv, name: string): string | undefined {
  const value = source[name]?.trim();
  return value ? value : undefined;
}

function numberEnv(source: CloudEnv, name: string, fallback: number): number {
  const raw = env(source, name);
  const value = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function listEnv(source: CloudEnv, name: string): string[] {
  return (env(source, name) ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Read the config.
 *
 * `options.dataFile` is the host's fallback for `DATA_FILE`; the host is also what resolves the
 * resulting path, because resolution is a file-system idea the core does not have.
 */
export function loadConfig(source: CloudEnv, options: { dataFile: string }): CloudConfig {
  const port = numberEnv(source, "PORT", 9088);
  const host = env(source, "HOST") ?? "127.0.0.1";
  const publicOrigin = (env(source, "PUBLIC_ORIGIN") ?? `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`).replace(/\/+$/, "");

  const clientId = env(source, "GITHUB_CLIENT_ID");
  const clientSecret = env(source, "GITHUB_CLIENT_SECRET");
  const turnSecret = env(source, "TURN_SECRET");
  const turnUrls = listEnv(source, "TURN_URLS");

  return {
    port,
    host,
    publicOrigin,
    dataFile: env(source, "DATA_FILE") ?? options.dataFile,
    tokenTtlMs: numberEnv(source, "TOKEN_TTL_DAYS", 90) * 24 * 60 * 60 * 1000,
    codeTtlMs: numberEnv(source, "CODE_TTL_SECONDS", 300) * 1000,
    sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
    github: clientId && clientSecret ? { clientId, clientSecret } : null,
    devLogin: env(source, "DEV_LOGIN") === "1",
    maxDevicesPerAccount: numberEnv(source, "MAX_DEVICES", 10),
    stunUrls: listEnv(source, "STUN_URLS").length > 0 ? listEnv(source, "STUN_URLS") : ["stun:stun.l.google.com:19302"],
    turn:
      turnSecret && turnUrls.length > 0
        ? { secret: turnSecret, urls: turnUrls, ttlSeconds: numberEnv(source, "TURN_TTL_SECONDS", 300) }
        : null,
    relayLimit: numberEnv(source, "RELAY_LIMIT", 4),
  };
}

/** Whether GitHub sign-in can be offered at all. Separate so the pages can say which mode they are in. */
export function canSignInWithGithub(config: CloudConfig): boolean {
  return config.github !== null;
}
