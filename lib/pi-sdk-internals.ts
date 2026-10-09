/**
 * fork:pr11-mcp — 按 file URL 加载 pi SDK **没有导出** 的 MCP 内部模块。
 *
 * 上游依据：`85f9cb1`（上游 `lib/pi-sdk-internals.ts`，442 行）
 *          + 上游 `docs/adr/0006-mcp-and-code-mode.md`。
 *
 * pi 0.99 起自带 `mcp` / `codemode` / `tool-search` 三个内置扩展，当时**包不导出它们**：
 * SDK 根只给 `createMcpExtension` 一个工厂，扩展清单、mcp.json 编辑器、连接类
 * `McpServerConnection`、stdio transport 和 OAuth 登录助手全是未导出的内部件
 * （ADR 0006 原文）。这里按文件 URL 从**本进程正在用的那份 SDK** 里把它们取出来，
 * 这样 SDK 内部的 `instanceof` 检查看到的正是我们构造出来的类。
 *
 * fork:mcp-native-exposure（2026-10-02）—— **1.0 把前提改了一半**：
 *   · `createCodemodeExtension` / `createToolSearchExtension` **公开导出了**（`dist/index.d.ts:29,33`），
 *     所以这两个扩展现在由本仓**正常注册**（`mcpDiscoveryExtensionEntries()`），不再走
 *     内部件；本文件只剩 `mcp` 扩展的内部件（连接类 / mcp.json 编辑器 / OAuth 助手）要偷。
 *   · 类型也公开导出了（`LoadedMcpConfig` / `McpServerConfig` / `McpExposure` / `McpServerEntry` /
 *     `ToolExposure`，`dist/index.d.ts:8,11,31`），下面手写的那份可以逐步退役（P1）。
 *   · exposure 不再无条件降级：会话里有了 codemode / tool_search，pi 的原生曝光
 *     （默认 `codemode`、脚本里 `searchTools`、`deferred` 走 `tool_search`）就能用；
 *     SDK 拿不到这两个导出时**自动退回**降级（见 `normalizeMcpConfigForPiWeb`）。
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
import {
  createCooldownGatedTransportFactory,
  createMcpSessionLivenessGate,
  createPiNextMcpTransportFactory,
  createSessionGatedTransportFactory,
  type McpSessionLivenessGate,
} from "./mcp-transport";
import { createMcpFailureCooldown } from "./mcp-catalog";
import { resolveCatalogCredentialEnvironment } from "./mcp-catalog-credentials";

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

/** pi-mcp 的 transport：SDK 根不导出，MCP 连接只认这个形状（含返回退订函数的监听器）。 */
export interface McpTransport {
  start(): Promise<void>;
  send(message: unknown): Promise<void>;
  close(): Promise<void>;
  onMessage(listener: (message: unknown) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  onClose(listener: () => void): () => void;
  /** pi-mcp 连接成功后会回填协议版本；旧 transport 可以不实现。 */
  setProtocolVersion?(version: string): void;
}

export type McpTransportFactory = (
  entry: McpServerEntry,
  cwd: string,
  authProvider: unknown,
) => McpTransport;

// fork:mcp-native-exposure —— 这四个类型 **1.0 起从 SDK 根公开导出**
// （`dist/index.d.ts:31`），所以下面不再手写一份。手写那份（0.99 时代）缺了
// `auth.provider` 与 `description`，本轮就是它先把 `auth` 报成了不存在。
//
// `McpExposure` 有一点差别：SDK 的类型是 `"codemode" | "deferred" | "direct" | "hidden"`，
// **不含** `codemode-deferred`（那是 pi 接受、但不在类型里的别名）。所以下面在导出之上
// 叠一个 `McpExposureLike`：读**用户写的配置**时用得上别名，写回去之前会归一成
// `McpExposure`（`normalizeExposureAlias`）。
import type {
  LoadedMcpConfig,
  McpExposure,
  McpServerConfig,
  McpServerEntry,
} from "@earendil-works/pi-coding-agent";

export type { LoadedMcpConfig, McpExposure, McpServerConfig, McpServerEntry };

/** 用户配置里可能出现的 exposure（含 pi 接受的 `codemode-deferred` 别名）。 */
export type McpExposureLike = McpExposure | "codemode-deferred";

/** `/mcp` 面板会改的设置；`enabled: true` 与 `exposure: "codemode"` 会删掉这个键。
 *  SDK 从 `extensions/mcp/config` 子路径导出它、根上不导出，所以这份仍手写
 *  （两个字段，形状照 `config.d.ts:56-59`）。 */
export interface McpServerConfigPatch {
  enabled?: boolean;
  exposure?: McpExposureLike;
}

/** 0.99 的 `McpOAuthCredentialStore`：每个 server 的状态存在 agent 目录的 `mcp-auth.json`。 */
export interface McpOAuthCredentialStore {
  forServer(name: string, serverUrl: string): McpOAuthServerStore;
  /** 存下来的 token，用来发现别的进程完成的登录。 */
  tokens(name: string, serverUrl: string): unknown;
  /** 之前是否真的存过这个 server 的凭据（按 name + URL 键控）。 */
  remove(name: string, serverUrl: string): boolean;
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
  /** 动态注册时发的 `client_name`。 */
  clientName?: string;
  /** fork:pi-1.1 —— pi 1.0.1 新增：`dcr`（动态注册，默认）或 `cimd`（pi 自己的 Client ID Metadata Document）。 */
  clientRegistration?: "dcr" | "cimd";
  /** 覆盖授权服务器元数据地址。 */
  authServerMetadataUrl?: URL;
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
  /** 上一次 stdio 服务器连不上时它写出来的 stderr 尾巴（真连测试要拿它，且必须先掩码）。 */
  stderrTail?: string;
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
  /** fork:pi-1.1 —— 任何一步取消/超时都会以 `McpSignInCancelledError` 中止登录（pi 1.1）。 */
  signal?: AbortSignal;
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
  /** fork:pi-1.1 —— 带 `override` 时，缺失的条目会作为项目覆盖写入（pi 1.0.1）。 */
  updateMcpServerConfig: (path: string, name: string, patch: McpServerConfigPatch, options?: { override?: boolean }) => void;
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
  /**
   * fork:mcp-auto-reload / P0-3 —— pi 1.0 新增：`/mcp` 管理器改了 `enabled` / `exposure`
   * 之后的落盘钩子。不传则 pi 自己改文件（本仓改了就绕开 0600 + staging 原子写）。
   * `entry.scope === "extension"` 的条目按 pi 的约定不落盘。
   */
  updateConfig?: (entry: McpServerEntry, patch: McpServerConfigPatch) => void;
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

/**
 * fork:mcp-native-exposure —— codemode / tool_search 两个内置扩展的工厂。
 *
 * 1.0 起它们**公开导出**（`dist/index.d.ts:29` `createCodemodeExtension`、
 * `:33` `createToolSearchExtension`），所以本仓可以自己注册，不再需要绕过 pi 去加载
 * 内部件。仍然按 `sdkCreateMcpExtension` 那套写法取（可能不存在就返回 undefined）：
 * 类型引用不写死，SDK 不带这两个导出时本仓安静地不注册。
 */
function sdkCreateCodemodeExtension(): (() => piSdk.ExtensionFactory) | undefined {
  const candidate = (piSdk as { createCodemodeExtension?: unknown }).createCodemodeExtension;
  return typeof candidate === "function" ? (candidate as () => piSdk.ExtensionFactory) : undefined;
}

function sdkCreateToolSearchExtension(): (() => piSdk.ExtensionFactory) | undefined {
  const candidate = (piSdk as { createToolSearchExtension?: unknown }).createToolSearchExtension;
  return typeof candidate === "function" ? (candidate as () => piSdk.ExtensionFactory) : undefined;
}

/**
 * codemode / tool_search 是否真的注册进了会话（1.0 起才有）。false 时 loadConfig 退回
 * exposure 降级 —— 详见 normalizeMcpConfigForPiWeb 的 `nativeExposure`。
 */
const hasDiscoveryExtensions = Boolean(sdkCreateCodemodeExtension() && sdkCreateToolSearchExtension());

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

/** `session_start` 的 ctx 里本仓接线要用的那部分（不 import SDK 的 ExtensionContext 类型）。 */
export interface PiWebExtensionContext {
  cwd: string;
  projectTrusted: boolean;
  sessionId: string;
  sessionFile?: string;
}

/** 从扩展 ctx 里取 cwd / 项目信任 / 会话身份；取不到就退到安全默认值。 */
export function extensionContextFromPiContext(ctx: unknown): PiWebExtensionContext {
  const value = isRecord(ctx) ? ctx : {};
  const cwd = typeof value.cwd === "string" && value.cwd ? value.cwd : process.cwd();
  const isProjectTrusted = value.isProjectTrusted;
  let projectTrusted = false;
  if (typeof isProjectTrusted === "function") {
    try {
      projectTrusted = (isProjectTrusted as () => unknown).call(value) === true;
    } catch {
      projectTrusted = false;
    }
  }
  const manager = isRecord(value.sessionManager) ? value.sessionManager : {};
  const getSessionId = manager.getSessionId;
  let sessionId = "";
  if (typeof getSessionId === "function") {
    try {
      sessionId = String((getSessionId as () => unknown).call(manager) ?? "");
    } catch {
      sessionId = "";
    }
  }
  const getSessionFile = manager.getSessionFile;
  let fileValue: unknown;
  if (typeof getSessionFile === "function") {
    try {
      fileValue = (getSessionFile as () => unknown).call(manager);
    } catch {
      fileValue = undefined;
    }
  }
  return {
    cwd,
    projectTrusted,
    sessionId,
    sessionFile: typeof fileValue === "string" && fileValue ? fileValue : undefined,
  };
}

/**
 * fork:mcp-native-exposure —— pi 的 exposure **别名**：老配置里写
 * `codemode-deferred`，pi 接受它但类型里只有 `codemode`（`core/mcp-servers.d.ts:12`，
 * 注释写明 "codemode-deferred is accepted as an alias"）。所以只归一别名，不改语义。
 *
 * 以前这里是 `codemode` / `deferred` → `direct` 的**降级**（"pi-web 没有 codemode /
 * tool-search，没人能调到"）。1.0 起 `createCodemodeExtension` / `createToolSearchExtension`
 * 已公开导出（`dist/index.d.ts:29,33`），那两个扩展现在由本仓注册（见
 * `mcpDiscoveryExtensionEntries`），所以降级的前提没了，撤掉。
 */
function normalizeExposureAlias(exposure: McpExposureLike | undefined): McpExposure | undefined {
  return exposure === "codemode-deferred" ? "codemode" : exposure;
}

/**
 * pi 1.0 的 `isEnabled` 只看 `enabled !== false`（`dist/extensions/mcp/index.js`）；
 * 旧版 pi.web 写的 `disabled` 它完全不认。UI（route 的 `serverInfoFromDef`）与运行时
 * 都从这里取判定，两边必须同源。
 */
export function isMcpServerEnabled(config: McpServerConfig): boolean {
  const value = config as unknown as { enabled?: unknown; disabled?: unknown };
  return value.enabled !== false && value.disabled !== true;
}

/**
 * pi 的 `loadMcpConfig` 会把 JSON.parse 的原始报错塞进 `errors`（config.js 把
 * `${path}: ${error.message}` 推入），而 V8 的报错**会引用文件内容**（env / header
 * 里的秘密）。这个清洗与 HTTP 路径（`lib/mcp-config-file.ts`）共用，任何路径下
 * parser 原文都不进浏览器。
 *
 * 判定方式不依赖重读文件（无 TOCTOU）：只放行 pi 已知的安全错误形状
 * （校验 / 信封 / 顶层开关），其余一律归为 `malformed JSON`。
 */
const SAFE_MCP_CONFIG_ERROR_DETAILS = [
  "server ",
  "invalid server name",
  "autoEnableCodemode ",
  "expected an object",
];

export function sanitizeMcpConfigErrors(files: string[], errors: string[]): string[] {
  return errors.map((error) => {
    const file = files.find((candidate) => error.startsWith(`${candidate}:`));
    if (!file) return error;
    const detail = error.slice(file.length + 1).trimStart();
    if (SAFE_MCP_CONFIG_ERROR_DETAILS.some((prefix) => detail.startsWith(prefix))) return error;
    return `${file}: malformed JSON`;
  });
}

/**
 * pi-web 运行时对 `loadMcpConfig` 结果的适配：
 * - **exposure 原样透传**（fork:mcp-native-exposure，2026-10-02）。以前这里是
 *   `codemode` / `deferred` → `direct` 的降级，理由是「pi-web 没注册 codemode /
 *   tool-search，那些工具没人能调到」。1.0 把两个扩展公开导出了（`dist/index.d.ts:29,33`），
 *   本仓在 `mcpDiscoveryExtensionEntries()` 里注册，mcp 扩展会在需要时自动激活它们
 *   （`extensions/mcp/index.js:352-378`），所以降级的前提已经不存在。
 *   现在只归一别名 `codemode-deferred` → `codemode`，`hidden` 保持隐藏。
 * - 旧版 pi.web 的 `disabled: true` 折成 pi 的 `enabled: false` 并删掉 `disabled`：
 *   SDK 的 `isEnabled` 不认 `disabled`，不在运行时出口折的话用户关掉的 server 会被连上。
 * - errors 过 `sanitizeMcpConfigErrors`（解析原文不进扩展通知/浏览器）。
 */
/**
 * `nativeExposure`：会话里**注册了** codemode / tool_search（pi 1.0 起 `mcpDiscoveryExtensionEntries()`
 * 才拿得到它们）。true = exposure 原样透传；false = 退回 2026-10-02 之前的降级
 * （`codemode` / `deferred` → `direct`），因为那时没人能调到这两个曝光的工具。
 *
 * 也就是说：**降级还留着，只是不再无条件发生** —— SDK 不带这两个导出时（本仓历史上有过
 * 0.87 / 0.99）行为与之前完全一致。
 */
export function normalizeMcpConfigForPiWeb(
  loaded: LoadedMcpConfig,
  options: { nativeExposure?: boolean } = {},
): LoadedMcpConfig {
  const nativeExposure = options.nativeExposure ?? true;
  return {
    ...loaded,
    servers: loaded.servers.map((entry) => {
      const config = { ...entry.config } as McpServerConfig & { disabled?: unknown };
      const pick = (value: McpExposure | undefined): McpExposure | undefined => {
        const aliased = normalizeExposureAlias(value);
        if (nativeExposure) return aliased;
        return aliased === "codemode" || aliased === "deferred" ? "direct" : aliased;
      };
      const exposure = pick(config.exposure);
      // 不声明时 pi 自己按默认值（codemode）处理；显式落一遍，免得不同 pi 版本改默认值时
      // 我们这边跟着漂。降级模式下「默认」要落成 direct（就是默认值本身的效果）。
      if (exposure) config.exposure = exposure;
      if (config.toolExposure) {
        config.toolExposure = Object.fromEntries(
          Object.entries(config.toolExposure).map(([tool, value]) => [tool, pick(value) ?? value]),
        );
      }
      if (!isMcpServerEnabled(config)) config.enabled = false;
      delete config.disabled;
      return { ...entry, config };
    }),
  };
}

/**
 * `lib/rpc-manager.ts` 的 `extensionFactories` 要加的那一条。
 *
 * 名字必须是 CLI 用的 `mcp`，`DefaultResourceLoader` 才把它当 `builtin:mcp` 资源解析：
 * `-builtin:mcp` / `--no-extensions` 能关掉，`pi config` 列得出来，第三方扩展注册
 * `/mcp` 时能让位（`replaceable`）。ADR 0006 的 Loading 决策。
 *
 * 传了 `internals`（rpc-manager 先 `await loadPiSdkInternals()`）才通电；不传时
 * 保持「关」的形状（空配置 + 一律抛错的 transport），契约测试与 SDK 不具备 MCP 的
 * 降级都靠它。
 *
 * ADR 0006 三个坑的处置：
 *   1. **fan-out**：`loadConfig` 总是返回真实配置，但 `createTransport` 外面包了
 *      `lib/session-liveness.ts` 的**浏览器 SSE 租约**闸门（`createMcpSessionLivenessGate`）：
 *      只有浏览器真的在看这个会话才构造 transport，stdio 进程才可能 spawn；
 *      切会话 `get_tools`、自动命名、SSE 预热这类没人看的 wrapper 永远等不到闸门放行，
 *      有后台委派工作但无 SSE 租约的 wrapper 也不算「在看」（详见闸门注释）。
 *      等待不设 deadline（超时后无法重连会静默不可用），由 `session_shutdown` 的
 *      dispose 中止并回收已创建的 transport。
 *   2. **stop**：`before_agent_start` 的 10s 等待用 `startupWaitMs: 0` 绕开——首个
 *      prompt 不阻塞；晚连上的 direct 工具在注册时激活，下一轮就进模型。
 *   3. **env**：`createTransport` 走 `lib/mcp-transport.ts` 的洗 env 工厂
 *      （`inheritEnv: false` + 洗过的环境 + server 自己声明的 env）；引用
 *      `PI_WEB_PASSWORD` 的条目在 SDK 解析任何值之前就拒。
 *
 * 另两个上游限制（远程部署才要紧）：OAuth 回调只听 `127.0.0.1`，
 * `.pi/mcp.json` 靠目录信任继承。
 */
export function mcpBuiltinExtensionEntries(
  internals?: PiSdkInternals,
  /**
   * fork:mcp-auto-reload / P0-3 —— 落 `/mcp` 管理器改出来的 patch。由调用方注入
   * （`rpc-manager.ts` 传 `applyMcpServerPatch`）而不是本模块 import `mcp-config-file`：
   * 那个模块反过来依赖本模块的 `requireInternals`，直接 import 会成环。
   */
  applyPatch?: (file: string, name: string, patch: McpServerConfigPatch) => Promise<void>,
): McpBuiltinExtension[] {
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

  const baseTransport = internals
    ? createCooldownGatedTransportFactory(
        createPiNextMcpTransportFactory(internals, {
          // fork:proma-46-mcp-catalog —— stdio 目录凭据只在启动命令未被改动时注入。
          resolveStdioCredentialEnvironment: resolveCatalogCredentialEnvironment,
        }),
        createMcpFailureCooldown(),
      )
    : (entry: McpServerEntry) => {
        throw new Error(
          `MCP server "${entry.name}": SDK 内部件未加载或不可用，洗 env 的 transport 工厂没有接上（见 lib/mcp-transport.ts）`,
        );
      };

  const factory: piSdk.ExtensionFactory = (pi) => {
    // 工厂按会话调用一次，所以闸门/会话身份放在这里：即使同一个 entry 被复用到
    // 多个会话，也不会拿错会话的租约。
    let gate: McpSessionLivenessGate | undefined;
    let identity: { sessionId: string; sessionFile?: string } = { sessionId: "" };
    const gateForThisSession = (): McpSessionLivenessGate => {
      gate ??= createMcpSessionLivenessGate({ sessionId: identity.sessionId });
      return gate;
    };
    const builtinFactory = createMcpExtension({
      loadConfig: internals
        ? (ctx: unknown) => {
            const context = extensionContextFromPiContext(ctx);
            identity = { sessionId: context.sessionId, sessionFile: context.sessionFile };
            const agentDir = piSdk.getAgentDir();
            const loaded = internals.loadMcpConfig({
              agentDir,
              cwd: context.cwd,
              projectTrusted: context.projectTrusted,
            });
            // 解析原文（会引用文件内容）绝不能随扩展通知进浏览器。
            return normalizeMcpConfigForPiWeb({
              ...loaded,
              errors: sanitizeMcpConfigErrors(
                [join(agentDir, "mcp.json"), join(context.cwd, ".pi", "mcp.json")],
                loaded.errors,
              ),
            }, { nativeExposure: hasDiscoveryExtensions });
          }
        : () => ({ servers: [], errors: [] }),
      // 首个 prompt 不等连接，Stop 始终按得动（ADR 0006 坑 2 的绕开）。
      startupWaitMs: 0,
      createTransport: (entry, cwd, authProvider) =>
        createSessionGatedTransportFactory(baseTransport, gateForThisSession())(entry, cwd, authProvider),
      // fork:mcp-auto-reload / P0-3 —— 接管 `/mcp` 管理器的落盘。没传时 pi 自己改
      // mcp.json，会绕过本仓的 0600 + staging rename（editMcpConfigFile）。
      // `entry.scope === "extension"` 的 server 是扩展注册来的，按 pi 的约定**不落盘**。
      // 钩子是同步的（返回 void），而本仓写入是 async：fire-and-forget，写失败只记日志，
      // 配置本身没被改坏（原子写要么成功要么原样）。
      updateConfig: (entry, patch) => {
        if (!applyPatch) return;
        if (entry.scope === "extension") return;
        const file = entry.source;
        if (!file) return;
        void applyPatch(file, entry.name, patch).catch((error) => {
          console.error(`MCP /mcp patch write failed for ${entry.name}:`, error);
        });
      },
    });
    // 会话关停：中止还在等活跃租约的连接尝试，绝不在会话死后补拉进程。
    pi.on("session_shutdown", () => gate?.dispose());
    return builtinFactory(pi);
  };
  return [
    {
      name: "mcp",
      factory,
      replaceable: true,
      builtin: true,
    },
  ];
}

/**
 * fork:mcp-native-exposure —— `codemode` + `tool_search` 两个内置扩展。
 *
 * 它们**注册但不激活**（`extensions/codemode/index.js` 与 `tool-search/index.js` 的头部
 * 注释：`registered inactive. Activate it with --tools, the defaultTools setting, or
 * setActiveTools()`）。真正激活它们的是 mcp 扩展：`session_start` 时它看配置里有没有
 * `codemode` / `deferred` 曝光的 server，有就把对应的工具加进 active 集合
 * （`dist/extensions/mcp/index.js:352-378`）。所以：
 *
 *   · 没有 MCP server 用这两种曝光时，这两枚工具**不出现在工具表里**（零开销）；
 *   · 有了才出现，而且 mcp 扩展会自己激活，不依赖我们的工具预设；
 *   · 它按**工具形状**识别（`tools.some(isCodemodeTool)`），所以第三方扩展注册同名工具
 *     不会被误认（pi 源码里那句 “Other extensions' tools of the same names cannot reach
 *     MCP tools, so never activate them”）。
 *
 * 名字与 CLI 一致（`builtin:codemode` / `builtin:tool-search`），于是 `-builtin:codemode`
 * / `--no-extensions` 也能像 CLI 一样关掉它们。SDK 不带这两个导出时返回空数组。
 */
export function mcpDiscoveryExtensionEntries(): McpBuiltinExtension[] {
  const entries: McpBuiltinExtension[] = [];
  const createCodemodeExtension = sdkCreateCodemodeExtension();
  if (createCodemodeExtension) {
    entries.push({
      name: "codemode",
      factory: createCodemodeExtension(),
      replaceable: true,
      builtin: true,
    });
  }
  const createToolSearchExtension = sdkCreateToolSearchExtension();
  if (createToolSearchExtension) {
    entries.push({
      name: "tool-search",
      factory: createToolSearchExtension(),
      replaceable: true,
      builtin: true,
    });
  }
  return entries;
}
