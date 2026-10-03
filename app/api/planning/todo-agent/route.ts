import { existsSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { allowFileRoot, getAllowedFileRoots, isFilePathAllowed, isWindowsAbsolutePath } from "@/lib/file-access";
import { invalidateSessionListCache } from "@/lib/session-reader";
import { startRpcSession } from "@/lib/rpc-manager";
import { mutatePlanningState } from "@/lib/planning-store";
import { PlanningConflictError, PlanningInputError, linkTodoSession, updateTodo } from "@/lib/planning-state";
import { buildTodoAgentPrompt } from "../prompt";

export const dynamic = "force-dynamic";

/**
 * fork:proma-44-planning —— 从一条 Todo 发起一次 Agent 对话。
 *
 *   POST /api/planning/todo-agent  body: { todoId, cwd, expectedUpdatedAt? }
 *
 * **消息通道不新造**：这里 `startRpcSession()` + `session.send({ type: "prompt" })`
 * 就是 `POST /api/agent/new` 用的那两条，没有第二条实现，也没有前端自建 SSE。
 * 前端拿到 `sessionId` 后走 `?session=<id>` 导航 —— AppShell 早就认这个参数，
 * 于是「从 Todo 跳到对话」不需要碰 `AppShell` / `TabBar` / `ChatWindow` 里的任何一行。
 *
 * 这条路由自己只做三件 `/api/agent/new` 不管的事：
 *
 * 1. **前置校验**：Todo 存在、`expectedUpdatedAt` 对得上（否则两个面板各起一条
 *    会话，谁也不知道最后哪条算数）、`cwd` 是绝对路径 / 存在 / 在 allowed roots 内
 *    —— 后两条与 `/api/cwd/validate` 和 `/api/files` 同一套，不另写授权。
 * 2. **原子登记**：把 `sessionId` 记进这条 Todo 的 `sessionLinks`，按 sessionId 去重。
 * 3. **把工作目录存回 Todo**，下次不用再选。
 *
 * 目录落在 allowed roots 之外时返回 403 而不是 500：那是「你选了个我们没权开的
 * 目录」，属于用户的输入问题，报内部错误会让人以为是 bug。
 */

function errorResponse(error: unknown): NextResponse {
  if (error instanceof PlanningConflictError) {
    return NextResponse.json({ error: error.message, code: "planning_conflict" }, { status: 409 });
  }
  if (error instanceof PlanningInputError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: String(error) }, { status: 500 });
}

export async function POST(request: NextRequest) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let body: { todoId?: unknown; cwd?: unknown; expectedUpdatedAt?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const todoId = typeof body.todoId === "string" ? body.todoId.trim() : "";
  const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  const expectedUpdatedAt = typeof body.expectedUpdatedAt === "number" && Number.isFinite(body.expectedUpdatedAt)
    ? body.expectedUpdatedAt
    : undefined;

  if (!todoId) return NextResponse.json({ error: "todoId is required" }, { status: 400 });
  if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
    return NextResponse.json({ error: "cwd must be an absolute path" }, { status: 400 });
  }
  if (!existsSync(cwd)) {
    return NextResponse.json({ error: `Directory does not exist: ${cwd}` }, { status: 400 });
  }
  if (!statSync(cwd).isDirectory()) {
    return NextResponse.json({ error: `Not a directory: ${cwd}` }, { status: 400 });
  }
  if (!isFilePathAllowed(cwd, await getAllowedFileRoots())) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    // 先原子校验 Todo（顺带把工作目录记上去），再建会话 —— 顺序反了会留下一条
    // 「已经起了会话但 Todo 校验不过」的关联。
    const snapshot = await mutatePlanningState((state) => {
      updateTodo(state, { id: todoId, workspaceCwd: cwd, expectedUpdatedAt }, Date.now());
      return state.todos.find((todo) => todo.id === todoId)!;
    });

    // 一次性 key：`startRpcSession` 会把同一个 key 上的并发调用合并成一条会话，
    // Date.now() 的毫秒精度在同毫秒下会撞车（见 /api/agent/new 的同一处注释）。
    const { session, realSessionId } = await startRpcSession(`__planning__${randomUUID()}`, "", cwd, {});

    // 与 /api/agent/new 一样：新 cwd 要进 files 路由的 allowed-roots 缓存，
    // 否则文件浏览器在第一条会话建好之前读不到它。
    allowFileRoot(cwd);
    invalidateSessionListCache();

    await session.send({ type: "prompt", message: buildTodoAgentPrompt(snapshot) });

    const todo = await mutatePlanningState((state) => linkTodoSession(state, todoId, realSessionId, Date.now()));
    return NextResponse.json(
      { sessionId: realSessionId, cwd, todo, now: Date.now() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
