import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { stripJsonComments } from "./jsonc";
import { invalidateModelsCache } from "./models-cache";

const MODEL_COST_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeModelCost(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const providedKeys = MODEL_COST_KEYS.filter((key) => value[key] !== undefined);
  if (providedKeys.length === 0) return undefined;
  if (providedKeys.some((key) => (
    typeof value[key] !== "number" || !Number.isFinite(value[key])
  ))) return undefined;

  return Object.fromEntries([
    ...Object.entries(value),
    ...MODEL_COST_KEYS.map((key) => [key, value[key] ?? 0]),
  ]);
}

/** Complete partial cost groups with zero; omit a cost group only when it is empty. */
export function normalizeModelsConfigCosts(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = structuredClone(data);
  if (!isRecord(normalized.providers)) return normalized;

  for (const provider of Object.values(normalized.providers)) {
    if (!isRecord(provider) || !Array.isArray(provider.models)) continue;
    for (const model of provider.models) {
      if (!isRecord(model) || !("cost" in model)) continue;
      const cost = normalizeModelCost(model.cost);
      if (cost) model.cost = cost;
      else delete model.cost;
    }
  }
  return normalized;
}

/**
 * Keys that make a provider entry do something. A built-in provider needs none
 * of them in models.json — an entry carrying only a name and an empty `models`
 * array is a leftover from an older Pi Web form, and pi's loader rejects it
 * ("must specify baseUrl, headers, compat, modelOverrides, or models"), which
 * fails every runtime the file is read for. Keep the same list the loader
 * accepts, so a file Pi Web writes is one pi can load.
 */
const PROVIDER_CONFIG_KEYS = [
  "apiKey",
  "oauth",
  "baseUrl",
  "headers",
  "compat",
  "modelOverrides",
  "authHeader",
] as const;

function isEmptyProviderEntry(provider: Record<string, unknown>): boolean {
  if (Array.isArray(provider.models)
    && provider.models.some((model) => isRecord(model) && typeof model.id === "string" && model.id.trim().length > 0)) {
    return false;
  }
  const overrides = provider.modelOverrides;
  if (isRecord(overrides) && Object.keys(overrides).length > 0) return false;
  return !PROVIDER_CONFIG_KEYS.some((key) => (
    key !== "modelOverrides" && provider[key] !== undefined
  ));
}

function sanitizeModelsConfig(data: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(data.providers)) return data;

  const providers = Object.fromEntries(Object.entries(data.providers).flatMap(([providerId, provider]) => {
    if (!isRecord(provider)) return [[providerId, provider]];
    const models = Array.isArray(provider.models)
      ? provider.models.filter((model) => (
        !isRecord(model) || typeof model.id !== "string" || model.id.trim().length > 0
      ))
      : provider.models;
    const cleaned = Array.isArray(models) ? { ...provider, models } : provider;
    return isEmptyProviderEntry(cleaned) ? [] : [[providerId, cleaned]];
  }));

  return { ...data, providers };
}

export function getModelsConfigPath(): string {
  return join(getAgentDir(), "models.json");
}

/** models.json exists but its contents cannot be used, so it must not be replaced. */
export class ModelsConfigReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelsConfigReadError";
  }
}

/**
 * Reads models.json with the same leniency as pi's loader (BOM, `//` comments,
 * trailing commas). `stripJsonComments` also drops block comments, which pi
 * rejects, and returns pi's own result for every file pi accepts. A file pi
 * accepts must never read as empty here: the panel saves its whole draft, so
 * an empty read would delete every provider on the next save. Unusable
 * contents throw instead.
 */
export function readModelsConfig(
  modelsPath = getModelsConfigPath(),
): Record<string, unknown> {
  if (!existsSync(modelsPath)) return { providers: {} };
  let parsed: unknown;
  try {
    const content = readFileSync(modelsPath, "utf8").replace(/^\uFEFF/, "");
    if (!content.trim()) return { providers: {} };
    parsed = JSON.parse(stripJsonComments(content));
  } catch (error) {
    throw new ModelsConfigReadError(
      `Failed to read ${modelsPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new ModelsConfigReadError(`Failed to read ${modelsPath}: expected a JSON object`);
  }
  // The panel shows the readable file, so a leftover empty provider never
  // appears as a broken row; saving then writes it out without the entry.
  return sanitizeModelsConfig(parsed);
}

export function writeModelsConfig(
  data: Record<string, unknown>,
  modelsPath = getModelsConfigPath(),
): void {
  // Refuse to replace a file this panel could not read: the draft being saved
  // was not built from it, so writing would silently discard its contents.
  readModelsConfig(modelsPath);
  const dir = dirname(modelsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const normalized = normalizeModelsConfigCosts(sanitizeModelsConfig(data));
  // models.json may be a symbolic link (a dotfiles setup). The atomic write
  // renames a temp file over the destination path, which would replace the
  // link itself and leave its target holding the old contents, so write
  // through the resolved path instead. A dangling link is refused: the read
  // guard above reports it as missing, and replacing it would silently break
  // the user's link.
  let writePath = modelsPath;
  if (lstatSync(modelsPath, { throwIfNoEntry: false })?.isSymbolicLink()) {
    try {
      writePath = realpathSync(modelsPath);
    } catch {
      throw new ModelsConfigReadError(`Failed to write ${modelsPath}: dangling symbolic link`);
    }
  }
  writePrivateFileAtomicSync(writePath, JSON.stringify(normalized, null, 2));
  invalidateModelsCache();
}
