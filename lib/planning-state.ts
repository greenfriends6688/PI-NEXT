/**
 * fork:proma-44-planning — 五类数据的**纯逻辑**层（无 fs、无 React、无时钟）。
 *
 * 这一层是整个工作区唯一会改数据的地方，理由和 Proma 的 `planning-manager.ts`
 * 一样：落盘、UI、提醒调度三处各自拼一份「增删改」的规则，三个月后必然对不上。
 * 所以这里是纯函数 —— 输入 `PlanningState` + 输入 + `now`，输出新的 `PlanningState`；
 * 副作用（写文件、计时器、请求）全在外面。
 *
 * 三条不变量在这里锁死，都有单测：
 *
 * 1. **解析失败 fail-soft**。`normalizePlanningState()` 遇到不认识 / 半截的 JSON 一律
 *    丢成空集合而不是抛错：数据文件被手改坏时，界面要能打开（空列表），而不是
 *    整个工作区 500。唯一被拒的是「顶层不是对象」。
 * 2. **引用不悬空**。删分组 / 删标签 / 删提醒会就地清掉指向它的 id，不留幽灵引用
 *    （`id` 不存在时读侧只是接不上，但留着会让「按标签过滤」永远为空且无法解释）。
 * 3. **版本冲突显式拒绝**。`expectedUpdatedAt` 不匹配时抛 `PlanningConflictError`，
 *    由路由转 409 —— 静默覆盖会让「另一个面板正在编辑的标题」凭空消失。
 */

import { randomUUID } from "node:crypto";
import {
  PLANNING_CONFLICT_MESSAGE,
  PLANNING_STORE_VERSION,
  type PlanningEvent,
  type PlanningGroup,
  type PlanningGroupScope,
  type PlanningReminder,
  type PlanningReminderOrigin,
  type PlanningReminderTargetType,
  type PlanningState,
  type PlanningTag,
  type PlanningTodo,
  type TodoPriority,
  type TodoSessionLink,
  type TodoStatus,
} from "./planning-types";

export class PlanningConflictError extends Error {
  constructor(message = PLANNING_CONFLICT_MESSAGE) {
    super(message);
    this.name = "PlanningConflictError";
  }
}

export class PlanningInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanningInputError";
  }
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function optStr(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) if (typeof entry === "string" && entry) out.push(entry);
  return out;
}

function priorityOf(value: unknown): TodoPriority {
  return value === "low" || value === "high" ? value : "medium";
}

function statusOf(value: unknown): TodoStatus {
  return value === "completed" ? "completed" : "open";
}

function scopeOf(value: unknown): PlanningGroupScope {
  return value === "calendar" ? "calendar" : "todo";
}

function reminderTargetOf(value: unknown): PlanningReminderTargetType {
  return value === "calendar_event" ? "calendar_event" : "todo";
}

function reminderStatusOf(value: unknown): PlanningReminder["status"] {
  return value === "acknowledged" || value === "completed" ? value : "pending";
}

function reminderOriginOf(value: unknown): PlanningReminderOrigin {
  return value === "todo_due_at" ? "todo_due_at" : "manual";
}

function sessionLinksOf(value: unknown): TodoSessionLink[] {
  if (!Array.isArray(value)) return [];
  const bySession = new Map<string, TodoSessionLink>();
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const sessionId = str(entry.sessionId);
    if (!sessionId) continue;
    const first = num(entry.firstTouchedAt) ?? 0;
    const last = num(entry.lastTouchedAt) ?? first;
    const existing = bySession.get(sessionId);
    if (existing) {
      existing.firstTouchedAt = Math.min(existing.firstTouchedAt, first);
      existing.lastTouchedAt = Math.max(existing.lastTouchedAt, last);
      continue;
    }
    bySession.set(sessionId, { sessionId, firstTouchedAt: first, lastTouchedAt: last });
  }
  return [...bySession.values()];
}

