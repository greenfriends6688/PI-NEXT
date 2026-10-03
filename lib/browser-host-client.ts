/**
 * fork:proma-42-browser · 服务端 → 桌面宿主的传输层。
 *
 * 只做三件事：读端点、连 loopback、发一行 JSON 等一行 JSON。
 * 协议与 op 名字在 `lib/browser-host-protocol.ts`，URL 策略 / 世代管理 / 容量裁剪
 * 都不在这里 —— 那些是 `lib/browser-tools-extension.ts` 的职责。
 *
 * 每次调用都开一个新连接：宿主是有状态的长驻进程，但连接本身无状态，
 * 这样一次崩溃/超时不至于把后面的调用一起拖死。
 */

import { connect } from "node:net";
import {
  BROWSER_HOST_PROTOCOL_VERSION,
  parseBrowserHostLine,
  type BrowserHostOp,
  type BrowserHostRequest,
  type BrowserHostResponse,
} from "./browser-host-protocol";
import {
  BrowserHostUnavailableError,
  resolveBrowserHostEndpoint,
  type BrowserHostEndpoint,
} from "./browser-endpoint";

/** 单次调用的总超时（含 TCP 握手）。观察/导航各自另有更紧的 CDP 超时。 */
export const BROWSER_HOST_CALL_TIMEOUT_MS = 30_000;

export class BrowserHostCallError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BrowserHostCallError";
    this.code = code;
  }
}

export interface CallBrowserHostOptions {
  sessionId: string;
  tabId?: string;
  payload?: Record<string, unknown>;
  timeoutMs?: number;
  signal?: AbortSignal;
  endpointPath?: string;
  /** 测试注入：换成假的发送函数，避免真的开 socket。 */
  transport?: (endpoint: BrowserHostEndpoint, request: BrowserHostRequest, signal: AbortSignal | undefined) => Promise<string>;
}

function defaultTransport(
  endpoint: BrowserHostEndpoint,
  request: BrowserHostRequest,
  signal: AbortSignal | undefined,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = connect({ host: endpoint.host, port: endpoint.port });
    let buffer = "";
    let settled = false;

    const cleanup = (): void => {
      socket.removeAllListeners();
      socket.destroy();
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const succeed = (line: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(line);
    };

    const onAbort = (): void => fail(new BrowserHostCallError("aborted", "浏览器操作已取消。"));
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        if (buffer.length > 32 * 1024 * 1024) fail(new BrowserHostCallError("response-too-large", "浏览器宿主返回内容过大。"));
        return;
      }
      succeed(buffer.slice(0, newline));
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      fail(new BrowserHostUnavailableError(
        "not-responding",
        `连不上本地浏览器宿主（${error.code ?? "unknown"}）。请重启桌面端后重试。`,
      ));
    });
    socket.on("close", () => {
      if (!settled) fail(new BrowserHostUnavailableError("not-responding", "本地浏览器宿主提前关闭了连接。"));
    });
  });
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal | undefined;
  done: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  const composite = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  return {
    signal: composite,
    done: () => clearTimeout(timer),
  };
}

/**
 * 一次宿主调用。错误分两类，工具据此决定是重试还是改参数：
 *   · `BrowserHostUnavailableError` —— 宿主不在（Web 部署 / 桌面端退出）；
 *   · `BrowserHostCallError` —— 宿主在，但这一个动作做不成（ref 过期、超时…）。
 */
export async function callBrowserHost(op: BrowserHostOp, options: CallBrowserHostOptions): Promise<unknown> {
  const endpoint = resolveBrowserHostEndpoint(options.endpointPath);
  const request: BrowserHostRequest = {
    v: BROWSER_HOST_PROTOCOL_VERSION,
    token: endpoint.token,
    op,
    sessionId: options.sessionId,
    ...(options.tabId ? { tabId: options.tabId } : {}),
    ...(options.payload ? { payload: options.payload } : {}),
    ...(options.timeoutMs ? { deadlineMs: options.timeoutMs } : {}),
  };
  const transport = options.transport ?? defaultTransport;
  const timeout = withTimeout(options.signal, options.timeoutMs ?? BROWSER_HOST_CALL_TIMEOUT_MS);
  let line: string;
  try {
    line = await transport(endpoint, request, timeout.signal);
  } catch (error) {
    if (error instanceof BrowserHostUnavailableError) throw error;
    if (error instanceof BrowserHostCallError && error.code === "aborted") {
      throw new BrowserHostCallError("cdp-timeout", "浏览器操作超时，页面可能没有响应。");
    }
    throw error instanceof Error
      ? new BrowserHostCallError("transport", error.message)
      : new BrowserHostCallError("transport", String(error));
  } finally {
    timeout.done();
  }

  const response = parseBrowserHostLine(line);
  if (!response) throw new BrowserHostCallError("bad-response", "本地浏览器宿主返回了无法解析的结果。");
  if (!response.ok) {
    throw new BrowserHostCallError(response.code ?? "host-error", response.error ?? "浏览器操作失败。");
  }
  return response.result;
}

export type { BrowserHostResponse };