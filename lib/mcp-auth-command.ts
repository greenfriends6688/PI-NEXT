/**
 * lib/mcp-auth-command.ts
 *
 * MCP OAuth entry points.
 *
 * 两条路径，互不重复实现 OAuth：
 * 1. **会话内（UI 用）**：`buildMcpAuthCommand` / `buildMcpLogoutCommand` 拼出
 *    用户在聊天输入框里执行的斜杠命令。pi 1.0 的内置 `mcp` 扩展注册了
 *    `/mcp login [server]` / `/mcp logout [server]`（依赖 `ctx.ui.input` 收
 *    callback URL），pi-web 的 RPC 模式桥接了 `extension_ui_input`，所以命令
 *    在本应用的会话里真的能跑。这里只负责把命令拼成安全的一行，不执行任何东西。
 * 2. **服务端（非 UI）**：`signInMcpServerWithPrompt` / `signOutMcpServerWithPrompt`
 *    直接调 pi 1.0 的 `signInMcpServer` + `McpOAuthCredentialStore`（
 *    `lib/pi-sdk-internals.ts` 加载）。凭证落在 `<agentDir>/mcp-auth.json`，
 *    与 CLI / 内置扩展共用。
 *
 * OAuth 回调边界：pi 的 callback server 只监听 `127.0.0.1`（`OAuthCallbackServer`，
 * 见 SDK `dist/extensions/mcp/oauth.js`）。本地开发没问题；**远程部署时浏览器
 * 的回跳地址必须能到这台机器**，否则只能走「把 callback URL 粘回来」的 prompt
 * 分支。本模块不假装解决这个。
 *
 * 安全边界：server name 是用户在 `mcp.json` 里可编辑的 JSON key，按不可信输入
 * 处理。换行/行分隔符会让「一条命令」变成「两条命令」，因此含控制字符的名字一律
 * 拒绝，而不是清洗成近似名字。
 */

import type { McpServerInfo } from "./api-types";
import {
  loadPiSdkInternals,
  type McpOAuthChallenge,
  type McpOAuthSettings,
  type McpServerConfig,
  type McpSignInPrompt,
  type PiSdkInternals,
} from "./pi-sdk-internals";

/**
 * 同时兼容仓库里已有的两种配置形状（只取传输判定需要的字段，不新造解析器）：
 * - `McpServerInfo`（lib/api-types.ts）：`/api/mcp` 返回、MCP 面板渲染的形状；
 * - pi 的 `McpServerConfig`：mcp.json 原始定义的形状（`url` 即 http）。
 */
export type McpAuthServerShape = {
  kind?: McpServerInfo["kind"];
  url?: McpServerInfo["url"];
  transport?: "stdio" | "http" | "sse";
};

/** 行终止符（含 U+2028/U+2029）与 C0/C1 控制字符：会破坏「单行命令」这个前提。 */
const UNSAFE_COMMAND_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

/**
 * 是否是 URL（HTTP/SSE）型 server —— 只有这类才可能走 OAuth 浏览器回调。
 *
 * 保守口径：stdio / socket 是本地进程，排除；必须存在非空且以 http(s) 开头的
 * `url`。无法从配置形状可靠判断 server 是否声明了 OAuth（`auth` 字段、自动探测
 * 都在扩展里），所以这里只按「远程 URL」放行。
 */
export function isRemoteMcpServer(server: McpAuthServerShape | null | undefined): boolean {
  if (!server || typeof server !== "object") return false;
  if (server.kind === "command" || server.kind === "socket") return false;
  if (server.transport === "stdio") return false;
  const url = typeof server.url === "string" ? server.url.trim() : "";
  return /^https?:\/\//i.test(url);
}

function buildCommand(prefix: string, serverName: unknown): string | null {
  if (typeof serverName !== "string" || !serverName) return null;
  // 换行/控制字符 = 可能夹带第二条斜杠命令，直接拒绝。
  if (UNSAFE_COMMAND_CHARS.test(serverName)) return null;
  // 扩展对参数 trim 后再查表，首尾空白的 key 用命令本来也寻址不到。
  if (serverName.trim() !== serverName) return null;
  return `${prefix} ${serverName}`;
}

