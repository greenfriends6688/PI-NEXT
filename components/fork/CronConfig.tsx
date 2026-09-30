"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  ConfigBadge,
  ConfigButton,
  ConfigDetail,
  ConfigDetailActions,
  ConfigDetailHeader,
  ConfigDetailStack,
  ConfigDetailTitle,
  ConfigEmptyState,
  ConfigField,
  ConfigSectionTitle,
  ConfigSidebarItem,
  ConfigSidebarList,
  ConfigSplitView,
  ConfigSwitch,
  PwCtl,
  PwRadio,
  PwSelectBox,
  SettingsPage,
} from "../SettingsUi";
import { CRON_EXAMPLES } from "@/lib/cron-expression";
import { compileCronRule, parseClockTime, type CronRule } from "@/lib/cron-rule";
import type { CronRunRecord, CronSchedule, CronTaskView } from "@/lib/cron-schedule";

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
const THINKING_LABELS: Record<(typeof THINKING_LEVELS)[number], string> = {
  auto: "auto", off: "off", minimal: "minimal", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max",
};

/** Zones the runtime knows, big list first; falls back to a short fixed set. */
function timezoneOptions(): string[] {
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone");
    if (supported && supported.length > 0) return supported;
  } catch {
    // Older runtimes: the select still works with the host zone only.
  }
  return ["UTC", "Asia/Shanghai", "Asia/Tokyo", "Europe/London", "America/New_York", "America/Los_Angeles"];
}

/*
 * fork:cron — the scheduled-task page inside Settings.
 *
 * Scope: create / enable / run now / delete + the run history and a
 * human-readable frequency editor. fork:zc-14 adds the history region (start/end,
 * status, output excerpt, open-session and delete-a-row, 8 rows per page);
 * fork:zc-19 adds the frequency editor, which compiles the readable structure
 * down to the same 5-field cron the scheduler already runs — there is no second
 * schedule format at runtime.
 */

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const MONTH_KEYS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;
const ORDINALS = [1, 2, 3, 4, 5] as const;

/** fork:zc-19 — the editor modes. `once`/`cron` keep the previous escape hatches. */
type EditorMode = "minutes" | "hours" | "daily" | "weekly" | "monthly" | "yearly" | "once" | "cron";

/** fork:zc-14 — the reference browser shows 8 runs per page. */
const HISTORY_PAGE_SIZE = 8;

/**
 * fork:fix-cron-model-list — shape of `GET /api/models`.
 *
 * `models` is a `provider:id → display name` map used for lookups; the list a
 * picker must render is `modelList`. Reading the map here made `.map` throw,
 * the `.catch` swallowed the TypeError, and the picker silently kept a single
 * "default" option (see lib/models-cache.ts `ModelsData`).
 */
interface ModelsResponse {
  modelList?: { id: string; name?: string; provider: string }[];
  defaultModel?: { provider: string; modelId: string } | null;
  modelError?: string;
}

function toDateInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

const RUN_STATUS_ICON: Record<string, string> = {
  ok: "circle-check",
  error: "circle-x",
  skipped: "circle-slash",
  running: "loader-circle",
};

/** 画板 44 的运行历史行：状态用 `.pw-badge` 的四档（ok / bad / accent / 静）。 */
const RUN_STATUS_BADGE: Record<string, string> = {
  ok: "ok",
  error: "bad",
  skipped: "",
  running: "accent",
};

const RUN_STATUS_KEY: Record<string, string> = {
  ok: "cron.runStatus.ok",
  error: "cron.runStatus.error",
  skipped: "cron.runStatus.skipped",
  running: "cron.runStatus.running",
};

/** 画板 44 的任务列表行：上次状态对应 `.pw-badge` 的哪一档色。 */
const LAST_STATUS_BADGE: Record<string, string> = { error: "bad", ok: "ok", running: "accent" };

/**
 * fork:zc-14 — one task's run history: newest first, 8 rows per page, with the
 * output excerpt (or the skip reason / error) and a jump to the run's session.
 */
