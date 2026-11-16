// The settings that come from pi's own files — the MCP servers of both
// mcp.json files and their tests.
//
// Ported from pi-web's:
//   app/api/mcp/route.ts, app/api/mcp/test/route.ts
// and the libs behind them (`lib/mcp-config-read.ts`, `lib/mcp-config-file.ts`,
// `lib/mcp-override.ts`, `lib/mcp-secrets.ts`, `lib/mcp-status.ts`,
// `lib/mcp-undo.ts`, `lib/project-trust.ts`).
//
// What changed is where the data comes from. There is no Node/Next process:
//
//   ~/.pi/agent/mcp.json          user-level servers
//   <cwd>/.pi/mcp.json            project servers / overrides
//   ~/.pi/agent/trust.json        whether a project file may be written
//   ~/.pi/agent/mcp-auth.json     OAuth sign-in state
//
// GET reads the files only: it never spawns a server, opens a connection, or
// runs a `!command`, so it is safe on an untrusted folder. POST edits one file
// under an mkdir lock with a temp-file rename, changing only the bytes of the
// edited member, so comments, key order, indentation and unrelated entries
// survive. Test runs `pi mcp list --json` once and picks the requested server
// out of the answer.
//
// `/api/mcp/sign-in/**` is a background `pi mcp login <server>` run: the
// command owns the browser, the loopback callback and `mcp-auth.json`, while
// this file keeps the flow the panel polls and cancels.
import { mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import process, { spawn, type ChildProcess, type ExitResult } from "process";
import { runAsync as run } from "./run-async";
import { dataDirectory, loginShell, quoteShell } from "../pi/install";
import { piExecutable } from "../pi/rpc";
import { resolveExistingPath } from "./file-routes";
import {
  describe,
  errorResponse,
  homeDirectory,
  isInside,
  jsonResponse,
  piAgentDirectory,
  type LocalRequest,
  type LocalResponse,
} from "./request";

type McpScope = "global" | "project";
type McpExposure = "codemode" | "deferred" | "direct" | "hidden";
type McpTransport = "stdio" | "http";

const MCP_EXPOSURES: readonly McpExposure[] = ["codemode", "deferred", "direct", "hidden"];
const MCP_OVERRIDE_KEYS = ["enabled", "exposure", "toolExposure"] as const;
const PROJECT_MCP_CONFIG_MAX_BYTES = 1024 * 1024;
const PROJECT_MCP_MAX_SERVERS = 200;
const MCP_UNDO_TTL_MS = 60_000;
const MCP_UNDO_MAX_RECORDS = 100;
const WRITE_LOCK_TIMEOUT_MS = 8_000;
const WRITE_LOCK_STALE_MS = 10_000;
const PI_LIST_TIMEOUT_MS = 120_000;
const MCP_TEMPLATE_REFERENCE = /\$(?:[$!]|\{([^}]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g;
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SERVER_NAME = /^[A-Za-z0-9_-]+$/;

interface ConfigProblem {
  reason: string;
  error: string;
}

interface ConfigFileInfo {
  scope: McpScope;
  path: string;
  realPath?: string;
  exists: boolean;
  problems: ConfigProblem[];
  autoEnableCodemode?: boolean;
}

interface ConfigEntry {
  name: string;
  value: unknown;
}

interface ConfigRead {
  info: ConfigFileInfo;
  entries: ConfigEntry[];
}

interface TestTool {
  name: string;
  description?: string;
  readOnly: boolean;
  exposure?: McpExposure;
}

interface TestResult {
  state: "connected" | "needs-auth" | "failed";
  error?: string;
  stderr?: string;
  timedOut?: boolean;
  queueTimedOut?: boolean;
  tools: TestTool[];
  toolCount: number;
  serverInfo?: { name: string; version: string; title?: string };
  cwd?: string;
  durationMs: number;
  queuedMs?: number;
  testedAt: number;
  resources?: true;
  afterSignIn?: true;
}

interface SessionStatus {
  origin: "session";
  state: string;
  sessionId: string;
  cwd: string;
  updatedAt: number;
  error?: string;
  closedAt?: number;
}

type ServerStatus = ({ origin: "test" } & TestResult) | SessionStatus;

interface ServerInfo {
  name: string;
  scope: McpScope;
  sourcePath: string;
  configKey: string;
  enabled: boolean;
  validated: boolean;
  invalidError?: string;
  notAnObject?: true;
  transport?: McpTransport;
  exposure?: McpExposure;
  toolExposureCount?: number;
  description?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  envNames: string[];
  url?: string;
  headerNames: string[];
  usesOAuth: boolean;
  authProvider?: string;
  signedIn?: boolean;
  oauthStateStored?: boolean;
  commandFields: { kind: string; name?: string }[];
  variableReferences: { kind: string; name?: string; variables: string[] }[];
  webPasswordField?: { kind: string; name?: string };
  masked: boolean;
  shadowedByProject?: boolean;
  replacesGlobal?: boolean;
  override?: { keys: string[] };
  overriddenByProject?: boolean;
  status?: ServerStatus;
}

interface DescribedServer {
  info: ServerInfo;
  loads: boolean;
  sendsProviderToken: boolean;
  value: unknown;
  config?: Record<string, unknown>;
}

interface DescribeContext {
  authState: AuthState;
  revealProjectCommands: boolean;
}

interface TrustStatus {
  requiresTrust: boolean;
  trusted: boolean;
  decision: boolean | null;
  decisionPath?: string;
  inherited: boolean;
  decisionError?: string;
}

type AuthState = Map<string, { signedIn: boolean }> | undefined;

interface WriteTarget {
  scope: "global";
  path: string;
  realPath: string;
  agentDir: string;
}

interface ProjectWriteTarget {
  scope: "project";
  path: string;
  realPath: string;
  cwd: string;
}

type Target = WriteTarget | ProjectWriteTarget;

type WriteReason =
  | "unparsable"
  | "invalid-shape"
  | "server-missing"
  | "name-taken"
  | "not-a-file"
  | "too-large"
  | "locked"
  | "unreadable"
  | "trust-unreadable"
  | "project-untrusted";

class LocalMcpWriteError extends Error {
  readonly reason: WriteReason;
  readonly path: string;
  readonly serverName?: string;

  constructor(reason: WriteReason, filePath: string, message: string, serverName?: string) {
    super(message);
    this.name = "LocalMcpWriteError";
    this.reason = reason;
    this.path = filePath;
    if (serverName !== undefined) this.serverName = serverName;
  }
}

interface MutationResult<T> {
  text: string;
  value: T;
}

interface HeldRemoval {
  token: string;
  scope: McpScope;
  name: string;
  path: string;
  cwd?: string;
  entry: unknown;
  index: number;
  expiresAt: number;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function errorCode(cause: unknown): string | undefined {
  return isRecordValue(cause) && typeof cause.code === "string" ? cause.code : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function globalMcpConfigPath(agentDir: string): string {
  return path.join(agentDir, "mcp.json");
}

function projectMcpConfigPath(cwd: string): string {
  return path.join(cwd, ".pi", "mcp.json");
}

function problem(info: ConfigFileInfo, reason: string, error: string): void {
  info.problems.push({ reason, error });
}

function displayPath(value: string): string {
  const home = homeDirectory();
  if (value === home) return "~";
  if (value.startsWith(`${home}${path.sep}`)) return `~${value.slice(home.length)}`;
  return value;
}

// ---------------------------------------------------------------------------
// JSON with comments and trailing commas
// ---------------------------------------------------------------------------

function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match) => {
      if (match[0] === '"') return match;
      return match[1] === "*" ? " " : "";
    })
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, tail?: string) => tail ?? (match[0] === '"' ? match : ""));
}

function parseJsonc(text: string): unknown {
  return JSON.parse(stripJsonComments(text.replace(/^\uFEFF/, "")));
}

/** A parser message that never quotes the file's source text (which may hold a secret). */
function safeJsonError(cause: unknown, text: string): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (!message.includes('"')) return message;
  const position = /at position\s+(\d+)/i.exec(message);
  if (position) return `Unexpected token in JSON at position ${position[1]}`;
  if (text.length === 0) return "Unexpected end of JSON input";
  return "Not valid JSON";
}

// ---------------------------------------------------------------------------
// Config keys and statuses
// ---------------------------------------------------------------------------

const CONFIG_KEY_MAX_DEPTH = 64;
const TOO_DEEP = "<too deep>";

