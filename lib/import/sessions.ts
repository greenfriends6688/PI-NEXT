/**
 * fork:import-scan — conversation transcript scanner (PR-08 / PD-15).
 *
 * Sources (all read-only):
 *   ~/.claude/projects/<encoded>/<uuid>.jsonl
 *   ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 *   ~/.local/share/opencode/storage/session/<project>/<session>.json
 *   ~/.pi/agent/sessions/<encoded-cwd>/<file>.jsonl
 *
 * The parse is intentionally shallow and tolerant: enough for a list row
 * (title / cwd / timestamps / count), never a full transcript. Malformed JSONL
 * lines are skipped silently; one broken file never hides the others.
 */

import { open, opendir, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { toNativePath } from "../paths";
import { normalizePath } from "../recent-projects";
import {
  errorLabel,
  firstString,
  isRecord,
  readJsonFileCapped,
  readTextFileCapped,
  sourceDiagnostic,
  type ImportScanOptions,
  type ImportScanPayload,
  type ImportSessionCandidate,
  type ImportSessionSource,
  type ImportSourceDiagnostic,
} from "./types";

/**
 * Ceiling on transcript files walked *per source* in one scan. There are at
 * most four session sources, so a single request walks at most 1600 files.
 * Per source (not total) so one bloated product archive cannot crowd out the
 * other three products entirely.
 */
export const SESSIONS_MAX_FILES = 400;

/** Files at or below this size are parsed in full; larger files are sampled. */
export const SESSIONS_FULL_PARSE_MAX_BYTES = 2 * 1024 * 1024;

/** Head sample for oversized transcripts: header, title, first user message. */
export const SESSIONS_HEAD_BYTES = 256 * 1024;

/** Tail sample for oversized transcripts: last timestamp only. */
export const SESSIONS_TAIL_BYTES = 64 * 1024;

/** Ceiling on opencode messages counted per session (directory listing bound). */
export const OPENCODE_MAX_MESSAGE_FILES = 2000;

/** Cap for one opencode message or part JSON file read during transcript conversion. */
export const OPENCODE_TRANSCRIPT_MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Depth ceiling for the recursive walks (codex nests YYYY/MM/DD). */
const SESSIONS_WALK_DEPTH = 4;

/** Title ceiling for list rows. */
const SESSION_TITLE_MAX_CHARS = 200;

/** Deterministic apply id; the apply step derives the same value. */
export function importedSessionId(source: ImportSessionSource, externalId: string): string {
  return `import-${source}-${externalId}`;
}

/**
 * pi encodes a session cwd as `--<cwd without leading slash, : and / as ->--`
 * (see the SDK's getDefaultSessionDirPath). Exported because the apply step
 * needs the exact same derivation.
 */
export function encodeSessionDirName(cwd: string): string {
  return `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

type JsonRecord = Record<string, unknown>;

interface SessionFileSample {
  full: boolean;
  head: string;
  tail: string;
  mtimeMs: number;
}

interface SessionMeta {
  projectPath: string | null;
  title?: string;
  createdAt: string | null;
  updatedAt: string | null;
  messageCount: number | null;
}

/** Read a transcript, falling back to head+tail sampling above the ceiling. */
async function readSessionFile(filePath: string): Promise<SessionFileSample | null> {
  let size: number;
  let mtimeMs: number;
  try {
    const stats = await stat(filePath);
    if (!stats.isFile()) return null;
    size = stats.size;
    mtimeMs = stats.mtimeMs;
  } catch {
    return null;
  }

  if (size <= SESSIONS_FULL_PARSE_MAX_BYTES) {
    try {
      return { full: true, head: await readFile(filePath, "utf8"), tail: "", mtimeMs };
    } catch {
      return null;
    }
  }

  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    handle = await open(filePath, "r");
    const headLength = Math.min(SESSIONS_HEAD_BYTES, size);
    const headBuffer = Buffer.alloc(headLength);
    const headRead = await handle.read(headBuffer, 0, headLength, 0);
    const tailStart = Math.max(0, size - SESSIONS_TAIL_BYTES);
    const tailLength = size - tailStart;
    const tailBuffer = Buffer.alloc(tailLength);
    const tailRead = await handle.read(tailBuffer, 0, tailLength, tailStart);
    return {
      full: false,
      head: headBuffer.subarray(0, headRead.bytesRead).toString("utf8"),
      tail: tailBuffer.subarray(0, tailRead.bytesRead).toString("utf8"),
      mtimeMs,
    };
  } catch {
    return null;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // best effort
      }
    }
  }
}

function parseJsonl(text: string, dropFirstPartial: boolean): JsonRecord[] {
  const out: JsonRecord[] = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (index === 0 && dropFirstPartial) continue;
    const line = lines[index].replace(/\r$/, "").trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed)) out.push(parsed);
    } catch {
      // malformed JSONL lines are skipped silently, per the scanning contract
    }
  }
  return out;
}

function sampleEntries(sample: SessionFileSample): JsonRecord[] {
  const head = parseJsonl(sample.head, false);
  if (sample.full || !sample.tail) return head;
  return [...head, ...parseJsonl(sample.tail, true)];
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (
      typeof block.text === "string"
      && (block.type === "text" || block.type === "input_text" || block.type === "output_text")
    ) {
      parts.push(block.text);
    }
  }
  return parts.join("\n");
}

function isoOrNull(value: unknown, fallbackMs: number): string | null {
  let ms: number | null = null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) ms = parsed;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    ms = value;
  }
  if (ms === null) ms = fallbackMs;
  if (!Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function normalizeTitle(text: string | undefined): string | undefined {
  const collapsed = text?.replace(/\s+/g, " ").trim() ?? "";
  if (!collapsed) return undefined;
  return collapsed.length > SESSION_TITLE_MAX_CHARS
    ? `${collapsed.slice(0, SESSION_TITLE_MAX_CHARS)}…`
    : collapsed;
}

function encodeDestination(home: string, projectPath: string | null): string {
  const root = join(home, ".pi", "agent", "sessions");
  return projectPath ? join(root, encodeSessionDirName(projectPath)) : root;
}

function buildCandidate(
  source: ImportSessionSource,
  filePath: string,
  meta: SessionMeta,
  destination: string,
): ImportSessionCandidate {
  const externalId = basename(filePath, ".jsonl");
  return {
    kind: "sessions",
    id: `${source}:${externalId}`,
    source,
    externalId,
    title: meta.title,
    projectPath: meta.projectPath,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    messageCount: meta.messageCount,
    filePath: toNativePath(filePath),
    destination,
  };
}

// ─── pi ──────────────────────────────────────────────────────────────────────

function candidateFromPi(
  home: string,
  filePath: string,
  sample: SessionFileSample,
): ImportSessionCandidate | null {
  const entries = sampleEntries(sample);
  const header = entries[0];
  if (!header || header.type !== "session") return null;

  let name: string | undefined;
  let firstUser = "";
  let lastTimestamp: unknown;
  let messageCount = 0;
  for (const entry of entries) {
    if (entry.type === "session_info") {
      const candidateName = firstString(entry.name);
      if (candidateName) name = candidateName;
      continue;
    }
    if (entry.type !== "message") continue;
    messageCount += 1;
    const message = isRecord(entry.message) ? entry.message : null;
    if (!message) continue;
    if (typeof entry.timestamp === "string") lastTimestamp = entry.timestamp;
    else if (typeof message.timestamp === "number") lastTimestamp = message.timestamp;
    if (!firstUser && message.role === "user") {
      const text = extractText(message.content).trim();
      if (text) firstUser = text;
    }
  }
  if (messageCount === 0) return null;

  const headerTimestamp = typeof header.timestamp === "string" ? header.timestamp : undefined;
  const projectPath = typeof header.cwd === "string" && header.cwd
    ? normalizePath(header.cwd)
    : null;
  return buildCandidate("pi", filePath, {
    projectPath,
    title: normalizeTitle(name) ?? normalizeTitle(firstUser),
    createdAt: isoOrNull(headerTimestamp, sample.mtimeMs),
    updatedAt: isoOrNull(lastTimestamp ?? headerTimestamp, sample.mtimeMs),
    messageCount: sample.full ? messageCount : null,
  }, encodeDestination(home, projectPath));
}

// ─── claude ──────────────────────────────────────────────────────────────────

function isClaudeConversation(entry: JsonRecord): boolean {
  return (
    (entry.type === "user" || entry.type === "assistant")
    && entry.isSidechain !== true
    && isRecord(entry.message)
  );
}

/** Claude injects synthetic user lines (system reminders etc.) starting with `<`. */
function candidateFromClaude(
  home: string,
  filePath: string,
  sample: SessionFileSample,
): ImportSessionCandidate | null {
  const entries = sampleEntries(sample);
  const conversation = entries.filter(isClaudeConversation);
  if (conversation.length === 0) return null;

  let firstUser = "";
  let projectPath: string | null = null;
  for (const entry of conversation) {
    if (projectPath === null && typeof entry.cwd === "string" && entry.cwd) {
      projectPath = normalizePath(entry.cwd);
    }
    if (firstUser || entry.type !== "user") continue;
    const message = entry.message as JsonRecord;
    const text = extractText(message.content).trim();
    if (text && !text.startsWith("<")) firstUser = text;
  }

  const firstTimestamp = conversation[0].timestamp;
  const lastTimestamp = conversation[conversation.length - 1].timestamp;
  return buildCandidate("claude", filePath, {
    projectPath,
    title: normalizeTitle(firstUser),
    createdAt: isoOrNull(firstTimestamp, sample.mtimeMs),
    updatedAt: isoOrNull(lastTimestamp ?? firstTimestamp, sample.mtimeMs),
    messageCount: sample.full ? conversation.length : null,
  }, encodeDestination(home, projectPath));
}

// ─── codex ───────────────────────────────────────────────────────────────────

/**
 * Codex prepends synthetic user messages (AGENTS.md, IDE context, …). Matching
 * stays on exact evidenced prefixes so a real prompt like `# Role: …` survives.
 */
const CODEX_SYNTHETIC_USER_PREFIXES = [
  "<",
  "# AGENTS.md",
  "# Context from my IDE setup",
  "# In app browser:",
  "# Browser comments:",
  "# Files mentioned by the user:",
  "# Diff comments:",
  "# Selected text:",
  "# Review findings:",
  "You are Codex",
];

function isCodexSyntheticUserText(text: string): boolean {
  return CODEX_SYNTHETIC_USER_PREFIXES.some((prefix) => text.startsWith(prefix));
}

function candidateFromCodex(
  home: string,
  filePath: string,
  sample: SessionFileSample,
): ImportSessionCandidate | null {
  const entries = sampleEntries(sample);
  let cwd: string | null = null;
  let startedAt: unknown;
  let lastAt: unknown;
  let sawHeader = false;
  let sawItem = false;
  let itemCount = 0;
  let firstUser = "";

  for (const entry of entries) {
    // Newer format wraps everything in {timestamp, type, payload}.
    if (entry.type === "session_meta" && isRecord(entry.payload)) {
      sawHeader = true;
      const payload = entry.payload;
      if (typeof payload.cwd === "string" && payload.cwd) cwd = normalizePath(payload.cwd);
      startedAt = payload.timestamp ?? entry.timestamp ?? startedAt;
      continue;
    }
    if (entry.type === "response_item" && isRecord(entry.payload)) {
      sawItem = true;
      itemCount += 1;
      if (typeof entry.timestamp === "string") lastAt = entry.timestamp;
      const payload = entry.payload;
      if (!firstUser && payload.type === "message" && payload.role === "user") {
        const text = extractText(payload.content).trim();
        if (text && !isCodexSyntheticUserText(text)) firstUser = text;
      }
      continue;
    }
    // Older format: first line is a bare session header, items are bare lines.
    if (!sawHeader && typeof entry.id === "string" && entry.timestamp !== undefined && entry.type === undefined) {
      sawHeader = true;
      startedAt = entry.timestamp;
      if (typeof entry.cwd === "string" && entry.cwd) cwd = normalizePath(entry.cwd);
      continue;
    }
    if (
      entry.type === "message"
      || entry.type === "function_call"
      || entry.type === "function_call_output"
    ) {
      sawItem = true;
      itemCount += 1;
      if (typeof entry.timestamp === "string") lastAt = entry.timestamp;
      if (!firstUser && entry.type === "message" && entry.role === "user") {
        const text = extractText(entry.content).trim();
        if (text && !isCodexSyntheticUserText(text)) firstUser = text;
      }
    }
  }

  if (!sawItem) return null;
  return buildCandidate("codex", filePath, {
    projectPath: cwd,
    title: normalizeTitle(firstUser),
    createdAt: isoOrNull(startedAt, sample.mtimeMs),
    updatedAt: isoOrNull(lastAt ?? startedAt, sample.mtimeMs),
    messageCount: sample.full ? itemCount : null,
  }, encodeDestination(home, cwd));
}

// ─── opencode ────────────────────────────────────────────────────────────────

function candidateFromOpenCode(
  home: string,
  filePath: string,
  session: JsonRecord,
  messageCount: number | null,
  mtimeMs: number,
): ImportSessionCandidate {
  const time = isRecord(session.time) ? session.time : {};
  const externalId = session.id as string;
  const projectPath = typeof session.directory === "string" && session.directory
    ? normalizePath(session.directory)
    : null;
  return {
    kind: "sessions",
    id: `opencode:${externalId}`,
    source: "opencode",
    externalId,
    title: normalizeTitle(firstString(session.title)),
    projectPath,
    createdAt: isoOrNull(time.created, mtimeMs),
    updatedAt: isoOrNull(time.updated ?? time.created, mtimeMs),
    messageCount,
    filePath: toNativePath(filePath),
    destination: encodeDestination(home, projectPath),
  };
}

// ─── bounded walks ───────────────────────────────────────────────────────────

interface FileCollection {
  files: string[];
  truncated: boolean;
  exists: boolean;
  error?: string;
}

/** Recursive `.jsonl` walk. Sorting is name-descending so date-like names win. */
async function collectJsonlFiles(
  root: string,
  maxFiles: number,
  maxDepth: number,
): Promise<FileCollection> {
  const files: string[] = [];
  let truncated = false;
  let walkError: string | undefined;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (depth === 0 && walkError === undefined) walkError = errorLabel(error);
      return;
    }
    entries.sort((left, right) => right.name.localeCompare(left.name));
    for (const entry of entries) {
      if (truncated) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < maxDepth) await walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      files.push(full);
    }
  };

  try {
    const stats = await stat(root);
    if (!stats.isDirectory()) return { files: [], truncated: false, exists: false };
  } catch {
    return { files: [], truncated: false, exists: false };
  }
  await walk(root, 0);
  return { files, truncated, exists: true, error: walkError };
}

