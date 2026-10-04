"use client";

import { Fragment, useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import { formatUpdatedTime } from "@/lib/i18n/format";
// fork:input-limits —— pi-ai 原生的 `inputLimits` / `promptCache` 类型（见 ModelEntry）。
import type { ModelInputLimits, ModelPromptCache } from "@earendil-works/pi-ai";
import type { ModelCatalogPreset, ModelCatalogRecommendation } from "@/lib/model-catalog";
import type { DiscoveredModel } from "@/lib/model-discovery";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
import {
  collectModelRenames,
  compatFlagState,
  compatFlagsForApi,
  countUnknownCompatKeys,
  hasModelCostDraftValue,
  hasModelCostTierDraftValue,
  modelApiChoices,
  modelCostTierToDraft,
  modelCostToDraft,
  parseCompleteModelCost,
  parseModelCostTier,
  parseModelCostTiers,
  renameProviderEntry,
  savedModelIds,
  serializeHeaderRows,
  setCompatBool,
  setCompatFlag,
  trackAddedModels,
  updateHeaderRow,
  type CompatFlagState,
  type HeaderRow,
  type ModelCostDraft,
  type ModelCostKey,
  type ModelCostTier,
  type ModelCostTierDraft,
} from "./models-config-helpers";
// fork:input-limits —— 多模态上限 / 图片 resize / 提示词缓存时长的输入区。
import { ModelInputLimitsFields } from "./ModelLimitsFields";
import {
  ConfigPanelShell,
  ConfigSidebar,
  ConfigSidebarGroupLabel,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSidebarSub,
  ConfigSidebarText,
  ConfigSplitView,
  PwSelectBox,
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

// ── v5 基件（画板 D-08/09/10 的 d-* DOM）──────────────────────────────────────
/* fork:v5-landing —— 模型页内容层直接抄画板 DOM：小节用 `.d-set-sec`、行用
   `.d-set-row`、字段用 `.d-field`/`.d-grid2`、表用 `.d-card > .d-table`、
   开关用 `.d-switch`、分段用 `.d-seg`。壳（SettingsPage / ConfigSplitView /
   侧栏）仍是共享基件，由设置壳那一波统一换。 */
function DBadge({ tone, title, className, children }: {
  tone?: "ok" | "warn" | "bad" | "info" | "mute" | "count";
  title?: string; className?: string; children: ReactNode;
}) {
  const cls = ["d-badge", tone === "count" ? "mute" : tone, className].filter(Boolean).join(" ");
  return <span className={cls} title={title}>{children}</span>;
}

/** v5 D-08/09 的字段块：`.d-field` + `.d-field-t`，hint 是字段下方的小字。 */
function DField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="d-field">
      <span className="d-field-t">{label}</span>
      {children}
      {hint ? <div className="d-t-xs d-t-faint">{hint}</div> : null}
    </div>
  );
}

function DButton({ variant, size, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "secondary" | "primary" | "danger" | "ghost"; size?: "small";
}) {
  const cls = ["d-btn",
    variant === "primary" ? "primary" : variant === "danger" ? "danger" : variant === "ghost" ? "ghost" : "",
    size === "small" ? "sm" : "", className].filter(Boolean).join(" ");
  return <button type="button" className={cls} {...rest}>{children}</button>;
}

function DSwitch({ checked, disabled = false, label, onChange }: {
  checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`d-switch${checked ? " on" : ""}`}
      onClick={() => onChange(!checked)}
    />
  );
}

function DSeg({ value, options, ariaLabel, disabled = false, onChange }: {
  value: string; options: readonly { value: string; label: string; title?: string; node?: ReactNode }[];
  ariaLabel: string; disabled?: boolean; onChange: (next: string) => void;
}) {
  return (
    <span className="d-seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={option.title}
            disabled={disabled}
            className={on ? "is-on" : undefined}
            onClick={() => onChange(option.value)}
          >
            {option.node}
            {option.label}
          </button>
        );
      })}
    </span>
  );
}

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
  /* fork:input-limits —— pi-ai 的原生字段（`@earendil-works/pi-ai` 的 `Model` 上
     是 `inputLimits?` / `promptCache?`），先前这里没声明，所以 models.json 编辑器
     配不了它们。类型直接引 SDK 的，不自己抄一份（抄了就会漂）。
     pi 的校验在 `model-config.js:121-136`，见 components/ModelLimitsFields.tsx。 */
  inputLimits?: ModelInputLimits;
  promptCache?: ModelPromptCache;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; tiers?: ModelCostTier[] };
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

/* fork:model-row-inline —— 模型行的 🔌「测试模型」与编辑器里的那枚是**同一次调用**。
   两边各写一份 POST 的话，改了路由或错误处理只记得住一处；把网络那一段提出来，
   状态机（testing / success / error）留在调用方，因为行内只关心「这一行正在测」。 */
