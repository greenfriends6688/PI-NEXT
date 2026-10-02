/**
 * fork:pr11-mcp — 按 file URL 加载 pi SDK **没有导出** 的 MCP 内部模块。
 *
 * 上游依据：`85f9cb1`（上游 `lib/pi-sdk-internals.ts`，442 行）
 *          + 上游 `docs/adr/0006-mcp-and-code-mode.md`。
 *
 * pi 0.99 起自带 `mcp` / `codemode` / `tool-search` 三个内置扩展，但**包不导出它们**：
 * SDK 根只给 `createMcpExtension` 一个工厂，扩展清单、mcp.json 编辑器、连接类
 * `McpServerConnection`、stdio transport 和 OAuth 登录助手全是未导出的内部件
 * （ADR 0006 原文）。这里按文件 URL 从**本进程正在用的那份 SDK** 里把它们取出来，
 * 这样 SDK 内部的 `instanceof` 检查看到的正是我们构造出来的类。
 *
 * 三道防线（都有测试，见 `lib/pi-sdk-internals.test.mjs`）：
 *   1. `PI_PACKAGE_DIR` 指向别处 → 拒绝（会让 `getPackageDir()` 跑到另一份 SDK 上，
 *      file URL 就会加载出第二份副本）；
 *   2. 本进程跑的 SDK 与按 cwd 解析到的 SDK realpath 不一致 → 拒绝；
 *   3. 内部模块里拿到的 `createMcpExtension` / `StdioTransport` 与根导出不是同一个
 *      实例（第二份 SDK 或第二份 pi-mcp）→ 拒绝。
 * SDK 升级只要挪了路径或改了导出名，`lib/pi-sdk-internals.test.mjs` 的契约测试先红；
 * 真到运行时也只是 MCP 带着一句原因关掉，而不是行为变味。
 *
 * 与上游的差异（本仓 SDK 锁 0.87，**没有 MCP**）：
 *   - 0.99 才有的类型（`McpServerConfig` / `McpTransportFactory` / …）**不能静态 import**，
 *     静态 import 一个不存在的命名导出在 ESM 里是 link 期错误，tsc 也会红。所以这些
 *     类型在本文件里按 0.99 的 `dist/**.d.ts` 手写一份，契约测试钉住它们。
 *   - `createMcpExtension` 从命名空间 import 上取（0.87 上是 `undefined`），并新增同步的
 *     能力探测 `detectMcpSdkSupport()`：0.87 上它给出「本 SDK 没有内置 MCP」的原因，
 *     而不是等到 import 内部文件才报 ERR_MODULE_NOT_FOUND。
 *   - 新增 `mcpBuiltinExtensionEntries()`：`lib/rpc-manager.ts` 的接线用，见该函数。
 *
 * 加载不到就永远是「关」：本仓**绝不**回退到 SDK 默认的 stdio transport（它会把整个
 * `process.env` 交给 MCP 子进程，含 `PI_WEB_PASSWORD`）。洗 env 的事在
 * `lib/mcp-transport.ts`。
 */

import * as piSdk from "@earendil-works/pi-coding-agent";
import { readFileSync, realpathSync } from "node:fs";
import { findPackageJSON } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SDK_PACKAGE = "@earendil-works/pi-coding-agent";
const MCP_PACKAGE = "@earendil-works/pi-mcp";

/** 第一个带内置 MCP 扩展的 SDK 版本（用来把「太老」的原因说清楚）。 */
const MCP_SDK_VERSION = "0.99";

/** 内部模块在 SDK 包里的路径。改这里之前先看契约测试。 */
const SDK_MODULES = {
  mcpExtension: "dist/extensions/mcp/index.js",
  mcpRuntime: "dist/extensions/mcp/runtime.js",
  mcpConfig: "dist/extensions/mcp/config.js",
  mcpOAuth: "dist/extensions/mcp/oauth.js",
  mcpServers: "dist/core/mcp-servers.js",
  configValues: "dist/core/resolve-config-value.js",
} as const;

