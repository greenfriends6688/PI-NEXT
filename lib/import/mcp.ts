/**
 * fork:import-scan — MCP server configuration scanner (PR-08 / PD-15).
 *
 * Sources (all read-only):
 *   ~/Library/Application Support/Claude/claude_desktop_config.json
 *   ~/.claude.json
 *   ~/.claude/settings.json
 *   ~/.cursor/mcp.json
 *   ~/.codex/config.toml
 *   ~/.config/opencode/opencode.json
 *
 * Transport mapping: a `url` wins (http); otherwise a `type`/`transport`
 * containing http/sse is http; otherwise a `command` makes it stdio. opencode's
 * `local` packs argv into `command` and `remote` maps to http.
 *
 * Env values and header values never leave this module: candidates carry only
 * `hasSecret: boolean`.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { toNativePath } from "../paths";
import { parseTomlTables } from "./models";
import {
  firstString,
  hasNonEmptyStringValue,
  headersLookCredentialed,
  isRecord,
  readJsonFileCapped,
  readTextFileCapped,
  redactUrlCredentials,
  sourceDiagnostic,
  stringList,
  type ImportMcpCandidate,
  type ImportMcpSource,
  type ImportMcpTransport,
  type ImportScanOptions,
  type ImportScanPayload,
  type ImportSourceDiagnostic,
} from "./types";

/**
 * Ceiling on candidates produced *per source*. Six MCP sources exist, so a
 * scan returns at most 1200 small server rows.
 */
export const MCP_MAX_CANDIDATES = 200;

/** Config files above this size are reported as too large instead of parsed. */
export const MCP_MAX_FILE_BYTES = 8 * 1024 * 1024;

type JsonRecord = Record<string, unknown>;
type ServerEntries = Array<[string, JsonRecord]>;

function looksLikeServerDefinition(record: JsonRecord): boolean {
  return (
    typeof record.command === "string"
    || Array.isArray(record.command)
    || typeof record.url === "string"
    || typeof record.type === "string"
    || typeof record.transport === "string"
  );
}

/**
 * Standard JSON shapes: `{"mcpServers": {...}}`, `{"servers": {...}}`, or a
 * bare map of server definitions.
 */
function serverEntriesFromDocument(document: unknown): ServerEntries {
  const root = isRecord(document) ? document : {};
  const container = isRecord(root.mcpServers)
    ? root.mcpServers
    : isRecord(root.servers)
      ? root.servers
      : null;
  const source = container ?? root;
  const entries: ServerEntries = [];
  for (const [name, value] of Object.entries(source)) {
    if (name === "mcpServers" || name === "servers") continue;
    if (!isRecord(value)) continue;
    if (container === null && !looksLikeServerDefinition(value)) continue;
    entries.push([name, value]);
  }
  return entries;
}

/** opencode nests servers under `mcp` (with `local`/`remote` type tags). */
function serverEntriesFromOpenCode(document: unknown): ServerEntries {
  const root = isRecord(document) ? document : {};
  const container = isRecord(root.mcp)
    ? root.mcp
    : isRecord(root.mcpServers)
      ? root.mcpServers
      : {};
  const entries: ServerEntries = [];
  for (const [name, value] of Object.entries(container)) {
    if (isRecord(value)) entries.push([name, value]);
  }
  return entries;
}

function serverEntriesFromToml(text: string): ServerEntries {
  const parsed = parseTomlTables(text);
  const entries: ServerEntries = [];
  for (const [tableKey, fields] of parsed.tables) {
    if (!tableKey.startsWith("mcp_servers.")) continue;
    const name = tableKey.slice("mcp_servers.".length);
    if (!name) continue;
    entries.push([name, fields]);
  }
  return entries;
}

function candidateFromDefinition(
  source: ImportMcpSource,
  name: string,
  def: JsonRecord,
  filePath: string,
  destination: string,
): ImportMcpCandidate | null {
  const url = firstString(def.url);
  const declared = (firstString(def.type, def.transport) ?? "").toLowerCase();

  let command = firstString(def.command);
  let args = stringList(def.args);
  if (!command && Array.isArray(def.command)) {
    const parts = def.command.filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    if (parts.length > 0) {
      command = parts[0];
      args = [...parts.slice(1), ...args];
    }
  }

  let transport: ImportMcpTransport;
  if (url) transport = "http";
  else if (declared.includes("http") || declared.includes("sse")) transport = "http";
  else if (command) transport = "stdio";
  else return null;

  const hasSecret = hasNonEmptyStringValue(def.env)
    || hasNonEmptyStringValue(def.environment)
    || headersLookCredentialed(def.headers);
  const disabled = def.disabled === true || def.enabled === false;

  const externalId = name;
  return {
    kind: "mcp",
    id: `${source}:${externalId}`,
    source,
    externalId,
    filePath: toNativePath(filePath),
    destination,
    name,
    transport,
    command: transport === "stdio" ? command : undefined,
    args: transport === "stdio" && args.length > 0 ? args : undefined,
    url: url ? redactUrlCredentials(url) : undefined,
    disabled,
    hasSecret,
  };
}

