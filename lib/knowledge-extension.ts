// fork:proma-51-knowledge — agent-facing tools for durable project knowledge.
//
// This is the §0.4 form of Proma's `knowledge-maintenance` skill: the ability to
// *change state* (write `AGENTS.md`, `memory/*.md`, a project skill) is a real
// tool registered through `lib/rpc-manager.ts`, not a markdown file the model may
// or may not read. The skill only ever described routing; the routing table now
// lives in `routeKnowledgeTarget()` below, where it is enforced.
//
// Two tools:
//   · `knowledge_propose` — read-only, always available. Turns an observation into
//     a candidate id plus the recommended destination. Writes nothing.
//   · `knowledge_write`   — the state change. Gated: until the user approves
//     agent-initiated knowledge maintenance for the project (see
//     `lib/knowledge-store.ts`) it returns a refusal that names the only allowed
//     move (`knowledge_propose`) and how to approve.
//
// Write discipline (see `writeKnowledgeEntry`):
//   · `AGENTS.md` is never rewritten. Only the bytes between
//     `KNOWLEDGE_BLOCK_START` / `KNOWLEDGE_BLOCK_END` change; when the block is
//     absent it is appended, so user prose outside it is untouched.
//   · `memory/<slug>.md` uses the same managed block, so an existing topic file is
//     extended rather than replaced.
//   · a skill is create-only: a same-named directory is refused, matching
//     `lib/default-skills.ts`'s never-overwrite rule.
//   · every write is staged in the target directory and `renameSync`d into place.
//
// Path safety reuses the single boundary implementation in `lib/path-security.ts`
// (`isPathWithinRoots` + `isExistingPathWithinRoots`), so a symlinked `AGENTS.md`
// or `memory/` cannot escape the project root.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type InlineExtension,
} from "@earendil-works/pi-coding-agent";
import { isExistingPathWithinRoots, isPathWithinRoots } from "./path-security";
import { isKnowledgeMaintenanceApproved } from "./knowledge-store";

export const HOST_KNOWLEDGE_EXTENSION_NAME = "pi-web-knowledge";
export const KNOWLEDGE_PROPOSE_TOOL_NAME = "knowledge_propose";
export const KNOWLEDGE_WRITE_TOOL_NAME = "knowledge_write";

export const KNOWLEDGE_TARGETS = ["agents_md", "memory", "skill"] as const;
export type KnowledgeTarget = typeof KNOWLEDGE_TARGETS[number];

/** Managed-block markers. Everything outside them is user content and never edited. */
export const KNOWLEDGE_BLOCK_START = "<!-- pi-web:knowledge:start -->";
export const KNOWLEDGE_BLOCK_END = "<!-- pi-web:knowledge:end -->";

const SKILL_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Routing table from Proma's `knowledge-maintenance` skill, in code. `kind` is the
 * signal the model observed; the returned target is where it belongs.
 */
const PROJECT_KINDS = new Set([
  "project",
  "project_fact",
  "architecture",
  "command",
  "commands",
  "boundary",
  "convention",
  "structure",
  "verification",
  "test",
]);
const MEMORY_KINDS = new Set([
  "preference",
  "collaboration",
  "decision",
  "lesson",
  "correction",
  "user",
  "profile",
  "experience",
  "fact",
]);
const SKILL_KINDS = new Set(["procedure", "workflow", "sop", "skill"]);

export function routeKnowledgeTarget(
  kind: string,
  explicit?: KnowledgeTarget,
): { target: KnowledgeTarget; reason: string } {
  if (explicit) return { target: explicit, reason: "explicit" };
  const normalized = kind.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (PROJECT_KINDS.has(normalized)) {
    return { target: "agents_md", reason: "project facts, commands and boundaries belong in the project map" };
  }
  if (SKILL_KINDS.has(normalized)) {
    return { target: "skill", reason: "a repeatable procedure belongs in a skill" };
  }
  if (MEMORY_KINDS.has(normalized)) {
    return { target: "memory", reason: "preferences, decisions and corrections belong in collaboration memory" };
  }
  return { target: "memory", reason: "unrecognized kind defaults to collaboration memory" };
}

/** Stable id for a candidate, derived from its content so proposing twice is idempotent. */
export function knowledgeCandidateId(kind: string, title: string, body: string): string {
  return createHash("sha1")
    .update(`${kind}\u0000${title}\u0000${body}`)
    .digest("hex")
    .slice(0, 12);
}

export function isValidKnowledgeSlug(slug: string): boolean {
  return SKILL_SLUG_RE.test(slug) && slug.length <= 64;
}

