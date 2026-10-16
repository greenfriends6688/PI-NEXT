import { randomBytes } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type { CloudConfig } from "./config.ts";
import type { CloudStore } from "./store.ts";
import { bearer } from "./login.ts";

/**
 * The signaling relay — the one piece of this service that is not replaceable by a static file.
 *
 * Two ends of one account cannot find each other on their own: each is behind a NAT, and the
 * address the other needs is the one the NAT hands out for this call. So both keep a socket here,
 * this service introduces them (`connect` → `incoming`), and from then on it forwards opaque
 * `signal` payloads between exactly those two — SDP offers, answers and ICE candidates.
 *
 * It never looks inside `data`. That is the security model as much as a design choice: the DTLS
 * fingerprints travel in the SDP over this already-authenticated channel, and the only thing
 * making that trustworthy is that a third party cannot get into it. So every `signal` goes to
 * **the other member of that call and nobody else** — no broadcast, no lookup that could resolve
 * to another account's socket.
 *
 * Calls live in memory only. A restart drops them, and that is the right default: both ends
 * reconnect, the desktop re-registers, and the phone calls again.
 */

/** Close codes the clients act on. `4001` means "you were replaced", `4005` means "you are gone". */
const REPLACED = 4001;
const REMOVED = 4005;
/** The contract's heartbeat: 25 seconds, and the desktop's 70-second silence verdict is calibrated to it. */
const PING_INTERVAL_MS = 25_000;
/** Per-socket flood guard. The desktop already merges predicted ports into one message to stay under it. */
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 200;

type Peer = {
  id: string;
  socket: WebSocket;
  accountId: string;
  role: "client" | "device" | "";
  deviceId: string;
  name: string;
  platform: string;
  /** Cleared on every ping, set by the pong. A whole missed round means the link is dead. */
  alive: boolean;
  messages: number;
  windowStart: number;
};

type Call = {
  cid: string;
  accountId: string;
  client: Peer;
  device: Peer;
};

export class Signaling {
  #config: CloudConfig;
  #store: CloudStore;
  #wss = new WebSocketServer({ noServer: true });
  #peers = new Set<Peer>();
  #byDevice = new Map<string, Peer>();
  #calls = new Map<string, Call>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #log: (message: string) => void;

  constructor(deps: { config: CloudConfig; store: CloudStore; log?: (message: string) => void }) {
    this.#config = deps.config;
    this.#store = deps.store;
    this.#log = deps.log ?? (() => undefined);
  }

  /** Attach to an HTTP server's `upgrade` event. */
  attach(server: Server): void {
    server.on("upgrade", (request, socket, head) => this.#upgrade(request, socket, head));
    this.#timer = setInterval(() => this.#beat(), PING_INTERVAL_MS);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    for (const peer of this.#peers) peer.socket.close(1000, "server stopping");
    this.#peers.clear();
    this.#byDevice.clear();
    this.#calls.clear();
  }

  /** Whether a device has a live signaling socket. This is the only source of "online". */
  isOnline(deviceId: string): boolean {
    return this.#byDevice.has(deviceId);
  }

  /**
   * Drop a device's socket because it is no longer in the account.
   *
   * Two messages, in this order: the error tells the desktop *why* (it re-registers when it sees
   * `device_not_found`), and the close code is what it reads as "stop reconnecting". Closing
   * alone would look like a network drop and be retried forever.
   */
  removeDevice(deviceId: string): void {
    const peer = this.#byDevice.get(deviceId);
    if (!peer) return;
    this.#send(peer, { type: "error", code: "device_not_found" });
    peer.socket.close(REMOVED, "device removed");
  }

  #upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== "/api/rtc/signal") {
      socket.destroy();
      return;
    }
    const token = bearer(request);
    const verified = token ? this.#store.verifyToken(token, this.#config.tokenTtlMs) : null;
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
    const peer: Peer = {
      id: randomBytes(6).toString("hex"),
      socket,
      accountId,
      role: "",
      deviceId: "",
      name: "",
      platform: "",
      alive: true,
      messages: 0,
      windowStart: Date.now(),
    };
    this.#peers.add(peer);
    socket.on("pong", () => {
      peer.alive = true;
    });
    socket.on("message", (raw) => this.#message(peer, raw.toString()));
    socket.on("error", () => undefined);
    socket.on("close", () => this.#closed(peer));
  }

  #message(peer: Peer, raw: string): void {
    // The flood guard counts messages rather than bytes: what a client sends here is small JSON,
    // and a loop that hammers this service is what costs it.
    const now = Date.now();
    if (now - peer.windowStart > RATE_WINDOW_MS) {
      peer.windowStart = now;
      peer.messages = 0;
    }
    if (++peer.messages > RATE_MAX) {
      this.#log(`signaling: closing ${peer.id} for flooding`);
      peer.socket.close(1008, "too many messages");
      return;
    }

    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return;
      message = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    switch (message.type) {
      case "hello":
        this.#hello(peer, message);
        return;
      case "connect":
        this.#connect(peer, message);
        return;
      case "signal":
        this.#relay(peer, message, "signal");
        return;
      case "hangup":
        this.#hangup(peer, message);
        return;
      default:
        return;
    }
  }

