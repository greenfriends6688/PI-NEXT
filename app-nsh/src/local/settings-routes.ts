// Settings and catalogue routes answered from pi's own files.
//
// Ported from pi-web's:
//   app/api/models/route.ts, app/api/models/default/route.ts,
//   app/api/models/enabled/route.ts, app/api/tools/settings/route.ts,
//   app/api/cache-miss-notices/route.ts, app/api/ui-preferences/route.ts,
//   app/api/subagents/settings/route.ts, app/api/subagents/profiles/route.ts
// and the libs behind them (`lib/default-preferences.ts`,
// `lib/global-settings-file.ts`, `lib/enabled-models*.ts`,
// `lib/jsonc.ts`, `lib/ui-preferences.ts`, `lib/subagent-settings.ts`,
// `lib/tool-presets.ts`, `lib/codemode-settings.ts`,
// `lib/powershell-settings.ts`).
//
// What changed is where the data comes from. There is no Node/Next process:
//
//   settings.json             defaults, enabledModels, defaultTools, codemode,
//                             showCacheMissNotices
//   models.json               custom providers, model additions/overrides
//   models-store.json         pi's cached provider catalogues (fetched by pi)
//   auth.json                 which providers have a credential
//   ui-preferences.json       per-key UI preferences
//   agents/settings.json      subagent switch/concurrency/built-in toggles
//   agents/*.md, .pi/agents/*.md, .agents/agents/*.md   agent profiles
//
// Writes are minimal text edits (comments, trailing commas and key order
// survive), serialized by an mkdir lock and committed with a temp-file rename.
// Settings/files this module cannot answer for (`/api/models-config/**`,
// `/api/mcp/**`, `/api/skills/**`, `/api/plugins/**`, `/api/auth/**`,
// `/api/terminal/**`, `/api/bot-channel/**`, `/api/lan/**`,
// `/api/provider-usage/**`, `/api/app-update`, `/api/project-trust`, and the
// per-session `/api/cache-miss` reads) return `null`, so the pipe keeps serving
// them.
import { lstat, mkdir, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import process from "process";
import {
  describe,
  errorResponse,
  homeDirectory,
  jsonResponse,
  piAgentDirectory,
  type LocalRequest,
  type LocalResponse,
} from "./request";

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCode(cause: unknown): string | undefined {
  return isRecord(cause) && typeof cause.code === "string" ? cause.code : undefined;
}

/** A path with the home folder shown as `~`, as the settings banner expects. */
function displayPath(value: string): string {
  const home = homeDirectory();
  if (home && value === home) return "~";
  if (home && value.startsWith(`${home}${path.sep}`)) return `~${value.slice(home.length)}`;
  return value;
}

function settingsPath(): string {
  return path.join(piAgentDirectory(), "settings.json");
}

function modelsJsonPath(): string {
  return path.join(piAgentDirectory(), "models.json");
}

function modelsStorePath(): string {
  return path.join(piAgentDirectory(), "models-store.json");
}

function authJsonPath(): string {
  return path.join(piAgentDirectory(), "auth.json");
}

function uiPreferencesPath(): string {
  return path.join(piAgentDirectory(), "ui-preferences.json");
}

function subagentSettingsPath(): string {
  return path.join(piAgentDirectory(), "agents", "settings.json");
}

function projectSettingsPath(cwd: string): string {
  return path.join(cwd, ".pi", "settings.json");
}

// ---------------------------------------------------------------------------
// JSON with comments and trailing commas (models.json is JSONC)
// ---------------------------------------------------------------------------

/**
 * Drops `//` line comments, `/* … *\/` block comments and trailing commas,
 * leaving string literals untouched — the reader in `lib/jsonc.ts`, which
 * extends pi's own `stripJsonComments` with block comments.
 */
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

function settingsObjectOf(text: string, target: string): Record<string, unknown> {
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = parseJsonc(text);
  } catch (cause) {
    throw new Error(`${target}: ${describe(cause)}`);
  }
  if (!isRecord(parsed)) throw new Error("Invalid settings.json: expected an object");
  return parsed;
}

// ---------------------------------------------------------------------------
// Locked, atomic file writes
// ---------------------------------------------------------------------------

const LOCK_TIMEOUT_MS = 8_000;
// proper-lockfile's default stale window; a holder refreshes the lock every 5 s.
const LOCK_STALE_MS = 10_000;

async function withFileLock<T>(target: string, task: () => Promise<T>): Promise<T> {
  await mkdir(path.dirname(target), { recursive: true });
  // `<file>.lock` is the directory proper-lockfile (pi's SettingsManager and
  // `lib/global-settings-file.ts`) holds on the same path, so this app and a
  // running pi never write the file at once.
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
      // A lock another writer already cleaned up: nothing to release.
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
      // The temp file never existed, or the rename already consumed it.
    }
    throw cause;
  }
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

/** A locked read-modify-write whose edit returns the text to store. */
async function updateTextFile(target: string, edit: (text: string) => string): Promise<void> {
  await withFileLock(target, async () => {
    const before = (await readText(target)) ?? "";
    const after = edit(before);
    if (after !== before) await writeAtomic(target, after);
  });
}

// ---------------------------------------------------------------------------
// settings.json (global)
// ---------------------------------------------------------------------------

async function readGlobalSettings(): Promise<Record<string, unknown>> {
  const target = settingsPath();
  const text = await readText(target);
  if (text === null) return {};
  return settingsObjectOf(text, target);
}

async function mutateGlobalSettings(
  edit: (settings: Record<string, unknown>, text: string) => string,
): Promise<void> {
  const target = settingsPath();
  await updateTextFile(target, (text) => edit(settingsObjectOf(text, target), text));
}

