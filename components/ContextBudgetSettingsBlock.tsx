"use client";

/**
 * fork:pr12-a5-context-budget —— pi 的 `settings.compaction` / `settings.branchSummary` 预算块。
 *
 * A5 的问题：pi 认这四个字段（`settings-manager.d.ts:4-15, :83-84`），设置页里**一个控件
 * 都没有** —— 压缩预留多少 / 保留最近多少 / 某个模型用另一套预算，全都只能手改
 * `~/.pi/agent/settings.json`。逐字段的 SDK setter 结论见 `lib/context-budget-settings.ts` 头。
 *
 * DOM 照画板 40 帧 1 右栏 / 62 帧 C 右栏（`.pw-block` + `.pw-field`）：开关照「通知」块，
 * 三个数值框照「重试策略」块（`.pw-ctl > .pw-input.pw-numin`，类来自画板 44），模型覆盖行
 * 是同样一条 `.pw-field` —— **没有新 `.pw-*` 类**，`board.css` 不动，判据⑦ 不触发。
 *
 * 三条行为约定（与 `components/RetrySettingsBlock.tsx` 同源，理由见那里）：
 * - **即时生效**：本页副标题写死「改动即时生效」，所以开关点一下就 PUT，数值框在
 *   **失焦 / 回车**时提交（否则打 "16384" 会发四次请求，其中三次带着半截数字）。
 * - **读不出来就摆事实**：GET 422（settings.json 坏了）时全部控件禁用并显示原因，
 *   不用默认值假装没事。
 * - **提交后以磁盘为准**：响应体是服务端重新读出来的值，本地状态直接采用它。
 *
 * ## 模型覆盖行（`modelOverrides`）
 *
 * 0.87 的 `CompactionModelOverride` 是 `{ reserveTokens?, keepRecentTokens? }`，
 * **不是**「用哪个模型去做压缩」：它是给某个模型一套不同的 token 预算，解析顺序
 * 「模型覆盖 → 全局 → 内建默认」（`getCompactionTokenSetting`）。所以一行覆盖 =
 * 一条 `.pw-field`，标签是模型引用，右侧两个窄数值框分别预留 / 保留，
 * 清空某个框 = 这个字段不覆盖（回落全局），两个框都清空 = 删掉这条覆盖。
 *
 * 键的取值只能从 `/api/models` 的清单里挑：SDK 用
 * `` `${model.provider}/${model.id}` `` 查表（`settings-manager.js:572`），
 * 手打错一个字符就是一条永远不生效的死配置。
 */
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { PwBlock, PwCtl, PwField, PwSelectBox, PwSwitch } from "./SettingsUi";
import { numericInputToValue } from "./RetrySettingsBlock";
import {
  CONTEXT_BUDGET_DEFAULTS,
  CONTEXT_BUDGET_MAX_TOKENS,
  type CompactionModelOverride,
  type ContextBudgetSettings,
} from "@/lib/context-budget-settings-shared";

type NumericKey = "reserveTokens" | "keepRecentTokens" | "branchSummaryReserveTokens";

/** 三个全局数值框的规格表 —— 上下限与 `lib/context-budget-settings.ts` 的服务端校验同源。 */
const NUMERIC_FIELDS: readonly { key: NumericKey; label: string; hint: string; step: number }[] = [
  { key: "reserveTokens", label: "settings.contextBudgetReserve", hint: "settings.contextBudgetReserveHint", step: 1024 },
  { key: "keepRecentTokens", label: "settings.contextBudgetKeepRecent", hint: "settings.contextBudgetKeepRecentHint", step: 1024 },
  { key: "branchSummaryReserveTokens", label: "settings.contextBudgetBranchReserve", hint: "settings.contextBudgetBranchReserveHint", step: 1024 },
];

/** 覆盖行里两个框的草稿（null = 不在编辑，回落到磁盘上的值；空串 = 明确清空 = 不覆盖）。 */
type OverrideDrafts = Record<string, { reserveTokens: string | null; keepRecentTokens: string | null }>;

/** PUT 请求体：`cwd` 只是给 `SettingsManager` 当工作目录（全局 settings 不用它），null 就不带。 */
export function contextBudgetRequestBody(
  update: Partial<ContextBudgetSettings>,
  cwd: string | null,
): Record<string, unknown> {
  return cwd === null ? { ...update } : { ...update, cwd };
}

/**
 * 一个覆盖框里的字符串 → 可提交的值。**空串是「不覆盖」**（返回 `undefined`），
 * 与全局数值框（空串回落到当前值）不同：覆盖条目本来就可以只有一半字段，
 * 清空是用户真的想说「这一项跟随全局」。
 *
 * 导出是为了能单测：这段是本组件里唯一有分支的逻辑。
 */
