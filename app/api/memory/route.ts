import { NextResponse } from "next/server";

import { listMemoryDocuments } from "@/lib/memory-docs";
import { readMemoryState, setMemoryExtensionEnabled } from "@/lib/memory-package";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * GET /api/memory —— 「设置 → 记忆」的读数：**本应用的开关**、包装没装 / 版本 /
 * 在 pi 的 `packages` 里开着吗（只读），以及记忆写在哪个目录、目录里有什么。
 *
 * fork:memory-docs（2026-10-07）—— 另带 `documents`：可读可改的记忆文档清单
 * （只含 `.md`，全局在前、然后逐个项目）。列的是**相对名 + 项目名**，路径拼接
 * 只在 `lib/memory-docs.ts` 一处做；读 / 写单份走 `/api/memory/document`。
 *
 * PUT —— `{ enabled: boolean }`：只改**本应用**的开关（`pi-web-preferences.json`）。
 * 不动 pi 的 `packages` —— 终端与其它运行时照旧用它自己的那份记忆（用户 2026-10-07 裁定）。
 * 切换对**新会话**生效：扩展是会话启动时加载的，关掉不会把正在跑的会话里的它摘掉。
 */
export async function GET() {
  try {
    return NextResponse.json({ ...await readMemoryState(), documents: listMemoryDocuments() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  try {
    const body = await req.json() as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    setMemoryExtensionEnabled(body.enabled);
    return NextResponse.json(await readMemoryState());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