/** Non-recursive `.json` listing (bounded caller-side). */
async function listJsonFiles(dir: string): Promise<string[] | null> {
  try {
    const entries = await readdir(dir);
    return entries.filter((name) => name.endsWith(".json")).sort();
  } catch {
    return null;
  }
}

interface BoundedCount {
  count: number;
  truncated: boolean;
}

/** Count `.json` message files without buffering an unbounded directory. */
async function countJsonFiles(dir: string, maxFiles: number): Promise<BoundedCount | null> {
  let handle: Awaited<ReturnType<typeof opendir>> | null = null;
  try {
    handle = await opendir(dir);
    let count = 0;
    let truncated = false;
    for await (const entry of handle) {
      if (!entry.name.endsWith(".json")) continue;
      if (count >= maxFiles) {
        truncated = true;
        break;
      }
      count += 1;
    }
    return { count, truncated };
  } catch {
    return null;
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // best effort
      }
    }
  }
}

async function parseSessionFiles(
  files: string[],
  truncated: boolean,
  exists: boolean,
  error: string | undefined,
  source: ImportSessionSource,
  root: string,
  parse: (filePath: string, sample: SessionFileSample) => ImportSessionCandidate | null,
): Promise<ImportScanPayload> {
  const candidates: ImportSessionCandidate[] = [];
  for (const file of files) {
    const sample = await readSessionFile(file);
    if (!sample) continue;
    const candidate = parse(file, sample);
    if (candidate) candidates.push(candidate);
  }
  return {
    sources: [
      sourceDiagnostic("sessions", source, root, exists, candidates.length, {
        truncated: truncated || undefined,
        error,
      }),
    ],
    candidates,
  };
}