type SdkModuleName = keyof typeof SDK_MODULES | "mcpClient";
type MemberKind = "class" | "function";

/** 我们要用的内部件。缺一个、类型不对、或者模块挪了位置，都在这里变成一句原因。 */
const MEMBERS = {
  McpServerConnection: { module: "mcpRuntime", kind: "class" },
  createDefaultTransport: { module: "mcpRuntime", kind: "function" },
  StdioTransport: { module: "mcpClient", kind: "class" },
  loadMcpConfig: { module: "mcpConfig", kind: "function" },
  addMcpServerConfig: { module: "mcpConfig", kind: "function" },
  updateMcpServerConfig: { module: "mcpConfig", kind: "function" },
  removeMcpServerConfig: { module: "mcpConfig", kind: "function" },
  validateMcpServerConfig: { module: "mcpServers", kind: "function" },
  getMcpToolExposure: { module: "mcpServers", kind: "function" },
  signInMcpServer: { module: "mcpOAuth", kind: "function" },
  McpOAuthCredentialStore: { module: "mcpOAuth", kind: "class" },
  McpSignInCancelledError: { module: "mcpOAuth", kind: "class" },
  resolveConfigValueOrThrow: { module: "configValues", kind: "function" },
  resolveHeadersOrThrow: { module: "configValues", kind: "function" },
  getConfigValueEnvVarNames: { module: "configValues", kind: "function" },
  isCommandConfigValue: { module: "configValues", kind: "function" },
} as const satisfies Record<string, { module: SdkModuleName; kind: MemberKind }>;

// ───────────────────────── 0.99 的类型，在本文件里手写 ─────────────────────────
// 0.87 上这些类型不存在，静态 import 会让 tsc 直接红。改动它们之前先改契约测试。

/** pi-mcp 的 transport：SDK 根不导出，MCP 连接只认这个形状。 */
export interface McpTransport {
  start(): Promise<void>;
  send(message: unknown): Promise<void>;
  close(): Promise<void>;
  onMessage(listener: (message: unknown) => void): void;
  onError(listener: (error: Error) => void): void;
  onClose(listener: () => void): void;
}

export type McpTransportFactory = (
  entry: McpServerEntry,
  cwd: string,
  authProvider: unknown,
) => McpTransport;

export type McpExposure = "codemode" | "codemode-deferred" | "deferred" | "direct" | "hidden";

export interface McpServerConfigBase {
  /** 工具默认只对 codemode 可见（0.99 默认值）。 */
  exposure?: McpExposure;
  toolExposure?: Record<string, McpExposure>;
  /** false 时保留条目但不连接。 */
  enabled?: boolean;
  /** 单次请求超时（秒）。 */
  timeout?: number;
  name?: string;
}

export interface McpStdioServerConfig extends McpServerConfigBase {
  type?: "stdio";
  command: string;
  args?: string[];
  /** 值可以引用 `${NAME}` / `$NAME` / `!command`。 */
  env?: Record<string, string>;
  /** 相对路径按会话工作目录解析。 */
  cwd?: string;
}

/** 不支持动态注册的授权服务器用的 OAuth 客户端设置。 */
export interface McpOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  callbackPort?: number;
  /** 必须是 `localhost` / `127.0.0.1` / `[::1]` 上的 http URI。 */
  callbackUrl?: string;
  scope?: string;
}

