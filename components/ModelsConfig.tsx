"use client";

/* 设置 → 模型。形态照抄参考项目 pi-web-main 的 `components/ModelsConfig.tsx`：
   **一个列表页 + 一层钻入**（供应商 → 模型），列表页一眼看完，钻入页按
   「连接 / 端点 / 模型」三段摆。类名按本仓设计系统映射到 `d-*`，图标只走 lucide。

   与参考项目的接口差异（本仓为准，服务端不动）：
   · 参考项目读 `/api/models-config/runtime`（catalog + builtIn）与
     `/api/models-config/picker`（enabledModels 的读写）。本仓这两份是
     `/api/models?cwd=` 与 `/api/models/enabled`，所以「运行时目录」一律走
     `useEnabledModels()` 返回的 `view.providers[].models[]`。
   · 参考项目能给内置目录里的模型写 `modelOverrides`（那需要 runtime 的完整
     字段）。本仓的 enabled 视图只给 `{id,name,ref,enabled,thinkingPin}`，所以
     **只有 models.json 里的定义可编辑**；目录模型只带聊天开关，见交付报告。 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useDialogA11y } from "@/hooks/useDialogA11y";
// fork:input-limits —— pi-ai 原生的 `inputLimits` / `promptCache` 类型（见 ModelEntry）。
import type { ModelInputLimits, ModelPromptCache } from "@earendil-works/pi-ai";
import type { ModelCatalogPreset, ModelCatalogRecommendation } from "@/lib/model-catalog";
import type { DiscoveredModel } from "@/lib/model-discovery";
// 用量概览：本机日志的口径（/api/usage-stats）。
import type { ModelsData, ThinkingProfileInputs } from "@/lib/models-cache";
import { describeThinkingRequestFromFields, type ThinkingModelFields } from "@/lib/thinking-request-core";
// fork:pr17-favorites —— 与输入框模型选择器共用同一份 store；增删在选择器里，这里只读。
import {
  getFavoriteModelsServerSnapshot,
  getFavoriteModelsSnapshot,
  subscribeFavoriteModels,
} from "@/lib/favorite-models";
// fork:model-roles —— 「命名模型」写的是 General 页同一份 localStorage 偏好。
import { clearTitleModel, getTitleModel, setTitleModel } from "@/lib/title-settings";
import { getLastSettingsSelection, setLastSettingsSelection } from "@/lib/settings-navigation";
import { isProviderUsageId } from "@/lib/provider-usage-ids";
import {
  CHECKBOX_CONTROL,
  compatFlagState,
  compatFlagsForApi,
  countUnknownCompatKeys,
  formatThinkingRequestParams,
  hasModelCostDraftValue,
  hasModelCostTierDraftValue,
  modelApiChoices,
  modelCostTierToDraft,
  modelCostToDraft,
  parseCompleteModelCost,
  parseModelCostTier,
  parseModelCostTiers,
  serializeHeaderRows,
  setCompatBool,
  setCompatFlag,
  updateHeaderRow,
  type CompatFlagState,
  type HeaderRow,
  type ModelCostDraft,
  type ModelCostKey,
  type ModelCostTier,
  type ModelCostTierDraft,
} from "./models-config-helpers";
import { ModelInputLimitsFields } from "./ModelLimitsFields";
import {
  ConfigBadge,
  ConfigButton,
  ConfigEmptyState,
  ConfigPanelShell,
  ConfigSidebarSub,
  ConfigSidebarText,
  ConfigSwitch,
  PwSelectBox,
  SettingsPage,
} from "./SettingsUi";
import { useCatalogRefresh, useEnabledModels } from "./EnabledModelsSection";
import type { EnabledModelsModelView, EnabledModelsView } from "@/lib/enabled-models";
import { ChatModelsPicker } from "./ChatModelsPicker";
import { findProviderView, isLastEnabledModel, providerBadgeLabel } from "./enabled-models-helpers";
import { ProviderIcon } from "./ProviderIcon";
import { ProviderUsageSummary } from "./ProviderUsageSummary";

// ── v5 基件（`.d-*`，几何全在 design/v5/web/system.css）───────────────────────

/** `.d-field`：标签在上、控件在中、hint 在下。 */
function DField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="d-field">
      <span className="d-field-t">{label}</span>
      {children}
      {hint ? <div className="d-t-xs d-t-faint">{hint}</div> : null}
    </div>
  );
}

/** 分节头：标题 + 一句说明 + 右端动作（参考项目 `SectionHeading` 的 d-* 映射）。 */
function SectionHeading({ title, hint, actions }: { title: ReactNode; hint?: string; actions?: ReactNode }) {
  return (
    <div className="d-row">
      <div className="d-col d-grow">
        <div className="d-set-sec-t">{title}</div>
        {hint ? <div className="d-t-xs d-t-faint">{hint}</div> : null}
      </div>
      {actions ? <span className="d-row">{actions}</span> : null}
    </div>
  );
}

/** `.d-banner`：只在有话要说的时候出现，列表页与钻入页共用一份。 */
function Notice({ tone = "info", children, action }: {
  tone?: "info" | "warn" | "err"; children: ReactNode; action?: ReactNode;
}) {
  return (
    <div className={`d-banner${tone === "info" ? "" : ` ${tone}`}`} role={tone === "err" ? "alert" : "status"}>
      {children}
      {action}
    </div>
  );
}

/** 分段控件（参考项目 `models-segmented` → `.d-seg`）。 */
function DSeg({ value, options, ariaLabel, onChange }: {
  value: string;
  options: readonly { value: string; label: string; title?: string }[];
  ariaLabel: string;
  onChange: (next: string) => void;
}) {
  return (
    <span className="d-seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          title={option.title}
          className={option.value === value ? "is-on" : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

/** 一行可点的设置卡（`.d-setcard`）：点开钻入，右端留给状态徽标。 */
function OpenCard({ onClick, title, icon, children }: {
  onClick: () => void; title: string; icon?: ReactNode; children?: ReactNode;
}) {
  return (
    <button type="button" className="d-setcard" title={title} onClick={onClick}>
      {icon}
      {children}
      <span className="d-grow" aria-hidden="true" />
      <i data-ico="chevron-right" data-size="14" aria-hidden="true" />
    </button>
  );
}

// ── 表单控件 ───────────────────────────────────────────────────────────────────

/** 一行输入吃掉整行剩余宽度（画板搜索行 / 密钥行共用）。 */
const FILL_ROW_INPUT = { flex: 1, minWidth: 0 } as const;
/** 画板没有复选框基件，勾选框的几何只能留在这几个调用点。 */
const BREAKABLE_LINK = { color: "var(--accent)", wordBreak: "break-all" } as const;

function TextInput({ value, onChange, placeholder, mono, disabled }: {
  value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; disabled?: boolean;
}) {
  return (
    <input
      className={mono ? "d-input d-mono" : "d-input"}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
    />
  );
}

function SecretTextInput({ value, onChange, placeholder, onKeyDown }: {
  value: string; onChange: (v: string) => void; placeholder?: string; onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  const [visible, setVisible] = useState(false);
  const { t } = useI18n();
  useEffect(() => { if (!value) setVisible(false); }, [value]);
  return (
    <div className="d-row">
      <input
        type={visible ? "text" : "password"}
        className="d-input d-mono"
        style={FILL_ROW_INPUT}
        value={value}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        className="d-iconbtn"
        onClick={() => setVisible((current) => !current)}
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
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** 协议下拉：显示人话，落盘仍是内部 id（`MODEL_API_LABELS` 是它的唯一来源）。 */
function Select({ value, onChange, options, required, ariaLabel }: {
  value: string; onChange: (v: string) => void; options: readonly (string | { value: string; label: string })[];
  required?: boolean; ariaLabel: string;
}) {
  const { t } = useI18n();
  const choices = [
    ...(required ? [] : [{ value: "", label: `— ${t("i18n.default")} —` }]),
    ...options.map((option) => (typeof option === "string" ? { value: option, label: option } : option)),
  ];
  return <PwSelectBox value={value} options={choices} ariaLabel={ariaLabel} onChange={onChange} />;
}

const API_OPTIONS = modelApiChoices();

// ── 类型 ──────────────────────────────────────────────────────────────────────

interface OAuthProvider {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
  supportsApiKey?: boolean;
}

interface ApiKeyProvider {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  supportsOAuth?: boolean;
}

interface ModelEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  inputLimits?: ModelInputLimits;
  promptCache?: ModelPromptCache;
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; tiers?: ModelCostTier[] };
  headers?: Record<string, string>;
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
}

interface ModelsJson {
  providers?: Record<string, ProviderEntry>;
  /** Present only on a malformed read; saving stays disabled while it is set. */
  error?: string;
}

type ModelTestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "success"; latencyMs?: number; status?: number; responseText?: string }
  | { phase: "error"; message: string; latencyMs?: number; status?: number };

type ModelCatalogState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; recommendation: ModelCatalogRecommendation; appliedCount: number }
  | { phase: "error"; message: string };

type ModelDiscoveryState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "success"; models: DiscoveredModel[]; endpoint: string }
  | { phase: "error"; message: string };

/** Which page is on screen. `provider: null` is always the provider list. */
interface View {
  provider: string | null;
  /** Index into that provider's models.json `models[]`. */
  modelIndex?: number;
}

function readRememberedView(): View {
  const raw = getLastSettingsSelection("models");
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const value = parsed as Record<string, unknown>;
        if (value.provider === null || typeof value.provider === "string") {
          return {
            provider: value.provider as string | null,
            ...(typeof value.modelIndex === "number" && Number.isInteger(value.modelIndex) && value.modelIndex >= 0
              ? { modelIndex: value.modelIndex }
              : {}),
          };
        }
      }
    } catch {
      // Malformed browser state: fall through to the provider list.
    }
  }
  return { provider: null };
}

// ── 行内徽标 ──────────────────────────────────────────────────────────────────

