"use client";

/**
 * fork:upstream-0.9.3-retry-settings —— pi 的 `settings.retry` 三个键的设置块。
 *
 * 这是「后端已有、只差一个 UI 入口」那批里最典型的一条：字段一直在
 * `~/.pi/agent/settings.json` 里、pi 一直认（`settings-manager.d.ts:23-29`），
 * 本产品一直读出来透传（`lib/pi-types.ts:140` `autoRetryEnabled` ←
 * `lib/rpc-manager.ts:854`），但从来没有地方能改。
 *
 * DOM 照画板 40 帧 1 右栏末块 / 62 帧 C 右栏末块（`.pw-block` + 三行 `.pw-field`）：
 * 开关照「通知」块，两个数值框照画板 44「最大运行次数」那一行
 * （`.pw-ctl > .pw-input.pw-numin`，类在 `design/pi-web-design/assets/board.css`，
 * 判据⑦）。登记见 DIVERGENCE V 节。
 *
 * 三条行为约定：
 * - **即时生效**：本页副标题写死「改动即时生效，不需要保存」，所以开关点一下就 PUT；
 *   数值框在**失焦 / 回车**时提交，不在每次按键时提交（否则打 "2000" 会发四次请求，
 *   其中三次带着半截数字）。
 * - **读不出来就摆事实**：GET 返回 422（settings.json 坏了）时三个控件全禁用并显示原因，
 *   不用默认值假装没事 —— 照 `lib/models-config-store.ts` 那条「解析失败被吞成空配置、
 *   下一次保存把全部 provider 抹掉」的教训。失败详情见 `lib/retry-settings.ts` 头。
 * - **提交后以磁盘为准**：响应体是服务端重新读出来的值，本地状态直接采用它，
 *   所以并发改动与服务端钳制都看得见。
 */
import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { PwBlock, PwCtl, PwField, PwSwitch } from "./SettingsUi";
import {
  RETRY_DEFAULTS,
  RETRY_MAX_BASE_DELAY_MS,
  RETRY_MAX_RETRIES,
  type RetrySettings,
} from "@/lib/retry-settings";

type NumericKey = "maxRetries" | "baseDelayMs";

/** 两个数值框的规格表 —— 上下限与 `lib/retry-settings.ts` 的服务端校验同源。 */
const NUMERIC_FIELDS: readonly { key: NumericKey; min: number; max: number; step: number }[] = [
  { key: "maxRetries", min: 0, max: RETRY_MAX_RETRIES, step: 1 },
  { key: "baseDelayMs", min: 0, max: RETRY_MAX_BASE_DELAY_MS, step: 100 },
];

/** 输入框的草稿（null = 不在编辑，回落到服务端值）。 */
type NumericDrafts = { maxRetries: string | null; baseDelayMs: string | null };
const NO_DRAFTS: NumericDrafts = { maxRetries: null, baseDelayMs: null };

/**
 * 输入框里的字符串 → 可提交的值。
 *
 * 空串 / 非数字 / 越界一律回落到 `current`（并夹进范围），所以「输入框里打字」这件事
 * 永远不会产生一次非法请求 —— 用户删掉数字重新输入时提交的就是上一个有效值。
 * 导出是为了能单测：这段是本组件里唯一有分支的逻辑。
 */
export function numericInputToValue(raw: string, current: number, min: number, max: number): number {
  const trimmed = raw.trim();
  if (trimmed === "") return current;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return current;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/** PUT 请求体：`cwd` 只是给 `SettingsManager` 当工作目录（全局 settings 不用它），null 就不带。 */
export function retryRequestBody(
  update: Partial<RetrySettings>,
  cwd: string | null,
): Record<string, unknown> {
  return cwd === null ? { ...update } : { ...update, cwd };
}

export function RetrySettingsBlock({ cwd }: { cwd: string | null }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<RetrySettings>(RETRY_DEFAULTS);
  const [drafts, setDrafts] = useState<NumericDrafts>(NO_DRAFTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/retry-settings")
      .then(async (response) => {
        const data = await response.json() as Partial<RetrySettings> & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (cancelled) return;
        setSettings({
          enabled: data.enabled ?? RETRY_DEFAULTS.enabled,
          maxRetries: data.maxRetries ?? RETRY_DEFAULTS.maxRetries,
          baseDelayMs: data.baseDelayMs ?? RETRY_DEFAULTS.baseDelayMs,
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

  const save = async (update: Partial<RetrySettings>): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/retry-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(retryRequestBody(update, cwd)),
      });
      const data = await response.json() as RetrySettings & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setSettings(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  /** 失焦 / 回车：算出一个合法值（非法输入回落到当前值），提交并丢掉草稿。 */
  const commitNumber = (key: NumericKey, spec: { min: number; max: number }) => {
    const draft = drafts[key];
    if (draft === null) return;
    setDrafts((current) => ({ ...current, [key]: null }));
    const next = numericInputToValue(draft, settings[key], spec.min, spec.max);
    if (next !== settings[key]) void save({ [key]: next });
  };

  // 读不出来（422 / 网络）时锁住三个控件：这时任何写入都可能覆盖掉一个我们读不懂的文件。
  const locked = loading || error !== null;

  return (
    <PwBlock icon="refresh-cw" title={t("settings.retryBlock")}>
      <PwField
        label={t("settings.retryEnabled")}
        hint={t("settings.retryEnabledHint")}
        control={
          <PwSwitch
            checked={settings.enabled}
            disabled={locked}
            loading={saving}
            label={t("settings.retryEnabled")}
            onChange={(enabled) => void save({ enabled })}
          />
        }
      />
      {NUMERIC_FIELDS.map((field) => {
        const inputId = `settings-retry-${field.key}`;
        const maxRetries = field.key === "maxRetries";
        return (
          <PwField
            key={field.key}
            label={maxRetries
              ? t("settings.retryMaxRetries")
              // 毫秒这个单位挂在标签上：画板 40 把单位放在 `.pw-mono` 读数位里，
              // 这里是可编辑的 input，没有读数位（见 DIVERGENCE V-2）。
              : <>{t("settings.retryBaseDelayMs")}<small>{t("settings.retryBaseDelayHint")}</small></>}
            htmlFor={inputId}
            control={
              <PwCtl>
                <input
                  id={inputId}
                  className="pw-input pw-numin"
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  disabled={locked || saving}
                  value={drafts[field.key] ?? String(settings[field.key])}
                  onChange={(event) => setDrafts((current) => ({ ...current, [field.key]: event.target.value }))}
                  onBlur={() => commitNumber(field.key, field)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitNumber(field.key, field);
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