export function overrideInputToValue(raw: string, current: number | undefined, min: number, max: number): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (current === undefined) current = 0;
  return numericInputToValue(trimmed, current, min, max);
}

/** 清空之后这条覆盖还剩什么；空了就该把整个模型从覆盖表里摘掉。 */
export function pruneOverride(override: CompactionModelOverride): CompactionModelOverride | null {
  const clean: CompactionModelOverride = {};
  if (override.reserveTokens !== undefined) clean.reserveTokens = override.reserveTokens;
  if (override.keepRecentTokens !== undefined) clean.keepRecentTokens = override.keepRecentTokens;
  return clean.reserveTokens === undefined && clean.keepRecentTokens === undefined ? null : clean;
}

export function ContextBudgetSettingsBlock({ cwd }: { cwd: string | null }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<ContextBudgetSettings>(CONTEXT_BUDGET_DEFAULTS);
  const [drafts, setDrafts] = useState<Partial<Record<NumericKey, string | null>>>({});
  const [overrideDrafts, setOverrideDrafts] = useState<OverrideDrafts>({});
  /** 已有的覆盖 + 本次会话新加但还没落盘的空行。顺序 = 添加顺序。 */
  const [rows, setRows] = useState<string[]>([]);
  const [modelRefs, setModelRefs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/context-budget-settings")
      .then(async (response) => {
        const data = await response.json() as Partial<ContextBudgetSettings> & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (cancelled) return;
        const next: ContextBudgetSettings = {
          enabled: data.enabled ?? CONTEXT_BUDGET_DEFAULTS.enabled,
          reserveTokens: data.reserveTokens ?? CONTEXT_BUDGET_DEFAULTS.reserveTokens,
          keepRecentTokens: data.keepRecentTokens ?? CONTEXT_BUDGET_DEFAULTS.keepRecentTokens,
          branchSummaryReserveTokens:
            data.branchSummaryReserveTokens ?? CONTEXT_BUDGET_DEFAULTS.branchSummaryReserveTokens,
          modelOverrides: data.modelOverrides ?? {},
        };
        setSettings(next);
        setRows(Object.keys(next.modelOverrides));
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  // 覆盖行的候选模型：复用设置页「会话命名模型」下拉那套 /api/models 拉取方式，
  // 键就是 SDK 查表用的 `${provider}/${id}`。
  useEffect(() => {
    const url = cwd ? `/api/models?cwd=${encodeURIComponent(cwd)}` : "/api/models";
    let cancelled = false;
    void fetch(url)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data: { modelList?: { id: string; name?: string; provider: string }[] }) => {
        if (cancelled) return;
        const refs = (data?.modelList ?? [])
          .filter((model) => model.id && model.provider)
          .map((model) => `${model.provider}/${model.id}`);
        setModelRefs([...new Set(refs)].sort());
      })
      .catch(() => {
        // 拿不到清单不是错误：手写进 settings.json 的覆盖仍然显示、仍然能改，
        // 只是没有「新增」的下拉可点。
        if (!cancelled) setModelRefs([]);
      });
    return () => { cancelled = true; };
  }, [cwd]);

  const save = async (update: Partial<ContextBudgetSettings>): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/context-budget-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contextBudgetRequestBody(update, cwd)),
      });
      const data = await response.json() as ContextBudgetSettings & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setSettings(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  /** 失焦 / 回车：算出一个合法值（非法输入回落到当前值），提交并丢掉草稿。 */
  const commitNumber = (key: NumericKey) => {
    const draft = drafts[key];
    if (draft === null || draft === undefined) return;
    setDrafts((current) => ({ ...current, [key]: null }));
    const next = numericInputToValue(draft, settings[key], 0, CONTEXT_BUDGET_MAX_TOKENS);
    if (next !== settings[key]) void save({ [key]: next });
  };

  /** 覆盖行的提交：空串 = 这个字段不覆盖；两个都空 = 删掉这条覆盖（行也随之消失）。 */
  const commitOverride = (modelRef: string, field: "reserveTokens" | "keepRecentTokens") => {
    const rowDraft = overrideDrafts[modelRef];
    if (!rowDraft || rowDraft[field] === null) return;
    const raw = rowDraft[field] ?? "";
    setOverrideDrafts((current) => ({ ...current, [modelRef]: { ...current[modelRef], [field]: null } }));
    const stored = settings.modelOverrides[modelRef] ?? {};
    const next = pruneOverride({
      ...stored,
      [field]: overrideInputToValue(raw, stored[field], 0, CONTEXT_BUDGET_MAX_TOKENS),
    });
    if (next === null) {
      setRows((current) => current.filter((ref) => ref !== modelRef));
      void save({ modelOverrides: { [modelRef]: {} } });
      return;
    }
    if (next.reserveTokens === stored.reserveTokens && next.keepRecentTokens === stored.keepRecentTokens) return;
    void save({ modelOverrides: { [modelRef]: next } });
  };

  const removeOverride = (modelRef: string) => {
    setRows((current) => current.filter((ref) => ref !== modelRef));
    void save({ modelOverrides: { [modelRef]: {} } });
  };

  const addOverride = (modelRef: string) => {
    if (!modelRef || rows.includes(modelRef)) return;
    setRows((current) => [...current, modelRef]);
  };

  /** 还没被覆盖的模型才进下拉 —— 已有的行自己有「移除」钮。 */
  const addOptions = useMemo(() => {
    const taken = new Set(rows);
    const candidates = modelRefs.filter((ref) => !taken.has(ref));
    return [
      { value: "", label: t("settings.contextBudgetOverrideAdd") },
      ...candidates.map((ref) => ({ value: ref, label: ref })),
    ];
  }, [modelRefs, rows, t]);

  // 读不出来（422 / 网络）时锁住控件：这时任何写入都可能覆盖掉一个我们读不懂的文件。
  const locked = loading || error !== null;

  return (
    <PwBlock icon="scan-text" title={t("settings.contextBudgetBlock")}>
      <PwField
        label={t("settings.contextBudgetEnabled")}
        hint={t("settings.contextBudgetEnabledHint")}
        control={
          <PwSwitch
            checked={settings.enabled}
            disabled={locked}
            loading={saving}
            label={t("settings.contextBudgetEnabled")}
            onChange={(enabled) => void save({ enabled })}
          />
        }
      />
      {NUMERIC_FIELDS.map((field) => {
        const inputId = `settings-context-${field.key}`;
        return (
          <PwField
            key={field.key}
            label={<>{t(field.label)}<small>{t(field.hint)}</small></>}
            htmlFor={inputId}
            control={
              <PwCtl>
                <input
                  id={inputId}
                  className="pw-input pw-numin"
                  type="number"
                  min={0}
                  max={CONTEXT_BUDGET_MAX_TOKENS}
                  step={field.step}
                  disabled={locked || saving}
                  value={drafts[field.key] ?? String(settings[field.key])}
                  onChange={(event) => setDrafts((current) => ({ ...current, [field.key]: event.target.value }))}
                  onBlur={() => commitNumber(field.key)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitNumber(field.key);
                  }}
                />
              </PwCtl>
            }
          />
        );
      })}
      {rows.map((modelRef) => {
        const override = settings.modelOverrides[modelRef] ?? {};
        const rowDraft = overrideDrafts[modelRef] ?? { reserveTokens: null, keepRecentTokens: null };
        const removeLabel = t("settings.contextBudgetOverrideRemove");
        return (
          <PwField
            key={modelRef}
            label={<span className="pw-mono">{modelRef}</span>}
            control={
              <PwCtl>
                {(["reserveTokens", "keepRecentTokens"] as const).map((field) => {
                  const fieldLabel = t(field === "reserveTokens"
                    ? "settings.contextBudgetOverrideReserve"
                    : "settings.contextBudgetOverrideKeepRecent");
                  return (
                    <input
                      key={field}
                      className="pw-input pw-numin"
                      type="number"
                      min={0}
                      max={CONTEXT_BUDGET_MAX_TOKENS}
                      step={1024}
                      disabled={locked || saving}
                      aria-label={`${modelRef} ${fieldLabel}`}
                      title={`${modelRef} · ${fieldLabel}`}
                      value={rowDraft[field] ?? (override[field] === undefined ? "" : String(override[field]))}
                      onChange={(event) => setOverrideDrafts((current) => ({
                        ...current,
                        [modelRef]: { ...current[modelRef], [field]: event.target.value },
                      }))}
                      onBlur={() => commitOverride(modelRef, field)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitOverride(modelRef, field);
                      }}
                    />
                  );
                })}
                <button
                  type="button"
                  className="pw-iconbtn sm"
                  disabled={locked || saving}
                  aria-label={removeLabel}
                  title={removeLabel}
                  onClick={() => removeOverride(modelRef)}
                >
                  <span className="pw-ico"><i data-ico="trash-2" data-size="13" aria-hidden="true" /></span>
                </button>
              </PwCtl>
            }
          />
        );
      })}
      <PwField
        label={t("settings.contextBudgetOverrideAdd")}
        hint={t("settings.contextBudgetOverrideAddHint")}
        control={
          <PwSelectBox
            value=""
            ariaLabel={t("settings.contextBudgetOverrideAdd")}
            disabled={locked || saving || addOptions.length === 1}
            options={addOptions}
            onChange={addOverride}
          />
        }
      />
      {error ? (
        <div role="alert" className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
          <span className="pw-grow">{error}</span>
        </div>
      ) : null}
    </PwBlock>
  );
}
