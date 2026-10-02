/**
 * fork:pr11-mcp — MCP stdio transport 的 env 清洗。
 *
 * 上游依据：`85f9cb1`（上游 `lib/mcp-transport.ts`，113 行）
 *          + 上游 `docs/adr/0006-mcp-and-code-mode.md`（Safety → Environment）。
 *
 * pi 自带的 stdio transport 默认 `inheritEnv: true`，也就是把**整个** `process.env`
 * 交给 MCP 子进程。本仓的 `PI_WEB_PASSWORD`（浏览器登录口令，远程部署时是产品的命门）
 * 就在里面，于是这个工厂重建 transport：`inheritEnv: false` + 洗过的环境 + server 自己声明的
 * `env`。`lib/pi-sdk-internals.ts` 加载不到时 MCP 就是关的——**任何情况下都不回退**到
 * SDK 的默认 transport（`createDefaultTransport` 的返回值不是我们认识的 `StdioTransport`
 * 就直接抛错）。
 *
 * 与上游的差异：
 *   - 上游把 `PI_WEB_PASSWORD` 加进了 `lib/project-command-env.ts` 的
 *     `isHostRuntimeVariable()`；本仓那份没有（G7 密码网关尚未裁定，见
 *     `docs/upstream-alignment-plan-2026-10-01.md`），而本文件不在这次能改的范围里，
 *     所以这里自己再洗一遍。裁定 G7 时应与上游对齐（两处合成一处），别留两份名单。
 *   - `sanitizedMcpServerEnvironment()` 单独导出：洗 env 的规则要能在**没有 MCP 的
 *     SDK（0.87）**上被测到，契约测试才能在 SDK 具备 MCP 之前就守着这条线。
 */

import { sanitizeProjectCommandEnvironment } from "./project-command-env";
import { hasActiveSessionLivenessLease } from "./session-liveness";
import type { McpServerConfig, McpTransport, McpTransportFactory, PiSdkInternals } from "./pi-sdk-internals";

// MCP server 是替某个项目跑的，和它的 bash 命令算同一类：给项目 bash 命令的环境，
// 不给配置/守护这个 Next.js 进程的变量（ADR 0006「Safety → Environment」）。
const WEB_PASSWORD_VARIABLE = "PI_WEB_PASSWORD";

/**
 * 除了 `sanitizeProjectCommandEnvironment()` 已经洗掉的 `PORT` / `NODE_ENV` / `NEXT_*`，
 * 本仓还要额外洗掉的。本仓产品目前没有登录（`PI_WEB_PASSWORD` 不被读），但 G7 一旦
 * 裁定支持局域网/公网暴露，它就会重新变成真密码，所以名单先写死在这里。
 */
const EXTRA_HOST_ONLY_VARIABLES = [WEB_PASSWORD_VARIABLE];

type TransportInternals = Pick<
  PiSdkInternals,
  "createDefaultTransport" | "StdioTransport" | "getConfigValueEnvVarNames" | "isCommandConfigValue"
>;
type ConfigValueInternals = Pick<PiSdkInternals, "getConfigValueEnvVarNames" | "isCommandConfigValue">;