/** One project's `.pi/settings.json`; an unreadable or broken file reads as empty, as pi reads it. */
async function readProjectSettings(cwd: string): Promise<Record<string, unknown>> {
  const target = projectSettingsPath(cwd);
  let text: string | null;
  try {
    text = await readText(target);
  } catch {
    return {};
  }
  if (text === null) return {};
  try {
    const parsed = parseJsonc(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

interface SettingsLayers {
  global: Record<string, unknown>;
  project: Record<string, unknown>;
}

async function readSettingsLayers(cwd: string | null): Promise<SettingsLayers> {
  let global: Record<string, unknown> = {};
  try {
    global = await readGlobalSettings();
  } catch {
    // pi's model/settings readers treat an unreadable settings file as empty.
  }
  return { global, project: cwd ? await readProjectSettings(cwd) : {} };
}

function mergedValue<T>(layers: SettingsLayers, key: string): T | undefined {
  const project = layers.project[key];
  if (project !== undefined) return project as T;
  return layers.global[key] as T | undefined;
}

function mergedThinkingLevels(layers: SettingsLayers): Record<string, unknown> {
  const global = isRecord(layers.global.modelThinkingLevels) ? layers.global.modelThinkingLevels : {};
  const project = isRecord(layers.project.modelThinkingLevels) ? layers.project.modelThinkingLevels : {};
  return { ...global, ...project };
}

// ---------------------------------------------------------------------------
// Models catalogue: models.json + models-store.json + auth.json
// ---------------------------------------------------------------------------

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = typeof THINKING_LEVELS[number];

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

/** pi's built-in provider ids (the ids its resolver ships defaults for). */
const BUILTIN_PROVIDER_NAMES: Record<string, string> = {
  "amazon-bedrock": "Amazon Bedrock",
  "ant-ling": "Ant Ling",
  anthropic: "Anthropic",
  openai: "OpenAI",
  azure: "Azure OpenAI",
  "openai-codex": "OpenAI Codex",
  radius: "Radius",
  nvidia: "NVIDIA",
  deepseek: "DeepSeek",
  google: "Google",
  "google-vertex": "Google Vertex AI",
  "github-copilot": "GitHub Copilot",
  openrouter: "OpenRouter",
  "vercel-ai-gateway": "Vercel AI Gateway",
  xai: "xAI",
  groq: "Groq",
  cerebras: "Cerebras",
  zai: "Z.AI",
  "zai-coding-cn": "Z.AI Coding (China)",
  mistral: "Mistral",
  minimax: "MiniMax",
  "minimax-cn": "MiniMax (China)",
  moonshotai: "Moonshot AI",
  "moonshotai-cn": "Moonshot AI (China)",
  huggingface: "Hugging Face",
  fireworks: "Fireworks",
  together: "Together AI",
  baseten: "Baseten",
  opencode: "OpenCode",
  "opencode-go": "OpenCode Go",
  "kimi-coding": "Kimi for Coding",
  meta: "Meta",
  "cloudflare-workers-ai": "Cloudflare Workers AI",
  "cloudflare-ai-gateway": "Cloudflare AI Gateway",
  "qwen-token-plan": "Qwen Token Plan",
  "qwen-token-plan-cn": "Qwen Token Plan (China)",
  "qwen-token-plan-individual": "Qwen Token Plan (Individual)",
  xiaomi: "Xiaomi MiMo",
  "xiaomi-token-plan-cn": "Xiaomi MiMo Token Plan (China)",
  "xiaomi-token-plan-ams": "Xiaomi MiMo Token Plan (Amsterdam)",
  "xiaomi-token-plan-sgp": "Xiaomi MiMo Token Plan (Singapore)",
  typesafe: "TypeSafe",
  "llama.cpp": "llama.cpp",
};

interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  input: string[];
  thinkingLevelMap?: Record<string, string | null>;
  contextWindow?: number;
  maxTokens?: number;
}

interface Catalog {
  /** Models whose provider has a usable credential: the selector's list. */
  models: CatalogModel[];
  /**
   * Models whose provider has no usable credential right now but whose
   * catalogue pi has cached. `enabledModels` entries matching one of these are
   * kept (not stale, not pruned), exactly as `lib/enabled-models-runtime.ts`
   * marks them `known`.
   */
  knownModels: CatalogModel[];
  providerNames: Map<string, string>;
  customProviders: Set<string>;
  modelError?: string;
}

function stringInput(value: unknown): string[] {
  if (!Array.isArray(value)) return ["text"];
  const allowed = value.filter((entry): entry is string => entry === "text" || entry === "image");
  return allowed.length > 0 ? allowed : ["text"];
}

function thinkingLevelMapOf(value: unknown): Record<string, string | null> | undefined {
  if (!isRecord(value)) return undefined;
  const map: Record<string, string | null> = {};
  for (const level of THINKING_LEVELS) {
    const entry = value[level];
    if (entry === null) map[level] = null;
    else if (typeof entry === "string") map[level] = entry;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

function catalogModel(value: unknown, provider: string, fallbackId?: string): CatalogModel | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === "string" && value.id ? value.id : fallbackId;
  if (!id) return null;
  const name = typeof value.name === "string" && value.name ? value.name : id;
  const contextWindow = typeof value.contextWindow === "number" ? value.contextWindow : undefined;
  const maxTokens = typeof value.maxTokens === "number" ? value.maxTokens : undefined;
  return {
    id,
    name,
    provider,
    reasoning: value.reasoning === true,
    input: stringInput(value.input),
    ...(thinkingLevelMapOf(value.thinkingLevelMap) ? { thinkingLevelMap: thinkingLevelMapOf(value.thinkingLevelMap) } : {}),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  };
}

interface ModelsJsonRead {
  providers: Record<string, Record<string, unknown>>;
  error?: string;
}

async function readModelsJson(): Promise<ModelsJsonRead> {
  const target = modelsJsonPath();
  let text: string | null;
  try {
    text = await readText(target);
  } catch (cause) {
    return { providers: {}, error: `Failed to load models.json: ${describe(cause)}\n\nFile: ${target}` };
  }
  if (text === null) return { providers: {} };
  let parsed: unknown;
  try {
    parsed = parseJsonc(text);
  } catch (cause) {
    return { providers: {}, error: `Failed to parse models.json: ${describe(cause)}\n\nFile: ${target}` };
  }
  if (!isRecord(parsed) || !isRecord(parsed.providers)) {
    return { providers: {}, error: `Invalid models.json: expected an object with "providers"\n\nFile: ${target}` };
  }
  const providers: Record<string, Record<string, unknown>> = {};
  for (const [id, value] of Object.entries(parsed.providers)) {
    if (isRecord(value)) providers[id] = value;
  }
  return { providers };
}

function providerKeyConfigured(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

async function readAuthProviders(): Promise<Set<string>> {
  let text: string | null;
  try {
    text = await readText(authJsonPath());
  } catch {
    return new Set();
  }
  if (text === null) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Set();
  }
  if (!isRecord(parsed)) return new Set();
  const providers = new Set<string>();
  for (const [id, entry] of Object.entries(parsed)) {
    if (!isRecord(entry)) continue;
    const key = entry.key;
    if (typeof key === "string") {
      if (key !== "") providers.add(id);
      continue;
    }
    // OAuth credentials carry no `key`.
    if (typeof entry.type === "string" && entry.type !== "") providers.add(id);
  }
  return providers;
}

async function readModelsStore(): Promise<Record<string, CatalogModel[]>> {
  let text: string | null;
  try {
    text = await readText(modelsStorePath());
  } catch {
    return {};
  }
  if (text === null) return {};
  let parsed: unknown;
  try {
    parsed = parseJsonc(text);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const store: Record<string, CatalogModel[]> = {};
  for (const [provider, entry] of Object.entries(parsed)) {
    if (!isRecord(entry) || !Array.isArray(entry.models)) continue;
    const models: CatalogModel[] = [];
    for (const raw of entry.models) {
      if (!isRecord(raw)) continue;
      // models-store keeps image and classifier models beside the chat ones.
      if (raw.type !== undefined && raw.type !== "chat") continue;
      const model = catalogModel(raw, provider);
      if (model) models.push(model);
    }
    if (models.length > 0) store[provider] = models;
  }
  return store;
}

function applyModelDefinition(existing: CatalogModel | undefined, definition: Record<string, unknown>, provider: string): CatalogModel | null {
  if (typeof definition.id !== "string" || !definition.id) return null;
  const id = definition.id;
  const contextWindow = typeof definition.contextWindow === "number" ? definition.contextWindow : existing?.contextWindow;
  const maxTokens = typeof definition.maxTokens === "number" ? definition.maxTokens : existing?.maxTokens;
  return {
    id,
    provider,
    name: typeof definition.name === "string" && definition.name ? definition.name : (existing?.name ?? id),
    reasoning: typeof definition.reasoning === "boolean" ? definition.reasoning : (existing?.reasoning ?? false),
    input: definition.input === undefined ? (existing?.input ?? ["text"]) : stringInput(definition.input),
    thinkingLevelMap: thinkingLevelMapOf(definition.thinkingLevelMap) ?? existing?.thinkingLevelMap,
    contextWindow: contextWindow ?? (definition.contextWindow === undefined && existing === undefined ? 128000 : undefined),
    maxTokens: maxTokens ?? (definition.maxTokens === undefined && existing === undefined ? 16384 : undefined),
  };
}

function applyModelOverride(model: CatalogModel, override: Record<string, unknown>): CatalogModel {
  const map = thinkingLevelMapOf(override.thinkingLevelMap);
  return {
    ...model,
    name: typeof override.name === "string" && override.name ? override.name : model.name,
    reasoning: typeof override.reasoning === "boolean" ? override.reasoning : model.reasoning,
    input: override.input === undefined ? model.input : stringInput(override.input),
    thinkingLevelMap: map ? { ...(model.thinkingLevelMap ?? {}), ...map } : model.thinkingLevelMap,
    contextWindow: typeof override.contextWindow === "number" ? override.contextWindow : model.contextWindow,
    maxTokens: typeof override.maxTokens === "number" ? override.maxTokens : model.maxTokens,
  };
}

/**
 * The catalogue the files can describe: every provider pi has a cached
 * catalogue for and that has a credential (auth.json or models.json), plus
 * every provider `models.json` defines models or a key for.
 *
 * pi's bundled catalogue is not a file this app can read without spawning pi,
 * so a provider pi ships but has never fetched a catalogue for (and that is
 * not in models.json) is simply absent. An empty catalogue is a valid answer:
 * the picker shows zero rows instead of failing.
 */
async function buildCatalog(): Promise<Catalog> {
  const [store, authProviders, config] = await Promise.all([readModelsStore(), readAuthProviders(), readModelsJson()]);
  const allProviders = new Map<string, CatalogModel[]>();
  const availableProviders = new Set<string>();

  for (const [provider, models] of Object.entries(store)) {
    allProviders.set(provider, models.map((model) => ({ ...model })));
    if (authProviders.has(provider)) availableProviders.add(provider);
  }

  for (const [provider, definition] of Object.entries(config.providers)) {
    const hasAuth = authProviders.has(provider) || providerKeyConfigured(definition.apiKey);
    const definitions = Array.isArray(definition.models) ? definition.models : [];
    const hasDefinitions = definitions.some((entry) => isRecord(entry) && typeof entry.id === "string" && entry.id);
    if (hasAuth || hasDefinitions) availableProviders.add(provider);

    const list = allProviders.get(provider)?.slice() ?? [];
    for (const entry of definitions) {
      if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id) continue;
      const index = list.findIndex((model) => model.id === entry.id);
      const next = applyModelDefinition(index >= 0 ? list[index] : undefined, entry, provider);
      if (!next) continue;
      if (index >= 0) list[index] = next;
      else list.push(next);
    }
    if (isRecord(definition.modelOverrides)) {
      for (const [id, override] of Object.entries(definition.modelOverrides)) {
        if (!isRecord(override)) continue;
        const index = list.findIndex((model) => model.id === id);
        if (index >= 0) list[index] = applyModelOverride(list[index], override);
      }
    }
    if (list.length > 0) allProviders.set(provider, list);
  }

  const providerNames = new Map<string, string>();
  for (const [id, name] of Object.entries(BUILTIN_PROVIDER_NAMES)) providerNames.set(id, name);
  for (const [id, definition] of Object.entries(config.providers)) {
    if (typeof definition.name === "string" && definition.name) providerNames.set(id, definition.name);
  }

  const customProviders = new Set(
    Object.keys(config.providers).filter((id) => !(id in BUILTIN_PROVIDER_NAMES)),
  );

  const knownModels: CatalogModel[] = [];
  const models: CatalogModel[] = [];
  for (const [provider, list] of allProviders) {
    const available = availableProviders.has(provider);
    for (const model of list) {
      const copy = { ...model, provider };
      knownModels.push(copy);
      if (available) models.push(copy);
    }
  }
  return {
    models,
    knownModels,
    providerNames,
    customProviders,
    ...(config.error ? { modelError: config.error } : {}),
  };
}

// ---------------------------------------------------------------------------
// pi's model-scope resolver (glob + fuzzy + `:thinkingLevel`), ported
// ---------------------------------------------------------------------------

type ResolveResult =
  | { status: "resolved"; model: CatalogModel; thinkingLevel?: ThinkingLevel; warning?: string }
  | { status: "ambiguous"; candidates: CatalogModel[]; usableCount: number; thinkingLevel?: ThinkingLevel; warning?: string }
  | { status: "not-found" };

interface ResolveRequest {
  text: string;
  provider?: string;
  fuzzy: boolean;
  thinkingSuffix: "none" | "lenient" | "strict";
}

function splitThinkingSuffix(text: string): { base: string; thinkingLevel: ThinkingLevel } | null {
  const colon = text.lastIndexOf(":");
  const suffix = text.slice(colon + 1);
  if (colon < 0 || !isThinkingLevel(suffix)) return null;
  return { base: text.slice(0, colon), thinkingLevel: suffix };
}

function splitProviderPrefix(text: string, models: readonly CatalogModel[]): { provider: string; modelText: string } | undefined {
  const lowerText = text.toLowerCase();
  let best: { provider: string; modelText: string } | undefined;
  for (const { provider } of models) {
    const prefix = provider.trim().toLowerCase();
    if (!prefix || (best && best.provider.length >= provider.length)) continue;
    const slash = lowerText.indexOf("/", prefix.length);
    if (slash === -1 || lowerText.slice(0, slash).trim() !== prefix) continue;
    const modelText = text.slice(slash + 1).trim();
    if (modelText) best = { provider, modelText };
  }
  return best;
}

function isAlias(id: string): boolean {
  return id.endsWith("-latest") || !/-\d{8}$/.test(id);
}

function bestFuzzyMatch(matches: readonly CatalogModel[]): CatalogModel | undefined {
  const aliases = matches.filter((model) => isAlias(model.id));
  return [...(aliases.length > 0 ? aliases : matches)].sort((a, b) => b.id.localeCompare(a.id))[0];
}

function fuzzyMatches(text: string, models: readonly CatalogModel[]): CatalogModel[] {
  const lower = text.toLowerCase();
  return models.filter((model) => model.id.toLowerCase().includes(lower) || (model.name ?? "").toLowerCase().includes(lower));
}

function usableBy(ref: string): boolean {
  return ref.length > 0;
}

function selectReference(
  text: string,
  pool: readonly CatalogModel[],
  fuzzy: boolean,
  usable: (provider: string) => boolean,
): ResolveResult | undefined {
  const lowerText = text.toLowerCase();
  const raw = pool.filter((model) => model.id.toLowerCase() === lowerText);
  const split = splitProviderPrefix(text, pool);
  let named: CatalogModel | undefined;
  if (split) {
    const providerModels = pool.filter((model) => model.provider === split.provider);
    const lowerModelText = split.modelText.toLowerCase();
    named = providerModels.find((model) => model.id.toLowerCase() === lowerModelText)
      ?? raw.find((model) => model.provider === split.provider)
      ?? (fuzzy ? bestFuzzyMatch(fuzzyMatches(split.modelText, providerModels)) : undefined);
  }
  const others = raw.filter((model) => model !== named);
  const candidates = named ? [named, ...others] : others;
  if (candidates.length === 0) return undefined;
  if (new Set(candidates.map((model) => model.provider)).size === 1) {
    return { status: "resolved", model: candidates[0] };
  }
  if (named && usable(named.provider)) return { status: "resolved", model: named };
  const usableOthers = others.filter((model) => usable(model.provider));
  if (usableOthers.length === 1) return { status: "resolved", model: usableOthers[0] };
  if (usableOthers.length === 0 && named) return { status: "resolved", model: named };
  return { status: "ambiguous", candidates, usableCount: usableOthers.length };
}

function selectFuzzy(matches: readonly CatalogModel[], usable: (provider: string) => boolean): ResolveResult | undefined {
  if (matches.length === 0) return undefined;
  const multipleProviders = new Set(matches.map((model) => model.provider)).size > 1;
  const usableMatches = multipleProviders ? matches.filter((model) => usable(model.provider)) : [];
  const pool = usableMatches.length > 0 ? usableMatches : matches;
  const best = bestFuzzyMatch(pool);
  if (!best) return undefined;
  const tied = pool.filter((model) => model.id === best.id);
  if (new Set(tied.map((model) => model.provider)).size === 1) {
    return { status: "resolved", model: best };
  }
  return { status: "ambiguous", candidates: tied, usableCount: usableMatches.length > 0 ? tied.length : 0 };
}

function resolveText(
  text: string,
  request: ResolveRequest,
  pool: readonly CatalogModel[],
  usable: (provider: string) => boolean,
): ResolveResult {
  const reference = selectReference(text, pool, request.fuzzy, usable);
  if (reference) return reference;
  if (request.fuzzy) {
    const fuzzy = selectFuzzy(fuzzyMatches(text, pool), usable);
    if (fuzzy) return fuzzy;
  }
  if (request.thinkingSuffix === "none") return { status: "not-found" };
  const thinking = splitThinkingSuffix(text);
  if (thinking) {
    const inner = resolveText(thinking.base, request, pool, usable);
    if (inner.status === "not-found") return inner;
    return { ...inner, thinkingLevel: inner.warning ? undefined : thinking.thinkingLevel };
  }
  if (request.thinkingSuffix === "strict") return { status: "not-found" };
  const colon = text.lastIndexOf(":");
  if (colon === -1) return { status: "not-found" };
  const suffix = text.slice(colon + 1);
  const inner = resolveText(text.slice(0, colon), request, pool, usable);
  if (inner.status === "not-found") return inner;
  return {
    ...inner,
    thinkingLevel: undefined,
    warning: `Invalid thinking level "${suffix}" in pattern "${text}". Using default instead.`,
  };
}

function resolveModelReference(
  request: ResolveRequest,
  models: readonly CatalogModel[],
  usable: (provider: string) => boolean,
): ResolveResult {
  const text = request.text.trim();
  if (!text) return { status: "not-found" };
  const constraint = request.provider?.toLowerCase();
  const pool = constraint ? models.filter((model) => model.provider.toLowerCase() === constraint) : models;
  return resolveText(text, request, pool, usable);
}

function escapeRegExpChar(ch: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(ch) ? `\\${ch}` : ch;
}

function globToRegExp(glob: string): RegExp {
  let source = "^";
  let index = 0;
  while (index < glob.length) {
    const ch = glob[index];
    if (ch === "\\") {
      index += 1;
      if (index < glob.length) source += escapeRegExpChar(glob[index]);
      index += 1;
      continue;
    }
    if (ch === "*") {
      if (glob[index + 1] === "*") {
        index += 2;
        if (glob[index] === "/") index += 1;
        source += ".*";
      } else {
        source += "[^/]*";
        index += 1;
      }
      continue;
    }
    if (ch === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }
    if (ch === "[") {
      const close = glob.indexOf("]", index + 1);
      if (close > index + 1) {
        let body = glob.slice(index + 1, close);
        if (body[0] === "!") body = `^${body.slice(1)}`;
        source += `[${body}]`;
        index = close + 1;
        continue;
      }
    }
    source += escapeRegExpChar(ch);
    index += 1;
  }
  source += "$";
  return new RegExp(source, "i");
}

function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf("{");
  if (open < 0) return [pattern];
  const close = pattern.indexOf("}", open + 1);
  if (close < 0) return [pattern];
  const before = pattern.slice(0, open);
  const after = pattern.slice(close + 1);
  const parts = pattern.slice(open + 1, close).split(",");
  return parts.flatMap((part) => expandBraces(`${before}${part}${after}`));
}

function globMatches(value: string, pattern: string): boolean {
  return expandBraces(pattern).some((expanded) => {
    try {
      return globToRegExp(expanded).test(value);
    } catch {
      // A malformed character class must read as "matches nothing", not fail
      // the whole settings request.
      return false;
    }
  });
}

interface ScopeDiagnostic {
  code: string;
  message: string;
  pattern?: string;
}

interface ScopedModel {
  model: CatalogModel;
  thinkingLevel?: ThinkingLevel;
}

interface ResolvedScope {
  scopedModels: ScopedModel[];
  diagnostics: ScopeDiagnostic[];
}

function resolveModelScopeFromModels(patterns: readonly string[], models: readonly CatalogModel[]): ResolvedScope {
  const scopedModels: ScopedModel[] = [];
  const diagnostics: ScopeDiagnostic[] = [];
  const usable = (provider: string) => usableBy(provider);
  const add = (model: CatalogModel, thinkingLevel?: ThinkingLevel) => {
    if (!scopedModels.some((scoped) => scoped.model.provider === model.provider && scoped.model.id === model.id)) {
      scopedModels.push({ model, ...(thinkingLevel ? { thinkingLevel } : {}) });
    }
  };
  const noMatch = (pattern: string) => diagnostics.push({
    code: "no-match",
    message: `No models match pattern "${pattern}"`,
    pattern,
  });
  const ambiguous = (pattern: string, candidates: readonly CatalogModel[]) => {
    const providers = [...new Set(candidates.map((model) => model.provider))].sort((a, b) => a.localeCompare(b));
    diagnostics.push({
      code: "ambiguous",
      message: `Pattern "${pattern}" matches several providers: ${providers.join(", ")}. Use provider/id to choose one.`,
      pattern,
    });
  };

  for (const pattern of patterns) {
    if (pattern.includes("*") || pattern.includes("?") || pattern.includes("[")) {
      const thinking = splitThinkingSuffix(pattern);
      const globPattern = thinking?.base ?? pattern;
      const thinkingLevel = thinking?.thinkingLevel;
      const exact = resolveModelReference({ text: globPattern, fuzzy: false, thinkingSuffix: "none" }, models, usable);
      let matches: CatalogModel[] = [];
      if (exact.status === "resolved") {
        matches = [exact.model];
      } else if (exact.status === "ambiguous") {
        matches = exact.candidates;
        ambiguous(pattern, matches);
      } else {
        matches = models.filter((model) => (
          globMatches(`${model.provider}/${model.id}`, globPattern) || globMatches(model.id, globPattern)
        ));
      }
      if (matches.length === 0) noMatch(pattern);
      for (const model of matches) add(model, thinkingLevel);
      continue;
    }

    const result = resolveModelReference({ text: pattern, fuzzy: true, thinkingSuffix: "lenient" }, models, usable);
    if (result.status === "not-found") {
      noMatch(pattern);
      continue;
    }
    if (result.warning) {
      diagnostics.push({ code: "invalid-thinking-level", message: result.warning, pattern });
    }
    if (result.status === "ambiguous") ambiguous(pattern, result.candidates);
    const matches = result.status === "resolved" ? [result.model] : result.candidates;
    for (const model of matches) add(model, result.thinkingLevel);
  }
  return { scopedModels, diagnostics };
}

function isSuppressibleUnmatchedGlob(pattern: string): boolean {
  if (!(pattern.includes("*") || pattern.includes("?") || pattern.includes("["))) return false;
  const colon = pattern.lastIndexOf(":");
  return colon < 0 || isThinkingLevel(pattern.slice(colon + 1));
}

interface VisibleScope {
  visible: CatalogModel[];
  scopedModels: ScopedModel[];
  pins: Record<string, string>;
  warnings: string[];
}

function resolveVisibleScope(patterns: readonly string[] | undefined, models: readonly CatalogModel[]): VisibleScope {
  const cleaned = (patterns ?? []).map((pattern) => pattern.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return { visible: [...models], scopedModels: [], pins: {}, warnings: [] };
  }
  const { scopedModels, diagnostics } = resolveModelScopeFromModels(cleaned, models);
  const warnings = diagnostics
    .filter((diagnostic) => (
      diagnostic.code !== "no-match"
      || scopedModels.length === 0
      || !isSuppressibleUnmatchedGlob(diagnostic.pattern ?? "")
    ))
    .map((diagnostic) => diagnostic.message);
  if (scopedModels.length === 0) {
    return { visible: [...models], scopedModels: [], pins: {}, warnings };
  }
  const pins: Record<string, string> = {};
  for (const scoped of scopedModels) {
    if (scoped.thinkingLevel) pins[`${scoped.model.provider}/${scoped.model.id}`] = scoped.thinkingLevel;
  }
  return { visible: scopedModels.map((scoped) => scoped.model), scopedModels, pins, warnings };
}

function orderSelectorModels(scope: VisibleScope): CatalogModel[] {
  if (scope.scopedModels.length > 0) return [...scope.visible];
  return [...scope.visible].sort((a, b) => a.provider.localeCompare(b.provider));
}

function supportedThinkingLevels(model: CatalogModel): ThinkingLevel[] {
  if (!model.reasoning) return ["off"];
  return THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

function modelKey(provider: string, id: string): string {
  return `${provider}:${id}`;
}

function modelRef(provider: string, id: string): string {
  return `${provider}/${id}`;
}

// ---------------------------------------------------------------------------
// enabledModels: the pure editor from lib/enabled-models.ts
// ---------------------------------------------------------------------------

interface PatternResolution {
  pattern: string;
  matched: string[];
  known?: boolean;
  pin?: string;
}

interface EnabledModelsInput {
  patterns: string[] | undefined;
  availableRefs: readonly string[];
  resolutions: readonly PatternResolution[];
  providerGlobs?: Readonly<Record<string, string>>;
}

interface EnabledModelsState {
  allEnabled: boolean;
  enabled: string[];
  pins: Record<string, string>;
  stalePatterns: string[];
}

type EnabledModelsEdit =
  | { ok: true; patterns: string[] | undefined; changed: boolean }
  | { ok: false; reason: "last-model" };

interface Entry {
  pattern: string;
  matched: string[];
  pin?: string;
}

function modelRefProvider(ref: string): string {
  const slash = ref.indexOf("/");
  return slash < 0 ? ref : ref.slice(0, slash);
}

function toEntries(resolutions: readonly PatternResolution[]): Entry[] {
  return resolutions.map((resolution) => ({
    pattern: resolution.pattern,
    matched: [...resolution.matched],
    ...(resolution.pin ? { pin: resolution.pin } : {}),
  }));
}

function enabledRefs(entries: readonly Entry[]): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const entry of entries) {
    for (const ref of entry.matched) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      refs.push(ref);
    }
  }
  return refs;
}

