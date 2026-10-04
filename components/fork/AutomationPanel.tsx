"use client";

/*
 * fork:proma-43-automation —— 定时任务面板（列表 + 详情 + 运行历史）。
 *
 * 这是**设置页里的一块内嵌面板**（`embedded` 形态），不是独立弹层：
 * 接线方把它塞进 SettingsPanel 的某一节即可，本 PR 不去动 SettingsPanel.tsx。
 *
 * 数据流：GET /api/automation 一次拉全量；每次改动后重新拉（任务量是几十条量级，
 * 轮询式刷新比维护一套乐观更新更不容易错）。运行中的任务额外每 5s 刷一次，
 * 让「立即运行」的进度能看见 —— 一次自动运行可能几十分钟。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ConfigButton,
  ConfigDetail,
  ConfigEmptyState,
  ConfigFooter,
  ConfigListAction,
  ConfigPanelShell,
  ConfigSectionTitle,
  ConfigSidebar,
  ConfigSidebarList,
  ConfigSplitView,
  ConfigStatusDot,
} from "../SettingsUi";
import { PortalDropdown, useDismissMenu } from "../PortalDropdown";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { formatRelativeTime } from "@/lib/i18n/format";
import { PwaBanner, PwaPage, PwaSetRow, PwaSwitchRow } from "@/components/pwa/PwaPage";
import { PwaSheet } from "@/components/pwa/PwaSheet";
import { AutomationEditor } from "./AutomationEditor";
import { describeSchedule, listUpcomingRuns } from "@/lib/automation-schedule";
import {
  AUTOMATION_DAILY_CONTEXT_ROLLOVER_THRESHOLD,
  type Automation,
  type AutomationDraft,
  type AutomationRun,
} from "@/lib/automation-types";

/** 运行中任务额外轮询的间隔（ms）。任务空闲时不轮询。 */
const RUNNING_POLL_MS = 5_000;

interface SchedulerStatus {
  started: boolean;
  activeRunIds: string[];
}

interface ListResponse {
  automations?: Automation[];
  scheduler?: SchedulerStatus;
}

export interface AutomationPanelProps {
  /** 新建任务时的默认工作目录（面板所在会话的 cwd）。 */
  cwd: string;
  /** 面板只读（存储读不出来时用）。 */
  readOnly?: boolean;
}

/** 一条空白草稿。`locale` 跟随当前界面语言，注入给 agent 的说明也就跟着变。 */
function emptyDraft(cwd: string, locale: string, model?: string): AutomationDraft {
  return {
    name: "",
    prompt: "",
    scheduleType: "daily",
    intervalMinutes: 60,
    timeOfDay: "09:00",
    // once 模式服务端必填 scheduledAt，新建时就先给一个「一小时后」的初值，
    // 否则一选 once 就会因为缺这个字段而存不下去。
    scheduledAt: Date.now() + 60 * 60_000,
    cwd,
    model,
    sessionMode: "daily",
    locale: (locale === "zh-CN" || locale === "zh-TW" ? locale : "en"),
    active: true,
  };
}

/** 记录 → 草稿（编辑时）。字段对不齐的地方一律给缺省，交给服务端校验去拦。 */
function toDraft(automation: Automation): AutomationDraft {
  return {
    name: automation.name,
    prompt: automation.prompt,
    scheduleType: automation.scheduleType,
    intervalMinutes: automation.intervalMinutes,
    activeWindowStart: automation.activeWindowStart,
    activeWindowEnd: automation.activeWindowEnd,
    activeWeekdays: automation.activeWeekdays,
    timeOfDay: automation.timeOfDay,
    dayOfWeek: automation.dayOfWeek,
    scheduledAt: automation.scheduledAt,
    maxRuns: automation.maxRuns,
    cwd: automation.cwd,
    model: automation.model,
    sessionMode: automation.sessionMode ?? "daily",
    locale: automation.locale ?? "en",
    active: automation.active,
  };
}

