// fork:upstream-port — upstream-port marker
export interface CompatEntry {
  compat?: Record<string, unknown>;
}

export interface HeaderRow {
  id: number;
  name: string;
  value: string;
}

export const MODEL_COST_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;

export type ModelCostKey = (typeof MODEL_COST_KEYS)[number];

export type ModelCostRates = Record<ModelCostKey, number>;

export type ModelCostDraft = Record<ModelCostKey, string>;

/**
 * fork:cost-tiers (B3) — pi-ai `ModelCostTier`（`dist/types.d.ts` 的
 * `ModelCostTier extends ModelCostRates { inputTokensAbove }`）：请求总输入
 * tokens 超过某个阈值后，整笔请求改用该档价格，取**最高匹配的阈值**（自证：
 * `dist/models.js` 的 `calculateCost()`）。长上下文档位的模型不配阶梯，显示的
 * 基础价和实际扣费就对不上。
 */
export interface ModelCostTier {
  inputTokensAbove: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelCostTierDraft extends ModelCostDraft {
  inputTokensAbove: string;
}

export function modelCostTierToDraft(tier: ModelCostTier): ModelCostTierDraft {
  return { inputTokensAbove: String(tier.inputTokensAbove), ...modelCostToDraft(tier) };
}

/** 阈值必须是正整数（pi 的 schema 是 `Type.Number()`，但 0/负数没有意义），价格四项全填才落盘。 */
export function parseModelCostTier(
  draft: ModelCostTierDraft,
): ModelCostTier | undefined {
  const threshold = Number(draft.inputTokensAbove.trim());
  if (!Number.isInteger(threshold) || threshold <= 0) return undefined;
  const rates = parseCompleteModelCost(draft);
  return rates ? { inputTokensAbove: threshold, ...rates } : undefined;
}

export function hasModelCostTierDraftValue(draft: ModelCostTierDraft): boolean {
  return draft.inputTokensAbove.trim() !== "" || hasModelCostDraftValue(draft);
}

/**
 * 草稿 → 落盘的阶梯数组。阈值必须递增，否则 pi 的「最高匹配阈值」比较会被
 * 后面的乱序档遮蔽 —— 直接按升序排，并丢掉解析不出阈值 / 价格的档。
 */
export function parseModelCostTiers(
  drafts: readonly ModelCostTierDraft[],
): ModelCostTier[] | undefined {
  const tiers = drafts
    .map((draft) => parseModelCostTier(draft))
    .filter((tier): tier is ModelCostTier => tier !== undefined)
    .sort((a, b) => a.inputTokensAbove - b.inputTokensAbove);
  if (!tiers.length) return undefined;
  // 同一阈值重复出现时只留最后一个（读的那一份也是后者生效）。
  return tiers.filter((tier, index) => index === tiers.length - 1 || tiers[index + 1].inputTokensAbove !== tier.inputTokensAbove);
}

export function modelCostToDraft(cost?: Partial<ModelCostRates>): ModelCostDraft {
  return {
    input: cost?.input === undefined ? "" : String(cost.input),
    output: cost?.output === undefined ? "" : String(cost.output),
    cacheRead: cost?.cacheRead === undefined ? "" : String(cost.cacheRead),
    cacheWrite: cost?.cacheWrite === undefined ? "" : String(cost.cacheWrite),
  };
}

export function parseCompleteModelCost(draft: ModelCostDraft): ModelCostRates | undefined {
  if (!hasModelCostDraftValue(draft)) return undefined;

  const parse = (value: string): number | undefined => {
    if (!value.trim()) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };
  const input = parse(draft.input);
  const output = parse(draft.output);
  const cacheRead = parse(draft.cacheRead);
  const cacheWrite = parse(draft.cacheWrite);
  if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) {
    return undefined;
  }
  return { input, output, cacheRead, cacheWrite };
}

export function hasModelCostDraftValue(draft: ModelCostDraft): boolean {
  return MODEL_COST_KEYS.some((key) => draft[key].trim() !== "");
}

export function setCompatBool<T extends CompatEntry>(entry: T, key: string, value: boolean): T {
  return {
    ...entry,
    compat: { ...(entry.compat ?? {}), [key]: value },
  };
}

export function updateHeaderRow(
  rows: readonly HeaderRow[],
  id: number,
  changes: Partial<Pick<HeaderRow, "name" | "value">>,
): HeaderRow[] {
  return rows.map((row) => row.id === id ? { ...row, ...changes } : row);
}

