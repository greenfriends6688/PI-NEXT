// Settings › Plugins: the packages this machine's `pi` has configured.
//
// The source of truth is pi's own settings, not the app's copy:
//
//   ~/.pi/agent/settings.json       the user's packages
//   <cwd>/.pi/settings.json         the project's packages, once trusted
//   ~/.pi/agent/packages.lock.json  pi's install metadata (used only as a
//                                   version fallback when a package.json is
//                                   unreadable; the CLI and SettingsManager
//                                   read the settings files)
//   <install path>/package.json     name, version, description and `pi` manifest
//
// A package is listed by `pi list` / `DefaultPackageManager`, and an entry can
// be an object with resource filters. An entry whose four resource lists are
// empty is how `pi config` writes "disabled". This module reproduces that
// small part of pi's package manager (source parsing, install roots, filters
// and conventional resource discovery) so the panel needs neither Node nor the
// old server.
//
// Mutations stay pi's own:
//   install / remove / update  run `pi install|remove|update …` (through the
//                               login shell, so the user's PATH finds pi);
//   enable / disable           edit the same settings array exactly as pi's
//                               SettingsManager does, under the same `.lock`
//                               directory and written with a temp-file rename.
//
// `/api/plugins/check` compares each installed package with npm's `latest`
// (`curl` through the login shell) or with a Git remote's HEAD. It is read
// only: no package is installed or changed by a check. Every other
// `/api/plugins/**` path is still null.
import { mkdir, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import { spawn, type ChildProcess, type ExitResult } from "process";
import { runAsync as run } from "./run-async";
import {
  dataDirectory,
  loginShell,
  loginShellCommand,
  loginShellRun,
  quoteShell,
} from "../pi/install";
import { piExecutable } from "../pi/rpc";
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

// ---------------------------------------------------------------------------
// The wire shapes (`src/api/config.ts`, `lib/api-types.ts`)
// ---------------------------------------------------------------------------

type PluginScope = "global" | "project";
type PluginResourceKind = "extension" | "skill" | "prompt" | "theme";

interface PluginResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

interface PluginResourceInfo {
  kind: PluginResourceKind;
  name: string;
  path: string;
  relativePath: string;
}

interface PluginStandaloneExtensionInfo extends PluginResourceInfo {
  kind: "extension";
  scope: PluginScope;
  enabled: boolean;
}

interface PluginPackageInfo {
  source: string;
  scope: PluginScope;
  canCheckForUpdates: boolean;
  filtered: boolean;
  disabled: boolean;
  installedPath?: string;
  packageName?: string;
  version?: string;
  configuredVersion?: string;
  description?: string;
  counts: PluginResourceCounts;
  resources: PluginResourceInfo[];
  status: "loaded" | "installed" | "missing" | "disabled";
}

interface PluginDiagnostic {
  type: "warning" | "error";
  source?: string;
  message: string;
  path?: string;
}

interface PluginsResponse {
  packages: PluginPackageInfo[];
  standaloneExtensions: PluginStandaloneExtensionInfo[];
  totals: PluginResourceCounts;
  diagnostics: PluginDiagnostic[];
  projectResourcesLoaded: boolean;
}

interface PluginToggleResult {
  source: string;
  scope: PluginScope;
}

interface PluginsBulkResponse extends PluginsResponse {
  results: (PluginToggleResult & { error?: string })[];
}

type PackageEntry = string | Record<string, unknown>;

const RESOURCE_TYPES = [
  { kind: "extension", plural: "extensions" },
  { kind: "skill", plural: "skills" },
  { kind: "prompt", plural: "prompts" },
  { kind: "theme", plural: "themes" },
] as const;

const FILTERED_PACKAGE_ERROR =
  "Has resource filters, which disabling would remove; use the package's own switch";
const PROJECT_UNTRUSTED = "Project resources must be trusted before modifying project plugins";
const PROJECT_UPDATE_UNTRUSTED = "Project resources must be trusted before updating project plugins";

const LIST_TIMEOUT_MS = 20_000;
const PACKAGE_COMMAND_TIMEOUT_MS = 5 * 60_000;
const MAX_SCAN_FILES = 5_000;

function emptyCounts(): PluginResourceCounts {
  return { extensions: 0, skills: 0, prompts: 0, themes: 0 };
}

/** pi's config folder; `PI_CODING_AGENT_DIR` overrides it exactly as pi allows. */
function agentDirectory(): string {
  const configured = process.env.PI_CODING_AGENT_DIR as string | undefined;
  if (configured !== undefined && configured.startsWith("/")) return path.resolve(configured);
  return piAgentDirectory();
}

// ---------------------------------------------------------------------------
// Small JSON/file helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function errorCode(cause: unknown): string | undefined {
  return isRecord(cause) && typeof cause.code === "string" ? cause.code : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripJsonComments(input: string): string {
  return input
    .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match) => {
      if (match[0] === '"') return match;
      return match[1] === "*" ? " " : "";
    })
    .replace(/"(?:\\.|[^"\\])*"|,(\s*[}\]])/g, (match, tail?: string) => (
      tail ?? (match[0] === '"' ? match : "")
    ));
}

function parseSettings(text: string, target: string): Record<string, unknown> {
  const cleaned = stripJsonComments(text.replace(/^\uFEFF/, ""));
  if (cleaned.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (cause) {
    throw new Error(`${target}: ${describe(cause)}`);
  }
  if (!isRecord(parsed)) throw new Error(`${target}: expected a JSON object`);
  return parsed;
}

async function readText(target: string): Promise<string | null> {
  try {
    return await readFile(target, "utf8");
  } catch (cause) {
    if (errorCode(cause) === "ENOENT") return null;
    throw cause;
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

const LOCK_TIMEOUT_MS = 8_000;
const LOCK_STALE_MS = 10_000;

/** The same `<file>.lock` directory pi's proper-lockfile/SettingsManager holds. */
async function withFileLock<T>(target: string, task: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(target), { recursive: true });
  const lock = `${target}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (cause) {
      if (errorCode(cause) !== "EEXIST") throw cause;
      try {
        const info = await stat(lock);
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await rmdir(lock);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${target}`);
      await sleep(30);
    }
  }
  try {
    return await task();
  } finally {
    try {
      await rmdir(lock);
    } catch {
      // Another writer already removed the stale lock.
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
      // The rename consumed it, or it was never created.
    }
    throw cause;
  }
}

function settingsPath(cwd: string | null): string {
  return cwd === null
    ? path.join(agentDirectory(), "settings.json")
    : path.join(cwd, ".pi", "settings.json");
}

/** Read settings for a GET: an unreadable/broken file is a diagnostic, not a failure. */
async function readSettingsForRead(
  target: string,
): Promise<{ settings: Record<string, unknown>; error: string | null }> {
  let text: string | null;
  try {
    text = await readText(target);
  } catch (cause) {
    return { settings: {}, error: `${target}: ${describe(cause)}` };
  }
  if (text === null) return { settings: {}, error: null };
  try {
    return { settings: parseSettings(text, target), error: null };
  } catch (cause) {
    return { settings: {}, error: describe(cause) };
  }
}

/**
 * A locked read-modify-write of one settings file. `mutate` returns whether it
 * changed the document; a parse failure throws with the file path first, so a
 * caller can report it on the affected rows.
 */