export interface McpHttpServerConfig extends McpServerConfigBase {
  type?: "http";
  url: string;
  headers?: Record<string, string>;
  oauth?: McpOAuthConfig;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

export interface McpServerEntry {
  name: string;
  config: McpServerConfig;
  /** 定义它的配置文件路径，或注册它的扩展路径。 */
  source: string;
  /** `extension` = `pi.registerMcpServer()` 注册的 server，改动不落盘。 */
  scope?: "global" | "project" | "extension";
}

export interface LoadedMcpConfig {
  servers: McpServerEntry[];
  autoEnableCodemode?: boolean;
  errors: string[];
}

/** 0.99 的 `McpOAuthCredentialStore`：每个 server 的状态存在 agent 目录的 `mcp-auth.json`。 */
export interface McpOAuthCredentialStore {
  forServer(serverUrl: string): McpOAuthServerStore;
  /** 存下来的 token，用来发现别的进程完成的登录。 */
  tokens(serverUrl: string): unknown;
  /** 之前是否真的存过这个 server 的凭据。 */
  remove(serverUrl: string): boolean;
}

export interface McpOAuthServerStore {
  load(): Promise<unknown>;
  save(state: unknown): Promise<void>;
  tokens(): unknown;
  remove(): boolean;
  withRefreshLock<T>(fn: () => Promise<T>): Promise<T>;
}

/** 登录读写的状态（`McpOAuthServerStore` 的 `load` / `save` 这一对）。 */
export type McpOAuthStateStore = Pick<McpOAuthServerStore, "load" | "save">;

/** pi-mcp 的 `StdioTransportOptions`。 */
export interface StdioTransportOptions {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: Record<string, string>;
  inheritEnv?: boolean;
  stderr?: "pipe" | "inherit";
  onStderr?: (chunk: string) => void;
  maxMessageBytes?: number;
  maxStderrBytes?: number;
  /** SIGTERM 之后等多久再 SIGKILL。默认 2000。 */
  closeTimeoutMs?: number;
}

/** pi-mcp 的 `StdioTransport`。 */
export interface StdioTransport extends McpTransport {
  readonly options: Readonly<StdioTransportOptions>;
  readonly pid: number | undefined;
  readonly stderr: string;
}

/** server 在 `tools/list` 里报的 tool。 */
export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  execution?: { taskSupport?: "forbidden" | "optional" | "required" };
  _meta?: Record<string, unknown>;
}

export interface McpContentAnnotations {
  audience?: ("user" | "assistant")[];
  priority?: number;
  lastModified?: string;
}

export interface McpResource {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
  size?: number;
  annotations?: McpContentAnnotations;
  _meta?: Record<string, unknown>;
}

export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  annotations?: McpContentAnnotations;
  _meta?: Record<string, unknown>;
}

/** 从 server 的 `WWW-Authenticate` 头解析出来的 OAuth 挑战。 */
export interface McpOAuthChallenge {
  resourceMetadataUrl?: URL;
  scope?: string;
  error?: string;
  errorDescription?: string;
}

/** 0.99 的 `McpOAuthSettings`；`clientSecret` 已经解析过。 */
export interface McpOAuthSettings {
  clientId?: string;
  clientSecret?: string;
  callbackPort?: number;
  callbackUrl?: string;
  scope?: string;
}

/** pi-mcp 的 `McpClient` 里本仓要读的那部分。 */
export interface McpClient {
  readonly connectionState: "idle" | "connecting" | "connected" | "closed";
  readonly serverInfo: { name: string; version: string; title?: string } | undefined;
  readonly instructions: string | undefined;
  readonly protocolVersion: string | undefined;
  close(): Promise<void>;
}

export type McpServerState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "needs-auth"
  | "failed"
  | "closed";

export interface McpServerConnectionOptions {
  entry: McpServerEntry;
  cwd: string;
  createTransport: McpTransportFactory;
  credentials: McpOAuthCredentialStore;
  onTools: (connection: McpServerConnection) => void;
  /** `state` / `error` / `tools` 变化时调用。 */
  onChange?: (connection: McpServerConnection) => void;
}

/** 0.99 的 `McpServerConnection` 里本仓用到的那部分。 */
export interface McpServerConnection {
  readonly entry: McpServerEntry;
  state: McpServerState;
  error: string | undefined;
  tools: McpTool[];
  hasResources: boolean;
  resources: McpResource[];
  resourceTemplates: McpResourceTemplate[];
  /** `initialize` 带回来的服务器说明。 */
  instructions: string | undefined;
  challenge: McpOAuthChallenge | undefined;
  readonly name: string;
  readonly timeoutMs: number;
  readonly oauthUrl: string | undefined;
  oauthSettings(): McpOAuthSettings;
  getClient(): Promise<McpClient>;
  callTool(name: string, args: unknown, options: unknown): Promise<{ isError?: boolean; structuredContent?: unknown }>;
  reconnect(): Promise<void>;
  signOut(): Promise<void>;
  close(): Promise<void>;
}

