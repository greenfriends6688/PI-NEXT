import { NextResponse } from "next/server";

import { readEntriesSince } from "@/lib/session-sync";
import { resolveSessionPath } from "@/lib/session-reader";

export const dynamic = "force-dynamic";

/**
 * GET /api/sync/session/[id]/entries?offset=&maxBytes= —— 会话条目增量（fork:mobile-shell）。
 *
 * `.jsonl` 按字节游标增量下发，协议语义见 `lib/session-sync.ts`（reset/分页/UTF-8 安全）。
 * 客户端第一次 offset=0 全量拉，之后带上次返回的 nextOffset 续拉。
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const offsetRaw = url.searchParams.get("offset");
  const maxBytesRaw = url.searchParams.get("maxBytes");
  const offset = offsetRaw == null || offsetRaw === "" ? 0 : Number(offsetRaw);
  const maxBytes = maxBytesRaw == null || maxBytesRaw === "" ? undefined : Number(maxBytesRaw);
  if (!Number.isFinite(offset) || offset < 0) {
    return NextResponse.json({ error: "offset must be a non-negative number" }, { status: 400 });
  }
  if (maxBytes !== undefined && (!Number.isFinite(maxBytes) || maxBytes < 1 || maxBytes > 32 * 1024 * 1024)) {
    return NextResponse.json({ error: "maxBytes must be between 1 and 33554432" }, { status: 400 });
  }

  const filePath = await resolveSessionPath(id);
  if (!filePath) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  const slice = readEntriesSince(filePath, offset, maxBytes);
  return NextResponse.json({ sessionId: id, offset, ...slice });
}
