import { NextResponse } from "next/server";

import {
  LAN_COOKIE_MAX_AGE_SECONDS,
  LAN_COOKIE_NAME,
  deriveReadOnlyToken,
  lanCookieSecure,
  readLanToken,
} from "@/lib/lan-access";
import { lanPairCodes, pairAttemptLimiter, attemptKey } from "@/lib/lan-pair";
import { hasJsonContentType } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * POST /api/lan/pair/redeem —— 手机拿 6 位码换 cookie。这是**唯一**免令牌可达的路径
 * （`lib/lan-access.ts` 的 `PAIR_EXEMPT_PATHS`），所以它只做一件事：把码换成 cookie，
 * 换不到就是换不到。
 */
export async function POST(req: Request) {
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const token = readLanToken();
  if (!token) {
    return NextResponse.json(
      { error: "PI_WEB_LAN_TOKEN is not set, so pairing is not available" },
      { status: 409 },
    );
  }

  let code = "";
  try {
    const body = await req.json() as { code?: unknown };
    if (typeof body.code !== "string") {
      return NextResponse.json({ error: "code must be a string" }, { status: 400 });
    }
    code = body.code.trim();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const key = attemptKey(req);
  if (pairAttemptLimiter().remaining(key) <= 0) {
    return NextResponse.json(
      { error: "Too many failed attempts. Wait a few minutes and try again." },
      { status: 429, headers: { "retry-after": "300" } },
    );
  }

  const kind = lanPairCodes().spend(code);
  if (!kind) {
    pairAttemptLimiter().record(key);
    return NextResponse.json({ error: "invalid or expired pair code" }, { status: 401 });
  }
  pairAttemptLimiter().reset(key);

  const response = NextResponse.json({ ok: true, readOnly: kind === "readonly" });
  response.cookies.set(LAN_COOKIE_NAME, kind === "readonly" ? deriveReadOnlyToken(token) : token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: LAN_COOKIE_MAX_AGE_SECONDS,
    // 局域网直连是明文 http；https 隧道/反代下 lanCookieSecure 翻开 Secure。fork:mobile-shell
    secure: lanCookieSecure(req),
  });
  return response;
}
