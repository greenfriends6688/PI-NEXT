/**
 * fork:mobile-shell —— 自建中继的 Mac 拨号端。
 *
 * 形态（Paseo 的极简子集）：Mac **主动拨出** WebSocket 到中继（家里免公网 IP、
 * 不动路由器），中继把手机发来的 HTTP 原样打包塞过来，本端对 `127.0.0.1:<port>`
 * 执行真实请求、把响应流式分片回去（SSE 也是普通字节流，天然兼容）。
 *
 * 两个安全要点：
 * - **应用层鉴权不在这里**：中继只是搬运工，每个请求到本机还是过
 *   `checkLanAccess()`（令牌/6 位码配对照旧）。
 * - **Host 重写 + 运行时放行**：浏览器页面的源是中继域名，本端把 Host 重写成
 *   中继 host、补 `x-forwarded-proto`，并把该 host 追加进 `PI_WEB_ALLOWED_HOSTS`
 *   —— `lib/request-security.ts` 的放行名单每次请求现读 `process.env`，
 *   所以不用重启服务（同源校验靠 `isProxyRewrittenSameOrigin` 的代理豁免）。
 *
 * 配置：`~/.pi/agent/relay-link.json`（0600，`/api/relay` 写）：
 *   { version: 1, url: "https://xxx.deno.dev", token?: string, serverId: string }
 * 服务启动时（instrumentation）读它，有就自动连。
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writePrivateFileAtomicSync } from "./atomic-file";
import { getAgentDir } from "./session-reader";

export interface RelayLinkConfig {
  version: 1;
  /** 中继的**公网 origin**（如 https://xxx.deno.dev）。 */
  url: string;
  /** 中继的 RELAY_TOKEN（agent 注册用；中继未配 token 时可缺省）。 */
  token?: string;
  serverId: string;
  createdAt: string;
}

export type RelayDialerStatus = "off" | "connecting" | "connected" | "offline";

export interface RelayDialerState {
  status: RelayDialerStatus;
  url: string | null;
  serverId: string | null;
  lastError: string | null;
  connectedAt: number | null;
  /** 自本次服务启动以来的重连次数（诊断用）。 */
  reconnects: number;
}

const CONFIG_PATH_KEY = Symbol.for("pi-web.relayLinkConfigPath");
const STATE_KEY = Symbol.for("pi-web.relayDialerState");
const SOCKET_KEY = Symbol.for("pi-web.relayDialerSocket");
const TIMER_KEY = Symbol.for("pi-web.relayDialerTimer");
const LISTENERS_KEY = Symbol.for("pi-web.relayDialerListeners");
const ALLOWED_HOSTS_KEY = Symbol.for("pi-web.relayAllowedHostsBase");

const INITIAL_STATE: RelayDialerState = {
  status: "off",
  url: null,
  serverId: null,
  lastError: null,
  connectedAt: null,
  reconnects: 0,
};

interface Registry {
  [CONFIG_PATH_KEY]?: string;
  [STATE_KEY]?: RelayDialerState;
  [SOCKET_KEY]?: WebSocket;
  [TIMER_KEY]?: ReturnType<typeof setTimeout>;
  [LISTENERS_KEY]?: Set<() => void>;
  [ALLOWED_HOSTS_KEY]?: string;
}

function registry(): Registry {
  return globalThis as unknown as Registry;
}

function configPath(): string {
  return registry()[CONFIG_PATH_KEY]
    ?? join(getAgentDir(), "relay-link.json");
}

/** 测试注入：换配置文件路径（globalThis 单例会跨用例残留，必须可重置）。 */
export function setRelayLinkConfigPathForTests(path: string | null): void {
  registry()[CONFIG_PATH_KEY] = path ?? undefined;
}

