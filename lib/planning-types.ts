/**
 * fork:proma-44-planning — 本地 Todo / 日程工作区的数据模型（五类）。
 *
 * 与 Proma 的差异（有意为之，写在这里免得后面有人「补回去」）：
 *
 * - **关系存 id 数组，不存嵌套对象**。Proma 走 SQLite，todo 上挂着 group / tags /
 *   reminders 三张联表结果；这里是单个 JSON 文件，读出来就是内存里的纯对象，
 *   嵌套副本意味着「一次保存要同时改三处数组、任何一处漏改就产生幽灵引用」。
 *   关联一律存 `groupId` / `tagIds` / `reminderIds`，由 `planning-view.ts` 在读侧接上。
 * - **不带 `color`**。Proma 的分组 / 标签有取色器；本仓设计系统没有调色板这一档，
 *   加一个只能填十六进色的输入框是纯负担。分组与标签用中性芯片 + 文字区分。
 * - **不带 `nativeOrigin` / `workspaceId` 之外的原生同步字段**。macOS EventKit 双向同步
 *   明确不做（原生模块 + 冲突解决，成本远超收益），详见 docs/patches/0004-planning.md。
 * - **事件也存本地时间戳（毫秒）**，`allDay` 只是一个渲染标记。跨时区日程同步不在
 *   范围内，所以不做 UTC 归一化：`allDay` 项的 startAt 取本地当天 0 点。
 *
 * 所有时间戳都是 `Date.now()` 形状的毫秒数，且**所有函数都接收注入的 `now`**，
 * 测试因此不需要真的等 800ms。
 */

export type TodoStatus = "open" | "completed";
export type TodoPriority = "low" | "medium" | "high";

/** Todo 与日程各自独立分组；同名分组允许分别存在。 */
export type PlanningGroupScope = "todo" | "calendar";

export type PlanningReminderTargetType = "todo" | "calendar_event";
export type PlanningReminderStatus = "pending" | "acknowledged" | "completed";
/** `todo_due_at` 标记「这条提醒由目标的计划时间自动生成」，改期时跟着一起挪。 */
export type PlanningReminderOrigin = "manual" | "todo_due_at";

export interface PlanningGroup {
  id: string;
  scope: PlanningGroupScope;
  name: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface PlanningTag {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlanningReminder {
  id: string;
  targetType: PlanningReminderTargetType;
  targetId: string;
  triggerAt: number;
  /** 稍后提醒时的新触发时刻；优先于 `triggerAt`。 */
  snoozedUntil?: number;
  status: PlanningReminderStatus;
  origin: PlanningReminderOrigin;
  acknowledgedAt?: number;
  /** 上一次真正通知的时刻；用来保证同一条提醒不反复弹。 */
  lastNotifiedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** 一个 Agent 会话与一条 Todo 的去重关联（不保存对话正文）。 */
export interface TodoSessionLink {
  sessionId: string;
  firstTouchedAt: number;
  lastTouchedAt: number;
}

export interface PlanningTodo {
  id: string;
  title: string;
  notes?: string;
  status: TodoStatus;
  priority: TodoPriority;
  dueAt?: number;
  groupId?: string;
  tagIds: string[];
  /** 指向 `PlanningReminder[]`；到期自动提醒也在这张表里。 */
  reminderIds: string[];
  sessionLinks: TodoSessionLink[];
  /** 发起 Agent 对话时使用的目录。 */
  workspaceCwd?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface PlanningEvent {
  id: string;
  title: string;
  notes?: string;
  startAt: number;
  endAt?: number;
  allDay: boolean;
  groupId?: string;
  tagIds: string[];
  reminderIds: string[];
  /** 由某条 Todo 排出来的日程（双向只做 Todo → Event 这一向）。 */
  todoId?: string;
  workspaceCwd?: string;
  createdAt: number;
  updatedAt: number;
}

export const PLANNING_STORE_VERSION = 1;

export interface PlanningState {
  version: number;
  todos: PlanningTodo[];
  events: PlanningEvent[];
  groups: PlanningGroup[];
  tags: PlanningTag[];
  reminders: PlanningReminder[];
}

/** 快照 + 服务端时间。`now` 让客户端不必自己校时，冲突判定也以服务端为准。 */
export interface PlanningSnapshot {
  state: PlanningState;
  now: number;
}

/** 会话内已有的 todo 工具之外另开的一个数据面；版本冲突文案与 Proma 同义。 */
export const PLANNING_CONFLICT_MESSAGE = "Todo was changed in another view. Reload and try again.";
