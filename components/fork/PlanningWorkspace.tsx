"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import {
  PlanningApiError,
  fetchDueReminders,
  fetchPlanningSnapshot,
  runPlanningOp,
  startTodoAgent,
  type PlanningEntity,
  type PlanningOp,
} from "@/lib/planning-client";
import { addLocalDays, addLocalMonths, buildMonthGrid, buildWeekGrid, startOfLocalDay } from "@/lib/planning-calendar";
import type { DisplayReminder } from "@/lib/planning-reminders";
import type { PlanningState } from "@/lib/planning-types";
import {
  filterTodos,
  sortTodos,
  toTodoView,
  visibleEvents,
  type TodoFilterStatus,
  type TodoViewFilter,
} from "@/lib/planning-view";
import { PlanningCalendar, type PlanningCalendarMode } from "./PlanningCalendar";
import { PlanningReminderRail } from "./PlanningReminderRail";
import { PlanningTodoDetail, type PlanningWorkspaceOption } from "./PlanningTodoDetail";
import { PlanningTodoList } from "./PlanningTodoList";

/*
 * fork:proma-44-planning —— Todo / 日程工作区的壳。
 *
 * 它是**唯一**持有五类数据快照的地方；列表、详情、日历、提醒条都吃它的 props。
 * 每个 op 之后服务端回**整份快照**（`runPlanningOp` 一次给 `{ entity, state, now }`），
 * 所以这里是唯一的 setState 点 —— 联动规则（改 dueAt 挪提醒、删标签从所有 Todo 上
 * 摘掉）因此只存在于 `lib/planning-state.ts` 一处，前端不复制第二遍。
 *
 * 关闭详情面板的**唯一**出口是 `closeDetail()`：× / Esc / 点空白三种手势都汇到它，
 * 顺序固定为「先 flush 未保存的标题与描述，再清 selectedId」。别处一律不许出现
 * `setSelectedId(null)` —— 漏一处就意味着「× 能保存、Esc 不能」。
 *
 * 提醒：工作区开着时 30 秒一轮轮询，与服务端 tick 同节奏；关掉工作区就停 ——
 * 刻意的取舍（不引 Web Push / 通知权限），见 docs/patches/0004-planning.md。
 */

interface Props {
  /** 发起 Agent 对话时的候选目录。 */
  workspaces: PlanningWorkspaceOption[];
  activeCwd: string | null;
  onClose: () => void;
}

type Tab = "todos" | "calendar";

