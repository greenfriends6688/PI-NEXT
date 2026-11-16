// The settings panel's wire format: one function per route the panel calls.
//
// Every type is copied from the server's own declaration, not invented, and
// each block names where it comes from (`重构/pi-next-0.0.4-source-2026-11-14`:
// `app/api/**/route.ts` and `lib/**`). Requests go through `client.req` /
// `client.postJson`, so they inherit the endpoint, the LAN token, the timeout
// and `ApiError` (which keeps the route's `{ error, reason }` body verbatim).
//
// The panel reads only what it shows: fields a section does not display are
// left out of the types here, and a field the route may omit is optional.

import { postJson, req, withQuery, type RequestOptions } from "./client";
import type { ModelRef, ModelsData, ToolSettingsResponse } from "./models";

export type { ModelsData, ModelRef, ToolSettingsResponse };

/** The `{ error, reason? }` refusals `/api/mcp`, `/api/mcp/test` and `/api/tools/settings` answer with (`lib/api-types.ts:580-688`). */
export type SettingsRefusalReason = string;

/** A failed request's words, for a row's error line: the route's `error`, else the transport's. */
export function settingsErrorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

// --- settings › models: enabled list (`app/api/models/enabled/route.ts`) --

/** One model's switch (`lib/enabled-models.ts:80-90`). */
export interface EnabledModelView {
  id: string;
  name: string;
  /** `provider/modelId`, the reference every edit uses. */
  ref: string;
  enabled: boolean;
  /** The context budget pi resolved, when the catalog knows it. */
  contextWindow?: number;
  /** A thinking level an `enabledModels` `:level` pattern pins (read-only here). */
  thinkingPin?: string;
}

/** One provider's group of models (`lib/enabled-models.ts:92-104`). */
export interface EnabledProviderView {
  id: string;
  name: string;
  /** `builtin` providers own their list; `custom` ones come from `models.json` and switch as a whole. */
  kind: "builtin" | "custom";
  enabledCount: number;
  models: EnabledModelView[];
}

/**
 * `GET`/`PUT /api/models/enabled` (`lib/enabled-models.ts:106-123`).
 * `scope: "project"` means the project's settings shadow the global value and
 * `editable` is false: the route refuses writes with `reason: "project-scope"`
 * (`app/api/models/enabled/route.ts:207-213`).
 */
export interface EnabledModelsView {
  allEnabled: boolean;
  /** The configured patterns (`null` when nothing narrows the list). */
  patterns: string[] | null;
  /** Patterns that match no available model; every edit keeps them. */
  stalePatterns: string[];
  enabledTotal: number;
  availableTotal: number;
  providers: EnabledProviderView[];
  scope: "global" | "project";
  /** The settings file the effective value comes from, shortened (`~/.pi/agent/settings.json`). */
  settingsPath: string;
  editable: boolean;
  modelError?: string;
}

/** `GET /api/models/enabled?cwd=` (`app/api/models/enabled/route.ts:93-101`). */
export function loadEnabledModels(
  cwd: string | null,
  options: RequestOptions = {},
): Promise<EnabledModelsView> {
  return req<EnabledModelsView>(
    withQuery("/api/models/enabled", { cwd: cwd ?? undefined }),
    {},
    options,
  );
}

/**
 * `PUT /api/models/enabled` with `op: "models"` — one edit per model ref
 * (`app/api/models/enabled/route.ts:233-252`; the `refs` gate is 245-247).
 * The answer is the overview the panel replaces its list with.
 */
export function setModelsEnabled(
  cwd: string | null,
  refs: readonly string[],
  enabled: boolean,
  options: RequestOptions = {},
): Promise<EnabledModelsView> {
  return req<EnabledModelsView>(
    "/api/models/enabled",
    {
      method: "PUT",
      body: JSON.stringify({ cwd: cwd ?? undefined, op: "models", refs: [...refs], enabled }),
    },
    options,
  );
}

/** `PUT /api/models/enabled` with `op: "provider"` — a whole provider (`app/api/models/enabled/route.ts:233-244`). */
export function setProviderEnabled(
  cwd: string | null,
  provider: string,
  enabled: boolean,
  options: RequestOptions = {},
): Promise<EnabledModelsView> {
  return req<EnabledModelsView>(
    "/api/models/enabled",
    {
      method: "PUT",
      body: JSON.stringify({ cwd: cwd ?? undefined, op: "provider", provider, enabled }),
    },
    options,
  );
}

/**
 * `PUT /api/models/enabled` with `op: "clear"` — drop the whole
 * `enabledModels` filter (`app/api/models/enabled/route.ts:244-252`). The
 * answer is the overview with every model enabled.
 */
export function clearEnabledModels(
  cwd: string | null,
  options: RequestOptions = {},
): Promise<EnabledModelsView> {
  return req<EnabledModelsView>(
    "/api/models/enabled",
    { method: "PUT", body: JSON.stringify({ cwd: cwd ?? undefined, op: "clear" }) },
    options,
  );
}

