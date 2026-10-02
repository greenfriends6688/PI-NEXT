// fork:pr11-mcp —— `lib/mcp-auth-command.ts` 的**纯常量 / 纯函数**部分。
//
// 为什么要拆：服务端那份要用 pi SDK 的内部件（`signInMcpServer` /
// `McpOAuthCredentialStore`，经 `lib/pi-sdk-internals.ts` 按 file URL 加载），
// 那条 import 链会把 `@earendil-works/pi-coding-agent` 整个拖进来（它内部
// `require("fs")` / `require("child_process")`），而面板
// `components/fork/McpConfig.tsx` 是 `"use client"` —— 于是 webpack 报
// `Module not found: Can't resolve 'fs'`，`npm run build` 直接红。
//
// 与 `lib/context-budget-settings-shared.ts` / `lib/retry-settings-shared.ts` 同一套办法：
// 客户端只需要「安全地拼一条斜杠命令」这件没有平台依赖的事。
//
// 安全边界（与拆之前逐字一致）：server name 是用户在 `mcp.json` 里可编辑的 JSON key，
// 按不可信输入处理。换行/行分隔符会把「一条命令」变成「两条命令」，因此含控制字符的
// 名字一律拒绝，而不是清洗成近似名字。

/**
 * 同时兼容仓库里已有的两种配置形状（只取传输判定需要的字段，不新造解析器）：
 * - `McpServerInfo`（lib/api-types.ts）：`/api/mcp` 返回、MCP 面板渲染的形状；
 * - pi 的 `McpServerConfig`：mcp.json 原始定义的形状（`url` 即 http）。
 */
export type McpAuthServerShape = {
  kind?: "command" | "url" | "socket";
  url?: string;
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
