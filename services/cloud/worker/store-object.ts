import { loadConfig, type CloudConfig } from "../src/config.ts";
import { CloudStore, readSession, type CloudData, type CloudStorage } from "../src/store.ts";
import { cookiesOf } from "../src/http.ts";
import { Login, SESSION_COOKIE } from "../src/login.ts";
import { Devices } from "../src/devices.ts";
import { Ice } from "../src/ice.ts";
import { ConsolePage } from "../src/console-page.ts";
import { createRouter } from "../src/router.ts";
import type { CloudEnv } from "./env.ts";

type Service = {
  router: (request: Request) => Promise<Response>;
  store: CloudStore;
  config: CloudConfig;
};

/**
 * The whole service's state, and the router that reads it.
 *
 * There is one of these (`idFromName("store")`) and the Worker hands it every request that is
 * not a signaling upgrade. Two reasons it is also where the router runs, rather than the Worker
 * reading through it:
 *
 * - **A read-modify-write has to be one step.** Issuing a token is read the document, mutate,
 *   write it back. With the Worker doing the reading and the writing, two sign-ins arriving
 *   together would each write a document missing the other's account. Inside one object the
 *   requests queue, so the second sees the first one's account.
 * - **`blockConcurrencyWhile` is per object**, so hydration happens once and nothing can
 *   observe a half-loaded document.
 *
 * The price is that one slow request holds up the others *of this object*. Nothing here is slow
 * except the GitHub round trip during sign-in, which is rare and bounded, and a live call never
 * comes through here at all — that is the `SignalObject`s' business. Single-threaded is the
 * property that makes the token and device counts correct, so it is bought deliberately rather
 * than worked around.
 *
 * The document is small by construction: accounts, token hashes and devices, tokens pruned to
 * an hour. It is held in memory for the object's life and written back whole, which is what
 * `CloudStorage` describes and what the Node host's file also is.
 */
export class StoreObject {
  #ctx: DurableObjectState;
  #env: CloudEnv;
  #booted: Promise<Service> | null = null;

  constructor(ctx: DurableObjectState, env: CloudEnv) {
    this.#ctx = ctx;
    this.#env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const service = await this.#start();

    // The questions the signaling object has to ask, and the only entry point that is not a
    // route. Reachable from nowhere but this Worker and the objects bound to it: a Durable
    // Object has no public address of its own.
    if (new URL(request.url).pathname === "/__store") {
      const body = (await request.json()) as { op?: string; token?: string; ttlMs?: number; accountId?: string };
      if (body.op === "verify") {
        // Defaulted to this object's own TTL rather than to zero. Zero reads as "the token must
        // be newer than 0ms old" — that is, every token is expired — and it is the value a
        // caller that does not know the TTL would reach for. Sign-in policy is the store's;
        // the caller only gets to shorten it.
        const ttlMs = body.ttlMs && body.ttlMs > 0 ? body.ttlMs : service.config.tokenTtlMs;
        const verified = body.token ? await service.store.verifyToken(body.token, ttlMs) : null;
        return Response.json({ account: verified?.account ?? null });
      }
      if (body.op === "devices") {
        // The relay decides whether a `hello` names a device of this account, and it does that
        // **synchronously** — see `SignalObject`, which is why it takes the whole list once
        // rather than asking per frame.
        const devices = body.accountId
          ? service.store.devicesOf(body.accountId).map((device) => ({ id: device.id, accountId: device.accountId }))
          : [];
        return Response.json({ devices });
      }
      return Response.json({ account: null, devices: [] }, { status: 400 });
    }

    const response = await service.router(request);
    // Every mutation queued its write and returned. This is the answer not outliving the object.
    await service.store.flush();
    return response;
  }

  #start(): Promise<Service> {
    if (this.#booted) return this.#booted;
    this.#booted = this.#ctx.blockConcurrencyWhile(async () => {
      const ctx = this.#ctx;
      const storage: CloudStorage = {
        load: async () => (await ctx.storage.get<CloudData>("data")) ?? null,
        save: async (data) => {
          await ctx.storage.put("data", data);
        },
      };
      const store = await CloudStore.open(storage);
      const config = loadConfig(stringVars(this.#env), { dataFile: "" });
      const log = (message: string): void => console.log(`[cloud] ${message}`);
      const devices = new Devices({
        config,
        store,
        // A device is online when a signaling object holds its socket. That object is the
        // authority and this one cannot see it, so it is asked — one hop, and only for the
        // devices list, which is a pane somebody has open rather than a hot path.
        isOnline: (deviceId) => this.#deviceOnline(deviceId),
        onDeviceRemoved: (deviceId) => this.#dropDevice(deviceId),
      });
      const session = async (request: Request) => {
        // The same reading the Node host does, from the same helpers: the cookie is signed with
        // the document's own secret, so the console cannot be reached by typing one.
        const accountId = await readSession(store.secret(), cookiesOf(request)[SESSION_COOKIE], config.sessionTtlMs);
        const account = accountId ? store.account(accountId) : null;
        return account && !account.disabled ? account : null;
      };
      return {
        config,
        store,
        router: createRouter({
          config,
          store,
          login: new Login({ config, store, log }),
          devices,
          ice: new Ice(config),
          consolePage: new ConsolePage({ store, devices, session }),
        }),
      };
    });
    return this.#booted;
  }

  /** Whether the account's signaling object holds this device's socket. */
  async #deviceOnline(deviceId: string): Promise<boolean> {
    const accountId = await this.#deviceAccount(deviceId);
    if (!accountId) return false;
    const reply = await this.#signal(accountId).fetch(`https://signal/__online?device=${encodeURIComponent(deviceId)}`);
    return ((await reply.json()) as { online?: boolean }).online === true;
  }

  /** Tell that object the device is gone, so it closes the socket with the code the client reads. */
  async #dropDevice(deviceId: string): Promise<void> {
    const accountId = await this.#deviceAccount(deviceId);
    if (!accountId) return;
    await this.#signal(accountId).fetch(`https://signal/__remove?device=${encodeURIComponent(deviceId)}`);
  }

  async #deviceAccount(deviceId: string): Promise<string | null> {
    const service = await this.#start();
    return service.store.device(deviceId)?.accountId ?? null;
  }

  #signal(accountId: string): DurableObjectStub {
    return this.#env.SIGNAL.get(this.#env.SIGNAL.idFromName(accountId));
  }
}

/**
 * The configured variables, without the bindings.
 *
 * `loadConfig` reads a plain string map — the same map the Node host builds from `process.env` —
 * and a Durable Object namespace is not a string. Handing it one anyway would put an object
 * where a variable is expected, which `loadConfig` would read as an absent value.
 */
function stringVars(env: CloudEnv): Record<string, string | undefined> {
  const vars: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") vars[key] = value;
  }
  return vars;
}
