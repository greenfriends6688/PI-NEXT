import { randomBytes, createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CloudConfig } from "./config.ts";
import type { Account, CloudStore } from "./store.ts";
import { readSession, signSession } from "./store.ts";
import { escapeHtml, page, readForm, readJson, redirect, sendError, sendHtml, sendJson, setCookie, cookiesOf } from "./http.ts";
import { exchangeGithubCode, fetchGithubProfile, githubAuthorizeUrl } from "./github.ts";

/**
 * Sign-in: the browser authorization-code flow for native apps (RFC 8252) with PKCE (RFC 7636).
 *
 * The desktop opens a listener on loopback, sends its browser here, and waits for the browser to
 * come back with a one-time code. The code is useless without the verifier, which never leaves
 * the desktop — so another program that saw the redirect (a browser extension, another tab on
 * the same port) still cannot trade it for a token.
 *
 * Two things about the redirect are easy to get wrong, and both fail as `invalid_grant` rather
 * than as anything readable:
 *
 * - **The code is bound to the `redirect_uri` this service actually redirected to**, and the
 *   token exchange must present exactly that string. The desktop rebuilds it from the `Host`
 *   the request arrived with (`account.ts`), not from the one it asked for, so a layer that
 *   rewrites `127.0.0.1` to `localhost` changes the string that comes back.
 * - **`state` is echoed, never generated here.** It is the desktop's own guard against a
 *   redirect it did not start.
 */

const CLIENT_IDS = new Set(["pinext-desktop", "pinext-mobile"]);
const MOBILE_REDIRECT = "pinext://oauth/callback";
const SESSION_COOKIE = "pinext_cloud_session";

type PendingCode = {
  accountId: string;
  clientId: string;
  /** Exactly the string we put in the `Location` header. */
  redirectUri: string;
  challenge: string;
  expiresAt: number;
};

type PendingGithub = { returnTo: string; expiresAt: number };

export type LoginDeps = {
  config: CloudConfig;
  store: CloudStore;
  /** Overridden in tests, where a real GitHub round trip is not available. */
  fetch?: typeof fetch;
  log?: (message: string) => void;
};

export class Login {
  #deps: LoginDeps;
  #codes = new Map<string, PendingCode>();
  #github = new Map<string, PendingGithub>();

  constructor(deps: LoginDeps) {
    this.#deps = deps;
  }

  /** Answer this request, or return false so another route can. */
  async handle(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
    const { pathname } = url;
    if (pathname === "/authorize") return this.#authorize(request, response, url);
    if (pathname === "/authorize/decision") return this.#decision(request, response);
    if (pathname === "/auth/github/login") return this.#githubStart(response, url);
    if (pathname === "/auth/github/callback") return this.#githubCallback(response, url);
    if (pathname === "/api/oauth/token") return this.#token(request, response);
    if (pathname === "/api/me") return this.#me(request, response);
    if (pathname === "/api/auth/logout") return this.#logout(request, response);
    return false;
  }

  /** The session cookie's account, when the browser is signed in. */
  #session(request: IncomingMessage): Account | null {
    const accountId = readSession(this.#deps.store.secret(), cookiesOf(request)[SESSION_COOKIE], this.#deps.config.sessionTtlMs);
    if (!accountId) return null;
    const account = this.#deps.store.account(accountId);
    return account && !account.disabled ? account : null;
  }

  #authorize(request: IncomingMessage, response: ServerResponse, url: URL): boolean {
    const params = {
      client_id: url.searchParams.get("client_id") ?? "",
      redirect_uri: url.searchParams.get("redirect_uri") ?? "",
      state: url.searchParams.get("state") ?? "",
      code_challenge: url.searchParams.get("code_challenge") ?? "",
      code_challenge_method: url.searchParams.get("code_challenge_method") ?? "",
      device_name: (url.searchParams.get("device_name") ?? "").slice(0, 80),
      platform: url.searchParams.get("platform") ?? "",
    };