/**
 * `PUT /api/models/enabled` with `op: "prune"` — remove the stored patterns
 * that match no model (`app/api/models/enabled/route.ts:244-252`). A pattern
 * of a provider without a usable credential is kept.
 */
export function pruneEnabledModels(
  cwd: string | null,
  options: RequestOptions = {},
): Promise<EnabledModelsView> {
  return req<EnabledModelsView>(
    "/api/models/enabled",
    { method: "PUT", body: JSON.stringify({ cwd: cwd ?? undefined, op: "prune" }) },
    options,
  );
}

/**
 * `PUT /api/models/default` — what new sessions start with
 * (`app/api/models/default/route.ts:48-116`; the body is `{ cwd?, provider,
 * modelId, thinkingLevel? }`, `parseEdit()` at 26-38). A project that sets the
 * same key answers 409 with `reason: "project-scope"` (85-95), and a model the
 * selector cannot offer with 404 (96-103).
 */
export function saveDefaultModel(
  cwd: string | null,
  model: ModelRef,
  options: RequestOptions = {},
): Promise<{ ok: true; defaultModel?: ModelRef }> {
  return req<{ ok: true; defaultModel?: ModelRef }>(
    "/api/models/default",
    {
      method: "PUT",
      body: JSON.stringify({ cwd: cwd ?? undefined, provider: model.provider, modelId: model.modelId }),
    },
    options,
  );
}

// --- settings › general: shell + tool preferences -------------------------

/** `GET /api/tools/settings` (`app/api/tools/settings/route.ts:40-47`; `ToolSettingsResponse` is `lib/api-types.ts:41-50`). */
export function loadToolSettings(options: RequestOptions = {}): Promise<ToolSettingsResponse> {
  return req<ToolSettingsResponse>("/api/tools/settings", {}, options);
}

/**
 * `PUT /api/tools/settings`, one key per request (`app/api/tools/settings/route.ts:57-130`; `CHANGES` at
 * 30): `{ enabled }` for the PowerShell tool (Windows only, 118-129) and
 * `{ codemode }` for "always" / "automatic" (106-116).
 */
export function saveToolSetting(
  change:
    | { enabled: boolean }
    | { codemode: ToolSettingsResponse["codemode"] }
    | { codemodeMode: "on" | "only" }
    | { codemodeInlineBudget: number | null },
  options: RequestOptions = {},
): Promise<ToolSettingsResponse> {
  return req<ToolSettingsResponse>(
    "/api/tools/settings",
    { method: "PUT", body: JSON.stringify(change) },
    options,
  );
}

// --- settings › MCP (`app/api/mcp/route.ts`, `app/api/mcp/test/route.ts`) --

export type McpScope = "global" | "project";

/** `McpScope` (`lib/api-types.ts:176`), the pair every change names (`694-697`). */
/** How a server's tools reach the agent (`lib/mcp-import-core.ts:1111`). */
export type McpExposure = "codemode" | "deferred" | "direct" | "hidden";

export const MCP_EXPOSURES: readonly McpExposure[] = ["codemode", "deferred", "direct", "hidden"];

export interface McpServerRef {
  scope: McpScope;
  name: string;
}

/** A state a test records (`lib/api-types.ts:346-384`). */
export interface McpTestTool {
  name: string;
  /** The first line of its description, shortened by the route. */
  description?: string;
  /** The server marks it read-only (`annotations.readOnlyHint`). */
  readOnly: boolean;
  /** How the tool reaches the model under the server's exposure rules. */
  exposure?: McpExposure;
}

export interface McpTestResult {
  state: "connected" | "needs-auth" | "failed";
  error?: string;
  /** The stderr tail a stdio server wrote before it failed. */
  stderr?: string;
  timedOut?: boolean;
  queueTimedOut?: boolean;
  /** At most `MCP_TEST_MAX_TOOLS`, in the server's order; `toolCount` counts all of them. */
  tools: McpTestTool[];
  toolCount: number;
  serverInfo?: { name: string; version: string; title?: string };
  cwd?: string;
  durationMs: number;
  queuedMs?: number;
  testedAt: number;
  resources?: true;
  afterSignIn?: true;
}

/** The last known state: a test's, or an open session's report (`lib/api-types.ts:402-425`). */
export type McpServerStatus =
  | ({ origin: "test" } & McpTestResult)
  | {
      origin: "session";
      state: "connecting" | "connected" | "needs-auth" | "failed" | "disconnected" | "conflict" | "not-trusted";
      sessionId: string;
      cwd: string;
      updatedAt: number;
      error?: string;
      closedAt?: number;
    };

