import { NextResponse, type NextRequest } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  LAN_COOKIE_MAX_AGE_SECONDS,
  LAN_COOKIE_NAME,
  checkLanAccess,
  lanCookieSecure,
} from "@/lib/lan-access";

// No login: the app only ever answers trusted hosts (loopback, a LAN address,
// a tunnel's own host). The password gate, the session cookie and /login are
// gone — `PI_WEB_PASSWORD` is no longer read anywhere.
//
// 手机/平板走局域网时另有一道**令牌闸门**（lib/lan-access.ts）：只有设置了令牌才存在，
// 没设置时 `checkLanAccess()` 恒放行，本机与以前一字不差。
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

  const lanAccess = checkLanAccess(request);
  if (!lanAccess.ok) {
    if (isApiRequest) {
      return NextResponse.json({ error: lanAccess.reason }, { status: lanAccess.status });
    }
    // 手机第一次打开局域网地址时还没有 cookie：直接送到兑码页，而不是回一行 401 文本。
    // 兑码页本身不在 matcher 里（它只能换码），所以这里跳过去不会打转。
    // 跳转目标用请头里的 Host：`request.url` 是服务器自己看到的地址（回环），
    // 把手机跳回 127.0.0.1 它就打不开了。
    if (request.nextUrl.pathname === "/" && !request.nextUrl.searchParams.has("t")) {
      const host = request.headers.get("host");
      const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
      const target = host ? new URL("/pair", `${proto}://${host}`) : new URL("/pair", request.url);
      return NextResponse.redirect(target);
    }
    return new NextResponse(`${lanAccess.reason}\n\nOpen Settings → Phone on the machine running Pi Web to pair this device.`, {
      status: lanAccess.status,
    });
  }

  const response = NextResponse.next();
  // `?t=` 到达的令牌种成 cookie：页面随后的请求就都是普通请求了（EventSource 带不上自定义头）。
  if (lanAccess.plantCookie) {
    response.cookies.set(LAN_COOKIE_NAME, lanAccess.plantCookie, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: LAN_COOKIE_MAX_AGE_SECONDS,
      secure: lanCookieSecure(request),
    });
  }
  return response;
}

// `/pair` 刻意不在 matcher 里：手机还没令牌时就要能打开兑码页（它只能换码，换不到就还是 401）。
export const config = { matcher: ["/", "/api/:path*"] };
