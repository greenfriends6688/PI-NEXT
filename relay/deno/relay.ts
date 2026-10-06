/**
 * PI NEXT 自建中继（fork:mobile-shell · relay）—— Deno Deploy / deno run 单文件部署。
 *
 * 形态（Paseo 的极简子集，见 relay/README.md）：
 *   手机(5G) ──HTTP──▶ 本中继 ──WebSocket──▶ Mac 拨号端（主动拨出，家里免公网）
 * 本中继只做字节搬运：不解读内容、不落盘、不做应用层鉴权 —— 应用层鉴权在 Mac 的
 * 令牌闸门（lib/lan-access.ts），每个转发请求都要过 `checkLanAccess()`。
 * agent 注册鉴权用 RELAY_TOKEN 环境变量（Deno Deploy 的 env 里配）。
 *
 * 协议（JSON 帧）：
 *   中继 → Mac：{type:"req", id, method, path, headers, bodyB64}
 *              {type:"cancel", id}                       手机侧断开
 *   Mac → 中继：{type:"res-head", id, status, headers}
 *              {type:"chunk", id, b64}        响应体分片（SSE 也走这个）
 *              {type:"res-end", id}
 *   双向：{type:"ping"} / {type:"pong"}
 *
 * 部署：deno deploy → 入口选本文件 → env 配 RELAY_TOKEN → 得 https://xxx.deno.dev
 * 本地跑：RELAY_TOKEN=xxx deno run --allow-net relay/deno/relay.ts
 */

interface PendingResponse {
  head: (value: { status: number; headers: Headers }) => void;
  write: (b64: string) => void;
  close: () => void;
}

interface AgentConn {
  socket: WebSocket;
  pending: Map<string, PendingResponse>;
}

const agents = new Map<string, AgentConn>();
const RELAY_TOKEN = Deno.env.get("RELAY_TOKEN")?.trim() ?? "";
const PORT = Number(Deno.env.get("PORT") ?? "8000");
const PING_MS = 25_000;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const SERVER_ID_RE = /^[a-z0-9][a-z0-9-]{3,63}$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function sanitizeServerId(raw: string | null): string | null {
  if (!raw) return null;
  return SERVER_ID_RE.test(raw) ? raw : null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

Deno.serve({ port: PORT }, async (request: Request) => {
  const url = new URL(request.url);

  // ---- agent 注册（Mac 拨出） ------------------------------------------------
  if (url.pathname === "/agent") {
    if (!RELAY_TOKEN) {
      return json({ error: "RELAY_TOKEN is not configured on this relay" }, 503);
    }
    if (url.searchParams.get("token") !== RELAY_TOKEN) {
      return json({ error: "invalid relay token" }, 401);
    }
    const serverId = sanitizeServerId(url.searchParams.get("serverId"));
    if (!serverId) {
      return json({ error: "serverId must match " + SERVER_ID_RE.source }, 400);
    }
    if (request.headers.get("upgrade") !== "websocket") {
      return json({ error: "websocket upgrade required" }, 426);
    }

    const { socket, response } = Deno.upgradeWebSocket(request);
    // 同一 serverId 只留一条连接：Mac 重连时旧的让位（挂起流直接结束）。
    const previous = agents.get(serverId);
    if (previous) {
      for (const [, pending] of previous.pending) pending.close();
      previous.pending.clear();
      try { previous.socket.close(4000, "replaced by a newer agent"); } catch { /* gone */ }
    }
    const conn: AgentConn = { socket, pending: new Map() };
    agents.set(serverId, conn);

    socket.onmessage = (event) => {
      if (typeof event.data !== "string" || event.data.length > MAX_FRAME_BYTES) return;
      let frame: Record<string, unknown>;
      try {
        frame = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }
      if (frame.type === "ping") {
        socket.send(JSON.stringify({ type: "pong" }));
        return;
      }
      const id = typeof frame.id === "string" ? frame.id : "";
      const pending = conn.pending.get(id);
      if (!pending) return;
      if (frame.type === "res-head") {
        const status = typeof frame.status === "number" ? frame.status : 502;
        const headers = new Headers(
          Array.isArray(frame.headers) ? (frame.headers as [string, string][]) : [],
        );
        pending.head({ status, headers });
      } else if (frame.type === "chunk" && typeof frame.b64 === "string") {
        pending.write(frame.b64);
      } else if (frame.type === "res-end") {
        pending.close();
        conn.pending.delete(id);
      }
    };
    socket.onclose = () => {
      if (agents.get(serverId) === conn) agents.delete(serverId);
      for (const [, pending] of conn.pending) pending.close();
      conn.pending.clear();
    };
    socket.onerror = () => {
      try { socket.close(); } catch { /* already closed */ }
    };

    return response;
  }

  // ---- 手机侧：/m/<serverId>/<path> 原样转发 --------------------------------
  const mobileMatch = /^\/m\/([^/]+)(\/.*)?$/.exec(url.pathname);
  if (mobileMatch) {
    const serverId = sanitizeServerId(decodeURIComponent(mobileMatch[1]));
    const path = (mobileMatch[2] ?? "/") + url.search;
    if (!serverId) return json({ error: "bad serverId" }, 400);
    const conn = agents.get(serverId);
    if (!conn || conn.socket.readyState !== WebSocket.OPEN) {
      return json(
        { error: "your computer is not connected to the relay right now" },
        502,
      );
    }

    const id = crypto.randomUUID();
    let bodyB64: string | null = null;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const body = new Uint8Array(await request.arrayBuffer());
      if (body.byteLength > MAX_BODY_BYTES) {
        return json({ error: "request body too large for the relay" }, 413);
      }
      bodyB64 = bytesToBase64(body);
    }
    const headers: [string, string][] = [];
    request.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      // host 由 Mac 拨号端重写为中继的公网 host（同源校验靠它）；
      // content-length 由拨号端按实际 body 重算；accept-encoding 由拨号端自己谈。
      if (lower === "host" || lower === "connection" || lower === "content-length" || lower === "accept-encoding") {
        return;
      }
      headers.push([lower, value]);
    });

    // 先把 pending 流挂好（ReadableStream 的 start 在构造时同步执行），
    // 再发 req 帧 —— 保证 agent 的 res-head 一定有地方落。
    let headResolve!: (value: { status: number; headers: Headers }) => void;
    const headPromise = new Promise<{ status: number; headers: Headers }>((resolve) => {
      headResolve = resolve;
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        conn.pending.set(id, {
          head: (value) => headResolve(value),
          write: (b64) => {
            const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
            try { controller.enqueue(bytes); } catch { /* stream closed */ }
          },
          close: () => {
            try { controller.close(); } catch { /* already closed */ }
          },
        });
      },
      cancel: () => {
        try { conn.socket.send(JSON.stringify({ type: "cancel", id })); } catch { /* gone */ }
        conn.pending.delete(id);
      },
    });

    conn.socket.send(
      JSON.stringify({ type: "req", id, method: request.method, path, headers, bodyB64 }),
    );

    const head = await headPromise;
    return new Response(stream, { status: head.status, headers: head.headers });
  }

  // ---- 其它路径：极简状态页 --------------------------------------------------
  if (url.pathname === "/_health") {
    return json({ ok: true, connected: agents.size > 0 });
  }
  return new Response("PI NEXT relay (fork:mobile-shell). See relay/README.md.", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
});

setInterval(() => {
  for (const [serverId, conn] of agents) {
    try {
      if (conn.socket.readyState === WebSocket.OPEN) {
        conn.socket.send(JSON.stringify({ type: "ping" }));
      }
    } catch {
      agents.delete(serverId);
    }
  }
}, PING_MS);