function toTodo(raw: unknown): PlanningTodo | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const createdAt = num(raw.createdAt) ?? 0;
  return {
    id,
    title: str(raw.title),
    notes: optStr(raw.notes),
    status: statusOf(raw.status),
    priority: priorityOf(raw.priority),
    dueAt: num(raw.dueAt),
    groupId: optStr(raw.groupId),
    tagIds: strList(raw.tagIds),
    reminderIds: strList(raw.reminderIds),
    sessionLinks: sessionLinksOf(raw.sessionLinks),
    workspaceCwd: optStr(raw.workspaceCwd),
    createdAt,
    updatedAt: num(raw.updatedAt) ?? createdAt,
    completedAt: num(raw.completedAt),
  };
}

function toEvent(raw: unknown): PlanningEvent | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const createdAt = num(raw.createdAt) ?? 0;
  const startAt = num(raw.startAt);
  if (startAt === undefined) return null;
  return {
    id,
    title: str(raw.title),
    notes: optStr(raw.notes),
    startAt,
    endAt: num(raw.endAt),
    allDay: raw.allDay === true,
    groupId: optStr(raw.groupId),
    tagIds: strList(raw.tagIds),
    reminderIds: strList(raw.reminderIds),
    todoId: optStr(raw.todoId),
    workspaceCwd: optStr(raw.workspaceCwd),
    createdAt,
    updatedAt: num(raw.updatedAt) ?? createdAt,
  };
}

function toGroup(raw: unknown): PlanningGroup | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const createdAt = num(raw.createdAt) ?? 0;
  return {
    id,
    scope: scopeOf(raw.scope),
    name: str(raw.name),
    sortOrder: num(raw.sortOrder) ?? 0,
    createdAt,
    updatedAt: num(raw.updatedAt) ?? createdAt,
  };
}

function toTag(raw: unknown): PlanningTag | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  if (!id) return null;
  const createdAt = num(raw.createdAt) ?? 0;
  return {
    id,
    name: str(raw.name),
    createdAt,
    updatedAt: num(raw.updatedAt) ?? createdAt,
  };
}

function toReminder(raw: unknown): PlanningReminder | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const targetId = str(raw.targetId);
  if (!id || !targetId) return null;
  const triggerAt = num(raw.triggerAt);
  if (triggerAt === undefined) return null;
  const createdAt = num(raw.createdAt) ?? 0;
  return {
    id,
    targetType: reminderTargetOf(raw.targetType),
    targetId,
    triggerAt,
    snoozedUntil: num(raw.snoozedUntil),
    status: reminderStatusOf(raw.status),
    origin: reminderOriginOf(raw.origin),
    acknowledgedAt: num(raw.acknowledgedAt),
    lastNotifiedAt: num(raw.lastNotifiedAt),
    createdAt,
    updatedAt: num(raw.updatedAt) ?? createdAt,
  };
}

export function emptyPlanningState(): PlanningState {
  return {
    version: PLANNING_STORE_VERSION,
    todos: [],
    events: [],
    groups: [],
    tags: [],
    reminders: [],
  };
}

/**
 * 把磁盘上的任意 JSON 收敛成一个可用的 `PlanningState`。
 * 顶层不是对象 = 文件根本不是我们的（fail-closed，报错让路由回 500）；
 * 里面的残缺条目 = 逐条丢弃（fail-soft，界面照常打开）。
 */
export function normalizePlanningState(raw: unknown): PlanningState {
  if (!isRecord(raw)) return emptyPlanningState();
  const state = emptyPlanningState();
  state.todos = (Array.isArray(raw.todos) ? raw.todos : []).map(toTodo).filter((v): v is PlanningTodo => v !== null);
  state.events = (Array.isArray(raw.events) ? raw.events : []).map(toEvent).filter((v): v is PlanningEvent => v !== null);
  state.groups = (Array.isArray(raw.groups) ? raw.groups : []).map(toGroup).filter((v): v is PlanningGroup => v !== null);
  state.tags = (Array.isArray(raw.tags) ? raw.tags : []).map(toTag).filter((v): v is PlanningTag => v !== null);
  state.reminders = (Array.isArray(raw.reminders) ? raw.reminders : []).map(toReminder).filter((v): v is PlanningReminder => v !== null);
  return dropDanglingReferences(state);
}