/** One `mcpServers` entry as its file holds it (`lib/api-types.ts:239-323`). */
export interface McpServerInfo {
  name: string;
  scope: McpScope;
  sourcePath: string;
  enabled: boolean;
  /** False when the SDK's validator was unavailable; nothing below was checked. */
  validated: boolean;
  /** The SDK refuses to connect it, with this reason. */
  invalidError?: string;
  /** The entry is not an object, so it has no `enabled` to switch. */
  notAnObject?: true;
  transport?: "stdio" | "http";
  /** How its tools reach the model (`lib/api-types.ts:267`). */
  exposure?: string;
  toolExposureCount?: number;
  /** A global entry the project's override changes while the project is trusted. */
  overriddenByProject?: boolean;
  status?: McpServerStatus;
}

/** `GET /api/mcp?cwd=` (`app/api/mcp/route.ts:112-127`; `McpResponse` is `lib/api-types.ts:552-575`). */
export interface McpResponse {
  mcp:
    | { available: true }
    | { available: false; reason: "operator-disabled" | "internals-unavailable" | "builtin-disabled"; error: string };
  /** The global file, then the project file when a cwd was given. */
  servers: McpServerInfo[];
  files: { scope: McpScope; path: string; exists: boolean }[];
}

/** `POST /api/mcp`'s answer: the overview read after the change, plus what the action added (`lib/api-types.ts:717-733`). */
export interface McpActionResponse extends McpResponse {
  results?: (McpServerRef & { error?: string; reason?: SettingsRefusalReason })[];
}

/** `GET /api/mcp?cwd=` — the listing; without `cwd` it covers the global file alone (`app/api/mcp/route.ts:112-127`). */
export function loadMcpOverview(
  cwd: string | null,
  options: RequestOptions = {},
): Promise<McpResponse> {
  return req<McpResponse>(withQuery("/api/mcp", { cwd: cwd ?? undefined }), {}, options);
}

/**
 * `POST /api/mcp` — `enable` / `disable` one server (`app/api/mcp/route.ts:592-663`;
 * the `enable`/`disable` case at 616-626). A project server needs `cwd`; the
 * answer is the new overview, so the section replaces its list with it.
 * `set-enabled` takes `{ enabled, servers }` (`627-633`).
 */
export function setMcpServerEnabled(
  server: McpServerRef,
  enabled: boolean,
  cwd: string | null,
  options: RequestOptions = {},
): Promise<McpActionResponse> {
  return postJson<McpActionResponse>(
    "/api/mcp",
    { action: enabled ? "enable" : "disable", scope: server.scope, name: server.name, cwd: cwd ?? undefined },
    options,
  );
}

/** `POST /api/mcp` with `action: "set-enabled"` for a group of servers (`app/api/mcp/route.ts:627-633`, `307-352`). */
export function setMcpServersEnabled(
  servers: readonly McpServerRef[],
  enabled: boolean,
  cwd: string | null,
  options: RequestOptions = {},
): Promise<McpActionResponse> {
  return postJson<McpActionResponse>(
    "/api/mcp",
    { action: "set-enabled", enabled, servers: servers.map((s) => ({ scope: s.scope, name: s.name })), cwd: cwd ?? undefined },
    options,
  );
}

/** `POST /api/mcp/test` (`app/api/mcp/test/route.ts:26-36`): connects once; `{ scope, name, cwd }` in, `McpTestResponse` out. */
export interface McpTestResponse extends McpServerRef {
  configKey: string;
  result: McpTestResult;
}

export function testMcpServer(
  server: McpServerRef,
  cwd: string | null,
  options: RequestOptions = {},
): Promise<McpTestResponse> {
  return postJson<McpTestResponse>(
    "/api/mcp/test",
    { scope: server.scope, name: server.name, cwd: cwd ?? undefined },
    options,
  );
}

// --- settings › skills (`app/api/skills/route.ts`) ------------------------

/** One skill (`lib/api-types.ts:87-99`). */
export interface SkillInfo {
  name: string;
  description: string;
  /** The `SKILL.md` the switch edits. */
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo: { source?: string; scope?: string };
}

/** `GET /api/skills?cwd=` (`app/api/skills/route.ts:16-30`; `SkillsResponse` is `lib/api-types.ts:100-104`). */
export interface SkillsResponse {
  skills: SkillInfo[];
  diagnostics: { type: string; message: string }[];
  projectResourcesLoaded: boolean;
}

export function loadSkills(
  cwd: string,
  options: RequestOptions = {},
): Promise<SkillsResponse> {
  return req<SkillsResponse>(withQuery("/api/skills", { cwd }), {}, options);
}

/**
 * `PATCH /api/skills` — `{ filePath, disableModelInvocation }` for one skill
 * (`app/api/skills/route.ts:69-104`; the single-file branch at 98-103).
 */
