import { NextResponse } from "next/server";

import { FEATURE_DESCRIPTORS, isFeatureId } from "@/lib/feature-toggles";
import { readFeatureFlags, setFeatureFlag } from "@/lib/feature-settings";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * fork:feature-toggles —— 「设置 → 界面与功能」的开关。
 *
 * GET  —— 整张开关表（含默认值补齐）+ 每个开关的元数据（生效时机 / 文案键）。
 * PUT  —— `{ id, enabled }`，一次只改一个。响应回写完之后读回来的整张表。
 *
 * 为什么单独一条路由而不是塞进已有的某条：这一节是**本应用的偏好**，与项目无关，
 * 与 `app/api/memory/route.ts`（只读状态 + 写开关）同形。
 *
 * 生效时机由 `scope` 决定，**路由不负责让它生效**：`session` 类的开关在
 * `startRpcSession()` 构造会话时读（改完要重载会话），`ui` 类的开关由客户端渲染时读。
 * 客户端的读法在 `hooks/useFeatureFlags.ts`。
 */
export async function GET() {
  try {
    return NextResponse.json({
      flags: readFeatureFlags(),
      descriptors: FEATURE_DESCRIPTORS,
    });
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
    const body = await req.json() as { id?: unknown; enabled?: unknown };
    if (!isFeatureId(body.id)) {
      return NextResponse.json({ error: "id must be a known feature id" }, { status: 400 });
    }
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
    }
    return NextResponse.json({
      flags: setFeatureFlag(body.id, body.enabled),
      descriptors: FEATURE_DESCRIPTORS,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
