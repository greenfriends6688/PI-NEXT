// Settings › Models: the provider / model tree on the left, the selected
// entry's editor on the right, and one Save for models.json.
//
// This is pi-next's `components/ModelsConfig.tsx` split into our shell:
// `ConfigSplit` draws the 250-point tree, the detail pane and the pinned
// footer; `Models.tsx` puts the default-model band above it. The tree holds
// four kinds of rows, each with its own detail:
//
// - an active OAuth provider (`GET /api/auth/providers`, `loggedIn`): the
//   same sign-in stream and paste panel as `Auth.tsx`
//   (`GET /api/auth/login/<provider>`), its quota, and every enabled model;
// - an active API-key provider (`configured`): the key field
//   (`POST`/`DELETE /api/auth/api-key/<provider>`), its quota, and every
//   enabled model;
// - a custom provider from models.json: Base URL, protocol, key, headers,
//   Discover and its models;
// - one model under a custom provider: id, name, context window, prices,
//   thinking-level map and compatibility flags.
//
// models.json itself is one draft until Save (`PUT /api/models-config`).
// The editor keeps every field the file had, normalizes only what the server
// requires, and shows the route's refusal verbatim. A provider's enabled
// models are the exception: those switches write `PUT /api/models/enabled`
// immediately, as pi-next does, because `enabledModels` lives in
// settings.json rather than in this file.
//
// "Add Provider" is the reference's picker: a searchable card dialog of the
// signed-in services, the API-key providers that are not configured yet, and
// a custom OpenAI/Anthropic-compatible endpoint. Choosing OAuth starts that
// sign-in, choosing an API key opens its detail, and choosing custom appends
// `new-provider` and opens it.
//
// Everything visual is the gallery kit through `./parts`; no Tailwind of our
// own.

import type { JSX } from "nsh";
import { cleanup, effect, openUrl, resource, Scroll, signal, Text, View, windowSize } from "nsh";
import { Checkbox, Dialog, Input } from "nsh/base";
import {
  alpha,
  Badge,
  Button,
  backdrop,
  CheckboxMark,
  checkboxLook,
  colors,
  dialogCard,
  dialogTitle,
  Icon,
  inputLook,
  RoundButton,
  Status,
  type IconName,
} from "../../ui/kit";
import {
  clearEnabledModels,
  loadEnabledModels,
  pruneEnabledModels,
  setModelsEnabled,
  setProviderEnabled,
  type EnabledModelView,
  type EnabledModelsView,
} from "../../api/config";
import {
  authErrorText,
  authMessageText,
  deleteApiKey,
  loadAuthProviders,
  logoutOAuth,
  saveApiKey,
  startOAuthLogin,
  submitOAuthCode,
  type ApiKeyProviderInfo,
  type AuthChoice,
  type AuthLoginEvent,
  type OAuthProviderInfo,
} from "../../api/auth";
import {
  discoverProviderModels,
  loadModelsConfig,
  saveModelsConfig,
  testProviderModel,
  type DiscoveredModel,
  type ModelsJsonConfig,
  type ModelsJsonModel,
  type ModelsJsonModelCost,
  type ModelsJsonProvider,
} from "../../api/models-config";
import { errorText } from "../../ui/errors";
import { mono, sans } from "../../ui/fonts";
import { activeCwd, settingsOpen } from "../../state/session";
import { t } from "../../ui/i18n";
import { ProviderUsageSummary } from "./ProviderUsageSummary";
import {
  ConfigDetailTitle,
  ConfigEmpty,
  ConfigField,
  ConfigFooter,
  ConfigListAction,
  ConfigRowText,
  ConfigSectionTitle,
  ConfigSidebarItem,
  ConfigSidebarLabel,
  ConfigSplit,
  ConfigText,
  SettingsError,
  SettingsSelect,
  SettingsLoading,
  SettingsSwitch,
  SETTINGS_DETAIL,
  SETTINGS_LABEL,
  settingsCode,
} from "./parts";

// ── Schema-shaped form values ────────────────────────────────────────────────

const API_OPTIONS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;

const API_DEFAULT = "__pi_default__";

const PROVIDER_TYPE_ITEMS = [
  { value: "apikey", labelKey: "models.typeApiKey" },
  { value: "oauth", labelKey: "models.typeOAuthRadius" },
];

function providerTypeItems(): { value: string; title: string }[] {
  return PROVIDER_TYPE_ITEMS.map((item) => ({ value: item.value, title: t(item.labelKey) }));
}

const COST_KEYS = ["input", "output", "cacheRead", "cacheWrite"] as const;
type CostKey = typeof COST_KEYS[number];

const COST_FIELDS: { key: CostKey; labelKey: string }[] = [
  { key: "input", labelKey: "models.costInput" },
  { key: "output", labelKey: "models.costOutput" },
  { key: "cacheRead", labelKey: "models.costCacheRead" },
  { key: "cacheWrite", labelKey: "models.costCacheWrite" },
];

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = typeof THINKING_LEVELS[number];

type ProviderPair = [string, ModelsJsonProvider];

interface ModelDraft {
  id: string;
  name: string;
  contextWindow: string;
  maxTokens: string;
  cost: Record<CostKey, string>;
}

type TestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "success"; latencyMs?: number; status?: number; responseText?: string }
  | { phase: "error"; message: string; latencyMs?: number; status?: number };

type DiscoveryState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; models: DiscoveredModel[]; endpoint: string }
  | { phase: "error"; message: string };

type Selection =
  | { type: "provider"; name: string }
  | { type: "model"; providerName: string; index: number }
  | { type: "oauth"; providerId: string }
  | { type: "apikey"; providerId: string };

/** The enabled-model switches every provider detail shares. */
interface EnabledActions {
  view: () => EnabledModelsView | undefined;
  pending: () => string | null;
  failure: () => string | null;
  notice: () => string | null;
  setModels: (key: string, refs: string[], enabled: boolean) => void;
  setProvider: (providerId: string, enabled: boolean) => void;
  clear: () => void;
  prune: () => void;
  refresh: () => void;
  contextOf: (providerId: string, modelId: string) => unknown;
  setContext: (providerId: string, modelId: string, value: string) => void;
  draftDisabled: () => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The draft is JSON (it came from models.json), so a JSON copy is enough. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isProviderEntry(value: unknown): value is ModelsJsonProvider {
  return isRecord(value);
}

function isModelEntry(value: unknown): value is ModelsJsonModel {
  return isRecord(value);
}

function trimText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function providerKind(provider: ModelsJsonProvider): "oauth" | "apikey" {
  return provider.oauth ? "oauth" : "apikey";
}

function providerTitle(name: string, provider: ModelsJsonProvider): string {
  return trimText(provider.name) && provider.name!.trim() !== name ? provider.name!.trim() : name;
}

function providerDetail(name: string, provider: ModelsJsonProvider): string {
  const count = provider.models?.length ?? 0;
  const parts: string[] = [];
  if (providerTitle(name, provider) !== name) parts.push(name);
  parts.push(providerKind(provider));
  parts.push(trimText(provider.baseUrl) ?? t("models.piDefault"));
  parts.push(t(count === 1 ? "models.modelCountOne" : "models.modelCount", { count }));
  return parts.join(" · ");
}

function modelLabel(model: ModelsJsonModel): string {
  return trimText(model.name) ?? trimText(model.id) ?? t("i18n.newModel");
}

function modelSidebarLabel(model: ModelsJsonModel): string {
  return trimText(model.name) ?? trimText(model.id) ?? t("i18n.newModel");
}

function modelCountText(count: number): string {
  return t(count === 1 ? "models.modelCountOne" : "models.modelCount", { count });
}

function hasCost(cost: ModelsJsonModelCost | undefined): boolean {
  if (!cost) return false;
  return COST_KEYS.some((key) => cost[key] !== undefined);
}

function costDraft(cost: ModelsJsonModelCost | undefined): Record<CostKey, string> {
  return {
    input: cost?.input === undefined ? "" : String(cost.input),
    output: cost?.output === undefined ? "" : String(cost.output),
    cacheRead: cost?.cacheRead === undefined ? "" : String(cost.cacheRead),
    cacheWrite: cost?.cacheWrite === undefined ? "" : String(cost.cacheWrite),
  };
}

function modelDraft(model: ModelsJsonModel): ModelDraft {
  return {
    id: typeof model.id === "string" ? model.id : "",
    name: typeof model.name === "string" ? model.name : "",
    contextWindow: model.contextWindow === undefined ? "" : String(model.contextWindow),
    maxTokens: model.maxTokens === undefined ? "" : String(model.maxTokens),
    cost: costDraft(model.cost),
  };
}

/** A number the draft typed, or the old value when the text is not one. */
function draftNumber(text: string, previous: number | undefined): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : previous;
}

/** Prices: blank removes the rate; text that is not a number keeps the old one. */
function costFromDraft(
  draft: Record<CostKey, string>,
  previous: ModelsJsonModelCost | undefined,
): ModelsJsonModelCost | undefined {
  const cost: ModelsJsonModelCost = { ...(previous ?? {}) };
  for (const key of COST_KEYS) {
    const text = draft[key].trim();
    if (!text) {
      delete cost[key];
      continue;
    }
    const value = Number(text);
    if (Number.isFinite(value)) cost[key] = value;
  }
  return Object.keys(cost).length > 0 ? cost : undefined;
}

function modelFromDraft(base: ModelsJsonModel, draft: ModelDraft): ModelsJsonModel {
  const next: ModelsJsonModel = { ...base, id: draft.id };
  const name = draft.name.trim();
  if (name) next.name = name;
  else delete next.name;
  const contextWindow = draftNumber(draft.contextWindow, base.contextWindow);
  if (contextWindow === undefined) delete next.contextWindow;
  else next.contextWindow = contextWindow;
  const maxTokens = draftNumber(draft.maxTokens, base.maxTokens);
  if (maxTokens === undefined) delete next.maxTokens;
  else next.maxTokens = maxTokens;
  const cost = costFromDraft(draft.cost, base.cost);
  if (cost) next.cost = cost;
  else delete next.cost;
  return next;
}

function modelFromDiscovered(model: DiscoveredModel): ModelsJsonModel {
  const next: ModelsJsonModel = { id: model.id };
  if (model.name && model.name !== model.id) next.name = model.name;
  if (model.reasoning) next.reasoning = true;
  if (model.thinkingLevelMap) next.thinkingLevelMap = { ...model.thinkingLevelMap };
  if (model.contextWindow !== undefined) next.contextWindow = model.contextWindow;
  if (model.maxTokens !== undefined) next.maxTokens = model.maxTokens;
  return next;
}

function testText(state: TestState): string {
  if (state.phase === "testing") return t("models.testing");
  if (state.phase === "idle") return "";
  const meta = [
    state.latencyMs !== undefined ? `${state.latencyMs}ms` : null,
    state.status !== undefined ? `HTTP ${state.status}` : null,
  ].filter((part): part is string => part !== null);
  if (state.phase === "success") {
    return ["OK", ...meta, state.responseText || null].filter((part): part is string => Boolean(part)).join(" · ");
  }
  return [t("i18n.failed"), ...meta, state.message].filter((part): part is string => Boolean(part)).join(" · ");
}

/** What Save must refuse before the server drops it: a blank model id is
 * removed by the store, and pi rejects a non-positive window or output limit. */
