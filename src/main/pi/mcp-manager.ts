import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  McpClient,
  StdioTransport,
  StreamableHttpTransport,
  toLlmContent,
  type McpTransport,
  type Tool as McpTool,
} from "@earendil-works/pi-mcp";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { McpServerConfig, McpServerStatus } from "@shared/types";
import { isStringRecord, serverFromEntry } from "../../shared/mcp-config.ts";
import type { McpTestResult } from "../../shared/mcp-discovery.ts";
import { uiText } from "../engine/ui-text.ts";
export type { McpServerConfig, McpServerStatus } from "@shared/types";

/**
 * How long one server gets to answer before it is given up on.
 *
 * Both calls below are bounded, because neither the handshake nor `tools/list` has a
 * deadline of its own — an unreachable HTTP endpoint, or a stdio server that starts but
 * never speaks, simply never settles. The engine awaits `connectAll()` before it reports
 * itself ready, so without this the whole app sat in 「正在准备工作区…」 for as long as
 * that server stayed silent, with no way to send a prompt and nothing on screen to say why.
 */
const CONNECT_TIMEOUT_MS = 10_000;

/** A tool call is allowed to be slow; a hung server is ended by Stop (the call's signal). */
const REQUEST_TIMEOUT_MS = 60_000;

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), CONNECT_TIMEOUT_MS);
    timer.unref?.();
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/**
 * The variables a stdio server inherits before its own `env` is laid on top. The
 * transport would hand over the whole of `process.env` by default; the app's own
 * environment is not the server's business, so only what a process needs to find its
 * interpreter and home directory goes through — the same short list the MCP reference
 * client uses.
 */
const INHERITED_ENV =
  process.platform === "win32"
    ? ["APPDATA", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "PATH", "PROCESSOR_ARCHITECTURE", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "USERNAME", "USERPROFILE", "PROGRAMFILES"]
    : ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"];

function inheritedEnvironment(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_ENV) {
    const value = process.env[key];
    // A value starting with "()" is a shell function exported by bash, not data.
    if (value && !value.startsWith("()")) env[key] = value;
  }
  return env;
}

type Connection = {
  config: McpServerConfig;
  client: McpClient;
  tools: McpTool[];
  /** What the server says about its tools as a group; handed to `codemode` as the namespace's guide. */
  instructions?: string;
};

/** Builds the wire to one server. `onStderr` receives a stdio child's error output. */
export type McpTransportFactory = (config: McpServerConfig, onStderr: (chunk: string) => void) => McpTransport;

export function createTransport(config: McpServerConfig, onStderr: (chunk: string) => void): McpTransport {
  if (config.transport === "stdio") {
    return new StdioTransport({
      command: config.command ?? "",
      args: config.args,
      env: { ...inheritedEnvironment(), ...config.env },
      inheritEnv: false,
      cwd: process.cwd(),
      stderr: "pipe",
      onStderr,
    });
  }
  return new StreamableHttpTransport({ url: config.url ?? "", headers: config.headers });
}

