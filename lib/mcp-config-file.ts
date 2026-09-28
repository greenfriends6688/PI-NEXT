/**
 * Shared `mcp.json` read/write helpers.
 *
 * These started life as private helpers inside `app/api/mcp/route.ts`. The
 * import apply layer needs the same shape (and must not import from a route
 * file), so the minimal logic moved here and the route now imports it too.
 *
 * The writer is atomic and creates the parent directory: mcp.json can carry
 * env values and headers, so it is written with the same private-file path as
 * models.json (`lib/atomic-file.ts`, mode 0600 + temp + rename).
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { writePrivateFileAtomicSync } from "./atomic-file";

export interface McpConfigFileData {
  settings?: Record<string, unknown>;
  mcpServers?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface McpConfigFileRead {
  exists: boolean;
  data?: McpConfigFileData;
  /** Error *code*, never a parser message (V8 quotes the offending input). */
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strict read for callers that must not clobber a corrupt file. The lenient
 * `readMcpConfigFile` below is kept for the route's read-modify-write flow,
 * which historically treats malformed JSON as an empty config.
 */
export function readMcpConfigFileResult(file: string): McpConfigFileRead {
  if (!existsSync(file)) return { exists: false };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!isRecord(parsed)) return { exists: true, error: "malformed JSON" };
    return { exists: true, data: parsed as McpConfigFileData };
  } catch {
    return { exists: true, error: "malformed JSON" };
  }
}

export function readMcpConfigFile(file: string): McpConfigFileData {
  return readMcpConfigFileResult(file).data ?? {};
}

export function writeMcpConfigFile(file: string, data: McpConfigFileData): void {
  mkdirSync(dirname(file), { recursive: true });
  writePrivateFileAtomicSync(file, JSON.stringify(data, null, 2) + "\n");
}
