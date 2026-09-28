/**
 * fork:import-scan — provider/model configuration scanner (PR-08 / PD-15).
 *
 * Sources (all read-only):
 *   ~/.claude/settings.json
 *   ~/.codex/config.toml
 *   ~/.config/opencode/opencode.json (+ auth.json)
 *   ~/.pi/agent/models.json
 *
 * Only `hasSecret: boolean` leaves this module. API keys, OAuth tokens, env
 * values and credential header values are detected and then discarded.
 *
 * The TOML subset parser also lives here because `mcp.ts` needs to read the
 * same `~/.codex/config.toml`; exporting it from one place avoids a second
 * hand-rolled parser for the same file.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { toNativePath } from "../paths";
import {
  firstString,
  headersLookCredentialed,
  isRecord,
  readJsonFileCapped,
  readTextFileCapped,
  redactUrlCredentials,
  sourceDiagnostic,
  uniqueStrings,
  type ImportModelApiStyle,
  type ImportModelCandidate,
  type ImportModelSource,
  type ImportScanOptions,
  type ImportScanPayload,
  type ImportSourceDiagnostic,
} from "./types";

/**
 * Ceiling on candidates produced *per source*. Four model sources exist, so a
 * scan returns at most 800 provider rows; each source walks sequentially.
 */
export const MODELS_MAX_CANDIDATES = 200;

/** Config files above this size are reported as too large instead of parsed. */
export const MODELS_MAX_FILE_BYTES = 8 * 1024 * 1024;

// ─── minimal TOML subset (shared with the MCP scanner) ───────────────────────

export type TomlValue = string | number | boolean | TomlValue[] | { [key: string]: TomlValue };

export interface TomlTables {
  root: Record<string, TomlValue>;
  tables: Map<string, Record<string, TomlValue>>;
}

export function parseTomlTables(text: string): TomlTables {
  const root: Record<string, TomlValue> = {};
  const tables = new Map<string, Record<string, TomlValue>>();
  let current = root;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    if (line.startsWith("[[")) continue;
    if (line.startsWith("[")) {
      const header = parseTableHeader(line);
      if (!header) continue;
      const existing = tables.get(header) ?? {};
      tables.set(header, existing);
      current = existing;
      continue;
    }
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim().replace(/^["']|["']$/g, "");
    const value = parseTomlValue(line.slice(equals + 1));
    if (!key || value === undefined) continue;
    current[key] = value;
  }
  return { root, tables };
}

function parseTableHeader(line: string): string | null {
  if (!line.startsWith("[") || !line.endsWith("]")) return null;
  const inner = line.slice(1, -1).trim();
  const parts: string[] = [];
  let rest = inner;
  while (rest.length > 0) {
    rest = rest.trimStart();
    if (rest.startsWith('"') || rest.startsWith("'")) {
      const quoted = parseQuoted(rest);
      if (!quoted) return null;
      parts.push(quoted.value);
      rest = quoted.rest.trimStart();
    } else {
      const match = rest.match(/^([A-Za-z0-9_-]+)/);
      if (!match) return null;
      parts.push(match[1]);
      rest = rest.slice(match[1].length).trimStart();
    }
    if (rest.startsWith(".")) {
      rest = rest.slice(1);
      continue;
    }
    break;
  }
  return parts.length > 0 ? parts.join(".") : null;
}

function stripTomlComment(line: string): string {
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) inString = false;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === "#") return line.slice(0, index);
  }
  return line;
}

function parseQuoted(input: string): { value: string; rest: string } | null {
  const quote = input[0];
  if (quote !== '"' && quote !== "'") return null;
  if (quote === "'") {
    const end = input.indexOf("'", 1);
    if (end < 0) return null;
    return { value: input.slice(1, end), rest: input.slice(end + 1) };
  }
  let out = "";
  for (let index = 1; index < input.length; index += 1) {
    const char = input[index];
    if (char === "\\") {
      const next = input[index + 1];
      if (next === undefined) return null;
      const escapes: Record<string, string> = { n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\" };
      out += escapes[next] ?? next;
      index += 1;
      continue;
    }
    if (char === '"') return { value: out, rest: input.slice(index + 1) };
    out += char;
  }
  return null;
}

function findTomlValueEnd(input: string, start: number): number {
  let depth = 0;
  let inString = false;
  let quote = "";
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (inString) {
      if (char === "\\" && quote === '"') {
        index += 1;
        continue;
      }
      if (char === quote) inString = false;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === "[" || char === "{") depth += 1;
    else if (char === "]" || char === "}") {
      if (depth === 0) return index;
      depth -= 1;
    } else if (char === "," && depth === 0) {
      return index;
    }
  }
  return input.length;
}