// ─── sources ─────────────────────────────────────────────────────────────────

async function scanPiSessions(home: string): Promise<ImportScanPayload> {
  const root = join(home, ".pi", "agent", "sessions");
  const collected = await collectJsonlFiles(root, SESSIONS_MAX_FILES, SESSIONS_WALK_DEPTH);
  return parseSessionFiles(
    collected.files,
    collected.truncated,
    collected.exists,
    collected.error,
    "pi",
    root,
    (filePath, sample) => candidateFromPi(home, filePath, sample),
  );
}

async function scanClaudeSessions(home: string): Promise<ImportScanPayload> {
  const root = join(home, ".claude", "projects");
  const collected = await collectJsonlFiles(root, SESSIONS_MAX_FILES, 1);
  return parseSessionFiles(
    collected.files,
    collected.truncated,
    collected.exists,
    collected.error,
    "claude",
    root,
    (filePath, sample) => candidateFromClaude(home, filePath, sample),
  );
}

async function scanCodexSessions(home: string): Promise<ImportScanPayload> {
  const root = join(home, ".codex", "sessions");
  const collected = await collectJsonlFiles(root, SESSIONS_MAX_FILES, SESSIONS_WALK_DEPTH);
  return parseSessionFiles(
    collected.files,
    collected.truncated,
    collected.exists,
    collected.error,
    "codex",
    root,
    (filePath, sample) => candidateFromCodex(home, filePath, sample),
  );
}