/** The one place a server's tool name becomes the name the model sees. */
export function mcpToolName(serverId: string, toolName: string): string {
  return `mcp_${serverId}_${toolName}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export class McpManager {
  #file: string;
  #createTransport: McpTransportFactory;
  #configs: McpServerConfig[] = [];
  #connections = new Map<string, Connection>();
  #errors = new Map<string, string>();

  constructor(file: string, options: { createTransport?: McpTransportFactory } = {}) {
    this.#file = file;
    this.#createTransport = options.createTransport ?? createTransport;
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.#file, "utf8")) as unknown;
      this.#configs = normalizeConfigs(parsed);
    } catch { this.#configs = []; }
  }

  /**
   * Write the server table, with the two rules a credential file needs.
   *
   * **Atomic and private.** The bytes land in a temp file in the same directory, get `0600`,
   * and are renamed over the original — so a crash cannot leave a half-written config, and a
   * config holding API keys and auth headers is not world-readable. `writeFile` alone was
   * both of those holes at once.
   *
   * **A masked secret means "keep what is stored".** The renderer never holds the real value
   * (`list()` masks it), so the plaintext it sends back for an untouched row is the mask —
   * and writing that would destroy the credential on the next save.
   */
  async save(configs: McpServerConfig[]): Promise<void> {
    const previous = new Map(this.#configs.map((config) => [config.id, config]));
    this.#configs = configs.filter(isConfig).map((config) => mergeMaskedSecrets(config, previous.get(config.id)));
    const temp = join(dirname(this.#file), `.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temp, `${JSON.stringify(this.#configs, null, 2)}\n`, { mode: 0o600 });
    await chmod(temp, 0o600);
    await rename(temp, this.#file);
  }

  list(): McpServerStatus[] {
    // Masked on the way out. An MCP server's `env` and `headers` are where its API keys and
    // bearer tokens live, and this object is handed to the renderer — which may be a browser
    // on another machine. The connection itself still gets the real values: masking is a
    // property of this reply, not of the stored config.
    return this.#configs.map((config) => ({
      ...maskServerSecrets(config),
      connected: this.#connections.has(config.id),
      tools: this.#connections.get(config.id)?.tools.map((tool) => tool.name) ?? [],
      error: this.#errors.get(config.id),
    }));
  }

  async connectAll(): Promise<void> {
    await this.close();
    this.#errors.clear();
    await Promise.all(this.#configs.filter((config) => config.enabled).map((config) => this.#connect(config)));
  }

  /**
   * The registered names of the MCP tools whose server declared them read-only.
   *
   * A hint, not an audit: it is what the server says about its own tool, and the only signal a
   * read-only session has. Servers that say nothing get nothing.
   */
  readOnlyToolNames(): Set<string> {
    const names = new Set<string>();
    for (const connection of this.#connections.values()) {
      for (const tool of connection.tools) {
        if (tool.annotations?.readOnlyHint === true) names.add(mcpToolName(connection.config.id, tool.name));
      }
    }
    return names;
  }

  async tools(): Promise<ToolDefinition<any>[]> {
    const output: ToolDefinition<any>[] = [];
    for (const connection of this.#connections.values()) {
      for (const tool of connection.tools) {
        const safeName = mcpToolName(connection.config.id, tool.name);
        // `direct` is the SDK's own default and needs no namespace. The other two are
        // tools the model does not see declared, so `codemode` lists them under their
        // server and `tool_search` ranks them by it.
        const exposure = connection.config.exposure ?? "direct";
        output.push({
          name: safeName,
          ...(exposure === "direct"
            ? {}
            : {
                exposure,
                namespace: {
                  name: connection.config.name,
                  ...(connection.instructions ? { instructions: connection.instructions } : {}),
                },
              }),
          label: `${connection.config.name}: ${tool.name}`,
          description: tool.description ?? `MCP tool ${tool.name} from ${connection.config.name}`,
          parameters: toParameters(tool.inputSchema) as any,
          execute: async (_toolCallId, params, signal) => {
            // Stop reaches the server as a cancellation, instead of leaving the call to
            // run out its timeout behind a run that has already ended.
            const result = await connection.client.callTool(tool.name, (params ?? {}) as Record<string, unknown>, { signal });
            const content = toLlmContent(result);
            if (!content.length) content.push({ type: "text", text: result.isError ? uiText("MCP 工具返回了错误", "The MCP tool returned an error") : "(empty result)" });
            return {
              content,
              details: { isError: result.isError === true },
              ...(result.isError ? { isError: true } : {}),
            };
          },
        });
      }
    }
    return output;
  }

  async close(): Promise<void> {
    const connections = [...this.#connections.values()];
    this.#connections.clear();
    await Promise.all(connections.map((connection) => connection.client.close().catch(() => undefined)));
  }

  /**
   * Try one server, right now, and report what happened.
   *
   * The connection loop already does every part of this (`#connect`), so a separate test
   * harness would be a second implementation of the same thing — and the two would drift on
   * exactly the details a person reads when something fails: the timeout, the stderr tail,
   * and whether an error is "the server said no" or "we could not get there".
   *
   * It **does not touch the live connection map**: a test must not disturb the servers the
   * agent is using, and a failed test must not leave a child process behind.
   */
  async test(id: string): Promise<McpTestResult> {
    const config = this.#configs.find((item) => item.id === id);
    if (!config) return { id, ok: false, state: "failed", error: uiText("找不到这个 server", "No such server"), tools: [] };
    const client = new McpClient({ name: "Pinext", version: "0.1.0", requestTimeoutMs: REQUEST_TIMEOUT_MS });
    let stderr = "";
    try {
      const transport = this.#createTransport(config, (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-12_000);
      });
      await withTimeout(client.connect(transport), uiText("连接超时", "Connection timed out"));
      const tools = await withTimeout(client.listTools(), uiText("读取工具列表超时", "Listing tools timed out"));
      return {
        id,
        ok: true,
        state: "connected",
        tools: tools.slice(0, 500).map((tool) => ({
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
          // 只读提示是 MCP 自己给的，读得到就说出来 —— 会话的只读策略靠它。
          ...(tool.annotations?.readOnlyHint === true ? { readOnly: true } : {}),
        })),
        ...(client.instructions ? { instructions: client.instructions } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const details = stderr.trim();
      return {
        id,
        ok: false,
        state: /timed out|超时/i.test(message) ? "timedOut" : "failed",
        error: details ? `${message}\n\n${details}` : message,
        tools: [],
      };
    } finally {
      // stdio servers are child processes this app owns: a test that fails must still let go.
      await client.close().catch(() => undefined);
    }
  }

  async #connect(config: McpServerConfig): Promise<void> {
    const client = new McpClient({ name: "Pinext", version: "0.1.0", requestTimeoutMs: REQUEST_TIMEOUT_MS });
    let stderr = "";
    try {
      const transport = this.#createTransport(config, (chunk) => {
        // Keep enough context for the settings tooltip without allowing a noisy
        // child process to grow the in-memory error indefinitely.
        stderr = `${stderr}${chunk}`.slice(-12_000);
      });
      await withTimeout(client.connect(transport), uiText("连接超时", "Connection timed out"));
      const tools = await withTimeout(client.listTools(), uiText("读取工具列表超时", "Listing tools timed out"));
      const connection: Connection = { config, client, tools, instructions: client.instructions };
      this.#connections.set(config.id, connection);
      // A server that exits later is shown as down rather than as connected with tools
      // that can no longer be called. Closing on our own side clears the map first, so
      // only a connection that is still the current one reports itself lost.
      client.onClose(() => {
        if (this.#connections.get(config.id) !== connection) return;
        this.#connections.delete(config.id);
        this.#errors.set(config.id, uiText("连接已断开", "The connection was closed"));
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const details = stderr.trim();
      this.#errors.set(config.id, details ? `${message}\n\n${details}` : message);
      // A timed-out connect can still be in flight, and a stdio server is a child
      // process this one owns: closing releases it instead of leaving it running for
      // the life of the app.
      await client.close().catch(() => undefined);
    }
  }
}

/**
 * A tool's input schema must be an object, and some providers reject an object schema
 * with no `properties`; MCP servers may omit either.
 */
function toParameters(schema: McpTool["inputSchema"] | undefined): Record<string, unknown> {
  const base = (schema ?? {}) as Record<string, unknown>;
  return { ...base, type: base.type ?? "object", ...(base.properties === undefined ? { properties: {} } : {}) };
}

export function normalizeConfigs(value: unknown): McpServerConfig[] {
  if (Array.isArray(value)) return value.filter(isConfig);
  if (!value || typeof value !== "object") return [];

  // Also accept the standard MCP client shape, so a config copied from DBX,
  // Claude Desktop, etc. can be placed directly in Pinext's mcp.json.
  const servers = (value as Record<string, unknown>).mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) return [];
  return Object.entries(servers).flatMap(([name, raw]) => {
    const result = serverFromEntry(name, raw, { lenient: true });
    return "server" in result ? [result.server] : [];
  });
}