export function readRelayLinkConfig(): RelayLinkConfig | null {
  const path = configPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as RelayLinkConfig;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.url !== "string" || !/^https?:\/\//i.test(parsed.url)) return null;
    if (typeof parsed.serverId !== "string" || !/^[a-z0-9][a-z0-9-]{3,63}$/.test(parsed.serverId)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeRelayLinkConfig(config: RelayLinkConfig): void {
  writePrivateFileAtomicSync(configPath(), `${JSON.stringify(config, null, 2)}\n`);
}

export function getRelayDialerState(): RelayDialerState {
  return registry()[STATE_KEY] ?? INITIAL_STATE;
}

function setRelayDialerState(patch: Partial<RelayDialerState>): void {
  const next = { ...getRelayDialerState(), ...patch };
  registry()[STATE_KEY] = next;
  registry()[LISTENERS_KEY]?.forEach((listener) => listener());
}

export function subscribeRelayDialerState(listener: () => void): () => void {
  const listeners = registry()[LISTENERS_KEY] ?? new Set<() => void>();
  listeners.add(listener);
  registry()[LISTENERS_KEY] = listeners;
  return () => listeners.delete(listener);
}

function localPort(): string {
  return process.env.PORT?.trim() || "30141";
}

/**
 * 把中继 host 追加进运行时放行名单（幂等）。`request-security.ts` 的名单每次
 * 请求现读 `process.env.PI_WEB_ALLOWED_HOSTS`，所以这里改 env 立即生效、不用重启。
 */
function allowRelayHost(relayUrl: string): void {
  const host = new URL(relayUrl).host.toLowerCase();
  const base = registry()[ALLOWED_HOSTS_KEY]
    ?? (registry()[ALLOWED_HOSTS_KEY] = process.env.PI_WEB_ALLOWED_HOSTS ?? "");
  const current = new Set(
    (process.env.PI_WEB_ALLOWED_HOSTS ?? "").split(",").map((v) => v.trim()).filter(Boolean),
  );
  if (current.has(host)) return;
  current.add(host);
  process.env.PI_WEB_ALLOWED_HOSTS = [...current].join(",");
  void base;
}

async function handleRelayRequest(
  frame: { id: string; method: string; path: string; headers: [string, string][]; bodyB64: string | null },
  relayUrl: URL,
  socket: WebSocket,
): Promise<void> {
  const id = frame.id;
  const abort = new AbortController();
  const onCancel = (event: MessageEvent) => {
    try {
      const data = JSON.parse(String(event.data)) as { type?: string; id?: string };
      if (data.type === "cancel" && data.id === id) abort.abort();
    } catch { /* ignore */ }
  };
  socket.addEventListener("message", onCancel);
  try {
    const headers = new Headers(frame.headers);
    // 浏览器页面的源是中继域名：Host 必须重写成中继 host，同源校验
    // （isProxyRewrittenSameOrigin）与 cookie 的 Domain 语义才对得上。
    headers.set("host", relayUrl.host);
    headers.set("x-forwarded-proto", relayUrl.protocol.replace(":", ""));
    // 本机是内网回环，不要压缩：undici 会自动解压 body 但保留 content-encoding 头，
    // 我们若原样转发，手机侧会对明文再解压一次（2026-10-06 冒烟实测卡死）。
    headers.set("accept-encoding", "identity");

    const body = frame.bodyB64 != null ? Buffer.from(frame.bodyB64, "base64") : undefined;
    const response = await fetch(`http://127.0.0.1:${localPort()}${frame.path}`, {
      method: frame.method,
      headers,
      body,
      redirect: "manual",
      signal: abort.signal,
    });

    const responseHeaders: [string, string][] = [];
    response.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      // set-cookie 单独走 getSetCookie()（多值）；编码类字段随明文 body 一起剥掉。
      if (lower === "set-cookie" || lower === "content-encoding" || lower === "content-length" || lower === "transfer-encoding") {
        return;
      }
      responseHeaders.push([key, value]);
    });
    for (const cookie of response.headers.getSetCookie()) {
      responseHeaders.push(["set-cookie", cookie]);
    }
    socket.send(JSON.stringify({ type: "res-head", id, status: response.status, headers: responseHeaders }));

    if (response.body) {
      // undici 的 body 运行时可异步迭代，DOM lib 类型没声明（Node 实测）。
      const bodyStream = response.body as unknown as AsyncIterable<Uint8Array>;
      for await (const chunk of bodyStream) {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: "chunk", id, b64: Buffer.from(chunk).toString("base64") }));
      }
    }
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "res-end", id }));
  } catch (error) {
    // 本机没起来/请求中断：给中继一个终态，手机侧拿到 502 而不是无限等。
    try {
      socket.send(JSON.stringify({
        type: "res-head",
        id,
        status: 502,
        headers: [["content-type", "application/json; charset=utf-8"]],
      }));
      const message = error instanceof Error ? error.message : String(error);
      socket.send(JSON.stringify({
        type: "chunk",
        id,
        b64: Buffer.from(JSON.stringify({ error: message }), "utf8").toString("base64"),
      }));
      socket.send(JSON.stringify({ type: "res-end", id }));
    } catch { /* socket gone */ }
  } finally {
    socket.removeEventListener("message", onCancel);
  }
}

