/**
 * fork:proma-44-planning —— 前端读侧：把五类平铺数据接成视图模型。
 *
 * 存的是 `groupId` / `tagIds` / `reminderIds`（见 `planning-types.ts` 里为什么），
 * 所以「一条 Todo 带它的分组、标签、提醒」这件事必须在这里接一次。放在读侧而不是
 * 写侧的理由：写侧一存就把同一份 group 对象复制到 N 条 Todo 上，改一次分组名要
 * 重写 N 处，漏一处就出现两个同名分组。
 *
 * 本模块**不引 React、不碰网络**，所以列表过滤、排序、视图分组都能单测。
 */

import { addLocalDays, isSameLocalDay, itemsOnDay, startOfLocalDay } from "./planning-calendar";
import type {
  PlanningEvent,
  PlanningGroup,
  PlanningReminder,
  PlanningState,
  PlanningTag,
  PlanningTodo,
} from "./planning-types";

export interface PlanningTodoView extends PlanningTodo {
  group?: PlanningGroup;
  tags: PlanningTag[];
  reminders: PlanningReminder[];
}

export interface PlanningEventView extends PlanningEvent {
  group?: PlanningGroup;
  tags: PlanningTag[];
  reminders: PlanningReminder[];
}

function indexById<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

export function groupById(state: PlanningState): Map<string, PlanningGroup> {
  return indexById(state.groups);
}

export function tagById(state: PlanningState): Map<string, PlanningTag> {
  return indexById(state.tags);
}

export function reminderById(state: PlanningState): Map<string, PlanningReminder> {
  return indexById(state.reminders);
}

export function toTodoView(todo: PlanningTodo, state: PlanningState): PlanningTodoView {
  const groups = groupById(state);
  const tags = tagById(state);
  const reminders = reminderById(state);
  return {
    ...todo,
    group: todo.groupId ? groups.get(todo.groupId) : undefined,
    tags: todo.tagIds.map((id) => tags.get(id)).filter((tag): tag is PlanningTag => tag !== undefined),
    reminders: todo.reminderIds
      .map((id) => reminders.get(id))
      .filter((reminder): reminder is PlanningReminder => reminder !== undefined)
      .sort((a, b) => (a.snoozedUntil ?? a.triggerAt) - (b.snoozedUntil ?? b.triggerAt)),
  };
}

export function toEventView(event: PlanningEvent, state: PlanningState): PlanningEventView {
  const groups = groupById(state);
  const tags = tagById(state);
  const reminders = reminderById(state);
  return {
    ...event,
    group: event.groupId ? groups.get(event.groupId) : undefined,
    tags: event.tagIds.map((id) => tags.get(id)).filter((tag): tag is PlanningTag => tag !== undefined),
    reminders: event.reminderIds
      .map((id) => reminders.get(id))
      .filter((reminder): reminder is PlanningReminder => reminder !== undefined)
      .sort((a, b) => (a.snoozedUntil ?? a.triggerAt) - (b.snoozedUntil ?? b.triggerAt)),
  };
}

// ---------------------------------------------------------------------------
// 列表过滤与排序
// ---------------------------------------------------------------------------

export type TodoFilterStatus = "all" | "open" | "completed";
export type TodoViewFilter = "all" | "today" | "overdue" | `group:${string}` | `tag:${string}`;

export interface TodoListOptions {
  status?: TodoFilterStatus;
  view?: TodoViewFilter;
  now: number;
}

/**
 * 排序：**未完成在前，按计划时间升序、无计划时间的沉底；已完成在后，按完成时间倒序。**
 *
 * 「无计划时间沉底」而不是排在最前：一份没有 due 的任务是「不着急」，不是
 * 「最着急」。完成的那一档按完成时间倒序，于是刚做完的留在列表头，方便改主意。
 */
export function sortTodos(todos: readonly PlanningTodo[]): PlanningTodo[] {
  const open = todos.filter((todo) => todo.status === "open");
  const done = todos.filter((todo) => todo.status === "completed");
  open.sort((a, b) => {
    if (a.dueAt === undefined && b.dueAt === undefined) return b.createdAt - a.createdAt;
    if (a.dueAt === undefined) return 1;
    if (b.dueAt === undefined) return -1;
    return a.dueAt - b.dueAt || b.createdAt - a.createdAt;
  });
  done.sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt));
  return [...open, ...done];
}

export function filterTodos(todos: readonly PlanningTodo[], options: TodoListOptions): PlanningTodo[] {
  const view = options.view ?? "all";
  const status = options.status ?? "all";
  const todayStart = startOfLocalDay(options.now);
  return todos.filter((todo) => {
    if (status !== "all" && todo.status !== status) return false;
    if (view === "all") return true;
    if (view === "today") return todo.status === "open" && todo.dueAt !== undefined && isSameLocalDay(todo.dueAt, options.now);
    if (view === "overdue") return todo.status === "open" && todo.dueAt !== undefined && todo.dueAt < todayStart;
    if (view.startsWith("group:")) return todo.groupId === view.slice("group:".length);
    if (view.startsWith("tag:")) return todo.tagIds.includes(view.slice("tag:".length));
    return true;
  });
}

export function visibleTodos(state: PlanningState, options: TodoListOptions): PlanningTodoView[] {
  return sortTodos(filterTodos(state.todos, options)).map((todo) => toTodoView(todo, state));
}

/**
 * 取与 `[from, to)` 有交集的日程。
 *
 * 逐日判定走 `itemsOnDay`（内部用 `addLocalDays`，夏令时切换日也正确），
 * 而不是「`startAt < to && end >= from`」一刀切 —— 那样会把「昨天 22:00 到今天
 * 02:00」在月视图里整条丢掉。跨天日程会在多天各命中一次，按 id 去重。
 */
export function visibleEvents(state: PlanningState, range: { from: number; to: number }): PlanningEventView[] {
  const candidates = state.events
    .filter((event) => event.startAt < range.to && (event.endAt ?? event.startAt) >= range.from)
    .slice()
    .sort((a, b) => a.startAt - b.startAt)
    .map((event) => toEventView(event, state));
  const hit = new Set<string>();
  for (let day = startOfLocalDay(range.from); day < range.to; day = addLocalDays(day, 1)) {
    for (const event of itemsOnDay(candidates, day)) hit.add(event.id);
  }
  return candidates.filter((event) => hit.has(event.id));
}

/** 分组列表项：未分组永远排最后（它不是一类，是缺省）。 */
export function todoGroupBuckets(state: PlanningState): Array<{ group?: PlanningGroup; todos: PlanningTodo[] }> {
  const buckets = new Map<string, PlanningTodo[]>();
  for (const group of state.groups.filter((item) => item.scope === "todo").sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
    buckets.set(group.id, []);
  }
  const loose: PlanningTodo[] = [];
  for (const todo of state.todos) {
    if (todo.groupId && buckets.has(todo.groupId)) buckets.get(todo.groupId)!.push(todo);
    else loose.push(todo);
  }
  const out: Array<{ group?: PlanningGroup; todos: PlanningTodo[] }> = [];
  for (const [id, todos] of buckets) {
    out.push({ group: state.groups.find((group) => group.id === id), todos });
  }
  if (loose.length > 0) out.push({ todos: loose });
  return out;
}

export function countOpenTodos(state: PlanningState): number {
  return state.todos.reduce((sum, todo) => (todo.status === "open" ? sum + 1 : sum), 0);
}
