import type { Device } from "../src/store.ts";
import { CloudRelay, type RelayAction } from "../src/relay.ts";
import type { CloudEnv } from "./env.ts";

/** The word that keeps an idle link alive; see `#startBeat`. */
const KEEPALIVE = JSON.stringify({ type: "ping" });

/**
 * One account's signaling sockets.
 *
 * A Durable Object per account (`idFromName(accountId)`) is the shape this service always
 * wanted: both ends of a call belong to the same account, so one object holds both sockets and
 * a `signal` is a forward inside a single process — no shared registry to keep consistent, and
 * no way for a third account to appear in the middle, because no code path here can reach
 * another account's object.
 *
 * **The sockets do not hibernate.** `CloudRelay` keeps the call bookkeeping in memory, and a
 * hibernated object comes back with its maps empty — a call in flight would answer
 * `unknown_call` to the next candidate the phone sends, which is exactly the failure that is
 * hardest to reproduce. Accepting plainly (`server.accept()`) keeps the object resident for as
 * long as a socket is attached, which is what makes that bookkeeping trustworthy. The price is
 * that an account with a phone connected keeps an object warm; hibernating would mean moving
 * the calls into storage and rebuilding the peer state from `getWebSockets()`, which is a
 * larger change and not an obviously better one.
 *
 * **The device table is a snapshot, not a lookup.** `CloudRelay` decides whether a `hello`
 * names a device of this account, and it does so synchronously inside `message()` — because a
 * frame that awaited could be overtaken by the next one on the same socket, and the phone's
 * `hello` and `connect` arrive back to back. So the list is fetched once per connection and the
 * relay reads that. A device registered later reaches this object through its own new socket,
 * which takes its own snapshot.
 */
export class SignalObject {
  #ctx: DurableObjectState;
  #env: CloudEnv;
  #relay: CloudRelay | null = null;
  #sockets = new Map<string, WebSocket>();
  #devices = new Map<string, Device>();
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: DurableObjectState, env: CloudEnv) {
    this.#ctx = ctx;
    this.#env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/__online") {
      const deviceId = url.searchParams.get("device") ?? "";
      return Response.json({ online: this.#relay?.isOnline(deviceId) === true });
    }
    if (url.pathname === "/__remove") {
      this.#apply(this.#relay?.removeDevice(url.searchParams.get("device") ?? "") ?? []);
      return Response.json({ ok: true });
    }
    if (url.pathname !== "/api/rtc/signal") return new Response(null, { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("upgrade required", { status: 426 });
    }

    // Verified here rather than trusting the Worker's word: this object is reachable from
    // anything holding the binding, and the token is the only thing that says whose account
    // this is. One hop, on connect only.
    const token = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";
    const verified = await this.#askStore<{ account: { id: string; disabled?: boolean } | null }>({
      op: "verify",
      token,
    });
    if (!verified.account) return new Response(null, { status: 401 });
    if (verified.account.disabled) return new Response(null, { status: 403 });

    const listed = await this.#askStore<{ devices: Array<{ id: string; accountId: string }> }>({
      op: "devices",
      accountId: verified.account.id,
    });
    this.#devices = new Map(
      listed.devices.map((device) => [device.id, { id: device.id, accountId: device.accountId } as Device]),
    );

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    // Non-hibernating on purpose: see the class comment. `accept()` keeps this object resident
    // while the socket is attached, which is what makes the in-memory calls trustworthy.
    server.accept();
    this.#open(server, verified.account.id);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The relay, built on the snapshot the connecting socket just took. */
  #relayFor(accountId: string): CloudRelay {
    if (!this.#relay || this.#accountId !== accountId) {
      this.#accountId = accountId;
      this.#relay = new CloudRelay({
        deviceOf: (deviceId) => this.#devices.get(deviceId) ?? null,
        log: (message) => console.log(`[cloud] ${message}`),
      });
    }
    return this.#relay;
  }

  #accountId: string | null = null;

  #open(socket: WebSocket, accountId: string): void {
    const relay = this.#relayFor(accountId);
    const peerId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    this.#sockets.set(peerId, socket);

    socket.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
      this.#apply(relay.message(peerId, raw, Date.now()));
    });
    socket.addEventListener("close", () => {
      this.#sockets.delete(peerId);
      this.#apply(relay.closed(peerId));
      if (this.#sockets.size === 0) this.#stopBeat();
    });
    socket.addEventListener("error", () => undefined);

    this.#apply(relay.open(peerId, accountId));
    this.#startBeat();
  }

  /**
   * A word every 25 seconds, because the client's watchdog counts silence.
   *
   * On Node this is a WebSocket protocol ping: the runtime answers it, and a socket that
   * missed a whole round is terminated. **A Worker cannot send one** — the edge terminates the
   * socket and answers those itself, so this object never sees a pong either. The keepalive is
   * therefore an application message.
   *
   * What it is for on this side is not liveness. Both clients fall through to a default branch
   * for an unknown `type` (`rtc/signaling.ts` and the phone's switch), so it is ignored — but
   * the desktop drops a link that has heard **nothing** for seventy seconds, and a call whose
   * media is flowing peer-to-peer sends no further signaling for far longer than that. That is
   * why it has to exist at all.
   *
   * So the beat deliberately does **not** call `CloudRelay.beat()`: the round it measures is
   * closed by protocol pongs, and there are none here. Every peer would age out every round and
   * be terminated on the first one. Liveness is the edge's question on this host, answered by
   * the `close` event.
   */
  #startBeat(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      for (const socket of this.#sockets.values()) {
        try {
          socket.send(KEEPALIVE);
        } catch {
          // A send that fails means the socket is going away; `close` does the cleanup.
        }
      }
    }, 25_000);
  }

  #stopBeat(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  #apply(actions: RelayAction[]): void {
    for (const action of actions) {
      if ("to" in action) {
        const socket = this.#sockets.get(action.to);
        if (!socket) continue;
        try {
          socket.send(JSON.stringify(action.message));
        } catch {
          // A send that fails means the socket is going away; `close` does the cleanup.
        }
        continue;
      }
      const socket = this.#sockets.get(action.close);
      if (!socket) continue;
      try {
        socket.close(action.code, action.reason);
      } catch {
        // `close` is best effort; letting it throw would abort the rest of this batch.
      }
      this.#sockets.delete(action.close);
    }
  }

  async #askStore<T>(body: Record<string, unknown>): Promise<T> {
    const stub = this.#env.STORE.get(this.#env.STORE.idFromName("store"));
    const reply = await stub.fetch("https://store/__store", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await reply.json()) as T;
  }
}
