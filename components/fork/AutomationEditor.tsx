"use client";

/*
 * fork:proma-43-automation —— 定时任务的编辑表单。
 *
 * 表单只做三件事：把四种调度模式各自的字段摆出来、把三语文案摆出来、把值交回去。
 * 一切校验与规范化都在服务端 `normalizeAutomationDraft()`（`lib/automation-types.ts`），
 * 这里不重复一套 —— 两份校验规则迟早会分叉，而分叉的那份永远是没人跑的那个。
 *
 * 样式基件全部是既有的 `.pw-*`（SettingsUi.tsx / board 40 的设置页规格），
 * 本文件只新增 `.fork-automation-*` 那一小段（见 app/fork-ui.css）。
 */
import { Fragment, useState, type ReactNode } from "react";
import { ConfigField, ConfigSectionTitle } from "../SettingsUi";
import { useI18n } from "@/hooks/useI18n";
import { PwaPickBar, PwaSetRow } from "@/components/pwa/PwaPage";
import {
  AUTOMATION_SCHEDULE_TYPES,
  AUTOMATION_WEEKDAYS,
  type AutomationDraft,
  type AutomationScheduleType,
  type AutomationSessionMode,
} from "@/lib/automation-types";

export interface AutomationEditorProps {
  draft: AutomationDraft;
  onChange: (next: AutomationDraft) => void;
  disabled?: boolean;
  modelOptions: Array<{ value: string; label: string }>;
  /**
   * fork:v5-landing Wave B —— 形态分支。`desktop` 走画板 D-17 的 `.d-*` 表单，
   * `mobile` 走画板 M-09 帧 B「新建定时任务」的 `.m-*` 表单。默认值是 desktop，
   * 所以其他调用方（含既有测试）不受影响。
   */
  variant?: "desktop" | "mobile";
}

