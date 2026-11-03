import { NextResponse } from "next/server";

import { ensureLanAccessConfig, lanAccessState, listLanUrls, requestPort } from "@/lib/lan-access";
import { lanPairCodes } from "@/lib/lan-pair";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const DEFAULT_PORT = 30142;

/**
 * POST /api/lan/pair/generate —— 桌面端（本机）申请一个 6 位配对码。
 *
 * 鉴权交给 proxy.ts：本机随便调，局域网来的请求要带令牌。
 * 没有令牌就**现生成一个**，而不是回 409 让用户自己去敲 env。
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  ensureLanAccessConfig();
  const access = lanAccessState();
  if (!access.token) {
    return NextResponse.json(
      { error: "LAN access is turned off. Turn it on first, then restart Pi Web once.", code: "lan-access-off" },
      { status: 409 },
    );
  }

  let readOnly = false;
  try {
    const body = await req.json() as { readOnly?: unknown };
    if (body.readOnly !== undefined && typeof body.readOnly !== "boolean") {
      return NextResponse.json({ error: "readOnly must be a boolean" }, { status: 400 });
    }
    readOnly = body.readOnly === true;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const pair = lanPairCodes().mint(readOnly ? "readonly" : "full");
  return NextResponse.json({
    code: pair.code,
    readOnly: pair.kind === "readonly",
    expiresInSeconds: pair.expiresInSeconds,
    lanUrls: listLanUrls(requestPort(req, DEFAULT_PORT)),
    boundLan: access.boundLan,
    needsRebind: access.needsRebind,
  }, { headers: { "Cache-Control": "no-store" } });
}