export interface McpSignInPrompt {
  showAuthorizationUrl(url: URL): void;
  /**
   * 让用户从浏览器地址栏里抄回跳转 URL。loopback 回调到达即中止。
   * 用户取消时 resolve `undefined` 或空串。
   */
  promptForRedirectUrl(signal: AbortSignal): Promise<string | undefined>;
}

export interface McpSignInOptions {
  serverUrl: string;
  store: McpOAuthStateStore;
  settings: McpOAuthSettings;
  challenge?: McpOAuthChallenge;
  prompt: McpSignInPrompt;
}

/** `/mcp` 面板会改的设置；`enabled: true` 与 `exposure: "codemode"` 会删掉这个键。 */
export interface McpServerConfigPatch {
  enabled?: boolean;
  exposure?: McpExposure;
}

export interface PiSdkInternals {
  /** 内部件是从哪个 SDK 包的实路径加载的。 */
  packageDir: string;
  McpServerConnection: new (options: McpServerConnectionOptions) => McpServerConnection;
  createDefaultTransport: McpTransportFactory;
  /** `McpServerConnection` 认作 stdio transport 的那个类。 */
  StdioTransport: new (options: StdioTransportOptions) => StdioTransport;
  loadMcpConfig: (options: { agentDir: string; cwd: string; projectTrusted: boolean }) => LoadedMcpConfig;
  /** 同名条目被替换时返回 true。 */
  addMcpServerConfig: (path: string, name: string, config: McpServerConfig) => boolean;
  updateMcpServerConfig: (path: string, name: string, patch: McpServerConfigPatch) => void;
  /** 文件里没有这个 server 时返回 false。 */
  removeMcpServerConfig: (path: string, name: string) => boolean;
  /** 返回配置，或者一句错误。 */
  validateMcpServerConfig: (name: string, value: unknown) => McpServerConfig | string;
  getMcpToolExposure: (config: McpServerConfig, toolName: string) => McpExposure;
  signInMcpServer: (options: McpSignInOptions) => Promise<void>;
  McpOAuthCredentialStore: new () => McpOAuthCredentialStore;
  McpSignInCancelledError: new () => Error;
  resolveConfigValueOrThrow: (config: string, description: string, env?: Record<string, string>) => string;
  resolveHeadersOrThrow: (
    headers: Record<string, string> | undefined,
    description: string,
    env?: Record<string, string>,
  ) => Record<string, string> | undefined;
  /** `${NAME}` / `$NAME` 引用到的变量名；`!command` 值返回空。 */
  getConfigValueEnvVarNames: (config: string) => string[];
  isCommandConfigValue: (config: string) => boolean;
}

export type PiSdkInternalsResult = ({ ok: true } & PiSdkInternals) | { ok: false; reason: string };

/** 能力探测的结果：这份 SDK 有没有内置 MCP 扩展。 */
export type McpSdkSupport = {
  ok: true;
  /** 本进程正在跑的那份 SDK 的实路径。 */
  packageDir: string;
  version: string;
} | {
  ok: false;
  version: string;
  reason: string;
};

/** 0.99 的 `createMcpExtension(options)`；本仓只用到这三个选项。 */
type McpExtensionOptions = {
  /** 默认读 agent 目录与受信任项目的 `mcp.json`。 */
  loadConfig?: (ctx: unknown) => LoadedMcpConfig;
  /** 默认按配置自建 stdio / streamable HTTP transport。 */
  createTransport?: McpTransportFactory;
  /** 首次 prompt 时等还在连接的 server 多久（毫秒）。默认 10000。 */
  startupWaitMs?: number;
};

/**
 * 交给 `DefaultResourceLoader` 的内置扩展条目。0.99 的 `InlineExtension` 多了
 * `replaceable` / `builtin` 两个字段（0.87 的还没有），所以这里本地声明；
 * 多出来的字段对 0.87 的结构类型仍然是可赋值的，所以这份代码在 0.87 上也编译得过。
 */
