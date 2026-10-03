import { NextResponse } from "next/server";

import { lanAccessState } from "@/lib/lan-access";
import { lanPairCodes, listLanUrls, requestPort } from "@/lib/lan-pair";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const DEFAULT_PORT = 30141;

/**
 * POST /api/lan/pair/generate —— 桌面端（本机）申请一个 6 位配对码。
 *
 * 鉴权交给 `proxy.ts` 的 LAN 闸门：没设 `PI_WEB_LAN_TOKEN` 时本机随便调，
 * 设了之后非本机请求要带令牌。这里只回答「有没有可发的凭证」。
 */
export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  // fork:lan-access —— **没有令牌就建一个**，而不是回 409 让用户自己去敲 env。
  // 用户 2026-10-03 的原话是「默认给我暂停，还让我自己启动」：上一版把配对挂在
  // `PI_WEB_LAN_TOKEN` 上，于是这个页面默认只能报一句英文。现在令牌由应用自己生成并存盘
  // （`~/.pi/agent/lan-access.json`，0600），启动器下次看到它就自动绑网卡 —— 全程零参数。
  const access = lanAccessState();
  if (!access.token) {
    return NextResponse.json(
      { error: "LAN access is turned off. Turn it on in this panel, then restart pi-web once.", code: "lan-access-off" },
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
    // 本次运行的实际状态：令牌有了，但要等重启才真的绑上网卡。
    boundLan: access.boundLan,
    needsRebind: access.needsRebind,
  });
}