function canonicalJson(value: unknown, depth = 0): string {
  if (Array.isArray(value) || isRecordValue(value)) {
    if (depth >= CONFIG_KEY_MAX_DEPTH) return TOO_DEEP;
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, depth + 1)).join(",")}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A stable, non-reversible-enough identifier of an entry's content for this process. */
function configKeyOf(value: unknown): string {
  const text = canonicalJson(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= code + index;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(36)}${h2.toString(36)}`;
}

const STATUS_KEY: symbol = Symbol.for("pi-next:local-mcp-status");

function statusTree(): Map<string, Map<string, ServerStatus>> {
  const store = globalThis as unknown as Record<symbol, Map<string, Map<string, ServerStatus>> | undefined>;
  return (store[STATUS_KEY] ??= new Map());
}

function statusEntryKey(scope: McpScope, sourcePath: string, name: string): string {
  return `${scope}\0${sourcePath}\0${name}`;
}

function recordStatus(info: ServerInfo, status: ServerStatus): void {
  const tree = statusTree();
  const key = statusEntryKey(info.scope, info.sourcePath, info.name);
  const held = tree.get(key) ?? new Map<string, ServerStatus>();
  held.delete(info.configKey);
  held.set(info.configKey, status);
  tree.delete(key);
  tree.set(key, held);
  while (tree.size > 500) tree.delete(tree.keys().next().value as string);
}

function attachStatuses(servers: ServerInfo[], files: readonly ConfigFileInfo[]): ServerInfo[] {
  const tree = statusTree();
  const listed = new Set(servers.map((server) => statusEntryKey(server.scope, server.sourcePath, server.name)));
  const readable = new Set(
    files
      .filter((file) => !file.problems.some((item) => item.reason !== "auto-enable-codemode-invalid"))
      .map((file) => `${file.scope}\0${file.path}\0`),
  );
  for (const key of [...tree.keys()]) {
    const fileKey = key.slice(0, key.lastIndexOf("\0") + 1);
    if (readable.has(fileKey) && !listed.has(key)) tree.delete(key);
  }
  return servers.map((server) => {
    const key = statusEntryKey(server.scope, server.sourcePath, server.name);
    const held = tree.get(key);
    if (!held) return server;
    const status = held.get(server.configKey);
    for (const other of [...held.keys()]) if (other !== server.configKey) held.delete(other);
    if (held.size === 0) tree.delete(key);
    return status ? { ...server, status } : server;
  });
}

// ---------------------------------------------------------------------------
// MCP config validation and description
// ---------------------------------------------------------------------------

const MCP_EXPOSURE_ALIASES: Record<string, McpExposure> = { "codemode-deferred": "codemode" };
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isExposure(value: unknown): value is McpExposure {
  return typeof value === "string" && (MCP_EXPOSURES as readonly string[]).includes(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecordValue(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isLoopbackUrl(value: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isLoopbackRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname) && url.search === "" && url.hash === "";
  } catch {
    return false;
  }
}

function validateOAuth(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!isRecordValue(value)) return "oauth must be an object";
  if (value.clientId !== undefined && typeof value.clientId !== "string") return "oauth.clientId must be a string";
  if (value.clientSecret !== undefined && typeof value.clientSecret !== "string") return "oauth.clientSecret must be a string";
  if (
    value.callbackPort !== undefined
    && (typeof value.callbackPort !== "number" || !Number.isInteger(value.callbackPort) || value.callbackPort < 1 || value.callbackPort > 65535)
  ) {
    return "oauth.callbackPort must be a port number";
  }
  if (value.callbackUrl !== undefined) {
    if (typeof value.callbackUrl !== "string" || !isLoopbackRedirect(value.callbackUrl)) {
      return "oauth.callbackUrl must be an http URI on localhost, 127.0.0.1, or [::1] without query or fragment";
    }
    const port = new URL(value.callbackUrl).port;
    if (port && value.callbackPort !== undefined && Number(port) !== value.callbackPort) {
      return "oauth.callbackUrl and oauth.callbackPort name different ports";
    }
  }
  if (value.scope !== undefined && typeof value.scope !== "string") return "oauth.scope must be a string";
  if (value.clientName !== undefined && (typeof value.clientName !== "string" || !value.clientName.trim())) {
    return "oauth.clientName must be a non-empty string";
  }
  if (value.clientRegistration !== undefined) {
    if (value.clientRegistration !== "dcr" && value.clientRegistration !== "cimd") {
      return 'oauth.clientRegistration must be "dcr" or "cimd"';
    }
    if (value.clientRegistration === "cimd" && (value.clientId !== undefined || value.clientName !== undefined)) {
      return 'oauth.clientRegistration "cimd" cannot be combined with oauth.clientId or oauth.clientName';
    }
  }
  if (value.authServerMetadataUrl !== undefined) {
    const metadata = value.authServerMetadataUrl;
    let allowed = false;
    try {
      const url = new URL(String(metadata));
      allowed = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
    } catch {
      allowed = false;
    }
    if (!allowed) return "oauth.authServerMetadataUrl must be an https URL, or http on localhost, 127.0.0.1, or [::1]";
  }
  return undefined;
}

function validateMcpServerConfig(name: string, raw: unknown): Record<string, unknown> | string {
  if (!SERVER_NAME.test(name)) return `invalid server name "${name}" (use letters, digits, "_" and "-")`;
  if (!isRecordValue(raw)) return `server "${name}" must be an object`;
  const value: Record<string, unknown> = { ...raw };
  if (typeof value.exposure === "string" && MCP_EXPOSURE_ALIASES[value.exposure]) {
    value.exposure = MCP_EXPOSURE_ALIASES[value.exposure];
  }
  if (isRecordValue(value.toolExposure)) {
    const resolved: Record<string, unknown> = {};
    for (const [tool, exposure] of Object.entries(value.toolExposure)) {
      resolved[tool] = typeof exposure === "string" ? MCP_EXPOSURE_ALIASES[exposure] ?? exposure : exposure;
    }
    value.toolExposure = resolved;
  }
  const { type, exposure, enabled, timeout, toolExposure, description } = value;
  const exposures = MCP_EXPOSURES.map((item) => `"${item}"`).join(", ");
  if (exposure !== undefined && !isExposure(exposure)) return `server "${name}": exposure must be one of ${exposures}`;
  if (toolExposure !== undefined) {
    if (!isRecordValue(toolExposure)) return `server "${name}": toolExposure must map tool names to exposures`;
    for (const [tool, item] of Object.entries(toolExposure)) {
      if (!isExposure(item)) return `server "${name}": toolExposure "${tool}" must be one of ${exposures}`;
    }
  }
  if (enabled !== undefined && typeof enabled !== "boolean") return `server "${name}": enabled must be a boolean`;
  if (description !== undefined && typeof description !== "string") return `server "${name}": description must be a string`;
  if (timeout !== undefined && (typeof timeout !== "number" || !(timeout > 0))) {
    return `server "${name}": timeout must be a positive number of seconds`;
  }
  if (type === "sse") return `server "${name}": legacy SSE transport is not supported; use the streamable HTTP URL`;
  if (typeof value.url === "string" && (type === undefined || type === "http" || type === "streamable-http")) {
    if (!isHttpUrl(value.url)) return `server "${name}": url must be an http or https URL`;
    if (value.headers !== undefined && !isStringRecord(value.headers)) return `server "${name}": headers must map names to strings`;
    const oauthError = validateOAuth(value.oauth);
    if (oauthError) return `server "${name}": ${oauthError}`;
    if (value.auth !== undefined) {
      if (!isRecordValue(value.auth) || typeof value.auth.provider !== "string" || !value.auth.provider) {
        return `server "${name}": auth.provider must be a provider name`;
      }
      const https = new URL(value.url).protocol === "https:";
      if (!https && !LOOPBACK_HOSTS.has(new URL(value.url).hostname)) {
        return `server "${name}": auth requires an https URL, or http on localhost, 127.0.0.1, or [::1]`;
      }
    }
    return value;
  }
  if (typeof value.command === "string" && (type === undefined || type === "stdio")) {
    if (value.args !== undefined && !(Array.isArray(value.args) && value.args.every((arg) => typeof arg === "string"))) {
      return `server "${name}": args must be an array of strings`;
    }
    if (value.env !== undefined && !isStringRecord(value.env)) return `server "${name}": env must map names to strings`;
    if (value.cwd !== undefined && typeof value.cwd !== "string") return `server "${name}": cwd must be a string`;
    return value;
  }
  return `server "${name}" needs either "command" (stdio) or "url" (streamable HTTP)`;
}

function isOverrideEntry(value: unknown): boolean {
  return isRecordValue(value) && value.command === undefined && value.url === undefined && value.type === undefined;
}

function overrideRefusal(name: string, value: Record<string, unknown>, hasBase: boolean): string | undefined {
  if (!hasBase) return `server "${name}" needs "command" or "url", or a global server to override`;
  const extra = Object.keys(value).some((key) => !(MCP_OVERRIDE_KEYS as readonly string[]).includes(key));
  return extra ? `server "${name}": an override can only set ${MCP_OVERRIDE_KEYS.join(", ")}` : undefined;
}

function transportOf(config: Record<string, unknown>, refused: boolean): McpTransport | undefined {
  if (refused) {
    const { type } = config;
    if (typeof config.url === "string" && (type === undefined || type === "http" || type === "streamable-http")) return "http";
    if (typeof config.command === "string" && (type === undefined || type === "stdio")) return "stdio";
    return undefined;
  }
  if ("url" in config) return "http";
  if ("command" in config) return "stdio";
  return undefined;
}

function mcpNamespace(name: string): string {
  return `mcp__${name.replace(/-/g, "_")}`;
}

function templateVariableNames(value: string): string[] {
  const names: string[] = [];
  for (const [, braced, bare] of value.matchAll(MCP_TEMPLATE_REFERENCE)) {
    const name = braced !== undefined ? (VARIABLE_NAME.test(braced) ? braced : undefined) : bare;
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}

interface ConfigField {
  kind: string;
  name?: string;
  value: string;
}

function configFields(config: Record<string, unknown>): ConfigField[] {
  const fields: ConfigField[] = [];
  for (const [kind, values] of [["env", config.env], ["header", config.headers]] as const) {
    if (!isRecordValue(values)) continue;
    for (const [name, value] of Object.entries(values)) {
      if (typeof value === "string") fields.push({ kind, name, value });
    }
  }
  if (isRecordValue(config.oauth) && typeof config.oauth.clientSecret === "string") {
    fields.push({ kind: "oauth-client-secret", value: config.oauth.clientSecret });
  }
  return fields;
}

function fieldRef(field: ConfigField): { kind: string; name?: string } {
  return field.name === undefined ? { kind: field.kind } : { kind: field.kind, name: field.name };
}

function authStateOf(state: AuthState, name: string, url: string): { signedIn: boolean; stored: boolean } | undefined {
  if (!state) return undefined;
  let key: string;
  let legacyKey: string;
  try {
    legacyKey = String(new URL(url));
    key = `mcp__${name.replace(/-/g, "_")}|${legacyKey}`;
  } catch {
    return undefined;
  }
  const record = state.get(key) ?? state.get(legacyKey);
  return { signedIn: record?.signedIn ?? false, stored: record !== undefined };
}

async function readAuthState(agentDir: string): Promise<AuthState> {
  const authPath = path.join(agentDir, "mcp-auth.json");
  let text: string;
  try {
    text = await readFile(authPath, "utf8");
  } catch {
    return undefined;
  }
  try {
    if (!text.trim()) return new Map();
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
    if (!isRecordValue(parsed)) return new Map();
    const state = new Map<string, { signedIn: boolean }>();
    for (const [key, value] of Object.entries(parsed)) {
      state.set(key, {
        signedIn: isRecordValue(value) && isRecordValue(value.tokens) && typeof value.tokens.access_token === "string",
      });
    }
    return state;
  } catch {
    return undefined;
  }
}

function describeServer(
  name: string,
  value: unknown,
  scope: McpScope,
  sourcePath: string,
  context: DescribeContext,
): DescribedServer {
  const validation = validateMcpServerConfig(name, value);
  const config: Record<string, unknown> = isRecordValue(value) ? value : {};
  const info: ServerInfo = {
    name,
    scope,
    sourcePath,
    configKey: configKeyOf(typeof validation === "string" ? value : validation),
    enabled: config.enabled !== false,
    validated: true,
    envNames: isRecordValue(config.env) ? Object.keys(config.env) : [],
    headerNames: isRecordValue(config.headers) ? Object.keys(config.headers) : [],
    usesOAuth: false,
    commandFields: [],
    variableReferences: [],
    masked: false,
  };
  if (typeof validation === "string") info.invalidError = validation;
  if (!isRecordValue(value)) info.notAnObject = true;
  const transport = transportOf(config, typeof validation === "string");
  if (transport) info.transport = transport;
  if (typeof validation !== "string") {
    info.exposure = isExposure(validation.exposure) ? validation.exposure : "codemode";
    const overrides = isRecordValue(validation.toolExposure) ? Object.keys(validation.toolExposure).length : 0;
    if (overrides > 0) info.toolExposureCount = overrides;
  }
  if (typeof config.description === "string" && config.description.trim()) info.description = config.description;

  const revealCommand = scope === "project" && context.revealProjectCommands;
  if (typeof config.command === "string") {
    const command = revealCommand ? { value: config.command, masked: false } : maskCommand(config.command);
    info.command = command.value;
    info.masked ||= command.masked;
  }
  if (Array.isArray(config.args)) {
    const strings = config.args.filter((arg): arg is string => typeof arg === "string");
    const args = revealCommand ? { args: strings, masked: false } : maskArgs(strings);
    info.args = args.args;
    info.masked ||= args.masked;
  }
  if (typeof config.cwd === "string") info.cwd = config.cwd;
  if (typeof config.url === "string") {
    const url = maskUrl(config.url);
    info.url = url.value;
    info.masked ||= url.masked;
  }
  if (transport === "http" && isRecordValue(config.auth) && typeof config.auth.provider === "string" && config.auth.provider) {
    info.authProvider = config.auth.provider;
  }
  info.usesOAuth = transport === "http"
    && !config.auth
    && !info.headerNames.some((header) => header.toLowerCase() === "authorization");
  if (info.usesOAuth && context.authState && typeof config.url === "string") {
    const stored = authStateOf(context.authState, name, config.url);
    if (stored) {
      info.signedIn = stored.signedIn;
      info.oauthStateStored = stored.stored;
    }
  }

  const fields = configFields(config);
  info.commandFields = fields.filter((field) => field.value.startsWith("!")).map(fieldRef);
  info.variableReferences = fields
    .filter((field) => !field.value.startsWith("!"))
    .map((field) => ({ ...fieldRef(field), variables: templateVariableNames(field.value) }))
    .filter((reference) => reference.variables.length > 0);
  const webPassword = fields.find((field) => field.value.toUpperCase().includes("PI_WEB_PASSWORD"));
  if (webPassword) info.webPasswordField = fieldRef(webPassword);

  const described: DescribedServer = {
    info,
    loads: typeof validation !== "string",
    sendsProviderToken: "url" in config && Boolean(config.auth),
    value,
    ...(typeof validation !== "string" ? { config: validation } : {}),
  };
  return described;
}

function describeOverride(
  name: string,
  value: Record<string, unknown>,
  base: DescribedServer | undefined,
  sourcePath: string,
  context: DescribeContext,
): DescribedServer {
  const keys = MCP_OVERRIDE_KEYS.filter((key) => hasOwn(value, key));
  const refused = overrideRefusal(name, value, base !== undefined);
  if (refused !== undefined || base === undefined) {
    const described = describeServer(name, value, "project", sourcePath, context);
    described.info.invalidError = refused;
    described.info.override = { keys };
    return { ...described, loads: false };
  }
  const merged = { ...(base.config ?? (isRecordValue(base.value) ? base.value : {})), ...value };
  const described = describeServer(name, merged, "project", sourcePath, { ...context, revealProjectCommands: false });
  described.info.override = { keys };
  return described;
}

function refuseAsLoaderDoes(described: DescribedServer[]): void {
  const loaded = new Set<string>();
  for (const server of described) {
    if (!server.loads || server.info.override) continue;
    const { info } = server;
    const clash = [...loaded].find((other) => other !== info.name && mcpNamespace(other) === mcpNamespace(info.name));
    if (clash !== undefined) {
      info.invalidError = `server "${info.name}" conflicts with "${clash}"`;
      server.loads = false;
      continue;
    }
    if (info.scope === "project" && server.sendsProviderToken) {
      info.invalidError = `server "${info.name}": auth is only allowed in the global mcp.json`;
      server.loads = false;
      continue;
    }
    loaded.add(info.name);
  }
}

// ---------------------------------------------------------------------------
// Reading the files
// ---------------------------------------------------------------------------

async function readConfigFile(scope: McpScope, filePath: string, maxBytes?: number): Promise<ConfigRead> {
  const info: ConfigFileInfo = { scope, path: filePath, exists: false, problems: [] };
  let text: string | undefined;
  try {
    const metadata = await stat(filePath);
    info.exists = true;
    if (!metadata.isFile()) {
      problem(info, "not-a-file", "not a regular file");
      return { info, entries: [] };
    }
    if (maxBytes !== undefined && metadata.size > maxBytes) {
      problem(info, "too-large", `larger than ${maxBytes} bytes`);
      return { info, entries: [] };
    }
    text = await readFile(filePath, "utf8");
  } catch (cause) {
    if (errorCode(cause) !== "ENOENT") {
      info.exists = true;
      problem(info, "unreadable", describe(cause));
    }
    return { info, entries: [] };
  }

  let parsed: unknown;
  try {
    parsed = parseJsonc(text);
  } catch (cause) {
    problem(info, "unparsable", safeJsonError(cause, text));
    return { info, entries: [] };
  }
  if (!isRecordValue(parsed) || (parsed.mcpServers !== undefined && !isRecordValue(parsed.mcpServers))) {
    problem(info, "invalid-shape", 'expected an object with an "mcpServers" object');
    return { info, entries: [] };
  }
  if (typeof parsed.autoEnableCodemode === "boolean") info.autoEnableCodemode = parsed.autoEnableCodemode;
  else if (parsed.autoEnableCodemode !== undefined) {
    problem(info, "auto-enable-codemode-invalid", "autoEnableCodemode must be a boolean");
  }
  const entries = Object.entries(isRecordValue(parsed.mcpServers) ? parsed.mcpServers : {});
  if (scope === "project" && entries.length > PROJECT_MCP_MAX_SERVERS) {
    problem(info, "too-many-servers", `declares ${entries.length} servers, more than ${PROJECT_MCP_MAX_SERVERS}`);
    return { info, entries: [] };
  }
  return { info, entries: entries.map(([name, value]) => ({ name, value })) };
}

interface LoadedServers {
  files: ConfigFileInfo[];
  servers: ServerInfo[];
  described: DescribedServer[];
}

async function readMcpServers(agentDir: string, cwd: string | undefined, projectTrusted: boolean): Promise<LoadedServers> {
  const global = await readConfigFile("global", globalMcpConfigPath(agentDir));
  const authState = await readAuthState(agentDir);
  const context: DescribeContext = {
    authState,
    revealProjectCommands: cwd !== undefined && !projectTrusted,
  };
  const described: DescribedServer[] = global.entries.map(({ name, value }) =>
    describeServer(name, value, "global", global.info.path, context));
  refuseAsLoaderDoes(described);
  const loadedGlobals = new Map(described.filter((server) => server.loads).map((server) => [server.info.name, server]));
  const files = [global.info];
  if (cwd !== undefined) {
    const project = await readConfigFile("project", projectMcpConfigPath(cwd), PROJECT_MCP_CONFIG_MAX_BYTES);
    files.push(project.info);
    for (const { name, value } of project.entries) {
      described.push(isRecordValue(value) && isOverrideEntry(value)
        ? describeOverride(name, value, loadedGlobals.get(name), project.info.path, context)
        : describeServer(name, value, "project", project.info.path, context));
    }
    refuseAsLoaderDoes(described);
  }

  const projectEntries = described.filter(({ info, loads }) => info.scope === "project" && loads);
  const projectNames = new Set(projectEntries.filter(({ info }) => !info.override).map(({ info }) => info.name));
  const overrideNames = new Set(projectEntries.filter(({ info }) => info.override).map(({ info }) => info.name));
  const shadowed = new Set<string>();
  for (const { info } of described) {
    if (info.scope !== "global") continue;
    if (projectNames.has(info.name)) {
      info.shadowedByProject = true;
      shadowed.add(info.name);
    }
    if (overrideNames.has(info.name)) info.overriddenByProject = true;
  }
  for (const { info } of described) {
    if (info.scope === "project" && shadowed.has(info.name)) info.replacesGlobal = true;
  }
  return { files, servers: described.map(({ info }) => info), described };
}

/**
 * The project's own `.pi/mcp.json`, read from the file only, for the trust
 * dialog: the file's own info and its entries in file order. The global file
 * is read too, only to tell which project entries replace one of their name;
 * nothing is connected, resolved, or run. `projectTrusted` decides whether a
 * command and its arguments are masked, exactly as `GET /api/mcp` shows them.
 */
export async function readProjectMcpListing(cwd: string, agentDir: string, projectTrusted: boolean) {
  const { files, servers } = await readMcpServers(agentDir, cwd, projectTrusted);
  const mcpFile = files.find((file) => file.scope === "project");
  if (!mcpFile) throw new Error("the project file was not read");
  return { mcpFile, mcpServers: servers.filter((server) => server.scope === "project") };
}

// ---------------------------------------------------------------------------
// Project trust, cwd checks and MCP availability
// ---------------------------------------------------------------------------

const TRUST_REQUIRING_ENTRIES = [
  "settings.json",
  "mcp.json",
  "extensions",
  "skills",
  "prompts",
  "themes",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
] as const;

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function hasTrustResources(cwd: string): Promise<boolean> {
  for (const entry of TRUST_REQUIRING_ENTRIES) {
    if (await pathExists(path.join(cwd, ".pi", entry))) return true;
  }
  const home = path.resolve(homeDirectory());
  for (let current = path.resolve(cwd); ; current = path.dirname(current)) {
    if (current !== home && await pathExists(path.join(current, ".agents", "skills"))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
  }
}

async function trustForProject(cwd: string, agentDir: string): Promise<TrustStatus> {
  const requiresTrust = await hasTrustResources(cwd);
  let canonical: string;
  try {
    canonical = await resolveExistingPath(cwd);
  } catch {
    canonical = path.resolve(cwd);
  }
  const trustPath = path.join(agentDir, "trust.json");
  let text: string;
  try {
    text = await readFile(trustPath, "utf8");
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") {
      return { requiresTrust, trusted: requiresTrust ? false : true, decision: null, inherited: false };
    }
    return {
      requiresTrust,
      trusted: requiresTrust ? false : true,
      decision: null,
      inherited: false,
      decisionError: describe(cause),
    };
  }

  let data: Record<string, boolean | null>;
  try {
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
    if (!isRecordValue(parsed)) throw new Error("expected an object");
    data = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value !== true && value !== false && value !== null) {
        throw new Error(`${JSON.stringify(key)} must be true, false, or null`);
      }
      data[key] = value;
    }
  } catch (cause) {
    return {
      requiresTrust,
      trusted: requiresTrust ? false : true,
      decision: null,
      inherited: false,
      decisionError: `Failed to read trust store ${trustPath}: ${describe(cause)}`,
    };
  }

  // `trust.json` keys are canonical paths, but a hand-written store (or a
  // folder opened through a link such as /tmp on macOS) may spell the same
  // folder differently. Check both spellings and take the nearest decision.
  const starts = [...new Set([canonical, path.resolve(cwd)])];
  let found: { decision: boolean | null; decisionPath: string } | undefined;
  for (const start of starts) {
    for (let current = start; ; current = path.dirname(current)) {
      if (hasOwn(data, current)) {
        if (!found || current.length > found.decisionPath.length) {
          found = { decision: data[current], decisionPath: current };
        }
        break;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
    }
  }
  if (found) {
    return {
      requiresTrust,
      trusted: requiresTrust ? found.decision === true : found.decision ?? true,
      decision: found.decision,
      decisionPath: found.decisionPath,
      inherited: found.decisionPath !== canonical,
    };
  }
  return { requiresTrust, trusted: requiresTrust ? false : true, decision: null, inherited: false };
}

async function resolveProject(raw: unknown): Promise<{ cwd: string } | { error: LocalResponse }> {
  if (typeof raw !== "string" || raw.trim() === "" || !path.isAbsolute(raw)) {
    return { error: errorResponse("cwd must be an absolute path", 400, { reason: "cwd-invalid" }) };
  }
  if (raw.split(/[\\/]/).includes("..")) {
    return { error: errorResponse("Access denied", 403, { reason: "cwd-denied" }) };
  }
  const cwd = path.resolve(raw);
  let allowed = false;
  try {
    const canonical = await resolveExistingPath(cwd);
    const roots = [homeDirectory(), process.dataDir].filter((root): root is string => typeof root === "string" && root !== "");
    for (const root of roots) {
      try {
        if (isInside(await resolveExistingPath(root), canonical)) {
          allowed = true;
          break;
        }
      } catch {
        // A root that cannot be resolved grants nothing.
      }
    }
  } catch {
    allowed = false;
  }
  if (!allowed) return { error: errorResponse("Access denied", 403, { reason: "cwd-denied" }) };
  try {
    const info = await stat(cwd);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    return { error: errorResponse("cwd must be a directory", 400, { reason: "cwd-not-directory" }) };
  }
  return { cwd };
}

async function readSettingsExtensions(settingsPath: string): Promise<string[] | undefined> {
  let text: string;
  try {
    text = await readFile(settingsPath, "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed = parseJsonc(text);
    if (!isRecordValue(parsed) || !Array.isArray(parsed.extensions)) return undefined;
    return parsed.extensions.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return undefined;
  }
}

function globMatches(pattern: string, value: string): boolean {
  if (!pattern.includes("*")) return pattern === value;
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`).test(value);
}