/** `1M` / `262.1K`：模型行上那枚上下文窗口徽标。 */
function formatContextWindowBadge(contextWindow?: number): string | null {
  if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 0) return null;
  if (contextWindow >= 1_000_000) {
    const m = contextWindow / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (contextWindow >= 1000) return `${(contextWindow / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(contextWindow);
}

function formatTokenLimit(value: number): string {
  return value >= 1_000_000 ? `${value / 1_000_000}M` : `${Math.round(value / 1000)}k`;
}

/* fork:model-row-inline —— 模型行的 🔌 测试与编辑器里的那枚是**同一次调用**；
   状态机留在调用方（行内只关心「这一行正在测」），网络那一段共用。 */
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
      ok?: boolean; error?: string; latencyMs?: number; status?: number; responseText?: string;
    };
    if (!res.ok || !d.ok) {
      return { phase: "error", message: d.error ?? `HTTP ${res.status}`, latencyMs: d.latencyMs, status: d.status };
    }
    return { phase: "success", latencyMs: d.latencyMs, status: d.status, responseText: d.responseText };
  } catch (error) {
    return { phase: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

// ── 思考档位映射 ──────────────────────────────────────────────────────────────

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevel = typeof THINKING_LEVELS[number];

// 七档只用设计允许的色相；深浅由 token 自己跟主题走。
const LEVEL_COLORS: Record<ThinkingLevel, string> = {
  off: "var(--text-dim)",
  minimal: "var(--n-muted)",
  low: "var(--accent-text)",
  medium: "var(--accent)",
  high: "var(--accent-hover)",
  xhigh: "var(--warning)",
  max: "var(--danger)",
};

type ThinkingLevelState = "omit" | "null" | "string";

function ThinkingLevelMapEditor({ value, onChange, describeLevel }: {
  value: Record<string, string | null> | undefined;
  onChange: (v: Record<string, string | null> | undefined) => void;
  /** fork:upstream-0.9.2-thinking-profile —— 该档实际会发的请求参数。 */
  describeLevel?: (level: string) => { text: string | null; invalid?: string } | null;
}) {
  const { t } = useI18n();
  const map = value ?? {};
  const setLevel = (level: ThinkingLevel, entry: string | null | "omit") => {
    const next = { ...map };
    if (entry === "omit") delete next[level];
    else next[level] = entry;
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div className="d-col">
      {THINKING_LEVELS.map((level) => {
        const raw = map[level];
        const state: ThinkingLevelState = !(level in map) ? "omit" : raw === null ? "null" : "string";
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
                <span className={state === "null" ? "d-mono d-t-faint" : "d-mono"}>{level}</span>
              </div>
              {described ? (
                <div className="d-set-row-s" style={invalid ? { color: "var(--nx-danger)" } : undefined}>
                  {invalid ? described.invalid : described.text ?? t("models.thinkingSendsNothing")}
                </div>
              ) : null}
            </div>
            <span className="d-grow-last d-row">
              <DSeg
                value={state}
                ariaLabel={level}
                options={[
                  { value: "omit", label: t("models.levelDefault") },
                  { value: "null", label: t("models.levelDisabled") },
                  { value: "string", label: t("models.levelCustom") },
                ]}
                onChange={(next) => setLevel(level, next === "omit" ? "omit" : next === "null" ? null : strVal || level)}
              />
              {state === "string" && (
                <input
                  className="d-input d-mono"
                  value={strVal}
                  maxLength={10}
                  placeholder={level}
                  onChange={(event) => setLevel(level, event.target.value)}
                />
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── 兼容性开关 ────────────────────────────────────────────────────────────────

const DEEPSEEK_COMPAT = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
} as const;

function hasDeepseekCompat(model: ModelEntry): boolean {
  return model.compat?.thinkingFormat === "deepseek";
}

function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } };
  if (!model.compat) return model;
  const rest = { ...model.compat };
  delete rest.thinkingFormat;
  delete rest.requiresReasoningContentOnAssistantMessages;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

/**
 * Compat 可以配在 provider 或 model 上，运行时按「model 覆盖 provider」合并。
 * 这里读的是合并后的**生效值**，写入只落在 model 条目上，覆盖是显式的。
 */
function effectiveCompat(provider: ProviderEntry, model: ModelEntry): Record<string, unknown> {
  return { ...(provider.compat ?? {}), ...(model.compat ?? {}) };
}

/* fork:compat-flags (B5) —— 三态而不是两态：Default（不写键，跟随 pi 默认或按
   baseUrl 自动探测）/ On（写 true）/ Off（写 false）。两态会把「跟随探测」与
   「显式打开」混成同一个值。 */
const COMPAT_FLAG_STATE_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
] as const satisfies readonly { value: CompatFlagState; label: string }[];

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
      {specs.map((spec) => (
        <div key={spec.key} className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t(spec.labelKey)}</div>
            <div className="d-set-row-s">
              {spec.defaultValue === null
                ? t("models.compatDefaultAuto")
                : t("models.compatDefaultValue", { value: String(spec.defaultValue) })}
            </div>
          </div>
          <span className="d-grow-last">
            <DSeg
              value={compatFlagState(compat, spec)}
              ariaLabel={t(spec.labelKey)}
              options={COMPAT_FLAG_STATE_OPTIONS}
              onChange={(next) => onChange(spec.key, next as CompatFlagState)}
            />
          </span>
        </div>
      ))}
      {countUnknownCompatKeys(compat, specs) > 0 && (
        /* 枚举 / 对象 / 手改 JSON 写进来的键：报个数，不假装能编辑。 */
        <div className="d-t-xs d-t-faint">
          {t("models.compatOtherKeys", { count: countUnknownCompatKeys(compat, specs) })}
        </div>
      )}
    </div>
  );
}

// ── Header / 采样参数 / 阶梯定价 ───────────────────────────────────────────────

function HeaderListEditor({ headers, onChange }: {
  headers: Record<string, string> | undefined;
  onChange: (h: Record<string, string> | undefined) => void;
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState<HeaderRow[]>(() => Object.entries(headers ?? {}).map(
    ([name, value], id) => ({ id, name, value }),
  ));
  const nextRowIdRef = useRef(rows.length);
  // 空行不落盘：没有名字的行不是合法的 HTTP 头。
  const apply = (next: HeaderRow[]) => {
    setRows(next);
    onChange(serializeHeaderRows(next));
  };

  return (
    <div className="d-col">
      {rows.length > 0 && (
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
                      className="d-input d-mono"
                      value={row.name}
                      placeholder="Header-Name"
                      onChange={(event) => apply(updateHeaderRow(rows, row.id, { name: event.target.value }))}
                    />
                  </td>
                  <td>
                    <input
                      className="d-input d-mono"
                      value={row.value}
                      placeholder="value"
                      onChange={(event) => apply(updateHeaderRow(rows, row.id, { value: event.target.value }))}
                    />
                  </td>
                  <td>
                    <ConfigButton
                      variant="ghost"
                      size="small"
                      aria-label={t("i18n.delete")}
                      title={t("i18n.delete")}
                      onClick={() => apply(rows.filter((entry) => entry.id !== row.id))}
                    >
                      <i data-ico="trash-2" data-size="14" aria-hidden="true" />
                    </ConfigButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="d-row">
        <ConfigButton
          size="small"
          onClick={() => setRows((current) => [...current, { id: nextRowIdRef.current++, name: "", value: "" }])}
        >
          <i data-ico="plus" data-size="13" aria-hidden="true" />
          {t("models.addHeader")}
        </ConfigButton>
      </div>
    </div>
  );
}

/**
 * fork:models-presets —— `samplingParams` 是 models.json 里真正的「高级参数」入口
 * （temperature / top_p…，pi 会把它并进请求参数）。值类型不受限，所以用 JSON 而不是
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
    <div className="d-col">
      <textarea
        className="d-textarea"
        value={editing ? draft : serialized}
        rows={2}
        spellCheck={false}
        placeholder={'{ "temperature": 0.7 }'}
        aria-invalid={error !== null}
        style={{ minHeight: 0, whiteSpace: "pre" }}
        onFocus={() => { setDraft(serialized); setEditing(true); }}
        onChange={(event) => { setDraft(event.target.value); setError(null); }}
        onBlur={commit}
      />
      {error && <div role="alert" className="d-err">{error}</div>}
    </div>
  );
}

/* fork:cost-tiers (B3) —— 阶梯定价编辑器：pi-ai 的 `ModelCostTier` 是「输入 tokens
   超过阈值后整笔改用这组价格」，`calculateCost()` 取最高匹配的阈值。清空就删键，
   不留 `tiers: []`。 */
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
  const [drafts, setDrafts] = useState<ModelCostTierDraft[]>(() => tiers.map(modelCostTierToDraft));
  // 已保存的档变了（撤销目录回填 / 换模型）就重新起草。
  useEffect(() => { setDrafts(tiers.map(modelCostTierToDraft)); }, [tiers]);

  const apply = (next: ModelCostTierDraft[]) => {
    setDrafts(next);
    onChange(parseModelCostTiers(next));
  };

  return (
    <div className="d-col">
      {drafts.map((draft, index) => (
        <div key={index} className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("models.costTierAbove")}</div>
            <div className="d-set-row-s">
              {t("models.costTierAboveHint", { value: formatTokenLimit(Number(draft.inputTokensAbove) || 0) })}
            </div>
          </div>
          <span className="d-grow-last d-row">
            <input
              type="number"
              min={1}
              className="d-input d-mono"
              value={draft.inputTokensAbove}
              aria-label={t("models.costTierAbove")}
              onChange={(event) => apply(drafts.map((entry, i) => (
                i === index ? { ...entry, inputTokensAbove: event.target.value } : entry
              )))}
            />
            {COST_TIER_RATE_FIELDS.map(({ key, label }) => (
              <input
                key={key}
                type="number"
                min={0}
                step="any"
                className="d-input d-mono"
                value={draft[key]}
                placeholder={label}
                aria-label={`${t("models.costTierPrice")}: ${label}`}
                onChange={(event) => apply(drafts.map((entry, i) => (
                  i === index ? { ...entry, [key]: event.target.value } : entry
                )))}
              />
            ))}
            <ConfigButton
              variant="ghost"
              size="small"
              aria-label={t("i18n.delete")}
              title={t("i18n.delete")}
              onClick={() => apply(drafts.filter((_, i) => i !== index))}
            >
              <i data-ico="trash-2" data-size="14" aria-hidden="true" />
            </ConfigButton>
          </span>
        </div>
      ))}
      {drafts.some((draft) => hasModelCostTierDraftValue(draft) && !parseModelCostTier(draft)) && (
        <div aria-live="polite" className="d-t-xs d-t-faint" style={{ color: "var(--nx-warning)" }}>
          {t("models.costTierInvalid")}
        </div>
      )}
      <div className="d-row">
        <ConfigButton
          variant="ghost"
          size="small"
          onClick={() => apply([...drafts, { inputTokensAbove: "", input: "", output: "", cacheRead: "", cacheWrite: "" }])}
        >
          <i data-ico="plus" data-size="13" aria-hidden="true" />
          {t("models.costTierAdd")}
        </ConfigButton>
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
  if (!model.name?.trim() && preset.name) { next.name = preset.name; appliedCount += 1; }
  if (model.reasoning === undefined && preset.reasoning === true) { next.reasoning = true; appliedCount += 1; }
  if (!model.input?.length && preset.input?.length) { next.input = [...preset.input]; appliedCount += 1; }
  if (model.contextWindow === undefined && preset.contextWindow !== undefined) {
    next.contextWindow = preset.contextWindow;
    appliedCount += 1;
  }
  if (model.maxTokens === undefined && preset.maxTokens !== undefined) { next.maxTokens = preset.maxTokens; appliedCount += 1; }
  if (preset.cost) {
    const cost = { ...(model.cost ?? {}) };
    let filled = 0;
    for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
      if (cost[key] === undefined && preset.cost[key] !== undefined) { cost[key] = preset.cost[key]; filled += 1; }
    }
    const completeCost = parseCompleteModelCost(modelCostToDraft(cost));
    if (filled > 0 && completeCost) { next.cost = { ...cost, ...completeCost }; appliedCount += filled; }
  }
  return { model: next, appliedCount };
}

// ── 端点表单（models.json 的 provider 段）─────────────────────────────────────

/**
 * The provider-level part of a models.json entry: where and how to call it.
 * A built-in provider's entry is only an override, so every field is optional and
 * blank means "use the built-in default".
 */
function EndpointForm({ providerId, provider, builtIn, onChange }: {
  /** The provider id, which keys models.json, auth.json and enabledModels. */
  providerId: string;
  provider: ProviderEntry;
  builtIn: boolean;
  onChange: (p: ProviderEntry) => void;
}) {
  const { t } = useI18n();
  const set = <K extends keyof ProviderEntry>(key: K, value: ProviderEntry[K]) => onChange({ ...provider, [key]: value });

  return (
    <div className="d-grid2">
      <DField label={t("models.baseUrl")}>
        <TextInput
          mono
          value={provider.baseUrl ?? ""}
          placeholder="https://api.example.com/v1"
          onChange={(value) => set("baseUrl", value || undefined)}
        />
      </DField>
      <DField label={t("models.apiLabel")}>
        <Select
          required={!builtIn}
          ariaLabel={t("models.apiLabel")}
          value={provider.api ?? (builtIn ? "" : "openai-completions")}
          options={API_OPTIONS}
          onChange={(value) => set("api", builtIn ? (value || undefined) : value)}
        />
      </DField>
      <DField label={t("models.apiKeyLabel")}>
        <SecretTextInput
          value={provider.apiKey ?? ""}
          placeholder="ENV_VAR_NAME, !shell-command, or literal key"
          onChange={(value) => set("apiKey", value || undefined)}
        />
      </DField>
      <DField label={t("models.headers")}>
        <HeaderListEditor headers={provider.headers} onChange={(headers) => set("headers", headers)} />
      </DField>
      <div className="d-t-xs d-t-faint" style={{ gridColumn: "1 / -1" }}>
        {t("models.providerIdHint", { id: providerId })}
      </div>
    </div>
  );
}

// ── 上游导入 ──────────────────────────────────────────────────────────────────

/** Fetches the endpoint's model list and appends the picked ids as definitions. */
function ModelDiscovery({ providerId, provider, onAddModels, onClose }: {
  providerId: string;
  provider: ProviderEntry;
  onAddModels: (models: DiscoveredModel[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<ModelDiscoveryState>({ phase: "idle" });
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const requestIdRef = useRef(0);
  const selectShownRef = useRef<HTMLInputElement>(null);

  const discover = useCallback(async () => {
    if (state.phase === "loading") return;
    const requestId = ++requestIdRef.current;
    setState({ phase: "loading" });
    setSelected([]);
    try {
      const res = await fetch("/api/models-config/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName: providerId, provider: { ...provider, models: undefined } }),
      });
      const data = await res.json() as { models?: DiscoveredModel[]; endpoint?: string; error?: string };
      if (requestId !== requestIdRef.current) return;
      if (!res.ok || data.error || !data.models) {
        setState({ phase: "error", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ phase: "success", models: data.models, endpoint: data.endpoint ?? provider.baseUrl ?? "" });
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [state.phase, providerId, provider]);

  // Fetch on open, and again whenever the endpoint it would call changes.
  // The callback closes over the whole provider entry, so depending on it would
  // re-fetch on every keystroke of an unrelated field.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void discover(); }, [providerId, provider.baseUrl, provider.api, provider.apiKey]);

  const existingIds = new Set((provider.models ?? []).map((model) => model.id));
  const discovered = state.phase === "success" ? state.models : [];
  const needle = query.trim().toLocaleLowerCase();
  const shown = discovered.filter((model) => !needle
    || model.id.toLocaleLowerCase().includes(needle)
    || model.name?.toLocaleLowerCase().includes(needle)).slice(0, 300);
  const selectableIds = shown.filter((model) => !existingIds.has(model.id)).map((model) => model.id);
  const selectedCount = selected.filter((id) => !existingIds.has(id)).length;
  const allShownSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.includes(id));
  const someShownSelected = !allShownSelected && selectableIds.some((id) => selected.includes(id));

  useEffect(() => { if (selectShownRef.current) selectShownRef.current.indeterminate = someShownSelected; }, [someShownSelected]);

  const specsOf = (model: DiscoveredModel): string | null => {
    const parts: string[] = [];
    if (model.contextWindow) parts.push(t("models.specsContextShort", { value: formatTokenLimit(model.contextWindow) }));
    if (model.maxTokens) parts.push(t("models.specsOutputShort", { value: formatTokenLimit(model.maxTokens) }));
    if (model.input?.includes("image")) parts.push(t("models.specsImageShort"));
    return parts.length ? parts.join(" · ") : null;
  };

  return (
    <div className="d-col">
      {state.phase === "loading" && <div className="d-t-xs d-t-faint">{t("models.discoveryFetching")}</div>}
      {state.phase === "error" && (
        <Notice tone="err" action={
          <ConfigButton size="small" className="d-banner-btn" onClick={() => void discover()}>{t("models.retry")}</ConfigButton>
        }>
          {state.message}
        </Notice>
      )}
      {state.phase === "success" && (
        <>
          <input
            className="d-input"
            value={query}
            placeholder={t("models.discoveryFilterPlaceholder", { count: state.models.length })}
            aria-label={t("models.discoveryFilter")}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="d-card">
            <label className="d-row models-discovery-row models-discovery-head">
              <input
                ref={selectShownRef}
                type="checkbox"
                style={CHECKBOX_CONTROL}
                checked={allShownSelected}
                disabled={selectableIds.length === 0}
                onChange={() => setSelected((current) => {
                  const ids = new Set(selectableIds);
                  return current.filter((id) => !ids.has(id)).concat(
                    allShownSelected ? [] : selectableIds.filter((id) => !current.includes(id)),
                  );
                })}
              />
              <span className="d-t-b">{t("models.discoverySelectShown")}</span>
            </label>
            {shown.length === 0 ? (
              <div className="d-t-xs d-t-faint models-discovery-row">{t("models.discoveryNoMatches")}</div>
            ) : shown.map((model) => {
              const alreadyAdded = existingIds.has(model.id);
              const specs = specsOf(model);
              return (
                <label key={model.id} className={`d-row models-discovery-row${alreadyAdded ? " is-added" : ""}`}>
                  <input
                    type="checkbox"
                    style={CHECKBOX_CONTROL}
                    checked={alreadyAdded || selected.includes(model.id)}
                    disabled={alreadyAdded}
                    onChange={() => setSelected((current) => (current.includes(model.id)
                      ? current.filter((id) => id !== model.id)
                      : [...current, model.id]))}
                  />
                  <span className="d-col d-grow">
                    <span className="d-t-b">{model.name ?? model.id}</span>
                    <span className="d-t-xs d-t-faint">{model.id}{specs ? ` · ${specs}` : ""}</span>
                  </span>
                  {alreadyAdded && <ConfigBadge tone="mute">{t("models.discoveryAdded")}</ConfigBadge>}
                </label>
              );
            })}
          </div>
          <div className="d-row">
            <span className="d-mono d-t-faint d-grow" title={state.endpoint}>
              {needle && shown.length < discovered.length
                ? t("models.discoveryShowing", { shown: shown.length, total: discovered.length })
                : t("models.discoveryFetched", { count: state.models.length })}
            </span>
            <ConfigButton
              variant="primary"
              size="small"
              disabled={selectedCount === 0}
              onClick={() => {
                const picked = new Set(selected);
                const additions = state.models.filter((model) => picked.has(model.id) && !existingIds.has(model.id));
                if (additions.length > 0) onAddModels(additions);
                setSelected([]);
              }}
            >
              {selectedCount
                ? t("models.discoveryAddSelectedCount", { count: selectedCount })
                : t("models.discoveryAddSelected")}
            </ConfigButton>
          </div>
        </>
      )}
      <div className="d-row">
        {/* 这一枚关的是页内那一层（导入清单），不是设置面板本身。 */}
        <ConfigButton size="small" variant="ghost" onClick={() => onClose()}>{t("i18n.close")}</ConfigButton>
      </div>
    </div>
  );
}

// ── 模型详情 ──────────────────────────────────────────────────────────────────

function ModelDetail({ providerName, provider, model, onChange, onDelete, cwd }: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
  onChange: (m: ModelEntry) => void;
  onDelete: () => void;
  /** The project cwd; `/api/models` only answers for an allowed root. */
  cwd: string | null;
}) {
  const { t } = useI18n();
  const [testState, setTestState] = useState<ModelTestState>({ phase: "idle" });
  const [catalogState, setCatalogState] = useState<ModelCatalogState>({ phase: "idle" });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rememberedThinking, setRememberedThinking] = useState<string | null>(null);
  const [thinkingInputs, setThinkingInputs] = useState<ThinkingProfileInputs | null>(null);
  const [costEditing, setCostEditing] = useState(false);
  const [costDraft, setCostDraft] = useState<ModelCostDraft>(() => modelCostToDraft(model.cost));
  const costDraftRef = useRef(costDraft);
  const costTemplateRef = useRef(model.cost);
  const catalogRequestIdRef = useRef(0);
  const catalogUndoRef = useRef<ModelEntry | null>(null);

  const set = <K extends keyof ModelEntry>(key: K, value: ModelEntry[K]) => onChange({ ...model, [key]: value });
  const thinkingMemoryKey = model.id ? `${providerName}/${model.id}` : null;

  useEffect(() => { setTestState({ phase: "idle" }); }, [providerName, provider.baseUrl, provider.api, provider.apiKey, model.id, model.api]);
  useEffect(() => {
    catalogRequestIdRef.current += 1;
    setCatalogState({ phase: "idle" });
    catalogUndoRef.current = null;
  }, [providerName, provider.baseUrl, model.id]);

  // fork:thinking-level-memory / fork:upstream-0.9.2-thinking-profile —— 该模型上次实际
  // 生效的思考档，以及运行时模型字段（内置模型的 models.json 里往往什么都没写）。
  useEffect(() => {
    if (!thinkingMemoryKey) {
      setRememberedThinking(null);
      return;
    }
    let cancelled = false;
    void fetch(cwd ? `/api/models?cwd=${encodeURIComponent(cwd)}` : "/api/models")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: {
        thinkingLevelMemory?: Record<string, string>;
        thinkingInputs?: Record<string, ThinkingProfileInputs>;
      } | null) => {
        if (cancelled) return;
        setRememberedThinking(data?.thinkingLevelMemory?.[thinkingMemoryKey] ?? null);
        setThinkingInputs(data?.thinkingInputs?.[thinkingMemoryKey] ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [thinkingMemoryKey, cwd]);

  const forgetRememberedThinking = useCallback(async () => {
    if (!thinkingMemoryKey) return;
    const res = await fetch("/api/thinking-level-memory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelKey: thinkingMemoryKey }),
    }).catch(() => null);
    if (res?.ok) setRememberedThinking(null);
  }, [thinkingMemoryKey]);

  /* 「这一档实际会发什么」：字段取运行时模型（缺失时退回编辑器声明），映射用编辑器
     当前值，所以改映射时这一列会立刻跟着变。 */
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
    if (costEditing) { setCostEditing(false); return; }
    costTemplateRef.current = model.cost;
    const nextDraft = modelCostToDraft(model.cost);
    costDraftRef.current = nextDraft;
    setCostDraft(nextDraft);
    setCostEditing(true);
  };
  // 阶梯挂在同一个 cost 对象上；清空就删键。useMemo 不是洁癖：CostTiersEditor 的
  // `useEffect([tiers])` 会用 tiers 重建草稿，`?? []` 每次渲染都是新数组就会死循环。
  const costTiers = useMemo(() => (Array.isArray(model.cost?.tiers) ? model.cost.tiers : []), [model.cost?.tiers]);
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
    return testState.phase === "success"
      ? [t("i18n.connected"), ...meta, testState.responseText || null].filter(Boolean).join(" · ")
      : [t("i18n.failed"), ...meta, testState.message].filter(Boolean).join(" · ");
  })();

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
      setCatalogState({ phase: "success", recommendation: data.recommendation, appliedCount: filled.appliedCount });
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

  const catalogSummary = (() => {
    if (catalogState.phase !== "success") return null;
    const { recommendation, appliedCount } = catalogState;
    const applied = appliedCount > 0
      ? t("models.catalogFilled", { count: appliedCount })
      : t("models.catalogNoEmptyFields");
    if (recommendation.price.status === "unreliable") {
      return `${applied} · ${recommendation.price.reason === "no-exact-match"
        ? t("models.catalogNoExactMatch")
        : t("models.catalogPriceUnreliable")}`;
    }
    const who = recommendation.price.providerName ?? recommendation.price.providerId ?? providerName;
    const price = recommendation.price.method === "provider"
      ? t("models.catalogPriceProvider", { provider: who })
      : recommendation.price.method === "base-url"
        ? t("models.catalogPriceBaseUrl", { provider: who })
        : t("models.catalogPriceConsensus", {
            support: recommendation.price.support,
            total: recommendation.price.total,
          });
    return `${applied} · ${price}`;
  })();

  const costFields = [
    { key: "input", label: t("models.costInput") },
    { key: "output", label: t("models.costOutput") },
    { key: "cacheRead", label: t("models.costCacheRead") },
    { key: "cacheWrite", label: t("models.costCacheWrite") },
  ] as const;
  const formatCost = (key: ModelCostKey) => {
    const value = model.cost?.[key];
    return value === undefined ? t("models.notProvided") : `$${String(value)}`;
  };

  const remainingCompatKeys = new Set(Object.keys(model.compat ?? {}));
  let compatCount = 0;
  if (hasDeepseekCompat(model)) {
    compatCount += 1;
    remainingCompatKeys.delete("thinkingFormat");
    remainingCompatKeys.delete("requiresReasoningContentOnAssistantMessages");
  }
  if (Object.prototype.hasOwnProperty.call(model.compat ?? {}, "supportsDeveloperRole")) {
    compatCount += 1;
    remainingCompatKeys.delete("supportsDeveloperRole");
  }
  compatCount += remainingCompatKeys.size;

  const advancedSummary = [
    model.api ? `API: ${model.api}` : null,
    Object.keys(model.headers ?? {}).length ? t("models.headersSummary", { count: Object.keys(model.headers ?? {}).length }) : null,
    compatCount ? t("models.compatSummary", { count: compatCount }) : null,
    Object.keys(model.thinkingLevelMap ?? {}).length ? t("models.thinkingSummary", { count: Object.keys(model.thinkingLevelMap ?? {}).length }) : null,
  ].filter((part): part is string => Boolean(part)).join(" · ") || t("models.providerDefaults");

  return (
    <div className="d-set-inner">
      {/* fork:models-detail-modal —— 不再有「← 返回」：这一页已经是弹窗，关窗就是返回。 */}

      <div className="d-set-sec">
        <SectionHeading
          title={<span className="d-row">{model.name || model.id || t("models.untitledModel")}</span>}
          actions={(
            <>
              <ConfigBadge tone="mute">{providerName}</ConfigBadge>
              {model.reasoning && <ConfigBadge tone="info">{t("models.badgePinnable")}</ConfigBadge>}
            </>
          )}
        />
        <div className="d-grid2">
          <DField label={t("models.fieldModelId")}>
            <TextInput mono value={model.id} placeholder="model-id" onChange={(value) => set("id", value)} />
          </DField>
          <DField label={t("models.fieldName")}>
            <TextInput
              value={model.name ?? ""}
              placeholder={model.id || t("models.fieldName")}
              onChange={(value) => set("name", value || undefined)}
            />
          </DField>
        </div>
        <div className="d-row">
          <ConfigButton
            size="small"
            disabled={!model.id.trim() || catalogState.phase === "loading"}
            onClick={() => void handleCatalogFill()}
          >
            {catalogState.phase === "loading" ? t("models.catalogFilling") : t("models.catalogFill")}
          </ConfigButton>
          <ConfigButton
            size="small"
            disabled={!model.id.trim() || testState.phase === "testing"}
            onClick={() => void handleTest()}
          >
            <i data-ico="circle-play" data-size="13" aria-hidden="true" />
            {testState.phase === "testing" ? t("i18n.checking") : t("models.sendTestRequest")}
          </ConfigButton>
          <span className="d-grow" aria-hidden="true" />
          <a href="https://github.com/anomalyco/models.dev" target="_blank" rel="noreferrer" className="d-t-xs d-t-faint">
            {t("models.catalogSource")}
          </a>
        </div>
        {catalogState.phase === "error" && (
          <Notice tone="err" action={
            <ConfigButton size="small" className="d-banner-btn" onClick={undoCatalogFill}>{t("models.catalogUndo")}</ConfigButton>
          }>
            {catalogState.message}
          </Notice>
        )}
        {catalogSummary && (
          <div aria-live="polite" className="d-t-xs d-t-faint">
            {catalogSummary}
            {catalogUndoRef.current && (
              <ConfigButton variant="ghost" size="small" onClick={undoCatalogFill}>{t("models.catalogUndo")}</ConfigButton>
            )}
          </div>
        )}
        {testSummary && (
          <Notice tone={testState.phase === "success" ? "info" : "err"}>{testSummary}</Notice>
        )}
        {testState.phase === "success" && testState.responseText && (
          <pre className="d-term plain">{testState.responseText}</pre>
        )}
      </div>

      <div className="d-set-sec">
        <SectionHeading title={t("models.capabilities")} />
        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("models.reasoningCapability")}</div>
          </div>
          <span className="d-grow-last">
            <ConfigSwitch
              checked={model.reasoning ?? false}
              label={t("models.reasoning")}
              onChange={(value) => set("reasoning", value || undefined)}
            />
          </span>
        </div>
        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("models.imageInput")}</div>
          </div>
          <span className="d-grow-last">
            <ConfigSwitch
              checked={model.input?.includes("image") ?? false}
              label={t("models.imageInput")}
              onChange={(value) => set("input", value ? ["text", "image"] : undefined)}
            />
          </span>
        </div>
      </div>

      <div className="d-set-sec">
        <SectionHeading
          title={t("models.modelSpecs")}
          actions={(
            <ConfigButton size="small" aria-expanded={costEditing} onClick={toggleCostEditing}>
              {costEditing ? t("models.finishEditingCosts") : t("models.editCosts")}
            </ConfigButton>
          )}
        />
        <div className="d-grid2">
          <DField label={t("models.contextWindow")}>
            <NumInput
              value={model.contextWindow !== undefined ? String(model.contextWindow) : ""}
              placeholder="128000"
              onChange={(value) => set("contextWindow", value ? Number.parseInt(value, 10) : undefined)}
            />
          </DField>
          <DField label={t("models.maxOutputTokens")}>
            <NumInput
              value={model.maxTokens !== undefined ? String(model.maxTokens) : ""}
              placeholder="16384"
              onChange={(value) => set("maxTokens", value ? Number.parseInt(value, 10) : undefined)}
            />
          </DField>
        </div>
        {model.contextWindow !== undefined && model.maxTokens !== undefined && model.maxTokens > model.contextWindow && (
          <Notice tone="err">{t("models.maxTokensExceedsContext")}</Notice>
        )}
        <div className="d-grid2">
          {costFields.map(({ key, label }) => (
            <DField key={key} label={label}>
              {costEditing ? (
                <NumInput value={costDraft[key]} placeholder="0" onChange={(value) => setCost(key, value)} />
              ) : (
                <span className="d-mono">{formatCost(key)}</span>
              )}
            </DField>
          ))}
        </div>
        {costEditing && hasModelCostDraftValue(costDraft) && !parseCompleteModelCost(costDraft) && (
          <div aria-live="polite" className="d-t-xs d-t-faint" style={{ color: "var(--nx-warning)" }}>
            {t("models.costAllRequired")}
          </div>
        )}
        <SectionHeading title={<>{t("models.costTiers")} <ConfigBadge tone="mute">{costTiers.length}</ConfigBadge></>} />
        <CostTiersEditor tiers={costTiers} onChange={setCostTiers} />
      </div>

      <div className="d-set-sec">
        <ConfigButton
          variant="ghost"
          size="small"
          aria-expanded={advancedOpen}
          aria-controls="model-advanced"
          title={advancedSummary}
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          <span className="d-t-b">{t("models.advancedSettings")}</span>
          <span className="d-grow d-t-xs d-t-faint">{advancedSummary}</span>
          <i data-ico={advancedOpen ? "chevron-down" : "chevron-right"} data-size="13" aria-hidden="true" />
        </ConfigButton>

        {advancedOpen && (
          <div id="model-advanced" className="d-col">
            <DField label={t("models.apiOverride")}>
              <Select
                ariaLabel={t("models.apiOverride")}
                value={model.api ?? ""}
                options={API_OPTIONS}
                onChange={(value) => set("api", value || undefined)}
              />
            </DField>

            <DField label={t("models.headers")}>
              <HeaderListEditor headers={model.headers} onChange={(headers) => set("headers", headers)} />
            </DField>

            <DField label={t("models.samplingParams")}>
              <SamplingParamsEditor value={model.samplingParams} onChange={(next) => set("samplingParams", next)} />
            </DField>

            <DField label={t("models.inputLimitsTitle")}>
              <ModelInputLimitsFields
                inputLimits={model.inputLimits}
                promptCache={model.promptCache}
                onInputLimitsChange={(next) => set("inputLimits", next)}
                onPromptCacheChange={(next) => set("promptCache", next)}
              />
            </DField>

            {model.reasoning && (
              <>
                <SectionHeading title={t("models.thinkingLevelMap")} actions={(
                  model.thinkingLevelMap && (
                    <ConfigButton size="small" variant="ghost" onClick={() => set("thinkingLevelMap", undefined)}>
                      {t("models.clearAll")}
                    </ConfigButton>
                  )
                )} />
                <ThinkingLevelMapEditor
                  value={model.thinkingLevelMap}
                  onChange={(value) => set("thinkingLevelMap", value)}
                  describeLevel={describeThinkingLevel}
                />
                {rememberedThinking && (
                  <div className="d-row">
                    <span className="d-t-xs d-t-faint">
                      {t("models.lastUsedThinking")}: <strong className="d-mono">{rememberedThinking}</strong>
                    </span>
                    <span className="d-grow" aria-hidden="true" />
                    <ConfigButton size="small" variant="ghost" onClick={() => void forgetRememberedThinking()}>
                      {t("models.forgetThinking")}
                    </ConfigButton>
                  </div>
                )}
              </>
            )}

            <SectionHeading title={t("models.compatibility")} />
            <div className="d-set-row">
              <div className="d-set-row-box">
                <div className="d-set-row-t">{t("models.deepSeekThinkingCompat")}</div>
              </div>
              <span className="d-grow-last">
                <ConfigSwitch
                  checked={hasDeepseekCompat(model)}
                  label={t("models.deepSeekThinkingCompat")}
                  onChange={(value) => onChange(setDeepseekCompat(model, value))}
                />
              </span>
            </div>
            <div className="d-set-row">
              <div className="d-set-row-box">
                <div className="d-set-row-t">{t("models.developerRole")}</div>
              </div>
              <span className="d-grow-last">
                <ConfigSwitch
                  checked={effectiveCompat(provider, model)["supportsDeveloperRole"] !== false}
                  label={t("models.developerRole")}
                  onChange={(value) => onChange(setCompatBool(model, "supportsDeveloperRole", value))}
                />
              </span>
            </div>
            <CompatFlagsEditor
              compat={effectiveCompat(provider, model)}
              api={model.api ?? provider.api}
              onChange={(key, state) => onChange(setCompatFlag(model, key, state))}
            />
          </div>
        )}
      </div>

      <div className="d-set-row">
        <div className="d-set-row-box">
          <div className="d-set-row-t">{t("models.deleteModel")}</div>
          <div className="d-set-row-s">{t("models.deleteDefinitionDescription")}</div>
        </div>
        <span className="d-grow-last">
          <ConfigButton variant="danger" size="small" onClick={onDelete}>{t("i18n.delete")}</ConfigButton>
        </span>
      </div>
    </div>
  );
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

type OAuthLoginState =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "auth"; url: string; token: string }
  | { phase: "device_code"; userCode: string; verificationUri: string; expiresInSeconds: number | null }
  | { phase: "prompt"; message: string; placeholder: string | null; token: string }
  | { phase: "select"; message: string; options: { id: string; label: string }[]; token: string }
  | { phase: "progress"; message: string }
  | { phase: "success" }
  | { phase: "error"; message: string };

function OAuthDetail({ provider, onRefresh }: { provider: OAuthProvider; onRefresh: () => void }) {
  const { t } = useI18n();
  const [loginState, setLoginState] = useState<OAuthLoginState>({ phase: "idle" });
  const [inputValue, setInputValue] = useState("");
  const eventSourceRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (loginState.phase === "auth" || loginState.phase === "prompt") {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [loginState.phase]);

  useEffect(() => {
    setLoginState({ phase: "idle" });
    setInputValue("");
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, [provider.id]);

  useEffect(() => () => { eventSourceRef.current?.close(); }, []);

  const handleLogin = useCallback(() => {
    eventSourceRef.current?.close();
    setLoginState({ phase: "connecting" });
    setInputValue("");
    const es = new EventSource(`/api/auth/login/${encodeURIComponent(provider.id)}`);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data) as {
        type: string; url?: string; token?: string; message?: string; placeholder?: string | null;
        userCode?: string; verificationUri?: string; expiresInSeconds?: number | null;
        options?: { id: string; label: string }[];
      };
      if (data.type === "auth") {
        setLoginState({ phase: "auth", url: data.url!, token: data.token! });
        window.open(data.url!, "_blank", "noopener,noreferrer");
      } else if (data.type === "device_code") {
        setLoginState({
          phase: "device_code",
          userCode: data.userCode!,
          verificationUri: data.verificationUri!,
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
      setLoginState((previous) => (previous.phase === "success" ? previous : { phase: "error", message: t("models.loginConnectionLost") }));
    };
  }, [provider.id, onRefresh, t]);

  const handleLogout = useCallback(async () => {
    await fetch(`/api/auth/logout/${encodeURIComponent(provider.id)}`, { method: "POST" });
    setLoginState({ phase: "idle" });
    onRefresh();
  }, [provider.id, onRefresh]);

  const postLoginInput = useCallback(async (token: string, value: string, progress: string) => {
    setLoginState({ phase: "progress", message: progress });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: value.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? `HTTP ${res.status}` });
        return;
      }
      setInputValue("");
      // Success arrives as a `success` frame on the open stream.
    } catch (error) {
      setLoginState({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, [provider.id]);

  const submitCode = (token: string, code: string) => {
    if (code.trim()) void postLoginInput(token, code, t("models.loginVerifying"));
  };

  const isWorking = loginState.phase !== "idle" && loginState.phase !== "success" && loginState.phase !== "error";

  return (
    <div className="d-col">
      <div className="d-set-row">
        <div className="d-set-row-box">
          <div className="d-set-row-t">{t("models.oauthTitle")}</div>
          <ConfigBadge tone={provider.loggedIn ? "ok" : "mute"}>
            {provider.loggedIn ? t("i18n.connected") : t("i18n.notConnected")}
          </ConfigBadge>
        </div>
        <span className="d-grow-last d-row">
          {isWorking ? (
            <ConfigButton size="small" onClick={() => { eventSourceRef.current?.close(); setLoginState({ phase: "idle" }); }}>
              {t("i18n.cancel")}
            </ConfigButton>
          ) : (
            <>
              {provider.loggedIn && (
                <ConfigButton size="small" variant="danger" onClick={() => void handleLogout()}>{t("i18n.disconnect")}</ConfigButton>
              )}
              <ConfigButton size="small" variant="primary" onClick={handleLogin}>
                {provider.loggedIn ? t("i18n.relogin") : t("i18n.login")}
              </ConfigButton>
            </>
          )}
        </span>
      </div>

      {loginState.phase === "connecting" && <div className="d-t-xs d-t-faint">{t("i18n.openingBrowser")}</div>}
      {loginState.phase === "progress" && <div className="d-t-xs d-t-faint">{loginState.message}</div>}
      {loginState.phase === "select" && (
        <>
          <div className="d-t-xs d-t-faint">{loginState.message}</div>
          <div className="d-row">
            {loginState.options.map((option) => (
              <ConfigButton
                key={option.id}
                size="small"
                onClick={() => void postLoginInput(loginState.token, option.id, t("models.loginContinuing"))}
              >
                {option.label}
              </ConfigButton>
            ))}
          </div>
        </>
      )}
      {(loginState.phase === "auth" || loginState.phase === "prompt") && (
        <>
          <div className="d-t-xs d-t-faint">
            {loginState.phase === "auth" ? t("models.oauthPasteRedirect") : loginState.message}
          </div>
          {loginState.phase === "auth" && (
            <div className="d-t-xs d-t-faint">
              {t("models.oauthBrowserNotOpened")}{" "}
              <a href={loginState.url} target="_blank" rel="noopener noreferrer" style={BREAKABLE_LINK}>
                {t("models.oauthOpenLoginPage")}
              </a>
            </div>
          )}
          <div className="d-row">
            <input
              ref={inputRef}
              className="d-input d-mono"
              style={FILL_ROW_INPUT}
              value={inputValue}
              placeholder={loginState.phase === "auth"
                ? "http://localhost:1455/auth/callback?code=…"
                : (loginState.placeholder ?? t("models.enterValue"))}
              onChange={(event) => setInputValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") submitCode(loginState.token, inputValue); }}
            />
            <ConfigButton variant="primary" size="small" disabled={!inputValue.trim()} onClick={() => submitCode(loginState.token, inputValue)}>
              {t("i18n.submit")}
            </ConfigButton>
          </div>
        </>
      )}
      {loginState.phase === "device_code" && (
        <>
          <div className="d-t-xs d-t-faint">{t("models.deviceCodeHint")}</div>
          <div><span className="d-kbd">{loginState.userCode}</span></div>
          <div className="d-t-xs d-t-faint">
            <a href={loginState.verificationUri} target="_blank" rel="noopener noreferrer" style={BREAKABLE_LINK}>
              {loginState.verificationUri}
            </a>
            {loginState.expiresInSeconds ? ` · ${t("models.deviceCodeExpires", { minutes: Math.ceil(loginState.expiresInSeconds / 60) })}` : ""}
          </div>
        </>
      )}
      {loginState.phase === "success" && (
        <ConfigBadge tone="ok">
          <i data-ico="check" data-size="11" aria-hidden="true" />
          {t("i18n.connectedSuccessfully")}
        </ConfigBadge>
      )}
      {loginState.phase === "error" && <Notice tone="err">{loginState.message}</Notice>}
    </div>
  );
}

// ── API Key ───────────────────────────────────────────────────────────────────

function ApiKeyDetail({ provider, onRefresh }: { provider: ApiKeyProvider; onRefresh: () => void }) {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setApiKey(""); setError(null); setSavedOk(false); }, [provider.id]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) setError(d.error ?? `HTTP ${res.status}`);
      else {
        setApiKey("");
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        onRefresh();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRemoving(false);
    }
  }, [provider.id, onRefresh]);

  return (
    <div className="d-col">
      <div className="d-set-row">
        <div className="d-set-row-box">
          <div className="d-set-row-t">{t("models.apiKeyTitle")}</div>
          <ConfigBadge tone={provider.configured ? "ok" : "mute"}>
            {provider.configured ? t("i18n.configured") : t("i18n.notConfigured")}
          </ConfigBadge>
        </div>
        {provider.configured && (
          <span className="d-grow-last">
            <ConfigButton size="small" variant="danger" disabled={removing} onClick={() => void handleRemove()}>
              {removing ? t("i18n.removing") : t("i18n.disconnect")}
            </ConfigButton>
          </span>
        )}
      </div>
      <div className="d-row">
        <SecretTextInput
          value={apiKey}
          placeholder={provider.configured ? t("models.replaceKeyPlaceholder") : "sk-…"}
          onChange={setApiKey}
          onKeyDown={(event) => { if (event.key === "Enter" && apiKey.trim()) void handleSave(); }}
        />
        <ConfigButton
          variant="primary"
          size="small"
          disabled={saving || !apiKey.trim() || savedOk}
          onClick={() => void handleSave()}
        >
          {savedOk ? t("i18n.saved") : saving ? t("i18n.saving") : provider.configured ? t("models.updateKey") : t("models.saveKey")}
        </ConfigButton>
      </div>
      {error && <Notice tone="err">{error}</Notice>}
    </div>
  );
}

// ── 添加供应商 ────────────────────────────────────────────────────────────────

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function AddProviderPicker({ oauthProviders, apiKeyProviders, existingIds, onPick, onAddCustom, onClose }: {
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  existingIds: ReadonlySet<string>;
  onPick: (id: string) => void;
  onAddCustom: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [customOpen, setCustomOpen] = useState(false);
  const [customId, setCustomId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const timer = setTimeout(() => inputRef.current?.focus(), 30); return () => clearTimeout(timer); }, []);
  /* fork:models-detail-modal —— 列表还没到时（面板刚挂载 / `/api/auth/providers` 还在路上）
     不要报「没有可用服务商」，那会让用户以为装的东西没了；先报「正在加载」。 */
  const loading = oauthProviders.length === 0 && apiKeyProviders.length === 0;

  const needle = search.trim().toLocaleLowerCase();
  // A dual-auth provider appears in both lists; whichever the user picks is the
  // same provider id, so opening it lands on the page that shows both details.
  const availableOAuth = oauthProviders.filter((p) => !p.loggedIn && (!needle || p.name.toLocaleLowerCase().includes(needle)));
  const availableApiKey = apiKeyProviders.filter((p) => !p.configured && (!needle
    || p.displayName.toLocaleLowerCase().includes(needle) || p.id.toLocaleLowerCase().includes(needle)));
  const showCustom = !needle || needle.includes("custom") || needle.includes("compatible") || needle.includes("openai");
  const trimmedId = customId.trim();
  const customIdValid = PROVIDER_ID_PATTERN.test(trimmedId) && !existingIds.has(trimmedId);
  const totalCount = availableOAuth.length + availableApiKey.length + (showCustom ? 1 : 0);

  const pick = (id: string) => { onPick(id); onClose(); };

  return (
    <Modal title={t("models.addProviderTitle")} onClose={onClose} footer={(
      <>
        <span className="d-grow" aria-hidden="true" />
        {/* 取消的是这一个选择器，不是设置面板的关闭。 */}
        <ConfigButton onClick={() => onClose()}>{t("i18n.cancel")}</ConfigButton>
      </>
    )}>
      <div className="d-searchfield">
        <i data-ico="search" data-size="14" aria-hidden="true" />
        <input
          ref={inputRef}
          value={search}
          placeholder={t("i18n.searchProviders")}
          aria-label={t("i18n.searchProviders")}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {loading ? (
        <div className="d-t-xs d-t-faint" role="status">{t("i18n.loading")}</div>
      ) : totalCount === 0 ? (
        <div className="d-t-xs d-t-faint">{t("i18n.noProviders")}</div>
      ) : (
        <div className="d-col">
          {showCustom && (
            <>
              <div className="d-group-title">{t("i18n.custom")}</div>
              {!customOpen && (
                <OpenCard title={t("models.customCompatible")} onClick={() => setCustomOpen(true)}>
                  <span className="d-col d-grow">
                    <ConfigSidebarText>{t("models.customCompatible")}</ConfigSidebarText>
                    <ConfigSidebarSub>{t("i18n.customEndpoint")}</ConfigSidebarSub>
                  </span>
                </OpenCard>
              )}
              {customOpen && (
                <div className="d-card">
                  <div className="d-card-body">
                    <div className="d-col">
                      <div className="d-field">
                        <span className="d-field-t">{t("models.providerId")}</span>
                        <input
                          className="d-input d-mono"
                          value={customId}
                          placeholder="my-provider"
                          aria-describedby="custom-provider-id-hint"
                          onChange={(event) => setCustomId(event.target.value)}
                        />
                        <span id="custom-provider-id-hint" className="d-t-xs d-t-faint">
                          {existingIds.has(trimmedId) ? t("models.providerIdTaken") : t("models.providerIdFormat")}
                        </span>
                      </div>
                      <div className="d-row">
                        <ConfigButton size="small" onClick={() => setCustomOpen(false)}>{t("i18n.cancel")}</ConfigButton>
                        <span className="d-grow" aria-hidden="true" />
                        <ConfigButton
                          size="small"
                          variant="primary"
                          disabled={!customIdValid}
                          onClick={() => { onAddCustom(trimmedId); onClose(); }}
                        >
                          {t("models.createProvider")}
                        </ConfigButton>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {availableOAuth.length > 0 && <div className="d-group-title">{t("i18n.subscriptions")}</div>}
          {availableOAuth.map((provider) => (
            <OpenCard key={provider.id} title={provider.name} icon={<ProviderIcon id={provider.id} size={16} />} onClick={() => pick(provider.id)}>
              <span className="d-col d-grow">
                <ConfigSidebarText>{provider.name}</ConfigSidebarText>
                <ConfigSidebarSub>{t("models.kindOAuth")}</ConfigSidebarSub>
              </span>
            </OpenCard>
          ))}

          {availableApiKey.length > 0 && <div className="d-group-title">{t("models.kindApiKey")}</div>}
          {availableApiKey.map((provider) => (
            <OpenCard key={provider.id} title={provider.displayName} icon={<ProviderIcon id={provider.id} size={16} />} onClick={() => pick(provider.id)}>
              <span className="d-col d-grow">
                <ConfigSidebarText>{provider.displayName}</ConfigSidebarText>
                <ConfigSidebarSub>{t("models.modelCount", { count: provider.modelCount })}</ConfigSidebarSub>
              </span>
            </OpenCard>
          ))}
        </div>
      )}
    </Modal>
  );
}

/**
 * fork:settings-modal-portal（2026-10-07 用户原话：「mcp、模型、还有导入的细选条目的
 * 弹窗，展示的有问题啊，还有其他设置的弹窗也是如此，为啥要内嵌在设置的弹窗里啊，请帮
 * 我优化一下」）—— 模型设置里的自绘弹层根节点统一挂到 `document.body`。
 *
 * 根因：用户开着主题皮肤时，`app/fork-ui.css` 的皮肤块会给设置面板壳
 * （`.config-panel-surface`）加 `backdrop-filter`。**带 `backdrop-filter` 的祖先会让
 * 后代的 `position: fixed` 相对它定位，而不是视口** —— `.d-modal` 是
 * `position: fixed; inset: 0`，渲染在设置壳的子树里就会相对面板那一块算，看起来就是
 * 「内嵌在设置弹窗里」、被面板边界裁掉 / 压小。挂到 body 后 fixed 重新相对视口，
 * 弹层的几何与样式一个字都不用改。
 *
 * `useDialogA11y` 会把弹层的兄弟节点设 `inert`：挂到 body 后兄弟就是 body 下其它节点，
 * 正好罩住整片背景；hook 的 cleanup 会还原，关闭后不留残留。
 */
function BodyPortal({ children }: { children: ReactNode }) {
  // SSR 阶段没有 document，内联渲染（这些弹层都是交互后才挂载，正常不会走到）。
  if (typeof document === "undefined") return <>{children}</>;
  return createPortal(children, document.body);
}

/** `.d-modal` 壳：Esc 只关自己这一层，Tab 循环在弹层内。 */
function Modal({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  const { dialogRef, dialogProps } = useDialogA11y({ open: true, onClose });
  const modal = (
    <div
      ref={dialogRef}
      {...dialogProps}
      aria-label={title}
      className="d-modal is-open"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(e) => {
        // fork:dsn-dialog-a11y —— Esc 只关这一层：不拦下的话设置面板会跟着一起关。
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="d-modal-box wide fork-pwa-ms-sheet">
        <div className="d-modal-head">{title}</div>
        <div className="d-modal-body">
          <div className="d-col">{children}</div>
        </div>
        {footer && <div className="d-modal-foot">{footer}</div>}
      </div>
    </div>
  );
  return <BodyPortal>{modal}</BodyPortal>;
}

// ── 列表页的三块附加信息（参考项目没有，本仓登记过的能力，收在列表页底部）───────

/** fork:pr17-favorites —— 只读总览（收藏本体在模型选择器里管理）。 */
function FavoritesSection({ favorites, view }: {
  favorites: Set<string>;
  view: EnabledModelsView | null;
}) {
  const { t } = useI18n();
  if (favorites.size === 0) return null;
  return (
    <div className="d-set-sec">
      <div className="d-set-sec-t">{t("models.favoritesSection")}</div>
      <div className="d-tags">
        {[...favorites].map((key) => {
          const separator = key.indexOf(":");
          const providerId = separator > 0 ? key.slice(0, separator) : key;
          const modelId = separator > 0 ? key.slice(separator + 1) : "";
          // A favorite whose provider or model is gone stays listed, dimmed.
          const available = Boolean(findProviderView(view, providerId)?.models.some((model) => model.id === modelId));
          return (
            <span className="d-tag" key={key}>
              <i data-ico="star" data-size="12" aria-hidden="true" />
              {modelId || key}{available ? null : `（${t("models.favoriteDisabled")}）`}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** fork:enabled-models —— 「刷新目录」：pi 自带的模型清单冻在 SDK 版本上，供应商
    之后新发的模型要按一次才出现。按钮本身就是这个功能的全部。 */
function CatalogRefreshButton({ providerId, onDone }: { providerId: string; onDone: () => void }) {
  const { t } = useI18n();
  const catalog = useCatalogRefresh(providerId, onDone);
  return (
    <>
      <ConfigButton
        size="small"
        variant="ghost"
        disabled={catalog.refreshing}
        title={t("models.refreshCatalogHint")}
        onClick={catalog.refresh}
      >
        <i data-ico={catalog.refreshing ? "loader-circle" : "refresh-cw"} data-size="13" aria-hidden="true" />
        {catalog.refreshing ? t("models.refreshingCatalog") : t("models.refreshCatalog")}
      </ConfigButton>
      {catalog.note && <div className="d-t-xs d-t-faint">{t(catalog.note)}</div>}
    </>
  );
}

/** fork:usage-overview-dropped — 帧 A 原本在这里有一段「用量摘要（近 30 天）」概览
    （刷新按钮 + 每个供应商一条占比条）。2026-10-06 用户裁定去掉：设置里另有「用量」
    分节，供应商详情页也有自己的用量，两处口径摆在一起只会互相干扰。 */

/** fork:model-roles —— 新会话起步模型（落 settings.json）与命名模型（本地偏好）。 */
function ModelRolesSection({ cwd }: { cwd: string | null }) {
  const { t } = useI18n();
  const [defaultModel, setDefaultModel] = useState<{ provider: string; modelId: string } | null>(null);
  const [titleModel, setTitleModelState] = useState<{ provider: string; modelId: string } | null>(null);
  const [options, setOptions] = useState<{ provider: string; modelId: string; label: string }[]>([]);
  const [openRole, setOpenRole] = useState<"default" | "title" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setTitleModelState(getTitleModel());
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch(cwd ? `/api/models?cwd=${encodeURIComponent(cwd)}` : "/api/models")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: {
        defaultModel?: { provider: string; modelId: string } | null;
        modelList?: { id: string; name?: string; provider: string }[];
      } | null) => {
        if (cancelled || !data) return;
        setDefaultModel(data.defaultModel ?? null);
        setOptions((data.modelList ?? [])
          .filter((model) => model.id && model.provider)
          .map((model) => ({
            provider: model.provider,
            modelId: model.id,
            label: `${model.name || model.id} · ${model.provider}`,
          }))
          .sort((a, b) => a.label.localeCompare(b.label)));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [cwd]);

  const saveDefault = useCallback(async (value: { provider: string; modelId: string } | null) => {
    setError(null);
    try {
      const response = await fetch("/api/models/default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value ? { provider: value.provider, modelId: value.modelId, cwd } : { clear: true, cwd }),
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setDefaultModel(value);
      setOpenRole(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [cwd]);

  const saveTitle = (value: { provider: string; modelId: string } | null) => {
    if (value) setTitleModel(value.provider, value.modelId);
    else clearTitleModel();
    setTitleModelState(value);
    setOpenRole(null);
  };

  const rows = [
    {
      role: "default" as const,
      label: t("models.roleDefault"),
      value: defaultModel ? `${defaultModel.provider} / ${defaultModel.modelId}` : t("models.roleUnset"),
      picker: t("models.pickDefault"),
      foot: t("models.pickDefaultFoot"),
    },
    {
      role: "title" as const,
      label: t("models.roleTitle"),
      value: titleModel ? `${titleModel.provider} / ${titleModel.modelId}` : t("models.roleSessionModel"),
      picker: t("models.pickTitle"),
      foot: t("models.pickTitleFoot"),
    },
  ];

  return (
    <div className="d-set-sec">
      <SectionHeading title={t("models.defaultsSection")} />
      {rows.map((row) => (
        <div key={row.role} className="d-anchor">
          <div className="d-set-row">
            <div className="d-set-row-box">
              <div className="d-set-row-t">{row.label}</div>
            </div>
            <span className="d-grow-last d-mono d-t-xs d-t-faint">{row.value}</span>
            <ConfigButton size="small" onClick={() => setOpenRole(openRole === row.role ? null : row.role)}>
              {t("i18n.edit")}
            </ConfigButton>
          </div>
          {openRole === row.role && (
            <div className="d-pop is-open up" style={{ right: 0, left: "auto" }}>
              <div className="d-pop-title">{row.picker}</div>
              <div className="d-sep" />
              <div className="d-pop-body d-col" style={{ minWidth: 280, maxHeight: 260, overflowY: "auto" }}>
                {options.map((option) => {
                  const current = (row.role === "default" ? defaultModel : titleModel);
                  const on = current?.provider === option.provider && current?.modelId === option.modelId;
                  return (
                    <button
                      key={`${option.provider}:${option.modelId}`}
                      type="button"
                      className={`d-menu-row${on ? " is-on" : ""}`}
                      onClick={() => (row.role === "default" ? void saveDefault(option) : saveTitle(option))}
                    >
                      <span className="d-grow">{row.role === "default" ? `${option.provider} / ${option.modelId}` : option.label}</span>
                      {on && <ConfigBadge tone="ok">{t("models.currentBadge")}</ConfigBadge>}
                    </button>
                  );
                })}
                <div className="d-sep" />
                <button
                  type="button"
                  className="d-menu-row"
                  onClick={() => (row.role === "default" ? void saveDefault(null) : saveTitle(null))}
                >
                  <span className="d-grow">
                    {row.role === "default" ? t("models.useBuiltinDefault") : t("models.useSessionModel")}
                  </span>
                </button>
              </div>
              <div className="d-pop-foot">{row.foot}</div>
            </div>
          )}
        </div>
      ))}
      {error && <Notice tone="err">{error}</Notice>}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

/** One row of the provider list: which provider, how it authenticates, how many of its models chat offers. */
interface ProviderRow {
  id: string;
  label: string;
  oauth?: OAuthProvider;
  apiKey?: ApiKeyProvider;
  json?: ProviderEntry;
  connected: boolean;
}

export function ModelsConfig({ onClose, embedded = false, cwd = null }: {
  onClose: () => void; embedded?: boolean; cwd?: string | null;
}) {
  const { t } = useI18n();
  // `enabledModels` lives in pi's settings, not models.json, so its switches apply
  // immediately instead of waiting for this panel's Save button.
  const enabledModels = useEnabledModels(cwd);
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const [savedConfig, setSavedConfig] = useState<ModelsJson>({ providers: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // fork:pr2-security —— models.json 读不出来时（注释以外的语法错误、截断的写入…）
  // **禁用保存**：面板保存的是整份 draft，而 draft 并不是从这个文件读出来的。
  const [loadError, setLoadError] = useState<string | null>(null);
  // fork:builtin-models —— 保存后回传的「覆盖了内置定义」警告。
  const [saveWarnings, setSaveWarnings] = useState<string[]>([]);
  const [view, setView] = useState<View>(readRememberedView);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
  /** fork:models-catalog-override —— 运行时模型目录（起草目录模型覆盖的种子）。 */
  const [runtimeModels, setRuntimeModels] = useState<ModelsData["modelList"]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Provider whose upstream import list is open, or null. */
  const [discoveryFor, setDiscoveryFor] = useState<string | null>(null);
  /* fork:models-picker —— 「聊天里显示哪些模型」：白名单还什么都没配时这一次是
     replace（首次配置唯一能收窄的手段），之后都是追加。 */
  const [chatPickerOpen, setChatPickerOpen] = useState(false);

  // fork:pr17-favorites —— 与输入框模型选择器共用同一个 store（只读总览）。
  const favoriteModels = useSyncExternalStore(
    subscribeFavoriteModels,
    getFavoriteModelsSnapshot,
    getFavoriteModelsServerSnapshot,
  );

  const refreshAuthProviders = useCallback(() => {
    return fetch("/api/auth/providers")
      .then((response) => response.json())
      .then((d: { oauthProviders?: OAuthProvider[]; apiKeyProviders?: ApiKeyProvider[] }) => {
        if (Array.isArray(d.oauthProviders)) setOauthProviders(d.oauthProviders);
        if (Array.isArray(d.apiKeyProviders)) setApiKeyProviders(d.apiKeyProviders);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/models-config")
      .then(async (response) => {
        const d = await response.json() as ModelsJson;
        // 422（读不出 models.json）不是一个空配置：当成空配置渲染会把「保存」变成
        // 「清空所有 provider」。
        if (!response.ok || d.error) throw new Error(d.error ?? `HTTP ${response.status}`);
        return d;
      })
      .then((d) => {
        if (cancelled) return;
        const normalized = d.providers ? d : { ...d, providers: {} };
        setConfig(normalized);
        setSavedConfig(normalized);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    void refreshAuthProviders();
    /* fork:models-catalog-override —— 运行时目录：起草「目录模型覆盖」时要带着它的实际值
       （上下文窗口 / 定价 / thinking 档 / compat…）。与 ModelDetail 自己的那一份同源。 */
    void fetch(cwd ? `/api/models?cwd=${encodeURIComponent(cwd)}` : "/api/models")
      .then((response) => response.json())
      .then((d: { modelList?: ModelsData["modelList"] }) => { if (!cancelled) setRuntimeModels(d.modelList ?? []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [cwd, refreshAuthProviders]);

  useEffect(() => {
    setLastSettingsSelection("models", JSON.stringify(view));
  }, [view]);

  const configDirty = JSON.stringify(config) !== JSON.stringify(savedConfig);
  useEffect(() => {
    if (!configDirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [configDirty]);

  const openProvider = useCallback((provider: string | null) => {
    setView(provider === null ? { provider: null } : { provider });
  }, []);
  const openModel = useCallback((provider: string, modelIndex: number) => {
    setView({ provider, modelIndex });
  }, []);

  const addCustomProvider = useCallback((id: string) => {
    setConfig((prev) => ({
      ...prev,
      providers: { ...(prev.providers ?? {}), [id]: { api: "openai-completions" } },
    }));
    setView({ provider: id });
  }, []);

  const updateProvider = useCallback((name: string, next: ProviderEntry) => {
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [name]: next } }));
  }, []);

  const deleteProvider = useCallback((name: string) => {
    setConfig((prev) => {
      const providers = { ...(prev.providers ?? {}) };
      delete providers[name];
      return { ...prev, providers };
    });
    openProvider(null);
  }, [openProvider]);

  const addModel = useCallback((providerName: string) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      return {
        ...prev,
        providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models: [...(provider.models ?? []), { id: "" }] } },
      };
    });
    const provider = config.providers?.[providerName];
    openModel(providerName, (provider?.models?.length ?? 0));
  }, [config.providers, openModel]);

  /**
   * fork:models-catalog-override —— 为目录/内置模型起草一条 models.json 覆盖条目并打开它。
   *
   * pi 的 `models[]` 是**整条替换**而不是合并（见 `lib/builtin-models.ts`），所以草稿必须
   * 带着运行时那份实际值 —— 否则用户改一个字段再保存，上下文窗口 / 定价 / thinking 档 /
   * compat 全部归零。值来自 `/api/models` 的 `modelList`（与 ModelDetail 自己读的那份同源），
   * 取不到就只写 id/name（“填入模型信息”按钮还能从 models.dev 补）。
   */
  const createCatalogOverride = useCallback((providerName: string, modelId: string, name?: string) => {
    const runtime = runtimeModels.find((entry) => entry.provider === providerName && entry.id === modelId);
    const seed: ModelEntry = { id: modelId };
    const label = name?.trim() || runtime?.name?.trim();
    if (label && label !== modelId) seed.name = label;
    if (runtime?.api) seed.api = runtime.api;
    if (typeof runtime?.reasoning === "boolean") seed.reasoning = runtime.reasoning;
    if (runtime?.thinkingLevelMap) seed.thinkingLevelMap = { ...runtime.thinkingLevelMap };
    if (runtime?.input) seed.input = [...runtime.input];
    if (runtime?.inputLimits) seed.inputLimits = runtime.inputLimits as ModelEntry["inputLimits"];
    if (typeof runtime?.contextWindow === "number") seed.contextWindow = runtime.contextWindow;
    if (typeof runtime?.maxTokens === "number") seed.maxTokens = runtime.maxTokens;
    if (runtime?.cost) seed.cost = runtime.cost as ModelEntry["cost"];
    if (runtime?.compat) seed.compat = { ...runtime.compat };
    const index = config.providers?.[providerName]?.models?.length ?? 0;
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      return {
        ...prev,
        providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models: [...(provider.models ?? []), seed] } },
      };
    });
    openModel(providerName, index);
  }, [config.providers, openModel, runtimeModels]);

  const addDiscoveredModels = useCallback((providerName: string, discovered: DiscoveredModel[]) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      const known = new Set(models.map((model) => model.id));
      for (const discoveredModel of discovered) {
        if (known.has(discoveredModel.id)) continue;
        known.add(discoveredModel.id);
        /* fork:model-discovery-specs —— 上游报上来的规格跟着一起进 models.json：
           私有网关 / vLLM / 自建端点在 models.dev 上查不到，`/models` 是唯一来源。
           没报的字段不写（绝不写 0 —— 0 会被 pi 当成声明值）。 */
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

  const updateModel = useCallback((providerName: string, index: number, model: ModelEntry) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models[index] = model;
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, []);

  const removeModel = useCallback((providerName: string, index: number) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models.splice(index, 1);
      return {
        ...prev,
        providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models: models.length ? models : undefined } },
      };
    });
    openProvider(providerName);
  }, [openProvider]);

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
        // fork:builtin-models —— provider-composer 对 models[] 是整条替换：同名条目会
        // 丢掉内置的 thinkingLevelMap / compat。
        setSaveWarnings(d.warnings ?? []);
        setSavedConfig(config);
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        // models.json just changed under the switches: models may have been added or
        // deleted. Re-read the resolved view rather than guessing what it now means.
        enabledModels.refresh();
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }, [config, enabledModels, loadError]);

  const discardChanges = useCallback(() => {
    setConfig(savedConfig);
    setSaveWarnings([]);
  }, [savedConfig]);

  // ── 派生数据 ────────────────────────────────────────────────────────────────

  const connectedIds = new Set([
    ...oauthProviders.filter((p) => p.loggedIn).map((p) => p.id),
    ...apiKeyProviders.filter((p) => p.configured).map((p) => p.id),
  ]);
  const providerIds: string[] = [];
  const addId = (id: string | null | undefined) => { if (id && !providerIds.includes(id)) providerIds.push(id); };
  oauthProviders.filter((p) => p.loggedIn).forEach((p) => addId(p.id));
  apiKeyProviders.filter((p) => p.configured).forEach((p) => addId(p.id));
  Object.keys(config.providers ?? {}).forEach(addId);
  enabledModels.view?.providers.forEach((provider) => addId(provider.id));

  /** 一行供应商的派生形状 —— 列表与详情弹窗共用一份（未连接的服务商也能靠它进详情页）。 */
  const buildProviderRow = (id: string): ProviderRow => {
    const oauth = oauthProviders.find((p) => p.id === id);
    const apiKey = apiKeyProviders.find((p) => p.id === id);
    const json = config.providers?.[id];
    return {
      id,
      label: oauth?.name ?? apiKey?.displayName ?? id,
      ...(oauth ? { oauth } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(json ? { json } : {}),
      connected: connectedIds.has(id),
    };
  };

  const providerRows: ProviderRow[] = providerIds.map(buildProviderRow);
  const providerDirty = (id: string) =>
    JSON.stringify(config.providers?.[id] ?? null) !== JSON.stringify(savedConfig.providers?.[id] ?? null);
  const chatTotal = enabledModels.view?.enabledTotal ?? 0;

  // ── 列表页 ──────────────────────────────────────────────────────────────────

  const authLabel = (row: ProviderRow) => (
    row.oauth?.loggedIn ? t("models.kindOAuth")
      : row.apiKey?.configured ? t("models.kindApiKey")
        : row.json ? t("models.kindCustom")
          : t("models.notConnected")
  );

  /** The chat list only speaks up when something needs attention. */
  const NoticeList = () => {
    const view = enabledModels.view;
    return (
      <>
        {!view && enabledModels.loading && <div className="d-t-xs d-t-faint" role="status">{t("agents.modelsLoading")}</div>}
        {view && !view.editable && <Notice tone="warn">{t("models.enabledProjectScope")}</Notice>}
        {view?.modelError && <Notice tone="err">{view.modelError}</Notice>}
        {view && view.stalePatterns.length > 0 && (
          <Notice tone="warn" action={(
            <ConfigButton
              size="small"
              className="d-banner-btn"
              disabled={enabledModels.pending !== null || !view.editable}
              title={t("models.enabledPruneHint")}
              onClick={enabledModels.pruneStale}
            >
              {t("models.enabledPrune")}
            </ConfigButton>
          )}>
            {t("models.patternStaleBanner", { count: view.stalePatterns.length })}
          </Notice>
        )}
        {enabledModels.failure && (
          <Notice tone="err">
            {enabledModels.failure.messageKey ? t(enabledModels.failure.messageKey) : enabledModels.failure.message}
          </Notice>
        )}
      </>
    );
  };

  /** Where the model filter lives, and how to get all of it back. */
  const SelectorScopeSection = () => {
    const view = enabledModels.view;
    if (!view) return null;
    const busy = enabledModels.pending !== null;
    return (
      <div className="d-set-sec">
        <SectionHeading title={t("models.visibilitySection")} />
        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("models.settingsFileRow")}</div>
            <div className="d-set-row-s d-mono">{view.settingsPath}</div>
          </div>
          <span className="d-grow-last">
            <ConfigBadge tone={view.scope === "project" ? "info" : "mute"}>
              {view.scope === "project" ? t("models.scopeProject") : t("models.scopeGlobal")}
            </ConfigBadge>
          </span>
        </div>
        <div className="d-set-row">
          <div className="d-set-row-box">
            <div className="d-set-row-t">{t("models.clearPatternsRow")}</div>
          </div>
          <span className="d-grow-last d-row">
            <ConfigBadge tone="mute">{t("models.enabledCount", { enabled: view.enabledTotal, total: view.availableTotal })}</ConfigBadge>
            <ConfigButton
              size="small"
              variant="ghost"
              disabled={busy || !view.editable || view.allEnabled}
              title={t("models.enabledClearHint")}
              onClick={enabledModels.clearScope}
            >
              {t("models.enabledClear")}
            </ConfigButton>
          </span>
        </div>
      </div>
    );
  };

  const renderProviderList = () => {
    const connected = providerRows.filter((row) => row.connected);
    const other = providerRows.filter((row) => !row.connected);
    const inChat = (id: string) => findProviderView(enabledModels.view, id);
    const item = (row: ProviderRow) => (
      <OpenCard
        key={row.id}
        title={row.label}
        icon={<ProviderIcon id={row.id} size={16} />}
        onClick={() => openProvider(row.id)}
      >
        <span className="d-col d-grow">
          <ConfigSidebarText>
            {row.label}
            {providerDirty(row.id) && (
              <span className="d-badge warn" title={t("models.unsavedProvider")}>{t("models.unsavedChanges")}</span>
            )}
          </ConfigSidebarText>
          <ConfigSidebarSub>{row.json?.baseUrl ?? authLabel(row)}</ConfigSidebarSub>
        </span>
        <ConfigBadge tone={row.connected ? "ok" : "mute"}>{authLabel(row)}</ConfigBadge>
        {providerBadgeLabel(enabledModels.view, row.id) && (
          <ConfigBadge
            tone="mute"
            title={t("models.inChatCount", {
              count: inChat(row.id)?.enabledCount ?? 0,
              total: inChat(row.id)?.models.length ?? 0,
            })}
          >
            {providerBadgeLabel(enabledModels.view, row.id)}
          </ConfigBadge>
        )}
      </OpenCard>
    );

    return (
      <>
        <NoticeList />
        {providerRows.length === 0 ? (
          <ConfigEmptyState>
            <p className="d-empty-s">{t("models.listEmptyHint")}</p>
          </ConfigEmptyState>
        ) : (
          <>
            {connected.length > 0 && (
              <div className="d-set-sec">
                <SectionHeading title={<>{t("models.groupConnected")} <ConfigBadge tone="mute">{connected.length}</ConfigBadge></>} />
                {connected.map(item)}
              </div>
            )}
            {other.length > 0 && (
              <div className="d-set-sec">
                <SectionHeading title={<>{t("models.groupNotConnected")} <ConfigBadge tone="mute">{other.length}</ConfigBadge></>} />
                {other.map(item)}
              </div>
            )}
          </>
        )}
        <SelectorScopeSection />
        <ModelRolesSection cwd={cwd} />
        <FavoritesSection favorites={favoriteModels} view={enabledModels.view} />
      </>
    );
  };

  // ── 钻入页 ──────────────────────────────────────────────────────────────────

  const renderProviderPage = (row: ProviderRow) => {
    // OAuth / API-key providers ship with the SDK; their models.json entry only overrides.
    const builtIn = Boolean(row.oauth || row.apiKey);
    const showApiKey = Boolean(row.apiKey) && (!row.oauth || row.apiKey?.configured || !row.oauth?.loggedIn);
    const json = row.json;
    const providerView = findProviderView(enabledModels.view, row.id);
    // Only a handful of providers publish a quota endpoint; the rest simply have none.
    const usageId = (row.oauth || row.apiKey) && isProviderUsageId(row.id) ? row.id : null;
    const definitions = json?.models ?? [];
    const definitionIndexOf = new Map<string, number>();
    definitions.forEach((definition, index) => { if (!definitionIndexOf.has(definition.id)) definitionIndexOf.set(definition.id, index); });
    const catalogIds = new Set((providerView?.models ?? []).map((model) => model.id));

    /* Catalog models plus definitions that do not resolve yet, so every definition
       stays reachable whether or not the provider is connected. */
    const modelRows: {
      key: string;
      id: string;
      name: string;
      index: number | null;
      usable: boolean;
      /** The resolved view row, when the runtime serves this model. */
      view?: EnabledModelsModelView;
    }[] = [
      ...(providerView?.models ?? []).map((model) => {
        const index = definitionIndexOf.get(model.id) ?? null;
        return {
          key: model.id,
          id: model.id,
          name: model.name || model.id,
          index,
          usable: true,
          view: model,
        };
      }),
      ...definitions
        .map((definition, index) => ({ definition, index }))
        .filter(({ definition }) => !catalogIds.has(definition.id))
        .map(({ definition, index }) => ({
          key: `def-${index}-${definition.id}`,
          id: definition.id,
          name: definition.name || definition.id,
          index,
          usable: false,
        })),
    ];

    /* Only a model the runtime actually serves can join the chat list, so the
       switch lives on those rows; a definition that does not resolve is marked
       instead of offered. */
    const chatSwitch = (entry: (typeof modelRows)[number]) => {
      if (!entry.view) return null;
      const lastOne = isLastEnabledModel(enabledModels.view, entry.view);
      return (
        <ConfigSwitch
          checked={entry.view.enabled}
          loading={enabledModels.pending === entry.view.ref}
          disabled={enabledModels.pending !== null || !enabledModels.view?.editable || lastOne}
          label={lastOne ? t("models.enabledLastModel") : t("models.showInChat")}
          onChange={(next) => enabledModels.setModels(entry.view!.ref, [entry.view!.ref], next)}
        />
      );
    };

    const modelRow = (entry: (typeof modelRows)[number]) => {
      const windowBadge = entry.index === null ? null : formatContextWindowBadge(definitions[entry.index]?.contextWindow);
      const copy = (
        <span className="d-col d-grow">
          <ConfigSidebarText>{entry.name || t("models.untitledModel")}</ConfigSidebarText>
          {entry.name !== entry.id && <ConfigSidebarSub>{entry.id}</ConfigSidebarSub>}
        </span>
      );
      const tags = (
        <>
          {windowBadge && <ConfigBadge tone="mute">{windowBadge}</ConfigBadge>}
          {!entry.usable && <ConfigBadge tone="warn">{t("models.notUsable")}</ConfigBadge>}
          {entry.view?.thinkingPin && (
            <ConfigBadge tone="mute">{t("models.thinkingPin", { level: entry.view.thinkingPin })}</ConfigBadge>
          )}
        </>
      );
      return (
        <div key={entry.key} className="d-row">
          {entry.index === null ? (
            /* fork:models-catalog-override —— 目录模型（models-store / 内置目录）也能配参数：
               点开时先为它**起草**一条 models.json 覆盖条目。pi 的 `models[]` 是整条替换
               而不是合并，所以草稿带着运行时那份实际值（见 createCatalogOverride），
               否则保存一次就把上下文窗口 / 定价 / thinking 档 / compat 全丢了。
               用户 2026-10-07：「opencode go 套餐里面的模型，缺少参数相关配置，别的都有」。 */
            <button
              type="button"
              className="d-setcard d-grow"
              title={t("models.createOverride")}
              onClick={() => createCatalogOverride(row.id, entry.id, entry.name)}
            >
              {copy}{tags}
              <i data-ico="chevron-right" data-size="14" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="d-setcard d-grow"
              title={t("models.editParams")}
              onClick={() => openModel(row.id, entry.index as number)}
            >
              {copy}{tags}
              <i data-ico="chevron-right" data-size="14" aria-hidden="true" />
            </button>
          )}
          {chatSwitch(entry)}
        </div>
      );
    };

    return (
      <div className="d-set-inner">
        {/* fork:models-detail-modal —— 不再有「← 返回」：这一页已经是弹窗，关窗就是返回。 */}

        <SectionHeading
          title={<span className="d-row"><ProviderIcon id={row.id} size={16} />{row.label}</span>}
          actions={(
            <>
              <ConfigBadge tone={row.oauth?.loggedIn || row.apiKey?.configured ? "ok" : "mute"}>{authLabel(row)}</ConfigBadge>
              {/* 托管供应商的 models.json 条目是覆盖层，说一句；自定义端点已经在
                  认证徽标里说过了，不重复一枚。 */}
              {json && builtIn && <ConfigBadge tone="mute">{t("models.kindOverridden")}</ConfigBadge>}
            </>
          )}
        />

        {(row.oauth || showApiKey) && (
          <div className="d-set-sec">
            <SectionHeading title={t("models.sectionConnection")} />
            {row.oauth && <OAuthDetail key={row.oauth.id} provider={row.oauth} onRefresh={refreshAuthProviders} />}
            {showApiKey && row.apiKey && (
              <ApiKeyDetail key={`${row.apiKey.id}-key`} provider={row.apiKey} onRefresh={refreshAuthProviders} />
            )}
          </div>
        )}

        {usageId && (
          <div className="d-set-sec">
            <SectionHeading title={t("models.usageTitle")} />
            <ProviderUsageSummary
              providerId={usageId}
              enabled={row.oauth?.loggedIn ?? row.apiKey?.configured ?? false}
            />
          </div>
        )}

        {/* A custom provider is set up from its endpoint; a built-in one rarely needs its override. */}
        {json && !builtIn && (
          <div className="d-set-sec">
            <SectionHeading title={t("models.sectionEndpoint")} />
            <EndpointForm
              providerId={row.id}
              provider={json}
              builtIn={builtIn}
              onChange={(next) => updateProvider(row.id, next)}
            />
          </div>
        )}

        <div className="d-set-sec">
          <SectionHeading
            title={<>{t("models.sectionModelsTitle")} <ConfigBadge tone="mute">{modelRows.length}</ConfigBadge></>}
            actions={(
              <>
                {/* fork:models-catalog-override —— 「刷新目录」对目录型服务商也要有：
                    它写的是 models-store.json，本来就不需要 models.json 条目，
                    而 opencode-go 这类套餐此前整组动作都被 `json &&` 吞掉了
                    （用户 2026-10-07：「少一个刷新列表的功能吧，之前有」）。 */}
                <CatalogRefreshButton providerId={row.id} onDone={enabledModels.refresh} />
                {json && (
                  <>
                    <ConfigButton size="small" onClick={() => setDiscoveryFor(row.id)}>
                      <i data-ico="download" data-size="13" aria-hidden="true" />
                      {t("models.importFromUpstream")}
                    </ConfigButton>
                    <ConfigButton size="small" onClick={() => addModel(row.id)}>{t("i18n.addModel")}</ConfigButton>
                  </>
                )}
              </>
            )}
          />

          {discoveryFor === row.id && json && (
            <ModelDiscovery
              providerId={row.id}
              provider={json}
              onAddModels={(models) => addDiscoveredModels(row.id, models)}
              onClose={() => setDiscoveryFor(null)}
            />
          )}

          {modelRows.length === 0 ? (
            <div className="d-t-xs d-t-faint">{json ? t("models.noDefinitions") : t("models.connectToSeeModels")}</div>
          ) : (
            <div className="d-col">{modelRows.map(modelRow)}</div>
          )}
        </div>

        {json && builtIn && (
          <div className="d-set-sec">
            <SectionHeading title={t("models.sectionEndpointOverride")} />
            <EndpointForm
              providerId={row.id}
              provider={json}
              builtIn={builtIn}
              onChange={(next) => updateProvider(row.id, next)}
            />
          </div>
        )}

        {json && (
          <div className="d-set-sec">
            <SectionHeading title={t("models.compatibility")} />
            <CompatFlagsEditor
              compat={json.compat}
              api={json.api}
              onChange={(key, state) => updateProvider(row.id, setCompatFlag(json, key, state))}
            />
            <div className="d-set-row">
              <div className="d-set-row-box">
                <div className="d-set-row-t">{builtIn ? t("models.deleteOverride") : t("models.deleteEndpoint")}</div>
                <div className="d-set-row-s">{builtIn ? t("models.deleteOverrideDescription") : t("models.deleteEndpointDescription")}</div>
              </div>
              <span className="d-grow-last">
                <ConfigButton variant="danger" size="small" onClick={() => deleteProvider(row.id)}>
                  {t("i18n.delete")}
                </ConfigButton>
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  /* fork:models-detail-modal（用户 2026-10-07 裁定）—— 详情一律弹窗：页内那两处
     「← 返回」的位置别扭（截图反馈），而详情本来就是「看一眼 / 改两格就走」的东西。
     页面本体永远是供应商列表，详情叠在它上面。 */
  /* 未连接的服务商（「添加供应商」里刚点进来的那个）也要能进详情页：providerRows 只含
     已连接 / models.json / 当前可见模型里的，之前找不到就静默回落成列表 —— 用户
     2026-10-07：「点了对应的列表后，无法输入 apikey，弹窗直接就消失了」。 */
  const detailRow = view.provider
    ? providerRows.find((entry) => entry.id === view.provider) ?? buildProviderRow(view.provider)
    : null;
  const detailModel = detailRow && typeof view.modelIndex === "number"
    ? config.providers?.[detailRow.id]?.models?.[view.modelIndex]
    : undefined;

  const renderPage = () => renderProviderList();

  const statusMessage = loadError
    ? t("models.configUnreadable", { error: loadError })
    : saveError ?? (saveWarnings.length > 0 ? t("models.builtinOverrideWarning", { models: saveWarnings.join(", ") }) : null);

  return (
    <>
      <ConfigPanelShell
        embedded={embedded}
        title={t("common.models")}
        subtitle="~/.pi/agent/models.json"
        closeLabel={t("i18n.close")}
        onClose={onClose}
      >
        <SettingsPage
          title={t("common.models")}
          actions={(
            <>
              <ConfigButton
                variant="secondary"
                size="small"
                className="fork-pwa-ms-page fork-pwa-ms-models"
                onClick={() => { setPickerOpen(true); void refreshAuthProviders(); }}
              >
                <i data-ico="plus" data-size="13" aria-hidden="true" />
                {t("models.addProvider")}
              </ConfigButton>
              <ConfigButton
                variant="primary"
                size="small"
                className={savedOk ? "is-success" : undefined}
                disabled={saving || savedOk || loadError !== null}
                onClick={handleSave}
              >
                {savedOk && (
                  <span className="config-button-success-icon">
                    <i data-ico="check" data-size="14" aria-hidden="true" />
                  </span>
                )}
                <span>{savedOk ? t("i18n.saved") : saving ? t("i18n.saving") : t("i18n.save")}</span>
              </ConfigButton>
            </>
          )}
          toolbar={(
            <>
              <span className="d-t-xs d-t-faint">{t("models.summary", { count: chatTotal })}</span>
              <span className="d-grow" aria-hidden="true" />
              {configDirty && (
                <ConfigButton size="small" variant="ghost" onClick={discardChanges}>
                  {t("models.discardChanges")}
                </ConfigButton>
              )}
              <ConfigButton
                size="small"
                variant="ghost"
                disabled={!enabledModels.view?.editable}
                title={enabledModels.view?.editable ? undefined : t("models.enabledProjectScope")}
                onClick={() => setChatPickerOpen(true)}
              >
                <i data-ico="list-checks" data-size="13" aria-hidden="true" />
                {t("models.pickChatModels")}
              </ConfigButton>
            </>
          )}
        >
          {loading ? (
            <div className="d-t-xs d-t-faint" role="status">{t("i18n.loading")}</div>
          ) : loadError ? (
            /* 读不出 models.json ≠ 库是空的：只报现状，保存已在页头被禁用。 */
            <Notice tone="err">{t("models.listUnreadable")}</Notice>
          ) : (
            <>
              {statusMessage && (
                <div className={loadError || saveError ? "d-banner err" : "d-banner warn"} role="status">
                  {statusMessage}
                </div>
              )}
              {configDirty && !statusMessage && (
                <Notice tone="warn">{t("models.unsavedChanges")}</Notice>
              )}
              <div className="d-set-inner">{renderPage()}</div>
            </>
          )}
        </SettingsPage>
      </ConfigPanelShell>

      {/* fork:models-detail-modal —— 供应商详情与模型详情都是弹窗（页面本体永远是列表）。
          模型弹窗叠在供应商弹窗之上；两层各自处理 Esc（`Modal` 里 `stopPropagation`）。 */}
      {detailRow && (
        <Modal title={detailRow.label} onClose={() => openProvider(null)}>
          {renderProviderPage(detailRow)}
        </Modal>
      )}
      {detailRow && detailModel && typeof view.modelIndex === "number" && (
        <Modal
          title={detailModel.name || detailModel.id || t("models.untitledModel")}
          onClose={() => openProvider(detailRow.id)}
        >
          <ModelDetail
            key={`${detailRow.id}-${view.modelIndex}`}
            providerName={detailRow.id}
            provider={config.providers?.[detailRow.id] ?? {}}
            model={detailModel}
            cwd={cwd}
            onChange={(next) => updateModel(detailRow.id, view.modelIndex!, next)}
            onDelete={() => removeModel(detailRow.id, view.modelIndex!)}
          />
        </Modal>
      )}

      {pickerOpen && (
        <AddProviderPicker
          oauthProviders={oauthProviders}
          apiKeyProviders={apiKeyProviders}
          existingIds={new Set([
            ...Object.keys(config.providers ?? {}),
            ...oauthProviders.map((p) => p.id),
            ...apiKeyProviders.map((p) => p.id),
            ...(enabledModels.view?.providers.map((provider) => provider.id) ?? []),
          ])}
          onPick={(id) => openProvider(id)}
          onAddCustom={addCustomProvider}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {chatPickerOpen && enabledModels.view && (
        /* fork:settings-modal-portal —— `ChatModelsPicker` 是另一文件里的覆盖层（自身顶着
           `position: fixed`，见 ChatModelsPicker.tsx），在调用点整棵挂到 body：留在
           `.settings-dialog-surface` 子树里会被皮肤块的 `backdrop-filter` 错误地当成定位
           祖先（根因见 `BodyPortal` 注释）。 */
        <BodyPortal>
          <ChatModelsPicker
            providers={enabledModels.view.providers}
            /* replace 模式下不锁任何行：这一次是重选名单，「已经在聊天里」没有意义。 */
            listedRefs={enabledModels.view.allEnabled
              ? new Set<string>()
              : new Set(enabledModels.view.providers.flatMap((provider) =>
                provider.models.filter((model) => model.enabled).map((model) => model.ref)))}
            mode={enabledModels.view.allEnabled ? "replace" : "add"}
            saving={enabledModels.pending !== null}
            error={enabledModels.failure
              ? (enabledModels.failure.messageKey ? t(enabledModels.failure.messageKey) : enabledModels.failure.message ?? null)
              : null}
            onClose={() => setChatPickerOpen(false)}
            onApply={(refs) => {
              setChatPickerOpen(false);
              if (enabledModels.view?.allEnabled) enabledModels.replaceModels(refs);
              else enabledModels.setModels("chat-picker", refs, true);
            }}
          />
        </BodyPortal>
      )}
    </>
  );
}