export function setSkillModelInvocation(
  filePath: string,
  disableModelInvocation: boolean,
  options: RequestOptions = {},
): Promise<{ success: true }> {
  return req<{ success: true }>(
    "/api/skills",
    { method: "PATCH", body: JSON.stringify({ filePath, disableModelInvocation }) },
    options,
  );
}

/** Where an installed skill lives (`lib/api-types.ts:58-75`): the update routes take the pair. */
export type SkillInstallScope = "global" | "project";

/** How a skill was installed (`lib/api-types.ts:60-75`). */
export interface SkillInstallInfo {
  package: string;
  scope: SkillInstallScope;
  source: string;
  sourceType?: string;
  skillsShUrl?: string;
  skillPath?: string;
  ref?: string;
  versionHash?: string;
  canCheckForUpdates: boolean;
}

/** A loaded skill with its install record (`GET /api/skills?cwd=`). */
export interface SkillWithInstall extends SkillInfo {
  install?: SkillInstallInfo;
}

/** The same listing as `SkillsResponse`, with the install fields the update routes need. */
export interface SkillsWithInstallResponse {
  skills: SkillWithInstall[];
  diagnostics: { type: string; message: string }[];
  projectResourcesLoaded: boolean;
}

export function loadSkillsWithInstalls(
  cwd: string,
  options: RequestOptions = {},
): Promise<SkillsWithInstallResponse> {
  return req<SkillsWithInstallResponse>(withQuery("/api/skills", { cwd }), {}, options);
}

/** One row of `POST /api/skills/search` (`lib/api-types.ts:52-56`). */
export interface SkillSearchResult {
  package: string;
  installs: string;
  url: string;
}

/**
 * `POST /api/skills/search` — `{ query, limit? }` (`app/api/skills/search/route.ts`).
 * The route asks skills.sh first, then falls back to `npx skills find`; a search
 * can outlast the client's default timeout, so give it a minute.
 */
export function searchSkills(
  query: string,
  limit?: number,
  options: RequestOptions = {},
): Promise<{ results: SkillSearchResult[] }> {
  return postJson<{ results: SkillSearchResult[] }>(
    "/api/skills/search",
    { query, limit },
    { timeoutMs: 60_000, ...options },
  );
}

/**
 * `POST /api/skills/install` — `{ package, scope, cwd? }` (`app/api/skills/install/route.ts`).
 * A project install needs `cwd` and a trusted folder; the route runs `npx`.
 */
export function installSkill(
  packageName: string,
  scope: SkillInstallScope,
  cwd: string | null,
  options: RequestOptions = {},
): Promise<{ success: true; output?: string }> {
  return postJson<{ success: true; output?: string }>(
    "/api/skills/install",
    { package: packageName, scope, cwd: cwd ?? undefined },
    { timeoutMs: 120_000, ...options },
  );
}

/** One file of a bulk PATCH; `error` means that file kept its state (`lib/api-types.ts:111-114`). */
export interface SkillToggleResult {
  filePath: string;
  error?: string;
}

/**
 * `PATCH /api/skills` — `{ filePaths, disableModelInvocation }` for the
 * section's group switches (`app/api/skills/route.ts:69-104`; the batch
 * branch reports every file, so one refusal does not stop the rest).
 */
export function setSkillsModelInvocation(
  filePaths: readonly string[],
  disableModelInvocation: boolean,
  options: RequestOptions = {},
): Promise<{ results: SkillToggleResult[] }> {
  return req<{ results: SkillToggleResult[] }>(
    "/api/skills",
    {
      method: "PATCH",
      body: JSON.stringify({ filePaths: [...filePaths], disableModelInvocation }),
    },
    options,
  );
}

/** A check's verdict (`lib/api-types.ts:77-89`). */
export type SkillUpdateState = "up-to-date" | "update-available" | "unsupported" | "error";

export interface SkillUpdateResult {
  package: string;
  scope: SkillInstallScope;
  state: SkillUpdateState;
  currentVersion?: string;
  latestVersion?: string;
  message?: string;
}

/**
 * `POST /api/skills/check` — `{ cwd, package?, scope? }`
 * (`app/api/skills/check/route.ts`): without the pair it checks every install.
 */
export function checkSkillUpdates(
  cwd: string,
  target?: { package: string; scope: SkillInstallScope },
  options: RequestOptions = {},
): Promise<{ updates: SkillUpdateResult[] }> {
  return postJson<{ updates: SkillUpdateResult[] }>(
    "/api/skills/check",
    { cwd, package: target?.package, scope: target?.scope },
    { timeoutMs: 60_000, ...options },
  );
}

/**
 * `POST /api/skills/update` — `{ cwd, package, scope }`
 * (`app/api/skills/update/route.ts`); the answer carries the refreshed skill.
 */
