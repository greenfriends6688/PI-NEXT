/**
 * fork:proma-46-mcp-catalog — 从「连接目录」配置一个 server。
 *
 * 这是**新增**路由，不碰 `app/api/mcp/route.ts` 的响应形状与状态码。职责：
 *   1. 按 `entryId` 取出目录条目（纯数据，见 lib/mcp-catalog.ts）；
 *   2. remote 条目的凭据写进 `mcp.json` 的 `headers`（pi / Proma 同款）；
 *   3. stdio 条目的凭据**不写进 mcp.json**，存进 0600 的
 *      `lib/mcp-catalog-credentials.ts`，连接时绑定校验通过才注入；
 *   4. 与既有 `/api/mcp` 一样，先过 pi 的结构校验再原子写入。
 *
 * 项目作用域的写入仍要求目录已信任；cwd 仍必须在 allow-list 内。
 */

import { NextResponse } from "next/server";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { addMcpServer } from "@/lib/mcp-config-file";
import { validateMcpServer, type McpServerConfig } from "@/lib/mcp-validator";
import { buildCatalogServerConfig, findCatalogEntry, isCatalogEntryValid } from "@/lib/mcp-catalog";
import { saveCatalogCredential } from "@/lib/mcp-catalog-credentials";
// fork:mcp-auto-reload —— 目录里配好一个 server 也是写 mcp.json，同样要重载会话。
import { requestMcpReload } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

type CatalogScope = "global" | "project";

function catalogFilePath(cwd: string, scope: CatalogScope): string {
  return scope === "global" ? join(getAgentDir(), "mcp.json") : join(cwd, ".pi", "mcp.json");
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = (await req.json()) as {
      cwd?: string;
      scope?: CatalogScope;
      entryId?: string;
      credential?: string;
      force?: boolean;
    };
    if (!body.cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (!body.entryId) return NextResponse.json({ error: "entryId required" }, { status: 400 });

    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(body.cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const entry = findCatalogEntry(body.entryId);
    if (!entry || !isCatalogEntryValid(entry)) {
      return NextResponse.json({ error: `Unknown or invalid catalog entry: ${body.entryId}` }, { status: 404 });
    }

    const scope: CatalogScope = body.scope === "project" ? "project" : "global";
    if (scope === "project" && !getProjectTrustStatus(body.cwd, getAgentDir()).trusted) {
      return NextResponse.json(
        { error: "Project must be trusted before modifying project MCP config" },
        { status: 403 },
      );
    }

    if (entry.category === "cli") {
      return NextResponse.json(
        { error: "CLI integrations are not written to mcp.json" },
        { status: 400 },
      );
    }
    if (entry.requiresCredential && !body.credential?.trim()) {
      return NextResponse.json({ error: "credential required" }, { status: 400 });
    }

    const built = buildCatalogServerConfig(entry, body.credential);
    if (entry.requiresCredential && entry.transport === "stdio") {
      if (!built.envName || built.envValue === undefined || !built.credentialBinding) {
        return NextResponse.json({ error: "catalog entry is missing its stdio credential field" }, { status: 500 });
      }
      // 先落盘凭据，再写配置：即使随后校验失败，凭据也只在绑定匹配时才可能被注入。
      saveCatalogCredential(entry.serverName, {
        envName: built.envName,
        value: built.envValue,
        binding: built.credentialBinding,
      });
    }

    if (body.force !== true) {
      const result = await validateMcpServer(entry.serverName, built.config);
      if (!result.ok) return NextResponse.json({ error: result.detail }, { status: 400 });
    }

    await addMcpServer(catalogFilePath(body.cwd, scope), entry.serverName, built.config as unknown as McpServerConfig);
    // fork:mcp-auto-reload —— global 改动影响所有会话，项目级只影响本工作区。
    const reload = scope === "global" ? requestMcpReload(undefined) : requestMcpReload(body.cwd);
    return NextResponse.json({ ok: true, name: entry.serverName, scope, reload });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
