import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import {
  ensureLanAccessConfig,
  lanAccessState,
  listLanUrls,
  readLanAccessConfig,
  requestPort,
  writeLanAccessConfig,
} from "@/lib/lan-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const DEFAULT_PORT = 30142;

/**
 * GET /api/lan/access —— 「手机能不能连上」的状态（设置 › 手机 那一栏读它）。
 * PUT /api/lan/access —— 开关 + 换令牌。
 *
 * 第一次打开这一栏就算同意：现生成一个令牌并开启。这就是「默认就该能用」的落点 ——
 * 不用敲 env、不用加参数。反过来，**从没打开过这一栏的人不受影响**：令牌只在这次访问里
 * 生成，所以「没开过」仍然是纯 loopback。
 */
export async function GET(req: Request) {
  const before = readLanAccessConfig();
  const config = ensureLanAccessConfig();
  const state = lanAccessState();
  return NextResponse.json({
    enabled: state.token !== undefined,
    created: before === null,
    boundLan: state.boundLan,
    // 有令牌但服务还没绑网卡 → 需要重启一次（桌面端会自己重启）。
    needsRebind: state.needsRebind,
    lanUrls: listLanUrls(requestPort(req, DEFAULT_PORT)),
    // 只回「有没有」，绝不回令牌本身。
    tokenHint: config.token ? `${config.token.slice(0, 4)}…${config.token.slice(-4)}` : null,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: { enabled?: unknown; rotate?: unknown };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const current = readLanAccessConfig() ?? ensureLanAccessConfig();

  if (body.rotate === true) {
    // 换令牌 = 换一份随机串：所有已发的链接、已种下的 cookie、只读链接一起作废。
    writeLanAccessConfig({ ...current, token: randomBytes(24).toString("hex"), enabled: true });
    const state = lanAccessState();
    return NextResponse.json({ enabled: true, boundLan: state.boundLan, needsRebind: state.needsRebind, lanUrls: [] });
  }

  const saved = writeLanAccessConfig({ ...current, enabled: body.enabled !== false });
  const state = lanAccessState();
  return NextResponse.json({
    enabled: saved.enabled && state.token !== undefined,
    boundLan: state.boundLan,
    needsRebind: state.needsRebind,
    lanUrls: [],
  });
}