function formatEntry(ref: string, pin?: string): string {
  return pin ? `${ref}:${pin}` : ref;
}

function providerOrder(availableRefs: readonly string[]): string[] {
  const providers: string[] = [];
  for (const ref of availableRefs) {
    const provider = modelRefProvider(ref);
    if (!providers.includes(provider)) providers.push(provider);
  }
  return providers;
}

function refsOfProvider(availableRefs: readonly string[], provider: string): string[] {
  return availableRefs.filter((ref) => modelRefProvider(ref) === provider);
}

function materializeEntries(input: EnabledModelsInput): Entry[] {
  const entries = toEntries(input.resolutions);
  if (enabledRefs(entries).length > 0) return entries;
  for (const provider of providerOrder(input.availableRefs)) {
    const refs = refsOfProvider(input.availableRefs, provider);
    const glob = input.providerGlobs?.[provider];
    if (glob) entries.push({ pattern: glob, matched: refs });
    else for (const ref of refs) entries.push({ pattern: ref, matched: [ref] });
  }
  return entries;
}

function collapseProvider(entries: Entry[], input: EnabledModelsInput, provider: string): Entry[] {
  const providerGlob = input.providerGlobs?.[provider];
  if (!providerGlob) return entries;
  const providerRefs = refsOfProvider(input.availableRefs, provider);
  if (providerRefs.length === 0) return entries;

  const providerSet = new Set(providerRefs);
  const involved = entries.filter((entry) => entry.matched.some((ref) => providerSet.has(ref)));
  if (involved.some((entry) => entry.pin)) return entries;

  const covered = new Set(involved.flatMap((entry) => entry.matched.filter((ref) => providerSet.has(ref))));
  if (providerRefs.some((ref) => !covered.has(ref))) return entries;

  const isSubset = (entry: Entry) => entry.matched.length > 0 && entry.matched.every((ref) => providerSet.has(ref));
  if (entries.filter(isSubset).length < 2) return entries;
  const firstSubset = entries.findIndex(isSubset);
  if (firstSubset < 0) return entries;

  const wider = new Set(involved.filter((entry) => !isSubset(entry)).flatMap((entry) => entry.matched));
  if (providerRefs.every((ref) => wider.has(ref))) return entries;

  const glob: Entry = { pattern: providerGlob, matched: providerRefs };
  return entries
    .map((entry, index) => (index === firstSubset ? glob : entry))
    .filter((entry, index) => index === firstSubset || !isSubset(entry));
}

