/**
 * fork:proma-44-planning —— `POST /api/planning` 的 op 判别式（**服务端一份**）。
 *
 * 客户端的 `PlanningOp` 在 `lib/planning-client.ts`，那里只是给 TS 用的类型；
 * 运行时能信的东西只有这一个 `isPlanningOp()`。它做三件事，逐个字段查：
 *
 * 1. `op` 是已知字符串 —— 未知 op 一律 400，不做「猜一个相近的」。
 * 2. 字符串字段是字符串、数值字段是**有限数**、数组是字符串数组。
 *    `NaN` / `Infinity` 从 JSON 解析不出来，但 `"dueAt": "123"`（字符串）能 ——
 *    那是往时间戳字段塞字符串的经典手法，直接放行会让 `isSameLocalDay` 拿到字符串。
 * 3. 数组长度有上限（64）。提醒加 64 条就够用了，上限防的是「一个失控的循环
 *    一次塞十万条把文件写爆」。
 *
 * **不复用客户端那份类型定义**是刻意的：把客户端模块 import 进路由会把
 * `lib/planning-client.ts` 拖进服务端依赖图（它没有副作用，但类型要手工同步两遍）。
 * 少一个真相来源比少一次类型检查值钱。
 */

import type { TodoPriority, TodoStatus } from "@/lib/planning-types";

const OPS = [
  "todo.create", "todo.update", "todo.delete",
  "event.create", "event.update", "event.delete",
  "group.create", "group.rename", "group.delete",
  "tag.create", "tag.rename", "tag.delete",
  "reminder.create", "reminder.delete", "reminder.acknowledge", "reminder.snooze",
] as const;

export type PlanningOpName = (typeof OPS)[number];

/** 每个 op 允许出现的键；不在表里的键直接丢掉（不报错，省得客户端一加字段就 400）。 */
const ALLOWED_KEYS: Record<PlanningOpName, readonly string[]> = {
  "todo.create": ["title", "notes", "priority", "dueAt", "groupId", "tagIds"],
  "todo.update": ["id", "title", "notes", "status", "priority", "dueAt", "groupId", "tagIds", "workspaceCwd", "expectedUpdatedAt"],
  "todo.delete": ["id"],
  "event.create": ["title", "notes", "startAt", "endAt", "allDay", "groupId", "tagIds", "todoId"],
  "event.update": ["id", "title", "notes", "startAt", "endAt", "allDay", "groupId", "tagIds", "todoId", "expectedUpdatedAt"],
  "event.delete": ["id"],
  "group.create": ["scope", "name"],
  "group.rename": ["id", "name"],
  "group.delete": ["id"],
  "tag.create": ["name"],
  "tag.rename": ["id", "name"],
  "tag.delete": ["id"],
  "reminder.create": ["targetType", "targetId", "triggerAt"],
  "reminder.delete": ["id"],
  "reminder.acknowledge": ["id"],
  "reminder.snooze": ["id", "minutes"],
};

/** 必填键。 */
const REQUIRED_KEYS: Record<PlanningOpName, readonly string[]> = {
  "todo.create": ["title"],
  "todo.update": ["id"],
  "todo.delete": ["id"],
  "event.create": ["title", "startAt"],
  "event.update": ["id"],
  "event.delete": ["id"],
  "group.create": ["scope", "name"],
  "group.rename": ["id", "name"],
  "group.delete": ["id"],
  "tag.create": ["name"],
  "tag.rename": ["id", "name"],
  "tag.delete": ["id"],
  "reminder.create": ["targetType", "targetId", "triggerAt"],
  "reminder.delete": ["id"],
  "reminder.acknowledge": ["id"],
  "reminder.snooze": ["id", "minutes"],
};

/**
 * 判别联合（服务端一份）。字段与 `lib/planning-client.ts` 的 `PlanningOp` 一一对应 ——
 * 两处要手工保持同步，改一处记得改另一处（`parsePlanningOp` 的运行时校验才是
 * 真正的关卡，这个类型只是让 `applyOp` 里不用写 30 个 `as string`）。
 */
export type PlanningOpInput =
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

const MAX_TAG_IDS = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** `undefined` / `null` 之外的值原样保留（`dueAt: null` 是「清掉计划时间」，有语义）。 */
function keepScalar(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === "string" || typeof value === "boolean" || isFiniteNumber(value)) return value;
  return undefined;
}

function keepStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .slice(0, MAX_TAG_IDS);
}

function isPriority(value: unknown): value is TodoPriority {
  return value === "low" || value === "medium" || value === "high";
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return value === "open" || value === "completed";
}

/**
 * 判定 + 清洗。返回 null 时路由回 400。
 *
 * 返回的是**新对象**（只含白名单里的键），不是原 body：多出来的键（客户端
 * 塞进来的调试字段、未来的扩展字段）不参与运算，也不会被 `JSON.stringify` 带走。
 */
export function parsePlanningOp(body: unknown): PlanningOpInput | null {
  if (!isRecord(body)) return null;
  const op = body.op;
  if (typeof op !== "string" || !(OPS as readonly string[]).includes(op)) return null;
  const name = op as PlanningOpName;

  const cleaned: Record<string, unknown> = { op: name };
  for (const key of ALLOWED_KEYS[name]) {
    if (key === "tagIds") continue;   // 数组单独处理（keepScalar 会把数组丢成 undefined）
    const value = keepScalar(body[key]);
    if (value !== undefined) cleaned[key] = value;
  }
  if (ALLOWED_KEYS[name].includes("tagIds")) cleaned.tagIds = keepStringList(body.tagIds) ?? [];
  if (cleaned.priority !== undefined && !isPriority(cleaned.priority)) return null;
  if (cleaned.status !== undefined && !isTodoStatus(cleaned.status)) return null;
  if (cleaned.scope !== undefined && cleaned.scope !== "todo" && cleaned.scope !== "calendar") return null;
  if (cleaned.targetType !== undefined && cleaned.targetType !== "todo" && cleaned.targetType !== "calendar_event") return null;
  if (cleaned.dueAt !== undefined && cleaned.dueAt !== null && !isFiniteNumber(cleaned.dueAt)) return null;
  if (cleaned.expectedUpdatedAt !== undefined && !isFiniteNumber(cleaned.expectedUpdatedAt)) return null;
  if (cleaned.startAt !== undefined && !isFiniteNumber(cleaned.startAt)) return null;
  if (cleaned.triggerAt !== undefined && !isFiniteNumber(cleaned.triggerAt)) return null;
  if (cleaned.minutes !== undefined && !isFiniteNumber(cleaned.minutes)) return null;

  for (const key of REQUIRED_KEYS[name]) {
    const value = cleaned[key];
    if (value === undefined || value === null) return null;
    if (typeof value === "string" && value.trim() === "") return null;
  }

  // 上面每一项都逐字段查过（类型 / 枚举 / 必填 / 白名单），所以这里的断言是
  // 「校验器与类型声明同步」的承诺，而不是绕过校验。改类型时记得同步 ALLOWED_KEYS。
  return cleaned as PlanningOpInput;
}
