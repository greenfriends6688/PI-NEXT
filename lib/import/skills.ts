/**
 * fork:import-scan — skill directory scanner (PR-08 / PD-15).
 *
 * Sources (all read-only):
 *   ~/.claude/skills/** /SKILL.md and ~/.claude/skills/*.md
 *   ~/.agents/skills/** /SKILL.md and ~/.agents/skills/*.md
 *
 * Discovery mirrors the pi SDK: a directory containing SKILL.md is a skill
 * root and is not descended into; otherwise direct `.md` children of the
 * scanned root count, and subdirectories are recursed to find SKILL.md.
 * Only 128 KiB per file is read because the frontmatter sits at the top.
 */

import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseFrontmatter } from "../frontmatter";
import { samePath, toNativePath } from "../paths";
import {
  firstString,
  readFileHead,
  sourceDiagnostic,
  type ImportScanOptions,
  type ImportScanPayload,
  type ImportSkillCandidate,
  type ImportSkillSource,
  type ImportSourceDiagnostic,
} from "./types";

/**
 * Ceiling on candidates produced *per source*. Two skill roots exist, so a
 * scan returns at most 400 skill rows.
 */
export const SKILLS_MAX_CANDIDATES = 200;

/** Bytes read per file: enough for frontmatter, bounded for huge skill bodies. */
export const SKILLS_MAX_FRONTMATTER_BYTES = 128 * 1024;

/** Depth ceiling for finding nested SKILL.md directories. */
const SKILLS_MAX_DEPTH = 6;

interface SkillFileCollection {
  files: string[];
  truncated: boolean;
  exists: boolean;
}

async function statFollow(target: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(target);
  } catch {
    return null;
  }
}

async function collectSkillFiles(root: string): Promise<SkillFileCollection> {
  const rootStat = await statFollow(root);
  if (!rootStat || !rootStat.isDirectory()) {
    return { files: [], truncated: false, exists: false };
  }

  const files: string[] = [];
  let truncated = false;
  // samePath() keeps symlink loops out even though the roots are fixed.
  const visitedDirs: string[] = [root];

  const walk = async (dir: string, isRoot: boolean, depth: number): Promise<void> => {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (truncated) return;
      const full = join(dir, entry.name);
      const followed = entry.isSymbolicLink() ? await statFollow(full) : null;
      const isDirectory = entry.isDirectory() || followed?.isDirectory() === true;
      const isFile = entry.isFile() || followed?.isFile() === true;

      if (isDirectory) {
        if (visitedDirs.some((seen) => samePath(seen, full))) continue;
        const skillFile = join(full, "SKILL.md");
        const skillStat = await statFollow(skillFile);
        if (skillStat?.isFile()) {
          if (files.length >= SKILLS_MAX_CANDIDATES) {
            truncated = true;
            return;
          }
          files.push(skillFile);
        } else if (depth < SKILLS_MAX_DEPTH) {
          visitedDirs.push(full);
          await walk(full, false, depth + 1);
        }
        continue;
      }

      if (isRoot && isFile && entry.name.endsWith(".md")) {
        if (files.length >= SKILLS_MAX_CANDIDATES) {
          truncated = true;
          return;
        }
        files.push(full);
      }
    }
  };

  await walk(root, true, 0);
  return { files, truncated, exists: true };
}

interface SkillMeta {
  name: string;
  description: string | null;
}

async function readSkillMeta(filePath: string): Promise<SkillMeta | null> {
  const head = await readFileHead(filePath, SKILLS_MAX_FRONTMATTER_BYTES);
  if (head === null) return null;
  const { data } = parseFrontmatter(head);
  const frontmatter = data ?? {};
  const fallbackName = basename(filePath) === "SKILL.md"
    ? basename(dirname(filePath))
    : basename(filePath, ".md");
  return {
    name: firstString(frontmatter.name) ?? fallbackName,
    description: firstString(frontmatter.description) ?? null,
  };
}

/** Existence only — used for the destination diagnostic, which is never walked. */
async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

async function scanSkillRoot(
  source: ImportSkillSource,
  root: string,
  destination: string,
): Promise<ImportScanPayload> {
  const diagnostics: ImportSourceDiagnostic[] = [];
  const candidates: ImportSkillCandidate[] = [];
  const collected = await collectSkillFiles(root);

  for (const filePath of collected.files) {
    const meta = await readSkillMeta(filePath);
    if (!meta) {
      diagnostics.push(sourceDiagnostic("skills", source, filePath, true, 0, { error: "unreadable" }));
      continue;
    }
    const externalId = toNativePath(filePath);
    candidates.push({
      kind: "skills",
      id: `${source}:${externalId}`,
      source,
      externalId,
      filePath: externalId,
      destination,
      name: meta.name,
      description: meta.description,
    });
  }

  diagnostics.unshift(sourceDiagnostic("skills", source, root, collected.exists, candidates.length, {
    truncated: collected.truncated || undefined,
  }));
  return { sources: diagnostics, candidates };
}

/**
 * Scan both skill roots concurrently; each root walks sequentially and is
 * capped independently.
 */
export async function scanSkillImports(
  options: ImportScanOptions = {},
): Promise<ImportScanPayload> {
  const home = options.home ?? homedir();
  const destination = join(home, ".agents", "skills");
  // fork:import-self-source — `~/.agents/skills` IS the destination. Scanning it as a
  // source produced 76 rows on this machine that could only ever come back `skipped`,
  // which made the list look like it was neither grouped nor useful ("导入这块布局非常乱，
  // 也没有按照 agent 给我分类" — the bulk of it was the user's own skills).
  //
  // Only the external products are importable. The destination is still reported as a
  // *source diagnostic* so the page can say "already yours", instead of silently
  // dropping a directory the user expects to see listed.
  const payloads = await Promise.all([
    scanSkillRoot("claude", join(home, ".claude", "skills"), destination),
  ]);
  const sources = [
    ...payloads.flatMap((payload) => payload.sources),
    sourceDiagnostic("skills", "agents", destination, await isDirectory(destination), 0, { error: "destination" }),
  ];
  const byId = new Map<string, ImportSkillCandidate>();
  for (const payload of payloads) {
    for (const candidate of payload.candidates) {
      if (candidate.kind === "skills" && !byId.has(candidate.id)) byId.set(candidate.id, candidate);
    }
  }
  return { sources, candidates: [...byId.values()] };
}