function normalizeProviderGlobs(entries: Entry[], input: EnabledModelsInput): Entry[] {
  let normalized = entries;
  for (const provider of providerOrder(input.availableRefs)) {
    normalized = collapseProvider(normalized, input, provider);
  }
  return normalized;
}

function serialize(entries: readonly Entry[], input: EnabledModelsInput): string[] | undefined {
  const hasStale = entries.some((entry) => entry.matched.length === 0);
  const hasPins = entries.some((entry) => entry.pin);
  const enabled = new Set(enabledRefs(entries));
  const coversEverything = input.availableRefs.every((ref) => enabled.has(ref));
  if (coversEverything && !hasStale && !hasPins) return undefined;
  return entries.map((entry) => entry.pattern);
}

function samePatterns(a: string[] | undefined, b: string[] | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((pattern, index) => pattern === b[index]);
}

function computeEnabledModelsState(input: EnabledModelsInput): EnabledModelsState {
  const entries = toEntries(input.resolutions);
  const enabled = enabledRefs(entries);
  const pins: Record<string, string> = {};
  for (const entry of entries) {
    if (!entry.pin) continue;
    for (const ref of entry.matched) pins[ref] ??= entry.pin;
  }
  const allEnabled = enabled.length === 0;
  return {
    allEnabled,
    enabled: allEnabled ? [...input.availableRefs] : enabled,
    pins,
    stalePatterns: input.resolutions
      .filter((resolution) => resolution.matched.length === 0 && !resolution.known)
      .map((resolution) => resolution.pattern),
  };
}

function setModelsEnabled(input: EnabledModelsInput, refs: readonly string[], enabled: boolean): EnabledModelsEdit {
  const available = new Set(input.availableRefs);
  const targets = [...new Set(refs.filter((ref) => available.has(ref)))];
  if (targets.length === 0) return { ok: true, patterns: input.patterns, changed: false };

  let entries = materializeEntries(input);

  if (enabled) {
    const current = new Set(enabledRefs(entries));
    for (const ref of targets) {
      if (current.has(ref)) continue;
      current.add(ref);
      entries.push({ pattern: ref, matched: [ref] });
    }
  } else {
    const removed = new Set(targets);
    const next: Entry[] = [];
    for (const entry of entries) {
      if (!entry.matched.some((ref) => removed.has(ref))) {
        next.push(entry);
        continue;
      }
      for (const ref of entry.matched.filter((matched) => !removed.has(matched))) {
        next.push({
          pattern: formatEntry(ref, entry.pin),
          matched: [ref],
          ...(entry.pin ? { pin: entry.pin } : {}),
        });
      }
    }
    if (enabledRefs(next).length === 0) return { ok: false, reason: "last-model" };
    entries = next;
  }

  const patterns = serialize(normalizeProviderGlobs(entries, input), input);
  return { ok: true, patterns, changed: !samePatterns(patterns, input.patterns) };
}

function pruneStaleEnabledModels(input: EnabledModelsInput): EnabledModelsEdit {
  const kept = toEntries(input.resolutions)
    .filter((entry, index) => entry.matched.length > 0 || input.resolutions[index].known);
  if (kept.length === input.resolutions.length) {
    return { ok: true, patterns: input.patterns, changed: false };
  }
  const patterns = kept.length === 0 ? undefined : serialize(kept, input);
  return { ok: true, patterns, changed: !samePatterns(patterns, input.patterns) };
}

function clearEnabledModels(input: EnabledModelsInput): EnabledModelsEdit {
  return { ok: true, patterns: undefined, changed: input.patterns !== undefined };
}

const THINKING_LEVEL_SUFFIXES = new Set<string>(THINKING_LEVELS);

function renameModelPatterns(patterns: string[] | undefined, renames: readonly { from: string; to: string }[]): string[] | undefined {
  if (!patterns) return patterns;
  const applicable = renames.filter((rename) => rename.from && rename.to && rename.from !== rename.to);
  if (applicable.length === 0) return patterns;
  return patterns.map((pattern) => {
    for (const { from, to } of applicable) {
      if (pattern === from) return to;
      if (!pattern.startsWith(`${from}:`)) continue;
      const suffix = pattern.slice(from.length + 1);
      if (THINKING_LEVEL_SUFFIXES.has(suffix)) return `${to}:${suffix}`;
    }
    return pattern;
  });
}

function renameProviderPatterns(patterns: string[] | undefined, renames: readonly { from: string; to: string }[]): string[] | undefined {
  if (!patterns) return patterns;
  const applicable = renames.filter((rename) => rename.from && rename.to && rename.from !== rename.to);
  if (applicable.length === 0) return patterns;
  return patterns.map((pattern) => {
    const rename = applicable.find((candidate) => pattern.startsWith(`${candidate.from}/`));
    return rename ? `${rename.to}${pattern.slice(rename.from.length)}` : pattern;
  });
}

function constrainProviderEntries(input: EnabledModelsInput): EnabledModelsEdit {
  const providers = new Set(providerOrder(input.availableRefs));
  const next: Entry[] = [];
  let cutBack = false;
  for (const entry of toEntries(input.resolutions)) {
    const slash = entry.pattern.indexOf("/");
    const prefix = slash > 0 ? entry.pattern.slice(0, slash) : "";
    const inside = providers.has(prefix)
      ? entry.matched.filter((ref) => modelRefProvider(ref) === prefix)
      : [];
    if (inside.length === 0 || inside.length === entry.matched.length) {
      next.push(entry);
      continue;
    }
    cutBack = true;
    for (const ref of inside) {
      next.push({
        pattern: formatEntry(ref, entry.pin),
        matched: [ref],
        ...(entry.pin ? { pin: entry.pin } : {}),
      });
    }
  }
  if (!cutBack) return { ok: true, patterns: input.patterns, changed: false };
  const patterns = serialize(next, input);
  return { ok: true, patterns, changed: !samePatterns(patterns, input.patterns) };
}

async function resolvePatternMatches(patterns: readonly string[], models: readonly CatalogModel[]): Promise<PatternResolution[]> {
  const resolutions: PatternResolution[] = [];
  for (const pattern of patterns) {
    const { scopedModels } = resolveModelScopeFromModels([pattern], models);
    const pin = scopedModels.find((scoped) => scoped.thinkingLevel)?.thinkingLevel;
    resolutions.push({
      pattern,
      matched: scopedModels.map((scoped) => modelRef(scoped.model.provider, scoped.model.id)),
      ...(pin ? { pin } : {}),
    });
  }
  return resolutions;
}

async function resolveProviderGlobs(models: readonly CatalogModel[]): Promise<Record<string, string>> {
  const refsByProvider = new Map<string, Set<string>>();
  for (const model of models) {
    const ref = modelRef(model.provider, model.id);
    const refs = refsByProvider.get(model.provider);
    if (refs) refs.add(ref);
    else refsByProvider.set(model.provider, new Set([ref]));
  }
  const globs: Record<string, string> = {};
  for (const [provider, refs] of refsByProvider) {
    for (const suffix of ["*", "**"]) {
      const pattern = `${provider}/${suffix}`;
      const [resolution] = await resolvePatternMatches([pattern], models);
      if (resolution.matched.length !== refs.size) continue;
      if (!resolution.matched.every((ref) => refs.has(ref))) continue;
      globs[provider] = pattern;
      break;
    }
  }
  return globs;
}

async function buildEnabledInput(
  patterns: string[] | undefined,
  models: readonly CatalogModel[],
  withGlobs: boolean,
  knownModels?: readonly CatalogModel[],
): Promise<EnabledModelsInput> {
  const resolutions = await resolvePatternMatches(patterns ?? [], models);
  if (knownModels) {
    const unmatched = resolutions.filter((resolution) => resolution.matched.length === 0);
    if (unmatched.length > 0) {
      const inCatalog = await resolvePatternMatches(unmatched.map((resolution) => resolution.pattern), knownModels);
      unmatched.forEach((resolution, index) => {
        if (inCatalog[index].matched.length > 0) resolution.known = true;
      });
    }
  }
  return {
    patterns,
    availableRefs: models.map((model) => modelRef(model.provider, model.id)),
    resolutions,
    ...(withGlobs ? { providerGlobs: await resolveProviderGlobs(models) } : {}),
  };
}

function buildEnabledView(
  input: EnabledModelsInput,
  catalog: Catalog,
  scope: "global" | "project",
  settingsFilePath: string,
): Record<string, unknown> {
  const state = computeEnabledModelsState(input);
  const enabled = new Set(state.enabled);
  const byProvider = new Map<string, Record<string, unknown>[]>();
  for (const model of catalog.models) {
    const ref = modelRef(model.provider, model.id);
    const pin = state.pins[ref];
    const entry: Record<string, unknown> = {
      id: model.id,
      name: model.name || model.id,
      ref,
      enabled: enabled.has(ref),
      ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
      ...(pin ? { thinkingPin: pin } : {}),
    };
    const list = byProvider.get(model.provider);
    if (list) list.push(entry);
    else byProvider.set(model.provider, [entry]);
  }

  const providers = [...byProvider.entries()].map(([id, entries]) => {
    entries.sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
    return {
      id,
      name: catalog.providerNames.get(id) ?? id,
      kind: catalog.customProviders.has(id) ? "custom" : "builtin",
      enabledCount: entries.filter((entry) => entry.enabled === true).length,
      models: entries,
    };
  });
  providers.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  return {
    allEnabled: state.allEnabled,
    patterns: input.patterns ?? null,
    stalePatterns: state.stalePatterns,
    enabledTotal: state.enabled.length,
    availableTotal: input.availableRefs.length,
    providers,
    scope,
    settingsPath: displayPath(settingsFilePath),
    editable: scope === "global",
    ...(catalog.modelError ? { modelError: catalog.modelError } : {}),
  };
}

