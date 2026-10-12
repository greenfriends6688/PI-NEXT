import { NextResponse } from "next/server";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { deleteSessions, MAX_SESSION_DELETE_IDS, type SessionDeleteResult } from "@/lib/session-delete";
import { isValidSessionId } from "@/lib/session-file-references-core";

export const dynamic = "force-dynamic";

// fork:upstream-0.12-sidebar-parity —— 项目分组的「删除全部会话」（#1182）：侧栏在确认
// 框里列出的 id，连同它们下面的子代理会话，一次遍历目录删掉（lib/session-delete.ts）。
// 之后才开始的运行会被保留并回报，绝不停止；已经不在了的 id 也回报。

const NO_STORE = { "Cache-Control": "no-store" };

function refusal(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

// POST /api/sessions/delete - body { ids: string[] }（最多 MAX_SESSION_DELETE_IDS 个）。
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return refusal(403, "Untrusted API request");
  if (!hasJsonContentType(req)) return refusal(415, "Content-Type must be application/json");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refusal(400, "Invalid JSON body");
  }
  const ids = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as { ids?: unknown }).ids : undefined;
  if (!Array.isArray(ids) || ids.length === 0) return refusal(400, "ids must be a non-empty array");
  if (ids.length > MAX_SESSION_DELETE_IDS) return refusal(400, `ids may hold at most ${MAX_SESSION_DELETE_IDS} session ids`);
  if (!ids.every((id) => typeof id === "string" && isValidSessionId(id))) return refusal(400, "ids must be session ids");

  try {
    const result = await deleteSessions(ids as string[], { keepRunning: true });
    return NextResponse.json(result satisfies SessionDeleteResult, { headers: NO_STORE });
  } catch (error) {
    return refusal(500, error instanceof Error ? error.message : String(error));
  }
}
