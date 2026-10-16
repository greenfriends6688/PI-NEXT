import type { ScheduleRule, ScheduledTask, ScheduledTaskDraft } from "@shared/schedules";
import { DEFAULT_MAX_DURATION_MIN, MAX_DURATION_LIMITS } from "@shared/schedules";
import type { ThinkingLevel } from "@shared/types";
import { parseCron } from "@shared/cron";

/** Monday-first display order. Values stay Sunday=0 … Saturday=6, matching the schedule rule. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type ScheduleKind = ScheduleRule["kind"];

export type ScheduleFormState = {
  name: string;
  prompt: string;
  /** Empty means a fresh scratch chat. */
  project: string;
  kind: ScheduleKind;
  /** `datetime-local` value, local wall time. */
  at: string;
  /** `HH:mm`. */
  time: string;
  timeZone: string;
  days: number[];
  /** A five-field cron expression, when `kind` is `cron`. */
  expr: string;
  /** How long one run may last, in minutes. Sent for every kind. */
  maxDurationMinutes: number;
  /**
   * `""` follows the default (read-only); `"default"` is the full toolset.
   *
   * The empty string is the *safe* default rather than the full toolset, because the form's
   * first state is the one a task is created in, and an unattended run is the case where the
   * safe answer has to be the one nobody has to remember to pick.
   */
  toolPreset: "" | "default" | "read-only";
  /** `""` follows whatever the app is on. `provider/id`. */
  model: string;
  /** `""` leaves the model's own default; otherwise a level from THINKING_EFFORT_LEVELS. */
  thinkingLevel: "";
};

export type ScheduleFormError = "name" | "prompt" | "at" | "atPast" | "time" | "timeZone" | "days" | "expr" | "duration";

export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** IANA zones, with the machine's zone (and any saved zone) first. */
/**
 * The time zones to offer, **this machine's first**, then ordered by offset from UTC.
 *
 * `Intl.supportedValuesOf("timeZone")` returns IANA ids in plain alphabetical order, which
 * puts `Africa/Abidjan` … `Africa/Bangui` … in front of `Asia/Shanghai`: finding your own
 * zone means scrolling past a continent you are not on. Sorting by the offset each zone is
 * actually at (evaluated now, so DST is accounted for) puts the neighbours of the one you
 * want next to it, and the current zone stays pinned at the top.
 */
export function timeZoneOptions(current = localTimeZone()): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  const zones = intl.supportedValuesOf?.("timeZone") ?? [];
  const local = localTimeZone();
  const preferred = [current, local, "UTC"].filter((zone) => zone.length > 0);
  const rest = zones.filter((zone) => !preferred.includes(zone));
  return [...new Set([...preferred, ...rest.sort((a, b) => zoneOffsetMinutes(a) - zoneOffsetMinutes(b) || a.localeCompare(b))])];
}

/** Minutes east of UTC for a zone right now (so DST is included). */
export function zoneOffsetMinutes(zone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(parts ?? "");
    if (!match) return 0;
    return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
  } catch {
    return 0;
  }
}

/**
 * `Asia/Shanghai` → `中国标准时间`, via the platform's own name for it.
 *
 * A list of IANA ids is a list of strings; the person picking one is picking *their own
 * clock*. `timeZoneName: "long"` is the name a person would recognise, and it follows the
 * UI language, which the ids never did.
 */
export function timeZoneLabel(zone: string, locale: string, offsetMinutes?: number): string {
  try {
    const name = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "long" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    const sign = (offsetMinutes ?? 0) >= 0 ? "+" : "-";
    const abs = Math.abs(offsetMinutes ?? 0);
    const offset = offsetMinutes === undefined ? "" : ` (UTC${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")})`;
    return name ? `${name}${offset}` : `${zone}${offset}`;
  } catch {
    return zone;
  }
}

export function normalizeHm(value: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)/.exec(value);
  return match ? `${match[1]}:${match[2]}` : value;
}

export function isHm(value: string): boolean {
  return HM.test(value);
}