export function updateSkill(
  cwd: string,
  packageName: string,
  scope: SkillInstallScope,
  options: RequestOptions = {},
): Promise<{ success: true; skill?: SkillWithInstall; output?: string }> {
  return postJson<{ success: true; skill?: SkillWithInstall; output?: string }>(
    "/api/skills/update",
    { cwd, package: packageName, scope },
    { timeoutMs: 120_000, ...options },
  );
}

/** `GET /api/skills/content` (`app/api/skills/content/route.ts`); `document` is a Markdown file in the skill folder. */
export function loadSkillContent(
  cwd: string,
  filePath: string,
  document?: string,
  options: RequestOptions = {},
): Promise<{ content: string }> {
  return req<{ content: string }>(
    withQuery("/api/skills/content", { cwd, filePath, document }),
    {},
    options,
  );
}

// --- settings › plugins (`app/api/plugins/route.ts`) ----------------------

export type PluginScope = "global" | "project";

/** One configured package (`lib/api-types.ts:870-884`). */
export type PluginResourceKind = "extension" | "skill" | "prompt" | "theme";

export interface PluginResourceCounts {
  extensions: number;
  skills: number;
  prompts: number;
  themes: number;
}

/** One file a package contributes (`lib/api-types.ts:842-848`). */
export interface PluginResourceInfo {
  kind: PluginResourceKind;
  name: string;
  path: string;
  relativePath: string;
}

/** An extension loaded on its own, without a package (`lib/api-types.ts:849-856`). */
export interface PluginStandaloneExtensionInfo extends PluginResourceInfo {
  kind: "extension";
  scope: PluginScope;
  enabled: boolean;
}

export interface PluginPackageInfo {
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
  /** The package's resolved extensions, skills, prompts and themes. */
  resources: PluginResourceInfo[];
  status: "loaded" | "installed" | "missing" | "disabled";
}

/** `GET /api/plugins?cwd=` (`app/api/plugins/route.ts:406-423`; `PluginsResponse` is `lib/api-types.ts:886-892`). */
export interface PluginsResponse {
  packages: PluginPackageInfo[];
  standaloneExtensions: PluginStandaloneExtensionInfo[];
  totals: PluginResourceCounts;
  diagnostics: { type: string; source?: string; message: string }[];
  projectResourcesLoaded: boolean;
}

export function loadPlugins(
  cwd: string,
  options: RequestOptions = {},
): Promise<PluginsResponse> {
  return req<PluginsResponse>(withQuery("/api/plugins", { cwd }), {}, options);
}

/**
 * `POST /api/plugins` with `action: "enable" | "disable"` — `{ action, source,
 * scope, cwd }` (`app/api/plugins/route.ts:425-520`; the package-list branch
 * at 454-470, the single one at 483-511). The answer is the plugin list again.
 */
export function setPluginEnabled(
  pkg: { source: string; scope: PluginScope },
  enabled: boolean,
  cwd: string,
  options: RequestOptions = {},
): Promise<PluginsResponse> {
  return postJson<PluginsResponse>(
    "/api/plugins",
    { action: enabled ? "enable" : "disable", source: pkg.source, scope: pkg.scope, cwd },
    options,
  );
}

/** A package's update verdict (`lib/api-types.ts:853-867`). */
export type PluginUpdateState = "update-available" | "up-to-date" | "unsupported" | "error";

export interface PluginUpdateResult {
  source: string;
  scope: PluginScope;
  displayName: string;
  type: "npm" | "git";
  state: PluginUpdateState;
  message?: string;
}

/** One package of a bulk enable/disable; `error` means it kept its state (`lib/api-types.ts:895-899`). */
export interface PluginToggleResult {
  source: string;
  scope: PluginScope;
  error?: string;
}

export interface PluginsBulkResponse extends PluginsResponse {
  results: PluginToggleResult[];
}

/**
 * `POST /api/plugins` with `action: "install" | "remove" | "update"`
 * (`app/api/plugins/route.ts:425-520`; the action branches at 483-511).
 * `update` without a source updates every configured package.
 */
export function actOnPlugin(
  action: "install" | "remove" | "update",
  cwd: string,
  target?: { source: string; scope: PluginScope },
  options: RequestOptions = {},
): Promise<PluginsResponse> {
  return postJson<PluginsResponse>(
    "/api/plugins",
    {
      action,
      cwd,
      source: target?.source,
      scope: target?.scope,
    },
    { timeoutMs: action === "remove" ? 60_000 : 180_000, ...options },
  );
}

/**
 * `POST /api/plugins` with `{ action, packages }` — the section's Enable all /
 * Disable all (`app/api/plugins/route.ts:454-470`). Each package gets its own
 * result; filtered packages are left on by the route.
 */
export function setPluginsEnabled(
  packages: readonly { source: string; scope: PluginScope }[],
  enabled: boolean,
  cwd: string,
  options: RequestOptions = {},
): Promise<PluginsBulkResponse> {
  return postJson<PluginsBulkResponse>(
    "/api/plugins",
    {
      action: enabled ? "enable" : "disable",
      cwd,
      packages: packages.map((pkg) => ({ source: pkg.source, scope: pkg.scope })),
    },
    options,
  );
}