export interface PiNextMcpTransportOptions {
  /** stdio server 起进程时的环境基准（清洗之前）。默认在连接时读 `process.env`。 */
  baseEnvironment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

function isHostOnlyVariable(name: string, platform: NodeJS.Platform): boolean {
  const comparableName = platform === "win32" ? name.toUpperCase() : name;
  return EXTRA_HOST_ONLY_VARIABLES.some((variable) => comparableName === variable);
}

/** 本进程里已解析的 config 值：stdio 看 `env`，http 看 `headers` 和 `oauth.clientSecret`。 */
function resolvedConfigValues(config: McpServerConfig): [field: string, value: string][] {
  if (!("url" in config)) {
    return Object.entries(config.env ?? {}).map(([key, value]): [string, string] => [`env "${key}"`, value]);
  }
  const values = Object.entries(config.headers ?? {}).map(
    ([key, value]): [string, string] => [`header "${key}"`, value],
  );
  if (config.oauth?.clientSecret !== undefined) values.push(["oauth.clientSecret", config.oauth.clientSecret]);
  return values;
}

/**
 * 哪个字段的 `config` 值引用了 `PI_WEB_PASSWORD`，没有就 undefined。
 *
 * 值是按**本进程**的环境解析的（这个环境里还有密码），所以只把它从 server 的环境里
 * 删掉是不够的。名字按 Windows 的大小写不敏感规则比。`!command` 不带 `$` 引用也能
 * 直接读到那个变量，所以提到名字就算引用；这种值 SDK 仍是带着本进程整个环境跑的。
 */
export function findWebPasswordReference(
  config: McpServerConfig,
  internals: ConfigValueInternals,
): string | undefined {
  for (const [field, value] of resolvedConfigValues(config)) {
    const references = internals.isCommandConfigValue(value)
      ? value.toUpperCase().includes(WEB_PASSWORD_VARIABLE)
      : internals.getConfigValueEnvVarNames(value).some((name) => name.toUpperCase() === WEB_PASSWORD_VARIABLE);
    if (references) return field;
  }
  return undefined;
}

/**
 * 洗过的环境，上面再盖 server 自己声明的 `env`；Windows 上同名不同大小写会被替换。
 *
 * 纯函数，不依赖 SDK：契约测试在 0.87 上也能断言「`PI_WEB_PASSWORD` / `PORT` /
 * `NODE_ENV` / `NEXT_*` 都不在子进程环境里」。
 */
export function sanitizedMcpServerEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  configured: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const [name, value] of Object.entries(sanitizeProjectCommandEnvironment(baseEnvironment, platform))) {
    if (value !== undefined && !isHostOnlyVariable(name, platform)) environment[name] = value;
  }
  for (const [name, value] of Object.entries(configured)) {
    if (platform === "win32") {
      for (const existing of Object.keys(environment)) {
        if (existing.toUpperCase() === name.toUpperCase()) delete environment[existing];
      }
    }
    environment[name] = value;
  }
  return environment;
}

/**
 * 交给 SDK MCP 连接的 transport 工厂。
 *
 * http server 原样用 SDK 的 transport。stdio server 拿到「SDK 本该构造的那份
 * transport」——`~` 展开过的 command/args、按会话解析的 cwd、piped stderr、SDK 解析过的
 * `env` 值——但 `inheritEnv: false` + 洗过的环境重建一份。**绝不**回退到 SDK 的
 * stdio transport。
 */
export function createPiNextMcpTransportFactory(
  internals: TransportInternals,
  options: PiNextMcpTransportOptions = {},
): McpTransportFactory {
  const platform = options.platform ?? process.platform;
  return (entry, cwd, authProvider) => {
    const field = findWebPasswordReference(entry.config, internals);
    if (field) {
      throw new Error(`MCP server "${entry.name}" ${field} references ${WEB_PASSWORD_VARIABLE}, which PI NEXT does not pass to MCP servers`);
    }
    const transport = internals.createDefaultTransport(entry, cwd, authProvider);
    if ("url" in entry.config) return transport;
    if (!(transport instanceof internals.StdioTransport)) {
      throw new Error(`MCP server "${entry.name}": the SDK did not create a stdio transport`);
    }
    const { env: configured = {}, ...stdioOptions } = transport.options;
    // `env` 里只能有这条 entry 自己声明的值；多出来的说明是 SDK 塞进来的、我们没洗过的环境。
    const declared = new Set(Object.keys(entry.config.env ?? {}));
    const unexpected = Object.keys(configured).find((name) => !declared.has(name));
    if (unexpected !== undefined) {
      throw new Error(`MCP server "${entry.name}": the SDK set environment variable ${unexpected}, which its config does not declare`);
    }
    return new internals.StdioTransport({
      ...stdioOptions,
      env: sanitizedMcpServerEnvironment(options.baseEnvironment ?? process.env, configured, platform),
      inheritEnv: false,
    });
  };
}