async function postModelTest(
  body: { providerName: string; provider: ProviderEntry; model: ModelEntry },
): Promise<ModelTestState> {
  try {
    const res = await fetch("/api/models-config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json() as {
      ok?: boolean;
      error?: string;
      latencyMs?: number;
      status?: number;
      responseText?: string;
    };
    if (!res.ok || !d.ok) {
      return {
        phase: "error",
        message: d.error ?? `HTTP ${res.status}`,
        latencyMs: d.latencyMs,
        status: d.status,
      };
    }
    return { phase: "success", latencyMs: d.latencyMs, status: d.status, responseText: d.responseText };
  } catch (e) {
    return { phase: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/* fork:model-row-badges —— 模型行的能力徽标（对齐 ZCode 的那三枚：名称 / 1M / 视觉）。
   `contextWindow` 与 `input` 本来就写在 models.json 里，只是列表一直没读它们 ——
   于是「这个模型多大、支不支持图」要去点进编辑器才看得见。 */
function formatContextWindowBadge(contextWindow?: number): string | null {
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) return null;
  // 与 ZCode 一致：≥100 万走 M、≥1000 走 K，其余原数（1M / 262.1K）。
  if (contextWindow >= 1_000_000) {
    const m = contextWindow / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (contextWindow >= 1000) return `${(contextWindow / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(contextWindow);
}

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

/**
 * fork:model-api-protocols (B4) —— 协议下拉与 `KNOWN_MODEL_APIS` 同源（经 `modelApiChoices`）：
 * 那份清单的来源与三条自证写在 components/models-config-helpers.ts 的定义处
 * （pi-ai `types.d.ts:15` 的 `KnownApi` 联合类型，不是印象）。
 */
const API_OPTIONS = modelApiChoices();

// ── Form field helpers ────────────────────────────────────────────────────────

/* fork:design-system —— 表单控件全部换成画板的 `.pw-input` / `.pw-selectbox`
   （视觉全在 board.css）。三个只存在于画板 DOM / 产品行为里的行内值集中在这里：
   · FILL_ROW_INPUT = 画板搜索行的 `style="flex:1;min-width:0"` —— d-input
     （或包着它的行）在 flex 行里要吃掉剩余宽度、并盖掉 min-width:200px
     （ChatWindow 同款先例）。
   · DISCOVERY_CHECKBOX —— 画板没有复选框基件（.d-switch 是开关不是多选）：
     上游导入清单勾选框的几何与 accentColor 只能留在行内。
   · BREAKABLE_LINK —— 画板没有链接基件；颜色走 token，授权 URL 很长必须可断行。 */
const FILL_ROW_INPUT = { flex: 1, minWidth: 0 } as const;
const DISCOVERY_CHECKBOX = { width: 13, height: 13, accentColor: "var(--accent)", flexShrink: 0 } as const;
const BREAKABLE_LINK = { color: "var(--accent)", wordBreak: "break-all" } as const;

function TextInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input
      className={mono ? "d-input d-mono" : "d-input"}
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

  /* 显隐切换用画板 D-08 搜索行的形态：`.d-row` + `.d-input` + 行尾 `.d-iconbtn`。 */
  return (
    <div className="d-row" style={style}>
      <input
        type={visible ? "text" : "password"}
        className={mono ? "d-input d-mono" : "d-input"}
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
        className="d-iconbtn"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("i18n.hideDetails") : t("i18n.showDetails")}
        title={visible ? t("i18n.hideDetails") : t("i18n.showDetails")}
      >
        <i data-ico={visible ? "eye-off" : "eye"} data-size="14" aria-hidden="true" />
      </button>
    </div>
  );
}

function NumInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      type="number"
      className="d-input d-mono"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function Select({ value, onChange, options, required, ariaLabel }: { value: string; onChange: (v: string) => void; options: readonly (string | { value: string; label: string })[]; required?: boolean; ariaLabel: string }) {
  const { t } = useI18n();
  // fork:api-labels —— 选项可以是纯字符串（label = value），也可以是
  // `{value,label}`：协议下拉要显示人话，落盘仍是内部 id。
  const choices = [
    ...(required ? [] : [{ value: "", label: `— ${t("i18n.default")} / none —` }]),
    ...options.map((o) => (typeof o === "string" ? { value: o, label: o } : o)),
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

  /* fork:design-system —— 四段模式就是画板 D-08 的 `.d-seg` 分段；芯片前置的
     图案是品牌 ProviderIcon（非 sprite 名），走 DSeg option.node。 */
  return (
    <div className="d-col">
      {/* fork:v5-landing —— 四段模式就是画板 D-08 的 `.d-seg` 分段。 */}
      <DSeg
        value={current}
        options={PROVIDER_ICON_MODES.map((modeOption) => ({
          value: modeOption,
          label: t(ICON_MODE_LABEL_KEYS[modeOption]),
          title: t(ICON_MODE_LABEL_KEYS[modeOption]),
          node: <ProviderIcon id={providerId} api={api} size={12} mode={modeOption} />,
        }))}
        ariaLabel={t("models.providerIcon")}
        onChange={(next) => chooseMode(next as ProviderIconMode)}
      />
      {current === "emoji" && (
        <div className="d-row">
          <input
            className="d-input d-mono"
            style={{ width: "12ch" }}
            value={emojiDraft}
            onChange={(event) => updateEmoji(event.target.value)}
            placeholder={t("models.providerIconEmojiPlaceholder")}
            aria-label={t("models.providerIconEmoji")}
            maxLength={16}
          />
          <DButton
            variant="ghost"
            size="small"
            disabled={!emojiDraft && !getProviderEmoji(providerId)}
            onClick={() => updateEmoji("")}
          >
            {t("models.providerIconEmojiClear")}
          </DButton>
        </div>
      )}
      <div className="d-mono d-t-faint">{t("models.providerIconModeDescription")}</div>
    </div>
  );
}

// ── Provider detail ───────────────────────────────────────────────────────────

/* fork:model-rename-save（上游 bd85004 #969）—— 供应商名输入框的草稿由面板持有，
   不再是 ProviderDetail 的本地 state：只有 Rename 按钮能动 draft 时，页脚 Save
   就看不见输入框里的改动，直接序列化等于静默丢掉一次重命名。 */
function ProviderDetail({ name, editingName, provider, onChange, onEditingNameChange, onRename, onDelete, onAddModels, enabledModels, onOpenModel, onAddModel, onPrune }: {
  name: string; editingName: string; provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void; onEditingNameChange: (n: string) => void;
  onRename: (n: string) => void; onDelete: () => void;
  onAddModels: (models: DiscoveredModel[]) => void; enabledModels: EnabledModelsController;
  /** 画板 41 的「可用模型」是一行一个模型：点它就钻到模型详情。 */
  onOpenModel: (index: number) => void;
  onAddModel: () => void;
  onPrune: () => void;
}) {
  const { t, locale } = useI18n();
  const [discoveryState, setDiscoveryState] = useState<ModelDiscoveryState>({ phase: "idle" });
  const [discoveryQuery, setDiscoveryQuery] = useState("");
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const discoveryRequestIdRef = useRef(0);
  const selectShownRef = useRef<HTMLInputElement>(null);
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
    // fork:discover-catalog-endpoint —— 不再自己判断 baseUrl 为空：`/api/models-config/discover`
    // 已经会在 models.json 没写 baseUrl 时去 pi 的 provider catalog 反查（那个 provider
    // 条目可能只为覆盖内置模型而存在）。入口再按 baseUrl 禁用，就把这个能力又堵回去了。
    if (discoveryState.phase === "loading") return;
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
      // baseUrl 可能为空（端点来自 pi 的 catalog），所以 endpoint 也要有底线。
      setDiscoveryState({ phase: "success", models: data.models, endpoint: data.endpoint ?? provider.baseUrl ?? "" });
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
  /* fork:model-discovery-specs —— 导入清单副标题里先告知上游报了哪些规格，勾之前就
     知道会带什么进来。只用现成的 `formatTokenLimit`，没有新类名。 */
  const discoveredModelSpecs = (model: DiscoveredModel): string | null => {
    const parts: string[] = [];
    if (model.contextWindow) parts.push(t("models.specsContextShort", { value: formatTokenLimit(model.contextWindow) }));
    if (model.maxTokens) parts.push(t("models.specsOutputShort", { value: formatTokenLimit(model.maxTokens) }));
    if (model.input?.includes("image")) parts.push(t("models.specsImageShort"));
    return parts.length ? parts.join(" · ") : null;
  };
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

  /* fork:models-board —— 画板 D-08 帧 A 的「可用模型」是**按名字过滤的开关行**，
     头卡里那两组 `.d-grid2 > .d-field`（接口地址 / 认证方式 / 上次同步）也在这算。
     「上次同步」是本次打开面板后真的成功导入过一次才有的事实，没有就明说没有。 */
  const [lastSync, setLastSync] = useState<{ at: number; count: number } | null>(null);
  const [modelFilter, setModelFilter] = useState("");
  /* fork:model-row-inline —— 行内 🔌 的结果，按行下标存。
     一行一个 entry 而不是「一个全局 testState」，否则点第二行会把第一行的
     结果冲掉。key 用下标而不是 model.id：同一 provider 里允许出现两条同 id
     的草稿条目（下标唯一），而 id 在这种情况下不唯一。 */
  const [rowTests, setRowTests] = useState<Record<number, ModelTestState>>({});
  const testRowModel = useCallback(async (index: number, model: ModelEntry) => {
    if (!model.id.trim()) return;
    setRowTests((prev) => ({ ...prev, [index]: { phase: "testing" } }));
    const result = await postModelTest({ providerName: name, provider, model });
    setRowTests((prev) => ({ ...prev, [index]: result }));
  }, [name, provider]);
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

  /* fork:v5-landing —— 画板 D-08 帧 A：供应商头卡 / 用量 / 可用模型 / 导入 / 连接
     都是 `.d-set-inner` 里的 `.d-set-sec`；配置字段走 `.d-grid2 > .d-field`。 */
  return (
    <div className="d-set-inner">
      <div className="d-set-sec">
        <div className="d-row">
          <ProviderIcon id={name} size={22} />
          <div className="d-set-sec-t">{name}</div>
          <span className="d-grow" aria-hidden="true" />
          <EnabledModelsProviderSwitch providerId={name} controller={enabledModels} />
          <DButton variant="danger" size="small" onClick={onDelete}>{t("i18n.delete")}</DButton>
        </div>
        {/* fork:provider-inline-fields —— 地址 / 协议 / 密钥就地可改（顺序：
            Base URL → API 格式 → API Key），同一个值不留两个输入框。 */}
        <DField label={t("models.kvBaseUrl")} hint={t("models.baseUrlCatalogFallbackHint")}>
          <TextInput value={provider.baseUrl ?? ""} onChange={(v) => set("baseUrl", v || undefined)}
            placeholder="https://api.example.com/v1" mono />
        </DField>

        <DField label={t("models.apiLabel")}>
          <Select value={provider.api ?? "openai-completions"} onChange={(v) => set("api", v)} options={API_OPTIONS} required ariaLabel={t("models.apiLabel")} />
        </DField>

        <DField label={t("models.apiKeyLabel")} hint={t("models.apiKeyHint")}>
          <SecretTextInput value={provider.apiKey ?? ""} onChange={(v) => set("apiKey", v || undefined)}
            placeholder="ENV_VAR_NAME, !shell-command, or literal key" mono />
        </DField>

        <div className="d-grid2">
          <div className="d-field">
            <span className="d-field-t">{t("models.kvAuth")}</span>
            <span>{authSummary}</span>
          </div>
          <div className="d-field">
            <span className="d-field-t">{t("models.kvLastSync")}</span>
            <span className="d-mono">
              {lastSync
                ? `${formatUpdatedTime(lastSync.at, locale)} · ${t("models.discoveryFetched", { count: lastSync.count })}`
                : t("models.neverSynced")}
            </span>
          </div>
        </div>
      </div>

      <div className="d-set-sec">
        <div className="d-set-sec-t">{t("models.usageTitle")}</div>
        <ProviderUsageCards providerId={name} />
      </div>

      <div className="d-set-sec">
        <div className="d-row">
          <div className="d-set-sec-t">{t("models.availableModels")}</div>
          <DBadge tone="count">
            {t("models.modelsCount", { count: provider.models?.length ?? 0, enabled: enabledCount })}
          </DBadge>
          <span className="d-grow" aria-hidden="true" />
          <input
            className="d-input d-mono"
            style={{ maxWidth: 200 }}
            value={modelFilter}
            onChange={(event) => setModelFilter(event.target.value)}
            placeholder={t("models.filterModels")}
            aria-label={t("models.filterModels")}
          />
          <DButton
            size="small"
            disabled={discoveryState.phase === "loading"}
            onClick={handleDiscoverModels}
          >
            <i data-ico="download" data-size="13" aria-hidden="true" />
            {discoveryState.phase === "loading" ? t("models.discoveryFetching") : t("models.importFromUpstream")}
          </DButton>
        </div>

        <div className="d-card">
          <table className="d-table">
            <tbody>
              {configuredModels.length === 0 ? (
                <tr>
                  <td><span className="d-t-xs d-t-faint">{provider.models?.length ? t("models.enabledNoMatches") : t("models.noModels")}</span></td>
                </tr>
              ) : configuredModels.map((model, index) => {
                const subtitle = modelSubtitle(model);
                const rowTest = rowTests[index];
                const testing = rowTest?.phase === "testing";
                const view = providerView?.models.find((entry) => entry.id === model.id);
                const window_ = formatContextWindowBadge(model.contextWindow);
                const vision = (model.input ?? []).some((modality) => modality === "image" || modality === "pdf");
                const testTitle = !model.id.trim()
                  ? t("models.testModelNeedsId")
                  : rowTest && rowTest.phase !== "idle" && rowTest.phase !== "testing"
                    ? rowTest.phase === "success"
                      ? [t("i18n.connected"), rowTest.latencyMs !== undefined ? `${rowTest.latencyMs}ms` : null]
                        .filter(Boolean).join(" · ")
                      : [t("i18n.failed"), rowTest.message].filter(Boolean).join(" · ")
                    : testing ? t("i18n.testingModel") : t("models.testModel");
                return (
                  <tr key={index} className="models-provider-model-row">
                    <td>
                      <div className="d-col">
                        <span className="d-t-b">{model.name || model.id || t("i18n.newModel")}</span>
                        {subtitle ? <span className="d-t-xs d-t-faint">{subtitle}</span> : null}
                      </div>
                    </td>
                    <td>
                      <div className="d-row">
                        {window_ ? <DBadge tone="count">{window_}</DBadge> : null}
                        {vision ? <DBadge tone="count">{t("models.badgeVision")}</DBadge> : null}
                        {model.reasoning ? <DBadge tone="info">{t("models.badgePinnable")}</DBadge> : null}
                        {rowTest && rowTest.phase === "error" ? <DBadge tone="bad">{t("i18n.failed")}</DBadge> : null}
                        <button
                          type="button"
                          className="d-iconbtn models-provider-model-action"
                          disabled={!model.id.trim() || testing}
                          title={testTitle}
                          aria-label={testTitle}
                          onClick={() => void testRowModel(index, model)}
                        >
                          <i data-ico={testing ? "loader-circle" : "zap"} data-size="13" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="d-iconbtn models-provider-model-action"
                          title={t("models.editModel")}
                          aria-label={t("models.editModel")}
                          onClick={() => onOpenModel(index)}
                        >
                          <i data-ico="square-pen" data-size="13" aria-hidden="true" />
                        </button>
                        <DSwitch
                          checked={view?.enabled ?? true}
                          disabled={!view || !enabledModels.view?.editable}
                          label={view
                            ? t("models.enabledToggle", { model: model.name || model.id })
                            : t("models.enabledUnavailable")}
                          onChange={(checked) => view && enabledModels.setModels(view.ref, [view.ref], checked)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="d-row">
          <span className="d-mono d-t-faint">
            {t("models.enabledProjectScope")}
          </span>
          <span className="d-grow" aria-hidden="true" />
          <DButton
            size="small"
            disabled={stalePatternCount === 0}
            title={stalePatternCount === 0 ? undefined : t("models.pruneHint", { count: stalePatternCount })}
            onClick={onPrune}
          >
            {t("models.pruneUnmatched")}
          </DButton>
          <DButton size="small" variant="ghost" onClick={onAddModel}>{t("i18n.addModel")}</DButton>
        </div>
      </div>

      {discoveryState.phase !== "idle" && (
        <div className="d-set-sec">
          <div className="d-row">
            <div className="d-set-sec-t">{t("models.importFromUpstream")}</div>
            <span className="d-grow" aria-hidden="true" />
            {discoveryState.phase === "success" && (
              <DButton size="small" variant="ghost" onClick={() => setDiscoveryState({ phase: "idle" })}>
                {t("i18n.close")}
              </DButton>
            )}
          </div>

          {discoveryState.phase === "error" && (
            <div className="d-banner err">{discoveryState.message}</div>
          )}

          {discoveryState.phase === "success" && (
            <>
              <div className="d-field">
                <span className="d-field-t">{t("models.discoveryFilter")}</span>
                <input
                  className="d-input d-mono"
                  value={discoveryQuery}
                  onChange={(event) => setDiscoveryQuery(event.target.value)}
                  placeholder={t("models.discoveryFilterPlaceholder", { count: discoveryState.models.length })}
                  aria-label={t("models.discoveryFilter")}
                />
              </div>

              <div className="d-card">
                <label className="d-row models-discovery-row models-discovery-head" style={{ padding: "6px 12px" }}>
                  <input
                    ref={selectShownRef}
                    type="checkbox"
                    checked={allShownSelected}
                    disabled={selectableShownIds.length === 0}
                    onChange={toggleShownModels}
                    style={DISCOVERY_CHECKBOX}
                  />
                  <span className="d-t-b">{t("models.discoverySelectShown")}</span>
                </label>
                {shownDiscoveredModels.length === 0 ? (
                  <div className="d-t-xs d-t-faint" style={{ padding: "6px 12px" }}>{t("models.discoveryNoMatches")}</div>
                ) : shownDiscoveredModels.map((model) => {
                  const alreadyAdded = existingModelIds.has(model.id);
                  const specs = discoveredModelSpecs(model);
                  return (
                    <label
                      key={model.id}
                      className={`d-row models-discovery-row${alreadyAdded ? " is-added" : ""}`}
                      style={{ padding: "6px 12px" }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedModelIds.includes(model.id) || alreadyAdded}
                        disabled={alreadyAdded}
                        onChange={() => toggleDiscoveredModel(model.id)}
                        style={DISCOVERY_CHECKBOX}
                      />
                      <span className="d-col d-grow">
                        <span className="d-t-b">{model.name ?? model.id}</span>
                        <span className="d-t-xs d-t-faint">{model.id}{specs ? ` · ${specs}` : ""}</span>
                      </span>
                      {alreadyAdded && <DBadge tone="mute">{t("models.discoveryAdded")}</DBadge>}
                    </label>
                  );
                })}
              </div>

              <div className="d-row">
                <span
                  title={discoveryState.endpoint}
                  className="d-mono d-t-faint catalog-status-text"
                >
                  {filteredDiscoveredModels.length > shownDiscoveredModels.length
                    ? t("models.discoveryShowing", { shown: shownDiscoveredModels.length, total: filteredDiscoveredModels.length })
                    : t("models.discoveryFetched", { count: discoveryState.models.length })}
                </span>
                <span className="d-grow" aria-hidden="true" />
                <DButton
                  variant="primary"
                  size="small"
                  disabled={selectedCount === 0}
                  onClick={addSelectedModels}
                >
                  {selectedCount
                    ? t("models.discoveryAddSelectedCount", { count: selectedCount })
                    : t("models.discoveryAddSelected")}
                </DButton>
              </div>
            </>
          )}
        </div>
      )}

      <div className="d-set-sec">
        <div className="d-set-sec-t">{t("models.connectionTitle")}</div>
        <div className="d-field">
          <span className="d-field-t">{t("i18n.providerName")}</span>
          <div className="d-row">
            <TextInput value={editingName} onChange={onEditingNameChange} placeholder="provider-name" mono />
            {editingName !== name && editingName.trim() && (
              <DButton size="small" variant="primary" onClick={() => onRename(editingName.trim())}>
                {t("i18n.rename")}
              </DButton>
            )}
          </div>
        </div>

        <div className="d-field">
          <span className="d-field-t">{t("models.providerIcon")}</span>
          <ProviderIconModePicker providerId={name} api={provider.api} />
        </div>

        <DField label={t("models.headers")} hint={t("models.providerHeadersHint")}>
          <HeaderListEditor headers={provider.headers} onChange={(headers) => set("headers", headers)} />
        </DField>

        <DField label={t("models.compatibility")} hint={t("models.compatProviderHint")}>
          <CompatFlagsEditor
            compat={provider.compat}
            api={provider.api}
            onChange={(key, state) => onChange(setCompatFlag(provider, key, state))}
          />
        </DField>
      </div>
    </div>
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

/* 画板 D-08「能力」区的三态没有开关二值那么简单：每档是
   omit（跟随默认）/ null（Disabled）/ string（Custom + 值），画成分段芯片就是
   `.d-seg`（DSeg，键盘可切换）。 */
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

  /* fork:design-system —— 行结构用画板 D-08 的 `d-set-row` 形态：
     左侧「档名 + 该档实际请求的小字说明」、右侧 `d-grow-last` 里的 `d-seg` 三态芯片。
     档位色点沿用七档语义色（LEVEL_COLORS，运行时色值），Disabled 档做淡出。 */
  return (
    <div className="d-col">
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
          <div key={level} className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t d-row">
                <span className="d-dot" style={{ background: dotColor }} />
                <span
                  className={state === "null" ? "d-mono d-t-faint" : "d-mono"}
                  style={state === "null" ? { textDecoration: "line-through" } : undefined}
                >
                  {level}
                </span>
              </div>
              {described ? (
                <div
                  className="d-set-row-s"
                  title={invalid ? described.invalid : described.text ?? undefined}
                  style={invalid ? { color: "var(--nx-danger)" } : undefined}
                >
                  {invalid ? described.invalid : described.text ?? t("models.thinkingSendsNothing")}
                </div>
              ) : null}
            </div>
            <span className="d-grow-last d-row">
              <DSeg
                value={state}
                options={LEVEL_STATE_OPTIONS}
                ariaLabel={level}
                onChange={(next) => setLevel(level, next === "omit" ? "omit" : next === "null" ? null : strVal || level)}
              />
              {state === "string" && (
                <input
                  className="d-input d-mono"
                  value={strVal}
                  onChange={(e) => setLevel(level, e.target.value)}
                  placeholder={level}
                  maxLength={10}
                  style={{ width: "12ch" }}
                />
              )}
            </span>
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

/* fork:compat-flags (B5) —— 三态：Default（不写键）/ On（写 true）/ Off（写 false）。
   Default 之所以是三态而不是两态：pi-ai 对不少字段是 `model.compat.x ?? detected.x`
   （按 baseUrl 自动探测），对另一些是固定默认值 —— 两态开关会把「跟随自动探测」
   和「显式打开」混成同一个值，要么写一堆与默认相同的噪声，要么改不了自动探测。 */
const COMPAT_FLAG_STATE_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
] as const satisfies readonly { value: CompatFlagState; label: string }[];

/**
 * 该协议的 compat 布尔开关表。清单与默认值的来源写在
 * `components/models-config-helpers.ts` 的 `COMPAT_FLAGS_BY_API` 定义处
 * （pi-ai `types.d.ts` 的条件类型 + `dist/api/*.js` 里逐个 `??` 的默认值）。
 *
 * 显示读的是 provider+model 合并后的**生效值**（provider-composer 在运行时也是
 * 这个合并规则），写入只落在 model 条目上，所以一个 model 的覆盖是显式的。
 */
function CompatFlagsEditor({ compat, api, onChange }: {
  compat: Record<string, unknown> | undefined;
  api: string | undefined;
  onChange: (key: string, state: CompatFlagState) => void;
}) {
  const { t } = useI18n();
  const specs = compatFlagsForApi(api);

  if (specs.length === 0) {
    return (
      <div className="d-t-xs d-t-faint">
        {api ? t("models.compatNoneForApi", { api }) : t("models.compatNeedApi")}
      </div>
    );
  }

  return (
    <div className="d-col">
      {specs.map((spec) => {
        const state = compatFlagState(compat, spec);
        return (
          <div key={spec.key} className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t(spec.labelKey)}</div>
              <div className="d-set-row-s">{spec.defaultValue === null
                ? t("models.compatDefaultAuto")
                : t("models.compatDefaultValue", { value: String(spec.defaultValue) })}</div>
            </div>
            <span className="d-grow-last">
              <DSeg
                value={state}
                options={COMPAT_FLAG_STATE_OPTIONS}
                ariaLabel={t(spec.labelKey)}
                onChange={(next) => onChange(spec.key, next as CompatFlagState)}
              />
            </span>
          </div>
        );
      })}
      {countUnknownCompatKeys(compat, specs) > 0 && (
        /* 枚举 / 对象 / 手改 JSON 写进来的键：报个数，不假装能编辑。 */
        <div className="d-t-xs d-t-faint">
          {t("models.compatOtherKeys", { count: countUnknownCompatKeys(compat, specs) })}
        </div>
      )}
    </div>
  );
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
  /* fork:design-system —— 快捷档位是画板 D-08 的 `.d-seg` 分段：
     单选、选中态 accent，自绘 chip 的边框/圆角/字号全部退役。
     原始数值留在芯片的 title 上（DSeg option.title）。 */
  const options: { value: string; label: string; title?: string }[] = ladder.map((preset) => ({
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
      <DSeg
        value={value !== undefined ? String(value) : ""}
        options={options}
        ariaLabel={ariaLabel}
        onChange={(next) => onChange(Number(next))}
      />
      {catalogValue !== undefined && value !== undefined && !followsCatalog && (
        <span className="d-mono d-t-faint">{t("models.overridden")}</span>
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
    /* `.d-textarea` 是画板的系统提示级 textarea；这里按内容收高，缩进需要 pre。 */
    <div className="d-col">
      <textarea
        value={editing ? draft : serialized}
        onFocus={() => { setDraft(serialized); setEditing(true); }}
        onChange={(event) => { setDraft(event.target.value); setError(null); }}
        onBlur={commit}
        rows={2}
        spellCheck={false}
        placeholder={'{ "temperature": 0.7 }'}
        aria-invalid={error !== null}
        className="d-textarea"
        style={{ minHeight: 0, whiteSpace: "pre" }}
      />
      {error && <div role="alert" className="d-err">{error}</div>}
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
    <div className="d-col">
      {/* fork:v5-landing —— 画板 D-09 帧 A：Header 逐行进 `.d-card > .d-table`，
          每行一个删除图标钮，不在用 JSON 文本框。 */}
      <div className="d-card">
        <table className="d-table">
          <thead>
            <tr>
              <th>Header</th>
              <th>value</th>
              <th aria-hidden="true"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <input
                    value={row.name}
                    onChange={(e) => setEntry(row.id, { name: e.target.value })}
                    placeholder="Header-Name"
                    className="d-input d-mono"
                    style={{ width: "100%" }}
                  />
                </td>
                <td>
                  <input
                    value={row.value}
                    onChange={(e) => setEntry(row.id, { value: e.target.value })}
                    placeholder="value"
                    className="d-input d-mono"
                    style={{ width: "100%" }}
                  />
                </td>
                <td>
                  <DButton
                    variant="ghost"
                    size="small"
                    onClick={() => removeEntry(row.id)}
                    aria-label={t("i18n.delete")}
                    title={t("i18n.delete")}
                  >
                    <i data-ico="trash-2" data-size="14" aria-hidden="true" />
                  </DButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="d-row">
        <DButton
          variant="primary"
          size="small"
          onClick={() => setRows((current) => [
            ...current,
            { id: nextRowIdRef.current++, name: "", value: "" },
          ])}
        >
          <i data-ico="plus" data-size="13" aria-hidden="true" />
          Add header
        </DButton>
      </div>
    </div>
  );
}

/**
 * fork:cost-tiers (B3) — 阶梯定价编辑器。pi-ai 的 `ModelCostTier`（`dist/types.d.ts`）
 * 是一组「输入 tokens 超过阈值后整笔改用这组价格」，`calculateCost()` 取最高匹配的
 * 阈值 —— 没有编辑器就只能手改 JSON，于是显示用的基础价与实际扣费对不上。
 *
 * 每一档是一组 `.d-set-row` 行（画板 D-08/09 已经用的形态）：左阈值 + 右边四个
 * `.d-input.d-mono` 窄数值框。行内不加自造类。
 */
const COST_TIER_RATE_FIELDS: readonly { key: ModelCostKey; label: string }[] = [
  { key: "input", label: "in" },
  { key: "output", label: "out" },
  { key: "cacheRead", label: "cache r" },
  { key: "cacheWrite", label: "cache w" },
];
function CostTiersEditor({ tiers, onChange }: {
  tiers: ModelCostTier[];
  onChange: (next: ModelCostTier[] | undefined) => void;
}) {
  const { t } = useI18n();
  const draftsRef = useRef<ModelCostTierDraft[]>(tiers.map(modelCostTierToDraft));
  const [drafts, setDrafts] = useState(draftsRef.current);
  // 已保存的档变了（撤销目录回填 / 换模型）就重新起草。
  useEffect(() => {
    draftsRef.current = tiers.map(modelCostTierToDraft);
    setDrafts(draftsRef.current);
  }, [tiers]);

  const apply = (next: ModelCostTierDraft[]) => {
    const parsed = parseModelCostTiers(next);
    draftsRef.current = next;
    setDrafts(next);
    onChange(parsed);
  };
  const setDraft = (index: number, changes: Partial<ModelCostTierDraft>) => {
    apply(drafts.map((draft, i) => (i === index ? { ...draft, ...changes } : draft)));
  };

  return (
    <div className="d-col">
      {drafts.map((draft, index) => {
        return (
          <div key={index} className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{t("models.costTierAbove")}</div>
              <div className="d-set-row-s">{t("models.costTierAboveHint", { value: formatTokenLimit(Number(draft.inputTokensAbove) || 0) })}</div>
            </div>
            <span className="d-grow-last d-row">
              <input
                className="d-input d-mono"
                type="number"
                min={1}
                value={draft.inputTokensAbove}
                onChange={(event) => setDraft(index, { inputTokensAbove: event.target.value })}
                aria-label={t("models.costTierAbove")}
                style={{ width: "9ch" }}
              />
              {COST_TIER_RATE_FIELDS.map(({ key, label }) => (
                <input
                  key={key}
                  className="d-input d-mono"
                  type="number"
                  min={0}
                  step="any"
                  value={draft[key]}
                  onChange={(event) => setDraft(index, { [key]: event.target.value })}
                  aria-label={`${t("models.costTierPrice")}: ${label}`}
                  placeholder={label}
                  style={{ width: "8ch" }}
                />
              ))}
              <DButton
                variant="danger"
                size="small"
                aria-label={t("i18n.delete")}
                title={t("i18n.delete")}
                onClick={() => apply(drafts.filter((_, i) => i !== index))}
              >
                <i data-ico="trash-2" data-size="14" aria-hidden="true" />
              </DButton>
            </span>
          </div>
        );
      })}
      {drafts.some((draft) => hasModelCostTierDraftValue(draft) && !parseModelCostTier(draft)) && (
        <div aria-live="polite" className="d-mono d-t-faint" style={{ color: "var(--nx-warning)" }}>
          {t("models.costTierInvalid")}
        </div>
      )}
      <div className="d-row">
        <DButton
          variant="ghost"
          size="small"
          onClick={() => apply([...drafts, {
            inputTokensAbove: "",
            input: "",
            output: "",
            cacheRead: "",
            cacheWrite: "",
          }])}
        >
          <i data-ico="plus" data-size="13" aria-hidden="true" />
          {t("models.costTierAdd")}
        </DButton>
      </div>
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

/** 收藏星标用画板 `<i data-ico="star">` + `.d-iconbtn`（见侧栏模型行）；这里不再自绘 SVG。 */

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
  // fork:cost-tiers (B3) —— 阶梯挂在同一个 cost 对象上，所以走同一份模板（保持
  // tiers 之外的手写字段），只换 tiers 本身；清空就删键，不留 `tiers: []`。
  //
  // `useMemo` 不是洁癖：CostTiersEditor 的 `useEffect([tiers])` 会用 tiers 重建草稿，
  // 没有它时 `?? []` 每次渲染都是新数组 → 每次渲染都重设草稿 → 无限重渲染。
  const costTiers = useMemo(
    () => (Array.isArray(model.cost?.tiers) ? model.cost.tiers : []),
    [model.cost?.tiers],
  );
  const setCostTiers = (tiers: ModelCostTier[] | undefined) => {
    const nextCost = { ...(costTemplateRef.current ?? {}) };
    if (tiers?.length) nextCost.tiers = tiers;
    else delete nextCost.tiers;
    costTemplateRef.current = nextCost;
    onChange({ ...model, cost: nextCost });
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
    setTestState(await postModelTest({ providerName, provider, model }));
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
  // fork:compat-flags (B5) —— 开关表里的那些已经被编辑器接管，剩下的（枚举 / 对象 /
  // 手改 JSON 写进来的）仍然只报个数。
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

  /* fork:v5-landing —— 画板 D-08 帧 B / D-09：模型详情拆成三个 `.d-set-sec`
     ① 身份 / 能力 / 规格 / 成本 ② 高级（Header / 兼容 / 上限 / 思考）③ 测试连接。
     控件全部换成画板的 d-* DOM（`.d-grid2` / `.d-field` / `.d-set-row` / `.d-seg`）；
     数据绑定与状态机不变。 */
  return (
    <div className="d-set-inner">
      <div className="d-set-sec">
        <div className="d-row">
          <div className="d-set-sec-t">{model.name || model.id || t("i18n.newModel")}</div>
          <DBadge tone="mute">{providerName}</DBadge>
          {model.reasoning ? <DBadge tone="info">{t("models.badgePinnable")}</DBadge> : null}
        </div>

        <div className="d-grid2">
          <div className="d-field">
            <span className="d-field-t">ID *</span>
            <TextInput value={model.id} onChange={(v) => set("id", v)} placeholder="model-id" mono />
          </div>
          <div className="d-field">
            <span className="d-field-t">Name</span>
            <TextInput value={model.name ?? ""} onChange={(v) => set("name", v || undefined)} placeholder="Display name" />
          </div>
        </div>
        <div className="d-row">
          <DButton
            size="small"
            disabled={!model.id.trim() || catalogState.phase === "loading"}
            onClick={() => void handleCatalogFill()}
          >
            {catalogState.phase === "loading" ? t("models.catalogFilling") : t("models.catalogFill")}
          </DButton>
          <span className="d-grow" aria-hidden="true" />
          <a
            href="https://github.com/anomalyco/models.dev"
            target="_blank"
            rel="noreferrer"
            className="d-t-xs d-t-faint"
          >
            {t("models.catalogSource")}
          </a>
        </div>
        {catalogStatusText && (
          /* 状态色是运行时按「成功 / 不可靠 / 出错」算出来的 —— 几何无关，内联允许。 */
          <div className="catalog-status d-row" aria-live="polite" style={{ color: catalogStatusColor }}>
            <span title={catalogStatusText} className="catalog-status-text d-t-xs">{catalogStatusText}</span>
            {catalogUndoRef.current && (
              <button type="button" className="catalog-undo" onClick={undoCatalogFill}>
                {t("models.catalogUndo")}
              </button>
            )}
          </div>
        )}

        <div className="d-set-sec-t">{t("models.capabilities")}</div>
        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("models.reasoning")}</div>
          </div>
          <span className="d-grow-last">
            <DSwitch
              checked={model.reasoning ?? false}
              label={t("models.reasoning")}
              onChange={(v) => set("reasoning", v || undefined)}
            />
          </span>
        </div>
        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("models.imageInput")}</div>
          </div>
          <span className="d-grow-last">
            <DSwitch
              checked={model.input?.includes("image") ?? false}
              label={t("models.imageInput")}
              onChange={(v) => set("input", v ? ["text", "image"] : undefined)}
            />
          </span>
        </div>

        <div className="d-set-sec-t">{t("models.specs")}</div>
        <div className="d-grid2">
          <div className="d-field">
            <span className="d-field-t">{t("models.contextWindow")}</span>
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
          <div className="d-field">
            <span className="d-field-t">{t("models.maxOutputTokens")}</span>
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
        </div>
        {model.contextWindow !== undefined && model.maxTokens !== undefined && model.maxTokens > model.contextWindow && (
          <div role="alert" className="d-banner err">{t("models.maxTokensExceedsContext")}</div>
        )}

        <div className="d-field">
          <span className="d-field-t">{t("models.samplingParams")}</span>
          <div className="d-t-xs d-t-faint">{t("models.samplingParamsHint")}</div>
          <SamplingParamsEditor value={model.samplingParams} onChange={(next) => set("samplingParams", next)} />
        </div>

        <div className="d-set-sec-t">{t("models.costPerMillion")}</div>
        {costEditing ? (
          <div className="d-grid2">
            {costFields.map(({ key, label }) => (
              <div key={key} className="d-field">
                <span className="d-field-t">{label}</span>
                <NumInput value={costDraft[key]} onChange={(v) => setCost(key, v)} placeholder="0" />
              </div>
            ))}
          </div>
        ) : (
          <div className="d-grid2">
            {costFields.map(({ key, label }) => (
              <div key={key} className="d-field">
                <span className="d-field-t">{label}</span>
                <span className="d-mono">{formatCost(key)}</span>
                {/* 没填的这一格：值本身就是「未提供」，再补一句一样的只会重复。 */}
                {model.cost?.[key] === undefined ? null : <div className="d-t-xs d-t-faint">{t("models.costEditableHint")}</div>}
              </div>
            ))}
          </div>
        )}
        {costEditing && hasModelCostDraftValue(costDraft) && !parseCompleteModelCost(costDraft) && (
          /* 这里是「填了一半」的警告语义色，颜色是运行时算出来的。 */
          <div aria-live="polite" className="d-mono d-t-faint" style={{ color: "var(--nx-warning)" }}>{t("models.costAllRequired")}</div>
        )}

        <div className="d-row">
          <div className="d-set-sec-t">{t("models.costTiers")}</div>
          {costTiers.length > 0 && <DBadge tone="count">{costTiers.length}</DBadge>}
          <span className="d-grow" aria-hidden="true" />
          <DButton size="small" onClick={toggleCostEditing} aria-expanded={costEditing}>
            {costEditing ? t("models.finishEditingCosts") : t("models.editCosts")}
          </DButton>
        </div>
        <div className="d-t-xs d-t-faint">{t("models.costTiersHint")}</div>
        <CostTiersEditor tiers={costTiers} onChange={setCostTiers} />
      </div>

      <div className="d-set-sec">
        <div className="d-row">
          <div className="d-set-sec-t">{t("models.advancedTitle")}</div>
          <span className="d-grow" aria-hidden="true" />
          <DButton
            size="small"
            onClick={() => setAdvancedOpen((open) => !open)}
            aria-expanded={advancedOpen}
            aria-controls="model-advanced-settings"
          >
            {advancedOpen ? t("i18n.collapse") : t("i18n.expand")}
          </DButton>
        </div>
        <div className="d-t-xs d-t-faint">{advancedSummary}</div>

        {advancedOpen && (
          <div id="model-advanced-settings" className="d-col">
            <div className="d-field">
              <span className="d-field-t">{t("models.apiOverride")}</span>
              <Select value={model.api ?? ""} onChange={(v) => set("api", v || undefined)} options={API_OPTIONS} ariaLabel={t("models.apiOverride")} />
            </div>

            <div className="d-field">
              <span className="d-field-t">{t("models.headers")}</span>
              <div className="d-t-xs d-t-faint">{t("models.headersHelp")}</div>
              <HeaderListEditor headers={model.headers} onChange={(headers) => set("headers", headers)} />
            </div>

            <div className="d-set-sec-t">{t("models.compatibility")}</div>
            <div className="d-set-row">
              <div className="d-set-row-box">
                <div className="d-set-row-t">{t("models.deepSeekThinkingCompat")}</div>
              </div>
              <span className="d-grow-last">
                <DSwitch
                  checked={hasDeepseekCompat(model)}
                  label={t("models.deepSeekThinkingCompat")}
                  onChange={(v) => onChange(setDeepseekCompat(model, v))}
                />
              </span>
            </div>
            <div className="d-set-row">
              <div className="d-set-row-box">
                <div className="d-set-row-t">{t("models.developerRole")}</div>
              </div>
              <span className="d-grow-last">
                <DSwitch
                  checked={effectiveCompat(provider, model)["supportsDeveloperRole"] !== false}
                  label={t("models.developerRole")}
                  onChange={(v) => onChange(setCompatBool(model, "supportsDeveloperRole", v))}
                />
              </span>
            </div>

            <CompatFlagsEditor
              compat={effectiveCompat(provider, model)}
              api={model.api ?? provider.api}
              onChange={(key, state) => onChange(setCompatFlag(model, key, state))}
            />

            <ModelInputLimitsFields
              inputLimits={model.inputLimits}
              promptCache={model.promptCache}
              onInputLimitsChange={(next) => set("inputLimits", next)}
              onPromptCacheChange={(next) => set("promptCache", next)}
            />

            {model.reasoning && (
              <>
                <div className="d-row">
                  <div className="d-set-sec-t">{t("models.thinkingLevelMap")}</div>
                  <span className="d-grow" aria-hidden="true" />
                  {model.thinkingLevelMap && (
                    <DButton size="small" variant="ghost" onClick={() => set("thinkingLevelMap", undefined)}>
                      {t("models.clearAll")}
                    </DButton>
                  )}
                </div>
                <ThinkingLevelMapEditor
                  value={model.thinkingLevelMap}
                  onChange={(v) => set("thinkingLevelMap", v)}
                  describeLevel={describeThinkingLevel}
                />
                <div className="d-t-xs d-t-faint">{t("models.thinkingLevelMapHint")}</div>
                {rememberedThinking && (
                  <div className="models-thinking-memory d-row">
                    <span>{t("models.lastUsedThinking")}: <strong>{rememberedThinking}</strong></span>
                    <DButton size="small" variant="ghost" onClick={() => { void forgetRememberedThinking(); }}>
                      {t("models.forgetThinking")}
                    </DButton>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="d-set-sec">
        <div className="d-row">
          <div className="d-set-sec-t">{t("models.testConnection")}</div>
          <span className="d-grow" aria-hidden="true" />
          {testState.phase !== "idle" && (
            <DBadge tone={testState.phase === "error" ? "bad" : testState.phase === "success" ? "ok" : undefined}>
              {testSummary}
            </DBadge>
          )}
        </div>
        <div className="d-row">
          <DButton
            variant="primary"
            size="small"
            onClick={handleTest}
            disabled={!model.id.trim() || testState.phase === "testing"}
          >
            <i data-ico="circle-play" data-size="13" aria-hidden="true" />
            {testState.phase === "testing" ? t("i18n.checking") : t("models.sendTestRequest")}
          </DButton>
          <span className="d-grow" aria-hidden="true" />
          <DButton size="small" variant="ghost" disabled={testState.phase === "idle"} onClick={() => setTestState({ phase: "idle" })}>
            {t("models.clearTestResult")}
          </DButton>
          <DButton variant="danger" size="small" onClick={onDelete}>{t("models.deleteModel")}</DButton>
        </div>

        {testState.phase === "success" && testState.responseText && (
          <pre className="d-term plain models-test-echo">
            <span className="d-term-ok">{t("i18n.connected")}</span>
            {`\n${testState.responseText}`}
          </pre>
        )}
        {testState.phase === "error" && (
          <div className="d-banner err">{testState.message}</div>
        )}
      </div>
    </div>
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

  /* fork:v5-landing —— 画板 D-08 帧 A：登录 / 用量 / 可用模型都是 `.d-set-inner`
     里的 `.d-set-sec`；状态行用画板的弱化等宽行，错误走 `.d-banner.err`。 */
  return (
    <div className="d-set-inner">
      <div className="d-set-sec">
        <div className="d-row">
          <ProviderIcon id={provider.id} size={22} />
          <div className="d-set-sec-t">{provider.name}</div>
          <DBadge tone={provider.loggedIn ? "ok" : "mute"}>
            {provider.loggedIn ? t("models.badgeLoggedIn") : t("models.badgeNotLoggedIn")}
          </DBadge>
          <span className="d-grow" aria-hidden="true" />
          {isWorking ? (
            <DButton
              size="small"
              onClick={() => { eventSourceRef.current?.close(); setLoginState({ phase: "idle" }); }}
            >
              {t("i18n.cancel")}
            </DButton>
          ) : (
            <>
              <DButton variant="primary" size="small" onClick={handleLogin}>
                {provider.loggedIn ? t("i18n.relogin") : t("i18n.login")}
              </DButton>
              {provider.loggedIn && (
                <DButton variant="danger" size="small" onClick={handleLogout}>
                  {t("i18n.disconnect")}
                </DButton>
              )}
            </>
          )}
        </div>

        {/* 运行时才确定的高度：已登录且空闲时不占位，其余流程给足一行。 */}
        <div style={{ minHeight: provider.loggedIn && loginState.phase === "idle" ? 0 : 48 }}>
          {loginState.phase === "idle" && (
            !provider.loggedIn && (
              <div className="d-mono d-t-faint">
                Connect your {provider.name} account.
              </div>
            )
          )}
          {loginState.phase === "connecting" && (
            <div className="d-mono d-t-faint">{t("i18n.openingBrowser")}</div>
          )}
          {loginState.phase === "select" && (
            <div className="d-col">
              <div className="d-mono d-t-faint">
                {loginState.message}
              </div>
              <div className="d-col">
                {loginState.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className="d-menu-row"
                    onClick={() => submitSelection(loginState.token, option.id)}
                  >
                    <span className="d-grow">{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {(loginState.phase === "auth" || loginState.phase === "prompt") && (
            <div className="d-col">
              <div className="d-mono d-t-faint">
                {loginState.phase === "auth"
                  ? "Complete sign-in in the browser, then copy the redirect URL from the address bar and paste it below."
                  : loginState.message}
              </div>
              {loginState.phase === "auth" && (
                <div className="d-mono d-t-faint">
                  If the browser window did not open,{" "}
                  <a href={loginState.url} target="_blank" rel="noopener noreferrer" style={BREAKABLE_LINK}>
                    click here to open the login page
                  </a>
                  .
                </div>
              )}
              <div className="d-row">
                <input
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") submitCode(loginState.token, inputValue); }}
                  placeholder={loginState.phase === "auth" ? "http://localhost:1455/auth/callback?code=…" : (loginState.placeholder ?? "Enter value…")}
                  className="d-input d-mono"
                  style={FILL_ROW_INPUT}
                />
                <DButton
                  variant="primary"
                  onClick={() => submitCode(loginState.token, inputValue)}
                  disabled={!inputValue.trim()}
                >
                  {t("i18n.submit")}
                </DButton>
              </div>
            </div>
          )}
          {loginState.phase === "device_code" && (
            <div className="d-col">
              <div className="d-mono d-t-faint">
                Open the verification page and enter this code:
              </div>
              <div><span className="d-kbd">{loginState.userCode}</span></div>
              <div className="d-mono d-t-faint">
                <a href={loginState.verificationUri} target="_blank" rel="noopener noreferrer" style={BREAKABLE_LINK}>
                  {loginState.verificationUri}
                </a>
                {loginState.expiresInSeconds ? ` Expires in ${Math.ceil(loginState.expiresInSeconds / 60)} minutes.` : ""}
              </div>
            </div>
          )}
          {loginState.phase === "progress" && (
            <div className="d-mono d-t-faint">{loginState.message}</div>
          )}
          {loginState.phase === "success" && (
            <DBadge tone="ok">
              <i data-ico="check" data-size="11" aria-hidden="true" />
              {t("i18n.connectedSuccessfully")}
            </DBadge>
          )}
          {loginState.phase === "error" && (
            <div className="d-banner err">{loginState.message}</div>
          )}
        </div>
      </div>

    {isProviderUsageId(provider.id) && (
      <ProviderUsageSummary providerId={provider.id} enabled={provider.loggedIn} />
    )}

    <div className="d-set-sec">
      {provider.loggedIn
        ? <EnabledModelsSection providerId={provider.id} controller={enabledModels} />
        : <div className="d-t-xs d-t-faint">{t("models.signInToListModels")}</div>}
    </div>
    </div>
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

  /* fork:v5-landing —— 画板 D-08 帧 A：API Key 头卡 / 用量 / 可用模型都是
     `.d-set-inner` 里的 `.d-set-sec`。 */
  return (
    <div className="d-set-inner">
      <div className="d-set-sec">
        <div className="d-row">
          <div className="d-set-sec-t">API Key</div>
          <DBadge tone={provider.configured ? "ok" : "mute"}>
            {provider.configured ? t("i18n.configured") : t("i18n.notConfigured")}
          </DBadge>
          <span className="d-grow" aria-hidden="true" />
          {provider.configured && (
            <DButton
              variant="danger"
              size="small"
              onClick={handleRemove}
              disabled={removing}
            >
              {removing ? t("i18n.removing") : t("i18n.disconnect")}
            </DButton>
          )}
        </div>

        {!provider.configured && (
          <div className="d-t-xs d-t-faint">
            {t("models.apiKeyPrompt", { name: provider.displayName, count: provider.modelCount })}
          </div>
        )}
        <div className="d-row">
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
          <DButton
            variant="primary"
            onClick={handleSave}
            disabled={saving || !apiKey.trim() || savedOk}
          >
            {savedOk ? t("i18n.saved") : saving ? t("i18n.saving") : t("i18n.save")}
          </DButton>
        </div>

        {error ? <div className="d-banner err">{error}</div> : null}
      </div>

    {isProviderUsageId(provider.id) && (
      <ProviderUsageSummary providerId={provider.id} enabled={provider.configured} />
    )}

    <div className="d-set-sec">
      <EnabledModelsSection providerId={provider.id} controller={enabledModels} />
    </div>
    </div>
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

  /* fork:design-system —— 弹层列表换 `.d-col` + `d-menu-row` 行（图标 + 名称/副行），
     自绘卡片、hover JS、搜索图标 SVG 全部退役。覆盖层的 fixed/层级画板没有产品等价物
     （fork-ui 只给皮肤工作室接了线，z 顺序不能共用），保留这组行为 inline。
     壳 `.pw-modal` 见下方注释（移动 sheet 的 CSS 选择器依赖）。 */
  return (
    /* fork:pwa-models-skills —— `fork-pwa-ms-sheet` 是**本文件私有的**手机档钩子
       （app/pwa-models-skills.css）：≤640px 时这个选择器从 560px 的居中对话框变成
       全屏 sheet（顶部圆角 + 底部安全区留白）。壳的宽高是内联几何（`.pw-modal` 的
       width 与内容行的 max-height），覆盖写在 app/pwa-models-skills.css 的
       「sheet 一节」——该节用 `!important` 压内联，因为「手机上换成整片」这件事
       没法再写一段内联值来表达而桌面端不变。 */
    <div
      ref={dialogRef}
      {...dialogProps}
      aria-label={t("models.title")}
      className="fork-pwa-ms-sheet"
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "var(--scrim)", display: "grid", placeItems: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      {/* `pw-modal` 外壳保留（脚本侧依赖）：app/pwa-models-skills.css 的窄屏 sheet
          以 `.fork-pwa-ms-sheet > .pw-modal` / `> .pw-modal-body` 为选择器，
          删了会静默打断手机端 sheet；收尾波与那段移动 CSS 一并换 `d-modal`。
          壳内其余类已全部走 `d-*`。 */}
      <div className="pw-modal">
        {/* Search —— 画板 D-08 搜索行：图标 + 吃掉剩余宽度的输入框。 */}
        <div className="pw-modal-head">
          <i data-ico="search" data-size="14" aria-hidden="true" />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
             placeholder={t("i18n.searchProviders")}
            className="d-input"
            style={FILL_ROW_INPUT}
          />
        </div>

        {/* List —— 画板 50 的 pw-modal 是内容定高的确认框；这个选择器是长列表，
            滚动上边界是产品行为，留在行内。
            fork:pwa-models-skills —— 手机档把 72vh 换成 sheet 的整片可用高度，
            那条覆盖写在 app/pwa-models-skills.css（用 `!important` 压这条内联几何，
            理由见该文件「sheet 一节」）。 */}
        <div className="pw-modal-body" style={{ overflowY: "auto", maxHeight: "min(72vh, calc(100vh - 32px))" }}>
          {totalCount === 0 ? (
            <div className="d-empty compact">
              <p className="d-empty-s">{t("i18n.noProviders")}</p>
            </div>
          ) : (
            <div className="d-col">
              {showCustom && <ConfigSidebarGroupLabel>{t("i18n.custom")}</ConfigSidebarGroupLabel>}
              {showCustom && (
                <ConfigSidebarItem
                  onClick={() => { onAddCustom(); onClose(); }}
                >
                  <i data-ico="plus" data-size="14" aria-hidden="true" />
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
  /* fork:model-rename-save（上游 bd85004 #969，fixes #903）—— 供应商名输入框的草稿。
     只有它跟 provider 的 id 不同才非 null：Save 会把它当普通可见编辑一起落盘，
     Rename 按钮则立刻应用；面板自己持有它，所以 Save 看得见。 */
  const [providerNameDraft, setProviderNameDraft] = useState<{ provider: string; name: string } | null>(null);
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

  /** fork:model-rename-save — 在 draft 里搬一个 provider；id 已被占用时返回 null 且不记录。 */
  const applyProviderRename = useCallback((draft: ModelsJson, oldName: string, newName: string): ModelsJson | null => {
    const next = renameProviderEntry(draft, {
      savedProviders: savedProvidersRef.current,
      renames: renamesRef.current,
      slots: savedModelIdsRef.current,
    }, oldName, newName);
    if (!next) return null;
    setConfig(next);
    setProviderNameDraft(null);
    setSelection((prev) => {
      if (!prev) return prev;
      if (prev.type === "provider" && prev.name === oldName) return { type: "provider", name: newName };
      if (prev.type === "model" && prev.providerName === oldName) return { ...prev, providerName: newName };
      return prev;
    });
    return next;
  }, []);

  const renameProvider = useCallback((oldName: string, newName: string) => {
    if (applyProviderRename(config, oldName, newName)) setSaveError(null);
    else setSaveError(t("models.providerNameTaken", { name: newName }));
  }, [applyProviderRename, config, t]);

  const deleteProvider = useCallback((name: string) => {
    savedModelIdsRef.current.delete(name);
    setProviderNameDraft((prev) => prev?.provider === name ? null : prev);
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
        /* fork:model-discovery-specs —— 上游报上来的规格跟着一起进 models.json：
           私有网关 / vLLM / 自建端点在 models.dev 上查不到，`/models` 是唯一来源。
           没报的字段就不写（绝不写 0 —— 0 会被 pi 当成声明值）。 */
        const entry: ModelEntry = { id: discoveredModel.id };
        if (discoveredModel.name !== undefined) entry.name = discoveredModel.name;
        if (discoveredModel.contextWindow !== undefined) entry.contextWindow = discoveredModel.contextWindow;
        if (discoveredModel.maxTokens !== undefined) entry.maxTokens = discoveredModel.maxTokens;
        if (discoveredModel.input !== undefined) entry.input = [...discoveredModel.input];
        models.push(entry);
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
    // fork:model-rename-save —— 输入框里改了名但没点 Rename 的供应商，和其它可见编辑
    // 一样是「保存」的一部分：先把它搬完再写盘，enabledModels 才能跟着改名。
    let draft = config;
    const pendingName = providerNameDraft?.name.trim();
    if (providerNameDraft && pendingName && config.providers?.[providerNameDraft.provider]) {
      const renamed = applyProviderRename(config, providerNameDraft.provider, pendingName);
      if (!renamed) {
        setSaveError(t("models.providerNameTaken", { name: pendingName }));
        setSaving(false);
        return;
      }
      draft = renamed;
    }
    try {
      const res = await fetch("/api/models-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
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
        const modelRenames = collectModelRenames(draft, savedModelIdsRef.current, renamesRef.current);
        savedProvidersRef.current = new Set(Object.keys(draft.providers ?? {}));
        savedModelIdsRef.current = savedModelIds(draft);
        renamesRef.current.clear();
        enabledModels.resync(renames, modelRenames);
      }
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [applyProviderRename, config, enabledModels, loadError, providerNameDraft, t]);

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
          editingName={providerNameDraft?.provider === selection.name ? providerNameDraft.name : selection.name}
          provider={provider}
          onChange={(p) => updateProvider(selection.name, p)}
          onEditingNameChange={(n) => setProviderNameDraft(n === selection.name ? null : { provider: selection.name, name: n })}
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
          /* fork:pwa-models-skills —— `fork-pwa-ms-page` 是**本页的手机档作用域钩子**：
             app/pwa-models-skills.css 的每条窄屏规则都从「页头动作区里有这个类」出发
             （`.pw-shead:has(.fork-pwa-ms-page) ~ …`），因为 `.pw-shead` / `.pw-stools` /
             `.pw-scontent` / `.pw-cols` 全是 SettingsUi 的**共享基件**——不挂钩子就没法
             只改模型页而不波及插件 / 子代理分节。全仓只有本页与 SkillsConfig 发这个类。
             `fork-pwa-ms-models` 是同页专属的细分钩子（技能页是 fork-pwa-ms-skills）。 */
          <>
            <DButton
              variant="secondary"
              size="small"
              className="fork-pwa-ms-page fork-pwa-ms-models"
              onClick={() => setPickerOpen(true)}
            >
              <i data-ico="plus" data-size="13" aria-hidden="true" />
              {t("models.addProvider")}
            </DButton>
            <DButton
              variant="primary"
              size="small"
              onClick={handleSave}
              disabled={saving || savedOk || loadError !== null}
              className={savedOk ? "is-success" : undefined}
            >
              {savedOk && (
                /* 保存成功的对勾：画板 `<i data-ico>`；settings.css 的
                   .config-button-success-icon 继续提供描画动画（行为钩子，保留）。 */
                <span className="config-button-success-icon">
                  <i data-ico="check" data-size="14" aria-hidden="true"></i>
                </span>
              )}
              <span>{savedOk ? t("i18n.saved") : saving ? t("i18n.saving") : t("i18n.save")}</span>
            </DButton>
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
          <span className="d-grow" aria-hidden="true" />
            {loadError || saveError || saveWarnings.length > 0 ? (
              <span style={{ color: loadError || saveError ? "var(--error)" : "var(--warning)" }}>
                {loadError
                  ? t("models.configUnreadable", { error: loadError })
                  : saveError ?? t("models.builtinOverrideWarning", { models: saveWarnings.join(", ") })}
              </span>
            ) : null}
            <DBadge tone="count">{t("models.providerCount", { count: String(visibleOAuth.length + visibleApiKey.length + visibleProviders.length) })}</DBadge>
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
                <p className="d-t-xs d-t-faint">{t("i18n.loading")}</p>
              ) : loadError ? (
                /* 读不出 models.json ≠ 库是空的：空态那句「还没有供应商」会把用户
                   引去「添加供应商」，而保存已被禁用（见页头）。只报现状。 */
                <p className="d-t-xs d-t-faint">{t("models.listUnreadable")}</p>
              ) : !hasVisibleRows ? (
                /* fork:settings-frame（画板 62 帧 D）—— 「列表空」落在**列表列内**：
                   方框图标 + 一句，不折行；过滤无结果与「一个供应商都没有」都不再
                   静默留白。「先加供应商」的入口常驻页头右端（画板 41 的页级动作），
                   空态本体只负责点名现状：有过滤词是选择器同款「没有匹配的
                   Provider」；空库用 models.listEmpty + listEmptyHint 第二句。 */
                <div className="d-empty compact">
                  <span className="d-empty-ico"><i data-ico="server" data-size="16" aria-hidden="true" /></span>
                  <p className="d-empty-t">{needle ? t("i18n.noProviders") : t("models.listEmpty")}</p>
                  {!needle && <p className="d-empty-s">{t("models.listEmptyHint")}</p>}
                </div>
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
                    <DBadge tone="ok">{t("models.badgeLoggedIn")}</DBadge>
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
                    <DBadge tone="ok">{t("models.badgeLoggedIn")}</DBadge>
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
                            <ConfigSidebarText className={m.id ? undefined : "d-t-faint"}>
                               {m.id || t("i18n.newModel")}
                            </ConfigSidebarText>
                          </span>
                          {m.reasoning && (
                            <DBadge tone="info">T</DBadge>
                          )}
                          {/* fork:fix-nested-button — 收藏星**不能**是真 `<button>`：行本体
                              `ConfigSidebarItem` 渲染的就是 `<button class="d-trow">`（窄屏是 `m-trow`，
                              见 components/SettingsUi.tsx），而 HTML 解析器
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
                            className="d-iconbtn"
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
                            <i
                              data-ico="star"
                              data-size="13"
                              aria-hidden="true"
                              style={{ color: isFavorite ? "var(--nx-accent)" : "var(--nx-text-3)", opacity: favoriteKey ? 1 : 0.35 }}
                            ></i>
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

          {/* Right: v5 D-08 的内容列是 `.d-set-inner`（一列 `.d-set-sec` 分节），
              不再套一张撑满高度的巨卡 —— 那是「弹窗影子」的来源。 */}
          <div className="d-set-inner">
            {loading ? null : detailContent ?? (
              /* fork:settings-frame（画板 62 帧 D）—— 「详情未选」：方框图标 + 一句引导。 */
              <div className="d-empty compact">
                <span className="d-empty-ico"><i data-ico="square-mouse-pointer" data-size="16" aria-hidden="true" /></span>
                <p className="d-empty-t">{t("models.detailEmpty")}</p>
              </div>
            )}
          </div>
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
