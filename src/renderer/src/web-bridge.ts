import { AppClient, type MessageTransport } from "@shared/app-client";
import { APP_PROTOCOL_VERSION } from "@shared/app-protocol";
import { createPinextApi } from "@shared/api";
import { APP_PLATFORM } from "@/lib/platform";

/**
 * The browser half of `window.pinext`.
 *
 * The desktop's half is `src/preload/index.ts` over Electron IPC; this is the same bridge
 * object from the same factory (`createPinextApi`), carried by a WebSocket that speaks the
 * App Protocol. Both hand the renderer an object built by that one factory, so neither can
 * quietly grow a method the other lacks.
 *
 * Two things are different here, and both are consequences of being a browser:
 *
 * 1. **The credential cannot ride in a header.** `new WebSocket()` takes no headers, so the
 *    device token goes in the first frame instead — `{type:"auth",token}`, which the server
 *    already accepts for exactly this reason. It has to go out *before* the App Protocol
 *    `hello`, and its reply must not be handed to `AppClient`: an auth frame is not an App
 *    Protocol frame and `AppClient` would rightly refuse it.
 * 2. **There is no file path.** `pathForFile` is left undefined; `lib/attachments.ts`
 *    already checks for it and falls back to uploading the bytes.
 */

/** Where the device token is kept. Not a credential store — a browser has none. */
const TOKEN_KEY = "pinext.web.token";

class SocketTransport implements MessageTransport {
  #socket: WebSocket;
  #queue: unknown[] = [];
  #messages = new Set<(message: unknown) => void>();
  #closes = new Set<(reason: string) => void>();
  #authError: string | null = null;
  #finished = false;

  constructor(url: string, token: string) {
    this.#socket = new WebSocket(url);
    this.#socket.addEventListener("open", () => {
      this.#socket.send(JSON.stringify({ type: "auth", token }));
      for (const frame of this.#queue) this.#socket.send(JSON.stringify(frame));
      this.#queue.length = 0;
    });
    this.#socket.addEventListener("message", (event) => {
      let frame: unknown;
      try {
        frame = JSON.parse(typeof event.data === "string" ? event.data : "");
      } catch {
        return;
      }
      const record = frame as Record<string, unknown> | null;
      if (record?.type === "auth") {
        if (record.ok !== true) {
          this.#authError = typeof record.error === "string" ? record.error : "令牌无效";
        }
        return;
      }
      for (const listener of this.#messages) listener(frame);
    });
    this.#socket.addEventListener("close", (event) => this.#finish(this.#reason(event.code)));
    this.#socket.addEventListener("error", () => this.#finish("连接失败"));
  }

  #reason(code: number): string {
    // 4001 is the server's `unauthorized`: a revoked device, or a token that was never one.
    if (code === 4001) return this.#authError ?? "unauthorized";
    if (code === 4005) return "removed";
    return this.#authError ?? `closed(${code})`;
  }

  #finish(reason: string): void {
    if (this.#finished) return;
    this.#finished = true;
    for (const listener of this.#closes) listener(reason);
  }

  send(message: unknown): void {
    if (this.#finished) return;
    // `AppClient` writes `hello` the moment it is constructed, which is before the socket
    // has opened. Sending then throws, so frames wait here.
    if (this.#socket.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(message));
    else this.#queue.push(message);
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.#messages.add(listener);
    return () => this.#messages.delete(listener);
  }

  onClose(listener: (reason: string) => void): () => void {
    this.#closes.add(listener);
    return () => this.#closes.delete(listener);
  }

  close(): void {
    this.#finished = true;
    try {
      this.#socket.close();
    } catch {
      // Already gone.
    }
  }
}

/**
 * Ask for the password and trade it for a device token.
 *
 * A page rather than a component: it runs before the app's own stylesheet and React tree
 * exist, and it is the only thing on screen until there is a credential to connect with.
 */
async function promptForToken(): Promise<string | null> {
  const root = document.getElementById("root");
  if (!root) return null;
  root.innerHTML = `
    <form id="pinext-login" style="max-width:22rem;margin:18vh auto;padding:0 1.5rem;font:14px/1.6 system-ui,sans-serif;color:#111">
      <h1 style="font-size:1.1rem;font-weight:600;margin:0 0 .35rem">PI NEXT</h1>
      <p style="margin:0 0 1.25rem;color:#666">输入这台电脑上「远程访问」设置的密码。</p>
      <input id="pinext-password" type="password" autocomplete="current-password" placeholder="密码"
        style="width:100%;box-sizing:border-box;padding:.6rem .75rem;border:1px solid #ccc;border-radius:10px;font:inherit" />
      <p id="pinext-error" style="margin:.75rem 0 0;color:#c0392b;min-height:1.2em"></p>
      <button type="submit"
        style="margin-top:.5rem;width:100%;padding:.6rem;border:0;border-radius:10px;background:#2b6cf6;color:#fff;font:inherit;font-weight:500;cursor:pointer">
        连接
      </button>
    </form>`;
  const form = root.querySelector<HTMLFormElement>("#pinext-login");
  const input = root.querySelector<HTMLInputElement>("#pinext-password");
  const error = root.querySelector<HTMLParagraphElement>("#pinext-error");
  if (!form || !input || !error) return null;
  input.focus();
  return new Promise<string | null>((settle) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void (async () => {
        error.textContent = "";
        const password = input.value;
        if (!password) return;
        try {
          const response = await fetch("/api/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password, label: "web" }),
          });
          if (!response.ok) {
            error.textContent = response.status === 403 ? "这个页面不是从服务器自己的地址打开的。" : "密码不对。";
            return;
          }
          const body = (await response.json()) as { token?: unknown };
          if (typeof body.token !== "string") {
            error.textContent = "服务器没有返回令牌。";
            return;
          }
          root.innerHTML = "";
          settle(body.token);
        } catch {
          error.textContent = "连不上服务器。";
        }
      })();
    });
  });
}

