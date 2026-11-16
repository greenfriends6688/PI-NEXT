// Settings › Skills, read from the folders pi itself loads.
//
// Ported from pi-web's `app/api/skills/route.ts`,
// `app/api/skills/content/route.ts`, `lib/skills-service.ts`,
// `lib/skill-lock.ts` and `lib/skill-frontmatter.ts`. There is no server (and
// no SDK import) here, so the discovery is done the way
// `DefaultResourceLoader`/`DefaultPackageManager` does it:
//
//   ~/.pi/agent/skills             user skills
//   ~/.agents/skills               user Agent Skills
//   <cwd>/.pi/skills               project skills (trusted projects only)
//   <cwd>/.agents/skills + parents project Agent Skills (trusted projects only)
//   <package>/skills               npm/git/local packages from settings.json
//   settings.json `skills`         explicit files/directories, project then user
//
// A skill's "model invocation" switch is its own frontmatter: pi reads
// `disable-model-invocation` from `SKILL.md` (`dist/core/skills.js`:
// `frontmatter["disable-model-invocation"] === true`), so PATCH edits that
// file with the same surgical line edit the old server used.
//
// Search, install and the update checks run here too: skills.sh and the npm
// registry are read with `curl` through the login shell, and installs/updates
// are `npx skills add` there, so no old server is needed.
import { lstat, mkdir, readFile, readdir, readlink, rename, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import process, { spawn, type ChildProcess, type ExitResult } from "process";
import { runAsync as run } from "./run-async";
import {
  dataDirectory,
  loginShell,
  loginShellCommand,
  loginShellRun,
  quoteShell,
} from "../pi/install";
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

/** pi's agent directory; a test host may point it elsewhere with pi's own variable. */
function agentDirectory(): string {
  const configured = process.env.PI_CODING_AGENT_DIR;
  if (typeof configured === "string" && configured.startsWith("/")) return configured;
  return piAgentDirectory();
}

const SKILL_CONTENT_MAX_BYTES = 1024 * 1024;
const MARKDOWN_FILE = /\.(md|markdown)$/i;
const FRONTMATTER_KEY = "disable-model-invocation";

type Scope = "user" | "project";

interface ResourceMeta {
  source: string;
  scope: Scope;
  origin: "package" | "top-level";
  /** What pi reports as `sourceInfo.baseDir` for this resource. */
  baseDir?: string;
}

interface SkillResource {
  path: string;
  rank: number;
  meta: ResourceMeta;
}

interface SourceInfo {
  path?: string;
  source?: string;
  scope?: string;
  origin?: string;
  baseDir?: string;
}

interface SkillInstallInfo {
  package: string;
  scope: "global" | "project";
  source: string;
  sourceType?: string;
  skillsShUrl?: string;
  skillPath?: string;
  ref?: string;
  versionHash?: string;
  canCheckForUpdates: boolean;
}

interface SkillRecord {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: SourceInfo;
  install?: SkillInstallInfo;
}

interface SkillDiagnostic {
  type: string;
  message: string;
  path?: string;
  collision?: {
    resourceType: "skill";
    name: string;
    winnerPath: string;
    loserPath: string;
  };
}

interface Discovery {
  skills: SkillRecord[];
  diagnostics: SkillDiagnostic[];
  projectResourcesLoaded: boolean;
}

// ---------------------------------------------------------------------------
// Small JSON / path helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

async function readJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse((await readFile(filePath, "utf8")).replace(/^\uFEFF/, ""));
  } catch {
    return null;
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

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await stat(target)).isDirectory();
  } catch {
    return false;
  }
}

function resolveInputPath(input: string, baseDir: string): string {
  let value = input.trim();
  const home = homeDirectory();
  if (value === "~") value = home;
  else if (value.startsWith("~/")) value = path.join(home, value.slice(2));
  if (/^file:\/\//i.test(value)) {
    try {
      value = decodeURIComponent(new URL(value).pathname);
    } catch {
      // Keep the literal path; it will simply not exist.
    }
  }
  return path.resolve(baseDir, value);
}

/** Every symlink in an existing path resolved (this runtime has no `realpath`). */
async function canonicalExisting(target: string, depth = 0): Promise<string> {
  if (depth > 40) throw new Error("Too many symbolic links");
  const absolute = path.resolve(target);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep)) {
    if (!part) continue;
    current = path.join(current, part);
    let info;
    try {
      info = await lstat(current);
    } catch {
      continue;
    }
    if (info.isSymbolicLink()) {
      try {
        const link = await readlink(current);
        current = await canonicalExisting(path.resolve(path.dirname(current), link), depth + 1);
      } catch {
        continue;
      }
    }
  }
  return current;
}

async function resolveExistingPath(target: string): Promise<string> {
  const absolute = path.resolve(target);
  let candidate = absolute;
  const missing: string[] = [];
  for (;;) {
    try {
      const resolved = await canonicalExisting(candidate);
      return missing.length > 0 ? path.join(resolved, ...missing.slice().reverse()) : resolved;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) return absolute;
      missing.push(path.basename(candidate));
      candidate = parent;
    }
  }
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

/** `path.relative` is typed as `unknown` in this runtime, but returns a string. */
function relativePath(from: string, to: string): string {
  return (path.relative as (from: string, to: string) => string)(from, to);
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

// ---------------------------------------------------------------------------
// YAML frontmatter (the subset pi skills use)
//
// The full YAML package is not available in this runtime. This parser reads a
// frontmatter mapping's top-level keys, quoted/plain scalars and literal or
// folded block scalars, which is all a skill manifest relies on. Invalid
// compact mappings (`key: text: more`) are rejected like YAML does.
// ---------------------------------------------------------------------------

function countIndent(line: string): number {
  let index = 0;
  while (index < line.length && (line[index] === " " || line[index] === "\t")) index += 1;
  return index;
}

function splitMappingLine(line: string): { key: string; rest: string } | null {
  let quote = "";
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index];
    if (quote === '"') {
      if (ch === "\\") index += 1;
      else if (ch === '"') quote = "";
      continue;
    }
    if (quote === "'") {
      if (ch === "'" && line[index + 1] === "'") index += 1;
      else if (ch === "'") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ":") {
      const key = line.slice(0, index).trim();
      if (!key) return null;
      return { key: unquoteKey(key), rest: line.slice(index + 1) };
    }
  }
  return null;
}

function unquoteKey(key: string): string {
  if (key.length >= 2 && key.startsWith('"') && key.endsWith('"')) {
    return decodeDoubleQuoted(key.slice(1, -1));
  }
  if (key.length >= 2 && key.startsWith("'") && key.endsWith("'")) {
    return key.slice(1, -1).replace(/''/g, "'");
  }
  return key;
}

function decodeDoubleQuoted(value: string): string {
  const escapes: Record<string, string> = {
    "0": "\0",
    a: "\x07",
    b: "\b",
    t: "\t",
    n: "\n",
    v: "\v",
    f: "\f",
    r: "\r",
    e: "\x1b",
    " ": " ",
    '"': '"',
    "/": "/",
    "\\": "\\",
  };
  return value.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_match, code: string) => {
    if (code.startsWith("u") || code.startsWith("x")) {
      const number = Number.parseInt(code.slice(1), 16);
      return Number.isFinite(number) ? String.fromCharCode(number) : "";
    }
    return escapes[code] ?? code;
  });
}

function closingQuote(value: string, quote: '"' | "'"): number {
  for (let index = 1; index < value.length; index += 1) {
    const ch = value[index];
    if (quote === '"' && ch === "\\") {
      index += 1;
      continue;
    }
    if (quote === "'" && ch === "'" && value[index + 1] === "'") {
      index += 1;
      continue;
    }
    if (ch === quote) return index;
  }
  return -1;
}

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quote = "";
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const ch = value[index];
    if (quote === '"') {
      if (ch === "\\") index += 1;
      else if (ch === '"') quote = "";
      continue;
    }
    if (quote === "'") {
      if (ch === "'" && value[index + 1] === "'") index += 1;
      else if (ch === "'") quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "[" || ch === "{") depth += 1;
    else if (ch === "]" || ch === "}") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

function parseFlow(value: string): unknown {
  const text = value.trim().replace(/^([\[{])/, "$1");
  if (text.startsWith("[")) {
    if (!text.endsWith("]")) throw new SyntaxError("Unterminated flow sequence");
    const body = text.slice(1, -1).trim();
    return body === "" ? [] : splitTopLevel(body).map((entry) => parseScalar(entry));
  }
  if (text.startsWith("{")) {
    if (!text.endsWith("}")) throw new SyntaxError("Unterminated flow mapping");
    const body = text.slice(1, -1).trim();
    const result: Record<string, unknown> = {};
    if (body === "") return result;
    for (const entry of splitTopLevel(body)) {
      const split = splitMappingLine(entry.trim());
      if (!split) throw new SyntaxError("Expected a flow mapping entry");
      result[split.key] = parseScalar(split.rest);
    }
    return result;
  }
  return parseScalar(text);
}

function stripPlainComment(value: string): string {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "#" && (index === 0 || /\s/.test(value[index - 1]))) {
      return value.slice(0, index);
    }
  }
  return value;
}