// ─────────────────── fan-out 闸门：浏览器真的在看才准连 ───────────────────

const MCP_LIVENESS_POLL_MS = 250;

export interface McpSessionLivenessGate {
  /** 会话有**浏览器 SSE 租约**时 resolve；否则一直等；dispose 时 reject。 */
  waitForActive(): Promise<void>;
  /**
   * 登记一个已创建的内层 transport（含 connect 还没完成的）：dispose 时会被关掉。
   * 返回注销函数。
   */
  track(transport: McpTransport): () => void;
  /** 会话关停：中止所有等待、关闭已登记的 transport，此后不再放行任何连接。 */
  dispose(): void;
  readonly disposed: boolean;
}

export interface McpSessionLivenessGateOptions {
  sessionId: string;
  pollMs?: number;
  /** 单测接缝；默认只问浏览器 SSE 租约（`hasActiveSessionLivenessLease`）。 */
  isActive?: () => boolean;
}

/**
 * fan-out 的闸门（ADR 0006 坑 1）。pi 的扩展在 `session_start` 上连**全部**启用
 * server，而 pi-web 每个 wrapper 都会建（切会话 `get_tools`、自动命名、SSE 预热）；
 * 这里用空闲回收同一份租约表做门：只有浏览器真的在看这个会话（SSE 租约）时才放行，
 * 没人看的 wrapper 永远不 spawn。
 *
 * **只看 SSE 租约，不把委派工作算成「在看」**（`hasActiveSessionLivenessLease`
 * 而非 `hasActiveSessionLivenessProvider`）：空闲回收必须把后台子代理 run 算成忙，
 * 但那只是「别回收父会话」，不代表父 wrapper 该把全部 MCP server 拉起来；子代理自己
 * 的 wrapper 有它自己的会话与租约。
 *
 * 等待**不设 deadline**：超时后 lease 再出现也无法重连（SDK 只在 session_start 连一次），
 * 会把该会话本次生命周期内的 MCP 变成静默不可用。等待期间不持有任何进程，定时器
 * `unref()`；wrapper 真被回收时 `session_shutdown` 的 `dispose()` 会中止等待并关掉
 * 已登记的内层 transport。
 */
export function createMcpSessionLivenessGate(
  options: McpSessionLivenessGateOptions,
): McpSessionLivenessGate {
  const pollMs = options.pollMs ?? MCP_LIVENESS_POLL_MS;
  const isActive = options.isActive ?? (() => hasActiveSessionLivenessLease({ sessionId: options.sessionId }));
  let disposed = false;
  const waiters = new Set<{ reject: (error: Error) => void; timer: ReturnType<typeof setInterval> | undefined }>();
  const tracked = new Set<McpTransport>();
  const failAll = (error: Error): void => {
    for (const waiter of [...waiters]) {
      if (waiter.timer) clearInterval(waiter.timer);
      waiter.reject(error);
    }
    waiters.clear();
  };
  return {
    get disposed() {
      return disposed;
    },
    waitForActive() {
      if (disposed) return Promise.reject(new Error("MCP session ended before the server could start"));
      if (isActive()) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const waiter = { reject, timer: undefined as ReturnType<typeof setInterval> | undefined };
        waiter.timer = setInterval(() => {
          if (disposed) return;
          if (isActive()) {
            if (waiter.timer) clearInterval(waiter.timer);
            waiters.delete(waiter);
            resolve();
          }
        }, pollMs);
        (waiter.timer as unknown as { unref?: () => void }).unref?.();
        waiters.add(waiter);
      });
    },
    track(transport) {
      if (disposed) {
        void transport.close().catch(() => undefined);
        return () => {};
      }
      tracked.add(transport);
      return () => tracked.delete(transport);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      failAll(new Error("MCP session ended before the server could start"));
      for (const transport of [...tracked]) {
        tracked.delete(transport);
        // connect 还没完成的 transport 不会被 McpServerConnection.close() 摸到，
        // 所以这里必须由闸门自己关，子进程才不会活过会话。
        void transport.close().catch(() => undefined);
      }
    },
  };
}