async function scanOpenCodeSessions(home: string): Promise<ImportScanPayload> {
  const source: ImportSessionSource = "opencode";
  const sessionRoot = join(home, ".local", "share", "opencode", "storage", "session");
  const diagnostics: ImportSourceDiagnostic[] = [];
  const candidates: ImportSessionCandidate[] = [];

  let entries;
  try {
    entries = await readdir(sessionRoot, { withFileTypes: true });
  } catch (error) {
    const code = errorLabel(error);
    const exists = code !== "ENOENT";
    return {
      sources: [
        sourceDiagnostic("sessions", source, sessionRoot, exists, 0, {
          error: exists ? code : undefined,
        }),
      ],
      candidates: [],
    };
  }

  const sessionFiles: string[] = [];
  let truncated = false;
  const projectDirs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const dir of projectDirs) {
    const files = await listJsonFiles(join(sessionRoot, dir));
    if (!files) continue;
    for (const name of files) {
      if (sessionFiles.length >= SESSIONS_MAX_FILES) {
        truncated = true;
        break;
      }
      sessionFiles.push(join(sessionRoot, dir, name));
    }
    if (truncated) break;
  }

  for (const filePath of sessionFiles) {
    const read = await readTextFileCapped(filePath, SESSIONS_FULL_PARSE_MAX_BYTES);
    if (!read.exists) continue;
    if (read.error !== undefined) {
      diagnostics.push(sourceDiagnostic("sessions", source, filePath, true, 0, { error: read.error }));
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(read.text ?? "") as unknown;
    } catch {
      diagnostics.push(sourceDiagnostic("sessions", source, filePath, true, 0, { error: "malformed JSON" }));
      continue;
    }
    if (!isRecord(parsed) || typeof parsed.id !== "string" || !parsed.id) continue;
    const messageDir = join(home, ".local", "share", "opencode", "storage", "message", parsed.id);
    const messageCount = await countJsonFiles(messageDir, OPENCODE_MAX_MESSAGE_FILES);
    if (!messageCount || messageCount.count === 0) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = (await stat(filePath)).mtimeMs;
    } catch {
      mtimeMs = 0;
    }
    candidates.push(candidateFromOpenCode(
      home,
      filePath,
      parsed,
      messageCount.truncated ? null : messageCount.count,
      mtimeMs,
    ));
  }

  diagnostics.unshift(sourceDiagnostic("sessions", source, sessionRoot, true, candidates.length, {
    truncated: truncated || undefined,
  }));
  return { sources: diagnostics, candidates };
}