function parseTomlValue(raw: string): TomlValue | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    return parseQuoted(trimmed)?.value;
  }
  if (trimmed.startsWith("[")) return parseTomlArray(trimmed);
  if (trimmed.startsWith("{")) return parseTomlInlineTable(trimmed);
  if (/^true\b/.test(trimmed)) return true;
  if (/^false\b/.test(trimmed)) return false;
  const number = /^[+-]?(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(trimmed);
  if (number) {
    const parsed = Number(number[0]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function parseTomlArray(input: string): TomlValue[] | undefined {
  const out: TomlValue[] = [];
  let index = 1;
  while (index < input.length) {
    while (index < input.length && /[\s,]/.test(input[index])) index += 1;
    if (input[index] === "]") return out;
    const end = findTomlValueEnd(input, index);
    const value = parseTomlValue(input.slice(index, end));
    if (value === undefined) return undefined;
    out.push(value);
    index = end;
  }
  return undefined;
}

function parseTomlInlineTable(input: string): Record<string, TomlValue> | undefined {
  const out: Record<string, TomlValue> = {};
  let index = 1;
  while (index < input.length) {
    while (index < input.length && /[\s,]/.test(input[index])) index += 1;
    if (input[index] === "}") return out;
    const start = index;
    let equals = -1;
    let inString = false;
    let quote = "";
    for (; index < input.length; index += 1) {
      const char = input[index];
      if (inString) {
        if (char === "\\" && quote === '"') {
          index += 1;
          continue;
        }
        if (char === quote) inString = false;
        continue;
      }
      if (char === '"' || char === "'") {
        inString = true;
        quote = char;
        continue;
      }
      if (char === "=") {
        equals = index;
        break;
      }
      if (char === "}") break;
    }
    if (equals === -1) return undefined;
    const key = input.slice(start, equals).trim().replace(/^["']|["']$/g, "");
    const end = findTomlValueEnd(input, equals + 1);
    const value = parseTomlValue(input.slice(equals + 1, end));
    if (!key || value === undefined) return undefined;
    out[key] = value;
    index = end;
  }
  return undefined;
}

function tomlString(value: TomlValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function tomlStringList(value: TomlValue | undefined): string[] {
  if (typeof value === "string") {
    return value.split(",").map((part) => part.trim()).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.filter((part): part is string => typeof part === "string");
  }
  return [];
}

// ─── shared helpers ──────────────────────────────────────────────────────────

function apiStyleFrom(value: unknown): ImportModelApiStyle {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  if (!text) return "unknown";
  if (text.includes("anthropic")) return "anthropic_messages";
  if (text.includes("response")) return "responses";
  if (text.includes("chat") || text.includes("completion") || text.includes("openai")) {
    return "chat_completions";
  }
  return "unknown";
}

function modelIdsFromModels(value: unknown): string[] {
  if (isRecord(value)) {
    return uniqueStrings(Object.keys(value));
  }
  if (Array.isArray(value)) {
    return uniqueStrings(value.map((entry) => (isRecord(entry) ? entry.id : entry)));
  }
  return [];
}

function modelCandidate(
  source: ImportModelSource,
  providerId: string,
  filePath: string,
  destination: string,
  fields: {
    name: string;
    baseUrl: string | null;
    apiStyle: ImportModelApiStyle;
    modelIds: string[];
    hasSecret: boolean;
  },
): ImportModelCandidate {
  return {
    kind: "models",
    id: `${source}:${providerId}`,
    source,
    externalId: providerId,
    filePath: toNativePath(filePath),
    destination,
    name: fields.name,
    baseUrl: fields.baseUrl ? redactUrlCredentials(fields.baseUrl) : null,
    apiStyle: fields.apiStyle,
    modelIds: fields.modelIds,
    hasSecret: fields.hasSecret,
  };
}

function cappedDiagnostic(
  source: ImportModelSource,
  filePath: string,
  exists: boolean,
  count: number,
  truncated: boolean,
  error?: string,
): ImportSourceDiagnostic {
  return sourceDiagnostic("models", source, filePath, exists, count, {
    truncated: truncated || undefined,
    error,
  });
}

// ─── claude ──────────────────────────────────────────────────────────────────

async function scanClaudeModels(
  home: string,
  destination: string,
): Promise<ImportScanPayload> {
  const source: ImportModelSource = "claude";
  const filePath = join(home, ".claude", "settings.json");
  const read = await readJsonFileCapped(filePath, MODELS_MAX_FILE_BYTES);
  if (!read.exists) {
    return { sources: [cappedDiagnostic(source, filePath, false, 0, false)], candidates: [] };
  }
  if (read.error !== undefined) {
    return { sources: [cappedDiagnostic(source, filePath, true, 0, false, read.error)], candidates: [] };
  }

  const root = isRecord(read.data) ? read.data : {};
  const env = isRecord(root.env) ? root.env : {};
  const modelIds = uniqueStrings([
    root.model,
    env.ANTHROPIC_MODEL,
    env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
  ]);
  if (modelIds.length === 0) {
    return { sources: [cappedDiagnostic(source, filePath, true, 0, false)], candidates: [] };
  }
  const baseUrl = firstString(env.ANTHROPIC_BASE_URL, env.ANTHROPIC_API_URL) ?? null;
  const hasSecret = firstString(env.ANTHROPIC_API_KEY, env.ANTHROPIC_AUTH_TOKEN) !== undefined;
  const candidate = modelCandidate(source, "default", filePath, destination, {
    name: "Claude Code",
    baseUrl,
    apiStyle: "anthropic_messages",
    modelIds,
    hasSecret,
  });
  return { sources: [cappedDiagnostic(source, filePath, true, 1, false)], candidates: [candidate] };
}

// ─── codex ───────────────────────────────────────────────────────────────────

async function scanCodexModels(
  home: string,
  destination: string,
): Promise<ImportScanPayload> {
  const source: ImportModelSource = "codex";
  const filePath = join(home, ".codex", "config.toml");
  const read = await readTextFileCapped(filePath, MODELS_MAX_FILE_BYTES);
  if (!read.exists) {
    return { sources: [cappedDiagnostic(source, filePath, false, 0, false)], candidates: [] };
  }
  if (read.error !== undefined) {
    return { sources: [cappedDiagnostic(source, filePath, true, 0, false, read.error)], candidates: [] };
  }

  const parsed = parseTomlTables(read.text ?? "");
  const defaultModel = tomlString(parsed.root.model);
  const candidates: ImportModelCandidate[] = [];
  let truncated = false;
  for (const [tableKey, fields] of parsed.tables) {
    if (!tableKey.startsWith("model_providers.")) continue;
    const providerId = tableKey.slice("model_providers.".length);
    if (!providerId) continue;
    const modelIds = uniqueStrings([defaultModel, ...tomlStringList(fields.models)]);
    if (modelIds.length === 0) continue;
    if (candidates.length >= MODELS_MAX_CANDIDATES) {
      truncated = true;
      break;
    }
    const envKey = tomlString(fields.env_key) ?? tomlString(fields.envKey);
    const hasSecret = tomlString(fields.api_key) !== undefined || envKey !== undefined;
    candidates.push(modelCandidate(source, providerId, filePath, destination, {
      name: tomlString(fields.name) ?? tomlString(fields.label) ?? providerId,
      baseUrl: tomlString(fields.base_url) ?? tomlString(fields.baseUrl) ?? null,
      apiStyle: apiStyleFrom(tomlString(fields.wire_api) ?? tomlString(fields.wireApi)),
      modelIds,
      hasSecret,
    }));
  }
  return {
    sources: [cappedDiagnostic(source, filePath, true, candidates.length, truncated)],
    candidates,
  };
}

// ─── opencode ────────────────────────────────────────────────────────────────

function openCodeAuthPaths(home: string): string[] {
  return [
    join(home, ".config", "opencode", "auth.json"),
    join(home, ".local", "share", "opencode", "auth.json"),
  ];
}

async function scanOpenCodeModels(
  home: string,
  destination: string,
): Promise<ImportScanPayload> {
  const source: ImportModelSource = "opencode";
  const configPath = join(home, ".config", "opencode", "opencode.json");
  const diagnostics: ImportSourceDiagnostic[] = [];

  const configRead = await readJsonFileCapped(configPath, MODELS_MAX_FILE_BYTES);

  const authPaths = openCodeAuthPaths(home);
  const authPath = authPaths.find((candidate) => existsSync(candidate)) ?? authPaths[0];
  let auth: Record<string, unknown> = {};
  if (existsSync(authPath)) {
    const authRead = await readJsonFileCapped(authPath, MODELS_MAX_FILE_BYTES);
    if (authRead.error !== undefined) {
      diagnostics.push(cappedDiagnostic(source, authPath, true, 0, false, authRead.error));
    } else if (isRecord(authRead.data)) {
      auth = authRead.data;
    }
  } else {
    diagnostics.push(cappedDiagnostic(source, authPath, false, 0, false));
  }

  if (!configRead.exists) {
    diagnostics.unshift(cappedDiagnostic(source, configPath, false, 0, false));
    return { sources: diagnostics, candidates: [] };
  }
  if (configRead.error !== undefined) {
    diagnostics.unshift(cappedDiagnostic(source, configPath, true, 0, false, configRead.error));
    return { sources: diagnostics, candidates: [] };
  }

  const root = isRecord(configRead.data) ? configRead.data : {};
  const providers = isRecord(root.provider)
    ? root.provider
    : isRecord(root.providers)
      ? root.providers
      : {};
  const candidates: ImportModelCandidate[] = [];
  let truncated = false;
  for (const [providerId, raw] of Object.entries(providers)) {
    if (!isRecord(raw)) continue;
    const modelIds = modelIdsFromModels(raw.models);
    if (modelIds.length === 0) continue;
    if (candidates.length >= MODELS_MAX_CANDIDATES) {
      truncated = true;
      break;
    }
    const options = isRecord(raw.options) ? raw.options : {};
    const authEntry = isRecord(auth[providerId]) ? auth[providerId] : {};
    const hasSecret = [
      raw.apiKey,
      options.apiKey,
      authEntry.key,
      authEntry.access,
      authEntry.refresh,
      authEntry.token,
    ].some((value) => typeof value === "string" && value.trim().length > 0)
      || headersLookCredentialed(options.headers)
      || headersLookCredentialed(raw.headers);
    const baseUrl = firstString(
      options.baseURL,
      options.baseUrl,
      raw.baseURL,
      raw.baseUrl,
    ) ?? null;
    candidates.push(modelCandidate(source, providerId, configPath, destination, {
      name: firstString(raw.name, raw.label) ?? providerId,
      baseUrl,
      apiStyle: apiStyleFrom(firstString(raw.api, options.api, raw.apiStyle, raw.type)),
      modelIds,
      hasSecret,
    }));
  }

  diagnostics.unshift(cappedDiagnostic(source, configPath, true, candidates.length, truncated));
  return { sources: diagnostics, candidates };
}

// ─── pi ──────────────────────────────────────────────────────────────────────

async function scanPiModels(
  home: string,
  destination: string,
): Promise<ImportScanPayload> {
  const source: ImportModelSource = "pi";
  const filePath = join(home, ".pi", "agent", "models.json");
  const read = await readJsonFileCapped(filePath, MODELS_MAX_FILE_BYTES);
  if (!read.exists) {
    return { sources: [cappedDiagnostic(source, filePath, false, 0, false)], candidates: [] };
  }
  if (read.error !== undefined) {
    return { sources: [cappedDiagnostic(source, filePath, true, 0, false, read.error)], candidates: [] };
  }

  const root = isRecord(read.data) ? read.data : {};
  const providers = isRecord(root.providers) ? root.providers : {};
  const candidates: ImportModelCandidate[] = [];
  let truncated = false;
  for (const [providerId, raw] of Object.entries(providers)) {
    if (!isRecord(raw)) continue;
    const modelIds = modelIdsFromModels(raw.models);
    if (modelIds.length === 0) continue;
    if (candidates.length >= MODELS_MAX_CANDIDATES) {
      truncated = true;
      break;
    }
    const hasSecret = firstString(raw.apiKey, raw.api_key) !== undefined
      || headersLookCredentialed(raw.headers);
    candidates.push(modelCandidate(source, providerId, filePath, destination, {
      name: firstString(raw.name, raw.label) ?? providerId,
      baseUrl: firstString(raw.baseUrl, raw.baseURL, raw.url) ?? null,
      apiStyle: apiStyleFrom(firstString(raw.api, raw.apiStyle, raw.type)),
      modelIds,
      hasSecret,
    }));
  }
  return {
    sources: [cappedDiagnostic(source, filePath, true, candidates.length, truncated)],
    candidates,
  };
}

// ─── aggregator ──────────────────────────────────────────────────────────────

/**
 * Scan the four provider stores concurrently, each capped independently.
 * Deduplicates by deterministic id (first source in order wins).
 */
export async function scanModelImports(
  options: ImportScanOptions = {},
): Promise<ImportScanPayload> {
  const home = options.home ?? homedir();
  const destination = join(home, ".pi", "agent", "models.json");
  const payloads = await Promise.all([
    scanClaudeModels(home, destination),
    scanCodexModels(home, destination),
    scanOpenCodeModels(home, destination),
    scanPiModels(home, destination),
  ]);
  const sources = payloads.flatMap((payload) => payload.sources);
  const byId = new Map<string, ImportModelCandidate>();
  for (const payload of payloads) {
    for (const candidate of payload.candidates) {
      if (candidate.kind === "models" && !byId.has(candidate.id)) byId.set(candidate.id, candidate);
    }
  }
  return { sources, candidates: [...byId.values()] };
}
