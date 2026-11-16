// Session routes served from pi's own files: `~/.pi/agent/sessions/*.jsonl`.
//
// This is the attached-mode replacement for `app/api/sessions/**` and the
// `lib/session-*.ts` readers behind it. It reads the files directly (no
// `SessionManager`, which is Node-only), tolerates malformed lines the way pi
// does, and keeps only small metadata in memory: list rows, project identities
// and usage summaries. Transcripts are parsed per request.
//
// Everything the sidebar pins or archives lives in
// `~/.pi/agent/pi-web-session-state.json`, exactly where the old server kept
// it, so both can read the same file while the port is in progress.
//
// Answered here: GET /api/sessions
//   (?summary=1, ?force=1), GET/PATCH/DELETE /api/sessions/[id],
//   GET /api/sessions/[id]/context, GET /api/sessions/search,
//   POST /api/sessions/stats, GET/POST /api/sessions/ui-state,
//   POST /api/sessions/delete, POST /api/sessions/[id]/fork and
//   GET /api/sessions/[id]/entries/[entryId]/thinking.
// Left to the pipe (`null`): /export, /auto-name, /state and
//   /entries/[entryId]/tool-result-image (a binary body has no local
//   response shape yet). `deferMedia` is therefore accepted but does not
//   replace base64 images with lazy URLs.
import path from "path";
import process, { spawn } from "process";
import { mkdir, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "fs/promises";
import type {
  AgentMessage,
  AgentUsage,
  BranchPreview,
  SessionContext,
  SessionFileStats,
  SessionInfo,
  SessionSearchResponse,
  SessionStatsResponse,
  SessionTreeSummaryNode,
  SessionUsageSummary,
} from "../api/types";
import type { SessionContextPage, SessionDeleteResult, SessionForkResult } from "../api/sessions";
import type {
  SessionUiFamilyState,
  SessionUiProjectState,
  SessionUiState,
  SessionUiStateRequest,
} from "../api/ui-state";
import { getThinkingPreview, isMessageGroupAnchor } from "../lib/message-display";
import { runningSessionIds, sessionListRevision } from "../pi/session-agent";
import { normalizeToolCalls } from "../lib/normalize";
import type { LocalRequest, LocalResponse } from "./request";
import {
  describe,
  errorResponse,
  isInside,
  jsonResponse,
  piAgentDirectory,
  sessionFilePath,
  sessionsDirectory,
} from "./request";

type RawEntry = Record<string, unknown>;
type JsonObject = Record<string, unknown>;

const NO_STORE = { "cache-control": "no-store" };
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_WRITE_BYTES = 8 * 1024 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;
// A summary row needs only the first user message for its title, so the head
// scan stops after this many lines even when the file is smaller than the
// byte bound; a long transcript must not be parsed just to name it.
const MAX_TITLE_HEAD_LINES = 300;
// The scan may walk past a long line (pi writes the whole system prompt as one
// 80 KB message) without parsing it; only this much of the file is read through
// before a title falls back to the path leaf.
const MAX_TITLE_HEAD_BYTES = 512 * 1024;
const MAX_TITLE_HEAD_LINE = 64 * 1024;
// The runtime holds at most 64 MiB of file data in flight. Large sessions are
// read one at a time so a sidebar poll and an open chat cannot overshoot it.
const READ_BUDGET_BYTES = 40 * 1024 * 1024;
let activeReadBytes = 0;
const readWaiters: Array<() => void> = [];
const MAX_SEARCH_FILE_BYTES = 16 * 1024 * 1024;
const MAX_SEARCH_LINE_CHARS = 1024 * 1024;
const MAX_SEARCH_RESULTS = 30;
const MAX_SEARCH_FILES = 500;
const SEARCH_TIME_BUDGET_MS = 3000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const SUBAGENT_META_TYPE = "pi-web:subagent";
const SUBAGENT_STATUS_TYPE = "pi-web:subagent-status";
const SUBAGENT_RESULT_TYPE = "pi-web:subagent-result";
const SIDE_META_TYPE = "pi-web:side";
const SIDE_BOUNDARY_MESSAGE_TYPE = "pi-web:side-boundary";
const SIDE_BOUNDARY_TEXT =
  "[Side chat] This is a note from the app, not from the user. Everything above is inherited from a parent session as background, frozen when this side chat started. It is not your current task, and work left unfinished in it is not yours to continue. Only messages after this note are active.";
const SIDE_SESSION_NAME = "Side chat";
const TOOL_SELECTION_TYPE = "pi-web:tool-selection";
const TOOL_SELECTION_NAMES = new Set(["bash", "read", "edit", "write", "grep", "find", "ls"]);
const SNAPSHOT_BUILTIN_TOOL_NAMES = new Set([...TOOL_SELECTION_NAMES, "powershell"]);
const SUBAGENT_CONTROL_TOOL_NAMES = new Set(["Agent", "get_subagent_result", "steer_subagent"]);
const SKILL_EXPANSION_RE =
  /^<skill name="([^"\n]+)" location="([^"\n]+)">\nReferences are relative to [^\n]+\.\n\n([\s\S]*)\n<\/skill>(?:\n\n([\s\S]+))?$/;

// --- small helpers ---------------------------------------------------------

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseLine(line: string): RawEntry | null {
  if (!line.trim()) return null;
  try {
    const value: unknown = JSON.parse(line);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function stripCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function parseTimestamp(entry: RawEntry): number | undefined {
  const value = typeof entry.timestamp === "string" ? Date.parse(entry.timestamp) : Number.NaN;
  return Number.isNaN(value) ? undefined : value;
}

function entryActivityTime(entry: RawEntry): number | undefined {
  const message = entry.message;
  if (!isRecord(message) || typeof message.role !== "string" || !("content" in message)) return undefined;
  if (message.role !== "user" && message.role !== "assistant") return undefined;
  if (typeof message.timestamp === "number" && Number.isFinite(message.timestamp)) return message.timestamp;
  return parseTimestamp(entry);
}

function extractTextContent(message: RawEntry): string {
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        isRecord(block) && block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text)
    .join(" ");
}

function skillExpansionToCommand(value: string): string | null {
  const match = value.match(SKILL_EXPANSION_RE);
  if (!match) return null;
  const [, name, , , args] = match;
  return args ? `/skill:${name} ${args}` : `/skill:${name}`;
}

const CATALOG_FIRST_MESSAGE_MAX = 500;

function catalogFirstMessage(value: string): string {
  const display = skillExpansionToCommand(value) ?? value;
  if (display.length <= CATALOG_FIRST_MESSAGE_MAX) return display;
  const last = display.charCodeAt(CATALOG_FIRST_MESSAGE_MAX - 1);
  return display.slice(0, last >= 0xd800 && last <= 0xdbff ? CATALOG_FIRST_MESSAGE_MAX - 1 : CATALOG_FIRST_MESSAGE_MAX);
}

function normalizeForCompare(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "windows" ? normalized.toLowerCase() : normalized;
}

function projectIdentityKey(projectRoot: string): string {
  if (!projectRoot) return projectRoot;
  let normalized = path.normalize(projectRoot);
  const root = path.parse(normalized).root;
  let end = normalized.length;
  while (end > root.length && normalized[end - 1] === path.sep) end -= 1;
  normalized = normalized.slice(0, end);
  return process.platform === "windows" ? normalized.toLowerCase() : normalized;
}

function randomHex(length: number): string {
  const digits = "0123456789abcdef";
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += digits[Math.floor(Math.random() * 16)];
  }
  return value;
}

function newSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    // A host without WebCrypto still gets a valid (if not cryptographic) id.
    return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-a${randomHex(3)}-${randomHex(12)}`;
  }
}

function newEntryId(): string {
  return randomHex(8);
}

function nowIso(): string {
  return new Date().toISOString();
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length;
}

function jsonResponseNoStore(value: unknown, status = 200): LocalResponse {
  return {
    status,
    headers: { "content-type": "application/json", ...NO_STORE },
    body: JSON.stringify(value),
  };
}

function errorNoStore(message: string, status: number, extra: Record<string, unknown> = {}): LocalResponse {
  return jsonResponseNoStore({ error: message, ...extra }, status);
}

function contentTypeOf(request: LocalRequest): string | undefined {
  return request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
}

function hasJsonContentType(request: LocalRequest): boolean {
  const mediaType = contentTypeOf(request);
  return mediaType === "application/json"
    || Boolean(mediaType?.startsWith("application/") && mediaType.endsWith("+json"));
}

function parseBodyObject(request: LocalRequest): JsonObject | null {
  if (!request.body) return null;
  try {
    const value: unknown = JSON.parse(request.body);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function sessionIdFromPath(filePath: string): string | undefined {
  if (!filePath.endsWith(".jsonl")) return undefined;
  const base = path.basename(filePath);
  const stem = base.slice(0, -".jsonl".length);
  const underscore = stem.lastIndexOf("_");
  if (underscore <= 0) return undefined;
  const id = stem.slice(underscore + 1);
  return SESSION_ID_PATTERN.test(id) ? id : undefined;
}

function pathKey(filePath: string): string {
  return normalizeForCompare(filePath);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

// --- reading a session file ------------------------------------------------

interface FileText {
  filePath: string;
  text: string;
  size: number;
  mtimeMs: number;
}

/** The file's text and stat, or null when it is missing, not a file, or past `readFile`'s 64 MiB limit. */
async function readSessionText(filePath: string): Promise<FileText | null> {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) return null;
    while (activeReadBytes > 0 && activeReadBytes + info.size > READ_BUDGET_BYTES) {
      await new Promise<void>((resolve) => readWaiters.push(resolve));
    }
    activeReadBytes += info.size;
    try {
      const text = await readFile(filePath, "utf8");
      return { filePath, text, size: info.size, mtimeMs: info.mtimeMs };
    } finally {
      activeReadBytes = Math.max(0, activeReadBytes - info.size);
      for (const resolve of readWaiters.splice(0)) resolve();
    }
  } catch {
    return null;
  }
}

function findHeader(textValue: string): RawEntry | null {
  let start = 0;
  let scanned = 0;
  while (start < textValue.length && start <= MAX_HEADER_BYTES && scanned < 8) {
    const newline = textValue.indexOf("\n", start);
    const end = newline === -1 ? textValue.length : newline;
    const entry = parseLine(stripCarriageReturn(textValue.slice(start, end)));
    if (entry?.type === "session") return entry;
    if (entry) return null;
    scanned += 1;
    if (newline === -1) break;
    start = newline + 1;
  }
  return null;
}

function secondEntry(textValue: string): RawEntry | null {
  const firstNewline = textValue.indexOf("\n");
  if (firstNewline === -1) return null;
  const secondNewline = textValue.indexOf("\n", firstNewline + 1);
  const end = secondNewline === -1 ? textValue.length : secondNewline;
  return parseLine(stripCarriageReturn(textValue.slice(firstNewline + 1, end)));
}

/**
 * The first user message in the head of a transcript, for a summary row's
 * title. Only 64 KiB and 300 lines are walked, so a cold scan still avoids
 * parsing whole files; a line that runs past the head is skipped rather than
 * sliced, and a message with no text (an image only) comes back empty so the
 * caller can fall back to the path leaf.
 */
function firstUserMessageInHead(textValue: string): string {
  let start = 0;
  let scannedBytes = 0;
  for (let line = 0; line < MAX_TITLE_HEAD_LINES && start < textValue.length; line += 1) {
    const newline = textValue.indexOf("\n", start);
    const end = newline === -1 ? textValue.length : newline;
    const length = end - start;
    // A line longer than a title scan needs (pi's whole system prompt as one
    // message, a pasted log) is skipped whole: its newline is still found, so
    // the first user message after it is read, but its JSON is never parsed.
    if (length <= MAX_TITLE_HEAD_LINE) {
      const entry = parseLine(stripCarriageReturn(textValue.slice(start, end)));
      if (entry?.type === "message" && isRecord(entry.message) && entry.message.role === "user") {
        return "content" in entry.message ? extractTextContent(entry.message) : "";
      }
    }
    scannedBytes += length;
    if (scannedBytes > MAX_TITLE_HEAD_BYTES || newline === -1) break;
    start = newline + 1;
  }
  return "";
}

interface ParsedSession {
  header: RawEntry | null;
  entries: RawEntry[];
}

function parseSession(textValue: string): ParsedSession {
  let header: RawEntry | null = null;
  const entries: RawEntry[] = [];
  for (const rawLine of textValue.split("\n")) {
    const entry = parseLine(stripCarriageReturn(rawLine));
    if (!entry) continue;
    if (entry.type === "session") {
      if (!header) header = entry;
      continue;
    }
    entries.push(entry);
  }
  return { header, entries };
}

function tailEntries(textValue: string, maxLines = 128): RawEntry[] {
  const entries: RawEntry[] = [];
  let end = textValue.length;
  if (end > 0 && textValue[end - 1] === "\n") end -= 1;
  for (let line = 0; line < maxLines && end > 0; line += 1) {
    const start = textValue.lastIndexOf("\n", end - 1);
    const entry = parseLine(stripCarriageReturn(textValue.slice(start + 1, end)));
    if (entry) entries.push(entry);
    if (start < 0) break;
    end = start;
  }
  return entries;
}

// --- entry metadata --------------------------------------------------------

interface SubagentMetadata {
  parentSessionId: string;
  parentSessionPath: string;
  profile: string;
  description: string;
  status: string;
  tools?: string[];
}

function isSubagentData(value: unknown): value is JsonObject & {
  version: 1;
  parentSessionId: string;
  parentSessionPath: string;
} {
  return isRecord(value)
    && value.version === 1
    && typeof value.parentSessionId === "string"
    && typeof value.parentSessionPath === "string";
}

function isSideData(value: unknown): value is JsonObject & {
  version: 1;
  parentSessionId: string;
  createdAt: string;
} {
  return isRecord(value)
    && value.version === 1
    && typeof value.parentSessionId === "string"
    && typeof value.createdAt === "string";
}

function subagentMetadata(entries: readonly RawEntry[]): SubagentMetadata | null {
  let found: SubagentMetadata | null = null;
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== SUBAGENT_META_TYPE || !isSubagentData(entry.data)) continue;
    const data = entry.data;
    const status = "interrupted";
    const tools = subagentSnapshotTools(data.resourceSnapshot);
    found = {
      parentSessionId: data.parentSessionId,
      parentSessionPath: data.parentSessionPath,
      profile: typeof data.profile === "string" ? data.profile : "general-purpose",
      description: typeof data.description === "string" ? data.description : "Subagent",
      status,
      ...(tools ? { tools } : {}),
    };
    break;
  }
  if (!found) return null;
  // The newest lifecycle entry decides; anything else is a run a dead process
  // left behind, which the list settles as interrupted.
  let lifecycle: RawEntry | undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type === "custom"
      && (entry.customType === SUBAGENT_RESULT_TYPE || entry.customType === SUBAGENT_STATUS_TYPE)) {
      lifecycle = entry;
      break;
    }
  }
  if (lifecycle && isRecord(lifecycle.data)) {
    if (lifecycle.customType === SUBAGENT_RESULT_TYPE) {
      const status = lifecycle.data.status;
      if (status === "completed" || status === "failed" || status === "aborted") found.status = status;
    } else if (lifecycle.data.version === 1) {
      const status = lifecycle.data.status;
      if (status === "queued" || status === "running") found.status = status;
    }
  }
  return found;
}

function subagentSnapshotTools(value: unknown): string[] | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined;
  if (!Array.isArray(value.appendSystemPrompt) || value.appendSystemPrompt.some((item) => typeof item !== "string")) return undefined;
  if ("codemode" in value && typeof value.codemode !== "boolean") return undefined;
  if ("mcp" in value && typeof value.mcp !== "boolean") return undefined;
  if (!Array.isArray(value.tools)) return undefined;
  const codemode = value.codemode === true;
  const loadExtensions = value.loadExtensions === true;
  const tools = value.tools.filter((name): name is string => typeof name === "string" && name.length > 0);
  if (tools.length !== value.tools.length) return undefined;
  const valid = tools.every((name) =>
    !SUBAGENT_CONTROL_TOOL_NAMES.has(name)
    && ((name === "codemode" && codemode) || SNAPSHOT_BUILTIN_TOOL_NAMES.has(name) || loadExtensions),
  );
  return valid ? tools : undefined;
}

function sideMetadata(entries: readonly RawEntry[]): { parentSessionId: string; createdAt: string } | null {
  for (const entry of entries) {
    if (entry.type !== "custom" || entry.customType !== SIDE_META_TYPE || !isSideData(entry.data)) continue;
    return { parentSessionId: entry.data.parentSessionId, createdAt: entry.data.createdAt };
  }
  return null;
}

function readSessionToolSelection(entries: readonly RawEntry[]): string[] | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== TOOL_SELECTION_TYPE || !isRecord(entry.data)) continue;
    if (entry.data.version !== 1) continue;
    if (entry.data.cleared === true) return undefined;
    const tools = entry.data.tools;
    if (!Array.isArray(tools) || tools.some((name) => typeof name !== "string" || !TOOL_SELECTION_NAMES.has(name))) continue;
    return [...new Set(tools.filter((name): name is string => typeof name === "string"))];
  }
  return undefined;
}

function sideOwnEntries<T extends { timestamp?: unknown }>(entries: readonly T[]): readonly T[] {
  let createdAt: string | undefined;
  for (const entry of entries as unknown as readonly RawEntry[]) {
    if (entry.type === "custom" && entry.customType === SIDE_META_TYPE && isSideData(entry.data)) {
      createdAt = entry.data.createdAt;
      break;
    }
  }
  if (!createdAt) return entries;
  return entries.filter((entry) => (typeof entry.timestamp === "string" ? entry.timestamp : "") > createdAt);
}

function labelsOf(entries: readonly RawEntry[]): {
  labels: Map<string, string>;
  timestamps: Map<string, string | undefined>;
} {
  const labels = new Map<string, string>();
  const timestamps = new Map<string, string | undefined>();
  for (const entry of entries) {
    if (entry.type !== "label" || typeof entry.targetId !== "string") continue;
    if (typeof entry.label === "string" && entry.label) {
      labels.set(entry.targetId, entry.label);
      timestamps.set(entry.targetId, typeof entry.timestamp === "string" ? entry.timestamp : undefined);
    } else {
      labels.delete(entry.targetId);
      timestamps.delete(entry.targetId);
    }
  }
  return { labels, timestamps };
}

// --- project identity (cwd → repo root / branch) ---------------------------

interface ProjectInfo {
  projectRoot: string;
  branch: string | null;
  isWorktree: boolean;
  isTopLevel: boolean;
}

interface ProjectCacheEntry {
  info: ProjectInfo;
  expiresAt: number;
}

const projectCache = new Map<string, ProjectCacheEntry>();
const PROJECT_CACHE_TTL_MS = 60_000;

async function readSmallFile(filePath: string): Promise<string | null> {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size > 256 * 1024) return null;
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

function branchFromHead(head: string | null): string | null {
  if (!head) return null;
  const match = /^ref:\s*refs\/heads\/(.+)$/m.exec(head.trim());
  return match ? match[1].trim() || null : null;
}

async function gitIdentityAt(checkout: string): Promise<{ gitDir: string; commonDir: string; isWorktree: boolean; branch: string | null } | null> {
  const dotGit = path.join(checkout, ".git");
  let gitDir: string | null = null;
  try {
    const info = await stat(dotGit);
    if (info.isDirectory()) {
      gitDir = dotGit;
    } else if (info.isFile()) {
      const content = await readSmallFile(dotGit);
      const match = content ? /^gitdir:\s*(.+?)\s*$/m.exec(content) : null;
      if (match) gitDir = path.resolve(checkout, match[1]);
    }
  } catch {
    return null;
  }
  if (!gitDir) return null;

  let commonDir = gitDir;
  const commonFile = await readSmallFile(path.join(gitDir, "commondir"));
  if (commonFile?.trim()) commonDir = path.resolve(gitDir, commonFile.trim());
  const branch = branchFromHead(await readSmallFile(path.join(gitDir, "HEAD")));
  return { gitDir, commonDir, isWorktree: pathKey(gitDir) !== pathKey(commonDir), branch };
}

function repoRootFromCommonDir(commonDir: string): string {
  return path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir;
}

async function resolveProjectUncached(cwd: string): Promise<ProjectInfo> {
  if (!cwd) return { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
  const cwdInfo = await stat(cwd).catch(() => null);
  if (!cwdInfo || !cwdInfo.isDirectory()) {
    return { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
  }
  let current = path.resolve(cwd);
  const top = current;
  for (let depth = 0; depth < 64; depth += 1) {
    const identity = await gitIdentityAt(current);
    if (identity) {
      const topLevel = depth === 0;
      const projectRoot = topLevel && identity.isWorktree ? repoRootFromCommonDir(identity.commonDir) : current;
      return {
        projectRoot,
        branch: identity.branch,
        isWorktree: topLevel && identity.isWorktree,
        isTopLevel: topLevel,
      };
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { projectRoot: top, branch: null, isWorktree: false, isTopLevel: false };
}

async function resolveProject(cwd: string): Promise<ProjectInfo> {
  const cached = projectCache.get(cwd);
  if (cached && cached.expiresAt > Date.now()) return cached.info;
  let info: ProjectInfo;
  try {
    info = await resolveProjectUncached(cwd);
  } catch {
    info = { projectRoot: cwd, branch: null, isWorktree: false, isTopLevel: false };
  }
  projectCache.set(cwd, { info, expiresAt: Date.now() + PROJECT_CACHE_TTL_MS });
  return info;
}

async function attachProjectInfo(rows: SessionInfo[]): Promise<SessionInfo[]> {
  const cwds = [...new Set(rows.map((row) => row.cwd).filter(Boolean))];
  const byCwd = new Map<string, ProjectInfo>();
  for (const cwd of cwds) byCwd.set(cwd, await resolveProject(cwd));
  return rows.map((row) => {
    const project = row.cwd ? byCwd.get(row.cwd) : undefined;
    const projectRoot = project?.projectRoot ?? row.cwd;
    return {
      ...row,
      projectRoot,
      projectKey: projectIdentityKey(projectRoot),
      ...(project?.branch ? { branch: project.branch } : {}),
      ...(project?.isWorktree ? { isWorktree: true } : {}),
    };
  });
}

// --- enumerating session files --------------------------------------------

let enumerationCache: { at: number; files: string[] } | null = null;
let directorySignature: string | null = null;

/**
 * The session tree's cheap revision, for the sidebar's 2.5 s poll: the
 * directory listing and each project folder's mtime. A new, removed or renamed
 * session changes one of them; appending to an existing transcript does not,
 * which is exactly the line the stat cache draws. When it changes, the row
 * list is invalidated and every file is stat'ed once more; otherwise the poll
 * touches only this signature, never the 730 transcripts.
 */
export async function refreshSessionDirectory(): Promise<void> {
  const root = sessionsDirectory();
  let directories: string[];
  try {
    directories = await readdir(root);
  } catch {
    directorySignature = null;
    return;
  }
  const parts: string[] = [];
  for (const directory of directories) {
    try {
      const info = await stat(path.join(root, directory));
      parts.push(`${directory}:${info.mtimeMs}`);
    } catch {
      // A file at the root, or a folder that vanished: it is not a session
      // folder and changes nothing on its own.
    }
  }
  const signature = parts.sort().join("|");
  if (directorySignature !== null && signature !== directorySignature) {
    sessionListVersion += 1;
    enumerationCache = null;
    statCache.clear();
  }
  directorySignature = signature;
}

async function enumerateSessionFiles(force = false): Promise<string[]> {
  if (!force && enumerationCache && Date.now() - enumerationCache.at < 2000) {
    return [...enumerationCache.files];
  }
  const root = sessionsDirectory();
  let directories: string[];
  try {
    directories = await readdir(root);
  } catch {
    enumerationCache = { at: Date.now(), files: [] };
    return [];
  }
  const files: string[] = [];
  for (const directory of directories) {
    const directoryPath = path.join(root, directory);
    try {
      const entries = await readdir(directoryPath);
      for (const entry of entries) {
        if (entry.endsWith(".jsonl")) files.push(path.join(directoryPath, entry));
      }
    } catch {
      // A file at the root, or an unreadable project folder: skip as absent.
    }
  }
  enumerationCache = { at: Date.now(), files };
  return [...files];
}

interface FileStat {
  filePath: string;
  size: number;
  mtimeMs: number;
}

/**
 * The last stat of each session file, reused while the file list does not
 * change. The sidebar polls the list every 2.5 s; 730 `stat` calls a poll cost
 * ~0.9 s of CPU, and a transcript only changes in place when its session runs.
 * Running sessions are therefore re-stat'ed every poll (their time and order
 * still move), and everything else is reused until the file appears, vanishes,
 * or a route that wrote it clears the entry (`forgetPathCaches`).
 */
const statCache = new Map<string, FileStat>();

async function statSessionFiles(files: readonly string[]): Promise<FileStat[]> {
  const running = new Set(runningSessionIds());
  const stats = new Map<string, FileStat>();
  const missing: string[] = [];
  for (const filePath of files) {
    const id = sessionIdFromPath(filePath);
    const cached = statCache.get(filePath);
    if (cached && (id === undefined || !running.has(id))) stats.set(filePath, cached);
    else missing.push(filePath);
  }
  const batch = 32;
  for (let start = 0; start < missing.length; start += batch) {
    const slice = missing.slice(start, start + batch);
    const fresh = await Promise.all(slice.map(async (filePath) => {
      try {
        const info = await stat(filePath);
        return info.isFile() ? { filePath, size: info.size, mtimeMs: info.mtimeMs } : null;
      } catch {
        return null;
      }
    }));
    for (let index = 0; index < fresh.length; index += 1) {
      const entry = fresh[index];
      if (entry) {
        stats.set(entry.filePath, entry);
        statCache.set(entry.filePath, entry);
      } else {
        statCache.delete(slice[index]);
      }
    }
  }
  // A deleted file must not keep its old stat for a path a later session takes.
  const alive = new Set(files);
  for (const filePath of statCache.keys()) if (!alive.has(filePath)) statCache.delete(filePath);
  return files.flatMap((filePath) => {
    const entry = stats.get(filePath);
    return entry ? [entry] : [];
  });
}

let idPathCache = new Map<string, string>();

async function resolveSessionPathById(id: string): Promise<string | null> {
  if (!SESSION_ID_PATTERN.test(id)) return null;
  const cached = idPathCache.get(id);
  if (cached && await fileExists(cached)) return cached;

  const files = await enumerateSessionFiles();
  for (const filePath of files) {
    if (sessionIdFromPath(filePath) !== id) continue;
    if (!await fileExists(filePath)) continue;
    idPathCache.set(id, filePath);
    return filePath;
  }
  const found = await sessionFilePath(id);
  if (found) idPathCache.set(id, found);
  return found;
}

async function sessionIdForPath(filePath: string): Promise<string | undefined> {
  if (!isInside(sessionsDirectory(), filePath)) return undefined;
  return sessionIdFromPath(filePath);
}

function forgetPathCaches(filePath?: string, id?: string): void {
  enumerationCache = null;
  if (filePath) statCache.delete(filePath);
  if (filePath) {
    idPathCache.delete(id ?? sessionIdFromPath(filePath) ?? "");
    listRowCache.delete(filePath);
    usageCache.delete(filePath);
  }
  if (id) idPathCache.delete(id);
}

// --- the session catalogue -------------------------------------------------

interface ListRowCacheEntry {
  size: number;
  mtimeMs: number;
  row: SessionInfo;
  detailsPending: boolean;
  parentSessionPath?: string;
}

/** Small row cache keyed by path; `summary` rows are kept too, so a poll does not reread transcripts. */
const listRowCache = new Map<string, ListRowCacheEntry>();

/**
 * The same rows, kept across launches in the app's data directory.
 *
 * A cold scan reads every session file (this machine: 934 files, 1.8 GB) just to
 * learn each one's message count and first message — seconds of work and a
 * memory spike on every launch. The rows are ~300 bytes each, so the cache is
 * ~300 KB and turns the next launch into one `stat` per file.
 */
const ROW_CACHE_FILE = "local-session-rows.json";
// Version 2 titles summary rows by their first user message; version 1 rows
// carry an empty firstMessage, so they have to be rescanned once. Version 3
// reads past a long system-prompt line (version 2 stopped at 64 KiB and left
// those sessions on their file name), so those rows are rebuilt too.
const ROW_CACHE_VERSION = 3;
let rowCacheLoaded: Promise<void> | null = null;
let rowCacheSaveTimer: ReturnType<typeof setTimeout> | null = null;

function rowCachePath(): string {
  // Next to pi's own files rather than in the app's data dir: a `nsh test` host
  // gets a fresh data dir per test, and a cold scan there costs every test the
  // whole history (seconds each). `~/.pi/agent` is stable, and this is the same
  // folder the sidebar's pins/archive state lives in.
  return path.join(piAgentDirectory(), ROW_CACHE_FILE);
}

async function loadRowCache(): Promise<void> {
  try {
    const saved = JSON.parse(await readFile(rowCachePath(), "utf8")) as {
      version?: number;
      rows?: Array<[string, ListRowCacheEntry]>;
    };
    if (saved.version !== ROW_CACHE_VERSION || !Array.isArray(saved.rows)) return;
    for (const [key, entry] of saved.rows) {
      if (entry !== null && typeof entry === "object" && entry.row && typeof entry.size === "number") {
        listRowCache.set(key, entry);
      }
    }
  } catch {
    // No cache yet, or an unreadable one: the scan below builds it.
  }
}

function saveRowCache(): void {
  if (rowCacheSaveTimer !== null) return;
  rowCacheSaveTimer = setTimeout(() => {
    rowCacheSaveTimer = null;
    const payload = JSON.stringify({ version: ROW_CACHE_VERSION, rows: [...listRowCache.entries()] });
    void writeFile(rowCachePath(), payload).catch(() => {
      // A read-only or full data directory only costs the next launch a scan.
    });
  }, 1500);
}
const usageCache = new Map<string, { size: number; mtimeMs: number; entryCount: number; leafId: string | null; summary: SessionUsageSummary }>();

let sessionListVersion = 0;
let membershipSignature: string | null = null;

function noteMembership(files: readonly string[]): void {
  const signature = [...files].sort().join("\n");
  if (membershipSignature !== null && membershipSignature !== signature) {
    sessionListVersion += 1;
  }
  membershipSignature = signature;
}

function bumpSessionListVersion(): void {
  sessionListVersion += 1;
  membershipSignature = null;
}

/**
 * The list's revision, for the running poll: a rename, a delete or a fork has
 * to reach the sidebar through the same number it polls, or the row keeps the
 * old title until something else happens to change it.
 */
export function sessionCatalogueRevision(): number {
  return sessionListVersion;
}

interface FoldedSession {
  name?: string;
  messageCount: number;
  firstMessage: string;
  lastActivityTime?: number;
  subagent: SubagentMetadata | null;
  side: { parentSessionId: string; createdAt: string } | null;
  toolSelection?: string[];
}

function foldSessionEntries(entries: readonly RawEntry[]): FoldedSession {
  let name: string | undefined;
  let messageCount = 0;
  let firstMessage = "";
  let lastActivityTime: number | undefined;
  for (const entry of entries) {
    if (entry.type === "session_info") {
      name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : undefined;
    }
    if (entry.type !== "message") continue;
    messageCount += 1;
    const activity = entryActivityTime(entry);
    if (activity !== undefined) {
      lastActivityTime = Math.max(lastActivityTime ?? 0, activity);
    }
    if (firstMessage) continue;
    const message = entry.message;
    if (!isRecord(message) || typeof message.role !== "string" || !("content" in message)) continue;
    if (message.role !== "user") continue;
    firstMessage = extractTextContent(message);
  }
  const toolSelection = readSessionToolSelection(entries);
  return {
    ...(name ? { name } : {}),
    messageCount,
    firstMessage,
    ...(lastActivityTime !== undefined ? { lastActivityTime } : {}),
    subagent: subagentMetadata(entries),
    side: sideMetadata(entries),
    ...(toolSelection !== undefined ? { toolSelection } : {}),
  };
}

function relationFor(
  header: RawEntry,
  folded: FoldedSession,
  pathToId: ReadonlyMap<string, string>,
): { parentSessionId?: string; relation?: SessionInfo["relation"] } {
  const parentPath = typeof header.parentSession === "string" ? header.parentSession : undefined;
  const originSessionId = parentPath ? pathToId.get(pathKey(parentPath)) : undefined;
  if (folded.subagent) {
    return {
      parentSessionId: originSessionId,
      relation: {
        kind: "subagent",
        parentSessionId: folded.subagent.parentSessionId,
        profile: folded.subagent.profile,
        description: folded.subagent.description,
        status: folded.subagent.status as "starting" | "queued" | "running" | "completed" | "failed" | "aborted" | "interrupted",
      },
    };
  }
  if (folded.side) {
    return {
      parentSessionId: originSessionId,
      relation: { kind: "side", parentSessionId: folded.side.parentSessionId },
    };
  }
  if (parentPath) {
    return {
      parentSessionId: originSessionId,
      relation: { kind: "fork", ...(originSessionId ? { originSessionId } : {}) },
    };
  }
  return {};
}

function timeIso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function headerTime(header: RawEntry): number | undefined {
  const raw = typeof header.timestamp === "string" ? Date.parse(header.timestamp) : Number.NaN;
  return Number.isNaN(raw) ? undefined : raw;
}

interface ScannedListRow {
  row: SessionInfo;
  mtimeMs: number;
  detailsPending: boolean;
  parentSessionPath?: string;
}

function makeRow(
  filePath: string,
  header: RawEntry,
  folded: FoldedSession,
  pathToId: ReadonlyMap<string, string>,
  modified: string,
  detailsPending: boolean,
): SessionInfo {
  const relation = relationFor(header, folded, pathToId);
  return {
    path: filePath,
    id: typeof header.id === "string" ? header.id : "",
    cwd: typeof header.cwd === "string" ? header.cwd : "",
    ...(folded.name ? { name: folded.name } : {}),
    created: typeof header.timestamp === "string" ? header.timestamp : "",
    modified,
    messageCount: folded.messageCount,
    firstMessage: detailsPending && !folded.firstMessage
      ? ""
      : catalogFirstMessage(folded.firstMessage || "(no messages)"),
    ...(relation.parentSessionId ? { parentSessionId: relation.parentSessionId } : {}),
    ...(relation.relation ? { relation: relation.relation } : {}),
    transient: false,
    ...(detailsPending ? { detailsPending: true } : {}),
  };
}

function scanSummaryRow(
  filePath: string,
  file: FileText,
  pathToId: ReadonlyMap<string, string>,
): ScannedListRow | null {
  const header = findHeader(file.text);
  if (!header) return null;
  if (typeof header.id !== "string" || typeof header.cwd !== "string" || typeof header.timestamp !== "string") return null;
  const created = Date.parse(header.timestamp);
  if (!Number.isFinite(created)) return null;

  const folded: FoldedSession = {
    messageCount: 0,
    firstMessage: catalogFirstMessage(firstUserMessageInHead(file.text)),
    subagent: null,
    side: null,
  };
  const second = secondEntry(file.text);
  if (second?.type === "custom" && second.customType === SUBAGENT_META_TYPE && isSubagentData(second.data)) {
    const data = second.data;
    let status = "interrupted";
    for (const entry of tailEntries(file.text)) {
      if (entry.type !== "custom") continue;
      if (entry.customType === SUBAGENT_RESULT_TYPE && isRecord(entry.data)) {
        const value = entry.data.status;
        if (value === "completed" || value === "failed" || value === "aborted") {
          status = value;
          break;
        }
      } else if (entry.customType === SUBAGENT_STATUS_TYPE && isRecord(entry.data)) {
        const value = entry.data.status;
        if (entry.data.version === 1 && (value === "queued" || value === "running")) {
          status = value;
          break;
        }
      }
    }
    folded.subagent = {
      parentSessionId: data.parentSessionId,
      parentSessionPath: data.parentSessionPath,
      profile: typeof data.profile === "string" ? data.profile : "general-purpose",
      description: typeof data.description === "string" ? data.description : "Subagent",
      status,
    };
  } else if (second?.type === "custom" && second.customType === SIDE_META_TYPE && isSideData(second.data)) {
    folded.side = { parentSessionId: second.data.parentSessionId, createdAt: second.data.createdAt };
  }
  const row = makeRow(filePath, header, folded, pathToId, timeIso(file.mtimeMs), true);
  return {
    row,
    mtimeMs: file.mtimeMs,
    detailsPending: true,
    ...(typeof header.parentSession === "string" ? { parentSessionPath: header.parentSession } : {}),
  };
}

function scanFullRow(
  filePath: string,
  file: FileText,
  pathToId: ReadonlyMap<string, string>,
): ScannedListRow | null {
  const parsed = parseSession(file.text);
  const header = parsed.header;
  if (!header || typeof header.id !== "string" || typeof header.cwd !== "string") return null;
  const folded = foldSessionEntries(parsed.entries);
  const headerMillis = headerTime(header);
  const modifiedMillis = folded.lastActivityTime !== undefined && folded.lastActivityTime > 0
    ? folded.lastActivityTime
    : headerMillis !== undefined
      ? headerMillis
      : Math.round(file.mtimeMs);
  const row = makeRow(filePath, header, folded, pathToId, timeIso(modifiedMillis), false);
  return {
    row,
    mtimeMs: file.mtimeMs,
    detailsPending: false,
    ...(typeof header.parentSession === "string" ? { parentSessionPath: header.parentSession } : {}),
  };
}

/** `task` over `items`, `limit` at a time, results in input order. */
async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index]);
    }
  };
  const workers: Promise<void>[] = [];
  for (let index = 0; index < Math.min(limit, items.length); index += 1) workers.push(worker());
  await Promise.all(workers);
  return results;
}

async function buildSessionCatalogue(options: { summary: boolean; force: boolean }): Promise<SessionInfo[]> {
  if (options.force) {
    listRowCache.clear();
    projectCache.clear();
    statCache.clear();
    // The old server's forced scan invalidated its list generation; a caller
    // comparing versions should see that the snapshot was rebuilt.
    if (!options.summary) sessionListVersion += 1;
  }
  const startedAt = Date.now();
  if (rowCacheLoaded === null) rowCacheLoaded = loadRowCache();
  await rowCacheLoaded;
  const cachedRows = listRowCache.size;
  const files = await enumerateSessionFiles(options.force);
  noteMembership(files);
  const stats = await statSessionFiles(files);
  const pathToId = new Map<string, string>();
  for (const file of stats) {
    const id = sessionIdFromPath(file.filePath);
    if (id) pathToId.set(pathKey(file.filePath), id);
  }

  // Reads run a few at a time: the first scan of a real history is ~900 files,
  // and one `readFile` after another is what made it take seconds. The cap
  // keeps the peak memory of a few 40 MB transcripts bounded.
  const READ_CONCURRENCY = 4;
  const rows = (
    await mapPool(stats, READ_CONCURRENCY, async (file) => {
      const cached = listRowCache.get(file.filePath);
      const fresh = cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs;
      if (fresh && (options.summary || !cached.detailsPending)) {
        return { row: cached.row, mtimeMs: cached.mtimeMs };
      }

      const contents = await readSessionText(file.filePath);
      if (!contents) {
        // Past readFile's limit: keep the row visible with header-only metadata.
        const header = cached?.row;
        return header ? { row: header, mtimeMs: file.mtimeMs } : null;
      }
      const scanned = options.summary
        ? scanSummaryRow(file.filePath, contents, pathToId)
        : scanFullRow(file.filePath, contents, pathToId);
      if (!scanned) {
        listRowCache.delete(file.filePath);
        return null;
      }
      listRowCache.set(file.filePath, {
        size: file.size,
        mtimeMs: file.mtimeMs,
        row: scanned.row,
        detailsPending: scanned.detailsPending,
        ...(scanned.parentSessionPath ? { parentSessionPath: scanned.parentSessionPath } : {}),
      });
      return { row: scanned.row, mtimeMs: file.mtimeMs };
    })
  ).filter((entry): entry is { row: SessionInfo; mtimeMs: number } => entry !== null);

  // Sessions deleted while the app was closed leave their rows behind
  // otherwise, and the cache would only grow.
  const alive = new Set(stats.map((file) => file.filePath));
  for (const cachedPath of [...listRowCache.keys()]) {
    if (!alive.has(cachedPath)) listRowCache.delete(cachedPath);
  }
  saveRowCache();
  // The first scan of a history is the one worth seeing in the log (seconds);
  // a warm poll is 50 ms and would just fill the file.
  const elapsed = Date.now() - startedAt;
  if (cachedRows === 0 || elapsed > 500) {
    console.log(
      `[local] sessions: ${rows.length} rows in ${elapsed} ms`
      + ` (${cachedRows > 0 ? `${cachedRows} cached` : "cold"})`,
    );
  }

  rows.sort((left, right) =>
    right.row.modified.localeCompare(left.row.modified)
    || right.mtimeMs - left.mtimeMs
    || path.basename(right.row.path).localeCompare(path.basename(left.row.path)),
  );
  return attachProjectInfo(rows.map((entry) => entry.row));
}

// --- one session -----------------------------------------------------------

interface LoadedSession {
  filePath: string;
  file: FileText;
  header: RawEntry | null;
  entries: RawEntry[];
  leafId: string | null;
}

async function loadSession(id: string): Promise<LoadedSession | null> {
  const filePath = await resolveSessionPathById(id);
  if (!filePath) return null;
  const file = await readSessionText(filePath);
  if (!file) return null;
  const parsed = parseSession(file.text);
  const last = parsed.entries[parsed.entries.length - 1];
  return {
    filePath,
    file,
    header: parsed.header,
    entries: parsed.entries,
    leafId: last && typeof last.id === "string" ? last.id : null,
  };
}

function firstUserText(entries: readonly RawEntry[]): string {
  for (const entry of entries) {
    if (entry.type !== "message" || !isRecord(entry.message)) continue;
    if (entry.message.role !== "user" || !("content" in entry.message)) continue;
    return extractTextContent(entry.message);
  }
  return "";
}

function firstUserMessage(entries: readonly RawEntry[]): RawEntry | undefined {
  for (const entry of entries) {
    if (entry.type !== "message" || !isRecord(entry.message)) continue;
    if (entry.message.role === "user") return entry.message;
  }
  return undefined;
}

async function sessionInfoForView(
  id: string,
  loaded: LoadedSession,
  stats: SessionFileStats,
  pathToId: ReadonlyMap<string, string>,
): Promise<SessionInfo | null> {
  const header = loaded.header;
  if (!header) return null;
  const folded = foldSessionEntries(loaded.entries);
  const firstUser = firstUserMessage(loaded.entries);
  const firstText = firstUser
    ? (() => {
        const content = firstUser.content;
        if (typeof content === "string") return content;
        if (!Array.isArray(content)) return "";
        const block = content.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string");
        return isRecord(block) && typeof block.text === "string" ? block.text : "";
      })()
    : "";
  const relation = relationFor(header, folded, pathToId);
  const parentPath = typeof header.parentSession === "string" ? header.parentSession : undefined;
  const parentSessionId = parentPath ? await sessionIdForPath(parentPath) : undefined;
  const sessionName = folded.name;
  return {
    path: loaded.filePath,
    id: typeof header.id === "string" ? header.id : id,
    cwd: typeof header.cwd === "string" ? header.cwd : "",
    ...(sessionName ? { name: sessionName } : {}),
    created: typeof header.timestamp === "string" ? header.timestamp : "",
    modified: timeIso(Math.round(loaded.file.mtimeMs)),
    messageCount: stats.totalMessages,
    firstMessage: firstText || "(no messages)",
    parentSessionId,
    ...(folded.subagent
      ? { relation: relation.relation }
      : folded.side
        ? { relation: relation.relation }
        : parentPath
          ? { relation: { kind: "fork" as const, ...(parentSessionId ? { originSessionId: parentSessionId } : {}) } }
          : {}),
    transient: false,
  };
}

function statsForEntries(entries: readonly RawEntry[]): SessionFileStats {
  const stats = emptyStats();
  for (const entry of entries) {
    if (entry.type === "compaction" || entry.type === "branch_summary" || entry.type === "usage") {
      addUsage(stats, entry.usage);
      continue;
    }
    if (entry.type !== "message" || !isRecord(entry.message)) continue;
    addMessage(stats, entry.message);
  }
  finishStats(stats);
  return stats;
}

function emptyStats(): SessionFileStats {
  return {
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    totalMessages: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

function addUsage(stats: SessionFileStats, value: unknown): void {
  if (!isRecord(value)) return;
  const usage = value as Partial<AgentUsage>;
  stats.tokens.input += numberOrUndefined(usage.input) ?? 0;
  stats.tokens.output += numberOrUndefined(usage.output) ?? 0;
  stats.tokens.cacheRead += numberOrUndefined(usage.cacheRead) ?? 0;
  stats.tokens.cacheWrite += numberOrUndefined(usage.cacheWrite) ?? 0;
  stats.cost += isRecord(usage.cost) ? numberOrUndefined(usage.cost.total) ?? 0 : 0;
}

function addMessage(stats: SessionFileStats, message: RawEntry): void {
  stats.totalMessages += 1;
  if (message.role === "user") {
    stats.userMessages += 1;
  } else if (message.role === "toolResult") {
    stats.toolResults += 1;
    addUsage(stats, message.usage);
  } else if (message.role === "assistant") {
    stats.assistantMessages += 1;
    if (Array.isArray(message.content)) {
      stats.toolCalls += message.content.filter((block) => isRecord(block) && block.type === "toolCall").length;
    }
    addUsage(stats, message.usage);
  }
}

function finishStats(stats: SessionFileStats): void {
  stats.tokens.total = stats.tokens.input + stats.tokens.output + stats.tokens.cacheRead + stats.tokens.cacheWrite;
}

function computeTotalActiveMs(entries: readonly RawEntry[]): number {
  let total = 0;
  let previous: number | undefined;
  for (const entry of entries) {
    if (entry.type !== "message" && entry.type !== "compaction"
      && entry.type !== "branch_summary" && entry.type !== "custom_message") continue;
    const timestamp = parseTimestamp(entry);
    if (timestamp === undefined) continue;
    const role = entry.type === "message" && isRecord(entry.message) ? entry.message.role : undefined;
    if (role === "user" || role === "bashExecution") {
      previous = timestamp;
      continue;
    }
    if (previous !== undefined && timestamp > previous) total += timestamp - previous;
    previous = timestamp;
  }
  return total;
}

function countTurnsBefore(entries: readonly RawEntry[], oldest: RawEntry): number {
  const byId = new Map<string, RawEntry>();
  for (const entry of entries) {
    if (typeof entry.id === "string") byId.set(entry.id, entry);
  }
  let turns = 0;
  const seen = new Set<string>();
  let current = typeof oldest.parentId === "string" ? byId.get(oldest.parentId) : undefined;
  while (current) {
    if (typeof current.id === "string") {
      if (seen.has(current.id)) break;
      seen.add(current.id);
    }
    const shape = turnAnchorShape(current);
    if (shape && isMessageGroupAnchor(shape as { role?: AgentMessage["role"]; customType?: string; display?: boolean })) {
      turns += 1;
    }
    current = typeof current.parentId === "string" ? byId.get(current.parentId) : undefined;
  }
  return turns;
}

function turnAnchorShape(entry: RawEntry): RawEntry | null {
  switch (entry.type) {
    case "message": {
      if (!isRecord(entry.message) || entry.message.role === "system") return null;
      return entry.message;
    }
    case "compaction":
      return { role: "custom", customType: "compaction", display: true };
    case "branch_summary":
      return entry.summary ? { role: "user" } : null;
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        display: entry.display === true,
      };
    default:
      return null;
  }
}

function countsTowardTail(entry: RawEntry): boolean {
  if (entry.type === "compaction") return true;
  if (entry.type !== "message" || !isRecord(entry.message)) return false;
  return entry.message.role === "user" || entry.message.role === "assistant";
}

const MIN_RAW_WINDOW_ENTRIES = 200;
const rawWindowCap = (tail: number): number => Math.max(MIN_RAW_WINDOW_ENTRIES, tail * 6);

function sliceActiveBranch(
  entries: readonly RawEntry[],
  leafId: string | null,
  tail: number,
  excludeLeaf = false,
): RawEntry[] {
  if (tail <= 0) return [...entries];
  const byId = new Map<string, RawEntry>();
  for (const entry of entries) {
    if (typeof entry.id === "string") byId.set(entry.id, entry);
  }
  let leaf = leafId ? byId.get(leafId) : entries[entries.length - 1];
  if (excludeLeaf) leaf = leaf && typeof leaf.parentId === "string" ? byId.get(leaf.parentId) : undefined;
  if (!leaf) return [];
  const chain: RawEntry[] = [];
  const seen = new Set<string>();
  let current: RawEntry | undefined = leaf;
  let visible = 0;
  const cap = rawWindowCap(tail);
  while (current) {
    if (typeof current.id === "string") {
      if (seen.has(current.id)) break;
      seen.add(current.id);
    }
    chain.push(current);
    if (countsTowardTail(current)) visible += 1;
    if (visible >= tail || chain.length >= cap) break;
    current = typeof current.parentId === "string" ? byId.get(current.parentId) : undefined;
  }
  chain.reverse();
  return chain;
}

function getSessionSettings(
  entries: readonly RawEntry[],
  leafId: string | null | undefined,
): Pick<SessionContext, "thinkingLevel" | "model"> {
  if (leafId === null) return { thinkingLevel: "off", model: null };
  const branch = sliceActiveBranch(entries, leafId ?? null, entries.length);
  let thinkingLevel: string | undefined;
  let responseModel: SessionContext["model"] | undefined;
  for (let index = branch.length - 1; index >= 0 && (thinkingLevel === undefined || responseModel === undefined); index -= 1) {
    const entry = branch[index];
    if (thinkingLevel === undefined && entry.type === "thinking_level_change" && typeof entry.thinkingLevel === "string") {
      thinkingLevel = entry.thinkingLevel;
    }
    if (responseModel === undefined && entry.type === "message" && isRecord(entry.message)
      && entry.message.role === "assistant"
      && typeof entry.message.provider === "string"
      && typeof entry.message.model === "string") {
      responseModel = { provider: entry.message.provider, modelId: entry.message.model };
    }
  }
  let model: SessionContext["model"] = null;
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry.type === "model_change" && typeof entry.provider === "string" && typeof entry.modelId === "string") {
      model = { provider: entry.provider, modelId: entry.modelId };
      break;
    }
  }
  return { thinkingLevel: thinkingLevel ?? "off", model: model ?? responseModel ?? null };
}

// --- context / transcript projection --------------------------------------

const SIGNATURE_FIELDS = ["thinkingSignature", "textSignature", "thoughtSignature"] as const;

function withoutMessageSignatures(value: unknown): unknown {
  if (!isRecord(value) || value.role !== "assistant" || !Array.isArray(value.content)) return value;
  let changed = false;
  const content = value.content.map((block: unknown) => {
    if (!isRecord(block) || !SIGNATURE_FIELDS.some((field) => Object.hasOwn(block, field))) return block;
    const copy = { ...block };
    for (const field of SIGNATURE_FIELDS) delete copy[field];
    changed = true;
    return copy;
  });
  return changed ? { ...value, content } : value;
}

function deferredThinkingMessage(message: RawEntry): RawEntry {
  if (message.role !== "assistant" || !Array.isArray(message.content)) return message;
  return {
    ...message,
    content: message.content.map((block: unknown) => {
      if (!isRecord(block) || block.type !== "thinking" || typeof block.thinking !== "string") return block;
      if (block.thinking.trim() === "") return block;
      return { ...block, thinking: getThinkingPreview(block.thinking), deferred: true };
    }),
  };
}

function normalizeMessage(entry: RawEntry): RawEntry | null {
  if (!isRecord(entry.message)) return null;
  const message = entry.message;
  if (message.role === "system") return null;
  const display = withoutMessageSignatures(message) as RawEntry;
  let normalized = normalizeToolCalls(display as unknown as AgentMessage) as unknown as RawEntry;
  if (normalized.role === "assistant" && typeof normalized.content === "string") {
    normalized = { ...normalized, content: [{ type: "text", text: normalized.content }] };
  }
  return normalized;
}

function entryToUiMessage(entry: RawEntry, options: { deferThinking: boolean }): RawEntry | null {
  switch (entry.type) {
    case "message": {
      const normalized = normalizeMessage(entry);
      if (!normalized) return null;
      return options.deferThinking ? deferredThinkingMessage(normalized) : normalized;
    }
    case "compaction":
      return {
        role: "custom",
        customType: "compaction",
        content: typeof entry.summary === "string" ? entry.summary : "",
        display: true,
        details: {
          tokensBefore: entry.tokensBefore,
          firstKeptEntryId: entry.firstKeptEntryId,
        },
        timestamp: parseTimestamp(entry),
      };
    case "branch_summary": {
      if (typeof entry.summary !== "string" || !entry.summary) return null;
      return {
        role: "user",
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseTimestamp(entry),
      };
    }
    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        display: entry.display === true,
        details: entry.details,
        timestamp: parseTimestamp(entry),
      };
    default:
      return null;
  }
}

function buildSessionContext(
  entries: readonly RawEntry[],
  leafId: string | null | undefined,
  options: {
    deferThinking?: boolean;
    tail?: number;
    excludeLeaf?: boolean;
  } = {},
): SessionContext {
  const tail = options.tail ?? 0;
  const sliced = leafId === null
    ? []
    : sliceActiveBranch(entries, leafId ?? null, tail > 0 ? tail : entries.length, options.excludeLeaf === true);
  const hasMore = Boolean(tail > 0 && sliced[0] && typeof sliced[0].parentId === "string" && sliced[0].parentId);
  const turnsBefore = hasMore && sliced[0] ? countTurnsBefore(entries, sliced[0]) : 0;

  const messages: AgentMessage[] = [];
  const entryIds: string[] = [];
  for (const entry of sliced) {
    const message = entryToUiMessage(entry, { deferThinking: options.deferThinking === true });
    if (!message) continue;
    messages.push(message as unknown as AgentMessage);
    entryIds.push(typeof entry.id === "string" ? entry.id : "");
  }
  const oldestEntryId = sliced[0] && typeof sliced[0].id === "string" ? sliced[0].id : null;
  return {
    messages,
    entryIds,
    oldestEntryId,
    hasMore,
    turnsBefore,
    ...getSessionSettings(entries, leafId),
  };
}

// --- the navigation tree ---------------------------------------------------

interface TreeNode {
  entry: RawEntry;
  children: TreeNode[];
  label?: string;
  compressedEntryIds?: string[];
  branchPreview?: BranchPreview;
}

function buildTree(entries: readonly RawEntry[]): TreeNode[] {
  const { labels } = labelsOf(entries);
  const nodes = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  for (const entry of entries) {
    if (typeof entry.id !== "string") continue;
    const label = labels.get(entry.id);
    nodes.set(entry.id, {
      entry,
      children: [],
      ...(label ? { label } : {}),
    });
  }
  for (const entry of entries) {
    if (typeof entry.id !== "string") continue;
    const node = nodes.get(entry.id);
    if (!node) continue;
    const parentId = typeof entry.parentId === "string" ? entry.parentId : null;
    if (parentId === null || parentId === entry.id) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(parentId);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    node.children.sort((left, right) => {
      const leftTime = parseTimestamp(left.entry) ?? Number.NaN;
      const rightTime = parseTimestamp(right.entry) ?? Number.NaN;
      return leftTime - rightTime;
    });
    stack.push(...node.children);
  }
  return roots;
}

const MAX_PROJECTED_TREE_DEPTH = 200;
const MAX_BRANCH_PREVIEW_LENGTH = 40;

function appendPreviewText(current: string, value: unknown): string {
  if (typeof value !== "string" || current.length > MAX_BRANCH_PREVIEW_LENGTH) return current;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return current;
  const prefix = current ? `${current} ` : "";
  if (prefix.length >= MAX_BRANCH_PREVIEW_LENGTH + 1) return prefix.slice(0, MAX_BRANCH_PREVIEW_LENGTH + 1);
  const remaining = MAX_BRANCH_PREVIEW_LENGTH + 1 - prefix.length;
  return prefix + normalized.slice(0, remaining);
}

function previewForEntry(entry: RawEntry): BranchPreview | undefined {
  if (entry.type !== "message" || !isRecord(entry.message) || typeof entry.message.role !== "string") return undefined;
  if (entry.message.role === "system") return undefined;
  const content = entry.message.content;
  let preview = "";
  let hasImage = false;
  if (typeof content === "string") {
    preview = appendPreviewText(preview, content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (!isRecord(block)) continue;
      if (block.type === "image") hasImage = true;
      if (block.type === "text") preview = appendPreviewText(preview, block.text);
      if (preview.length > MAX_BRANCH_PREVIEW_LENGTH) break;
    }
  }
  if (preview.length > MAX_BRANCH_PREVIEW_LENGTH) {
    preview = `${preview.slice(0, MAX_BRANCH_PREVIEW_LENGTH)}…`;
  } else if (!preview) {
    preview = hasImage ? "[image]" : entry.message.role === "assistant" ? "[assistant]" : "message";
  }
  const role = entry.message.role === "user" || entry.message.role === "assistant"
    ? entry.message.role
    : undefined;
  return { ...(role ? { role } : {}), text: preview };
}

function cloneEntryForDisplay(entry: RawEntry): RawEntry {
  const message = entry.type === "message" ? withoutMessageSignatures(entry.message) : entry.message;
  return message === entry.message ? entry : { ...entry, message };
}

function projectTree(nodes: readonly TreeNode[]): TreeNode[] {
  const keep = new Set<TreeNode>();
  const roots = new Set(nodes);
  const seen = new Set<TreeNode>();
  const stack = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    if (roots.has(node) || node.children.length !== 1) keep.add(node);
    for (const child of node.children) stack.push(child);
  }

  const cloneNode = (node: TreeNode, compressedEntryIds?: string[], branchPreview?: BranchPreview): TreeNode => ({
    ...node,
    entry: cloneEntryForDisplay(node.entry),
    children: [],
    ...(compressedEntryIds?.length ? { compressedEntryIds } : {}),
    ...(branchPreview ? { branchPreview } : {}),
  });

  const projectedRoots = nodes.map((node) => cloneNode(node, undefined, previewForEntry(node.entry)));
  const tasks = nodes.map((source, index) => ({ source, projected: projectedRoots[index], depth: 1 }));

  const appendFlattened = (source: TreeNode, projectedParent: TreeNode): void => {
    const pending: Array<{ node: TreeNode; compressedEntryIds: string[]; branchPreview?: BranchPreview }> = [
      { node: source, compressedEntryIds: [] },
    ];
    const flattenedSeen = new Set<TreeNode>();
    while (pending.length > 0) {
      const frame = pending.pop();
      if (!frame || flattenedSeen.has(frame.node)) continue;
      flattenedSeen.add(frame.node);
      const nextPreview = frame.branchPreview ?? previewForEntry(frame.node.entry);
      if (keep.has(frame.node)) projectedParent.children.push(cloneNode(frame.node, frame.compressedEntryIds, nextPreview));
      for (let index = frame.node.children.length - 1; index >= 0; index -= 1) {
        const child = frame.node.children[index];
        pending.push({
          node: child,
          compressedEntryIds: keep.has(frame.node) ? [] : [...frame.compressedEntryIds, String(frame.node.entry.id ?? "")],
          branchPreview: keep.has(frame.node) ? undefined : nextPreview,
        });
      }
    }
  };

  while (tasks.length > 0) {
    const task = tasks.pop();
    if (!task) continue;
    const { source, projected, depth } = task;
    for (const sourceChild of source.children) {
      let child = sourceChild;
      if (depth >= MAX_PROJECTED_TREE_DEPTH) {
        appendFlattened(child, projected);
        continue;
      }
      const compressedEntryIds: string[] = [];
      let branchPreview = previewForEntry(child.entry);
      while (!keep.has(child) && child.children.length === 1) {
        compressedEntryIds.push(String(child.entry.id ?? ""));
        child = child.children[0];
        branchPreview ??= previewForEntry(child.entry);
      }
      if (!keep.has(child)) continue;
      const projectedChild = cloneNode(child, compressedEntryIds, branchPreview);
      projected.children.push(projectedChild);
      tasks.push({ source: child, projected: projectedChild, depth: depth + 1 });
    }
  }
  return projectedRoots;
}

function toSummaryTree(nodes: readonly TreeNode[]): SessionTreeSummaryNode[] {
  const roots: SessionTreeSummaryNode[] = [];
  const stack: Array<{ input: TreeNode; into: SessionTreeSummaryNode[] }> = [];
  for (let index = nodes.length - 1; index >= 0; index -= 1) stack.push({ input: nodes[index], into: roots });
  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) continue;
    const input = frame.input;
    const summary: SessionTreeSummaryNode = {
      entry: {
        id: typeof input.entry.id === "string" ? input.entry.id : "",
        parentId: typeof input.entry.parentId === "string" ? input.entry.parentId : null,
        type: typeof input.entry.type === "string" ? input.entry.type : "",
        timestamp: typeof input.entry.timestamp === "string" ? input.entry.timestamp : "",
      },
      children: [],
      ...(input.compressedEntryIds?.length ? { compressedEntryIds: input.compressedEntryIds } : {}),
      ...(input.branchPreview ? { branchPreview: input.branchPreview } : {}),
    };
    frame.into.push(summary);
    for (let index = input.children.length - 1; index >= 0; index -= 1) {
      stack.push({ input: input.children[index], into: summary.children });
    }
  }
  return roots;
}

// --- list / view / context handlers ---------------------------------------

function requestedNumber(value: string | null): number {
  if (value === null || value === "") return Number.NaN;
  return Number(value);
}

async function handleSessionList(request: LocalRequest): Promise<LocalResponse> {
  const summary = request.params.get("summary") === "1";
  const force = request.params.get("force") === "1";
  let sessions: SessionInfo[];
  try {
    sessions = await buildSessionCatalogue({ summary, force });
  } catch (cause) {
    return errorNoStore(describe(cause), 500);
  }
  return jsonResponseNoStore({
    sessions,
    // The running poll reports `max(live set, catalogue)`; the list has to
    // report at least the same number or the sidebar compares 1 with 0 and
    // reloads the whole list on every 2.5 s poll.
    sessionListVersion: Math.max(sessionListVersion, sessionListRevision()),
    runningSessionIds: [],
    awaitingInputSessionIds: [],
    completionNotificationSuppressedSessionIds: [],
  } satisfies import("../api/types").SessionsResponse);
}

async function handleSessionView(request: LocalRequest, id: string): Promise<LocalResponse> {
  const loaded = await loadSession(id);
  if (!loaded) {
    const missing = await resolveSessionPathById(id);
    return missing
      ? errorResponse("Session file is too large to read (64 MiB limit)", 500)
      : errorResponse("Session not found", 404);
  }
  if (!loaded.header) {
    // An empty file is a valid empty session; anything else is not a pi file.
    if (loaded.file.size > 0) return errorResponse("Session file is not a valid pi session", 500);
  }

  const summaryTree = request.params.get("tree") === "summary";
  const deferThinking = request.params.has("deferThinking");
  const rawTail = requestedNumber(request.params.get("tail"));
  const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 0;
  const entries = loaded.entries;
  const leafId = loaded.leafId;
  const context = buildSessionContext(entries, leafId, { deferThinking, tail });
  const tree = buildTree(entries);
  const projected = projectTree(tree);
  const ownEntries = sideOwnEntries(entries);
  const stats = statsForEntries(ownEntries);
  const totalActiveMs = computeTotalActiveMs(ownEntries);

  const pathToId = new Map<string, string>();
  for (const filePath of await enumerateSessionFiles()) {
    const entryId = sessionIdFromPath(filePath);
    if (entryId) pathToId.set(pathKey(filePath), entryId);
  }
  const info = loaded.header ? await sessionInfoForView(id, loaded, stats, pathToId) : null;
  const withProject = info ? (await attachProjectInfo([info]))[0] : null;
  const folded = foldSessionEntries(entries);
  const toolNames = folded.subagent?.tools ?? folded.toolSelection;
  const latest = entries[entries.length - 1];
  const latestId = latest && typeof latest.id === "string" ? latest.id : null;
  const snapshotRevision = [
    loaded.file.size,
    loaded.file.mtimeMs,
    entries.length,
    latestId ?? "",
    leafId ?? "",
  ].join(":");

  const response = {
    sessionId: id,
    filePath: loaded.filePath,
    info: withProject,
    leafId,
    // Compressed: the navigator lists the places the session parts, not every
    // message (pi-next's `selectTopLevelBranches` reads it that way).
    tree: summaryTree ? toSummaryTree(projected) : projected,
    ...(summaryTree ? { treeFormat: "summary" as const } : {}),
    snapshotRevision,
    context,
    stats,
    totalActiveMs,
    ...(toolNames !== undefined ? { toolNames } : {}),
  };
  return jsonResponse(response);
}

async function handleSessionContext(request: LocalRequest, id: string): Promise<LocalResponse> {
  const loaded = await loadSession(id);
  if (!loaded) {
    const missing = await resolveSessionPathById(id);
    return missing
      ? errorResponse("Session file is too large to read (64 MiB limit)", 500)
      : errorResponse("Session not found", 404);
  }
  const leafParam = request.params.get("leafId") ?? undefined;
  const before = request.params.get("before") ?? undefined;
  const rawTail = requestedNumber(request.params.get("tail"));
  const tail = Number.isFinite(rawTail) && rawTail > 0 ? Math.min(rawTail, 1000) : 0;
  const context = buildSessionContext(loaded.entries, before ?? leafParam, {
    deferThinking: request.params.has("deferThinking"),
    tail,
    excludeLeaf: Boolean(before),
  });
  return jsonResponse({
    context,
    tail,
    before: before ?? null,
  } satisfies SessionContextPage);
}

// --- usage summaries -------------------------------------------------------

function usageSummaryFor(loaded: LoadedSession): SessionUsageSummary {
  const ownEntries = sideOwnEntries(loaded.entries);
  const stats = statsForEntries(ownEntries);
  const settings = getSessionSettings(loaded.entries, loaded.leafId);
  return {
    tokens: stats.tokens,
    cost: stats.cost,
    toolCalls: stats.toolCalls,
    totalActiveMs: computeTotalActiveMs(ownEntries),
    ...settings,
  };
}

async function handleStats(request: LocalRequest): Promise<LocalResponse> {
  if (!hasJsonContentType(request)) return errorNoStore("Content-Type must be application/json", 415);
  const body = parseBodyObject(request);
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) return errorNoStore("ids must be a non-empty array", 400);
  if (ids.length > 200) return errorNoStore("ids may hold at most 200 session ids", 400);
  if (!ids.every((id) => typeof id === "string" && SESSION_ID_PATTERN.test(id))) {
    return errorNoStore("ids must be session ids", 400);
  }
  const stats: Record<string, SessionUsageSummary> = {};
  for (const id of new Set(ids as string[])) {
    try {
      const filePath = await resolveSessionPathById(id);
      if (!filePath) continue;
      const info = await stat(filePath).catch(() => null);
      if (!info || !info.isFile() || info.size > MAX_FILE_BYTES) continue;
      const cached = usageCache.get(filePath);
      if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
        stats[id] = cached.summary;
        continue;
      }
      const file = await readSessionText(filePath);
      if (!file) continue;
      const parsed = parseSession(file.text);
      const last = parsed.entries[parsed.entries.length - 1];
      const loaded: LoadedSession = {
        filePath,
        file,
        header: parsed.header,
        entries: parsed.entries,
        leafId: last && typeof last.id === "string" ? last.id : null,
      };
      const summary = usageSummaryFor(loaded);
      usageCache.set(filePath, {
        size: file.size,
        mtimeMs: file.mtimeMs,
        entryCount: parsed.entries.length,
        leafId: loaded.leafId,
        summary,
      });
      stats[id] = summary;
    } catch {
      // Malformed or concurrently removed: leave it out.
    }
  }
  return jsonResponseNoStore({ stats } satisfies SessionStatsResponse);
}

// --- rename ----------------------------------------------------------------

function appendSessionInfoEntry(leafId: string | null, name: string): RawEntry {
  return {
    type: "session_info",
    id: newEntryId(),
    parentId: leafId,
    timestamp: nowIso(),
    name,
  };
}

async function handleRename(request: LocalRequest, id: string): Promise<LocalResponse> {
  const filePath = await resolveSessionPathById(id);
  if (!filePath) return errorResponse("Session not found", 404);
  let body: unknown;
  try {
    body = JSON.parse(request.body ?? "null");
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
  const name = isRecord(body) ? body.name : undefined;
  if (typeof name !== "string") return errorResponse("name is required", 400);

  const loaded = await loadSession(id);
  const trimmed = name.trim();
  const entry = appendSessionInfoEntry(loaded?.leafId ?? null, trimmed.replace(/[\r\n]+/g, " ").trim());
  try {
    await appendSessionLine(filePath, JSON.stringify(entry));
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
  forgetPathCaches(filePath, id);
  bumpSessionListVersion();
  return jsonResponse({ ok: true });
}

// --- writing session files -------------------------------------------------

let posixShellCache: string | null | undefined;

async function posixShell(): Promise<string | null> {
  if (posixShellCache !== undefined) return posixShellCache;
  if (process.platform === "windows") {
    posixShellCache = null;
    return null;
  }
  posixShellCache = await fileExists("/bin/zsh") ? "/bin/zsh" : await fileExists("/bin/bash") ? "/bin/bash" : null;
  return posixShellCache;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

interface ShellResult {
  code: number | null;
  stderr: string;
}

async function runShell(script: string, stdinText?: string): Promise<ShellResult> {
  const shell = await posixShell();
  if (!shell) throw new Error("no POSIX shell is available on this platform");
  return new Promise((resolve, reject) => {
    const options = {
      cwd: process.dataDir ?? undefined,
      ...(stdinText !== undefined ? { stdin: "pipe" as const } : {}),
    };
    let child;
    try {
      child = spawn(shell, ["-c", script], options);
    } catch (cause) {
      reject(cause);
      return;
    }
    let stderr = "";
    child.on("stderr", (line) => {
      stderr += line;
      if (stderr.length > 8192) stderr = stderr.slice(-8192);
    });
    child.on("exit", (result) => {
      if (result.error) {
        reject(new Error(result.error));
        return;
      }
      resolve({ code: result.code ?? null, stderr });
    });
    if (stdinText !== undefined) {
      try {
        child.write(stdinText);
        child.end();
      } catch (cause) {
        child.kill();
        reject(cause);
      }
    }
  });
}

async function appendViaShell(filePath: string, textValue: string): Promise<void> {
  const result = await runShell(`cat >> ${shellQuote(filePath)}`, textValue);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `append failed (exit ${result.code})`);
}

async function appendSessionLine(filePath: string, line: string): Promise<void> {
  if (!isInside(sessionsDirectory(), filePath)) throw new Error("refusing to write outside pi's sessions");
  if (await posixShell()) {
    await appendViaShell(filePath, `${line}\n`);
    return;
  }
  // No POSIX shell (Windows): append by rewriting, which the 8 MiB write cap bounds.
  const existing = await readFile(filePath, "utf8");
  const next = `${existing}${line}\n`;
  if (utf8Length(next) > MAX_WRITE_BYTES) {
    throw new Error("session file is too large to rename on this platform");
  }
  await writeFile(filePath, next);
}

function splitTextIntoChunks(value: string, limit: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < value.length) {
    let end = Math.min(value.length, start + limit);
    let candidate = value.slice(start, end);
    if (utf8Length(candidate) > limit) {
      // Binary search the longest prefix under the byte budget.
      let low = 0;
      let high = candidate.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (utf8Length(value.slice(start, start + middle)) <= limit) low = middle;
        else high = middle - 1;
      }
      end = start + Math.max(1, low);
      candidate = value.slice(start, end);
    }
    // Never split a surrogate pair: the two halves are one code point.
    if (end > start && end < value.length) {
      const last = value.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    }
    // Prefer ending at a newline, so a read rarely sees half a JSON line.
    const newline = candidate.lastIndexOf("\n");
    if (newline > 0 && end < value.length) {
      end = start + newline + 1;
    }
    candidate = value.slice(start, end);
    if (end > start) {
      chunks.push(candidate);
      start = end;
    } else {
      chunks.push(value.slice(start, start + 1));
      start += 1;
    }
  }
  return chunks;
}

async function writeSessionText(filePath: string, value: string): Promise<void> {
  if (!isInside(sessionsDirectory(), filePath)) throw new Error("refusing to write outside pi's sessions");
  if (utf8Length(value) <= MAX_WRITE_BYTES) {
    await writeFile(filePath, value);
    return;
  }
  const shell = await posixShell();
  if (!shell) throw new Error("session is too large to fork on this platform");
  const base = process.dataDir ?? piAgentDirectory();
  const directory = path.join(base, `.pi-next-write-${newEntryId()}`);
  await mkdir(directory, { recursive: true });
  try {
    const chunks = splitTextIntoChunks(value, MAX_WRITE_BYTES - 64 * 1024);
    const files: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const part = path.join(directory, `part-${index}`);
      await writeFile(part, chunks[index]);
      files.push(part);
    }
    for (let start = 0; start < files.length; start += 40) {
      const slice = files.slice(start, start + 40);
      const command = `cat -- ${slice.map((file) => shellQuote(file)).join(" ")} ${start === 0 ? ">" : ">>"} ${shellQuote(filePath)}`;
      const result = await runShell(command);
      if (result.code !== 0) throw new Error(result.stderr.trim() || `write failed (exit ${result.code})`);
    }
  } finally {
    for (const file of await readdir(directory).catch(() => [] as string[])) {
      await unlink(path.join(directory, file)).catch(() => undefined);
    }
    await rmdir(directory).catch(() => undefined);
  }
}

// --- delete ----------------------------------------------------------------

interface SessionMeta {
  header: RawEntry | null;
  parentSessionPath?: string;
  relation?: SessionInfo["relation"];
}

async function readSessionMeta(filePath: string): Promise<SessionMeta | null> {
  const cached = listRowCache.get(filePath);
  if (cached && !cached.detailsPending) {
    const file = await stat(filePath).catch(() => null);
    if (file && file.size === cached.size && file.mtimeMs === cached.mtimeMs) {
      return {
        header: {
          type: "session",
          id: cached.row.id,
          cwd: cached.row.cwd,
          timestamp: cached.row.created,
          ...(cached.parentSessionPath ? { parentSession: cached.parentSessionPath } : {}),
        },
        ...(cached.parentSessionPath ? { parentSessionPath: cached.parentSessionPath } : {}),
        relation: cached.row.relation,
      };
    }
  }
  const file = await readSessionText(filePath);
  if (!file) return null;
  const header = findHeader(file.text);
  if (!header) return null;
  const entries: RawEntry[] = [];
  const second = secondEntry(file.text);
  if (second) entries.push(second);
  for (const entry of tailEntries(file.text)) entries.push(entry);
  const subagent = subagentMetadata(entries);
  const side = subagent ? null : sideMetadata(entries);
  const relation: SessionInfo["relation"] | undefined = subagent
    ? {
        kind: "subagent",
        parentSessionId: subagent.parentSessionId,
        profile: subagent.profile,
        description: subagent.description,
        status: subagent.status as "starting" | "queued" | "running" | "completed" | "failed" | "aborted" | "interrupted",
      }
    : side
      ? { kind: "side", parentSessionId: side.parentSessionId }
      : typeof header.parentSession === "string"
        ? { kind: "fork" }
        : undefined;
  return {
    header,
    ...(typeof header.parentSession === "string" ? { parentSessionPath: header.parentSession } : {}),
    ...(relation ? { relation } : {}),
  };
}

function metaId(meta: SessionMeta, filePath: string): string | undefined {
  if (meta.header && typeof meta.header.id === "string") return meta.header.id;
  return sessionIdFromPath(filePath);
}

async function deleteSessionsByIds(ids: readonly string[]): Promise<SessionDeleteResult> {
  const targets = new Map<string, string>();
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const filePath = await resolveSessionPathById(id);
    if (filePath) targets.set(id, filePath);
    else missing.push(id);
  }
  if (targets.size === 0) return { deleted: [], missing, running: [] };

  const metaByPath = new Map<string, SessionMeta | null>();
  const parentPathByKey = new Map<string, string | undefined>();
  for (const filePath of targets.values()) {
    const meta = await readSessionMeta(filePath);
    metaByPath.set(filePath, meta);
    parentPathByKey.set(pathKey(filePath), meta?.parentSessionPath);
  }

  const targetPathKeys = new Set([...targets.values()].map(pathKey));
  const targetDirs = new Set([...targets.values()].map((filePath) => path.dirname(filePath)));
  const childrenByParent = new Map<string, string[]>();
  const sessionPaths = new Map<string, string>();
  const addChild = (parentId: string, childId: string): void => {
    const list = childrenByParent.get(parentId) ?? [];
    list.push(childId);
    childrenByParent.set(parentId, list);
  };

  for (const directory of targetDirs) {
    let names: string[];
    try {
      names = await readdir(directory);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const childPath = path.join(directory, name);
      if (targetPathKeys.has(pathKey(childPath))) continue;
      const meta = await readSessionMeta(childPath);
      metaByPath.set(childPath, meta);
      const childId = meta ? metaId(meta, childPath) : sessionIdFromPath(childPath);
      if (!meta || !childId) continue;
      if (meta.relation?.kind === "subagent" || meta.relation?.kind === "side") {
        addChild(meta.relation.parentSessionId, childId);
        sessionPaths.set(childId, childPath);
      }
    }
  }

  const deletedSessionIds = new Set<string>();
  const running: string[] = [];
  for (const id of targets.keys()) {
    if (deletedSessionIds.has(id)) continue;
    const family: string[] = [];
    const seen = new Set<string>();
    const visit = (sessionId: string): void => {
      if (seen.has(sessionId) || deletedSessionIds.has(sessionId)) return;
      seen.add(sessionId);
      for (const childId of childrenByParent.get(sessionId) ?? []) visit(childId);
      family.push(sessionId);
    };
    visit(id);
    for (const sessionId of family) deletedSessionIds.add(sessionId);
  }

  const deletedPaths = new Map<string, string>();
  for (const deletedId of deletedSessionIds) {
    const filePath = targets.get(deletedId)
      ?? sessionPaths.get(deletedId)
      ?? await resolveSessionPathById(deletedId);
    if (filePath) deletedPaths.set(deletedId, filePath);
  }
  const deletedPathKeys = new Map([...deletedPaths.values()].map((filePath) => [pathKey(filePath), filePath]));

  const survivingParent = async (parentSessionPath: string | undefined): Promise<string | undefined> => {
    const seen = new Set<string>();
    let current = parentSessionPath;
    while (current) {
      const key = pathKey(current);
      const deletedPath = deletedPathKeys.get(key);
      if (deletedPath === undefined) return current;
      if (seen.has(key)) return undefined;
      seen.add(key);
      if (!parentPathByKey.has(key)) {
        const meta = metaByPath.get(deletedPath) ?? await readSessionMeta(deletedPath);
        parentPathByKey.set(key, meta?.parentSessionPath);
      }
      current = parentPathByKey.get(key);
    }
    return undefined;
  };

  if (deletedPaths.size > 0) {
    const scanDirs = new Set([...deletedPaths.values()].map((filePath) => path.dirname(filePath)));
    for (const directory of scanDirs) {
      let names: string[];
      try {
        names = await readdir(directory);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!name.endsWith(".jsonl")) continue;
        const childPath = path.join(directory, name);
        if (deletedPathKeys.has(pathKey(childPath))) continue;
        const meta = metaByPath.get(childPath) ?? await readSessionMeta(childPath);
        if (!meta?.parentSessionPath || !deletedPathKeys.has(pathKey(meta.parentSessionPath))) continue;
        try {
          const file = await readSessionText(childPath);
          if (!file) continue;
          const parentSessionPath = await survivingParent(meta.parentSessionPath);
          let parentSessionId: string | undefined;
          if (parentSessionPath) {
            const parentMeta = metaByPath.get(parentSessionPath) ?? await readSessionMeta(parentSessionPath);
            parentSessionId = parentMeta ? metaId(parentMeta, parentSessionPath) : undefined;
          }
          const lines = file.text.split("\n");
          const header = parseLine(stripCarriageReturn(lines[0] ?? ""));
          if (!header || header.type !== "session") continue;
          if (parentSessionPath) header.parentSession = parentSessionPath;
          else delete header.parentSession;
          lines[0] = JSON.stringify(header);
          if (parentSessionPath && parentSessionId) {
            for (let index = 1; index < lines.length; index += 1) {
              const entry = parseLine(stripCarriageReturn(lines[index]));
              if (!entry || entry.type !== "custom" || entry.customType !== SUBAGENT_META_TYPE) continue;
              if (!isRecord(entry.data)) continue;
              entry.data = { ...entry.data, parentSessionId, parentSessionPath };
              lines[index] = JSON.stringify(entry);
              break;
            }
          }
          await writeSessionText(childPath, lines.join("\n"));
        } catch {
          // Malformed or concurrently removed: leave it alone.
        }
      }
    }
  }

  for (const [deletedId, filePath] of deletedPaths) {
    try {
      await unlink(filePath);
    } catch (cause) {
      if ((cause as { code?: string }).code !== "ENOENT") throw cause;
    }
    forgetPathCaches(filePath, deletedId);
  }
  try {
    await forgetSessionUiState([...deletedSessionIds]);
  } catch {
    // The files are gone; a stale pin is harmless.
  }
  bumpSessionListVersion();
  return { deleted: [...deletedSessionIds], missing, running };
}

async function handleDeleteMany(request: LocalRequest): Promise<LocalResponse> {
  if (!hasJsonContentType(request)) return errorNoStore("Content-Type must be application/json", 415);
  const body = parseBodyObject(request);
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) return errorNoStore("ids must be a non-empty array", 400);
  if (ids.length > 500) return errorNoStore("ids may hold at most 500 session ids", 400);
  if (!ids.every((id) => typeof id === "string" && SESSION_ID_PATTERN.test(id))) {
    return errorNoStore("ids must be session ids", 400);
  }
  try {
    return jsonResponseNoStore(await deleteSessionsByIds(ids as string[]));
  } catch (cause) {
    return errorNoStore(describe(cause), 500);
  }
}

async function handleDeleteOne(id: string): Promise<LocalResponse> {
  try {
    const result = await deleteSessionsByIds([id]);
    if (result.missing.length > 0) return errorResponse("Session not found", 404);
    return jsonResponse({ ok: true });
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
}

// --- sidebar UI state ------------------------------------------------------
//
// The same file the old server reads: pins, archive times, project order and
// project names. Writes are serialized in this window, locked against the old
// server (`.lock` directories, as proper-lockfile makes them) and replaced
// atomically. A corrupt file is set aside rather than overwritten.

const SESSION_UI_STATE_VERSION = 1;
const MAX_SESSION_UI_IDS_PER_REQUEST = 500;
const MAX_PROJECT_STRING_LENGTH = 4096;
const MAX_PROJECT_ORDER_KEYS = 1000;
const PROJECT_ORDER_MAX_BYTES = 256 * 1024;
const MAX_PROJECT_NAME_LENGTH = 80;
const MAX_PROJECT_NAMES = 1000;
const PROJECT_NAMES_MAX_BYTES = 256 * 1024;
const MAX_UI_STATE_BYTES = 4 * 1024 * 1024;
const UI_LOCK_STALE_MS = 10_000;
const KNOWN_UI_KEYS = new Set(["version", "revision", "sessions", "projects", "projectOrder", "projectNames", "__proto__"]);

interface UiFlagsSnapshot {
  id: string;
  pinnedAt: number | null;
  archivedAt: number | null;
}

type UiRequest =
  | SessionUiStateRequest
  | { action: "restore"; entries: UiFlagsSnapshot[] };

interface UiStateCacheEntry {
  size: number;
  mtimeMs: number;
  state: SessionUiState;
}

const uiStateCache = new Map<string, UiStateCacheEntry>();
const uiStateRevisions = new Map<string, number>();

function sessionUiStatePath(): string {
  return path.join(piAgentDirectory(), "pi-web-session-state.json");
}

function emptyUiState(): SessionUiState {
  return { version: SESSION_UI_STATE_VERSION, revision: 0, sessions: {}, projects: {} };
}

function copyUiState(state: SessionUiState): SessionUiState {
  const sessions: Record<string, SessionUiFamilyState> = {};
  for (const [key, value] of Object.entries(state.sessions)) sessions[key] = { ...value };
  const projects: Record<string, SessionUiProjectState> = {};
  for (const [key, value] of Object.entries(state.projects)) projects[key] = { ...value };
  const copy: SessionUiState = { ...state, sessions, projects };
  if (state.projectOrder) copy.projectOrder = [...state.projectOrder];
  if (state.projectNames) copy.projectNames = { ...state.projectNames };
  return copy;
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProjectString(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= MAX_PROJECT_STRING_LENGTH
    && value !== "__proto__";
}

const NOT_ONE_LINE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

function projectDisplayName(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  if (!name) return null;
  if (NOT_ONE_LINE.test(name) || [...name].length > MAX_PROJECT_NAME_LENGTH) return undefined;
  return name;
}

function storedProjectName(state: SessionUiState, projectKey: string): string | undefined {
  const names = state.projectNames;
  return names && Object.hasOwn(names, projectKey) ? names[projectKey] : undefined;
}

function orderEntryBytes(key: string): number {
  return utf8Length(JSON.stringify(key)) + 1;
}

function orderBytes(order: readonly string[]): number {
  let bytes = 1;
  for (const key of order) bytes += orderEntryBytes(key);
  return bytes;
}

function orderFits(count: number, bytes: number): boolean {
  return count <= MAX_PROJECT_ORDER_KEYS && bytes <= PROJECT_ORDER_MAX_BYTES;
}

function fitProjectOrder(keys: readonly string[]): string[] {
  const kept: string[] = [];
  let bytes = 1;
  for (const key of keys) {
    if (kept.length >= MAX_PROJECT_ORDER_KEYS) break;
    const size = orderEntryBytes(key);
    if (bytes + size > PROJECT_ORDER_MAX_BYTES) continue;
    kept.push(key);
    bytes += size;
  }
  return kept;
}

function nameEntryBytes(key: string, name: string): number {
  return utf8Length(JSON.stringify(key)) + utf8Length(JSON.stringify(name)) + 2;
}

function namesBytes(names: Record<string, string>): number {
  let bytes = 1;
  for (const [key, name] of Object.entries(names)) bytes += nameEntryBytes(key, name);
  return bytes;
}

function namesFit(count: number, bytes: number): boolean {
  return count <= MAX_PROJECT_NAMES && bytes <= PROJECT_NAMES_MAX_BYTES;
}

function normalizeUiState(value: unknown): SessionUiState | null {
  if (!isPlainObject(value)) return null;
  if (value.version !== undefined && value.version !== SESSION_UI_STATE_VERSION) return null;
  if (value.sessions !== undefined && !isPlainObject(value.sessions)) return null;
  if (value.projects !== undefined && !isPlainObject(value.projects)) return null;
  const state = emptyUiState();
  if (typeof value.revision === "number" && Number.isSafeInteger(value.revision) && value.revision >= 0) {
    state.revision = value.revision;
  }
  for (const [id, entry] of Object.entries(value.sessions ?? {})) {
    if (!SESSION_ID_PATTERN.test(id) || !isPlainObject(entry)) continue;
    const family: SessionUiFamilyState = {};
    if (isTimestamp(entry.pinnedAt)) family.pinnedAt = entry.pinnedAt;
    if (isTimestamp(entry.archivedAt)) family.archivedAt = entry.archivedAt;
    if (family.pinnedAt === undefined && family.archivedAt === undefined) continue;
    state.sessions[id] = family;
  }
  for (const [key, entry] of Object.entries(value.projects ?? {})) {
    if (!isProjectString(key) || !isPlainObject(entry) || !isTimestamp(entry.pinnedAt) || !isProjectString(entry.root)) continue;
    state.projects[key] = { pinnedAt: entry.pinnedAt, root: entry.root };
  }
  if (Array.isArray(value.projectOrder)) {
    const seen = new Set<string>();
    const keys = value.projectOrder.filter((key): key is string => {
      if (!isProjectString(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const order = fitProjectOrder(keys);
    if (order.length > 0) state.projectOrder = order;
  }
  if (isPlainObject(value.projectNames)) {
    const names: Record<string, string> = {};
    let count = 0;
    let bytes = 1;
    for (const [key, entry] of Object.entries(value.projectNames)) {
      const name = projectDisplayName(entry);
      if (!isProjectString(key) || typeof name !== "string") continue;
      const size = nameEntryBytes(key, name);
      if (!namesFit(count + 1, bytes + size)) continue;
      names[key] = name;
      count += 1;
      bytes += size;
    }
    if (count > 0) state.projectNames = names;
  }
  return state;
}

function parseUiRequest(body: unknown): { ok: true; request: UiRequest } | { ok: false; error: string } {
  if (!isPlainObject(body)) return { ok: false, error: "Expected a JSON object" };
  const parseIds = (value: unknown): { ok: true; ids: string[] } | { ok: false; error: string } => {
    if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "ids must be a non-empty array" };
    if (value.length > MAX_SESSION_UI_IDS_PER_REQUEST) {
      return { ok: false, error: `ids may hold at most ${MAX_SESSION_UI_IDS_PER_REQUEST} session ids` };
    }
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const id of value) {
      if (typeof id !== "string" || !SESSION_ID_PATTERN.test(id)) return { ok: false, error: "ids must be session ids" };
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return { ok: true, ids };
  };
  const parseKeys = (value: unknown, name: string, allowEmpty: boolean): { ok: true; keys: string[] } | { ok: false; error: string } => {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
      return { ok: false, error: `${name} must be ${allowEmpty ? "an" : "a non-empty"} array` };
    }
    if (value.length > MAX_SESSION_UI_IDS_PER_REQUEST) {
      return { ok: false, error: `${name} may hold at most ${MAX_SESSION_UI_IDS_PER_REQUEST} projectKeys` };
    }
    const keys: string[] = [];
    const seen = new Set<string>();
    for (const key of value) {
      if (!isProjectString(key)) {
        return { ok: false, error: `${name} must hold non-empty strings of at most ${MAX_PROJECT_STRING_LENGTH} characters` };
      }
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
    return { ok: true, keys };
  };

  switch (body.action) {
    case "set": {
      const hasPinned = Object.hasOwn(body, "pinned");
      if (hasPinned === Object.hasOwn(body, "archived")) return { ok: false, error: "Send exactly one of pinned or archived" };
      const value = hasPinned ? body.pinned : body.archived;
      if (typeof value !== "boolean") return { ok: false, error: `${hasPinned ? "pinned" : "archived"} must be a boolean` };
      const ids = parseIds(body.ids);
      if (!ids.ok) return ids;
      return {
        ok: true,
        request: hasPinned
          ? { action: "set", ids: ids.ids, pinned: value }
          : { action: "set", ids: ids.ids, archived: value },
      };
    }
    case "restore": {
      const raw = body.entries;
      if (!Array.isArray(raw)) return { ok: false, error: "entries must be an array" };
      if (raw.length > MAX_SESSION_UI_IDS_PER_REQUEST) {
        return { ok: false, error: `entries may hold at most ${MAX_SESSION_UI_IDS_PER_REQUEST} sessions` };
      }
      const entries: UiFlagsSnapshot[] = [];
      const seen = new Set<string>();
      for (const entry of raw) {
        if (!isPlainObject(entry) || typeof entry.id !== "string" || !SESSION_ID_PATTERN.test(entry.id)) {
          return { ok: false, error: "Each entry needs a session id" };
        }
        if (seen.has(entry.id)) return { ok: false, error: "entries must name each session once" };
        seen.add(entry.id);
        const pinnedAt = entry.pinnedAt === null ? null : isTimestamp(entry.pinnedAt) ? entry.pinnedAt : undefined;
        const archivedAt = entry.archivedAt === null ? null : isTimestamp(entry.archivedAt) ? entry.archivedAt : undefined;
        if (pinnedAt === undefined || archivedAt === undefined) {
          return { ok: false, error: "pinnedAt and archivedAt must be timestamps or null" };
        }
        entries.push({ id: entry.id, pinnedAt, archivedAt });
      }
      return { ok: true, request: { action: "restore", entries } };
    }
    case "pin-project": {
      if (!isProjectString(body.projectKey)) {
        return { ok: false, error: `projectKey must be a non-empty string of at most ${MAX_PROJECT_STRING_LENGTH} characters` };
      }
      if (!isProjectString(body.root)) {
        return { ok: false, error: `root must be a non-empty string of at most ${MAX_PROJECT_STRING_LENGTH} characters` };
      }
      if (typeof body.pinned !== "boolean") return { ok: false, error: "pinned must be a boolean" };
      return { ok: true, request: { action: "pin-project", projectKey: body.projectKey, root: body.root, pinned: body.pinned } };
    }
    case "add-projects": {
      const keys = parseKeys(body.keys, "keys", false);
      if (!keys.ok) return keys;
      return { ok: true, request: { action: "add-projects", keys: keys.keys } };
    }
    case "move-project": {
      const projectKey = body.projectKey;
      const anchorKey = body.anchorKey;
      const position = body.position;
      if (!isProjectString(projectKey) || !isProjectString(anchorKey)) {
        return { ok: false, error: `projectKey and anchorKey must be non-empty strings of at most ${MAX_PROJECT_STRING_LENGTH} characters` };
      }
      if (projectKey === anchorKey) return { ok: false, error: "projectKey and anchorKey must differ" };
      if (position !== "before" && position !== "after") return { ok: false, error: "position must be \"before\" or \"after\"" };
      const add = body.add === undefined ? { ok: true as const, keys: [] as string[] } : parseKeys(body.add, "add", true);
      if (!add.ok) return add;
      return { ok: true, request: { action: "move-project", projectKey, anchorKey, position, add: add.keys } };
    }
    case "rename-project": {
      if (!isProjectString(body.projectKey)) {
        return { ok: false, error: `projectKey must be a non-empty string of at most ${MAX_PROJECT_STRING_LENGTH} characters` };
      }
      const name = projectDisplayName(body.name);
      if (name === undefined) {
        return { ok: false, error: `name must be null or one line of at most ${MAX_PROJECT_NAME_LENGTH} characters` };
      }
      return { ok: true, request: { action: "rename-project", projectKey: body.projectKey, name } };
    }
    default:
      return {
        ok: false,
        error: "action must be \"set\", \"restore\", \"pin-project\", \"add-projects\", \"move-project\" or \"rename-project\"",
      };
  }
}

function sameFamily(left: SessionUiFamilyState | undefined, right: SessionUiFamilyState): boolean {
  return left?.pinnedAt === right.pinnedAt && left?.archivedAt === right.archivedAt;
}

function writeFamily(sessions: Record<string, SessionUiFamilyState>, id: string, next: SessionUiFamilyState): boolean {
  const previous = Object.hasOwn(sessions, id) ? sessions[id] : undefined;
  const empty = next.pinnedAt === undefined && next.archivedAt === undefined;
  if (empty) {
    if (!previous) return false;
    delete sessions[id];
    return true;
  }
  if (sameFamily(previous, next)) return false;
  sessions[id] = next;
  return true;
}

function nextFamily(
  previous: SessionUiFamilyState | undefined,
  request: Extract<SessionUiStateRequest, { action: "set" }>,
  now: number,
): SessionUiFamilyState {
  const next: SessionUiFamilyState = { ...previous };
  if ("pinned" in request) {
    if (!request.pinned) {
      delete next.pinnedAt;
    } else if (next.pinnedAt === undefined || next.archivedAt !== undefined) {
      next.pinnedAt = now;
      delete next.archivedAt;
    }
    return next;
  }
  if (request.archived) {
    next.archivedAt = now;
    delete next.pinnedAt;
  } else {
    delete next.archivedAt;
  }
  return next;
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function writeProjectOrder(state: SessionUiState, order: string[]): boolean {
  if (sameOrder(state.projectOrder ?? [], order)) return false;
  if (order.length === 0) delete state.projectOrder;
  else state.projectOrder = order;
  return true;
}

function writeProjectName(state: SessionUiState, key: string, name: string | null): boolean {
  const names = { ...state.projectNames };
  const previous = Object.hasOwn(names, key) ? names[key] : undefined;
  if (previous === (name ?? undefined)) return false;
  if (name === null) {
    delete names[key];
  } else {
    names[key] = name;
    if (!namesFit(Object.keys(names).length, namesBytes(names))) return false;
  }
  if (Object.keys(names).length === 0) delete state.projectNames;
  else state.projectNames = names;
  return true;
}

function missingProjectKeys(order: readonly string[], keys: readonly string[]): string[] {
  const present = new Set(order);
  const missing: string[] = [];
  for (const key of keys) {
    if (present.has(key)) continue;
    present.add(key);
    missing.push(key);
  }
  return missing;
}

function withProjectsAdded(order: readonly string[], keys: readonly string[]): string[] {
  const missing = missingProjectKeys(order, keys);
  let count = order.length;
  let bytes = orderBytes(order);
  let first = missing.length;
  while (first > 0) {
    const size = orderEntryBytes(missing[first - 1]);
    if (!orderFits(count + 1, bytes + size)) break;
    count += 1;
    bytes += size;
    first -= 1;
  }
  return [...missing.slice(first), ...order];
}

function withProjectMoved(order: readonly string[], key: string, anchor: string, position: "before" | "after"): string[] {
  const list = order.filter((item) => item !== key);
  if (!list.includes(anchor)) list.unshift(anchor);
  const index = list.indexOf(anchor);
  list.splice(position === "before" ? index : index + 1, 0, key);
  return list;
}

function withProjectRebanded(
  order: readonly string[],
  key: string,
  pinned: Record<string, SessionUiProjectState>,
  nowPinned: boolean,
): string[] {
  const list = order.filter((item) => item !== key);
  let index: number;
  if (nowPinned) {
    index = 0;
    list.forEach((item, position) => {
      if (Object.hasOwn(pinned, item)) index = position + 1;
    });
  } else {
    index = list.findIndex((item) => !Object.hasOwn(pinned, item));
    if (index < 0) index = list.length;
  }
  list.splice(index, 0, key);
  return list;
}

function capProjectOrder(order: string[], keep: ReadonlySet<string>): string[] {
  let count = order.length;
  let bytes = orderBytes(order);
  if (orderFits(count, bytes)) return order;
  const dropped = new Set<number>();
  for (let index = order.length - 1; index >= 0 && !orderFits(count, bytes); index -= 1) {
    if (keep.has(order[index])) continue;
    dropped.add(index);
    count -= 1;
    bytes -= orderEntryBytes(order[index]);
  }
  const kept = order.filter((_, index) => !dropped.has(index));
  return orderFits(count, bytes) ? kept : fitProjectOrder(kept);
}

function applyUiRequest(
  state: SessionUiState,
  request: UiRequest,
  now: number,
): { state: SessionUiState; changed: boolean } {
  const next = copyUiState(state);
  let changed = false;
  switch (request.action) {
    case "set":
      for (const id of request.ids) {
        const previous = Object.hasOwn(next.sessions, id) ? next.sessions[id] : undefined;
        if (writeFamily(next.sessions, id, nextFamily(previous, request, now))) changed = true;
      }
      break;
    case "restore":
      for (const entry of request.entries) {
        const family: SessionUiFamilyState = {};
        if (entry.pinnedAt !== null) family.pinnedAt = entry.pinnedAt;
        if (entry.archivedAt !== null) family.archivedAt = entry.archivedAt;
        if (writeFamily(next.sessions, entry.id, family)) changed = true;
      }
      break;
    case "pin-project": {
      const { projectKey, root } = request;
      const previous = Object.hasOwn(next.projects, projectKey) ? next.projects[projectKey] : undefined;
      if (request.pinned) {
        if (previous?.root !== root) {
          next.projects[projectKey] = { pinnedAt: now, root };
          changed = true;
        }
      } else if (previous) {
        delete next.projects[projectKey];
        changed = true;
      }
      const rebanded = request.pinned ? previous === undefined : previous !== undefined;
      if (rebanded && next.projectOrder) {
        const order = withProjectRebanded(next.projectOrder, projectKey, next.projects, request.pinned);
        if (orderFits(order.length, orderBytes(order)) && writeProjectOrder(next, order)) changed = true;
      }
      break;
    }
    case "add-projects":
      if (writeProjectOrder(next, withProjectsAdded(next.projectOrder ?? [], request.keys))) changed = true;
      break;
    case "move-project": {
      const order = next.projectOrder ?? [];
      const moved = withProjectMoved(
        [...missingProjectKeys(order, request.add), ...order],
        request.projectKey,
        request.anchorKey,
        request.position,
      );
      const named = new Set([request.projectKey, request.anchorKey, ...request.add]);
      if (writeProjectOrder(next, capProjectOrder(moved, named))) changed = true;
      break;
    }
    case "rename-project": {
      const name = projectDisplayName(request.name);
      if (name !== undefined && writeProjectName(next, request.projectKey, name)) changed = true;
      break;
    }
  }
  return { state: next, changed };
}

function parseUiStateText(textValue: string): { ok: true; state: SessionUiState; raw: JsonObject } | { ok: false } {
  let raw: unknown;
  try {
    raw = JSON.parse(textValue.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false };
  }
  const state = normalizeUiState(raw);
  return state && isPlainObject(raw) ? { ok: true, state, raw } : { ok: false };
}

async function loadUiStateAt(target: string): Promise<SessionUiState> {
  let info;
  try {
    info = await stat(target);
  } catch (cause) {
    const code = (cause as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      uiStateCache.delete(target);
      return emptyUiState();
    }
    throw cause;
  }
  const cached = uiStateCache.get(target);
  if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.state;
  if (!info.isFile() || info.size > MAX_UI_STATE_BYTES) {
    uiStateCache.delete(target);
    return emptyUiState();
  }
  let textValue: string;
  try {
    textValue = await readFile(target, "utf8");
  } catch {
    uiStateCache.delete(target);
    return emptyUiState();
  }
  const parsed = parseUiStateText(textValue);
  let state: SessionUiState;
  if (parsed.ok) {
    state = parsed.state;
    const highest = uiStateRevisions.get(target) ?? -1;
    if (state.revision > highest) uiStateRevisions.set(target, state.revision);
  } else {
    state = emptyUiState();
  }
  uiStateCache.set(target, { size: info.size, mtimeMs: info.mtimeMs, state });
  return state;
}

function noteUiRevision(target: string, revision: number): void {
  if (revision > (uiStateRevisions.get(target) ?? -1)) uiStateRevisions.set(target, revision);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireUiLock(lockPath: string): Promise<boolean> {
  let delay = 25;
  for (let attempt = 0; attempt <= 10; attempt += 1) {
    try {
      await mkdir(lockPath);
      return true;
    } catch (cause) {
      if ((cause as { code?: string }).code !== "EEXIST") throw cause;
      const info = await stat(lockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > UI_LOCK_STALE_MS) {
        await rmdir(lockPath).catch(() => undefined);
        continue;
      }
      if (attempt === 10) return false;
      await sleep(delay);
      delay = Math.min(500, delay * 2);
    }
  }
  return false;
}

function serializeUiWrite<T>(work: () => Promise<T>): Promise<T> {
  const next = uiWriteQueue.then(work, work);
  uiWriteQueue = next.then(() => undefined, () => undefined);
  return next;
}

let uiWriteQueue: Promise<unknown> = Promise.resolve();

async function writeUiState(target: string, state: SessionUiState, extras: JsonObject = {}): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${newEntryId()}`;
  const document = {
    version: state.version,
    revision: state.revision,
    sessions: state.sessions,
    projects: state.projects,
    ...(state.projectOrder?.length ? { projectOrder: state.projectOrder } : {}),
    ...(state.projectNames && Object.keys(state.projectNames).length > 0 ? { projectNames: state.projectNames } : {}),
    ...extras,
  };
  await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`);
  try {
    await rename(temporary, target);
  } catch (cause) {
    // Windows does not replace an existing file with rename.
    await unlink(target).catch(() => undefined);
    try {
      await rename(temporary, target);
    } catch {
      await unlink(temporary).catch(() => undefined);
      throw cause;
    }
  }
}

async function editUiState(
  target: string,
  edit: (state: SessionUiState) => { state: SessionUiState; changed: boolean },
): Promise<SessionUiState> {
  return serializeUiWrite(async () => {
    await mkdir(path.dirname(target), { recursive: true });
    const lockPath = `${target}.lock`;
    if (!await acquireUiLock(lockPath)) throw new UiStateLockedError();
    try {
      const lastRevision = uiStateRevisions.get(target) ?? 0;
      let state: SessionUiState;
      let reset = false;
      const extras: JsonObject = {};
      const fileInfo = await stat(target).catch(() => null);
      const textValue = fileInfo && fileInfo.isFile() && fileInfo.size <= MAX_UI_STATE_BYTES
        ? await readFile(target, "utf8").catch(() => undefined)
        : undefined;
      if (textValue === undefined) {
        state = { ...emptyUiState(), revision: lastRevision };
      } else {
        const parsed = parseUiStateText(textValue);
        if (parsed.ok) {
          state = parsed.state;
          for (const [key, value] of Object.entries(parsed.raw)) {
            if (!KNOWN_UI_KEYS.has(key)) extras[key] = value;
          }
        } else {
          const backup = `${target}.corrupt-${Date.now()}`;
          await rename(target, backup).catch(() => undefined);
          state = { ...emptyUiState(), revision: lastRevision + 1 };
          reset = true;
        }
      }
      const result = edit(state);
      if (!result.changed && !reset) return copyUiState(state);
      const next: SessionUiState = {
        ...result.state,
        version: SESSION_UI_STATE_VERSION,
        revision: state.revision + (result.changed ? 1 : 0),
      };
      await writeUiState(target, next, extras);
      noteUiRevision(target, next.revision);
      const info = await stat(target).catch(() => null);
      if (info) uiStateCache.set(target, { size: info.size, mtimeMs: info.mtimeMs, state: copyUiState(next) });
      else uiStateCache.delete(target);
      return copyUiState(next);
    } finally {
      await rmdir(lockPath).catch(() => undefined);
    }
  });
}

class UiStateLockedError extends Error {
  constructor() {
    super("Another process holds the session UI state lock");
    this.name = "UiStateLockedError";
  }
}

async function readUiState(target = sessionUiStatePath()): Promise<SessionUiState> {
  try {
    return copyUiState(await loadUiStateAt(target));
  } catch {
    return emptyUiState();
  }
}

async function updateUiState(request: UiRequest, target = sessionUiStatePath()): Promise<SessionUiState> {
  return editUiState(target, (state) => applyUiRequest(state, request, Date.now()));
}

async function forgetSessionUiState(ids: readonly string[]): Promise<void> {
  const target = sessionUiStatePath();
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return;
  const has = (state: SessionUiState): boolean => wanted.some((id) => Object.hasOwn(state.sessions, id));
  const current = await loadUiStateAt(target);
  if (!has(current)) return;
  await editUiState(target, (state) => {
    if (!has(state)) return { state, changed: false };
    const sessions = { ...state.sessions };
    for (const id of wanted) delete sessions[id];
    return { state: { ...state, sessions }, changed: true };
  });
}

async function handleUiState(request: LocalRequest): Promise<LocalResponse> {
  if (request.method === "GET") {
    return jsonResponseNoStore({ state: await readUiState() });
  }
  if (!hasJsonContentType(request)) {
    return errorNoStore("Content-Type must be application/json", 415, { reason: "content-type" });
  }
  let body: unknown;
  try {
    body = JSON.parse(request.body ?? "");
  } catch {
    return errorNoStore("Invalid JSON body", 400, { reason: "invalid-request" });
  }
  if (!isPlainObject(body)) {
    return errorNoStore("Expected a JSON object", 400, { reason: "invalid-request" });
  }
  const parsed = parseUiRequest(body);
  if (!parsed.ok) return errorNoStore(parsed.error, 400, { reason: "invalid-request" });
  try {
    const state = await updateUiState(parsed.request);
    if (parsed.request.action === "rename-project"
      && parsed.request.name !== null
      && storedProjectName(state, parsed.request.projectKey) !== parsed.request.name) {
      return errorNoStore(
        `No room for another project name (at most ${MAX_PROJECT_NAMES}, ${PROJECT_NAMES_MAX_BYTES / 1024} KiB in all)`,
        409,
        { reason: "full" },
      );
    }
    return jsonResponseNoStore({ state });
  } catch (cause) {
    if (cause instanceof UiStateLockedError) return errorNoStore(cause.message, 409, { reason: "locked" });
    return errorNoStore(describe(cause), 500, { reason: "internal" });
  }
}

// --- fork ------------------------------------------------------------------

class SessionForkFailure extends Error {
  constructor(
    readonly code: "not_found" | "unsaved" | "empty" | "subagent" | "side" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "SessionForkFailure";
  }
}

const FORK_NAME_BASE_MAX = 40;
const FORK_SUFFIX_RE = / · [0-9a-f]{4}$/;

function shortenToCodePoints(value: string, max: number): string {
  const points = [...value];
  return points.length <= max ? value : `${points.slice(0, max - 1).join("").trimEnd()}…`;
}

function forkSessionName(sourceTitle: string, suffix: string, sourceIsFork: boolean): string {
  let base = sourceTitle.replace(/\s+/g, " ").trim();
  if (sourceIsFork) base = base.replace(FORK_SUFFIX_RE, "").trimEnd();
  base = shortenToCodePoints(base, FORK_NAME_BASE_MAX);
  return base ? `${base} · ${suffix}` : suffix;
}

function sideChatNameFromText(value: string): string | null {
  const line = value.trim().split("\n")[0].trim();
  if (!line) return null;
  return line.length > 40 ? `${line.slice(0, 40).trimEnd()}…` : line;
}

interface ForkBranch {
  path: RawEntry[];
  labels: RawEntry[];
  sourceTitle: string | null;
  sourceIsFork: boolean;
}

function forkSourceTitle(header: RawEntry, entries: readonly RawEntry[]): string | null | undefined {
  const folded = foldSessionEntries(entries);
  const firstMessage = folded.firstMessage || "(no messages)";
  if (!folded.name && firstMessage === "(no messages)") return null;
  const displayed = catalogFirstMessage(firstMessage);
  const fallbackId = typeof header.id === "string" ? header.id.slice(0, 12) : "";
  const title = folded.name || skillExpansionToCommand(displayed) || displayed || fallbackId;
  return title.trim() || undefined;
}

function branchForFork(entries: readonly RawEntry[], leafId: string): ForkBranch {
  const byId = new Map<string, RawEntry>();
  for (const entry of entries) {
    if (typeof entry.id === "string") byId.set(entry.id, entry);
  }
  const path: RawEntry[] = [];
  const seen = new Set<string>();
  let current: RawEntry | undefined = byId.get(leafId);
  while (current) {
    if (typeof current.id === "string") {
      if (seen.has(current.id)) break;
      seen.add(current.id);
    }
    path.push(current);
    current = typeof current.parentId === "string" ? byId.get(current.parentId) : undefined;
  }
  path.reverse();
  if (path.length === 0) throw new SessionForkFailure("empty", "Nothing to fork: the session has no messages");

  const { labels, timestamps } = labelsOf(entries);
  const pathWithoutLabels: RawEntry[] = [];
  const replacementByLabelId = new Map<string, string>();
  const pendingLabelIds: string[] = [];
  let parentId: string | null = null;
  for (const entry of path) {
    if (entry.type === "label") {
      pendingLabelIds.push(typeof entry.id === "string" ? entry.id : "");
      continue;
    }
    for (const labelId of pendingLabelIds) replacementByLabelId.set(labelId, typeof entry.id === "string" ? entry.id : "");
    pendingLabelIds.length = 0;
    const previous = parentId;
    parentId = typeof entry.id === "string" ? entry.id : parentId;
    if (entry.type === "compaction") {
      const firstKept = typeof entry.firstKeptEntryId === "string" ? entry.firstKeptEntryId : "";
      pathWithoutLabels.push({
        ...entry,
        parentId: previous,
        firstKeptEntryId: firstKept === entry.id
          ? entry.id
          : replacementByLabelId.get(firstKept) ?? entry.firstKeptEntryId,
      });
    } else {
      pathWithoutLabels.push({ ...entry, parentId: previous });
    }
  }

  const pathIds = new Set(pathWithoutLabels.map((entry) => entry.id).filter((id): id is string => typeof id === "string"));
  const labelEntries: RawEntry[] = [];
  let labelParentId = pathWithoutLabels.length > 0 && typeof pathWithoutLabels[pathWithoutLabels.length - 1].id === "string"
    ? pathWithoutLabels[pathWithoutLabels.length - 1].id as string
    : null;
  for (const [targetId, label] of labels) {
    if (!pathIds.has(targetId)) continue;
    const id = newEntryId();
    pathIds.add(id);
    labelEntries.push({
      type: "label",
      id,
      parentId: labelParentId,
      timestamp: timestamps.get(targetId) ?? nowIso(),
      targetId,
      label,
    });
    labelParentId = id;
  }

  return {
    path: pathWithoutLabels,
    labels: labelEntries,
    sourceTitle: null,
    sourceIsFork: false,
  };
}

function sanitizedSessionName(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

interface ForkWriteInput {
  sourcePath: string;
  sourceHeader: RawEntry;
  branch: ForkBranch;
  name: string | undefined;
}

function forkFileLines(input: ForkWriteInput): { lines: string[]; sessionId: string; header: RawEntry; entries: RawEntry[] } {
  const sessionId = newSessionId();
  const timestamp = nowIso();
  const header: RawEntry = {
    type: "session",
    version: 3,
    id: sessionId,
    timestamp,
    cwd: typeof input.sourceHeader.cwd === "string" ? input.sourceHeader.cwd : "",
    parentSession: input.sourcePath,
  };
  const entries = [...input.branch.path, ...input.branch.labels];
  if (input.name !== undefined) {
    const last = entries[entries.length - 1];
    entries.push({
      type: "session_info",
      id: newEntryId(),
      parentId: last && typeof last.id === "string" ? last.id : null,
      timestamp,
      name: sanitizedSessionName(input.name),
    });
  }
  return {
    sessionId,
    header,
    entries,
    lines: [JSON.stringify(header), ...entries.map((entry) => JSON.stringify(entry))],
  };
}

function sessionFileFor(sourcePath: string, sessionId: string, timestamp: string): string {
  const filename = `${timestamp.replace(/[:.]/g, "-")}_${sessionId}.jsonl`;
  return path.join(path.dirname(sourcePath), filename);
}

function forkInfoFromEntries(
  filePath: string,
  header: RawEntry,
  entries: readonly RawEntry[],
  mtimeMs: number,
): SessionInfo {
  const folded = foldSessionEntries(entries);
  const headerMillis = headerTime(header);
  const modifiedMillis = folded.lastActivityTime !== undefined && folded.lastActivityTime > 0
    ? folded.lastActivityTime
    : headerMillis ?? mtimeMs;
  return {
    path: filePath,
    id: typeof header.id === "string" ? header.id : "",
    cwd: typeof header.cwd === "string" ? header.cwd : "",
    ...(folded.name ? { name: folded.name } : {}),
    created: typeof header.timestamp === "string" ? header.timestamp : "",
    modified: timeIso(modifiedMillis),
    messageCount: folded.messageCount,
    firstMessage: catalogFirstMessage(folded.firstMessage || "(no messages)"),
    transient: false,
  };
}

async function handleFork(request: LocalRequest, id: string): Promise<LocalResponse> {
  if (!hasJsonContentType(request)) {
    return errorNoStore("Content-Type must be application/json", 415, { code: "request-denied" });
  }
  const body = parseBodyObject(request);
  const side = body?.side === true;
  const sideName = typeof body?.name === "string" ? sideChatNameFromText(body.name) ?? undefined : undefined;

  try {
    const sourcePath = await resolveSessionPathById(id);
    if (!sourcePath) {
      bumpSessionListVersion();
      return errorNoStore("Session not found", 404, { code: "not_found" });
    }
    const sourceFile = await readSessionText(sourcePath);
    if (!sourceFile) throw new SessionForkFailure("not_found", "Session not found");
    const parsed = parseSession(sourceFile.text);
    const sourceHeader = parsed.header;
    if (!sourceHeader) throw new SessionForkFailure("not_found", "Session not found");
    const leaf = parsed.entries[parsed.entries.length - 1];
    const leafId = leaf && typeof leaf.id === "string" ? leaf.id : null;
    if (!leafId) throw new SessionForkFailure("empty", "Nothing to fork: the session has no messages");
    const branch = branchForFork(parsed.entries, leafId);
    branch.sourceIsFork = typeof sourceHeader.parentSession === "string";
    if (subagentMetadata(branch.path)) {
      throw new SessionForkFailure("subagent", "A subagent session cannot be forked");
    }
    if (sideMetadata(branch.path)) {
      throw new SessionForkFailure("side", "A side chat cannot be forked");
    }
    if (!branch.path.some((entry) => entry.type === "message")) {
      throw new SessionForkFailure("empty", "Nothing to fork: the session has no messages");
    }

    const sourceTitle = side ? null : forkSourceTitle(sourceHeader, parsed.entries);
    if (sourceTitle === null) branch.sourceTitle = null;
    else {
      const base = sourceTitle?.trim()
        || (typeof sourceHeader.id === "string" ? sourceHeader.id.slice(0, 12) : "");
      branch.sourceTitle = forkSessionName(base || randomHex(8), randomHex(4), branch.sourceIsFork);
    }

    if (side) {
      const name = sideName ?? SIDE_SESSION_NAME;
      const copy = forkFileLines({ sourcePath, sourceHeader, branch, name });
      const sessionPath = sessionFileFor(sourcePath, copy.sessionId, String(copy.header.timestamp));
      const headerLine = copy.lines[0];
      const firstLine = copy.lines[1];
      const rest = copy.lines.slice(2);
      const first = parseLine(firstLine) ?? {};
      const metadataId = `side-${newSessionId()}`;
      const createdAt = nowIso();
      const metadata: RawEntry = {
        type: "custom",
        customType: SIDE_META_TYPE,
        data: { version: 1, parentSessionId: typeof sourceHeader.id === "string" ? sourceHeader.id : id, createdAt },
        id: metadataId,
        parentId: first.parentId ?? null,
        timestamp: createdAt,
      };
      first.parentId = metadataId;
      const leafEntry = parseLine(rest.length > 0 ? rest[rest.length - 1] : firstLine) ?? first;
      const toolSelection = readSessionToolSelection(parsed.entries);
      const pin = toolSelection
        ? {
            type: "custom",
            customType: TOOL_SELECTION_TYPE,
            data: { version: 1, tools: [...toolSelection] },
            id: `side-tools-${newSessionId()}`,
            parentId: typeof leafEntry.id === "string" ? leafEntry.id : null,
            timestamp: nowIso(),
          } satisfies RawEntry
        : undefined;
      const boundary: RawEntry = {
        type: "custom_message",
        customType: SIDE_BOUNDARY_MESSAGE_TYPE,
        content: SIDE_BOUNDARY_TEXT,
        display: false,
        id: `side-boundary-${newSessionId()}`,
        parentId: pin && typeof pin.id === "string" ? pin.id : (typeof leafEntry.id === "string" ? leafEntry.id : null),
        timestamp: nowIso(),
      };
      const lines = [headerLine, JSON.stringify(metadata), JSON.stringify(first), ...rest, ...(pin ? [JSON.stringify(pin)] : []), JSON.stringify(boundary)];
      await writeSessionText(sessionPath, `${lines.join("\n")}\n`);
      idPathCache.set(copy.sessionId, sessionPath);
      forgetPathCaches();
      bumpSessionListVersion();
      const writtenEntries = [metadata, first as RawEntry, ...rest.map((line) => parseLine(line)).filter((entry): entry is RawEntry => entry !== null), ...(pin ? [pin] : []), boundary];
      const info = forkInfoFromEntries(sessionPath, copy.header, writtenEntries, Date.now());
      const withProject = (await attachProjectInfo([{
        ...info,
        parentSessionId: id,
        relation: { kind: "side", parentSessionId: id },
      }]))[0];
      return jsonResponseNoStore({ sessionId: copy.sessionId, session: withProject } satisfies SessionForkResult);
    }

    const copy = forkFileLines({ sourcePath, sourceHeader, branch, name: branch.sourceTitle ?? undefined });
    const sessionPath = sessionFileFor(sourcePath, copy.sessionId, String(copy.header.timestamp));
    await writeSessionText(sessionPath, `${copy.lines.join("\n")}\n`);
    idPathCache.set(copy.sessionId, sessionPath);
    forgetPathCaches();
    bumpSessionListVersion();
    const info = forkInfoFromEntries(sessionPath, copy.header, copy.entries, Date.now());
    const withProject = (await attachProjectInfo([{
      ...info,
      parentSessionId: id,
      relation: { kind: "fork", originSessionId: id },
    }]))[0];
    return jsonResponseNoStore({ sessionId: copy.sessionId, session: withProject } satisfies SessionForkResult);
  } catch (cause) {
    if (cause instanceof SessionForkFailure) {
      if (cause.code === "not_found") {
        idPathCache.delete(id);
        bumpSessionListVersion();
        return errorNoStore(cause.message, 404, { code: cause.code });
      }
      return errorNoStore(cause.message, 409, { code: cause.code });
    }
    return errorNoStore(describe(cause), 500, { code: "failed" });
  }
}

// --- search ----------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cachedSearchRow(filePath: string, file: FileText): SessionInfo | null {
  const cached = listRowCache.get(filePath);
  if (cached && !cached.detailsPending && cached.size === file.size && cached.mtimeMs === file.mtimeMs) {
    return cached.row;
  }
  return null;
}

function quickSearchRow(filePath: string, file: FileText, pathToId: ReadonlyMap<string, string>): SessionInfo | null {
  const header = findHeader(file.text);
  if (!header) return null;
  let name: string | undefined;
  for (const entry of tailEntries(file.text, 256)) {
    if (entry.type !== "session_info") continue;
    name = typeof entry.name === "string" && entry.name.trim() ? entry.name.trim() : undefined;
    break;
  }
  let firstMessage = "";
  let scanned = 0;
  for (const rawLine of file.text.split("\n")) {
    if (scanned > 256) break;
    scanned += 1;
    const entry = parseLine(stripCarriageReturn(rawLine));
    if (!entry || entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "user") continue;
    firstMessage = extractTextContent(entry.message);
    break;
  }
  const folded: FoldedSession = { ...(name ? { name } : {}), messageCount: 0, firstMessage, subagent: null, side: null };
  const headerMillis = headerTime(header);
  return makeRow(filePath, header, folded, pathToId, timeIso(headerMillis ?? Math.round(file.mtimeMs)), false);
}

function searchRowFor(
  filePath: string,
  file: FileText,
  pathToId: ReadonlyMap<string, string>,
  boundedText?: string,
): SessionInfo | null {
  const cached = cachedSearchRow(filePath, file);
  if (cached) return cached;
  const bounded = boundedText ?? file.text;
  const scanned = scanFullRow(filePath, { ...file, text: bounded }, pathToId);
  return scanned?.row ?? null;
}

async function handleSearch(request: LocalRequest): Promise<LocalResponse> {
  const query = (request.params.get("q") ?? "").trim();
  if (query.length > 200) {
    return errorNoStore("Search query exceeds 200 characters", 400);
  }
  const response: SessionSearchResponse = { results: [], truncated: false };
  if (!query) return jsonResponseNoStore(response);
  if (request.signal?.aborted) return jsonResponseNoStore(response);

  const needle = new RegExp(escapeRegExp(query), "i");
  const deadline = Date.now() + SEARCH_TIME_BUDGET_MS;
  const files = await statSessionFiles(await enumerateSessionFiles());
  files.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const pathToId = new Map<string, string>();
  for (const file of files) {
    const id = sessionIdFromPath(file.filePath);
    if (id) pathToId.set(pathKey(file.filePath), id);
  }

  for (const [index, file] of files.entries()) {
    if (index >= MAX_SEARCH_FILES || response.results.length >= MAX_SEARCH_RESULTS
      || request.signal?.aborted || Date.now() >= deadline) {
      response.truncated = true;
      break;
    }
    const contents = await readSessionText(file.filePath);
    if (!contents) {
      response.truncated = true;
      continue;
    }
    // A side chat copies its parent's text and never opens as the main chat.
    const second = secondEntry(contents.text);
    if (second?.type === "custom" && second.customType === SIDE_META_TYPE) continue;

    const bounded = contents.text.length > MAX_SEARCH_FILE_BYTES
      ? contents.text.slice(0, MAX_SEARCH_FILE_BYTES)
      : contents.text;
    let found = false;
    let row: SessionInfo | null = null;
    for (const rawLine of bounded.split("\n")) {
      if (request.signal?.aborted || Date.now() >= deadline) {
        response.truncated = true;
        break;
      }
      const line = stripCarriageReturn(rawLine);
      if (line.length > MAX_SEARCH_LINE_CHARS) {
        response.truncated = true;
        continue;
      }
      const entry = parseLine(line);
      if (!entry || entry.type !== "message" || !isRecord(entry.message)) continue;
      if (entry.message.role !== "user" && entry.message.role !== "assistant") continue;
      const content = entry.message.content;
      const blocks = typeof content === "string"
        ? [{ type: "text", text: content }]
        : Array.isArray(content)
          ? content
          : [];
      const textBlocks = blocks.flatMap((block, blockIndex) => (
        isRecord(block) && block.type === "text" && typeof block.text === "string"
          ? [{ text: block.text, blockIndex }]
          : []
      ));
      const joined = textBlocks.map((block) => block.text).join("\n");
      const match = needle.exec(joined);
      if (!match) continue;
      const start = match.index;
      const end = start + match[0].length;
      let blockOffset = 0;
      let matchedBlock = 0;
      for (const block of textBlocks) {
        const blockEnd = blockOffset + block.text.length;
        blockOffset = blockEnd + 1;
        if (start <= blockEnd) {
          matchedBlock = block.blockIndex;
          break;
        }
      }
      row = searchRowFor(file.filePath, contents, pathToId, bounded);
      if (!row) break;
      response.results.push({
        session: row,
        ...(typeof entry.id === "string" ? { entryId: entry.id } : {}),
        blockIndex: matchedBlock,
        before: (start > 80 ? "..." : "") + joined.slice(Math.max(0, start - 80), start).replace(/\s+/g, " ").trimStart(),
        match: match[0].replace(/\s+/g, " "),
        after: joined.slice(end, end + 80).replace(/\s+/g, " ").trimEnd() + (end + 80 < joined.length ? "..." : ""),
      });
      found = true;
      break;
    }
    if (!found && bounded.length >= MAX_SEARCH_FILE_BYTES) response.truncated = true;
    if (!found && !request.signal?.aborted && Date.now() < deadline) {
      row ??= cachedSearchRow(file.filePath, contents) ?? quickSearchRow(file.filePath, contents, pathToId);
      const title = row?.name || row?.firstMessage || "";
      const titleHit = needle.exec(title);
      if (titleHit) {
        response.results.push({
          session: row as SessionInfo,
          blockIndex: 0,
          titleMatch: true,
          before: title.slice(0, titleHit.index),
          match: titleHit[0],
          after: title.slice(titleHit.index + titleHit[0].length),
        });
      }
    }
  }

  const uniqueRows = new Map<string, SessionInfo>();
  for (const result of response.results) {
    const existing = uniqueRows.get(result.session.path);
    if (existing) result.session = existing;
    else uniqueRows.set(result.session.path, result.session);
  }
  const attached = await attachProjectInfo([...uniqueRows.values()]);
  const byPath = new Map(attached.map((row) => [row.path, row]));
  for (const result of response.results) {
    const row = byPath.get(result.session.path);
    if (row) result.session = row;
  }
  return jsonResponseNoStore(response);
}

// --- deferred thinking blocks ---------------------------------------------

async function handleThinkingBlock(request: LocalRequest, id: string, entryId: string): Promise<LocalResponse> {
  const blockIndexParam = request.params.get("blockIndex");
  const blockIndex = blockIndexParam === null ? Number.NaN : Number(blockIndexParam);
  if (!Number.isSafeInteger(blockIndex) || blockIndex < 0) {
    return errorResponse("Valid blockIndex is required", 400);
  }
  const loaded = await loadSession(id);
  if (!loaded) return errorResponse("Session not found", 404);
  const entry = loaded.entries.find((candidate) => candidate.id === entryId);
  if (!entry || entry.type !== "message" || !isRecord(entry.message) || entry.message.role !== "assistant") {
    return errorResponse("Assistant message not found", 404);
  }
  const content = entry.message.content;
  const block = Array.isArray(content) ? content[blockIndex] : undefined;
  if (!isRecord(block) || block.type !== "thinking" || typeof block.thinking !== "string") {
    return errorResponse("Thinking block not found", 404);
  }
  return jsonResponse({ thinking: block.thinking });
}

// --- routing ---------------------------------------------------------------

function methodNotAllowed(): LocalResponse {
  return errorResponse("Method not allowed", 405);
}

export async function handleSessions(request: LocalRequest): Promise<LocalResponse | null> {
  const segments = request.segments;
  if (segments[0] !== "api" || segments[1] !== "sessions") return null;

  if (segments.length === 2) {
    if (request.method !== "GET") return methodNotAllowed();
    return handleSessionList(request);
  }

  if (segments.length === 3) {
    const id = segments[2];
    if (id === "search") {
      if (request.method !== "GET") return methodNotAllowed();
      return handleSearch(request);
    }
    if (id === "stats") {
      if (request.method !== "POST") return methodNotAllowed();
      return handleStats(request);
    }
    if (id === "ui-state") {
      if (request.method !== "GET" && request.method !== "POST") return methodNotAllowed();
      return handleUiState(request);
    }
    if (id === "delete") {
      if (request.method !== "POST") return methodNotAllowed();
      return handleDeleteMany(request);
    }
    if (request.method === "GET") return handleSessionView(request, id);
    if (request.method === "PATCH") return handleRename(request, id);
    if (request.method === "DELETE") return handleDeleteOne(id);
    return methodNotAllowed();
  }

  if (segments.length === 4) {
    const id = segments[2];
    if (segments[3] === "context") {
      if (request.method !== "GET") return methodNotAllowed();
      return handleSessionContext(request, id);
    }
    if (segments[3] === "fork") {
      if (request.method !== "POST") return methodNotAllowed();
      return handleFork(request, id);
    }
    // /export, /auto-name, /state and anything else stay on the old pipe.
    return null;
  }

  if (segments.length === 6 && segments[3] === "entries" && segments[5] === "thinking") {
    if (request.method !== "GET") return methodNotAllowed();
    return handleThinkingBlock(request, segments[2], segments[4]);
  }

  return null;
}