function parseScalar(value: string): unknown {
  let text = value.trim();
  if (text === "") return "";
  if (text.startsWith('"')) {
    const end = closingQuote(text, '"');
    if (end < 0) throw new SyntaxError("Unterminated double-quoted string");
    return decodeDoubleQuoted(text.slice(1, end));
  }
  if (text.startsWith("'")) {
    const end = closingQuote(text, "'");
    if (end < 0) throw new SyntaxError("Unterminated single-quoted string");
    return text.slice(1, end).replace(/''/g, "'");
  }
  text = stripPlainComment(text).trim();
  if (/^(?:true|True|TRUE)$/.test(text)) return true;
  if (/^(?:false|False|FALSE)$/.test(text)) return false;
  if (/^(?:null|Null|NULL|~)$/.test(text)) return null;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return Number(text);
  if (text.startsWith("[") || text.startsWith("{")) return parseFlow(text);
  // A plain scalar may contain `:` only when it is not followed by space (a
  // URL is fine); `a: b` would start a nested mapping and is invalid here.
  if (text.includes(": ") || text.endsWith(":")) {
    throw new SyntaxError("Nested mappings are not allowed in compact mappings");
  }
  return text;
}

function foldBlock(lines: string[]): string {
  let result = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (index === 0) result = line;
    else if (line === "" || lines[index - 1] === "") result += `\n${line}`;
    else result += ` ${line}`;
  }
  return result;
}

function readBlockScalar(
  header: string,
  lines: string[],
  start: number,
  parentIndent: number,
): { value: string; next: number } {
  const indicator = header[0];
  let chomp = "";
  let explicitIndent = 0;
  for (const ch of header.slice(1)) {
    if (ch === "+" || ch === "-") chomp = ch;
    else if (ch >= "0" && ch <= "9") explicitIndent = Number(ch);
  }

  const collected: string[] = [];
  let next = start;
  while (next < lines.length) {
    const line = lines[next];
    if (line.trim() === "") {
      collected.push("");
      next += 1;
      continue;
    }
    if (countIndent(line) <= parentIndent) break;
    collected.push(line);
    next += 1;
  }

  let minimum = Number.POSITIVE_INFINITY;
  for (const line of collected) {
    if (line.trim() !== "") minimum = Math.min(minimum, countIndent(line));
  }
  if (!Number.isFinite(minimum)) minimum = parentIndent + 1;
  if (explicitIndent > 0) minimum = parentIndent + explicitIndent;
  const stripped = collected.map((line) => (
    line.trim() === "" ? "" : line.slice(Math.min(minimum, line.length))
  ));

  let value = indicator === "|" ? stripped.join("\n") : foldBlock(stripped);
  if (chomp === "-") value = value.replace(/\n+$/, "");
  else if (chomp !== "+") value = `${value.replace(/\n+$/, "")}${value.trim() === "" ? "" : "\n"}`;
  return { value, next };
}

function parseNestedBlock(lines: string[]): unknown {
  let minimum = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (line.trim() !== "") minimum = Math.min(minimum, countIndent(line));
  }
  if (!Number.isFinite(minimum)) return null;
  const dedented = lines.map((line) => (line.trim() === "" ? "" : line.slice(minimum)));
  const first = dedented.find((line) => line.trim() !== "")?.trim() ?? "";
  if (first.startsWith("-")) {
    return dedented
      .filter((line) => line.trim().startsWith("-"))
      .map((line) => parseScalar(line.trim().slice(1)));
  }
  if (dedented.some((line) => line.trim() !== "" && splitMappingLine(line.trim()) !== null)) {
    try {
      return parseYamlMap(dedented.join("\n"));
    } catch {
      return null;
    }
  }
  return foldBlock(dedented.map((line) => line.trim()));
}

function parseYamlMap(yaml: string): Record<string, unknown> {
  const lines = yaml.split("\n");
  const result: Record<string, unknown> = {};
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      index += 1;
      continue;
    }
    if (/^[ \t]/.test(line)) throw new SyntaxError("Unexpected indentation");
    const trimmed = line.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const flow = parseFlow(trimmed);
      if (isRecord(flow)) Object.assign(result, flow);
      index += 1;
      continue;
    }
    const split = splitMappingLine(line);
    if (!split) throw new SyntaxError("Expected a mapping entry");
    const rest = split.rest.trim();
    if (rest === "") {
      index += 1;
      const nested: string[] = [];
      while (index < lines.length) {
        const next = lines[index];
        if (next.trim() === "") {
          nested.push("");
          index += 1;
          continue;
        }
        if (/^[ \t]/.test(next)) {
          nested.push(next);
          index += 1;
          continue;
        }
        break;
      }
      result[split.key] = nested.length > 0 ? parseNestedBlock(nested) : null;
      continue;
    }
    if (/^[|>][0-9+\-]*$/.test(rest)) {
      const block = readBlockScalar(rest, lines, index + 1, countIndent(line));
      result[split.key] = block.value;
      index = block.next;
      continue;
    }

    let valueText = rest;
    let next = index + 1;
    if (
      (valueText.startsWith('"') && closingQuote(valueText, '"') < 0) ||
      (valueText.startsWith("'") && closingQuote(valueText, "'") < 0)
    ) {
      while (next < lines.length) {
        valueText += `\n${lines[next].trim()}`;
        next += 1;
        if (
          (valueText.startsWith('"') && closingQuote(valueText, '"') >= 0) ||
          (valueText.startsWith("'") && closingQuote(valueText, "'") >= 0)
        ) break;
      }
    }
    result[split.key] = parseScalar(valueText);
    index = next;
  }
  return result;
}

interface ParsedFrontmatter {
  data: Record<string, unknown>;
  yaml: string | null;
}

function parseFrontmatter(content: string): ParsedFrontmatter {
  const normalized = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return { data: {}, yaml: null };
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return { data: {}, yaml: null };
  const yaml = normalized.slice(4, end);
  if (yaml.trim() === "") return { data: {}, yaml };
  return { data: parseYamlMap(yaml), yaml };
}

// ---------------------------------------------------------------------------
// Skill directories (pi's `loadSkillsFromDir`, through the package manager's
// `collectSkillEntries`)
// ---------------------------------------------------------------------------

/**
 * Everything under `dir` that pi would hand to the skill loader. A directory
 * with `SKILL.md` is one skill and is not searched further; otherwise `pi`
 * roots include their own `.md` files and `agents` roots include nested ones.
 */
