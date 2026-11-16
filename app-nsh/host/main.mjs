// The app's agent: the pi server, running inside the app, with no address.
//
// pi's agent is a Node SDK, and the app's UI runs in QuickJS — so the agent
// cannot be *the same* process as the window. It is the app's own process
// instead: this host, started by `PI NEXT.app` from the Node runtime the bundle
// carries, talking to the window over stdin/stdout only. No TCP listener, no
// port, no URL: nothing outside this app can reach it, and the window never
// connects to "a local server".
//
// What it serves is the pi server this repo already is (sessions, agent, tools,
// MCP, files, git, terminal, settings). Next's own request handler sits behind a
// **unix socket** in the app's data directory (mode 0600) — a socket is not a
// port and is not reachable by other machines or apps — and this file turns
// stdio into requests to it.
//
// Wire format: one JSON object per line, both ways.
//
//   → {"id":1,"path":"/api/sessions","method":"GET","headers":{…}}
//   → {"id":1,"body":"…","bodyEncoding":"utf8|base64"}
//   ← {"id":1,"status":200,"headers":{…},"body":"…","bodyEncoding":"utf8|base64"}
//   ← {"id":1,"stream":"open","status":200} / {"id":1,"chunk":"…"} / {"id":1,"stream":"end"}
//   ← {"id":1,"error":{"message":"…","code":"…"}}
//   → {"id":1,"cancel":true}     (aborts that request or stream)
//   ← {"event":"ready"}          (listening: the window may send)
//   ← {"event":"log","text":"…"} (the server's own stdout/stderr, for the log)
//
// It is copied into the packaged app at `<pi-web>/host/main.mjs` by
// `scripts/bundle-server.mjs`, so `next` and the app's dependencies resolve
// exactly as they do when the server runs standalone.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** The server payload root: this file lives in `<pi-web>/host/`. */
const root = path.resolve(here, "..");
/** The socket the app's own Next handler listens on: in the data dir, 0600. */
const socket = process.env.PI_NSH_SOCKET || path.join(process.cwd(), "agent.sock");
/** What the Host header says, so Next builds absolute URLs that are stable. */
const HOST = process.env.PI_NSH_HOST || "127.0.0.1:30142";

/** One line to the window. Everything goes through here, so lines never mix. */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function log(text) {
  const line = String(text).trim();
  if (line) send({ event: "log", text: line });
}

for (const event of ["uncaughtException", "unhandledRejection"]) {
  process.on(event, (error) => {
    send({ event: "error", message: error instanceof Error ? error.message : String(error) });
  });
}

// ---------------------------------------------------------------- the server
let handler;
let server;
try {
  const next = (await import("next")).default;
  const app = next({ dev: false, dir: root, hostname: "127.0.0.1", port: 30142 });
  await app.prepare();
  handler = app.getRequestHandler();
} catch (error) {
  send({
    event: "failed",
    message: `the pi server did not start: ${error instanceof Error ? error.message : String(error)}`,
  });
  process.exit(1);
}

try {
  fs.unlinkSync(socket);
} catch {
  // No stale socket.
}
fs.mkdirSync(path.dirname(socket), { recursive: true });
server = http.createServer((request, response) => {
  Promise.resolve(handler(request, response)).catch((error) => {
    try {
      response.statusCode = 500;
      response.end(String(error));
    } catch {
      // The response already went out.
    }
  });
});
server.on("error", (error) => {
  send({ event: "failed", message: `the pi server did not listen: ${error.message}` });
  process.exit(1);
});
await new Promise((resolve) => server.listen(socket, resolve));
try {
  fs.chmodSync(socket, 0o600);
} catch {
  // A filesystem without modes (a mounted volume).
}

// The server writes its own log lines to stdout (Next's ready banner, pi's
// session notices); keep them out of the protocol by capturing the console and
// sending them as log events, not as responses.
for (const name of ["log", "info", "warn", "error"]) {
  console[name] = (...parts) => log(parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
}

send({ event: "ready", pid: process.pid, socket });

// ---------------------------------------------------------------- the protocol
const inflight = new Map();

/** Turns one message from the window into one request against the socket. */
function forward(message) {
  const { id, path: requestPath, method = "GET", headers = {} } = message;
  const body = typeof message.body === "string"
    ? Buffer.from(message.body, message.bodyEncoding === "base64" ? "base64" : "utf8")
    : undefined;
  const outgoing = { host: HOST, ...headers };
  if (body) outgoing["content-length"] = String(body.length);

  const request = http.request({ socketPath: socket, path: requestPath, method, headers: outgoing }, (response) => {
    if (message.stream) {
      send({ id, stream: "open", status: response.statusCode, headers: response.headers });
      response.setEncoding("utf8");
      response.on("data", (chunk) => send({ id, chunk }));
      response.on("end", () => {
        inflight.delete(id);
        send({ id, stream: "end" });
      });
      return;
    }
    const chunks = [];
    response.on("data", (chunk) => chunks.push(chunk));
    response.on("end", () => {
      inflight.delete(id);
      const buffer = Buffer.concat(chunks);
      const type = String(response.headers["content-type"] ?? "");
      // JSON and event streams are text; everything else (a zip, an image, a
      // downloaded file) travels base64 so the window writes the same bytes.
      const textual = /(^text\/|json|event-stream|javascript|xml|csv)/i.test(type) || buffer.length === 0;
      send({
        id,
        status: response.statusCode,
        headers: response.headers,
        body: textual ? buffer.toString("utf8") : buffer.toString("base64"),
        bodyEncoding: textual ? "utf8" : "base64",
      });
    });
  });
  request.on("error", (error) => {
    inflight.delete(id);
    send({ id, error: { message: String(error.message ?? error), code: error.code } });
  });
  if (body) request.write(body);
  request.end();
  inflight.set(id, request);
}

let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  for (;;) {
    const breakAt = buffered.indexOf("\n");
    if (breakAt < 0) break;
    const line = buffered.slice(0, breakAt).trim();
    buffered = buffered.slice(breakAt + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ event: "log", text: `the window sent a line that is not JSON` });
      continue;
    }
    if (message.cancel) {
      const pending = inflight.get(message.id);
      if (pending) {
        pending.destroy();
        inflight.delete(message.id);
      }
      continue;
    }
    try {
      forward(message);
    } catch (error) {
      send({ id: message.id, error: { message: String(error?.message ?? error) } });
    }
  }
});

// The window closing means the app quit: take the server down with it.
process.stdin.on("end", () => shutdown());
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => shutdown());
}

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const request of inflight.values()) {
    try {
      request.destroy();
    } catch {
      // Already gone.
    }
  }
  try {
    server.close();
    fs.unlinkSync(socket);
  } catch {
    // Already closed.
  }
  process.exit(0);
}
