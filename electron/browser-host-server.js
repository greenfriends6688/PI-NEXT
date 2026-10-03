"use strict";

// fork:proma-42-browser · 桌面浏览器宿主的 loopback 控制通道。
//
// 这个文件**不 import electron**：它只是一个本机 TCP 服务，把「一行 JSON 请求」转成
// 「一次 handle(request, signal)」调用再把结果写成一行 JSON。这样协议、令牌握手、
// 消息大小与字符上限都能在没有 Electron 的普通 Node 里单测
// （见 electron/browser-host-server.test.mjs）。
//
// 为什么是 TCP 而不是 Electron IPC：跑 agent 的 Next 服务和 Electron 主进程是两个
// 进程，IPC 只在 renderer ↔ main 之间可用。端口动态分配，令牌只出现在本文件写的
// 0600 端点文件里 —— 读端（lib/browser-host-client.ts）把它当作不可信输入重新校验。

const net = require("node:net");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/** 与 lib/browser-host-protocol.ts 的 BROWSER_HOST_OPS 一一对应（测试断言两边相等）。 */
const SUPPORTED_OPS = Object.freeze([
  "state",
  "navigate",
  "observe",
  "click",
  "type",
  "scroll",
  "extract",
  "screenshot",
  "newTab",
  "switchTab",
  "closeTab",
  "closeSession",
]);

const PROTOCOL_VERSION = 1;
/** 截图这类大块走单个 JSON 字段，所以上限比一般 API 宽松，但仍是有界的。 */
const MAX_MESSAGE_CHARS = 8 * 1024 * 1024;
/** 请求必须是一行；超过就是有人在拿这个口传文件。 */
const MAX_REQUEST_CHARS = 1024 * 1024;
/** 单次操作的墙钟上限（毫秒）：之后主动 abort，调用方不必等到天荒地老。 */
const OPERATION_TIMEOUT_MS = 60_000;
/** 异步操作的排队上限：超过就拒，不给「排队等一个永远不会来的 CDP」留口子。 */
const MAX_PENDING_OPERATIONS = 64;

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

function endpointPath(home) {
  return path.join(home || os.homedir(), ".pi", "agent", "browser-host.json");
}