function isConfig(value: unknown): value is McpServerConfig {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.name !== "string") return false;
  // `env` was never validated before, and a hand-written `"PORT": 3000` spawns fine, so only
  // its shape is checked; `headers` is new and must be strings, which a request needs.
  if (item.env !== undefined && (typeof item.env !== "object" || item.env === null || Array.isArray(item.env))) return false;
  if (item.headers !== undefined && !isStringRecord(item.headers)) return false;
  if (item.exposure !== undefined && item.exposure !== "direct" && item.exposure !== "deferred" && item.exposure !== "codemode") return false;
  if (item.transport === "stdio") {
    return typeof item.command === "string" && item.command.length > 0
      && (item.args === undefined || Array.isArray(item.args));
  }
  return item.transport === "http" && typeof item.url === "string" && item.url.length > 0;
}

/** What a secret looks like to the renderer. Sending it back means "keep the stored one". */
export const MCP_SECRET_MASK = "••••••••";

function maskedRecord(values: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!values) return undefined;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value ? MCP_SECRET_MASK : value]));
}

/** The same server, with every credential replaced by the mask. */
export function maskServerSecrets(config: McpServerConfig): McpServerConfig {
  return {
    ...config,
    ...(config.env ? { env: maskedRecord(config.env) } : {}),
    ...(config.headers ? { headers: maskedRecord(config.headers) } : {}),
  };
}

/** Put the stored secret back wherever the incoming value is the mask. */
function mergeMaskedSecrets(config: McpServerConfig, previous: McpServerConfig | undefined): McpServerConfig {
  const merge = (incoming: Record<string, string> | undefined, stored: Record<string, string> | undefined) => {
    if (!incoming) return stored;
    return Object.fromEntries(
      Object.entries(incoming).map(([key, value]) => [key, value === MCP_SECRET_MASK ? stored?.[key] ?? "" : value]),
    );
  };
  return {
    ...config,
    ...(config.env || previous?.env ? { env: merge(config.env, previous?.env) } : {}),
    ...(config.headers || previous?.headers ? { headers: merge(config.headers, previous?.headers) } : {}),
  };
}
