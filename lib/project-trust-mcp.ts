import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadMcpConfigFile } from "./mcp-config-file";
import { maskUrl } from "./mcp-secrets";
import { getProjectTrustStatus } from "./project-trust";

/**
 * fork:pi-1.1（上游 3e693c7b3 / #1092 系列）—— 「信任这个文件夹之前，先看清楚它会跑什么」。
 *
 * 信任一个项目 = 允许它 `.pi/` 下的扩展、技能、MCP server 在本机执行。所以对话框
 * 必须在**按下信任之前**把 `.pi/mcp.json` 里的 server 及其命令列出来 —— 这正是
 * `loadMcpConfig` 自己做不到的（它只在项目已受信任时才读项目文件）。
 *
 * 这里用 `loadMcpConfigFile` 的「只读一个文件」通道（`contextForFile` 让 `.pi/mcp.json`
 * 按项目半边读），它只做解析与校验：**不起进程、不连网络、不展开 `${VAR}`、不跑
 * `!command`**。
 *
 * 命令**按原文列出、不掩码**：掩码是按形状认密钥的，仓库里写 `npx -y •••` 就能把
 * 「信任后会跑什么」藏起来，那正是这张表要回答的问题。URL 仍然掩码（host 不掩），
 * env / header 只列**名字**、不列值。
 */
export interface ProjectMcpServerSummary {
  name: string;
  transport: "stdio" | "http" | null;
  /** stdio：会跑的命令行（按原文）。 */
  command?: string;
  /** http：会连的地址（凭证已掩码，host 保留）。 */
  url?: string;
  /** 会被交给进程的环境变量名（只有名字）。 */
  envNames: string[];
  /** 会随请求发出去的请求头名（只有名字）。 */
  headerNames: string[];
  /** pi 拒绝它的原因；有值就表示它不会被连。 */
  invalidError?: string;
}

export interface ProjectMcpSummary {
  /** `.pi/mcp.json` 的绝对路径。 */
  file: string;
  exists: boolean;
  servers: ProjectMcpServerSummary[];
  /** 文件级问题（解析失败等）。 */
  errors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 一个项目 `.pi/mcp.json` 里声明了什么 —— 只读文件，不受信任状态影响。
 * 读不出来（文件坏 / SDK 内部件不可用）时也返回一个带 `errors` 的形状，
 * 让对话框如实说「读不出来」，而不是静默显示「没有 server」。
 */
export async function readProjectMcpSummary(cwd: string): Promise<ProjectMcpSummary> {
  const file = join(cwd, ".pi", "mcp.json");
  let loaded: Awaited<ReturnType<typeof loadMcpConfigFile>>;
  try {
    loaded = await loadMcpConfigFile(file);
  } catch (error) {
    return {
      file,
      exists: true,
      servers: [],
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
  // 信任状态只影响「谁来读」，不影响这里列什么。读它只为让「文件存在但当前不会被加载」
  // 这件事在错误里说清楚（未信任时 pi 根本不会读这个文件）。
  const trust = getProjectTrustStatus(cwd, getAgentDir());
  const servers: ProjectMcpServerSummary[] = [];
  for (const entry of loaded.servers) {
    const config = isRecord(entry.config) ? entry.config as Record<string, unknown> : {};
    const summary: ProjectMcpServerSummary = {
      name: entry.name,
      transport: "url" in config ? "http" : "command" in config ? "stdio" : null,
      envNames: isRecord(config.env) ? Object.keys(config.env) : [],
      headerNames: isRecord(config.headers) ? Object.keys(config.headers) : [],
    };
    if (typeof config.command === "string") {
      const args = Array.isArray(config.args) ? config.args.filter((arg): arg is string => typeof arg === "string") : [];
      summary.command = [config.command, ...args].join(" ");
    }
    if (typeof config.url === "string") summary.url = maskUrl(config.url).value;
    servers.push(summary);
  }
  return {
    file,
    exists: loaded.exists,
    servers,
    // 未信任时把「它现在还不会被加载」说清楚：这张表说的是「信任后会怎样」。
    errors: [...loaded.errors, ...(trust.trusted ? [] : [`not loaded while untrusted: ${file}`])],
  };
}