async function updatePackageSettings(
  target: string,
  mutate: (settings: Record<string, unknown>) => boolean,
): Promise<void> {
  await withFileLock(target, async () => {
    const before = await readText(target);
    const settings = before === null || before.trim() === "" ? {} : parseSettings(before, target);
    if (mutate(settings)) {
      await writeAtomic(target, JSON.stringify(settings, null, 2));
    }
  });
}

// ---------------------------------------------------------------------------
// Package entries: source, disabled state, filters
// ---------------------------------------------------------------------------

function entrySource(entry: PackageEntry): string | null {
  if (typeof entry === "string") return entry;
  return typeof entry.source === "string" ? entry.source : null;
}

function isDisabledEntry(entry: PackageEntry): boolean {
  if (typeof entry === "string" || !isRecord(entry)) return false;
  return RESOURCE_TYPES.every(({ plural }) => Array.isArray(entry[plural]) && entry[plural].length === 0);
}

/** An object entry that carries something besides a source: filters or `autoload`. */
function hasEntrySettings(entry: PackageEntry): boolean {
  return typeof entry === "object" && !isDisabledEntry(entry);
}

function packageKey(source: string, scope: PluginScope): string {
  return `${scope}\u0000${source}`;
}

/**
 * The exact edit `lib/…`/pi's package manager makes:
 * disable writes all four empty lists; enable removes those lists, keeping
 * `autoload` and any other keys the entry had. A plain string stays a string.
 */
function setPackagesDisabled(
  settings: Record<string, unknown>,
  sources: readonly string[],
  disabled: boolean,
  keepEntrySettings: boolean,
): { missing: Set<string>; kept: Set<string>; changed: boolean } {
  const raw = settings.packages;
  const current = Array.isArray(raw) ? raw as PackageEntry[] : [];
  const wanted = new Set(sources);
  const missing = new Set(sources);
  const kept = new Set<string>();
  let changed = false;

  const next = current.map((entry): PackageEntry => {
    const source = entrySource(entry);
    if (source === null || !wanted.has(source)) return entry;
    missing.delete(source);
    if (isDisabledEntry(entry) === disabled) return entry;
    if (disabled && keepEntrySettings && hasEntrySettings(entry)) {
      kept.add(source);
      return entry;
    }
    changed = true;
    if (disabled) {
      return {
        ...(typeof entry === "string" ? { source: entry } : entry),
        extensions: [],
        skills: [],
        prompts: [],
        themes: [],
      };
    }
    if (typeof entry === "string") return source;
    const rest = { ...entry };
    delete rest.extensions;
    delete rest.skills;
    delete rest.prompts;
    delete rest.themes;
    return Object.keys(rest).length > 1 ? rest : source;
  });

  if (changed) settings.packages = next;
  return { missing, kept, changed };
}

function readScope(value: unknown): PluginScope {
  return value === "project" ? "project" : "global";
}

// ---------------------------------------------------------------------------
// Project trust (pi's trust.json, with the same "fresh folder" rule)
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

function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "windows" ? resolved.toLowerCase() : resolved;
}

function samePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}