let reconnectAttempt = 0;

function connect(relayUrl: URL, serverId: string, token: string | undefined): void {
  const wsScheme = relayUrl.protocol === "https:" ? "wss:" : "ws:";
  const query = new URLSearchParams({ serverId, ...(token ? { token } : {}) });
  let socket: WebSocket;
  try {
    socket = new WebSocket(`${wsScheme}//${relayUrl.host}/agent?${query.toString()}`);
  } catch (error) {
    setRelayDialerState({ status: "offline", lastError: error instanceof Error ? error.message : String(error) });
    scheduleReconnect(relayUrl, serverId, token);
    return;
  }
  registry()[SOCKET_KEY] = socket;
  setRelayDialerState({ status: "connecting" });

  socket.onopen = () => {
    reconnectAttempt = 0;
    setRelayDialerState({ status: "connected", connectedAt: Date.now(), lastError: null });
  };
  socket.onmessage = (event: MessageEvent) => {
    let frame: { type?: string; id?: string; method?: string; path?: string; headers?: [string, string][]; bodyB64?: string | null };
    try {
      frame = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (frame.type === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
      return;
    }
    if (frame.type === "req" && typeof frame.id === "string" && typeof frame.method === "string" && typeof frame.path === "string") {
      void handleRelayRequest(
        { id: frame.id, method: frame.method, path: frame.path, headers: frame.headers ?? [], bodyB64: frame.bodyB64 ?? null },
        relayUrl,
        socket,
      );
    }
  };
  socket.onclose = () => {
    if (registry()[SOCKET_KEY] !== socket) return; // 已被 stop()/新连接取代
    setRelayDialerState({ status: "offline", connectedAt: null });
    scheduleReconnect(relayUrl, serverId, token);
  };
  socket.onerror = () => {
    setRelayDialerState({ lastError: "websocket error" });
  };
}

function scheduleReconnect(relayUrl: URL, serverId: string, token: string | undefined): void {
  reconnectAttempt = Math.min(reconnectAttempt + 1, 30);
  const delay = Math.min(1000 * reconnectAttempt, 30_000);
  const timer = setTimeout(() => {
    registry()[TIMER_KEY] = undefined;
    connect(relayUrl, serverId, token);
  }, delay);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
  registry()[TIMER_KEY] = timer;
  setRelayDialerState({ reconnects: getRelayDialerState().reconnects + 1 });
}

/** 启动拨号端（配置不存在时是 no-op）。幂等：已在跑就直接返回。 */
export function startRelayDialer(): RelayDialerState {
  const current = getRelayDialerState();
  if (current.status === "connecting" || current.status === "connected") return current;
  const config = readRelayLinkConfig();
  if (!config) {
    setRelayDialerState({ status: "off", url: null, serverId: null });
    return getRelayDialerState();
  }
  const relayUrl = new URL(config.url);
  allowRelayHost(config.url);
  setRelayDialerState({ url: config.url, serverId: config.serverId, reconnects: 0 });
  connect(relayUrl, config.serverId, config.token);
  return getRelayDialerState();
}

/** 停止拨号端（关开关时用）：断开且不再重连。 */
export function stopRelayDialer(): RelayDialerState {
  const timer = registry()[TIMER_KEY];
  if (timer) clearTimeout(timer);
  registry()[TIMER_KEY] = undefined;
  const socket = registry()[SOCKET_KEY];
  if (socket) {
    const dying = socket;
    registry()[SOCKET_KEY] = undefined;
    // onclose 里有「被取代」判断，先摘引用再关。
    dying.onclose = null;
    dying.onerror = null;
    try { dying.close(); } catch { /* gone */ }
  }
  setRelayDialerState({ status: "off", connectedAt: null });
  return getRelayDialerState();
}
