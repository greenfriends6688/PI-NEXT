// The project-trust route and the listing it carries: whether a folder needs
// trust, whether it has it, and what its `.pi/mcp.json` declares (ADR 0006).
//
// The response is `ProjectTrustStatus & ProjectMcpListing`
// (`lib/api-types.ts:116-147`, `:182-291`, `:787-812`), assembled by
// `GET /api/project-trust` from `getProjectTrustStatus()` and
// `readProjectMcpServers()` (`app/api/project-trust/route.ts:56-73`). The
// listing reads files only: no server is spawned, no value resolved and no
// `!command` run. `POST` writes the trust decision and answers the status
// (`route.ts:75-100`).
//
// A `trust.json` that cannot be read answers 500 with `reason:
// "trust-unreadable"` and still carries the listing (`route.ts:66-72`); the
// dialog keeps that listing so it never says "no servers" over an unreadable
// store. `projectTrustListingFromError()` reads it from `ApiError.body`.

import { ApiError, postJson, req, withQuery, type RequestOptions } from "./client";

export type McpScope = "global" | "project";
export type McpTransportKind = "stdio" | "http";
export type McpOverrideKey = "enabled" | "exposure" | "toolExposure";

/** A value the SDK resolves before connecting (`lib/api-types.ts:182-186`). */
export interface McpConfigFieldRef {
  kind: "env" | "header" | "oauth-client-secret";
  name?: string;
}

/** A value that reads host environment variables, named without expanding (`:193-196`). */
export interface McpVariableReference extends McpConfigFieldRef {
  variables: string[];
}

export type McpConfigFileProblemReason =
  | "unparsable"
  | "invalid-shape"
  | "auto-enable-codemode-invalid"
  | "link-dangling"
  | "link-outside"
  | "not-a-file"
  | "too-large"
  | "too-many-servers"
  | "unreadable";

export interface McpConfigFileProblem {
  reason: McpConfigFileProblemReason;
  error: string;
}

/** The project file's own state (`lib/api-types.ts:222-232`). */
export interface McpConfigFileInfo {
  scope: McpScope;
  path: string;
  realPath?: string;
  exists: boolean;
  problems: McpConfigFileProblem[];
  autoEnableCodemode?: boolean;
}

/**
 * One `mcpServers` entry as the trust dialog shows it (`:240-307`): the fields
 * here are the ones naming or explaining the server, not its literals
 * (`env`/`headers` values never leave the server).
 */
export interface McpServerInfo {
  name: string;
  scope: McpScope;
  sourcePath: string;
  enabled: boolean;
  validated: boolean;
  invalidError?: string;
  transport?: McpTransportKind;
  description?: string;
  command?: string;
  args?: string[];
  /** Relative to the session's folder. */
  cwd?: string;
  envNames: string[];
  url?: string;
  headerNames: string[];
  replacesGlobal?: boolean;
  override?: { keys: McpOverrideKey[] };
  masked?: boolean;
}

/** `ProjectMcpListing` (`:787-795`). */
export interface ProjectMcpListing {
  /** Absent only when listing failed unexpectedly (`mcpError`). */
  mcpFile?: McpConfigFileInfo;
  mcpServers: McpServerInfo[];
  mcpError?: string;
}

/** `ProjectTrustStatus` (`:116-147`). */
export interface ProjectTrustStatus {
  requiresTrust: boolean;
  trusted: boolean;
  /** Nearest `trust.json` decision for the folder or an ancestor; null when none. */
  decision: boolean | null;
  /** The folder the decision is recorded for. */
  decisionPath?: string;
  /** The decision belongs to an ancestor. */
  inherited: boolean;
  /** Only for a folder that needs no trust, when `trust.json` could not be read. */
  decisionError?: string;
}

/** `GET /api/project-trust` (`:798-802`). */
export interface ProjectTrustResponse extends ProjectTrustStatus, ProjectMcpListing {}

/** `GET /api/project-trust`'s 500, still carrying the listing (`:804-812`). */
export interface ProjectTrustUnreadableResponse extends ProjectMcpListing {
  error: string;
  reason: "trust-unreadable";
}

/** `GET /api/project-trust?cwd=` — the status and what trusting would connect. */
export function loadProjectTrust(cwd: string, options: RequestOptions = {}): Promise<ProjectTrustResponse> {
  return req<ProjectTrustResponse>(withQuery("/api/project-trust", { cwd }), {}, options);
}

/** `POST /api/project-trust` — records the folder as trusted; answers its status. */
export function trustProject(cwd: string, options: RequestOptions = {}): Promise<ProjectTrustStatus> {
  return postJson<ProjectTrustStatus>("/api/project-trust", { cwd }, options);
}

/**
 * The listing a 500 `trust-unreadable` answer carries. `undefined` for any
 * other failure, or one without server rows.
 */
export function projectTrustListingFromError(error: unknown): ProjectMcpListing | undefined {
  if (!(error instanceof ApiError)) return undefined;
  const body = error.body;
  if (!Array.isArray(body.mcpServers)) return undefined;
  const listing: ProjectMcpListing = {
    mcpServers: body.mcpServers as McpServerInfo[],
  };
  if (body.mcpFile !== null && typeof body.mcpFile === "object") {
    listing.mcpFile = body.mcpFile as McpConfigFileInfo;
  }
  if (typeof body.mcpError === "string") listing.mcpError = body.mcpError;
  return listing;
}
