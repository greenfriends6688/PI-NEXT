import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";

import {
  getRelayDialerState,
  readRelayLinkConfig,
  startRelayDialer,
  stopRelayDialer,
  writeRelayLinkConfig,
} from "@/lib/relay-dialer";
import { hasJsonContentType } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/**
 * GET/PUT /api/relay —— 自建中继（fork:mobile-shell）的配置面。
 *
 * 配置落 `~/.pi/agent/relay-link.json`（0600）；拨号端在**本进程内**启停
 * （lib/relay-dialer.ts），开关即时生效不用重启。鉴权走 /api 既有令牌闸门。
 */
export async function GET() {
  const config = readRelayLinkConfig();
  const state = getRelayDialerState();
  return NextResponse.json({
    configured: config != null,
    url: config?.url ?? null,
    serverId: config?.serverId ?? null,
    hasToken: Boolean(config?.token),
    phoneAddress: config ? `${config.url.replace(/\/$/, "")}/m/${config.serverId}/` : null,
    dialer: state,
  });
}

export async function PUT(req: Request) {
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "body must be an object" }, { status: 400 });
  }
  const entry = body as { url?: unknown; token?: unknown; enabled?: unknown };

  if (entry.enabled === false) {
    stopRelayDialer();
    return NextResponse.json({ ok: true, dialer: getRelayDialerState() });
  }

  const existing = readRelayLinkConfig();
  const url = typeof entry.url === "string" && entry.url.trim() ? entry.url.trim() : existing?.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json(
      { error: "url must be the relay's public origin, e.g. https://xxx.deno.dev" },
      { status: 400 },
    );
  }
  let normalizedUrl: URL;
  try {
    normalizedUrl = new URL(url);
  } catch {
    return NextResponse.json({ error: "url is not a valid origin" }, { status: 400 });
  }
  const token = typeof entry.token === "string" && entry.token.trim()
    ? entry.token.trim()
    : existing?.token;
  const serverId = existing?.serverId ?? randomBytes(5).toString("hex");

  writeRelayLinkConfig({
    version: 1,
    url: normalizedUrl.origin,
    ...(token ? { token } : {}),
    serverId,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  });

  if (entry.enabled === true) {
    startRelayDialer();
  }
  const config = readRelayLinkConfig();
  return NextResponse.json({
    ok: true,
    configured: config != null,
    url: config?.url ?? null,
    serverId: config?.serverId ?? null,
    hasToken: Boolean(config?.token),
    phoneAddress: config ? `${config.url.replace(/\/$/, "")}/m/${config.serverId}/` : null,
    dialer: getRelayDialerState(),
  });
}