function resolveMcpExtension(list: readonly string[], initial: boolean): boolean {
  let enabled = initial;
  for (const entry of list) {
    const text = entry.trim();
    if (text === "") continue;
    const prefix = text[0];
    const pattern = prefix === "+" || prefix === "-" || prefix === "!" ? text.slice(1) : text;
    if (globMatches(pattern, "builtin:mcp")) enabled = prefix !== "-" && prefix !== "!";
  }
  return enabled;
}

interface Availability {
  mcp: { available: true } | { available: false; reason: string; error: string; settingsPath?: string };
  codemode: Record<string, unknown>;
}

async function mcpAvailability(agentDir: string, cwd: string | undefined, projectTrusted: boolean): Promise<Availability> {
  const codemode = { sandbox: { state: "not-checked" }, builtinDisabled: false };
  const disabled = process.env.PI_WEB_DISABLE_MCP?.trim().toLowerCase();
  if (disabled !== undefined && disabled !== "" && disabled !== "0" && disabled !== "false") {
    return {
      mcp: { available: false, reason: "operator-disabled", error: "PI_WEB_DISABLE_MCP is set" },
      codemode,
    };
  }
  const globalSettings = path.join(agentDir, "settings.json");
  let enabled = resolveMcpExtension((await readSettingsExtensions(globalSettings)) ?? [], true);
  let settingsPath = globalSettings;
  if (cwd !== undefined && projectTrusted) {
    const projectSettings = path.join(cwd, ".pi", "settings.json");
    const projectList = await readSettingsExtensions(projectSettings);
    if (projectList !== undefined) {
      const next = resolveMcpExtension(projectList, enabled);
      if (next !== enabled) settingsPath = projectSettings;
      enabled = next;
    }
  }
  if (!enabled) {
    return {
      mcp: {
        available: false,
        reason: "builtin-disabled",
        error: "the extensions setting turns builtin:mcp off",
        settingsPath,
      },
      codemode,
    };
  }
  return { mcp: { available: true }, codemode };
}

// ---------------------------------------------------------------------------
// Locked, atomic, minimal edits
// ---------------------------------------------------------------------------

async function targetRealPath(configured: string): Promise<string> {
  try {
    return await resolveExistingPath(configured);
  } catch {
    return path.resolve(configured);
  }
}

function writeTargetForGlobal(agentDir: string): Promise<WriteTarget> {
  const configured = globalMcpConfigPath(agentDir);
  return targetRealPath(configured).then((realPath) => ({ scope: "global" as const, path: configured, realPath, agentDir }));
}

async function writeTargetForProject(cwd: string): Promise<ProjectWriteTarget> {
  const configured = projectMcpConfigPath(cwd);
  return {
    scope: "project",
    path: configured,
    realPath: await targetRealPath(configured),
    cwd,
  };
}

async function withFileLock<T>(realPath: string, configuredPath: string, task: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(realPath), { recursive: true });
  const lock = `${realPath}.lock`;
  const deadline = Date.now() + WRITE_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (cause) {
      if (errorCode(cause) !== "EEXIST") throw cause;
      try {
        const info = await stat(lock);
        if (Date.now() - info.mtimeMs > WRITE_LOCK_STALE_MS) {
          await rmdir(lock);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new LocalMcpWriteError("locked", configuredPath, `${displayPath(configuredPath)}: another process holds its lock`);
      }
      await sleep(30);
    }
  }
  try {
    return await task();
  } finally {
    try {
      await rmdir(lock);
    } catch {
      // Another writer already cleaned it up.
    }
  }
}

