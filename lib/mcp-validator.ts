/**
 * lib/mcp-validator.ts
 *
 * fork:pr11-mcp — 启用/保存前的配置校验，现在直接转发 pi 1.0 的
 * `validateMcpServerConfig` 原语（`lib/pi-sdk-internals.ts` 加载）。
 *
 * 语义变化（有意为之，见提交信息）：
 * - **不再真连一次**。旧实现手写 JSON-RPC，对候选 server 做 `initialize` +
 *   `tools/list` 握手；pi 的校验是**纯结构校验**，不建连接、不拉子进程。
 *   可连性由 pi 内置 `mcp` 扩展在会话启动后自己验证并上报状态。
 * - 因此 `ok: true` 的文案明确写「结构有效、未建立连接」，绝不把它当连通性；
 *   连不连得上要看会话里的 MCP 状态（`/mcp`）或真实连接。
 * - 返回 pi 校验后的配置副本：exposure 别名已归一（`codemode-deferred` →
 *   `codemode`），server 名必须匹配 `^[A-Za-z0-9_-]+$`，legacy SSE（`type: "sse"`）
 *   被 pi 拒绝，`url` 必须是 http(s)，stdio 只认 `command` / `args` / `env` / `cwd`。
 * - 这里返回的是机器可判定的一句话（`detail`），调用方决定怎么呈现；不再有
 *   HTTP / stdio 探测错误码（`connection-refused` / `timeout` / …）——那些是
 *   运行时连接的事，不是配置的事。
 *
 * 仓内不再手写任何 MCP JSON-RPC：握手、传输、OAuth 全部走 pi 内部件。
 */

import { loadPiSdkInternals, type McpServerConfig } from "./pi-sdk-internals";

export type { McpServerConfig } from "./pi-sdk-internals";

export type McpValidationError = "unsupported" | "invalid-config" | "protocol-error";

export interface McpValidationResult {
  ok: boolean;
  /** pi 校验后的配置副本（别名已归一）。`ok: true` 时总是存在。 */
  config?: McpServerConfig;
  error?: McpValidationError;
  /** 给 UI / 日志的一句话；失败时是 pi 的校验错误。 */
  detail: string;
}
function describeConfig(config: McpServerConfig): string {
  const target = "url" in config
    ? `${config.type ?? "http"} ${config.url}`
    : [config.command, ...(config.args ?? [])].join(" ");
  // 这里**不是**连通性结论：pi 的 validateMcpServerConfig 是纯结构校验，
  // 不建连接、不拉子进程。文案必须说清楚，否则连不上的 server 会被读成「能用」。
  return `Config is structurally valid; no connection was attempted (${target})`;
}

/**
 * Validate one server entry with pi's rules. Never throws: the SDK internals
 * being unavailable is reported as `unsupported`, exactly like an invalid config.
 *
 * fork:mcp-native-exposure（2026-10-02）—— pi 1.0 的 `validateMcpServerConfig` 本身已经很全
 * （exposure / toolExposure / timeout / description / legacy SSE / http(s) / oauth.* /
 * auth.provider 的 https 或 loopback 要求都在里面），所以这里**不再自己写一套**。
 * 本仓只补一条**它按定义看不到的规则**：项目级 `mcp.json` 不许用 `auth.provider` ——
 * 那是仓库内容，不该决定凭据发给哪个 provider（SDK 文档
 * `extensions/mcp/config.d.ts` 原文：「Project files cannot use it, so a repository
 * cannot pick where the credential goes.」）。pi 自己不做这条判断，因为它不知道这份
 * 配置是全局还是项目级。
 */
export async function validateMcpServer(
  name: string,
  raw: unknown,
  options: { scope?: "global" | "project" } = {},
): Promise<McpValidationResult> {
  try {
    const internals = await loadPiSdkInternals();
    if (!internals.ok) {
      return { ok: false, error: "unsupported", detail: internals.reason };
    }
    const result = internals.validateMcpServerConfig(name, raw);
    if (typeof result === "string") {
      return { ok: false, error: "invalid-config", detail: result };
    }
    // `auth` 只存在于 http 变体（McpHttpServerConfig），stdio 分支上不存在。
    const httpAuth = "url" in result ? result.auth : undefined;
    if (options.scope === "project" && isRecord(httpAuth) && typeof httpAuth.provider === "string") {
      return {
        ok: false,
        error: "invalid-config",
        detail: `server "${name}": auth.provider is not allowed in a project mcp.json `
          + "(a repository must not choose which provider credential is sent); use oauth, or move the server to the global scope",
      };
    }
    return { ok: true, config: result, detail: describeConfig(result) };
  } catch (error) {
    return {
      ok: false,
      error: "protocol-error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
