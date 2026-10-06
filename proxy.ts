import { NextResponse, type NextRequest } from "next/server";
import {
  LAN_COOKIE_MAX_AGE_SECONDS,
  LAN_COOKIE_NAME,
  checkLanAccess,
  lanCookieSecure,
} from "@/lib/lan-access";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";

export function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  // fork:design-system（2026-09-28 用户裁定）—— **本产品没有登录**。
  // 原来这里有一整套 PI_WEB_PASSWORD 门（/login 页 + 会话令牌 + Basic 认证 +
  // 失败限流 + 302 跳登录页），现在整段删除：`app/login/`、`app/api/web-auth/`
  // 一并移除，`/login` 不再是路由。
  // 剩下的 `isTrustedRequest` 是**同源/本机**防护，与登录无关，必须保留。
  //
  // fork:lan-access（2026-10-03）—— 唯一的新增门：**只在 `PI_WEB_LAN_TOKEN` 被设置时**存在。
  // 没设置时 `checkLanAccess()` 恒放行，上面那条「没有登录」的裁定一字不动；设置之后，
  // loopback 仍放行（桌面 App / `npm run prod` / e2e 不受影响），只有从别的机器来的
  // 请求要出示令牌。借的是 MusePi 那条规则：有令牌才允许暴露到网卡。
  const lanAccess = checkLanAccess(request);
  if (!lanAccess.ok) {
    if (isApiRequest) {
      return NextResponse.json({ error: lanAccess.reason }, { status: lanAccess.status });
    }
    return new NextResponse(
      `${lanAccess.reason}\n\nSee PI_WEB_LAN_TOKEN in the pi-web CLI help.`,
      { status: lanAccess.status },
    );
  }

  const response = NextResponse.next();
  if (lanAccess.plantCookie) {
    response.cookies.set(LAN_COOKIE_NAME, lanAccess.plantCookie, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: LAN_COOKIE_MAX_AGE_SECONDS,
      // 局域网直连是明文 http（标了 Secure 浏览器就直接不存）；
      // 走 https 隧道/反代到达时 lanCookieSecure 会翻开 Secure。fork:mobile-shell
      secure: lanCookieSecure(request),
    });
  }
  return response;
}

export const config = { matcher: ["/", "/api/:path*"] };
