import { existsSync } from "node:fs";
import { builtWebRoot, RemoteServer } from "../server/server.ts";
import { readAppSettings, writeAppSettings } from "../engine/app-settings.ts";
import { getPinextPaths } from "../engine/paths.ts";
import { log } from "../engine/logger.ts";
import type { WebServerState } from "../../shared/web-server.ts";

/**
 * 独立的 web 端：一个只服务浏览器客户端的监听器，**自己一个端口、自己启停**。
 *
 * 为什么和「远程访问」那个不是一回事，值得写清楚：那个监听器是**手机 App 的入口**
 * （`/api/login` 换设备令牌、`/ws` 收事件流），它的存在与否由「手机要不要连」决定。
 * 这个只是「在浏览器里打开同一个工作台」，凭据是**同一套**（同一份 remote-access.json），
 * 但端口、开关、生命周期都独立 —— 用户要的是「我想开就开、想关就关，不牵连手机那条路」。
 *
 * 复用的是**同一个 `RemoteServer`**：同源规则、policy、capability 都不该有第二份实现。
 * 所以这里只做三件事：记住端口与开关、按它起一个实例、把状态报出来。
 */

const DEFAULT_WEB_PORT = 7800;

export type { WebServerState } from "../../shared/web-server.ts";

type Stored = { webServerEnabled?: boolean; webServerPort?: number };

let server: RemoteServer | null = null;
let lastError: string | undefined;

function stored(): Stored {
  const settings = readAppSettings(getPinextPaths()) as Record<string, unknown>;
  return {
    webServerEnabled: settings.webServerEnabled === true,
    webServerPort: typeof settings.webServerPort === "number" ? settings.webServerPort : DEFAULT_WEB_PORT,
  };
}

function persist(patch: Stored): void {
  const paths = getPinextPaths();
  writeAppSettings(paths, { ...readAppSettings(paths), ...patch });
}

/** 端口合法性：1024 以下要 root，65535 以上不存在，其余照单全收。 */
function normalizePort(value: unknown): number {
  const port = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : DEFAULT_WEB_PORT;
  return port >= 1024 && port <= 65535 ? port : DEFAULT_WEB_PORT;
}

function localUrls(port: number): string {
  return `http://127.0.0.1:${port}/`;
}

/**
 * The one instance, built the same way the remote listener is.
 *
 * `webRoot` is what makes it a *web* server rather than an API endpoint: the same renderer
 * bundle the desktop window loads, served over HTTP so a browser has a page at all.
 */
function createServer(): RemoteServer {
  const paths = getPinextPaths();
  const webRoot = builtWebRoot(process.env.PINEXT_WEB_ROOT ?? process.cwd());
  if (!existsSync(webRoot)) {
    // 明说，而不是起一个只能回 JSON 404 的监听器 —— 那看起来像「服务器坏了」。
    throw new Error(`找不到 web 产物：${webRoot}（先跑一次构建）`);
  }
  return new RemoteServer({
    accessFile: paths.remoteAccessFile,
    channels: () => [],
    policyScope: "full",
    dispatch: async () => {
      throw new Error("web 端只服务页面与 App Protocol，不接单次调用");
    },
    subscribe: () => () => undefined,
    webRoot,
    log: {
      info: (message) => log.info(`[web] ${message}`),
      warn: (message) => log.warn(`[web] ${message}`),
      error: (message, error) => log.error(`[web] ${message}`, error),
    },
  });
}

export function webServerState(): WebServerState {
  const { webServerEnabled, webServerPort } = stored();
  return {
    enabled: webServerEnabled === true,
    port: normalizePort(webServerPort),
    running: server !== null,
    ...(server ? { url: localUrls(normalizePort(webServerPort)) } : {}),
    ...(lastError ? { error: lastError } : {}),
  };
}

export async function startWebServer(): Promise<WebServerState> {
  const { webServerPort } = stored();
  const port = normalizePort(webServerPort);
  persist({ webServerEnabled: true, webServerPort: port });
  if (server) return webServerState();
  lastError = undefined;
  try {
    const instance = createServer();
    // 只听 loopback：这是「我本机浏览器打开」，不是又一条对外入口 —— 对外那条是
    // 远程访问监听器的事，它有它自己的令牌与闸门。
    await instance.start({ port, host: "127.0.0.1" });
    server = instance;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    log.warn(`[web] 启动失败：${lastError}`);
  }
  return webServerState();
}

export async function stopWebServer(): Promise<WebServerState> {
  persist({ webServerEnabled: false });
  if (server) {
    await server.stop();
    server = null;
  }
  lastError = undefined;
  return webServerState();
}

export function setWebServerPort(port: unknown): WebServerState {
  const next = normalizePort(port);
  persist({ webServerPort: next });
  return webServerState();
}

/** 开机时按存下来的开关自动拉起。只打日志、不抛。 */
export async function startWebServerIfEnabled(): Promise<void> {
  if (stored().webServerEnabled !== true) return;
  await startWebServer();
}