export type McpBuiltinExtension = {
  /** 必须与 CLI 用的名字一致，`DefaultResourceLoader` 才按 `builtin:<name>` 解析。 */
  name: string;
  factory: piSdk.ExtensionFactory;
  /** 别的扩展注册了同名 tool/command/flag 时让位（例如第三方 MCP 扩展接管 `/mcp`）。 */
  replaceable: true;
  /** 作为 `builtin:mcp` 资源存在：`-builtin:mcp`、`--no-extensions` 能关掉它。 */
  builtin: true;
};

type LoadedModules = Record<SdkModuleName, Record<string, unknown>>;
/** 测试用的导入接缝：给一个文件路径，返回那个模块的命名空间。 */
type ModuleLoader = (path: string) => Promise<Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameRealPath(a: string, b: string): boolean {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isClass(value: unknown): boolean {
  return typeof value === "function" && /^class[\s{]/.test(Function.prototype.toString.call(value));
}

/** 命名空间 import 上那个 0.87 还没有的导出。 */
function sdkCreateMcpExtension(): ((options?: McpExtensionOptions) => piSdk.ExtensionFactory) | undefined {
  const candidate = (piSdk as { createMcpExtension?: unknown }).createMcpExtension;
  return typeof candidate === "function"
    ? (candidate as (options?: McpExtensionOptions) => piSdk.ExtensionFactory)
    : undefined;
}

/** 本进程用的 SDK 包的实路径。 */
function runningSdkPackageDir(): string {
  return realpathSync(piSdk.getPackageDir());
}

function sdkVersion(packageDir: string): string {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
    return isRecord(manifest) && typeof manifest.version === "string" ? manifest.version : "unknown";
  } catch {
    return "unknown";
  }
}

async function importFile(path: string): Promise<Record<string, unknown>> {
  // 运行期从 SDK 自己的文件里加载，绝不打包：打包进来会是另一份模块实例，
  // 它有自己的一套类，SDK 内部的 `instanceof` 全部对不上。
  return await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ pathToFileURL(path).href);
}

// Node 解析器对一次 `import` 默认打开的条件。
const IMPORT_CONDITIONS = new Set(["node", "import", "module-sync", "node-addons", "default"]);

/**
 * 条件导出里 `import` 会拿到的那个目标：按对象顺序第一个 own target 能解析的键
 * （Node 解析器就是这么挑的）。`null` 目标表示这个入口不存在。
 */
function conditionalTarget(target: unknown): string | null | undefined {
  if (typeof target === "string" || target === null) return target;
  const candidates = Array.isArray(target)
    ? target
    : isRecord(target)
      ? Object.entries(target).filter(([key]) => IMPORT_CONDITIONS.has(key)).map(([, value]) => value)
      : [];
  for (const candidate of candidates) {
    const resolved = conditionalTarget(candidate);
    if (resolved !== undefined) return resolved;
  }
  return undefined;
}

/** 一个包的 `exports`（或 `main`）给根 `import` 的 ESM 入口。 */
function packageImportEntry(manifest: unknown): string | undefined {
  if (!isRecord(manifest)) return undefined;
  const { exports } = manifest;
  if (exports === undefined) return typeof manifest.main === "string" ? manifest.main : "index.js";
  return conditionalTarget(isRecord(exports) && "." in exports ? exports["."] : exports) ?? undefined;
}

/**
 * pi-mcp 是 SDK 的依赖而不是我们的依赖，所以从导入它的那个 SDK 文件去解析：
 * 拿 runtime.js 实际用的那一份，不管 npm 把它嵌在 SDK 下面还是提到了上层。
 */
function resolveMcpClientEntry(packageDir: string): string {
  const importer = pathToFileURL(join(packageDir, SDK_MODULES.mcpRuntime)).href;
  const manifestPath = findPackageJSON(MCP_PACKAGE, importer);
  if (!manifestPath) throw new Error(`cannot resolve ${MCP_PACKAGE}`);
  const entry = packageImportEntry(JSON.parse(readFileSync(manifestPath, "utf8")));
  if (!entry) throw new Error(`${manifestPath} declares no import entry`);
  return join(manifestPath, "..", entry);
}

