import { useMemo, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  WEEKDAY_ORDER,
  isoToDatetimeLocal,
  normalizeHm,
  timeZoneLabel,
  timeZoneOptions,
  zoneOffsetMinutes,
  type ScheduleFormError,
  type ScheduleFormState,
  type ScheduleKind,
} from "@/components/schedules/schedule-time";
import { cn } from "@/lib/utils";
import { CRON_PRESETS } from "@shared/cron";
import { MAX_DURATION_LIMITS } from "@shared/schedules";
import type { Project } from "@shared/types";

const SCRATCH = "__scratch__";

/** 24 小时制的时与分；分钟按 5 步长，够用又不用滚过 60 项。 */
const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));

export function TaskForm({
  form,
  projects,
  error,
  saving,
  onChange,
  onSubmit,
  onCancel,
}: {
  form: ScheduleFormState;
  projects: Project[];
  error: ScheduleFormError | null;
  saving: boolean;
  onChange: (patch: Partial<ScheduleFormState>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useTranslation("schedules");
  const zones = useMemo(() => timeZoneOptions(form.timeZone), [form.timeZone]);
  const [hour, minute] = normalizeHm(form.time).split(":");
  const projectOptions = useMemo(
    () =>
      projectChoices(projects, form.project, {
        scratch: t("projectScratch"),
        remote: t("projectRemote"),
        missing: t("projectMissing"),
      }),
    [projects, form.project, t],
  );
  const kindItems = {
    once: t("kind.once"),
    daily: t("kind.daily"),
    weekly: t("kind.weekly"),
    cron: t("kind.cron"),
  };
  const presetItems = CRON_PRESETS.map((preset) => ({
    expr: preset.expr,
    label: `${i18n.language === "en" ? preset.en : preset.zh} · ${preset.expr}`,
  }));
  const projectItems = Object.fromEntries(projectOptions.map((item) => [item.value, item.label]));
  const zoneItems = Object.fromEntries(zones.map((zone) => [zone, zone]));
  const minAt = isoToDatetimeLocal(new Date().toISOString());

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Field label={t("name")} htmlFor="schedule-name" error={error === "name" ? t("errors.name") : undefined}>
        <Input
          id="schedule-name"
          value={form.name}
          disabled={saving}
          placeholder={t("namePlaceholder")}
          aria-invalid={error === "name" || undefined}
          onChange={(event) => onChange({ name: event.target.value })}
        />
      </Field>
      <Field label={t("prompt")} htmlFor="schedule-prompt" error={error === "prompt" ? t("errors.prompt") : undefined}>
        <Textarea
          id="schedule-prompt"
          value={form.prompt}
          disabled={saving}
          placeholder={t("promptPlaceholder")}
          className="min-h-28"
          aria-invalid={error === "prompt" || undefined}
          onChange={(event) => onChange({ prompt: event.target.value })}
        />
      </Field>
      <Field label={t("project")} hint={t("projectHint")}>
        <Select
          items={projectItems}
          value={form.project || SCRATCH}
          disabled={saving}
          onValueChange={(next) => {
            if (typeof next !== "string") return;
            onChange({ project: next === SCRATCH ? "" : next });
          }}
        >
          <SelectTrigger className="w-full" aria-label={t("project")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {projectOptions.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label={t("kind.label")}>
        <Select
          items={kindItems}
          value={form.kind}
          disabled={saving}
          onValueChange={(next) => {
            if (next === "once" || next === "daily" || next === "weekly" || next === "cron") {
              onChange({ kind: next satisfies ScheduleKind });
            }
          }}
        >
          <SelectTrigger className="w-full" aria-label={t("kind.label")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="once">{t("kind.once")}</SelectItem>
            <SelectItem value="daily">{t("kind.daily")}</SelectItem>
            <SelectItem value="weekly">{t("kind.weekly")}</SelectItem>
            <SelectItem value="cron">{t("kind.cron")}</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {form.kind === "cron" ? (
        <>
          <Field
            label={t("expr")}
            htmlFor="schedule-expr"
            hint={t("exprHint")}
            error={error === "expr" ? t("errors.expr") : undefined}
          >
            <Input
              id="schedule-expr"
              value={form.expr}
              disabled={saving}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="font-mono"
              placeholder="0 9 * * 1-5"
              aria-invalid={error === "expr" || undefined}
              onChange={(event) => onChange({ expr: event.target.value })}
            />
          </Field>
          {/* 预设只是糖：填进去的是表达式本身，用户可以接着改。 */}
          <div className="flex flex-wrap gap-1.5">
            {presetItems.map((preset) => (
              <Button
                key={preset.expr}
                type="button"
                size="xs"
                variant={form.expr.trim() === preset.expr ? "secondary" : "outline"}
                disabled={saving}
                onClick={() => onChange({ expr: preset.expr })}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </>
      ) : null}
      {form.kind === "once" ? (
        <Field
          label={t("at")}
          htmlFor="schedule-at"
          hint={t("atHint")}
          error={error === "at" || error === "atPast" ? t(`errors.${error}`) : undefined}
        >
          <Input
            id="schedule-at"
            type="datetime-local"
            step={60}
            min={minAt}
            value={form.at}
            disabled={saving}
            aria-invalid={error === "at" || error === "atPast" || undefined}
            onChange={(event) => onChange({ at: event.target.value })}
          />
        </Field>
      ) : form.kind === "cron" ? (
        <Field label={t("timeZone")} error={error === "timeZone" ? t("errors.timeZone") : undefined}>
          {zones.length > 1 ? (
            <Select
              items={zoneItems}
              value={form.timeZone}
              disabled={saving}
              onValueChange={(next) => {
                if (typeof next === "string") onChange({ timeZone: next });
              }}
            >
              <SelectTrigger className="w-full" aria-label={t("timeZone")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {zones.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {timeZoneLabel(zone, i18n.language, zoneOffsetMinutes(zone))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={form.timeZone}
              disabled={saving}
              aria-label={t("timeZone")}
              onChange={(event) => onChange({ timeZone: event.target.value })}
            />
          )}
        </Field>
      ) : (
        <>
          <div className="grid gap-4 @min-[28rem]/tasks:grid-cols-2">
            <Field label={t("time")} htmlFor="schedule-time" error={error === "time" ? t("errors.time") : undefined}>
              {/*
                两个下拉，不是一个 `<input type="time">`。后者在 macOS 上弹的是系统自带的
                双列滚轮，样式改不了、与这个界面完全不搭（用户 2026-10-14 截图指出）。
                小时/分钟分开选，用的是本页其余地方同一个 Select。
              */}
              <div className="flex items-center gap-2" id="schedule-time">
                <Select
                  value={hour}
                  disabled={saving}
                  onValueChange={(next) => onChange({ time: `${next ?? hour}:${minute}` })}
                >
                  <SelectTrigger size="sm" className="w-20" aria-label={t("hour")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">:</span>
                <Select
                  value={minute}
                  disabled={saving}
                  onValueChange={(next) => onChange({ time: `${hour}:${next ?? minute}` })}
                >
                  <SelectTrigger size="sm" className="w-20" aria-label={t("minute")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MINUTES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </Field>
            <Field label={t("timeZone")} error={error === "timeZone" ? t("errors.timeZone") : undefined}>
              {zones.length > 1 ? (
                <Select
                  items={zoneItems}
                  value={form.timeZone}
                  disabled={saving}
                  onValueChange={(next) => {
                    if (typeof next === "string") onChange({ timeZone: next });
                  }}
                >
                  <SelectTrigger className="w-full" aria-label={t("timeZone")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {zones.map((zone) => (
                      <SelectItem key={zone} value={zone}>
                        {/* 人挑的是自己的钟，不是一串 IANA id —— 名字随界面语言。 */}
                        {timeZoneLabel(zone, i18n.language, zoneOffsetMinutes(zone))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={form.timeZone}
                  disabled={saving}
                  aria-label={t("timeZone")}
                  aria-invalid={error === "timeZone" || undefined}
                  onChange={(event) => onChange({ timeZone: event.target.value })}
                />
              )}
            </Field>
          </div>
          {form.kind === "weekly" ? (
            <Field label={t("daysLabel")} error={error === "days" ? t("errors.days") : undefined}>
              <div className="flex flex-wrap gap-2">
                {WEEKDAY_ORDER.map((day) => {
                  const checked = form.days.includes(day);
                  return (
                    <label
                      key={day}
                      className={cn(
                        "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-sm pointer-coarse:h-10",
                        checked ? "border-primary/40 bg-primary/10" : "border-border",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={saving}
                        aria-label={t(`days.${day}`)}
                        onCheckedChange={(value) => onChange({ days: toggleDay(form.days, day, value === true) })}
                      />
                      {t(`days.${day}`)}
                    </label>
                  );
                })}
              </div>
            </Field>
          ) : null}
        </>
      )}
      <Field
        label={t("maxDuration")}
        htmlFor="schedule-duration"
        hint={t("maxDurationHint", { min: MAX_DURATION_LIMITS.min, max: MAX_DURATION_LIMITS.max })}
        error={error === "duration" ? t("errors.duration") : undefined}
      >
        <Input
          id="schedule-duration"
          type="number"
          inputMode="numeric"
          min={MAX_DURATION_LIMITS.min}
          max={MAX_DURATION_LIMITS.max}
          step={1}
          disabled={saving}
          className="w-28"
          aria-invalid={error === "duration" || undefined}
          value={form.maxDurationMinutes}
          onChange={(event) => onChange({ maxDurationMinutes: Number(event.target.value) })}
        />
      </Field>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" disabled={saving}>
          {t("save")}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function toggleDay(days: number[], day: number, on: boolean): number[] {
  const next = new Set(days);
  if (on) next.add(day);
  else next.delete(day);
  return [...next];
}

function projectChoices(
  projects: Project[],
  current: string,
  labels: { scratch: string; remote: string; missing: string },
): Array<{ value: string; label: string }> {
  const options = [{ value: SCRATCH, label: labels.scratch }];
  const seen = new Set<string>();
  for (const project of projects) {
    seen.add(project.cwd);
    const remote = project.kind === "remote" ? ` (${labels.remote})` : "";
    options.push({ value: project.cwd, label: `${project.name}${remote}` });
  }
  if (current && !seen.has(current)) options.push({ value: current, label: `${current} (${labels.missing})` });
  return options;
}