/** 丢掉指向不存在实体的引用（手改文件 / 早期版本遗留都会产生这种）。 */
function dropDanglingReferences(state: PlanningState): PlanningState {
  const todoIds = new Set(state.todos.map((todo) => todo.id));
  const eventIds = new Set(state.events.map((todo) => todo.id));
  const groupIds = new Set(state.groups.map((group) => group.id));
  const tagIds = new Set(state.tags.map((tag) => tag.id));

  const targetExists = (reminder: PlanningReminder) =>
    reminder.targetType === "todo" ? todoIds.has(reminder.targetId) : eventIds.has(reminder.targetId);
  const reminders = state.reminders.filter(targetExists);
  const reminderIds = new Set(reminders.map((reminder) => reminder.id));

  return {
    version: PLANNING_STORE_VERSION,
    todos: state.todos.map((todo) => ({
      ...todo,
      groupId: todo.groupId && groupIds.has(todo.groupId) ? todo.groupId : undefined,
      tagIds: todo.tagIds.filter((id) => tagIds.has(id)),
      reminderIds: todo.reminderIds.filter((id) => reminderIds.has(id)),
    })),
    events: state.events.map((event) => ({
      ...event,
      groupId: event.groupId && groupIds.has(event.groupId) ? event.groupId : undefined,
      tagIds: event.tagIds.filter((id) => tagIds.has(id)),
      reminderIds: event.reminderIds.filter((id) => reminderIds.has(id)),
      todoId: event.todoId && todoIds.has(event.todoId) ? event.todoId : undefined,
    })),
    groups: state.groups,
    tags: state.tags,
    reminders,
  };
}

// ---------------------------------------------------------------------------
// 提醒：目标侧的联动
// ---------------------------------------------------------------------------

function addReminder(
  state: PlanningState,
  target: { type: PlanningReminderTargetType; id: string },
  triggerAt: number,
  origin: PlanningReminderOrigin,
  now: number,
): PlanningReminder {
  const reminder: PlanningReminder = {
    id: randomUUID(),
    targetType: target.type,
    targetId: target.id,
    triggerAt,
    status: "pending",
    origin,
    createdAt: now,
    updatedAt: now,
  };
  state.reminders.push(reminder);
  return reminder;
}

/** 完成 Todo 时把它名下还没确认的提醒一起收掉，否则会为一件做完的事继续弹窗。 */
function completeRemindersFor(state: PlanningState, targetType: PlanningReminderTargetType, targetId: string, now: number): void {
  for (const reminder of state.reminders) {
    if (reminder.targetType !== targetType || reminder.targetId !== targetId) continue;
    if (reminder.status !== "pending") continue;
    reminder.status = "completed";
    reminder.updatedAt = now;
  }
}

/**
 * 让「由计划时间自动生成」的那条提醒跟着 `dueAt` 走。
 *
 * 照 Proma 的 `syncTodoDueAtReminder` 的形状：先删掉多余的自动提醒，再**复用**一条
 * 可移动的（pending 且未被稍后推迟的），没有就新建。复用而不是删了重建，是为了让
 * 提醒 id 稳定 —— 前端的提醒条已经把它当 key 了。
 *
 * `lastNotifiedAt` 必须清空：挪到将来的时间不该让「已经响过」的状态跟着搬过去。
 *
 * 判「要不要新建」只看**自动**提醒的 pending 状态，不看手动提醒。Proma 那里写的是
 * 「有任何 pending 提醒就不建」，于是「建一条带计划时间、同时手动加了提醒的任务」
 * 永远拿不到它的到点提醒 —— 那是一条用户明确排了时间、却永远不会响的任务。
 */
