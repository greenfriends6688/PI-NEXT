
/**
 * The signaling relay as a pure state machine — no socket, no timer, no I/O.
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
 * The host owns the sockets and the clock: it assigns each peer's id, hands in `now`, and turns
 * the returned `RelayAction`s into sends, closes and terminations. That split is what lets the
 * same relay run behind `ws` on a Node server and behind a data channel in a Worker.
 *
 * Calls live in memory only. A restart drops them, and that is the right default: both ends
 * reconnect, the desktop re-registers, and the phone calls again.
 */

/** Close codes the clients act on. `4001` means "you were replaced", `4005` means "you are gone". */
const REPLACED = 4001;
const REMOVED = 4005;
/** Per-socket flood guard. The desktop already merges predicted ports into one message to stay under it. */
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 200;

/**
 * What the host should do next.
 *
 * `to` addresses one peer; `close` carries the close code, including the flood guard's `1008`.
 * A peer that missed a heartbeat is reported by `beat()` instead, because a half-open socket
 * never answers a close handshake and the host has to terminate it rather than close it.
 */
export type RelayAction =
  | { to: string; message: Record<string, unknown> }
  | { close: string; code: number; reason: string };

type Peer = {
  id: string;
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
  client: string;
  device: string;
};

/**
 * As much of a device as the relay ever asks about.
 *
 * Narrowed to these two on purpose: the rest of a `Device` is a name, a platform and a
 * timestamp, and a Cloudflare host that holds a snapshot of the device table rather than the
 * store itself should not have to produce fields nobody reads.
 */
export type RelayDevice = { id: string; accountId: string };

export type CloudRelayDeps = {
  /** Device registration lives in the store; the relay only asks whether an id belongs to an account. */
  deviceOf: (deviceId: string) => RelayDevice | null;
  log?: (message: string) => void;
};

export class CloudRelay {
  #deps: CloudRelayDeps;
  #peers = new Map<string, Peer>();
  #byDevice = new Map<string, string>();
  #calls = new Map<string, Call>();

  constructor(deps: CloudRelayDeps) {
    this.#deps = deps;
  }

