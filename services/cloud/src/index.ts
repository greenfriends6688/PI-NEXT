import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readSession } from "./store.ts";
import { loadConfig, type CloudConfig } from "./config.ts";
import { CloudStore, type Account } from "./store.ts";
import { Login, bearer } from "./login.ts";
import { Devices } from "./devices.ts";
import { Ice } from "./ice.ts";
import { Signaling } from "./signaling.ts";
import { ConsolePage } from "./console-page.ts";
import { page, sendError, sendHtml, cookiesOf } from "./http.ts";

/**
 * PI NEXT's cloud, in one process: the account service, the device registry, the ICE handout and
 * the WebRTC signaling relay.
 *
 * What it is for, in one sentence: **two devices of one account have to find each other.** The
 * desktop and the phone each sit behind a NAT, so neither can be dialled; this service is the
 * place they both already have a connection to, which makes it the only place an introduction can
 * happen. Everything a phone then sends — the offer, the candidates — is forwarded without being
 * read, and the actual conversation never passes through here again.
 *
 * The contract it implements is `docs/pinext-cloud-contract-2026-10-13.md` in the PI NEXT
 * repository, and the clients are written against it: the paths (`/api/rtc/signal`,
 * `/api/rtc/ice`, `/api/devices/me`) are hardcoded there, so they are not configurable here
 * either. Only the origin is.
 *
 * Persisted state is three things — accounts, token hashes, devices. Calls are memory only.
 */
export function createCloud(config: CloudConfig, options: { fetch?: typeof fetch } = {}) {
  const store = new CloudStore(config.dataFile);
  const log = (message: string): void => console.log(`[cloud] ${message}`);

  const signaling = new Signaling({ config, store, log });
  const devices = new Devices({
    config,
    store,
    isOnline: (deviceId) => signaling.isOnline(deviceId),
    onDeviceRemoved: (deviceId) => signaling.removeDevice(deviceId),
  });
  const ice = new Ice(config);
  const login = new Login({ config, store, log, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const session = (request: IncomingMessage): Account | null => {
    const accountId = readSession(store.secret(), cookiesOf(request)["pinext_cloud_session"], config.sessionTtlMs);
    const account = accountId ? store.account(accountId) : null;
    return account && !account.disabled ? account : null;
  };
  const consolePage = new ConsolePage({ store, devices, session });

  const server = createServer((request, response) => {
    void route(request, response).catch((error: unknown) => {
      log(`unhandled: ${String(error)}`);
      // A request that ends without a response leaves a socket open until the client gives up,
      // which on a sign-in page reads as "the service is broken".
      if (!response.headersSent) sendError(response, 500, "internal_error");
      else response.end();
    });
  });

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", config.publicOrigin);

    if (url.pathname === "/api/hello") {
      // What a client asks to find out whether this address is a cloud service at all.
      sendJsonHello(response);
      return;
    }
    if (url.pathname === "/") {
      // Somebody typed the address into a browser. Say what this is rather than answering a
      // blank 404 — a phone's "add a computer" flow lands here when a scan goes wrong.
      sendHtml(response, 200, landing(config.publicOrigin));
      return;
    }
    if (await login.handle(request, response, url)) return;
    if (await consolePage.handle(request, response, url, config.publicOrigin)) return;

    // Everything below needs a device token. Folding the token check here means a route added
    // later cannot forget it and quietly become public — the same reason the located-before
    // policy table exists on the desktop side.
    const token = bearer(request);
    const verified = token ? store.verifyToken(token, config.tokenTtlMs) : null;
    if (!verified) {
      sendError(response, 401, "unauthorized");
      return;
    }
    // A disabled account is answered with its own code rather than a 401: a 401 tells a client
    // to sign out and say nothing, and "this account was turned off" is the one thing worth
    // saying.
    if (verified.account.disabled) {
      sendError(response, 403, "account_disabled");
      return;
    }
    if (await devices.handle(request, response, url)) return;
    if (ice.handle(request, response, url, verified.account.id)) return;

    sendError(response, 404, "not_found");
  }

  return {
    store,
    signaling,
    devices,
    login,
    server,
    config,
    /** Listen, and start the signaling heartbeat with it. */
    async listen(): Promise<{ port: number; host: string }> {
      signaling.attach(server);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : config.port;
      return { port, host: config.host };
    },
    async close(): Promise<void> {
      signaling.stop();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function sendJsonHello(response: ServerResponse): void {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify({ ok: true, service: "pinext-cloud", version: 1 }));
}

/** A landing page for somebody who typed the address into a browser. Never a blank 404. */
function landing(origin: string): string {
  return page(
    "PI NEXT",
    `<h1>PI NEXT 云服务</h1>
     <p>这是 PI NEXT 的账号与远程连接服务。请在 PI NEXT 客户端里登录。</p>
     <p class="muted">登录后可以在这里管理账号下的电脑：<a href="/console">管理设备</a></p>`,
    { origin },
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const cloud = createCloud(config);
  const address = await cloud.listen();
  console.log(`[cloud] listening on ${address.host}:${address.port}`);
  console.log(`[cloud] public origin ${config.publicOrigin}`);
  console.log(`[cloud] data ${config.dataFile}`);
  console.log(`[cloud] sign-in ${config.github ? "github" : config.devLogin ? "dev (no github)" : "DISABLED — set GITHUB_CLIENT_ID/SECRET or DEV_LOGIN=1"}`);
  console.log(`[cloud] turn ${config.turn ? `${config.turn.urls.length} url(s)` : "none (stun only)"}`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void cloud.close().finally(() => process.exit(0));
    });
  }
}

export { landing };