function syncTodoDueReminder(state: PlanningState, todoId: string, dueAt: number | undefined, now: number): void {
  const todo = state.todos.find((item) => item.id === todoId);
  if (!todo) return;
  // 任务已完成：不排新的到点提醒。`completeRemindersFor()` 已经把它们收成 completed，
  // 这里再补一条 pending 等于「刚做完就又响一次」。
  if (todo.status === "completed") return;
  const auto = state.reminders.filter(
    (reminder) => reminder.origin === "todo_due_at" && reminder.targetType === "todo" && reminder.targetId === todoId,
  );
  // 计划时间被清掉 = 没有到点提醒这回事，全部自动提醒（包括刚才那条可移动的）都删。
  const movable = dueAt === undefined
    ? undefined
    : auto.find((reminder) => reminder.status === "pending" && reminder.snoozedUntil === undefined);
  const doomed = auto.filter((reminder) => reminder.id !== movable?.id);
  if (doomed.length > 0) {
    const doomedIds = new Set(doomed.map((reminder) => reminder.id));
    state.reminders = state.reminders.filter((reminder) => !doomedIds.has(reminder.id));
    todo.reminderIds = todo.reminderIds.filter((id) => !doomedIds.has(id));
  }
  if (dueAt === undefined) return;
  if (movable) {
    if (movable.triggerAt === dueAt && movable.lastNotifiedAt === undefined) return;
    movable.triggerAt = dueAt;
    movable.lastNotifiedAt = undefined;
    movable.updatedAt = now;
    return;
  }
  if (auto.some((reminder) => reminder.status === "pending")) return;
  const reminder = addReminder(state, { type: "todo", id: todoId }, dueAt, "todo_due_at", now);
  todo.reminderIds.push(reminder.id);
}

function assertVersion(entity: { updatedAt: number }, expectedUpdatedAt: number | undefined): void {
  if (expectedUpdatedAt === undefined) return;
  if (entity.updatedAt !== expectedUpdatedAt) throw new PlanningConflictError();
}

function findTodo(state: PlanningState, id: string): PlanningTodo {
  const todo = state.todos.find((item) => item.id === id);
  if (!todo) throw new PlanningInputError(`Todo not found: ${id}`);
  return todo;
}

function findEvent(state: PlanningState, id: string): PlanningEvent {
  const event = state.events.find((item) => item.id === id);
  if (!event) throw new PlanningInputError(`Event not found: ${id}`);
  return event;
}

// ---------------------------------------------------------------------------
// Todo
// ---------------------------------------------------------------------------

export interface CreateTodoInput {
  title: string;
  notes?: string;
  priority?: TodoPriority;
  dueAt?: number;
  groupId?: string;
  tagIds?: string[];
  /** 手动提醒的触发时刻；计划时间那条由本层自己建。 */
  reminderAt?: number[];
  workspaceCwd?: string;
}

export function createTodo(state: PlanningState, input: CreateTodoInput, now: number): PlanningTodo {
  const title = input.title.trim();
  if (!title) throw new PlanningInputError("title is required");
  const todo: PlanningTodo = {
    id: randomUUID(),
    title,
    notes: input.notes,
    status: "open",
    priority: input.priority ?? "medium",
    dueAt: input.dueAt,
    groupId: input.groupId,
    tagIds: [...new Set(input.tagIds ?? [])],
    reminderIds: [],
    sessionLinks: [],
    workspaceCwd: input.workspaceCwd,
    createdAt: now,
    updatedAt: now,
  };
  state.todos.push(todo);
  for (const triggerAt of input.reminderAt ?? []) {
    if (!Number.isFinite(triggerAt)) continue;
    todo.reminderIds.push(addReminder(state, { type: "todo", id: todo.id }, triggerAt, "manual", now).id);
  }
  syncTodoDueReminder(state, todo.id, todo.dueAt, now);
  return todo;
}

export interface UpdateTodoInput {
  id: string;
  title?: string;
  /** 空串 = 清空描述；`undefined` = 不动。 */
  notes?: string;
  status?: TodoStatus;
  priority?: TodoPriority;
  dueAt?: number | null;
  groupId?: string | null;
  tagIds?: string[];
  workspaceCwd?: string | null;
  expectedUpdatedAt?: number;
}