/** `datetime-local` 要的是本地 `YYYY-MM-DDTHH:mm`，不是 ISO 字符串。 */
function toLocalInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function AutomationEditor({
  draft,
  onChange,
  disabled = false,
  modelOptions,
  variant = "desktop",
}: AutomationEditorProps): ReactNode {
  const { t } = useI18n();
  // `datetime-local` 的初值要用「现在」兜底，但渲染期不许调 Date.now()（不纯），
  // 所以在 useState 的惰性初始化里取一次，之后一直不变。
  const [fallbackNow] = useState(() => Date.now());

  const set = <K extends keyof AutomationDraft>(key: K, value: AutomationDraft[K]): void => {
    onChange({ ...draft, [key]: value });
  };

  const toggleWeekday = (day: number): void => {
    const current = new Set(draft.activeWeekdays ?? []);
    if (current.has(day)) current.delete(day);
    else current.add(day);
    set("activeWeekdays", [...current].sort((a, b) => a - b));
  };

  const scheduleFields = (type: AutomationScheduleType): ReactNode => {
    if (type === "once") {
      return (
        <ConfigField label={t("automation.scheduledAt")} hint={t("automation.nextRun")}>
          <input
            className="d-input"
            type="datetime-local"
            disabled={disabled}
            value={toLocalInputValue(draft.scheduledAt ?? fallbackNow)}
            onChange={(event) => {
              const parsed = Date.parse(event.target.value);
              if (Number.isFinite(parsed)) set("scheduledAt", parsed);
            }}
          />
        </ConfigField>
      );
    }

    if (type === "interval") {
      return (
        <Fragment>
          <ConfigField label={t("automation.interval")}>
            <input
              className="d-input" style={{ width: 90, fontVariantNumeric: "tabular-nums" }}
              type="number"
              min={1}
              step={1}
              disabled={disabled}
              value={draft.intervalMinutes}
              onChange={(event) => set("intervalMinutes", Math.max(1, Number(event.target.value) || 1))}
            />
          </ConfigField>
          <ConfigField label={t("automation.activeDays")}>
            <div className="fork-automation-days">
              {AUTOMATION_WEEKDAYS.map((day) => {
                const on = (draft.activeWeekdays ?? []).includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={disabled}
                    aria-pressed={on}
                    className="d-chipbtn fork-automation-day"
                    onClick={() => toggleWeekday(day)}
                  >
                    {t(`automation.weekday.${day}`)}
                  </button>
                );
              })}
            </div>
          </ConfigField>
          <ConfigField label={t("automation.window")} hint={t("automation.windowHint")}>
            <div className="d-row">
              <input
                className="d-input" style={{ width: 90, fontVariantNumeric: "tabular-nums" }}
                type="time"
                disabled={disabled}
                value={draft.activeWindowStart ?? ""}
                onChange={(event) => set(
                  "activeWindowStart",
                  event.target.value || undefined
                )}
              />
              <span className="d-t-faint">–</span>
              <input
                className="d-input" style={{ width: 90, fontVariantNumeric: "tabular-nums" }}
                type="time"
                disabled={disabled}
                value={draft.activeWindowEnd ?? ""}
                onChange={(event) => set(
                  "activeWindowEnd",
                  event.target.value || undefined
                )}
              />
            </div>
          </ConfigField>
        </Fragment>
      );
    }

    return (
      <Fragment>
        {type === "weekly" && (
          <ConfigField label={t("automation.dayOfWeek")}>
            <select
              className="d-select"
              disabled={disabled}
              value={draft.dayOfWeek ?? 1}
              onChange={(event) => set("dayOfWeek", Number(event.target.value))}
            >
              {AUTOMATION_WEEKDAYS.map((day) => (
                <option key={day} value={day}>{t(`automation.weekday.${day}`)}</option>
              ))}
            </select>
          </ConfigField>
        )}
        <ConfigField label={t("automation.timeOfDay")}>
          <input
            className="d-input" style={{ width: 90, fontVariantNumeric: "tabular-nums" }}
            type="time"
            disabled={disabled}
            value={draft.timeOfDay ?? "09:00"}
            onChange={(event) => set("timeOfDay", event.target.value || "09:00")}
          />
        </ConfigField>
      </Fragment>
    );
  };

  // fork:v5-landing Wave B · M-09 帧 B「新建定时任务」——
  // 表单结构照画板：分节 = `.m-cardgroup`，标签行 = `.m-setrow`，控件槽 = `.m-doc-body`
  // （M-05 帧 C 的那一行就是「标签行 + 控件行」两段，中间靠 `.m-doc-body` 收边）。
  // 四种调度模式走 `.m-pickbar` / `.m-picktag`（画板里就是四个 tag 互斥，一个不多）。
  // 字段、取值、校验口径与桌面**完全同一套**（`set()` / 服务端 normalize），
  // 这里只换皮：没有新增字段、没有改默认值、没有绕过 `disabled`。
  const mobileLabel = (label: string) => (
    <PwaSetRow label={<span className="m-setrow-t">{label}</span>} />
  );
  const mobileSlot = (control: ReactNode) => <div className="m-doc-body">{control}</div>;

  if (variant === "mobile") {
    return (
      <Fragment>
        <div className="m-cardgroup">
          <div className="m-group-title">{t("automation.scheduleType")}</div>
          <PwaPickBar
            options={AUTOMATION_SCHEDULE_TYPES.map((type) => ({
              value: type,
              label: t(`automation.scheduleType.${type}`),
            }))}
            value={draft.scheduleType}
            onChange={(next) => set("scheduleType", next as AutomationScheduleType)}
          />
          {draft.scheduleType === "once" && (
            <>
              {mobileLabel(t("automation.scheduledAt"))}
              {mobileSlot(
                <input
                  className="m-input"
                  style={{ width: "100%" }}
                  type="datetime-local"
                  disabled={disabled}
                  value={toLocalInputValue(draft.scheduledAt ?? fallbackNow)}
                  onChange={(event) => {
                    const parsed = Date.parse(event.target.value);
                    if (Number.isFinite(parsed)) set("scheduledAt", parsed);
                  }}
                />
              )}
            </>
          )}
          {draft.scheduleType === "interval" && (
            <>
              {mobileLabel(t("automation.interval"))}
              {mobileSlot(
                <input
                  className="m-input"
                  style={{ width: "100%" }}
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  disabled={disabled}
                  value={draft.intervalMinutes}
                  onChange={(event) => set("intervalMinutes", Math.max(1, Number(event.target.value) || 1))}
                />
              )}
              {mobileLabel(t("automation.activeDays"))}
              <div className="m-doc-body">
                <div className="m-chips">
                  {AUTOMATION_WEEKDAYS.map((day) => {
                    const on = (draft.activeWeekdays ?? []).includes(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        disabled={disabled}
                        aria-pressed={on}
                        className={`m-chipbtn${on ? " is-on" : ""}`}
                        onClick={() => toggleWeekday(day)}
                      >
                        {t(`automation.weekday.${day}`)}
                      </button>
                    );
                  })}
                </div>
              </div>
              {mobileLabel(t("automation.window"))}
              {mobileSlot(
                <div className="m-row-m">
                  <input
                    className="m-input"
                    style={{ width: "100%" }}
                    type="time"
                    disabled={disabled}
                    value={draft.activeWindowStart ?? ""}
                    onChange={(event) => set("activeWindowStart", event.target.value || undefined)}
                  />
                  <span className="m-t-faint">–</span>
                  <input
                    className="m-input"
                    style={{ width: "100%" }}
                    type="time"
                    disabled={disabled}
                    value={draft.activeWindowEnd ?? ""}
                    onChange={(event) => set("activeWindowEnd", event.target.value || undefined)}
                  />
                </div>)}
            </>
          )}
          {(draft.scheduleType === "daily" || draft.scheduleType === "weekly") && (
            <>
              {draft.scheduleType === "weekly" && (
                <>
                  {mobileLabel(t("automation.dayOfWeek"))}
                  {mobileSlot(
                    <select
                      className="m-input"
                      style={{ width: "100%" }}
                      disabled={disabled}
                      value={draft.dayOfWeek ?? 1}
                      onChange={(event) => set("dayOfWeek", Number(event.target.value))}
                    >
                      {AUTOMATION_WEEKDAYS.map((day) => (
                        <option key={day} value={day}>{t(`automation.weekday.${day}`)}</option>
                      ))}
                    </select>)}
                </>
              )}
              {mobileLabel(t("automation.timeOfDay"))}
              {mobileSlot(
                <input
                  className="m-input"
                  style={{ width: "100%" }}
                  type="time"
                  disabled={disabled}
                  value={draft.timeOfDay ?? "09:00"}
                  onChange={(event) => set("timeOfDay", event.target.value || "09:00")}
                />)}
            </>
          )}
        </div>

        <div className="m-cardgroup">
          <div className="m-group-title">{t("automation.content")}</div>
          {mobileLabel(t("automation.name"))}
          {mobileSlot(
            <input
              className="m-input"
              style={{ width: "100%" }}
              type="text"
              disabled={disabled}
              placeholder={t("automation.namePlaceholder")}
              value={draft.name}
              onChange={(event) => set("name", event.target.value)}
            />)}
          {mobileLabel(t("automation.prompt"))}
          {mobileSlot(
            <textarea
              className="m-input"
              /* `.m-input` 的高度锁在 `--nx-ctl-md`（44px），textarea 需要放开；
                 高度是 UA 行为而不是设计值，故走内联（画板 M-10 自己在附录里记了同一个缺口）。 */
              style={{ width: "100%", height: "auto" }}
              rows={4}
              disabled={disabled}
              placeholder={t("automation.promptPlaceholder")}
              value={draft.prompt}
              onChange={(event) => set("prompt", event.target.value)}
            />)}
          {mobileLabel(t("automation.cwd"))}
          {mobileSlot(
            <input
              className="m-input m-mono"
              style={{ width: "100%" }}
              type="text"
              disabled={disabled}
              value={draft.cwd ?? ""}
              onChange={(event) => set("cwd", event.target.value)}
            />)}
          {mobileLabel(t("automation.model"))}
          {mobileSlot(
            <select
              className="m-input"
              style={{ width: "100%" }}
              disabled={disabled}
              value={draft.model ?? ""}
              onChange={(event) => set("model", event.target.value || undefined)}
            >
              <option value="">{t("automation.modelDefault")}</option>
              {modelOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>)}
          {mobileLabel(t("automation.maxRuns"))}
          {mobileSlot(
            <input
              className="m-input"
              style={{ width: "100%" }}
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              disabled={disabled}
              value={draft.maxRuns ?? ""}
              onChange={(event) => set(
                "maxRuns",
                event.target.value === "" ? undefined : Math.max(1, Number(event.target.value) || 1)
              )}
            />)}
          {mobileLabel(t("automation.sessionMode"))}
          <div className="m-pickbar">
            <PwaPickBar
              className="m-grow"
              options={[
                { value: "daily", label: t("automation.sessionMode.daily") },
                { value: "reuse", label: t("automation.sessionMode.reuse") },
              ]}
              value={draft.sessionMode}
              onChange={(next) => set("sessionMode", next as AutomationSessionMode)}
            />
          </div>
        </div>
      </Fragment>
    );
  }

  return (
    <Fragment>
      <ConfigSectionTitle>{t("automation.schedule")}</ConfigSectionTitle>
      <ConfigField label={t("automation.scheduleType")}>
        <select
          className="d-select"
          disabled={disabled}
          value={draft.scheduleType}
          onChange={(event) => set("scheduleType", event.target.value as AutomationScheduleType)}
        >
          {AUTOMATION_SCHEDULE_TYPES.map((type) => (
            <option key={type} value={type}>{t(`automation.scheduleType.${type}`)}</option>
          ))}
        </select>
      </ConfigField>
      {scheduleFields(draft.scheduleType)}

      <ConfigSectionTitle>{t("automation.content")}</ConfigSectionTitle>
      <ConfigField label={t("automation.name")}>
        <input
          className="d-input"
          type="text"
          disabled={disabled}
          placeholder={t("automation.namePlaceholder")}
          value={draft.name}
          onChange={(event) => set("name", event.target.value)}
        />
      </ConfigField>
      {/* `.pw-field` 是 `align-items: center`：对 28px 的输入框正合适，对 112px 的
          textarea 会让标签飘在整块中间。这一行是唯一的高控件，就地顶对齐
          （`alignItems` 不在 check-style-literals 的几何槽位里，不需要 token）。 */}
      <ConfigField label={t("automation.prompt")} hint={t("automation.promptHint")} style={{ alignItems: "flex-start" }}>
        <textarea
          className="d-textarea fork-automation-prompt"
          rows={4}
          disabled={disabled}
          placeholder={t("automation.promptPlaceholder")}
          value={draft.prompt}
          onChange={(event) => set("prompt", event.target.value)}
        />
      </ConfigField>
      <ConfigField label={t("automation.cwd")}>
        <input
          className="d-input d-mono"
          type="text"
          disabled={disabled}
          value={draft.cwd ?? ""}
          onChange={(event) => set("cwd", event.target.value)}
        />
      </ConfigField>
      <ConfigField label={t("automation.model")} hint={t("automation.modelHint")}>
        <select
          className="d-select"
          disabled={disabled}
          value={draft.model ?? ""}
          onChange={(event) => set("model", event.target.value || undefined)}
        >
          {/* 空选项原来借用整句 hint 当标签（「留空则用会话默认模型。」），
              而同一句又显示在字段下面 —— 一行里说两遍。给个短标签。 */}
          <option value="">{t("automation.modelDefault")}</option>
          {modelOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </ConfigField>
      <ConfigField label={t("automation.maxRuns")} hint={t("automation.maxRunsHint")}>
        <input
          className="d-input" style={{ width: 90, fontVariantNumeric: "tabular-nums" }}
          type="number"
          min={1}
          step={1}
          disabled={disabled}
          value={draft.maxRuns ?? ""}
          onChange={(event) => set(
            "maxRuns",
            event.target.value === "" ? undefined : Math.max(1, Number(event.target.value) || 1),
          )}
        />
      </ConfigField>

      {/* fork:automation-layout —— 这里原来还有一行 `ConfigSectionTitle`，内容与下面那个
          字段标签一字不差（这一节只有这一个字段），于是屏幕上出现两遍「子会话复用」。
          字段标签已经说清了，标题删掉。 */}
      <ConfigField label={t("automation.sessionMode")} hint={t("automation.sessionModeHint")}>
        <select
          className="d-select"
          disabled={disabled}
          value={draft.sessionMode}
          onChange={(event) => set("sessionMode", event.target.value as AutomationSessionMode)}
        >
          <option value="daily">{t("automation.sessionMode.daily")}</option>
          <option value="reuse">{t("automation.sessionMode.reuse")}</option>
        </select>
      </ConfigField>
    </Fragment>
  );
}