/**
 * `POST /api/plugins/check` — `{ cwd, source?, scope? }`
 * (`app/api/plugins/check/route.ts`): without the pair it checks every package
 * that can be checked automatically.
 */
export function checkPluginUpdates(
  cwd: string,
  target?: { source: string; scope: PluginScope },
  options: RequestOptions = {},
): Promise<{ updates: PluginUpdateResult[] }> {
  return postJson<{ updates: PluginUpdateResult[] }>(
    "/api/plugins/check",
    { cwd, source: target?.source, scope: target?.scope },
    { timeoutMs: 60_000, ...options },
  );
}

// --- settings › agents (`app/api/subagents/settings/route.ts`) ------------

/** `GET`/`PUT /api/subagents/settings` (`app/api/subagents/settings/route.ts:12-22`, 24-58). */
export interface SubagentSettings {
  enabled: boolean;
  maxConcurrent: number;
}

export function loadSubagentSettings(options: RequestOptions = {}): Promise<SubagentSettings> {
  return req<SubagentSettings>("/api/subagents/settings", {}, options);
}

/**
 * `PUT /api/subagents/settings` — `{ enabled?, maxConcurrent? }`, the bound
 * `1..MAX_SUBAGENT_MAX_CONCURRENT` (32) is checked at 39-45
 * (`lib/subagent-settings.ts:21`).
 */
export function saveSubagentSettings(
  change: Partial<SubagentSettings>,
  options: RequestOptions = {},
): Promise<SubagentSettings> {
  return req<SubagentSettings>(
    "/api/subagents/settings",
    { method: "PUT", body: JSON.stringify(change) },
    options,
  );
}

/** The largest `maxConcurrent` the route accepts (`lib/subagent-settings.ts:21`). */
export const MAX_SUBAGENT_MAX_CONCURRENT = 32;

/** Where a subagent profile lives (`lib/subagents.ts:20-21`). */
export type SubagentScope = "builtin" | "global" | "workspace" | "project";

/**
 * One profile as `lib/subagents.ts:25-57` reads it. The route sends the whole
 * profile (`listSubagentProfileSources`), so the panel can show its prompt,
 * tools and resources without a second read.
 */
export interface SubagentProfile {
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
  scope: SubagentScope;
  filePath?: string;
}

/** `GET /api/subagents/profiles?cwd=` (`app/api/subagents/profiles/route.ts:36-43`). */
export interface SubagentProfilesResponse {
  profiles: SubagentProfile[];
}

export function loadSubagentProfiles(
  cwd: string,
  options: RequestOptions = {},
): Promise<SubagentProfilesResponse> {
  return req<SubagentProfilesResponse>(
    withQuery("/api/subagents/profiles", { cwd }),
    {},
    options,
  );
}

/**
 * `PATCH /api/subagents/profiles` — `{ cwd, scope, name, enabled }`
 * (`app/api/subagents/profiles/route.ts:66-122`). A built-in is recorded in
 * `agents/settings.json`; global and project profiles rewrite their file.
 */
export function setSubagentProfileEnabled(
  profile: { scope: SubagentScope; name: string },
  enabled: boolean,
  cwd: string,
  options: RequestOptions = {},
): Promise<{ profile: SubagentProfile }> {
  return req<{ profile: SubagentProfile }>(
    "/api/subagents/profiles",
    {
      method: "PATCH",
      body: JSON.stringify({ cwd, scope: profile.scope, name: profile.name, enabled }),
    },
    options,
  );
}

/**
 * `PUT /api/subagents/profiles` — `{ cwd, scope, profile }`: writes one
 * Markdown profile (`global`: `~/.pi/agent/agents`, `project`: `.pi/agents`).
 * `name` is the file name; the body becomes the system prompt.
 */
export function saveSubagentProfile(
  cwd: string,
  scope: "global" | "project",
  profile: Omit<SubagentProfile, "scope" | "filePath">,
  options: RequestOptions = {},
): Promise<{ profile: SubagentProfile }> {
  return req<{ profile: SubagentProfile }>(
    "/api/subagents/profiles",
    {
      method: "PUT",
      body: JSON.stringify({ cwd, scope, profile }),
    },
    options,
  );
}

/** `DELETE /api/subagents/profiles` — remove one global or project profile. */
export async function deleteSubagentProfile(
  cwd: string,
  scope: "global" | "project",
  name: string,
  options: RequestOptions = {},
): Promise<void> {
  await req<{ ok: true }>(
    "/api/subagents/profiles",
    {
      method: "DELETE",
      body: JSON.stringify({ cwd, scope, name }),
    },
    options,
  );
}

// --- settings › devices (`app/api/lan/access/route.ts`) -------------------

