/**
 * fork:import-scan — orchestrator for the read-only import scanning layer
 * (PR-08 / PD-15).
 *
 * `scanImports(kind, options)` runs exactly one kind per request so a slow
 * source never serializes behind another scan. Nothing here writes to disk;
 * the apply step is a separate PR (PD-16).
 */

import { homedir } from "node:os";
import { scanMcpImports } from "./mcp";
import { scanModelImports } from "./models";
import { importedSessionId, scanSessionImports } from "./sessions";
import { scanSkillImports } from "./skills";
import type { ImportKind, ImportScanOptions, ImportScanResult } from "./types";

export { importedSessionId };
export * from "./types";

export async function scanImports(
  kind: ImportKind,
  options: ImportScanOptions = {},
): Promise<ImportScanResult> {
  const home = options.home ?? homedir();
  const scannedAt = new Date().toISOString();

  let payload;
  switch (kind) {
    case "sessions":
      payload = await scanSessionImports({ ...options, home });
      break;
    case "models":
      payload = await scanModelImports({ ...options, home });
      break;
    case "skills":
      payload = await scanSkillImports({ ...options, home });
      break;
    case "mcp":
      payload = await scanMcpImports({ ...options, home });
      break;
    default:
      payload = { sources: [], candidates: [] };
      break;
  }

  return { kind, scannedAt, sources: payload.sources, candidates: payload.candidates };
}
