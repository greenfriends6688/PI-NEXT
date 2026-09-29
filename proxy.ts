import { NextResponse, type NextRequest } from "next/server";
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
  return NextResponse.next();
}

export const config = { matcher: ["/", "/api/:path*"] };
