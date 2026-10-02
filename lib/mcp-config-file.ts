/**
 * fork:pr11-mcp — `mcp.json` access built on pi 1.0's official config primitives.
 *
 * This module used to be a private JSON reader/writer. It now forwards every
 * server-map read/edit to the SDK internals exported by `lib/pi-sdk-internals.ts`
 * (`loadMcpConfig` / `addMcpServerConfig` / `updateMcpServerConfig` /
 * `removeMcpServerConfig`), so pi.web and the `pi` CLI share one config dialect:
 * `enabled` (not `disabled`), exposure aliases, legacy-SSE rejection, name
 * validation, and the same project-over-global precedence.
 *
 * Two invariants the SDK editors do **not** provide are kept here on purpose:
 *   - **0600 + atomic replace**: the SDK's `editMcpServers` uses a plain
 *     `writeFileSync`. `mcp.json` carries env values and headers, so every edit
 *     runs against a private staging copy in the same directory and only a
 *     `renameSync` (0600) puts it in place — callers can never observe a
 *     half-written file.
 *   - **no parser text in errors**: V8 quotes the offending input in JSON parse
 *     errors; a malformed file throws a plain `malformed JSON` here so route
 *     error responses can never echo config contents.
 *
 * The loader is async because the SDK internals are loaded by file URL
 * (`loadMcpConfig` and friends are not exported from the package root).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import {
  loadPiSdkInternals,
  type LoadedMcpConfig,
  type McpServerConfig,
  type McpServerConfigPatch,
  type McpServerEntry,
  type PiSdkInternals,
} from "./pi-sdk-internals";

export interface McpConfigFileLoad extends LoadedMcpConfig {
  /** Whether the config file itself exists (a missing file is an empty config, not an error). */
  exists: boolean;
}

export interface McpConfigFileContext {
  agentDir: string;
  cwd: string;
  projectTrusted: boolean;
}