/** 按 cwd 解析到的 SDK 包，和本进程跑的那份必须一致。 */
function resolvedSdkPackageDir(cwd: string): string {
  // Next.js 用工程目录当 cwd 跑服务端，外部包也从工程内的构建产物解析，两边看到同一个包。
  const manifestPath = findPackageJSON(SDK_PACKAGE, pathToFileURL(join(cwd, "package.json")).href);
  if (!manifestPath) throw new Error(`cannot resolve ${SDK_PACKAGE} from ${cwd}`);
  return realpathSync(join(manifestPath, ".."));
}

/**
 * 同步能力探测：这份 SDK 有没有内置 MCP 扩展。
 *
 * 0.87 上整个 `dist/extensions/mcp/` 都不存在、根也不导出 `createMcpExtension`，
 * 于是这里直接给出原因——契约测试据此跳过，接线据此不注册，而不是等到运行时才炸。
 */
export function detectMcpSdkSupport(): McpSdkSupport {
  let packageDir: string;
  try {
    packageDir = runningSdkPackageDir();
  } catch (error) {
    return { ok: false, version: "unknown", reason: `cannot locate ${SDK_PACKAGE}: ${errorMessage(error)}` };
  }
  const version = sdkVersion(packageDir);
  const factory = sdkCreateMcpExtension();
  if (!factory) {
    return {
      ok: false,
      version,
      reason: `${SDK_PACKAGE} ${version} does not export createMcpExtension; the built-in MCP extension needs ${MCP_SDK_VERSION}.x`,
    };
  }
  const missing = Object.values(SDK_MODULES).find((path) => !existsInPackage(packageDir, path));
  if (missing !== undefined) {
    return {
      ok: false,
      version,
      reason: `${SDK_PACKAGE} ${version} has no ${missing}; the built-in MCP extension needs ${MCP_SDK_VERSION}.x`,
    };
  }
  return { ok: true, packageDir, version };
}

