import { NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { isMcpServerEnabled, type McpExposureLike } from "@/lib/pi-sdk-internals";
// fork:mcp-paste —— 「粘贴添加」：解析（lib/mcp-import-*）+ 预检（lib/mcp-add.ts）。
import { MCP_ADD_MAX_TEXT, prepareMcpAdd, readMcpAddSecretReferences, readMcpAddValues } from "@/lib/mcp-add";
import type { McpResponse, McpScope, McpServerInfo, McpUndoToken } from "@/lib/api-types";
import {
  addMcpServer,
  applyMcpServerPatch,
  getMcpServerConfig,
  insertMcpServerAt,
  loadMcpConfigFile,
  loadMcpConfigFiles,
  readMcpServerEntryAt,
  removeMcpServer,
  setMcpServerEnabled,
} from "@/lib/mcp-config-file";
import { resolveBundledScript } from "@/lib/mcp-bundled-script";
import { validateMcpServer, type McpServerConfig } from "@/lib/mcp-validator";


// fork:secrets-never-reach-browser —— 出去掩码、回来还原（规则来自上游 lib/mcp-secrets.ts）。
import { maskMcpDefForBrowser, restoreMaskedMcpDef } from "@/lib/mcp-secret-mask";
// fork:mcp-native-exposure —— `patch` 动作的入参形状就是 pi 自己的 McpServerConfigPatch。
import type { McpServerConfigPatch } from "@/lib/pi-sdk-internals";
// fork:mcp-auto-reload —— 写完配置就让已经打开的会话重读资源（空闲的立即、跑着的等这轮结束）。
import { requestMcpReload } from "@/lib/rpc-manager";
// fork:mcp-undo —— 删除 60 秒可撤销。被删条目（含字面密钥）只留在服务端内存，
// 浏览器只拿到 token。上游原样迁入，见 lib/mcp-undo.ts。
import { holdRemovedEntry, returnRemovedEntry, takeRemovedEntry } from "@/lib/mcp-undo";
// fork:mcp-live-test —— 本机/桌面形态下的真连测试（默认关闭，见该文件「边界」）。
import { mcpLiveTestAllowed, testMcpServerWithinPolicy } from "@/lib/mcp-live-test";
import { loadPiSdkInternals, type McpOAuthCredentialStore, type PiSdkInternals } from "@/lib/pi-sdk-internals";

export const dynamic = "force-dynamic";

type McpAction = "paste" | "add" | "remove" | "enable" | "disable" | "update" | "move" | "test" | "get" | "patch" | "undo";

function mcpFilePath(cwd: string, scope: McpScope): string {
  return scope === "global" ? join(getAgentDir(), "mcp.json") : join(cwd, ".pi", "mcp.json");
}

/** fork:mcp-native-exposure —— pi 的曝光档（`core/mcp-servers.d.ts:12`）；`codemode-deferred` 是别名。 */
const MCP_EXPOSURES: ReadonlyArray<McpExposureLike> = ["codemode", "codemode-deferred", "deferred", "direct", "hidden"];

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
  // fork:mcp-native-exposure —— exposure 单列出来给 UI 下拉（同时从 options 里摘掉，
  // 不然详情里会以 JSON 形式重复出现一次）。`codemode-deferred` 是旧别名，这里归一；
  // 没声明 = null = pi 默认（codemode）。
  const rawExposure = typeof def.exposure === "string" ? def.exposure : null;
  const exposure = rawExposure === "codemode-deferred" ? "codemode" : rawExposure;
  delete options.exposure;
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
    exposure: exposure as McpServerInfo["exposure"],
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
async function checkServer(name: string, def: Record<string, unknown>, force: boolean, scope: McpScope = "global"):
  Promise<{ ok: true; config: McpServerConfig } | { ok: false; error: string; status: number }> {
  if (force) return { ok: true, config: def as unknown as McpServerConfig };
  // fork:mcp-native-exposure —— scope 要传下去：项目级 mcp.json 不许用 auth.provider
  // （仓库内容不该决定凭据发给哪个 provider），这条 pi 的校验器看不到它。
  const result = await validateMcpServer(name, def, { scope });
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
    // fork:mcp-undo —— 一次请求里「删了又撤销」的两个结果拼在同一个响应里。
    let undo: McpUndoToken | undefined;
    let restored: { scope: McpScope; name: string } | undefined;
    let undoTouchedGlobal = false;
    const body = (await req.json()) as {
      action?: McpAction;
      cwd?: string;
      scope?: McpScope;
      name?: string;
      fromScope?: McpScope;
      toScope?: McpScope;
      def?: Record<string, unknown>;
      /** fork:mcp-native-exposure —— `patch` 动作的入参（`enabled` / `exposure`）。 */
      patch?: McpServerConfigPatch;
      /** fork:mcp-undo —— `undo` 动作的入参（删除时拿到的 token）。 */
      token?: string;
      /** fork:mcp-paste —— `paste` 动作的入参（粘贴的原文 + 逐字段取值 + 确认过的宿主变量名）。 */
      text?: string;
      values?: unknown;
      secretReferences?: unknown;
      server?: number;
      rawPi?: boolean;
      confirmHostEnv?: unknown;
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
      const file = mcpFilePath(cwd, scope);
      const def = body.def ?? await getMcpServerConfig(file, name);
      if (!def) return NextResponse.json({ error: "server not found" }, { status: 404 });
      const result = await validateMcpServer(name, def);
      if (!result.ok) return NextResponse.json({ ok: false, message: result.detail });

      // fork:mcp-live-test —— 真连只在本机/桌面形态下开放（`PI_WEB_ALLOW_MCP_TEST`），
      // 默认仍是纯结构校验。远程部署上「测试连接」等于替远程用户 spawn 一条他配置的
      // 命令，所以那里不做 —— 详见 lib/mcp-live-test.ts 的「边界」。
      if (!mcpLiveTestAllowed()) {
        return NextResponse.json({ ok: true, message: result.detail, live: false });
      }
      const internals = await loadPiSdkInternals();
      if (!internals.ok) {
        return NextResponse.json({ ok: true, message: result.detail, live: false });
      }
      const live = await testMcpServerWithinPolicy(
        { name, config: result.config as McpServerConfig, source: file, scope },
        {
          internals: internals as PiSdkInternals,
          credentials: internals.McpOAuthCredentialStore as unknown as new () => McpOAuthCredentialStore,
          cwd,
          testCwd: cwd,
        },
      );
      return NextResponse.json({
        ok: live.state === "connected",
        message: live.state === "connected"
          ? `Connected · ${live.toolCount} tool(s) · ${Math.round(live.durationMs / 100) / 10}s`
          : (live.error ?? live.state),
        live: true,
        result: live,
      });
    }

    if (body.action === "get") {
      const scope = readScope(body.scope);
      const def = await getMcpServerConfig(mcpFilePath(cwd, scope), body.name ?? "");
      if (!def) return NextResponse.json({ error: "server not found" }, { status: 404 });
      // Return the full raw definition (including env values) for advanced JSON editing
      return NextResponse.json({ def });
    }

    if (body.action === "paste") {
      // fork:mcp-paste —— 「粘贴添加」：浏览器只发**粘贴的原文**，服务端用与预览同一个
      // 解析器再解析一遍（`lib/mcp-import-*`），预检通过才写盘（`lib/mcp-add.ts` 的
      // `prepareMcpAdd`）。浏览器不再能自己拼一个 def 进来。
      const scope = readScope(body.scope);
      if (scope === "project" && !projectTrust.trusted) {
        return NextResponse.json(
          { error: "Project must be trusted before modifying project MCP config", reason: "trust-required" },
          { status: 403 },
        );
      }
      const internals = await loadPiSdkInternals();
      if (!internals.ok) {
        return NextResponse.json({ error: internals.reason, reason: "internals-unavailable" }, { status: 500 });
      }
      const request = {
        text: typeof body.text === "string" ? body.text : "",
        values: readMcpAddValues(body.values) ?? {},
        secretReferences: readMcpAddSecretReferences(body.secretReferences),
        server: typeof body.server === "number" ? body.server : 0,
        name: typeof body.name === "string" ? body.name : undefined,
        scope,
        rawPi: body.rawPi === true,
        confirmHostEnv: Array.isArray(body.confirmHostEnv)
          ? body.confirmHostEnv.filter((item): item is string => typeof item === "string").slice(0, 100)
          : [],
      };
      if (request.text.length > MCP_ADD_MAX_TEXT) {
        return NextResponse.json(
          { error: `The pasted text is longer than ${MCP_ADD_MAX_TEXT} characters`, reason: "invalid-request" },
          { status: 400 },
        );
      }
      const targetFile = mcpFilePath(cwd, scope);
      const existing = await loadMcpConfigFile(targetFile);
      const takenNames = existing.servers.map((server) => server.name);
      const prepared = prepareMcpAdd(request, { internals, takenNames });
      if (!prepared.ok) {
        return NextResponse.json(
          { error: prepared.error, reason: prepared.reason, notes: prepared.notes, name: prepared.name },
          { status: prepared.status },
        );
      }
      await addMcpServer(mcpFilePath(cwd, scope), prepared.name, prepared.entry);
      // fork:mcp-auto-reload —— 粘贴写完同样要让在跑的会话重读资源。
      const reload = scope === "global" ? requestMcpReload(undefined) : requestMcpReload(cwd);
      return NextResponse.json({
        ...(await readMcp(cwd)),
        added: { scope, name: prepared.name, path: mcpFilePath(cwd, scope) },
        reload,
      });
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
      /*
       * fork:simulator-section —— `script` 是本仓的简写：
       * 浏览器只知道自己要装「仓库里那个 ios-simulator.mjs」，不知道它在磁盘上的
       * 绝对路径（那是服务端的信息，也不该让客户端来猜 cwd）。所以接受
       * `{ type:"stdio", script: "mcp/xxx.mjs" }`，在这里解析成
       * `{ command: process.execPath, args: [<绝对路径>] }`。
       *
       * 边界收得很紧（**安全**）：必须落在本仓仓库根之下、必须是文件、扩展名必须是
       * .mjs。否则 `script: "../../../../etc/passwd"` 就成了一个任意文件读的执行入口。
       */
      if ("script" in def && typeof (def as { script?: unknown }).script === "string") {
        const resolved = resolveBundledScript((def as { script: string }).script);
        if (!resolved.ok) {
          return NextResponse.json({ error: resolved.error }, { status: 400 });
        }
        const record = def as Record<string, unknown>;
        delete record.script;
        Object.assign(record, resolved.def);
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
      // fork:secrets-never-reach-browser —— 浏览器回传的 def 里没动过的密钥字段是 `•••`，
      // 校验/写盘前换回落盘的真值（否则会把掩码写进文件，把用户的密钥真抹掉）。
      const submitted = body.action === "update"
        ? restoreMaskedMcpDef(def, await getMcpServerConfig(file, name))
        : def;
      const check = await checkServer(name, submitted, body.force === true, scope);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
      await addMcpServer(file, name, check.config);
    } else if (body.action === "patch") {
      // fork:mcp-native-exposure —— 改 `exposure`（以及将来同一形状的字段）。用 pi 自己的
      // `McpServerConfigPatch` 口径：`enabled: true` 与 `exposure: "codemode"` 是默认值，
      // 写入默认值等于**删掉这个键**。不走 `update` 是因为那条路要回传整份 def（并重跑
      // 一次结构校验），改一个曝光档没理由把 env 明文在请求体里再走一趟。
      const scope = readScope(body.scope);
      if (scope === "project" && !projectTrust.trusted) {
        return NextResponse.json(
          { error: "Project must be trusted before modifying project MCP config" },
          { status: 403 },
        );
      }
      const name = body.name?.trim();
      if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
      const patch = body.patch;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        return NextResponse.json({ error: "patch object required" }, { status: 400 });
      }
      const exposure = (patch as { exposure?: unknown }).exposure;
      if (exposure !== undefined && !MCP_EXPOSURES.includes(exposure as McpExposureLike)) {
        return NextResponse.json(
          { error: `Invalid exposure: ${String(exposure)} (expected one of ${[...new Set(MCP_EXPOSURES)].join(", ")})` },
          { status: 400 },
        );
      }
      await applyMcpServerPatch(mcpFilePath(cwd, scope), name, patch as McpServerConfigPatch);
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
      // fork:mcp-undo —— 删之前把**原文与位置**抓下来（上游同一要求：撤销要放回原位，
      // 且原文里的字面密钥不必再经一次掩码往返）。
      const file = mcpFilePath(cwd, scope);
      const held = await readMcpServerEntryAt(file, name);
      await removeMcpServer(file, name);
      if (held) {
        const { token, expiresAt } = holdRemovedEntry({
          scope,
          name,
          path: file,
          ...(scope === "project" ? { cwd } : {}),
          entry: held.entry,
          index: held.index,
        });
        undo = {
          scope,
          name,
          token,
          path: file,
          expiresInMs: Math.max(0, expiresAt - Date.now()),
        };
      }
    } else if (body.action === "undo") {
      // fork:mcp-undo —— 放回原位，规则与任何一次写入相同：项目条目的目录仍须被允许且受信任。
      const token = (body.token ?? "").trim();
      if (!token || token.length > 100) {
        return NextResponse.json({ error: "token required" }, { status: 400 });
      }
      const taken = takeRemovedEntry(token);
      if (!taken) {
        return NextResponse.json(
          { error: "undo-unavailable", detail: "Nothing to undo: the removal is unknown, already undone, or older than 60 seconds" },
          { status: 410 },
        );
      }
      let failure: string | undefined;
      if (taken.scope === "project") {
        const roots = await getAllowedFileRoots();
        if (!taken.cwd || !isExistingFilePathAllowed(taken.cwd, roots) || !projectTrust.trusted) {
          failure = "The project folder is no longer allowed or trusted, so the removal is not undone";
        }
      }
      if (!failure) {
        const target = mcpFilePath(cwd, taken.scope);
        const stillThere = await readMcpServerEntryAt(target, taken.name);
        if (stillThere) {
          failure = `${target} defines "${taken.name}" again, so the removal is not undone`;
        } else {
          try {
            await insertMcpServerAt(target, taken.name, taken.entry, taken.index);
          } catch (error) {
            failure = error instanceof Error ? error.message : String(error);
          }
        }
      }
      if (failure) {
        // 原因解决后还能在剩下的时间里再试一次。
        returnRemovedEntry(taken);
        return NextResponse.json({ error: "undo-failed", detail: failure }, { status: 409 });
      }
      restored = { scope: taken.scope, name: taken.name };
      undoTouchedGlobal ||= taken.scope === "global";
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
          const check = await checkServer(name, def as unknown as Record<string, unknown>, body.force === true, scope);
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

    // fork:mcp-auto-reload —— 六个写动作（add/update/remove/enable/disable/move）都落到
    // 这里，所以「重载在跑的会话」也只在这里发一次。判据是**这次改动碰了哪一层配置**：
    // 碰到 global（`readScope` 把未知值当 global，所以省略 scope 就是 global）就让所有
    // 会话重读；只碰项目级则只重载本工作区的会话 —— 项目 `.pi/mcp.json` 不该影响别的项目。
    // `test` / `get` 是只读的，不走这条。
    const touchesGlobal = undoTouchedGlobal || (body.action === "move"
      ? readScope(body.fromScope) === "global" || readScope(body.toScope) === "global"
      : readScope(body.scope) === "global");
    const reload = touchesGlobal ? requestMcpReload(undefined) : requestMcpReload(cwd);
    return NextResponse.json({
      ...(await readMcp(cwd)),
      reload,
      ...(undo ? { undo } : {}),
      ...(restored ? { restored } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