// ─── aggregator ──────────────────────────────────────────────────────────────

function mergeSessionPayloads(payloads: ImportScanPayload[]): ImportScanPayload {
  const sources = payloads.flatMap((payload) => payload.sources);
  const byId = new Map<string, ImportSessionCandidate>();
  for (const payload of payloads) {
    for (const candidate of payload.candidates) {
      if (candidate.kind === "sessions" && !byId.has(candidate.id)) {
        byId.set(candidate.id, candidate);
      }
    }
  }
  const candidates = [...byId.values()].sort((left, right) => {
    const timeDelta = (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
    return timeDelta !== 0 ? timeDelta : left.id.localeCompare(right.id);
  });
  return { sources, candidates };
}

/**
 * Scan all four transcript stores. The four source scanners run concurrently;
 * each walks its own store sequentially and is capped independently.
 */
export async function scanSessionImports(
  options: ImportScanOptions = {},
): Promise<ImportScanPayload> {
  const home = options.home ?? homedir();
  const payloads = await Promise.all([
    scanClaudeSessions(home),
    scanCodexSessions(home),
    scanOpenCodeSessions(home),
    scanPiSessions(home),
  ]);
  return mergeSessionPayloads(payloads);
}

// ─── full transcript read for the apply layer (PR-09) ────────────────────────

/**
 * One text turn the apply layer will write into a pi session file. Fidelity is
 * "the conversation reads correctly in pi-web", not "byte-exact replay": tool
 * calls collapse to a single `[tool: <name>]` assistant turn.
 */
export interface ImportTranscriptTurn {
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
}

/**
 * Full JSONL read for the apply layer. Reuses the scanner's per-line parser so
 * a second, subtly different JSONL parser never drifts from this one.
 */
export async function readSessionEntries(filePath: string): Promise<Record<string, unknown>[]> {
  try {
    return parseJsonl(await readFile(filePath, "utf8"), false);
  } catch {
    return [];
  }
}

function entryTimestamp(entry: JsonRecord, message: JsonRecord): string | undefined {
  if (typeof entry.timestamp === "string" && entry.timestamp) return entry.timestamp;
  if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) {
    return new Date(message.timestamp).toISOString();
  }
  return undefined;
}