function localProblem(config: ModelsJsonConfig): string | null {
  for (const [providerName, entry] of Object.entries(config.providers ?? {})) {
    if (!isProviderEntry(entry)) {
      return t("models.providerNotObject", { provider: providerName });
    }
    if (entry.models !== undefined && !Array.isArray(entry.models)) {
      return t("models.providerModelsArray", { provider: providerName });
    }
    for (const [index, model] of (entry.models ?? []).entries()) {
      if (!isModelEntry(model)) {
        return t("models.modelNotObject", { provider: providerName, index: index + 1 });
      }
      if (typeof model.id !== "string" || !model.id.trim()) {
        return t("models.modelIdRequired", { provider: providerName, index: index + 1 });
      }
      if (model.contextWindow !== undefined
        && (typeof model.contextWindow !== "number" || !Number.isFinite(model.contextWindow) || model.contextWindow <= 0)) {
        return t("models.contextPositive", { provider: providerName, model: model.id });
      }
      if (model.maxTokens !== undefined
        && (typeof model.maxTokens !== "number" || !Number.isFinite(model.maxTokens) || model.maxTokens <= 0)) {
        return t("models.maxTokensPositive", { provider: providerName, model: model.id });
      }
    }
    if (isRecord(entry.modelOverrides)) {
      for (const [modelId, override] of Object.entries(entry.modelOverrides)) {
        if (!isRecord(override) || override.contextWindow === undefined) continue;
        const value = override.contextWindow;
        const text = typeof value === "string" ? value.trim() : "";
        const number = typeof value === "number" ? value : Number(text);
        if (!Number.isInteger(number) || number <= 0) {
          return t("models.contextInvalid", { model: modelId });
        }
      }
    }
  }
  return null;
}

/** Trim the fields pi's schema requires to be non-empty; blank removes them. */
function normalizeForSave(config: ModelsJsonConfig): ModelsJsonConfig {
  const next = cloneJson(config);
  next.providers = next.providers ?? {};
  for (const entry of Object.values(next.providers)) {
    if (!isProviderEntry(entry)) continue;
    const baseUrl = trimText(entry.baseUrl);
    if (baseUrl) entry.baseUrl = baseUrl;
    else delete entry.baseUrl;
    const api = trimText(entry.api);
    if (api) entry.api = api;
    else delete entry.api;
    if (entry.apiKey !== undefined && (typeof entry.apiKey !== "string" || !entry.apiKey.trim())) delete entry.apiKey;
    const name = trimText(entry.name);
    if (name) entry.name = name;
    else delete entry.name;
    for (const model of entry.models ?? []) {
      if (!isModelEntry(model)) continue;
      model.id = model.id.trim();
      const modelName = trimText(model.name);
      if (modelName) model.name = modelName;
      else delete model.name;
      const modelBaseUrl = trimText(model.baseUrl);
      if (modelBaseUrl) model.baseUrl = modelBaseUrl;
      else delete model.baseUrl;
      const modelApi = trimText(model.api);
      if (modelApi) model.api = modelApi;
      else delete model.api;
    }
    if (isRecord(entry.modelOverrides)) {
      for (const [modelId, override] of Object.entries(entry.modelOverrides)) {
        if (!isRecord(override)) continue;
        if (typeof override.contextWindow === "string") {
          const value = Number(override.contextWindow.trim());
          if (Number.isInteger(value) && value > 0) override.contextWindow = value;
        }
        if (Object.keys(override).length === 0) delete entry.modelOverrides[modelId];
      }
      if (Object.keys(entry.modelOverrides).length === 0) delete entry.modelOverrides;
    }
  }
  return next;
}

function contextText(value: unknown): string {
  return typeof value === "number" || typeof value === "string" ? String(value) : "";
}

/** Write one model's context override into the draft. The text stays a string
 * until Save, so an in-progress number is not silently replaced. */
function withContextOverride(
  config: ModelsJsonConfig,
  providerId: string,
  modelId: string,
  value: string,
): ModelsJsonConfig {
  const next = cloneJson(config);
  next.providers = next.providers ?? {};
  const existing = next.providers[providerId];
  const provider: ModelsJsonProvider = isProviderEntry(existing) ? existing : {};
  if (!isRecord(provider.modelOverrides)) provider.modelOverrides = {};
  const overrides = provider.modelOverrides;
  const current = overrides[modelId];
  const override: Record<string, unknown> = isRecord(current) ? { ...current } : {};
  if (value.trim() === "") delete override.contextWindow;
  else override.contextWindow = value;
  if (Object.keys(override).length > 0) overrides[modelId] = override;
  else delete overrides[modelId];
  if (Object.keys(overrides).length === 0) delete provider.modelOverrides;
  if (Object.keys(provider).length > 0) next.providers[providerId] = provider;
  else delete next.providers[providerId];
  return next;
}

function effectiveCompat(provider: ModelsJsonProvider, model: ModelsJsonModel): Record<string, unknown> {
  return { ...(provider.compat ?? {}), ...(model.compat ?? {}) };
}

function setCompatValue(model: ModelsJsonModel, key: string, value: unknown): ModelsJsonModel {
  const next = { ...model };
  const compat = { ...(model.compat ?? {}) };
  if (value === undefined) delete compat[key];
  else compat[key] = value;
  if (Object.keys(compat).length > 0) next.compat = compat;
  else delete next.compat;
  return next;
}

function hasDeepseekCompat(model: ModelsJsonModel): boolean {
  return model.compat?.thinkingFormat === "deepseek";
}

function setDeepseekCompat(model: ModelsJsonModel, enabled: boolean): ModelsJsonModel {
  let next = setCompatValue(model, "thinkingFormat", enabled ? "deepseek" : undefined);
  next = setCompatValue(next, "requiresReasoningContentOnAssistantMessages", enabled ? true : undefined);
  return next;
}

/** A provider entry that only carries `modelOverrides` belongs to the managed
 * provider of the same id, not to a second custom provider in the tree. */
function isOverridesOnly(entry: ModelsJsonProvider): boolean {
  return Object.keys(entry).length === 1 && Object.keys(entry.modelOverrides ?? {}).length > 0;
}

function providerMatches(query: string, id: string, name: string): boolean {
  if (query === "") return true;
  return id.toLowerCase().includes(query)
    || name.toLowerCase().includes(query);
}

// ── Small form pieces (the kit's look, no Tailwind) ─────────────────────────

function Field(props: { label: string; hint?: string; wide?: boolean; children: JSX.Element }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: props.wide ? 300 : 190, minWidth: 160, gap: 4 }}>
      <ConfigField label={props.label}>{props.children}</ConfigField>
      <If when={props.hint !== undefined}>
        <Text style={{ fontSize: SETTINGS_DETAIL, lineHeight: 15, color: colors.faint }}>{props.hint ?? ""}</Text>
      </If>
    </View>
  );
}

function SwitchField(props: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexGrow: 1, flexBasis: 190, minWidth: 160 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontSize: SETTINGS_LABEL, color: colors.text }}>{props.label}</Text>
        <If when={props.detail !== undefined}>
          <Text style={{ fontSize: SETTINGS_DETAIL, color: colors.muted }}>{props.detail ?? ""}</Text>
        </If>
      </View>
      <SettingsSwitch value={props.value} onChange={props.onChange} label={props.label} />
    </View>
  );
}

function SelectCheckbox(props: {
  checked: () => boolean;
  indeterminate?: () => boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  children: JSX.Element;
}) {
  const box = checkboxLook({ disabled: () => props.disabled === true });
  const indeterminate = () => props.indeterminate?.() === true;
  return (
    <Checkbox
      checked={props.checked()}
      indeterminate={indeterminate()}
      disabled={props.disabled}
      onChange={({ checked }) => props.onChange(checked)}
      accessibilityLabel={props.label}
      indicatorClass={box.indicatorClass}
      indicatorStyle={box.indicatorStyle}
      indicator={<CheckboxMark mark={props.checked() ? "check" : indeterminate() ? "dash" : null} />}
      style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}
    >
      {props.children}
    </Checkbox>
  );
}

/** A provider's mark in the tree and the picker. Brand artwork is not bundled,
 * so a stable glyph per family stands in for it. */
function providerGlyph(id: string): { name: IconName; tint: string } {
  const key = id.toLowerCase();
  if (key.includes("anthropic") || key.includes("claude")) return { name: "bulb", tint: colors.accent };
  if (key.includes("google") || key.includes("gemini")) return { name: "star", tint: colors.warn };
  if (key.includes("openai") || key.includes("gpt")) return { name: "spark", tint: colors.up };
  if (key.includes("deepseek")) return { name: "layers", tint: colors.accent };
  if (key.includes("opencode") || key.includes("code")) return { name: "code", tint: colors.accent };
  if (key.includes("xai") || key.includes("grok")) return { name: "chat", tint: colors.muted };
  return { name: "components", tint: colors.muted };
}

function ProviderMark(props: { id: string; size?: number }) {
  const glyph = () => providerGlyph(props.id);
  const size = props.size ?? 16;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: alpha(glyph().tint, 0.12),
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Icon name={glyph().name} size={Math.round(size * 0.62)} tint={glyph().tint} />
    </View>
  );
}

interface HeaderRow {
  id: number;
  name: string;
  value: string;
}

function serializeHeaders(rows: readonly HeaderRow[]): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name) headers[name] = row.value;
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function HeadersEditor(props: {
  headers: Record<string, string> | undefined;
  onChange: (headers: Record<string, string> | undefined) => void;
}) {
  const initial = Object.entries(props.headers ?? {}).map(([name, value], id) => ({ id, name, value }));
  const rows = signal<HeaderRow[]>(initial);
  let nextId = initial.length;
  const field = inputLook({ style: { flex: 1, minWidth: 0, fontFamily: sans } });

  const apply = (next: HeaderRow[]): void => {
    rows.set(next);
    props.onChange(serializeHeaders(next));
  };

  return (
    <View style={{ gap: 6 }}>
      <Each of={rows()} key={(row) => row.id}>
        {(row) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Input
              class={field.class}
              style={field.style}
              value={row().name}
              onChange={({ value }) => apply(rows().map((entry) => (
                entry.id === row().id ? { ...entry, name: value } : entry
              )))}
              placeholder="Header-Name"
              accessibilityLabel={t("models.headers")}
              autoComplete="off"
            />
            <Input
              class={field.class}
              style={field.style}
              value={row().value}
              onChange={({ value }) => apply(rows().map((entry) => (
                entry.id === row().id ? { ...entry, value } : entry
              )))}
              placeholder={t("models.headers")}
              accessibilityLabel={`${t("models.headers")} · ${row().name}`}
              autoComplete="off"
            />
            <RoundButton
              icon="minus"
              label={t("i18n.remove")}
              variant="secondary"
              size={24}
              onPress={() => apply(rows().filter((entry) => entry.id !== row().id))}
            />
          </View>
        )}
      </Each>
      <Button
        label={`+ ${t("models.addHeader")}`}
        variant="secondary"
        size="small"
        onPress={() => apply([...rows(), { id: nextId++, name: "", value: "" }])}
      />
    </View>
  );
}

function ThinkingLevelMapEditor(props: {
  value: () => Record<string, string | null> | undefined;
  onChange: (value: Record<string, string | null> | undefined) => void;
}) {
  const field = inputLook({ style: { width: 130, fontFamily: sans } });

  const setLevel = (level: ThinkingLevel, next: string | null | "omit"): void => {
    const map = { ...(props.value() ?? {}) };
    if (next === "omit") delete map[level];
    else map[level] = next;
    props.onChange(Object.keys(map).length > 0 ? map : undefined);
  };

  return (
    <View style={{ gap: 2 }}>
      <Each of={[...THINKING_LEVELS]} key={(level) => level}>
        {(level) => {
          const map = () => props.value() ?? {};
          const raw = () => map()[level()];
          const state = (): "omit" | "null" | "string" => (
            !(level() in map()) ? "omit" : raw() === null ? "null" : "string"
          );
          return (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                paddingVertical: 4,
                borderTopWidth: level() === "off" ? 0 : 1,
                borderTopColor: colors.line,
              }}
            >
              <Text style={{ width: 62, fontSize: 11, fontFamily: mono, color: colors.muted }}>
                {level()}
              </Text>
              <Button
                label={t("i18n.default")}
                variant="secondary"
                size="small"
                selected={state() === "omit"}
                onPress={() => setLevel(level(), "omit")}
              />
              <Button
                label={t("i18n.disabled")}
                variant={state() === "null" ? "danger" : "secondary"}
                size="small"
                selected={state() === "null"}
                onPress={() => setLevel(level(), null)}
              />
              <Button
                label={t("i18n.custom")}
                variant={state() === "string" ? "primary" : "secondary"}
                size="small"
                selected={state() === "string"}
                onPress={() => setLevel(level(), typeof raw() === "string" && raw() !== "" ? raw()! : level())}
              />
              <Input
                class={field.class}
                style={field.style}
                value={state() === "string" ? String(raw() ?? "") : ""}
                onChange={({ value }) => setLevel(level(), value)}
                placeholder={level()}
                accessibilityLabel={`${t("models.thinkingLevelMap")} · ${level()}`}
                autoComplete="off"
              />
            </View>
          );
        }}
      </Each>
    </View>
  );
}