async function hasProjectTrustResources(cwd: string): Promise<boolean> {
  const configDir = path.join(cwd, ".pi");
  for (const entry of TRUST_REQUIRING_ENTRIES) {
    if (await pathExists(path.join(configDir, entry))) return true;
  }
  const home = homeDirectory();
  const userSkills = path.join(home, ".agents", "skills");
  let current = path.resolve(cwd);
  for (;;) {
    const skills = path.join(current, ".agents", "skills");
    if (!samePath(skills, userSkills) && await pathExists(skills)) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

interface TrustDecision {
  path: string;
  decision: boolean;
}

async function nearestTrustDecision(cwd: string): Promise<TrustDecision | null> {
  const target = path.join(agentDirectory(), "trust.json");
  const text = await readText(target);
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(`Invalid trust store ${target}`);
  }
  if (!isRecord(parsed)) throw new Error(`Invalid trust store ${target}: expected an object`);
  let current = path.resolve(cwd);
  for (;;) {
    for (const [key, value] of Object.entries(parsed)) {
      if ((value === true || value === false) && samePath(key, current)) {
        return { path: key, decision: value };
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function projectTrust(cwd: string): Promise<{ trusted: boolean; requiresTrust: boolean }> {
  const requiresTrust = await hasProjectTrustResources(cwd);
  let decision: TrustDecision | null = null;
  try {
    decision = await nearestTrustDecision(cwd);
  } catch {
    // pi treats an unreadable store as "untrusted" only for a project that
    // requires trust; a fresh folder still reads as trusted.
    return { trusted: !requiresTrust, requiresTrust };
  }
  if (!requiresTrust) return { trusted: decision?.decision ?? true, requiresTrust };
  return { trusted: decision?.decision === true, requiresTrust };
}

// ---------------------------------------------------------------------------
// Package sources: the paths pi's DefaultPackageManager uses
// ---------------------------------------------------------------------------

type ParsedPackageSource =
  | { kind: "npm"; spec: string; name: string; version?: string }
  | { kind: "git"; host: string; path: string; ref?: string }
  | { kind: "local"; path: string }
  | { kind: "other" };

function parseNpmSpec(spec: string): { name: string; version?: string } {
  const trimmed = spec.trim();
  if (trimmed.startsWith("@")) {
    const slash = trimmed.indexOf("/");
    if (slash < 0) return { name: trimmed };
    const at = trimmed.indexOf("@", slash + 1);
    if (at < 0) return { name: trimmed };
    return { name: trimmed.slice(0, at), version: trimmed.slice(at + 1) || undefined };
  }
  const at = trimmed.indexOf("@");
  if (at < 0) return { name: trimmed };
  return { name: trimmed.slice(0, at), version: trimmed.slice(at + 1) || undefined };
}

function splitGitRef(value: string): { repo: string; ref?: string } {
  if (value.includes("://")) {
    const scheme = /^([a-z][a-z0-9+.-]*:\/\/[^/]+)(\/[^?#]*)?/i.exec(value);
    if (!scheme) return { repo: value };
    const pathPart = (scheme[2] ?? "").replace(/^\/+/, "");
    const at = pathPart.indexOf("@");
    if (at >= 0) {
      const repoPath = pathPart.slice(0, at);
      const ref = pathPart.slice(at + 1);
      if (repoPath !== "" && ref !== "") {
        return { repo: `${scheme[1]}/${repoPath}`.replace(/\/$/, ""), ref };
      }
    }
    return { repo: value };
  }
  const scp = /^([^@/:]+@[^:]+):(.+)$/.exec(value);
  if (scp) {
    const pathPart = scp[2] ?? "";
    const at = pathPart.indexOf("@");
    if (at >= 0) {
      const repoPath = pathPart.slice(0, at);
      const ref = pathPart.slice(at + 1);
      if (repoPath !== "" && ref !== "") {
        return { repo: `${scp[1]}:${repoPath}`, ref };
      }
    }
    return { repo: value };
  }
  const slash = value.indexOf("/");
  if (slash < 0) return { repo: value };
  const host = value.slice(0, slash);
  const pathPart = value.slice(slash + 1);
  const at = pathPart.indexOf("@");
  if (at < 0) return { repo: value };
  const repoPath = pathPart.slice(0, at);
  const ref = pathPart.slice(at + 1);
  if (repoPath === "" || ref === "") return { repo: value };
  return { repo: `${host}/${repoPath}`, ref };
}

function safeGitPart(value: string, allowSlash: boolean): boolean {
  if (value === "" || value.includes("\0") || value.includes("\\") || value.startsWith("/")) return false;
  if (!allowSlash && value.includes("/")) return false;
  return !value.split("/").includes("..");
}

function parseGitSource(source: string): ParsedPackageSource | null {
  const trimmed = source.trim();
  const hasPrefix = trimmed.startsWith("git:");
  const url = hasPrefix ? trimmed.slice(4).trim() : trimmed;
  if (!hasPrefix && !/^(https?|ssh|git):\/\//i.test(url)) return null;

  const split = splitGitRef(url);
  let host = "";
  let repoPath = "";
  if (/^(https?|ssh|git):\/\//i.test(split.repo)) {
    const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.*)$/i.exec(split.repo);
    if (!match) return null;
    host = match[1] ?? "";
    repoPath = match[2] ?? "";
  } else {
    const scp = /^([^@]+@)?([^:]+):(.+)$/.exec(split.repo);
    if (scp) {
      host = scp[2] ?? "";
      repoPath = scp[3] ?? "";
    } else {
      const slash = split.repo.indexOf("/");
      if (slash < 0) return null;
      host = split.repo.slice(0, slash);
      repoPath = split.repo.slice(slash + 1);
      if (!host.includes(".") && host !== "localhost") return null;
    }
  }

  repoPath = repoPath.replace(/^\/+/, "").replace(/\.git$/, "");
  if (!safeGitPart(host, false) || !safeGitPart(repoPath, true)) return null;
  if (repoPath.split("/").filter(Boolean).length < 2) return null;
  return {
    kind: "git",
    host,
    path: repoPath.split("/").filter(Boolean).join("/"),
    ...(split.ref !== undefined ? { ref: split.ref } : {}),
  };
}

function isLocalSource(source: string): boolean {
  const trimmed = source.trim();
  if (
    trimmed.startsWith("npm:") ||
    trimmed.startsWith("git:") ||
    trimmed.startsWith("github:") ||
    trimmed.startsWith("http:") ||
    trimmed.startsWith("https:") ||
    trimmed.startsWith("ssh:") ||
    trimmed.startsWith("builtin:")
  ) {
    return false;
  }
  return true;
}

function parsePackageSource(source: string): ParsedPackageSource {
  if (source.startsWith("npm:")) {
    const spec = source.slice(4).trim();
    const parsed = parseNpmSpec(spec);
    return { kind: "npm", spec, name: parsed.name, ...(parsed.version !== undefined ? { version: parsed.version } : {}) };
  }
  if (isLocalSource(source)) return { kind: "local", path: source };
  const git = parseGitSource(source);
  if (git !== null) return git;
  return { kind: "other" };
}

function expandHome(value: string): string {
  if (value === "~") return homeDirectory();
  if (value.startsWith("~/")) return path.join(homeDirectory(), value.slice(2));
  return value;
}

function resolveFromBase(value: string, base: string): string {
  const expanded = expandHome(value);
  return path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(base, expanded);
}

function managedPath(root: string, ...parts: string[]): string | null {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...parts);
  return isInside(resolvedRoot, target) ? target : null;
}

function isExactVersion(value: string | undefined): boolean {
  if (value === undefined) return false;
  return /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function canCheckForUpdates(source: string): boolean {
  if (source.startsWith("npm:")) {
    return !isExactVersion(parseNpmSpec(source.slice(4)).version);
  }
  if (source.startsWith("git:") || /^(https?|ssh|git):\/\//i.test(source)) {
    const git = parseGitSource(source);
    return git?.kind === "git" && git.ref === undefined;
  }
  return false;
}

function configuredVersion(source: string): string | undefined {
  if (source.startsWith("npm:")) {
    return parseNpmSpec(source.slice(4)).version;
  }
  if (source.startsWith("git:") || /^[a-z]+:\/\//.test(source)) {
    const lastAt = source.lastIndexOf("@");
    const lastSlash = source.lastIndexOf("/");
    const lastColon = source.lastIndexOf(":");
    if (lastAt > Math.max(lastSlash, lastColon)) return source.slice(lastAt + 1) || undefined;
  }
  return undefined;
}

function packageRootFor(scope: PluginScope, cwd: string, kind: "npm" | "git"): string {
  return scope === "project"
    ? path.join(cwd, ".pi", kind)
    : path.join(agentDirectory(), kind);
}

async function installedPathFor(
  source: string,
  scope: PluginScope,
  cwd: string,
): Promise<string | undefined> {
  const parsed = parsePackageSource(source);
  let candidate: string | null = null;
  if (parsed.kind === "npm") {
    candidate = managedPath(packageRootFor(scope, cwd, "npm"), "node_modules", parsed.name);
  } else if (parsed.kind === "git") {
    candidate = managedPath(packageRootFor(scope, cwd, "git"), parsed.host, parsed.path);
  } else if (parsed.kind === "local") {
    const base = scope === "project" ? path.join(cwd, ".pi") : agentDirectory();
    candidate = resolveFromBase(parsed.path, base);
  }
  if (candidate === null) return undefined;
  return await pathExists(candidate) ? candidate : undefined;
}

// ---------------------------------------------------------------------------
// Installed package metadata + pi's package lock
// ---------------------------------------------------------------------------

interface InstalledPackage {
  /** The package.json contents, when it could be read. */
  data: Record<string, unknown> | null;
  /** True for a local source that names an extension file rather than a folder. */
  isFile: boolean;
}

async function readInstalledPackage(installedPath: string | undefined): Promise<InstalledPackage> {
  if (installedPath === undefined) return { data: null, isFile: false };
  let isFile = false;
  try {
    isFile = !(await stat(installedPath)).isDirectory();
  } catch {
    return { data: null, isFile: false };
  }
  const packageJson = isFile
    ? path.join(path.dirname(installedPath), "package.json")
    : path.join(installedPath, "package.json");
  try {
    const text = await readFile(packageJson, "utf8");
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
    return { data: isRecord(parsed) ? parsed : null, isFile };
  } catch {
    return { data: null, isFile };
  }
}

function packageMetadata(data: Record<string, unknown> | null): {
  packageName?: string;
  version?: string;
  description?: string;
} {
  if (data === null) return {};
  return {
    ...(typeof data.name === "string" ? { packageName: data.name } : {}),
    ...(typeof data.version === "string" ? { version: data.version } : {}),
    ...(typeof data.description === "string" ? { description: data.description } : {}),
  };
}

/** `packages.lock.json`'s installed versions, keyed by source and identity. */
async function readLockVersions(): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  const target = path.join(agentDirectory(), "packages.lock.json");
  try {
    const parsed: unknown = JSON.parse((await readFile(target, "utf8")).replace(/^\uFEFF/, ""));
    if (!isRecord(parsed) || !Array.isArray(parsed.entries)) return versions;
    for (const entry of parsed.entries) {
      if (!isRecord(entry) || !isRecord(entry.resolved)) continue;
      const version = entry.resolved.installed_version;
      if (typeof version !== "string") continue;
      for (const key of [entry.source, entry.identity]) {
        if (typeof key === "string") versions.set(key, version);
      }
    }
  } catch {
    // No lock file, or an unreadable one: package.json remains the source.
  }
  return versions;
}

/**
 * `pi list` as a fallback for install paths this module cannot derive (a
 * legacy global npm root, for example). It is read-only and only asked for
 * when a configured path is missing.
 */
async function readPiListPaths(): Promise<Map<string, string>> {
  const paths = new Map<string, string>();
  if (loginShell() === null) return paths;
  let stdout: string;
  try {
    const result = await loginShellCommand("pi list", LIST_TIMEOUT_MS);
    if (result.code !== 0) return paths;
    stdout = result.stdout;
  } catch {
    return paths;
  }
  let scope: PluginScope = "global";
  let source: string | null = null;
  const stripAnsi = (line: string): string => line.replace(/\u001b\[[0-9;]*m/g, "");
  for (const raw of stdout.split(/\r?\n/)) {
    const line = stripAnsi(raw);
    if (line.trim() === "User packages:") {
      scope = "global";
      source = null;
      continue;
    }
    if (line.trim() === "Project packages:") {
      scope = "project";
      source = null;
      continue;
    }
    const packageLine = /^ {2}(\S.*)$/.exec(line);
    if (packageLine && !/^ {4}/.test(line)) {
      source = (packageLine[1] ?? "").replace(/ \(filtered\)$/, "").trim();
      continue;
    }
    const pathLine = /^ {4}(\/.*)$/.exec(line);
    if (pathLine && source !== null) {
      paths.set(packageKey(source, scope), (pathLine[1] ?? "").trim());
      source = null;
    }
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Package resources: pi's manifest/convention rules, without the SDK
// ---------------------------------------------------------------------------

type ResourceManifest = Partial<Record<(typeof RESOURCE_TYPES)[number]["plural"], string[]>>;

function manifestOf(data: Record<string, unknown> | null): ResourceManifest | null {
  if (data === null || !isRecord(data.pi)) return null;
  const manifest: ResourceManifest = {};
  for (const { plural } of RESOURCE_TYPES) {
    const value = data.pi[plural];
    if (isStringArray(value)) manifest[plural] = value;
  }
  return manifest;
}

function manifestHasResources(manifest: ResourceManifest | null): boolean {
  return manifest !== null && Object.keys(manifest).length > 0;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

/** nsh types `path.relative` as unknown; it is Node's function at runtime. */
function relativePathOf(from: string, to: string): string {
  return (path.relative as (from: string, to: string) => string)(from, to);
}

function relativePath(baseDir: string, target: string): string {
  const relative = relativePathOf(baseDir, target);
  if (relative !== "" && !relative.startsWith("..")) return toPosix(relative);
  return target;
}

function resourceName(target: string, kind: PluginResourceKind): string {
  const file = path.basename(target);
  const ext = path.extname(file);
  if (kind === "skill" && file.toLowerCase() === "skill.md") return path.basename(path.dirname(target));
  if (kind === "extension" && /^index\.(ts|js)$/.test(file)) return path.basename(path.dirname(target));
  if (ext !== "") return file.slice(0, -ext.length);
  return file;
}

function resourceInfo(target: string, kind: PluginResourceKind, baseDir: string): PluginResourceInfo {
  return {
    kind,
    name: resourceName(target, kind),
    path: target,
    relativePath: relativePath(baseDir, target),
  };
}

async function listEntries(directory: string) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function resolveExtensionEntries(directory: string): Promise<string[]> {
  const packageJson = path.join(directory, "package.json");
  try {
    const parsed: unknown = JSON.parse((await readFile(packageJson, "utf8")).replace(/^\uFEFF/, ""));
    const manifest = manifestOf(isRecord(parsed) ? parsed : null);
    const entries = manifest?.extensions;
    if (entries !== undefined && entries.length > 0) {
      const found: string[] = [];
      for (const entry of entries) {
        const resolved = path.resolve(directory, entry);
        if (await pathExists(resolved)) found.push(resolved);
      }
      if (found.length > 0) return found;
    }
  } catch {
    // No package.json here; index.ts/index.js still decide.
  }
  const indexTs = path.join(directory, "index.ts");
  if (await pathExists(indexTs)) return [indexTs];
  const indexJs = path.join(directory, "index.js");
  if (await pathExists(indexJs)) return [indexJs];
  return [];
}

async function autoExtensionEntries(directory: string): Promise<string[]> {
  const rootEntries = await resolveExtensionEntries(directory);
  if (rootEntries.length > 0) return rootEntries;
  const files: string[] = [];
  for (const entry of await listEntries(directory)) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await resolveExtensionEntries(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function collectSkillEntries(directory: string, isRoot = true): Promise<string[]> {
  const entries = await listEntries(directory);
  for (const entry of entries) {
    if (entry.name !== "SKILL.md") continue;
    const fullPath = path.join(directory, entry.name);
    try {
      if ((await stat(fullPath)).isFile()) return [fullPath];
    } catch {
      // A dangling link is not a skill.
    }
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSkillEntries(fullPath, false));
    } else if (isRoot && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function collectFiles(directory: string, extension: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await listEntries(directory)) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath, extension));
    } else if (entry.name.endsWith(extension)) {
      files.push(fullPath);
    }
  }
  return files;
}

async function collectResourceFiles(
  directory: string,
  kind: PluginResourceKind,
): Promise<string[]> {
  if (kind === "extension") return autoExtensionEntries(directory);
  if (kind === "skill") return collectSkillEntries(directory);
  if (kind === "prompt") return collectFiles(directory, ".md");
  return collectFiles(directory, ".json");
}

async function allFilesUnder(directory: string, root = directory, seen: string[] = []): Promise<string[]> {
  if (seen.length >= MAX_SCAN_FILES) return seen;
  for (const entry of await listEntries(directory)) {
    if (seen.length >= MAX_SCAN_FILES) break;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await allFilesUnder(fullPath, root, seen);
    } else {
      seen.push(fullPath);
    }
  }
  return seen;
}

function globRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  let source = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index] as string;
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        if (normalized[index + 2] === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else {
        source += "[^/]*";
      }
    } else if (character === "?") {
      source += "[^/]";
    } else {
      source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  source += "$";
  return new RegExp(source);
}

function matchesPattern(filePath: string, pattern: string, baseDir: string): boolean {
  const normalized = pattern.replace(/^\.\//, "");
  const matcher = globRegExp(normalized);
  const relative = toPosix(relativePathOf(baseDir, filePath));
  const name = path.basename(filePath);
  const absolute = toPosix(filePath);
  if (matcher.test(relative) || matcher.test(name) || matcher.test(absolute)) return true;
  if (name === "SKILL.md") {
    const parent = path.dirname(filePath);
    const parentRelative = toPosix(relativePathOf(baseDir, parent));
    const parentName = path.basename(parent);
    const parentAbsolute = toPosix(parent);
    return matcher.test(parentRelative) || matcher.test(parentName) || matcher.test(parentAbsolute);
  }
  return false;
}

function matchesExact(filePath: string, pattern: string, baseDir: string): boolean {
  const normalized = pattern.replace(/^\.\//, "").split(path.sep).join("/");
  const relative = toPosix(relativePathOf(baseDir, filePath));
  const absolute = toPosix(filePath);
  if (normalized === relative || normalized === absolute) return true;
  if (path.basename(filePath) === "SKILL.md") {
    const parent = path.dirname(filePath);
    return normalized === toPosix(relativePathOf(baseDir, parent)) || normalized === toPosix(parent);
  }
  return false;
}

/** pi's `applyPatterns`: plain includes, `!` excludes, `+`/`-` exact overrides. */
function applyPatterns(allPaths: readonly string[], patterns: readonly string[], baseDir: string): Set<string> {
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
    : allPaths.filter((filePath) => includes.some((pattern) => matchesPattern(filePath, pattern, baseDir)));
  if (excludes.length > 0) {
    result = result.filter((filePath) => !excludes.some((pattern) => matchesPattern(filePath, pattern, baseDir)));
  }
  if (forceIncludes.length > 0) {
    for (const filePath of allPaths) {
      if (!result.includes(filePath) && forceIncludes.some((pattern) => matchesExact(filePath, pattern, baseDir))) {
        result.push(filePath);
      }
    }
  }
  if (forceExcludes.length > 0) {
    result = result.filter((filePath) => !forceExcludes.some((pattern) => matchesExact(filePath, pattern, baseDir)));
  }
  return new Set(result);
}

function applyDeltaPatterns(
  allPaths: readonly string[],
  patterns: readonly string[],
  baseDir: string,
): Set<string> {
  const result = new Set<string>();
  for (const pattern of patterns) {
    const exact = pattern.startsWith("+") || pattern.startsWith("-");
    const exclude = pattern.startsWith("-") || pattern.startsWith("!");
    const target = pattern.slice(exact || exclude ? 1 : 0);
    for (const filePath of allPaths) {
      const matches = exact
        ? matchesExact(filePath, target, baseDir)
        : matchesPattern(filePath, target, baseDir);
      if (matches && !exclude) result.add(filePath);
      if (matches && exclude) result.delete(filePath);
    }
  }
  return result;
}

function isOverride(pattern: string): boolean {
  return pattern.startsWith("!") || pattern.startsWith("+") || pattern.startsWith("-");
}

async function collectManifestEntries(
  entries: readonly string[],
  root: string,
  kind: PluginResourceKind,
): Promise<string[]> {
  const allFiles: string[] = [];
  const add = (file: string): void => {
    if (!allFiles.includes(file)) allFiles.push(file);
  };

  for (const entry of entries.filter((value) => !isOverride(value))) {
    if (entry.includes("*") || entry.includes("?")) {
      const matcher = globRegExp(entry);
      for (const file of await allFilesUnder(root)) {
        const relative = toPosix(relativePathOf(root, file));
        if (matcher.test(relative)) add(file);
      }
      continue;
    }
    const resolved = path.resolve(root, entry);
    if (!(await pathExists(resolved))) continue;
    try {
      if ((await stat(resolved)).isDirectory()) {
        for (const file of await collectResourceFiles(resolved, kind)) add(file);
      } else {
        add(resolved);
      }
    } catch {
      // A path that disappeared while reading is simply not a resource.
    }
  }

  const overrides = entries.filter(isOverride);
  if (overrides.length === 0) return allFiles;
  return [...applyPatterns(allFiles, overrides, root)];
}

/**
 * pi's `collectManifestFiles`: a resource type's manifest entries decide when
 * present, otherwise its conventional directory does. Used for filtered
 * packages, where the user's patterns narrow the manifest's own selection.
 */
async function collectManifestFiles(
  root: string,
  kind: PluginResourceKind,
  plural: string,
  manifest: ResourceManifest | null,
): Promise<string[]> {
  const entries = manifest?.[plural as keyof ResourceManifest];
  if (entries !== undefined && entries.length > 0) {
    return collectManifestEntries(entries, root, kind);
  }
  const directory = path.join(root, plural);
  if (!(await pathExists(directory))) return [];
  return collectResourceFiles(directory, kind);
}

/** Unfiltered discovery: a manifest with any resource field replaces convention. */
async function collectDefaultResources(
  root: string,
  kind: PluginResourceKind,
  plural: string,
  manifest: ResourceManifest | null,
): Promise<string[]> {
  if (manifestHasResources(manifest)) {
    const entries = manifest?.[plural as keyof ResourceManifest];
    if (entries === undefined) return [];
    return collectManifestEntries(entries, root, kind);
  }
  const directory = path.join(root, plural);
  if (!(await pathExists(directory))) return [];
  return collectResourceFiles(directory, kind);
}

async function packageResources(
  installedPath: string,
  installed: InstalledPackage,
  entry: PackageEntry,
): Promise<PluginResourceInfo[]> {
  const filter = typeof entry === "object" ? entry : null;
  const root = installed.isFile ? path.dirname(installedPath) : installedPath;
  if (installed.isFile) {
    return [resourceInfo(installedPath, "extension", root)];
  }
  const manifest = manifestOf(installed.data);
  const resources: PluginResourceInfo[] = [];
  for (const { kind, plural } of RESOURCE_TYPES) {
    let files: string[];
    const userPatterns = filter !== null ? filter[plural] : undefined;
    if (filter !== null && userPatterns !== undefined) {
      if (!isStringArray(userPatterns)) {
        files = [];
      } else if (userPatterns.length === 0) {
        files = [];
      } else {
        const candidates = await collectManifestFiles(root, kind, plural, manifest);
        if (filter.autoload === false) {
          const enabled = applyDeltaPatterns(candidates, userPatterns, root);
          files = candidates.filter((file) => enabled.has(file));
        } else {
          files = [...applyPatterns(candidates, userPatterns, root)];
        }
      }
    } else if (filter !== null && filter.autoload === false) {
      // A project delta with no patterns adds nothing; the base user entry
      // already contributes its resources.
      files = [];
    } else {
      files = await collectDefaultResources(root, kind, plural, manifest);
    }
    for (const file of files) {
      if (!resources.some((resource) => resource.path === file)) {
        resources.push(resourceInfo(file, kind, root));
      }
    }
  }
  return resources;
}

// ---------------------------------------------------------------------------
// Standalone extensions (settings `extensions` + the agent/project folders)
// ---------------------------------------------------------------------------

function extensionOverrides(settings: Record<string, unknown>): string[] {
  return isStringArray(settings.extensions) ? settings.extensions : [];
}

function isEnabledByOverrides(filePath: string, overrides: readonly string[], baseDir: string): boolean {
  const list = overrides.filter(isOverride);
  const excludes = list.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
  const forceIncludes = list.filter((pattern) => pattern.startsWith("+")).map((pattern) => pattern.slice(1));
  const forceExcludes = list.filter((pattern) => pattern.startsWith("-")).map((pattern) => pattern.slice(1));
  let enabled = true;
  if (excludes.length > 0 && excludes.some((pattern) => matchesPattern(filePath, pattern, baseDir))) enabled = false;
  if (forceIncludes.length > 0 && forceIncludes.some((pattern) => matchesExact(filePath, pattern, baseDir))) enabled = true;
  if (forceExcludes.length > 0 && forceExcludes.some((pattern) => matchesExact(filePath, pattern, baseDir))) enabled = false;
  return enabled;
}

async function addStandaloneDirectory(
  map: Map<string, PluginStandaloneExtensionInfo>,
  settings: Record<string, unknown>,
  baseDir: string,
  scope: PluginScope,
): Promise<void> {
  const directory = path.join(baseDir, "extensions");
  const overrides = extensionOverrides(settings);
  for (const file of await autoExtensionEntries(directory)) {
    if (map.has(file)) continue;
    map.set(file, {
      ...resourceInfo(file, "extension", baseDir),
      kind: "extension",
      scope,
      enabled: isEnabledByOverrides(file, overrides, baseDir),
    });
  }
}

async function addStandaloneConfigured(
  map: Map<string, PluginStandaloneExtensionInfo>,
  settings: Record<string, unknown>,
  baseDir: string,
  scope: PluginScope,
): Promise<void> {
  const entries = extensionOverrides(settings);
  if (entries.length === 0) return;
  const plain = entries.filter((entry) => !entry.startsWith("!") && !entry.startsWith("+") && !entry.startsWith("-") && !entry.includes("*") && !entry.includes("?"));
  const patterns = entries.filter((entry) => !plain.includes(entry));
  const files: string[] = [];
  for (const entry of plain) {
    const resolved = resolveFromBase(entry, baseDir);
    if (!(await pathExists(resolved))) continue;
    try {
      if ((await stat(resolved)).isDirectory()) {
        files.push(...await autoExtensionEntries(resolved));
      } else {
        files.push(resolved);
      }
    } catch {
      // Ignore an entry that vanished.
    }
  }
  const enabled = applyPatterns(files, patterns, baseDir);
  for (const file of files) {
    if (map.has(file)) continue;
    map.set(file, {
      ...resourceInfo(file, "extension", baseDir),
      kind: "extension",
      scope,
      enabled: enabled.has(file),
    });
  }
}

async function standaloneExtensions(
  cwd: string,
  globalSettings: Record<string, unknown>,
  projectSettings: Record<string, unknown>,
  trusted: boolean,
): Promise<PluginStandaloneExtensionInfo[]> {
  const map = new Map<string, PluginStandaloneExtensionInfo>();
  await addStandaloneDirectory(map, globalSettings, agentDirectory(), "global");
  await addStandaloneConfigured(map, globalSettings, agentDirectory(), "global");
  if (trusted) {
    const projectBase = path.join(cwd, ".pi");
    await addStandaloneDirectory(map, projectSettings, projectBase, "project");
    await addStandaloneConfigured(map, projectSettings, projectBase, "project");
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// GET /api/plugins
// ---------------------------------------------------------------------------

interface ConfiguredPackage {
  source: string;
  scope: PluginScope;
  entry: PackageEntry;
}

function configuredPackages(
  settings: Record<string, unknown>,
  scope: PluginScope,
  diagnostics: PluginDiagnostic[],
): ConfiguredPackage[] {
  const raw = settings.packages;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    diagnostics.push({
      type: "warning",
      message: "settings packages must be an array; it was ignored.",
    });
    return [];
  }
  const packages: ConfiguredPackage[] = [];
  for (const entry of raw as PackageEntry[]) {
    const source = entrySource(entry);
    if (source === null || source.trim() === "") {
      diagnostics.push({ type: "warning", message: "A configured package has no source; it was skipped." });
      continue;
    }
    packages.push({ source, scope, entry });
  }
  return packages;
}

function addCounts(counts: PluginResourceCounts, resources: readonly PluginResourceInfo[]): void {
  for (const resource of resources) {
    if (resource.kind === "extension") counts.extensions += 1;
    else if (resource.kind === "skill") counts.skills += 1;
    else if (resource.kind === "prompt") counts.prompts += 1;
    else counts.themes += 1;
  }
}

async function readPlugins(cwd: string): Promise<PluginsResponse> {
  const diagnostics: PluginDiagnostic[] = [];
  const globalPath = settingsPath(null);
  const globalRead = await readSettingsForRead(globalPath);
  if (globalRead.error !== null) {
    diagnostics.push({ type: "error", message: globalRead.error, path: globalPath });
  }

  const trust = await projectTrust(cwd);
  const projectPath = settingsPath(cwd);
  const projectRead = trust.trusted
    ? await readSettingsForRead(projectPath)
    : { settings: {}, error: null };
  if (projectRead.error !== null) {
    diagnostics.push({ type: "error", message: projectRead.error, path: projectPath });
  }

  const configured = [
    ...configuredPackages(globalRead.settings, "global", diagnostics),
    ...configuredPackages(projectRead.settings, "project", diagnostics),
  ];
  const lockVersions = await readLockVersions();
  const totals = emptyCounts();
  const packages: PluginPackageInfo[] = [];
  let listPaths: Map<string, string> | null = null;

  for (const pkg of configured) {
    let installedPath = await installedPathFor(pkg.source, pkg.scope, cwd);
    if (installedPath === undefined) {
      listPaths ??= await readPiListPaths();
      const fallback = listPaths.get(packageKey(pkg.source, pkg.scope));
      if (fallback !== undefined && await pathExists(fallback)) installedPath = fallback;
    }

    const installed = await readInstalledPackage(installedPath);
    const metadata = packageMetadata(installed.data);
    const disabled = isDisabledEntry(pkg.entry);
    let resources: PluginResourceInfo[] = [];
    if (installedPath !== undefined) {
      try {
        resources = await packageResources(installedPath, installed, pkg.entry);
      } catch (cause) {
        diagnostics.push({
          type: "error",
          source: pkg.source,
          message: `Could not read package resources: ${describe(cause)}`,
        });
      }
    } else {
      diagnostics.push({
        type: "warning",
        source: pkg.source,
        message: "Configured package path was not found.",
      });
    }

    const counts = emptyCounts();
    addCounts(counts, resources);
    addCounts(totals, resources);
    const resourceCount = counts.extensions + counts.skills + counts.prompts + counts.themes;
    packages.push({
      source: pkg.source,
      scope: pkg.scope,
      canCheckForUpdates: canCheckForUpdates(pkg.source),
      filtered: typeof pkg.entry === "object",
      disabled,
      ...(installedPath !== undefined ? { installedPath } : {}),
      ...(metadata.packageName !== undefined ? { packageName: metadata.packageName } : {}),
      ...((metadata.version ?? lockVersions.get(pkg.source)) !== undefined
        ? { version: metadata.version ?? lockVersions.get(pkg.source) }
        : {}),
      ...(configuredVersion(pkg.source) !== undefined
        ? { configuredVersion: configuredVersion(pkg.source) }
        : {}),
      ...(metadata.description !== undefined ? { description: metadata.description } : {}),
      counts,
      resources,
      status: disabled ? "disabled" : resourceCount > 0 ? "loaded" : installedPath !== undefined ? "installed" : "missing",
    });
  }

  const extensions = await standaloneExtensions(cwd, globalRead.settings, projectRead.settings, trust.trusted);
  for (const extension of extensions) {
    if (extension.enabled) totals.extensions += 1;
  }

  return {
    packages,
    standaloneExtensions: extensions,
    totals,
    diagnostics,
    projectResourcesLoaded: trust.trusted,
  };
}

// ---------------------------------------------------------------------------
// POST /api/plugins: settings toggles
// ---------------------------------------------------------------------------

function readPackageList(value: unknown): (PluginToggleResult & { error?: string })[] | null {
  if (!Array.isArray(value)) return null;
  const packages = new Map<string, PluginToggleResult>();
  for (const item of value) {
    if (!isRecord(item) || typeof item.source !== "string" || item.source.trim() === "") return null;
    const pkg = { source: item.source.trim(), scope: readScope(item.scope) };
    packages.set(packageKey(pkg.source, pkg.scope), pkg);
  }
  return [...packages.values()];
}

async function setPackageListDisabled(
  cwd: string,
  packages: readonly PluginToggleResult[],
  disabled: boolean,
  projectTrusted: boolean,
): Promise<(PluginToggleResult & { error?: string })[]> {
  const errors = new Map<string, string>();
  for (const scope of ["global", "project"] as const) {
    const subset = packages.filter((pkg) => pkg.scope === scope);
    if (subset.length === 0) continue;
    if (scope === "project" && !projectTrusted) {
      for (const pkg of subset) errors.set(packageKey(pkg.source, scope), PROJECT_UNTRUSTED);
      continue;
    }
    const target = settingsPath(scope === "global" ? null : cwd);
    const sources = subset.map((pkg) => pkg.source);
    let outcome: { missing: Set<string>; kept: Set<string>; changed: boolean };
    try {
      outcome = await withFileLock(target, async () => {
        const before = await readText(target);
        const settings = before === null || before.trim() === "" ? {} : parseSettings(before, target);
        const result = setPackagesDisabled(settings, sources, disabled, true);
        if (result.changed) await writeAtomic(target, JSON.stringify(settings, null, 2));
        return result;
      });
    } catch (cause) {
      const message = describe(cause);
      for (const pkg of subset) errors.set(packageKey(pkg.source, scope), message);
      continue;
    }
    for (const source of outcome.missing) errors.set(packageKey(source, scope), "Package is not configured");
    for (const source of outcome.kept) errors.set(packageKey(source, scope), FILTERED_PACKAGE_ERROR);
  }
  return packages.map((pkg) => {
    const error = errors.get(packageKey(pkg.source, pkg.scope));
    return error === undefined ? { ...pkg } : { ...pkg, error };
  });
}

// ---------------------------------------------------------------------------
// POST /api/plugins: pi's own install/remove/update commands
// ---------------------------------------------------------------------------

interface PiRun {
  code: number | null;
  signal: string | null;
  error: string | null;
  lines: string[];
}

function lastNonEmptyLine(lines: readonly string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim() ?? "";
    if (line !== "") return line;
  }
  return null;
}

async function runPi(
  args: readonly string[],
  cwd: string | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<PiRun> {
  const executable = await piExecutable();
  const shell = loginShell();
  if (shell === null) throw new Error("this platform has no login shell");
  const script = ["exec", quoteShell(executable), ...args.map(quoteShell)].join(" ");

  return new Promise<PiRun>((resolve, reject) => {
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
      if (signal !== undefined) signal.removeEventListener("abort", abort);
      resolve({
        code: result.code ?? null,
        signal: result.signal ?? null,
        error: result.error ?? null,
        lines,
      });
    };
    const abort = (): void => {
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    };
    child.on("stdout", (line) => lines.push(line));
    child.on("stderr", (line) => lines.push(line));
    child.on("exit", (result) => finish(result));
    if (signal !== undefined) {
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort);
    }
  });
}

async function commandCwd(scope: PluginScope, cwd: string): Promise<string | undefined> {
  if (scope === "global") return await dataDirectory();
  try {
    if (!(await stat(cwd)).isDirectory()) throw new Error(`Project folder is not a directory: ${cwd}`);
  } catch (cause) {
    throw new Error(`Project folder is not available: ${describe(cause)}`);
  }
  return cwd;
}

async function runPackageCommand(
  action: "install" | "remove" | "update",
  source: string | undefined,
  scope: PluginScope,
  cwd: string,
  trusted: boolean,
  signal?: AbortSignal,
): Promise<LocalResponse> {
  const args: string[] = [action === "install" ? "install" : action === "remove" ? "remove" : "update"];
  if (action === "update") {
    if (source !== undefined && source !== "") args.push(source);
    else args.push("--extensions");
  } else {
    if (source === undefined || source === "") return errorResponse("source required", 400);
    args.push(source);
    if (scope === "project") args.push("--local");
  }

  const runCwd = action === "update"
    ? (trusted ? cwd : await dataDirectory())
    : await commandCwd(scope, cwd);
  const result = await runPi(args, runCwd, PACKAGE_COMMAND_TIMEOUT_MS, signal);
  if (result.code !== 0 || result.error !== null) {
    const last = lastNonEmptyLine(result.lines);
    const why = result.error ?? (result.code !== null ? `exit ${result.code}` : result.signal ?? "stopped");
    return errorResponse(last ?? `pi ${args[0]} failed (${why})`, 500);
  }
  return jsonResponse(await readPlugins(cwd));
}

// ---------------------------------------------------------------------------
// POST /api/plugins/check: installed version vs npm's `latest`
//
// `curl` resolves through the login shell (the runtime grants neither `curl`
// nor `npm` directly), one request per package. Git sources are compared by
// their remote HEAD when pi installed them without a pinned ref; a pinned or
// local package is `unsupported`, as before. The answer is the `updates` list
// `src/api/config.ts` reads, keyed by source and scope on the screen.
// ---------------------------------------------------------------------------

interface PluginUpdateResult {
  source: string;
  scope: PluginScope;
  displayName: string;
  type: "npm" | "git";
  state: "update-available" | "up-to-date" | "unsupported" | "error";
  message?: string;
}

interface SemverParts {
  main: [number, number, number];
  prerelease: string[];
}

function parseSemver(value: string): SemverParts | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (match === null) return null;
  return {
    main: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  // A release is newer than any prerelease of the same version.
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const aNumber = /^\d+$/.test(a);
    const bNumber = /^\d+$/.test(b);
    if (aNumber && bNumber) {
      const difference = Number(a) - Number(b);
      if (difference !== 0) return difference < 0 ? -1 : 1;
    } else if (aNumber !== bNumber) {
      return aNumber ? -1 : 1;
    } else if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return 0;
}

function compareSemver(left: string, right: string): number {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (a === null || b === null) throw new Error("Installed or remote version is not a semantic version.");
  for (let index = 0; index < 3; index += 1) {
    const difference = a.main[index] - b.main[index];
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

function pluginUpdateResult(
  pkg: PluginPackageInfo,
  state: PluginUpdateResult["state"],
  message?: string,
): PluginUpdateResult {
  const parsed = parsePackageSource(pkg.source);
  return {
    source: pkg.source,
    scope: pkg.scope,
    displayName: parsed.kind === "npm" ? parsed.name : pkg.source,
    type: parsed.kind === "npm" ? "npm" : "git",
    state,
    ...(message !== undefined ? { message } : {}),
  };
}

function pluginsOffline(): boolean {
  return /^(1|true|yes)$/i.test(process.env.PI_OFFLINE ?? "");
}

async function installedNpmVersion(installedPath: string): Promise<string> {
  const text = await readFile(path.join(installedPath, "package.json"), "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("Installed package version is unavailable.");
  }
  if (!isRecord(parsed) || typeof parsed.version !== "string" || parseSemver(parsed.version) === null) {
    throw new Error("Installed package version is unavailable.");
  }
  return parsed.version;
}

async function latestNpmVersion(name: string): Promise<string> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`;
  const text = await loginShellRun(`curl -fsSL --max-time 15 ${quoteShell(url)}`, 20_000);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Unexpected response from npm view.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("Unexpected response from npm view.");
  }
  if (!isRecord(parsed) || typeof parsed.version !== "string" || parseSemver(parsed.version) === null) {
    throw new Error("Unexpected response from npm view.");
  }
  return parsed.version;
}

async function checkNpmPackageUpdate(pkg: PluginPackageInfo): Promise<PluginUpdateResult> {
  const parsed = parsePackageSource(pkg.source);
  if (parsed.kind !== "npm" || parsed.name === "") return pluginUpdateResult(pkg, "unsupported");
  if (pkg.installedPath === undefined || !(await pathExists(pkg.installedPath))) {
    return pluginUpdateResult(pkg, "error", "Package is not installed.");
  }
  const current = await installedNpmVersion(pkg.installedPath);
  const latest = await latestNpmVersion(parsed.name);
  return pluginUpdateResult(pkg, compareSemver(latest, current) > 0 ? "update-available" : "up-to-date");
}

async function checkGitPackageUpdate(pkg: PluginPackageInfo): Promise<PluginUpdateResult> {
  if (pkg.installedPath === undefined || !(await pathExists(pkg.installedPath))) {
    return pluginUpdateResult(pkg, "error", "Package is not installed.");
  }
  const options = { cwd: pkg.installedPath, timeoutMs: 20_000 };
  const local = (await run("git", ["rev-parse", "HEAD"], options)).stdout.trim();
  const upstream = await run("git", ["rev-parse", "--abbrev-ref", "@{upstream}"], options)
    .then((output) => output.stdout.trim())
    .catch(() => "");
  const ref = upstream.startsWith("origin/")
    ? `refs/heads/${upstream.slice("origin/".length)}`
    : "HEAD";
  const remoteOutput = (await run("git", ["ls-remote", "origin", ref], options)).stdout;
  const remote = remoteOutput.match(/^([0-9a-f]{40,64})\s+/m)?.[1];
  if (remote === undefined) throw new Error(`Failed to determine remote ${ref}.`);
  return pluginUpdateResult(pkg, local === remote ? "up-to-date" : "update-available");
}

async function checkPluginPackageUpdate(pkg: PluginPackageInfo): Promise<PluginUpdateResult> {
  if (!pkg.canCheckForUpdates) {
    return pluginUpdateResult(pkg, "unsupported", "Pinned or local packages cannot be checked automatically.");
  }
  if (pluginsOffline()) {
    return pluginUpdateResult(pkg, "error", "Update checks are disabled while PI_OFFLINE=1.");
  }
  try {
    const parsed = parsePackageSource(pkg.source);
    if (parsed.kind === "npm") return await checkNpmPackageUpdate(pkg);
    if (parsed.kind === "git") return await checkGitPackageUpdate(pkg);
    return pluginUpdateResult(pkg, "unsupported", "This package source cannot be checked automatically.");
  } catch (cause) {
    return pluginUpdateResult(pkg, "error", describe(cause));
  }
}

async function postPluginCheck(request: LocalRequest): Promise<LocalResponse> {
  let body: unknown;
  try {
    body = JSON.parse(request.body ?? "");
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  if (!isRecord(body)) return errorResponse("Invalid JSON body", 400);

  const rawCwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  if (rawCwd === "") return errorResponse("cwd required", 400);
  const cwd = path.resolve(rawCwd);
  try {
    if (!(await stat(cwd)).isDirectory()) return errorResponse("cwd required", 400);
  } catch {
    return errorResponse("cwd required", 400);
  }

  const source = typeof body.source === "string" ? body.source : undefined;
  const scope = body.scope === "global" || body.scope === "project" ? body.scope : undefined;
  if ((source !== undefined && scope === undefined) || (source === undefined && scope !== undefined)) {
    return errorResponse("source and scope must be provided together", 400);
  }

  const plugins = await readPlugins(cwd);
  const selected = plugins.packages.filter((pkg) => (
    source === undefined || (pkg.source === source && pkg.scope === scope)
  ));
  if (source !== undefined && selected.length === 0) {
    return errorResponse("Configured package not found", 404);
  }
  return jsonResponse({ updates: await Promise.all(selected.map((pkg) => checkPluginPackageUpdate(pkg))) });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function isPluginsPath(request: LocalRequest): boolean {
  return request.segments.length === 2
    && request.segments[0] === "api"
    && request.segments[1] === "plugins";
}

async function getPlugins(request: LocalRequest): Promise<LocalResponse> {
  const rawCwd = request.params.get("cwd")?.trim() ?? "";
  if (rawCwd === "") return errorResponse("cwd required", 400);
  const cwd = path.resolve(rawCwd);
  try {
    if (!(await stat(cwd)).isDirectory()) return errorResponse("cwd required", 400);
  } catch {
    return errorResponse("cwd required", 400);
  }
  return jsonResponse(await readPlugins(cwd));
}

async function postPlugins(request: LocalRequest): Promise<LocalResponse> {
  let body: unknown;
  try {
    body = JSON.parse(request.body ?? "");
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  if (!isRecord(body)) return errorResponse("Invalid JSON body", 400);

  const rawCwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  if (rawCwd === "") return errorResponse("cwd required", 400);
  const cwd = path.resolve(rawCwd);
  try {
    if (!(await stat(cwd)).isDirectory()) return errorResponse("cwd required", 400);
  } catch {
    return errorResponse("cwd required", 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (action === "") return errorResponse("action required", 400);

  const trust = await projectTrust(cwd);

  if (body.packages !== undefined) {
    if (action !== "enable" && action !== "disable") {
      return errorResponse("packages is only supported by enable and disable", 400);
    }
    const packages = readPackageList(body.packages);
    if (packages === null) {
      return errorResponse("packages must be a list of { source, scope }", 400);
    }
    const results = await setPackageListDisabled(cwd, packages, action === "disable", trust.trusted);
    const response: PluginsBulkResponse = {
      ...(await readPlugins(cwd)),
      results,
    };
    return jsonResponse(response);
  }

  const scope = readScope(body.scope);
  const source = typeof body.source === "string" ? body.source.trim() : undefined;

  // The old route refuses every project-scoped mutation before touching
  // anything when the project is not trusted, and a whole-list update that
  // would include an untrusted project's packages.
  if (scope === "project" && !trust.trusted) {
    return errorResponse(PROJECT_UNTRUSTED, 403);
  }
  if (action === "update" && (source === undefined || source === "") && !trust.trusted) {
    const projectSettings = await readSettingsForRead(settingsPath(cwd));
    const hasProject = configuredPackages(projectSettings.settings, "project", []).length > 0;
    if (hasProject) return errorResponse(PROJECT_UPDATE_UNTRUSTED, 403);
  }

  if (action === "install" || action === "add") {
    return runPackageCommand("install", source, scope, cwd, trust.trusted, request.signal);
  }
  if (action === "remove" || action === "uninstall") {
    return runPackageCommand("remove", source, scope, cwd, trust.trusted, request.signal);
  }
  if (action === "update") {
    return runPackageCommand("update", source, scope, cwd, trust.trusted, request.signal);
  }

  if (action === "enable" || action === "disable") {
    if (source === undefined || source === "") return errorResponse("source required", 400);
    const target = settingsPath(scope === "global" ? null : cwd);
    try {
      await updatePackageSettings(target, (settings) => (
        setPackagesDisabled(settings, [source], action === "disable", false).changed
      ));
    } catch (cause) {
      return errorResponse(describe(cause), 500);
    }
    return jsonResponse(await readPlugins(cwd));
  }

  return errorResponse(`Unsupported action: ${action}`, 400);
}

export async function handlePlugins(request: LocalRequest): Promise<LocalResponse | null> {
  if (request.segments.length === 3 && request.segments[0] === "api"
    && request.segments[1] === "plugins" && request.segments[2] === "check"
    && request.method === "POST") {
    return postPluginCheck(request);
  }
  if (!isPluginsPath(request)) return null;
  if (request.method === "GET") return getPlugins(request);
  if (request.method === "POST") return postPlugins(request);
  return null;
}