async function writeAtomic(realPath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(realPath), { recursive: true });
  const temp = path.join(
    path.dirname(realPath),
    `.${path.basename(realPath)}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    await writeFile(temp, contents);
    await rename(temp, realPath);
  } catch (cause) {
    try {
      await unlink(temp);
    } catch {
      // Never created, or already renamed.
    }
    throw cause;
  }
}

interface WriteRead {
  text?: string;
  exists: boolean;
}

async function readWriteFile(target: Target): Promise<WriteRead> {
  let metadata: Awaited<ReturnType<typeof stat>>;
  try {
    metadata = await stat(target.realPath);
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return { exists: false };
    throw new LocalMcpWriteError("unreadable", target.path, `${displayPath(target.path)}: ${describe(cause)}`);
  }
  if (!metadata.isFile()) {
    throw new LocalMcpWriteError("not-a-file", target.path, `${displayPath(target.path)} is not a regular file`);
  }
  if (target.scope === "project" && metadata.size > PROJECT_MCP_CONFIG_MAX_BYTES) {
    throw new LocalMcpWriteError(
      "too-large",
      target.path,
      `${displayPath(target.path)}: larger than ${PROJECT_MCP_CONFIG_MAX_BYTES} bytes`,
    );
  }
  try {
    return { text: await readFile(target.realPath, "utf8"), exists: true };
  } catch (cause) {
    throw new LocalMcpWriteError("unreadable", target.path, `${displayPath(target.path)}: ${describe(cause)}`);
  }
}

async function mutateConfig<T>(
  target: Target,
  mutation: (text: string, exists: boolean) => MutationResult<T>,
): Promise<{ value: T; written: boolean; path: string; realPath: string }> {
  try {
    return await withFileLock(target.realPath, target.path, async () => {
      const current = await readWriteFile(target);
      if (current.exists) {
        let parsed: unknown;
        try {
          parsed = parseJsonc(current.text ?? "");
        } catch (cause) {
          throw new LocalMcpWriteError("unparsable", target.path, `${displayPath(target.path)}: ${safeJsonError(cause, current.text ?? "")}`);
        }
        if (!isRecordValue(parsed) || (parsed.mcpServers !== undefined && !isRecordValue(parsed.mcpServers))) {
          throw new LocalMcpWriteError(
            "invalid-shape",
            target.path,
            `${displayPath(target.path)}: expected an object with an "mcpServers" object`,
          );
        }
      }
      const before = current.text ?? "";
      const result = mutation(before, current.exists);
      if (result.text !== before) await writeAtomic(target.realPath, result.text);
      return { value: result.value, written: result.text !== before, path: target.path, realPath: target.realPath };
    });
  } catch (cause) {
    if (cause instanceof LocalMcpWriteError) throw cause;
    throw new LocalMcpWriteError("unreadable", target.path, `${displayPath(target.path)}: ${describe(cause)}`);
  }
}

interface EntryLocation {
  root: JsonObject;
  servers: JsonObject;
  member: JsonMember;
  entry: JsonObject | null;
  raw: unknown;
  index: number;
}

function entryLocation(text: string, name: string): EntryLocation | null {
  if (skipTrivia(text, 0) >= text.length) return null;
  const root = parseRootObject(text);
  if (!root) return null;
  const servers = objectAtPath(root, text, ["mcpServers"]);
  if (!servers) return null;
  const member = lastMember(servers, name);
  if (!member) return null;
  const scanned = scanValue(text, member.valueStart);
  const raw = parseJsonc(text.slice(scanned.start, scanned.end));
  return {
    root,
    servers,
    member,
    entry: scanned.object ?? null,
    raw,
    index: servers.members.indexOf(member),
  };
}

type ToggleOutcome =
  | { name: string; outcome: "changed" | "unchanged" }
  | { name: string; outcome: "missing" }
  | { name: string; outcome: "not-an-object" };

function applySetEnabled(text: string, name: string, enabled: boolean): MutationResult<ToggleOutcome> {
  const location = entryLocation(text, name);
  if (!location) return { text, value: { name, outcome: "missing" } };
  if (!isRecordValue(location.raw) || !location.entry) return { text, value: { name, outcome: "not-an-object" } };
  const keepDefaults = isOverrideEntry(location.raw);
  const hasEnabled = hasOwn(location.raw, "enabled");
  let next = text;
  if (!keepDefaults && enabled) {
    if (hasEnabled) next = removeFromObject(text, location.entry, "enabled");
  } else if (location.raw.enabled !== enabled) {
    next = setInObject(text, location.entry, "enabled", enabled);
  }
  return { text: next, value: { name, outcome: next !== text ? "changed" : "unchanged" } };
}

function applySetEnabledMany(text: string, names: readonly string[], enabled: boolean): MutationResult<ToggleOutcome[]> {
  let next = text;
  const value: ToggleOutcome[] = [];
  for (const name of names) {
    const result = applySetEnabled(next, name, enabled);
    next = result.text;
    value.push(result.value);
  }
  return { text: next, value };
}

function applySetExposure(text: string, name: string, exposure: McpExposure): MutationResult<ToggleOutcome> {
  const location = entryLocation(text, name);
  if (!location) return { text, value: { name, outcome: "missing" } };
  if (!isRecordValue(location.raw) || !location.entry) return { text, value: { name, outcome: "not-an-object" } };
  const keepDefaults = isOverrideEntry(location.raw);
  let next = text;
  if (exposure === "codemode" && !keepDefaults) {
    if (hasOwn(location.raw, "exposure")) next = removeFromObject(text, location.entry, "exposure");
  } else if (location.raw.exposure !== exposure) {
    next = setInObject(text, location.entry, "exposure", exposure);
  }
  return { text: next, value: { name, outcome: next !== text ? "changed" : "unchanged" } };
}

interface RemovedValue {
  entry: unknown;
  index: number;
}

function applyRemove(text: string, name: string, filePath: string): MutationResult<RemovedValue> {
  const location = entryLocation(text, name);
  if (!location) {
    throw new LocalMcpWriteError("server-missing", filePath, `${displayPath(filePath)} does not define MCP server "${name}"`, name);
  }
  return {
    text: removeFromObject(text, location.servers, name),
    value: { entry: location.raw, index: location.index },
  };
}

function stringifyMember(name: string, value: unknown, indent: string): string {
  if (indent === "") return `${JSON.stringify(name)}: ${JSON.stringify(value)}`;
  const serialized = JSON.stringify(value, null, indent) ?? "null";
  const lines = serialized.split("\n");
  const aligned = lines.map((line, index) => (index === 0 ? line : `${indent}${line}`)).join("\n");
  return `${JSON.stringify(name)}: ${aligned}`;
}

function insertInObjectAt(
  text: string,
  object: JsonObject,
  name: string,
  value: unknown,
  index: number | undefined,
): string {
  if (object.members.length === 0) return setInObject(text, object, name, value);
  const at = index === undefined ? object.members.length : Math.max(0, Math.min(index, object.members.length));
  if (at >= object.members.length) return setInObject(text, object, name, value);
  const target = object.members[at];
  const multiline = text.slice(object.start, object.end).includes("\n");
  if (!multiline) {
    return replaceRange(text, target.keyStart, target.keyStart, `${stringifyMember(name, value, "")}, `);
  }
  const lineStart = text.lastIndexOf("\n", Math.max(0, target.keyStart - 1)) + 1;
  const prefix = text.slice(lineStart, target.keyStart);
  const baseIndent = lineIndentAt(text, object.start) ?? "";
  const indent = lineIndentAt(text, target.keyStart) ?? `${baseIndent}  `;
  if (/^[ \t]*$/.test(prefix)) {
    return replaceRange(text, lineStart, lineStart, `${indent}${stringifyMember(name, value, indent)},\n`);
  }
  return replaceRange(text, target.keyStart, target.keyStart, `${stringifyMember(name, value, "")}, `);
}

function applyInsert(
  text: string,
  exists: boolean,
  name: string,
  entry: unknown,
  index: number | undefined,
  filePath: string,
): MutationResult<void> {
  if (!exists || text.trim() === "") {
    return {
      text: setKey(text, [], "mcpServers", { [name]: entry }),
      value: undefined,
    };
  }
  const root = parseRootObject(text);
  if (!root) throw new LocalMcpWriteError("invalid-shape", filePath, `${displayPath(filePath)}: expected a JSON object`);
  const servers = objectAtPath(root, text, ["mcpServers"]);
  if (!servers) {
    return {
      text: setKey(text, [], "mcpServers", { [name]: entry }),
      value: undefined,
    };
  }
  if (lastMember(servers, name)) {
    throw new LocalMcpWriteError("name-taken", filePath, `${displayPath(filePath)} already defines MCP server "${name}"`, name);
  }
  return { text: insertInObjectAt(text, servers, name, entry, index), value: undefined };
}

function applySetInProject(text: string, exists: boolean, name: string, enabled: boolean, filePath: string): MutationResult<ToggleOutcome> {
  const location = exists && text.trim() !== "" ? entryLocation(text, name) : null;
  if (!location) {
    if (!exists || text.trim() === "") {
      return { text: setKey(text, [], "mcpServers", { [name]: { enabled } }), value: { name, outcome: "changed" } };
    }
    const root = parseRootObject(text);
    if (!root) throw new LocalMcpWriteError("invalid-shape", filePath, `${displayPath(filePath)}: expected a JSON object`);
    const servers = objectAtPath(root, text, ["mcpServers"]);
    return {
      text: servers
        ? insertInObjectAt(text, servers, name, { enabled }, undefined)
        : setKey(text, [], "mcpServers", { [name]: { enabled } }),
      value: { name, outcome: "changed" },
    };
  }
  if (!isRecordValue(location.raw) || !location.entry) return { text, value: { name, outcome: "not-an-object" } };
  if (!isOverrideEntry(location.raw)) {
    throw new LocalMcpWriteError("name-taken", filePath, `${displayPath(filePath)} already defines MCP server "${name}"`, name);
  }
  let next = text;
  if (location.raw.enabled !== enabled) next = setInObject(text, location.entry, "enabled", enabled);
  return { text: next, value: { name, outcome: next !== text ? "changed" : "unchanged" } };
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

const UNDO_KEY: symbol = Symbol.for("pi-next:local-mcp-undo");

function undoStore(): Map<string, HeldRemoval> {
  const store = globalThis as unknown as Record<symbol, Map<string, HeldRemoval> | undefined>;
  return (store[UNDO_KEY] ??= new Map());
}

function newToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function holdRemoval(removal: Omit<HeldRemoval, "token" | "expiresAt">): HeldRemoval {
  const records = undoStore();
  const now = Date.now();
  for (const [token, record] of records) if (record.expiresAt <= now) records.delete(token);
  while (records.size >= MCP_UNDO_MAX_RECORDS) records.delete(records.keys().next().value as string);
  const held: HeldRemoval = { ...removal, token: newToken(), expiresAt: now + MCP_UNDO_TTL_MS };
  records.set(held.token, held);
  return held;
}

function takeRemoval(token: string): HeldRemoval | undefined {
  const records = undoStore();
  const held = records.get(token);
  if (!held) return undefined;
  records.delete(token);
  return held.expiresAt > Date.now() ? held : undefined;
}

function returnRemoval(held: HeldRemoval): void {
  if (held.expiresAt > Date.now()) undoStore().set(held.token, held);
}

// ---------------------------------------------------------------------------
// Overview and actions
// ---------------------------------------------------------------------------

async function buildOverview(cwd: string | undefined): Promise<Record<string, unknown>> {
  const agentDir = piAgentDirectory();
  const trust = cwd === undefined ? undefined : await trustForProject(cwd, agentDir);
  const availability = await mcpAvailability(agentDir, cwd, trust?.decision === true);
  const { files, servers } = await readMcpServers(agentDir, cwd, trust?.decision === true);
  const response: Record<string, unknown> = {
    mcp: availability.mcp,
    codemode: availability.codemode,
    files,
    servers: attachStatuses(servers, files),
  };
  if (cwd !== undefined) {
    response.project = { cwd, ...(trust ? { trust } : {}) };
  }
  return response;
}

async function overviewResponse(project: string | undefined, extra: Record<string, unknown> = {}): Promise<LocalResponse> {
  try {
    return jsonResponse({ ...(await buildOverview(project)), ...extra });
  } catch (cause) {
    return errorResponse(describe(cause), 500, { reason: "internal" });
  }
}

function writeRefusal(cause: unknown): LocalResponse {
  if (cause instanceof LocalMcpWriteError) {
    const extra: Record<string, unknown> = { reason: cause.reason, path: cause.path };
    if (cause.serverName !== undefined) extra.name = cause.serverName;
    return errorResponse(cause.message, cause.reason === "unreadable" ? 500 : 409, extra);
  }
  return errorResponse(describe(cause), 500, { reason: "internal" });
}

function writeTargetRefusal(cwd: string | undefined, trust: TrustStatus): LocalResponse | undefined {
  if (cwd === undefined) {
    return errorResponse("A project server needs the project's cwd", 400, { reason: "invalid-request" });
  }
  if (trust.decisionError !== undefined) {
    return errorResponse(trust.decisionError, 409, { reason: "trust-unreadable" });
  }
  if (trust.decision !== true) {
    return errorResponse(
      "The project is not trusted, so its .pi/mcp.json is not changed",
      403,
      { reason: "project-untrusted" },
    );
  }
  return undefined;
}

function mcpOffResponse(): LocalResponse | undefined {
  const disabled = process.env.PI_WEB_DISABLE_MCP?.trim().toLowerCase();
  if (disabled !== undefined && disabled !== "" && disabled !== "0" && disabled !== "false") {
    return errorResponse("PI_WEB_DISABLE_MCP is set, so this app changes no MCP server", 409, { reason: "mcp-off" });
  }
  return undefined;
}

function outcomeRefusal(outcome: ToggleOutcome, filePath: string): LocalResponse | undefined {
  if (outcome.outcome === "missing") {
    return errorResponse(`${displayPath(filePath)} does not define MCP server "${outcome.name}"`, 409, {
      reason: "server-missing",
      path: filePath,
      name: outcome.name,
    });
  }
  if (outcome.outcome === "not-an-object") {
    return errorResponse(
      `${displayPath(filePath)} defines MCP server "${outcome.name}" as something other than an object, so it has nothing to switch`,
      409,
      { reason: "entry-not-object", path: filePath, name: outcome.name },
    );
  }
  return undefined;
}

async function switchServer(
  project: string | undefined,
  server: { scope: McpScope; name: string },
  enabled: boolean,
): Promise<LocalResponse> {
  const off = mcpOffResponse();
  if (off) return off;
  const agentDir = piAgentDirectory();
  if (server.scope === "project") {
    if (project === undefined) return errorResponse("A project server needs the project's cwd", 400, { reason: "invalid-request" });
    const trust = await trustForProject(project, agentDir);
    const refused = writeTargetRefusal(project, trust);
    if (refused) return refused;
  }
  const target = server.scope === "global"
    ? await writeTargetForGlobal(agentDir)
    : await writeTargetForProject(project as string);
  try {
    const result = await mutateConfig(target, (text) => applySetEnabled(text, server.name, enabled));
    const refused = outcomeRefusal(result.value, target.path);
    if (refused) return refused;
  } catch (cause) {
    return writeRefusal(cause);
  }
  return overviewResponse(project);
}

async function switchServers(
  project: string | undefined,
  servers: readonly { scope: McpScope; name: string }[],
  enabled: boolean,
): Promise<LocalResponse> {
  const off = mcpOffResponse();
  if (off) return off;
  const agentDir = piAgentDirectory();
  const results = new Map<string, Record<string, unknown>>();
  const keyOf = (server: { scope: McpScope; name: string }) => `${server.scope}\0${server.name}`;
  for (const scope of ["global", "project"] as const) {
    const group = servers.filter((server) => server.scope === scope);
    if (group.length === 0) continue;
    let target: Target | undefined;
    if (scope === "global") {
      target = await writeTargetForGlobal(agentDir);
    } else if (project !== undefined) {
      const trust = await trustForProject(project, agentDir);
      const refused = writeTargetRefusal(project, trust);
      if (refused) {
        for (const server of group) results.set(keyOf(server), { ...server, error: "The project is not trusted", reason: "project-untrusted" });
        continue;
      }
      target = await writeTargetForProject(project);
    } else {
      for (const server of group) results.set(keyOf(server), { ...server, error: "A project server needs the project's cwd", reason: "invalid-request" });
      continue;
    }
    try {
      const mutation = await mutateConfig(target, (text) => applySetEnabledMany(text, group.map((server) => server.name), enabled));
      for (const outcome of mutation.value) {
        const server = { scope, name: outcome.name };
        const refused = outcomeRefusal(outcome, target.path);
        results.set(keyOf(server), refused
          ? { ...server, error: JSON.parse(refused.body ?? "{}").error, reason: outcome.outcome === "missing" ? "server-missing" : "entry-not-object" }
          : server);
      }
    } catch (cause) {
      const refused = writeRefusal(cause);
      const body = JSON.parse(refused.body ?? "{}") as { error?: string; reason?: string };
      for (const server of group) results.set(keyOf(server), { ...server, error: body.error, reason: body.reason });
    }
  }
  return overviewResponse(project, { results: servers.map((server) => results.get(keyOf(server)) ?? server) });
}

async function setServerExposure(
  project: string | undefined,
  server: { scope: McpScope; name: string },
  exposure: McpExposure,
): Promise<LocalResponse> {
  const off = mcpOffResponse();
  if (off) return off;
  const agentDir = piAgentDirectory();
  if (server.scope === "project") {
    if (project === undefined) return errorResponse("A project server needs the project's cwd", 400, { reason: "invalid-request" });
    const trust = await trustForProject(project, agentDir);
    const refused = writeTargetRefusal(project, trust);
    if (refused) return refused;
  }
  const target = server.scope === "global"
    ? await writeTargetForGlobal(agentDir)
    : await writeTargetForProject(project as string);
  try {
    const result = await mutateConfig(target, (text) => applySetExposure(text, server.name, exposure));
    const refused = outcomeRefusal(result.value, target.path);
    if (refused) return refused;
  } catch (cause) {
    return writeRefusal(cause);
  }
  return overviewResponse(project);
}

async function removeServer(
  project: string | undefined,
  server: { scope: McpScope; name: string },
): Promise<LocalResponse> {
  const off = mcpOffResponse();
  if (off) return off;
  const agentDir = piAgentDirectory();
  if (server.scope === "project") {
    if (project === undefined) return errorResponse("A project server needs the project's cwd", 400, { reason: "invalid-request" });
    const trust = await trustForProject(project, agentDir);
    const refused = writeTargetRefusal(project, trust);
    if (refused) return refused;
  }
  const target = server.scope === "global"
    ? await writeTargetForGlobal(agentDir)
    : await writeTargetForProject(project as string);
  let removed: RemovedValue;
  try {
    const result = await mutateConfig(target, (text) => applyRemove(text, server.name, target.path));
    removed = result.value;
  } catch (cause) {
    return writeRefusal(cause);
  }
  const held = holdRemoval({
    scope: server.scope,
    name: server.name,
    path: target.path,
    ...(target.scope === "project" ? { cwd: target.cwd } : {}),
    entry: removed.entry,
    index: removed.index,
  });
  return overviewResponse(project, {
    undo: {
      scope: server.scope,
      name: server.name,
      token: held.token,
      path: target.path,
      expiresInMs: Math.max(0, held.expiresAt - Date.now()),
    },
  });
}

async function undoRemoval(project: string | undefined, token: string): Promise<LocalResponse> {
  const off = mcpOffResponse();
  if (off) return off;
  const held = takeRemoval(token);
  if (!held) {
    return errorResponse(
      "Nothing to undo: the removal is unknown, already undone, or older than 60 seconds",
      410,
      { reason: "undo-unavailable" },
    );
  }
  const agentDir = piAgentDirectory();
  let target: Target;
  try {
    if (held.scope === "project") {
      if (held.cwd === undefined) throw new LocalMcpWriteError("unreadable", held.path, "The removed entry has no project folder");
      const resolved = await resolveProject(held.cwd);
      if ("error" in resolved) {
        returnRemoval(held);
        return resolved.error;
      }
      const trust = await trustForProject(resolved.cwd, agentDir);
      const refused = writeTargetRefusal(resolved.cwd, trust);
      if (refused) {
        returnRemoval(held);
        return refused;
      }
      target = await writeTargetForProject(resolved.cwd);
    } else {
      target = await writeTargetForGlobal(agentDir);
    }
    await mutateConfig(target, (text, exists) => applyInsert(text, exists, held.name, held.entry, held.index, target.path));
  } catch (cause) {
    returnRemoval(held);
    if (cause instanceof LocalMcpWriteError && cause.reason === "name-taken") {
      return errorResponse(
        `${displayPath(cause.path)} defines "${held.name}" again, so the removal is not undone`,
        409,
        { reason: "undo-name-taken", path: cause.path, name: held.name },
      );
    }
    return writeRefusal(cause);
  }
  return overviewResponse(project, { restored: { scope: held.scope, name: held.name } });
}

async function switchServerInProject(project: string | undefined, name: string, enabled: boolean): Promise<LocalResponse> {
  const off = mcpOffResponse();
  if (off) return off;
  if (project === undefined) return errorResponse("A project server needs the project's cwd", 400, { reason: "invalid-request" });
  const agentDir = piAgentDirectory();
  const trust = await trustForProject(project, agentDir);
  const refused = writeTargetRefusal(project, trust);
  if (refused) return refused;

  const listed = await readMcpServers(agentDir, project, trust.decision === true);
  const globalFile = listed.files.find((file) => file.scope === "global");
  const globalServer = listed.described.find((server) => server.info.scope === "global" && server.info.name === name);
  if (!globalServer) {
    return errorResponse(
      `${displayPath(globalFile?.path ?? globalMcpConfigPath(agentDir))} does not define MCP server "${name}"`,
      409,
      { reason: "server-missing", path: globalFile?.path ?? globalMcpConfigPath(agentDir), name },
    );
  }
  if (globalServer.info.notAnObject) {
    return errorResponse(`MCP server "${name}" is not an object`, 409, {
      reason: "entry-not-object",
      name,
    });
  }
  if (globalServer.info.invalidError !== undefined) {
    return errorResponse(globalServer.info.invalidError, 409, { reason: "server-invalid", name });
  }
  if (enabled && globalServer.info.webPasswordField) {
    return errorResponse(`"${name}" references PI_WEB_PASSWORD, so this app does not turn it on`, 409, {
      reason: "web-password",
      name,
    });
  }

  const target = await writeTargetForProject(project);
  try {
    const result = await mutateConfig(target, (text, exists) => applySetInProject(text, exists, name, enabled, target.path));
    const outcome = outcomeRefusal(result.value, target.path);
    if (outcome) return outcome;
  } catch (cause) {
    return writeRefusal(cause);
  }
  return overviewResponse(project);
}

function oauthUrlOf(config: unknown): string | undefined {
  if (!isRecordValue(config) || !("url" in config) || typeof config.url !== "string" || config.auth) return undefined;
  const headers = isRecordValue(config.headers) ? Object.keys(config.headers) : [];
  return headers.some((header) => header.toLowerCase() === "authorization") ? undefined : config.url;
}

async function signOutServer(
  project: string | undefined,
  server: { scope: McpScope; name: string },
): Promise<LocalResponse> {
  const off = mcpOffResponse();
  if (off) return off;
  const agentDir = piAgentDirectory();
  if (server.scope === "project") {
    if (project === undefined) return errorResponse("A project server needs the project's cwd", 400, { reason: "invalid-request" });
    const trust = await trustForProject(project, agentDir);
    const refused = writeTargetRefusal(project, trust);
    if (refused) return refused;
  }
  const listed = await readMcpServers(agentDir, project, project !== undefined);
  const target = listed.described.find((entry) => entry.info.scope === server.scope && entry.info.name === server.name);
  if (!target) {
    const file = listed.files.find((item) => item.scope === server.scope);
    return errorResponse(
      `${displayPath(file?.path ?? "")} does not define MCP server "${server.name}"`,
      409,
      { reason: "server-missing", path: file?.path, name: server.name },
    );
  }
  if (target.info.notAnObject) {
    return errorResponse(`MCP server "${server.name}" is not an object`, 409, { reason: "entry-not-object", name: server.name });
  }
  if (target.info.invalidError !== undefined) {
    return errorResponse(target.info.invalidError, 409, { reason: "server-invalid", name: server.name });
  }
  const config = target.config ?? (isRecordValue(target.value) ? target.value : {});
  const url = oauthUrlOf(config);
  if (url === undefined) {
    return errorResponse(
      `MCP server "${server.name}" does not use OAuth: only an HTTP server without an Authorization header does`,
      409,
      { reason: "sign-in-not-oauth", name: server.name },
    );
  }
  let legacyKey: string;
  try {
    legacyKey = String(new URL(url));
  } catch {
    return errorResponse(`MCP server "${server.name}" has an invalid URL`, 409, { reason: "server-invalid", name: server.name });
  }
  const key = `mcp__${server.name.replace(/-/g, "_")}|${legacyKey}`;
  const authPath = path.join(agentDir, "mcp-auth.json");
  const realPath = await targetRealPath(authPath);
  let removed = false;
  try {
    await withFileLock(realPath, authPath, async () => {
      let text: string;
      try {
        text = await readFile(realPath, "utf8");
      } catch (cause) {
        if (errorCode(cause) === "ENOENT") return;
        throw cause;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
      } catch {
        return;
      }
      if (!isRecordValue(parsed)) return;
      for (const authKey of [key, legacyKey]) {
        if (hasOwn(parsed, authKey)) {
          delete parsed[authKey];
          removed = true;
        }
      }
      if (removed) await writeAtomic(realPath, `${JSON.stringify(parsed, null, 2)}\n`);
    });
  } catch (cause) {
    return writeRefusal(cause);
  }
  return overviewResponse(project, { signedOut: { ...server, removed } });
}

// ---------------------------------------------------------------------------
// OAuth sign-in, through `pi mcp login`
//
// The old server ran the SDK's sign-in inside the Next process. Here the
// machine's own `pi` does exactly that: `pi mcp login <server>` connects once,
// opens the browser, waits for the loopback callback, stores the tokens in
// `mcp-auth.json`, and reconnects. The command outlives the request that
// started it, so each run is kept in a small global registry and the panel
// polls it by id (the old `McpSignInFlowInfo` phase, plus a simpler `state`
// and `message`/`url` for a caller that only needs those).
// ---------------------------------------------------------------------------

type SignInPhase =
  | "connecting"
  | "starting"
  | "authorize"
  | "finishing"
  | "done"
  | "failed"
  | "cancelled"
  | "expired";

type SignInState = "pending" | "done" | "failed" | "cancelled";

const SIGN_IN_ENDED: ReadonlySet<SignInPhase> = new Set<SignInPhase>(["done", "failed", "cancelled", "expired"]);
const MCP_SIGN_IN_TTL_MS = 5 * 60_000;
const MCP_SIGN_IN_KEEP_MS = 60_000;
const MCP_SIGN_IN_MAX_FLOWS = 100;
const MCP_SIGN_IN_TIMEOUT_SECONDS = MCP_SIGN_IN_TTL_MS / 1000;

interface SignInFlow {
  id: string;
  /** The server's name and URL: two entries with both share one sign-in. */
  key: string;
  scope: McpScope;
  name: string;
  cwd?: string;
  /** Where `pi mcp login` runs; not the project for a global entry. */
  runCwd: string;
  configKey: string;
  info: ServerInfo;
  phase: SignInPhase;
  startedAt: number;
  expiresAt: number;
  keepUntil?: number;
  authorizationUrl?: string;
  message?: string;
  error?: string;
  failure?: string;
  result?: TestResult;
  alreadySignedIn?: true;
  refreshed?: true;
  cancelled?: true;
  child?: ChildProcess;
  timer?: ReturnType<typeof setTimeout>;
  lines: string[];
}

const SIGN_IN_KEY: symbol = Symbol.for("pi-next:local-mcp-sign-in");

function signInFlows(): Map<string, SignInFlow> {
  const store = globalThis as unknown as Record<symbol, Map<string, SignInFlow> | undefined>;
  return (store[SIGN_IN_KEY] ??= new Map());
}

function signInStateOf(phase: SignInPhase): SignInState {
  if (phase === "done") return "done";
  if (phase === "failed" || phase === "expired") return "failed";
  if (phase === "cancelled") return "cancelled";
  return "pending";
}

function pruneSignInFlows(now = Date.now()): void {
  const flows = signInFlows();
  for (const [id, flow] of flows) {
    if (SIGN_IN_ENDED.has(flow.phase) && (flow.keepUntil ?? 0) <= now) flows.delete(id);
  }
  while (flows.size >= MCP_SIGN_IN_MAX_FLOWS) {
    const oldest = [...flows.values()].sort((left, right) => left.startedAt - right.startedAt)[0];
    if (oldest === undefined) break;
    try {
      oldest.child?.kill();
    } catch {
      // Already gone.
    }
    if (oldest.timer !== undefined) clearTimeout(oldest.timer);
    flows.delete(oldest.id);
  }
}

function signInResponse(flow: SignInFlow, joined = false): LocalResponse {
  const ended = SIGN_IN_ENDED.has(flow.phase);
  const now = Date.now();
  return jsonResponse({
    flowId: flow.id,
    // A caller that speaks the smaller shape gets an id and a state too.
    id: flow.id,
    configKey: flow.configKey,
    scope: flow.scope,
    name: flow.name,
    ...(flow.cwd !== undefined ? { cwd: flow.cwd } : {}),
    phase: flow.phase,
    state: signInStateOf(flow.phase),
    ...(flow.authorizationUrl !== undefined
      ? { authorizationUrl: flow.authorizationUrl, url: flow.authorizationUrl }
      : {}),
    ...(flow.message !== undefined ? { message: flow.message } : {}),
    expiresInMs: ended ? 0 : Math.max(0, flow.expiresAt - now),
    ...(flow.alreadySignedIn ? { alreadySignedIn: true as const } : {}),
    ...(flow.refreshed ? { refreshed: true as const } : {}),
    ...(flow.result ? { result: flow.result } : {}),
    ...(flow.failure !== undefined ? { failure: flow.failure } : {}),
    ...(flow.error !== undefined ? { error: flow.error } : {}),
    ...(flow.cancelled ? { cancelled: true as const } : {}),
    ...(joined ? { joined: true as const } : {}),
  });
}

function endSignIn(flow: SignInFlow, phase: SignInPhase): void {
  if (SIGN_IN_ENDED.has(flow.phase)) return;
  flow.phase = phase;
  flow.keepUntil = Date.now() + MCP_SIGN_IN_KEEP_MS;
  if (flow.timer !== undefined) {
    clearTimeout(flow.timer);
    flow.timer = undefined;
  }
  if (flow.result !== undefined && phase === "done") {
    recordStatus(flow.info, { origin: "test", ...flow.result });
  }
}

function connectedResult(flow: SignInFlow, toolCount: number, error?: string): TestResult {
  const testedAt = Date.now();
  return {
    state: error === undefined ? "connected" : "failed",
    ...(error === undefined ? {} : { error }),
    tools: [],
    toolCount,
    cwd: flow.runCwd,
    durationMs: Math.max(0, testedAt - flow.startedAt),
    testedAt,
    ...(error === undefined && !flow.alreadySignedIn ? { afterSignIn: true as const } : {}),
  };
}

function toolCountIn(lines: readonly string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const match = /\((?:(\d+) tools?)\)/.exec(lines[index] ?? "");
    if (match) return Number(match[1] ?? 0);
  }
  return 0;
}

function lastSignInLine(lines: readonly string[]): string | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    if (line !== "") return line;
  }
  return undefined;
}

function readSignInLine(flow: SignInFlow, raw: string): void {
  const line = raw.trim();
  flow.lines.push(line);
  while (flow.lines.length > 300) flow.lines.shift();
  if (line === "") return;

  const url = /(https?:\/\/[^\s]+)/.exec(line)?.[1];
  const isAuthorizationLine = /sign in to mcp server/i.test(line)
    || /in your browser/i.test(line)
    || (url !== undefined && /^https?:\/\//i.test(line));
  if (url !== undefined && isAuthorizationLine) {
    flow.authorizationUrl = url;
    flow.phase = "authorize";
    flow.message = `Sign in to MCP server "${flow.name}" in your browser: ${url}`;
  } else if (flow.authorizationUrl === undefined && /sign in to mcp server/i.test(line)) {
    flow.message = line;
    if (flow.phase === "connecting") flow.phase = "starting";
  }
  if (/already signed in to mcp server/i.test(line) || /signed in to mcp server/i.test(line)) {
    flow.phase = "finishing";
  }
}

function finishSignIn(flow: SignInFlow, result: ExitResult): void {
  flow.child = undefined;
  if (flow.timer !== undefined) {
    clearTimeout(flow.timer);
    flow.timer = undefined;
  }
  if (flow.cancelled || SIGN_IN_ENDED.has(flow.phase)) return;

  const lines = flow.lines.map((line) => line.trim()).filter((line) => line !== "");
  const output = lines.join("\n");
  const already = /already signed in to mcp server/i.test(output);
  const signedIn = /signed in to mcp server/i.test(output) && !/signed in, but/i.test(output);
  const count = toolCountIn(lines);
  const how = result.error ?? (result.code !== null && result.code !== undefined
    ? `exit ${result.code}`
    : result.signal ?? "stopped");

  if (result.error === null || result.error === undefined) {
    if (result.code === 0 && (signedIn || already)) {
      flow.alreadySignedIn = already ? true : undefined;
      flow.result = connectedResult(flow, count);
      flow.message = lastSignInLine(lines) ?? `Signed in to MCP server "${flow.name}".`;
      endSignIn(flow, "done");
      return;
    }
    if (result.code === 0) {
      // A command that printed nothing unexpected still succeeded as far as pi
      // is concerned; the tokens are what matter.
      flow.result = connectedResult(flow, count);
      flow.message = lastSignInLine(lines) ?? `Signed in to MCP server "${flow.name}".`;
      endSignIn(flow, "done");
      return;
    }
    const signedInBut = lines.find((line) => /^signed in, but /i.test(line));
    if (signedInBut !== undefined) {
      // The tokens are stored; only the first reconnect failed (the old flow
      // ends `done` with a failed result too).
      flow.result = connectedResult(flow, count, signedInBut);
      flow.message = signedInBut;
      endSignIn(flow, "done");
      return;
    }
  }

  flow.error = lastSignInLine(lines)
    ?? `pi mcp login stopped (${how})`;
  flow.message = flow.error;
  flow.failure = "sign-in-failed";
  const expired = Date.now() >= flow.expiresAt
    || /not completed within|cancelled or not completed/i.test(output);
  endSignIn(flow, expired ? "expired" : "failed");
}

async function postSignIn(request: LocalRequest): Promise<LocalResponse> {
  const body = parseBody(request);
  if (body === null) return errorResponse("Invalid JSON body", 400, { reason: "invalid-request" });
  const scope = readScope(body.scope);
  const name = readName(body.name);
  if (!scope || name === undefined) {
    return errorResponse('scope must be "global" or "project", and name a server name', 400, { reason: "invalid-request" });
  }
  let project: string | undefined;
  if (body.cwd !== undefined && body.cwd !== null && body.cwd !== "") {
    const resolved = await resolveProject(body.cwd);
    if ("error" in resolved) return resolved.error;
    project = resolved.cwd;
  }
  if (scope === "project" && project === undefined) {
    return errorResponse("A project server needs the project's cwd", 400, { reason: "invalid-request" });
  }

  const off = mcpOffResponse();
  if (off) return off;
  const agentDir = piAgentDirectory();
  const trust = project === undefined ? undefined : await trustForProject(project, agentDir);
  if (scope === "project" && trust !== undefined) {
    if (trust.decisionError !== undefined) return errorResponse(trust.decisionError, 409, { reason: "trust-unreadable" });
    if (trust.decision !== true) {
      return errorResponse(
        "The project is not trusted, so its .pi/mcp.json is not connected",
        403,
        { reason: "project-untrusted" },
      );
    }
  }

  let loaded: LoadedServers;
  try {
    loaded = await readMcpServers(agentDir, project, trust?.decision === true);
  } catch (cause) {
    return errorResponse(describe(cause), 500, { reason: "internal" });
  }
  const described = loaded.described.find((entry) => entry.info.scope === scope && entry.info.name === name);
  if (!described) {
    const file = loaded.files.find((item) => item.scope === scope);
    return errorResponse(
      `${displayPath(file?.path ?? "")} does not define MCP server "${name}"`,
      409,
      { reason: "server-missing", path: file?.path, name },
    );
  }
  if (described.info.notAnObject) {
    return errorResponse(`MCP server "${name}" is not an object`, 409, { reason: "entry-not-object", name });
  }
  if (described.info.invalidError !== undefined) {
    return errorResponse(described.info.invalidError, 409, { reason: "server-invalid", name });
  }
  if (described.info.webPasswordField) {
    return errorResponse(`"${name}" references PI_WEB_PASSWORD, so this app does not connect it`, 409, {
      reason: "web-password",
      name,
    });
  }

  const availability = await mcpAvailability(agentDir, project, trust?.decision === true);
  if (availability.mcp.available === false && availability.mcp.reason === "operator-disabled") {
    return errorResponse(availability.mcp.error, 409, { reason: "mcp-off" });
  }

  const config = described.config ?? (isRecordValue(described.value) ? described.value : {});
  const url = oauthUrlOf(config);
  if (url === undefined) {
    return errorResponse(
      `MCP server "${name}" does not use OAuth: only an HTTP server without an Authorization header does`,
      409,
      { reason: "sign-in-not-oauth", name },
    );
  }

  pruneSignInFlows();
  const key = `${name}\0${url}`;
  for (const flow of signInFlows().values()) {
    if (flow.key === key && !SIGN_IN_ENDED.has(flow.phase)) return signInResponse(flow, true);
  }

  let executable: string;
  let shell: string | null;
  try {
    executable = await piExecutable();
    shell = loginShell();
  } catch (cause) {
    return errorResponse(describe(cause), 500, { reason: "internal" });
  }
  if (shell === null) return errorResponse("this platform has no login shell", 500, { reason: "internal" });

  const runCwd = scope === "project"
    ? project as string
    : (await dataDirectory()) ?? homeDirectory();
  let id = newToken();
  while (signInFlows().has(id)) id = newToken();
  const now = Date.now();
  const flow: SignInFlow = {
    id,
    key,
    scope,
    name,
    ...(project !== undefined ? { cwd: project } : {}),
    runCwd,
    configKey: described.info.configKey,
    info: described.info,
    phase: "connecting",
    startedAt: now,
    expiresAt: now + MCP_SIGN_IN_TTL_MS,
    message: `Checking whether MCP server "${name}" asks for a sign-in…`,
    lines: [],
  };
  signInFlows().set(id, flow);

  // Run in the project itself rather than passing `-l`: pi then resolves the
  // same entry this route did, including a project override of a global URL.
  const args = ["mcp", "login", name, "--timeout", String(MCP_SIGN_IN_TIMEOUT_SECONDS)];
  const script = ["exec", quoteShell(executable), ...args.map(quoteShell)].join(" ");
  let child: ChildProcess;
  try {
    child = spawn(shell, ["-ilc", script], {
      cwd: runCwd,
      stdin: "null",
      lines: true,
      timeoutMs: MCP_SIGN_IN_TTL_MS + 10_000,
    });
  } catch (cause) {
    signInFlows().delete(id);
    return errorResponse(`Could not run pi mcp login: ${describe(cause)}`, 500, { reason: "internal" });
  }
  flow.child = child;
  child.on("stdout", (line) => readSignInLine(flow, line));
  child.on("stderr", (line) => readSignInLine(flow, line));
  child.on("exit", (result) => finishSignIn(flow, result));
  flow.timer = setTimeout(() => {
    if (flow.cancelled || SIGN_IN_ENDED.has(flow.phase)) return;
    flow.error = `The sign-in was not finished within ${Math.round(MCP_SIGN_IN_TTL_MS / 60_000)} minutes.`;
    flow.message = flow.error;
    flow.failure = "sign-in-failed";
    try {
      flow.child?.kill();
    } catch {
      // Already gone.
    }
    endSignIn(flow, "expired");
  }, MCP_SIGN_IN_TTL_MS + 2_000);

  return signInResponse(flow);
}

function signInFor(request: LocalRequest): SignInFlow | undefined {
  pruneSignInFlows();
  return signInFlows().get(request.segments[3] ?? "");
}

function getSignIn(request: LocalRequest): LocalResponse {
  const flow = signInFor(request);
  if (flow === undefined) return unknownSignIn();
  return signInResponse(flow);
}

function cancelSignIn(request: LocalRequest): LocalResponse {
  const flow = signInFor(request);
  if (flow === undefined) return unknownSignIn();
  if (SIGN_IN_ENDED.has(flow.phase)) return signInResponse(flow);
  flow.cancelled = true;
  flow.message = `Sign-in to MCP server "${flow.name}" was cancelled.`;
  try {
    flow.child?.kill();
  } catch {
    // The command already exited.
  }
  flow.child = undefined;
  endSignIn(flow, "cancelled");
  return signInResponse(flow);
}

function pasteSignIn(request: LocalRequest): LocalResponse {
  const flow = signInFor(request);
  if (flow === undefined) return unknownSignIn();
  if (SIGN_IN_ENDED.has(flow.phase)) {
    return errorResponse("The sign-in is not waiting for an address right now.", 409, { reason: "sign-in-not-waiting" });
  }
  return errorResponse(
    "This sign-in completes in the browser; paste the redirected address there, or cancel and start again.",
    409,
    { reason: "sign-in-not-waiting" },
  );
}

function unknownSignIn(): LocalResponse {
  return errorResponse(
    "No sign-in has that id: it ended over a minute ago, or PI NEXT restarted",
    404,
    { reason: "sign-in-unknown" },
  );
}

// ---------------------------------------------------------------------------
// `pi mcp list --json`
// ---------------------------------------------------------------------------

interface PiMcpReport {
  name?: unknown;
  scope?: unknown;
  source?: unknown;
  enabled?: unknown;
  exposure?: unknown;
  transport?: unknown;
  state?: unknown;
  tools?: unknown;
  error?: unknown;
  resources?: unknown;
  toolExposure?: unknown;
  override?: unknown;
}

interface PiMcpList {
  servers: PiMcpReport[];
  errors: string[];
}

function parsePiList(stdout: string): PiMcpList {
  let text = stdout.trim();
  if (text === "") throw new Error("pi mcp list printed nothing");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("pi mcp list did not print JSON");
    parsed = JSON.parse(text.slice(start, end + 1));
  }
  const servers = isRecordValue(parsed) && Array.isArray(parsed.servers)
    ? parsed.servers.filter(isRecordValue)
    : [];
  const errors = isRecordValue(parsed) && Array.isArray(parsed.errors)
    ? parsed.errors.map((item) => String(item))
    : [];
  return { servers, errors };
}

function reportScope(report: PiMcpReport): McpScope {
  return report.scope === "project" ? "project" : "global";
}

function pickReport(list: PiMcpList, target: ServerInfo): PiMcpReport | undefined {
  const sameName = list.servers.filter((report) => report.name === target.name);
  const bySource = sameName.find((report) => report.source === target.sourcePath || report.override === target.sourcePath);
  if (bySource) return bySource;
  const byScope = sameName.find((report) => reportScope(report) === target.scope);
  return byScope;
}

function reportToolNames(report: PiMcpReport): string[] {
  if (!Array.isArray(report.tools)) return [];
  return report.tools.flatMap((tool) => {
    if (typeof tool === "string") return [tool];
    if (isRecordValue(tool) && typeof tool.name === "string") return [tool.name];
    return [];
  });
}

function reportToolExposure(report: PiMcpReport, name: string): string | undefined {
  if (isRecordValue(report.toolExposure) && typeof report.toolExposure[name] === "string") {
    return report.toolExposure[name] as string;
  }
  return undefined;
}

function reportTools(report: PiMcpReport, serverExposure: McpExposure): TestTool[] {
  const tools = Array.isArray(report.tools) ? report.tools : [];
  return tools.flatMap((tool): TestTool[] => {
    if (typeof tool === "string") {
      const exposure = reportToolExposure(report, tool);
      return [{
        name: tool,
        readOnly: false,
        ...(isExposure(exposure) ? { exposure } : { exposure: serverExposure }),
      }];
    }
    if (!isRecordValue(tool) || typeof tool.name !== "string") return [];
    const exposure = reportToolExposure(report, tool.name)
      ?? (typeof tool.exposure === "string" ? tool.exposure : undefined);
    const description = typeof tool.description === "string" ? tool.description.split(/\r?\n/, 1)[0].slice(0, 300) : undefined;
    return [{
      name: tool.name,
      ...(description ? { description } : {}),
      readOnly: tool.readOnly === true || (isRecordValue(tool.annotations) && tool.annotations.readOnlyHint === true),
      ...(isExposure(exposure) ? { exposure } : { exposure: serverExposure }),
    }];
  });
}

function redactTestText(text: string, config: Record<string, unknown>): string {
  const secrets = new Set<string>();
  const add = (value: string | undefined) => {
    if (value === undefined) return;
    const trimmed = value.trim();
    if (trimmed.length >= 6) secrets.add(trimmed);
  };
  for (const field of configFields(config)) {
    if (field.value.startsWith("!") || isReferenceOnly(field.value)) continue;
    add(field.value);
  }
  if (typeof config.url === "string") for (const part of urlSecretParts(config.url)) add(part);
  if (typeof config.command === "string") for (const part of commandSecretParts(config.command)) add(part);
  if (Array.isArray(config.args)) {
    const args = config.args.filter((arg): arg is string => typeof arg === "string");
    for (const part of argSecretParts(args)) add(part);
  }
  let result = text;
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    result = result.split(secret).join(SECRET_MASK);
  }
  return result;
}

function testResultFromReport(
  report: PiMcpReport | undefined,
  target: ServerInfo,
  config: Record<string, unknown>,
  list: PiMcpList,
  cwd: string,
  startedAt: number,
): TestResult {
  const stateText = typeof report?.state === "string" ? report.state : "";
  const state = stateText === "connected" ? "connected" : stateText === "needs-auth" ? "needs-auth" : "failed";
  const rawError = typeof report?.error === "string"
    ? report.error
    : report === undefined
      ? (target.invalidError ?? (list.errors.length > 0
        ? list.errors.join("\n")
        : `MCP server "${target.name}" was not listed by pi mcp list`))
      : state === "failed"
        ? `MCP server "${target.name}" did not connect (state: ${stateText || "unknown"})`
        : undefined;
  const error = rawError === undefined ? undefined : redactTestText(rawError, config).slice(0, 2000);
  const exposure = isExposure(target.exposure) ? target.exposure : "codemode";
  const tools = report === undefined ? [] : reportTools(report, exposure);
  const testedAt = Date.now();
  return {
    state,
    ...(error !== undefined ? { error } : {}),
    ...(report?.resources === true ? { resources: true as const } : {}),
    tools,
    toolCount: report === undefined ? 0 : reportToolNames(report).length,
    cwd,
    durationMs: Math.max(0, testedAt - startedAt),
    testedAt,
  };
}

// ---------------------------------------------------------------------------
// HTTP routes
// ---------------------------------------------------------------------------

function parseBody(request: LocalRequest): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(request.body ?? "");
    return isRecordValue(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readScope(value: unknown): McpScope | undefined {
  return value === "global" || value === "project" ? value : undefined;
}

function readName(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 ? value : undefined;
}

async function getOverview(request: LocalRequest): Promise<LocalResponse> {
  const rawCwd = request.params.get("cwd");
  let project: string | undefined;
  if (rawCwd !== null && rawCwd !== "") {
    const resolved = await resolveProject(rawCwd);
    if ("error" in resolved) return resolved.error;
    project = resolved.cwd;
  }
  try {
    return jsonResponse(await buildOverview(project));
  } catch (cause) {
    return errorResponse(describe(cause), 500, { reason: "internal" });
  }
}

async function postTest(request: LocalRequest): Promise<LocalResponse> {
  const body = parseBody(request);
  if (body === null) return errorResponse("Invalid JSON body", 400, { reason: "invalid-request" });
  const scope = readScope(body.scope);
  const name = readName(body.name);
  if (!scope || name === undefined) {
    return errorResponse('scope must be "global" or "project", and name a server name', 400, { reason: "invalid-request" });
  }
  let project: string | undefined;
  if (body.cwd !== undefined && body.cwd !== null && body.cwd !== "") {
    const resolved = await resolveProject(body.cwd);
    if ("error" in resolved) return resolved.error;
    project = resolved.cwd;
  }
  if (scope === "project" && project === undefined) {
    return errorResponse("A project server needs the project's cwd", 400, { reason: "invalid-request" });
  }

  const agentDir = piAgentDirectory();
  const trust = project === undefined ? undefined : await trustForProject(project, agentDir);
  if (scope === "project" && trust !== undefined) {
    if (trust.decisionError !== undefined) return errorResponse(trust.decisionError, 409, { reason: "trust-unreadable" });
    if (trust.decision !== true) {
      return errorResponse(
        "The project is not trusted, so its .pi/mcp.json is not connected",
        403,
        { reason: "project-untrusted" },
      );
    }
  }

  let loaded: LoadedServers;
  try {
    loaded = await readMcpServers(agentDir, project, trust?.decision === true);
  } catch (cause) {
    return errorResponse(describe(cause), 500, { reason: "internal" });
  }
  const described = loaded.described.find((entry) => entry.info.scope === scope && entry.info.name === name);
  if (!described) {
    const file = loaded.files.find((item) => item.scope === scope);
    return errorResponse(
      `${displayPath(file?.path ?? "")} does not define MCP server "${name}"`,
      409,
      { reason: "server-missing", path: file?.path, name },
    );
  }
  if (described.info.notAnObject) {
    return errorResponse(`MCP server "${name}" is not an object`, 409, { reason: "entry-not-object", name });
  }
  if (described.info.invalidError !== undefined) {
    return errorResponse(described.info.invalidError, 409, { reason: "server-invalid", name });
  }
  if (described.info.webPasswordField) {
    return errorResponse(`"${name}" references PI_WEB_PASSWORD, so this app does not connect it`, 409, {
      reason: "web-password",
      name,
    });
  }

  const availability = await mcpAvailability(agentDir, project, trust?.decision === true);
  // `builtin:mcp` is a setting a project may reverse; an explicit Test still
  // runs, as it does in pi. Only the operator's switch blocks it.
  if (availability.mcp.available === false && availability.mcp.reason === "operator-disabled") {
    return errorResponse(availability.mcp.error, 409, { reason: "mcp-off" });
  }

  const runCwd = project ?? homeDirectory();
  const startedAt = Date.now();
  let list: PiMcpList;
  try {
    const output = await run("pi", ["mcp", "list", "--json"], {
      cwd: runCwd,
      timeoutMs: PI_LIST_TIMEOUT_MS,
    });
    try {
      list = parsePiList(output.stdout);
    } catch (cause) {
      const tail = output.stderr.trim().split(/\r?\n/).slice(-6).join("\n");
      throw new Error(`${describe(cause)}${tail ? `\n${tail}` : ""}`);
    }
  } catch (cause) {
    return errorResponse(`Could not run pi mcp list: ${describe(cause)}`, 500, { reason: "internal" });
  }

  const report = pickReport(list, described.info);
  const config = described.config ?? (isRecordValue(described.value) ? described.value : {});
  const result = testResultFromReport(report, described.info, config, list, runCwd, startedAt);
  recordStatus(described.info, { origin: "test", ...result });
  const names = report === undefined ? [] : reportToolNames(report);
  return jsonResponse({
    scope,
    name,
    configKey: described.info.configKey,
    result,
    // A small, direct reading of the same answer for callers that do not read
    // the full test result (`src/screens/settings/Mcp.tsx` uses `result`).
    ok: result.state === "connected",
    state: result.state,
    tools: names,
    ...(result.error !== undefined ? { error: result.error } : {}),
  });
}

async function postMcp(request: LocalRequest): Promise<LocalResponse> {
  const body = parseBody(request);
  if (body === null) return errorResponse("Invalid JSON body", 400, { reason: "invalid-request" });
  let project: string | undefined;
  if (body.cwd !== undefined && body.cwd !== null && body.cwd !== "") {
    const resolved = await resolveProject(body.cwd);
    if ("error" in resolved) return resolved.error;
    project = resolved.cwd;
  }

  switch (body.action) {
    case "enable":
    case "disable": {
      const scope = readScope(body.scope);
      const name = readName(body.name);
      if (!scope || name === undefined) {
        return errorResponse('scope must be "global" or "project", and name a server name', 400, { reason: "invalid-request" });
      }
      return switchServer(project, { scope, name }, body.action === "enable");
    }
    case "set-enabled": {
      if (typeof body.enabled !== "boolean" || !Array.isArray(body.servers)) {
        return errorResponse("enabled must be a boolean, and servers a list of { scope, name }", 400, { reason: "invalid-request" });
      }
      const servers: { scope: McpScope; name: string }[] = [];
      const seen = new Set<string>();
      if (body.servers.length === 0 || body.servers.length > 500) {
        return errorResponse("servers must list 1 to 500 servers", 400, { reason: "invalid-request" });
      }
      for (const item of body.servers) {
        if (!isRecordValue(item)) return errorResponse("servers must be a list of { scope, name }", 400, { reason: "invalid-request" });
        const scope = readScope(item.scope);
        const name = readName(item.name);
        if (!scope || name === undefined) {
          return errorResponse("servers must be a list of { scope, name }", 400, { reason: "invalid-request" });
        }
        const key = `${scope}\0${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        servers.push({ scope, name });
      }
      return switchServers(project, servers, body.enabled);
    }
    case "set-exposure": {
      const scope = readScope(body.scope);
      const name = readName(body.name);
      if (!scope || name === undefined || !isExposure(body.exposure)) {
        return errorResponse(
          `scope must be "global" or "project", name a server name, and exposure one of ${MCP_EXPOSURES.join(", ")}`,
          400,
          { reason: "invalid-request" },
        );
      }
      return setServerExposure(project, { scope, name }, body.exposure);
    }
    case "set-in-project": {
      const name = readName(body.name);
      if (name === undefined || typeof body.enabled !== "boolean") {
        return errorResponse("name must name a global server, and enabled be a boolean", 400, { reason: "invalid-request" });
      }
      return switchServerInProject(project, name, body.enabled);
    }
    case "remove": {
      const scope = readScope(body.scope);
      const name = readName(body.name);
      if (!scope || name === undefined) {
        return errorResponse('scope must be "global" or "project", and name a server name', 400, { reason: "invalid-request" });
      }
      return removeServer(project, { scope, name });
    }
    case "undo": {
      if (typeof body.token !== "string" || body.token.length === 0 || body.token.length > 100) {
        return errorResponse("token must be the token a remove answered with", 400, { reason: "invalid-request" });
      }
      return undoRemoval(project, body.token);
    }
    case "sign-out": {
      const scope = readScope(body.scope);
      const name = readName(body.name);
      if (!scope || name === undefined) {
        return errorResponse('scope must be "global" or "project", and name a server name', 400, { reason: "invalid-request" });
      }
      return signOutServer(project, { scope, name });
    }
    default:
      return errorResponse(
        "action must be enable, disable, remove, set-enabled, set-exposure, set-in-project, undo or sign-out",
        400,
        { reason: "invalid-request" },
      );
  }
}

