import { NextResponse } from "next/server";
import { isApiRequestAllowed, hasJsonContentType } from "@/lib/request-security";
import { isBrowserHostOp, MAX_BROWSER_HOST_MESSAGE_CHARS } from "@/lib/browser-host-protocol";
import { callBrowserHost } from "@/lib/browser-host-client";
import { BrowserHostUnavailableError } from "@/lib/browser-endpoint";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * fork:proma-42-browser · 渲染进程 → 桌面宿主的唯一入口。
 *
 * `components/BrowserPanel.tsx` 不直接连主进程，而是走这个路由：它和
 * `lib/browser-tools-extension.ts` 用的是同一套 `callBrowserHost`，所以 UI 点开一个标签
 * 与 agent 驱动同一个标签，走的是同一条 URL 策略、同一份世代表、同一组上限。
 *
 * 授权与其它 `/api/*` 一致（`isApiRequestAllowed`，见 `lib/request-security.ts`）：
 * 这条路能控制用户自己的浏览器，不能比别的 API 更容易被跨站页面打。
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!hasJsonContentType(req)) return NextResponse.json({ error: "Invalid content type" }, { status: 400 });

  let body: { op?: unknown; sessionId?: unknown; tabId?: unknown; payload?: unknown };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!isBrowserHostOp(body.op)) return NextResponse.json({ error: "Unsupported op" }, { status: 400 });
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  // 会话 id 由本仓生成（`detectBrowserHostSessionId`），形状固定；宽松一点只是为了让
  // 宿主能报「没有这个会话」，而不是让路由先拒绝。
  if (!sessionId || sessionId.length > 256) return NextResponse.json({ error: "Invalid sessionId" }, { status: 400 });
  if (body.tabId !== undefined && (typeof body.tabId !== "string" || body.tabId.length > 128)) {
    return NextResponse.json({ error: "Invalid tabId" }, { status: 400 });
  }
  if (body.payload !== undefined && (typeof body.payload !== "object" || body.payload === null || Array.isArray(body.payload))) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const result = await callBrowserHost(body.op, {
      sessionId,
      ...(typeof body.tabId === "string" ? { tabId: body.tabId } : {}),
      ...(typeof body.payload === "object" && body.payload !== null && !Array.isArray(body.payload)
        ? { payload: body.payload as Record<string, unknown> }
        : {}),
    });
    // 截图 base64 可能很大：这里不做二次裁剪（宿主与服务端各卡过一次 3MB），
    // 但仍守一道上限，防止一个构造出来的响应把渲染进程内存吃光。
    const serialized = JSON.stringify(result ?? null);
    if (serialized.length > MAX_BROWSER_HOST_MESSAGE_CHARS) {
      return NextResponse.json({ error: "Result too large" }, { status: 413 });
    }
    return NextResponse.json({ ok: true, result: result ?? null });
  } catch (error) {
    if (error instanceof BrowserHostUnavailableError) {
      // Web 部署是**正常状态**，不是 500：前端据此提示「桌面端才可用」。
      return NextResponse.json({ ok: false, error: error.message, reason: error.reason }, { status: 200 });
    }
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}