    const problem = this.#validate(params);
    if (problem) {
      sendHtml(response, 400, page("无法登录", `<h1>无法登录</h1><p>${escapeHtml(problem)}</p>`, { origin: this.#deps.config.publicOrigin }));
      return true;
    }

    const session = this.#session(request);
    const origin = this.#deps.config.publicOrigin;
    const hidden = Object.entries(params)
      .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
      .join("");

    if (!session) {
      // The signed-in identity is the whole point of this page, so an unauthenticated visitor is
      // sent to GitHub first and comes back here afterwards with every parameter intact.
      const returnTo = `/authorize?${url.searchParams.toString()}`;
      const button = this.#deps.config.github
        ? `<a class="btn primary" href="/auth/github/login?return=${encodeURIComponent(returnTo)}">用 GitHub 登录</a>`
        : "";
      const dev = this.#deps.config.devLogin
        ? `<form method="post" action="/authorize/decision">
             ${hidden}
             <input type="hidden" name="decision" value="allow">
             <input type="hidden" name="dev_login" value="1">
             <p style="margin:1rem 0 .35rem">开发登录：任意名字都会被视为一个账号</p>
             <input name="dev_account" value="dev" style="width:100%;padding:.5rem .7rem;border-radius:.5rem;border:1px solid #d4d4d8;font:inherit;box-sizing:border-box">
             <div class="row"><button class="primary" type="submit">继续</button></div>
           </form>`
        : "";
      sendHtml(
        response,
        200,
        page(
          "登录 PI NEXT",
          `<h1>登录 PI NEXT</h1>
           <p>用你的账号登录，手机与电脑登录同一个账号后才能互相发现。</p>
           ${button}
           ${dev}
           ${!button && !dev ? `<p>这台服务没有配置登录方式。</p>` : ""}`,
          { origin },
        ),
      );
      return true;
    }

    const device = params.device_name || "未命名设备";
    sendHtml(
      response,
      200,
      page(
        "授权登录",
        `<h1>允许这台设备登录？</h1>
         <p>确认后，它会以 <strong>${escapeHtml(session.login)}</strong> 的身份登录。</p>
         <dl>
           <dt>设备</dt><dd>${escapeHtml(device)}</dd>
           ${params.platform ? `<dt>平台</dt><dd>${escapeHtml(params.platform)}</dd>` : ""}
         </dl>
         <form method="post" action="/authorize/decision">
           ${hidden}
           <input type="hidden" name="decision" value="allow">
           <div class="row">
             <button class="ghost" type="submit" name="decision" value="deny">取消</button>
             <button class="primary" type="submit">允许</button>
           </div>
         </form>
         <p class="muted">当前登录：${escapeHtml(session.login)}</p>`,
        { origin },
      ),
    );
    return true;
  }

  async #decision(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const form = await readForm(request).catch(() => ({}) as Record<string, string>);
    const params = {
      client_id: form.client_id ?? "",
      redirect_uri: form.redirect_uri ?? "",
      state: form.state ?? "",
      code_challenge: form.code_challenge ?? "",
      code_challenge_method: form.code_challenge_method ?? "",
      device_name: form.device_name ?? "",
      platform: form.platform ?? "",
    };
    const problem = this.#validate(params);
    if (problem) {
      sendHtml(response, 400, page("无法登录", `<h1>无法登录</h1><p>${escapeHtml(problem)}</p>`, { origin: this.#deps.config.publicOrigin }));
      return true;
    }

    // Denial goes back the same way an approval does, with `error` instead of `code`: the
    // desktop's listener treats it as "the person changed their mind", not as a failure.
    if (form.decision === "deny") {
      const denied = new URL(params.redirect_uri);
      denied.searchParams.set("error", "access_denied");
      denied.searchParams.set("state", params.state);
      redirect(response, denied.toString());
      return true;
    }

    let account = this.#session(request);
    if (!account && form.dev_login === "1" && this.#deps.config.devLogin) {
      const login = (form.dev_account ?? "").trim() || "dev";
      account = this.#deps.store.upsertAccount({ login, name: login });
      this.#setSession(response, account.id);
    }
    if (!account) {
      sendHtml(response, 403, page("需要登录", `<h1>需要登录</h1><p>请先登录再授权。</p>`, { origin: this.#deps.config.publicOrigin }));
      return true;
    }

    const code = randomBytes(32).toString("base64url");
    this.#codes.set(code, {
      accountId: account.id,
      clientId: params.client_id,
      redirectUri: params.redirect_uri,
      challenge: params.code_challenge,
      expiresAt: Date.now() + this.#deps.config.codeTtlMs,
    });
    this.#prune();

    const target = new URL(params.redirect_uri);
    target.searchParams.set("code", code);
    target.searchParams.set("state", params.state);
    redirect(response, target.toString());
    return true;
  }

  #githubStart(response: ServerResponse, url: URL): boolean {
    const github = this.#deps.config.github;
    const origin = this.#deps.config.publicOrigin;
    if (!github) {
      sendHtml(response, 404, page("未配置 GitHub 登录", `<h1>未配置 GitHub 登录</h1><p>设置 GITHUB_CLIENT_ID 与 GITHUB_CLIENT_SECRET 后可用。</p>`, { origin }));
      return true;
    }
    const raw = url.searchParams.get("return") ?? "/authorize";
    // Only a path inside this service: an absolute URL here would make this an open redirect
    // that any site could point at to bounce a visitor somewhere else after a sign-in.
    const returnTo = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/authorize";
    const state = randomBytes(16).toString("base64url");
    this.#github.set(state, { returnTo, expiresAt: Date.now() + 10 * 60 * 1000 });

    redirect(
      response,
      githubAuthorizeUrl({
        clientId: github.clientId,
        redirectUri: `${this.#deps.config.publicOrigin}/auth/github/callback`,
        state,
      }),
    );
    return true;
  }

  async #githubCallback(response: ServerResponse, url: URL): Promise<boolean> {
    const origin = this.#deps.config.publicOrigin;
    const state = url.searchParams.get("state") ?? "";
    const pending = this.#github.get(state);
    this.#github.delete(state);
    const github = this.#deps.config.github;
    if (!pending || !github || pending.expiresAt < Date.now()) {
      sendHtml(response, 400, page("登录已过期", `<h1>登录已过期</h1><p>请回到 PI NEXT 重新发起登录。</p>`, { origin }));
      return true;
    }
    const code = url.searchParams.get("code") ?? "";
    if (!code) {
      sendHtml(response, 400, page("登录已取消", `<h1>登录已取消</h1><p>可以回到 PI NEXT 重试。</p>`, { origin }));
      return true;
    }

    const doFetch = this.#deps.fetch ?? fetch;
    const token = await exchangeGithubCode({
      clientId: github.clientId,
      clientSecret: github.clientSecret,
      code,
      redirectUri: `${this.#deps.config.publicOrigin}/auth/github/callback`,
      fetch: doFetch,
    }).catch(() => null);
    const profile = token ? await fetchGithubProfile(token, doFetch).catch(() => null) : null;
    if (!profile) {
      this.#deps.log?.("github: could not read the profile");
      sendHtml(response, 502, page("登录失败", `<h1>登录失败</h1><p>GitHub 没有返回可用的账号信息。</p>`, { origin }));
      return true;
    }

    const account = this.#deps.store.upsertAccount(profile);
    this.#setSession(response, account.id);
    redirect(response, pending.returnTo);
    return true;
  }

  async #token(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const body = await readJson(request).catch(() => ({}) as Record<string, unknown>);
    const code = typeof body.code === "string" ? body.code : "";
    const verifier = typeof body.code_verifier === "string" ? body.code_verifier : "";
    const clientId = typeof body.client_id === "string" ? body.client_id : "";
    const redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri : "";
    const grant = typeof body.grant_type === "string" ? body.grant_type : "";

    const pending = this.#codes.get(code);
    // One use, whatever happens next: a code that failed its checks is still spent, so a
    // wrong verifier cannot be retried against the same code.
    this.#codes.delete(code);

    if (
      !pending ||
      pending.expiresAt < Date.now() ||
      grant !== "authorization_code" ||
      pending.clientId !== clientId ||
      pending.redirectUri !== redirectUri ||
      !verifier ||
      pkceChallenge(verifier) !== pending.challenge
    ) {
      sendError(response, 400, "invalid_grant");
      return true;
    }

    const account = this.#deps.store.account(pending.accountId);
    if (!account) {
      sendError(response, 400, "invalid_grant");
      return true;
    }
    if (account.disabled) {
      sendError(response, 403, "account_disabled");
      return true;
    }

    const issued = this.#deps.store.issueToken(account.id);
    sendJson(response, 200, {
      access_token: issued.token,
      token_type: "Bearer",
      expires_in: Math.floor(this.#deps.config.tokenTtlMs / 1000),
      user: toWireUser(account),
    });
    return true;
  }

  #me(request: IncomingMessage, response: ServerResponse): boolean {
    const token = bearer(request);
    const verified = token ? this.#deps.store.verifyToken(token, this.#deps.config.tokenTtlMs) : null;
    if (!verified) {
      sendError(response, 401, "unauthorized");
      return true;
    }
    if (verified.account.disabled) {
      sendError(response, 403, "account_disabled");
      return true;
    }
    // Sliding window: reading the account is what keeps it alive, which is why the client
    // calls this on every start rather than on a timer.
    sendJson(response, 200, { user: toWireUser(verified.account) });
    return true;
  }

  #logout(request: IncomingMessage, response: ServerResponse): boolean {
    const token = bearer(request);
    if (token) this.#deps.store.revokeToken(token);
    // Answering 2xx for a token that was already gone is deliberate: the client has cleared its
    // copy either way, and a failure here would only invite it to keep trying.
    sendJson(response, 200, { ok: true });
    return true;
  }

  #setSession(response: ServerResponse, accountId: string): void {
    setCookie(response, SESSION_COOKIE, signSession(this.#deps.store.secret(), accountId, Date.now()), {
      maxAgeSeconds: Math.floor(this.#deps.config.sessionTtlMs / 1000),
      secure: this.#deps.config.publicOrigin.startsWith("https://"),
    });
  }

  #prune(): void {
    const now = Date.now();
    for (const [code, pending] of this.#codes) if (pending.expiresAt < now) this.#codes.delete(code);
    for (const [state, pending] of this.#github) if (pending.expiresAt < now) this.#github.delete(state);
  }

  #validate(params: {
    client_id: string;
    redirect_uri: string;
    state: string;
    code_challenge: string;
    code_challenge_method: string;
  }): string | null {
    if (!CLIENT_IDS.has(params.client_id)) return "未知的客户端。";
    if (!params.state) return "缺少 state。";
    if (params.code_challenge_method !== "S256") return "只支持 PKCE S256。";
    if (params.code_challenge.length < 43 || params.code_challenge.length > 128) return "code_challenge 长度不对。";
    if (!validRedirect(params.client_id, params.redirect_uri)) return "redirect_uri 不被允许。";
    return null;
  }
}