function existsInPackage(packageDir: string, relativePath: string): boolean {
  try {
    // realpath 一遍，顺手排掉断掉的软链（symlinked SDK 在 pnpm 布局下是常态）。
    realpathSync(join(packageDir, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function importSdkModules(
  packageDir: string,
  loadModule: ModuleLoader,
  resolveMcpClient: (packageDir: string) => string,
): Promise<LoadedModules | string> {
  const paths = {} as Record<SdkModuleName, string>;
  for (const [name, path] of Object.entries(SDK_MODULES)) {
    paths[name as Exclude<SdkModuleName, "mcpClient">] = join(packageDir, path);
  }
  try {
    paths.mcpClient = resolveMcpClient(packageDir);
  } catch (error) {
    return `${MCP_PACKAGE}: ${errorMessage(error)}`;
  }
  const modules = {} as LoadedModules;
  for (const [name, path] of Object.entries(paths) as [SdkModuleName, string][]) {
    try {
      modules[name] = await loadModule(path);
    } catch (error) {
      return `cannot load ${path}: ${errorMessage(error)}`;
    }
  }
  return modules;
}

function sdkMembers(modules: LoadedModules): Record<string, unknown> | string {
  const members: Record<string, unknown> = {};
  for (const [name, { module, kind }] of Object.entries(MEMBERS)) {
    const value = modules[module][name];
    // 槽位是函数时，类也算错：类不能直接调用，放进来只会在运行时才炸。
    if (kind === "class" ? !isClass(value) : typeof value !== "function" || isClass(value)) {
      const path = module === "mcpClient" ? MCP_PACKAGE : SDK_MODULES[module];
      return `${path} does not export ${name} as a ${kind}`;
    }
    members[name] = value;
  }
  return members;
}

/**
 * `McpServerConnection` 只有在 transport 是 runtime.js 自己 import 的那个
 * `StdioTransport` 实例时才读 server 的 stderr。构造 transport 不 spawn 任何进程。
 */
function sharesStdioTransport(internals: PiSdkInternals): boolean {
  const probe = internals.createDefaultTransport(
    { name: "pi-web-probe", config: { command: "pi-web-probe" }, source: "pi-web" },
    internals.packageDir,
    undefined,
  );
  return probe instanceof internals.StdioTransport;
}

/**
 * 加载 SDK 内部件，不走缓存。`environment` / `cwd` / `loadModule` / `resolveMcpClient`
 * 是给测试用的；服务端只用 `loadPiSdkInternals()`。
 */
export async function importPiSdkInternals(options: {
  environment?: NodeJS.ProcessEnv;
  cwd?: string;
  /** 测试用：替换按 file URL 的模块导入。 */
  loadModule?: ModuleLoader;
  /** 测试用：替换 pi-mcp 的解析。 */
  resolveMcpClient?: (packageDir: string) => string;
  /** 测试用：伪造 SDK 根上的 `createMcpExtension`，用来造出「第二份副本」。 */
  rootCreateMcpExtension?: unknown;
} = {}): Promise<PiSdkInternalsResult> {
  const { environment = process.env, cwd = process.cwd() } = options;
  const loadModule: ModuleLoader = options.loadModule ?? importFile;
  // PI_PACKAGE_DIR 会把 getPackageDir() 指到本进程没加载的那份 SDK，file URL 就成了第二份副本。
  if (environment.PI_PACKAGE_DIR) {
    return { ok: false, reason: `PI_PACKAGE_DIR is set; MCP support loads only from the ${SDK_PACKAGE} that PI NEXT runs` };
  }

  let packageDir: string;
  try {
    packageDir = runningSdkPackageDir();
    const resolvedDir = resolvedSdkPackageDir(cwd);
    if (!sameRealPath(packageDir, resolvedDir)) {
      return { ok: false, reason: `${SDK_PACKAGE} at ${packageDir} is not the package PI NEXT resolves (${resolvedDir})` };
    }
  } catch (error) {
    return { ok: false, reason: `cannot locate ${SDK_PACKAGE}: ${errorMessage(error)}` };
  }

  // 真实加载才做能力探测：测试用假模块时，这里要能继续走下去。
  if (!options.loadModule) {
    const support = detectMcpSdkSupport();
    if (!support.ok) return { ok: false, reason: support.reason };
  }

  const modules = await importSdkModules(
    packageDir,
    loadModule,
    options.resolveMcpClient ?? resolveMcpClientEntry,
  );
  if (typeof modules === "string") return { ok: false, reason: modules };
  // 本仓正常 import 的 SDK 根，必须和内部模块是同一个模块实例。根上根本没有这个
  // 导出时（本仓 0.87）没有可比的对象，那份 SDK 也没有 MCP 可加载。
  const rootCreateMcpExtension = "rootCreateMcpExtension" in options
    ? options.rootCreateMcpExtension
    : sdkCreateMcpExtension();
  if (rootCreateMcpExtension !== undefined && modules.mcpExtension.createMcpExtension !== rootCreateMcpExtension) {
    return { ok: false, reason: `${SDK_MODULES.mcpExtension} loaded as a second copy of ${SDK_PACKAGE}` };
  }
  const members = sdkMembers(modules);
  if (typeof members === "string") return { ok: false, reason: members };
  const internals = { packageDir, ...members } as PiSdkInternals;
  try {
    if (!sharesStdioTransport(internals)) {
      return { ok: false, reason: `${MCP_PACKAGE} resolved to another copy than ${SDK_MODULES.mcpRuntime} uses` };
    }
  } catch (error) {
    return { ok: false, reason: `${SDK_MODULES.mcpRuntime}: ${errorMessage(error)}` };
  }
  return { ok: true, ...internals };
}

// 路由处理器和 instrumentation 各自打成一个模块图，热重载还会重新求值本模块；
// globalThis 保证一个进程只加载一次。
const INTERNALS_KEY: symbol = Symbol.for("pi-web.piSdkInternals");

/**
 * 每个服务端进程加载一次 SDK 内部件。返回 `ok: false` 时 MCP 就是关的：
 * 本仓绝不去用那些会把服务端整个环境交给 MCP server 的默认 transport。
 */
export function loadPiSdkInternals(): Promise<PiSdkInternalsResult> {
  const store = globalThis as Record<symbol, Promise<PiSdkInternalsResult> | undefined>;
  return store[INTERNALS_KEY] ??= importPiSdkInternals().catch((error: unknown): PiSdkInternalsResult => ({
    ok: false,
    reason: errorMessage(error),
  }));
}

/** 缺 `createMcpExtension` 时只打一行，别在每个会话上刷屏。 */
let missingMcpSdkLogged = false;

/**
 * `lib/rpc-manager.ts` 的 `extensionFactories` 要加的那一条。
 *
 * 名字必须是 CLI 用的 `mcp`，`DefaultResourceLoader` 才把它当 `builtin:mcp` 资源解析：
 * `-builtin:mcp` / `--no-extensions` 能关掉，`pi config` 列得出来，第三方扩展注册
 * `/mcp` 时能让位（`replaceable`）。ADR 0006 的 Loading 决策。
 *
 * **为什么在 SDK 不具备 MCP 时返回空数组**：0.87 上没有 `createMcpExtension` 这个导出，
 * 硬接会让 tsc 直接红（静态命名 import 在 ESM 里是 link 期错误）。所以这里是能力探测：
 * 有才注册，没有就一行日志跳过，等 SDK 升到 0.99 自动生效。
 *
 * 三个坑（ADR 0006 全中，本轮只处理第三个）：
 *   1. **fan-out**：扩展在 `session_start` 上连**全部**启用的 server，而本仓每个 wrapper
 *      都会建（切会话 `get_tools`、自动命名、SSE 预热），浏览一个会话就把所有 stdio
 *      server 拉起来常驻。所以这里 `loadConfig` 返回空列表——`session_start` 不连任何
 *      server，那 10 秒的启动等待也不会上膛。真正的「会话要哪台 server 就连哪台」
 *      （每次用户 prompt 前比对配置指纹、只连变化的那几台）是 P1 的 `McpHost`。
 *   2. **stop**：`before_agent_start` 最多等 10s 且不理会 abort，这期间 Stop 按不动。
 *      同样因为现在不连 server 而不触发；`McpHost` 版本的等待必须自己认 abort。
 *   3. **env**：SDK 默认的 stdio transport 把整个 `process.env` 交给子进程，本仓的
 *      `PI_WEB_PASSWORD` 就在里面。这里**不做**回退：`createTransport` 一律抛错，
 *      直到 P1 把 `lib/mcp-transport.ts` 的洗 env 工厂挂上来。宁可连不上，也不泄漏。
 *
 * 另外两个上游写死的限制（远程部署才要紧）：OAuth 回调只听 `127.0.0.1`，
 * `.pi/mcp.json` 靠目录信任继承（被信任的父目录会让子目录的条目直接开跑）。
 */
export function mcpBuiltinExtensionEntries(): McpBuiltinExtension[] {
  const createMcpExtension = sdkCreateMcpExtension();
  if (!createMcpExtension) {
    if (!missingMcpSdkLogged) {
      missingMcpSdkLogged = true;
      console.warn(
        `[mcp] builtin:mcp 未注册：${SDK_PACKAGE} ${sdkVersion(runningSdkPackageDir())} 不带内置 MCP 扩展（需要 ${MCP_SDK_VERSION}.x）`,
      );
    }
    return [];
  }
  return [
    {
      name: "mcp",
      factory: createMcpExtension({
        loadConfig: () => ({ servers: [], errors: [] }),
        createTransport: (entry) => {
          throw new Error(
            `MCP server "${entry.name}": 洗 env 的 transport 工厂还没接上（见 lib/mcp-transport.ts）`,
          );
        },
      }),
      replaceable: true,
      builtin: true,
    },
  ];
}