function piTranscriptTurns(entries: JsonRecord[]): ImportTranscriptTurn[] {
  const turns: ImportTranscriptTurn[] = [];
  for (const entry of entries) {
    if (entry.type !== "message" || !isRecord(entry.message)) continue;
    const message = entry.message;
    if (message.role !== "user" && message.role !== "assistant") continue;
    const timestamp = entryTimestamp(entry, message);
    const text = extractText(message.content).trim();
    if (text) turns.push({ role: message.role, text, timestamp });
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== "toolCall") continue;
      const name = firstString(block.toolName, block.name);
      if (name) turns.push({ role: "assistant", text: `[tool: ${name}]`, timestamp });
    }
  }
  return turns;
}

function claudeTranscriptTurns(entries: JsonRecord[]): ImportTranscriptTurn[] {
  const turns: ImportTranscriptTurn[] = [];
  for (const entry of entries) {
    if (!isClaudeConversation(entry)) continue;
    const message = entry.message as JsonRecord;
    const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
    const text = extractText(message.content).trim();
    // Synthetic user lines (system reminders, slash-command transcripts) start
    // with `<`; the scanner already treats them as noise for titles.
    if (text && !(entry.type === "user" && text.startsWith("<"))) {
      turns.push({ role: entry.type === "user" ? "user" : "assistant", text, timestamp });
    }
    if (entry.type !== "assistant" || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isRecord(block) || block.type !== "tool_use") continue;
      const name = firstString(block.name);
      if (name) turns.push({ role: "assistant", text: `[tool: ${name}]`, timestamp });
    }
  }
  return turns;
}

interface CodexTranscriptItem {
  item: JsonRecord;
  timestamp?: string;
}

function codexTranscriptItems(entries: JsonRecord[]): CodexTranscriptItem[] {
  const items: CodexTranscriptItem[] = [];
  let sawHeader = false;
  for (const entry of entries) {
    const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : undefined;
    if (entry.type === "session_meta" && isRecord(entry.payload)) {
      sawHeader = true;
      continue;
    }
    if (entry.type === "response_item" && isRecord(entry.payload)) {
      items.push({ item: entry.payload, timestamp });
      continue;
    }
    if (!sawHeader && typeof entry.id === "string" && entry.timestamp !== undefined && entry.type === undefined) {
      sawHeader = true;
      continue;
    }
    if (entry.type === "message" || entry.type === "function_call" || entry.type === "function_call_output") {
      items.push({ item: entry, timestamp });
    }
  }
  return items;
}