/** `datetime-local` (`YYYY-MM-DDTHH:mm`, local) → absolute ISO-8601. */
export function datetimeLocalToIso(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

/** Absolute ISO → `datetime-local` in the viewer's zone. */
export function isoToDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function emptyScheduleForm(now = Date.now()): ScheduleFormState {
  return {
    name: "",
    prompt: "",
    project: "",
    kind: "daily",
    at: isoToDatetimeLocal(new Date(now + 60 * 60 * 1000).toISOString()),
    time: "09:00",
    timeZone: localTimeZone(),
    days: [1, 2, 3, 4, 5],
    // A field with a value in it reads as「把这里改一下」; an empty one reads as a form that
    // has not loaded.
    expr: "0 9 * * 1-5",
    maxDurationMinutes: DEFAULT_MAX_DURATION_MIN,
    toolPreset: "",
    model: "",
    thinkingLevel: "",
  };
}

export function formFromTask(task: ScheduledTask, now = Date.now()): ScheduleFormState {
  const base = emptyScheduleForm(now);
  const rule = task.schedule;
  return {
    name: task.name,
    prompt: task.prompt,
    project: task.project ?? "",
    kind: rule.kind,
    at: rule.kind === "once" ? isoToDatetimeLocal(rule.at) : base.at,
    time: rule.kind === "daily" || rule.kind === "weekly" ? rule.time : base.time,
    timeZone: rule.kind === "once" ? base.timeZone : rule.timeZone || base.timeZone,
    days: rule.kind === "weekly" ? [...rule.days] : base.days,
    expr: rule.kind === "cron" ? rule.expr : base.expr,
    maxDurationMinutes: task.maxDurationMin ?? DEFAULT_MAX_DURATION_MIN,
    toolPreset: task.toolPreset ?? "",
    model: task.model ? `${task.model.provider}/${task.model.id}` : "",
    thinkingLevel: (task.thinkingLevel as ScheduleFormState["thinkingLevel"]) ?? "",
  };
}

export function validateScheduleForm(form: ScheduleFormState, now = Date.now()): ScheduleFormError | null {
  if (!form.name.trim()) return "name";
  if (!form.prompt.trim()) return "prompt";
  if (form.kind === "once") {
    const at = datetimeLocalToIso(form.at);
    if (!at) return "at";
    // The store requires a future instant too: do not show a saveable form it will reject.
    if (Date.parse(at) <= now) return "atPast";
    return null;
  }
  if (!Number.isInteger(form.maxDurationMinutes) || form.maxDurationMinutes < MAX_DURATION_LIMITS.min || form.maxDurationMinutes > MAX_DURATION_LIMITS.max) return "duration";
  if (!form.timeZone.trim()) return "timeZone";
  // The expression is checked for syntax here; whether it can ever fire (the 30th of
  // February) is the store's answer, because that needs the zone's calendar, and it comes
  // back as a save error rather than a field the renderer re-implements.
  if (form.kind === "cron") return parseCron(form.expr) ? null : "expr";
  if (!isHm(normalizeHm(form.time))) return "time";
  if (form.kind === "weekly" && form.days.length === 0) return "days";
  return null;
}

export function ruleFromForm(form: ScheduleFormState, now = Date.now()): ScheduleRule | undefined {
  if (validateScheduleForm(form, now)) return undefined;
  if (form.kind === "once") {
    const at = datetimeLocalToIso(form.at);
    return at ? { kind: "once", at } : undefined;
  }
  const timeZone = form.timeZone.trim();
  if (form.kind === "cron") return { kind: "cron", expr: form.expr.trim(), timeZone };
  const time = normalizeHm(form.time);
  if (form.kind === "daily") return { kind: "daily", time, timeZone };
  const days = [...new Set(form.days.filter((day) => day >= 0 && day <= 6))].sort((a, b) => a - b);
  return { kind: "weekly", time, timeZone, days };
}

/**
 * Create payload. An empty project is omitted — scratch chat — rather than sent as `""`.
 * Updates that must clear a project send `""` themselves, because JSON drops `undefined`.
 */
export function draftFromForm(form: ScheduleFormState, now = Date.now()): ScheduledTaskDraft | undefined {
  const schedule = ruleFromForm(form, now);
  if (!schedule) return undefined;
  const project = form.project.trim();
  return {
    name: form.name.trim(),
    prompt: form.prompt.trim(),
    ...(project ? { project } : {}),
    schedule,
    // Always sent, not only when it differs from the default: a stored task should say how
    // long it may run rather than inheriting whatever the app defaults to that week.
    maxDurationMin: form.maxDurationMinutes,
    // Absent means read-only, which is what the empty choice says.
    // Absent means read-only; the select's other choice is the full toolset.
    ...(form.toolPreset === "default" ? { toolPreset: "default" as const } : {}),
    ...preferencesFromForm(form),
  };
}

/**
 * The model and reasoning a task picks, split out because `ScheduledTaskDraft` carries them
 * as a structured model but the form holds one `provider/id` string.
 */
export function preferencesFromForm(form: ScheduleFormState): { model?: { provider: string; id: string }; thinkingLevel?: ThinkingLevel } {
  const separator = form.model.indexOf("/");
  const provider = separator > 0 ? form.model.slice(0, separator) : "";
  const id = separator > 0 ? form.model.slice(separator + 1) : "";
  return {
    ...(provider && id ? { model: { provider, id } } : {}),
    ...(form.thinkingLevel ? { thinkingLevel: form.thinkingLevel } : {}),
  };
}

export function sortTasks(tasks: ScheduledTask[]): ScheduledTask[] {
  return [...tasks].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    const nextA = a.nextRunAt ?? Number.POSITIVE_INFINITY;
    const nextB = b.nextRunAt ?? Number.POSITIVE_INFINITY;
    if (nextA !== nextB) return nextA - nextB;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
}