/** `GET /api/lan/access` (`app/api/lan/access/route.ts:26-40`): the token itself is never in the answer. */
export interface LanAccessState {
  enabled: boolean;
  /** The first read generated the token: this visit turned LAN access on. */
  created: boolean;
  /** The server is bound to a LAN interface. */
  boundLan: boolean;
  /** A token exists but the server has not rebound since; a restart applies it. */
  needsRebind: boolean;
  /** The URLs a phone can open. */
  lanUrls: string[];
  /** `abcd…wxyz`, for showing which token is in use. */
  tokenHint: string | null;
}

export function loadLanAccess(options: RequestOptions = {}): Promise<LanAccessState> {
  return req<LanAccessState>("/api/lan/access", {}, options);
}

/**
 * `PUT /api/lan/access` — `{ enabled }` (`app/api/lan/access/route.ts:42-76`;
 * `enabled` at 60-67). The answer leaves `lanUrls` empty: read `GET` again.
 */
export function setLanAccessEnabled(
  enabled: boolean,
  options: RequestOptions = {},
): Promise<LanAccessState> {
  return req<LanAccessState>(
    "/api/lan/access",
    { method: "PUT", body: JSON.stringify({ enabled }) },
    options,
  );
}

/**
 * `POST /api/lan/pair/generate` (`app/api/lan/pair/generate/route.ts:14-56`):
 * `{ readOnly }` in, a six-digit code and the URLs a phone can open out. The
 * code lasts `expiresInSeconds` (ten minutes) and is spent once.
 */
export interface LanPair {
  code: string;
  /** The code can only look, not send (`mint("readonly")`). */
  readOnly: boolean;
  /** How long the code stays valid, in seconds. */
  expiresInSeconds: number;
  /** The URLs a phone can open; the first one carries the QR. */
  lanUrls: string[];
  boundLan: boolean;
  needsRebind: boolean;
}

export function generateLanPair(
  readOnly: boolean,
  options: RequestOptions = {},
): Promise<LanPair> {
  return postJson<LanPair>("/api/lan/pair/generate", { readOnly }, options);
}

// --- settings › devices: bot channels (`app/api/bot-channel/route.ts`) ---

/** The five channels the route knows (`lib/bot-channel.ts:37`). */
export type BotChannelId = "wechat" | "feishu" | "lark" | "dingtalk" | "wecom";

/** The channels with a scan registration (`lib/bot-channel-register.ts:18`). */
export type ScannableBotChannelId = Extract<BotChannelId, "wechat" | "feishu" | "lark">;

/** One channel's state (`lib/bot-channel.ts:232-255`); credentials are never in it. */
export interface BotChannelStatus {
  id: BotChannelId;
  label: string;
  /** The channel needs no public URL to receive messages. */
  lanFriendly: boolean;
  requires: string[];
  note: string;
  configured: boolean;
  hasAppId: boolean;
  hasAgentId: boolean;
  hasCallback: boolean;
  allowCount: number;
  /** The session the channel delivers to; empty for a temporary one. */
  sessionId: string;
  ready: boolean;
  missing: string[];
  running: boolean;
  /** `abcd…wxyz`, the only form the token is shown in. */
  tokenHint: string | null;
}

/** Every `POST /api/bot-channel` answer carries the refreshed channel list (`app/api/bot-channel/route.ts:96-102`). */
export interface BotChannelsResponse {
  channels: BotChannelStatus[];
}

/** `GET /api/bot-channel` (`app/api/bot-channel/route.ts:52-54`). */
export function loadBotChannels(options: RequestOptions = {}): Promise<BotChannelsResponse> {
  return req<BotChannelsResponse>("/api/bot-channel", {}, options);
}

/** The fields `action: "save"` merges (`app/api/bot-channel/route.ts:60-78`). Empty means "keep" for a credential. */
export interface BotChannelSave {
  token?: string;
  appId?: string;
  agentId?: string;
  callbackToken?: string;
  callbackAesKey?: string;
  sessionId?: string;
  allowFrom?: string[];
}

/** `POST /api/bot-channel` `action: "save"` (`app/api/bot-channel/route.ts:143-149`). */
export function saveBotChannel(
  channel: BotChannelId,
  change: BotChannelSave,
  options: RequestOptions = {},
): Promise<BotChannelsResponse> {
  return postJson<BotChannelsResponse>(
    "/api/bot-channel",
    { action: "save", channel, ...change },
    options,
  );
}

/** `POST /api/bot-channel` `action: "start" | "stop"` (`app/api/bot-channel/route.ts:151-162`). */
export function controlBotChannel(
  channel: BotChannelId,
  action: "start" | "stop",
  options: RequestOptions = {},
): Promise<BotChannelsResponse> {
  return postJson<BotChannelsResponse>(
    "/api/bot-channel",
    { action, channel },
    options,
  );
}

