import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { isMcpServerEnabled } from "@/lib/pi-sdk-internals";
import type { McpResponse, McpScope, McpServerInfo } from "@/lib/api-types";
import {
  addMcpServer,
  getMcpServerConfig,
  loadMcpConfigFiles,
  removeMcpServer,
  setMcpServerEnabled,
} from "@/lib/mcp-config-file";
import { validateMcpServer, type McpServerConfig } from "@/lib/mcp-validator";

export const dynamic = "force-dynamic";

type McpAction = "add" | "remove" | "enable" | "disable" | "update" | "move" | "test" | "get";

function mcpFilePath(cwd: string, scope: McpScope): string {
  return scope === "global" ? join(getAgentDir(), "mcp.json") : join(cwd, ".pi", "mcp.json");
}

function serverInfoFromDef(
  name: string,
  def: Record<string, unknown>,
  scope: McpScope,
  source: string,
): McpServerInfo {
  const command = typeof def.command === "string" ? def.command : undefined;
  const url = typeof def.url === "string" ? def.url : undefined;
  const socket = typeof def.socket === "string" ? def.socket : undefined;
  const args = Array.isArray(def.args)
    ? def.args.filter((a): a is string => typeof a === "string")
    : [];
  const env =
    def.env && typeof def.env === "object"
      ? (def.env as Record<string, unknown>)
      : {};
  const options: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(def)) {
    if (!["command", "url", "socket", "args", "env", "enabled", "disabled"].includes(k)) {
      options[k] = v;
    }
  }
  return {
    name,
    scope,
    // 与运行时同源：pi 的 isEnabled 只看 `enabled !== false`，旧 `disabled: true`
    // 在 normalizeMcpConfigForPiWeb 里已折成 `enabled: false`，这里用同一个判定。
    disabled: !isMcpServerEnabled(def as unknown as McpServerConfig),
    kind: socket ? "socket" : url ? "url" : "command",
    command,
    args,
    url,
    socket,
    envKeys: Object.keys(env),
    options,
    source,
  };
}

async function readMcp(cwd: string): Promise<McpResponse> {
  const agentDir = getAgentDir();
  const globalFile = mcpFilePath(cwd, "global");
  const projectFile = mcpFilePath(cwd, "project");
  const projectTrust = getProjectTrustStatus(cwd, agentDir);
  // All server-map reads go through pi's `loadMcpConfig` (validated entries,
  // project-over-global precedence, project file only when the project is trusted).
  const loaded = await loadMcpConfigFiles({ agentDir, cwd, projectTrusted: projectTrust.trusted });

  const diagnostics = [...loaded.errors];
  if (!existsSync(globalFile) && !existsSync(projectFile)) {
    diagnostics.push('No MCP config file found (global ~/.pi/agent/mcp.json or project .pi/mcp.json). Click "Add MCP" to create one.');
  }

  const servers = loaded.servers.map((entry) =>
    serverInfoFromDef(
      entry.name,
      entry.config as unknown as Record<string, unknown>,
      entry.scope === "project" ? "project" : "global",
      entry.source,
    ),
  );
  // pi 1.0's only top-level config knob is `autoEnableCodemode`; keep it under
  // the response's stable `settings` field instead of inventing a second shape.
  const settings = loaded.autoEnableCodemode === undefined
    ? {}
    : { autoEnableCodemode: loaded.autoEnableCodemode };
  return { servers, settings, diagnostics, projectResourcesLoaded: projectTrust.trusted };
}

function readScope(scope: unknown): McpScope {
  return scope === "project" ? "project" : "global";
}

/**
 * fork:pr11-mcp — 保存/启用前的校验现在直接调 pi 的 `validateMcpServerConfig`
 * （纯结构校验，不再真连一次；见 lib/mcp-validator.ts）。
 *
 * `force: true` 仍是逃生口：配上配置、服务稍后才起的场景跳过校验。
 */