async function collectSkillEntries(
  dir: string,
  mode: "pi" | "agents",
  root = dir,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (entry.name !== "SKILL.md") continue;
    const fullPath = path.join(dir, entry.name);
    try {
      if ((await stat(fullPath)).isFile()) return [fullPath];
    } catch {
      // A broken link is skipped, like pi's statSync check.
    }
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = path.join(dir, entry.name);
    let info;
    try {
      info = await stat(fullPath);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      files.push(...await collectSkillEntries(fullPath, mode, root));
      continue;
    }
    if (!info.isFile() || !entry.name.endsWith(".md")) continue;
    if ((mode === "pi" && dir === root) || (mode === "agents" && dir !== root)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function collectSkillFiles(paths: readonly string[]): Promise<string[]> {
  const files: string[] = [];
  for (const target of paths) {
    let info;
    try {
      info = await stat(target);
    } catch {
      continue;
    }
    if (info.isFile()) files.push(target);
    else if (info.isDirectory()) files.push(...await collectSkillEntries(target, "pi"));
  }
  return files;
}

// ---------------------------------------------------------------------------
// Glob matching for settings/package filters
// ---------------------------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globRegExp(pattern: string): RegExp {
  const value = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  let source = "^";
  for (let index = 0; index < value.length; index += 1) {
    const ch = value[index];
    if (ch === "*") {
      if (value[index + 1] === "*") {
        source += ".*";
        index += 1;
        if (value[index + 1] === "/") index += 1;
      } else {
        source += "[^/]*";
      }
    } else if (ch === "?") {
      source += "[^/]";
    } else if (ch === "[") {
      const end = value.indexOf("]", index + 1);
      if (end < 0) source += "\\[";
      else {
        source += `[${value.slice(index + 1, end)}]`;
        index = end;
      }
    } else if (ch === "{") {
      const end = value.indexOf("}", index + 1);
      if (end < 0) source += "\\{";
      else {
        source += `(?:${value.slice(index + 1, end).split(",").map(escapeRegExp).join("|")})`;
        index = end;
      }
    } else {
      source += escapeRegExp(ch);
    }
  }
  return new RegExp(`${source}$`);
}

function globMatch(value: string, pattern: string): boolean {
  const candidate = value.replace(/\\/g, "/");
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  try {
    return globRegExp(normalized).test(candidate);
  } catch {
    return false;
  }
}

function matchesAnyPattern(
  filePath: string,
  patterns: readonly string[],
  baseDir: string,
): boolean {
  const relative = toPosix(relativePath(baseDir, filePath));
  const name = path.basename(filePath);
  const absolute = toPosix(path.resolve(filePath));
  const isSkillFile = name === "SKILL.md";
  const parent = isSkillFile ? path.dirname(filePath) : "";
  const parentRelative = isSkillFile ? toPosix(relativePath(baseDir, parent)) : "";
  const parentName = isSkillFile ? path.basename(parent) : "";
  const parentAbsolute = isSkillFile ? toPosix(path.resolve(parent)) : "";
  return patterns.some((pattern) => {
    const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
    if (
      globMatch(relative, normalized) ||
      globMatch(name, normalized) ||
      globMatch(absolute, normalized)
    ) return true;
    return isSkillFile && (
      globMatch(parentRelative, normalized) ||
      globMatch(parentName, normalized) ||
      globMatch(parentAbsolute, normalized)
    );
  });
}

function normalizeExactPattern(pattern: string): string {
  return pattern.replace(/\\/g, "/").replace(/^\.\//, "");
}

function matchesAnyExactPattern(
  filePath: string,
  patterns: readonly string[],
  baseDir: string,
): boolean {
  if (patterns.length === 0) return false;
  const relative = toPosix(relativePath(baseDir, filePath));
  const name = path.basename(filePath);
  const absolute = toPosix(path.resolve(filePath));
  const isSkillFile = name === "SKILL.md";
  const parent = isSkillFile ? path.dirname(filePath) : "";
  const parentRelative = isSkillFile ? toPosix(relativePath(baseDir, parent)) : "";
  const parentAbsolute = isSkillFile ? toPosix(path.resolve(parent)) : "";
  return patterns.some((pattern) => {
    const normalized = normalizeExactPattern(pattern);
    if (normalized === relative || normalized === absolute) return true;
    return isSkillFile && (normalized === parentRelative || normalized === parentAbsolute);
  });
}

function isOverridePattern(value: string): boolean {
  return value.startsWith("!") || value.startsWith("+") || value.startsWith("-");
}

function splitPatterns(entries: readonly string[]): { plain: string[]; patterns: string[] } {
  const plain: string[] = [];
  const patterns: string[] = [];
  for (const entry of entries) {
    if (isOverridePattern(entry) || entry.includes("*") || entry.includes("?")) patterns.push(entry);
    else plain.push(entry);
  }
  return { plain, patterns };
}

function applyPatterns(
  allPaths: readonly string[],
  patterns: readonly string[],
  baseDir: string,
): Set<string> {
  const includes: string[] = [];
  const excludes: string[] = [];
  const forceIncludes: string[] = [];
  const forceExcludes: string[] = [];
  for (const pattern of patterns) {
    if (pattern.startsWith("+")) forceIncludes.push(pattern.slice(1));
    else if (pattern.startsWith("-")) forceExcludes.push(pattern.slice(1));
    else if (pattern.startsWith("!")) excludes.push(pattern.slice(1));
    else includes.push(pattern);
  }
  let result = includes.length === 0
    ? [...allPaths]
    : allPaths.filter((filePath) => matchesAnyPattern(filePath, includes, baseDir));
  if (excludes.length > 0) {
    result = result.filter((filePath) => !matchesAnyPattern(filePath, excludes, baseDir));
  }
  if (forceIncludes.length > 0) {
    for (const filePath of allPaths) {
      if (!result.includes(filePath) && matchesAnyExactPattern(filePath, forceIncludes, baseDir)) {
        result.push(filePath);
      }
    }
  }
  if (forceExcludes.length > 0) {
    result = result.filter((filePath) => !matchesAnyExactPattern(filePath, forceExcludes, baseDir));
  }
  return new Set(result);
}

function isEnabledByOverrides(
  filePath: string,
  entries: readonly string[],
  baseDir: string,
): boolean {
  const overrides = entries.filter(isOverridePattern);
  const excludes = overrides.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
  const forceIncludes = overrides.filter((p) => p.startsWith("+")).map((p) => p.slice(1));
  const forceExcludes = overrides.filter((p) => p.startsWith("-")).map((p) => p.slice(1));
  let enabled = true;
  if (excludes.length > 0 && matchesAnyPattern(filePath, excludes, baseDir)) enabled = false;
  if (forceIncludes.length > 0 && matchesAnyExactPattern(filePath, forceIncludes, baseDir)) enabled = true;
  if (forceExcludes.length > 0 && matchesAnyExactPattern(filePath, forceExcludes, baseDir)) enabled = false;
  return enabled;
}

async function expandGlob(pattern: string, baseDir: string): Promise<string[]> {
  let root = baseDir;
  let relativePattern = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  if (path.isAbsolute(pattern)) {
    root = path.parse(pattern).root;
    relativePattern = toPosix(pattern).slice(root.length).replace(/^\/+/, "");
  }
  if (relativePattern.split("/").includes("..")) return [];
  const matched: string[] = [];

  const walk = async (dir: string, relativeDir: string, depth: number): Promise<void> => {
    if (depth > 12) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = path.join(dir, entry.name);
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      let info;
      try {
        info = await stat(fullPath);
      } catch {
        continue;
      }
      if (globMatch(relativePath, relativePattern)) matched.push(fullPath);
      if (info.isDirectory()) {
        const needed = relativePattern.includes("**") ||
          relativePattern.split("/").length > relativePath.split("/").length;
        if (needed) await walk(fullPath, relativePath, depth + 1);
      }
    }
  };

  await walk(root, "", 0);
  return matched.sort();
}

// ---------------------------------------------------------------------------
// Packages (settings.json `packages`)
// ---------------------------------------------------------------------------

interface PackageSpec {
  type: "npm" | "git" | "local";
  identity: string;
  name?: string;
  host?: string;
  repoPath?: string;
  localPath?: string;
}

function parseNpmName(spec: string): string {
  const match = spec.match(/^(@?[^@]+(?:\/[^@]+)?)(?:@(.+))?$/);
  return match?.[1] ?? spec;
}

function parseGitSource(source: string): { host: string; repoPath: string } | null {
  let raw = source.trim();
  const prefixed = raw.startsWith("git:");
  if (prefixed) raw = raw.slice(4).trim();
  if (!prefixed && !/^(https?|ssh|git):\/\//i.test(raw)) return null;

  let host = "";
  let repoPath = "";
  const scpLike = /^git@([^:]+):(.+)$/.exec(raw);
  if (scpLike) {
    host = scpLike[1];
    repoPath = scpLike[2];
  } else if (/^[a-z]+:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      host = parsed.hostname;
      repoPath = parsed.pathname.replace(/^\/+/, "");
    } catch {
      return null;
    }
  } else {
    const slash = raw.indexOf("/");
    if (slash < 0) return null;
    host = raw.slice(0, slash);
    repoPath = raw.slice(slash + 1);
    if (!host.includes(".") && host !== "localhost") return null;
  }

  const at = repoPath.indexOf("@");
  if (at >= 0) repoPath = repoPath.slice(0, at);
  const hash = repoPath.indexOf("#");
  if (hash >= 0) repoPath = repoPath.slice(0, hash);
  repoPath = repoPath.replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");
  if (!host || !repoPath || repoPath.split("/").length < 2) return null;
  if (
    host.includes("/") || host.includes("\\") || host.includes("\0") ||
    repoPath.includes("\\") || repoPath.includes("\0") ||
    repoPath.split("/").includes("..")
  ) return null;
  return { host, repoPath };
}

function parsePackageSource(source: string, baseDir: string): PackageSpec {
  const raw = source.trim();
  if (raw.startsWith("npm:")) {
    const name = parseNpmName(raw.slice(4).trim());
    return { type: "npm", identity: `npm:${name}`, name };
  }
  const git = parseGitSource(raw);
  if (git) {
    return {
      type: "git",
      identity: `git:${git.host}/${git.repoPath}`,
      host: git.host,
      repoPath: git.repoPath,
    };
  }
  const localPath = resolveInputPath(raw, baseDir);
  return { type: "local", identity: `local:${localPath}`, localPath };
}

async function packageRoot(
  spec: PackageSpec,
  scope: Scope,
  cwd: string,
  agentDir: string,
): Promise<string | null> {
  if (spec.type === "local") return spec.localPath ?? null;
  if (spec.type === "git") {
    if (!spec.host || !spec.repoPath) return null;
    const root = scope === "project"
      ? path.join(cwd, ".pi", "git")
      : path.join(agentDir, "git");
    const candidate = path.resolve(root, spec.host, ...spec.repoPath.split("/"));
    return isInside(root, candidate) ? candidate : null;
  }
  const name = spec.name;
  if (!name) return null;
  const managed = scope === "project"
    ? path.join(cwd, ".pi", "npm", "node_modules", name)
    : path.join(agentDir, "npm", "node_modules", name);
  if (await isDirectory(managed)) return managed;
  if (scope === "user") {
    const home = homeDirectory();
    const legacy = [
      path.join(home, ".npm-global", "lib", "node_modules", name),
      path.join(home, ".npm", "lib", "node_modules", name),
      path.join("/usr/local/lib/node_modules", name),
      path.join("/opt/homebrew/lib/node_modules", name),
    ];
    for (const candidate of legacy) {
      if (await isDirectory(candidate)) return candidate;
    }
    try {
      const versions = (await readdir(path.join(home, ".nvm", "versions", "node"))).sort().reverse();
      for (const version of versions) {
        const candidate = path.join(home, ".nvm", "versions", "node", version, "lib", "node_modules", name);
        if (await isDirectory(candidate)) return candidate;
      }
    } catch {
      // No nvm tree.
    }
  }
  return null;
}

async function collectManifestSkillFiles(
  root: string,
  entries: readonly string[],
): Promise<string[]> {
  const plain = entries.filter((entry) => !isOverridePattern(entry));
  const patterns = entries.filter(isOverridePattern);
  const all: string[] = [];
  for (const entry of plain) {
    let paths: string[];
    if (entry.includes("*") || entry.includes("?")) {
      paths = await expandGlob(entry, root);
    } else {
      paths = [resolveInputPath(entry, root)];
    }
    all.push(...await collectSkillFiles(paths));
  }
  return [...applyPatterns(all, patterns, root)];
}

async function packageSkillFiles(
  root: string,
  filter: Record<string, unknown> | undefined,
): Promise<string[]> {
  const packageJson = await readJson(path.join(root, "package.json"));
  const pi = isRecord(packageJson) && isRecord(packageJson.pi) ? packageJson.pi : null;
  const explicitManifest = pi !== null &&
    ["extensions", "skills", "prompts", "themes"].some((field) => field in pi);

  let files: string[];
  if (explicitManifest) {
    const manifestSkills = pi && Array.isArray(pi.skills) &&
      pi.skills.every((entry) => typeof entry === "string")
      ? pi.skills as string[]
      : null;
    files = manifestSkills === null ? [] : await collectManifestSkillFiles(root, manifestSkills);
  } else {
    files = await collectSkillEntries(path.join(root, "skills"), "pi");
  }

  if (filter && filter.skills !== undefined) {
    const patterns = stringArray(filter.skills);
    files = patterns.length === 0 ? [] : [...applyPatterns(files, patterns, root)];
  }
  return files;
}

interface PackageCandidate {
  raw: unknown;
  source: string;
  scope: Scope;
  spec: PackageSpec;
}

function packageCandidates(
  entries: unknown,
  scope: Scope,
  baseDir: string,
): PackageCandidate[] {
  const candidates: PackageCandidate[] = [];
  if (!Array.isArray(entries)) return candidates;
  for (const entry of entries) {
    const source = typeof entry === "string"
      ? entry
      : isRecord(entry) && typeof entry.source === "string"
        ? entry.source
        : null;
    if (!source) continue;
    const spec = parsePackageSource(source, baseDir);
    candidates.push({ raw: entry, source, scope, spec });
  }
  return candidates;
}

function dedupePackages(candidates: readonly PackageCandidate[]): PackageCandidate[] {
  const result: PackageCandidate[] = [];
  const seen = new Map<string, number>();
  for (const candidate of candidates) {
    const index = seen.get(candidate.spec.identity);
    if (index === undefined) {
      seen.set(candidate.spec.identity, result.length);
      result.push(candidate);
      continue;
    }
    const existing = result[index];
    if (existing.scope === "project" && candidate.scope === "user") {
      if (isRecord(existing.raw) && existing.raw.autoload === false) result.push(candidate);
    } else if (candidate.scope === "project") {
      result[index] = candidate;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Project trust (the same `trust.json` pi and pi-web share)
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
];

async function findGitRepoRoot(startDir: string): Promise<string | null> {
  let dir = path.resolve(startDir);
  for (;;) {
    if (await pathExists(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function collectAncestorAgentsDirs(cwd: string): Promise<string[]> {
  const repoRoot = await findGitRepoRoot(cwd);
  const dirs: string[] = [];
  let dir = path.resolve(cwd);
  for (;;) {
    dirs.push(path.join(dir, ".agents", "skills"));
    if (repoRoot !== null && samePath(dir, repoRoot)) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

async function hasTrustRequiringResources(cwd: string, home: string): Promise<boolean> {
  const configDir = path.join(cwd, ".pi");
  for (const entry of TRUST_REQUIRING_ENTRIES) {
    if (await pathExists(path.join(configDir, entry))) return true;
  }
  const userAgents = path.join(home, ".agents", "skills");
  let dir = cwd;
  for (;;) {
    const agents = path.join(dir, ".agents", "skills");
    if (!samePath(agents, userAgents) && await pathExists(agents)) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

async function readTrustDecision(agentDir: string, cwd: string): Promise<boolean | null> {
  const trust = await readJson(path.join(agentDir, "trust.json"));
  if (!isRecord(trust)) return null;

  const entries: { path: string; decision: boolean }[] = [];
  for (const key of Object.keys(trust)) {
    const value = trust[key];
    if (value !== true && value !== false) continue;
    try {
      entries.push({ path: await resolveExistingPath(key), decision: value });
    } catch {
      entries.push({ path: path.resolve(key), decision: value });
    }
  }

  let dir: string;
  try {
    dir = await resolveExistingPath(cwd);
  } catch {
    dir = path.resolve(cwd);
  }
  for (;;) {
    for (const entry of entries) {
      if (samePath(entry.path, dir)) return entry.decision;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ---------------------------------------------------------------------------
// Loading skills
// ---------------------------------------------------------------------------

function validateName(name: string): string[] {
  const errors: string[] = [];
  if (name.length > 64) errors.push(`name exceeds 64 characters (${name.length})`);
  if (!/^[a-z0-9-]+$/.test(name)) errors.push("name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)");
  if (name.startsWith("-") || name.endsWith("-")) errors.push("name must not start or end with a hyphen");
  if (name.includes("--")) errors.push("name must not contain consecutive hyphens");
  return errors;
}

function validateDescription(description: unknown): string[] {
  if (typeof description !== "string" || description.trim() === "") {
    return ["description is required"];
  }
  return description.length > 1024 ? [`description exceeds 1024 characters (${description.length})`] : [];
}

async function loadSkillFile(
  filePath: string,
  meta: ResourceMeta,
): Promise<{ skill: SkillRecord | null; diagnostics: SkillDiagnostic[] }> {
  const diagnostics: SkillDiagnostic[] = [];
  const declared = path.basename(filePath) === "SKILL.md";
  if (!filePath.endsWith(".md")) {
    diagnostics.push({ type: "warning", message: "skill path is not a markdown file", path: filePath });
    return { skill: null, diagnostics };
  }
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    diagnostics.push({ type: "warning", message: describe(error), path: filePath });
    return { skill: null, diagnostics };
  }

  let data: Record<string, unknown>;
  try {
    data = parseFrontmatter(content).data;
  } catch (error) {
    if (declared) {
      diagnostics.push({ type: "warning", message: describe(error), path: filePath });
    }
    return { skill: null, diagnostics };
  }

  const description = data.description;
  const hasDescription = typeof description === "string" && description.trim() !== "";
  if (!declared && !hasDescription) return { skill: null, diagnostics };

  const skillDir = path.dirname(filePath);
  const parentName = path.basename(skillDir);
  for (const message of validateDescription(description)) {
    diagnostics.push({ type: "warning", message, path: filePath });
  }
  const name = (typeof data.name === "string" ? data.name : "") || parentName;
  for (const message of validateName(name)) {
    diagnostics.push({ type: "warning", message, path: filePath });
  }
  if (!hasDescription) return { skill: null, diagnostics };

  return {
    skill: {
      name,
      description: description as string,
      filePath,
      baseDir: skillDir,
      disableModelInvocation: data[FRONTMATTER_KEY] === true,
      sourceInfo: {
        path: filePath,
        source: meta.source,
        scope: meta.scope,
        origin: meta.origin,
        ...(meta.baseDir ? { baseDir: meta.baseDir } : {}),
      },
    },
    diagnostics,
  };
}

async function discoverSkills(rawCwd: string): Promise<Discovery> {
  const cwd = resolveInputPath(rawCwd, homeDirectory());
  const agentDir = path.resolve(agentDirectory());
  const home = path.resolve(homeDirectory());
  const globalSettings = await readJson(path.join(agentDir, "settings.json"));
  const global = isRecord(globalSettings) ? globalSettings : {};

  const requiresTrust = await hasTrustRequiringResources(cwd, home);
  const decision = await readTrustDecision(agentDir, cwd);
  const projectResourcesLoaded = requiresTrust ? decision === true : (decision ?? true);
  const projectLoaded = !requiresTrust || decision === true;
  const projectSettings = projectLoaded ? await readJson(path.join(cwd, ".pi", "settings.json")) : null;
  const project = isRecord(projectSettings) ? projectSettings : {};

  const resources: SkillResource[] = [];

  // Packages: project sources first, then user sources, project wins duplicates.
  const candidates = [
    ...packageCandidates(project.packages, "project", path.join(cwd, ".pi")),
    ...packageCandidates(global.packages, "user", agentDir),
  ];
  for (const candidate of dedupePackages(candidates)) {
    const root = await packageRoot(candidate.spec, candidate.scope, cwd, agentDir);
    if (root === null || !(await isDirectory(root))) continue;
    const filter = isRecord(candidate.raw) ? candidate.raw : undefined;
    for (const filePath of await packageSkillFiles(root, filter)) {
      resources.push({
        path: filePath,
        rank: 4,
        meta: {
          source: candidate.source,
          scope: candidate.scope,
          origin: "package",
          baseDir: root,
        },
      });
    }
  }

  // Explicit settings paths, project before user (`settings.json: skills`).
  const explicitSources: { settings: Record<string, unknown>; scope: Scope; baseDir: string }[] = [];
  if (projectLoaded) explicitSources.push({ settings: project, scope: "project", baseDir: path.join(cwd, ".pi") });
  explicitSources.push({ settings: global, scope: "user", baseDir: agentDir });
  for (const source of explicitSources) {
    const entries = stringArray(source.settings.skills);
    const { plain, patterns } = splitPatterns(entries);
    const allFiles = await collectSkillFiles(plain.map((entry) => resolveInputPath(entry, source.baseDir)));
    const enabled = applyPatterns(allFiles, patterns, source.baseDir);
    for (const filePath of enabled) {
      resources.push({
        path: filePath,
        rank: source.scope === "project" ? 0 : 2,
        meta: {
          source: "local",
          scope: source.scope,
          origin: "top-level",
        },
      });
    }
  }

  // Auto-discovered folders, in pi's order: project .pi, project .agents
  // (each ancestor), user .pi/agent, user .agents.
  const addAuto = async (
    dir: string,
    mode: "pi" | "agents",
    meta: ResourceMeta,
    overrides: string[],
    overrideBase: string,
    rank: number,
  ): Promise<void> => {
    for (const filePath of await collectSkillEntries(dir, mode)) {
      if (!isEnabledByOverrides(filePath, overrides, overrideBase)) continue;
      resources.push({ path: filePath, rank, meta });
    }
  };

  const globalOverrides = stringArray(global.skills);
  const projectOverrides = stringArray(project.skills);
  const userAgentsDir = path.join(home, ".agents", "skills");

  if (projectLoaded) {
    await addAuto(
      path.join(cwd, ".pi", "skills"),
      "pi",
      { source: "auto", scope: "project", origin: "top-level", baseDir: path.join(cwd, ".pi") },
      projectOverrides,
      path.join(cwd, ".pi"),
      1,
    );
    for (const dir of await collectAncestorAgentsDirs(cwd)) {
      if (samePath(dir, userAgentsDir)) continue;
      await addAuto(
        dir,
        "agents",
        { source: "auto", scope: "project", origin: "top-level", baseDir: path.dirname(dir) },
        projectOverrides,
        path.dirname(dir),
        1,
      );
    }
  }
  await addAuto(
    path.join(agentDir, "skills"),
    "pi",
    { source: "auto", scope: "user", origin: "top-level", baseDir: agentDir },
    globalOverrides,
    agentDir,
    3,
  );
  await addAuto(
    userAgentsDir,
    "agents",
    { source: "auto", scope: "user", origin: "top-level", baseDir: path.dirname(userAgentsDir) },
    globalOverrides,
    path.dirname(userAgentsDir),
    3,
  );

  // Lower rank wins; Array.prototype.sort is stable, so discovery order remains
  // the tie-breaker inside one rank.
  resources.sort((left, right) => left.rank - right.rank);

  const byName = new Map<string, SkillRecord>();
  const realPaths = new Set<string>();
  const diagnostics: SkillDiagnostic[] = [];
  for (const resource of resources) {
    const result = await loadSkillFile(resource.path, resource.meta);
    diagnostics.push(...result.diagnostics);
    const skill = result.skill;
    if (!skill) continue;

    let realPath: string;
    try {
      realPath = await resolveExistingPath(skill.filePath);
    } catch {
      realPath = path.resolve(skill.filePath);
    }
    if (realPaths.has(realPath)) continue;

    const existing = byName.get(skill.name);
    if (existing) {
      diagnostics.push({
        type: "collision",
        message: `name "${skill.name}" collision`,
        path: skill.filePath,
        collision: {
          resourceType: "skill",
          name: skill.name,
          winnerPath: existing.filePath,
          loserPath: skill.filePath,
        },
      });
      continue;
    }
    realPaths.add(realPath);
    byName.set(skill.name, skill);
  }

  return {
    skills: [...byName.values()],
    diagnostics,
    projectResourcesLoaded,
  };
}

// ---------------------------------------------------------------------------
// Install records (`~/.agents/.skill-lock.json`, `<cwd>/skills-lock.json`)
// ---------------------------------------------------------------------------

interface SkillLockEntry {
  source?: unknown;
  sourceType?: unknown;
  skillPath?: unknown;
  ref?: unknown;
  skillFolderHash?: unknown;
  computedHash?: unknown;
}

function readSkillLock(pathName: string): Promise<Record<string, SkillLockEntry>> {
  return readJson(pathName).then((parsed) => {
    if (!isRecord(parsed) || !isRecord(parsed.skills)) return {};
    return parsed.skills as Record<string, SkillLockEntry>;
  });
}

function isWithin(root: string, target: string): boolean {
  const relative = relativePath(path.resolve(root), path.resolve(target));
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function findLockEntry(
  entries: Record<string, SkillLockEntry>,
  skillName: string,
): SkillLockEntry | undefined {
  if (entries[skillName]) return entries[skillName];
  const lower = skillName.toLowerCase();
  const key = Object.keys(entries).find((name) => name.toLowerCase() === lower);
  return key ? entries[key] : undefined;
}

function normalizeSource(source: string, sourceType?: string): string {
  if (sourceType !== "github") return source.replace(/\/$/, "");
  return source
    .replace(/^git\+/, "")
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
}

function buildSkillsShUrl(source: string, skillName: string): string | undefined {
  if (!source || source.includes("://") || source.startsWith("git@")) return undefined;
  const sourcePath = source.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return sourcePath ? `https://skills.sh/${sourcePath}/${encodeURIComponent(skillName)}` : undefined;
}

function getInstallInfo(
  entries: Record<string, SkillLockEntry>,
  skillName: string,
  scope: "global" | "project",
): SkillInstallInfo | undefined {
  const entry = findLockEntry(entries, skillName);
  if (!entry || typeof entry.source !== "string" || !entry.source.trim()) return undefined;
  const sourceType = typeof entry.sourceType === "string" ? entry.sourceType : undefined;
  const source = normalizeSource(entry.source.trim(), sourceType);
  if (!source) return undefined;
  const skillPath = typeof entry.skillPath === "string" ? entry.skillPath : undefined;
  const ref = typeof entry.ref === "string" ? entry.ref : undefined;
  const rawVersion = scope === "global" ? entry.skillFolderHash : entry.computedHash;
  const versionHash = typeof rawVersion === "string" && rawVersion ? rawVersion : undefined;
  const isGitHubSource = sourceType === "github" && /^[\w.-]+\/[\w.-]+$/.test(source);
  const hasComparableVersion = scope === "global" || !ref;
  return {
    package: `${source}@${skillName}`,
    scope,
    source,
    sourceType,
    skillsShUrl: sourceType === "local" ? undefined : buildSkillsShUrl(source, skillName),
    ...(skillPath ? { skillPath } : {}),
    ...(ref ? { ref } : {}),
    ...(versionHash ? { versionHash } : {}),
    canCheckForUpdates: Boolean(isGitHubSource && skillPath && versionHash && hasComparableVersion),
  };
}

async function annotateInstalls(skills: SkillRecord[], cwd: string): Promise<SkillRecord[]> {
  const agentDir = path.resolve(agentDirectory());
  const home = path.resolve(homeDirectory());
  const xdgStateHome = process.env.XDG_STATE_HOME;
  const globalLock = xdgStateHome && xdgStateHome.trim()
    ? path.join(xdgStateHome, "skills", ".skill-lock.json")
    : path.join(home, ".agents", ".skill-lock.json");
  const projectLock = path.join(cwd, "skills-lock.json");
  const globalEntries = await readSkillLock(globalLock);
  const projectEntries = await readSkillLock(projectLock);
  const globalRoots = [path.join(agentDir, "skills"), path.join(home, ".agents", "skills")];
  const projectRoots = [path.join(cwd, ".pi", "skills"), path.join(cwd, ".agents", "skills")];

  const result: SkillRecord[] = [];
  for (const skill of skills) {
    if (!(await pathExists(skill.filePath))) {
      result.push(skill);
      continue;
    }
    const install = globalRoots.some((root) => isWithin(root, skill.filePath))
      ? getInstallInfo(globalEntries, skill.name, "global")
      : projectRoots.some((root) => isWithin(root, skill.filePath))
        ? getInstallInfo(projectEntries, skill.name, "project")
        : undefined;
    result.push(install ? { ...skill, install } : skill);
  }
  return result;
}

// ---------------------------------------------------------------------------
// "Model invocation" switch (frontmatter line edit)
// ---------------------------------------------------------------------------

interface FrontmatterBlock {
  openingEnd: number;
  closingStart: number;
  newline: string;
}

function findFrontmatterBlock(content: string): FrontmatterBlock | undefined {
  const newline = "\\r\\n|\\n|\\r";
  const opening = new RegExp(`^\\uFEFF?---[ \\t]*(${newline})`).exec(content);
  if (!opening) return undefined;
  const rest = content.slice(opening[0].length);
  const closing = new RegExp(`(^|${newline})---`).exec(rest);
  if (!closing) return undefined;
  return {
    openingEnd: opening[0].length,
    closingStart: opening[0].length + closing.index + closing[1].length,
    newline: opening[1],
  };
}

function startsWithFrontmatterFence(content: string): boolean {
  const start = content.startsWith("\uFEFF") ? 1 : 0;
  return content.startsWith("---", start);
}

function setDisableModelInvocation(content: string, disable: boolean): string {
  const { data } = parseFrontmatter(content);
  const hasKey = Object.prototype.hasOwnProperty.call(data, FRONTMATTER_KEY);
  if (!disable && !hasKey) return content;

  const keyLine = `[ \\t]*(?:${FRONTMATTER_KEY}|"${FRONTMATTER_KEY}"|'${FRONTMATTER_KEY}')[ \\t]*:`;
  const newline = "\\r\\n|\\n|\\r";
  const block = findFrontmatterBlock(content);

  if (disable) {
    if (hasKey) {
      if (!block) throw new Error(`Cannot edit ${FRONTMATTER_KEY}: unsupported frontmatter formatting`);
      const head = content.slice(block.openingEnd, block.closingStart);
      const line = new RegExp(`(^|${newline})(${keyLine})[^\\r\\n]*`);
      if (!line.test(head)) throw new Error(`Cannot edit ${FRONTMATTER_KEY}: unsupported frontmatter formatting`);
      const updated = head.replace(line, "$1$2 true");
      return content.slice(0, block.openingEnd) + updated + content.slice(block.closingStart);
    }
    if (!block) {
      if (startsWithFrontmatterFence(content)) {
        throw new Error(`Cannot edit ${FRONTMATTER_KEY}: unsupported frontmatter formatting`);
      }
      const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
      const body = bom ? content.slice(1) : content;
      return `${bom}---\n${FRONTMATTER_KEY}: true\n---\n${body}`;
    }
    return (
      content.slice(0, block.openingEnd) +
      `${FRONTMATTER_KEY}: true${block.newline}` +
      content.slice(block.openingEnd)
    );
  }

  if (!block) throw new Error(`Cannot edit ${FRONTMATTER_KEY}: unsupported frontmatter formatting`);
  const head = content.slice(block.openingEnd, block.closingStart);
  const line = new RegExp(`(^|${newline})${keyLine}[^\\r\\n]*(?:${newline}|$)`);
  if (!line.test(head)) throw new Error(`Cannot edit ${FRONTMATTER_KEY}: unsupported frontmatter formatting`);
  const updated = head.replace(line, "$1");
  return content.slice(0, block.openingEnd) + updated + content.slice(block.closingStart);
}

async function writeAtomic(target: string, contents: string): Promise<void> {
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
      // The temp file never existed, or the rename consumed it.
    }
    throw cause;
  }
}

/** Roots a skill switch may write through, besides any `.pi/skills` / `.agents/skills` path. */
async function writableRoots(cwd: string | null): Promise<string[]> {
  const agentDir = path.resolve(agentDirectory());
  const home = path.resolve(homeDirectory());
  const roots = new Set<string>([agentDir, path.join(home, ".agents", "skills")]);

  const addPackages = async (
    settings: Record<string, unknown>,
    scope: Scope,
    baseDir: string,
    projectCwd: string,
  ): Promise<void> => {
    for (const candidate of packageCandidates(settings.packages, scope, baseDir)) {
      const root = await packageRoot(candidate.spec, candidate.scope, projectCwd, agentDir);
      if (root !== null) roots.add(root);
    }
  };

  const globalSettings = await readJson(path.join(agentDir, "settings.json"));
  if (isRecord(globalSettings)) await addPackages(globalSettings, "user", agentDir, cwd ?? home);
  if (cwd) {
    const resolved = resolveInputPath(cwd, homeDirectory());
    const projectSettings = await readJson(path.join(resolved, ".pi", "settings.json"));
    if (isRecord(projectSettings)) {
      await addPackages(projectSettings, "project", path.join(resolved, ".pi"), resolved);
    }
    roots.add(path.join(resolved, ".pi", "skills"));
    roots.add(path.join(resolved, ".agents", "skills"));
    for (const dir of await collectAncestorAgentsDirs(resolved)) roots.add(dir);
  }

  const resolvedRoots: string[] = [];
  for (const root of roots) {
    try {
      resolvedRoots.push(await resolveExistingPath(root));
    } catch {
      resolvedRoots.push(path.resolve(root));
    }
  }
  return resolvedRoots;
}

function insideSkillFolder(target: string): boolean {
  const parts = path.resolve(target).split(path.sep);
  for (let index = 0; index < parts.length - 1; index += 1) {
    if ((parts[index] === ".pi" || parts[index] === ".agents") && parts[index + 1] === "skills") {
      return true;
    }
  }
  return false;
}

function allowedSkillWrite(target: string, roots: readonly string[]): boolean {
  if (insideSkillFolder(target)) return true;
  return roots.some((root) => isInside(root, target));
}

interface ToggleFailure {
  status: number;
  error: string;
}

async function toggleSkillFile(
  filePath: string,
  disableModelInvocation: boolean,
  roots: readonly string[],
): Promise<ToggleFailure | null> {
  if (path.extname(filePath).toLowerCase() !== ".md") {
    return { status: 400, error: "Not a skill file" };
  }
  let info;
  try {
    info = await stat(filePath);
  } catch {
    return { status: 404, error: "file not found" };
  }
  if (!info.isFile()) return { status: 400, error: "Not a skill file" };

  const target = await resolveExistingPath(filePath);
  if (!allowedSkillWrite(target, roots)) return { status: 403, error: "Access denied" };

  const content = await readFile(target, "utf8");
  const updated = setDisableModelInvocation(content, disableModelInvocation);
  if (updated !== content) await writeAtomic(target, updated);
  return null;
}

// ---------------------------------------------------------------------------
// Search, install and update checks (skills.sh, npx, GitHub)
//
// No `fetch` in this runtime: every HTTP read is `curl` in the user's login
// shell, and every install/update is `npx skills` there too. The commands are
// spawned with line events so a long install does not block the UI thread;
// the request awaits the promise while the pane shows its busy state. The
// search and update checks have short deadlines of their own, and an install
// gets a generous one.
// ---------------------------------------------------------------------------

const SKILLS_API_BASE = process.env.SKILLS_API_URL || "https://skills.sh";
const SKILL_HTTP_TIMEOUT_MS = 15_000;
const SKILL_SEARCH_TIMEOUT_MS = 30_000;
const SKILL_INSTALL_TIMEOUT_MS = 5 * 60_000;
const SKILL_UPDATE_TIMEOUT_MS = 5 * 60_000;
const ANSI_RE = /\x1B\[[0-9;]*m/g;

interface SkillUpdateResult {
  package: string;
  scope: "global" | "project";
  state: "up-to-date" | "update-available" | "unsupported" | "error";
  currentVersion?: string;
  latestVersion?: string;
  message?: string;
}

interface ShellRun {
  code: number | null;
  signal: string | null;
  error: string | null;
  lines: string[];
}

class SkillHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SkillHttpError";
    this.status = status;
  }
}

function parseJsonObject(text: string, what: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error(`${what} did not return JSON`);
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (cause) {
    throw new Error(`${what} returned invalid JSON: ${describe(cause)}`);
  }
}

async function runShellScript(script: string, cwd: string | undefined, timeoutMs: number): Promise<ShellRun> {
  const shell = loginShell();
  if (shell === null) throw new Error("this platform has no login shell");
  return new Promise<ShellRun>((resolve, reject) => {
    const lines: string[] = [];
    let child: ChildProcess;
    try {
      child = spawn(shell, ["-ilc", script], {
        lines: true,
        timeoutMs,
        ...(cwd !== undefined ? { cwd } : {}),
      });
    } catch (cause) {
      reject(cause);
      return;
    }
    let settled = false;
    const finish = (result: ExitResult): void => {
      if (settled) return;
      settled = true;
      resolve({
        code: result.code ?? null,
        signal: result.signal ?? null,
        error: result.error ?? null,
        lines,
      });
    };
    child.on("stdout", (line) => lines.push(line));
    child.on("stderr", (line) => lines.push(line));
    child.on("exit", (result) => finish(result));
  });
}

async function runNpxSkills(args: readonly string[], cwd: string | undefined, timeoutMs: number): Promise<ShellRun> {
  const script = `export FORCE_COLOR=0; exec ${["npx", "--yes", "skills", ...args].map(quoteShell).join(" ")}`;
  return runShellScript(script, cwd, timeoutMs);
}

async function curlText(url: string, headers: readonly string[] = [], timeoutMs = SKILL_HTTP_TIMEOUT_MS): Promise<string> {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  const words = ["curl", "-fsSL", "--max-time", String(seconds)];
  for (const header of headers) words.push("-H", quoteShell(header));
  words.push(quoteShell(url));
  let output;
  try {
    output = await loginShellCommand(words.join(" "), timeoutMs + 5_000);
  } catch (cause) {
    throw new Error(`curl failed: ${describe(cause)}`);
  }
  if (output.code !== 0) {
    const stderr = output.stderr.trim();
    const message = stderr || output.stdout.trim() || `curl exit ${output.code ?? "unknown"}`;
    const match = /returned error:\s*(\d{3})|HTTP\/[\d.]+\s+(\d{3})/i.exec(message);
    const status = match ? Number(match[1] ?? match[2]) : 0;
    throw new SkillHttpError(status, message.split(/\r?\n/).slice(-2).join("\n"));
  }
  return output.stdout;
}

async function curlJson(url: string, headers: readonly string[] = [], timeoutMs = SKILL_HTTP_TIMEOUT_MS): Promise<unknown> {
  return parseJsonObject(await curlText(url, headers, timeoutMs), "The remote server");
}

function formatInstalls(count?: number): string {
  if (!count || count <= 0) return "";
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M installs`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}K installs`;
  return `${count} install${count === 1 ? "" : "s"}`;
}

function parseInstallCount(installs: string): number {
  const match = installs.match(/^([\d.]+)([KMB])?\s+installs?$/);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  const multiplier = match[2] === "B" ? 1_000_000_000 : match[2] === "M" ? 1_000_000 : match[2] === "K" ? 1_000 : 1;
  return value * multiplier;
}

interface SkillsApiSkill {
  id?: string;
  name?: string;
  source?: string;
  installs?: number;
}

function searchResultsFromApi(raw: unknown): { package: string; installs: string; url: string }[] {
  const skills = isRecord(raw) && Array.isArray(raw.skills) ? raw.skills : [];
  return skills
    .filter(isRecord)
    .map((skill: Record<string, unknown>) => {
      const name = typeof skill.name === "string" ? skill.name.trim() : "";
      const source = typeof skill.source === "string" ? skill.source.trim() : "";
      const slug = typeof skill.id === "string" ? skill.id.trim() : "";
      if (!name || (!source && !slug)) return null;
      return {
        package: `${source || slug}@${name}`,
        installs: formatInstalls(typeof skill.installs === "number" ? skill.installs : undefined),
        url: slug ? `${SKILLS_API_BASE}/${slug}` : "",
      };
    })
    .filter((item): item is { package: string; installs: string; url: string } => item !== null)
    .sort((left, right) => parseInstallCount(right.installs) - parseInstallCount(left.installs));
}

function parseSearchOutput(raw: string): { package: string; installs: string; url: string }[] {
  const clean = raw.replace(ANSI_RE, "");
  const results: { package: string; installs: string; url: string }[] = [];
  const lines = clean.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim();
    // package line: "owner/repo@skill  NNK installs"
    const pkgMatch = line.match(/^([\w.\-]+\/[\w.\-@:]+)\s+([\d.,]+[KMB]?\s+installs)$/);
    if (pkgMatch) {
      const urlLine = (lines[index + 1] ?? "").trim().replace(/^└\s*/, "");
      results.push({
        package: pkgMatch[1] ?? "",
        installs: pkgMatch[2] ?? "",
        url: urlLine.startsWith("https://") ? urlLine : "",
      });
    }
  }
  return results;
}

async function searchSkillsApi(query: string, limit: number): Promise<{ package: string; installs: string; url: string }[]> {
  const url = `${SKILLS_API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=${limit}`;
  const text = await loginShellRun(`curl -fsSL --max-time 15 ${quoteShell(url)}`, SKILL_SEARCH_TIMEOUT_MS);
  return searchResultsFromApi(parseJsonObject(text, "skills.sh")).slice(0, limit);
}

async function searchSkillsCli(query: string, limit: number): Promise<{ package: string; installs: string; url: string }[]> {
  const run = await runNpxSkills(["find", query], undefined, 20_000);
  return parseSearchOutput(run.lines.join("\n")).slice(0, limit);
}

function parseLimit(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return 50;
  return Math.min(50, Math.max(1, Math.floor(number)));
}

function skillSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function skillNameFromPackage(pkg: string): string {
  const at = pkg.lastIndexOf("@");
  return at >= 0 ? pkg.slice(at + 1) : pkg;
}

function skillFolder(skillPath: string): string {
  let folder = skillPath.replace(/\\/g, "/");
  if (folder.toLowerCase().endsWith("/skill.md")) folder = folder.slice(0, -9);
  else if (folder.toLowerCase().endsWith("skill.md")) folder = folder.slice(0, -8);
  return folder.replace(/\/$/, "");
}

function buildSkillUpdateArgs(install: SkillInstallInfo): string[] {
  const folder = skillFolder(install.skillPath ?? "");
  const source = folder ? `${install.source}/${folder}` : install.source;
  const ref = install.ref ? `#${encodeURIComponent(install.ref)}` : "";
  const args = [
    "add",
    `${source}${ref}`,
    "--skill",
    skillNameFromPackage(install.package),
    "-y",
    "--agent",
    "pi",
  ];
  if (install.scope === "global") args.push("-g");
  return args;
}

function skillUpdateResult(
  install: SkillInstallInfo,
  state: SkillUpdateResult["state"],
  latestVersion?: string,
  message?: string,
): SkillUpdateResult {
  return {
    package: install.package,
    scope: install.scope,
    state,
    currentVersion: install.versionHash,
    latestVersion,
    message,
  };
}

async function resolveGitTreeHash(install: SkillInstallInfo): Promise<string> {
  const root = await dataDirectory();
  if (root === undefined) throw new Error("This app has no data directory for a temporary Git checkout.");
  const gitDir = path.join(root, `skill-check-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(gitDir, { recursive: true });
  try {
    await run("git", ["init", "--bare", gitDir], { cwd: root, timeoutMs: 30_000 });
    await run("git", [
      `--git-dir=${gitDir}`,
      "fetch",
      "--depth=1",
      "--filter=blob:none",
      "--no-tags",
      `https://github.com/${install.source}.git`,
      install.ref || "HEAD",
    ], { cwd: root, timeoutMs: 30_000 });
    const folder = skillFolder(install.skillPath ?? "");
    const revision = folder ? `FETCH_HEAD:${folder}` : "FETCH_HEAD^{tree}";
    const output = await run("git", [`--git-dir=${gitDir}`, "rev-parse", revision], { cwd: root, timeoutMs: 30_000 });
    const hash = output.stdout.trim();
    if (!/^[0-9a-f]{40}$/i.test(hash)) throw new Error("Invalid Git tree hash");
    return hash;
  } finally {
    try {
      await loginShellCommand(`rm -rf -- ${quoteShell(gitDir)}`, 15_000);
    } catch {
      // A leftover check directory is harmless; the next check uses a new one.
    }
  }
}

async function checkGlobalSkill(install: SkillInstallInfo): Promise<SkillUpdateResult> {
  const ref = install.ref || "HEAD";
  const folder = skillFolder(install.skillPath ?? "");
  const url = `https://api.github.com/repos/${install.source}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  const headers = ["Accept: application/vnd.github.v3+json", "User-Agent: pi-web"];
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.push(`Authorization: Bearer ${token}`);
  let latestVersion: string | undefined;
  try {
    const raw = await curlJson(url, headers);
    latestVersion = isRecord(raw) && typeof raw.sha === "string" && !folder ? raw.sha : undefined;
    if (folder && isRecord(raw) && Array.isArray(raw.tree)) {
      const entry = raw.tree.find((item) => isRecord(item) && item.type === "tree" && item.path === folder);
      if (isRecord(entry) && typeof entry.sha === "string") latestVersion = entry.sha;
    }
  } catch (cause) {
    if (!(cause instanceof SkillHttpError) || ![401, 403, 429].includes(cause.status)) throw cause;
    latestVersion = await resolveGitTreeHash(install);
  }
  if (!latestVersion) return skillUpdateResult(install, "error", undefined, "Remote skill path was not found.");
  return skillUpdateResult(
    install,
    latestVersion === install.versionHash ? "up-to-date" : "update-available",
    latestVersion,
  );
}

async function checkProjectSkill(install: SkillInstallInfo): Promise<SkillUpdateResult> {
  const [owner, repo] = install.source.split("/");
  if (!owner || !repo) throw new Error("The installed skill does not name a GitHub repository.");
  const name = skillSlug(skillNameFromPackage(install.package));
  const url = `${SKILLS_API_BASE}/api/download/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(name)}`;
  const raw = await curlJson(url);
  const latestVersion = isRecord(raw) && typeof raw.hash === "string" ? raw.hash : undefined;
  if (!latestVersion) return skillUpdateResult(install, "error", undefined, "skills.sh did not return a version hash.");
  return skillUpdateResult(
    install,
    latestVersion === install.versionHash ? "up-to-date" : "update-available",
    latestVersion,
  );
}

async function checkSkillUpdate(install: SkillInstallInfo): Promise<SkillUpdateResult> {
  if (!install.canCheckForUpdates || !install.versionHash || !install.skillPath) {
    return skillUpdateResult(install, "unsupported", undefined, "This lock entry cannot be checked automatically.");
  }
  try {
    return install.scope === "global"
      ? await checkGlobalSkill(install)
      : await checkProjectSkill(install);
  } catch (cause) {
    return skillUpdateResult(install, "error", undefined, describe(cause));
  }
}

interface LoadedSkillList {
  skills: SkillRecord[];
  projectResourcesLoaded: boolean;
}

async function loadInstalledSkills(cwd: string): Promise<LoadedSkillList> {
  const discovery = await discoverSkills(cwd);
  return {
    skills: await annotateInstalls(discovery.skills, cwd),
    projectResourcesLoaded: discovery.projectResourcesLoaded,
  };
}

async function resolveSkillCwd(raw: unknown): Promise<{ cwd: string } | { error: LocalResponse }> {
  if (typeof raw !== "string" || raw.trim() === "") {
    return { error: errorResponse("cwd required", 400) };
  }
  const cwd = resolveInputPath(raw, homeDirectory());
  try {
    if (!(await stat(cwd)).isDirectory()) return { error: errorResponse("cwd required", 400) };
  } catch {
    return { error: errorResponse("cwd required", 400) };
  }
  try {
    const canonical = await resolveExistingPath(cwd);
    const roots = [homeDirectory(), process.dataDir].filter((root): root is string => typeof root === "string" && root !== "");
    let allowed = false;
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
    if (!allowed) return { error: errorResponse("Access denied", 403) };
  } catch {
    return { error: errorResponse("Access denied", 403) };
  }
  return { cwd };
}

async function skillProjectTrusted(cwd: string): Promise<boolean> {
  const requiresTrust = await hasTrustRequiringResources(cwd, path.resolve(homeDirectory()));
  const decision = await readTrustDecision(path.resolve(agentDirectory()), cwd);
  return requiresTrust ? decision === true : (decision ?? true);
}

function parseRequestJson(request: LocalRequest): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(request.body ?? "");
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function postSkillSearch(request: LocalRequest): Promise<LocalResponse> {
  const body = parseRequestJson(request);
  if (body === null) return errorResponse("Invalid JSON body", 400);
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (query === "") return errorResponse("query required", 400);
  const limit = parseLimit(body.limit);
  try {
    return jsonResponse({ results: await searchSkillsApi(query, limit) });
  } catch (apiError) {
    try {
      return jsonResponse({ results: await searchSkillsCli(query, limit) });
    } catch (cliError) {
      return errorResponse(`${describe(apiError)}; ${describe(cliError)}`, 500);
    }
  }
}

async function postSkillInstall(request: LocalRequest): Promise<LocalResponse> {
  const body = parseRequestJson(request);
  if (body === null) return errorResponse("Invalid JSON body", 400);
  const pkg = typeof body.package === "string" ? body.package.trim() : "";
  if (pkg === "") return errorResponse("package required", 400);
  const isGlobal = body.scope !== "project";
  let cwd: string | undefined;
  if (!isGlobal) {
    if (typeof body.cwd !== "string" || body.cwd.trim() === "") {
      return errorResponse("cwd required for project install", 400);
    }
    const resolved = await resolveSkillCwd(body.cwd);
    if ("error" in resolved) return resolved.error;
    cwd = resolved.cwd;
    if (!(await skillProjectTrusted(cwd))) {
      return errorResponse("Project resources must be trusted before installing project skills", 403);
    }
  }
  const args = ["add", pkg, "-y", "--agent", "pi"];
  if (isGlobal) args.push("-g");
  try {
    const runCwd = cwd ?? await dataDirectory();
    const result = await runNpxSkills(args, runCwd, SKILL_INSTALL_TIMEOUT_MS);
    const output = result.lines.join("\n").replace(ANSI_RE, "");
    const success = /Installation complete|Installed \d+ skill/.test(output);
    if (result.error !== null || result.code !== 0 || !success) {
      return errorResponse(output.slice(-300) || "Install failed", 500);
    }
    return jsonResponse({ success: true, output });
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
}

async function postSkillCheck(request: LocalRequest): Promise<LocalResponse> {
  const body = parseRequestJson(request);
  if (body === null) return errorResponse("Invalid JSON body", 400);
  const resolved = await resolveSkillCwd(body.cwd);
  if ("error" in resolved) return resolved.error;
  const cwd = resolved.cwd;
  const pkg = typeof body.package === "string" && body.package !== "" ? body.package : undefined;
  const scope = body.scope === "global" || body.scope === "project" ? body.scope : undefined;
  if ((pkg !== undefined && scope === undefined) || (pkg === undefined && scope !== undefined)) {
    return errorResponse("package and scope must be provided together", 400);
  }
  try {
    const loaded = await loadInstalledSkills(cwd);
    const installs = loaded.skills
      .map((skill) => skill.install)
      .filter((install): install is SkillInstallInfo => install !== undefined)
      .filter((install) => pkg === undefined || (install.package === pkg && install.scope === scope));
    if (pkg !== undefined && installs.length === 0) return errorResponse("Installed skill not found", 404);
    return jsonResponse({ updates: await Promise.all(installs.map((install) => checkSkillUpdate(install))) });
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
}

async function postSkillUpdate(request: LocalRequest): Promise<LocalResponse> {
  const body = parseRequestJson(request);
  if (body === null) return errorResponse("Invalid JSON body", 400);
  const pkg = typeof body.package === "string" ? body.package : "";
  const scope = body.scope === "global" || body.scope === "project" ? body.scope : undefined;
  if (typeof body.cwd !== "string" || body.cwd === "" || pkg === "" || scope === undefined) {
    return errorResponse("cwd, package, and scope are required", 400);
  }
  const resolved = await resolveSkillCwd(body.cwd);
  if ("error" in resolved) return resolved.error;
  const cwd = resolved.cwd;
  try {
    const loaded = await loadInstalledSkills(cwd);
    const skill = loaded.skills.find((item) => item.install?.package === pkg && item.install.scope === scope);
    if (!skill?.install) return errorResponse("Installed skill not found", 404);
    if (!skill.install.canCheckForUpdates) {
      return errorResponse("This skill cannot be updated automatically", 400);
    }
    const runCwd = scope === "project" ? cwd : await dataDirectory();
    const result = await runNpxSkills(buildSkillUpdateArgs(skill.install), runCwd, SKILL_UPDATE_TIMEOUT_MS);
    const output = result.lines.join("\n").replace(ANSI_RE, "");
    if (result.error !== null || result.code !== 0) {
      return errorResponse(output || `npx skills add stopped (${result.error ?? result.signal ?? result.code ?? "unknown"})`, 500);
    }
    const refreshed = await loadInstalledSkills(cwd);
    const updated = refreshed.skills.find((item) => item.install?.package === pkg && item.install.scope === scope);
    return jsonResponse({
      success: true,
      ...(updated !== undefined ? { skill: updated } : {}),
      output: output.slice(-500),
    });
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

async function getSkills(request: LocalRequest): Promise<LocalResponse> {
  const rawCwd = request.params.get("cwd");
  if (!rawCwd) return errorResponse("cwd required", 400);
  const cwd = resolveInputPath(rawCwd, homeDirectory());
  try {
    const discovery = await discoverSkills(cwd);
    const skills = await annotateInstalls(discovery.skills, cwd);
    return jsonResponse({
      skills,
      diagnostics: discovery.diagnostics,
      projectResourcesLoaded: discovery.projectResourcesLoaded,
    });
  } catch (error) {
    return errorResponse(describe(error), 500);
  }
}

async function patchSkills(request: LocalRequest): Promise<LocalResponse> {
  let body: unknown;
  try {
    body = JSON.parse(request.body ?? "");
  } catch (error) {
    return errorResponse(describe(error), 400);
  }
  if (!isRecord(body)) return errorResponse("Invalid request body", 400);

  const disableModelInvocation = body.disableModelInvocation;
  const optionalCwd = typeof body.cwd === "string" && body.cwd ? body.cwd : null;

  if (body.filePaths !== undefined) {
    const filePaths = body.filePaths;
    if (
      !Array.isArray(filePaths) ||
      !filePaths.every((item) => typeof item === "string" && item.length > 0)
    ) {
      return errorResponse("filePaths must be a list of paths", 400);
    }
    if (typeof disableModelInvocation !== "boolean") {
      return errorResponse("disableModelInvocation must be a boolean", 400);
    }
    const roots = await writableRoots(optionalCwd);
    const results: { filePath: string; error?: string }[] = [];
    for (const target of new Set(filePaths as string[])) {
      try {
        const refused = await toggleSkillFile(target, disableModelInvocation, roots);
        results.push(refused ? { filePath: target, error: refused.error } : { filePath: target });
      } catch (error) {
        results.push({ filePath: target, error: describe(error) });
      }
    }
    return jsonResponse({ results });
  }

  const filePath = body.filePath;
  if (typeof filePath !== "string" || !filePath) {
    return errorResponse("filePath required", 400);
  }
  if (typeof disableModelInvocation !== "boolean") {
    return errorResponse("disableModelInvocation must be a boolean", 400);
  }
  try {
    const refused = await toggleSkillFile(filePath, disableModelInvocation, await writableRoots(optionalCwd));
    if (refused) return errorResponse(refused.error, refused.status);
    return jsonResponse({ success: true });
  } catch (error) {
    return errorResponse(describe(error), 500);
  }
}

async function readRegularText(target: string): Promise<string | undefined> {
  let info;
  try {
    info = await stat(target);
  } catch {
    return undefined;
  }
  if (!info.isFile() || info.size > SKILL_CONTENT_MAX_BYTES) return undefined;
  try {
    return await readFile(target, "utf8");
  } catch {
    return undefined;
  }
}

async function directSkill(filePath: string): Promise<SkillRecord | null> {
  if (path.extname(filePath).toLowerCase() !== ".md") return null;
  if (!(await pathExists(filePath))) return null;
  const baseDir = path.dirname(filePath);
  const meta: ResourceMeta = {
    source: "local",
    scope: "user",
    origin: "top-level",
    baseDir,
  };
  const result = await loadSkillFile(filePath, meta);
  return result.skill;
}

async function getSkillContent(request: LocalRequest): Promise<LocalResponse> {
  const cwdRaw = request.params.get("cwd");
  const pathQuery = request.params.get("path");
  const filePath = request.params.get("filePath") ?? pathQuery;
  const document = request.params.get("document");
  if (!filePath) return errorResponse("filePath required", 400);
  // The panel always sends cwd + filePath. `path` alone is accepted for a
  // direct skill file; a filePath without cwd keeps the old route's refusal.
  if (!cwdRaw && pathQuery === null) return errorResponse("cwd required", 400);

  try {
    let skill: SkillRecord | null = null;
    if (cwdRaw) {
      const discovery = await discoverSkills(cwdRaw);
      skill = discovery.skills.find((item) => item.filePath === filePath) ?? null;
    } else {
      skill = await directSkill(filePath);
    }
    if (!skill) return errorResponse("Skill not found", 404);

    let target = skill.filePath;
    if (document !== null) {
      const refuse = (status: number, error: string): LocalResponse => errorResponse(error, status);
      // The client sends a normalized path. A `..` after a link names one file
      // to path.join() and realpath, another to the filesystem (#748).
      if (path.isAbsolute(document) || /[\\:\0]/.test(document) || document.split("/").includes("..")) {
        return refuse(400, "Document path must stay inside the skill folder");
      }
      if (!MARKDOWN_FILE.test(document)) return refuse(415, "Only Markdown documents can be opened");
      target = path.join(skill.baseDir, document);
      let info;
      try {
        info = await stat(target);
      } catch {
        return refuse(404, "Skill document not found");
      }

      let realBase: string;
      let realTarget: string;
      try {
        realBase = await resolveExistingPath(skill.baseDir);
        realTarget = await resolveExistingPath(target);
      } catch {
        return refuse(500, "Skill document could not be read");
      }
      if (!isInside(realBase, realTarget)) {
        return refuse(403, "Document is outside the skill folder");
      }
      if (!MARKDOWN_FILE.test(realTarget)) {
        return refuse(415, "Only Markdown documents can be opened");
      }
      if (!info.isFile()) return refuse(400, "Skill document is not a regular file");
      if (info.size > SKILL_CONTENT_MAX_BYTES) return refuse(413, "Skill document is larger than 1 MiB");
    }

    const content = await readRegularText(target);
    if (content === undefined) {
      if (document !== null) return errorResponse("Skill document could not be read", 500);
      return errorResponse("Skill file not found", 404);
    }
    return jsonResponse({ content });
  } catch (error) {
    if (document !== null) return errorResponse("Skill document could not be read", 500);
    return errorResponse(describe(error), 500);
  }
}

export async function handleSkills(request: LocalRequest): Promise<LocalResponse | null> {
  const { segments, method } = request;
  if (segments[0] !== "api" || segments[1] !== "skills") return null;

  if (segments.length === 2) {
    if (method === "GET") return getSkills(request);
    if (method === "PATCH") return patchSkills(request);
    return null;
  }

  if (segments.length === 3 && segments[2] === "content" && method === "GET") {
    return getSkillContent(request);
  }

  if (method === "POST") {
    if (segments[2] === "search") return postSkillSearch(request);
    if (segments[2] === "install") return postSkillInstall(request);
    if (segments[2] === "check") return postSkillCheck(request);
    if (segments[2] === "update") return postSkillUpdate(request);
  }
  return null;
}