async function requireInternals(): Promise<PiSdkInternals> {
  const result = await loadPiSdkInternals();
  if (!result.ok) throw new Error(`MCP config is unavailable: ${result.reason}`);
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether the file parses as a JSON object; parse details are deliberately dropped. */
function parsesAsConfig(file: string): boolean {
  if (!existsSync(file)) return true;
  try {
    return isRecord(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return false;
  }
}

/**
 * Replace parse-error strings (`<path>: Unexpected token '…' in JSON…`) with a
 * constant label. The value of the offending config must never reach a response.
 */
function sanitizeErrors(files: string[], errors: string[]): string[] {
  const malformed = files.filter((file) => !parsesAsConfig(file));
  if (malformed.length === 0) return errors;
  return errors.map((error) => {
    const file = malformed.find((candidate) => error.startsWith(`${candidate}:`));
    return file ? `${file}: malformed JSON` : error;
  });
}

/** Global and (when trusted) project config, in pi's precedence order. */
export async function loadMcpConfigFiles(context: McpConfigFileContext): Promise<LoadedMcpConfig> {
  const internals = await requireInternals();
  const loaded = internals.loadMcpConfig(context);
  return {
    ...loaded,
    errors: sanitizeErrors(
      [join(context.agentDir, "mcp.json"), join(context.cwd, ".pi", "mcp.json")],
      loaded.errors,
    ),
  };
}

/**
 * Context for reading one config file through `loadMcpConfig`, which otherwise
 * always reads a global + project pair. A project file is read as the project
 * half; the sentinel global path never exists, so only that file contributes.
 */
function contextForFile(file: string): McpConfigFileContext {
  const dir = dirname(file);
  if (basename(dir) === ".pi") {
    const cwd = dirname(dir);
    return { agentDir: join(cwd, ".pi-web-no-global-agent-dir"), cwd, projectTrusted: true };
  }
  return { agentDir: dir, cwd: dirname(dir), projectTrusted: false };
}

/** Servers defined by one config file, already validated by pi. */
export async function loadMcpConfigFile(file: string): Promise<McpConfigFileLoad> {
  const loaded = await loadMcpConfigFiles(contextForFile(file));
  return { ...loaded, exists: existsSync(file) };
}

/**
 * Run one SDK editor against a private staging copy and atomically replace the
 * target with it. The staging copy keeps the file's exact bytes (and therefore
 * its indentation), is mode 0600, and lives in the same directory as the target
 * so the final `renameSync` never crosses a filesystem boundary.
 */
async function editMcpConfigFile<T>(
  file: string,
  edit: (internals: PiSdkInternals, staging: string) => T,
): Promise<T> {
  const internals = await requireInternals();
  mkdirSync(dirname(file), { recursive: true });
  const staging = join(dirname(file), `.${basename(file)}-${randomUUID()}.tmp`);
  const hadFile = existsSync(file);
  if (hadFile) {
    const raw = readFileSync(file, "utf8");
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error("not an object");
    } catch {
      throw new Error(`${file}: malformed JSON`);
    }
    writeFileSync(staging, raw, { encoding: "utf8", flag: "wx", mode: 0o600 });
  }
  try {
    const result = edit(internals, staging);
    // The SDK editor writes nothing when the edit is a no-op (for example
    // removing a server the file does not define). The target stays untouched.
    if (!existsSync(staging)) return result;
    chmodSync(staging, 0o600);
    renameSync(staging, file);
    return result;
  } finally {
    rmSync(staging, { force: true });
  }
}

/** Add or replace one server. Returns true when an entry was replaced. */
export async function addMcpServer(file: string, name: string, config: McpServerConfig): Promise<boolean> {
  return editMcpConfigFile(file, (internals, staging) => internals.addMcpServerConfig(staging, name, config));
}

/** Add many servers in one atomic write (used by the import apply layer). */
export async function addMcpServers(
  file: string,
  entries: ReadonlyArray<{ name: string; config: McpServerConfig }>,
): Promise<void> {
  if (entries.length === 0) return;
  await editMcpConfigFile(file, (internals, staging) => {
    for (const { name, config } of entries) internals.addMcpServerConfig(staging, name, config);
  });
}

/**
 * Enable or disable a server through pi's `updateMcpServerConfig` (`enabled`
 * key). Older pi.web versions wrote a `disabled` key, which pi 1.0 ignores:
 * that legacy key is folded into `enabled` in the same staged write so an
 * old file cannot come back enabled after the user turned it off.
 */
export async function setMcpServerEnabled(file: string, name: string, enabled: boolean): Promise<void> {
  const loaded = await loadMcpConfigFile(file);
  const entry = loaded.servers.find((server) => server.name === name);
  if (!entry) return;
  const config = { ...(entry.config as unknown as Record<string, unknown>) };
  const hasLegacyDisabled = config.disabled !== undefined;
  delete config.disabled;
  if (hasLegacyDisabled) {
    if (enabled) delete config.enabled;
    else config.enabled = false;
    await editMcpConfigFile(file, (internals, staging) =>
      internals.addMcpServerConfig(staging, name, config as unknown as McpServerConfig));
    return;
  }
  await editMcpConfigFile(file, (internals, staging) =>
    internals.updateMcpServerConfig(staging, name, { enabled } satisfies McpServerConfigPatch));
}

/** Remove one server. Returns false when the file does not define it. */
export async function removeMcpServer(file: string, name: string): Promise<boolean> {
  return editMcpConfigFile(file, (internals, staging) => internals.removeMcpServerConfig(staging, name));
}

/** The config entry of one server in one file, raw enough for the JSON editor. */
export async function getMcpServerConfig(file: string, name: string): Promise<McpServerConfig | undefined> {
  const loaded = await loadMcpConfigFile(file);
  return loaded.servers.find((entry: McpServerEntry) => entry.name === name)?.config;
}