export function updateTodo(state: PlanningState, input: UpdateTodoInput, now: number): PlanningTodo {
  const todo = findTodo(state, input.id);
  assertVersion(todo, input.expectedUpdatedAt);
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new PlanningInputError("title must not be empty");
    todo.title = title;
  }
  if (input.notes !== undefined) {
    // 原样保存，不 trim：描述的缩进与首尾换行是内容的一部分（Markdown 代码块）。
    todo.notes = input.notes ? input.notes : undefined;
  }
  if (input.status !== undefined) todo.status = input.status;
  if (input.priority !== undefined) todo.priority = input.priority;
  if (input.dueAt !== undefined) todo.dueAt = input.dueAt ?? undefined;
  if (input.groupId !== undefined) todo.groupId = input.groupId ?? undefined;
  if (input.tagIds !== undefined) todo.tagIds = [...new Set(input.tagIds)];
  if (input.workspaceCwd !== undefined) todo.workspaceCwd = input.workspaceCwd ?? undefined;
  if (input.status === "completed") {
    todo.completedAt = todo.completedAt ?? now;
    completeRemindersFor(state, "todo", todo.id, now);
  } else if (input.status === "open") {
    todo.completedAt = undefined;
  }
  todo.updatedAt = now;
  // 放最后：它要读 todo.dueAt，也要写 todo.reminderIds。
  syncTodoDueReminder(state, todo.id, todo.dueAt, now);
  return todo;
}

export function deleteTodo(state: PlanningState, id: string): void {
  state.todos = state.todos.filter((todo) => todo.id !== id);
  completeRemindersFor(state, "todo", id, 0);
  state.reminders = state.reminders.filter((reminder) => !(reminder.targetType === "todo" && reminder.targetId === id));
}

/** 记一次「Agent 在这条 Todo 上起了会话」，按 sessionId 去重。 */
export function linkTodoSession(state: PlanningState, todoId: string, sessionId: string, now: number): PlanningTodo {
  const todo = findTodo(state, todoId);
  const existing = todo.sessionLinks.find((link) => link.sessionId === sessionId);
  if (existing) {
    existing.lastTouchedAt = now;
  } else {
    todo.sessionLinks.push({ sessionId, firstTouchedAt: now, lastTouchedAt: now });
  }
  todo.updatedAt = now;
  return todo;
}

// ---------------------------------------------------------------------------
// 日程
// ---------------------------------------------------------------------------

export interface CreateEventInput {
  title: string;
  notes?: string;
  startAt: number;
  endAt?: number;
  allDay?: boolean;
  groupId?: string;
  tagIds?: string[];
  reminderAt?: number[];
  todoId?: string;
  workspaceCwd?: string;
}

export function createEvent(state: PlanningState, input: CreateEventInput, now: number): PlanningEvent {
  const title = input.title.trim();
  if (!title) throw new PlanningInputError("title is required");
  if (!Number.isFinite(input.startAt)) throw new PlanningInputError("startAt must be a timestamp");
  const event: PlanningEvent = {
    id: randomUUID(),
    title,
    notes: input.notes,
    startAt: input.startAt,
    endAt: input.endAt && input.endAt > input.startAt ? input.endAt : undefined,
    allDay: input.allDay === true,
    groupId: input.groupId,
    tagIds: [...new Set(input.tagIds ?? [])],
    reminderIds: [],
    todoId: input.todoId,
    workspaceCwd: input.workspaceCwd,
    createdAt: now,
    updatedAt: now,
  };
  state.events.push(event);
  for (const triggerAt of input.reminderAt ?? []) {
    if (!Number.isFinite(triggerAt)) continue;
    event.reminderIds.push(addReminder(state, { type: "calendar_event", id: event.id }, triggerAt, "manual", now).id);
  }
  return event;
}

export interface UpdateEventInput {
  id: string;
  title?: string;
  notes?: string;
  startAt?: number;
  endAt?: number | null;
  allDay?: boolean;
  groupId?: string | null;
  tagIds?: string[];
  todoId?: string | null;
  expectedUpdatedAt?: number;
}

