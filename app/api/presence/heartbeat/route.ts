import { NextResponse } from "next/server";

import { recordPresenceHeartbeat } from "@/lib/presence-store";
import { hasJsonContentType } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * POST /api/presence/heartbeat —— 客户端在场心跳（fork:mobile-shell）。
 *
 * 走 `/api/**` 既有令牌闸门（proxy.ts），不新增鉴权面。判定语义见
 * `lib/notification-plan.ts`：这里只收数、只进内存。
 */
export async function POST(req: Request) {
  if (!hasJsonContentType(req)) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "body must be an object" }, { status: 400 });
  }
  const entry = body as Record<string, unknown>;
  const clientId = typeof entry.clientId === "string" ? entry.clientId.trim() : "";
  if (!clientId || clientId.length > 128) {
    return NextResponse.json({ error: "clientId must be a non-empty string" }, { status: 400 });
  }
  if (typeof entry.appVisible !== "boolean") {
    return NextResponse.json({ error: "appVisible must be a boolean" }, { status: 400 });
  }
  const focusedSessionId = typeof entry.focusedSessionId === "string" && entry.focusedSessionId
    ? entry.focusedSessionId.slice(0, 200)
    : null;
  const lastActivityAtMs = typeof entry.lastActivityAtMs === "number" && Number.isFinite(entry.lastActivityAtMs)
    ? entry.lastActivityAtMs
    : null;

  recordPresenceHeartbeat(clientId, {
    appVisible: entry.appVisible,
    focusedSessionId,
    lastActivityAtMs,
  });
  return new NextResponse(null, { status: 204 });
}
