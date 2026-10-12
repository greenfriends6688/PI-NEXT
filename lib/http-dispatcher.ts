import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as undici from "undici";
import { readRegularFileText } from "./regular-file";

export const DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000;

type DispatcherGlobal = typeof globalThis & {
  __piWebHttpDispatcherConfigured?: boolean;
};

const dispatcherGlobal = globalThis as DispatcherGlobal;
const originalGlobalFetch = globalThis.fetch;
const ignoreUndiciDispatcherError = (): void => {};

function parseHttpIdleTimeoutMs(value: unknown): number | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.toLowerCase() === "disabled") return 0;
    if (trimmed.length === 0) return undefined;
    return parseHttpIdleTimeoutMs(Number(trimmed));
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.floor(value);
}

/**
 * fork:upstream-0.12-infra —— settings 的 httpIdleTimeoutMs 也作用于 Web UI（#1127）。
 *
 * 与 pi 的 `getAgentDir()` 同规则解析 agent 目录；这里不 import SDK，因为本模块跑在
 * Next instrumentation 里，import SDK 约要一秒，而 undici 只要十分之一。
 */
export function defaultAgentDir(): string {
  let configured = process.env.PI_CODING_AGENT_DIR;
  if (!configured) return join(homedir(), ".pi", "agent");

  if (process.platform === "win32") configured = windowsShellPath(configured);
  if (configured === "~") return homedir();
  if (configured.startsWith("~/") || (process.platform === "win32" && configured.startsWith("~\\"))) {
    return join(homedir(), configured.slice(2));
  }
  if (/^file:\/\//.test(configured)) return fileURLToPath(configured);
  return configured;
}

/** pi 的 normalizeWindowsShellPath()：`/c/x`、`/mnt/c/x`、`/cygdrive/c/x` → `C:\\x`。 */
function windowsShellPath(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return path;
  const match = path.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);
  if (!match) return path;
  return `${match[1].toUpperCase()}:\\${match[2]?.replaceAll("/", "\\") ?? ""}`;
}

/**
 * 按 pi CLI 的方式读全局 `httpIdleTimeoutMs`。只认全局文件：dispatcher 在启动时
 * 配置一次，那时还没有任何项目被选中，所以项目的 `.pi/settings.json` 不适用。
 * 文件缺失 / 解析失败 / 无键 / 值被 CLI 拒绝 → `undefined`，保留 dispatcher 默认值。
 */
export function readHttpIdleTimeoutMs(agentDir: string = defaultAgentDir()): number | undefined {
  let text: string | undefined;
  try {
    text = readRegularFileText(join(agentDir, "settings.json"));
  } catch {
    return undefined;
  }
  if (text === undefined) return undefined;

  let settings: unknown;
  try {
    settings = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return undefined;
  }
  if (typeof settings !== "object" || settings === null) return undefined;

  return parseHttpIdleTimeoutMs((settings as { httpIdleTimeoutMs?: unknown }).httpIdleTimeoutMs);
}

// Undici can emit an internal Client error while terminating a response body.
// The body stream still rejects; this prevents the EventEmitter error from
// terminating the Next.js process first.
function withUndiciErrorListener<T extends undici.Dispatcher>(dispatcher: T): T {
  if (dispatcher instanceof EventEmitter) {
    EventEmitter.prototype.on.call(dispatcher, "error", ignoreUndiciDispatcherError);
  }
  return dispatcher;
}

function createUndiciClient(origin: string | URL, options: object): undici.Dispatcher {
  return withUndiciErrorListener(
    new undici.Client(origin, options as undici.Client.Options),
  );
}

function createUndiciOriginDispatcher(origin: string | URL, options: object): undici.Dispatcher {
  const dispatcherOptions = options as undici.Pool.Options;
  if (dispatcherOptions.connections === 1) {
    return createUndiciClient(origin, dispatcherOptions);
  }

  return withUndiciErrorListener(
    new undici.Pool(origin, {
      ...dispatcherOptions,
      factory: createUndiciClient,
    }),
  );
}

export function configureHttpDispatcher(
  timeoutMs: number = DEFAULT_HTTP_IDLE_TIMEOUT_MS,
): void {
  if (dispatcherGlobal.__piWebHttpDispatcherConfigured) return;

  const normalizedTimeoutMs = parseHttpIdleTimeoutMs(timeoutMs);
  if (normalizedTimeoutMs === undefined) {
    throw new Error(`Invalid HTTP idle timeout: ${String(timeoutMs)}`);
  }

  const dispatcher = withUndiciErrorListener(
    new undici.EnvHttpProxyAgent({
      allowH2: false,
      bodyTimeout: normalizedTimeoutMs,
      headersTimeout: normalizedTimeoutMs,
      clientFactory: createUndiciClient,
      factory: createUndiciOriginDispatcher,
    }),
  );
  undici.setGlobalDispatcher(dispatcher);

  // Keep fetch and the dispatcher on the same undici implementation. Preserve
  // an intentional fetch override installed after this module was loaded.
  if (globalThis.fetch === originalGlobalFetch) {
    undici.install?.();
  }

  dispatcherGlobal.__piWebHttpDispatcherConfigured = true;
}
