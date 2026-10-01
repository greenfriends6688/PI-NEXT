"use client";

import { Fragment, useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { formatUpdatedTime } from "@/lib/i18n/format";
import type { ModelCatalogPreset, ModelCatalogRecommendation } from "@/lib/model-catalog";
import type { DiscoveredModel } from "@/lib/model-discovery";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
import {
  collectModelRenames,
  hasModelCostDraftValue,
  modelCostToDraft,
  parseCompleteModelCost,
  savedModelIds,
  serializeHeaderRows,
  setCompatBool,
  trackAddedModels,
  updateHeaderRow,
  type HeaderRow,
  type ModelCostDraft,
  type ModelCostKey,
} from "./models-config-helpers";
import {
  ConfigBadge,
  ConfigButton,
  ConfigDetail,
  ConfigDetailActions,
  ConfigDetailHeader,
  ConfigDetailHeaderInfo,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigEmptyState,
  ConfigField,
  ConfigKv,
  ConfigPanelShell,
  ConfigSectionTitle,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarSub,
  ConfigSidebarText,
  ConfigSplitView,
  ConfigStat,
  ConfigStatGrid,
  ConfigStatusDot,
  ConfigSwitch,
  PwCtl,
  PwRadio,
  PwSelectBox,
  type PwRadioOption,
} from "./SettingsUi";
import { PwSearch, SettingsPage } from "./SettingsUi";
import {
  EnabledModelsBanner,
  EnabledModelsProviderSwitch,
  EnabledModelsSection,
  useEnabledModels,
  type EnabledModelsController,
} from "./EnabledModelsSection";
import { findProviderView, providerBadgeLabel } from "./enabled-models-helpers";
import { ProviderIcon } from "./ProviderIcon";
import {
  PROVIDER_ICON_MODES,
  getProviderEmoji,
  getProviderIconMode,
  getProviderIconModesVersion,
  setProviderEmoji,
  setProviderIconMode,
  subscribeProviderIconModes,
  type ProviderIconMode,
} from "@/lib/provider-icon";
import { ProviderUsageSummary } from "./ProviderUsageSummary";
import { isProviderUsageId } from "@/lib/provider-usage-ids";
import { ProviderUsageCards } from "./fork/ProviderUsageCards";
import {
  favoriteModelKey,
  getFavoriteModelsServerSnapshot,
  getFavoriteModelsSnapshot,
  subscribeFavoriteModels,
  toggleFavoriteModelKey,
} from "@/lib/favorite-models";
import { describeThinkingRequestFromFields, type ThinkingModelFields } from "@/lib/thinking-request-core";
import type { ThinkingProfileInputs } from "@/lib/models-cache";
import { formatThinkingRequestParams } from "./models-config-helpers";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OAuthProvider {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
  /** Provider also accepts an API key, so it appears in both picker sections. */
  supportsApiKey?: boolean;
}

interface ApiKeyProvider {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  /** Provider also supports OAuth, so it appears in both picker sections. */
  supportsOAuth?: boolean;
}

type OAuthLoginState =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "auth"; url: string; instructions: string | null; token: string }
  | { phase: "device_code"; userCode: string; verificationUri: string; intervalSeconds: number | null; expiresInSeconds: number | null }
  | { phase: "prompt"; message: string; placeholder: string | null; token: string }
  | { phase: "select"; message: string; options: { id: string; label: string }[]; token: string }
  | { phase: "progress"; message: string }
  | { phase: "success" }
  | { phase: "error"; message: string };

interface ModelEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; tiers?: unknown };
  headers?: Record<string, string>;
  /** Arbitrary provider request parameters (temperature, top_p, …). pi merges this
   *  into the request options, so it is the real "advanced parameters" escape hatch. */
  samplingParams?: Record<string, unknown>;
  compat?: Record<string, unknown>;
}

interface ProviderEntry {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  models?: ModelEntry[];
  modelOverrides?: Record<string, unknown>;
}

interface ModelsJson {
  providers?: Record<string, ProviderEntry>;
}

type ModelTestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "success"; latencyMs?: number; status?: number; responseText?: string }
  | { phase: "error"; message: string; latencyMs?: number; status?: number };

type ModelDiscoveryState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; models: DiscoveredModel[]; endpoint: string }
  | { phase: "error"; message: string };

type ModelCatalogState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; recommendation: ModelCatalogRecommendation; appliedCount: number }
  | { phase: "error"; message: string };

type Selection =
  | { type: "provider"; name: string }
  | { type: "model"; providerName: string; index: number }
  | { type: "oauth"; providerId: string }
  | { type: "apikey"; providerId: string };

function readRememberedSelection(): Selection | null {
  const raw = getLastSettingsSelection("models");
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object") return null;
    const selection = value as Record<string, unknown>;
    if (selection.type === "provider" && typeof selection.name === "string") {
      return { type: "provider", name: selection.name };
    }
    if (selection.type === "model"
      && typeof selection.providerName === "string"
      && typeof selection.index === "number"
      && Number.isInteger(selection.index)
      && selection.index >= 0) {
      return { type: "model", providerName: selection.providerName, index: selection.index };
    }
    if ((selection.type === "oauth" || selection.type === "apikey")
      && typeof selection.providerId === "string") {
      return { type: selection.type, providerId: selection.providerId };
    }
  } catch {
    // Ignore malformed browser state.
  }
  return null;
}

function customSelectionExists(config: ModelsJson, selection: Selection): boolean {
  if (selection.type === "provider") return Boolean(config.providers?.[selection.name]);
  if (selection.type !== "model") return true;
  return Boolean(config.providers?.[selection.providerName]?.models?.[selection.index]);
}

const API_OPTIONS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const;

// ── Form field helpers ────────────────────────────────────────────────────────

/* fork:design-system —— 表单控件全部换成画板的 `.pw-input` / `.pw-selectbox`
   （视觉全在 board.css）。三个只存在于画板 DOM / 产品行为里的行内值集中在这里：
   · FILL_ROW_INPUT = 画板 41 搜索行的 `style="flex:1;min-width:0"` —— pw-input
     （或包着它的行）在 flex 行里要吃掉剩余宽度、并盖掉 min-width:200px
     （ChatWindow 同款先例）。
   · DISCOVERY_CHECKBOX —— 画板没有复选框基件（.pw-switch 是开关不是多选）：
     上游导入清单勾选框的几何与 accentColor 只能留在行内。
   · BREAKABLE_LINK —— 画板没有链接基件；颜色走 token，授权 URL 很长必须可断行。 */
const FILL_ROW_INPUT = { flex: 1, minWidth: 0 } as const;
const DISCOVERY_CHECKBOX = { width: 13, height: 13, accentColor: "var(--accent)", flexShrink: 0 } as const;
const BREAKABLE_LINK = { color: "var(--accent)", wordBreak: "break-all" } as const;

function TextInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input
      className={mono ? "pw-input pw-mono" : "pw-input"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function SecretTextInput({
  value,
  onChange,
  placeholder,
  mono,
  onKeyDown,
  autoComplete = "off",
  spellCheck = false,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  autoComplete?: string;
  spellCheck?: boolean;
  style?: React.CSSProperties;
}) {
  const [visible, setVisible] = useState(false);
  const { t } = useI18n();

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  /* 显隐切换从「盖在输入框上的浮动按钮」改成画板 41 搜索行的形态：
     pw-inline 行 + pw-input + 行尾 pw-iconbtn，浮动定位不再需要自绘。 */
  return (
    <div className="pw-inline" style={style}>
      <input
        type={visible ? "text" : "password"}
        className={mono ? "pw-input pw-mono" : "pw-input"}
        style={FILL_ROW_INPUT}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
      />
      <button
        type="button"
        className="pw-iconbtn sm"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("i18n.hideDetails") : t("i18n.showDetails")}
        title={visible ? t("i18n.hideDetails") : t("i18n.showDetails")}
      >
        <span className="pw-ico"><i data-ico={visible ? "eye-off" : "eye"} data-size="13"></i></span>
      </button>
    </div>
  );
}

function NumInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="number"
      className="pw-input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function Select({ value, onChange, options, required, ariaLabel }: { value: string; onChange: (v: string) => void; options: readonly string[]; required?: boolean; ariaLabel: string }) {
  const { t } = useI18n();
  const choices = [
    ...(required ? [] : [{ value: "", label: `— ${t("i18n.default")} / none —` }]),
    ...options.map((o) => ({ value: o, label: o })),
  ];
  return <PwSelectBox value={value} options={choices} ariaLabel={ariaLabel} onChange={onChange} />;
}

// ── Provider 图标模式（D2-PR-20）─────────────────────────────────────────────

const ICON_MODE_LABEL_KEYS: Record<ProviderIconMode, string> = {
  auto: "models.providerIconAuto",
  api: "models.providerIconApi",
  letter: "models.providerIconLetter",
  emoji: "models.providerIconEmoji",
};

/**
 * 4 段模式选择（auto / api / letter / emoji）+ 自定义 emoji 输入。
 * 图标本体仍是本仓库的 sprite，这里只切「模式 + 角标 + emoji」三层决策；
 * 选择立即写入 localStorage 并广播，列表里的 ProviderIcon 同步重渲染。
 */
function ProviderIconModePicker({ providerId, api }: { providerId: string; api?: string }) {
  const { t } = useI18n();
  useSyncExternalStore(subscribeProviderIconModes, getProviderIconModesVersion, () => 0);
  const current = getProviderIconMode(providerId);
  const [emojiDraft, setEmojiDraft] = useState(() => getProviderEmoji(providerId) ?? "");

  const chooseMode = (next: ProviderIconMode) => {
    // 选 emoji 时先落一个默认 ✨，避免只切模式、还没填字形时退回首字母。
    if (next === "emoji" && !getProviderEmoji(providerId)) setProviderEmoji(providerId, "✨");
    setProviderIconMode(providerId, next);
    if (next === "emoji") setEmojiDraft(getProviderEmoji(providerId) ?? "✨");
  };

  const updateEmoji = (value: string) => {
    setEmojiDraft(value);
    setProviderEmoji(providerId, value || null);
  };

  /* fork:design-system —— 四段模式就是画板的 radio 芯片（`.pw-radio > button`，
     SettingsUi 的 PwRadio 基件）：选中态 accent 由画板给；芯片前置的图案是品牌
     ProviderIcon（非 sprite 名），走 PwRadioOption.node。 */
  return (
    <div className="pw-rowgap">
      <PwRadio
        value={current}
        options={PROVIDER_ICON_MODES.map((modeOption) => ({
          value: modeOption,
          label: t(ICON_MODE_LABEL_KEYS[modeOption]),
          node: <ProviderIcon id={providerId} api={api} size={12} mode={modeOption} />,
        }))}
        ariaLabel={t("models.providerIcon")}
        onChange={chooseMode}
      />
      {current === "emoji" && (
        <div className="pw-inline">
          <input
            className="pw-input pw-mono"
            value={emojiDraft}
            onChange={(event) => updateEmoji(event.target.value)}
            placeholder={t("models.providerIconEmojiPlaceholder")}
            aria-label={t("models.providerIconEmoji")}
            maxLength={16}
          />
          <ConfigButton
            variant="ghost"
            size="small"
            disabled={!emojiDraft && !getProviderEmoji(providerId)}
            onClick={() => updateEmoji("")}
          >
            {t("models.providerIconEmojiClear")}
          </ConfigButton>
        </div>
      )}
      <div className="pw-mono pw-dim">{t("models.providerIconModeDescription")}</div>
    </div>
  );
}

// ── Provider detail ───────────────────────────────────────────────────────────

