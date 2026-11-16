// Project trust: whether a folder's own `.pi` files may be loaded.
//
// Ported from pi-web's:
//   app/api/project-trust/route.ts, lib/project-trust.ts
// and pi's own `ProjectTrustStore` (`dist/core/trust-manager.js`).
//
// The store is pi's, not a second one:
//
//   ~/.pi/agent/trust.json    canonical folder -> true | false | null
//
// `true`/`false` are saved decisions; `null` removes a decision. The nearest
// decision for the folder or one of its ancestors applies, and a folder that
// needs no trust is trusted unless a saved `false` says otherwise. A folder
// with trust-requiring resources and no decision is untrusted; it does not
// fail just because no decision was ever asked for.
//
// GET also lists the project's own `.pi/mcp.json` entries for the dialog,
// from the file only (the reader in `mcp-routes.ts`): no server is spawned,
// no value resolved, no `!command` run. POST records the decision in pi's
// store under the same lock and with the same sorted, canonical JSON shape
// pi writes.
import { mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import process from "process";
import {
  authorizePath,
  hasParentDirectorySegment,
  isAbsolutePath,
  resolveExistingPath,
} from "./file-routes";
import { readProjectMcpListing } from "./mcp-routes";
import {
  describe,
  errorResponse,
  homeDirectory,
  jsonResponse,
  piAgentDirectory,
  type LocalRequest,
  type LocalResponse,
} from "./request";

/** What under `<cwd>/.pi` makes pi require a trust decision (`TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES`). */
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

const WRITE_LOCK_TIMEOUT_MS = 8_000;
/** pi's store gives up after about 200 ms; a read waits as long, never 8 s. */
const READ_LOCK_TIMEOUT_MS = 250;
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 30;

interface TrustEntry {
  /** The key `trust.json` holds, as it spells the folder. */
  path: string;
  decision: boolean;
}

interface TrustStatus {
  requiresTrust: boolean;
  trusted: boolean;
  decision: boolean | null;
  decisionPath?: string;
  inherited: boolean;
  decisionError?: string;
}

interface ListedServer {
  name: string;
}

interface ProjectListing {
  mcpFile?: unknown;
  mcpServers: ListedServer[];
  mcpError?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function errorCode(cause: unknown): string | undefined {
  return isRecord(cause) && typeof cause.code === "string" ? cause.code : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** pi's agent directory; a test host may point it elsewhere with pi's own variable. */
function agentDirectory(): string {
  const configured = process.env.PI_CODING_AGENT_DIR as string | undefined;
  if (typeof configured === "string" && configured.startsWith("/")) return configured;
  return piAgentDirectory();
}

function trustPath(): string {
  return path.join(agentDirectory(), "trust.json");
}

/** Same folder on this platform: the resolved path, case-folded on Windows. */
function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "windows" ? resolved.toLowerCase() : resolved;
}

function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}

/** The folder as pi keys it: its real path when it exists, else the resolved path. */
async function canonicalPath(target: string): Promise<string> {
  try {
    return await resolveExistingPath(target);
  } catch {
    return path.resolve(target);
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the folder needs trust: a trust-requiring entry under `.pi`, or
 * `.agents/skills` in the folder or an ancestor other than the home folder's
 * own. pi's rule (`hasTrustRequiringProjectResources()`).
 */
async function hasTrustRequiringResources(cwd: string): Promise<boolean> {
  const folder = await canonicalPath(cwd);
  for (const entry of TRUST_REQUIRING_ENTRIES) {
    if (await pathExists(path.join(folder, ".pi", entry))) return true;
  }
  const home = await canonicalPath(homeDirectory());
  const userSkills = path.join(home, ".agents", "skills");
  let current = folder;
  for (;;) {
    const skills = path.join(current, ".agents", "skills");
    if (!samePath(skills, userSkills) && await pathExists(skills)) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

// ---------------------------------------------------------------------------
// The trust store: a directory lock pi's proper-lockfile also honours
// ---------------------------------------------------------------------------

async function withFileLock<T>(target: string, timeoutMs: number, task: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(target), { recursive: true });
  const lock = `${target}.lock`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (cause) {
      if (errorCode(cause) !== "EEXIST") throw cause;
      let held = true;
      try {
        const info = await stat(lock);
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await rmdir(lock);
          continue;
        }
      } catch {
        // The holder removed it after our mkdir failed: try again at once.
        held = false;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Failed to read trust store ${target}: timed out waiting for ${lock}`);
      }
      if (held) await sleep(LOCK_RETRY_MS);
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

async function writeAtomic(target: string, contents: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
  try {
    await writeFile(temp, contents);
    await rename(temp, target);
  } catch (cause) {
    try {
      await unlink(temp);
    } catch {
      // Never created, or already renamed.
    }
    throw cause;
  }
}

/** `trust.json`'s object: canonical paths to true/false/null. */
async function readTrustData(target: string): Promise<Record<string, boolean | null>> {
  let text: string;
  try {
    text = await readFile(target, "utf8");
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return {};
    throw new Error(`Failed to read trust store ${target}: ${describe(cause)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (cause) {
    throw new Error(`Failed to read trust store ${target}: ${describe(cause)}`);
  }
  if (!isRecord(parsed)) throw new Error(`Invalid trust store ${target}: expected an object`);
  const data: Record<string, boolean | null> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== true && value !== false && value !== null) {
      throw new Error(`Invalid trust store ${target}: value for ${JSON.stringify(key)} must be true, false, or null`);
    }
    data[key] = value;
  }
  return data;
}

/**
 * The nearest true/false for a folder or an ancestor, as pi's
 * `findNearestTrustEntry()` finds it. A `null` entry removes a decision and
 * does not stop the walk. Both the real path and the path as written are
 * tried, so a hand-written key or a folder opened through a link still finds
 * its decision.
 */
function nearestDecision(
  data: Record<string, boolean | null>,
  canonical: string,
  requested: string,
): TrustEntry | null {
  const starts = [...new Set([canonical, path.resolve(requested)])];
  let found: TrustEntry | null = null;
  for (const start of starts) {
    let current = start;
    let nearestHere: TrustEntry | null = null;
    for (;;) {
      for (const [key, value] of Object.entries(data)) {
        if (value !== true && value !== false) continue;
        if (samePath(key, current)) {
          nearestHere = { path: key, decision: value };
          break;
        }
      }
      if (nearestHere) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (nearestHere && (!found || pathKey(nearestHere.path).length > pathKey(found.path).length)) {
      found = nearestHere;
    }
  }
  return found;
}

/**
 * Whether the project needs trust and is trusted, with the decision that
 * answers it. A folder that needs no trust is trusted unless a saved `false`
 * says otherwise; one that needs trust is trusted only by a saved `true`.
 * An unreadable store fails a folder that needs trust (the route's 500) and
 * is reported beside `trusted: true` for one that does not, as pi 1.5 does.
 */
async function getProjectTrustStatus(cwd: string): Promise<TrustStatus> {
  const requiresTrust = await hasTrustRequiringResources(cwd);
  const target = trustPath();
  let data: Record<string, boolean | null>;
  try {
    data = await withFileLock(target, READ_LOCK_TIMEOUT_MS, () => readTrustData(target));
  } catch (cause) {
    if (!requiresTrust) {
      return {
        requiresTrust: false,
        trusted: true,
        decision: null,
        inherited: false,
        decisionError: describe(cause),
      };
    }
    throw cause;
  }

  const canonical = await canonicalPath(cwd);
  const entry = nearestDecision(data, canonical, cwd);
  const described = entry
    ? { decision: entry.decision, decisionPath: entry.path, inherited: !samePath(entry.path, canonical) }
    : { decision: null, inherited: false };
  return {
    requiresTrust,
    trusted: requiresTrust ? entry?.decision === true : entry?.decision ?? true,
    ...described,
  };
}

/** Records `decision` for the folder exactly as `ProjectTrustStore.set()` does. */
async function writeTrustDecision(cwd: string, decision: boolean): Promise<string> {
  const target = trustPath();
  const canonical = await canonicalPath(cwd);
  await withFileLock(target, WRITE_LOCK_TIMEOUT_MS, async () => {
    const data = await readTrustData(target);
    for (const key of Object.keys(data)) {
      if (samePath(key, canonical)) delete data[key];
    }
    data[canonical] = decision;
    const sorted: Record<string, boolean | null> = {};
    for (const key of Object.keys(data).sort()) sorted[key] = data[key];
    await writeAtomic(target, `${JSON.stringify(sorted, null, 2)}\n`);
  });
  return canonical;
}

// ---------------------------------------------------------------------------
// The folder and its `.pi/mcp.json` listing
// ---------------------------------------------------------------------------

function isDirectoryError(cause: unknown): boolean {
  return errorCode(cause) === "ENOENT" || errorCode(cause) === "ENOTDIR";
}

/**
 * The folder, checked as `/api/mcp` checks its project: absolute (400
 * `cwd-invalid`), existing and inside the home/app-data folders as given (403
 * `cwd-denied`, with `..` refused rather than collapsed), then a directory
 * (400 `cwd-not-directory`).
 */
async function checkedCwd(raw: unknown): Promise<{ cwd: string } | { error: LocalResponse }> {
  if (typeof raw !== "string" || raw.trim() === "" || !isAbsolutePath(raw)) {
    return { error: errorResponse("cwd must be an absolute path", 400, { reason: "cwd-invalid" }) };
  }
  if (raw.includes("\0") || hasParentDirectorySegment(raw)) {
    return { error: errorResponse("Access denied", 403, { reason: "cwd-denied" }) };
  }
  const cwd = path.resolve(raw);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(cwd);
  } catch (cause) {
    // A folder that does not exist gets the same 403 as one outside the
    // allowed roots, whether or not it ever would have been inside them.
    if (isDirectoryError(cause)) return { error: errorResponse("Access denied", 403, { reason: "cwd-denied" }) };
    return { error: errorResponse(describe(cause), 500, { reason: "internal" }) };
  }
  if ((await authorizePath(cwd)) === null) {
    return { error: errorResponse("Access denied", 403, { reason: "cwd-denied" }) };
  }
  if (!info.isDirectory()) {
    return { error: errorResponse("cwd must be a directory", 400, { reason: "cwd-not-directory" }) };
  }
  return { cwd };
}

/** The project's own MCP entries; a listing failure does not fail the trust status. */
async function listProject(cwd: string, projectTrusted: boolean): Promise<ProjectListing> {
  try {
    const { mcpFile, mcpServers } = await readProjectMcpListing(cwd, agentDirectory(), projectTrusted);
    return { mcpFile, mcpServers };
  } catch (cause) {
    return { mcpServers: [], mcpError: describe(cause) };
  }
}

function parseBody(request: LocalRequest): Record<string, unknown> | null {
  if (!request.body) return null;
  try {
    const parsed: unknown = JSON.parse(request.body);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function getTrust(request: LocalRequest): Promise<LocalResponse> {
  const checked = await checkedCwd(request.params.get("cwd"));
  if ("error" in checked) return checked.error;
  const cwd = checked.cwd;

  let status: TrustStatus | null = null;
  let statusError: string | null = null;
  try {
    status = await getProjectTrustStatus(cwd);
  } catch (cause) {
    statusError = describe(cause);
  }

  // The listing does not depend on the store: an unreadable one still carries
  // it, so the dialog never says "no servers" over a broken trust.json.
  const listing = await listProject(cwd, status?.decision === true);
  if (statusError !== null) {
    return errorResponse(statusError, 500, { reason: "trust-unreadable", ...listing });
  }

  return jsonResponse({
    ...status,
    cwd,
    ...listing,
    // The dialog only needs the names; `mcpServers` carries the full rows
    // `src/api/trust.ts` reads.
    servers: listing.mcpServers.map((server) => server.name),
  });
}

async function postTrust(request: LocalRequest): Promise<LocalResponse> {
  const body = parseBody(request);
  const checked = await checkedCwd(body?.cwd);
  if ("error" in checked) return checked.error;
  const cwd = checked.cwd;
  const wanted = body?.trusted === false ? false : true;
  const explicitDecision = body !== null && hasOwn(body, "trusted");

  try {
    const current = await getProjectTrustStatus(cwd);
    // The dialog asks only for a folder that needs trust; a fresh folder that
    // has nothing to load is accepted without writing a decision, as the old
    // route refused it. A caller that sends `trusted` itself is recording a
    // decision deliberately, so it may be saved for a fresh folder too.
    if (!current.requiresTrust && !explicitDecision) {
      return errorResponse("This project has no resources that require trust", 409, {
        reason: "trust-not-required",
      });
    }
    const decisionPath = await writeTrustDecision(cwd, wanted);
    return jsonResponse({
      requiresTrust: current.requiresTrust,
      trusted: wanted,
      decision: wanted,
      decisionPath,
      inherited: false,
    });
  } catch (cause) {
    return errorResponse(describe(cause), 500, { reason: "internal" });
  }
}

export async function handleTrust(request: LocalRequest): Promise<LocalResponse | null> {
  const segments = request.segments;
  if (segments.length !== 2 || segments[0] !== "api" || segments[1] !== "project-trust") return null;
  if (request.method === "GET") return getTrust(request);
  if (request.method === "POST") return postTrust(request);
  return null;
}
