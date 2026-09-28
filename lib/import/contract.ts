/**
 * fork:import-scan — the wire contract for the "import from other AI agents" feature.
 *
 * **This module must stay free of Node builtins.** The settings UI renders these
 * candidates in a client component, so a `node:` import anywhere in its dependency
 * graph breaks `next build` with `UnhandledSchemeError`. The filesystem helpers that
 * belong with this contract live in `./types.ts`, which re-exports everything here.
 *
 * Read-only: nothing in this directory writes to disk. The apply step (PR-09)
 * will resolve candidate ids back to the paths recorded here; the renderer
 * must never send a path of its own.
 *
 * Security boundary: candidates may carry `hasSecret: boolean` and *nothing*
 * else derived from credentials. No API key, token, env value, or credential
 * header value may leave this module. Error diagnostics use error *codes*,
 * never parser messages, because V8's JSON errors quote the offending input.
 */

export const IMPORT_KINDS = ["sessions", "models", "skills", "mcp"] as const;

export type ImportKind = (typeof IMPORT_KINDS)[number];

export function isImportKind(value: unknown): value is ImportKind {
  return typeof value === "string" && (IMPORT_KINDS as readonly string[]).includes(value);
}

export type ImportSessionSource = "claude" | "codex" | "opencode" | "pi";
export type ImportModelSource = "claude" | "codex" | "opencode" | "pi";
export type ImportSkillSource = "claude" | "agents";
export type ImportMcpSource = "claude-desktop" | "claude" | "cursor" | "codex" | "opencode";
export type ImportSourceId =
  | ImportSessionSource
  | ImportModelSource
  | ImportSkillSource
  | ImportMcpSource;

/**
 * One attempted file or directory. Missing sources are normal (`exists: false`),
 * unreadable/malformed ones carry `error`, and sources cut off by a ceiling
 * carry `truncated: true` so the UI can say "showing the newest N".
 */
export interface ImportSourceDiagnostic {
  kind: ImportKind;
  source: ImportSourceId;
  path: string;
  exists: boolean;
  count: number;
  truncated?: boolean;
  error?: string;
}

export interface ImportCandidateBase {
  kind: ImportKind;
  /** Deterministic `${source}:${externalId}` key used for idempotent apply. */
  id: string;
  source: ImportSourceId;
  externalId: string;
  /** Absolute path of the file the candidate was read from. */
  filePath: string;
  /**
   * Destination the apply step will use later. Recorded here only — this scan
   * never writes it.
   */
  destination: string;
}

export interface ImportSessionCandidate extends ImportCandidateBase {
  kind: "sessions";
  source: ImportSessionSource;
  /** Optional; never an empty string. */
  title?: string;
  projectPath: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Exact count for fully parsed files, null when the file was sampled. */
  messageCount: number | null;
}

export type ImportModelApiStyle =
  | "anthropic_messages"
  | "chat_completions"
  | "responses"
  | "unknown";

export interface ImportModelCandidate extends ImportCandidateBase {
  kind: "models";
  source: ImportModelSource;
  name: string;
  baseUrl: string | null;
  apiStyle: ImportModelApiStyle;
  modelIds: string[];
  hasSecret: boolean;
}

export interface ImportSkillCandidate extends ImportCandidateBase {
  kind: "skills";
  source: ImportSkillSource;
  name: string;
  description: string | null;
}

export type ImportMcpTransport = "stdio" | "http";

export interface ImportMcpCandidate extends ImportCandidateBase {
  kind: "mcp";
  source: ImportMcpSource;
  name: string;
  transport: ImportMcpTransport;
  command?: string;
  args?: string[];
  url?: string;
  disabled: boolean;
  hasSecret: boolean;
}

export type ImportCandidate =
  | ImportSessionCandidate
  | ImportModelCandidate
  | ImportSkillCandidate
  | ImportMcpCandidate;

export interface ImportScanOptions {
  /** Fixture seam: default is os.homedir(). */
  home?: string;
  /**
   * Reserved for project-scoped sources in a later PR. The scanners of PR-08
   * deliberately read fixed home-relative paths only, so a client-supplied
   * working directory can never steer what is read.
   */
  cwd?: string;
}

export interface ImportScanResult {
  kind: ImportKind;
  scannedAt: string;
  sources: ImportSourceDiagnostic[];
  candidates: ImportCandidate[];
}

export interface ImportScanPayload {
  sources: ImportSourceDiagnostic[];
  candidates: ImportCandidate[];
}

export function sourceDiagnostic(
  kind: ImportKind,
  source: ImportSourceId,
  filePath: string,
  exists: boolean,
  count: number,
  extra: { truncated?: boolean; error?: string } = {},
): ImportSourceDiagnostic {
  return { kind, source, path: filePath, exists, count, ...extra };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Error *code* only — messages from JSON.parse quote the offending content. */
export function errorLabel(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code === "string" && code) return code;
    return error.name || "Error";
  }
  return "Error";
}

export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function uniqueStrings(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

const CREDENTIAL_HEADER_RE = /authorization|api[-_]?key|token|secret|cookie/i;

/** Whether a headers map carries anything that might be a credential. */
export function headersLookCredentialed(headers: unknown): boolean {
  if (!isRecord(headers)) return false;
  return Object.entries(headers).some(([key, value]) =>
    CREDENTIAL_HEADER_RE.test(key) && typeof value === "string" && value.trim().length > 0,
  );
}

/** Whether an env-style map has at least one non-empty value. */
export function hasNonEmptyStringValue(map: unknown): boolean {
  if (!isRecord(map)) return false;
  return Object.values(map).some((value) => typeof value === "string" && value.trim().length > 0);
}

/** Strip `user:pass@` from a URL so base URLs cannot smuggle credentials out. */
export function redactUrlCredentials(value: string): string {
  return value.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@\s]*@/, "$1");
}