// ---------------------------------------------------------------------------
// GET /api/models
// ---------------------------------------------------------------------------

function patternsOf(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value.filter((entry): entry is string => typeof entry === "string");
}

function thinkingLevelValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function getModels(request: LocalRequest): Promise<LocalResponse> {
  const rawCwd = request.params.get("cwd");
  let cwd: string | null = null;
  if (rawCwd) {
    cwd = path.resolve(rawCwd);
    let info;
    try {
      info = await stat(cwd);
    } catch {
      return errorResponse(`Directory does not exist: ${cwd}`, 400, { reason: "cwd-missing", cwd });
    }
    if (!info.isDirectory()) return errorResponse(`Not a directory: ${cwd}`, 400);
  }

  const scopeAll = request.params.get("scope") === "all";
  const layers = await readSettingsLayers(cwd);
  const catalog = await buildCatalog();
  const patterns = scopeAll ? undefined : patternsOf(mergedValue(layers, "enabledModels"));
  const scope = resolveVisibleScope(patterns, catalog.models);
  const ordered = orderSelectorModels(scope);

  const models: Record<string, string> = {};
  const modelList: Record<string, unknown>[] = [];
  const thinkingLevels: Record<string, string[]> = {};
  const thinkingLevelMaps: Record<string, Record<string, string | null>> = {};
  for (const model of ordered) {
    const key = modelKey(model.provider, model.id);
    models[key] = model.name;
    modelList.push({
      id: model.id,
      name: model.name,
      provider: model.provider,
      ...(model.input.length > 0 ? { input: model.input } : {}),
    });
  }
  for (const model of scope.visible) {
    const key = modelKey(model.provider, model.id);
    thinkingLevels[key] = supportedThinkingLevels(model);
    if (model.thinkingLevelMap) thinkingLevelMaps[key] = model.thinkingLevelMap;
  }

  const defaultProvider = mergedValue<string>(layers, "defaultProvider");
  const defaultModelId = mergedValue<string>(layers, "defaultModel");
  const defaultRef = typeof defaultProvider === "string" && defaultProvider && typeof defaultModelId === "string" && defaultModelId
    ? { provider: defaultProvider, modelId: defaultModelId }
    : null;
  const same = (model: CatalogModel, ref: { provider: string; modelId: string }) => (
    model.provider === ref.provider && model.id === ref.modelId
  );

  let initialModel: CatalogModel | undefined;
  let initialThinking: ThinkingLevel | undefined;
  if (scope.scopedModels.length > 0) {
    const selected = (defaultRef && scope.scopedModels.find((scoped) => same(scoped.model, defaultRef)))
      ?? scope.scopedModels[0];
    initialModel = selected.model;
    initialThinking = selected.thinkingLevel;
  } else if (defaultRef) {
    initialModel = scope.visible.find((model) => same(model, defaultRef));
  }

  const perModelThinking = initialModel ? mergedThinkingLevels(layers)[`${initialModel.provider}/${initialModel.id}`] : undefined;
  const savedDefaultThinkingLevel = thinkingLevelValue(mergedValue(layers, "defaultThinkingLevel"));
  const defaultThinkingLevel = initialThinking
    ?? (isThinkingLevel(perModelThinking) ? perModelThinking : undefined)
    ?? savedDefaultThinkingLevel
    ?? null;

  return jsonResponse({
    models,
    modelList,
    defaultModel: initialModel ? { provider: initialModel.provider, modelId: initialModel.id } : null,
    defaultThinkingLevel,
    savedDefaultThinkingLevel,
    thinkingLevels,
    thinkingLevelMaps,
    thinkingLevelPins: scope.pins,
    ...(catalog.modelError ? { modelError: catalog.modelError } : {}),
    ...(scope.warnings.length > 0 ? { modelScopeWarnings: scope.warnings } : {}),
    isScoped: scopeAll ? false : scope.scopedModels.length > 0,
  });
}

// ---------------------------------------------------------------------------
// PUT /api/models/default
// ---------------------------------------------------------------------------

interface DefaultEdit {
  model?: { provider: string; modelId: string };
  thinkingLevel?: ThinkingLevel;
}

function parseDefaultEdit(body: Record<string, unknown>): DefaultEdit | null {
  const edit: DefaultEdit = {};
  if (body.provider !== undefined || body.modelId !== undefined) {
    if (typeof body.provider !== "string" || !body.provider) return null;
    if (typeof body.modelId !== "string" || !body.modelId) return null;
    edit.model = { provider: body.provider, modelId: body.modelId };
  }
  if (body.thinkingLevel !== undefined) {
    if (!isThinkingLevel(body.thinkingLevel)) return null;
    edit.thinkingLevel = body.thinkingLevel;
  }
  return edit.model || edit.thinkingLevel ? edit : null;
}