// ── Enabled models: switches write immediately, context edits stay a draft ──

function EnabledModelsSection(props: { providerId: string; actions: EnabledActions }) {
  const query = signal("");
  const search = inputLook({ style: { flex: 1, minWidth: 0, fontFamily: sans } });
  const contextField = inputLook({ style: { width: 112, fontFamily: sans } });

  const provider = () => props.actions.view()?.providers.find((entry) => entry.id === props.providerId);
  const editable = () => props.actions.view()?.editable === true;
  const busy = () => props.actions.pending() !== null;
  const filtered = (): EnabledModelView[] => {
    const current = provider();
    if (!current) return [];
    const needle = query().trim().toLowerCase();
    if (needle === "") return current.models;
    return current.models.filter((model) => (
      model.id.toLowerCase().includes(needle)
      || model.name.toLowerCase().includes(needle)
      || model.ref.toLowerCase().includes(needle)
    ));
  };
  const isFiltered = (): boolean => {
    const current = provider();
    return current !== undefined && query().trim() !== "" && filtered().length !== current.models.length;
  };
  const allOn = (): boolean => {
    const current = provider();
    return current !== undefined && current.models.length > 0 && current.enabledCount === current.models.length;
  };
  const allOff = (): boolean => provider()?.enabledCount === 0;
  /** Turning these off must not leave the selector with no model at all. */
  const offWouldLeaveNone = (): boolean => {
    const view = props.actions.view();
    const current = provider();
    if (!view || !current) return false;
    const targets = isFiltered() ? filtered() : current.models;
    const enabled = targets.filter((model) => model.enabled).length;
    return view.enabledTotal - enabled <= 0;
  };

  const runBulk = (enabled: boolean): void => {
    const current = provider();
    if (!current) return;
    if (isFiltered()) {
      props.actions.setModels(`provider:${current.id}`, filtered().map((model) => model.ref), enabled);
    } else {
      props.actions.setProvider(current.id, enabled);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <If when={props.actions.view() === undefined}>
        <SettingsLoading label={t("settings.loadingEnabledModels")} />
      </If>
      <If when={props.actions.view() !== undefined && provider() === undefined}>
        <ConfigText
          text={props.actions.failure() ?? t("models.enabledUnavailable")}
          tone={props.actions.failure() ? "danger" : "muted"}
        />
      </If>
      <If when={provider() !== undefined}>
        <View style={{ gap: 10 }}>
          <ConfigSectionTitle
            text={t("models.enabledSection")}
            aside={t("models.enabledCount", {
              enabled: provider()?.enabledCount ?? 0,
              total: provider()?.models.length ?? 0,
            })}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
            <Button
              label={isFiltered() ? t("models.enableShown") : t("models.enableAll")}
              variant="secondary"
              size="small"
              disabled={busy() || filtered().length === 0 || allOn()}
              onPress={() => runBulk(true)}
            />
            <Button
              label={isFiltered() ? t("models.disableShown") : t("models.disableAll")}
              variant="secondary"
              size="small"
              disabled={busy() || filtered().length === 0 || allOff() || offWouldLeaveNone()}
              onPress={() => runBulk(false)}
            />
            <Button
              label={t("models.refreshCatalog")}
              variant="secondary"
              size="small"
              disabled={busy()}
              onPress={props.actions.refresh}
            />
            <If when={editable() && (props.actions.view()?.stalePatterns.length ?? 0) > 0}>
              <Button
                label={t("models.enabledPrune")}
                variant="secondary"
                size="small"
                disabled={busy()}
                onPress={props.actions.prune}
              />
            </If>
            <If when={editable() && props.actions.view()?.allEnabled === false}>
              <Button
                label={t("models.enabledClear")}
                variant="secondary"
                size="small"
                disabled={busy()}
                onPress={props.actions.clear}
              />
            </If>
          </View>
          <If when={!editable()}>
            <ConfigText text={t("models.enabledProjectScope")} />
          </If>
          <If when={offWouldLeaveNone() && filtered().some((model) => model.enabled)}>
            <ConfigText tone="warn" text={t("models.enabledLastModel")} />
          </If>
          <If when={props.actions.notice()}>
            <ConfigText text={props.actions.notice() ?? ""} />
          </If>
          <If when={props.actions.failure()}>
            <ConfigText tone="danger" text={props.actions.failure() ?? ""} />
          </If>
          <Input
            class={search.class}
            style={search.style}
            value={query()}
            onChange={({ value }) => query.set(value)}
            placeholder={t("models.enabledFilterPlaceholder", { count: provider()?.models.length ?? 0 })}
            accessibilityLabel={t("models.enabledFilter")}
            autoComplete="off"
          />
          <ConfigText text={t("models.contextOverrideHelp")} />
          <View>
            <Each of={filtered()} key={(model) => model.ref}>
              {(model, index) => {
                const override = () => props.actions.contextOf(props.providerId, model().id);
                return (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingVertical: 7,
                      borderTopWidth: index() === 0 ? 0 : 1,
                      borderTopColor: colors.line,
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <Text style={{ fontSize: 12.5, color: colors.text, numberOfLines: 1 }}>
                        {model().name || model().id}
                      </Text>
                      <Text style={{ ...settingsCode(), fontSize: 10.5, color: colors.faint, numberOfLines: 1 }}>
                        {model().id}
                      </Text>
                    </View>
                    <If when={model().thinkingPin !== undefined}>
                      <Badge label={model().thinkingPin!} tone="accent" outline />
                    </If>
                    <Input
                      class={contextField.class}
                      style={contextField.style}
                      value={contextText(override())}
                      onChange={({ value }) => props.actions.setContext(props.providerId, model().id, value)}
                      placeholder={model().contextWindow === undefined ? "" : String(model().contextWindow)}
                      keyboardType="number-pad"
                      disabled={props.actions.draftDisabled()}
                      accessibilityLabel={t("models.contextForModel", { model: model().name || model().id })}
                    />
                    <SettingsSwitch
                      value={model().enabled}
                      disabled={busy()
                        || !editable()
                        || (model().enabled && (props.actions.view()?.enabledTotal ?? 0) <= 1)}
                      label={t("models.enabledToggle", { model: model().name || model().id })}
                      onChange={(on) => props.actions.setModels(model().ref, [model().ref], on)}
                    />
                  </View>
                );
              }}
            </Each>
          </View>
          <If when={filtered().length === 0}>
            <ConfigText text={t("models.enabledNoMatches")} />
          </If>
        </View>
      </If>
    </View>
  );
}

/** The provider-level enabled switch a custom provider keeps in its header. */
function ProviderEnabledSwitch(props: { providerId: string; actions: EnabledActions }) {
  const provider = () => props.actions.view()?.providers.find((entry) => entry.id === props.providerId);
  const allOn = (): boolean => {
    const current = provider();
    return current !== undefined && current.models.length > 0 && current.enabledCount === current.models.length;
  };
  return (
    <If when={provider() !== undefined}>
      <SettingsSwitch
        value={allOn()}
        disabled={props.actions.pending() !== null || props.actions.view()?.editable !== true}
        label={t("models.enabledProviderToggle", { provider: props.providerId })}
        onChange={(on) => props.actions.setProvider(props.providerId, on)}
      />
    </If>
  );
}

interface ModelEnabledSwitchProps {
  providerName: string;
  modelId: string;
  actions: EnabledActions;
}

/** The per-model switch a custom model keeps in its detail header. */
function ModelEnabledSwitch(props: ModelEnabledSwitchProps) {
  const known = () => props.actions.view()?.providers
    .find((provider) => provider.id === props.providerName)
    ?.models.find((model) => model.id === props.modelId);
  return (
    <If when={known() !== undefined}>
      <SettingsSwitch
        value={known()?.enabled === true}
        disabled={props.actions.pending() !== null || props.actions.view()?.editable !== true}
        label={t("models.enabledToggle", { model: props.modelId })}
        onChange={(on) => {
          const model = known();
          if (model) props.actions.setModels(model.ref, [model.ref], on);
        }}
      />
    </If>
  );
}


// ── OAuth detail: the compact sign-in flow from Auth.tsx ────────────────────

type LoginState =
  | { phase: "connecting" }
  | { phase: "auth"; url: string; instructions: string | null; token: string }
  | {
    phase: "device_code";
    userCode: string;
    verificationUri: string;
    intervalSeconds: number | null;
    expiresInSeconds: number | null;
  }
  | { phase: "prompt"; message: string; placeholder: string | null; token: string }
  | { phase: "select"; message: string; options: AuthChoice[]; token: string }
  | { phase: "progress"; message: string }
  | { phase: "success" }
  | { phase: "error"; message: string };

function OAuthDetail(props: {
  providerId: () => string;
  provider: () => OAuthProviderInfo | undefined;
  onRefresh: () => void;
  autoStart: () => boolean;
  onAutoStarted: () => void;
  actions: EnabledActions;
}) {
  const fallback = (): OAuthProviderInfo => ({
    id: props.providerId(),
    name: props.providerId(),
    usesCallbackServer: false,
    loggedIn: false,
    supportsApiKey: false,
  });
  const provider = (): OAuthProviderInfo => props.provider() ?? fallback();
  const login = signal<LoginState | null>(null);
  const code = signal("");
  const verifying = signal(false);
  const loginError = signal<string | null>(null);
  const busy = signal(false);
  const field = inputLook({ style: { flex: 1, minWidth: 0, fontFamily: sans } });

  let stopLogin: (() => void) | null = null;
  const stopActiveLogin = (): void => {
    stopLogin?.();
    stopLogin = null;
  };
  cleanup(stopActiveLogin);

  const working = (): boolean => {
    const state = login();
    return state !== null && state.phase !== "success" && state.phase !== "error";
  };

  const openLink = async (url: string): Promise<void> => {
    loginError.set(null);
    try {
      const result = await openUrl(url);
      if (!result.opened) loginError.set(t("settings.providers.openLinkFailed"));
    } catch (cause) {
      const denied = cause instanceof Error && cause.message.includes("ERR_ACCESS_DENIED");
      loginError.set(
        denied
          ? t("settings.providers.openLinkDenied")
          : t("settings.providers.openLinkError", { error: errorText(cause) }),
      );
    }
  };

  const handleEvent = (event: AuthLoginEvent): void => {
    loginError.set(null);
    switch (event.type) {
      case "auth":
        login.set({
          phase: "auth",
          url: event.url,
          instructions: event.instructions,
          token: event.token,
        });
        break;
      case "device_code":
        login.set({
          phase: "device_code",
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          intervalSeconds: event.intervalSeconds,
          expiresInSeconds: event.expiresInSeconds,
        });
        break;
      case "prompt_request":
        login.set({
          phase: "prompt",
          message: event.message,
          placeholder: event.placeholder,
          token: event.token,
        });
        break;
      case "select_request":
        login.set({
          phase: "select",
          message: event.message,
          options: event.options,
          token: event.token,
        });
        break;
      case "progress":
        login.set({ phase: "progress", message: event.message });
        break;
      case "success":
        stopActiveLogin();
        verifying.set(false);
        code.set("");
        login.set({ phase: "success" });
        props.onRefresh();
        break;
      case "error":
        stopActiveLogin();
        verifying.set(false);
        login.set({ phase: "error", message: authMessageText(event.message) });
        break;
      case "cancelled":
        stopActiveLogin();
        verifying.set(false);
        login.set(null);
        break;
    }
  };

  const beginLogin = (): void => {
    stopActiveLogin();
    loginError.set(null);
    code.set("");
    verifying.set(false);
    login.set({ phase: "connecting" });
    stopLogin = startOAuthLogin(
      provider().id,
      handleEvent,
      {
        onError: (cause) => {
          const current = login();
          if (current === null || current.phase === "success" || current.phase === "error") return;
          verifying.set(false);
          login.set({ phase: "error", message: authErrorText(cause) });
        },
      },
    );
  };

  const cancelLogin = (): void => {
    stopActiveLogin();
    login.set(null);
    loginError.set(null);
    code.set("");
    verifying.set(false);
  };

  const submitValue = async (token: string, value: string, waiting: string): Promise<void> => {
    if (value.trim() === "") return;
    verifying.set(true);
    loginError.set(null);
    try {
      await submitOAuthCode(provider().id, token, value.trim());
      code.set("");
      const after = login();
      if (after !== null && (after.phase === "auth" || after.phase === "prompt" || after.phase === "select")) {
        login.set({ phase: "progress", message: waiting });
      }
    } catch (cause) {
      loginError.set(authErrorText(cause));
    } finally {
      verifying.set(false);
    }
  };

  const signOut = async (): Promise<void> => {
    busy.set(true);
    loginError.set(null);
    try {
      await logoutOAuth(provider().id);
      props.onRefresh();
    } catch (cause) {
      loginError.set(authErrorText(cause));
      props.onRefresh();
    } finally {
      busy.set(false);
    }
  };

  // The picker starts the sign-in; choosing the row in the tree only opens it.
  let autoStarted = false;
  effect(() => {
    if (autoStarted || !props.autoStart() || working()) return;
    autoStarted = true;
    props.onAutoStarted();
    beginLogin();
  });

  const authStep = (): Extract<LoginState, { phase: "auth" }> | null => {
    const state = login();
    return state?.phase === "auth" ? state : null;
  };
  const deviceStep = (): Extract<LoginState, { phase: "device_code" }> | null => {
    const state = login();
    return state?.phase === "device_code" ? state : null;
  };
  const promptStep = (): Extract<LoginState, { phase: "prompt" }> | null => {
    const state = login();
    return state?.phase === "prompt" ? state : null;
  };
  const selectStep = (): Extract<LoginState, { phase: "select" }> | null => {
    const state = login();
    return state?.phase === "select" ? state : null;
  };
  const progressStep = (): Extract<LoginState, { phase: "progress" }> | null => {
    const state = login();
    return state?.phase === "progress" ? state : null;
  };
  const successState = (): Extract<LoginState, { phase: "success" }> | null => {
    const state = login();
    return state?.phase === "success" ? state : null;
  };
  const errorState = (): Extract<LoginState, { phase: "error" }> | null => {
    const state = login();
    return state?.phase === "error" ? state : null;
  };

  return (
    <View style={{ gap: 16 }}>
      <ConfigDetailTitle
        title={provider().name}
        subtitle={t("settings.providers.subscriptionsSubtitle")}
      />

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 120 }}>
          <ConfigSectionTitle text={t("i18n.subscription")} />
        </View>
        <Status
          label={t(provider().loggedIn ? "settings.providers.signedIn" : "settings.providers.notConnected")}
          tone={provider().loggedIn ? "up" : undefined}
        />
        <If when={working()}>
          <Button label={t("i18n.cancel")} variant="secondary" size="small" onPress={cancelLogin} />
        </If>
        <If when={!working()}>
          <Button
            label={t(provider().loggedIn ? "settings.providers.signInAgain" : "settings.providers.signIn")}
            variant={provider().loggedIn ? "secondary" : "primary"}
            size="small"
            disabled={busy()}
            onPress={beginLogin}
          />
          <If when={provider().loggedIn}>
            <Button
              label={t("settings.providers.signOut")}
              variant="danger"
              size="small"
              busy={busy()}
              disabled={busy()}
              onPress={() => void signOut()}
            />
          </If>
        </If>
      </View>

      <If when={login() === null && !provider().loggedIn}>
        <ConfigText text={t("models.oauthConnect", { provider: provider().name })} />
      </If>
      <If when={login()?.phase === "connecting"}>
        <SettingsLoading label={t("settings.providers.openingSignIn")} />
      </If>
      <If when={progressStep()}>
        {(step) => <SettingsLoading label={step().message} />}
      </If>

      <If when={authStep()}>
        {(step) => (
          <View style={{ gap: 8 }}>
            <ConfigText text={t("settings.providers.finishSignIn")} />
            <If when={step().instructions}>
              <ConfigText text={step().instructions ?? ""} />
            </If>
            <Text style={{ ...settingsCode(), lineHeight: 17 }}>{step().url}</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Button
                label={t("settings.providers.openSignInPage")}
                variant="secondary"
                size="small"
                onPress={() => void openLink(step().url)}
              />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Input
                class={field.class}
                style={field.style}
                value={code()}
                onChange={({ value }) => code.set(value)}
                onSubmit={() => void submitValue(step().token, code(), t("settings.providers.waitingForProvider"))}
                placeholder="http://localhost:1455/auth/callback?code=…"
                accessibilityLabel={t("settings.providers.callbackLabel")}
                autoComplete="off"
              />
              <Button
                label={t("i18n.submit")}
                size="small"
                busy={verifying()}
                disabled={verifying() || code().trim() === ""}
                onPress={() => void submitValue(step().token, code(), t("settings.providers.waitingForProvider"))}
              />
            </View>
          </View>
        )}
      </If>

      <If when={promptStep()}>
        {(step) => (
          <View style={{ gap: 8 }}>
            <ConfigText text={step().message} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Input
                class={field.class}
                style={field.style}
                value={code()}
                onChange={({ value }) => code.set(value)}
                onSubmit={() => void submitValue(step().token, code(), t("settings.providers.waitingForProvider"))}
                placeholder={step().placeholder ?? t("settings.providers.pasteValue")}
                accessibilityLabel={t("settings.providers.valueLabel")}
                autoComplete="off"
              />
              <Button
                label={t("i18n.submit")}
                size="small"
                busy={verifying()}
                disabled={verifying() || code().trim() === ""}
                onPress={() => void submitValue(step().token, code(), t("settings.providers.waitingForProvider"))}
              />
            </View>
          </View>
        )}
      </If>

      <If when={selectStep()}>
        {(step) => (
          <View style={{ gap: 8 }}>
            <ConfigText text={step().message} />
            <Each of={step().options} key={(option) => option.id}>
              {(option) => (
                <Button
                  label={option().label}
                  variant="secondary"
                  size="small"
                  disabled={verifying()}
                  onPress={() => void submitValue(step().token, option().id, t("settings.providers.waitingForProvider"))}
                />
              )}
            </Each>
          </View>
        )}
      </If>

      <If when={deviceStep()}>
        {(step) => (
          <View style={{ gap: 8 }}>
            <ConfigText text={t("settings.providers.deviceCodeNote")} />
            <Text style={{ ...settingsCode(), fontSize: 18, fontWeight: "600" }}>{step().userCode}</Text>
            <Text style={{ ...settingsCode(), lineHeight: 17 }}>{step().verificationUri}</Text>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Button
                label={t("settings.providers.openVerificationPage")}
                variant="secondary"
                size="small"
                onPress={() => void openLink(step().verificationUri)}
              />
            </View>
            <If when={step().expiresInSeconds}>
              {(seconds) => (
                <ConfigText text={t("settings.providers.codeExpires", { minutes: Math.ceil(seconds() / 60) })} />
              )}
            </If>
          </View>
        )}
      </If>

      <If when={successState()}>
        <Status label={t("settings.providers.signedInTo", { provider: provider().name })} tone="up" />
      </If>
      <If when={errorState()}>
        {(state) => <SettingsError>{state().message}</SettingsError>}
      </If>
      <If when={loginError()}>
        <SettingsError>{loginError() ?? ""}</SettingsError>
      </If>

      <ProviderUsageSummary providerId={provider().id} enabled={() => provider().loggedIn} />
      <If when={provider().loggedIn}>
        <EnabledModelsSection providerId={provider().id} actions={props.actions} />
      </If>
    </View>
  );
}