/**
 * Model-level `headers` are merged over the provider's, so an empty value is not
 * "clear it" — it silently blanks a header the provider still needs. Drop those rows.
 * (Upstream closed PR #482①, same bug on both sides.)
 */
export function serializeHeaderRows(rows: readonly HeaderRow[]): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (!name || !row.value.trim()) continue;
    headers[name] = row.value;
  }
  return Object.keys(headers).length ? headers : undefined;
}

/** The parts of models.json the rename tracking needs. */
export interface ModelsConfigDraft {
  providers?: Record<string, { models?: { id: string }[] }>;
}

/** Snapshot of the model ids models.json holds, by provider and slot. */
export function savedModelIds(config: ModelsConfigDraft): Map<string, (string | null)[]> {
  return new Map(Object.entries(config.providers ?? {}).map(([name, provider]) => [
    name,
    (provider.models ?? []).map((model) => model.id),
  ]));
}

export function trackAddedModels(slots: Map<string, (string | null)[]>, providerName: string, count: number) {
  if (count <= 0) return;
  const existing = slots.get(providerName) ?? [];
  slots.set(providerName, [...existing, ...Array.from({ length: count }, () => null)]);
}

/**
 * Model ids that changed in place since the last save, as full references.
 *
 * `from` keeps the provider id the settings file still spells, so the server
 * can rewrite the entry before it applies the provider renames.
 */
export function collectModelRenames(
  config: ModelsConfigDraft,
  slots: Map<string, (string | null)[]>,
  providerRenames: Map<string, string>,
): { from: string; to: string }[] {
  const originalProvider = (name: string) => {
    for (const [from, to] of providerRenames) if (to === name) return from;
    return name;
  };

  const renames: { from: string; to: string }[] = [];
  for (const [name, provider] of Object.entries(config.providers ?? {})) {
    const saved = slots.get(name);
    if (!saved) continue;
    (provider.models ?? []).forEach((model, index) => {
      const before = saved[index];
      if (!before || !model.id || before === model.id) return;
      renames.push({ from: `${originalProvider(name)}/${before}`, to: `${name}/${model.id}` });
    });
  }
  return renames;
}

/** What the panel remembers between saves to tell renames from edits. */
export interface ProviderRenameTracking {
  /** Provider ids as models.json has them on disk. */
  savedProviders: Set<string>;
  /** Saved provider id -> where renames since the last save moved it. */
  renames: Map<string, string>;
  /** Saved model ids per provider, keyed by the provider's current id. */
  slots: Map<string, (string | null)[]>;
}

/**
 * fork:model-rename-save (upstream bd85004 / #969, fixes #903) — moves a provider to a
 * new id while keeping its place in models.json, and records the move so the
 * enabledModels entries can follow it on save.
 *
 * Returns null and records nothing when the provider is gone or the new id is
 * already taken: models.json is keyed by id, so the move would silently replace
 * the other provider. Returns the config unchanged when the id already matches.
 */
export function renameProviderEntry<T extends ModelsConfigDraft>(
  config: T,
  tracking: ProviderRenameTracking,
  oldName: string,
  newName: string,
): T | null {
  const providers = config.providers ?? {};
  if (!Object.hasOwn(providers, oldName)) return null;
  if (oldName === newName) return config;
  if (Object.hasOwn(providers, newName)) return null;

  const { renames, savedProviders, slots } = tracking;
  // A provider may already have been renamed once; keep the disk spelling as the
  // from side so `enabledModels` entries follow a single move, not a chain.
  let original = oldName;
  for (const [from, to] of renames) {
    if (to !== oldName) continue;
    original = from;
    break;
  }
  if (original === newName) renames.delete(original);
  else if (savedProviders.has(original)) renames.set(original, newName);
  const saved = slots.get(oldName);
  if (saved) {
    slots.delete(oldName);
    slots.set(newName, saved);
  }

  const entries = Object.entries(providers);
  const index = entries.findIndex(([name]) => name === oldName);
  entries[index] = [newName, entries[index][1]];
  return { ...config, providers: Object.fromEntries(entries) };
}

/**
 * D2-PR-21 — render one level's actual request params as a single compact line.
 *
 * The values come from `lib/thinking-request-core.ts`, a read-only mirror of pi-ai's request
 * construction, so this is what the provider would really receive for that level.
 * Returns null when the level sends no reasoning params at all.
 */
export function formatThinkingRequestParams(params: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        walk(nested, path ? `${path}.${key}` : key);
      }
      return;
    }
    parts.push(`${path}=${Array.isArray(value) ? value.join("|") : String(value)}`);
  };
  walk(params, "");
  return parts.length > 0 ? parts.join(", ") : null;
}
