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
import type { McpServerConfig, McpTransportFactory, PiSdkInternals } from "./pi-sdk-internals";

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