function codexTranscriptTurns(entries: JsonRecord[]): ImportTranscriptTurn[] {
  const turns: ImportTranscriptTurn[] = [];
  for (const { item, timestamp } of codexTranscriptItems(entries)) {
    if (item.type === "message") {
      const text = extractText(item.content).trim();
      if (!text) continue;
      if (item.role === "user" && isCodexSyntheticUserText(text)) continue;
      turns.push({ role: item.role === "user" ? "user" : "assistant", text, timestamp });
      continue;
    }
    if (item.type === "function_call") {
      const name = firstString(item.name);
      if (name) turns.push({ role: "assistant", text: `[tool: ${name}]`, timestamp });
    }
  }
  return turns;
}

function openCodeTime(message: JsonRecord): number {
  const time = isRecord(message.time) ? message.time.created : undefined;
  return typeof time === "number" && Number.isFinite(time) ? time : 0;
}

function openCodeIso(ms: number): string | undefined {
  if (!Number.isFinite(ms) || ms <= 0) return undefined;
  try {
    return new Date(ms).toISOString();
  } catch {
    return undefined;
  }
}

async function readOpenCodeParts(
  storageRoot: string,
  messageId: unknown,
): Promise<{ texts: string[]; tools: string[] }> {
  if (typeof messageId !== "string" || !messageId) return { texts: [], tools: [] };
  let names: string[];
  try {
    names = (await readdir(join(storageRoot, "part", messageId)))
      .filter((name) => name.endsWith(".json"))
      .sort();
  } catch {
    return { texts: [], tools: [] };
  }
  const texts: string[] = [];
  const tools: string[] = [];
  for (const name of names) {
    const read = await readJsonFileCapped(
      join(storageRoot, "part", messageId, name),
      OPENCODE_TRANSCRIPT_MAX_FILE_BYTES,
    );
    if (!read.exists || read.error !== undefined || !isRecord(read.data)) continue;
    const part = read.data;
    if (part.type === "text" && typeof part.text === "string" && part.synthetic !== true) {
      texts.push(part.text);
    } else if (part.type === "tool") {
      const name = firstString(part.tool);
      if (name) tools.push(name);
    }
  }
  return { texts, tools };
}

async function openCodeTranscriptTurns(filePath: string): Promise<ImportTranscriptTurn[]> {
  // filePath is `<storage>/session/<project>/<session>.json`.
  const storageRoot = dirname(dirname(dirname(filePath)));
  const sessionId = basename(filePath, ".json");
  const messageDir = join(storageRoot, "message", sessionId);
  let names: string[];
  try {
    names = (await readdir(messageDir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
  const messages: JsonRecord[] = [];
  for (const name of names) {
    const read = await readJsonFileCapped(
      join(messageDir, name),
      OPENCODE_TRANSCRIPT_MAX_FILE_BYTES,
    );
    if (read.exists && read.error === undefined && isRecord(read.data)) messages.push(read.data);
  }
  messages.sort((left, right) => {
    const delta = openCodeTime(left) - openCodeTime(right);
    return delta !== 0 ? delta : String(left.id ?? "").localeCompare(String(right.id ?? ""));
  });

  const turns: ImportTranscriptTurn[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const timestamp = openCodeIso(openCodeTime(message));
    const { texts, tools } = await readOpenCodeParts(storageRoot, message.id);
    const text = texts.join("\n").trim();
    if (text) turns.push({ role: message.role, text, timestamp });
    for (const name of tools) turns.push({ role: "assistant", text: `[tool: ${name}]`, timestamp });
  }
  return turns;
}

/**
 * Read the full transcript of a scanned session and flatten it to ordered text
 * turns. Every source keeps the scanner's own filtering rules (sidechains,
 * synthetic user lines) and tool calls collapse to `[tool: <name>]`.
 */
export async function readSessionTranscript(
  candidate: ImportSessionCandidate,
): Promise<ImportTranscriptTurn[]> {
  switch (candidate.source) {
    case "claude":
      return claudeTranscriptTurns(await readSessionEntries(candidate.filePath));
    case "codex":
      return codexTranscriptTurns(await readSessionEntries(candidate.filePath));
    case "pi":
      return piTranscriptTurns(await readSessionEntries(candidate.filePath));
    case "opencode":
      return openCodeTranscriptTurns(candidate.filePath);
    default:
      return [];
  }
}