/** The first scan answer (`lib/bot-channel-register.ts:31-33`). */
export interface BotRegistrationBegin {
  qrContent: string;
  expiresInSeconds?: number;
  intervalSeconds?: number;
}

/** A scan poll (`lib/bot-channel-register.ts:47-51`). */
export interface BotRegistrationPoll {
  status: "pending" | "scanned" | "expired" | "success";
  intervalSeconds?: number;
  /** The app's name after a successful Feishu / Lark scan. */
  appName?: string | null;
  channels?: BotChannelStatus[];
}

/** `POST /api/bot-channel` `action: "register-begin"` (`app/api/bot-channel/route.ts:113-117`). */
export function beginBotChannelRegistration(
  channel: ScannableBotChannelId,
  options: RequestOptions = {},
): Promise<BotRegistrationBegin> {
  return postJson<BotRegistrationBegin>(
    "/api/bot-channel",
    { action: "register-begin", channel },
    options,
  );
}

/** `POST /api/bot-channel` `action: "register-poll"` (`app/api/bot-channel/route.ts:119-138`). */
export function pollBotChannelRegistration(
  channel: ScannableBotChannelId,
  options: RequestOptions = {},
): Promise<BotRegistrationPoll> {
  return postJson<BotRegistrationPoll>(
    "/api/bot-channel",
    { action: "register-poll", channel },
    options,
  );
}

/** `POST /api/bot-channel` `action: "register-cancel"` (`app/api/bot-channel/route.ts:108-111`). */
export function cancelBotChannelRegistration(
  channel: ScannableBotChannelId,
  options: RequestOptions = {},
): Promise<BotChannelsResponse> {
  return postJson<BotChannelsResponse>(
    "/api/bot-channel",
    { action: "register-cancel", channel },
    options,
  );
}

// --- the panel's own preferences, kept with the server ----------------
//
// `GET`/`PUT /api/ui-preferences` (`app/api/ui-preferences/route.ts:17-45`):
// one string per key, last write wins (`lib/ui-preferences.ts:103-135`). The
// panel stores its appearance choices in `prefs` first (device-local); this is
// how they can follow a person to another device later — TODO(nsh): the merge
// policy (device value vs server value) is not decided, so nothing calls it yet.

export interface UiPreferencesFile {
  version: number;
  preferences: Record<string, { value: string; updatedAt: number }>;
}

export function loadUiPreferences(options: RequestOptions = {}): Promise<UiPreferencesFile> {
  return req<UiPreferencesFile>("/api/ui-preferences", {}, options);
}

export function saveUiPreferences(
  patch: Record<string, string>,
  options: RequestOptions = {},
): Promise<UiPreferencesFile> {
  return req<UiPreferencesFile>(
    "/api/ui-preferences",
    { method: "PUT", body: JSON.stringify(patch) },
    options,
  );
}

/**
 * `POST /api/mcp` with one of its row actions
 * (`app/api/mcp/route.ts:588-660`): `enable`/`disable` one server,
 * `remove` it (the answer carries `undo: { token, expiresInMs }`,
 * `route.ts:350-366`), `undo` a removal (`{ token }`), or `sign-out` its
 * OAuth credentials.
 *
 * The answer is the whole overview, so a caller can replace its list with it
 * instead of asking again.
 */
export type McpRowAction = "enable" | "disable" | "remove" | "sign-out";

export interface McpUndoToken {
  token: string;
  /** Milliseconds the token stays usable (the server keeps 60 s). */
  expiresInMs: number;
  path?: string;
}

export interface McpRowActionResponse extends McpResponse {
  undo?: McpUndoToken;
}

export function actOnMcpServer(
  action: McpRowAction,
  server: McpServerRef,
  cwd: string | null,
  options: RequestOptions = {},
): Promise<McpRowActionResponse> {
  return postJson<McpRowActionResponse>(
    "/api/mcp",
    { action, scope: server.scope, name: server.name, cwd: cwd ?? undefined },
    options,
  );
}

/** `POST /api/mcp { action: "undo", token }` (`route.ts:371-400`). */
export function undoMcpRemoval(
  token: string,
  cwd: string | null,
  options: RequestOptions = {},
): Promise<McpActionResponse> {
  return postJson<McpActionResponse>("/api/mcp", { action: "undo", token, cwd: cwd ?? undefined }, options);
}

/** `POST /api/mcp { action: "set-exposure", scope, name, exposure }` (`route.ts:634-641`). */
export function setMcpServerExposure(
  server: McpServerRef,
  exposure: McpExposure,
  cwd: string | null,
  options: RequestOptions = {},
): Promise<McpActionResponse> {
  return postJson<McpActionResponse>(
    "/api/mcp",
    { action: "set-exposure", scope: server.scope, name: server.name, exposure, cwd: cwd ?? undefined },
    options,
  );
}
