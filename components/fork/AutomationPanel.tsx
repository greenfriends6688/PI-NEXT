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
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ConfigBadge,
  ConfigButton,
  ConfigDetail,
  ConfigEmptyState,
  ConfigField,
  ConfigFooter,
  ConfigListAction,
  ConfigPanelShell,
  ConfigSectionTitle,
  ConfigSidebar,
  ConfigSidebarList,
  ConfigSplitView,
  ConfigStatusDot,
  ConfigSwitch,
} from "../SettingsUi";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useI18n } from "@/hooks/useI18n";
import { PwaBanner, PwaPage, PwaSetRow, PwaSwitchRow } from "@/components/pwa/PwaPage";
import { PwaSheet } from "@/components/pwa/PwaSheet";
import { AutomationEditor } from "./AutomationEditor";
import { describeSchedule, listUpcomingRuns } from "@/lib/automation-schedule";
import {
  AUTOMATION_DAILY_CONTEXT_ROLLOVER_THRESHOLD,
  type Automation,
  type AutomationDraft,
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

  // fork:v5-landing Wave B · M-09 帧 B · 定时任务 ——
  // 手机上这是一个**独立一级页**，不是 hub 卡片：每张卡只回答两件事
  // （`.m-croncard-head` 末位的调度徽章 + 开关，`.m-cronhist` 的上次成没成 / 下次什么时候），
  // 新建与详情一律走 `.m-sheet` 底部面板，不新开页面。
  // 数据、调度口径、开关语义（直接生效、关闭后历史留着）与桌面**完全同一份**。
  if (mobile) {
    const runDot = (status: string): string =>
      status === "success" ? "ok" : status === "error" ? "bad" : "warn";
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

          {(creating || selected) && (
            <ConfigField label={t("automation.schedule")}>
              <ConfigSwitch
                checked={draft.active}
                disabled={readOnly || busy}
                label={draft.active ? t("automation.pausedManual") : t("automation.reopen")}
                onChange={(next) => setDraft({ ...draft, active: next })}
              />
            </ConfigField>
          )}

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
              ) : (
                <ul className="fork-automation-history">
                  {[...selected.runHistory].reverse().map((run, index) => (
                    <li key={`${run.runAt}-${index}`} className="fork-automation-run">
                      <ConfigBadge tone={run.status === "success" ? "ok" : run.status === "error" ? "bad" : undefined}>
                        {t(`automation.runStatus.${run.status}`)}
                      </ConfigBadge>
                      <span className="d-mono d-t-faint">{formatter.format(new Date(run.runAt))}</span>
                      {run.status === "skipped" && run.skipReason && (
                        <span className="d-t-xs d-t-faint">
                          {t(`automation.skipReason.${run.skipReason === "source-busy" ? "source-busy" : "previous-run-active"}`)}
                        </span>
                      )}
                      {run.status === "error" && run.error && <span className="d-t-xs d-t-faint">{run.error}</span>}
                    </li>
                  ))}
                </ul>
              )}
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