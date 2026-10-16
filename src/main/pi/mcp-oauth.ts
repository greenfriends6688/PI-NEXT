import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { OAuthCallbackServer, McpOAuthProvider, authorizeMcp, adaptOAuthProvider, type McpOAuthState, type McpOAuthStateStore } from "@earendil-works/pi-mcp/oauth";
import type { AuthProvider } from "@earendil-works/pi-mcp";
import type { McpSignInResult } from "@shared/types";

/**
 * Signing in to an MCP server that asks for OAuth.
 *
 * A remote server can answer `401 WWW-Authenticate: Bearer resource_metadata=…`, and until now
 * the only way through was for the user to paste a token into the server's `headers` and keep
 * it fresh by hand. This runs the flow pi-mcp implements: discovery, dynamic client
 * registration, a loopback redirect, PKCE, and refresh on every later 401.
 *
 * Two things this module owns that the library leaves to the caller:
 *
 * - **Where the tokens live.** `runtime/engine/agent/mcp-oauth.json`, 0600, written through a
 *   temp file and renamed. It is the one credential this app keeps for an MCP server, and it
 *   is deliberately not `mcp.json`: that file is served to every client and re-broadcast on
 *   every save.
 * - **Opening the browser.** The library hands over an authorization URL; opening it is the
 *   host's job (`shell.openExternal` on the desktop), which keeps this file free of Electron
 *   and lets the headless Agent refuse the same call with a sentence instead of a crash.
 *
 * A sign-in is per server *URL*, not per server name: renaming a server does not lose its
 * grant, and two names pointing at the same URL share one — which is also why the store keys
 * on the URL and refuses to answer with state saved for another one.
 */

type Store = Record<string, McpOAuthState>;

/** Tokens saved for one server URL, or nothing. Never returns a state saved for another URL. */
function readState(file: string, serverUrl: string): McpOAuthState | undefined {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Store;
    const state = parsed?.[serverUrl];
    return state && state.serverUrl === serverUrl ? state : undefined;
  } catch {
    return undefined;
  }
}

function writeState(file: string, state: McpOAuthState): void {
  let store: Store = {};
  try {
    store = JSON.parse(readFileSync(file, "utf8")) as Store;
    if (!store || typeof store !== "object") store = {};
  } catch {
    store = {};
  }
  store[state.serverUrl] = state;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    // A file system that cannot chmod (a network share) still gets the mode above.
  }
}

function clearState(file: string, serverUrl: string): void {
  let store: Store;
  try {
    store = JSON.parse(readFileSync(file, "utf8")) as Store;
  } catch {
    return;
  }
  if (!store || typeof store !== "object" || !(serverUrl in store)) return;
  delete store[serverUrl];
  if (Object.keys(store).length === 0) {
    rmSync(file, { force: true });
    return;
  }
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

/** The store the library's provider writes through, backed by that file. */
function stateStore(file: string, serverUrl: string): McpOAuthStateStore {
  return {
    load: () => readState(file, serverUrl),
    save: (state) => writeState(file, { ...state, serverUrl }),
  };
}

/** Whether this install holds a grant for that server. The pane shows 已登录 from this. */
export function hasMcpGrant(file: string, serverUrl: string): boolean {
  const state = readState(file, serverUrl);
  return Boolean(state?.tokens?.access_token);
}

/** Every server URL with a grant, for the pane's list. */
export function mcpGrantUrls(file: string): string[] {
  try {
    const store = JSON.parse(readFileSync(file, "utf8")) as Store;
    return Object.entries(store)
      .filter(([, state]) => Boolean(state?.tokens?.access_token))
      .map(([url]) => url);
  } catch {
    return [];
  }
}

export type McpSignInOptions = {
  serverUrl: string;
  file: string;
  /** Open this URL in the host's browser. */
  openExternal: (url: string) => Promise<void>;
  signal?: AbortSignal;
  /** How long to wait for the browser to come back. */
  timeoutMs?: number;
};

export type { McpSignInResult };

/**
 * Run the flow for one server, start to finish.
 *
 * The loopback listener is opened *before* the browser is asked to visit anything, so the
 * redirect has somewhere to land the moment the user clicks 允许 — the same ordering the
 * account login uses, and for the same reason: a slow listener is a user staring at a blank
 * tab. The server closes on every path out, including the failures.
 */
export async function signInToMcpServer(options: McpSignInOptions): Promise<McpSignInResult> {
  const { serverUrl, file } = options;
  let callback: OAuthCallbackServer | null = null;
  try {
    callback = await OAuthCallbackServer.listen({ timeoutMs: options.timeoutMs ?? 5 * 60_000 });
    const provider = new McpOAuthProvider({
      serverUrl,
      redirectUrl: callback.redirectUrl,
      clientMetadata: {
        client_name: "Pinext",
        redirect_uris: [String(callback.redirectUrl)],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      },
      store: stateStore(file, serverUrl),
      onRedirect: async (url: URL) => {
        await options.openExternal(url.toString());
      },
    });
    const state = await provider.state();
    const outcome = await authorizeMcp(provider, { serverUrl, ...(options.signal ? { signal: options.signal } : {}) });
    if (outcome === "AUTHORIZED") return { ok: true, url: serverUrl };
    const answer = await callback.waitForCallback(state);
    const finished = await authorizeMcp(provider, {
      serverUrl,
      authorizationCode: answer.code,
      ...(answer.iss ? { iss: answer.iss } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    return finished === "AUTHORIZED"
      ? { ok: true, url: serverUrl }
      : { ok: false, reason: "授权没有完成" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    await callback?.close().catch(() => undefined);
  }
}

/** Drop the grant for one server. The pane's 登出. */
export function signOutOfMcpServer(file: string, serverUrl: string): void {
  clearState(file, serverUrl);
}

/**
 * The auth provider to hand a transport for that server, or nothing when there is no grant.
 *
 * Handing over a provider with no grant is not an error: a server that answers 401 is then
 * what tells the user to sign in, which is exactly the pane's 「需要登录」.
 */
export function mcpAuthProvider(file: string, serverUrl: string): AuthProvider | undefined {
  const state = readState(file, serverUrl);
  if (!state?.tokens?.access_token && !state?.clientInformation) return undefined;
  const provider = new McpOAuthProvider({
    serverUrl,
    // The redirect URL is only needed while authorizing; a stored grant only refreshes.
    redirectUrl: "http://127.0.0.1/mcp-oauth-callback",
    clientMetadata: { client_name: "Pinext" },
    store: stateStore(file, serverUrl),
    onRedirect: () => {
      throw new Error("这个 MCP 服务需要重新登录（设置 → MCP 工具 → 登录）");
    },
  });
  return adaptOAuthProvider(provider);
}

/** Whether a file exists at all, for a caller that wants to avoid a read per status paint. */
export function hasMcpGrantFile(file: string): boolean {
  return existsSync(file);
}