async function putDefaultModel(request: LocalRequest): Promise<LocalResponse> {
  let body: unknown;
  try {
    body = JSON.parse(request.body ?? "");
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  if (!isRecord(body)) return errorResponse("Expected a JSON object", 400);
  const edit = parseDefaultEdit(body);
  if (!edit) return errorResponse("Expected provider and modelId, or a valid thinkingLevel", 400);

  let cwd: string | null = null;
  const rawCwd = typeof body.cwd === "string" && body.cwd ? body.cwd : request.params.get("cwd");
  if (rawCwd) {
    cwd = path.resolve(rawCwd);
    let info;
    try {
      info = await stat(cwd);
    } catch {
      return errorResponse(`Directory does not exist: ${cwd}`, 400);
    }
    if (!info.isDirectory()) return errorResponse(`Not a directory: ${cwd}`, 400);
  }

  if (cwd) {
    const project = await readProjectSettings(cwd);
    const shadowed: string[] = [];
    if (edit.model) {
      if (project.defaultProvider !== undefined) shadowed.push("defaultProvider");
      if (project.defaultModel !== undefined) shadowed.push("defaultModel");
    }
    if (edit.thinkingLevel && project.defaultThinkingLevel !== undefined) shadowed.push("defaultThinkingLevel");
    if (shadowed.length > 0) {
      const target = displayPath(projectSettingsPath(cwd));
      return errorResponse(
        `${target} sets ${shadowed.join(", ")} for this project, so a global default would not apply here.`,
        409,
        { reason: "project-scope", settingsPath: target, keys: shadowed },
      );
    }
  }

  if (edit.model) {
    const catalog = await buildCatalog();
    if (catalog.models.length > 0) {
      const layers = await readSettingsLayers(cwd);
      const patterns = patternsOf(mergedValue(layers, "enabledModels"));
      const scope = resolveVisibleScope(patterns, catalog.models);
      const { provider, modelId } = edit.model;
      if (!scope.visible.some((model) => model.provider === provider && model.id === modelId)) {
        return errorResponse(`Model not available: ${provider}/${modelId}`, 404);
      }
    }
  }

  await mutateGlobalSettings((_settings, text) => {
    let next = text;
    if (edit.model) {
      next = setKey(next, [], "defaultProvider", edit.model.provider);
      next = setKey(next, [], "defaultModel", edit.model.modelId);
    }
    if (edit.thinkingLevel) next = setKey(next, [], "defaultThinkingLevel", edit.thinkingLevel);
    return next;
  });

  return jsonResponse({
    ok: true,
    ...(edit.model ? { defaultModel: edit.model } : {}),
    ...(edit.thinkingLevel ? { defaultThinkingLevel: edit.thinkingLevel } : {}),
  });
}

// ---------------------------------------------------------------------------
// GET/PUT /api/models/enabled
// ---------------------------------------------------------------------------

interface CwdResolution {
  cwd: string | null;
  error?: LocalResponse;
}

async function resolveCwd(raw: string | null): Promise<CwdResolution> {
  if (!raw) return { cwd: null };
  const cwd = path.resolve(raw);
  let info;
  try {
    info = await stat(cwd);
  } catch {
    return { cwd, error: errorResponse(`Directory does not exist: ${cwd}`, 400) };
  }
  if (!info.isDirectory()) return { cwd, error: errorResponse(`Not a directory: ${cwd}`, 400) };
  return { cwd };
}

async function enabledContext(cwd: string | null): Promise<{
  catalog: Catalog;
  patterns: string[] | undefined;
  scope: "global" | "project";
  settingsFilePath: string;
  projectPatterns: unknown;
}> {
  const layers = await readSettingsLayers(cwd);
  const catalog = await buildCatalog();
  const projectPatterns = cwd ? layers.project.enabledModels : undefined;
  const scope = projectPatterns !== undefined ? "project" : "global";
  return {
    catalog,
    patterns: scope === "project" ? patternsOf(projectPatterns) : patternsOf(layers.global.enabledModels),
    scope,
    settingsFilePath: scope === "project" && cwd ? projectSettingsPath(cwd) : settingsPath(),
    projectPatterns,
  };
}

async function getEnabledModels(request: LocalRequest): Promise<LocalResponse> {
  const resolved = await resolveCwd(request.params.get("cwd"));
  if (resolved.error) return resolved.error;
  const context = await enabledContext(resolved.cwd);
  const input = await buildEnabledInput(context.patterns, context.catalog.models, false, context.catalog.knownModels);
  return jsonResponse(buildEnabledView(input, context.catalog, context.scope, context.settingsFilePath));
}

function renamePairs(value: unknown): { from: string; to: string }[] | null {
  if (!Array.isArray(value)) return null;
  const renames: { from: string; to: string }[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const { from, to } = entry;
    if (typeof from !== "string" || typeof to !== "string" || !from || !to) return null;
    renames.push({ from, to });
  }
  return renames;
}

async function resyncEnabledModels(
  input: EnabledModelsInput,
  models: readonly CatalogModel[],
  knownModels: readonly CatalogModel[],
  body: Record<string, unknown>,
): Promise<EnabledModelsEdit | LocalResponse> {
  const renames = renamePairs(body.renames);
  const modelRenames = renamePairs(body.modelRenames ?? []);
  const fullyEnabled = body.fullyEnabled === undefined
    ? []
    : isStringArray(body.fullyEnabled) ? body.fullyEnabled : null;
  if (!renames || !modelRenames || !fullyEnabled) return errorResponse("Invalid resync payload", 400);

  const original = input.patterns;
  const renamed = renameProviderPatterns(renameModelPatterns(original, modelRenames), renames);
  let current = renamed === original ? input : await buildEnabledInput(renamed, models, true, knownModels);
  const constrained = constrainProviderEntries(current);
  if (constrained.ok && constrained.changed) current = await buildEnabledInput(constrained.patterns, models, true, knownModels);

  const refs = fullyEnabled
    .map((id) => renames.find((rename) => rename.from === id)?.to ?? id)
    .flatMap((id) => models.filter((model) => model.provider === id).map((model) => modelRef(model.provider, model.id)));
  const edit = setModelsEnabled(current, refs, true);
  if (!edit.ok) return edit;
  return { ok: true, patterns: edit.patterns, changed: !samePatterns(edit.patterns, original) };
}

async function putEnabledModels(request: LocalRequest): Promise<LocalResponse> {
  let body: unknown;
  try {
    body = JSON.parse(request.body ?? "");
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  if (!isRecord(body)) return errorResponse("Invalid JSON body", 400);
  const op = body.op;
  if (op !== "models" && op !== "provider" && op !== "clear" && op !== "prune" && op !== "resync") {
    return errorResponse("Invalid op", 400);
  }
  if ((op === "models" || op === "provider") && typeof body.enabled !== "boolean") {
    return errorResponse("enabled must be a boolean", 400);
  }
  if (body.cwd !== undefined && typeof body.cwd !== "string") return errorResponse("Invalid cwd", 400);

  const resolved = await resolveCwd(typeof body.cwd === "string" ? body.cwd : null);
  if (resolved.error) return resolved.error;
  const context = await enabledContext(resolved.cwd);
  if (context.scope === "project") {
    return errorResponse("Project settings override enabledModels", 409, { reason: "project-scope" });
  }

  const input = await buildEnabledInput(context.patterns, context.catalog.models, true, context.catalog.knownModels);
  let edit: EnabledModelsEdit | LocalResponse;
  if (op === "clear") {
    edit = clearEnabledModels(input);
  } else if (op === "prune") {
    edit = pruneStaleEnabledModels(input);
  } else if (op === "resync") {
    edit = await resyncEnabledModels(input, context.catalog.models, context.catalog.knownModels, body);
  } else {
    let refs: string[];
    if (op === "provider") {
      if (typeof body.provider !== "string" || !body.provider) return errorResponse("provider is required", 400);
      refs = context.catalog.models
        .filter((model) => model.provider === body.provider)
        .map((model) => modelRef(model.provider, model.id));
    } else {
      if (!isStringArray(body.refs)) return errorResponse("refs must be an array of strings", 400);
      refs = body.refs;
    }
    edit = setModelsEnabled(input, refs, body.enabled === true);
  }

  if (!("ok" in edit)) return edit;
  if (!edit.ok) {
    return errorResponse("At least one model must stay enabled", 409, { reason: edit.reason });
  }
  if (edit.changed) {
    const patterns = edit.patterns;
    await mutateGlobalSettings((_settings, text) => (
      patterns === undefined
        ? deleteKey(text, [], "enabledModels")
        : setKey(text, [], "enabledModels", patterns)
    ));
  }

  const nextInput = await buildEnabledInput(edit.patterns, context.catalog.models, false, context.catalog.knownModels);
  return jsonResponse(buildEnabledView(nextInput, context.catalog, "global", settingsPath()));
}

// ---------------------------------------------------------------------------
// `/api/tools/settings`: PowerShell + codemode
// ---------------------------------------------------------------------------

const CODEMODE = "codemode";
const DEFAULT_TOOLS = ["read", "bash", "edit", "write"];
const SHELL_TOOLS = new Set(["bash", "powershell"]);
const CODEMODE_INLINE_BUDGET_MAX = 1_000_000;
const INVALID_VALUE_MAX_CHARS = 60;

type CodemodePreference = "automatic" | "always";
type CodemodeMode = "on" | "only";

function isWindowsPlatform(): boolean {
  return (process.platform as string) === "windows";
}

function isToolModifier(entry: string): boolean {
  return entry.startsWith("+") || entry.startsWith("-");
}

function namesCodemode(entry: string): boolean {
  return (isToolModifier(entry) ? entry.slice(1) : entry) === CODEMODE;
}

function resolveDefaultToolEntries(entries: readonly string[]): string[] {
  const plain = entries.filter((entry) => !isToolModifier(entry));
  const tools = plain.length > 0 || entries.length === 0 ? plain : [...DEFAULT_TOOLS];
  for (const entry of entries) {
    if (!isToolModifier(entry)) continue;
    const name = entry.slice(1);
    const index = tools.indexOf(name);
    if (entry.startsWith("+") && index === -1 && name) tools.push(name);
    else if (entry.startsWith("-") && index !== -1) tools.splice(index, 1);
  }
  return tools;
}

function defaultToolEntries(settings: Record<string, unknown>): string[] | undefined {
  const value = settings.defaultTools;
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error("Invalid settings.json: defaultTools must be an array of strings");
  }
  return [...value as string[]];
}

function codemodePreferenceOf(entries: readonly string[] | undefined): CodemodePreference {
  return entries !== undefined && resolveDefaultToolEntries(entries).includes(CODEMODE) ? "always" : "automatic";
}

function withCodemodePreference(entries: readonly string[] | undefined, preference: CodemodePreference): string[] | undefined {
  const kept = (entries ?? []).filter((entry) => !namesCodemode(entry));
  if (preference === "always") return [...kept, `+${CODEMODE}`];
  if (kept.length > 0) return kept;
  return entries !== undefined && entries.some((entry) => !isToolModifier(entry)) ? [] : undefined;
}

function codemodeValueOf(settings: Record<string, unknown>, key: "mode" | "inlineBudget"): unknown {
  return isRecord(settings.codemode) ? settings.codemode[key] : undefined;
}

function invalidValueText(raw: unknown): string {
  const json = JSON.stringify(raw) ?? String(raw);
  return json.length > INVALID_VALUE_MAX_CHARS ? `${json.slice(0, INVALID_VALUE_MAX_CHARS - 1)}…` : json;
}

function codemodeModeOf(settings: Record<string, unknown>): { value: CodemodeMode; invalid?: string } {
  const raw = codemodeValueOf(settings, "mode");
  if (raw === "only") return { value: "only" };
  if (raw === undefined || raw === "on") return { value: "on" };
  return { value: "on", invalid: invalidValueText(raw) };
}

function codemodeInlineBudgetOf(settings: Record<string, unknown>): { value?: number; invalid?: string } {
  const raw = codemodeValueOf(settings, "inlineBudget");
  if (raw === undefined) return {};
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return { value: raw };
  return { invalid: invalidValueText(raw) };
}

function isCodemodeMode(value: unknown): value is CodemodeMode {
  return value === "on" || value === "only";
}

function isCodemodePreference(value: unknown): value is CodemodePreference {
  return value === "automatic" || value === "always";
}

function isCodemodeInlineBudget(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= CODEMODE_INLINE_BUDGET_MAX;
}

function replaceShellTool(toolNames: readonly string[], usePowerShell: boolean): string[] {
  const shell = usePowerShell ? "powershell" : "bash";
  const result: string[] = [];
  for (const name of toolNames) {
    const next = SHELL_TOOLS.has(name) ? shell : name;
    if (!result.includes(next)) result.push(next);
  }
  return result;
}

async function readToolSettings(): Promise<Record<string, unknown>> {
  const settings = await readGlobalSettings();
  const entries = defaultToolEntries(settings);
  const resolved = entries === undefined ? undefined : resolveDefaultToolEntries(entries);
  const powerShellEnabled = isWindowsPlatform()
    && resolved?.includes("powershell") === true
    && !resolved.includes("bash");
  const codemode = codemodePreferenceOf(entries);
  return {
    isWindows: isWindowsPlatform(),
    powerShellEnabled,
    codemode,
    codemodeMode: codemodeModeOf(settings),
    codemodeInlineBudget: codemodeInlineBudgetOf(settings),
  };
}

function toolRefusal(status: number, reason: string, message: string): LocalResponse {
  return errorResponse(message, status, { reason });
}

async function writeCodemodeValue(
  key: "mode" | "inlineBudget",
  value: unknown,
  unchanged: (stored: unknown) => boolean,
): Promise<void> {
  const stored = codemodeValueOf(await readGlobalSettings(), key);
  if (unchanged(stored)) return;
  await mutateGlobalSettings((settings, text) => {
    const codemode = settings.codemode;
    if (codemode !== undefined && !isRecord(codemode)) {
      throw new Error("Invalid settings.json: codemode must be an object");
    }
    if (value !== undefined) return setKey(text, ["codemode"], key, value);
    if (!isRecord(codemode)) return text;
    const others = Object.keys(codemode).filter((entry) => entry !== key);
    if (others.length === 0) return deleteKey(text, [], "codemode");
    return deleteKey(text, ["codemode"], key);
  });
}

async function getToolSettings(): Promise<LocalResponse> {
  try {
    return jsonResponse(await readToolSettings());
  } catch (cause) {
    return toolRefusal(500, "internal", describe(cause));
  }
}

async function putToolSettings(request: LocalRequest): Promise<LocalResponse> {
  if (!/application\/json/i.test(request.headers["content-type"] ?? "")) {
    return toolRefusal(415, "content-type", "Content-Type must be application/json");
  }
  let body: unknown;
  try {
    body = JSON.parse(request.body ?? "");
  } catch {
    return toolRefusal(400, "invalid-request", "Invalid JSON body");
  }
  if (!isRecord(body)) return toolRefusal(400, "invalid-request", "Expected a JSON object");
  const changes = body;
  const present = ["enabled", "codemode", "codemodeMode", "codemodeInlineBudget"].filter((key) => key in changes);
  if (present.length !== 1) {
    return toolRefusal(400, "invalid-request", "Send one of enabled (PowerShell), codemode, codemodeMode or codemodeInlineBudget");
  }

  try {
    if ("codemodeMode" in changes) {
      if (!isCodemodeMode(changes.codemodeMode)) {
        return toolRefusal(400, "invalid-request", 'codemodeMode must be "on" or "only"');
      }
      const mode = changes.codemodeMode;
      await writeCodemodeValue(
        "mode",
        mode === "only" ? "only" : undefined,
        (stored) => (mode === "only" ? stored === "only" : stored === undefined || stored === "on"),
      );
      return jsonResponse(await readToolSettings());
    }

    if ("codemodeInlineBudget" in changes) {
      const budget = changes.codemodeInlineBudget;
      if (budget !== null && !isCodemodeInlineBudget(budget)) {
        return toolRefusal(
          400,
          "invalid-request",
          `codemodeInlineBudget must be a whole number from 0 to ${CODEMODE_INLINE_BUDGET_MAX}, or null`,
        );
      }
      const value = budget === null ? undefined : budget;
      await writeCodemodeValue("inlineBudget", value, (stored) => stored === value);
      return jsonResponse(await readToolSettings());
    }

    if ("codemode" in changes) {
      if (!isCodemodePreference(changes.codemode)) {
        return toolRefusal(400, "invalid-request", 'codemode must be "automatic" or "always"');
      }
      const preference = changes.codemode;
      const current = codemodePreferenceOf(defaultToolEntries(await readGlobalSettings()));
      if (current !== preference) {
        await mutateGlobalSettings((settings, text) => {
          const next = withCodemodePreference(defaultToolEntries(settings), preference);
          return next === undefined
            ? deleteKey(text, [], "defaultTools")
            : setKey(text, [], "defaultTools", next);
        });
      }
      return jsonResponse(await readToolSettings());
    }

    if (!isWindowsPlatform()) {
      return toolRefusal(404, "invalid-request", "PowerShell tool settings are only available on Windows");
    }
    if (typeof changes.enabled !== "boolean") {
      return toolRefusal(400, "invalid-request", "enabled must be a boolean");
    }
    const enabled = changes.enabled;
    await mutateGlobalSettings((settings, text) => {
      const entries = defaultToolEntries(settings);
      const currentTools = entries === undefined ? DEFAULT_TOOLS : resolveDefaultToolEntries(entries);
      const nextTools = replaceShellTool(currentTools, enabled);
      if (!currentTools.some((name) => SHELL_TOOLS.has(name))) {
        nextTools.push(enabled ? "powershell" : "bash");
      }
      return setKey(text, [], "defaultTools", nextTools);
    });
    return jsonResponse(await readToolSettings());
  } catch (cause) {
    return toolRefusal(500, "internal", describe(cause));
  }
}

// ---------------------------------------------------------------------------
// `/api/cache-miss-notices`
// ---------------------------------------------------------------------------

const CACHE_MISS_KEY = "showCacheMissNotices";

async function getCacheMissNotices(): Promise<LocalResponse> {
  try {
    const settings = await readGlobalSettings();
    return jsonResponse({ enabled: settings[CACHE_MISS_KEY] === true });
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
}

async function putCacheMissNotices(request: LocalRequest): Promise<LocalResponse> {
  if (!/application\/json/i.test(request.headers["content-type"] ?? "")) {
    return errorResponse("Content-Type must be application/json", 415);
  }
  let body: unknown;
  try {
    body = JSON.parse(request.body ?? "");
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  const enabled = isRecord(body) ? body.enabled : undefined;
  if (typeof enabled !== "boolean") return errorResponse("enabled must be a boolean", 400);
  try {
    if (!enabled && !(await pathExists(settingsPath()))) return jsonResponse({ enabled: false });
    await mutateGlobalSettings((_settings, text) => (
      enabled
        ? setKey(text, [], CACHE_MISS_KEY, true)
        : deleteKey(text, [], CACHE_MISS_KEY)
    ));
    return jsonResponse({ enabled: (await readGlobalSettings())[CACHE_MISS_KEY] === true });
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
}

// ---------------------------------------------------------------------------
// `/api/ui-preferences`
// ---------------------------------------------------------------------------

const UI_PREFERENCES_VERSION = 1;
const MAX_PREFERENCE_KEY_LENGTH = 120;
const MAX_PREFERENCE_VALUE_LENGTH = 4096;
const MAX_PREFERENCE_ENTRIES = 400;

interface UiPreferenceEntry {
  value: string;
  updatedAt: number;
}

interface UiPreferencesFile {
  version: 1;
  preferences: Record<string, UiPreferenceEntry>;
}

function emptyUiPreferences(): UiPreferencesFile {
  return { version: UI_PREFERENCES_VERSION, preferences: {} };
}

function isValidPreferenceKey(key: string): boolean {
  return key.length > 0
    && key.length <= MAX_PREFERENCE_KEY_LENGTH
    && /^[a-zA-Z0-9._:-]+$/.test(key);
}

function validPreferenceValue(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_PREFERENCE_VALUE_LENGTH;
}

function readUiPreferencesFile(text: string | null): UiPreferencesFile {
  if (text === null) return emptyUiPreferences();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyUiPreferences();
  }
  if (!isRecord(parsed) || !isRecord(parsed.preferences)) return emptyUiPreferences();
  const preferences: Record<string, UiPreferenceEntry> = {};
  for (const [key, entry] of Object.entries(parsed.preferences)) {
    if (!isRecord(entry) || typeof entry.value !== "string") continue;
    if (!isValidPreferenceKey(key) || entry.value.length > MAX_PREFERENCE_VALUE_LENGTH) continue;
    const updatedAt = typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0;
    preferences[key] = { value: entry.value, updatedAt };
  }
  return { version: UI_PREFERENCES_VERSION, preferences };
}

function uiPreferencesResponse(value: UiPreferencesFile): LocalResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify(value),
  };
}

async function getUiPreferences(): Promise<LocalResponse> {
  const text = await readText(uiPreferencesPath());
  return uiPreferencesResponse(readUiPreferencesFile(text));
}

async function putUiPreferences(request: LocalRequest): Promise<LocalResponse> {
  if (!/application\/json/i.test(request.headers["content-type"] ?? "")) {
    return errorResponse("Content-Type must be application/json", 415);
  }
  let body: unknown;
  try {
    body = JSON.parse(request.body ?? "");
  } catch {
    return errorResponse("invalid JSON body", 400);
  }
  if (!isRecord(body)) return errorResponse("body must be an object of key/value pairs", 400);

  const keys = Object.keys(body);
  const patch: { key: string; value: string }[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (!isValidPreferenceKey(key) || !validPreferenceValue(value)) continue;
    patch.push({ key, value });
  }
  if (patch.length !== keys.length) {
    const rejected = keys.filter((key) => !isValidPreferenceKey(key) || patch.every((entry) => entry.key !== key));
    return errorResponse(`invalid preference key(s): ${rejected.join(", ")}`, 400);
  }
  if (patch.length === 0) return uiPreferencesResponse(readUiPreferencesFile(await readText(uiPreferencesPath())));

  const target = uiPreferencesPath();
  let saved = emptyUiPreferences();
  await withFileLock(target, async () => {
    const now = Date.now();
    const current = readUiPreferencesFile(await readText(target));
    const preferences = { ...current.preferences };
    for (const { key, value } of patch) {
      const existing = preferences[key];
      if (existing && existing.updatedAt > now) continue;
      preferences[key] = { value, updatedAt: now };
    }
    const entries = Object.entries(preferences);
    if (entries.length > MAX_PREFERENCE_ENTRIES) {
      entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
      for (const [key] of entries.slice(MAX_PREFERENCE_ENTRIES)) delete preferences[key];
    }
    saved = { version: UI_PREFERENCES_VERSION, preferences };
    await writeAtomic(target, `${JSON.stringify(saved, null, 2)}\n`);
  });
  return uiPreferencesResponse(saved);
}

// ---------------------------------------------------------------------------
// `/api/subagents/settings`
// ---------------------------------------------------------------------------

const DEFAULT_SUBAGENT_MAX_CONCURRENT = 10;
const MAX_SUBAGENT_MAX_CONCURRENT = 32;

function readMaxConcurrent(value: unknown): number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 1
    && value <= MAX_SUBAGENT_MAX_CONCURRENT
    ? value
    : DEFAULT_SUBAGENT_MAX_CONCURRENT;
}

