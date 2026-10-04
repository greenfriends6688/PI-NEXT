import { NextResponse } from "next/server";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { appendTurnObservation, type TurnObservation } from "@/lib/turn-observability";

/**
 * POST /api/usage-stats/turn
 * body: TurnObservation —— 把「这一轮」落盘。
 *
 * fork:per-turn-observability。写盘必须走服务端：观测在**客户端**算（turn-stats
 * 挂在 ChatWindow 上），而落盘要 `node:fs`。这条路由就是那个桥。
 *
 * 刻意做得**没有返回值语义**：写成功也只回 `{ ok: true }`，不回读回内容 ——
 * 它是旁路，调用方不该为它做重试或错误分支（观测失败不该影响一轮对话）。
 */

const MAX_BODY_CHARS = 8192;

export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!hasJsonContentType(request)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let body: unknown;
  try {
    const text = await request.text();
    // 先看长度：一轮观测本来只有几百字节，超了就是别的东西（或恶意）。
    if (text.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Object required" }, { status: 400 });
  }
  // 逐字段挑而不是整体转：客户端多塞的字段不该进观测记录
  // （落盘白名单在 `serializeTurnObservation` 里，这里先做一次形状收敛）。
  const source = body as Record<string, unknown>;
  // 先攒进一个普通 record，最后补 sessionId —— 那个类型要求它必填，
  // 而我们要在补之前先确认它非空。
  const observation: Record<string, unknown> = {};
  if (typeof source.sessionId === "string") observation.sessionId = source.sessionId;
  for (const key of ["entryId", "startedAt", "endedAt", "input", "output", "cacheRead",
    "cacheWrite", "cost", "toolCalls", "toolErrors"] as const) {
    if (typeof source[key] === "number" || typeof source[key] === "string") {
      observation[key] = source[key];
    }
  }
  if (typeof source.stopped === "boolean") observation.stopped = source.stopped;

  if (!observation.sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const path = `${getAgentDir()}/pi-web/turns.jsonl`;
  appendTurnObservation(path, observation as unknown as TurnObservation);
  return NextResponse.json({ ok: true });
}