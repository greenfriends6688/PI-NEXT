"use client";

/**
 * fork:pr12-a6-thinking-budget —— pi 的 `settings.thinkingBudgets` 四档 token 预算块。
 *
 * A6 的问题：pi 认这四个字段（`settings-manager.d.ts:50-53`），运行时由 pi-ai 的
 * `thinkingBudgetForLevel` 消费，设置页里**一个控件都没有**。0.87 的 `SettingsManager`
 * 连 setter 都没有（只有一个 `getThinkingBudgets()`），所以整条写入路径与逐字段结论见
 * `lib/thinking-budget-settings.ts` 头。
 *
 * DOM 照画板 40 帧 1 右栏 / 62 帧 C 右栏（`.pw-block` + 一句 `.pw-hint` + 四条 `.pw-field`）：
 * 四个窄数值框照「重试策略」块（`.pw-ctl > .pw-input.pw-numin`，类来自画板 44）——
 * **没有新 `.pw-*` 类**，`board.css` 不动，判据⑦ 不触发。
 *
 * 四件事必须在这一块讲清楚，否则用户会以为改了就有用（`models.configBlock` 里那类坑）：
 *   1. 只有**按 token 计思考预算**的供应商用得上（Anthropic / Bedrock / Google）；
 *      走 reasoning effort 的供应商发的是 effort 档位，这个预算根本不在请求里。
 *   2. 思考强度还有 `off` / `xhigh` / `max`，但 `thinkingBudgets` 只有四键：`off` 不发思考
 *      参数，`xhigh` / `max` 被 pi-ai 的 `clampReasoning` 折回 `high`（共用 high 这一档）。
 *   3. pi-ai 会按模型的输出上限再夹一次，并且无论如何给答案留 1024 tokens
 *      （`MIN_ANSWER_TOKENS`），所以填一个很大的数不等于真的能想那么久。
 *   4. 改了即时生效（每个新请求都读设置），但**当前这一次请求**已经发出去了。
 */
import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { PwBlock, PwCtl, PwField } from "./SettingsUi";
import { numericInputToValue } from "./RetrySettingsBlock";
import {
  THINKING_BUDGET_DEFAULTS,
  THINKING_BUDGET_LEVELS,
  THINKING_BUDGET_MAX_TOKENS,
  type ThinkingBudgetLevel,
  type ThinkingBudgetSettings,
} from "@/lib/thinking-budget-settings-shared";

/** 四档的标签键 —— 顺序即思考强度从低到高。 */
const LEVEL_LABEL_KEYS: Record<ThinkingBudgetLevel, string> = {
  minimal: "settings.thinkingBudgetMinimal",
  low: "settings.thinkingBudgetLow",
  medium: "settings.thinkingBudgetMedium",
  high: "settings.thinkingBudgetHigh",
};

/** 输入框的草稿（null = 不在编辑，回落到服务端值）。 */
type NumericDrafts = Partial<Record<ThinkingBudgetLevel, string | null>>;

/** PUT 请求体：这一段没有 SDK 写入路径，全局设置也不需要 cwd，所以只带要改的键。 */
export function thinkingBudgetRequestBody(
  update: Partial<ThinkingBudgetSettings>,
): Record<string, unknown> {
  return { ...update };
}

export function ThinkingBudgetSettingsBlock() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<ThinkingBudgetSettings>(THINKING_BUDGET_DEFAULTS);
  const [drafts, setDrafts] = useState<NumericDrafts>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/thinking-budget-settings")
      .then(async (response) => {
        const data = await response.json() as Partial<ThinkingBudgetSettings> & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (cancelled) return;
        setSettings({
          minimal: data.minimal ?? THINKING_BUDGET_DEFAULTS.minimal,
          low: data.low ?? THINKING_BUDGET_DEFAULTS.low,
          medium: data.medium ?? THINKING_BUDGET_DEFAULTS.medium,
          high: data.high ?? THINKING_BUDGET_DEFAULTS.high,
        });
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const save = async (update: Partial<ThinkingBudgetSettings>): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/thinking-budget-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(thinkingBudgetRequestBody(update)),
      });
      const data = await response.json() as ThinkingBudgetSettings & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setSettings(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  /** 失焦 / 回车：算出一个合法值（非法输入回落到当前值），提交并丢掉草稿。 */
  const commitNumber = (level: ThinkingBudgetLevel) => {
    const draft = drafts[level];
    if (draft === null || draft === undefined) return;
    setDrafts((current) => ({ ...current, [level]: null }));
    // 下限是 1：预算为 0 等于「这一档不思考」，那是关掉思考的开关该管的事。
    const next = numericInputToValue(draft, settings[level], 1, THINKING_BUDGET_MAX_TOKENS);
    if (next !== settings[level]) void save({ [level]: next });
  };

  // 读不出来（422 / 网络）时锁住四个控件：这时任何写入都可能覆盖掉一个我们读不懂的文件。
  const locked = loading || error !== null;

  return (
    <PwBlock icon="brain" title={t("settings.thinkingBudgetBlock")}>
      <p className="pw-hint">{t("settings.thinkingBudgetHint")}</p>
      {THINKING_BUDGET_LEVELS.map((level) => {
        const inputId = `settings-thinking-budget-${level}`;
        return (
          <PwField
            key={level}
            label={<>{t(LEVEL_LABEL_KEYS[level])}<small>{t("settings.thinkingBudgetDefault", {
              tokens: THINKING_BUDGET_DEFAULTS[level],
            })}</small></>}
            htmlFor={inputId}
            control={
              <PwCtl>
                <input
                  id={inputId}
                  className="pw-input pw-numin"
                  type="number"
                  min={1}
                  max={THINKING_BUDGET_MAX_TOKENS}
                  step={1024}
                  disabled={locked || saving}
                  value={drafts[level] ?? String(settings[level])}
                  onChange={(event) => setDrafts((current) => ({ ...current, [level]: event.target.value }))}
                  onBlur={() => commitNumber(level)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitNumber(level);
                  }}
                />
              </PwCtl>
            }
          />
        );
      })}
      {error ? (
        <div role="alert" className="pw-alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
          <span className="pw-grow">{error}</span>
        </div>
      ) : null}
    </PwBlock>
  );
}