async function checkServer(name: string, def: Record<string, unknown>, force: boolean):
  Promise<{ ok: true; config: McpServerConfig } | { ok: false; error: string; status: number }> {
  if (force) return { ok: true, config: def as unknown as McpServerConfig };
  const result = await validateMcpServer(name, def);
  if (result.ok && result.config) return { ok: true, config: result.config };
  return { ok: false, status: 400, error: result.detail };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const cwd = searchParams.get("cwd");
  if (!cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });

  try {
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    return NextResponse.json(await readMcp(cwd));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// POST /api/mcp body: { action, cwd, scope?, name?, def?, fromScope?, toScope?, force? }
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = (await req.json()) as {
      action?: McpAction;
      cwd?: string;
      scope?: McpScope;
      name?: string;
      fromScope?: McpScope;
      toScope?: McpScope;
      def?: Record<string, unknown>;
      /** fork:gap-mcp-handshake — 跳过保存/启用前校验（"先配好、服务稍后才起"）。 */
      force?: boolean;
    };
    if (!body.cwd) return NextResponse.json({ error: "cwd required" }, { status: 400 });
    if (!body.action) return NextResponse.json({ error: "action required" }, { status: 400 });
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(body.cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const cwd = body.cwd;
    const projectTrust = getProjectTrustStatus(cwd, getAgentDir());

    if (body.action === "test") {
      const scope = readScope(body.scope);
      const name = body.name?.trim() || "server";
      const def = body.def ?? await getMcpServerConfig(mcpFilePath(cwd, scope), name);
      if (!def) return NextResponse.json({ error: "server not found" }, { status: 404 });
      const result = await validateMcpServer(name, def);
      return NextResponse.json({ ok: result.ok, message: result.detail });
    }

    if (body.action === "get") {
      const scope = readScope(body.scope);
      const def = await getMcpServerConfig(mcpFilePath(cwd, scope), body.name ?? "");
      if (!def) return NextResponse.json({ error: "server not found" }, { status: 404 });
      // Return the full raw definition (including env values) for advanced JSON editing
      return NextResponse.json({ def });
    }

    if (body.action === "add" || body.action === "update") {
      const scope = readScope(body.scope);
      if (scope === "project" && !projectTrust.trusted) {
        return NextResponse.json(
          { error: "Project must be trusted before modifying project MCP config" },
          { status: 403 },
        );
      }
      const name = body.name?.trim();
      const def = body.def;
      if (!name || !def || typeof def !== "object") {
        return NextResponse.json({ error: "name and def required" }, { status: 400 });
      }
      if (!def.command && !def.url && !def.socket) {
        return NextResponse.json({ error: "Requires one of command, url or socket" }, { status: 400 });
      }
      const file = mcpFilePath(cwd, scope);
      // `update` must not silently create a copy in another scope: if the client reports a
      // scope that does not hold this server, fail loudly instead of writing a shadow entry
      // (which would also duplicate any env values into the other mcp.json).
      if (body.action === "update" && !(await getMcpServerConfig(file, name))) {
        return NextResponse.json(
          { error: `Server "${name}" not found in ${scope} scope` },
          { status: 404 },
        );
      }
      const check = await checkServer(name, def, body.force === true);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
      await addMcpServer(file, name, check.config);
    } else if (body.action === "remove") {
      const scope = readScope(body.scope);
      if (scope === "project" && !projectTrust.trusted) {
        return NextResponse.json(
          { error: "Project must be trusted before modifying project MCP config" },
          { status: 403 },
        );
      }
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
      await removeMcpServer(mcpFilePath(cwd, scope), name);
    } else if (body.action === "enable" || body.action === "disable") {
      const scope = readScope(body.scope);
      if (scope === "project" && !projectTrust.trusted) {
        return NextResponse.json(
          { error: "Project must be trusted before modifying project MCP config" },
          { status: 403 },
        );
      }
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
      const file = mcpFilePath(cwd, scope);
      if (body.action === "enable") {
        const def = await getMcpServerConfig(file, name);
        if (def) {
          const check = await checkServer(name, def as unknown as Record<string, unknown>, body.force === true);
          if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
        }
      }
      await setMcpServerEnabled(file, name, body.action === "enable");
    } else if (body.action === "move") {
      const from = readScope(body.fromScope);
      const to = readScope(body.toScope);
      if (from === to) return NextResponse.json({ error: "same scope" }, { status: 400 });
      if (to === "project" && !projectTrust.trusted) {
        return NextResponse.json(
          { error: "Project must be trusted before modifying project MCP config" },
          { status: 403 },
        );
      }
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
      const fromFile = mcpFilePath(cwd, from);
      const toFile = mcpFilePath(cwd, to);
      const def = await getMcpServerConfig(fromFile, name);
      if (!def) return NextResponse.json({ error: "server not found in source scope" }, { status: 404 });
      await removeMcpServer(fromFile, name);
      await addMcpServer(toFile, name, def);
    } else {
      return NextResponse.json({ error: `Unsupported action: ${body.action}` }, { status: 400 });
    }

    return NextResponse.json(await readMcp(cwd));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