/**
 * Which redirect targets are legitimate for each client.
 *
 * The desktop's is a loopback listener on a port the OS picked, so the port cannot be checked —
 * what can be is that it is loopback, which is what keeps a code from being delivered to a
 * remote host. The phone's is a custom scheme only that app can claim.
 */
export function validRedirect(clientId: string, redirectUri: string): boolean {
  if (clientId === "pinext-mobile") return redirectUri === MOBILE_REDIRECT;
  try {
    const url = new URL(redirectUri);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.pathname === "/callback" &&
      url.port !== ""
    );
  } catch {
    return false;
  }
}

/** `BASE64URL(SHA256(verifier))` — the same value the client sent as its challenge. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function bearer(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  const match = /^Bearer\s+(\S+)$/i.exec(typeof header === "string" ? header : "");
  return match?.[1] ?? null;
}

/**
 * The account as clients are allowed to see it.
 *
 * Field names are exact — the client reads `avatar_url` and `role` — and the avatar is dropped
 * unless it is https, because the client requires that and would otherwise discard it silently.
 */
export function toWireUser(account: Account): {
  id: string;
  login: string;
  avatar_url: string | null;
  email: string | null;
  role: "user" | "admin";
} {
  return {
    id: account.id,
    login: account.login,
    avatar_url: account.avatarUrl && account.avatarUrl.startsWith("https://") ? account.avatarUrl : null,
    email: account.email,
    role: account.role === "admin" ? "admin" : "user",
  };
}
