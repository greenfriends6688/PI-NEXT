/**
 * fork:proma-44-planning —— 「从 Todo 发起 Agent」的首条消息模板。
 *
 * 刻意**很短**。它是给模型的起点，不是任务书：写清「这是哪条 Todo、用户要你处理
 * 它、动手前先确认」三件事就够，剩下的让用户接着聊。长模板会挤占首轮上下文，
 * 而且会让模型在用户还没说话之前就开始改代码。
 *
 * 描述带进 prompt 是有意的（用户写在描述里的就是上下文），但长度封顶
 * `MAX_NOTES_CHARS` —— 一条描述可能有几万字，整段塞进首条消息会顶掉模型对
 * 仓库的注意力。超出的部分留一句「描述很长，去工作区里自己看」。
 */

import type { PlanningTodo } from "@/lib/planning-types";

const MAX_NOTES_CHARS = 2000;

function formatDue(dueAt: number | undefined, now: number): string {
  if (dueAt === undefined) return "no due date";
  const date = new Date(dueAt);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const relative = dueAt < now ? "overdue" : "upcoming";
  return `${day} ${time} (local, ${relative})`;
}

export function buildTodoAgentPrompt(todo: PlanningTodo, now: number = Date.now()): string {
  const lines = [
    "The user started this conversation from a todo item.",
    "",
    `- title: ${todo.title}`,
    `- priority: ${todo.priority}`,
    `- due: ${formatDue(todo.dueAt, now)}`,
  ];
  if (todo.groupId) lines.push(`- group: ${todo.groupId}`);
  if (todo.tagIds.length > 0) lines.push(`- tags: ${todo.tagIds.join(", ")}`);

  const notes = todo.notes?.trim();
  if (notes) {
    const truncated = notes.length > MAX_NOTES_CHARS;
    lines.push("", "Description:", truncated ? `${notes.slice(0, MAX_NOTES_CHARS)}…` : notes);
    if (truncated) lines.push("(the description is long — read the rest in the Planning workspace if you need it)");
  }

  lines.push(
    "",
    "Say what you understand the task to be, then wait for the user. Do not start editing files yet.",
  );
  return lines.join("\n");
}