/** 只回 null 或一个通过校验的对象；解析失败一律当没端点，绝不回显文件内容。 */
function readEndpoint(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== PROTOCOL_VERSION) return null;
    if (parsed.host !== "127.0.0.1") return null;
    if (!Number.isInteger(parsed.port) || parsed.port <= 0 || parsed.port >= 65536) return null;
    if (typeof parsed.token !== "string" || parsed.token.length < 16) return null;
    if (!Number.isInteger(parsed.pid)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 0600 + 同目录 staging + rename：端口与令牌是能力凭据，不能被读到半份。 */
function writeEndpoint(filePath, endpoint) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const staging = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(staging, `${JSON.stringify(endpoint, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(staging, 0o600);
  fs.renameSync(staging, filePath);
  fs.chmodSync(filePath, 0o600);
}

function clearEndpoint(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* 清不掉不是错误：读端会因连不上而自行失效。 */
  }
}

/** 定长比较，避免令牌比较本身泄露前缀长度。 */
function timingSafeEqual(candidate, expected) {
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 请求校验。失败返回 `{ error, code }`，成功返回 `{ request }`。
 * 顺序是「便宜的先查」：长度 → 控制字符 → JSON → 版本 → 令牌 → op。
 */
function validateRequest(line, token) {
  if (typeof line !== "string" || line.length === 0) return { error: "空请求。", code: "unauthorized" };
  if (line.length > MAX_REQUEST_CHARS) return { error: "请求过大。", code: "unauthorized" };
  if (CONTROL_CHARS.test(line)) return { error: "请求含控制字符。", code: "unauthorized" };
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { error: "请求不是合法 JSON。", code: "unauthorized" };
  }
  if (!isPlainObject(parsed)) return { error: "请求不是合法 JSON 对象。", code: "unauthorized" };
  if (parsed.v !== PROTOCOL_VERSION) return { error: "协议版本不匹配。", code: "unauthorized" };
  if (typeof parsed.token !== "string" || !timingSafeEqual(parsed.token, token)) {
    return { error: "未授权的调用。", code: "unauthorized" };
  }
  if (!SUPPORTED_OPS.includes(parsed.op)) return { error: "不支持的操作。", code: "unknown-op" };
  if (typeof parsed.sessionId !== "string" || !parsed.sessionId || parsed.sessionId.length > 256) {
    return { error: "sessionId 非法。", code: "unauthorized" };
  }
  if (parsed.tabId !== undefined && (typeof parsed.tabId !== "string" || parsed.tabId.length > 128)) {
    return { error: "tabId 非法。", code: "unauthorized" };
  }
  if (parsed.payload !== undefined && !isPlainObject(parsed.payload)) {
    return { error: "payload 非法。", code: "unauthorized" };
  }
  if (parsed.deadlineMs !== undefined && (!Number.isFinite(parsed.deadlineMs) || parsed.deadlineMs <= 0)) {
    return { error: "deadlineMs 非法。", code: "unauthorized" };
  }
  return { request: parsed };
}

/**
 * 启动控制通道。
 *
 * @param handle  (request, signal) => Promise<result>；undefined 会被包成 result:null。
 * @param options.port         端口；0 = 随机分配（生产必须 0）。
 * @param options.token        令牌；缺省随机生成。
 * @param options.endpointPath 端点描述文件路径（测试注入临时目录）。
 */
function startBrowserHostServer(handle, options = {}) {
  const filePath = options.endpointPath || endpointPath(options.home);
  const token = options.token || randomToken();
  const sockets = new Set();
  let pending = 0;
  let closing = false;

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";

    const finish = (response) => {
      let line;
      try {
        line = JSON.stringify(response);
      } catch {
        line = JSON.stringify({ ok: false, error: "结果无法序列化。", code: "host-error" });
      }
      if (line.length > MAX_MESSAGE_CHARS) {
        line = JSON.stringify({ ok: false, error: "结果过大。", code: "host-error" });
      }
      socket.end(`${line}\n`, () => socket.destroy());
    };

    const dispatch = (raw) => {
      const validation = validateRequest(raw, token);
      if (!validation.request) {
        finish({ ok: false, error: validation.error, code: validation.code });
        return;
      }
      if (pending >= MAX_PENDING_OPERATIONS) {
        finish({ ok: false, error: "浏览器忙，请稍后重试。", code: "cdp-timeout" });
        return;
      }
      const request = validation.request;
      const controller = new AbortController();
      const budget = Number.isFinite(request.deadlineMs) && request.deadlineMs > 0
        ? Math.min(request.deadlineMs, OPERATION_TIMEOUT_MS)
        : OPERATION_TIMEOUT_MS;
      const timer = setTimeout(() => controller.abort(), budget);
      if (typeof timer.unref === "function") timer.unref();
      pending += 1;
      Promise.resolve()
        .then(() => handle(request, controller.signal))
        .then((result) => finish({ ok: true, result: result === undefined ? null : result }))
        .catch((error) => finish({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          code: error && typeof error.code === "string" ? error.code : "host-error",
        }))
        .finally(() => {
          pending -= 1;
          clearTimeout(timer);
        });
    };

    socket.on("data", (chunk) => {
      if (closing) return;
      buffer += chunk;
      if (buffer.length > MAX_MESSAGE_CHARS) {
        finish({ ok: false, error: "请求过大。", code: "unauthorized" });
        buffer = "";
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      dispatch(line);
    });

    socket.on("error", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    const onStartupError = (error) => {
      console.error("[受管浏览器] 控制通道监听失败:", error.message);
      reject(error);
    };
    server.once("error", onStartupError);
    server.listen(options.port || 0, "127.0.0.1", () => {
      server.removeListener("error", onStartupError);
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const endpoint = {
        version: PROTOCOL_VERSION,
        host: "127.0.0.1",
        port,
        token,
        pid: process.pid,
        startedAt: Date.now(),
      };
      try {
        writeEndpoint(filePath, endpoint);
      } catch (error) {
        server.close();
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      resolve({
        endpoint,
        close() {
          if (closing) return;
          closing = true;
          // 只有「端点文件里的 pid 仍是我」才删：换了宿主重写之后，老的 close 不该抹掉新的。
          const current = readEndpoint(filePath);
          if (current && current.pid === process.pid) clearEndpoint(filePath);
          for (const socket of sockets) socket.destroy();
          server.close();
        },
      });
    });
  });
}

module.exports = {
  MAX_MESSAGE_CHARS,
  MAX_PENDING_OPERATIONS,
  MAX_REQUEST_CHARS,
  OPERATION_TIMEOUT_MS,
  PROTOCOL_VERSION,
  SUPPORTED_OPS,
  clearEndpoint,
  endpointPath,
  readEndpoint,
  startBrowserHostServer,
  validateRequest,
  writeEndpoint,
};