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

import {
  loadPiSdkInternals,
  type McpOAuthChallenge,
  type McpOAuthSettings,
  type McpServerConfig,
  type McpSignInPrompt,
  type PiSdkInternals,
} from "./pi-sdk-internals";

/**
 * **纯常量 / 纯函数的那一半在 `lib/mcp-auth-command-shared.ts`**（客户端面板要用）。
 *
 * 这里只留服务端那一半：`signInMcpServerWithPrompt` / `signOutMcpServerWithPrompt`
 * 走 `lib/pi-sdk-internals.ts` 加载的 pi 内部件。**客户端文件一律 import 上面那份 shared，
 * 不要 import 本模块** —— 那条 import 链会把整个 `@earendil-works/pi-coding-agent`
 * 拖进浏览器依赖图，`npm run build` 会直接红（`Module not found: Can't resolve 'fs'`）。
 * 下面这几行 re-export 只给服务端代码与既有单测用。
 */
export {
  buildMcpAuthCommand,
  buildMcpLogoutCommand,
  isRemoteMcpServer,
  type McpAuthServerShape,
} from "./mcp-auth-command-shared";


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