/**
 * The token this page connects with.
 *
 * Two ways, and the order matters. A 独立 Web 版 server on loopback has no password to
 * ask for, and hands this page a loopback token at `/api/web-token` — that request is
 * answered only for a loopback peer from this origin, so it is the server deciding, not
 * the page asking nicely. Anything else (a phone, a password-protected remote setup)
 * gets no token there and falls through to the form.
 *
 * A token the **user** supplied is reused across reloads: it is a device token the server
 * issued and will still accept tomorrow, and asking again would be a password prompt on
 * every visit.
 *
 * The loopback token is the opposite and is therefore **never** kept. `webLoopbackToken()`
 * mints a fresh one per run and writes it down nowhere, so a stored copy is dead the moment
 * the agent restarts — and a page holding one cannot recover by reloading, because the
 * stored value is tried first. It has to be asked for again, every load, which is one
 * request to the same process that served this page.
 */
async function ensureToken(): Promise<string> {
  const handed = await fetchLoopbackToken();
  if (handed) {
    // Drop any older loopback token rather than leaving it to be tried after the next
    // restart. A device token from the form never reaches this branch.
    localStorage.removeItem(TOKEN_KEY);
    return handed;
  }
  const stored = localStorage.getItem(TOKEN_KEY);
  if (stored) return stored;
  const token = await promptForToken();
  if (!token) throw new Error("没有可用的令牌");
  localStorage.setItem(TOKEN_KEY, token);
  return token;
}

/** The loopback token, when this server offers one to this page. `null` means ask for a password. */
async function fetchLoopbackToken(): Promise<string | null> {
  try {
    const response = await fetch("/api/web-token");
    if (!response.ok) return null;
    const body = (await response.json()) as { token?: unknown };
    return typeof body.token === "string" && body.token ? body.token : null;
  } catch {
    // No such endpoint, or the network is down: the form is the answer either way.
    return null;
  }
}

/** Connect, install `window.pinext`, and resolve once the handshake has landed. */
export async function installWebBridge(): Promise<void> {
  const token = await ensureToken();
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const client = new AppClient(new SocketTransport(`${scheme}://${location.host}/ws`, token), {
    client: { kind: "web", version: String(APP_PROTOCOL_VERSION) },
  });

  // One push registry on the client, fanned out per channel here: `subscribe` is called
  // per channel by the bridge, and `AppClient` delivers every push to one listener.
  const listeners = new Set<(channel: string, payload: unknown) => void>();
  client.onPush((channel, payload) => {
    for (const listener of listeners) listener(channel, payload);
  });
  client.onStatus((status) => {
    // A revoked device or an expired token: drop it so the next load asks again rather
    // than reconnecting forever with a credential the server keeps refusing.
    if (status.state === "error" && /unauthorized|令牌无效/.test(status.message)) {
      localStorage.removeItem(TOKEN_KEY);
    }
  });

  await client.connect();

  window.pinext = createPinextApi({
    invoke: (channel, payload) => client.call(channel, payload),
    send: (channel, payload) => {
      void client.call(channel, payload).catch(() => undefined);
    },
    subscribe: (channel, listener) => {
      const entry = (name: string, payload: unknown): void => {
        if (name === channel) listener(payload);
      };
      listeners.add(entry);
      return () => listeners.delete(entry);
    },
    // Nothing to read synchronously here: Electron's preload can reach into userData
    // before the page runs, a browser cannot. The store applies its defaults, then the
    // real settings arrive over `settings:get` a moment later.
    settingsInitial: {},
    platform: APP_PLATFORM,
  });

  // 玻璃效果 is offered where there is a blur to draw under, and a browser tab has no system
  // blur — so the browser client paints one instead (`lib/desktop-scene.ts`, installed by
  // `web-main.tsx` before the app module runs) and says so here. Without the flag the
  // setting would be hidden and every theme would keep its solid palette, which is the
  // "独立 Web 版没有玻璃效果" this answers. It must be set **before** `lib/platform.ts` is
  // imported: `HAS_VIBRANCY` is read once, at module scope.
  (window.pinext.app as { simulatedVibrancy?: boolean }).simulatedVibrancy = true;
}