function readDisabledBuiltIns(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const name = entry.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

interface StoredSubagentSettings {
  builtInEnabled: boolean;
  maxConcurrent: number;
  disabledBuiltIns: string[];
}

async function readStoredSubagentSettings(strict: boolean): Promise<StoredSubagentSettings> {
  const target = subagentSettingsPath();
  const fallback: StoredSubagentSettings = {
    builtInEnabled: false,
    maxConcurrent: DEFAULT_SUBAGENT_MAX_CONCURRENT,
    disabledBuiltIns: [],
  };
  let text: string | null;
  try {
    text = await readText(target);
  } catch (cause) {
    if (!strict) return fallback;
    throw cause;
  }
  if (text === null) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    if (!strict) return fallback;
    throw new Error(`${target}: ${describe(cause)}`);
  }
  if (!isRecord(parsed)) {
    if (!strict) return fallback;
    throw new Error("Invalid subagent settings: expected an object");
  }
  return {
    builtInEnabled: parsed.builtInEnabled === true,
    maxConcurrent: readMaxConcurrent(parsed.maxConcurrent),
    disabledBuiltIns: readDisabledBuiltIns(parsed.disabledBuiltIns),
  };
}

function subagentSettingsBody(settings: StoredSubagentSettings): Record<string, unknown> {
  return { enabled: settings.builtInEnabled, maxConcurrent: settings.maxConcurrent };
}

async function getSubagentSettings(): Promise<LocalResponse> {
  try {
    return jsonResponse(subagentSettingsBody(await readStoredSubagentSettings(true)));
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
}

async function putSubagentSettings(request: LocalRequest): Promise<LocalResponse> {
  if (!/application\/json/i.test(request.headers["content-type"] ?? "")) {
    return errorResponse("Content-Type must be application/json", 415);
  }
  let body: unknown;
  try {
    body = JSON.parse(request.body ?? "");
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }
  if (!isRecord(body)) return errorResponse("Invalid JSON body", 400);
  if (body.enabled === undefined && body.maxConcurrent === undefined) {
    return errorResponse("enabled or maxConcurrent is required", 400);
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return errorResponse("enabled must be a boolean", 400);
  }
  if (body.maxConcurrent !== undefined && (
    typeof body.maxConcurrent !== "number"
    || !Number.isInteger(body.maxConcurrent)
    || body.maxConcurrent < 1
    || body.maxConcurrent > MAX_SUBAGENT_MAX_CONCURRENT
  )) {
    return errorResponse(`maxConcurrent must be an integer between 1 and ${MAX_SUBAGENT_MAX_CONCURRENT}`, 400);
  }

  try {
    // Read it first so a broken file is reported instead of being overwritten.
    await readStoredSubagentSettings(true);
    await updateTextFile(subagentSettingsPath(), (text) => {
      // The file is strict JSON (pi reads it with JSON.parse); a broken one is
      // reported rather than overwritten.
      if (text.trim() !== "") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (cause) {
          throw new Error(`${subagentSettingsPath()}: ${describe(cause)}`);
        }
        if (!isRecord(parsed)) throw new Error("Invalid subagent settings: expected an object");
      }
      let next = setKey(text, [], "version", 1);
      if (body.enabled !== undefined) next = setKey(next, [], "builtInEnabled", body.enabled);
      if (body.maxConcurrent !== undefined) next = setKey(next, [], "maxConcurrent", body.maxConcurrent);
      return next;
    });
    return jsonResponse(subagentSettingsBody(await readStoredSubagentSettings(true)));
  } catch (cause) {
    return errorResponse(describe(cause), 500);
  }
}

// ---------------------------------------------------------------------------
// GET /api/subagents/profiles: Markdown profiles with YAML frontmatter
// ---------------------------------------------------------------------------

const SUBAGENT_DEFAULT_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];
const SUBAGENT_READ_ONLY_TOOLS = ["read", "grep", "find", "ls"];
const SUBAGENT_BUILTIN_TOOLS = new Set(SUBAGENT_DEFAULT_TOOLS);
const SUBAGENT_THINKING_LEVELS = new Set<string>(THINKING_LEVELS);
const OWNED_ALIAS_VALUES = new Set(["none", "all", "true", "false"]);

interface SubagentProfileView {
  name: string;
  displayName: string;
  description: string;
  systemPrompt?: string;
  tools?: string[];
  extensionTools?: string[];
  disallowedExtensionTools?: string[];
  skills?: string[];
  extensions?: string[];
  loadSkills?: boolean;
  loadExtensions?: boolean;
  codemode?: "inherit" | "on" | "off";
  mcp?: "on" | "off";
  model?: string;
  thinking?: string;
  maxTurns?: number;
  inheritContext?: boolean;
  runInBackground?: boolean;
  promptMode?: "replace" | "append";
  color?: string;
  isolation?: "worktree" | "off";
  persistSession?: boolean;
  enabled: boolean;
  scope: "builtin" | "global" | "workspace" | "project";
  filePath?: string;
}

