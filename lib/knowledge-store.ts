// fork:proma-51-knowledge — project-scoped consent for agent-initiated knowledge writes.
//
// Why this is a separate store rather than `lib/project-trust.ts`:
// `ProjectTrustStore` answers "may pi load and run this project's own code?"
// (project `.pi/extensions`, `.agents/skills`, project settings). Reusing it here
// would be wrong twice over:
//
//   · `getProjectTrustStatus()` reports `trusted: true` for every project that has
//     no trust-requiring resources — so ordinary projects would be auto-approved,
//     defeating the default read-only gate this PR exists to add.
//   · Trusting a repo to run its extensions would silently also authorize the
//     agent to rewrite the project's `AGENTS.md`. Two different consents.
//
// The store lives at `~/.pi/agent/knowledge-maintenance.json`. The `pi` CLI never
// reads this file, and an unknown JSON file in the agent directory is ignored by
// every pi loader (settings / trust / auth each name their own file), so writing
// it never makes the CLI error. Reads fail closed: a damaged store authorizes
// nothing.
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { samePath } from "./paths";

export const KNOWLEDGE_MAINTENANCE_STORE_VERSION = 1;

export interface KnowledgeMaintenanceState {
  /** Canonical absolute project paths the user approved for agent knowledge writes. */
  approvedProjects: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function knowledgeMaintenanceStorePath(agentDir = getAgentDir()): string {
  return join(agentDir, "knowledge-maintenance.json");
}

/**
 * Canonical key for a project path. Resolves symlinks when the directory exists so
 * a session cwd and the same project reached through a link compare equal; falls
 * back to a lexical resolve for a path that is not on disk yet.
 */
export function canonicalProjectPath(projectPath: string): string {
  const absolute = resolve(projectPath);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/** Pure parse: unknown fields are ignored, malformed entries dropped. */
export function parseKnowledgeMaintenanceState(value: unknown): KnowledgeMaintenanceState {
  if (!isRecord(value) || !Array.isArray(value.approvedProjects)) {
    return { approvedProjects: [] };
  }
  const approvedProjects: string[] = [];
  for (const entry of value.approvedProjects) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed) approvedProjects.push(trimmed);
  }
  return { approvedProjects };
}

/** Raw stored object, so a write can carry fields a newer build added. */
function readStoredObject(storePath: string): Record<string, unknown> {
  if (!existsSync(storePath)) return {};
  const parsed: unknown = JSON.parse(readFileSync(storePath, "utf8"));
  return isRecord(parsed) ? parsed : {};
}

/**
 * Read the store. A malformed file throws (the settings block surfaces it instead
 * of pretending the project is unapproved and then overwriting the file on the
 * next toggle). Callers that only gate a write use the fail-closed wrapper below.
 */
export function readKnowledgeMaintenanceState(
  storePath = knowledgeMaintenanceStorePath(),
): KnowledgeMaintenanceState {
  if (!existsSync(storePath)) return { approvedProjects: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(storePath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid knowledge maintenance store: ${(error as Error).message}`);
  }
  return parseKnowledgeMaintenanceState(parsed);
}

/** Whether `projectPath` has been approved. A damaged store answers "no". */
export function isKnowledgeMaintenanceApproved(
  projectPath: string,
  storePath = knowledgeMaintenanceStorePath(),
): boolean {
  if (!projectPath.trim()) return false;
  try {
    const key = canonicalProjectPath(projectPath);
    return readKnowledgeMaintenanceState(storePath).approvedProjects.some((entry) => samePath(entry, key));
  } catch {
    return false;
  }
}

/** Add or remove one project from the approval list, preserving unknown fields. */
export function writeKnowledgeMaintenanceApproval(
  projectPath: string,
  approved: boolean,
  storePath = knowledgeMaintenanceStorePath(),
): KnowledgeMaintenanceState {
  const trimmed = projectPath.trim();
  if (!trimmed) throw new Error("Project path is required");
  const key = canonicalProjectPath(trimmed);
  const current = readKnowledgeMaintenanceState(storePath);
  const without = current.approvedProjects.filter((entry) => !samePath(entry, key));
  const approvedProjects = approved ? [...without, key] : without;
  const stored = readStoredObject(storePath);
  mkdirSync(dirname(storePath), { recursive: true });
  writePrivateFileAtomicSync(storePath, JSON.stringify({
    ...stored,
    version: KNOWLEDGE_MAINTENANCE_STORE_VERSION,
    approvedProjects,
  }, null, 2));
  return { approvedProjects };
}
