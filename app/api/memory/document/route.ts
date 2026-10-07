import { NextResponse } from "next/server";

import { readMemoryDocument, writeMemoryDocument } from "@/lib/memory-docs";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * fork:memory-docs —— 「设置 → 记忆」里点开一份记忆文档。
 *
 * GET `?scope=global|project&project=<目录名>&name=<相对 .md 路径>` —— 读一份。
 * PUT `{ scope, project?, name, content }` —— 存回去（原子写）。
 *
 * **路径不在请求里拼**：三段交给 `lib/memory-docs.ts` 的 `resolveMemoryDocument()`
 * 统一校验（段干净 + realpath 复核落在根内），这里只做转发与状态码映射。
 * 记忆目录里还有 sqlite / 内部备份件，那边只认 `.md` —— 面板不会把它们列出来，
 * 就算手拼一个也拿不到。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const result = readMemoryDocument({
    scope: url.searchParams.get("scope"),
    project: url.searchParams.get("project") ?? undefined,
    name: url.searchParams.get("name") ?? undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.document);
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: { scope?: unknown; project?: unknown; name?: unknown; content?: unknown };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const result = writeMemoryDocument(body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, bytes: result.bytes, mtimeMs: result.mtimeMs });
}