// ── API-key detail ──────────────────────────────────────────────────────────

function ApiKeyDetail(props: {
  providerId: () => string;
  provider: () => ApiKeyProviderInfo | undefined;
  onRefresh: () => void;
  actions: EnabledActions;
}) {
  const fallback = (): ApiKeyProviderInfo => ({
    id: props.providerId(),
    displayName: props.providerId(),
    configured: false,
    modelCount: 0,
    supportsOAuth: false,
  });
  const provider = (): ApiKeyProviderInfo => props.provider() ?? fallback();
  const draft = signal("");
  const saving = signal(false);
  const removing = signal(false);
  const error = signal<string | null>(null);
  const savedOk = signal(false);
  const field = inputLook({ style: { flex: 1, minWidth: 0, fontFamily: sans } });

  const save = async (): Promise<void> => {
    const apiKey = draft().trim();
    if (apiKey === "") return;
    saving.set(true);
    error.set(null);
    savedOk.set(false);
    try {
      await saveApiKey(provider().id, apiKey);
      draft.set("");
      savedOk.set(true);
      props.onRefresh();
    } catch (cause) {
      error.set(authErrorText(cause));
    } finally {
      saving.set(false);
    }
  };

  const remove = async (): Promise<void> => {
    removing.set(true);
    error.set(null);
    try {
      await deleteApiKey(provider().id);
      props.onRefresh();
    } catch (cause) {
      error.set(authErrorText(cause));
      props.onRefresh();
    } finally {
      removing.set(false);
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <ConfigDetailTitle
        title={provider().displayName}
        subtitle={modelCountText(provider().modelCount)}
      />

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ConfigSectionTitle text={t("settings.providers.apiKey")} />
        </View>
        <Status
          label={t(provider().configured ? "settings.providers.configured" : "settings.providers.notConfigured")}
          tone={provider().configured ? "up" : undefined}
        />
        <If when={provider().configured}>
          <Button
            label={t("i18n.disconnect")}
            variant="danger"
            size="small"
            busy={removing()}
            disabled={removing() || saving()}
            onPress={() => void remove()}
          />
        </If>
      </View>

      <If when={!provider().configured}>
        <ConfigText
          text={t(provider().modelCount === 1 ? "models.apiKeyEnableOne" : "models.apiKeyEnable", {
            provider: provider().displayName,
            count: provider().modelCount,
          })}
        />
      </If>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Input
          class={field.class}
          style={field.style}
          value={draft()}
          onChange={({ value }) => {
            draft.set(value);
            savedOk.set(false);
          }}
          onSubmit={() => void save()}
          masked
          placeholder={provider().configured ? t("models.replaceApiKey") : "sk-…"}
          accessibilityLabel={t("settings.providers.apiKeyField", { provider: provider().displayName })}
          autoComplete="off"
        />
        <Button
          label={savedOk() ? t("i18n.saved") : saving() ? t("i18n.saving") : t("i18n.save")}
          variant={savedOk() ? "primary" : "secondary"}
          size="small"
          busy={saving()}
          disabled={saving() || removing() || draft().trim() === ""}
          onPress={() => void save()}
        />
      </View>

      <If when={error()}>
        <SettingsError>{error() ?? ""}</SettingsError>
      </If>

      <ProviderUsageSummary providerId={provider().id} enabled={() => provider().configured} />
      <If when={provider().configured}>
        <EnabledModelsSection providerId={provider().id} actions={props.actions} />
      </If>
    </View>
  );
}

// ── Custom provider detail: models.json fields, headers and Discover ────────

function CustomProviderDetail(props: {
  name: string;
  provider: () => ModelsJsonProvider;
  nameDraft: () => string;
  onNameDraft: (value: string) => void;
  onRename: () => void;
  onDelete: () => void;
  onChange: (change: (provider: ModelsJsonProvider) => ModelsJsonProvider) => void;
  onChangeFields: (change: (provider: ModelsJsonProvider) => void) => void;
  onAddModels: (models: ModelsJsonModel[]) => void;
  onAddModel: () => void;
  actions: EnabledActions;
}) {
  const field = inputLook({ style: { width: "100%", fontFamily: sans } });
  const inlineField = inputLook({ style: { flex: 1, minWidth: 0, fontFamily: sans } });
  const discovery = signal<DiscoveryState>({ phase: "idle" });
  const discoveryFilter = signal("");
  const discoverySelected = signal<string[]>([]);
  const confirming = signal(false);
  let discoveryRun = 0;

  const entry = (): ModelsJsonProvider => props.provider();
  const models = (): ModelsJsonModel[] => entry().models ?? [];
  const kind = (): "oauth" | "apikey" => providerKind(entry());
  const typeTitle = (): string => t(kind() === "oauth" ? "models.typeOAuthRadius" : "models.typeApiKey");
  const apiValue = (): string => entry().api ?? API_DEFAULT;
  const apiTitle = (): string => entry().api ?? t("models.piDefault");

  const patch = (change: (next: ModelsJsonProvider) => void): void => {
    props.onChange((provider) => {
      const next = { ...provider };
      change(next);
      return next;
    });
  };

  const resetDiscovery = (): void => {
    discoveryRun += 1;
    discovery.set({ phase: "idle" });
    discoverySelected.set([]);
  };

  const setBaseUrl = (value: string): void => {
    resetDiscovery();
    patch((next) => {
      if (value) next.baseUrl = value;
      else delete next.baseUrl;
    });
  };

  const setApi = (value: string | null): void => {
    resetDiscovery();
    patch((next) => {
      if (value) next.api = value;
      else delete next.api;
    });
  };

  const setType = (value: string | null): void => {
    resetDiscovery();
    patch((next) => {
      if (value === "oauth") next.oauth = "radius";
      else delete next.oauth;
    });
  };

  const setApiKey = (value: string): void => {
    resetDiscovery();
    patch((next) => {
      if (value) next.apiKey = value;
      else delete next.apiKey;
    });
  };

  const discovered = (): DiscoveredModel[] => {
    const current = discovery();
    return current.phase === "success" ? current.models : [];
  };
  const discoveryError = (): string => {
    const current = discovery();
    return current.phase === "error" ? current.message : "";
  };
  const endpoint = (): string => {
    const current = discovery();
    return current.phase === "success" ? current.endpoint : "";
  };
  const existingIds = (): Set<string> => new Set(models().map((model) => model.id));
  const filtered = (): DiscoveredModel[] => {
    const needle = discoveryFilter().trim().toLocaleLowerCase();
    if (!needle) return discovered();
    return discovered().filter((model) => (
      model.id.toLocaleLowerCase().includes(needle)
      || (model.name ?? "").toLocaleLowerCase().includes(needle)
    ));
  };
  const shown = (): DiscoveredModel[] => filtered().slice(0, 200);
  const selectableShown = (): string[] =>
    shown().filter((model) => !existingIds().has(model.id)).map((model) => model.id);
  const selectedCount = (): number =>
    discoverySelected().filter((id) => !existingIds().has(id)).length;
  const allShownSelected = (): boolean => {
    const ids = selectableShown();
    return ids.length > 0 && ids.every((id) => discoverySelected().includes(id));
  };
  const someShownSelected = (): boolean => {
    const ids = selectableShown();
    return !allShownSelected() && ids.some((id) => discoverySelected().includes(id));
  };

  const runDiscover = async (): Promise<void> => {
    const run = ++discoveryRun;
    discovery.set({ phase: "loading" });
    discoverySelected.set([]);
    discoveryFilter.set("");
    try {
      const response = await discoverProviderModels(props.name, entry());
      if (run !== discoveryRun) return;
      discovery.set({ phase: "success", models: response.models, endpoint: response.endpoint });
    } catch (cause) {
      if (run !== discoveryRun) return;
      discovery.set({ phase: "error", message: errorText(cause) });
    }
  };

  const toggleDiscovered = (id: string): void => {
    discoverySelected.update((current) => current.includes(id)
      ? current.filter((entryId) => entryId !== id)
      : [...current, id]);
  };

  const toggleShown = (checked: boolean): void => {
    const ids = selectableShown();
    discoverySelected.update((current) => {
      if (!checked) return current.filter((id) => !ids.includes(id));
      return Array.from(new Set([...current, ...ids]));
    });
  };

  const addSelected = (): void => {
    const selected = new Set(discoverySelected());
    const additions = discovered()
      .filter((model) => selected.has(model.id) && !existingIds().has(model.id))
      .map(modelFromDiscovered);
    if (additions.length === 0) return;
    props.onAddModels(additions);
    discoverySelected.set([]);
  };

  return (
    <View style={{ gap: 16 }}>
      <ConfigDetailTitle
        title={providerTitle(props.name, entry())}
        subtitle={providerDetail(props.name, entry())}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <ProviderEnabledSwitch providerId={props.name} actions={props.actions} />
          <If
            when={confirming()}
            else={
              <Button
                label={t("i18n.delete")}
                variant="danger"
                size="small"
                onPress={() => confirming.set(true)}
              />
            }
          >
            <Button label={t("i18n.cancel")} variant="secondary" size="small" onPress={() => confirming.set(false)} />
            <Button
              label={t("models.confirmRemove")}
              variant="danger"
              size="small"
              onPress={props.onDelete}
            />
          </If>
        </View>
      </ConfigDetailTitle>

      <If when={confirming()}>
        <ConfigText
          tone="warn"
          text={t("models.removeProviderConfirm", {
            provider: props.name,
            count: models().length,
          })}
        />
      </If>

      <ConfigSectionTitle text={t("i18n.provider")} />

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Field label={t("models.providerId")} hint={t("models.providerIdHint")}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Input
              class={inlineField.class}
              style={inlineField.style}
              value={props.nameDraft()}
              onChange={({ value }) => props.onNameDraft(value)}
              onSubmit={props.onRename}
              placeholder="provider-id"
              accessibilityLabel={t("models.providerId")}
              autoComplete="off"
            />
            <If when={props.nameDraft().trim() !== props.name}>
              <Button
                label={t("i18n.rename")}
                variant="secondary"
                size="small"
                disabled={!props.nameDraft().trim()}
                onPress={props.onRename}
              />
            </If>
          </View>
        </Field>
        <Field label={t("models.providerType")} hint={t("models.providerTypeHint")}>
          <SettingsSelect
            items={providerTypeItems()}
            value={kind()}
            onChange={setType}
            label={t("models.providerType")}
            title={typeTitle()}
            minWidth={200}
          />
        </Field>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Field label={t("models.baseUrl")} hint={t("models.baseUrlHint")} wide>
          <Input
            class={field.class}
            style={field.style}
            value={entry().baseUrl ?? ""}
            onChange={({ value }) => setBaseUrl(value)}
            placeholder="https://api.example.com/v1"
            accessibilityLabel={t("models.baseUrl")}
            autoComplete="off"
          />
        </Field>
        <Field label={t("models.apiProtocol")} hint={t("models.apiProtocolHint")}>
          <SettingsSelect
            items={[
              { value: API_DEFAULT, title: t("models.piDefault") },
              ...API_OPTIONS.map((value) => ({ value, title: value })),
            ]}
            value={apiValue()}
            onChange={(value) => setApi(value === null || value === API_DEFAULT ? null : value)}
            label={t("models.apiProtocol")}
            title={apiTitle()}
            minWidth={220}
          />
        </Field>
      </View>

      <Field label={t("models.apiKey")} hint={t("models.apiKeyHint")}>
        <Input
          class={field.class}
          style={field.style}
          value={entry().apiKey ?? ""}
          onChange={({ value }) => setApiKey(value)}
          placeholder="sk-… or $MY_PROVIDER_KEY"
          masked
          autoComplete="off"
          accessibilityLabel={t("models.apiKey")}
        />
      </Field>

      <Field label={t("models.headers")} hint={t("models.headersHelp")}>
        <HeadersEditor
          headers={entry().headers}
          onChange={(headers) => props.onChangeFields((next) => {
            if (headers) next.headers = headers;
            else delete next.headers;
          })}
        />
      </Field>

      <View style={{ gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <View style={{ flex: 1, minWidth: 120 }}>
            <ConfigSectionTitle text={t("models.discoverModels")} />
          </View>
          <Button
            label={discovery().phase === "loading" ? t("models.discovering") : t("models.discoveryFetch")}
            variant="secondary"
            size="small"
            busy={discovery().phase === "loading"}
            disabled={discovery().phase === "loading"}
            onPress={() => void runDiscover()}
          />
        </View>
        <ConfigText text={t("models.discoverNote")} />

        <If when={discovery().phase === "error"}>
          <SettingsError>{discoveryError()}</SettingsError>
        </If>
        <If when={discovery().phase === "success"}>
          <Text style={{ ...settingsCode(), fontSize: SETTINGS_DETAIL, color: colors.faint, numberOfLines: 1 }}>
            {endpoint()}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Input
              class={inlineField.class}
              style={inlineField.style}
              value={discoveryFilter()}
              onChange={({ value }) => discoveryFilter.set(value)}
              placeholder={t("models.discoveryFilterPlaceholder", { count: discovered().length })}
              accessibilityLabel={t("models.discoveryFilter")}
              autoComplete="off"
            />
            <Button
              label={selectedCount() > 0
                ? t("models.discoveryAddSelectedCount", { count: selectedCount() })
                : t("models.discoveryAddSelected")}
              variant="primary"
              size="small"
              disabled={selectedCount() === 0}
              onPress={addSelected}
            />
          </View>
          <SelectCheckbox
            checked={allShownSelected}
            indeterminate={someShownSelected}
            disabled={selectableShown().length === 0}
            label={t("models.selectAllShownLabel")}
            onChange={toggleShown}
          >
            <Text style={{ fontSize: SETTINGS_DETAIL, color: colors.muted }}>
              {t("models.selectAllShown", { count: selectableShown().length })}
            </Text>
          </SelectCheckbox>
          <If when={shown().length === 0}>
            <ConfigText text={t("models.discoveryNoMatches")} />
          </If>
          <Each of={shown()} key={(model) => model.id}>
            {(model) => {
              const added = () => existingIds().has(model().id);
              const checked = () => added() || discoverySelected().includes(model().id);
              return (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    paddingVertical: 5,
                    borderTopWidth: 1,
                    borderTopColor: colors.line,
                  }}
                >
                  <SelectCheckbox
                    checked={checked}
                    disabled={added()}
                    label={t("models.selectModel", { model: model().id })}
                    onChange={() => toggleDiscovered(model().id)}
                  >
                    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                      <Text style={{ fontSize: SETTINGS_DETAIL, color: colors.text, numberOfLines: 1 }}>
                        {model().name ?? model().id}
                      </Text>
                      <Text style={{ ...settingsCode(), fontSize: 10, color: colors.muted, numberOfLines: 1 }}>
                        {[
                          model().id,
                          model().contextWindow !== undefined
                            ? t("models.modelContextShort", { tokens: model().contextWindow! })
                            : null,
                          model().maxTokens !== undefined
                            ? t("models.modelMaxTokensShort", { tokens: model().maxTokens! })
                            : null,
                        ].filter((part): part is string => part !== null).join(" · ")}
                      </Text>
                    </View>
                  </SelectCheckbox>
                  <If when={added()}>
                    <Badge label={t("models.added")} />
                  </If>
                </View>
              );
            }}
          </Each>
          <If when={filtered().length > shown().length}>
            <ConfigText text={t("models.filterShowing", { shown: shown().length, total: filtered().length })} />
          </If>
        </If>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <ConfigSectionTitle
            text={t("models.modelsHeading", { count: models().length })}
          />
        </View>
        <Button
          label={`+ ${t("i18n.model")}`}
          variant="secondary"
          size="small"
          onPress={props.onAddModel}
        />
      </View>
      <If when={models().length === 0}>
        <ConfigText text={t("models.noModelNote")} />
      </If>
    </View>
  );
}

// ── Model detail: fields, prices, thinking map and compatibility ────────────

function ModelDetail(props: {
  providerName: string;
  provider: () => ModelsJsonProvider;
  model: () => ModelsJsonModel;
  onChange: (model: ModelsJsonModel) => void;
  onDelete: () => void;
  actions: EnabledActions;
}) {
  const initial = props.model();
  const draft = signal<ModelDraft>(modelDraft(initial));
  const test = signal<TestState>({ phase: "idle" });
  const confirming = signal(false);
  const field = inputLook({ style: { width: "100%", fontFamily: sans } });
  let testRun = 0;

  const resetTest = (): void => {
    testRun += 1;
    test.set({ phase: "idle" });
  };

  const applyDraft = (next: ModelDraft): void => {
    draft.set(next);
    resetTest();
    props.onChange(modelFromDraft(props.model(), next));
  };

  const setText = (key: "id" | "name" | "contextWindow" | "maxTokens", value: string): void => {
    applyDraft({ ...draft(), [key]: value });
  };

  const setCost = (key: CostKey, value: string): void => {
    applyDraft({ ...draft(), cost: { ...draft().cost, [key]: value } });
  };

  const setReasoning = (value: boolean): void => {
    resetTest();
    const next = { ...props.model() };
    if (value) next.reasoning = true;
    else {
      delete next.reasoning;
      delete next.thinkingLevelMap;
    }
    props.onChange(next);
  };

  const setImageInput = (value: boolean): void => {
    resetTest();
    const next = { ...props.model() };
    if (value) next.input = ["text", "image"];
    else delete next.input;
    props.onChange(next);
  };

  const invalidNumbers = (): boolean => {
    const current = draft();
    const texts = [current.contextWindow, current.maxTokens, ...COST_KEYS.map((key) => current.cost[key])];
    return texts.some((text) => {
      if (!text.trim()) return false;
      return !Number.isFinite(Number(text));
    });
  };

  const invalidPositive = (): boolean => {
    const current = draft();
    return [current.contextWindow, current.maxTokens].some((text) => {
      if (!text.trim()) return false;
      const value = Number(text);
      return !Number.isFinite(value) || value <= 0;
    });
  };

  const runTest = async (): Promise<void> => {
    const model = props.model();
    if (!model.id.trim()) {
      test.set({ phase: "error", message: t("models.modelIdBeforeTest") });
      return;
    }
    const run = ++testRun;
    test.set({ phase: "testing" });
    try {
      const result = await testProviderModel(props.providerName, props.provider(), model);
      if (run !== testRun) return;
      if (!result.ok) {
        test.set({
          phase: "error",
          message: result.error ?? t("models.modelError"),
          latencyMs: result.latencyMs,
          status: result.status,
        });
      } else {
        test.set({
          phase: "success",
          latencyMs: result.latencyMs,
          status: result.status,
          responseText: result.responseText,
        });
      }
    } catch (cause) {
      if (run !== testRun) return;
      test.set({ phase: "error", message: errorText(cause) });
    }
  };

  return (
    <View style={{ gap: 16 }}>
      <ConfigDetailTitle
        title={modelLabel(props.model())}
        subtitle={`${props.providerName} · ${props.model().id || t("models.modelNoId")}`}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <ModelEnabledSwitch
            providerName={props.providerName}
            modelId={props.model().id}
            actions={props.actions}
          />
          <Button
            label={test().phase === "testing" ? t("models.testing") : t("i18n.test")}
            variant={test().phase === "success" ? "primary" : "secondary"}
            size="small"
            busy={test().phase === "testing"}
            disabled={test().phase === "testing" || !props.model().id.trim()}
            onPress={() => void runTest()}
          />
          <If
            when={confirming()}
            else={
              <Button
                label={t("i18n.remove")}
                variant="danger"
                size="small"
                onPress={() => confirming.set(true)}
              />
            }
          >
            <Button label={t("i18n.cancel")} variant="secondary" size="small" onPress={() => confirming.set(false)} />
            <Button label={t("models.confirmRemove")} variant="danger" size="small" onPress={props.onDelete} />
          </If>
        </View>
      </ConfigDetailTitle>

      <If when={confirming()}>
        <ConfigText tone="warn" text={t("models.confirmRemoveModel")} />
      </If>

      <ConfigSectionTitle text={t("i18n.model")} />

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Field label={t("models.modelId")} hint={t("models.modelIdHint")}>
          <Input
            class={field.class}
            style={field.style}
            value={draft().id}
            onChange={({ value }) => setText("id", value)}
            placeholder="model-id"
            accessibilityLabel={t("models.modelId")}
            autoComplete="off"
          />
        </Field>
        <Field label={t("models.displayName")} hint={t("models.displayNameHint")}>
          <Input
            class={field.class}
            style={field.style}
            value={draft().name}
            onChange={({ value }) => setText("name", value)}
            placeholder={t("models.displayNamePlaceholder")}
            accessibilityLabel={t("models.displayName")}
            autoComplete="off"
          />
        </Field>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <Field label={t("models.contextWindow")} hint={t("models.contextWindowHint")}>
          <Input
            class={field.class}
            style={field.style}
            value={draft().contextWindow}
            onChange={({ value }) => setText("contextWindow", value)}
            placeholder="128000"
            keyboardType="number-pad"
            accessibilityLabel={t("models.contextWindow")}
          />
        </Field>
        <Field label={t("models.maxOutputTokens")} hint={t("models.maxOutputTokensHint")}>
          <Input
            class={field.class}
            style={field.style}
            value={draft().maxTokens}
            onChange={({ value }) => setText("maxTokens", value)}
            placeholder="16384"
            keyboardType="number-pad"
            accessibilityLabel={t("models.maxOutputTokens")}
          />
        </Field>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        <SwitchField
          label={t("models.reasoning")}
          detail={t("models.reasoningHint")}
          value={props.model().reasoning === true}
          onChange={setReasoning}
        />
        <SwitchField
          label={t("models.imageInput")}
          detail={t("models.imageInputHint")}
          value={props.model().input?.includes("image") === true}
          onChange={setImageInput}
        />
      </View>

      <View style={{ gap: 6 }}>
        <ConfigSectionTitle text={t("models.priceUsdHeading")} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <Each of={COST_FIELDS} key={(item) => item.key}>
            {(item) => (
              <Field label={t(item().labelKey)} hint={t("models.priceBlankHint")}>
                <Input
                  class={field.class}
                  style={field.style}
                  value={draft().cost[item().key]}
                  onChange={({ value }) => setCost(item().key, value)}
                  placeholder="0"
                  keyboardType="decimal-pad"
                  accessibilityLabel={t("models.priceLabel", { label: t(item().labelKey) })}
                />
              </Field>
            )}
          </Each>
        </View>
      </View>

      <If when={invalidNumbers() || invalidPositive()}>
        <ConfigText tone="warn" text={t("models.draftNumbersNote")} />
      </If>

      <View style={{ gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line }}>
        <ConfigSectionTitle
          text={t("models.thinkingLevelMap")}
          aside={t("models.thinkingSummary", {
            count: Object.keys(props.model().thinkingLevelMap ?? {}).length,
          })}
        />
        <Text style={{ fontSize: SETTINGS_DETAIL, color: colors.faint }}>
          {t("models.reasoningHint")}
        </Text>
        <ThinkingLevelMapEditor
          value={() => props.model().thinkingLevelMap}
          onChange={(value) => {
            resetTest();
            const next = { ...props.model() };
            if (value) next.thinkingLevelMap = value;
            else delete next.thinkingLevelMap;
            props.onChange(next);
          }}
        />
      </View>

      <View style={{ gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line }}>
        <ConfigSectionTitle text={t("models.compatibility")} />
        <SwitchField
          label={t("models.deepSeekThinkingCompat")}
          value={hasDeepseekCompat(props.model())}
          onChange={(on) => {
            resetTest();
            props.onChange(setDeepseekCompat(props.model(), on));
          }}
        />
        <SwitchField
          label={t("models.developerRole")}
          value={effectiveCompat(props.provider(), props.model())["supportsDeveloperRole"] !== false}
          onChange={(on) => {
            resetTest();
            props.onChange(setCompatValue(props.model(), "supportsDeveloperRole", on));
          }}
        />
        <If when={(props.model().api ?? props.provider().api) === "anthropic-messages"}>
          <SwitchField
            label={t("models.adaptiveThinking")}
            value={effectiveCompat(props.provider(), props.model())["forceAdaptiveThinking"] === true}
            onChange={(on) => {
              resetTest();
              props.onChange(setCompatValue(props.model(), "forceAdaptiveThinking", on ? true : undefined));
            }}
          />
        </If>
      </View>

      <If when={test().phase === "testing"}>
        <SettingsLoading label={t("models.testingModel")} />
      </If>
      <If when={test().phase === "success"}>
        <Status tone="up" label={testText(test())} />
      </If>
      <If when={test().phase === "error"}>
        <SettingsError>{testText(test())}</SettingsError>
      </If>
    </View>
  );
}

// ── Add Provider picker ─────────────────────────────────────────────────────

function AddProviderPicker(props: {
  open: () => boolean;
  oauthProviders: () => OAuthProviderInfo[];
  apiKeyProviders: () => ApiKeyProviderInfo[];
  customEnabled: () => boolean;
  onSelectOAuth: (id: string) => void;
  onSelectApiKey: (id: string) => void;
  onAddCustom: () => void;
  onClose: () => void;
}) {
  const search = signal("");
  const field = inputLook({ style: { flex: 1, minWidth: 0, fontFamily: sans } });

  // Every opening starts from the whole list.
  effect(() => {
    if (props.open()) search.set("");
  });

  const query = (): string => search().trim().toLowerCase();
  const availableOAuth = (): OAuthProviderInfo[] => props.oauthProviders()
    .filter((provider) => !provider.loggedIn && providerMatches(query(), provider.id, provider.name));
  const availableApiKey = (): ApiKeyProviderInfo[] => props.apiKeyProviders()
    .filter((provider) => !provider.configured && providerMatches(query(), provider.id, provider.displayName));
  const showCustom = (): boolean => {
    const needle = query();
    return needle === ""
      || "custom".includes(needle)
      || "openai".includes(needle)
      || "anthropic".includes(needle)
      || t("i18n.custom").toLowerCase().includes(needle)
      || t("models.compatibleEndpoint").toLowerCase().includes(needle);
  };
  const totalCount = (): number =>
    availableOAuth().length + availableApiKey().length + (showCustom() ? 1 : 0);

  const heading = (text: string): JSX.Element => (
    <Text style={{ fontSize: 10.5, fontWeight: "600", letterSpacing: 1.1, color: colors.faint }}>
      {text}
    </Text>
  );

  const card = (id: string, title: string, detail: string, onPress: () => void, disabled = false): JSX.Element => (
    <View
      onPress={disabled ? undefined : onPress}
      role="button"
      accessibilityLabel={`${title} · ${detail}`}
      accessibilityState={{ disabled }}
      style={{
        width: 160,
        height: 70,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingHorizontal: 11,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: alpha(colors.text, 0.12),
        backgroundColor: colors.raised,
        opacity: disabled ? 0.5 : 1,
      }}
      hoverStyle={disabled ? undefined : { borderColor: colors.accent, backgroundColor: alpha(colors.text, 0.04) }}
    >
      <ProviderMark id={id} size={26} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: colors.text, numberOfLines: 1 }}>
          {title}
        </Text>
        <Text style={{ fontSize: 10.5, color: colors.faint, numberOfLines: 1 }}>{detail}</Text>
      </View>
    </View>
  );

  return (
    <Dialog
      open={props.open()}
      animation="fade"
      accessibilityLabel={t("i18n.addProvider")}
      closeOnEscape={true}
      closeOnBackdropPress={true}
      onOpenChange={(event) => {
        if (!event.open) props.onClose();
      }}
      backdropStyle={backdrop()}
      style={{ ...dialogCard(620), maxHeight: Math.min(660, windowSize().height - 48) }}
    >
      <Text style={dialogTitle()}>{t("i18n.addProvider")}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Input
          class={field.class}
          style={field.style}
          value={search()}
          onChange={({ value }) => search.set(value)}
          placeholder={t("i18n.searchProviders")}
          accessibilityLabel={t("i18n.searchProviders")}
          autoComplete="off"
        />
      </View>

      <Scroll
        style={{ maxHeight: Math.max(240, Math.min(500, windowSize().height - 230)) }}
        contentStyle={{ gap: 10 }}
      >
        <If when={totalCount() === 0}>
          <ConfigEmpty text={t("i18n.noProviders")} />
        </If>

        <If when={showCustom()}>
          {heading(t("i18n.custom"))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <View
              onPress={props.customEnabled() ? props.onAddCustom : undefined}
              role="button"
              accessibilityLabel={t("models.compatibleEndpoint")}
              style={{
                width: 160,
                height: 70,
                flexDirection: "row",
                alignItems: "center",
                gap: 9,
                paddingHorizontal: 11,
                borderRadius: 8,
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: alpha(colors.text, 0.18),
                backgroundColor: colors.raised,
                opacity: props.customEnabled() ? 1 : 0.5,
              }}
              hoverStyle={props.customEnabled() ? { borderColor: colors.accent, backgroundColor: alpha(colors.text, 0.04) } : undefined}
            >
              <View
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 7,
                  borderWidth: 1,
                  borderColor: alpha(colors.text, 0.14),
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Icon name="plus" size={14} tint={colors.muted} />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.text, numberOfLines: 1 }}>
                  {t("models.compatibleEndpoint")}
                </Text>
                <Text style={{ fontSize: 10.5, color: colors.faint, numberOfLines: 1 }}>
                  {t("i18n.customEndpoint")}
                </Text>
              </View>
            </View>
          </View>
        </If>

        <If when={availableOAuth().length > 0}>
          {heading(t("i18n.subscriptions"))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Each of={availableOAuth()} key={(provider) => provider.id}>
              {(provider) => card(
                provider().id,
                provider().name,
                "OAuth",
                () => props.onSelectOAuth(provider().id),
              )}
            </Each>
          </View>
        </If>

        <If when={availableApiKey().length > 0}>
          {heading(t("models.apiKeyGroup"))}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Each of={availableApiKey()} key={(provider) => provider.id}>
              {(provider) => card(
                provider().id,
                provider().displayName,
                modelCountText(provider().modelCount),
                () => props.onSelectApiKey(provider().id),
              )}
            </Each>
          </View>
        </If>
      </Scroll>
    </Dialog>
  );
}