  #hello(peer: Peer, message: Record<string, unknown>): void {
    const role = message.role === "device" ? "device" : message.role === "client" ? "client" : "";
    if (!role) return;
    peer.role = role;
    peer.name = typeof message.name === "string" ? message.name.slice(0, 80) : "";
    peer.platform = typeof message.platform === "string" ? message.platform.slice(0, 32) : "";

    if (role === "device") {
      const deviceId = typeof message.device_id === "string" ? message.device_id : "";
      // A device must be one this account actually registered: the id comes from the client, and
      // without this check anyone could claim an id and receive another account's calls.
      const device = deviceId ? this.#store.device(deviceId) : null;
      if (!device || device.accountId !== peer.accountId) {
        peer.socket.close(REMOVED, "device not registered");
        return;
      }
      peer.deviceId = device.id;
      const previous = this.#byDevice.get(device.id);
      if (previous && previous !== peer) {
        // One live socket per device: two would both believe they answer the phone, and the
        // calls would land on whichever connected last.
        this.#byDevice.delete(device.id);
        previous.socket.close(REPLACED, "replaced by a newer connection");
      }
      this.#byDevice.set(device.id, peer);
    }

    // The client only matches on `type`, so this is the confirmation that its hello landed.
    this.#send(peer, { type: "hello", role });
  }

  #connect(peer: Peer, message: Record<string, unknown>): void {
    if (peer.role !== "client") return;
    const deviceId = typeof message.device_id === "string" ? message.device_id : "";
    const device = deviceId ? this.#store.device(deviceId) : null;
    // Two different answers on purpose: `device_not_found` is permanent and the phone drops the
    // machine from its list; `device_offline` is retryable and the phone keeps it.
    if (!device || device.accountId !== peer.accountId) {
      this.#send(peer, { type: "error", code: "device_not_found" });
      return;
    }
    const deviceSide = this.#byDevice.get(device.id);
    if (!deviceSide || deviceSide.socket.readyState !== deviceSide.socket.OPEN) {
      this.#send(peer, { type: "error", code: "device_offline" });
      return;
    }

    const cid = randomBytes(12).toString("hex");
    this.#calls.set(cid, { cid, accountId: peer.accountId, client: peer, device: deviceSide });
    this.#send(peer, { type: "connected", cid });
    this.#send(deviceSide, { type: "incoming", cid, peer: { name: peer.name || "Phone", platform: peer.platform } });
  }

  /** Forward `signal` to the other end of the call. The one path that must never widen. */
  #relay(peer: Peer, message: Record<string, unknown>, type: "signal"): void {
    const cid = typeof message.cid === "string" ? message.cid : "";
    const call = this.#calls.get(cid);
    if (!call || call.accountId !== peer.accountId) {
      // A hangup that crossed an answer makes this normal rather than exceptional, which is why
      // it is an `unknown_call` the client ignores instead of an error worth showing.
      this.#send(peer, { type: "error", code: "unknown_call", cid });
      return;
    }
    const other = call.client === peer ? call.device : call.device === peer ? call.client : null;
    if (!other) {
      this.#send(peer, { type: "error", code: "unknown_call", cid });
      return;
    }
    this.#send(other, { type, cid, data: message.data });
  }

  #hangup(peer: Peer, message: Record<string, unknown>): void {
    const cid = typeof message.cid === "string" ? message.cid : "";
    const call = this.#calls.get(cid);
    if (!call || call.accountId !== peer.accountId) {
      this.#send(peer, { type: "error", code: "unknown_call", cid });
      return;
    }
    // Told before the call is dropped, so the other end gets a `hangup` for a cid it still knows
    // rather than a stream of `unknown_call` for one it does not.
    const other = call.client === peer ? call.device : call.client;
    this.#calls.delete(cid);
    this.#send(other, { type: "hangup", cid });
  }

  #closed(peer: Peer): void {
    this.#peers.delete(peer);
    if (peer.deviceId && this.#byDevice.get(peer.deviceId) === peer) this.#byDevice.delete(peer.deviceId);
    // Whoever was talking to this peer learns the call is over; the survivor is otherwise left
    // waiting for a signal that will never come.
    for (const call of [...this.#calls.values()]) {
      if (call.client !== peer && call.device !== peer) continue;
      const other = call.client === peer ? call.device : call.client;
      this.#calls.delete(call.cid);
      this.#send(other, { type: "hangup", cid: call.cid });
    }
  }

  /** Ping every socket; one that missed a whole round is gone even though its socket says otherwise. */
  #beat(): void {
    for (const peer of this.#peers) {
      if (!peer.alive) {
        // `terminate`, not `close`: a half-open connection never answers a close handshake
        // either, and the client's own watchdog is what reconnects it.
        peer.socket.terminate();
        continue;
      }
      peer.alive = false;
      try {
        peer.socket.ping();
      } catch {
        peer.socket.terminate();
      }
    }
  }

  #send(peer: Peer, message: Record<string, unknown>): void {
    if (peer.socket.readyState !== peer.socket.OPEN) return;
    try {
      peer.socket.send(JSON.stringify(message));
    } catch {
      // A send that fails means the socket is going away; `close` does the cleanup.
    }
  }
}