function buildCandidates(
  source: ImportMcpSource,
  entries: ServerEntries,
  filePath: string,
  destination: string,
): { candidates: ImportMcpCandidate[]; truncated: boolean } {
  const candidates: ImportMcpCandidate[] = [];
  let truncated = false;
  for (const [name, def] of entries) {
    const candidate = candidateFromDefinition(source, name, def, filePath, destination);
    if (!candidate) continue;
    if (candidates.length >= MCP_MAX_CANDIDATES) {
      truncated = true;
      break;
    }
    candidates.push(candidate);
  }
  return { candidates, truncated };
}

function diagnostic(
  source: ImportMcpSource,
  filePath: string,
  exists: boolean,
  count: number,
  truncated: boolean,
  error?: string,
): ImportSourceDiagnostic {
  return sourceDiagnostic("mcp", source, filePath, exists, count, {
    truncated: truncated || undefined,
    error,
  });
}

async function scanJsonSource(
  source: ImportMcpSource,
  filePath: string,
  destination: string,
): Promise<ImportScanPayload> {
  const read = await readJsonFileCapped(filePath, MCP_MAX_FILE_BYTES);
  if (!read.exists) {
    return { sources: [diagnostic(source, filePath, false, 0, false)], candidates: [] };
  }
  if (read.error !== undefined) {
    return { sources: [diagnostic(source, filePath, true, 0, false, read.error)], candidates: [] };
  }
  const built = buildCandidates(source, serverEntriesFromDocument(read.data), filePath, destination);
  return {
    sources: [diagnostic(source, filePath, true, built.candidates.length, built.truncated)],
    candidates: built.candidates,
  };
}

async function scanTomlSource(
  source: ImportMcpSource,
  filePath: string,
  destination: string,
): Promise<ImportScanPayload> {
  const read = await readTextFileCapped(filePath, MCP_MAX_FILE_BYTES);
  if (!read.exists) {
    return { sources: [diagnostic(source, filePath, false, 0, false)], candidates: [] };
  }
  if (read.error !== undefined) {
    return { sources: [diagnostic(source, filePath, true, 0, false, read.error)], candidates: [] };
  }
  const built = buildCandidates(source, serverEntriesFromToml(read.text ?? ""), filePath, destination);
  return {
    sources: [diagnostic(source, filePath, true, built.candidates.length, built.truncated)],
    candidates: built.candidates,
  };
}

async function scanOpenCodeSource(
  filePath: string,
  destination: string,
): Promise<ImportScanPayload> {
  const source: ImportMcpSource = "opencode";
  const read = await readJsonFileCapped(filePath, MCP_MAX_FILE_BYTES);
  if (!read.exists) {
    return { sources: [diagnostic(source, filePath, false, 0, false)], candidates: [] };
  }
  if (read.error !== undefined) {
    return { sources: [diagnostic(source, filePath, true, 0, false, read.error)], candidates: [] };
  }
  const built = buildCandidates(source, serverEntriesFromOpenCode(read.data), filePath, destination);
  return {
    sources: [diagnostic(source, filePath, true, built.candidates.length, built.truncated)],
    candidates: built.candidates,
  };
}

/**
 * Scan all six MCP config locations concurrently. Duplicate server names from
 * the same product (Claude Code keeps two files) collapse on the deterministic
 * id, first source in order winning.
 */
export async function scanMcpImports(
  options: ImportScanOptions = {},
): Promise<ImportScanPayload> {
  const home = options.home ?? homedir();
  const destination = join(home, ".pi", "agent", "mcp.json");
  const payloads = await Promise.all([
    scanJsonSource("claude-desktop", join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"), destination),
    scanJsonSource("claude", join(home, ".claude.json"), destination),
    scanJsonSource("claude", join(home, ".claude", "settings.json"), destination),
    scanJsonSource("cursor", join(home, ".cursor", "mcp.json"), destination),
    scanTomlSource("codex", join(home, ".codex", "config.toml"), destination),
    scanOpenCodeSource(join(home, ".config", "opencode", "opencode.json"), destination),
  ]);
  const sources = payloads.flatMap((payload) => payload.sources);
  const byId = new Map<string, ImportMcpCandidate>();
  for (const payload of payloads) {
    for (const candidate of payload.candidates) {
      if (candidate.kind === "mcp" && !byId.has(candidate.id)) byId.set(candidate.id, candidate);
    }
  }
  return { sources, candidates: [...byId.values()] };
}