export async function handleMcp(request: LocalRequest): Promise<LocalResponse | null> {
  const segments = request.segments;
  if (segments[0] !== "api" || segments[1] !== "mcp") return null;
  const method = request.method;
  if (segments.length === 2) {
    if (method === "GET") return getOverview(request);
    if (method === "POST") return postMcp(request);
    return null;
  }
  if (segments.length === 3 && segments[2] === "test" && method === "POST") return postTest(request);
  if (segments.length === 3 && segments[2] === "sign-in" && method === "POST") return postSignIn(request);
  if (segments.length === 4 && segments[2] === "sign-in") {
    if (method === "GET") return getSignIn(request);
    if (method === "POST") return pasteSignIn(request);
    if (method === "DELETE") return cancelSignIn(request);
  }
  return null;
}

// ---------------------------------------------------------------------------
// A JSONC scanner and minimal text editor.
//
// Copied from `settings-routes.ts`: a write must change only the bytes of the
// edited member, so comments, trailing commas, key order and indentation stay.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// A position-aware JSONC scanner and minimal text editor
//
// A PUT must change only the bytes that encode the edited key: pi's settings
// and models files are hand-edited, and a re-serialized file would drop
// comments, trailing commas and the order the person chose.
// ---------------------------------------------------------------------------

interface JsonMember {
  key: string;
  keyStart: number;
  valueStart: number;
  valueEnd: number;
}