  /**
   * A new socket, before it has said who it is.
   *
   * `accountId` is the account the host already authenticated the socket as; the id is what the
   * host minted for it. Both are the host's, because neither exists on this side of the line.
   */
  open(peerId: string, accountId: string): RelayAction[] {
    this.#peers.set(peerId, {
      id: peerId,
      accountId,
      role: "",
      deviceId: "",
      name: "",
      platform: "",
      alive: true,
      messages: 0,
      windowStart: 0,
    });
    return [];
  }

  /** The socket answered a ping. */
  pong(peerId: string): void {
    const peer = this.#peers.get(peerId);
    if (peer) peer.alive = true;
  }

  /** One inbound frame. `now` is the host's clock, so the flood window is testable. */
  message(peerId: string, raw: string, now: number): RelayAction[] {
    const peer = this.#peers.get(peerId);
    if (!peer) return [];

    // The flood guard counts messages rather than bytes: what a client sends here is small JSON,
    // and a loop that hammers this service is what costs it.
    if (now - peer.windowStart > RATE_WINDOW_MS) {
      peer.windowStart = now;
      peer.messages = 0;
    }
    if (++peer.messages > RATE_MAX) {
      this.#deps.log?.(`signaling: closing ${peer.id} for flooding`);
      return [{ close: peer.id, code: 1008, reason: "too many messages" }];
    }

    let message: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "object" || parsed === null) return [];
      message = parsed as Record<string, unknown>;
    } catch {
      return [];
    }

    switch (message.type) {
      case "hello":
        return this.#hello(peer, message);
      case "connect":
        return this.#connect(peer, message);
      case "signal":
        return this.#relay(peer, message);
      case "hangup":
        return this.#hangup(peer, message);
      default:
        return [];
    }
  }

  /** A socket went away. Whoever was talking to it is told the call is over. */
  closed(peerId: string): RelayAction[] {
    const peer = this.#peers.get(peerId);
    this.#peers.delete(peerId);
    if (peer?.deviceId && this.#byDevice.get(peer.deviceId) === peerId) this.#byDevice.delete(peer.deviceId);

    const actions: RelayAction[] = [];
    for (const call of [...this.#calls.values()]) {
      if (call.client !== peerId && call.device !== peerId) continue;
      const other = call.client === peerId ? call.device : call.client;
      this.#calls.delete(call.cid);
      actions.push({ to: other, message: { type: "hangup", cid: call.cid } });
    }
    return actions;
  }

  /** Which sockets to ping, and which missed a whole round and are to be terminated. */
  beat(): { ping: string[]; dead: string[] } {
    const ping: string[] = [];
    const dead: string[] = [];
    for (const peer of this.#peers.values()) {
      if (!peer.alive) {
        dead.push(peer.id);
        continue;
      }
      peer.alive = false;
      ping.push(peer.id);
    }
    return { ping, dead };
  }

  /**
   * Drop a device's socket because it is no longer in the account.
   *
   * Two messages, in this order: the error tells the desktop *why* (it re-registers when it sees
   * `device_not_found`), and the close code is what it reads as "stop reconnecting". Closing
   * alone would look like a network drop and be retried forever.
   */
  removeDevice(deviceId: string): RelayAction[] {
    const peerId = this.#byDevice.get(deviceId);
    if (!peerId) return [];
    return [
      { to: peerId, message: { type: "error", code: "device_not_found" } },
      { close: peerId, code: REMOVED, reason: "device removed" },
    ];
  }

  /** Whether a device has a live signaling socket. This is the only source of "online". */
  isOnline(deviceId: string): boolean {
    return this.#byDevice.has(deviceId);
  }

  #hello(peer: Peer, message: Record<string, unknown>): RelayAction[] {
    const role = message.role === "device" ? "device" : message.role === "client" ? "client" : "";
    if (!role) return [];
    peer.role = role;
    peer.name = typeof message.name === "string" ? message.name.slice(0, 80) : "";
    peer.platform = typeof message.platform === "string" ? message.platform.slice(0, 32) : "";

    if (role === "device") {
      const deviceId = typeof message.device_id === "string" ? message.device_id : "";
      // A device must be one this account actually registered: the id comes from the client, and
      // without this check anyone could claim an id and receive another account's calls.
      const device = deviceId ? this.#deps.deviceOf(deviceId) : null;
      if (!device || device.accountId !== peer.accountId) {
        return [{ close: peer.id, code: REMOVED, reason: "device not registered" }];
      }
      peer.deviceId = device.id;
      const previous = this.#byDevice.get(device.id);
      const actions: RelayAction[] = [];
      if (previous && previous !== peer.id) {
        // One live socket per device: two would both believe they answer the phone, and the
        // calls would land on whichever connected last.
        this.#byDevice.delete(device.id);
        actions.push({ close: previous, code: REPLACED, reason: "replaced by a newer connection" });
      }
      this.#byDevice.set(device.id, peer.id);
      // The client only matches on `type`, so this is the confirmation that its hello landed.
      actions.push({ to: peer.id, message: { type: "hello", role } });
      return actions;
    }

    return [{ to: peer.id, message: { type: "hello", role } }];
  }

  #connect(peer: Peer, message: Record<string, unknown>): RelayAction[] {
    if (peer.role !== "client") return [];
    const deviceId = typeof message.device_id === "string" ? message.device_id : "";
    const device = deviceId ? this.#deps.deviceOf(deviceId) : null;
    // Two different answers on purpose: `device_not_found` is permanent and the phone drops the
    // machine from its list; `device_offline` is retryable and the phone keeps it.
    if (!device || device.accountId !== peer.accountId) {
      return [{ to: peer.id, message: { type: "error", code: "device_not_found" } }];
    }
    const deviceSide = this.#byDevice.get(device.id);
    if (!deviceSide) {
      return [{ to: peer.id, message: { type: "error", code: "device_offline" } }];
    }

    const cid = randomHex(12);
    this.#calls.set(cid, { cid, accountId: peer.accountId, client: peer.id, device: deviceSide });
    return [
      { to: peer.id, message: { type: "connected", cid } },
      { to: deviceSide, message: { type: "incoming", cid, peer: { name: peer.name || "Phone", platform: peer.platform } } },
    ];
  }

  /** Forward `signal` to the other end of the call. The one path that must never widen. */
  #relay(peer: Peer, message: Record<string, unknown>): RelayAction[] {
    const cid = typeof message.cid === "string" ? message.cid : "";
    const call = this.#calls.get(cid);
    if (!call || call.accountId !== peer.accountId) {
      // A hangup that crossed an answer makes this normal rather than exceptional, which is why
      // it is an `unknown_call` the client ignores instead of an error worth showing.
      return [{ to: peer.id, message: { type: "error", code: "unknown_call", cid } }];
    }
    const other = call.client === peer.id ? call.device : call.device === peer.id ? call.client : null;
    if (!other) {
      return [{ to: peer.id, message: { type: "error", code: "unknown_call", cid } }];
    }
    return [{ to: other, message: { type: "signal", cid, data: message.data } }];
  }

  #hangup(peer: Peer, message: Record<string, unknown>): RelayAction[] {
    const cid = typeof message.cid === "string" ? message.cid : "";
    const call = this.#calls.get(cid);
    if (!call || call.accountId !== peer.accountId) {
      return [{ to: peer.id, message: { type: "error", code: "unknown_call", cid } }];
    }
    // Told before the call is dropped, so the other end gets a `hangup` for a cid it still knows
    // rather than a stream of `unknown_call` for one it does not.
    const other = call.client === peer.id ? call.device : call.client;
    this.#calls.delete(cid);
    return [{ to: other, message: { type: "hangup", cid } }];
  }
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
