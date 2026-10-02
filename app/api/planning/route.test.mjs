import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { parsePlanningOp } = await jiti.import("./op.ts");
const { buildTodoAgentPrompt } = await jiti.import("./prompt.ts");

/*
 * fork:proma-44-planning —— op 判别式与首条消息模板。
 *
 * 路由的授权 / 状态码那一套与 `app/api/changes` 同源（`isApiRequestAllowed` +
 * `hasJsonContentType`），不在这里重复测；这里测的是**只有这一份**的运行时校验 ——
 * 它是唯一挡在「客户端发来的任意 JSON」和「写数据文件」之间的东西。
 */

test("unknown ops and non-objects are rejected", () => {
  assert.equal(parsePlanningOp(null), null);
  assert.equal(parsePlanningOp("todo.create"), null);
  assert.equal(parsePlanningOp({}), null);
  assert.equal(parsePlanningOp({ op: "todo.nuke" }), null);
  assert.equal(parsePlanningOp({ op: "__proto__" }), null);
});

test("required fields must be present and non-blank", () => {
  assert.equal(parsePlanningOp({ op: "todo.create" }), null, "少 title");
  assert.equal(parsePlanningOp({ op: "todo.create", title: "   " }), null, "空白 title");
  assert.equal(parsePlanningOp({ op: "todo.update" }), null, "少 id");
  assert.equal(parsePlanningOp({ op: "event.create", title: "x" }), null, "少 startAt");
  assert.equal(parsePlanningOp({ op: "reminder.snooze", id: "r" }), null, "少 minutes");
  assert.ok(parsePlanningOp({ op: "todo.create", title: "t" }));
});

test("enums are checked, unknown values are a 400 rather than a silent default", () => {
  assert.equal(parsePlanningOp({ op: "todo.create", title: "t", priority: "urgent" }), null);
  assert.equal(parsePlanningOp({ op: "todo.update", id: "a", status: "done" }), null);
  assert.equal(parsePlanningOp({ op: "group.create", scope: "notes", name: "x" }), null);
  assert.equal(parsePlanningOp({ op: "reminder.create", targetType: "event", targetId: "a", triggerAt: 1 }), null);
  assert.equal(parsePlanningOp({ op: "todo.create", title: "t", priority: "high" }).priority, "high");
});

test("timestamps must be real numbers — a numeric string is a classic smuggling attempt", () => {
  assert.equal(parsePlanningOp({ op: "todo.update", id: "a", dueAt: "123" }), null);
  assert.equal(parsePlanningOp({ op: "event.create", title: "x", startAt: "2026-01-01" }), null);
  assert.equal(parsePlanningOp({ op: "event.create", title: "x", startAt: true }), null);
  assert.equal(parsePlanningOp({ op: "reminder.snooze", id: "a", minutes: "5" }), null);
  // null 是「清掉」而不是「类型错」
  assert.equal(parsePlanningOp({ op: "todo.update", id: "a", dueAt: null }).dueAt, null);
  assert.equal(parsePlanningOp({ op: "event.create", title: "x", startAt: 0 }).startAt, 0, "0 是合法时间戳");
});

test("keys outside the whitelist are dropped instead of reaching the writer", () => {
  const op = parsePlanningOp({ op: "todo.create", title: "t", evil: "payload", __proto__: { x: 1 } });
  assert.deepEqual(Object.keys(op).sort(), ["op", "tagIds", "title"], "只留白名单键（tagIds 恒为数组）");
});

test("tagIds must be strings and are capped", () => {
  assert.deepEqual(parsePlanningOp({ op: "todo.create", title: "t", tagIds: ["a", 1, "", "b"] }).tagIds, ["a", "b"]);
  assert.deepEqual(parsePlanningOp({ op: "todo.create", title: "t", tagIds: "a" }).tagIds, [], "不是数组 → 空");
  const many = Array.from({ length: 500 }, (_, i) => `t${i}`);
  assert.equal(parsePlanningOp({ op: "todo.create", title: "t", tagIds: many }).tagIds.length, 64);
});

test("the parser does not mutate the request body", () => {
  const body = { op: "todo.create", title: "t", evil: "payload" };
  parsePlanningOp(body);
  assert.equal(body.evil, "payload");
});

test("the agent prompt names the task and refuses to start editing on its own", () => {
  const prompt = buildTodoAgentPrompt({
    id: "1",
    title: "rename the parser",
    notes: "it breaks on empty files",
    status: "open",
    priority: "high",
    dueAt: new Date(2026, 2, 14, 9).getTime(),
    tagIds: ["tag-1"],
    reminderIds: [],
    sessionLinks: [],
    createdAt: 0,
    updatedAt: 0,
  }, new Date(2026, 2, 15, 9).getTime());

  assert.match(prompt, /rename the parser/);
  assert.match(prompt, /it breaks on empty files/);
  assert.match(prompt, /overdue/, "昨天的截止时间要写成 overdue，而不是让模型自己算");
  assert.match(prompt, /Do not start editing files yet/);
});

test("a very long description is truncated so it cannot eat the first turn", () => {
  const prompt = buildTodoAgentPrompt({
    id: "1",
    title: "t",
    notes: "x".repeat(5000),
    status: "open",
    priority: "medium",
    tagIds: [],
    reminderIds: [],
    sessionLinks: [],
    createdAt: 0,
    updatedAt: 0,
  });
  assert.ok(prompt.length < 3000);
  assert.match(prompt, /read the rest in the Planning workspace/);
});

test("the request helpers the route relies on exist (auth seam reused, not rewritten)", async () => {
  const { isApiRequestAllowed, hasJsonContentType } = await jiti.import("@/lib/request-security");
  const crossSite = new NextRequest("http://localhost/api/planning", {
    headers: { Host: "localhost", Origin: "http://evil.example", "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(isApiRequestAllowed(crossSite), false);
  assert.equal(hasJsonContentType(new NextRequest("http://localhost/api/planning", {
    headers: { "Content-Type": "text/plain" },
  })), false);
  assert.equal(hasJsonContentType(new NextRequest("http://localhost/api/planning", {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  })), true);
});
