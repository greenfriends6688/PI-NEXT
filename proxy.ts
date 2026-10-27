import { NextResponse, type NextRequest } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";

// No login: the app only ever answers trusted hosts (loopback, a LAN address,
// a tunnel's own host). The password gate, the session cookie and /login are
// gone — `PI_WEB_PASSWORD` is no longer read anywhere.
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

  return NextResponse.next();
}

export const config = { matcher: ["/", "/api/:path*"] };
