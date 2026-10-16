import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname } from "node:path";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { CloudConfig } from "../config.ts";
import { CloudStore, readSession, type Account, type CloudData, type CloudStorage } from "../store.ts";
import { Login, SESSION_COOKIE } from "../login.ts";
import { Devices } from "../devices.ts";
import { Ice } from "../ice.ts";
import { ConsolePage } from "../console-page.ts";
import { CloudRelay, type RelayAction } from "../relay.ts";
import { createRouter } from "../router.ts";
import { bearerOf, cookiesOf } from "../http.ts";

/**
 * PI NEXT's cloud, on a Node process: the account service, the device registry, the ICE handout
 * and the WebRTC signaling relay.
 *
 * What it is for, in one sentence: **two devices of one account have to find each other.** The
 * desktop and the phone each sit behind a NAT, so neither can be dialled; this service is the
 * place they both already have a connection to, which makes it the only place an introduction can
 * happen. Everything a phone then sends — the offer, the candidates — is forwarded without being
 * read, and the actual conversation never passes through here again.
 *
 * The contract it implements is `docs/pinext-cloud-contract-2026-10-13.md` in the PI NEXT
 * repository, and the clients are written against it: the paths (`/api/rtc/signal`, `/api/rtc/ice`,
 * `/api/devices/me`) are hardcoded there, so they are not configurable here either. Only the
 * origin is.
 *
 * This file is the host, not the service: it owns `node:http`, `ws` and the JSON file, converts
 * their shapes into `Request`/`Response`, and lets the core — the same core a worker will run —
 * decide everything else.
 */
const PING_INTERVAL_MS = 25_000;
/** A body larger than this is truncated before the core's own 64 KiB ceiling can reject it. */
const MAX_REQUEST_BODY = 1024 * 1024;

/** The document as a JSON file, written whole through a temp file and a rename. */
export class FileStorage implements CloudStorage {
  #file: string;

  constructor(file: string) {
    this.#file = file;
  }