function TaskHistory({ task, onOpenSession, onDeleteRun }: {
  task: CronTaskView;
  onOpenSession?: (sessionId: string) => void;
  onDeleteRun: (runId: string) => void;
}): ReactNode {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const runs = task.history ?? [];
  const totalPages = Math.max(1, Math.ceil(runs.length / HISTORY_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paged = runs.slice((currentPage - 1) * HISTORY_PAGE_SIZE, currentPage * HISTORY_PAGE_SIZE);

  const detail = (run: CronRunRecord): string => {
    if (run.error) return run.error;
    if (run.skipReason) return t(`cron.skipReason.${run.skipReason}`);
    return run.outputExcerpt ?? "";
  };

  return (
    /* fork:design-system —— 画板 44 的「运行历史」：`.pw-detail` 卡 + `.pw-prow` 行
       （图标 + `.grow` 两行文本 + 状态徽章 + 动作钮）。原先是内联的折叠 details
       元素 + 一堆自绘盒子。 */
    <ConfigDetail>
      <ConfigDetailHeader>
        <ConfigDetailTitle>{t("cron.history")}</ConfigDetailTitle>
        <span className="pw-badge count">{runs.length}</span>
        <span className="pw-grow" aria-hidden="true" />
      </ConfigDetailHeader>
      {runs.length === 0 ? (
        <p className="pw-hint">{t("cron.historyEmpty")}</p>
      ) : (
        <>
          <ConfigDetailStack>
            {paged.map((run, index) => {
              const started = new Date(run.at);
              const finished = run.finishedAt ? new Date(run.finishedAt) : null;
              const duration = finished ? finished.getTime() - started.getTime() : undefined;
              const text = detail(run);
              const statusKey = RUN_STATUS_KEY[run.status] ?? "cron.runStatus.error";
              const tone = RUN_STATUS_BADGE[run.status];
              return (
                <div className="pw-prow" key={run.id ?? `${run.at}-${index}`}>
                  <span className="pw-ico">
                    <i data-ico={RUN_STATUS_ICON[run.status] ?? "circle-x"} data-size="14" aria-hidden="true" />
                  </span>
                  <span className="grow">
                    <span className="pw-mono">
                      {Number.isNaN(started.getTime()) ? run.at : started.toLocaleString()}
                      {finished && !Number.isNaN(finished.getTime()) ? ` → ${finished.toLocaleTimeString()}` : ""}
                    </span>
                    {/* 画板 20 的 `.grow` 两行形态：副行 `.pw-desc` 落一块 */}
                    <span className="pw-desc" style={{ display: "block" }}>
                      {[
                        finished ? formatDuration(duration) : null,
                        run.trigger ? t(`cron.trigger.${run.trigger}`) : null,
                        run.attempt !== undefined && run.attempt > 1
                          ? t("cron.history.attempt", { attempt: run.attempt })
                          : null,
                        text || null,
                      ].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <span className={tone ? `pw-badge ${tone}` : "pw-badge"}>{t(statusKey)}</span>
                  {run.sessionId && onOpenSession && (
                    <ConfigButton variant="ghost" size="small" onClick={() => onOpenSession(run.sessionId!)}>
                      {t("cron.openRun")}
                    </ConfigButton>
                  )}
                  {run.id && (
                    <ConfigButton
                      variant="ghost"
                      size="small"
                      title={t("cron.history.deleteRun")}
                      aria-label={t("cron.history.deleteRun")}
                      onClick={() => onDeleteRun(run.id!)}
                    >
                      <span className="pw-ico"><i data-ico="x" data-size="13" aria-hidden="true" /></span>
                    </ConfigButton>
                  )}
                </div>
              );
            })}
          </ConfigDetailStack>
          {totalPages > 1 && (
            <ConfigDetailActions>
              <span className="pw-grow" aria-hidden="true" />
              <ConfigButton
                variant="ghost"
                size="small"
                title={t("cron.history.prev")}
                aria-label={t("cron.history.prev")}
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <span className="pw-ico"><i data-ico="chevron-left" data-size="13" aria-hidden="true" /></span>
              </ConfigButton>
              <span className="pw-badge count">{t("cron.history.pageOf", { current: currentPage, total: totalPages })}</span>
              <ConfigButton
                variant="ghost"
                size="small"
                title={t("cron.history.next")}
                aria-label={t("cron.history.next")}
                disabled={currentPage >= totalPages}
                onClick={() => setPage(currentPage + 1)}
              >
                <span className="pw-ico"><i data-ico="chevron-right" data-size="13" aria-hidden="true" /></span>
              </ConfigButton>
            </ConfigDetailActions>
          )}
        </>
      )}
    </ConfigDetail>
  );
}

export function CronConfig({ cwd, onOpenSession }: { cwd?: string | null; onOpenSession?: (sessionId: string) => void }): ReactNode {
  const { t } = useI18n();
  const [tasks, setTasks] = useState<CronTaskView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [taskCwd, setTaskCwd] = useState(cwd ?? "");
  // fork:zc-19 — human-readable frequency editor state. It compiles to the
  // existing 5-field cron; the raw expression stays an escape hatch.
  const [mode, setMode] = useState<EditorMode>("daily");
  const [intervalValue, setIntervalValue] = useState("5");
  const [time, setTime] = useState("09:00");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [monthlyMode, setMonthlyMode] = useState<"date" | "weekday">("date");
  const [monthDay, setMonthDay] = useState("1");
  const [monthWeekday, setMonthWeekday] = useState(1);
  const [monthOrdinal, setMonthOrdinal] = useState(1);
  const [yearMonth, setYearMonth] = useState("1");
  const [yearDay, setYearDay] = useState("1");
  const [endDate, setEndDate] = useState("");
  const [date, setDate] = useState(() => toDateInputValue(new Date()));
  const [expression, setExpression] = useState("*/5 * * * *");
  const [idleStart, setIdleStart] = useState("");
  const [idleEnd, setIdleEnd] = useState("");
  const [timezone, setTimezone] = useState("host");
  const [thinking, setThinking] = useState("");
  const [modelKey, setModelKey] = useState("");
  // fork:fix-cron-lifecycle — 运行次数上限与子会话策略（不填即旧行为：不限次 + 每次新建）。
  const [maxRuns, setMaxRuns] = useState("");
  const [sessionMode, setSessionMode] = useState<"new" | "daily" | "reuse">("new");
  // fork:fix-cron-notify — 完成通知策略（默认只失败时通知）。
  const [notify, setNotify] = useState<"never" | "always" | "success" | "error">("error");
  const [taskEnabled, setTaskEnabled] = useState(true);
  const [models, setModels] = useState<{ key: string; label: string }[]>([]);
  const [defaultModelKey, setDefaultModelKey] = useState("");
  const [modelsError, setModelsError] = useState<string | null>(null);
  const zones = useMemo(() => timezoneOptions(), []);

  useEffect(() => {
    // Model list for the optional override; a failure is not fatal (the task then
    // runs with the app default, which is what an empty selection means anyway),
    // but it is surfaced — a picker that silently offers nothing is the bug this
    // replaced.
    // The route is scoped to a browsable cwd, so pass the panel's — without it the
    // request falls back to the server's own cwd and can be refused.
    const url = cwd ? `/api/models?cwd=${encodeURIComponent(cwd)}` : "/api/models";
    void fetch(url, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const detail = await res.json().catch(() => null) as { error?: string } | null;
          throw new Error(detail?.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<ModelsResponse>;
      })
      .then((data) => {
        setModels((data.modelList ?? []).map((model) => ({
          key: `${model.provider}/${model.id}`,
          label: `${model.name || model.id} · ${model.provider}`,
        })));
        setDefaultModelKey(data.defaultModel ? `${data.defaultModel.provider}/${data.defaultModel.modelId}` : "");
        setModelsError(data.modelError ?? null);
      })
      .catch((cause: unknown) => {
        setModels([]);
        setDefaultModelKey("");
        setModelsError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [cwd]);

  // "Default" is the app's own default model, so name it: an unlabelled "default"
  // leaves the user guessing which model a scheduled run will actually use.
  const defaultModelLabel = useMemo(() => {
    if (!defaultModelKey) return "";
    return models.find((model) => model.key === defaultModelKey)?.label ?? defaultModelKey;
  }, [defaultModelKey, models]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cron", { cache: "no-store" });
      const data = await res.json() as { tasks?: CronTaskView[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTasks(data.tasks ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (cwd) setTaskCwd((current) => current || cwd);
  }, [cwd]);

  /**
   * fork:zc-19 — build the readable rule from the editor state. Returns null when
   * a field is not usable yet (the preview then shows the compile error instead).
   */
  const buildRule = (): CronRule | null => {
    const interval = Number(intervalValue);
    const parsedTime = parseClockTime(time);
    const end = endDate ? { endDate } : {};
    switch (mode) {
      case "minutes":
        return { kind: "minutes", interval, ...end };
      case "hours":
        return parsedTime ? { kind: "hours", interval, minute: parsedTime.minute, ...end } : null;
      case "daily":
        return parsedTime ? { kind: "daily", time, ...end } : null;
      case "weekly":
        return parsedTime ? { kind: "weekly", time, weekdays, ...end } : null;
      case "monthly":
        if (!parsedTime) return null;
        return monthlyMode === "date"
          ? { kind: "monthly", mode: "date", time, day: Number(monthDay), ...end }
          : { kind: "monthly", mode: "weekday", time, weekday: monthWeekday, ordinal: monthOrdinal, ...end };
      case "yearly":
        return parsedTime ? { kind: "yearly", time, month: Number(yearMonth), day: Number(yearDay), ...end } : null;
      default:
        return null;
    }
  };

  const compiled = buildRule();
  const compiledResult = compiled ? compileCronRule(compiled) : null;

  const scheduleForCreate = (): CronSchedule | null => {
    const window = idleStart && idleEnd ? { idleWindow: { start: idleStart, end: idleEnd } } : {};
    const shared = { ...(timezone !== "host" ? { timezone } : {}), ...window };
    if (mode === "once") return { kind: "once", times: [time], date, ...shared };
    if (mode === "cron") return { kind: "cron", times: [], expression: expression.trim(), ...shared };
    const result = compiledResult;
    if (!result || !result.ok) {
      setError(result && !result.ok ? result.error : t("cron.ruleInvalid"));
      return null;
    }
    // fork:zc-19 — readable structure compiles down to the one runtime format.
    return {
      kind: "cron",
      times: [],
      expression: result.expression,
      ...(result.endDate ? { endDate: result.endDate } : {}),
      ...shared,
    };
  };

  const create = async () => {
    setError(null);
    const schedule = scheduleForCreate();
    if (!schedule) return;
    const body = {
      name: name.trim(),
      prompt: prompt.trim(),
      // Empty is allowed: the runner uses the default working directory.
      cwd: taskCwd.trim(),
      enabled: taskEnabled,
      ...(modelKey ? { model: { provider: modelKey.split("/")[0], modelId: modelKey.split("/").slice(1).join("/") } } : {}),
      ...(thinking ? { thinking } : {}),
      ...(Number.isFinite(Number(maxRuns)) && Number(maxRuns) > 0 ? { maxRuns: Math.floor(Number(maxRuns)) } : {}),
      ...(sessionMode !== "new" ? { sessionMode } : {}),
      ...(notify !== "error" ? { notify } : {}),
      schedule,
    };
    try {
      const res = await fetch("/api/cron", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setName("");
      setPrompt("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/cron", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...body }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) setError(data.error ?? `HTTP ${res.status}`);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await fetch(`/api/cron?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  // fork:zc-14 — drop one run row without touching the task itself.
  const removeRun = async (taskId: string, runId: string) => {
    setBusyId(taskId);
    try {
      await fetch(`/api/cron?id=${encodeURIComponent(taskId)}&runId=${encodeURIComponent(runId)}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const describe = (task: CronTaskView) => {
    const names = WEEKDAY_KEYS.map((key) => t(`cron.weekday.${key}`));
    const zone = task.schedule.timezone ? ` · ${task.schedule.timezone}` : "";
    const window = task.schedule.idleWindow ? ` · ${t("cron.window")} ${task.schedule.idleWindow.start}–${task.schedule.idleWindow.end}` : "";
    const end = task.schedule.endDate ? ` · ${t("cron.endDate")} ${task.schedule.endDate}` : "";
    if (task.schedule.kind === "cron") return `${task.schedule.expression ?? ""}${zone}${window}${end}`;
    if (task.schedule.kind === "daily") return `${t("cron.daily")} ${task.schedule.times.join(", ")}${zone}${window}${end}`;
    if (task.schedule.kind === "weekly") {
      const days = (task.schedule.weekdays ?? []).map((day) => names[day]).join("/");
      return `${days} ${task.schedule.times.join(", ")}${zone}${window}${end}`;
    }
    return `${task.schedule.date ?? ""} ${task.schedule.times.join(", ")}${zone}${window}${end}`;
  };

  /* fork:design-system —— 画板 44 的频率字段组：`input.pw-input` + 单位文字，
     与画板 `.pw-field > .pw-ctl` 同一形态。 */
  const intervalInput = (unit: string) => (
    <PwCtl>
      <input
        className="pw-input"
        inputMode="numeric"
        value={intervalValue}
        aria-label={t("cron.interval")}
        onChange={(event) => setIntervalValue(event.target.value.replace(/[^0-9]/g, ""))}
        style={{ minWidth: 0, width: 70, fontVariantNumeric: "tabular-nums" }}
      />
      <span className="pw-desc">{unit}</span>
    </PwCtl>
  );

  const modelOptions = useMemo(
    () => [
      {
        value: "",
        label: defaultModelLabel ? t("cron.modelDefault", { model: defaultModelLabel }) : t("cron.default"),
      },
      ...models.map((model) => ({ value: model.key, label: model.label })),
    ],
    [defaultModelLabel, models, t],
  );

  return (
    <>
      {/* fork:settings-frame（画板 62）—— 定时任务页的三件套。
          页头原来只有 h2、**没有 sub**（左列那个「任务列表」是小节标题，不是页头说明），
          用户进来看不到「这页是干嘛的」；计数也散在列里。现在说明与计数归位。 */}
      <SettingsPage
        title={t("cron.title")}
        sub={t("cron.pageSub")}
        toolbar={
          <>
            <span className="pw-grow" aria-hidden="true" />
            <ConfigBadge tone="count">{t("cron.count", { count: String(tasks.length) })}</ConfigBadge>
          </>
        }
        fill
      >
      {error && (
        <div className="pw-alert" role="alert">
          <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
          <span className="pw-grow">{error}</span>
        </div>
      )}

      {/* fork:design-system —— 画板 44：左列 = 任务列表 + 每个任务的运行历史
          （`.pw-litem` 行 + `.pw-detail` 卡），右列 = 新建任务表单。
          两栏用 SettingsUi 的 `ConfigSplitView`（`.pw-cols`）。 */}
      <ConfigSplitView>
        <div style={{ display: "grid", gap: "var(--s3)", alignContent: "start" }}>
          <ConfigSectionTitle>{t("cron.tasks")}</ConfigSectionTitle>
          {loading && <p className="pw-hint">{t("cron.loading")}</p>}
          {!loading && tasks.length === 0 && (
            <ConfigEmptyState>
              <p>{t("cron.empty")}</p>
            </ConfigEmptyState>
          )}
          <ConfigSidebarList>
            {tasks.map((task) => (
              <Fragment key={task.id}>
                {/* 画板 44 的任务行：`.pw-litem` + 前置 `.pw-switch` + `.grow`
                    （`.pw-lname` / `.pw-lsub`）+ 状态徽章。产品这一行要装开关 /
                    立即运行 / 删除三个真控件，所以是 div 而不是 ConfigSidebarItem
                    的 button（button 里不能再嵌 button）。 */}
                <div className="pw-litem">
                  <ConfigSwitch
                    label={`${t("cron.enabled")} · ${task.name}`}
                    checked={task.enabled}
                    onChange={(next) => void patch(task.id, { enabled: next })}
                  />
                  <span className="grow">
                    <span className="pw-lname">{task.name}</span>
                    <span className="pw-lsub">
                      {describe(task)}
                      {task.nextRunAt ? ` · ${t("cron.next")} ${new Date(task.nextRunAt).toLocaleString()}` : ` · ${t("cron.noNext")}`}
                      {task.missed ? ` · ${t("cron.missed")}` : ""}
                    </span>
                    <span className="pw-lsub" title={task.prompt}>{task.prompt}</span>
                    {(task.model || task.thinking) && (
                      <span className="pw-lsub">
                        {task.model ? `${task.model.provider}/${task.model.modelId}` : t("cron.default")}
                        {task.thinking ? ` · ${task.thinking}` : ""}
                      </span>
                    )}
                    {/* fork:zc-19 — surface a pending backoff retry instead of hiding it. */}
                    {task.retryAt && (
                      <span className="pw-badge warn">
                        {t("cron.retryScheduled", { at: new Date(task.retryAt).toLocaleTimeString() })}
                      </span>
                    )}
                  </span>
                  {task.lastStatus && (
                    <span className={LAST_STATUS_BADGE[task.lastStatus] ? `pw-badge ${LAST_STATUS_BADGE[task.lastStatus]}` : "pw-badge"}>
                      {t(`cron.status.${task.lastStatus}`)}
                    </span>
                  )}
                  <ConfigButton
                    variant="secondary"
                    size="small"
                    disabled={busyId === task.id}
                    onClick={() => void patch(task.id, { action: "run" })}
                  >
                    {t("cron.runNow")}
                  </ConfigButton>
                  <ConfigButton
                    variant="ghost"
                    size="small"
                    title={t("cron.delete")}
                    aria-label={t("cron.delete")}
                    disabled={busyId === task.id}
                    onClick={() => void remove(task.id)}
                  >
                    <span className="pw-ico"><i data-ico="trash-2" data-size="13" aria-hidden="true" /></span>
                  </ConfigButton>
                </div>
                {task.lastError && task.lastStatus === "error" && (
                  <p className="pw-hint">{task.lastError}</p>
                )}
                <TaskHistory
                  task={task}
                  {...(onOpenSession ? { onOpenSession } : {})}
                  onDeleteRun={(runId) => void removeRun(task.id, runId)}
                />
              </Fragment>
            ))}
          </ConfigSidebarList>
        </div>

        {/* 右列：画板 44 的「新建任务」`.pw-detail` —— 标签在左、控件在右的
            `.pw-field` 行，频率用 `.pw-radio`，下拉用 `.pw-selectbox`。 */}
        <ConfigDetail>
          <ConfigDetailHeader>
            <ConfigDetailTitle>{t("cron.newTask")}</ConfigDetailTitle>
          </ConfigDetailHeader>

          <ConfigField label={t("cron.name")}>
            <PwCtl>
              <input
                className="pw-input"
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("cron.namePlaceholder")}
                style={{ minWidth: 0, flex: 1 }}
              />
            </PwCtl>
          </ConfigField>

          <ConfigSectionTitle>{t("cron.prompt")}</ConfigSectionTitle>
          <textarea
            className="pw-textarea"
            value={prompt}
            rows={3}
            aria-label={t("cron.prompt")}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t("cron.promptPlaceholder")}
          />

          <ConfigField label={t("cron.cwd")}>
            <PwCtl>
              <input
                className="pw-input pw-mono"
                value={taskCwd}
                aria-label={t("cron.cwd")}
                onChange={(event) => setTaskCwd(event.target.value)}
                placeholder={t("cron.cwdPlaceholder")}
                style={{ minWidth: 0, flex: 1 }}
              />
            </PwCtl>
          </ConfigField>

          <ConfigField label={t("cron.model")}>
            <PwSelectBox
              value={modelKey}
              options={modelOptions}
              ariaLabel={t("cron.model")}
              onChange={setModelKey}
            />
          </ConfigField>

          <ConfigField label={t("cron.thinking")}>
            <PwSelectBox
              value={thinking}
              ariaLabel={t("cron.thinking")}
              options={[
                { value: "", label: t("cron.default") },
                ...THINKING_LEVELS.map((level) => ({ value: level, label: THINKING_LABELS[level] })),
              ]}
              onChange={setThinking}
            />
          </ConfigField>

          <ConfigField label={t("cron.maxRuns")}>
            <PwCtl>
              <input
                className="pw-input"
                inputMode="numeric"
                value={maxRuns}
                aria-label={t("cron.maxRuns")}
                onChange={(event) => setMaxRuns(event.target.value.replace(/[^0-9]/g, ""))}
                placeholder={t("cron.maxRunsPlaceholder")}
                title={t("cron.maxRunsHint")}
                style={{ minWidth: 0, flex: 1, fontVariantNumeric: "tabular-nums" }}
              />
            </PwCtl>
          </ConfigField>

          <ConfigField label={t("cron.sessionMode")}>
            <PwRadio
              value={sessionMode}
              ariaLabel={t("cron.sessionMode")}
              options={[
                { value: "new", label: t("cron.sessionModeNew") },
                { value: "daily", label: t("cron.sessionModeDaily") },
                { value: "reuse", label: t("cron.sessionModeReuse") },
              ]}
              onChange={setSessionMode}
            />
          </ConfigField>

          <ConfigField label={t("cron.notify")}>
            <PwSelectBox
              value={notify}
              ariaLabel={t("cron.notify")}
              options={[
                { value: "error", label: t("cron.notifyError") },
                { value: "success", label: t("cron.notifySuccess") },
                { value: "always", label: t("cron.notifyAlways") },
                { value: "never", label: t("cron.notifyNever") },
              ]}
              onChange={(next) => setNotify(next as "never" | "always" | "success" | "error")}
            />
          </ConfigField>

          {modelsError && (
            <div className="pw-alert" role="status">
              <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
              <span className="grow">{t("cron.modelListError", { error: modelsError })}</span>
            </div>
          )}

          {/* fork:zc-19 — human-readable frequency editor (compiles to 5-field cron). */}
          <ConfigSectionTitle>{t("cron.frequency")}</ConfigSectionTitle>
          <PwRadio
            value={mode}
            ariaLabel={t("cron.frequency")}
            options={[
              { value: "minutes", label: t("cron.freq.minutes") },
              { value: "hours", label: t("cron.freq.hours") },
              { value: "daily", label: t("cron.daily") },
              { value: "weekly", label: t("cron.weekly") },
              { value: "monthly", label: t("cron.freq.monthly") },
              { value: "yearly", label: t("cron.freq.yearly") },
              { value: "once", label: t("cron.once") },
              { value: "cron", label: t("cron.kindCron") },
            ]}
            onChange={(next) => setMode(next as EditorMode)}
          />

          {mode === "minutes" && (
            <ConfigField label={t("cron.interval")}>{intervalInput(t("cron.unit.minutes"))}</ConfigField>
          )}
          {mode === "hours" && (
            <>
              <ConfigField label={t("cron.interval")}>{intervalInput(t("cron.unit.hours"))}</ConfigField>
              <ConfigField label={t("cron.atTime")}>
                <PwCtl>
                  <input
                    className="pw-input"
                    type="time"
                    value={time}
                    aria-label={t("cron.atTime")}
                    onChange={(event) => setTime(event.target.value)}
                    style={{ minWidth: 0, width: 130 }}
                  />
                </PwCtl>
              </ConfigField>
            </>
          )}
          {(mode === "daily" || mode === "weekly" || mode === "monthly" || mode === "yearly" || mode === "once") && (
            <ConfigField label={t("cron.atTime")}>
              <PwCtl>
                <input
                  className="pw-input"
                  type="time"
                  value={time}
                  aria-label={t("cron.atTime")}
                  onChange={(event) => setTime(event.target.value)}
                  style={{ minWidth: 0, width: 130 }}
                />
              </PwCtl>
            </ConfigField>
          )}
          {mode === "once" && (
            <ConfigField label={t("cron.date")}>
              <PwCtl>
                <input
                  className="pw-input"
                  type="date"
                  value={date}
                  aria-label={t("cron.date")}
                  onChange={(event) => setDate(event.target.value)}
                  style={{ minWidth: 0, width: 160 }}
                />
              </PwCtl>
            </ConfigField>
          )}
          {mode === "monthly" && (
            <>
              <ConfigField label={t("cron.monthlyMode")}>
                <PwSelectBox
                  value={monthlyMode}
                  ariaLabel={t("cron.monthlyMode")}
                  options={[
                    { value: "date", label: t("cron.monthlyByDate") },
                    { value: "weekday", label: t("cron.monthlyByWeekday") },
                  ]}
                  onChange={(next) => setMonthlyMode(next as "date" | "weekday")}
                />
              </ConfigField>
              {monthlyMode === "date" ? (
                <ConfigField label={t("cron.dayOfMonth")}>
                  <PwCtl>
                    <input
                      className="pw-input"
                      inputMode="numeric"
                      value={monthDay}
                      aria-label={t("cron.dayOfMonth")}
                      onChange={(event) => setMonthDay(event.target.value.replace(/[^0-9]/g, ""))}
                      style={{ minWidth: 0, width: 80, fontVariantNumeric: "tabular-nums" }}
                    />
                  </PwCtl>
                </ConfigField>
              ) : (
                <>
                  <ConfigField label={t("cron.weekday")}>
                    <PwSelectBox
                      value={String(monthWeekday)}
                      ariaLabel={t("cron.weekday")}
                      options={WEEKDAY_KEYS.map((key, index) => ({ value: String(index), label: t(`cron.weekday.${key}`) }))}
                      onChange={(next) => setMonthWeekday(Number(next))}
                    />
                  </ConfigField>
                  <ConfigField label={t("cron.ordinal")}>
                    <PwSelectBox
                      value={String(monthOrdinal)}
                      ariaLabel={t("cron.ordinal")}
                      options={ORDINALS.map((ordinal) => ({ value: String(ordinal), label: t(`cron.ordinal.${ordinal}`) }))}
                      onChange={(next) => setMonthOrdinal(Number(next))}
                    />
                  </ConfigField>
                </>
              )}
            </>
          )}
          {mode === "yearly" && (
            <>
              <ConfigField label={t("cron.month")}>
                <PwSelectBox
                  value={String(yearMonth)}
                  ariaLabel={t("cron.month")}
                  options={MONTH_KEYS.map((key, index) => ({ value: String(index + 1), label: t(`cron.month.${key}`) }))}
                  onChange={(next) => setYearMonth(next)}
                />
              </ConfigField>
              <ConfigField label={t("cron.dayOfMonth")}>
                <PwCtl>
                  <input
                    className="pw-input"
                    inputMode="numeric"
                    value={yearDay}
                    aria-label={t("cron.dayOfMonth")}
                    onChange={(event) => setYearDay(event.target.value.replace(/[^0-9]/g, ""))}
                    style={{ minWidth: 0, width: 80, fontVariantNumeric: "tabular-nums" }}
                  />
                </PwCtl>
              </ConfigField>
            </>
          )}
          {mode !== "once" && (
            <ConfigField label={t("cron.endDate")}>
              <PwCtl>
                <input
                  className="pw-input"
                  type="date"
                  value={endDate}
                  aria-label={t("cron.endDate")}
                  onChange={(event) => setEndDate(event.target.value)}
                  style={{ minWidth: 0, width: 160 }}
                />
              </PwCtl>
            </ConfigField>
          )}

          {mode !== "once" && <p className="pw-hint">{t("cron.endDateHint")}</p>}

          {mode === "weekly" && (
            <ConfigField label={t("cron.weekday")}>
              {/* 画板 44 的 `.pw-radio` 芯片组（`.is-on` = 选中）；这里多选，
                  所以用 aria-pressed 而不是 radiogroup。 */}
              <span className="pw-radio">
                {WEEKDAY_KEYS.map((key, index) => {
                  const active = weekdays.includes(index);
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={active}
                      className={active ? "is-on" : undefined}
                      onClick={() => setWeekdays((current) => (active ? current.filter((day) => day !== index) : [...current, index].sort()))}
                    >
                      {t(`cron.weekday.${key}`)}
                    </button>
                  );
                })}
              </span>
            </ConfigField>
          )}

          {mode === "cron" && (
            <>
              <ConfigField label={t("cron.expression")}>
                <PwCtl>
                  <input
                    className="pw-input pw-mono"
                    value={expression}
                    aria-label={t("cron.expression")}
                    aria-describedby="cron-expression-help"
                    onChange={(event) => setExpression(event.target.value)}
                    placeholder="*/5 * * * *"
                    style={{ minWidth: 0, flex: 1, fontVariantNumeric: "tabular-nums" }}
                  />
                </PwCtl>
              </ConfigField>
              <p id="cron-expression-help" className="pw-hint">{t("cron.expressionHelp")}</p>
              <ConfigSectionTitle>{t("cron.examples")}</ConfigSectionTitle>
              <ConfigSidebarList>
                {CRON_EXAMPLES.map((example) => (
                  <ConfigSidebarItem
                    key={example.expression}
                    active={expression === example.expression}
                    onClick={() => setExpression(example.expression)}
                  >
                    <span className="grow">
                      <span className="pw-lname pw-mono">{example.expression}</span>
                      <span className="pw-lsub">{t(example.labelKey)}</span>
                    </span>
                  </ConfigSidebarItem>
                ))}
              </ConfigSidebarList>
            </>
          )}

          {mode !== "cron" && mode !== "once" && (
            compiledResult?.ok ? (
              <ConfigField label={t("cron.compiled")}>
                <PwCtl>
                  <span className="pw-mono">{compiledResult.expression}</span>
                </PwCtl>
              </ConfigField>
            ) : (
              <div className="pw-alert" role="status">
                <span className="pw-ico"><i data-ico="triangle-alert" data-size="14" aria-hidden="true" /></span>
                <span className="grow">
                  {t("cron.ruleInvalid", { error: compiledResult && !compiledResult.ok ? compiledResult.error : "" })}
                </span>
              </div>
            )
          )}
          {mode !== "cron" && mode !== "once" && compiledResult?.ok && (
            <p className="pw-hint">{t("cron.compiledHint")}</p>
          )}

          <ConfigField label={t("cron.windowStart")}>
            <PwCtl>
              <input
                className="pw-input"
                type="time"
                value={idleStart}
                aria-label={t("cron.windowStart")}
                onChange={(event) => setIdleStart(event.target.value)}
                style={{ minWidth: 0, width: 140 }}
              />
              {(idleStart || idleEnd) && (
                <ConfigButton
                  variant="ghost"
                  size="small"
                  onClick={() => { setIdleStart(""); setIdleEnd(""); }}
                >
                  {t("cron.windowClear")}
                </ConfigButton>
              )}
            </PwCtl>
          </ConfigField>
          <ConfigField label={t("cron.windowEnd")}>
            <PwCtl>
              <input
                className="pw-input"
                type="time"
                value={idleEnd}
                aria-label={t("cron.windowEnd")}
                onChange={(event) => setIdleEnd(event.target.value)}
                style={{ minWidth: 0, width: 140 }}
              />
            </PwCtl>
          </ConfigField>
          <ConfigField label={t("cron.timezone")}>
            <PwSelectBox
              value={timezone}
              ariaLabel={t("cron.timezone")}
              options={[
                { value: "host", label: t("cron.timezoneHost") },
                ...zones.map((zone) => ({ value: zone, label: zone })),
              ]}
              onChange={setTimezone}
            />
          </ConfigField>
          <p className="pw-hint">{t("cron.windowHint")}</p>

          <ConfigField label={t("cron.enabled")}>
            <ConfigSwitch label={t("cron.enabled")} checked={taskEnabled} onChange={setTaskEnabled} />
          </ConfigField>

          <ConfigDetailActions>
            <span className="pw-grow" aria-hidden="true" />
            <ConfigButton
              variant="primary"
              disabled={!prompt.trim() || !taskCwd.trim() || (mode !== "once" && mode !== "cron" && !compiledResult?.ok)}
              onClick={() => void create()}
            >
              {t("cron.create")}
            </ConfigButton>
          </ConfigDetailActions>
          <p className="pw-hint">{t("cron.hint")}</p>
        </ConfigDetail>
      </ConfigSplitView>
      </SettingsPage>
    </>
  );
}