export function updateEvent(state: PlanningState, input: UpdateEventInput, now: number): PlanningEvent {
  const event = findEvent(state, input.id);
  assertVersion(event, input.expectedUpdatedAt);
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) throw new PlanningInputError("title must not be empty");
    event.title = title;
  }
  if (input.notes !== undefined) event.notes = input.notes ? input.notes : undefined;
  if (input.startAt !== undefined) {
    if (!Number.isFinite(input.startAt)) throw new PlanningInputError("startAt must be a timestamp");
    event.startAt = input.startAt;
  }
  if (input.endAt !== undefined) event.endAt = input.endAt ?? undefined;
  if (event.endAt !== undefined && event.endAt <= event.startAt) event.endAt = undefined;
  if (input.allDay !== undefined) event.allDay = input.allDay;
  if (input.groupId !== undefined) event.groupId = input.groupId ?? undefined;
  if (input.tagIds !== undefined) event.tagIds = [...new Set(input.tagIds)];
  if (input.todoId !== undefined) event.todoId = input.todoId ?? undefined;
  event.updatedAt = now;
  return event;
}

export function deleteEvent(state: PlanningState, id: string): void {
  state.events = state.events.filter((event) => event.id !== id);
  state.reminders = state.reminders.filter((reminder) => !(reminder.targetType === "calendar_event" && reminder.targetId === id));
}

// ---------------------------------------------------------------------------
// 分组 / 标签
// ---------------------------------------------------------------------------

/** 同名分组在同一 scope 下不重复（区分大小写不敏感），与 Proma 的唯一约束一致。 */
function groupNameTaken(state: PlanningState, scope: PlanningGroupScope, name: string, exceptId?: string): boolean {
  const wanted = name.trim().toLowerCase();
  return state.groups.some((group) => group.id !== exceptId && group.scope === scope && group.name.trim().toLowerCase() === wanted);
}

export function createGroup(
  state: PlanningState,
  input: { scope: PlanningGroupScope; name: string; sortOrder?: number },
  now: number,
): PlanningGroup {
  const name = input.name.trim();
  if (!name) throw new PlanningInputError("group name is required");
  if (groupNameTaken(state, input.scope, name)) throw new PlanningInputError("group name already exists");
  const group: PlanningGroup = {
    id: randomUUID(),
    scope: input.scope,
    name,
    sortOrder: input.sortOrder ?? state.groups.filter((g) => g.scope === input.scope).length,
    createdAt: now,
    updatedAt: now,
  };
  state.groups.push(group);
  return group;
}

export function updateGroup(
  state: PlanningState,
  input: { id: string; name?: string; sortOrder?: number },
  now: number,
): PlanningGroup {
  const group = state.groups.find((item) => item.id === input.id);
  if (!group) throw new PlanningInputError("Group not found");
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new PlanningInputError("group name is required");
    if (groupNameTaken(state, group.scope, name, group.id)) throw new PlanningInputError("group name already exists");
    group.name = name;
  }
  if (input.sortOrder !== undefined) group.sortOrder = input.sortOrder;
  group.updatedAt = now;
  return group;
}

export function deleteGroup(state: PlanningState, id: string): void {
  state.groups = state.groups.filter((group) => group.id !== id);
  for (const todo of state.todos) if (todo.groupId === id) todo.groupId = undefined;
  for (const event of state.events) if (event.groupId === id) event.groupId = undefined;
}

function tagNameTaken(state: PlanningState, name: string, exceptId?: string): boolean {
  const wanted = name.trim().toLowerCase();
  return state.tags.some((tag) => tag.id !== exceptId && tag.name.trim().toLowerCase() === wanted);
}