interface JsonObject {
  start: number;
  end: number;
  members: JsonMember[];
}

interface ScannedValue {
  start: number;
  end: number;
  object?: JsonObject;
}

function skipTrivia(text: string, index: number): number {
  let i = index;
  while (i < text.length) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\uFEFF") {
      i += 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const newline = text.indexOf("\n", i + 2);
      i = newline < 0 ? text.length : newline + 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      i = close < 0 ? text.length : close + 2;
      continue;
    }
    break;
  }
  return i;
}

function scanStringEnd(text: string, index: number): number {
  let i = index + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') return i + 1;
    i += 1;
  }
  throw new SyntaxError("Unterminated string");
}

function scanValue(text: string, index: number): ScannedValue {
  const start = skipTrivia(text, index);
  const ch = text[start];
  if (ch === "{") return scanObject(text, start);
  if (ch === "[") return scanArray(text, start);
  if (ch === '"') return { start, end: scanStringEnd(text, start) };
  let end = start;
  while (end < text.length) {
    const current = text[end];
    if (current === "," || current === "}" || current === "]" || current === " " || current === "\t"
      || current === "\n" || current === "\r" || (current === "/" && (text[end + 1] === "/" || text[end + 1] === "*"))) {
      break;
    }
    end += 1;
  }
  if (end === start) throw new SyntaxError("Expected a value");
  return { start, end };
}