function ProviderDetail({ name, provider, onChange, onRename, onDelete, onAddModels, enabledModels, onOpenModel, onAddModel, onPrune }: {
  name: string; provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void; onRename: (n: string) => void; onDelete: () => void;
  onAddModels: (models: DiscoveredModel[]) => void; enabledModels: EnabledModelsController;
  /** 画板 41 的「可用模型」是一行一个模型：点它就钻到模型详情。 */
  onOpenModel: (index: number) => void;
  onAddModel: () => void;
  onPrune: () => void;
}) {
  const { t, locale } = useI18n();
  const [editingName, setEditingName] = useState(name);
  const [discoveryState, setDiscoveryState] = useState<ModelDiscoveryState>({ phase: "idle" });
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const discoveryRequestIdRef = useRef(0);
  const selectShownRef = useRef<HTMLInputElement>(null);
  useEffect(() => setEditingName(name), [name]);
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) => onChange({ ...provider, [k]: v });

  useEffect(() => {
    if (!provider.api) onChange({ ...provider, api: "openai-completions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.api]);

  useEffect(() => {
    discoveryRequestIdRef.current += 1;
    setDiscoveryState({ phase: "idle" });
    setDiscoveryQuery("");
    setSelectedModelIds([]);
  }, [name, provider.baseUrl, provider.api, provider.apiKey]);

  const handleDiscoverModels = useCallback(async () => {
    if (!provider.baseUrl?.trim() || discoveryState.phase === "loading") return;
    const requestId = ++discoveryRequestIdRef.current;
    setDiscoveryState({ phase: "loading" });
    setSelectedModelIds([]);
    try {
      const res = await fetch("/api/models-config/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName: name, provider: { ...provider, models: undefined } }),
      });
      const data = await res.json() as { models?: DiscoveredModel[]; endpoint?: string; error?: string };
      if (requestId !== discoveryRequestIdRef.current) return;
      if (!res.ok || data.error || !data.models) {
        setDiscoveryState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setDiscoveryState({ phase: "success", models: data.models, endpoint: data.endpoint ?? provider.baseUrl });
      setLastSync({ at: Date.now(), count: data.models.length });
    } catch (error) {
      if (requestId !== discoveryRequestIdRef.current) return;
      setDiscoveryState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [discoveryState.phase, name, provider]);

  const existingModelIds = new Set((provider.models ?? []).map((model) => model.id));
  const discoveredModels = discoveryState.phase === "success" ? discoveryState.models : [];
  const normalizedDiscoveryQuery = discoveryQuery.trim().toLocaleLowerCase();
  const filteredDiscoveredModels = discoveredModels.filter((model) => !normalizedDiscoveryQuery
    || model.id.toLocaleLowerCase().includes(normalizedDiscoveryQuery)
    || model.name?.toLocaleLowerCase().includes(normalizedDiscoveryQuery));
  const shownDiscoveredModels = filteredDiscoveredModels.slice(0, 300);
  const selectableShownIds = shownDiscoveredModels
    .filter((model) => !existingModelIds.has(model.id))
    .map((model) => model.id);
  const selectedCount = selectedModelIds.filter((id) => !existingModelIds.has(id)).length;
  const allShownSelected = selectableShownIds.length > 0
    && selectableShownIds.every((id) => selectedModelIds.includes(id));
  const someShownSelected = !allShownSelected
    && selectableShownIds.some((id) => selectedModelIds.includes(id));

  useEffect(() => {
    if (selectShownRef.current) selectShownRef.current.indeterminate = someShownSelected;
  }, [someShownSelected]);

  const toggleDiscoveredModel = (id: string) => {
    setSelectedModelIds((current) => current.includes(id)
      ? current.filter((entry) => entry !== id)
      : [...current, id]);
  };

  const toggleShownModels = () => {
    const shownIds = new Set(selectableShownIds);
    setSelectedModelIds((current) => allShownSelected
      ? current.filter((id) => !shownIds.has(id))
      : Array.from(new Set([...current, ...selectableShownIds])));
  };

  const addSelectedModels = () => {
    if (discoveryState.phase !== "success") return;
    const selected = new Set(selectedModelIds);
    const additions = discoveryState.models.filter((model) => selected.has(model.id) && !existingModelIds.has(model.id));
    if (additions.length === 0) return;
    onAddModels(additions);
    setSelectedModelIds([]);
  };

  /* fork:models-board —— 画板 41 的「可用模型」是**按名字过滤的开关行**，
     头卡里那三行 `.pw-kv`（接口地址 / 认证方式 / 上次同步）也在这算。
     「上次同步」是本次打开面板后真的成功导入过一次才有的事实，没有就明说没有。 */
  const [lastSync, setLastSync] = useState<{ at: number; count: number } | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  const authSummary = (() => {
    const key = provider.apiKey?.trim();
    if (!key) return t("models.kvAuthNotSet");
    if (key.startsWith("!")) return t("models.kvAuthShell");
    if (/^[A-Z][A-Z0-9_]*$/.test(key)) return t("models.kvAuthEnv", { name: key });
    return t("models.kvAuthLiteral");
  })();
  const normalizedModelFilter = modelFilter.trim().toLocaleLowerCase();
  const configuredModels = (provider.models ?? []).filter((model) => !normalizedModelFilter
    || model.id.toLocaleLowerCase().includes(normalizedModelFilter)
    || model.name?.toLocaleLowerCase().includes(normalizedModelFilter));
  // A custom provider is switched as a whole (see `EnabledModelsProviderView.kind`),
  // so its model list has no per-row switch to report — the badge counts what the
  // runtime exposes for it instead.
  const providerView = findProviderView(enabledModels.view, name);
  const enabledCount = providerView?.enabledCount ?? 0;
  const stalePatternCount = enabledModels.view?.stalePatterns.length ?? 0;
  const modelSubtitle = (model: ModelEntry): string => {
    const context = model.contextWindow
      ? t("models.modelSubBare", { context: formatTokenLimit(model.contextWindow) })
      : null;
    if (model.cost?.input !== undefined && model.cost?.output !== undefined) {
      const price = t("models.pricePerMillion", { input: String(model.cost.input), output: String(model.cost.output) });
      return context ? t("models.modelSub", { context, price }) : price;
    }
    return context ?? "";
  };

  /* fork:models-board —— 画板 41 的右列是**三张独立的 `.pw-detail` 卡**
     （供应商头卡 / 用量摘要 / 可用模型），不是一个撑满高度的巨卡。
     可调参数全部保留，但归到第四张「连接与请求」卡里：头卡只回答
     「它是谁、连到哪、上次什么时候同步的」。 */
  return (
    <ConfigDetailStack>
      <ConfigDetail>
        <ConfigDetailHeader>
          <ConfigDetailHeaderInfo>
            <ProviderIcon id={name} size={22} />
            <ConfigDetailTitle>{name}</ConfigDetailTitle>
            <ConfigBadge tone="count">{provider.api ?? "openai-completions"}</ConfigBadge>
            <span className="pw-grow" aria-hidden="true" />
            <EnabledModelsProviderSwitch providerId={name} controller={enabledModels} />
            <ConfigButton variant="danger" size="small" onClick={onDelete}>{t("i18n.delete")}</ConfigButton>
          </ConfigDetailHeaderInfo>
        </ConfigDetailHeader>
        <ConfigKv>
          <dt>{t("models.kvBaseUrl")}</dt>
          <dd className="pw-mono">{provider.baseUrl || "—"}</dd>
          <dt>{t("models.kvAuth")}</dt>
          <dd>{authSummary}</dd>
          <dt>{t("models.kvLastSync")}</dt>
          <dd className="pw-mono">
            {lastSync
              ? `${formatUpdatedTime(lastSync.at, locale)} · ${t("models.discoveryFetched", { count: lastSync.count })}`
              : t("models.neverSynced")}
          </dd>
        </ConfigKv>
      </ConfigDetail>

      <ConfigDetail>
        <h3>{t("models.usageTitle")}</h3>
        <ProviderUsageCards providerId={name} />
      </ConfigDetail>

      <ConfigDetail>
        <ConfigDetailHeader>
          <ConfigDetailTitle>{t("models.availableModels")}</ConfigDetailTitle>
          <ConfigBadge tone="count">
            {t("models.modelsCount", { count: provider.models?.length ?? 0, enabled: enabledCount })}
          </ConfigBadge>
          <span className="pw-grow" aria-hidden="true" />
          <input
            className="pw-input"
            /* 画板 41 的过滤框自带 inline（height:24px;min-width:120px）；
               flex 基准是本产品行内的收放。 */
            style={{ height: "var(--control-xs)", minWidth: 120, flex: "0 1 160px" }}
            value={modelFilter}
            onChange={(event) => setModelFilter(event.target.value)}
            placeholder={t("models.filterModels")}
            aria-label={t("models.filterModels")}
          />
          <ConfigButton
            variant="secondary"
            size="small"
            disabled={!provider.baseUrl?.trim() || discoveryState.phase === "loading"}
            onClick={handleDiscoverModels}
          >
            <span className="pw-ico"><i data-ico="download" data-size="13"></i></span>
            {discoveryState.phase === "loading" ? t("models.discoveryFetching") : t("models.importFromUpstream")}
          </ConfigButton>
        </ConfigDetailHeader>

        {configuredModels.length === 0 ? (
          <p className="pw-hint">{provider.models?.length ? t("models.enabledNoMatches") : t("models.noModels")}</p>
        ) : (
          <div className="pw-list">
            {configuredModels.map((model, index) => {
              const subtitle = modelSubtitle(model);
              return (
                <div
                  key={index}
                  className="pw-litem models-provider-model-row"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenModel(index)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onOpenModel(index);
                  }}
                >
                  <span className="grow">
                    <ConfigSidebarText>{model.name || model.id || t("i18n.newModel")}</ConfigSidebarText>
                    {subtitle ? <ConfigSidebarSub>{subtitle}</ConfigSidebarSub> : null}
                  </span>
                  {model.reasoning ? <ConfigBadge tone="accent">{t("models.badgePinnable")}</ConfigBadge> : null}
                </div>
              );
            })}
          </div>
        )}

        <ConfigDetailHeader>
          {/* `.pw-mono` 本身就是 var(--text-meta)，不需要再补字号。 */}
          <span className="pw-mono pw-dim">
            {t("models.enabledProjectScope")}
          </span>
          <span className="pw-grow" aria-hidden="true" />
          <ConfigButton
            size="small"
            disabled={stalePatternCount === 0}
            title={stalePatternCount === 0 ? undefined : t("models.pruneHint", { count: stalePatternCount })}
            onClick={onPrune}
          >
            {t("models.pruneUnmatched")}
          </ConfigButton>
          <ConfigButton size="small" variant="ghost" onClick={onAddModel}>{t("i18n.addModel")}</ConfigButton>
        </ConfigDetailHeader>
      </ConfigDetail>

      {discoveryState.phase !== "idle" && (
        <ConfigDetail>
        <ConfigDetailHeader>
          <ConfigDetailTitle>{t("models.importFromUpstream")}</ConfigDetailTitle>
          <span className="pw-grow" aria-hidden="true" />
            {discoveryState.phase === "success" && (
              <ConfigButton size="small" variant="ghost" onClick={() => setDiscoveryState({ phase: "idle" })}>
                {t("i18n.close")}
              </ConfigButton>
            )}
          </ConfigDetailHeader>

          {discoveryState.phase === "error" && (
            <div className="pw-alert">{discoveryState.message}</div>
          )}

          {discoveryState.phase === "success" && (
            <>
              <ConfigField label={t("models.discoveryFilter")}>
                <input
                  className="pw-input"
                  value={discoveryQuery}
                  onChange={(event) => setDiscoveryQuery(event.target.value)}
                  placeholder={t("models.discoveryFilterPlaceholder", { count: discoveryState.models.length })}
                  aria-label={t("models.discoveryFilter")}
                />
              </ConfigField>

              <div className="pw-list models-discovery-list">
                <label className="pw-litem models-discovery-row models-discovery-head">
                  <input
                    ref={selectShownRef}
                    type="checkbox"
                    checked={allShownSelected}
                    disabled={selectableShownIds.length === 0}
                    onChange={toggleShownModels}
                    style={DISCOVERY_CHECKBOX}
                  />
                  <ConfigSidebarText>{t("models.discoverySelectShown")}</ConfigSidebarText>
                </label>
                {shownDiscoveredModels.length === 0 ? (
                  <p className="pw-hint">{t("models.discoveryNoMatches")}</p>
                ) : shownDiscoveredModels.map((model) => {
                  const alreadyAdded = existingModelIds.has(model.id);
                  return (
                    <label
                      key={model.id}
                      className={`pw-litem models-discovery-row${alreadyAdded ? " is-added" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedModelIds.includes(model.id) || alreadyAdded}
                        disabled={alreadyAdded}
                        onChange={() => toggleDiscoveredModel(model.id)}
                        style={DISCOVERY_CHECKBOX}
                      />
                      <span className="grow">
                        <ConfigSidebarText>{model.name ?? model.id}</ConfigSidebarText>
                        <ConfigSidebarSub>{model.id}</ConfigSidebarSub>
                      </span>
                      {alreadyAdded && <ConfigBadge>{t("models.discoveryAdded")}</ConfigBadge>}
                    </label>
                  );
                })}
              </div>

              <ConfigDetailHeader>
                {/* `.catalog-status-text`（settings.css）就是「X / Y」状态行的截断语义；
                    `.pw-mono` 自带 meta 字号。 */}
                <span
                  title={discoveryState.endpoint}
                  className="pw-mono pw-dim catalog-status-text"
                >
                  {filteredDiscoveredModels.length > shownDiscoveredModels.length
                    ? t("models.discoveryShowing", { shown: shownDiscoveredModels.length, total: filteredDiscoveredModels.length })
                    : t("models.discoveryFetched", { count: discoveryState.models.length })}
                </span>
                <span className="pw-grow" aria-hidden="true" />
                <ConfigButton
                  variant="primary"
                  size="small"
                  disabled={selectedCount === 0}
                  onClick={addSelectedModels}
                >
                  {selectedCount
                    ? t("models.discoveryAddSelectedCount", { count: selectedCount })
                    : t("models.discoveryAddSelected")}
                </ConfigButton>
              </ConfigDetailHeader>
            </>
          )}
        </ConfigDetail>
      )}

      <ConfigDetail>
        <h3>{t("models.connectionTitle")}</h3>
        <ConfigField label={t("i18n.providerName")}>
          <PwCtl>
            <TextInput value={editingName} onChange={setEditingName} placeholder="provider-name" mono />
            {editingName !== name && editingName.trim() && (
              <ConfigButton size="small" variant="primary" onClick={() => onRename(editingName.trim())}>
                {t("i18n.rename")}
              </ConfigButton>
            )}
          </PwCtl>
        </ConfigField>

        {/* D2-PR-20：provider 图标模式（auto/api/letter/emoji）。 */}
        <ConfigField label={t("models.providerIcon")}>
          <ProviderIconModePicker providerId={name} api={provider.api} />
        </ConfigField>

        <ConfigField label={t("models.kvBaseUrl")}>
          <TextInput value={provider.baseUrl ?? ""} onChange={(v) => set("baseUrl", v || undefined)}
            placeholder="https://api.example.com/v1" mono />
        </ConfigField>

        <ConfigField label={t("models.apiKeyLabel")} hint={t("models.apiKeyHint")}>
          <SecretTextInput value={provider.apiKey ?? ""} onChange={(v) => set("apiKey", v || undefined)}
            placeholder="ENV_VAR_NAME, !shell-command, or literal key" mono />
        </ConfigField>

        <ConfigField label={t("models.apiLabel")}>
          <Select value={provider.api ?? "openai-completions"} onChange={(v) => set("api", v)} options={API_OPTIONS} required ariaLabel={t("models.apiLabel")} />
        </ConfigField>

        <ConfigField label={t("models.headers")} hint={t("models.providerHeadersHint")}>
          <HeaderListEditor headers={provider.headers} onChange={(headers) => set("headers", headers)} />
        </ConfigField>
      </ConfigDetail>
    </ConfigDetailStack>
  );
}

// ── ThinkingLevelMap editor ───────────────────────────────────────────────────

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = typeof THINKING_LEVELS[number];

// fork:design-system —— 七档只用设计允许的五个色相（中性 + 强调 + 4 语义），
// 不再各来一个自造色：off/minimal 走中性两档，low/medium/high 走强调三档，
// xhigh 走 warning，max 走 danger。深浅由 token 自己跟主题走。
const LEVEL_COLORS: Record<ThinkingLevel, string> = {
  off:     "var(--text-dim)",
  minimal: "var(--n-muted)",
  low:     "var(--accent-text)",
  medium:  "var(--accent)",
  high:    "var(--accent-hover)",
  xhigh:   "var(--warning)",
  max:     "var(--danger)",
};

/* 画板 41「能力」区的三态没有开关二值那么简单：每档是
   omit（跟随默认）/ null（Disabled）/ string（Custom + 值），画成分段芯片就是
   `.pw-radio`（PwRadio 基件，键盘可切换）。 */
const LEVEL_STATE_OPTIONS = [
  { value: "omit", label: "Default" },
  { value: "null", label: "Disabled" },
  { value: "string", label: "Custom" },
] as const;

type ThinkingLevelState = (typeof LEVEL_STATE_OPTIONS)[number]["value"];

function ThinkingLevelMapEditor({
  value,
  onChange,
  describeLevel,
}: {
  value: Record<string, string | null> | undefined;
  onChange: (v: Record<string, string | null> | undefined) => void;
  /** fork:upstream-0.9.2-thinking-profile — D2-PR-21 — 该档实际会发的请求参数（`lib/thinking-request-core.ts` 的镜像结果）。 */
  describeLevel?: (level: string) => { text: string | null; invalid?: string } | null;
}) {
  const { t } = useI18n();
  const map = value ?? {};

  const setLevel = (level: ThinkingLevel, entry: string | null | "omit") => {
    const next = { ...map };
    if (entry === "omit") {
      delete next[level];
    } else {
      next[level] = entry;
    }
    onChange(Object.keys(next).length ? next : undefined);
  };

  /* fork:design-system —— 行结构换成画板 41「规格」区的 pw-field 形态：
     左侧「档名 + 该档实际请求的小字说明」、右侧 pw-ctl 三态芯片；
     行间发丝线来自画板的 `.pw-field + .pw-field`。档位色点沿用七档语义色
     （LEVEL_COLORS，运行时色值），Disabled 档做淡出。 */
  return (
    <div className="pw-rowgap">
      {THINKING_LEVELS.map((level) => {
        const raw = map[level];
        const state: ThinkingLevelState =
          !(level in map) ? "omit" : raw === null ? "null" : "string";
        const strVal = typeof raw === "string" ? raw : "";
        const described = describeLevel?.(level) ?? null;
        const invalid = described?.invalid !== undefined;
        const dotColor = state === "null"
          ? `color-mix(in srgb, ${LEVEL_COLORS[level]} 30%, transparent)`
          : LEVEL_COLORS[level];

        return (
          <div key={level} className="pw-field">
            <span className="pw-label">
              <ConfigStatusDot color={dotColor} />
              <span
                className={state === "null" ? "pw-mono pw-dim" : "pw-mono"}
                style={state === "null" ? { textDecoration: "line-through" } : undefined}
              >
                {level}
              </span>
              {described ? (
                <small
                  title={invalid ? described.invalid : described.text ?? undefined}
                  style={invalid ? { color: "var(--danger)" } : undefined}
                >
                  {invalid ? described.invalid : described.text ?? t("models.thinkingSendsNothing")}
                </small>
              ) : null}
            </span>
            <PwCtl>
              <PwRadio
                value={state}
                options={LEVEL_STATE_OPTIONS}
                ariaLabel={level}
                onChange={(next) => setLevel(level, next === "omit" ? "omit" : next === "null" ? null : strVal || level)}
              />
              {state === "string" && (
                <input
                  className="pw-input pw-mono"
                  value={strVal}
                  onChange={(e) => setLevel(level, e.target.value)}
                  placeholder={level}
                  maxLength={10}
                  /* `.pw-input` 的 min-width:200px 会把 pw-ctl 撑爆；自定义映射值很短（≤10 字符）。 */
                  style={{ width: "12ch", minWidth: 0 }}
                />
              )}
            </PwCtl>
          </div>
        );
      })}
    </div>
  );
}

// ── Model detail ──────────────────────────────────────────────────────────────

const DEEPSEEK_COMPAT = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
} as const;

function hasDeepseekCompat(model: ModelEntry): boolean {
  return model.compat?.thinkingFormat === "deepseek";
}

function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) {
    return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } };
  }
  if (!model.compat) return model;
  const rest = { ...model.compat };
  delete rest.thinkingFormat;
  delete rest.requiresReasoningContentOnAssistantMessages;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

// Compat can be configured at the provider or model level; provider-composer
// merges them (model wins) at runtime. The UI reads the effective value so
// hand-edited models.json settings are reflected correctly, while toggles
// write to the model entry so a per-model override is explicit.
function effectiveCompat(provider: ProviderEntry, model: ModelEntry): Record<string, unknown> {
  return { ...(provider.compat ?? {}), ...(model.compat ?? {}) };
}

// Editable key/value request-header list for a provider or model. Rows stay
// local so a blank draft is never persisted as an invalid HTTP header name.
/**
 * fork:models-presets — 数值快填 + 与后端目录的一致/覆盖标记。
 *
 * 目录值只在本次编辑真正查过目录时才知道，所以没有推荐值时就只显示阶梯、不假装知道
 * 「跟随目录」是什么。`contextWindowSource` 那种「来源」字段不写进 models.json —— pi 的
 * ModelDefinitionSchema 没有这个键，写进去会被忽略，属于假功能。
 */
const CONTEXT_WINDOW_LADDER = [128_000, 256_000, 512_000, 1_000_000] as const;
const MAX_OUTPUT_LADDER = [4_096, 8_192, 16_384, 32_768, 65_536] as const;

function formatTokenLimit(value: number): string {
  if (value >= 1_000_000) return `${value / 1_000_000}M`;
  return `${Math.round(value / 1_000)}k`;
}

function LimitChips({ value, ladder, catalogValue, ariaLabel, onChange }: {
  value: number | undefined;
  ladder: readonly number[];
  catalogValue: number | undefined;
  ariaLabel: string;
  onChange: (next: number | undefined) => void;
}) {
  const { t } = useI18n();
  const followsCatalog = catalogValue !== undefined && value === catalogValue;
  /* fork:design-system —— 快捷档位就是画板的 radio 芯片（`.pw-radio > button`）：
     单选、选中态 accent，自绘 chip 的边框/圆角/字号全部退役。
     原始数值留在芯片的 title 上（PwRadioOption.title）。 */
  const options: PwRadioOption<string>[] = ladder.map((preset) => ({
    value: String(preset),
    label: formatTokenLimit(preset),
    title: String(preset),
  }));
  if (catalogValue !== undefined) {
    options.push({
      value: String(catalogValue),
      label: followsCatalog ? t("models.followingCatalog") : t("models.followCatalog"),
      title: `${t("models.followCatalog")} ${catalogValue}`,
    });
  }
  return (
    <>
      <PwRadio
        value={value !== undefined ? String(value) : ""}
        options={options}
        ariaLabel={ariaLabel}
        onChange={(next) => onChange(Number(next))}
      />
      {catalogValue !== undefined && value !== undefined && !followsCatalog && (
        <span className="pw-mono pw-dim">{t("models.overridden")}</span>
      )}
    </>
  );
}

/**
 * fork:models-presets — `samplingParams` 是 pi models.json 里真正的「高级参数」入口
 * （temperature / top_p / …，pi 会把它并进请求参数）。值类型不受限，所以用 JSON 而不是
 * 键值行：字符串化的数字会改掉类型。
 */
function SamplingParamsEditor({ value, onChange }: {
  value: Record<string, unknown> | undefined;
  onChange: (next: Record<string, unknown> | undefined) => void;
}) {
  const { t } = useI18n();
  const serialized = value ? JSON.stringify(value, null, 2) : "";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(serialized);
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    setEditing(false);
    if (!draft.trim()) {
      setError(null);
      if (value !== undefined) onChange(undefined);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(draft);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setError(t("models.samplingParamsInvalid"));
        return;
      }
      setError(null);
      onChange(parsed as Record<string, unknown>);
    } catch {
      setError(t("models.samplingParamsInvalid"));
    }
  };

  return (
    /* `.pw-textarea` 是画板的系统提示级 textarea（min-height 120）；这里是两行的
       JSON 参数编辑器，按内容收高，缩进需要 pre。 */
    <div className="pw-rowgap">
      <textarea
        value={editing ? draft : serialized}
        onFocus={() => { setDraft(serialized); setEditing(true); }}
        onChange={(event) => { setDraft(event.target.value); setError(null); }}
        onBlur={commit}
        rows={2}
        spellCheck={false}
        placeholder={'{ "temperature": 0.7 }'}
        aria-invalid={error !== null}
        className="pw-textarea"
        style={{ minHeight: 0, whiteSpace: "pre" }}
      />
      {error && <div role="alert" className="pw-alert">{error}</div>}
    </div>
  );
}

function HeaderListEditor({ headers, onChange }: {
  headers: Record<string, string> | undefined;
  onChange: (h: Record<string, string> | undefined) => void;
}) {
  const [rows, setRows] = useState<HeaderRow[]>(() => Object.entries(headers ?? {}).map(
    ([name, value], id) => ({ id, name, value }),
  ));
  const nextRowIdRef = useRef(rows.length);

  const applyRows = (next: HeaderRow[]): void => {
    setRows(next);
    onChange(serializeHeaderRows(next));
  };
  const setEntry = (id: number, changes: Partial<Pick<HeaderRow, "name" | "value">>): void => {
    applyRows(updateHeaderRow(rows, id, changes));
  };
  const removeEntry = (id: number): void => {
    applyRows(rows.filter((row) => row.id !== id));
  };
  const { t } = useI18n();
  return (
    <div className="pw-rowgap">
      {rows.map((row) => (
        <div key={row.id} className="pw-inline">
          <input value={row.name} onChange={(e) => setEntry(row.id, { name: e.target.value })}
            placeholder="Header-Name" className="pw-input pw-mono" style={FILL_ROW_INPUT} />
          <input value={row.value} onChange={(e) => setEntry(row.id, { value: e.target.value })}
            placeholder="value" className="pw-input pw-mono" style={FILL_ROW_INPUT} />
          <ConfigButton variant="danger" size="small" onClick={() => removeEntry(row.id)} aria-label={t("i18n.delete")}>
            <span className="pw-ico"><i data-ico="x" data-size="13"></i></span>
          </ConfigButton>
        </div>
      ))}
      <ConfigButton
        variant="ghost"
        size="small"
        onClick={() => setRows((current) => [
          ...current,
          { id: nextRowIdRef.current++, name: "", value: "" },
        ])}
      >
        <span className="pw-ico"><i data-ico="plus" data-size="13"></i></span>
        Add header
      </ConfigButton>
    </div>
  );
}

function fillEmptyModelFields(
  model: ModelEntry,
  preset: ModelCatalogPreset,
): { model: ModelEntry; appliedCount: number } {
  const next = { ...model };
  let appliedCount = 0;
  if (!model.name?.trim() && preset.name) {
    next.name = preset.name;
    appliedCount += 1;
  }
  if (model.reasoning === undefined && preset.reasoning === true) {
    next.reasoning = true;
    appliedCount += 1;
  }
  if (!model.input?.length && preset.input?.length) {
    next.input = [...preset.input];
    appliedCount += 1;
  }
  if (model.contextWindow === undefined && preset.contextWindow !== undefined) {
    next.contextWindow = preset.contextWindow;
    appliedCount += 1;
  }
  if (model.maxTokens === undefined && preset.maxTokens !== undefined) {
    next.maxTokens = preset.maxTokens;
    appliedCount += 1;
  }

  if (preset.cost) {
    const cost = { ...(model.cost ?? {}) };
    let filledCostCount = 0;
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      if (cost[key] === undefined && preset.cost[key] !== undefined) {
        cost[key] = preset.cost[key];
        filledCostCount += 1;
      }
    }
    const completeCost = parseCompleteModelCost(modelCostToDraft(cost));
    if (filledCostCount > 0 && completeCost) {
      next.cost = { ...cost, ...completeCost };
      appliedCount += filledCostCount;
    }
  }
  return { model: next, appliedCount };
}

/** 收藏星标改用画板 41 的 `pw-ico` + star（见侧栏模型行）；这里不再自绘 SVG。 */

function ModelDetail({
  providerName,
  provider,
  model,
  onChange,
  onDelete,
}: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
  onChange: (m: ModelEntry) => void;
  onDelete: () => void;
}) {
  const [testState, setTestState] = useState<ModelTestState>({ phase: "idle" });
  const { t } = useI18n();
  // fork:thinking-level-memory — 该模型上次实际生效（SDK clamp 之后）的思考档位。
  const [rememberedThinking, setRememberedThinking] = useState<string | null>(null);
  // D2-PR-21 — 运行时模型字段；缺失时退回编辑器里的声明（可能不准，所以只在有值时展示预览）。
  const [thinkingInputs, setThinkingInputs] = useState<ThinkingProfileInputs | null>(null);
  const thinkingMemoryKey = model.id ? `${providerName}/${model.id}` : null;
  useEffect(() => {
    if (!thinkingMemoryKey) {
      setRememberedThinking(null);
      return;
    }
    let cancelled = false;
    void fetch("/api/models")
      .then((res) => res.ok ? res.json() : null)
      .then((data: {
        thinkingLevelMemory?: Record<string, string>;
        thinkingInputs?: Record<string, ThinkingProfileInputs>;
      } | null) => {
        if (cancelled) return;
        setRememberedThinking(data?.thinkingLevelMemory?.[thinkingMemoryKey] ?? null);
        // fork:upstream-0.9.2-thinking-profile — D2-PR-21 — 运行时模型字段（models.json 里可能没写，内置模型尤其如此），
        // 用来把「每档实际发什么请求」算准；编辑中的 thinkingLevelMap 仍用编辑器里的值。
        setThinkingInputs(data?.thinkingInputs?.[thinkingMemoryKey] ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [thinkingMemoryKey]);
  const forgetRememberedThinking = useCallback(async () => {
    if (!thinkingMemoryKey) return;
    try {
      const res = await fetch("/api/thinking-level-memory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelKey: thinkingMemoryKey }),
      });
      if (res.ok) setRememberedThinking(null);
    } catch {
      // 取消失败不影响配置编辑，下次打开重试即可。
    }
  }, [thinkingMemoryKey]);
  const [catalogState, setCatalogState] = useState<ModelCatalogState>({ phase: "idle" });
  // fork:models-presets — the published values for *this* row, available only after its
  // own catalog lookup ran (`handleCatalogFill` queries by `model.id`, and `catalogState`
  // is per-ModelDetail). Until then the provenance marker stays silent instead of
  // guessing at a value we do not have.
  const catalogValue = catalogState.phase === "success" ? catalogState.recommendation.preset : undefined;
  const [costEditing, setCostEditing] = useState(false);
  const [costDraft, setCostDraft] = useState<ModelCostDraft>(() => modelCostToDraft(model.cost));
  const costDraftRef = useRef(costDraft);

  // fork:upstream-0.9.2-thinking-profile — D2-PR-21 — 「这一档实际会发什么」：字段取运行时模型（缺失时退回编辑器声明），
  // thinkingLevelMap 用**编辑器当前值**，所以改映射时这一列会立刻跟着变。
  const describeThinkingLevel = useMemo(() => {
    const fields: ThinkingModelFields = {
      provider: providerName,
      id: model.id || undefined,
      name: model.name,
      api: model.api ?? provider.api ?? thinkingInputs?.api,
      baseUrl: provider.baseUrl ?? thinkingInputs?.baseUrl,
      reasoning: model.reasoning ?? thinkingInputs?.reasoning,
      maxTokens: model.maxTokens ?? thinkingInputs?.maxTokens,
      compat: { ...(thinkingInputs?.compat ?? {}), ...effectiveCompat(provider, model) },
    };
    const map = model.thinkingLevelMap ?? {};
    return (level: string) => {
      const spec = describeThinkingRequestFromFields(fields, level, map);
      if (spec.kind === "invalid") return { text: null, invalid: spec.error };
      return { text: formatThinkingRequestParams(spec.params) };
    };
  }, [providerName, provider, model, thinkingInputs]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const catalogRequestIdRef = useRef(0);
  const catalogUndoRef = useRef<ModelEntry | null>(null);
  const costTemplateRef = useRef(model.cost);
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) => onChange({ ...model, [k]: v });
  const setCost = (key: ModelCostKey, value: string) => {
    const nextDraft = { ...costDraftRef.current, [key]: value };
    const completeCost = parseCompleteModelCost(nextDraft);
    const nextModel = { ...model };
    costDraftRef.current = nextDraft;
    setCostDraft(nextDraft);
    if (completeCost) {
      nextModel.cost = { ...(costTemplateRef.current ?? {}), ...completeCost };
      costTemplateRef.current = nextModel.cost;
    } else {
      delete nextModel.cost;
    }
    onChange(nextModel);
  };
  const toggleCostEditing = () => {
    if (costEditing) {
      setCostEditing(false);
      return;
    }
    costTemplateRef.current = model.cost;
    const nextDraft = modelCostToDraft(model.cost);
    costDraftRef.current = nextDraft;
    setCostDraft(nextDraft);
    setCostEditing(true);
  };
  const testSummary = (() => {
    if (testState.phase === "idle") return null;
     if (testState.phase === "testing") return t("i18n.testingModel");
    const meta = [
      testState.latencyMs !== undefined ? `${testState.latencyMs}ms` : null,
      testState.status !== undefined ? `HTTP ${testState.status}` : null,
    ].filter(Boolean);
    if (testState.phase === "success") {
       return [t("i18n.connected"), ...meta, testState.responseText || null].filter(Boolean).join(" · ");
    }
     return [t("i18n.failed"), ...meta, testState.message].filter(Boolean).join(" · ");
  })();

  useEffect(() => {
    setTestState({ phase: "idle" });
  }, [providerName, provider.baseUrl, provider.api, provider.apiKey, model.id, model.api]);

  useEffect(() => {
    catalogRequestIdRef.current += 1;
    setCatalogState({ phase: "idle" });
    catalogUndoRef.current = null;
  }, [providerName, provider.baseUrl, model.id]);

  const handleTest = useCallback(async () => {
    if (!model.id.trim() || testState.phase === "testing") return;
    setTestState({ phase: "testing" });
    try {
      const res = await fetch("/api/models-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName, provider, model }),
      });
      const d = await res.json() as {
        ok?: boolean;
        error?: string;
        latencyMs?: number;
        status?: number;
        responseText?: string;
      };
      if (!res.ok || !d.ok) {
        setTestState({
          phase: "error",
          message: d.error ?? `HTTP ${res.status}`,
          latencyMs: d.latencyMs,
          status: d.status,
        });
        return;
      }
      setTestState({
        phase: "success",
        latencyMs: d.latencyMs,
        status: d.status,
        responseText: d.responseText,
      });
    } catch (e) {
      setTestState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [model, provider, providerName, testState.phase]);

  const handleCatalogFill = useCallback(async () => {
    const query = model.id.trim();
    if (!query || catalogState.phase === "loading") return;
    const requestId = ++catalogRequestIdRef.current;
    setCatalogState({ phase: "loading" });
    try {
      const params = new URLSearchParams({ q: query, provider: providerName, limit: "50" });
      if (provider.baseUrl?.trim()) params.set("baseUrl", provider.baseUrl.trim());
      const res = await fetch(`/api/models-config/catalog?${params}`);
      const data = await res.json() as { recommendation?: ModelCatalogRecommendation; error?: string };
      if (requestId !== catalogRequestIdRef.current) return;
      if (!res.ok || data.error || !data.recommendation) {
        setCatalogState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      const filled = fillEmptyModelFields(model, data.recommendation.preset);
      if (filled.appliedCount > 0) {
        catalogUndoRef.current = model;
        onChange(filled.model);
      }
      setCostEditing(false);
      setCatalogState({
        phase: "success",
        recommendation: data.recommendation,
        appliedCount: filled.appliedCount,
      });
    } catch (error) {
      if (requestId !== catalogRequestIdRef.current) return;
      setCatalogState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [catalogState.phase, model, onChange, provider.baseUrl, providerName]);

  const undoCatalogFill = () => {
    const previous = catalogUndoRef.current;
    if (!previous) return;
    catalogUndoRef.current = null;
    onChange(previous);
    setCatalogState({ phase: "idle" });
  };

  const catalogResultSummary = (() => {
    if (catalogState.phase !== "success") return null;
    const { recommendation, appliedCount } = catalogState;
    const applied = appliedCount > 0
      ? t("models.catalogFilled", { count: appliedCount })
      : t("models.catalogNoEmptyFields");
    if (recommendation.price.status === "unreliable") {
      const price = recommendation.price.reason === "no-exact-match"
        ? t("models.catalogNoExactMatch")
        : t("models.catalogPriceUnreliable");
      return `${applied} · ${price}`;
    }
    const price = recommendation.price.method === "provider"
      ? t("models.catalogPriceProvider", { provider: recommendation.price.providerName ?? recommendation.price.providerId ?? providerName })
      : recommendation.price.method === "base-url"
        ? t("models.catalogPriceBaseUrl", { provider: recommendation.price.providerName ?? recommendation.price.providerId ?? providerName })
        : t("models.catalogPriceConsensus", {
            support: recommendation.price.support,
            total: recommendation.price.total,
          });
    return `${applied} · ${price}`;
  })();
  const catalogStatusText = catalogState.phase === "error"
    ? catalogState.message
    : catalogResultSummary;
  const catalogStatusColor = catalogState.phase === "error"
    ? "var(--danger)"
    : catalogState.phase === "success" && catalogState.recommendation.price.status === "unreliable"
      ? "var(--warning)"
      : "var(--text-dim)";
  const costFields = [
    { key: "input", label: t("models.costInput") },
    { key: "output", label: t("models.costOutput") },
    { key: "cacheRead", label: t("models.costCacheRead") },
    { key: "cacheWrite", label: t("models.costCacheWrite") },
  ] as const;
  const formatCost = (key: ModelCostKey): string => {
    const value = model.cost?.[key];
    return value === undefined ? t("models.notProvided") : `$${String(value)}`;
  };
  const remainingCompatKeys = new Set(Object.keys(model.compat ?? {}));
  let compatibilityOverrideCount = 0;
  if (hasDeepseekCompat(model)) {
    compatibilityOverrideCount += 1;
    remainingCompatKeys.delete("thinkingFormat");
    remainingCompatKeys.delete("requiresReasoningContentOnAssistantMessages");
  }
  if (Object.prototype.hasOwnProperty.call(model.compat ?? {}, "supportsDeveloperRole")) {
    compatibilityOverrideCount += 1;
    remainingCompatKeys.delete("supportsDeveloperRole");
  }
  compatibilityOverrideCount += remainingCompatKeys.size;
  const advancedSummaryParts = [
    model.api ? `API: ${model.api}` : null,
    Object.keys(model.headers ?? {}).length
      ? t("models.headersSummary", { count: Object.keys(model.headers ?? {}).length })
      : null,
    compatibilityOverrideCount
      ? t("models.compatSummary", { count: compatibilityOverrideCount })
      : null,
    Object.keys(model.thinkingLevelMap ?? {}).length
      ? t("models.thinkingSummary", { count: Object.keys(model.thinkingLevelMap ?? {}).length })
      : null,
  ].filter((part): part is string => Boolean(part));
  const advancedSummary = advancedSummaryParts.length
    ? advancedSummaryParts.join(" · ")
    : t("models.providerDefaults");

  /* fork:models-board —— 画板 41 的模型详情是三张 `.pw-detail`：
     ① 能力 / 规格 / 成本（可调参数）② 高级 ③ 测试连接。
     画板把规格画成只读等宽数字，这里保留真输入框 + 快捷档位 —— 参数要能改才是设置页。 */
  return (
    <ConfigDetailStack>
      <ConfigDetail>
        <ConfigDetailHeader>
          <ConfigDetailHeaderInfo>
            <ConfigDetailTitle>{model.name || model.id || t("i18n.newModel")}</ConfigDetailTitle>
            <ConfigBadge>{providerName}</ConfigBadge>
            {model.reasoning ? <ConfigBadge tone="accent">{t("models.badgePinnable")}</ConfigBadge> : null}
          </ConfigDetailHeaderInfo>
        </ConfigDetailHeader>

        <ConfigSectionTitle>{t("models.identity")}</ConfigSectionTitle>
        <div className="pw-grid2">
          <ConfigField label="ID *">
            <TextInput value={model.id} onChange={(v) => set("id", v)} placeholder="model-id" mono />
          </ConfigField>
          <ConfigField label="Name">
            <TextInput value={model.name ?? ""} onChange={(v) => set("name", v || undefined)} placeholder="Display name" />
          </ConfigField>
        </div>
        <ConfigDetailHeader>
          <ConfigButton
            size="small"
            variant="secondary"
            disabled={!model.id.trim() || catalogState.phase === "loading"}
            onClick={() => void handleCatalogFill()}
          >
            {catalogState.phase === "loading" ? t("models.catalogFilling") : t("models.catalogFill")}
          </ConfigButton>
          <span className="pw-grow" aria-hidden="true" />
          <a
            href="https://github.com/anomalyco/models.dev"
            target="_blank"
            rel="noreferrer"
            className="pw-hint"
          >
            {t("models.catalogSource")}
          </a>
        </ConfigDetailHeader>
        {catalogStatusText && (
          /* 状态色是运行时按「成功 / 不可靠 / 出错」算出来的。 */
          <div className="catalog-status" aria-live="polite" style={{ color: catalogStatusColor }}>
            <span title={catalogStatusText} className="catalog-status-text">{catalogStatusText}</span>
            {catalogUndoRef.current && (
              <button type="button" className="catalog-undo" onClick={undoCatalogFill}>
                {t("models.catalogUndo")}
              </button>
            )}
          </div>
        )}

        <ConfigSectionTitle>{t("models.capabilities")}</ConfigSectionTitle>
        <ConfigField label={t("models.reasoning")}>
          <ConfigSwitch
            checked={model.reasoning ?? false}
            label={t("models.reasoning")}
            onChange={(v) => set("reasoning", v || undefined)}
          />
        </ConfigField>
        <ConfigField label={t("models.imageInput")}>
          <ConfigSwitch
            checked={model.input?.includes("image") ?? false}
            label={t("models.imageInput")}
            onChange={(v) => set("input", v ? ["text", "image"] : undefined)}
          />
        </ConfigField>

        <ConfigSectionTitle>{t("models.specs")}</ConfigSectionTitle>
        <ConfigField label={t("models.contextWindow")}>
          <div className="pw-rowgap">
            <NumInput value={model.contextWindow !== undefined ? String(model.contextWindow) : ""}
              onChange={(v) => set("contextWindow", v ? parseInt(v) : undefined)} placeholder="128000" />
            <LimitChips
              value={model.contextWindow}
              ladder={CONTEXT_WINDOW_LADDER}
              catalogValue={catalogValue?.contextWindow}
              ariaLabel={t("models.contextWindow")}
              onChange={(next) => set("contextWindow", next)}
            />
          </div>
        </ConfigField>
        <ConfigField label={t("models.maxOutputTokens")}>
          <div className="pw-rowgap">
            <NumInput value={model.maxTokens !== undefined ? String(model.maxTokens) : ""}
              onChange={(v) => set("maxTokens", v ? parseInt(v) : undefined)} placeholder="16384" />
            <LimitChips
              value={model.maxTokens}
              ladder={MAX_OUTPUT_LADDER}
              catalogValue={catalogValue?.maxTokens}
              ariaLabel={t("models.maxOutputTokens")}
              onChange={(next) => set("maxTokens", next)}
            />
          </div>
        </ConfigField>
        {model.contextWindow !== undefined && model.maxTokens !== undefined && model.maxTokens > model.contextWindow && (
          <div role="alert" className="pw-alert">{t("models.maxTokensExceedsContext")}</div>
        )}

        <ConfigField label={t("models.samplingParams")} hint={t("models.samplingParamsHint")}>
          <SamplingParamsEditor value={model.samplingParams} onChange={(next) => set("samplingParams", next)} />
        </ConfigField>

        <ConfigSectionTitle>{t("models.costPerMillion")}</ConfigSectionTitle>
        {costEditing ? (
          <div className="pw-grid4">
            {costFields.map(({ key, label }) => (
              <ConfigField key={key} label={label}>
                <NumInput value={costDraft[key]} onChange={(v) => setCost(key, v)} placeholder="0" />
              </ConfigField>
            ))}
          </div>
        ) : (
          <ConfigStatGrid>
            {costFields.map(({ key, label }) => (
              <ConfigStat
                key={key}
                label={label}
                value={formatCost(key)}
                /* 没填的这一格：值本身就是「未提供」，再补一句一样的只会重复。 */
                hint={model.cost?.[key] === undefined ? null : t("models.costEditableHint")}
              />
            ))}
          </ConfigStatGrid>
        )}
        {costEditing && hasModelCostDraftValue(costDraft) && !parseCompleteModelCost(costDraft) && (
          /* 画板的状态文案只有 pw-dim 一档；这里是「填了一半」的警告语义色。 */
          <div aria-live="polite" className="pw-mono pw-dim" style={{ color: "var(--warning)" }}>{t("models.costAllRequired")}</div>
        )}
        <ConfigDetailHeader>
          <span className="pw-grow" aria-hidden="true" />
          <ConfigButton size="small" onClick={toggleCostEditing} aria-expanded={costEditing}>
            {costEditing ? t("models.finishEditingCosts") : t("models.editCosts")}
          </ConfigButton>
        </ConfigDetailHeader>
      </ConfigDetail>

      <ConfigDetail>
        <ConfigDetailHeader>
          <ConfigDetailTitle>{t("models.advancedTitle")}</ConfigDetailTitle>
          <span className="pw-grow" aria-hidden="true" />
          <ConfigButton
            size="small"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            aria-controls="model-advanced-settings"
          >
            {advancedOpen ? t("i18n.collapse") : t("i18n.expand")}
          </ConfigButton>
        </ConfigDetailHeader>
        <p className="pw-hint">{advancedSummary}</p>

        {advancedOpen && (
          <div id="model-advanced-settings">
            <ConfigField label={t("models.apiOverride")}>
              <Select value={model.api ?? ""} onChange={(v) => set("api", v || undefined)} options={API_OPTIONS} ariaLabel={t("models.apiOverride")} />
            </ConfigField>

            <ConfigField label={t("models.headers")} hint={t("models.headersHelp")}>
              <HeaderListEditor headers={model.headers} onChange={(headers) => set("headers", headers)} />
            </ConfigField>

            <ConfigSectionTitle>{t("models.compatibility")}</ConfigSectionTitle>
            <ConfigField label={t("models.deepSeekThinkingCompat")}>
              <ConfigSwitch
                checked={hasDeepseekCompat(model)}
                label={t("models.deepSeekThinkingCompat")}
                onChange={(v) => onChange(setDeepseekCompat(model, v))}
              />
            </ConfigField>
            <ConfigField label={t("models.developerRole")}>
              <ConfigSwitch
                checked={effectiveCompat(provider, model)["supportsDeveloperRole"] !== false}
                label={t("models.developerRole")}
                onChange={(v) => onChange(setCompatBool(model, "supportsDeveloperRole", v))}
              />
            </ConfigField>

            {model.reasoning && (
              <>
                <ConfigSectionTitle>{t("models.thinkingLevelMap")}</ConfigSectionTitle>
                {model.thinkingLevelMap && (
                  <ConfigDetailHeader>
                    <span className="pw-grow" aria-hidden="true" />
                    <ConfigButton size="small" variant="ghost" onClick={() => set("thinkingLevelMap", undefined)}>
                      {t("models.clearAll")}
                    </ConfigButton>
                  </ConfigDetailHeader>
                )}
                <ThinkingLevelMapEditor
                  value={model.thinkingLevelMap}
                  onChange={(v) => set("thinkingLevelMap", v)}
                  describeLevel={describeThinkingLevel}
                />
                <p className="pw-hint">{t("models.thinkingLevelMapHint")}</p>
                {rememberedThinking && (
                  <div className="models-thinking-memory">
                    <span>{t("models.lastUsedThinking")}: <strong>{rememberedThinking}</strong></span>
                    <ConfigButton size="small" variant="ghost" onClick={() => { void forgetRememberedThinking(); }}>
                      {t("models.forgetThinking")}
                    </ConfigButton>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </ConfigDetail>

      <ConfigDetail>
        <h3>{t("models.testConnection")}</h3>
        <ConfigDetailHeader>
          <ConfigButton
            variant="primary"
            size="small"
            onClick={handleTest}
            disabled={!model.id.trim() || testState.phase === "testing"}
          >
            <span className="pw-ico"><i data-ico="circle-play" data-size="13"></i></span>
            {testState.phase === "testing" ? t("i18n.checking") : t("models.sendTestRequest")}
          </ConfigButton>
          <span className="pw-grow" aria-hidden="true" />
          {testState.phase !== "idle" && (
            <ConfigBadge tone={testState.phase === "error" ? "bad" : testState.phase === "success" ? "ok" : undefined}>
              {testSummary}
            </ConfigBadge>
          )}
        </ConfigDetailHeader>

        {testState.phase === "success" && testState.responseText && (
          <pre className="models-test-echo">
            <span className="pw-tok-com">{t("i18n.connected")}</span>
            {`\n${testState.responseText}`}
          </pre>
        )}
        {testState.phase === "error" && (
          <div className="pw-alert">{testState.message}</div>
        )}

        <ConfigDetailHeader>
          <ConfigButton size="small" variant="ghost" disabled={testState.phase === "idle"} onClick={() => setTestState({ phase: "idle" })}>
            {t("models.clearTestResult")}
          </ConfigButton>
          <span className="pw-grow" aria-hidden="true" />
          <ConfigButton variant="danger" size="small" onClick={onDelete}>{t("models.deleteModel")}</ConfigButton>
        </ConfigDetailHeader>
      </ConfigDetail>
    </ConfigDetailStack>
  );
}

// ── OAuth detail ──────────────────────────────────────────────────────────────

function OAuthDetail({ provider, onRefresh, enabledModels }: {
  provider: OAuthProvider; onRefresh: () => void; enabledModels: EnabledModelsController;
}) {
  const [loginState, setLoginState] = useState<OAuthLoginState>({ phase: "idle" });
  const { t } = useI18n();
  const [inputValue, setInputValue] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loginState.phase === "auth" || loginState.phase === "prompt") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loginState.phase]);

  // Reset state when provider changes
  useEffect(() => {
    setLoginState({ phase: "idle" });
    setInputValue("");
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, [provider.id]);

  useEffect(() => {
    return () => { eventSourceRef.current?.close(); };
  }, []);

  const handleLogin = useCallback(() => {
    eventSourceRef.current?.close();
    setLoginState({ phase: "connecting" });
    setInputValue("");

    const es = new EventSource(`/api/auth/login/${encodeURIComponent(provider.id)}`);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as {
        type: string; url?: string; instructions?: string | null;
        token?: string; message?: string; placeholder?: string | null;
        userCode?: string; verificationUri?: string; intervalSeconds?: number | null; expiresInSeconds?: number | null;
        options?: { id: string; label: string }[];
      };
      if (data.type === "auth") {
        setLoginState({ phase: "auth", url: data.url!, instructions: data.instructions ?? null, token: data.token! });
        window.open(data.url!, "_blank", "noopener,noreferrer");
      } else if (data.type === "device_code") {
        setLoginState({
          phase: "device_code",
          userCode: data.userCode!,
          verificationUri: data.verificationUri!,
          intervalSeconds: data.intervalSeconds ?? null,
          expiresInSeconds: data.expiresInSeconds ?? null,
        });
        window.open(data.verificationUri!, "_blank", "noopener,noreferrer");
      } else if (data.type === "prompt_request") {
        setLoginState({ phase: "prompt", message: data.message!, placeholder: data.placeholder ?? null, token: data.token! });
      } else if (data.type === "select_request") {
        setLoginState({ phase: "select", message: data.message!, options: data.options ?? [], token: data.token! });
      } else if (data.type === "progress") {
        setLoginState({ phase: "progress", message: data.message! });
      } else if (data.type === "success") {
        es.close();
        setLoginState({ phase: "success" });
        onRefresh();
      } else if (data.type === "error") {
        es.close();
        setLoginState({ phase: "error", message: data.message! });
      } else if (data.type === "cancelled") {
        es.close();
        setLoginState({ phase: "idle" });
      }
    };
    es.onerror = () => {
      es.close();
      setLoginState((prev) => prev.phase === "success" ? prev : { phase: "error", message: "Connection lost" });
    };
  }, [provider.id, onRefresh]);

  const handleLogout = useCallback(async () => {
    await fetch(`/api/auth/logout/${encodeURIComponent(provider.id)}`, { method: "POST" });
    setLoginState({ phase: "idle" });
    onRefresh();
  }, [provider.id, onRefresh]);

  const submitCode = useCallback(async (token: string, code: string) => {
    if (!code.trim()) return;
    setLoginState({ phase: "progress", message: "Verifying…" });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: code.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? `Server error ${res.status}` });
        return;
      }
      setInputValue("");
      // Success path: SSE stream will emit "success" and update state
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : "Network error" });
    }
  }, [provider.id]);

  const submitSelection = useCallback(async (token: string, value: string) => {
    setLoginState({ phase: "progress", message: "Continuing…" });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? `Server error ${res.status}` });
      }
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : "Network error" });
    }
  }, [provider.id]);

  const isWorking = loginState.phase === "connecting" || loginState.phase === "progress" ||
    loginState.phase === "auth" || loginState.phase === "device_code" ||
    loginState.phase === "prompt" || loginState.phase === "select";

  /* fork:models-board —— 与画板 41 一致：右列是一列独立的 `.pw-detail` 卡
     （登录 / 用量 / 可用模型），不是一张撑满高度的巨卡。 */
  return (
    <ConfigDetailStack>
      <ConfigDetail>
      <ConfigDetailHeader>
        <ConfigDetailHeaderInfo>
          <ProviderIcon id={provider.id} size={22} />
          <ConfigDetailTitle>{provider.name}</ConfigDetailTitle>
          <ConfigBadge tone={provider.loggedIn ? "ok" : undefined}>
            {provider.loggedIn ? t("models.badgeLoggedIn") : t("models.badgeNotLoggedIn")}
          </ConfigBadge>
        </ConfigDetailHeaderInfo>
        <ConfigDetailActions>
          {/* 登录态就是画板 41 头部的徽章（头卡左侧那枚 pw-badge ok 已给出），
              不再重复一个「圆点 + 文案」的自绘状态。 */}
          {isWorking ? (
            <ConfigButton
              size="small"
              onClick={() => { eventSourceRef.current?.close(); setLoginState({ phase: "idle" }); }}
            >
              {t("i18n.cancel")}
            </ConfigButton>
          ) : (
            <>
              <ConfigButton
                variant="primary"
                size="small"
                onClick={handleLogin}
              >
                 {provider.loggedIn ? t("i18n.relogin") : t("i18n.login")}
              </ConfigButton>
              {provider.loggedIn && (
                <ConfigButton
                  variant="danger"
                  size="small"
                  onClick={handleLogout}
                >
                   {t("i18n.disconnect")}
                </ConfigButton>
              )}
            </>
          )}
        </ConfigDetailActions>
      </ConfigDetailHeader>

      {/* Status */}
      {/* 运行时才确定的高度：已登录且空闲时不占位，其余流程给足一行。 */}
      <div style={{ minHeight: provider.loggedIn && loginState.phase === "idle" ? 0 : 48 }}>
        {loginState.phase === "idle" && (
          !provider.loggedIn && (
            /* 登录引导文案按画板的弱化等宽信息行（`pw-mono pw-dim`，画板 41 的
               「项目级只读…」同款）；p 的 UA 边距用 div 规避。 */
            <div className="pw-mono pw-dim">
              Connect your {provider.name} account.
            </div>
          )
        )}
        {loginState.phase === "connecting" && (
            <div className="pw-mono pw-dim">{t("i18n.openingBrowser")}</div>
        )}
        {loginState.phase === "select" && (
          <div className="pw-rowgap">
            <div className="pw-mono pw-dim">
              {loginState.message}
            </div>
            <div className="pw-list">
              {loginState.options.map((option) => (
                <ConfigSidebarItem
                  key={option.id}
                  onClick={() => submitSelection(loginState.token, option.id)}
                >
                  <span className="grow">
                    <ConfigSidebarText>{option.label}</ConfigSidebarText>
                  </span>
                </ConfigSidebarItem>
              ))}
            </div>
          </div>
        )}
        {(loginState.phase === "auth" || loginState.phase === "prompt") && (
          <div className="pw-rowgap">
            <div className="pw-mono pw-dim">
              {loginState.phase === "auth"
                ? "Complete sign-in in the browser, then copy the redirect URL from the address bar and paste it below."
                : loginState.message}
            </div>
            {loginState.phase === "auth" && (
              <div className="pw-mono pw-dim">
                If the browser window did not open,{" "}
                <a href={loginState.url} target="_blank" rel="noopener noreferrer" style={BREAKABLE_LINK}>
                  click here to open the login page
                </a>
                .
              </div>
            )}
            <div className="pw-inline">
              <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitCode(loginState.token, inputValue); }}
                placeholder={loginState.phase === "auth" ? "http://localhost:1455/auth/callback?code=…" : (loginState.placeholder ?? "Enter value…")}
                className="pw-input pw-mono"
                style={FILL_ROW_INPUT}
              />
              <ConfigButton
                variant="primary"
                onClick={() => submitCode(loginState.token, inputValue)}
                disabled={!inputValue.trim()}
              >
                 {t("i18n.submit")}
              </ConfigButton>
            </div>
          </div>
        )}
        {loginState.phase === "device_code" && (
          <div className="pw-rowgap">
            <div className="pw-mono pw-dim">
              Open the verification page and enter this code:
            </div>
            {/* 设备码 = 画板的等宽小件（`.pw-kbd`，画板 41 的 ⌘K 同款）。 */}
            <div><span className="pw-kbd">{loginState.userCode}</span></div>
            <div className="pw-mono pw-dim">
              <a href={loginState.verificationUri} target="_blank" rel="noopener noreferrer" style={BREAKABLE_LINK}>
                {loginState.verificationUri}
              </a>
              {loginState.expiresInSeconds ? ` Expires in ${Math.ceil(loginState.expiresInSeconds / 60)} minutes.` : ""}
            </div>
          </div>
        )}
        {loginState.phase === "progress" && (
          <div className="pw-mono pw-dim">{loginState.message}</div>
        )}
        {loginState.phase === "success" && (
          /* 画板 41 的成功徽章（check 图标 + ok 色）。 */
          <ConfigBadge tone="ok">
            <span className="pw-ico"><i data-ico="check" data-size="11"></i></span>
            {t("i18n.connectedSuccessfully")}
          </ConfigBadge>
        )}
        {loginState.phase === "error" && (
          /* 错误走画板的 `.pw-alert`。 */
          <div className="pw-alert">{loginState.message}</div>
        )}
      </div>
      </ConfigDetail>

    {/* fork:models-board —— 画板 41:101-109：「用量摘要」是**自己一张 `.pw-detail` 卡**
        （标题行 + 四张小卡），不是登录卡里的一段。原先它紧跟在登录表单后面，
        根节点 `<section class="pw-rowgap">` 顶着上一行、卡片 padding 也被它和
        stat 卡分成两组，看着像贴上去的药膏；成卡之后与「登录 / 可用模型」三张卡
        同底、同边线、同一组内距。
        行尾的「更新于 …」是元信息档（`.pw-mono pw-dim`，即 var(--text-meta)），
        由 `ProviderUsageSummary` 自己出（那个文件不在本次改动范围内）。
        没有用量能力的 provider 由 `isProviderUsageId` 挡掉，不发一张空卡。 */}
    {isProviderUsageId(provider.id) && (
      <ConfigDetail>
        <ProviderUsageSummary providerId={provider.id} enabled={provider.loggedIn} />
      </ConfigDetail>
    )}

    <ConfigDetail>
      {provider.loggedIn
        ? <EnabledModelsSection providerId={provider.id} controller={enabledModels} />
        : <p className="pw-hint">{t("models.signInToListModels")}</p>}
    </ConfigDetail>
    </ConfigDetailStack>
  );
}

// ── API Key detail ────────────────────────────────────────────────────────────

function ApiKeyDetail({ provider, onRefresh, enabledModels }: {
  provider: ApiKeyProvider; onRefresh: () => void; enabledModels: EnabledModelsController;
}) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const { t } = useI18n();

  // Reset state when provider changes
  useEffect(() => {
    setApiKey("");
    setError(null);
    setSavedOk(false);
  }, [provider.id]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setError(d.error ?? `HTTP ${res.status}`);
      } else {
        setApiKey("");
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        onRefresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [apiKey, provider.id, onRefresh]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) setError(d.error ?? `HTTP ${res.status}`);
      else onRefresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setRemoving(false);
    }
  }, [provider.id, onRefresh]);

  /* fork:models-board —— 与画板 41 一样，托管供应商的详情也是一列独立的
     `.pw-detail` 卡（登录 / 用量 / 可用模型），不再是一张撑满高度的巨卡。 */
  return (
    <ConfigDetailStack>
      <ConfigDetail>
      <ConfigDetailHeader>
        <ConfigDetailHeaderInfo>
          <ConfigDetailTitle>API Key</ConfigDetailTitle>
          <ConfigBadge tone={provider.configured ? "ok" : undefined}>
            {provider.configured ? t("i18n.configured") : t("i18n.notConfigured")}
          </ConfigBadge>
        </ConfigDetailHeaderInfo>
        <ConfigDetailActions>
          {provider.configured && (
            <ConfigButton
              variant="danger"
              size="small"
              onClick={handleRemove}
              disabled={removing}
            >
               {removing ? t("i18n.removing") : t("i18n.disconnect")}
            </ConfigButton>
          )}
        </ConfigDetailActions>
      </ConfigDetailHeader>

      {!provider.configured && (
        <p className="pw-hint">
          {t("models.apiKeyPrompt", { name: provider.displayName, count: provider.modelCount })}
        </p>
      )}
      <ConfigDetailHeader>
        {/* 行内填充（flex:1）走画板 41 搜索行的同款 inline 常量。 */}
        <SecretTextInput
          value={apiKey}
          onChange={setApiKey}
          onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) handleSave(); }}
          placeholder={provider.configured ? "Enter new key to replace…" : "sk-…"}
          style={FILL_ROW_INPUT}
          autoComplete="off"
          spellCheck={false}
          mono
        />
        <ConfigButton
          variant="primary"
          onClick={handleSave}
          disabled={saving || !apiKey.trim() || savedOk}
        >
          {savedOk ? t("i18n.saved") : saving ? t("i18n.saving") : t("i18n.save")}
        </ConfigButton>
      </ConfigDetailHeader>

      {error ? <div className="pw-alert">{error}</div> : null}
    </ConfigDetail>

    {/* 画板 41:101 —— 与 OAuthDetail 同理：用量摘要是自己一张 `.pw-detail` 卡，
        不挂在登录卡的末尾当一段（原因见上面那条注释）。 */}
    {isProviderUsageId(provider.id) && (
      <ConfigDetail>
        <ProviderUsageSummary providerId={provider.id} enabled={provider.configured} />
      </ConfigDetail>
    )}

    <ConfigDetail>
      {/* 标题行由 EnabledModelsSection 自己给（画板 41 的「可用模型」头），
          这里不要再补一个同名 h3，否则一块卡上会出现两遍同一个标题。 */}
      <EnabledModelsSection providerId={provider.id} controller={enabledModels} />
    </ConfigDetail>
    </ConfigDetailStack>
  );
}

// ── Add provider picker ───────────────────────────────────────────────────────

interface AddProviderPickerProps {
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  onSelectOAuth: (id: string) => void;
  onSelectApiKey: (id: string) => void;
  onAddCustom: () => void;
  onClose: () => void;
}

function AddProviderPicker({
  oauthProviders, apiKeyProviders,
  onSelectOAuth, onSelectApiKey, onAddCustom, onClose,
}: AddProviderPickerProps) {
  const [search, setSearch] = useState("");
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);

  const q = search.trim().toLowerCase();

  const availableOAuth = oauthProviders.filter((p) => !p.loggedIn && (!q || p.name.toLowerCase().includes(q)));
  const availableApiKey = apiKeyProviders.filter((p) => !p.configured && (!q || p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)));
  const showCustom = !q || "custom".includes(q) || "openai-compatible".includes(q) || "anthropic-compatible".includes(q);

  const totalCount = availableOAuth.length + availableApiKey.length + (showCustom ? 1 : 0);

  // fork:dsn-dialog-a11y — 这个自绘弹层原先只在容器上听 Escape，而 Escape 只有
  // 焦点恰好落在容器内部才触发；也没有任何焦点约束（Tab 能走到背景的侧栏/输入框）。
  // 现在交给共享 hook：打开移焦（优先搜索框）、Tab 循环、Esc 关闭、背景 inert、
  // 关闭后把焦点还给触发元素。外层的 onKeyDown 保留作为兜底。
  const { dialogRef, dialogProps } = useDialogA11y({ open: true, onClose, initialFocusRef: inputRef });

  /* fork:design-system —— 弹层换画板 50 的 `.pw-scrim` + `.pw-modal`，供应商列表
     换画板 41 的 `.pw-list` 行（pw-ico 图标 + pw-lname/pw-lsub），自绘卡片、
     hover JS、搜索图标 SVG 全部退役。覆盖层的 fixed/层级画板没有产品等价物
     （fork-ui 只给皮肤工作室接了线，z 顺序不能共用），保留这组行为 inline。 */
  return (
    <div
      ref={dialogRef}
      {...dialogProps}
      aria-label={t("models.title")}
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "var(--scrim)", display: "grid", placeItems: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="pw-modal">
        {/* Search —— 画板 41 搜索行的形态（pw-ico + pw-input 吃掉剩余宽度）。 */}
        <div className="pw-modal-head">
          <span className="pw-ico pw-dim"><i data-ico="search" data-size="14"></i></span>
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
             placeholder={t("i18n.searchProviders")}
            className="pw-input"
            style={FILL_ROW_INPUT}
          />
        </div>

        {/* List —— 画板 50 的 pw-modal 是内容定高的确认框；这个选择器是长列表，
            滚动上边界是产品行为，留在行内。 */}
        <div className="pw-modal-body" style={{ overflowY: "auto", maxHeight: "min(72vh, calc(100vh - 32px))" }}>
          {totalCount === 0 ? (
            <ConfigEmptyState>{t("i18n.noProviders")}</ConfigEmptyState>
          ) : (
            <div className="pw-list">
              {showCustom && <ConfigSidebarGroupLabel>{t("i18n.custom")}</ConfigSidebarGroupLabel>}
              {showCustom && (
                <ConfigSidebarItem
                  onClick={() => { onAddCustom(); onClose(); }}
                >
                  <span className="pw-ico"><i data-ico="plus" data-size="14"></i></span>
                  <span className="grow">
                    <ConfigSidebarText>OpenAI / Anthropic compatible</ConfigSidebarText>
                    <ConfigSidebarSub>{t("i18n.customEndpoint")}</ConfigSidebarSub>
                  </span>
                </ConfigSidebarItem>
              )}

              {availableOAuth.length > 0 && (
                <ConfigSidebarGroupLabel>{t("i18n.subscriptions")}</ConfigSidebarGroupLabel>
              )}
              {availableOAuth.map((p) => (
                <ConfigSidebarItem key={p.id} onClick={() => { onSelectOAuth(p.id); onClose(); }}>
                  <ProviderIcon id={p.id} size={16} />
                  <span className="grow">
                    <ConfigSidebarText>{p.name}</ConfigSidebarText>
                    <ConfigSidebarSub>OAuth</ConfigSidebarSub>
                  </span>
                </ConfigSidebarItem>
              ))}

              {availableApiKey.length > 0 && (
                <ConfigSidebarGroupLabel>API Key</ConfigSidebarGroupLabel>
              )}
              {availableApiKey.map((p) => (
                <ConfigSidebarItem key={p.id} onClick={() => { onSelectApiKey(p.id); onClose(); }}>
                  <ProviderIcon id={p.id} size={16} />
                  <span className="grow">
                    <ConfigSidebarText>{p.displayName}</ConfigSidebarText>
                    <ConfigSidebarSub>{p.modelCount} models</ConfigSidebarSub>
                  </span>
                </ConfigSidebarItem>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function ModelsConfig({ onClose, embedded = false, cwd = null }: {
  onClose: () => void; embedded?: boolean; cwd?: string | null;
}) {
  const { t } = useI18n();
  // `enabledModels` lives in pi's settings, not models.json, so these switches
  // apply immediately instead of waiting for this panel's Save button.
  const enabledModels = useEnabledModels(cwd);
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  /* fork:pr2-security（上游 499aa4f）—— models.json 读不出来时（带注释以外的语法
     错误、截断的写入…）**禁用保存**：面板保存的是整份 draft，而 draft 并不是从这
     个文件读出来的，一存就把用户所有 provider 覆盖没了。 */
  const [loadError, setLoadError] = useState<string | null>(null);
  // fork:builtin-models — 上次保存回传的内置模型覆盖警告。
  const [saveWarnings, setSaveWarnings] = useState<string[]>([]);
  const [selection, setSelection] = useState<Selection | null>(readRememberedSelection);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Provider ids as models.json has them on disk, and where renames moved them. */
  const savedProvidersRef = useRef<Set<string>>(new Set());
  const renamesRef = useRef<Map<string, string>>(new Map());
  /**
   * Per provider, the model id saved at each slot, or null for a model added
   * since. Mirroring the draft's array moves is what lets a save tell a rename
   * from an unrelated edit without guessing.
   */
  const savedModelIdsRef = useRef<Map<string, (string | null)[]>>(new Map());
  // fork:pr17-favorites — 与输入框模型选择器共用同一个收藏 store。
  const favoriteModels = useSyncExternalStore(subscribeFavoriteModels, getFavoriteModelsSnapshot, getFavoriteModelsServerSnapshot);

  const refreshAuthProviders = useCallback(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((d: { oauthProviders?: OAuthProvider[]; apiKeyProviders?: ApiKeyProvider[] }) => {
        if (Array.isArray(d.oauthProviders)) setOauthProviders(d.oauthProviders);
        if (Array.isArray(d.apiKeyProviders)) setApiKeyProviders(d.apiKeyProviders);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/models-config")
      .then(async (r) => {
        const d = await r.json() as ModelsJson & { error?: string };
        // 422（读不出 models.json）不是一个空配置：当成空配置渲染会把「保存」变成
        // 「清空所有 provider」。
        if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`);
        return d;
      })
      .then((d) => {
        const normalized = d.providers ? d : { ...d, providers: {} };
        setConfig(normalized);
        savedProvidersRef.current = new Set(Object.keys(normalized.providers ?? {}));
        savedModelIdsRef.current = savedModelIds(normalized);
        const keys = Object.keys(normalized.providers ?? {});
        setSelection((current) => current && customSelectionExists(normalized, current)
          ? current
          : keys[0]
            ? { type: "provider", name: keys[0] }
            : null);
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    refreshAuthProviders();
  }, [refreshAuthProviders]);

  useEffect(() => {
    if (selection) setLastSettingsSelection("models", JSON.stringify(selection));
  }, [selection]);

  const addCustomProvider = useCallback(() => {
    let finalName = "new-provider";
    let n = 1;
    while (config.providers?.[finalName]) finalName = `new-provider-${n++}`;
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [finalName]: { api: "openai-completions" } } }));
    setSelection({ type: "provider", name: finalName });
  }, [config.providers]);

  const updateProvider = useCallback((name: string, p: ProviderEntry) => {
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [name]: p } }));
  }, []);

  const renameProvider = useCallback((oldName: string, newName: string) => {
    // Remember where each saved provider ended up, so the enabledModels entries
    // can follow it on save instead of pointing at an id that no longer exists.
    const renames = renamesRef.current;
    let original = oldName;
    for (const [from, to] of renames) {
      if (to !== oldName) continue;
      original = from;
      break;
    }
    if (original === newName) renames.delete(original);
    else if (savedProvidersRef.current.has(original)) renames.set(original, newName);
    const slots = savedModelIdsRef.current.get(oldName);
    if (slots) {
      savedModelIdsRef.current.delete(oldName);
      savedModelIdsRef.current.set(newName, slots);
    }
    setConfig((prev) => {
      const entries = Object.entries(prev.providers ?? {});
      const idx = entries.findIndex(([k]) => k === oldName);
      if (idx === -1) return prev;
      entries[idx] = [newName, entries[idx][1]];
      return { ...prev, providers: Object.fromEntries(entries) };
    });
    setSelection((prev) => {
      if (!prev) return prev;
      if (prev.type === "provider" && prev.name === oldName) return { type: "provider", name: newName };
      if (prev.type === "model" && prev.providerName === oldName) return { ...prev, providerName: newName };
      return prev;
    });
  }, []);

  const deleteProvider = useCallback((name: string) => {
    savedModelIdsRef.current.delete(name);
    setConfig((prev) => {
      const providers = { ...(prev.providers ?? {}) };
      delete providers[name];
      return { ...prev, providers };
    });
    setConfig((prev) => {
      const remaining = Object.keys(prev.providers ?? {});
      setSelection(remaining.length > 0 ? { type: "provider", name: remaining[0] } : null);
      return prev;
    });
  }, []);

  const addModel = useCallback((providerName: string) => {
    trackAddedModels(savedModelIdsRef.current, providerName, 1);
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? []), { id: "" }];
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
    setConfig((prev) => {
      const idx = (prev.providers?.[providerName]?.models?.length ?? 1) - 1;
      setSelection({ type: "model", providerName, index: idx });
      return prev;
    });
  }, []);

  const addDiscoveredModels = useCallback((providerName: string, discovered: DiscoveredModel[]) => {
    setConfig((prev) => {
      const known = new Set((prev.providers?.[providerName]?.models ?? []).map((model) => model.id));
      trackAddedModels(
        savedModelIdsRef.current,
        providerName,
        discovered.filter((model) => !known.has(model.id)).length,
      );
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      const existingIds = new Set(models.map((model) => model.id));
      for (const discoveredModel of discovered) {
        if (existingIds.has(discoveredModel.id)) continue;
        existingIds.add(discoveredModel.id);
        models.push({ id: discoveredModel.id, name: discoveredModel.name });
      }
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, []);

  const updateModel = useCallback((providerName: string, index: number, m: ModelEntry) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models[index] = m;
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, []);

  const removeModel = useCallback((providerName: string, index: number) => {
    savedModelIdsRef.current.get(providerName)?.splice(index, 1);
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models.splice(index, 1);
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models: models.length ? models : undefined } } };
    });
    setSelection({ type: "provider", name: providerName });
  }, []);

  const handleSave = useCallback(async () => {
    if (loadError) return;
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      const res = await fetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const d = await res.json() as { success?: boolean; error?: string; warnings?: string[] };
      if (!res.ok || d.error) setSaveError(d.error ?? `HTTP ${res.status}`);
      else {
        // fork:builtin-models — 保存后回传“覆盖了内置定义”的模型：provider-composer
        // 对 models[] 是整条替换，同名条目会丢掉内置的 thinkingLevelMap / compat。
        setSaveWarnings(d.warnings ?? []);
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        // models.json just changed under the switches: providers may have been
        // renamed, models added, deleted or renamed. Re-verify the stored
        // patterns against the new catalog and re-read.
        const renames = [...renamesRef.current].map(([from, to]) => ({ from, to }));
        const modelRenames = collectModelRenames(config, savedModelIdsRef.current, renamesRef.current);
        savedProvidersRef.current = new Set(Object.keys(config.providers ?? {}));
        savedModelIdsRef.current = savedModelIds(config);
        renamesRef.current.clear();
        enabledModels.resync(renames, modelRenames);
      }
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [config, enabledModels, loadError]);

  // `12/40` next to a provider makes a narrowed selector visible at a glance.
  const scopeBadge = (providerId: string) => {
    const label = providerBadgeLabel(enabledModels.view, providerId);
    return label ? <span className="models-sidebar-badge">{label}</span> : null;
  };
  const activeOAuth = oauthProviders.filter((p) => p.loggedIn);
  const activeApiKey = apiKeyProviders.filter((p) => p.configured);
  // models.json entries for a managed (OAuth / API-key) provider are an overlay
  // the runtime already composes — showing them again under "custom providers"
  // would list opencode-go twice. Hide them here; the API-key detail already
  // has EnabledModelsSection for the full merged list.
  const managedProviderIds = new Set([
    ...activeOAuth.map((p) => p.id),
    ...activeApiKey.map((p) => p.id),
  ]);
  const providers = Object.entries(config.providers ?? {})
    .filter(([providerId]) => !managedProviderIds.has(providerId));

  /* fork:models-board —— 左列表按画板 41 分「订阅 / 自定义」两组，并支持按名字过滤。
     过滤是纯本地的：切分组不应该重新拉 `/api/models-config`。 */
  const [providerFilter, setProviderFilter] = useState("");
  const needle = providerFilter.trim().toLocaleLowerCase();
  const nameMatches = (...candidates: (string | undefined)[]) =>
    !needle || candidates.some((value) => value?.toLocaleLowerCase().includes(needle));
  const managedProviders = [...activeOAuth.map((p) => ({ id: p.id, name: p.name })), ...activeApiKey];
  const visibleOAuth = activeOAuth.filter((p) => nameMatches(p.name, p.id));
  const visibleApiKey = activeApiKey.filter((p) => nameMatches(p.displayName, p.id));
  const visibleProviders = providers.filter(([providerId, entry]) => nameMatches(providerId, entry.baseUrl));
  /* fork:settings-frame（画板 62 帧 D）—— 列表列要区分「加载中 / 空 / 有行」三态，
     空态（过滤无结果或一个供应商都没有）不再静默留白。 */
  const hasVisibleRows = visibleOAuth.length + visibleApiKey.length + visibleProviders.length > 0;

  // Resolve current detail
  const detailContent = (() => {
    if (!selection) return null;
    if (selection.type === "oauth") {
      const p = oauthProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return <OAuthDetail key={p.id} provider={p} onRefresh={refreshAuthProviders} enabledModels={enabledModels} />;
    }
    if (selection.type === "apikey") {
      const p = apiKeyProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return <ApiKeyDetail key={p.id} provider={p} onRefresh={refreshAuthProviders} enabledModels={enabledModels} />;
    }
    if (selection.type === "provider") {
      const provider = config.providers?.[selection.name];
      if (!provider) return null;
      return (
        <ProviderDetail
          key={selection.name}
          name={selection.name}
          provider={provider}
          onChange={(p) => updateProvider(selection.name, p)}
          onRename={(n) => renameProvider(selection.name, n)}
          onDelete={() => deleteProvider(selection.name)}
          onAddModels={(models) => addDiscoveredModels(selection.name, models)}
          enabledModels={enabledModels}
          onOpenModel={(index) => setSelection({ type: "model", providerName: selection.name, index })}
          onAddModel={() => addModel(selection.name)}
          onPrune={enabledModels.pruneStale}
        />
      );
    }
    const provider = config.providers?.[selection.providerName];
    const model = provider?.models?.[selection.index];
    if (!model) return null;
    return (
      <ModelDetail
        key={`${selection.providerName}-${selection.index}`}
        providerName={selection.providerName}
        provider={provider}
        model={model}
        onChange={(m) => updateModel(selection.providerName, selection.index, m)}
        onDelete={() => removeModel(selection.providerName, selection.index)}
      />
    );
  })();

  return (
    <>
    <ConfigPanelShell embedded={embedded} title={t("common.models")} subtitle="~/.pi/agent/models.json" closeLabel={t("i18n.close")} onClose={onClose}>
      {/* fork:settings-frame（画板 62）—— 模型页的三件套。
          「保存」的位置按**画板 41 的 DOM**（模型页专属画板）裁定：那一帧的
          `.pw-shead-acts` 里就是「添加供应商 outline + 保存 primary」两个页级动作。
          62 落位表虽写「表单级→连接块底部」，但本页的保存对象是**整份 models.json**
          （列表列、详情卡、连接表单都在改），不是连接表单自己的表单级动作 ——
          41 的明确形态优先，且页头动作始终可见，不会像旧版那样浮在视口右下角、
          与它保存的表单完全脱开（未选中供应商时右列整片空白，按钮还孤零零挂着）。 */}
      <SettingsPage
        title={t("common.models")}
        sub={t("models.pageSub")}
        actions={
          <>
            <ConfigButton variant="secondary" size="small" onClick={() => setPickerOpen(true)}>
              <span className="pw-ico"><i data-ico="plus" data-size="13" aria-hidden="true" /></span>
              {t("models.addProvider")}
            </ConfigButton>
            <ConfigButton
              variant="primary"
              size="small"
              onClick={handleSave}
              disabled={saving || savedOk || loadError !== null}
              className={savedOk ? "is-success" : undefined}
            >
              {savedOk && (
                /* 保存成功的对勾收编为画板图标（`pw-ico` + data-ico=check）；
                   settings.css 的 .config-button-success-icon 继续提供描画动画。 */
                <span className="config-button-success-icon pw-ico">
                  <i data-ico="check" data-size="14"></i>
                </span>
              )}
              <span>{savedOk ? t("i18n.saved") : saving ? t("i18n.saving") : t("i18n.save")}</span>
            </ConfigButton>
          </>
        }
        toolbar={
          <>
            <PwSearch
              value={providerFilter}
              placeholder={t("models.searchProviders")}
              ariaLabel={t("models.searchProviders")}
              onChange={setProviderFilter}
            />
            <span className="pw-grow" aria-hidden="true" />
            {loadError || saveError || saveWarnings.length > 0 ? (
              <span style={{ color: loadError || saveError ? "var(--error)" : "var(--warning)" }}>
                {loadError
                  ? t("models.configUnreadable", { error: loadError })
                  : saveError ?? t("models.builtinOverrideWarning", { models: saveWarnings.join(", ") })}
              </span>
            ) : null}
            <ConfigBadge tone="count">{t("models.providerCount", { count: String(visibleOAuth.length + visibleApiKey.length + visibleProviders.length) })}</ConfigBadge>
          </>
        }
        fill
      >
        <EnabledModelsBanner controller={enabledModels} />

        {/* Body */}
        <ConfigSplitView>

          {/* Left: provider list（画板 62：搜索与「添加供应商」都提到页头/工具栏，
              列表列只留列表本身） */}
          <ConfigSidebar>
            <ConfigSidebarList>
              {loading ? (
                <p className="pw-hint">{t("i18n.loading")}</p>
              ) : loadError ? (
                /* 读不出 models.json ≠ 库是空的：空态那句「还没有供应商」会把用户
                   引去「添加供应商」，而保存已被禁用（见页头）。只报现状。 */
                <p className="pw-hint">{t("models.listUnreadable")}</p>
              ) : !hasVisibleRows ? (
                /* fork:settings-frame（画板 62 帧 D）—— 「列表空」落在**列表列内**：
                   方框图标 + 一句，不折行；过滤无结果与「一个供应商都没有」都不再
                   静默留白。「先加供应商」的入口常驻页头右端（画板 41 的页级动作），
                   空态本体只负责点名现状：有过滤词是选择器同款「没有匹配的
                   Provider」；空库用 models.listEmpty + listEmptyHint 第二句。 */
                <ConfigEmptyState>
                  <span className="mark"><i data-ico="server" data-size="16" aria-hidden="true" /></span>
                  <p>{needle ? t("i18n.noProviders") : t("models.listEmpty")}</p>
                  {!needle && <p className="pw-hint">{t("models.listEmptyHint")}</p>}
                </ConfigEmptyState>
              ) : (
                <>
              {managedProviders.length > 0 && (
                <ConfigSidebarGroupLabel>{t("models.groupSubscription")}</ConfigSidebarGroupLabel>
              )}
              {/* Active OAuth subscriptions */}
              {visibleOAuth.map((p) => {
                const isSelected = selection?.type === "oauth" && selection.providerId === p.id;
                return (
                  <ConfigSidebarItem
                    key={p.id}
                    active={isSelected}
                    onClick={() => setSelection({ type: "oauth", providerId: p.id })}
                  >
                    <ProviderIcon id={p.id} size={16} />
                    <span className="grow">
                      <ConfigSidebarText>{p.name}</ConfigSidebarText>
                      <ConfigSidebarSub>{t("models.modelsCount", {
                        count: findProviderView(enabledModels.view, p.id)?.models.length ?? 0,
                        enabled: findProviderView(enabledModels.view, p.id)?.enabledCount ?? 0,
                      })}</ConfigSidebarSub>
                    </span>
                    <ConfigBadge tone="ok">{t("models.badgeLoggedIn")}</ConfigBadge>
                  </ConfigSidebarItem>
                );
              })}

              {/* Active API key providers */}
              {visibleApiKey.map((p) => {
                const isSelected = selection?.type === "apikey" && selection.providerId === p.id;
                return (
                  <ConfigSidebarItem
                    key={p.id}
                    active={isSelected}
                    onClick={() => setSelection({ type: "apikey", providerId: p.id })}
                  >
                    <ProviderIcon id={p.id} size={16} />
                    <span className="grow">
                      <ConfigSidebarText>{p.displayName}</ConfigSidebarText>
                      <ConfigSidebarSub>{t("models.modelsCount", {
                        count: findProviderView(enabledModels.view, p.id)?.models.length ?? 0,
                        enabled: findProviderView(enabledModels.view, p.id)?.enabledCount ?? 0,
                      })}</ConfigSidebarSub>
                    </span>
                    <ConfigBadge tone="ok">{t("models.badgeLoggedIn")}</ConfigBadge>
                  </ConfigSidebarItem>
                );
              })}

              {/* Custom providers */}
              {visibleProviders.length > 0 && (
                <ConfigSidebarGroupLabel>{t("models.groupCustom")}</ConfigSidebarGroupLabel>
              )}
              {visibleProviders.map(([pName, pData]) => {
                const isProviderSelected = selection?.type === "provider" && selection.name === pName;
                const models = pData.models ?? [];
                /* Fragment 让 provider 行 / 模型行 / 添加行都是 `.pw-list` 的直接
                   网格项，行距由 pw-list 统一给，不再包一层补 margin 的 div。 */
                return (
                  <Fragment key={pName}>
                    {/* Provider row */}
                    <ConfigSidebarItem
                      onClick={() => setSelection({ type: "provider", name: pName })}
                      active={isProviderSelected}
                    >
                      <ProviderIcon id={pName} size={16} />
                      <span className="grow">
                        <ConfigSidebarText>{pName}</ConfigSidebarText>
                        <ConfigSidebarSub>
                          {pData.baseUrl || t("models.modelsCount", { count: models.length, enabled: 0 })}
                        </ConfigSidebarSub>
                      </span>
                      {scopeBadge(pName)}
                    </ConfigSidebarItem>

                    {/* Model rows */}
                    {models.map((m, i) => {
                      const isModelSelected = selection?.type === "model" && selection.providerName === pName && selection.index === i;
                      // fork:pr17-favorites — 与输入框选择器共用 store；空 id 的新模型不参与收藏。
                      const favoriteKey = m.id ? favoriteModelKey(pName, m.id) : null;
                      const isFavorite = favoriteKey !== null && favoriteModels.has(favoriteKey);
                      return (
                        <ConfigSidebarItem
                          key={i}
                          active={isModelSelected}
                          className="models-sidebar-indented-item"
                          onClick={() => setSelection({ type: "model", providerName: pName, index: i })}
                        >
                          {/* fork:models-board —— 名字包 `.grow`，思考档徽章与收藏星
                              因此贴到行右缘（board.css:858 `.pw-litem .grow{flex:1}`）。
                              依据：画板 41:74 的供应商行是
                              `<span class="grow">…</span>` + 行尾星标，画板 02:41/68-71
                              的 `.pw-row` 同样是「图标 + 名称 + grow + 右侧动作」。
                              少了这层 `.grow`，星标会紧贴模型 id 顶在左边、右侧空一大片 ——
                              与上面那一行供应商、以及右列「可用模型」卡都不齐。 */}
                          <span className="grow">
                            <ConfigSidebarText className={m.id ? undefined : "pw-dim"}>
                               {m.id || t("i18n.newModel")}
                            </ConfigSidebarText>
                          </span>
                          {m.reasoning && (
                            <ConfigBadge tone="accent">T</ConfigBadge>
                          )}
                          {/* fork:fix-nested-button — 收藏星**不能**是真 `<button>`：行本体
                              `ConfigSidebarItem` 渲染的就是 `<button class="pw-litem">`
                              （components/SettingsUi.tsx，那个文件不能动），而 HTML 解析器
                              遇到嵌套 `<button>` 会把里层的**提前闭合并提到外面** ——
                              SSR 出来的树和客户端渲染的树对不上，于是控制台常驻
                              `In HTML, <button> cannot be a descendant of <button>`、
                              开发态右下角常驻 1 Issue、整棵子树客户端重绘。
                              改用本仓既有写法（components/ModelSelector.tsx 的行内星标、
                              components/ProcessGroup.tsx 的 file chip，补丁 0019）：
                              `span[role=button] tabIndex=0` + Enter/Space 键盘处理。
                              `<span>` 不会被解析器搬走 → 服务端/客户端树一致，无 hydration 报错；
                              `[role=button]` 命中 app/globals.css 的全局 focus-visible 描边。 */}
                          <span
                            role="button"
                            className="pw-iconbtn sm"
                            tabIndex={favoriteKey ? 0 : -1}
                            aria-disabled={!favoriteKey}
                            aria-pressed={isFavorite}
                            aria-label={isFavorite ? t("models.unfavoriteModel") : t("models.favoriteModel")}
                            title={isFavorite ? t("models.unfavoriteModel") : t("models.favoriteModel")}
                            onClick={(event) => {
                              // stopPropagation：不能让星星的点击带发行选中。
                              event.stopPropagation();
                              if (favoriteKey) toggleFavoriteModelKey(favoriteKey);
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return;
                              // Space 否则会滚动侧栏，Enter 无所谓，都要拦下。
                              event.preventDefault();
                              event.stopPropagation();
                              if (favoriteKey) toggleFavoriteModelKey(favoriteKey);
                            }}
                          >
                            <span
                              className="pw-ico"
                              style={{ color: isFavorite ? "var(--accent)" : "var(--text-dim)", opacity: favoriteKey ? 1 : 0.35 }}
                            >
                              <i data-ico="star" data-size="13" aria-hidden="true"></i>
                            </span>
                          </span>
                        </ConfigSidebarItem>
                      );
                    })}

                    {/* Add model button */}
                    <ConfigSidebarItem
                      className="models-sidebar-indented-item models-sidebar-add-item"
                      onClick={(e) => { e.stopPropagation(); addModel(pName); }}
                    >
                       <ConfigSidebarText>+ {t("i18n.model")}</ConfigSidebarText>
                    </ConfigSidebarItem>
                  </Fragment>
                );
              })}
                </>
              )}
            </ConfigSidebarList>

          </ConfigSidebar>

          {/* Right: 画板 41 的右列是**一列独立的 `.pw-detail` 卡**（`ConfigDetailStack`），
              不再套一张撑满高度的巨卡 —— 那是「弹窗影子」的来源。 */}
          <ConfigDetailStack>
            {loading ? null : detailContent ?? (
              /* fork:settings-frame（画板 62 帧 D）—— 「详情未选」：40px 方框图标
                 （square-mouse-pointer）+ 一句引导，居中。替换旧版那句孤悬在详情列
                 宽度正中的裸文本「选择 Provider 或模型」。 */
              <ConfigEmptyState>
                <span className="mark"><i data-ico="square-mouse-pointer" data-size="16" aria-hidden="true" /></span>
                <p>{t("models.detailEmpty")}</p>
              </ConfigEmptyState>
            )}
          </ConfigDetailStack>
        </ConfigSplitView>
      </SettingsPage>
    </ConfigPanelShell>
    {pickerOpen && (
      <AddProviderPicker
        oauthProviders={oauthProviders}
        apiKeyProviders={apiKeyProviders}
        onSelectOAuth={(id) => setSelection({ type: "oauth", providerId: id })}
        onSelectApiKey={(id) => setSelection({ type: "apikey", providerId: id })}
        onAddCustom={addCustomProvider}
        onClose={() => setPickerOpen(false)}
      />
    )}
    </>
  );
}
