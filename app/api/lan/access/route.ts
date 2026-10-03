import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import {
  ensureLanAccessConfig,
  lanAccessState,
  readLanAccessConfig,
  writeLanAccessConfig,
} from "@/lib/lan-access";
import { listLanUrls, requestPort } from "@/lib/lan-pair";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const DEFAULT_PORT = 30141;

/**
 * GET /api/lan/access —— 「手机能不能连上」的状态（左栏的绿点 / 启动 / 停止都读它）。
 * PUT /api/lan/access —— 开关 + 换令牌。
 *
 * 2026-10-03 新增：用户要的是「打开就有二维码」而不是「先配好再回来」，所以令牌在进程内
 * 现生成（`ensureLanAccessConfig`），开关由界面直接写盘。
 */
export async function GET(req: Request) {
  // fork:lan-access —— **第一次打开这一栏就算同意**：现生成一个令牌并开启。
  // 这就是「默认就该能用」的落点：不用敲 env、不用加参数、不用手动重启（启动器盯着这份
  // 配置，off→on 会自动重启子进程）。反过来，**从没打开过这一栏的人不受影响** ——
  // 令牌只在这一次访问里生成，所以「没开过」仍然是纯 loopback。
  const before = readLanAccessConfig();
  const config = ensureLanAccessConfig();
  const state = lanAccessState();
  return NextResponse.json({
    enabled: state.token !== undefined,
    created: before === null,
    boundLan: state.boundLan,
    // 有令牌但服务还没绑网卡 → 启动器正在（或需要）重启一次。
    needsRebind: state.needsRebind,
    lanUrls: listLanUrls(requestPort(req, DEFAULT_PORT)),
    // 只回「有没有」，绝不回令牌本身。
    tokenHint: config.token ? `${config.token.slice(0, 4)}…${config.token.slice(-4)}` : null,
  });
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
    writeLanAccessConfig({ ...current, token: randomBytes(24).toString("hex") });
    return NextResponse.json({ enabled: true, boundLan: false, needsRebind: true, lanUrls: [] });
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
