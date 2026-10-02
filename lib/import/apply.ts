/**
 * fork:import-apply — write layer for the "import from other AI agents"
 * feature (PR-09 / PD-16).
 *
 * The client only ever sends candidate ids. This module re-runs the matching
 * scan and resolves every id against that fresh result, so the renderer can
 * never steer what gets read or written: no destination in this file comes
 * from the request body.
 *
 * Credentials: this module never reads a credential out of a source file.
 * Model providers are written without `apiKey`/`headers` and MCP servers
 * without `env`/`headers`; the user re-enters secrets in the destination UI.
 * The scan payload's `hasSecret` flag is the only credential-derived value
 * the client sees, and no key can appear in this module's result or errors.
 *
 * Non-destructive: an existing destination is always `skipped`, never merged
 * or overwritten. JSON configs are read once per batch and written once via
 * the existing atomic writers.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { writePrivateFileAtomicSync } from "../atomic-file";
import { writeModelsConfig } from "../models-config-store";
import { addMcpServers, loadMcpConfigFile } from "../mcp-config-file";
import type { McpServerConfig } from "../pi-sdk-internals";
import { samePath } from "../paths";
import { scanImports } from "./index";
import { importedSessionId, readSessionEntries, readSessionTranscript } from "./sessions";
import {
  errorLabel,
  isRecord,
  readJsonFileCapped,
  type ImportCandidate,
  type ImportKind,
  type ImportMcpCandidate,
  type ImportModelApiStyle,
  type ImportModelCandidate,
  type ImportSessionCandidate,
  type ImportSkillCandidate,
} from "./types";

/** Hard ceiling on ids per request; over this the route answers 400. */
export const IMPORT_APPLY_MAX_IDS = 500;

/** Per-transcript output ceiling: newest turns win when a source exceeds it. */
export const IMPORT_SESSION_MAX_TURNS = 2000;
export const IMPORT_SESSION_MAX_BYTES = 4 * 1024 * 1024;

/** Config files above this size are refused instead of parsed into memory. */
export const IMPORT_APPLY_MAX_CONFIG_BYTES = 8 * 1024 * 1024;

export interface ImportApplyItem {
  id: string;
  status: "imported" | "skipped" | "failed";
  destination?: string;
  /** Error *code* or short label, never a parser message or a path from the client. */
  error?: string;
}

export interface ImportApplyResult {
  kind: ImportKind;
  imported: number;
  skipped: number;
  failed: number;
  items: ImportApplyItem[];
}

export interface ImportApplyOptions {
  /** Fixture seam: default is os.homedir(). */
  home?: string;
  /** Forwarded to the scan; the scanners of PR-08 deliberately ignore it. */
  cwd?: string;
}

// ─── small helpers ───────────────────────────────────────────────────────────

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Keep `__proto__`-style keys from mutating prototypes while building configs. */
function isSafeKey(key: string): boolean {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
}

function normalizeIso(value: unknown, fallback: string | null): string | null {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      try {
        return new Date(parsed).toISOString();
      } catch {
        return fallback;
      }
    }
  }
  return fallback;
}

