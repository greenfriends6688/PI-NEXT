import { NextResponse } from "next/server";

import { hasJsonContentType, isLoopbackRequest } from "@/lib/request-security";
import {
  getTunnelState,
  startTunnel,
  stopTunnel,
} from "@/lib/tunnel-manager";

export const dynamic = "force-dynamic";

/**
 * /api/tunnel —— 「5G 控制」（fork:mobile-shell）。
 *
 * GET：隧道状态 + 当前放行名单。
 * POST：
 *   `{action:"start"|"stop"}` —— 启停隧道。走 /api 令牌闸门（配对过的设备皆可操作，
 *   与本面板其它控制同信任级），手机经隧道也能停/重开。
 *   `{host}` —— 把 host 追加进**运行时放行名单**。**仅限本机**（`isLoopbackRequest`
 *   硬闸）：这个入口改的是安全边界本身，远程永远 403（`scripts/tunnel.mjs` 用）。
 */
export async function GET(req: Request) {
  const loopback = isLoopbackRequest(req);
  const allowedHosts = loopback
    ? (process.env.PI_WEB_ALLOWED_HOSTS ?? "").split(",").map((v) => v.trim()).filter(Boolean)
    : [];
  return NextResponse.json({ tunnel: getTunnelState(), allowedHosts });
}

export async function POST(req: Request) {
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const entry = (body ?? {}) as { action?: unknown; host?: unknown };

  // 脚本通道：运行时放行（仅本机）。
  if (typeof entry.host === "string" && entry.host) {
    if (!isLoopbackRequest(req)) {
      return NextResponse.json({ error: "loopback only" }, { status: 403 });
    }
    const host = entry.host.trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/.test(host) || host.length > 253) {
      return NextResponse.json({ error: "host must be a bare hostname" }, { status: 400 });
    }
    const current = new Set(
      (process.env.PI_WEB_ALLOWED_HOSTS ?? "").split(",").map((v) => v.trim()).filter(Boolean),
    );
    const added = !current.has(host);
    if (added) {
      current.add(host);
      process.env.PI_WEB_ALLOWED_HOSTS = [...current].join(",");
    }
    return NextResponse.json({ ok: true, added, allowedHosts: [...current] });
  }

  // 面板通道：启停隧道（令牌闸门覆盖）。
  if (entry.action === "start") {
    startTunnel();
    return NextResponse.json({ ok: true, tunnel: getTunnelState() });
  }
  if (entry.action === "stop") {
    stopTunnel();
    return NextResponse.json({ ok: true, tunnel: getTunnelState() });
  }
  return NextResponse.json({ error: "action must be start or stop" }, { status: 400 });
}
