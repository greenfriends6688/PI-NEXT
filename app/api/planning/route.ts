import { NextRequest, NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { mutatePlanningState, readPlanningState } from "@/lib/planning-store";
import {
  PlanningConflictError,
  PlanningInputError,
  acknowledgeReminder,
  createEvent,
  createGroup,
  createReminder,
  createTag,
  createTodo,
  deleteEvent,
  deleteGroup,
  deleteReminder,
  deleteTag,
  deleteTodo,
  renameTag,
  snoozeReminder,
  updateEvent,
  updateGroup,
  updateTodo,
} from "@/lib/planning-state";
import type { PlanningEvent, PlanningGroup, PlanningReminder, PlanningState, PlanningTag, PlanningTodo } from "@/lib/planning-types";
import { parsePlanningOp, type PlanningOpInput } from "./op";

export const dynamic = "force-dynamic";

/**
 * fork:proma-44-planning —— Todo / 日程工作区的单一数据接口。
 *
 *   GET  /api/planning  -> { state, now }
 *   POST /api/planning  body: <op>  -> { entity?, deletedId?, state, now }
 *
 * 授权与路径校验复用既有的那一套，不另写：`isApiRequestAllowed()`（同源 / 本机）
 * + `hasJsonContentType()`。这里没有路径参数 —— 数据文件的位置由
 * `lib/planning-store.ts` 从 `getAgentDir()` 推出来，客户端碰不到。
 *
 * **POST 一次回整份快照**而不是只回改动的那个实体：联动太多（改 dueAt 会挪自动
 * 提醒、完成 Todo 会收掉它名下没确认的提醒、删标签会从所有 Todo 上摘掉它），
 * 回增量就得在前端拼一份和后端一样的联动规则 —— 那正是要避免的第二处真相。
 * 本地 JSON 文件的规模下这一份快照只有几十 KB。
 */

function now(): number {
  return Date.now();
}

export async function GET(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  try {
    return NextResponse.json(
      { state: readPlanningState(), now: now() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

/** 一次 op 改动的那个实体；调用方按 op 的种类收窄。 */
type PlanningEntity = PlanningTodo | PlanningEvent | PlanningGroup | PlanningTag | PlanningReminder;

async function applyOp(op: PlanningOpInput, state: PlanningState): Promise<{ entity?: PlanningEntity; deletedId?: string }> {
  switch (op.op) {
    case "todo.create":
      return { entity: createTodo(state, {
        title: op.title,
        notes: op.notes,
        priority: op.priority,
        dueAt: op.dueAt,
        groupId: op.groupId,
        tagIds: op.tagIds,
      }, now()) };
    case "todo.update":
      return { entity: updateTodo(state, {
        id: op.id,
        title: op.title,
        notes: op.notes,
        status: op.status,
        priority: op.priority,
        dueAt: op.dueAt,
        groupId: op.groupId,
        tagIds: op.tagIds,
        workspaceCwd: op.workspaceCwd,
        expectedUpdatedAt: op.expectedUpdatedAt,
      }, now()) };
    case "todo.delete":
      deleteTodo(state, op.id);
      return { deletedId: op.id };
    case "event.create":
      return { entity: createEvent(state, {
        title: op.title,
        notes: op.notes,
        startAt: op.startAt,
        endAt: op.endAt,
        allDay: op.allDay,
        groupId: op.groupId,
        tagIds: op.tagIds,
        todoId: op.todoId,
      }, now()) };
    case "event.update":
      return { entity: updateEvent(state, {
        id: op.id,
        title: op.title,
        notes: op.notes,
        startAt: op.startAt,
        endAt: op.endAt,
        allDay: op.allDay,
        groupId: op.groupId,
        tagIds: op.tagIds,
        todoId: op.todoId,
        expectedUpdatedAt: op.expectedUpdatedAt,
      }, now()) };
    case "event.delete":
      deleteEvent(state, op.id);
      return { deletedId: op.id };
    case "group.create":
      return { entity: createGroup(state, { scope: op.scope, name: op.name }, now()) };
    case "group.rename":
      return { entity: updateGroup(state, { id: op.id, name: op.name }, now()) };
    case "group.delete":
      deleteGroup(state, op.id);
      return { deletedId: op.id };
    case "tag.create":
      return { entity: createTag(state, { name: op.name }, now()) };
    case "tag.rename":
      return { entity: renameTag(state, { id: op.id, name: op.name }, now()) };
    case "tag.delete":
      deleteTag(state, op.id);
      return { deletedId: op.id };
    case "reminder.create":
      return { entity: createReminder(state, {
        targetType: op.targetType,
        targetId: op.targetId,
        triggerAt: op.triggerAt,
      }, now()) };
    case "reminder.delete":
      deleteReminder(state, op.id);
      return { deletedId: op.id };
    case "reminder.acknowledge":
      return { entity: acknowledgeReminder(state, op.id, now()) };
    case "reminder.snooze":
      return { entity: snoozeReminder(state, op.id, op.minutes, now()) };
  }
}

export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const op = parsePlanningOp(body);
  if (!op) {
    return NextResponse.json({ error: "Unknown or malformed planning op" }, { status: 400 });
  }

  try {
    const result = await mutatePlanningState((state) => {
      const outcome = applyOp(op, state);
      return { ...outcome, state };
    });
    return NextResponse.json(
      { ...result, now: now() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof PlanningConflictError) {
      return NextResponse.json(
        { error: error.message, code: "planning_conflict" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof PlanningInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
