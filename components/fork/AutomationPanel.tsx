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
  ConfigEmptyState,
  ConfigFooter,
  ConfigPanelShell,
  SettingsPage,
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
  type Automation,
  type AutomationDraft,
  type AutomationRun,
} from "@/lib/automation-types";
/** 运行中任务额外轮询的间隔（ms）。任务空闲时不轮询。 */
const RUNNING_POLL_MS = 5_000;

/* fork:v5-landing 逐帧核对（M-09 帧 B）—— 画板那一屏的第一件是 `.m-banner`：
 * 「手机上只管看与开关：调度在桌面端跑，手机连不连都不影响。」
 * 产品此前只在调度器停了 / 出错时才出横幅，平时没有这句口径 ——
 * 而手机上最需要说清的就是「关掉手机它照跑」。本地三语表（不动 i18n 消息包，
 * 口径与 `components/pwa/settingsHub.ts` / `McpLogModal` 同一做法）。 */
const MOBILE_SCOPE_NOTE: Record<string, string> = {
  en: "On the phone you only look and toggle: the scheduler runs on the desktop, and closing the phone changes nothing.",
  "zh-CN": "手机上只管看与开关：调度在桌面端跑，手机连不连都不影响。",
  "zh-TW": "手機上只管看與開關：調度在桌面端跑，手機連不連都不影響。",
};

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
  /* fork:v5-landing D-17 —— 桌面这一节是**一列三视图**（画板帧 A / B / C）：
     列表（默认）/ 编辑器 / 运行历史。`historyForId` 是运行历史这一屏当前看哪条任务；
     列表与编辑器沿用既有的 `selectedId` + `creating`（手机那一支也读这两个，
     不新增第三份指针）。`listFilter` 是帧 A 那排结局筛选。 */
  const [historyForId, setHistoryForId] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState<"all" | "on" | "off" | "failed">("all");
  const [rowMenuFor, setRowMenuFor] = useState<string | null>(null);
  const rowMenuRef = useRef<HTMLButtonElement | null>(null);
  const rowMenuPanelRef = useRef<HTMLDivElement | null>(null);
  useDismissMenu(rowMenuFor !== null, rowMenuRef, rowMenuPanelRef, () => setRowMenuFor(null));

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
    setHistoryForId(null);
    setDraft(emptyDraft(cwd, locale, modelOptions[0]?.value));
  }, [cwd, locale, modelOptions]);

  const startEdit = useCallback((automation: Automation) => {
    setCreating(false);
    setSelectedId(automation.id);
    setHistoryForId(null);
    setDraft(toDraft(automation));
  }, []);

  /** 回到帧 A 列表：三个指针一起清（编辑器草稿留着无所谓，回来时没人看它）。 */
  const backToList = useCallback(() => {
    setCreating(false);
    setSelectedId(null);
    setHistoryForId(null);
    setOpenRunAt(null);
  }, []);

  const closeRowMenu = useCallback(() => setRowMenuFor(null), []);

  const save = useCallback(async () => {
    const ok = creating
      ? await post({ action: "create", automation: draft })
      : selectedId
        ? await post({ action: "update", id: selectedId, automation: draft })
        : false;
    // 帧 B 是一个独立弹层，保存即回到帧 A 列表（失败留在原地，别把人刚填的东西收走）。
    if (ok) backToList();
  }, [backToList, creating, draft, post, selectedId]);

  const upcoming = useMemo(
    () => (selected ? listUpcomingRuns(selected, now, 3) : []),
    [selected, now],
  );

  /* fork:v5-landing D-17 · 帧 C：运行历史这一屏当前看哪条任务（`historyForId`）
     与编辑器共用的 `selectedId` 是两个指针，但查的是同一份列表。 */
  const historyFor = useMemo(
    () => automations.find((automation) => automation.id === historyForId) ?? null,
    [automations, historyForId],
  );
  const openRun = useMemo(
    () => (openRunAt === null || !historyFor
      ? undefined
      : historyFor.runHistory.find((run) => run.runAt === openRunAt)),
    [historyFor, openRunAt],
  );

  const formatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
    [locale],
  );

  /** 帧 C 的「下次运行」卡只显示时刻（日期在补充行与列表行里）。 */
  const timeFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
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
  const durationText = (run: AutomationRun | undefined): string => {
    const ms = run?.durationMs;
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
    const sheetOpen = creating || Boolean(selected && !historyForId);

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
        <PwaBanner icon="info">{MOBILE_SCOPE_NOTE[locale] ?? MOBILE_SCOPE_NOTE.en}</PwaBanner>
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

  /* fork:v5-landing D-17 —— 桌面这一节是**一列**（`.d-set-main` › `.d-set-inner`），
     三个视图逐帧对应画板：帧 A 任务列表（默认）/ 帧 B 编辑器 / 帧 C 运行历史。
     此前是「左导航 + 任务列表窄列 + 详情卡」三栏（`ConfigSplitView`），而画板四帧
     每一帧都是**左导航 + 一列内容** —— 空列表时中间那栏只剩一枚「新建任务」，
     右侧直接摊开一张空表单，正是用户看到的那副样子。
     手机形态（M-09 帧 B）不在本段，仍是上面那个独立一级页。 */
  const viewTitle = historyForId
    ? t("automation.history")
    : creating
      ? t("automation.new")
      : selected?.name ?? t("automation.title");

  /** 任务列表的结局/口径读数（帧 A 的副行、帧 C 的三枚统计卡共用）。 */
  const lastRunOf = (automation: Automation): AutomationRun | undefined =>
    automation.runHistory[automation.runHistory.length - 1];

  /** 帧 A 那一行右侧的「结局徽章」：连续失败暂停 > 跑满停用 > 上一轮结局 > 从未。 */
  const outcomeOf = (automation: Automation): { text: string; tone: string } => {
    const lastRun = lastRunOf(automation);
    if (automation.pausedReason === "consecutive-failures") {
      return {
        text: automation.consecutiveFailures
          ? `${t("automation.pausedBackoff")} · ${t("automation.consecutiveFailures", { count: automation.consecutiveFailures })}`
          : t("automation.pausedBackoff"),
        tone: "bad",
      };
    }
    if (automation.pausedReason === "completed") return { text: t("automation.completed"), tone: "mute" };
    return lastRun
      ? { text: t(`automation.runStatus.${lastRun.status}`), tone: runBadge(lastRun.status) }
      : { text: t("automation.never"), tone: "mute" };
  };

  /** 帧 A 顶部那一句读数：多少条、几条开着、今天真跑了多少次。 */
  const runsToday = automations.reduce(
    (sum, item) => sum + item.runHistory.filter(
      (run) => run.status !== "skipped" && new Date(run.runAt).toDateString() === new Date(now).toDateString(),
    ).length,
    0,
  );

  /** 桌面这一屏在哪一帧：运行历史 > 编辑器 > 列表（列表是默认那一屏）。 */
  const view: "list" | "edit" | "history" = historyForId
    ? "history"
    : creating || selectedId ? "edit" : "list";
  /** 帧 C 当前看的那条任务（`historyForId` 与编辑器的 `selectedId` 共用同一条查找）。 */
  const nextRunOf = (automation: Automation): number | undefined => listUpcomingRuns(automation, now, 1)[0];
  const countRuns = (automation: Automation, status: AutomationRun["status"]): number =>
    automation.runHistory.filter((run) => run.status === status).length;
  const latestRunOf = (automation: Automation, status: AutomationRun["status"]): AutomationRun | undefined =>
    [...automation.runHistory].reverse().find((run) => run.status === status);
  const shownRuns = (automation: Automation): AutomationRun[] =>
    [...automation.runHistory].reverse().filter((run) => historyFilter === "all" || run.status === historyFilter);

  const LIST_FILTERS = [
    { key: "all", label: t("automation.filterAll") },
    { key: "on", label: t("automation.filterOn") },
    { key: "off", label: t("automation.filterOff") },
    { key: "failed", label: t("automation.filterFailed") },
  ] as const;
  const listVisible = automations.filter((automation) => {
    if (listFilter === "on") return automation.active;
    if (listFilter === "off") return !automation.active;
    if (listFilter === "failed") {
      return automation.pausedReason === "consecutive-failures"
        || lastRunOf(automation)?.status === "error";
    }
    return true;
  });

  return (
    <ConfigPanelShell
      embedded
      title={t("automation.title")}
      subtitle={t("automation.subtitle")}
      onClose={() => {}}
    >
      <SettingsPage
        title={viewTitle}
        sub={historyFor
          ? `${historyFor.name} · ${describeSchedule(historyFor, t, locale)}`
          : t("automation.subtitle")}
        actions={view !== "list" ? (
          /* 画板四帧各自是一个弹层页，产品是同一节里的三个视图 —— 板面上没有
             「返回」这一件，它是产品行为的最小接线（与 ModelsConfig 的钻入列同款）。 */
          <ConfigButton variant="ghost" size="small" onClick={backToList}>
            <i data-ico="arrow-left" data-size="13" aria-hidden="true" />
            {t("automation.backToList")}
          </ConfigButton>
        ) : undefined}
      >
        {!scheduler.started && (
          <div className="d-banner warn" role="status">
            <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
            <span className="d-grow">{t("automation.schedulerStopped")}</span>
          </div>
        )}
        {error && (
          <div className="d-banner err" role="alert">
            <i data-ico="triangle-alert" data-size="14" aria-hidden="true" />
            <span className="d-grow">{error}</span>
          </div>
        )}

        {view === "list" && (
          /* ── 帧 A · 任务列表 ─────────────────────────────────────────────── */
          <div className="d-set-inner">
            <div className="d-set-sec">
              <div className="d-row">
                <div className="d-t-xs d-t-faint d-grow">
                  {t("automation.summary", {
                    count: automations.length,
                    active: automations.filter((automation) => automation.active).length,
                    runs: runsToday,
                  })}
                </div>
                <ConfigButton size="small" onClick={startCreate} disabled={readOnly || busy}>
                  <i data-ico="plus" data-size="14" aria-hidden="true" />
                  {t("automation.new")}
                </ConfigButton>
              </div>

              <div className="d-cats">
                <span className="d-t-xs d-t-faint">{t("automation.filter")}</span>
                {LIST_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    className={`d-cat${listFilter === filter.key ? " is-on" : ""}`}
                    aria-pressed={listFilter === filter.key}
                    onClick={() => setListFilter(filter.key)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              {automations.length === 0 ? (
                <ConfigEmptyState>
                  <span className="d-empty-ico"><i data-ico="timer" data-size="16" aria-hidden="true" /></span>
                  <p className="d-empty-t">{t("automation.empty")}</p>
                  <p className="d-empty-s">{t("automation.emptyHint")}</p>
                </ConfigEmptyState>
              ) : (
                <div className="d-col" style={{ gap: "var(--nx-sp-2)" }}>
                  {listVisible.map((automation) => {
                    const outcome = outcomeOf(automation);
                    const lastRun = lastRunOf(automation);
                    const next = listUpcomingRuns(automation, now, 1)[0];
                    const isRunning = scheduler.activeRunIds.includes(automation.id);
                    const menuOpen = rowMenuFor === automation.id;
                    return (
                      /*
                        帧 A 的任务行：`.d-cron-row` › `.d-switch`（库里排到行尾，
                        order:9）+ `.d-col.d-grow`（`.d-cron-t` + 调度徽章 + 结局徽章，
                        底下 `.d-set-row-s` 写结果归谁）+ `.d-cron-when`（下次运行
                        绝对时间 + 相对「几天后」）+ `.d-iconbtn`。
                        **一行说四件事**：会不会跑、上次结果如何、结果归谁、下一次什么时候。
                        开关即时生效（板面页脚原话「开关即时生效」），落盘走
                        `update`，与页脚的「保存」无关 —— 保存只管编辑器的草稿。 */
                      <div className="d-cron-row" key={automation.id}>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={automation.active}
                          aria-label={automation.active ? t("automation.pausedManual") : t("automation.reopen")}
                          className={`d-switch${automation.active ? " on" : ""}`}
                          disabled={readOnly || busy}
                          onClick={() => void post({
                            action: "update",
                            id: automation.id,
                            automation: { ...toDraft(automation), active: !automation.active },
                          })}
                        />
                        <div className="d-col d-grow">
                          <div className="d-row">
                            <span className="d-cron-t">{automation.name}</span>
                            <span className="d-badge mute">{describeSchedule(automation, t, locale)}</span>
                            <span className={`d-badge ${isRunning ? "ok" : outcome.tone}`}>
                              {isRunning ? t("automation.running") : outcome.text}
                            </span>
                          </div>
                          <span className="d-set-row-s">
                            {[
                              automation.cwd || "—",
                              automation.model || t("automation.modelDefault"),
                              // 画板帧 A 的副行末尾写的是「上次 41s」—— 那一个数是真有的
                              // （`AutomationRun.durationMs`），没记到就不写，不拿别的东西顶。
                              lastRun && typeof lastRun.durationMs === "number"
                                ? `${t("automation.lastRun")} ${durationText(lastRun)}`
                                : null,
                              automation.lastContextUsage !== undefined
                                ? t("automation.contextUsage", {
                                    value: Math.round(automation.lastContextUsage * 100),
                                  })
                                : null,
                            ].filter(Boolean).join(" · ")}
                          </span>
                        </div>
                        <div className="d-cron-when">
                          <span className="d-t-xs d-t-faint">{t("automation.nextRun")}</span>
                          <span className="d-t-sm">
                            {automation.active && next
                              ? formatter.format(new Date(next))
                              : t("automation.pausedManual")}
                          </span>
                          {/* 相对时间这一行**只在有下一次时**才画：板面第 3 行
                              （证书到期检查）就是两行，而第 1/2/5/6 行是三行 ——
                              判据是「这一行有没有话说」。不画空行，否则每行都多一格。 */}
                          {automation.active && next ? (
                            <span className="d-t-xs d-t-faint">
                              {formatRelativeTime(new Date(next), locale, new Date(now))}
                            </span>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          ref={menuOpen ? rowMenuRef : undefined}
                          className="d-iconbtn"
                          aria-expanded={menuOpen}
                          aria-haspopup="menu"
                          aria-label={t("automation.edit")}
                          title={t("automation.edit")}
                          onClick={() => setRowMenuFor(menuOpen ? null : automation.id)}
                        >
                          <i data-ico="ellipsis-vertical" data-size="15" aria-hidden="true" />
                        </button>
                        {/*
                          行菜单走共享的 `PortalDropdown`（portal + fixed）：这一块在
                          `.d-set-main` 里，而那层是 `overflow-y:auto` —— `.d-pop` 那种
                          `position:absolute` 的浮窗会被它整个裁掉（LANDING §4 第一条陷阱）。
                          四项都是板面帧 A 那一串菜单里产品真有的动作（「复制成新任务」
                          没有对应后端动作，不自造）。
                        */}
                        <PortalDropdown
                          open={menuOpen}
                          anchorRef={rowMenuRef}
                          panelRef={rowMenuPanelRef}
                          className="d-pop-float"
                          width={230}
                          align="right"
                        >
                          <div className="d-pop-title">{automation.name}</div>
                          <div className="d-sep" />
                          <div role="menu">
                            <button
                              type="button"
                              role="menuitem"
                              className="d-menu-row"
                              disabled={readOnly || busy || isRunning}
                              onClick={() => { closeRowMenu(); void post({ action: "run-now", id: automation.id }); }}
                            >
                              <i data-ico="play" data-size="14" aria-hidden="true" />
                              {t("automation.runNow")}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="d-menu-row"
                              disabled={readOnly || busy}
                              onClick={() => { closeRowMenu(); startEdit(automation); }}
                            >
                              <i data-ico="pencil" data-size="14" aria-hidden="true" />
                              {t("automation.edit")}
                            </button>
                            <button
                              type="button"
                              role="menuitem"
                              className="d-menu-row"
                              onClick={() => { closeRowMenu(); setHistoryForId(automation.id); }}
                            >
                              <i data-ico="file-diff" data-size="14" aria-hidden="true" />
                              {t("automation.viewRuns", { count: automation.runHistory.length })}
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
                                closeRowMenu();
                                if (window.confirm(t("automation.deleteConfirm"))) {
                                  void post({ action: "delete", id: automation.id });
                                }
                              }}
                            >
                              <i data-ico="trash-2" data-size="14" aria-hidden="true" />
                              {t("automation.delete")}
                            </button>
                          </div>
                        </PortalDropdown>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 帧 A 底部那条口径横幅：把「跳过」与「失败」分开 —— 混进失败率会让人
                  以为任务坏了，进而把好的那条删掉。产品没有画板那档「已延后」
                  （没有错峰执行），所以这里只说两种。 */}
              <div className="d-banner">
                <i data-ico="info" data-size="14" aria-hidden="true" />
                <span className="d-grow">{t("automation.outcomes")}</span>
              </div>
            </div>
          </div>
        )}

        {view === "edit" && (
          /* ── 帧 B · 编辑器 ──────────────────────────────────────────────── */
          <div className="d-set-inner" style={{ gap: "var(--nx-sp-4)" }}>
            <AutomationEditor
              draft={draft}
              onChange={setDraft}
              disabled={readOnly || busy}
              modelOptions={modelOptions}
            />
            <ConfigFooter status={t("automation.saveHint")}>
              <ConfigButton
                variant="ghost"
                size="small"
                disabled={readOnly || busy}
                onClick={backToList}
              >
                {t("i18n.cancel")}
              </ConfigButton>
              {!creating && selectedId && (
                <ConfigButton
                  size="small"
                  disabled={readOnly || busy || scheduler.activeRunIds.includes(selectedId)}
                  onClick={() => void post({ action: "run-now", id: selectedId })}
                >
                  <i data-ico="play" data-size="14" aria-hidden="true" />
                  {t("automation.runNow")}
                </ConfigButton>
              )}
              <ConfigButton
                variant="primary"
                size="small"
                disabled={readOnly || busy}
                onClick={() => void save()}
              >
                <i data-ico="check" data-size="14" aria-hidden="true" />
                {t("automation.save")}
              </ConfigButton>
            </ConfigFooter>
          </div>
        )}

        {view === "history" && historyFor && (
          /* ── 帧 C · 运行历史（+ 帧 D 单次详情）─────────────────────────── */
          <div className="d-set-inner">
            <div className="d-set-sec">
              <div className="d-statgrid">
                {(["success", "error", "skipped"] as const).map((status) => (
                  <div className="d-stat" key={status}>
                    <div className="d-row">
                      <i
                        data-ico={status === "success" ? "circle-check" : status === "error" ? "triangle-alert" : "circle-slash"}
                        data-size="13"
                        aria-hidden="true"
                      />
                      <span className="d-t-xs d-t-faint d-grow">{t(`automation.runStatus.${status}`)}</span>
                    </div>
                    <div className="d-t-title d-num">
                      {countRuns(historyFor, status)}
                    </div>
                    <div className="d-t-xs d-t-faint">
                      {status === "skipped"
                        ? t("automation.skippedHint")
                        : latestRunOf(historyFor, status)
                          ? `${t("automation.lastRun")} ${durationText(latestRunOf(historyFor, status))}`
                          : "—"}
                    </div>
                  </div>
                ))}
                <div className="d-stat">
                  <div className="d-row">
                    <i data-ico="calendar-clock" data-size="13" aria-hidden="true" />
                    <span className="d-t-xs d-t-faint d-grow">{t("automation.nextRun")}</span>
                  </div>
                  {/* 大数那一格只放时刻（`.d-t-title` 是单行字号，整串日期会折成两行把
                      卡片撑高一截）；绝对日期与相对时间挪到补充行。 */}
                  <div className="d-t-title d-num d-t-sm">
                    {historyFor.active && nextRunOf(historyFor)
                      ? timeFormatter.format(new Date(nextRunOf(historyFor) as number))
                      : t("automation.pausedManual")}
                  </div>
                  <div className="d-t-xs d-t-faint">
                    {historyFor.active && nextRunOf(historyFor)
                      ? formatRelativeTime(new Date(nextRunOf(historyFor) as number), locale, new Date(now))
                      : describeSchedule(historyFor, t, locale)}
                  </div>
                </div>
              </div>

              <div className="d-row">
                <span className="d-t-xs d-t-faint">{t("i18n.status")}</span>
                <div className="d-cats">
                  {(["success", "error", "skipped", "all"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={`d-cat${historyFilter === status ? " is-on" : ""}`}
                      aria-pressed={historyFilter === status}
                      onClick={() => setHistoryFilter(status)}
                    >
                      {status === "all"
                        ? `${t("automation.history")} ${historyFor.runHistory.length}`
                        : `${t(`automation.runStatus.${status}`)} ${countRuns(historyFor, status)}`}
                    </button>
                  ))}
                </div>
              </div>

              {historyFor.runHistory.length === 0 ? (
                <ConfigEmptyState>{t("automation.noRuns")}</ConfigEmptyState>
              ) : (
                <div className="d-card">
                  <div className="d-card-body" style={{ padding: "var(--nx-sp-2)" }}>
                    {shownRuns(historyFor).map((run) => (
                      <div className="d-hist-row" key={`${run.runAt}-${run.status}`}>
                        <span className={`d-badge ${runBadge(run.status)}`}>
                          {t(`automation.runStatus.${run.status}`)}
                        </span>
                        <span className="d-hist-t">{formatter.format(new Date(run.runAt))}</span>
                        {/* 任务名（`.d-grow` 自适应）与耗时列：画板在这里写的是
                            `min-width:104px` / `min-width:56px`，而门禁不收内联像素几何，
                            列宽对齐交给库里那两条规则（`.d-hist-t` 64px /
                            `.d-hist-cost` 76px，右对齐 + tabular）。类名一字未改。 */}
                        <span className="d-grow d-t-xs">{historyFor.name}</span>
                        <span className="d-t-xs d-t-faint">{durationText(run)}</span>
                        <span className="d-hist-cost">—</span>
                        <span className="d-t-xs d-t-faint">
                          {skipReasonText(run) ?? (run.status === "error" && run.error ? run.error : "")}
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
              )}

              {/* 帧 D · 单次运行详情：「为什么判失败」写在输出旁边 —— 最常见的失败
                  根本不是模型出错，而是权限档与指令互相矛盾。
                  **不画的部分**：`.d-code` 指令快照与 `.d-steps` 步骤耗时 ——
                  运行记录里没有逐轮快照与分步耗时（`AutomationRun` 只有
                  runAt / sessionId / status / durationMs / error / skipReason），
                  不拿当前配置冒充历史快照，也不编步骤。
                  **`.d-hist-cost` 写「—」**：落盘里没有每次运行的费用字段，
                  没有样本就不摆数。 */}
              {openRun && (
                <div className="d-card">
                  <div className="d-card-body">
                    <div className="d-row">
                      <span className={`d-badge ${runBadge(openRun.status)}`}>
                        {t(`automation.runStatus.${openRun.status}`)}
                      </span>
                      {historyFor.pausedReason === "consecutive-failures" && openRun.status === "error" && (
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
                        <div className="d-set-row-s">{describeSchedule(historyFor, t, locale)}</div>
                      </div>
                      <span className="d-grow-last">
                        <button
                          type="button"
                          className="d-btn sm"
                          disabled={readOnly || busy || scheduler.activeRunIds.includes(historyFor.id)}
                          onClick={() => void post({ action: "run-now", id: historyFor.id })}
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
            </div>
          </div>
        )}
      </SettingsPage>
    </ConfigPanelShell>
  );
}