const REMINDER_POLL_MS = 30_000;
const CLOCK_TICK_MS = 60_000;
const DEFAULT_EVENT_DURATION_MS = 3_600_000;

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function PlanningWorkspace({ workspaces, activeCwd, onClose }: Props) {
  const { t } = useI18n();
  const [state, setState] = useState<PlanningState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>("todos");
  const [view, setView] = useState<TodoViewFilter>("all");
  const [status, setStatus] = useState<TodoFilterStatus>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [calendarMode, setCalendarMode] = useState<PlanningCalendarMode>("week");
  const [cursor, setCursor] = useState(() => startOfLocalDay(Date.now()));
  const [reminders, setReminders] = useState<DisplayReminder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingAgent, setStartingAgent] = useState(false);
  const flushRef = useRef<() => void>(() => {});

  const registerFlush = useCallback((flush: () => void) => { flushRef.current = flush; }, []);

  // ---- 首屏 ----
  useEffect(() => {
    let cancelled = false;
    void fetchPlanningSnapshot().then(
      (snapshot) => {
        if (cancelled) return;
        setState(snapshot.state);
        setNow(snapshot.now);
        setLoading(false);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setError(errorText(cause));
        setLoading(false);
      },
    );
    return () => { cancelled = true; };
  }, []);

  // ---- 提醒：30 秒一轮，与服务端 tick 同节奏 ----
  useEffect(() => {
    let cancelled = false;
    const pull = () => {
      void fetchDueReminders().then(
        (payload) => { if (!cancelled) { setReminders(payload.reminders); setNow(payload.now); } },
        () => { /* 轮询失败静默：提醒条不是关键路径，下一轮还会来 */ },
      );
    };
    pull();
    const timer = setInterval(pull, REMINDER_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // ---- 时钟：逾期 / 今天这类判定要跟着钟走 ----
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // ---- 关闭详情：× / Esc / 点空白共用的这一条 ----
  const closeDetail = useCallback(() => {
    flushRef.current();
    setSelectedId(null);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      // 详情开着先关详情（并把草稿冲出去），否则关整个工作区。
      if (selectedId) closeDetail();
      else onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDetail, onClose, selectedId]);

  const onOp = useCallback(async (op: PlanningOp): Promise<PlanningEntity | undefined> => {
    try {
      const result = await runPlanningOp(op);
      setState(result.state);
      setNow(result.now);
      setError(null);
      return result.entity;
    } catch (cause) {
      setError(cause instanceof PlanningApiError && cause.conflict ? t("planning.conflict") : errorText(cause));
      throw cause;
    }
  }, [t]);

  const safeOp = useCallback((op: PlanningOp) => { void onOp(op).catch(() => { /* 已落到 setError */ }); }, [onOp]);

  const todos = useMemo(() => {
    if (!state) return [];
    return sortTodos(filterTodos(state.todos, { view, status, now })).map((todo) => toTodoView(todo, state));
  }, [state, view, status, now]);

  const selected = useMemo(() => {
    if (!state || !selectedId) return null;
    const todo = state.todos.find((item) => item.id === selectedId);
    return todo ? toTodoView(todo, state) : null;
  }, [state, selectedId]);

  // 可见区间直接取格阵自己算出来的边界，不在前端另算一遍「这个月从哪天开始」。
  // 拿不到就退回一个宽窗口：格阵算法坏了时宁可多画一点，也不要空白的日历。
  const calendarEvents = useMemo(() => {
    if (!state) return [];
    const range = (() => {
      try {
        if (calendarMode === "week") {
          const week = buildWeekGrid(cursor);
          return { from: week.start, to: addLocalDays(week.start, 7) };
        }
        const grid = buildMonthGrid(cursor, now);
        return { from: grid.start, to: addLocalDays(grid.start, grid.weekCount * 7) };
      } catch {
        const from = startOfLocalDay(cursor);
        return { from, to: addLocalDays(from, 42) };
      }
    })();
    return visibleEvents(state, range);
  }, [state, cursor, now, calendarMode]);

  const newTodo = useCallback(() => {
    safeOp({ op: "todo.create", title: t("planning.detail.titlePlaceholder") });
  }, [safeOp, t]);

  const newEvent = useCallback((startAt: number) => {
    safeOp({ op: "event.create", title: t("planning.detail.titlePlaceholder"), startAt, endAt: startAt + DEFAULT_EVENT_DURATION_MS });
  }, [safeOp, t]);

  const startAgent = useCallback(async (todoId: string, expectedUpdatedAt: number) => {
    const cwd = state?.todos.find((todo) => todo.id === todoId)?.workspaceCwd
      ?? activeCwd
      ?? workspaces[0]?.cwd
      ?? "";
    if (!cwd) { setError(t("planning.agent.noWorkspace")); return; }
    setStartingAgent(true);
    try {
      const result = await startTodoAgent(todoId, cwd, expectedUpdatedAt);
      // 复用既有的 `?session=` 导航（`lib/initial-navigation.ts` + AppShell 已认这个参数），
      // 所以「从 Todo 跳到对话」不需要碰 AppShell / TabBar / ChatWindow 里的任何一行，
      // 消息通道也仍然是 `/api/agent` 那一套（没有第二条实现）。
      //
      // 这里要的是**整页跳转**而不是 router.push：会话的加载挂在 useAgentSession 的
      // mount-only effect 上（同文件里「选会话必须 bump sessionKey 就是为了这个」），
      // 客户端路由换 query 不会让它重跑，页面会停在原会话上。
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- 见上
      window.location.assign(`/?session=${encodeURIComponent(result.sessionId)}`);
    } catch (cause) {
      setError(cause instanceof PlanningApiError && cause.conflict ? t("planning.conflict") : errorText(cause));
      setStartingAgent(false);
    }
  }, [state, activeCwd, workspaces, t]);

  const navigateCalendar = useCallback((amount: number) => {
    setCursor((current) => (calendarMode === "week" ? addLocalDays(current, amount * 7) : addLocalMonths(current, amount)));
  }, [calendarMode]);

  const closeButton = (
    <button type="button" className="pw-iconbtn" onClick={onClose} title={t("planning.close")} aria-label={t("planning.close")}>
      <span className="pw-ico"><i data-ico="x" data-size="14"></i></span>
    </button>
  );

  return (
    <div
      className="fork-plan-overlay"
      role="dialog"
      aria-label={t("planning.title")}
      onMouseDown={(event) => {
        // 点空白 = 点在遮罩本身。详情开着时先冲草稿再关详情（与 × / Esc 同一路径）。
        if (event.target !== event.currentTarget) return;
        if (selectedId) closeDetail();
        else onClose();
      }}
    >
      <div className="fork-plan-shell">
        <header className="fork-plan-detail-head">
          <h2 className="fork-plan-detail-name">{t("planning.title")}</h2>
          <div className="pw-tabs" role="tablist" aria-label={t("planning.tabs")}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "todos"}
              className={`pw-tab${tab === "todos" ? " is-on" : ""}`}
              onClick={() => setTab("todos")}
            >
              {t("planning.tab.todos")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "calendar"}
              className={`pw-tab${tab === "calendar" ? " is-on" : ""}`}
              onClick={() => setTab("calendar")}
            >
              {t("planning.tab.calendar")}
            </button>
          </div>
          <span className="grow" />
          {error && <span className="fork-plan-notice is-error" role="alert">{error}</span>}
          {closeButton}
        </header>

        <PlanningReminderRail
          reminders={reminders}
          now={now}
          onAcknowledge={(row) => safeOp({ op: "reminder.acknowledge", id: row.reminder.id })}
          onSnooze={(row, minutes) => safeOp({ op: "reminder.snooze", id: row.reminder.id, minutes })}
          onOpen={(row) => {
            if (row.targetType === "todo") { setTab("todos"); setSelectedId(row.reminder.targetId); }
            else { setTab("calendar"); setSelectedEventId(row.reminder.targetId); }
          }}
        />

        {loading ? (
          <div className="fork-plan-scroll"><p className="pw-muted">{t("planning.loading")}</p></div>
        ) : tab === "todos" ? (
          <div className={`fork-plan-body${selected ? " has-detail" : ""}`}>
            <PlanningTodoList
              todos={todos}
              now={now}
              view={view}
              status={status}
              groups={state?.groups ?? []}
              tags={state?.tags ?? []}
              selectedId={selectedId}
              openTodoCount={(state?.todos ?? []).reduce((sum, todo) => (todo.status === "open" ? sum + 1 : sum), 0)}
              onSelect={setSelectedId}
              onToggleDone={(todo) => safeOp({
                op: "todo.update",
                id: todo.id,
                status: todo.status === "completed" ? "open" : "completed",
                expectedUpdatedAt: todo.updatedAt,
              })}
              onViewChange={setView}
              onStatusChange={setStatus}
              onNewTodo={newTodo}
              onNewGroup={() => {
                const name = window.prompt(t("planning.group.newPrompt"));
                if (name?.trim()) safeOp({ op: "group.create", scope: "todo", name: name.trim() });
              }}
              onNewTag={() => {
                const name = window.prompt(t("planning.tag.newPrompt"));
                if (name?.trim()) safeOp({ op: "tag.create", name: name.trim() });
              }}
            />
            {selected && (
              <PlanningTodoDetail
                todo={selected}
                groups={state?.groups ?? []}
                tags={state?.tags ?? []}
                workspaces={workspaces}
                activeCwd={activeCwd}
                onClose={closeDetail}
                onOp={onOp}
                registerFlush={registerFlush}
                startingAgent={startingAgent}
                onStartAgent={(todo) => void startAgent(todo.id, todo.updatedAt)}
              />
            )}
          </div>
        ) : (
          <div className="fork-plan-body">
            <PlanningCalendar
              mode={calendarMode}
              cursor={cursor}
              now={now}
              events={calendarEvents}
              onModeChange={setCalendarMode}
              onNavigate={navigateCalendar}
              onToday={() => setCursor(startOfLocalDay(Date.now()))}
              onNewEventAt={newEvent}
              onSelectEvent={(event) => setSelectedEventId(event.id)}
            />
            <span className="fork-plan-visually-hidden" data-selected-event={selectedEventId ?? ""} />
          </div>
        )}
      </div>
    </div>
  );
}