// ── The page's body: tree, detail and Save ──────────────────────────────────

export function ModelsConfig() {
  const source = () => (settingsOpen() ? "models" : null);
  const config = resource(source, async (_source: string, info) =>
    await loadModelsConfig({ signal: info.signal }));
  const auth = resource(source, async (_source: string, info) =>
    await loadAuthProviders({ signal: info.signal }));
  const enabledSource = () => {
    if (!settingsOpen()) return null;
    const folder = activeCwd();
    return folder ?? "";
  };
  const enabled = resource(enabledSource, async (folder: string, info) =>
    loadEnabledModels(folder === "" ? null : folder, { signal: info.signal }));

  const selection = signal<Selection | null>(null);
  const nameDraft = signal<{ provider: string; name: string } | null>(null);
  const pickerOpen = signal(false);
  const saving = signal(false);
  const saved = signal(false);
  const error = signal<string | null>(null);
  const actionError = signal<string | null>(null);
  const enabledPending = signal<string | null>(null);
  const enabledFailure = signal<string | null>(null);
  const enabledNotice = signal<string | null>(null);
  const autoOAuth = signal<string | null>(null);

  const oauthProviders = (): OAuthProviderInfo[] => auth()?.oauthProviders ?? [];
  const apiKeyProviders = (): ApiKeyProviderInfo[] => auth()?.apiKeyProviders ?? [];
  const activeOAuth = (): OAuthProviderInfo[] => oauthProviders().filter((provider) => provider.loggedIn);
  const activeApiKey = (): ApiKeyProviderInfo[] => {
    const oauth = new Set(activeOAuth().map((provider) => provider.id));
    return apiKeyProviders().filter((provider) => provider.configured && !oauth.has(provider.id));
  };

  const providers = (): ProviderPair[] => Object.entries(config()?.providers ?? {})
    .filter((entry): entry is ProviderPair => isProviderEntry(entry[1]));
  const managedIds = (): Set<string> => new Set([
    ...oauthProviders().map((provider) => provider.id),
    ...apiKeyProviders().map((provider) => provider.id),
  ]);
  const customProviders = (): ProviderPair[] => {
    const managed = managedIds();
    return providers().filter(([id, entry]) => (
      auth() === undefined || !isOverridesOnly(entry) || !managed.has(id)
    ));
  };

  const providerOf = (name: string): ModelsJsonProvider | undefined => config()?.providers?.[name];
  const nameDraftFor = (name: string): string => {
    const draft = nameDraft();
    return draft?.provider === name ? draft.name : name;
  };

  const commit = (next: ModelsJsonConfig): void => {
    config.mutate(next);
    saved.set(false);
    error.set(null);
    actionError.set(null);
  };

  const changeProvider = (name: string, change: (provider: ModelsJsonProvider) => ModelsJsonProvider): void => {
    const current = config();
    const entry = current?.providers?.[name];
    if (!current || !entry) return;
    commit({
      ...current,
      providers: { ...(current.providers ?? {}), [name]: change(cloneJson(entry)) },
    });
  };

  const changeProviderFields = (name: string, change: (provider: ModelsJsonProvider) => void): void => {
    changeProvider(name, (entry) => {
      const next = { ...entry };
      change(next);
      return next;
    });
  };

  const renameProvider = (oldName: string, rawName: string): boolean => {
    const nextName = rawName.trim();
    if (!nextName) {
      error.set(t("models.providerNameRequired"));
      return false;
    }
    const current = config();
    const entries = current?.providers ?? {};
    if (!current || !entries[oldName]) return false;
    if (nextName === oldName) {
      nameDraft.set(null);
      return true;
    }
    if (entries[nextName]) {
      error.set(t("models.providerNameTaken", { name: nextName }));
      return false;
    }
    const nextEntries = { ...entries };
    const moved = nextEntries[oldName];
    delete nextEntries[oldName];
    nextEntries[nextName] = moved;
    commit({ ...current, providers: nextEntries });
    const currentSelection = selection();
    if (currentSelection?.type === "provider" && currentSelection.name === oldName) {
      selection.set({ type: "provider", name: nextName });
    } else if (currentSelection?.type === "model" && currentSelection.providerName === oldName) {
      selection.set({ ...currentSelection, providerName: nextName });
    }
    nameDraft.set(null);
    return true;
  };

  const removeProvider = (name: string): void => {
    const current = config();
    if (!current) return;
    const nextEntries = { ...(current.providers ?? {}) };
    delete nextEntries[name];
    commit({ ...current, providers: nextEntries });
    const next = Object.keys(nextEntries)[0];
    selection.set(next === undefined ? null : { type: "provider", name: next });
    if (nameDraft()?.provider === name) nameDraft.set(null);
  };

  const addProviderEntry = (name: string, entry: ModelsJsonProvider): void => {
    const current = config();
    if (!current) return;
    commit({ ...current, providers: { ...(current.providers ?? {}), [name]: entry } });
    nameDraft.set(null);
    selection.set({ type: "provider", name });
  };

  const addCustomProvider = (): void => {
    const entries = config()?.providers ?? {};
    let name = "new-provider";
    let n = 1;
    while (entries[name]) name = `new-provider-${n++}`;
    addProviderEntry(name, { api: "openai-completions" });
  };

  const addModel = (name: string): void => {
    const index = (providerOf(name)?.models ?? []).length;
    changeProvider(name, (entry) => ({ ...entry, models: [...(entry.models ?? []), { id: "" }] }));
    selection.set({ type: "model", providerName: name, index });
  };

  const updateModel = (name: string, index: number, model: ModelsJsonModel): void => {
    changeProvider(name, (entry) => {
      const models = [...(entry.models ?? [])];
      if (!models[index]) return entry;
      models[index] = model;
      return { ...entry, models };
    });
  };

  const removeModel = (name: string, index: number): void => {
    changeProvider(name, (entry) => {
      const models = [...(entry.models ?? [])];
      models.splice(index, 1);
      const next = { ...entry };
      if (models.length > 0) next.models = models;
      else delete next.models;
      return next;
    });
    selection.set({ type: "provider", name });
  };

  const addDiscoveredModels = (name: string, additions: ModelsJsonModel[]): void => {
    changeProvider(name, (entry) => {
      const models = [...(entry.models ?? [])];
      const known = new Set(models.map((model) => model.id));
      for (const model of additions) {
        if (known.has(model.id)) continue;
        known.add(model.id);
        models.push({ ...model });
      }
      return { ...entry, models };
    });
  };

  const applyEnabled = (
    key: string,
    edit: () => Promise<EnabledModelsView>,
  ): void => {
    enabledPending.set(key);
    enabledFailure.set(null);
    enabledNotice.set(null);
    void edit()
      .then((next) => enabled.mutate(next))
      .catch((cause) => {
        enabledFailure.set(errorText(cause));
        enabled.refetch();
      })
      .finally(() => enabledPending.set(null));
  };

  const refreshEnabled = (): void => {
    enabledFailure.set(null);
    enabledNotice.set(null);
    enabled.refetch();
    auth.refetch();
    enabledNotice.set(t("models.catalogUpdated"));
  };

  const enabledActions: EnabledActions = {
    view: () => enabled(),
    pending: () => enabledPending(),
    failure: () => enabledFailure() ?? (enabled.error() ? errorText(enabled.error()) : null),
    notice: () => enabledNotice(),
    setModels: (key, refs, on) => applyEnabled(key, () => setModelsEnabled(
      activeCwd() ?? null,
      refs,
      on,
    )),
    setProvider: (providerId, on) => applyEnabled(`provider:${providerId}`, () => setProviderEnabled(
      activeCwd() ?? null,
      providerId,
      on,
    )),
    clear: () => applyEnabled("clear", () => clearEnabledModels(activeCwd() ?? null)),
    prune: () => applyEnabled("prune", () => pruneEnabledModels(activeCwd() ?? null)),
    refresh: refreshEnabled,
    contextOf: (providerId, modelId) => {
      const override = providerOf(providerId)?.modelOverrides?.[modelId];
      return isRecord(override) ? override.contextWindow : undefined;
    },
    setContext: (providerId, modelId, value) => {
      const current = config();
      if (!current) return;
      commit(withContextOverride(current, providerId, modelId, value));
    },
    draftDisabled: () => saving() || config() === undefined || config.error() !== undefined,
  };

  const handleSave = async (): Promise<void> => {
    let draft = config();
    if (!draft) return;
    const pending = nameDraft();
    if (pending) {
      const entry = draft.providers?.[pending.provider];
      if (entry) {
        const nextName = pending.name.trim();
        if (!nextName) {
          error.set(t("models.providerNameRequired"));
          return;
        }
        if (nextName !== pending.provider) {
          if (draft.providers?.[nextName]) {
            error.set(t("models.providerNameTaken", { name: nextName }));
            return;
          }
          const nextEntries = { ...(draft.providers ?? {}) };
          const moved = nextEntries[pending.provider];
          delete nextEntries[pending.provider];
          nextEntries[nextName] = moved;
          draft = { ...draft, providers: nextEntries };
          config.mutate(draft);
          const currentSelection = selection();
          if (currentSelection?.type === "provider" && currentSelection.name === pending.provider) {
            selection.set({ type: "provider", name: nextName });
          } else if (currentSelection?.type === "model" && currentSelection.providerName === pending.provider) {
            selection.set({ ...currentSelection, providerName: nextName });
          }
        }
        nameDraft.set(null);
      } else {
        nameDraft.set(null);
      }
    }

    const problem = localProblem(draft);
    if (problem) {
      error.set(problem);
      return;
    }

    saving.set(true);
    error.set(null);
    actionError.set(null);
    saved.set(false);
    try {
      await saveModelsConfig(normalizeForSave(draft));
      saved.set(true);
      nameDraft.set(null);
      config.refetch();
      auth.refetch();
      enabled.refetch();
    } catch (cause) {
      error.set(errorText(cause));
    } finally {
      saving.set(false);
    }
  };

  // Open the first entry once both lists answered; later changes are the
  // person's own and are never replaced.
  let initialised = false;
  effect(() => {
    if (config.loading() && config() === undefined) return;
    if (auth.loading() && auth() === undefined) return;
    const current = selection();
    if (!initialised) {
      initialised = true;
      if (current === null) {
        const custom = customProviders();
        const oauth = activeOAuth();
        const apiKey = activeApiKey();
        if (custom.length > 0) selection.set({ type: "provider", name: custom[0][0] });
        else if (oauth.length > 0) selection.set({ type: "oauth", providerId: oauth[0].id });
        else if (apiKey.length > 0) selection.set({ type: "apikey", providerId: apiKey[0].id });
      }
    }
    const chosen = selection();
    if (chosen === null || auth() === undefined || config() === undefined) return;
    if (chosen.type === "oauth" && !oauthProviders().some((provider) => provider.id === chosen.providerId)) {
      selection.set(null);
    } else if (chosen.type === "apikey" && !apiKeyProviders().some((provider) => provider.id === chosen.providerId)) {
      selection.set(null);
    } else if (chosen.type === "provider" && !config()?.providers?.[chosen.name]) {
      selection.set(null);
    } else if (chosen.type === "model" && !config()?.providers?.[chosen.providerName]?.models?.[chosen.index]) {
      selection.set({ type: "provider", name: chosen.providerName });
    }
  });

  // A catalog note or a switch failure belongs to the provider it was made
  // for, never to the next one the tree opens.
  effect(() => {
    selection();
    enabledFailure.set(null);
    enabledNotice.set(null);
  });

  const selectedOAuth = (): { providerId: string }[] => {
    const current = selection();
    return current?.type === "oauth" ? [{ providerId: current.providerId }] : [];
  };
  const selectedApiKey = (): { providerId: string }[] => {
    const current = selection();
    return current?.type === "apikey" ? [{ providerId: current.providerId }] : [];
  };
  const selectedProviders = (): { name: string }[] => {
    const current = selection();
    return current?.type === "provider" ? [{ name: current.name }] : [];
  };
  const selectedModels = (): { providerName: string; index: number }[] => {
    const current = selection();
    return current?.type === "model" ? [{ providerName: current.providerName, index: current.index }] : [];
  };

  const isOAuthSelected = (id: string): boolean => {
    const current = selection();
    return current?.type === "oauth" && current.providerId === id;
  };
  const isApiKeySelected = (id: string): boolean => {
    const current = selection();
    return current?.type === "apikey" && current.providerId === id;
  };
  const isProviderSelected = (name: string): boolean => {
    const current = selection();
    return current?.type === "provider" && current.name === name;
  };
  const isModelSelected = (name: string, index: number): boolean => {
    const current = selection();
    return current?.type === "model" && current.providerName === name && current.index === index;
  };

  const noProviders = (): boolean => (
    auth() !== undefined
    && config() !== undefined
    && activeOAuth().length === 0
    && activeApiKey().length === 0
    && customProviders().length === 0
    && config.error() === undefined
  );

  const footerStatus = (): string => {
    if (config.error()) {
      return t("models.configUnreadable", { error: errorText(config.error()) });
    }
    if (config.loading() && config() === undefined) return t("models.readingConfig");
    if (error()) return error() ?? "";
    if (actionError() || enabledFailure()) return actionError() ?? enabledFailure() ?? "";
    if (saved()) return t("models.savedNote");
    return t("models.applyHelp");
  };

  return (
    <>
      <ConfigSplit
        testID="models-config"
        list={
          <View style={{ gap: 2 }}>
            <If when={auth.error()}>
              <ConfigText tone="danger" text={authErrorText(auth.error())} />
            </If>
            <If when={config.error()}>
              <ConfigText
                tone="danger"
                text={t("models.configUnreadable", { error: errorText(config.error()) })}
              />
            </If>
            <If when={activeOAuth().length > 0}>
              <ConfigSidebarLabel text={t("i18n.subscriptions")} />
              <Each of={activeOAuth()} key={(provider) => provider.id}>
                {(provider) => (
                  <ConfigSidebarItem
                    active={isOAuthSelected(provider().id)}
                    testID={`models-oauth-${provider().id}`}
                    accessibilityLabel={provider().name}
                    onPress={() => selection.set({ type: "oauth", providerId: provider().id })}
                  >
                    <ProviderMark id={provider().id} size={16} />
                    <ConfigRowText title={provider().name} active={isOAuthSelected(provider().id)} />
                  </ConfigSidebarItem>
                )}
              </Each>
            </If>

            <If when={activeApiKey().length > 0}>
              <ConfigSidebarLabel text={t("models.apiKeyGroup")} />
              <Each of={activeApiKey()} key={(provider) => provider.id}>
                {(provider) => (
                  <ConfigSidebarItem
                    active={isApiKeySelected(provider().id)}
                    testID={`models-apikey-${provider().id}`}
                    accessibilityLabel={provider().displayName}
                    onPress={() => selection.set({ type: "apikey", providerId: provider().id })}
                  >
                    <ProviderMark id={provider().id} size={16} />
                    <ConfigRowText title={provider().displayName} active={isApiKeySelected(provider().id)} />
                  </ConfigSidebarItem>
                )}
              </Each>
            </If>

            <If when={customProviders().length > 0}>
              <ConfigSidebarLabel text={t("i18n.custom")} />
              <Each of={customProviders()} key={(pair) => pair[0]}>
                {(pair) => {
                  const name = (): string => pair()[0];
                  const entry = (): ModelsJsonProvider => pair()[1];
                  return (
                    <View style={{ gap: 1, marginBottom: 2 }}>
                      <ConfigSidebarItem
                        active={isProviderSelected(name())}
                        testID={`models-provider-${name()}`}
                        accessibilityLabel={providerTitle(name(), entry())}
                        onPress={() => selection.set({ type: "provider", name: name() })}
                      >
                        <ProviderMark id={name()} size={16} />
                        <ConfigRowText
                          title={providerTitle(name(), entry())}
                          active={isProviderSelected(name())}
                        />
                      </ConfigSidebarItem>
                      <Each of={entry().models ?? []} key={(_model, index) => index}>
                        {(model, index) => (
                          <ConfigSidebarItem
                            indented
                            active={isModelSelected(name(), index())}
                            testID={`models-model-${name()}-${index()}`}
                            accessibilityLabel={modelSidebarLabel(model())}
                            onPress={() => selection.set({
                              type: "model",
                              providerName: name(),
                              index: index(),
                            })}
                          >
                            <ConfigRowText
                              title={modelSidebarLabel(model())}
                              muted={!model().id}
                              active={isModelSelected(name(), index())}
                            />
                            <If when={model().reasoning === true}>
                              <Text
                                style={{
                                  fontSize: 9,
                                  paddingHorizontal: 4,
                                  paddingVertical: 1,
                                  borderRadius: 3,
                                  backgroundColor: alpha(colors.accent, 0.12),
                                  color: colors.accent,
                                }}
                              >
                                T
                              </Text>
                            </If>
                          </ConfigSidebarItem>
                        )}
                      </Each>
                      <ConfigSidebarItem
                        indented
                        muted
                        testID={`models-add-model-${name()}`}
                        accessibilityLabel={t("models.addModel")}
                        onPress={() => addModel(name())}
                      >
                        <Text style={{ fontSize: 12, color: colors.muted }}>{`+ ${t("i18n.model")}`}</Text>
                      </ConfigSidebarItem>
                    </View>
                  );
                }}
              </Each>
            </If>

            <If when={config.loading() && config() === undefined}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
                <SettingsLoading label={t("models.readingConfig")} />
              </View>
            </If>
            <If when={noProviders()}>
              <View style={{ paddingHorizontal: 8, paddingVertical: 10, gap: 4 }}>
                <ConfigText text={t("i18n.noProvidersYet")} />
              </View>
            </If>
          </View>
        }
        listFooter={
          <ConfigListAction
            label={t("i18n.addProvider")}
            testID="models-add-provider"
            onPress={() => pickerOpen.set(true)}
          />
        }
        detail={
          <View style={{ gap: 16 }}>
            <If when={selection() === null}>
              <ConfigEmpty text={t("i18n.selectProviderModel")} />
            </If>

            <Each of={selectedOAuth()} key={(item) => item.providerId}>
              {(item) => (
                <OAuthDetail
                  providerId={() => item().providerId}
                  provider={() => oauthProviders().find((provider) => provider.id === item().providerId)}
                  onRefresh={() => auth.refetch()}
                  autoStart={() => autoOAuth() === item().providerId}
                  onAutoStarted={() => autoOAuth.set(null)}
                  actions={enabledActions}
                />
              )}
            </Each>

            <Each of={selectedApiKey()} key={(item) => item.providerId}>
              {(item) => (
                <ApiKeyDetail
                  providerId={() => item().providerId}
                  provider={() => apiKeyProviders().find((provider) => provider.id === item().providerId)}
                  onRefresh={() => auth.refetch()}
                  actions={enabledActions}
                />
              )}
            </Each>

            <Each of={selectedProviders()} key={(item) => item.name}>
              {(item) => (
                <CustomProviderDetail
                  name={item().name}
                  provider={() => providerOf(item().name) ?? {}}
                  nameDraft={() => nameDraftFor(item().name)}
                  onNameDraft={(value) => {
                    saved.set(false);
                    error.set(null);
                    nameDraft.set(value === item().name ? null : { provider: item().name, name: value });
                  }}
                  onRename={() => {
                    if (!renameProvider(item().name, nameDraftFor(item().name))) return;
                    actionError.set(null);
                  }}
                  onDelete={() => removeProvider(item().name)}
                  onChange={(change) => changeProvider(item().name, change)}
                  onChangeFields={(change) => changeProviderFields(item().name, change)}
                  onAddModels={(models) => addDiscoveredModels(item().name, models)}
                  onAddModel={() => addModel(item().name)}
                  actions={enabledActions}
                />
              )}
            </Each>

            <Each of={selectedModels()} key={(item) => `${item.providerName}:${item.index}`}>
              {(item) => (
                <ModelDetail
                  providerName={item().providerName}
                  provider={() => providerOf(item().providerName) ?? {}}
                  model={() => providerOf(item().providerName)?.models?.[item().index] ?? { id: "" }}
                  onChange={(model) => updateModel(item().providerName, item().index, model)}
                  onDelete={() => removeModel(item().providerName, item().index)}
                  actions={enabledActions}
                />
              )}
            </Each>
          </View>
        }
        footer={
          <ConfigFooter status={footerStatus()}>
            <Button
              label={saved() ? t("i18n.saved") : saving() ? t("i18n.saving") : t("i18n.save")}
              variant="primary"
              busy={saving()}
              disabled={saving() || saved() || config() === undefined || config.error() !== undefined}
              onPress={() => void handleSave()}
            />
          </ConfigFooter>
        }
      />

      <AddProviderPicker
        open={() => pickerOpen()}
        oauthProviders={oauthProviders}
        apiKeyProviders={apiKeyProviders}
        customEnabled={() => config() !== undefined && config.error() === undefined}
        onSelectOAuth={(id) => {
          autoOAuth.set(id);
          selection.set({ type: "oauth", providerId: id });
          pickerOpen.set(false);
        }}
        onSelectApiKey={(id) => {
          selection.set({ type: "apikey", providerId: id });
          pickerOpen.set(false);
        }}
        onAddCustom={() => {
          addCustomProvider();
          pickerOpen.set(false);
        }}
        onClose={() => pickerOpen.set(false)}
      />
    </>
  );
}