/** A best-effort slug for the proposal's suggested path; never used for a write. */
export function slugifyKnowledgeTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return isValidKnowledgeSlug(slug) ? slug : "knowledge";
}

function renderBlock(body: string): string {
  const normalized = body.replace(/^\n+/, "").replace(/\s+$/, "");
  return `${KNOWLEDGE_BLOCK_START}\n${normalized}\n${KNOWLEDGE_BLOCK_END}`;
}

/**
 * Replace (or append) the managed block in `existing`, returning the new file text.
 * Byte-for-byte preservation outside the block is the whole point: `existing` is
 * only ever sliced, never normalized.
 */
export function applyManagedBlock(
  existing: string | null,
  body: string,
): { content: string; action: "created" | "updated" | "appended" | "unchanged" } {
  const block = renderBlock(body);
  if (existing === null) return { content: `${block}\n`, action: "created" };

  const start = existing.indexOf(KNOWLEDGE_BLOCK_START);
  const end = start === -1 ? -1 : existing.indexOf(KNOWLEDGE_BLOCK_END, start);
  if (start !== -1 && end !== -1) {
    const after = existing.slice(end + KNOWLEDGE_BLOCK_END.length);
    const content = existing.slice(0, start) + block + after;
    return { content, action: content === existing ? "unchanged" : "updated" };
  }

  const separator = existing === ""
    ? ""
    : existing.endsWith("\n\n")
      ? ""
      : existing.endsWith("\n")
        ? "\n"
        : "\n\n";
  return { content: `${existing}${separator}${block}\n`, action: "appended" };
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

/** Frontmatter is written first; the body follows after a blank line. */
export function buildSkillMarkdown(options: {
  name: string;
  description: string;
  body: string;
}): string {
  const body = options.body.replace(/^\n+/, "").replace(/\s+$/, "");
  return [
    "---",
    `name: ${yamlScalar(options.name)}`,
    `description: ${yamlScalar(options.description)}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

export interface KnowledgeTargetPath {
  /** Absolute path of the file that will be written. */
  path: string;
  /** Directory that has to exist before the atomic stage. */
  directory: string;
}

export function resolveKnowledgeTargetPath(
  projectRoot: string,
  target: KnowledgeTarget,
  slug: string,
): KnowledgeTargetPath {
  if (target === "agents_md") {
    return { path: join(projectRoot, "AGENTS.md"), directory: projectRoot };
  }
  if (target === "memory") {
    const directory = join(projectRoot, "memory");
    return { path: join(directory, `${slug}.md`), directory };
  }
  const directory = join(projectRoot, ".agents", "skills", slug);
  return { path: join(directory, "SKILL.md"), directory };
}

/**
 * Containment check that also refuses symlink escapes. A missing target is
 * checked through its nearest existing ancestor, so a `memory/` symlink pointing
 * outside the project is rejected before anything is created.
 */
export function isKnowledgeTargetWithinRoots(targetPath: string, roots: Set<string>): boolean {
  if (!isPathWithinRoots(targetPath, roots)) return false;
  let probe = targetPath;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return false;
    probe = parent;
  }
  return isExistingPathWithinRoots(probe, roots);
}

export class KnowledgeWriteError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "KnowledgeWriteError";
    this.code = code;
  }
}

export interface KnowledgeWriteOptions {
  projectRoot: string;
  target: KnowledgeTarget;
  title: string;
  body: string;
  slug?: string;
  description?: string;
}

export interface KnowledgeWriteResult {
  target: KnowledgeTarget;
  path: string;
  action: "created" | "updated" | "appended" | "unchanged";
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

function readTextFileOrNull(path: string): string | null {
  if (!existsSync(path)) return null;
  let stats;
  try {
    stats = statSync(path);
  } catch (error) {
    throw new KnowledgeWriteError("unreadable", `Cannot read ${path}: ${(error as Error).message}`);
  }
  if (!stats.isFile()) {
    throw new KnowledgeWriteError("not_a_file", `${path} exists but is not a regular file`);
  }
  return readFileSync(path, "utf8");
}

/** Same-directory staging + rename. Never leaves a half-written file behind. */
function writeFileAtomicSync(path: string, contents: string): void {
  const directory = dirname(path);
  const tempPath = join(directory, `.${basename(path)}-${process.pid}-${Date.now()}.tmp`);
  let failed = false;
  try {
    writeFileSync(tempPath, contents, { encoding: "utf8", flag: "wx", flush: true });
    renameSync(tempPath, path);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      unlinkSync(tempPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !failed) throw error;
    }
  }
}

/**
 * Perform one approved write. Throws `KnowledgeWriteError` on every refusal so the
 * tool can turn it into a model-readable result.
 */
export function writeKnowledgeEntry(options: KnowledgeWriteOptions): KnowledgeWriteResult {
  const projectRoot = options.projectRoot;
  const title = options.title.trim();
  const body = options.body;
  if (!title) throw new KnowledgeWriteError("invalid_input", "title must not be empty");
  if (!body.trim()) throw new KnowledgeWriteError("invalid_input", "body must not be empty");

  const isAgentsMd = options.target === "agents_md";
  const slug = (options.slug ?? "").trim();
  if (!isAgentsMd && !slug) {
    throw new KnowledgeWriteError("invalid_input", `target "${options.target}" requires a slug`);
  }
  if (!isAgentsMd && !isValidKnowledgeSlug(slug)) {
    throw new KnowledgeWriteError(
      "invalid_slug",
      `slug must match ${SKILL_SLUG_RE} (lowercase letters, digits, hyphens)`,
    );
  }

  const resolved = resolveKnowledgeTargetPath(projectRoot, options.target, slug);
  if (!isKnowledgeTargetWithinRoots(resolved.path, new Set([projectRoot]))) {
    throw new KnowledgeWriteError("outside_root", `Refusing to write outside the project root: ${resolved.path}`);
  }

  if (options.target === "skill") {
    if (existsSync(resolved.directory)) {
      throw new KnowledgeWriteError("already_exists", `Skill "${slug}" already exists; create-only, no overwrite`);
    }
    const parent = dirname(resolved.directory);
    mkdirSync(parent, { recursive: true });
    try {
      mkdirSync(resolved.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new KnowledgeWriteError("already_exists", `Skill "${slug}" already exists; create-only, no overwrite`);
      }
      throw error;
    }
    const description = (options.description ?? title).replace(/\s+/g, " ").trim() || title;
    try {
      writeFileAtomicSync(resolved.path, buildSkillMarkdown({ name: slug, description, body }));
    } catch (error) {
      // Do not leave an empty skill directory behind a failed write.
      try { rmdirSync(resolved.directory); } catch { /* best effort */ }
      throw error;
    }
    return { target: "skill", path: resolved.path, action: "created" };
  }

  mkdirSync(resolved.directory, { recursive: true });
  const existing = readTextFileOrNull(resolved.path);
  const blockBody = `# ${title}\n\n${body.replace(/^\n+/, "").replace(/\s+$/, "")}`;
  const { content, action } = applyManagedBlock(existing, blockBody);
  if (action !== "unchanged") writeFileAtomicSync(resolved.path, content);
  return { target: options.target, path: resolved.path, action };
}

export function knowledgeWriteDeniedMessage(projectPath: string): string {
  return [
    "knowledge_write is disabled for this project: agent-initiated knowledge maintenance has not been approved.",
    "",
    "What you can do now:",
    "- Use knowledge_propose to record a candidate and tell the user where it would land.",
    "- Do not bypass this gate by editing AGENTS.md, memory/*.md or skills with other tools.",
    "",
    "How the user approves:",
    `- Open Settings → Project knowledge and enable it for ${projectPath}, or`,
    `- POST /api/knowledge-maintenance with {"cwd":"${projectPath}","approved":true}.`,
    "The change applies immediately; no session reload is needed.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export interface KnowledgeExtensionOptions {
  /** Test seam: override the approval lookup. Defaults to the on-disk store. */
  isApproved?: (projectPath: string) => boolean;
  /** Test seam: store path for the default lookup. */
  storePath?: string;
}

export function createKnowledgeExtension(options: KnowledgeExtensionOptions = {}): InlineExtension {
  const isApproved = options.isApproved
    ?? ((projectPath: string) => isKnowledgeMaintenanceApproved(projectPath, options.storePath));

  return {
    name: HOST_KNOWLEDGE_EXTENSION_NAME,
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      pi.registerTool(defineTool({
        name: KNOWLEDGE_PROPOSE_TOOL_NAME,
        label: "Propose knowledge",
        description: [
          "Propose a durable piece of project knowledge without writing anything.",
          "Returns a candidate id and the recommended destination, so the user can decide.",
          "Use this whenever you learn a stable project fact, a collaboration preference, a decision, or a repeatable procedure.",
          "This tool is always available, even before the user approves writes.",
        ].join("\n"),
        promptSnippet: "Propose durable project knowledge (read-only)",
        promptGuidelines: [
          "When the user says \"remember this\", or you discover a stable fact that would save future exploration, call knowledge_propose before doing anything else.",
          "Propose, then keep serving the user. Never ask permission just to record a candidate.",
        ],
        executionMode: "parallel",
        parameters: Type.Object({
          kind: Type.String({
            description: "Signal kind, e.g. project_fact, command, architecture, preference, decision, lesson, procedure",
          }),
          title: Type.String({ description: "One-line title for the candidate" }),
          body: Type.String({ description: "The knowledge itself, in Markdown" }),
          target: Type.Optional(Type.Union(KNOWLEDGE_TARGETS.map((target) => Type.Literal(target)))),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          const kind = params.kind.trim();
          const title = params.title.trim();
          const routed = routeKnowledgeTarget(kind, params.target);
          const id = knowledgeCandidateId(kind, title, params.body);
          const slug = slugifyKnowledgeTitle(title);
          const suggestedPath = routed.target === "agents_md"
            ? join(ctx.cwd, "AGENTS.md")
            : resolveKnowledgeTargetPath(ctx.cwd, routed.target, slug).path;
          return {
            content: [{
              type: "text" as const,
              text: [
                `Candidate ${id} recorded (nothing was written).`,
                `Recommended destination: ${routed.target} — ${routed.reason}.`,
                `Suggested path: ${suggestedPath}`,
                "Ask the user to approve project knowledge maintenance before calling knowledge_write.",
              ].join("\n"),
            }],
            details: {
              candidateId: id,
              kind,
              title,
              target: routed.target,
              reason: routed.reason,
              suggestedPath,
            },
          };
        },
      }));

      pi.registerTool(defineTool({
        name: KNOWLEDGE_WRITE_TOOL_NAME,
        label: "Write knowledge",
        description: [
          "Write an approved piece of durable project knowledge.",
          "Disabled until the user approves agent-initiated knowledge maintenance for this project; a disabled call returns instructions instead of writing.",
          "Targets:",
          "agents_md — the managed block in the project AGENTS.md (user content outside the block is never touched)",
          "memory — the managed block in project memory/<slug>.md",
          "skill — a new project skill at .agents/skills/<slug>/SKILL.md (create-only; an existing slug is refused)",
          "Prefer knowledge_propose first so the user can see the destination.",
        ].join("\n"),
        promptSnippet: "Write approved project knowledge (AGENTS.md / memory / skill)",
        promptGuidelines: [
          "Call knowledge_propose first and only call knowledge_write once the user has approved maintenance for this project.",
          "Never write knowledge with edit/write/bash to work around a knowledge_write refusal.",
          "Keep each write to one fact or one procedure; do not dump a transcript into AGENTS.md.",
        ],
        executionMode: "sequential",
        parameters: Type.Object({
          target: Type.Union(KNOWLEDGE_TARGETS.map((target) => Type.Literal(target))),
          title: Type.String({ description: "Heading / skill title" }),
          body: Type.String({ description: "Markdown body of the knowledge" }),
          slug: Type.Optional(Type.String({
            description: "File name for memory (memory/<slug>.md) or skill directory; required for those targets",
          })),
          description: Type.Optional(Type.String({ description: "Skill description (defaults to the title)" })),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
          if (!isApproved(ctx.cwd)) {
            return {
              isError: true,
              content: [{ type: "text" as const, text: knowledgeWriteDeniedMessage(ctx.cwd) }],
              details: { blocked: true, reason: "not_approved", target: params.target, projectRoot: ctx.cwd },
            };
          }
          try {
            const result = writeKnowledgeEntry({
              projectRoot: ctx.cwd,
              target: params.target,
              title: params.title,
              body: params.body,
              ...(params.slug !== undefined ? { slug: params.slug } : {}),
              ...(params.description !== undefined ? { description: params.description } : {}),
            });
            return {
              content: [{
                type: "text" as const,
                text: `knowledge_write ${result.action}: ${result.path}`,
              }],
              details: { blocked: false, ...result },
            };
          } catch (error) {
            const known = error instanceof KnowledgeWriteError;
            return {
              isError: true,
              content: [{
                type: "text" as const,
                text: known ? error.message : `knowledge_write failed: ${(error as Error).message}`,
              }],
              details: {
                blocked: false,
                reason: known ? error.code : "io_error",
                target: params.target,
                projectRoot: ctx.cwd,
              },
            };
          }
        },
      }));
    },
  };
}