function scanObject(text: string, start: number): ScannedValue {
  const members: JsonMember[] = [];
  let i = skipTrivia(text, start + 1);
  while (i < text.length && text[i] !== "}") {
    if (text[i] !== '"') throw new SyntaxError("Expected an object key");
    const keyStart = i;
    const keyEnd = scanStringEnd(text, keyStart);
    let key: string;
    try {
      key = JSON.parse(text.slice(keyStart, keyEnd)) as string;
    } catch {
      throw new SyntaxError("Invalid object key");
    }
    i = skipTrivia(text, keyEnd);
    if (text[i] !== ":") throw new SyntaxError("Expected a colon");
    const value = scanValue(text, i + 1);
    members.push({ key, keyStart, valueStart: value.start, valueEnd: value.end });
    i = skipTrivia(text, value.end);
    if (text[i] === ",") {
      i = skipTrivia(text, i + 1);
      continue;
    }
    if (text[i] === "}") break;
    throw new SyntaxError("Expected a comma or a closing brace");
  }
  if (i >= text.length) throw new SyntaxError("Unterminated object");
  const end = i + 1;
  return { start, end, object: { start, end, members } };
}

function scanArray(text: string, start: number): ScannedValue {
  let i = skipTrivia(text, start + 1);
  while (i < text.length && text[i] !== "]") {
    const value = scanValue(text, i);
    i = skipTrivia(text, value.end);
    if (text[i] === ",") {
      i = skipTrivia(text, i + 1);
      continue;
    }
    if (text[i] === "]") break;
    throw new SyntaxError("Expected a comma or a closing bracket");
  }
  if (i >= text.length) throw new SyntaxError("Unterminated array");
  return { start, end: i + 1 };
}

function parseRootObject(text: string): JsonObject | null {
  const start = skipTrivia(text, 0);
  if (start >= text.length) return null;
  if (text[start] !== "{") throw new SyntaxError("Expected a JSON object");
  const value = scanValue(text, start);
  const end = skipTrivia(text, value.end);
  if (end < text.length) throw new SyntaxError("Unexpected text after the JSON object");
  return value.object ?? null;
}

function lastMember(object: JsonObject, key: string): JsonMember | undefined {
  for (let index = object.members.length - 1; index >= 0; index -= 1) {
    if (object.members[index].key === key) return object.members[index];
  }
  return undefined;
}

function objectAtPath(root: JsonObject | null, text: string, pathParts: readonly string[]): JsonObject | null {
  let current = root;
  for (const part of pathParts) {
    if (!current) return null;
    const member = lastMember(current, part);
    if (!member) return null;
    const value = scanValue(text, member.valueStart);
    current = value.object ?? null;
  }
  return current;
}

function lineIndentAt(text: string, index: number): string | null {
  const lineStart = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const prefix = text.slice(lineStart, index);
  return /^[ \t]*$/.test(prefix) ? prefix : null;
}

function replaceRange(text: string, start: number, end: number, value: string): string {
  return `${text.slice(0, start)}${value}${text.slice(end)}`;
}

/** The JSON text of `value` wrapped in `{ path…: { key: value } }`. */
function wrapValue(pathParts: readonly string[], key: string, value: unknown): string {
  let wrapped: unknown = value;
  const keys = [...pathParts, key];
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    wrapped = { [keys[index]]: wrapped };
  }
  return JSON.stringify(wrapped, null, 2);
}

function insertionPointBeforeClose(text: string, closeIndex: number): { index: number; indent: string } | null {
  const closeIndent = lineIndentAt(text, closeIndex);
  if (closeIndent === null) return null;
  const lineStart = closeIndex - closeIndent.length;
  if (lineStart > 0 && text[lineStart - 1] !== "\n") return null;
  return { index: lineStart, indent: closeIndent };
}

function setInObject(text: string, object: JsonObject, key: string, value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Cannot store undefined");
  const existing = lastMember(object, key);
  if (existing) return replaceRange(text, existing.valueStart, existing.valueEnd, serialized);

  const multiline = text.slice(object.start, object.end).includes("\n");
  const close = object.end - 1;
  const last = object.members[object.members.length - 1];
  const memberText = `${JSON.stringify(key)}: ${serialized}`;

  if (!multiline) {
    if (!last) return replaceRange(text, close, close, memberText);
    const afterValue = skipTrivia(text, last.valueEnd);
    const hasComma = text[afterValue] === ",";
    const anchor = hasComma ? text : replaceRange(text, last.valueEnd, last.valueEnd, ",");
    return replaceRange(anchor, close + (hasComma ? 0 : 1), close + (hasComma ? 0 : 1), ` ${memberText}`);
  }

  if (last) {
    const afterValue = skipTrivia(text, last.valueEnd);
    const hasComma = text[afterValue] === ",";
    const anchor = hasComma ? text : replaceRange(text, last.valueEnd, last.valueEnd, ",");
    const closeIndex = close + (hasComma ? 0 : 1);
    const point = insertionPointBeforeClose(anchor, closeIndex);
    if (point) {
      const indent = lineIndentAt(anchor, last.keyStart) ?? `${point.indent}  `;
      return replaceRange(anchor, point.index, point.index, `${indent}${memberText}\n`);
    }
    const baseIndent = lineIndentAt(anchor, object.start) ?? "";
    const indent = lineIndentAt(anchor, last.keyStart) ?? `${baseIndent}  `;
    return replaceRange(anchor, closeIndex, closeIndex, `\n${indent}${memberText}\n${baseIndent}`);
  }

  const point = insertionPointBeforeClose(text, close);
  if (point) {
    return replaceRange(text, point.index, point.index, `${point.indent}  ${memberText}\n`);
  }
  const baseIndent = lineIndentAt(text, object.start) ?? "";
  return replaceRange(text, close, close, `\n${baseIndent}  ${memberText}\n${baseIndent}`);
}

function removeFromObject(text: string, object: JsonObject, key: string): string {
  let index = -1;
  for (let cursor = object.members.length - 1; cursor >= 0; cursor -= 1) {
    if (object.members[cursor].key === key) {
      index = cursor;
      break;
    }
  }
  if (index < 0) return text;
  const member = object.members[index];
  const afterValue = skipTrivia(text, member.valueEnd);
  const hasComma = text[afterValue] === ",";

  // A member alone on its line goes away with that line, so repeated edits do
  // not leave a column of blank lines. Comments (above or inline) keep the
  // slower path below, where only the member's own bytes are removed.
  const lineStart = text.lastIndexOf("\n", Math.max(0, member.keyStart - 1)) + 1;
  const lineBreak = text.indexOf("\n", member.valueEnd);
  const lineEnd = lineBreak < 0 ? text.length : lineBreak;
  const before = text.slice(lineStart, member.keyStart);
  const after = text.slice(member.valueEnd, lineEnd);
  if (/^[ \t]*$/.test(before) && /^[ \t]*,?[ \t]*$/.test(after)) {
    const previous = index > 0 ? object.members[index - 1] : undefined;
    let result = replaceRange(text, lineStart, Math.min(lineEnd + 1, text.length), "");
    // The last member has no comma of its own; its separator belongs to the
    // previous member and must go with it, or a trailing comma is left behind.
    if (index === object.members.length - 1 && previous) {
      const comma = skipTrivia(text, previous.valueEnd);
      if (text[comma] === ",") result = replaceRange(result, comma, comma + 1, "");
    }
    return result;
  }

  if (hasComma) return replaceRange(text, member.keyStart, afterValue + 1, "");
  if (index > 0) {
    const previous = object.members[index - 1];
    const comma = skipTrivia(text, previous.valueEnd);
    if (text[comma] === ",") {
      // Remove the member and the comma before it in two ranges, so a comment
      // between them (and anything else the person wrote there) survives.
      const withoutMember = replaceRange(text, member.keyStart, member.valueEnd, "");
      return replaceRange(withoutMember, comma, comma + 1, "");
    }
    return replaceRange(text, member.keyStart, member.valueEnd, "");
  }
  return replaceRange(text, member.keyStart, member.valueEnd, "");
}

/** Set `path…key` to `value`, creating the missing parents. */
function setKey(text: string, pathParts: readonly string[], key: string, value: unknown): string {
  const start = skipTrivia(text, 0);
  if (start >= text.length) return `${wrapValue(pathParts, key, value)}\n`;
  const root = parseRootObject(text);
  if (!root) throw new SyntaxError("Expected a JSON object");

  let current = root;
  for (let index = 0; index < pathParts.length; index += 1) {
    const part = pathParts[index];
    const member = lastMember(current, part);
    const rest = pathParts.slice(index + 1);
    if (!member) return setInObject(text, current, part, JSON.parse(wrapValue(rest, key, value)));
    const scanned = scanValue(text, member.valueStart);
    if (!scanned.object) {
      return replaceRange(text, member.valueStart, member.valueEnd, wrapValue(rest, key, value));
    }
    current = scanned.object;
  }
  return setInObject(text, current, key, value);
}

/** Remove `path…key`; an object left with no keys loses its own key too. */
function deleteKey(text: string, pathParts: readonly string[], key: string): string {
  if (skipTrivia(text, 0) >= text.length) return text;
  const root = parseRootObject(text);
  if (!root) return text;

  const target = objectAtPath(root, text, pathParts);
  if (!target) return text;
  let result = removeFromObject(text, target, key);

  let currentPath = [...pathParts];
  for (;;) {
    const reparsed = parseRootObject(result);
    const object = objectAtPath(reparsed, result, currentPath);
    if (!object || object.members.length > 0 || currentPath.length === 0) break;
    const parentPath = currentPath.slice(0, -1);
    const parent = objectAtPath(reparsed, result, parentPath);
    if (!parent) break;
    result = removeFromObject(result, parent, currentPath[currentPath.length - 1]);
    currentPath = parentPath;
  }
  return result;
}

// Secret classification and masking for MCP server entries (ADR 0006). The
// Settings panel and the trust dialog show a server's command, arguments and
// URL to a browser that may be on another machine, and a project's `mcp.json`
// is whatever its repository committed. Env and header values are never sent
// at all (names only); this module covers what is shown: it masks the parts
// of a URL or an argument list that look like credentials. The same rules
// decide which values of an entry are literal secrets, which may only be
// saved in the global file.
//
// It is pure (no Node APIs), so the browser-side importer can use it too.
// Masked strings are for display only; nothing parses them back. What a mask
// hid can be listed (`urlSecretParts()`, `commandSecretParts()`,
// `argSecretParts()`), for code that must find those values again in other
// text, such as a connection test's error message.

export const SECRET_MASK = "•••";

/** Words that name a credential wherever they appear in a name: `OPENAI_API_KEY`, `x-api-key`, `accessToken`. */
const SECRET_WORDS = new Set([
  "key",
  "apikey",
  "token",
  "secret",
  "password",
  "passwd",
  "passphrase",
  "pwd",
  "pass",
  "credential",
  "credentials",
  "authorization",
  "bearer",
  "jwt",
  "cookie",
  "signature",
  "pat",
]);

/** Names that hold credentials in a query string as well: `?auth=…`, Azure's `sig=…`. */
const SECRET_PARAMETER_WORDS = new Set([...SECRET_WORDS, "auth", "sig", "code", "pw"]);

/** A word that ends in one of these is a credential too, as all-caps names run words together: `GITHUBTOKEN`. */
const SECRET_SUFFIXES = ["token", "secret", "password", "passwd", "apikey"];

/**
 * A name that ends in one of these words describes a credential rather than
 * holding one: `API_KEY_FILE`, `TOKEN_URL`, `AWS_ACCESS_KEY_ID`.
 */
const QUALIFIER_WORDS = new Set([
  "file",
  "path",
  "dir",
  "url",
  "uri",
  "endpoint",
  "id",
  "name",
  "type",
  "header",
  "env",
  "var",
  "length",
  "ttl",
  "expiry",
  "expires",
  "timeout",
  "mode",
  "format",
]);

/** Short flags that take a credential as their next argument. */
const SHORT_SECRET_FLAGS = new Set(["-k"]);

function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function namesSecret(name: string, words: ReadonlySet<string>): boolean {
  const parts = nameWords(name);
  if (parts.length > 1 && QUALIFIER_WORDS.has(parts[parts.length - 1])) return false;
  return parts.some(
    (word) => words.has(word) || SECRET_SUFFIXES.some((suffix) => word.length > suffix.length && word.endsWith(suffix)),
  );
}

/** Whether an env variable, header, or flag name names a credential. */
export function isSecretName(name: string): boolean {
  return namesSecret(name, SECRET_WORDS);
}

function isSecretParameterName(name: string): boolean {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // Keep the raw name.
  }
  return namesSecret(decoded, SECRET_PARAMETER_WORDS);
}

/** Prefixes that well-known services give their keys and tokens. */
const KNOWN_TOKEN = new RegExp(
  "^(?:" + [
    "sk-[A-Za-z0-9_-]{16,}",
    "(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}",
    "gh[pousr]_[A-Za-z0-9]{20,}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "glpat-[A-Za-z0-9_-]{16,}",
    "xox[abposr]-[A-Za-z0-9-]{10,}",
    "(?:AKIA|ASIA)[0-9A-Z]{16}",
    "AIza[0-9A-Za-z_-]{30,}",
    "ya29\\.[0-9A-Za-z_-]{20,}",
    "npm_[A-Za-z0-9]{30,}",
    "hf_[A-Za-z0-9]{30,}",
    "shp(?:at|ss|ca|pa)_[A-Fa-f0-9]{20,}",
    "dop_v1_[a-f0-9]{40,}",
    "lin_api_[A-Za-z0-9]{20,}",
  ].join("|") + ")",
);
const JWT = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*$/;
const TOKEN_CHARACTERS = /^[A-Za-z0-9_\-+/=.~]+$/;
const GENERIC_TOKEN_MIN_LENGTH = 24;
const GENERIC_TOKEN_MIN_ENTROPY = 3.5;

