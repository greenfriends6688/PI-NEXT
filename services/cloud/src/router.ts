import type { CloudConfig } from "./config.ts";
import type { CloudStore } from "./store.ts";
import type { Login } from "./login.ts";
import type { Devices } from "./devices.ts";
import type { Ice } from "./ice.ts";
import type { ConsolePage } from "./console-page.ts";
import { bearer, errorResponse, htmlResponse, jsonResponse, page } from "./http.ts";

/**
 * The contract's routes, in one place and independent of any server.
 *
 * The paths are hardcoded on the clients (`/api/rtc/signal`, `/api/rtc/ice`, `/api/devices/me`)
 * and so are not configurable here either — which is exactly why the dispatch lives next to the
 * handlers instead of in whichever host happens to be listening. A Node server and a Worker hand
 * in the same dependencies and get the same service.
 *
 * The token check sits below the sign-in and console routes and above every device route, so a
 * route added later cannot forget it and quietly become public.
 */
export type CloudRouterDeps = {
  config: CloudConfig;
  store: CloudStore;
  login: Login;
  devices: Devices;
  ice: Ice;
  consolePage: ConsolePage;
};

export function createRouter(deps: CloudRouterDeps): (request: Request) => Promise<Response> {
  const { config, store } = deps;

  return async (request) => {
    const url = new URL(request.url);

    if (url.pathname === "/api/hello") {
      // What a client asks to find out whether this address is a cloud service at all.
      return jsonResponse(200, { ok: true, service: "pinext-cloud", version: 1 });
    }
    if (url.pathname === "/") {
      // Somebody typed the address into a browser. Say what this is rather than answering a
      // blank 404 — a phone's "add a computer" flow lands here when a scan goes wrong.
      return htmlResponse(200, landing(config.publicOrigin));
    }

    const login = await deps.login.handle(request);
    if (login) return login;
    const consolePage = await deps.consolePage.handle(request, config.publicOrigin);
    if (consolePage) return consolePage;

    const token = bearer(request);
    const verified = token ? await store.verifyToken(token, config.tokenTtlMs) : null;
    if (!verified) {
      return errorResponse(401, "unauthorized");
    }
    // A disabled account is answered with its own code rather than a 401: a 401 tells a client
    // to sign out and say nothing, and "this account was turned off" is the one thing worth
    // saying.
    if (verified.account.disabled) {
      return errorResponse(403, "account_disabled");
    }

    const devices = await deps.devices.handle(request);
    if (devices) return devices;
    const ice = await deps.ice.handle(request, verified.account.id);
    if (ice) return ice;

    return errorResponse(404, "not_found");
  };
}

/** A landing page for somebody who typed the address into a browser. Never a blank 404. */
export function landing(origin: string): string {
  return page(
    "PI NEXT",
    `<h1>PI NEXT 云服务</h1>
     <p>这是 PI NEXT 的账号与远程连接服务。请在 PI NEXT 客户端里登录。</p>
     <p class="muted">登录后可以在这里管理账号下的电脑：<a href="/console">管理设备</a></p>`,
    { origin },
  );
}