  async load(): Promise<CloudData | null> {
    if (!existsSync(this.#file)) return null;
    try {
      return JSON.parse(readFileSync(this.#file, "utf8")) as CloudData;
    } catch {
      // A corrupt file is not worth guessing at: refusing to serve is safer than starting with
      // no accounts and letting the first sign-in silently replace them.
      throw new Error(`${this.#file} 无法解析，拒绝启动（先备份或删除它）`);
    }
  }

  async save(data: CloudData): Promise<void> {
    const dir = dirname(this.#file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const temp = `${this.#file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.#file);
    chmodSync(this.#file, 0o600);
  }
}

/**
 * The `ws` glue around the pure relay.
 *
 * It mints each peer's id, authenticates the upgrade, writes the relay's `RelayAction`s onto the
 * right socket, and runs the heartbeat. The policy — who may say `hello` as which device, which
 * socket a `signal` reaches — lives entirely in `CloudRelay`.
 */
class NodeSignaling {
  #config: CloudConfig;
  #store: CloudStore;
  #relay: CloudRelay;
  #log: (message: string) => void;
  #wss = new WebSocketServer({ noServer: true });
  #sockets = new Map<string, WebSocket>();
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: { config: CloudConfig; store: CloudStore; relay: CloudRelay; log: (message: string) => void }) {
    this.#config = deps.config;
    this.#store = deps.store;
    this.#relay = deps.relay;
    this.#log = deps.log;
  }

  /** Attach to an HTTP server's `upgrade` event. */
  attach(server: Server): void {
    server.on("upgrade", (request, socket, head) => {
      void this.#upgrade(request, socket, head).catch(() => socket.destroy());
    });
    this.#timer = setInterval(() => this.#beat(), PING_INTERVAL_MS);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    for (const [peerId, socket] of this.#sockets) {
      this.#apply(this.#relay.closed(peerId));
      try {
        socket.close(1000, "server stopping");
      } catch {
        socket.terminate();
      }
    }
    this.#sockets.clear();
  }

  /** Drop a device's socket because it is no longer in the account. */
  removeDevice(deviceId: string): void {
    this.#apply(this.#relay.removeDevice(deviceId));
  }

  async #upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== "/api/rtc/signal") {
      socket.destroy();
      return;
    }
    const token = bearerOf(request.headers.authorization);
    const verified = token ? await this.#store.verifyToken(token, this.#config.tokenTtlMs) : null;
    if (!verified || verified.account.disabled) {
      // A refused upgrade is answered before the handshake. 401 is "your token is dead, sign
      // out"; a disabled account gets its own code, because a client that keeps retrying a
      // socket it will never be allowed to open looks like a network fault to the person.
      const status = verified ? "403 Forbidden" : "401 Unauthorized";
      socket.write(`HTTP/1.1 ${status}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    this.#wss.handleUpgrade(request, socket, head, (ws) => this.#open(ws, verified.account.id));
  }

  #open(socket: WebSocket, accountId: string): void {
    const peerId = randomBytes(6).toString("hex");
    this.#sockets.set(peerId, socket);
    socket.on("pong", () => this.#relay.pong(peerId));
    socket.on("message", (raw) => this.#apply(this.#relay.message(peerId, raw.toString(), Date.now())));
    socket.on("error", () => undefined);
    socket.on("close", () => {
      this.#sockets.delete(peerId);
      this.#apply(this.#relay.closed(peerId));
    });
    this.#apply(this.#relay.open(peerId, accountId));
  }

  /** Ping every socket; one that missed a whole round is gone even though its socket says otherwise. */
  #beat(): void {
    const { ping, dead } = this.#relay.beat();
    for (const peerId of dead) {
      // `terminate`, not `close`: a half-open connection never answers a close handshake either,
      // and the client's own watchdog is what reconnects it.
      this.#sockets.get(peerId)?.terminate();
    }
    for (const peerId of ping) {
      const socket = this.#sockets.get(peerId);
      if (!socket) continue;
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }
  }

  #apply(actions: RelayAction[]): void {
    for (const action of actions) {
      if ("to" in action) {
        const socket = this.#sockets.get(action.to);
        if (!socket || socket.readyState !== socket.OPEN) continue;
        try {
          socket.send(JSON.stringify(action.message));
        } catch {
          // A send that fails means the socket is going away; `close` does the cleanup.
        }
      } else {
        const socket = this.#sockets.get(action.close);
        if (!socket) continue;
        try {
          socket.close(action.code, action.reason);
        } catch {
          socket.terminate();
        }
      }
    }
  }
}

export async function createCloud(config: CloudConfig, options: { fetch?: typeof fetch; storage?: CloudStorage } = {}) {
  const log = (message: string): void => console.log(`[cloud] ${message}`);
  const storage = options.storage ?? new FileStorage(config.dataFile);
  const store = await CloudStore.open(storage);

  const relay = new CloudRelay({ deviceOf: (deviceId) => store.device(deviceId), log });
  const signaling = new NodeSignaling({ config, store, relay, log });
  const devices = new Devices({
    config,
    store,
    isOnline: (deviceId) => relay.isOnline(deviceId),
    onDeviceRemoved: (deviceId) => signaling.removeDevice(deviceId),
  });
  const ice = new Ice(config);
  const login = new Login({ config, store, log, ...(options.fetch ? { fetch: options.fetch } : {}) });
  const session = async (request: Request): Promise<Account | null> => {
    const accountId = await readSession(store.secret(), cookiesOf(request)[SESSION_COOKIE], config.sessionTtlMs);
    const account = accountId ? store.account(accountId) : null;
    return account && !account.disabled ? account : null;
  };
  const consolePage = new ConsolePage({ store, devices, session });
  const route = createRouter({ config, store, login, devices, ice, consolePage });

  const server = createServer((request, response) => {
    // One line per request. A service that introduces two devices has to be able to answer
    // "did this phone even reach me", and a log of what arrived is the only way to tell the
    // difference between a client that is misconfigured and one that never tried.
    const started = Date.now();
    response.on("finish", () => {
      log(`${request.method ?? "?"} ${request.url ?? "?"} ${response.statusCode} ${Date.now() - started}ms`);
    });
    void (async () => {
      const url = new URL(request.url ?? "/", config.publicOrigin);
      const web = await toRequest(request, url);
      const result = await route(web);
      await writeResponse(response, result);
    })().catch((error: unknown) => {
      log(`unhandled: ${String(error)}`);
      // A request that ends without a response leaves a socket open until the client gives up,
      // which on a sign-in page reads as "the service is broken".
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: { code: "internal_error" } }));
      } else {
        response.end();
      }
    });
  });

  return {
    store,
    relay,
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

/** Turn a Node request into the Web `Request` the core speaks. */
async function toRequest(request: IncomingMessage, url: URL): Promise<Request> {
  const method = (request.method ?? "GET").toUpperCase();
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(key, item);
    else headers.set(key, value);
  }
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers });
  const body = await readIncoming(request);
  return new Request(url, { method, headers, body });
}

async function readIncoming(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    if (size + buffer.byteLength > MAX_REQUEST_BODY) break;
    size += buffer.byteLength;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** Write the core's `Response` back onto the Node response, cookies included. */
async function writeResponse(response: ServerResponse, result: Response): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  result.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    headers[key] = value;
  });
  const cookies = result.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  const body = Buffer.from(await result.arrayBuffer());
  response.writeHead(result.status, headers);
  response.end(body);
}

export { landing } from "../router.ts";