function builtInProfiles(): SubagentProfileView[] {
  const common = {
    loadSkills: false,
    loadExtensions: false,
    codemode: "off" as const,
    mcp: "off" as const,
    promptMode: "append" as const,
    inheritContext: false,
    runInBackground: false,
    enabled: true,
    scope: "builtin" as const,
  };
  return [
    {
      ...common,
      name: "general-purpose",
      displayName: "General purpose",
      description: "Handle a focused implementation or investigation task",
      systemPrompt: "Work autonomously on the delegated task. Keep the final answer concise and include important files, decisions, and remaining risks.",
      tools: [...SUBAGENT_DEFAULT_TOOLS],
    },
    {
      ...common,
      name: "explore",
      displayName: "Explore",
      description: "Quickly inspect a codebase without modifying it",
      systemPrompt: "Explore the codebase to answer the delegated question. Do not modify files. Report concrete findings with file paths and relevant symbols.",
      tools: [...SUBAGENT_READ_ONLY_TOOLS],
    },
    {
      ...common,
      name: "plan",
      displayName: "Plan",
      description: "Design an implementation plan without modifying files",
      systemPrompt: "Produce an implementation-ready plan for the delegated task. Inspect the repository as needed, do not modify files, and call out dependencies, risks, and verification steps.",
      tools: [...SUBAGENT_READ_ONLY_TOOLS],
    },
  ];
}

interface Frontmatter {
  data: Record<string, unknown>;
  rest: string;
}

function stripYamlComment(value: string): string {
  let quote: string | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const ch = value[index];
    if (quote) {
      if (ch === "\\" && quote === '"') index += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "#" && (index === 0 || /\s/.test(value[index - 1]))) return value.slice(0, index).trimEnd();
  }
  return value;
}

function yamlScalar(raw: string): unknown {
  const value = stripYamlComment(raw).trim();
  if (value === "") return null;
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((entry) => yamlScalar(entry.trim()));
  }
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const body = value.slice(1, -1);
    if (value[0] === "'") return body.replace(/''/g, "'");
    try {
      return JSON.parse(value) as string;
    } catch {
      return body.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  }
  const lower = value.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  if (lower === "null" || value === "~") return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/** The subset of YAML frontmatter the agent profiles use: scalars, inline and block lists. */
function parseSimpleYaml(source: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  let listKey: string | null = null;
  for (const rawLine of source.split(/\r\n|\n|\r/)) {
    const line = rawLine.replace(/\t/g, "  ");
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      const current = data[listKey];
      const list = Array.isArray(current) ? current : [];
      list.push(yamlScalar(item[1]));
      data[listKey] = list;
      continue;
    }
    const pair = /^\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key = pair[1];
    const rest = pair[2].trim();
    if (rest === "") {
      // `key:` before a block list; with no items it stays null, as YAML reads it.
      listKey = key;
      data[key] = null;
    } else {
      listKey = null;
      data[key] = yamlScalar(rest);
    }
  }
  return data;
}

function parseFrontmatter(markdown: string): Frontmatter {
  const opening = /^(?:\uFEFF)?---[ \t]*(?:\r\n|\n|\r)/.exec(markdown);
  if (!opening) return { data: {}, rest: markdown };
  const closingPattern = /^---[ \t]*(?:(?:\r\n|\n|\r)|$)/gm;
  closingPattern.lastIndex = opening[0].length;
  const closing = closingPattern.exec(markdown);
  if (!closing) return { data: {}, rest: markdown };
  const yaml = markdown.slice(opening[0].length, closing.index).replace(/(?:\r\n|\n|\r)$/, "");
  return { data: parseSimpleYaml(yaml), rest: markdown.slice(closing.index + closing[0].length) };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function resourceBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return Array.isArray(value) || typeof value === "string" ? true : fallback;
}

function subagentNameList(value: unknown): string[] {
  const items: unknown[] = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return [...new Set(items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))];
}

function profileNameList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return subagentNameList(value);
  if (typeof value !== "string" || OWNED_ALIAS_VALUES.has(value.trim().toLowerCase())) return undefined;
  const names = subagentNameList(value);
  return names.length > 0 ? names : undefined;
}

function profileExtensions(value: unknown): string[] | undefined {
  const names = profileNameList(value);
  return names?.includes("*") ? undefined : names;
}

function profileResourceSwitch(value: unknown, fallback: boolean): boolean {
  if (typeof value === "string" && ["none", "false"].includes(value.trim().toLowerCase())) return false;
  return resourceBoolean(value, fallback);
}

function stringList(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function parseProfileTools(value: unknown, fallback: string[]): string[] {
  const tools = stringList(value);
  if (tools.includes("none")) return [];
  if (tools.includes("all") || tools.includes("*")) return [...SUBAGENT_DEFAULT_TOOLS];
  if (tools.length === 0) return [...fallback];
  return [...new Set(tools.filter((tool) => SUBAGENT_BUILTIN_TOOLS.has(tool)))];
}

function parseExtensionToolSelectors(value: unknown): string[] {
  return [...new Set(stringList(value).filter((tool) => tool.toLowerCase().startsWith("ext:")))];
}

function normalizeExtensionSelector(selector: string): string {
  const body = selector.slice(4).trim().replace(/\/+$/, "");
  return body.endsWith("/*") ? body.slice(0, -2) : body;
}

function parseCodemode(value: unknown): "inherit" | "on" | "off" {
  if (value === "on" || value === true) return "on";
  if (value === "inherit") return "inherit";
  return "off";
}

function parseProfileFile(source: string, filePath: string, scope: "global" | "workspace" | "project"): SubagentProfileView | null {
  try {
    const { data, rest } = parseFrontmatter(source);
    const name = stringValue(data.name) ?? path.basename(filePath, ".md");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) return null;
    const tools = parseProfileTools(data.tools, SUBAGENT_DEFAULT_TOOLS);
    const skills = profileNameList(data.skills);
    const extensions = profileExtensions(data.extensions);
    const disallowedTools = new Set(parseProfileTools(data.disallowed_tools, []));
    const disallowedExtensionTools = parseExtensionToolSelectors(data.disallowed_tools);
    const deniedKeys = new Set(disallowedExtensionTools.map((tool) => normalizeExtensionSelector(tool).toLowerCase()));
    const extensionSelectors = parseExtensionToolSelectors(data.tools);
    const extensionTools = extensionSelectors.filter((tool) => {
      const allowed = normalizeExtensionSelector(tool).toLowerCase();
      return ![...deniedKeys].some((denied) => (
        denied === "*" || allowed === denied || allowed.startsWith(`${denied}/`)
      ));
    });
    const maxTurns = typeof data.max_turns === "number" ? Math.floor(data.max_turns) : undefined;
    const thinking = stringValue(data.thinking);
    return {
      name,
      displayName: stringValue(data.display_name) ?? name,
      description: stringValue(data.description) ?? name,
      systemPrompt: rest.trim(),
      tools: tools.filter((tool) => !disallowedTools.has(tool)),
      ...(extensionSelectors.length > 0 ? { extensionTools } : {}),
      ...(disallowedExtensionTools.length > 0 ? { disallowedExtensionTools } : {}),
      ...(skills !== undefined ? { skills } : {}),
      ...(extensions !== undefined ? { extensions } : {}),
      loadSkills: profileResourceSwitch(data.load_skills ?? data.skills, false),
      loadExtensions: profileResourceSwitch(data.load_extensions ?? data.extensions, extensionSelectors.length > 0),
      codemode: parseCodemode(data.codemode),
      mcp: data.mcp === "on" || data.mcp === true ? "on" : "off",
      ...(stringValue(data.model) ? { model: stringValue(data.model) } : {}),
      ...(thinking && SUBAGENT_THINKING_LEVELS.has(thinking) ? { thinking } : {}),
      ...(maxTurns && maxTurns > 0 ? { maxTurns } : {}),
      inheritContext: booleanValue(data.inherit_context, false),
      runInBackground: booleanValue(data.run_in_background, false),
      promptMode: data.prompt_mode === "replace" ? "replace" : "append",
      ...(stringValue(data.color) ? { color: stringValue(data.color) } : {}),
      ...(data.isolation === "worktree" || data.isolation === "off" ? { isolation: data.isolation } : {}),
      ...(typeof data.persist_session === "boolean" ? { persistSession: data.persist_session } : {}),
      enabled: booleanValue(data.enabled, true),
      scope,
      filePath,
    };
  } catch {
    return null;
  }
}

async function readProfileDirectory(
  directory: string,
  scope: "global" | "workspace" | "project",
): Promise<SubagentProfileView[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const profiles: SubagentProfileView[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const filePath = path.join(directory, name);
    try {
      if (!(await lstat(filePath)).isFile()) continue;
    } catch {
      continue;
    }
    const source = await readText(filePath).catch(() => null);
    if (source === null) continue;
    const profile = parseProfileFile(source, filePath, scope);
    if (profile) profiles.push(profile);
  }
  return profiles;
}

async function getSubagentProfiles(request: LocalRequest): Promise<LocalResponse> {
  const rawCwd = request.params.get("cwd");
  if (!rawCwd) return errorResponse("Valid cwd required", 400);
  const cwd = path.resolve(rawCwd);
  let info;
  try {
    info = await stat(cwd);
  } catch {
    return errorResponse("Valid cwd required", 400);
  }
  if (!info.isDirectory()) return errorResponse("Valid cwd required", 400);

  const settings = await readStoredSubagentSettings(false);
  const disabled = new Set(settings.disabledBuiltIns.map((name) => name.toLowerCase()));
  const profiles = builtInProfiles().map((profile) => ({
    ...profile,
    enabled: !disabled.has(profile.name.toLowerCase()),
  }));
  profiles.push(...await readProfileDirectory(path.join(piAgentDirectory(), "agents"), "global"));
  profiles.push(...await readProfileDirectory(path.join(cwd, ".agents", "agents"), "workspace"));
  profiles.push(...await readProfileDirectory(path.join(cwd, ".pi", "agents"), "project"));
  profiles.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return jsonResponse({ profiles });
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function pathIs(request: LocalRequest, ...parts: string[]): boolean {
  if (request.segments.length !== parts.length + 1) return false;
  return parts.every((part, index) => request.segments[index + 1] === part);
}

export async function handleSettings(request: LocalRequest): Promise<LocalResponse | null> {
  const { method } = request;

  if (pathIs(request, "models")) {
    if (method === "GET") return getModels(request);
    return null;
  }
  if (pathIs(request, "models", "default")) {
    if (method === "PUT") return putDefaultModel(request);
    return null;
  }
  if (pathIs(request, "models", "enabled")) {
    if (method === "GET") return getEnabledModels(request);
    if (method === "PUT") return putEnabledModels(request);
    return null;
  }
  if (pathIs(request, "tools", "settings")) {
    if (method === "GET") return getToolSettings();
    if (method === "PUT") return putToolSettings(request);
    return null;
  }
  if (pathIs(request, "cache-miss-notices")) {
    if (method === "GET") return getCacheMissNotices();
    if (method === "PUT") return putCacheMissNotices(request);
    return null;
  }
  if (pathIs(request, "ui-preferences")) {
    if (method === "GET") return getUiPreferences();
    if (method === "PUT") return putUiPreferences(request);
    return null;
  }
  if (pathIs(request, "subagents", "settings")) {
    if (method === "GET") return getSubagentSettings();
    if (method === "PUT") return putSubagentSettings(request);
    return null;
  }
  if (pathIs(request, "subagents", "profiles")) {
    if (method === "GET") return getSubagentProfiles(request);
    return null;
  }

  // `/api/mcp/**`, `/api/skills/**`, `/api/plugins/**`, `/api/auth/**`,
  // `/api/models-config/**`, `/api/terminal/**`, `/api/bot-channel/**`,
  // `/api/lan/**`, `/api/provider-usage/**`, `/api/app-update`,
  // `/api/project-trust` and the per-session `/api/cache-miss` reads stay
  // with the pipe.
  return null;
}