/**
 * `/mcp login <server>` —— pi 1.0 内置 `mcp` 扩展的命令（取代 pi-mcp-adapter 的
 * `/mcp-auth`）。名字不可信/无法安全表示时返回 null，由 UI 隐藏入口。
 */
export function buildMcpAuthCommand(serverName: unknown): string | null {
  return buildCommand("/mcp login", serverName);
}

/**
 * `/mcp logout <server>` —— 内置扩展的 `/mcp` 子命令，清掉该 server 存在
 * `<agentDir>/mcp-auth.json` 的凭据。名字不可信/无法安全表示时返回 null。
 */
export function buildMcpLogoutCommand(serverName: unknown): string | null {
  return buildCommand("/mcp logout", serverName);
}

/** `signInMcpServer` / `McpOAuthCredentialStore` 那一小块内部件；单测注入假件。 */
export type McpAuthInternals = Pick<
  PiSdkInternals,
  "signInMcpServer" | "McpOAuthCredentialStore" | "McpSignInCancelledError" | "resolveConfigValueOrThrow"
>;

export interface McpServerSignInOptions {
  name: string;
  /** HTTP 型配置（`validateMcpServerConfig` 已校验过）。 */
  server: Extract<McpServerConfig, { url: string }>;
  /** 展示授权 URL / 收回跳 URL 的接缝；loopback 能直达时 prompt 分支不会被选中。 */
  prompt: McpSignInPrompt;
  challenge?: McpOAuthChallenge;
  /** 单测注入；生产走 `loadPiSdkInternals()`。 */
  internals?: McpAuthInternals;
}

export type McpSignInOutcome = { ok: true } | { ok: false; cancelled: boolean; error: string };

async function requireAuthInternals(injected?: McpAuthInternals): Promise<McpAuthInternals> {
  if (injected) return injected;
  const result = await loadPiSdkInternals();
  if (!result.ok) throw new Error(`MCP OAuth is unavailable: ${result.reason}`);
  return result;
}

/** `config.oauth` → `signInMcpServer` 的 settings（clientSecret 按 CLI 同规则解析）。 */
function oauthSettings(
  name: string,
  server: Extract<McpServerConfig, { url: string }>,
  internals: McpAuthInternals,
): McpOAuthSettings {
  const oauth = server.oauth;
  if (!oauth) return {};
  return {
    clientId: oauth.clientId,
    clientSecret: oauth.clientSecret === undefined
      ? undefined
      : internals.resolveConfigValueOrThrow(oauth.clientSecret, `MCP server "${name}" oauth.clientSecret`),
    callbackPort: oauth.callbackPort,
    callbackUrl: oauth.callbackUrl,
    scope: oauth.scope,
    clientName: oauth.clientName,
    authServerMetadataUrl: oauth.authServerMetadataUrl ? new URL(oauth.authServerMetadataUrl) : undefined,
  };
}

/**
 * Run pi's browser authorization-code flow for one server and persist the
 * credentials through `McpOAuthCredentialStore`. Never throws: a cancelled
 * flow is a normal outcome (the caller may keep a request open until it
 * returns).
 */
export async function signInMcpServerWithPrompt(
  options: McpServerSignInOptions,
): Promise<McpSignInOutcome> {
  let internals: McpAuthInternals;
  try {
    internals = await requireAuthInternals(options.internals);
  } catch (error) {
    return {
      ok: false,
      cancelled: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  try {
    const store = new internals.McpOAuthCredentialStore();
    await internals.signInMcpServer({
      serverUrl: options.server.url,
      store: store.forServer(options.name, options.server.url),
      settings: oauthSettings(options.name, options.server, internals),
      challenge: options.challenge,
      prompt: options.prompt,
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof internals.McpSignInCancelledError) {
      return { ok: false, cancelled: true, error: "Sign-in cancelled" };
    }
    return {
      ok: false,
      cancelled: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface McpServerSignOutOptions {
  name: string;
  url: string;
  internals?: McpAuthInternals;
}

/** Remove this server's stored credentials. Returns whether any were stored. */
export async function signOutMcpServerWithPrompt(
  options: McpServerSignOutOptions,
): Promise<boolean> {
  const internals = await requireAuthInternals(options.internals);
  return new internals.McpOAuthCredentialStore().remove(options.name, options.url);
}
