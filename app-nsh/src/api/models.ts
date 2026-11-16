// Reads of the model catalog and the tool settings.
//
// `/api/models?cwd=` is `app/api/models/route.ts`'s `ModelsData`
// (`lib/models-cache.ts:1-21`): the browser never builds this list itself, it
// is pi's own `/model` scope (enabledModels, thinking-level pins included).
// `/api/tools/settings` is `app/api/tools/settings/route.ts`'s
// `ToolSettingsResponse` (`lib/api-types.ts:41-50`). Both are plain JSON
// reads through `client.req`, so they inherit the endpoint, the LAN token,
// timeouts and `ApiError`.

import { req, withQuery, type RequestOptions } from "./client";

/** One row of `modelList` (a model the selector may show). */
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  /** Input kinds the model accepts, when the catalog says (`["text"]`, `["text", "image"]`). */
  input?: string[];
}

/** A model reference as the routes and pi commands spell it. */
export interface ModelRef {
  provider: string;
  modelId: string;
}

/** `GET /api/models?cwd=` — the shape `loadModels()` returns (`lib/models-cache.ts:1-21`). */
export interface ModelsData {
  /** `provider:modelId` → display name. */
  models: Record<string, string>;
  /** The selector's rows, already in pi's `/model` order. */
  modelList: ModelInfo[];
  defaultModel: ModelRef | null;
  /** The thinking level a new session starts with when the person has not picked one. */
  defaultThinkingLevel: string | null;
  /** `defaultThinkingLevel` as saved in settings (the selector's star). */
  savedDefaultThinkingLevel: string | null;
  /** `provider:modelId` → the levels this model supports. */
  thinkingLevels: Record<string, string[]>;
  /** `provider:modelId` → level → provider-side label, or `null` to hide it. */
  thinkingLevelMaps: Record<string, Record<string, string | null>>;
  /** `provider:modelId` → the level pinned by an `enabledModels` `:level` suffix. */
  thinkingLevelPins: Record<string, string>;
  /** Why the catalog could not load (a safe message, never a provider secret). */
  modelError?: string;
  /** Warnings while resolving the `enabledModels` scope (a pattern that matched nothing). */
  modelScopeWarnings?: string[];
  /** True while `enabledModels` narrows the list. */
  isScoped?: boolean;
}

/** One settings layer's `codemode.mode` (`lib/api-types.ts:24-31`). */
export interface CodemodeModeSetting {
  value: "on" | "only";
  invalid?: string;
}

/** One settings layer's `codemode.inlineBudget` (`lib/api-types.ts:18-23`). */
export interface CodemodeInlineBudgetSetting {
  value?: number;
  invalid?: string;
}

/** `GET /api/tools/settings` (`app/api/tools/settings/route.ts:39-48`). */
export interface ToolSettingsResponse {
  isWindows: boolean;
  powerShellEnabled: boolean;
  codemode: "automatic" | "always";
  codemodeMode: CodemodeModeSetting;
  codemodeInlineBudget: CodemodeInlineBudgetSetting;
}

/** `provider:modelId`, the key the catalog uses for `models` / `thinkingLevels`. */
export function modelKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

/**
 * `GET /api/models?cwd=<cwd>` (`app/api/models/route.ts:77-123`). A missing
 * `cwd` is left out, and the route falls back to the server's own directory.
 * `?scope=all` asks for the full catalog even when `enabledModels` narrows it.
 */
export function loadModels(
  cwd?: string | null,
  options: RequestOptions & { scopeAll?: boolean; scope?: "all" } = {},
): Promise<ModelsData> {
  const { scopeAll, scope, ...request } = options;
  return req<ModelsData>(
    withQuery("/api/models", {
      cwd: cwd ?? undefined,
      scope: scope ?? (scopeAll ? "all" : undefined),
    }),
    {},
    request,
  );
}

/** `GET /api/tools/settings` — PowerShell and codemode preferences. */
export function loadToolSettings(options: RequestOptions = {}): Promise<ToolSettingsResponse> {
  return req<ToolSettingsResponse>("/api/tools/settings", {}, options);
}
