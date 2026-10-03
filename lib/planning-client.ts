/**
 * fork:proma-44-planning —— 浏览器侧唯一的请求出口。
 *
 * 五类数据共用一个 `POST /api/planning` 的 op 分发接口，所以这里是「一个 fetch +
 * 一张 op 表」。三个约定：
 *
 * 1. **409 单独认**。版本冲突（另一个面板改了同一条）与普通失败必须能分开 ——
 *    冲突要提示「重新加载」，普通失败要提示「重试」，两者混成一句 toast 是
 *    Proma 那边最常见的一处体验退化。
 * 2. **不缓存**。`Cache-Control: no-store` + 请求头 `cache: "no-store"`：提醒的
 *    到点状态是时间敏感的，被 CDN / 浏览器回放一次就是「一小时前响过的提醒又响了」。
 * 3. **不带乐观更新**。列表小（本地文件撑死几千条），一次往返比本地改再回滚简单，
 *    也免了「乐观改完发现冲突要回滚」的 UI。
 */

import type { PlanningEvent, PlanningGroup, PlanningReminder, PlanningSnapshot, PlanningState, PlanningTag, PlanningTodo, TodoPriority, TodoStatus } from "./planning-types";
import type { DisplayReminder } from "./planning-reminders";

export class PlanningApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly conflict: boolean) {
    super(message);
    this.name = "PlanningApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok || body.error) {
    throw new PlanningApiError(body.error ?? `HTTP ${res.status}`, res.status, res.status === 409);
  }
  return body;
}

export function fetchPlanningSnapshot(): Promise<PlanningSnapshot> {
  return request<PlanningSnapshot>("/api/planning");
}

/** 提醒条：常驻显示未来 24 小时内未确认的提醒。 */
export function fetchDueReminders(horizonMs?: number): Promise<{ reminders: DisplayReminder[]; now: number }> {
  const query = horizonMs === undefined ? "" : `?horizon=${Math.round(horizonMs)}`;
  return request<{ reminders: DisplayReminder[]; now: number }>(`/api/planning/reminders${query}`);
}

export type PlanningOp =
  | { op: "todo.create"; title: string; notes?: string; priority?: TodoPriority; dueAt?: number; groupId?: string; tagIds?: string[] }
  | { op: "todo.update"; id: string; title?: string; notes?: string; status?: TodoStatus; priority?: TodoPriority; dueAt?: number | null; groupId?: string | null; tagIds?: string[]; workspaceCwd?: string | null; expectedUpdatedAt?: number }
  | { op: "todo.delete"; id: string }
  | { op: "event.create"; title: string; notes?: string; startAt: number; endAt?: number; allDay?: boolean; groupId?: string; tagIds?: string[]; todoId?: string }
  | { op: "event.update"; id: string; title?: string; notes?: string; startAt?: number; endAt?: number | null; allDay?: boolean; groupId?: string | null; tagIds?: string[]; todoId?: string | null; expectedUpdatedAt?: number }
  | { op: "event.delete"; id: string }
  | { op: "group.create"; scope: "todo" | "calendar"; name: string }
  | { op: "group.rename"; id: string; name: string }
  | { op: "group.delete"; id: string }
  | { op: "tag.create"; name: string }
  | { op: "tag.rename"; id: string; name: string }
  | { op: "tag.delete"; id: string }
  | { op: "reminder.create"; targetType: "todo" | "calendar_event"; targetId: string; triggerAt: number }
  | { op: "reminder.delete"; id: string }
  | { op: "reminder.acknowledge"; id: string }
  | { op: "reminder.snooze"; id: string; minutes: number };

/** 一次 op 改动的那个实体。调用方要按 op 的种类自己收窄。 */
export type PlanningEntity =
  | PlanningTodo
  | PlanningEvent
  | PlanningGroup
  | PlanningTag
  | PlanningReminder;

export interface PlanningOpResult {
  entity?: PlanningEntity;
  deletedId?: string;
  state: PlanningState;
  now: number;
}

/** 发一个 op。返回**整份最新快照** —— 联动（提醒随 dueAt 走、标签被删后从 Todo 上消失）需要它。 */
export function runPlanningOp(op: PlanningOp): Promise<PlanningOpResult> {
  return request<PlanningOpResult>("/api/planning", { method: "POST", body: JSON.stringify(op) });
}

export interface StartTodoAgentResult {
  sessionId: string;
  cwd: string;
  todo: PlanningTodo;
}

/** 从一条 Todo 发起 Agent 对话。消息通道复用既有的 `/api/agent`，这里只做前置校验与关联。 */
export function startTodoAgent(todoId: string, cwd: string, expectedUpdatedAt?: number): Promise<StartTodoAgentResult> {
  return request<StartTodoAgentResult>("/api/planning/todo-agent", {
    method: "POST",
    body: JSON.stringify({ todoId, cwd, ...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }) }),
  });
}