/**
 * 在洗 env 的工厂外面再包一层闸门：`start()` 先等会话活跃，活跃后才构造真正的
 * transport（stdio 进程只在 `start()` 里 spawn）。等待期收到 close/dispose 就
 * 直接拒绝，绝不在会话死后补拉一个进程。
 */
export function createSessionGatedTransportFactory(
  inner: McpTransportFactory,
  gate: McpSessionLivenessGate,
): McpTransportFactory {
  return (entry, cwd, authProvider) =>
    new SessionGatedTransport(entry.name, () => inner(entry, cwd, authProvider), gate);
}

class SessionGatedTransport implements McpTransport {
  private inner: McpTransport | undefined;
  private untrack: (() => void) | undefined;
  private started = false;
  private closed = false;
  private protocolVersion: string | undefined;
  private readonly controller = new AbortController();
  private readonly messageListeners = new Map<(message: unknown) => void, () => void>();
  private readonly errorListeners = new Map<(error: Error) => void, () => void>();
  private readonly closeListeners = new Map<() => void, () => void>();

  constructor(
    private readonly serverName: string,
    private readonly createInner: () => McpTransport,
    private readonly gate: McpSessionLivenessGate,
  ) {}

  private closedError(): Error {
    return new Error(`MCP server "${this.serverName}" transport closed before it started`);
  }

  private sessionEndedError(): Error {
    return new Error(`MCP server "${this.serverName}" session ended before the transport started`);
  }

  private aborted(): Promise<never> {
    if (this.controller.signal.aborted) return Promise.reject(this.closedError());
    return new Promise((_, reject) => {
      this.controller.signal.addEventListener("abort", () => reject(this.closedError()), { once: true });
    });
  }

  async start(): Promise<void> {
    if (this.started) throw new Error("MCP transport already started");
    if (this.closed) throw this.closedError();
    this.started = true;
    await Promise.race([this.gate.waitForActive(), this.aborted()]);
    // 放行与 dispose/close 之间没有原子性：两边各查一次，任何一边关了就绝不构造内层。
    if (this.gate.disposed) throw this.sessionEndedError();
    if (this.closed) throw this.closedError();
    const inner = this.createInner();
    this.inner = inner;
    this.untrack = this.gate.track(inner);
    for (const [listener, dispose] of this.messageListeners) {
      dispose();
      this.messageListeners.set(listener, inner.onMessage(listener));
    }
    for (const [listener, dispose] of this.errorListeners) {
      dispose();
      this.errorListeners.set(listener, inner.onError(listener));
    }
    for (const [listener, dispose] of this.closeListeners) {
      dispose();
      this.closeListeners.set(listener, inner.onClose(listener));
    }
    if (this.protocolVersion !== undefined) inner.setProtocolVersion?.(this.protocolVersion);
    await inner.start();
  }

  async send(message: unknown): Promise<void> {
    if (!this.inner) throw new Error(`MCP server "${this.serverName}" transport has not started`);
    await this.inner.send(message);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    this.untrack?.();
    this.untrack = undefined;
    await this.inner?.close();
  }

  setProtocolVersion(version: string): void {
    this.protocolVersion = version;
    this.inner?.setProtocolVersion?.(version);
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.messageListeners.set(listener, this.inner?.onMessage(listener) ?? (() => {}));
    return () => {
      this.messageListeners.get(listener)?.();
      this.messageListeners.delete(listener);
    };
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.set(listener, this.inner?.onError(listener) ?? (() => {}));
    return () => {
      this.errorListeners.get(listener)?.();
      this.errorListeners.delete(listener);
    };
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.set(listener, this.inner?.onClose(listener) ?? (() => {}));
    return () => {
      this.closeListeners.get(listener)?.();
      this.closeListeners.delete(listener);
    };
  }
}