async function sourceMtimeIso(filePath: string): Promise<string> {
  try {
    return new Date((await stat(filePath)).mtimeMs).toISOString();
  } catch {
    // Unreadable sources produce no turns and are skipped; the timestamp is
    // only a last-resort fallback and is never a fabricated "now".
    return new Date(0).toISOString();
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function fileTimestamp(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

/** Any file whose name ends with `_<sessionId>.jsonl` is that import. */
async function findSessionFile(dir: string, sessionId: string): Promise<string | null> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const suffix = `_${sessionId}.jsonl`;
  const match = names.find((name) => name.endsWith(suffix));
  return match ? join(dir, match) : null;
}

function sessionsRoot(home: string): string {
  return join(home, ".pi", "agent", "sessions");
}

// ─── sessions ────────────────────────────────────────────────────────────────

interface BuiltSession {
  text: string;
  timestamp: string;
  truncated: boolean;
}

function serializeTurn(
  role: "user" | "assistant",
  text: string,
  id: string,
  parentId: string | null,
  timestamp: string,
): string {
  return JSON.stringify({
    type: "message",
    id,
    parentId,
    timestamp,
    message: {
      role,
      content: role === "assistant" ? [{ type: "text", text }] : text,
    },
  });
}

function buildGenericSession(
  candidate: ImportSessionCandidate,
  home: string,
  turns: Awaited<ReturnType<typeof readSessionTranscript>>,
  fallbackIso: string,
): BuiltSession {
  const sessionId = importedSessionId(candidate.source, candidate.externalId);
  const headerTimestamp = normalizeIso(candidate.createdAt, fallbackIso)
    ?? normalizeIso(candidate.updatedAt, fallbackIso)
    ?? fallbackIso;
  const headerLine = JSON.stringify({
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: headerTimestamp,
    cwd: candidate.projectPath ?? sessionsRoot(home),
  });

  // Keep the newest turns: walk backwards until either ceiling would be crossed.
  const dummyId = "00000000";
  let bytes = Buffer.byteLength(headerLine) + 1;
  const kept: Array<{ role: "user" | "assistant"; text: string; timestamp: string }> = [];
  for (let index = turns.length - 1; index >= 0 && kept.length < IMPORT_SESSION_MAX_TURNS; index -= 1) {
    const turn = turns[index];
    const timestamp = normalizeIso(turn.timestamp, fallbackIso) ?? fallbackIso;
    const size = Buffer.byteLength(serializeTurn(turn.role, turn.text, dummyId, dummyId, timestamp)) + 1;
    if (bytes + size > IMPORT_SESSION_MAX_BYTES) break;
    bytes += size;
    kept.push({ role: turn.role, text: turn.text, timestamp });
  }
  kept.reverse();

  const lines = [headerLine];
  let parentId: string | null = null;
  for (const turn of kept) {
    const id = randomBytes(4).toString("hex");
    lines.push(serializeTurn(turn.role, turn.text, id, parentId, turn.timestamp));
    parentId = id;
  }
  return {
    text: `${lines.join("\n")}\n`,
    timestamp: headerTimestamp,
    truncated: kept.length < turns.length,
  };
}

/**
 * pi → pi is already the target format, so re-key the session id instead of
 * converting message by message. The header is verified before it is trusted;
 * anything else falls back to the generic conversion.
 */
async function buildPiSession(
  candidate: ImportSessionCandidate,
  home: string,
  fallbackIso: string,
): Promise<BuiltSession | null> {
  const entries = await readSessionEntries(candidate.filePath);
  const header = entries[0];
  if (!header || header.type !== "session") return null;

  const sessionId = importedSessionId("pi", candidate.externalId);
  const headerTimestamp = normalizeIso(header.timestamp, fallbackIso) ?? fallbackIso;
  const headerLine = JSON.stringify({
    ...header,
    type: "session",
    version: 3,
    id: sessionId,
    timestamp: headerTimestamp,
    cwd: candidate.projectPath ?? sessionsRoot(home),
  });

  const rest = entries.slice(1).filter((entry) => entry.type !== "session");
  let messageCount = 0;
  let bytes = Buffer.byteLength(headerLine) + 1;
  const kept: Record<string, unknown>[] = [];
  for (let index = rest.length - 1; index >= 0; index -= 1) {
    const entry = rest[index];
    const isMessage = entry.type === "message";
    if (isMessage && messageCount >= IMPORT_SESSION_MAX_TURNS) break;
    const size = Buffer.byteLength(JSON.stringify(entry)) + 1;
    if (bytes + size > IMPORT_SESSION_MAX_BYTES) break;
    bytes += size;
    kept.push(entry);
    if (isMessage) messageCount += 1;
  }
  kept.reverse();
  // The oldest kept entry can no longer point at an entry we dropped.
  if (kept.length > 0 && hasOwn(kept[0], "parentId")) {
    kept[0] = { ...kept[0], parentId: null };
  }
  return {
    text: `${[headerLine, ...kept.map((entry) => JSON.stringify(entry))].join("\n")}\n`,
    timestamp: headerTimestamp,
    truncated: kept.length < rest.length,
  };
}

async function applySession(
  candidate: ImportSessionCandidate,
  home: string,
): Promise<ImportApplyItem> {
  const sessionId = importedSessionId(candidate.source, candidate.externalId);
  const existing = await findSessionFile(candidate.destination, sessionId);
  if (existing) return { id: candidate.id, status: "skipped", destination: existing };

  const fallbackIso = await sourceMtimeIso(candidate.filePath);
  let built: BuiltSession | null = null;
  if (candidate.source === "pi") {
    built = await buildPiSession(candidate, home, fallbackIso);
  }
  if (!built) {
    const turns = await readSessionTranscript(candidate);
    if (turns.length === 0) {
      return { id: candidate.id, status: "skipped", destination: candidate.destination, error: "no text turns" };
    }
    built = buildGenericSession(candidate, home, turns, fallbackIso);
  }

  const destination = join(candidate.destination, `${fileTimestamp(built.timestamp)}_${sessionId}.jsonl`);
  // Defensive: external ids come from files, never from the client, but an id
  // containing a separator must still not escape the sessions directory.
  if (!samePath(dirname(destination), candidate.destination)) {
    return { id: candidate.id, status: "failed", error: "invalid session id" };
  }
  await mkdir(candidate.destination, { recursive: true });
  // Re-check immediately before the write so a concurrent import of the same
  // id is skipped rather than silently overwritten.
  const raced = await findSessionFile(candidate.destination, sessionId);
  if (raced) return { id: candidate.id, status: "skipped", destination: raced };
  writePrivateFileAtomicSync(destination, built.text);
  return {
    id: candidate.id,
    status: "imported",
    destination,
    ...(built.truncated ? { error: "truncated" } : {}),
  };
}

// ─── models ──────────────────────────────────────────────────────────────────

function piApiFromStyle(style: ImportModelApiStyle): string | undefined {
  switch (style) {
    case "anthropic_messages":
      return "anthropic-messages";
    case "chat_completions":
      return "openai-completions";
    case "responses":
      return "openai-responses";
    default:
      return undefined;
  }
}

function providerKey(baseUrl: unknown, api: unknown): string {
  const url = typeof baseUrl === "string" ? baseUrl.trim().replace(/\/+$/, "").toLowerCase() : "";
  const style = typeof api === "string" ? api.trim().toLowerCase() : "";
  return `${url}\u0000${style}`;
}

function modelProviderEntry(
  candidate: ImportModelCandidate,
  api: string | undefined,
): Record<string, unknown> {
  const entry: Record<string, unknown> = { name: candidate.name };
  if (candidate.baseUrl) entry.baseUrl = candidate.baseUrl;
  if (api) entry.api = api;
  entry.models = candidate.modelIds.map((id) => ({ id }));
  return entry;
}

interface IndexedItem {
  index: number;
  item: ImportApplyItem;
}

async function applyModelBatch(
  batch: Array<{ index: number; candidate: ImportModelCandidate }>,
): Promise<IndexedItem[]> {
  if (batch.length === 0) return [];
  const configPath = batch[0].candidate.destination;

  const read = await readJsonFileCapped(configPath, IMPORT_APPLY_MAX_CONFIG_BYTES);
  if (read.exists && (read.error !== undefined || !isRecord(read.data))) {
    const error = read.error ?? "malformed JSON";
    return batch.map(({ index, candidate }) => ({
      index,
      item: { id: candidate.id, status: "failed", destination: configPath, error },
    }));
  }
  const root = read.exists && isRecord(read.data) ? read.data : {};
  const providers: Record<string, unknown> = isRecord(root.providers) ? { ...root.providers } : {};
  const existingKeys = new Set<string>();
  for (const value of Object.values(providers)) {
    if (isRecord(value)) existingKeys.add(providerKey(value.baseUrl, value.api));
  }

  const out: IndexedItem[] = [];
  let changed = false;
  for (const { index, candidate } of batch) {
    if (!isSafeKey(candidate.externalId)) {
      out.push({ index, item: { id: candidate.id, status: "failed", destination: configPath, error: "invalid provider name" } });
      continue;
    }
    if (hasOwn(providers, candidate.externalId)) {
      out.push({ index, item: { id: candidate.id, status: "skipped", destination: configPath } });
      continue;
    }
    const api = piApiFromStyle(candidate.apiStyle);
    const key = providerKey(candidate.baseUrl, api);
    if (existingKeys.has(key)) {
      out.push({ index, item: { id: candidate.id, status: "skipped", destination: configPath } });
      continue;
    }
    providers[candidate.externalId] = modelProviderEntry(candidate, api);
    existingKeys.add(key);
    changed = true;
    out.push({ index, item: { id: candidate.id, status: "imported", destination: configPath } });
  }

  if (changed) {
    try {
      writeModelsConfig({ ...root, providers }, configPath);
    } catch (error) {
      const code = errorLabel(error);
      return out.map((entry) => entry.item.status === "imported"
        ? { index: entry.index, item: { ...entry.item, status: "failed", error: code } }
        : entry);
    }
  }
  return out;
}

// ─── mcp ─────────────────────────────────────────────────────────────────────

function mcpServerEntry(candidate: ImportMcpCandidate): Record<string, unknown> | null {
  const entry: Record<string, unknown> = {};
  if (candidate.transport === "stdio") {
    if (!candidate.command) return null;
    entry.command = candidate.command;
    if (candidate.args && candidate.args.length > 0) entry.args = [...candidate.args];
  } else {
    if (!candidate.url) return null;
    entry.url = candidate.url;
  }
  if (candidate.disabled) entry.enabled = false;
  return entry;
}

async function applyMcpBatch(
  batch: Array<{ index: number; candidate: ImportMcpCandidate }>,
): Promise<IndexedItem[]> {
  if (batch.length === 0) return [];
  const configPath = batch[0].candidate.destination;

  // fork:pr11-mcp — read via pi's `loadMcpConfig` so "already configured" means
  // the same thing as it does for the runtime (invalid entries are errors, not
  // importable names). A malformed file surfaces as an error on write below.
  const loaded = await loadMcpConfigFile(configPath);
  const names = new Set(loaded.servers.map((server) => server.name));

  const out: IndexedItem[] = [];
  const toAdd: Array<{ name: string; config: McpServerConfig }> = [];
  for (const { index, candidate } of batch) {
    if (!isSafeKey(candidate.name)) {
      out.push({ index, item: { id: candidate.id, status: "failed", destination: configPath, error: "invalid server name" } });
      continue;
    }
    if (names.has(candidate.name)) {
      out.push({ index, item: { id: candidate.id, status: "skipped", destination: configPath } });
      continue;
    }
    const entry = mcpServerEntry(candidate);
    if (!entry) {
      out.push({ index, item: { id: candidate.id, status: "failed", destination: configPath, error: "no command or url" } });
      continue;
    }
    names.add(candidate.name);
    toAdd.push({ name: candidate.name, config: entry as unknown as McpServerConfig });
    out.push({ index, item: { id: candidate.id, status: "imported", destination: configPath } });
  }

  if (toAdd.length > 0) {
    try {
      // One staged write for the whole batch: either every new server lands or none does.
      await addMcpServers(configPath, toAdd);
    } catch (error) {
      const code = errorLabel(error);
      return out.map((entry) => entry.item.status === "imported"
        ? { index: entry.index, item: { ...entry.item, status: "failed", error: code } }
        : entry);
    }
  }
  return out;
}

// ─── skills ──────────────────────────────────────────────────────────────────

/** Path-safe destination name derived from frontmatter; never a path fragment. */
function safeSkillName(name: string): string | null {
  const base = basename(name.trim().replace(/\\/g, "/"));
  const cleaned = base
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^[.-]+/, "")
    .replace(/[.-]+$/, "");
  if (!cleaned || cleaned === "." || cleaned === "..") return null;
  return cleaned;
}

async function applySkill(candidate: ImportSkillCandidate): Promise<ImportApplyItem> {
  const root = candidate.destination;
  const isDirectoryShape = basename(candidate.filePath) === "SKILL.md";
  const name = safeSkillName(candidate.name);
  if (!name) return { id: candidate.id, status: "failed", error: "invalid skill name" };
  const destination = isDirectoryShape ? join(root, name) : join(root, `${name}.md`);
  if (!samePath(dirname(destination), root)) {
    return { id: candidate.id, status: "failed", error: "invalid skill name" };
  }
  if (await pathExists(destination)) {
    return { id: candidate.id, status: "skipped", destination };
  }

  await mkdir(root, { recursive: true });
  const temp = join(root, `.${name}-${randomUUID()}.tmp`);
  try {
    if (isDirectoryShape) {
      await cp(dirname(candidate.filePath), temp, { recursive: true, force: false, errorOnExist: true });
    } else {
      await cp(candidate.filePath, temp, { force: false, errorOnExist: true });
    }
    // A concurrent import may have won the race while we copied.
    if (await pathExists(destination)) {
      return { id: candidate.id, status: "skipped", destination };
    }
    await rename(temp, destination);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  return { id: candidate.id, status: "imported", destination };
}

// ─── dispatcher ──────────────────────────────────────────────────────────────

/**
 * Resolve ids against a fresh scan and apply them one by one. A single failure
 * never aborts the batch: every id gets exactly one item, in request order.
 */
export async function applyImports(
  kind: ImportKind,
  ids: string[],
  options: ImportApplyOptions = {},
): Promise<ImportApplyResult> {
  const home = options.home ?? homedir();
  const scan = await scanImports(kind, { home, cwd: options.cwd });
  const byId = new Map<string, ImportCandidate>();
  for (const candidate of scan.candidates) {
    if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
  }

  const resolved = ids.map((id) => byId.get(id));
  const items: ImportApplyItem[] = ids.map((id) => ({
    id,
    status: "failed",
    error: "not returned by the latest scan",
  }));

  if (kind === "models" || kind === "mcp") {
    const batch: Array<{ index: number; candidate: ImportCandidate }> = [];
    resolved.forEach((candidate, index) => {
      if (!candidate) return;
      if (kind === "models" && candidate.kind === "models") batch.push({ index, candidate });
      if (kind === "mcp" && candidate.kind === "mcp") batch.push({ index, candidate });
    });
    const applied = kind === "models"
      ? await applyModelBatch(batch as Array<{ index: number; candidate: ImportModelCandidate }>)
      : await applyMcpBatch(batch as Array<{ index: number; candidate: ImportMcpCandidate }>);
    for (const { index, item } of applied) items[index] = item;
  } else {
    for (let index = 0; index < ids.length; index += 1) {
      const candidate = resolved[index];
      if (!candidate) continue;
      try {
        if (kind === "sessions" && candidate.kind === "sessions") {
          items[index] = await applySession(candidate, home);
        } else if (kind === "skills" && candidate.kind === "skills") {
          items[index] = await applySkill(candidate);
        }
      } catch (error) {
        items[index] = {
          id: ids[index],
          status: "failed",
          destination: candidate.destination,
          error: errorLabel(error),
        };
      }
    }
  }

  return {
    kind,
    imported: items.filter((item) => item.status === "imported").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    failed: items.filter((item) => item.status === "failed").length,
    items,
  };
}