export function createTag(state: PlanningState, input: { name: string }, now: number): PlanningTag {
  const name = input.name.replace(/^#/, "").trim();
  if (!name) throw new PlanningInputError("tag name is required");
  if (tagNameTaken(state, name)) throw new PlanningInputError("tag name already exists");
  const tag: PlanningTag = { id: randomUUID(), name, createdAt: now, updatedAt: now };
  state.tags.push(tag);
  return tag;
}

export function renameTag(state: PlanningState, input: { id: string; name: string }, now: number): PlanningTag {
  const tag = state.tags.find((item) => item.id === input.id);
  if (!tag) throw new PlanningInputError("Tag not found");
  const name = input.name.replace(/^#/, "").trim();
  if (!name) throw new PlanningInputError("tag name is required");
  if (tagNameTaken(state, name, tag.id)) throw new PlanningInputError("tag name already exists");
  tag.name = name;
  tag.updatedAt = now;
  return tag;
}

export function deleteTag(state: PlanningState, id: string): void {
  state.tags = state.tags.filter((tag) => tag.id !== id);
  for (const todo of state.todos) todo.tagIds = todo.tagIds.filter((tagId) => tagId !== id);
  for (const event of state.events) event.tagIds = event.tagIds.filter((tagId) => tagId !== id);
}

// ---------------------------------------------------------------------------
// 提醒
// ---------------------------------------------------------------------------

export function createReminder(
  state: PlanningState,
  input: { targetType: PlanningReminderTargetType; targetId: string; triggerAt: number },
  now: number,
): PlanningReminder {
  if (!Number.isFinite(input.triggerAt)) throw new PlanningInputError("triggerAt must be a timestamp");
  const exists = input.targetType === "todo"
    ? state.todos.some((todo) => todo.id === input.targetId)
    : state.events.some((event) => event.id === input.targetId);
  if (!exists) throw new PlanningInputError("reminder target not found");
  const reminder = addReminder(state, { type: input.targetType, id: input.targetId }, input.triggerAt, "manual", now);
  if (input.targetType === "todo") {
    const todo = findTodo(state, input.targetId);
    todo.reminderIds.push(reminder.id);
    todo.updatedAt = now;
  } else {
    const event = findEvent(state, input.targetId);
    event.reminderIds.push(reminder.id);
    event.updatedAt = now;
  }
  return reminder;
}

export function deleteReminder(state: PlanningState, id: string): void {
  const reminder = state.reminders.find((item) => item.id === id);
  if (!reminder) return;
  state.reminders = state.reminders.filter((item) => item.id !== id);
  for (const todo of state.todos) if (todo.reminderIds.includes(id)) todo.reminderIds = todo.reminderIds.filter((x) => x !== id);
  for (const event of state.events) if (event.reminderIds.includes(id)) event.reminderIds = event.reminderIds.filter((x) => x !== id);
}

/** 确认提醒：不再显示，也不删（用户可能想回看「我什么时候被提醒过」）。 */
export function acknowledgeReminder(state: PlanningState, id: string, now: number): PlanningReminder {
  const reminder = state.reminders.find((item) => item.id === id);
  if (!reminder) throw new PlanningInputError("Reminder not found");
  if (reminder.status === "pending") {
    reminder.status = "acknowledged";
    reminder.acknowledgedAt = now;
    reminder.updatedAt = now;
  }
  return reminder;
}

export function snoozeReminder(state: PlanningState, id: string, minutes: number, now: number): PlanningReminder {
  const reminder = state.reminders.find((item) => item.id === id);
  if (!reminder) throw new PlanningInputError("Reminder not found");
  if (!Number.isFinite(minutes) || minutes <= 0) throw new PlanningInputError("minutes must be positive");
  reminder.snoozedUntil = now + minutes * 60_000;
  reminder.status = "pending";
  reminder.acknowledgedAt = undefined;
  // 已经响过的提醒被推迟到将来，必须允许它再响一次。
  reminder.lastNotifiedAt = undefined;
  reminder.updatedAt = now;
  return reminder;
}

/** 调度器专用：记下「这一条已经通知过了」，避免下一轮 tick 重复弹。 */
export function markReminderNotified(state: PlanningState, id: string, now: number): PlanningReminder {
  const reminder = state.reminders.find((item) => item.id === id);
  if (!reminder) throw new PlanningInputError("Reminder not found");
  reminder.lastNotifiedAt = now;
  reminder.updatedAt = now;
  return reminder;
}
