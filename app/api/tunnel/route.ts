import { NextResponse } from "next/server";

import { hasJsonContentType, isLoopbackRequest } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * POST /api/tunnel —— 把 quick tunnel 的 host 追加进运行时放行名单（fork:mobile-shell）。
 *
 * `npm run tunnel` 在拿到新的 trycloudflare 地址后调用这里；`lib/request-security.ts`
 * 的放行名单每次请求现读 `process.env.PI_WEB_ALLOWED_HOSTS`，所以改 env 立即生效、
 * 不用重启服务。
 *
 * **仅限本机**：`isLoopbackRequest` 是硬闸（远程请求永远 403）——能改放行名单的
 * 入口必须只在本机。应用层鉴权（令牌闸门）不受影响：加进名单只是让请求「能进门」，
 * 进门后该验令牌照样验。
 */
export async function POST(req: Request) {
  if (!isLoopbackRequest(req)) {
    return NextResponse.json({ error: "loopback only" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const host = typeof (body as { host?: unknown })?.host === "string"
    ? (body as { host: string }).host.trim().toLowerCase()
    : "";
  // 宽松但明确的 hostname 形状校验（无 scheme/路径/端口——端口由隧道边缘处理）。
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/.test(host) || host.length > 253) {
    return NextResponse.json({ error: "host must be a bare hostname" }, { status: 400 });
  }

  const current = new Set(
    (process.env.PI_WEB_ALLOWED_HOSTS ?? "").split(",").map((v) => v.trim()).filter(Boolean),
  );
  const isNew = !current.has(host);
  if (isNew) {
    current.add(host);
    process.env.PI_WEB_ALLOWED_HOSTS = [...current].join(",");
  }
  return NextResponse.json({ ok: true, added: isNew, allowedHosts: [...current] });
}

export async function GET(req: Request) {
  if (!isLoopbackRequest(req)) {
    return NextResponse.json({ error: "loopback only" }, { status: 403 });
  }
  const allowedHosts = (process.env.PI_WEB_ALLOWED_HOSTS ?? "")
    .split(",").map((v) => v.trim()).filter(Boolean);
  return NextResponse.json({ allowedHosts });
}
