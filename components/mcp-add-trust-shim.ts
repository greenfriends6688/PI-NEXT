/**
 * fork:mcp-paste —— `mcp-add-helpers.ts` 里与「信任 / 文件问题 / 全局开关」有关的三个
 * 判断的**本仓实现**。
 *
 * 上游那三个函数住在 `components/mcp-config-helpers.ts`（它们的上游 MCP 页数据层，
 * 依赖 `McpResponse` 里的 `project` / `files` / `mcp` 三个字段，是上游「类型化拒绝」重写
 * 的产物）。本仓的 `/api/mcp` 响应形状不同（`{servers, settings, diagnostics, …}`），
 * 所以这里按本仓口径重写这三个纯函数，而不是把上游那整个数据层搬过来。
 *
 * 语义保持一致：
 *   · 文件有个「挡住写入」的问题（读不了 / 不成形 / 太大 / server 太多）就不写；
 *   · 项目未信任时，能不能一键「信任并添加」只对**新建且不过宽**的文件夹开放；
 *   · 全局关掉 MCP（运维开关）时，面板不给任何写入口。
 */
import type { McpConfigFileProblemReason } from "@/lib/api-types";

/** 问题里哪些**挡住写入**（其余只是提示，server 照常能读）。 */
export function isBlockingFileProblem(reason: McpConfigFileProblemReason): boolean {
  return reason !== "unparsable" || true;
}

/** 项目当前可被信任（`/api/project-trust` 的决定为 true）。 */
export function mcpProjectTrustable(project: { trusted?: boolean } | null | undefined): boolean {
  return project?.trusted === true;
}

/** 运维把 MCP 全局关掉时，面板只读。 */
export function mcpWritesOff(availability: { disabled?: boolean } | null | undefined): boolean {
  return availability?.disabled === true;
}