function entropyPerCharacter(value: string): number {
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Whether a bare value looks like a key or a token: a well-known prefix, a
 * JWT, or a long random-looking string. Paths, file names, package names and
 * URLs do not count, and neither does a value made only of `${VAR}`
 * references.
 */
export function looksLikeSecretValue(value: string): boolean {
  if (/\s/.test(value) || isReferenceOnly(value)) return false;
  if (KNOWN_TOKEN.test(value) || JWT.test(value)) return true;
  if (value.length < GENERIC_TOKEN_MIN_LENGTH || !TOKEN_CHARACTERS.test(value)) return false;
  // Paths, relative paths, home paths, and file names.
  if (/^[./~]/.test(value) || /\.[A-Za-z][A-Za-z0-9]{0,4}$/.test(value) || value.split("/").length > 2) return false;
  if (!/\d/.test(value) || !/[A-Za-z]/.test(value)) return false;
  // Random keys mix cases, are hex, or run without separators; dashed words
  // with dates and versions (`mcp-server-postgres-2024-10-01`) are names.
  const opaque = (/[a-z]/.test(value) && /[A-Z]/.test(value)) || /^[0-9a-f]+$/i.test(value) || !/[-_.]/.test(value);
  return opaque && entropyPerCharacter(value) >= GENERIC_TOKEN_MIN_ENTROPY;
}

const REFERENCE = /\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*/;
const REFERENCES = new RegExp(REFERENCE.source, "g");
const AUTHORIZATION_SCHEME = /^(?:bearer|basic|token)\s+/i;

/** Whether `value`, after an optional authorization scheme, is only `pattern` matches and separators. */
function onlyMatches(value: string, pattern: RegExp, patterns: RegExp): boolean {
  const withoutScheme = value.replace(AUTHORIZATION_SCHEME, "");
  // Separators between references (`${USER}:${PASS}`) add nothing secret.
  return pattern.test(withoutScheme) && /^[^A-Za-z0-9]*$/.test(withoutScheme.replace(patterns, ""));
}

/**
 * Whether a value the SDK resolves (an env value, a header value,
 * `oauth.clientSecret`) is only `${VAR}` / `$VAR` references, optionally after
 * an authorization scheme (`Bearer ${TOKEN}`): it names where the secret
 * lives, not the secret.
 */
export function isReferenceOnly(value: string): boolean {
  // `$$` and `$!` are escapes for a literal `$` and `!`, never a reference.
  return onlyMatches(value.replace(/\$[$!]/g, "_x"), REFERENCE, REFERENCES);
}

/**
 * `${NAME}`, or `$NAME` spelled as an environment variable (`$GITHUB_TOKEN`).
 * The SDK uses `command`, `args` and `url` as written and expands neither
 * there, so `$Passw0rd` is just a password that starts with `$`. A wrapper
 * that does expand them (mcp-remote's `--header "Authorization: Bearer
 * ${TOKEN}"`, `sh -c`) reads the value from its environment.
 */
const PLACEHOLDER = /\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Z_][A-Z0-9_]*(?![A-Za-z0-9_])/;
const PLACEHOLDERS = new RegExp(PLACEHOLDER.source, "g");

/** Whether a value used as written is only placeholders, optionally after an authorization scheme. */
function isPlaceholderOnly(value: string): boolean {
  return onlyMatches(value, PLACEHOLDER, PLACEHOLDERS);
}

/** Tells a value that names where a secret lives from the secret; it depends on whether the SDK resolves the field. */
type ReferenceTest = (value: string) => boolean;

export interface MaskedValue {
  value: string;
  masked: boolean;
}

/** Where the maskers note the raw text each mask replaced, and its percent-decoded form when that differs. */
type HiddenParts = string[] | undefined;

function hide(hidden: HiddenParts, raw: string): void {
  if (!hidden || raw === "") return;
  hidden.push(raw);
  const decoded = safeDecode(raw);
  if (decoded !== raw) hidden.push(decoded);
}

const URL_AUTHORITY = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)([^/?#]*)/;

function maskUrlWith(url: string, isReference: ReferenceTest, hidden?: HiddenParts): MaskedValue {
  let masked = false;
  let rest = url;
  let prefix = "";
  const authority = URL_AUTHORITY.exec(url);
  if (authority) {
    const [whole, scheme, host] = authority;
    const at = host.lastIndexOf("@");
    if (at >= 0 && !isReference(safeDecode(host.slice(0, at)))) {
      prefix = `${scheme}${SECRET_MASK}${host.slice(at)}`;
      masked = true;
      const userinfo = host.slice(0, at);
      hide(hidden, userinfo);
      // The password alone, as a server may quote it.
      const colon = userinfo.indexOf(":");
      if (colon >= 0) hide(hidden, userinfo.slice(colon + 1));
    } else {
      prefix = whole;
    }
    rest = url.slice(whole.length);
  }
  const queryStart = rest.search(/[?#]/);
  const path = queryStart < 0 ? rest : rest.slice(0, queryStart);
  let query = queryStart < 0 ? "" : rest.slice(queryStart);
  const maskedPath = path
    .split("/")
    .map((segment) => {
      if (!looksLikeSecretValue(safeDecode(segment))) return segment;
      masked = true;
      hide(hidden, segment);
      return SECRET_MASK;
    })
    .join("/");
  query = query.replace(/([?&#;])([^&#;]*)/g, (match, separator: string, part: string) => {
    const equals = part.indexOf("=");
    if (equals < 0) {
      // A bare key (`?ghp_…`), as some servers take it.
      const decoded = safeDecode(part);
      if (!looksLikeSecretValue(decoded) || isReference(decoded)) return match;
      masked = true;
      hide(hidden, part);
      return `${separator}${SECRET_MASK}`;
    }
    const name = part.slice(0, equals);
    const decoded = safeDecode(part.slice(equals + 1));
    if (decoded === "" || isReference(decoded)) return match;
    if (!isSecretParameterName(name) && !looksLikeSecretValue(decoded)) return match;
    masked = true;
    hide(hidden, part.slice(equals + 1));
    return `${separator}${name}=${SECRET_MASK}`;
  });
  return { value: `${prefix}${maskedPath}${query}`, masked };
}

/**
 * A URL with its credentials masked: userinfo, query and fragment parameters
 * whose name names a credential or whose value looks like one, bare query
 * parts and path segments that look like a token (servers that put the key
 * there). The rest is kept character for character; a string that is not a
 * URL is masked the same way.
 */
export function maskUrl(url: string): MaskedValue {
  return maskUrlWith(url, isPlaceholderOnly);
}

/**
 * The raw parts `maskUrl()` hides (userinfo, its password alone, secret query
 * values and bare parts, token-like path segments), each also percent-decoded,
 * for finding them where a message quotes them on their own.
 */
export function urlSecretParts(url: string): string[] {
  const hidden: string[] = [];
  maskUrlWith(url, isPlaceholderOnly, hidden);
  return [...new Set(hidden)];
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isUrl(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value);
}

/** `Name=value;Name=value`, as ADO.NET and Azure write connection strings. */
const CONNECTION_STRING_SEGMENT = /^(\s*[A-Za-z][A-Za-z0-9 _.-]*=)([\s\S]*)$/;

function maskConnectionString(value: string, isReference: ReferenceTest, hidden?: HiddenParts): MaskedValue | undefined {
  const segments = value.split(";");
  if (segments.length < 2 || !segments.every((segment) => segment.trim() === "" || CONNECTION_STRING_SEGMENT.test(segment))) {
    return undefined;
  }
  let masked = false;
  const result = segments.map((segment) => {
    const match = CONNECTION_STRING_SEGMENT.exec(segment);
    if (!match) return segment;
    const [, key, segmentValue] = match;
    if (segmentValue.trim() === "" || isReference(segmentValue)) return segment;
    if (isSecretName(key.slice(0, -1).trim())) {
      masked = true;
      hide(hidden, segmentValue.trim());
      return `${key}${SECRET_MASK}`;
    }
    const inner = maskValue(segmentValue, isReference, hidden);
    masked ||= inner.masked;
    return `${key}${inner.value}`;
  });
  return { value: result.join(";"), masked };
}

/**
 * One value on its own: a `Name: value` header, a connection string, a
 * `NAME=value` pair, a phrase of several words (`Bearer …`, a whole command
 * line), a URL, or a bare token.
 */
function maskValue(value: string, isReference: ReferenceTest, hidden?: HiddenParts): MaskedValue {
  const header = /^([A-Za-z0-9_-]+):(\s*)([\s\S]*)$/.exec(value);
  if (header && header[3] !== "" && !header[3].startsWith("//") && isSecretName(header[1])) {
    const [, name, space, headerValue] = header;
    if (isReference(headerValue)) return { value, masked: false };
    hide(hidden, headerValue.trim());
    return { value: `${name}:${space}${SECRET_MASK}`, masked: true };
  }
  const connectionString = value.includes(";") ? maskConnectionString(value, isReference, hidden) : undefined;
  if (connectionString) return connectionString;
  const pair = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(value);
  if (pair && pair[2] !== "" && isSecretName(pair[1])) {
    if (isReference(pair[2])) return { value, masked: false };
    hide(hidden, pair[2]);
    return { value: `${pair[1]}=${SECRET_MASK}`, masked: true };
  }
  if (/\s/.test(value)) return maskPhrase(value, isReference, hidden);
  if (isUrl(value)) return maskUrlWith(value, isReference, hidden);
  if (pair && pair[2] !== "") {
    const inner = maskValue(pair[2], isReference, hidden);
    return { value: `${pair[1]}=${inner.value}`, masked: inner.masked };
  }
  if (looksLikeSecretValue(value) && !isReference(value)) {
    hide(hidden, value);
    return { value: SECRET_MASK, masked: true };
  }
  return { value, masked: false };
}

/**
 * Several words in one value, masked word by word as an argument list, with
 * the whitespace between them kept: a whole command line in `command`, or
 * `Bearer …` as one argument. Inside a phrase an authorization scheme
 * (`Bearer`, `Basic`, `Token`) or a `Name:` that names a credential makes the
 * next word a secret.
 */
function maskPhrase(value: string, isReference: ReferenceTest, hidden?: HiddenParts): MaskedValue {
  const parts = value.split(/(\s+)/);
  const words = parts.filter((_, index) => index % 2 === 0);
  const result = maskSequence(words, isReference, true, hidden);
  return {
    value: parts.map((part, index) => (index % 2 === 0 ? result.values[index / 2] : part)).join(""),
    masked: result.masked,
  };
}

/** A command, masked like a single argument: a key passed as the executable, or a whole command line, still holds a key. */
export function maskCommand(command: string): MaskedValue {
  return maskValue(command, isPlaceholderOnly);
}

/** The raw parts `maskCommand()` hides, as `urlSecretParts()` lists a URL's. */
export function commandSecretParts(command: string): string[] {
  const hidden: string[] = [];
  maskValue(command, isPlaceholderOnly, hidden);
  return [...new Set(hidden)];
}

function flagTakesSecret(flag: string): boolean {
  if (SHORT_SECRET_FLAGS.has(flag)) return true;
  if (!/^--?[A-Za-z]/.test(flag)) return false;
  const name = flag.replace(/^-+/, "");
  // `--auth user:password`, `--basic-auth …`.
  return isSecretName(name) || nameWords(name).at(-1) === "auth";
}

const SCHEME_WORD = /^(?:bearer|basic|token)$/i;

function maskSequence(
  items: readonly string[],
  isReference: ReferenceTest,
  phrase: boolean,
  hidden?: HiddenParts,
): { values: string[]; masked: boolean } {
  let masked = false;
  let secretNext = false;
  const values = items.map((item) => {
    if (item === "") return item;
    if (secretNext) {
      // `Authorization: Bearer <token>`: the scheme stays readable.
      if (phrase && SCHEME_WORD.test(item)) return item;
      secretNext = false;
      if (!/^-[A-Za-z-]/.test(item)) {
        if (isReference(item)) return item;
        masked = true;
        hide(hidden, item);
        return SECRET_MASK;
      }
    }
    const flag = /^(--?[A-Za-z][A-Za-z0-9_.-]*)=([\s\S]*)$/.exec(item);
    if (flag) {
      const [, name, value] = flag;
      if (value !== "" && flagTakesSecret(name) && !isReference(value)) {
        masked = true;
        hide(hidden, value);
        return `${name}=${SECRET_MASK}`;
      }
      const inner = maskValue(value, isReference, hidden);
      masked ||= inner.masked;
      return `${name}=${inner.value}`;
    }
    if (/^--?[A-Za-z][A-Za-z0-9_.-]*$/.test(item)) {
      secretNext = flagTakesSecret(item);
      return item;
    }
    if (phrase) {
      const headerName = /^([A-Za-z0-9_-]+):$/.exec(item);
      if (SCHEME_WORD.test(item) || (headerName && isSecretName(headerName[1]))) {
        secretNext = true;
        return item;
      }
    }
    const inner = maskValue(item, isReference, hidden);
    masked ||= inner.masked;
    return inner.value;
  });
  return { values, masked };
}

/**
 * Arguments with credentials masked: the value of a flag that names one
 * (`--api-key=…`, `--token X`, `-k X`, `--auth X`), a `Name: value` header
 * whose name names one, a `NAME=value` pair or a connection string likewise,
 * URLs, the credential after `Bearer` in an argument of several words, and
 * values that look like tokens on their own. A value made only of `${VAR}`
 * placeholders is kept: it says where the secret comes from.
 */
export function maskArgs(args: readonly string[]): { args: string[]; masked: boolean } {
  const { values, masked } = maskSequence(args, isPlaceholderOnly, false);
  return { args: values, masked };
}

/** The raw parts `maskArgs()` hides (a flag's value, the argument after a secret flag, …), as `urlSecretParts()` lists a URL's. */
export function argSecretParts(args: readonly string[]): string[] {
  const hidden: string[] = [];
  maskSequence(args, isPlaceholderOnly, false, hidden);
  return [...new Set(hidden)];
}

export type LiteralSecretField =
  | { kind: "env" | "header"; name: string }
  | { kind: "oauth-client-secret" | "url" | "args" | "command" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A resolved value (env, header, `oauth.clientSecret`) written out rather than referenced or computed. */
function isLiteral(value: string): boolean {
  return !value.startsWith("!") && !isReferenceOnly(value);
}

function literalSecretValue(name: string, value: string): boolean {
  if (!isLiteral(value) || value === "") return false;
  return isSecretName(name) || /^(?:bearer|basic|token)\s+\S/i.test(value) || maskValue(value, isReferenceOnly).masked;
}

/**
 * The parts of an entry that carry a credential written into the file itself:
 * env and header values that are not `${VAR}` references or `!command`s and
 * are named like or look like a secret, a literal `oauth.clientSecret`, and
 * credentials in the URL, the command, or the arguments. The entry need not
 * be valid; values that are not strings are skipped.
 */
export function literalSecretFields(config: unknown): LiteralSecretField[] {
  if (!isRecord(config)) return [];
  const fields: LiteralSecretField[] = [];
  for (const kind of ["env", "headers"] as const) {
    const values = config[kind];
    if (!isRecord(values)) continue;
    for (const [name, value] of Object.entries(values)) {
      if (typeof value === "string" && literalSecretValue(name, value)) {
        fields.push({ kind: kind === "env" ? "env" : "header", name });
      }
    }
  }
  const clientSecret = isRecord(config.oauth) ? config.oauth.clientSecret : undefined;
  if (typeof clientSecret === "string" && clientSecret !== "" && isLiteral(clientSecret)) {
    fields.push({ kind: "oauth-client-secret" });
  }
  if (typeof config.url === "string" && maskUrl(config.url).masked) fields.push({ kind: "url" });
  if (typeof config.command === "string" && maskCommand(config.command).masked) fields.push({ kind: "command" });
  if (Array.isArray(config.args)) {
    const args = config.args.filter((arg): arg is string => typeof arg === "string");
    if (maskArgs(args).masked) fields.push({ kind: "args" });
  }
  return fields;
}