export function AutomationPanel({ cwd, readOnly = false }: AutomationPanelProps): ReactNode {
  const { t, locale } = useI18n();
  const mobile = useIsMobile();
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [scheduler, setScheduler] = useState<SchedulerStatus>({ started: false, activeRunIds: [] });
  const [modelOptions, setModelOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // 「接下来三次」跟着当前时间走；只在数据真的变了才重拨，不自己开轮询。
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState<AutomationDraft>(() => emptyDraft(cwd, locale));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * fork:v5-landing Wave N1 · D-17 帧 C/D ——
   * 两处**纯展示**的局部状态：运行历史的结局筛选（画板帧 C 的四枚 `.d-cat`）
   * 与单次详情展开的那一次运行（帧 D 的「看详情」）。两者都只改「看哪几条」，
   * 不改数据、不改口径、不发请求。
   */
  const [historyFilter, setHistoryFilter] = useState<"all" | "success" | "error" | "skipped">("all");
  const [openRunAt, setOpenRunAt] = useState<number | null>(null);
  const [rowMenuOpen, setRowMenuOpen] = useState(false);
  const rowMenuRef = useRef<HTMLButtonElement | null>(null);
  const rowMenuPanelRef = useRef<HTMLDivElement | null>(null);
  useDismissMenu(rowMenuOpen, rowMenuRef, rowMenuPanelRef, () => setRowMenuOpen(false));

  const refresh = useCallback(async () => {
    const response = await fetch("/api/automation", { cache: "no-store" });
    const data = await response.json().catch(() => ({})) as ListResponse & { error?: string };
    if (!response.ok) {
      setError(data.error ?? `HTTP ${response.status}`);
      return;
    }
    setError(null);
    setAutomations(data.automations ?? []);
    setScheduler(data.scheduler ?? { started: false, activeRunIds: [] });
    setNow(Date.now());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/models?cwd=${encodeURIComponent(cwd)}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({})) as {
          modelList?: Array<{ id: string; name: string; provider: string }>;
        };
        if (cancelled) return;
        setModelOptions((data.modelList ?? []).map((model) => ({
          value: `${model.provider}/${model.id}`,
          label: model.name || `${model.provider}/${model.id}`,
        })));
      } catch {
        if (!cancelled) setModelOptions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [cwd]);

  // 只有「确实有人在跑」时才轮询：空闲时没必要每 5s 打一次盘。
  useEffect(() => {
    if (scheduler.activeRunIds.length === 0) return;
    const handle = setInterval(() => { void refresh(); }, RUNNING_POLL_MS);
    return () => clearInterval(handle);
  }, [scheduler.activeRunIds.length, refresh]);

  const selected = useMemo(
    () => automations.find((automation) => automation.id === selectedId) ?? null,
    [automations, selectedId],
  );

  const post = useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? `HTTP ${response.status}`);
        return false;
      }
      await refresh();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const startCreate = useCallback(() => {
    setCreating(true);
    setSelectedId(null);
    setDraft(emptyDraft(cwd, locale, modelOptions[0]?.value));
  }, [cwd, locale, modelOptions]);

  const startEdit = useCallback((automation: Automation) => {
    setCreating(false);
    setSelectedId(automation.id);
    setDraft(toDraft(automation));
  }, []);

  const save = useCallback(async () => {
    const ok = creating
      ? await post({ action: "create", automation: draft })
      : selectedId
        ? await post({ action: "update", id: selectedId, automation: draft })
        : false;
    if (ok && creating) setCreating(false);
  }, [creating, draft, post, selectedId]);

  const upcoming = useMemo(
    () => (selected ? listUpcomingRuns(selected, now, 3) : []),
    [selected, now],
  );

  const formatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    [locale],
  );

  /*
   * fork:v5-landing Wave N1 · D-17 帧 A/C —— **三种结局各有自己的徽章档**：
   * 成功 ok / 失败 bad / 跳过 mute（手机上对应 `.m-dot` ok/bad/warn）。
   * 「跳过」不是失败：上一轮还没结束、或你正占着那个子会话，调度器就不排队 ——
   * 把它混进失败那一档，用户会以为任务坏了，进而把好的那条删掉。
   */
  const runDot = (status: string): string =>
    status === "success" ? "ok" : status === "error" ? "bad" : "warn";
  const runBadge = (status: string): string =>
    status === "success" ? "ok" : status === "error" ? "bad" : "mute";
  /** 跳过原因（帧 C 的那一列文字）；不是跳过时返回 null。 */
  const skipReasonText = (run: AutomationRun): string | null =>
    run.status === "skipped" && run.skipReason
      ? t(`automation.skipReason.${run.skipReason === "source-busy" ? "source-busy" : "previous-run-active"}`)
      : null;
  /** 单次耗时（帧 C 的「6s」列）。没记到就写「—」，不拿别的东西顶。 */
  const durationText = (run: AutomationRun): string => {
    const ms = run.durationMs;
    if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
    return ms >= 60_000
      ? `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1_000)).padStart(2, "0")}s`
      : `${(ms / 1_000).toFixed(1)}s`;
  };

  // fork:v5-landing Wave B · M-09 帧 B · 定时任务 ——
  // 手机上这是一个**独立一级页**，不是 hub 卡片：每张卡只回答两件事
  // （`.m-croncard-head` 末位的调度徽章 + 开关，`.m-cronhist` 的上次成没成 / 下次什么时候），
  // 新建与详情一律走 `.m-sheet` 底部面板，不新开页面。
  // 数据、调度口径、开关语义（直接生效、关闭后历史留着）与桌面**完全同一份**。
  if (mobile) {
    const badgeTone = (type: Automation["scheduleType"]): string =>
      type === "daily" ? "ok" : type === "interval" ? "warn" : "mute";
    const totalRuns = automations.reduce((sum, item) => sum + item.runHistory.length, 0);
    const failedRuns = automations.reduce(
      (sum, item) => sum + item.runHistory.filter((run) => run.status === "error").length,
      0,
    );
    const nextAnywhere = automations
      .flatMap((item) => listUpcomingRuns(item, now, 1))
      .sort((a, b) => a - b)[0];
    const sheetOpen = creating || Boolean(selected);

    return (
      <PwaPage
        title={t("automation.title")}
        actions={
          <button
            type="button"
            className="m-top-btn"
            title={t("automation.new")}
            onClick={startCreate}
          >
            <i data-ico="plus" data-size="16" aria-hidden="true" />
          </button>
        }
      >
        {!scheduler.started && (
          <PwaBanner icon="triangle-alert" tone="warn">{t("automation.schedulerStopped")}</PwaBanner>
        )}
        {error && (
          <PwaBanner icon="triangle-alert" tone="err" role="alert">{error}</PwaBanner>
        )}

        <div className="m-cardgroup">
          <PwaSetRow
            icon="list-checks"
            label={`${t("automation.history")} ${totalRuns}`}
            sub={`${t("automation.runStatus.success")} ${totalRuns - failedRuns} · ${t("automation.runStatus.error")} ${failedRuns}`}
          />
          <PwaSetRow
            icon="calendar-clock"
            label={`${t("automation.nextRuns")}: ${nextAnywhere ? formatter.format(new Date(nextAnywhere)) : t("automation.never")}`}
            sub={`${t("automation.title")} ${automations.length} · ${t("automation.runStatus.skipped")} ${automations.filter((item) => !item.active).length}`}
          />
        </div>

        {automations.length === 0 && (
          <div className="m-empty">
            <span className="m-empty-ico"><i data-ico="timer" data-size="20" aria-hidden="true" /></span>
            <span className="m-empty-t">{t("automation.empty")}</span>
            <span className="m-empty-s">{t("automation.emptyHint")}</span>
          </div>
        )}

        {automations.map((automation) => {
          const isRunning = scheduler.activeRunIds.includes(automation.id);
          const recent = [...automation.runHistory].reverse().slice(0, 2);
          const next = listUpcomingRuns(automation, now, 1)[0];
          return (
            <div className="m-croncard" key={automation.id}>
              {/* `.m-croncard-head` = 图标 + 名字/目录 + 调度徽章 + 开关。
                  中间那段在画板里是 `<span>`，这里换成 `<button>`（类名不变），
                  因为手机上「点卡进详情」是唯一入口 —— 不新开页面，只开面板。 */}
              <div className="m-croncard-head">
                <i data-ico={isRunning ? "loader-circle" : "timer"} data-size="16" aria-hidden="true" />
                <button
                  type="button"
                  className="m-setrow-body m-grow"
                  style={{ textAlign: "left", border: 0, background: "none", padding: 0, font: "inherit", color: "inherit" }}
                  onClick={() => startEdit(automation)}
                >
                  <span className="m-setrow-t">{automation.name}</span>
                  <span className="m-setrow-s">
                    {[automation.cwd, describeSchedule(automation, t, locale)].filter(Boolean).join(" · ")}
                  </span>
                </button>
                <span className={`m-badge ${isRunning ? "ok" : badgeTone(automation.scheduleType)}`}>
                  {isRunning ? t("automation.running") : t(`automation.scheduleType.${automation.scheduleType}`)}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={automation.active}
                  aria-label={automation.active ? t("automation.pausedManual") : t("automation.reopen")}
                  className={`m-switch${automation.active ? " on" : ""}`}
                  disabled={readOnly || busy}
                  onClick={() => void post({
                    action: "update",
                    id: automation.id,
                    automation: { ...toDraft(automation), active: !automation.active },
                  })}
                />
              </div>
              <div className="m-cronhist">
                {recent.map((run, index) => (
                  <div className="m-hist-row" key={`${automation.id}-${run.runAt}-${index}`}>
                    <span className={`m-dot ${runDot(run.status)}`} />
                    <span>{formatter.format(new Date(run.runAt))}</span>
                    <span className="m-grow" />
                    <span className={run.status === "error" ? "m-err" : undefined}>
                      {run.status === "error" && run.error
                        ? run.error
                        : t(`automation.runStatus.${run.status}`)}
                    </span>
                  </div>
                ))}
                <div className="m-hist-row">
                  <span className="m-grow" />
                  <span>
                    {automation.active
                      ? `${t("automation.nextRun")}: ${next ? formatter.format(new Date(next)) : t("automation.never")}`
                      : t("automation.pausedManual")}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        <PwaSheet
          open={sheetOpen}
          title={creating ? t("automation.new") : selected?.name ?? t("automation.title")}
          label={creating ? t("automation.new") : selected?.name}
          onClose={() => { setCreating(false); setSelectedId(null); }}
          footer={
            <>
              <button
                type="button"
                className="m-picktag"
                onClick={() => { setCreating(false); setSelectedId(null); }}
                disabled={busy}
              >
                {t("i18n.cancel")}
              </button>
              {!creating && selectedId && (
                <>
                  <button
                    type="button"
                    className="m-picktag danger"
                    disabled={readOnly || busy}
                    onClick={() => {
                      if (window.confirm(t("automation.deleteConfirm"))) {
                        void post({ action: "delete", id: selectedId }).then(() => {
                          setSelectedId(null);
                          setCreating(false);
                        });
                      }
                    }}
                  >
                    {t("automation.delete")}
                  </button>
                  <button
                    type="button"
                    className="m-picktag"
                    disabled={readOnly || busy || scheduler.activeRunIds.includes(selectedId)}
                    onClick={() => void post({ action: "run-now", id: selectedId })}
                  >
                    {t("automation.runNow")}
                  </button>
                </>
              )}
              <button
                type="button"
                className="m-picktag is-on"
                disabled={readOnly || busy}
                onClick={() => void save()}
              >
                {t("automation.save")}
              </button>
            </>
          }
        >
          {selected && !creating && (
            <div className="m-cardgroup">
              <PwaSwitchRow
                icon="power"
                label={t("automation.schedule")}
                sub={describeSchedule(selected, t, locale)}
                checked={draft.active}
                switchLabel={draft.active ? t("automation.pausedManual") : t("automation.reopen")}
                disabled={readOnly || busy}
                onChange={(next) => setDraft({ ...draft, active: next })}
              />
              <PwaSetRow
                icon="calendar-clock"
                label={t("automation.nextRuns")}
                sub={upcoming.length > 0
                  ? upcoming.map((timestamp) => formatter.format(new Date(timestamp))).join(" · ")
                  : t("automation.never")}
              />
              <PwaSetRow
                icon="history"
                label={t("automation.lastRun")}
                sub={selected.lastRunAt ? formatter.format(new Date(selected.lastRunAt)) : t("automation.never")}
              />
              {selected.pausedReason === "consecutive-failures" && (
                <PwaSetRow
                  icon="triangle-alert"
                  label={t("automation.pausedBackoff")}
                  sub={selected.consecutiveFailures
                    ? t("automation.consecutiveFailures", { count: selected.consecutiveFailures })
                    : undefined}
                />
              )}
              {selected.pausedReason === "completed" && (
                <PwaSetRow icon="circle-check" label={t("automation.completed")} />
              )}
              <div className="m-setrow">
                <i data-ico="history" data-size="16" aria-hidden="true" />
                <span className="m-setrow-body">
                  <span className="m-setrow-t">{t("automation.history")}</span>
                </span>
              </div>
              <div className="m-cronhist">
                {selected.runHistory.length === 0 ? (
                  <div className="m-hist-row"><span className="m-grow" /><span>{t("automation.noRuns")}</span></div>
                ) : (
                  [...selected.runHistory].reverse().map((run, index) => (
                    <div className="m-hist-row" key={`${run.runAt}-${index}`}>
                      <span className={`m-dot ${runDot(run.status)}`} />
                      <span className="m-mono">{formatter.format(new Date(run.runAt))}</span>
                      <span className="m-grow" />
                      <span className={run.status === "error" ? "m-err" : undefined}>
                        {run.status === "skipped" && run.skipReason
                          ? t(`automation.skipReason.${run.skipReason === "source-busy" ? "source-busy" : "previous-run-active"}`)
                          : run.status === "error" && run.error
                            ? run.error
                            : t(`automation.runStatus.${run.status}`)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          <AutomationEditor
            variant="mobile"
            draft={draft}
            onChange={setDraft}
            disabled={readOnly || busy}
            modelOptions={modelOptions}
          />
        </PwaSheet>
      </PwaPage>
    );
  }

  return (
    <ConfigPanelShell
      embedded
      title={t("automation.title")}
      subtitle={t("automation.subtitle")}
      onClose={() => {}}
    >
      <ConfigSplitView>
        <ConfigSidebar>
          <ConfigSidebarList>
            {automations.map((automation) => {
              const isRunning = scheduler.activeRunIds.includes(automation.id);
              return (
                <button
                  key={automation.id}
                  type="button"
                  aria-current={automation.id === selectedId ? "true" : undefined}
                  className={`d-sess${automation.id === selectedId ? " is-on" : ""}`}
                  onClick={() => startEdit(automation)}
                >
                  <i data-ico={isRunning ? "loader-circle" : "timer"} data-size="14" aria-hidden="true" />
                  <span className="d-grow">
                    <span className="d-sess-t">{automation.name}</span>
                    <span className="d-sess-m">{describeSchedule(automation, t, locale)}</span>
                  </span>
                  <ConfigStatusDot active={isRunning} />
                </button>
              );
            })}
            <ConfigListAction onClick={startCreate}>{t("automation.new")}</ConfigListAction>
          </ConfigSidebarList>
        </ConfigSidebar>

        <ConfigDetail>
          <ConfigSectionTitle>{creating ? t("automation.new") : selected?.name ?? t("automation.title")}</ConfigSectionTitle>

          {!scheduler.started && (
            <p className="d-banner warn">{t("automation.schedulerStopped")}</p>
          )}
          {error && <p className="d-banner err" role="alert">{error}</p>}

          {/*
            fork:v5-landing Wave N1 · D-17 帧 A · 任务列表行 ——
            DOM 抄画板：`.d-cron-row` › `.d-switch` + `.d-col.d-grow`（`.d-cron-t`
            + 调度徽章 + 结局徽章，底下 `.d-set-row-s`）+ `.d-cron-when`
            （下次运行 / 绝对时间 / 相对“几天后”）+ `.d-iconbtn`。
            **一行同时说四件事**：会不会跑、上次结果如何、结果归谁（目录 · 模型）、
            下一次什么时候。开关在库里被排到行尾（`.d-cron-row > .d-switch{order:9}`），
            与画板一致；语义与原来那个“调度”开关**完全相同**（改的是草稿里的 active，
            要落盘仍靠页脚的保存）。
          */}
          {(creating || selected) && (() => {
            const rowSchedule = describeSchedule({ ...draft, nextRunAt: 0 }, t, locale);
            const next = listUpcomingRuns({ ...draft, nextRunAt: 0 }, now, 1)[0];
            const lastRun = selected?.runHistory[selected.runHistory.length - 1];
            const paused = selected?.pausedReason === "consecutive-failures";
            const outcome = paused
              ? `${t("automation.pausedBackoff")}${selected?.consecutiveFailures
                ? ` · ${t("automation.consecutiveFailures", { count: selected.consecutiveFailures })}`
                : ""}`
              : selected?.pausedReason === "completed"
                ? t("automation.completed")
                : lastRun
                  ? t(`automation.runStatus.${lastRun.status}`)
                  : t("automation.never");
            const outcomeTone = paused ? "bad" : lastRun ? runBadge(lastRun.status) : "mute";
            return (
              <div className="d-cron-row">
                <button
                  type="button"
                  role="switch"
                  aria-checked={draft.active}
                  aria-label={draft.active ? t("automation.pausedManual") : t("automation.reopen")}
                  className={`d-switch${draft.active ? " on" : ""}`}
                  disabled={readOnly || busy}
                  onClick={() => setDraft({ ...draft, active: !draft.active })}
                />
                <div className="d-col d-grow">
                  <div className="d-row">
                    <span className="d-cron-t">{draft.name || t("automation.namePlaceholder")}</span>
                    <span className="d-badge mute">{rowSchedule}</span>
                    <span className={`d-badge ${outcomeTone}`}>{outcome}</span>
                  </div>
                  <span className="d-set-row-s">
                    {[
                      draft.cwd || "—",
                      draft.model || t("automation.modelDefault"),
                      // 画板帧 A 的副行末尾写的是「上次 41s」—— 那一个数是真有的
                      // （`AutomationRun.durationMs`），没记到就不写，不拿别的东西顶。
                      lastRun && typeof lastRun.durationMs === "number"
                        ? `${t("automation.lastRun")} ${durationText(lastRun)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <div className="d-cron-when">
                  <span className="d-t-xs d-t-faint">{t("automation.nextRun")}</span>
                  <span className="d-t-sm">
                    {draft.active && next ? formatter.format(new Date(next)) : t("automation.pausedManual")}
                  </span>
                  <span className="d-t-xs d-t-faint">
                    {draft.active && next ? formatRelativeTime(new Date(next), locale, new Date(now)) : ""}
                  </span>
                </div>
                {selected && !creating && (
                  <>
                    <button
                      type="button"
                      ref={rowMenuRef}
                      className="d-iconbtn"
                      aria-expanded={rowMenuOpen}
                      aria-haspopup="menu"
                      aria-label={t("automation.edit")}
                      title={t("automation.edit")}
                      onClick={() => setRowMenuOpen((open) => !open)}
                    >
                      <i data-ico="ellipsis-vertical" data-size="15" aria-hidden="true" />
                    </button>
                    {/*
                      行菜单走共享的 `PortalDropdown`（portal + fixed）：这一块在
                      `.d-set-main` 里，而那层是 `overflow-y:auto` —— `.d-pop` 那种
                      `position:absolute` 的浮窗会被它整个裁掉（LANDING §4 第一条陷阱）。
                      菜单项只挂**面板里已经有的两个动作**（画板那三行里
                      「复制成新任务」「看 N 次运行记录」是产品没有的功能，不自造）。
                    */}
                    <PortalDropdown
                      open={rowMenuOpen}
                      anchorRef={rowMenuRef}
                      panelRef={rowMenuPanelRef}
                      className="d-pop-float"
                      width={210}
                      align="right"
                    >
                      <div className="d-pop-title">{selected.name}</div>
                      <div className="d-sep" />
                      <div role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          className="d-menu-row"
                          disabled={readOnly || busy || scheduler.activeRunIds.includes(selected.id)}
                          onClick={() => {
                            setRowMenuOpen(false);
                            void post({ action: "run-now", id: selected.id });
                          }}
                        >
                          <i data-ico="play" data-size="14" aria-hidden="true" />
                          {t("automation.runNow")}
                        </button>
                      </div>
                      <div className="d-sep" />
                      <div role="menu">
                        <button
                          type="button"
                          role="menuitem"
                          className="d-menu-row danger"
                          disabled={readOnly || busy}
                          onClick={() => {
                            setRowMenuOpen(false);
                            if (window.confirm(t("automation.deleteConfirm"))) {
                              void post({ action: "delete", id: selected.id }).then(() => {
                                setSelectedId(null);
                                setCreating(false);
                              });
                            }
                          }}
                        >
                          <i data-ico="trash-2" data-size="14" aria-hidden="true" />
                          {t("automation.delete")}
                        </button>
                      </div>
                    </PortalDropdown>
                  </>
                )}
              </div>
            );
          })()}

          <AutomationEditor
            draft={draft}
            onChange={setDraft}
            disabled={readOnly || busy}
            modelOptions={modelOptions}
          />

          {selected && !creating && (
            <>
              <ConfigSectionTitle>{t("automation.nextRuns")}</ConfigSectionTitle>
              <p className="d-t-xs d-t-faint">
                {upcoming.length > 0
                  ? upcoming.map((timestamp) => formatter.format(new Date(timestamp))).join(" · ")
                  : t("automation.never")}
              </p>
              <p className="d-t-xs d-t-faint">
                {t("automation.lastRun")}: {selected.lastRunAt ? formatter.format(new Date(selected.lastRunAt)) : t("automation.never")}
                {selected.lastContextUsage !== undefined && (
                  <> · {(selected.lastContextUsage * 100).toFixed(0)}% / {Math.round(AUTOMATION_DAILY_CONTEXT_ROLLOVER_THRESHOLD * 100)}%</>
                )}
              </p>
              {selected.pausedReason === "consecutive-failures" && (
                <p className="d-banner warn" role="status">
                  {t("automation.pausedBackoff")}
                  {selected.consecutiveFailures ? ` · ${t("automation.consecutiveFailures", { count: selected.consecutiveFailures })}` : ""}
                </p>
              )}
              {selected.pausedReason === "completed" && (
                <p className="d-banner info" role="status">{t("automation.completed")}</p>
              )}

              <ConfigSectionTitle>{t("automation.history")}</ConfigSectionTitle>
              {selected.runHistory.length === 0 ? (
                <ConfigEmptyState>{t("automation.noRuns")}</ConfigEmptyState>
              ) : (() => {
                const runs = [...selected.runHistory].reverse();
                const countOf = (status: AutomationRun["status"]): number =>
                  selected.runHistory.filter((run) => run.status === status).length;
                const shown = runs.filter((run) =>
                  historyFilter === "all"
                    ? true
                    : run.status === historyFilter);
                const openRun = openRunAt === null
                  ? null
                  : runs.find((run) => run.runAt === openRunAt) ?? null;
                return (
                  <>
                    {/*
                      fork:v5-landing Wave N1 · D-17 帧 C —— 结局筛选。
                      画板那四枚里有一枚是「已延后」（错峰执行），**产品没有错峰**，
                      所以这里只列三种结局 + 全部，不自造第四档；每枚带上真实计数。
                    */}
                    <div className="d-row">
                      <span className="d-t-xs d-t-faint">{t("i18n.status")}</span>
                      <div className="d-cats">
                        <button
                          type="button"
                          className={`d-cat${historyFilter === "success" ? " is-on" : ""}`}
                          aria-pressed={historyFilter === "success"}
                          onClick={() => setHistoryFilter(historyFilter === "success" ? "all" : "success")}
                        >
                          {t("automation.runStatus.success")} {countOf("success")}
                        </button>
                        <button
                          type="button"
                          className={`d-cat${historyFilter === "error" ? " is-on" : ""}`}
                          aria-pressed={historyFilter === "error"}
                          onClick={() => setHistoryFilter(historyFilter === "error" ? "all" : "error")}
                        >
                          {t("automation.runStatus.error")} {countOf("error")}
                        </button>
                        <button
                          type="button"
                          className={`d-cat${historyFilter === "skipped" ? " is-on" : ""}`}
                          aria-pressed={historyFilter === "skipped"}
                          onClick={() => setHistoryFilter(historyFilter === "skipped" ? "all" : "skipped")}
                        >
                          {t("automation.runStatus.skipped")} {countOf("skipped")}
                        </button>
                        <button
                          type="button"
                          className={`d-cat${historyFilter === "all" ? " is-on" : ""}`}
                          aria-pressed={historyFilter === "all"}
                          onClick={() => setHistoryFilter("all")}
                        >
                          {t("automation.history")} {selected.runHistory.length}
                        </button>
                      </div>
                    </div>

                    <div className="d-card">
                      <div className="d-card-body" style={{ padding: "var(--nx-sp-2)" }}>
                        {shown.length === 0 && (
                          <span className="d-t-xs d-t-faint">{t("automation.noRuns")}</span>
                        )}
                        {shown.map((run) => (
                          <div className="d-hist-row" key={`${run.runAt}-${run.status}`}>
                            <span className={`d-badge ${runBadge(run.status)}`}>
                              {t(`automation.runStatus.${run.status}`)}
                            </span>
                            <span className="d-hist-t">{formatter.format(new Date(run.runAt))}</span>
                            {/* 任务名（`.d-grow` 自适应）与耗时列：画板在这里写的是
                                `min-width:104px` / `min-width:56px`，而门禁不收内联像素几何，
                                列宽对齐交给库里那两条规则（`.d-hist-t` 64px /
                                `.d-hist-cost` 76px，右对齐 + tabular）。类名一字未改。 */}
                            <span className="d-grow d-t-xs">{selected.name}</span>
                            <span className="d-t-xs d-t-faint">{durationText(run)}</span>
                            <span className="d-hist-cost">—</span>
                            <span className="d-t-xs d-t-faint">
                              {skipReasonText(run)
                                ?? (run.status === "error" && run.error ? run.error : "")}
                            </span>
                            <span style={{ flex: "0 0 auto" }}>
                              <button
                                type="button"
                                className="d-btn sm"
                                onClick={() => setOpenRunAt(openRunAt === run.runAt ? null : run.runAt)}
                              >
                                {t("i18n.showDetails")}
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/*
                      fork:v5-landing Wave N1 · D-17 帧 D · 单次运行详情 ——
                      「为什么判失败」写在输出旁边（最常见的失败根本不是模型出错），
                      以及「怎么重跑」那一行。
                      **不画的部分**：`.d-code` 指令快照与 `.d-steps` 步骤耗时 ——
                      运行记录里没有逐轮快照与分步耗时（`AutomationRun` 只有
                      runAt / sessionId / status / durationMs / error / skipReason），
                      不拿当前配置冒充历史快照，也不编步骤。
                      **`.d-hist-cost` 写「—」**：落盘里没有每次运行的费用字段，
                      没有样本就不摆数（等存储侧补 per-run cost 再填）。
                    */}
                    {openRun && (
                      <div className="d-card">
                        <div className="d-card-body">
                          <div className="d-row">
                            <span className={`d-badge ${runBadge(openRun.status)}`}>
                              {t(`automation.runStatus.${openRun.status}`)}
                            </span>
                            {selected.pausedReason === "consecutive-failures" && openRun.status === "error" && (
                              <span className="d-badge mute">{t("automation.pausedBackoff")}</span>
                            )}
                            <span className="d-grow" aria-hidden="true" />
                            <span className="d-t-xs d-t-faint">
                              {`${durationText(openRun)} · ${formatter.format(new Date(openRun.runAt))}`}
                            </span>
                          </div>
                          {openRun.status === "error" && openRun.error && (
                            <div className="d-banner err" role="status">
                              <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
                              <span>
                                <b>{t("automation.runStatus.error")}</b>
                                {` · ${openRun.error}`}
                              </span>
                            </div>
                          )}
                          {skipReasonText(openRun) && (
                            <div className="d-banner" role="status">
                              <i data-ico="info" data-size="14" aria-hidden="true" />
                              <span>
                                <b>{t("automation.runStatus.skipped")}</b>
                                {` · ${skipReasonText(openRun)}`}
                              </span>
                            </div>
                          )}
                          <div className="d-set-row">
                            <div className="d-set-row-box">
                              <div className="d-set-row-t">{t("automation.runNow")}</div>
                              <div className="d-set-row-s">{describeSchedule(selected, t, locale)}</div>
                            </div>
                            <span className="d-grow-last">
                              <button
                                type="button"
                                className="d-btn sm"
                                disabled={readOnly || busy || scheduler.activeRunIds.includes(selected.id)}
                                onClick={() => void post({ action: "run-now", id: selected.id })}
                              >
                                <i data-ico="rotate-cw" data-size="13" aria-hidden="true" />
                                {t("automation.runNow")}
                              </button>
                            </span>
                          </div>
                          <div className="d-row" style={{ justifyContent: "flex-end" }}>
                            <button
                              type="button"
                              className="d-btn primary sm"
                              onClick={() => setOpenRunAt(null)}
                            >
                              {t("i18n.close")}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}
            </>
          )}

          {/* fork:automation-layout —— 页脚原来把**整段副标题**（一句 40+ 字的中文）
              当 status 塞在按钮左边，还套了 `.pw-mono`（等宽 11px）—— 那是「挤」的
              主要来源，而且那句话在面板顶部已经出现过一次。页脚只留动作。 */}
          <ConfigFooter>
            <ConfigButton variant="primary" size="small" disabled={readOnly || busy} onClick={save}>
              {t("automation.save")}
            </ConfigButton>
            <ConfigButton
              variant="ghost"
              size="small"
              disabled={readOnly || busy || scheduler.activeRunIds.includes(selected?.id ?? "")}
              onClick={() => selectedId && void post({ action: "run-now", id: selectedId })}
            >
              {t("automation.runNow")}
            </ConfigButton>
            <ConfigButton
              variant="danger"
              size="small"
              disabled={readOnly || busy || !selectedId}
              onClick={() => {
                if (selectedId && window.confirm(t("automation.deleteConfirm"))) {
                  void post({ action: "delete", id: selectedId }).then(() => {
                    setSelectedId(null);
                    setCreating(false);
                  });
                }
              }}
            >
              {t("automation.delete")}
            </ConfigButton>
          </ConfigFooter>
        </ConfigDetail>
      </ConfigSplitView>
    </ConfigPanelShell>
  );
}