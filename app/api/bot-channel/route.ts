import { NextResponse } from "next/server";

import {
  BOT_CHANNELS,
  botChannelStatus,
  readBotChannelConfig,
  writeBotChannelConfig,
  type BotChannelConfig,
  type BotChannelEntry,
  type BotChannelId,
} from "@/lib/bot-channel";
import { isBotChannelRunning, startBotChannel, stopBotChannel } from "@/lib/bot-channel-runtime";
import {
  beginRegistration,
  cancelRegistration,
  pollRegistration,
  type ScannableChannelId,
} from "@/lib/bot-channel-register";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

const SCANNABLE: readonly ScannableChannelId[] = ["wechat", "feishu", "lark"];

const CHANNEL_IDS: readonly BotChannelId[] = BOT_CHANNELS.map((spec) => spec.id);

function isChannelId(value: unknown): value is BotChannelId {
  return typeof value === "string" && CHANNEL_IDS.includes(value as BotChannelId);
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function statuses() {
  return BOT_CHANNELS.map((spec) => botChannelStatus(spec.id, isBotChannelRunning(spec.id)));
}

/**
 * GET /api/bot-channel —— 每个渠道的规格 + 当前配置 + 在跑没有。绝不回凭证。
 * POST /api/bot-channel —— 保存配置 / 扫码注册 / 启动 / 停止。
 *
 * 启动 = 起一个进程内长轮询或长连接（企业微信是回调，只登记「在跑」），所以运行状态
 * 只在内存里；`enabled` 落盘，进程重启后由启动器按它自动拉起
 * （lib/bot-channel-runtime.ts）。
 */
export async function GET() {
  return NextResponse.json({ channels: statuses() }, { headers: { "Cache-Control": "no-store" } });
}

/** 把请求里出现过的字段合并进已有条目：缺 = 沿用，空串 = 清掉。 */
function mergeEntry(previous: BotChannelEntry | undefined, body: Record<string, unknown>): BotChannelEntry {
  const next: BotChannelEntry = { ...(previous ?? { allowFrom: [], enabled: false }) };
  const fields = ["token", "appId", "agentId", "callbackToken", "callbackAesKey", "botUserId", "sessionId"] as const;
  for (const field of fields) {
    if (!(field in body)) continue;
    const value = text(body[field]);
    if (value) next[field] = value;
    else delete next[field];
  }
  if ("allowFrom" in body) {
    next.allowFrom = Array.isArray(body.allowFrom)
      ? body.allowFrom.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
      : next.allowFrom;
  }
  return next;
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const action = text(body.action) ?? "status";

  // 扫码注册（微信 / 飞书 / Lark）：开始与轮询。
  if (action === "register-begin" || action === "register-poll" || action === "register-cancel") {
    const id = body.channel;
    if (typeof id !== "string" || !SCANNABLE.includes(id as ScannableChannelId)) {
      return NextResponse.json({ error: "channel must be wechat, feishu or lark" }, { status: 400 });
    }
    const channel = id as ScannableChannelId;
    if (action === "register-cancel") {
      cancelRegistration(channel);
      return NextResponse.json({ ok: true, channels: statuses() });
    }
    if (action === "register-begin") {
      const started = await beginRegistration(channel);
      if (!started.ok) return NextResponse.json({ error: started.error }, { status: 400 });
      return NextResponse.json(started, { headers: { "Cache-Control": "no-store" } });
    }
    const polled = await pollRegistration(channel);
    if (!polled.ok) return NextResponse.json({ error: polled.error }, { status: 400 });
    if (polled.status === "success") {
      // 凭证落盘：0600，绝不再回给浏览器（只回状态）。
      const config = readBotChannelConfig();
      const { credentials } = polled;
      const entry = mergeEntry(config.channels[channel], {
        token: credentials.token,
        ...(credentials.appId ? { appId: credentials.appId } : {}),
        ...(credentials.botUserId ? { botUserId: credentials.botUserId } : {}),
      });
      const next: BotChannelConfig = { version: 1, channels: { ...config.channels, [channel]: entry } };
      writeBotChannelConfig(next);
      return NextResponse.json({ ok: true, status: "success", appName: credentials.appName ?? null, channels: statuses() });
    }
    return NextResponse.json(polled, { headers: { "Cache-Control": "no-store" } });
  }

  const id = body.channel;
  if (action !== "status" && !isChannelId(id)) {
    return NextResponse.json({ error: "channel is required" }, { status: 400 });
  }
  const channel = isChannelId(id) ? id : null;

  if (action === "save" && channel) {
    const config = readBotChannelConfig();
    const entry = mergeEntry(config.channels[channel], body);
    writeBotChannelConfig({ version: 1, channels: { ...config.channels, [channel]: entry } });
    return NextResponse.json({ ok: true, channels: statuses() });
  }

  if (action === "start" && channel) {
    // 让渠道用**这个进程自己**的地址回环调用：端口是浏览器正在用的那个，不用猜默认值。
    const result = await startBotChannel(channel, { deliverUrl: `${new URL(req.url).origin}/api/agent/` });
    if (!result.ok) return NextResponse.json({ error: result.error, channels: statuses() }, { status: result.status ?? 400 });
    return NextResponse.json({ ok: true, channels: statuses() });
  }

  if (action === "stop" && channel) {
    stopBotChannel(channel);
    return NextResponse.json({ ok: true, channels: statuses() });
  }

  return NextResponse.json({ channels: statuses() }, { headers: { "Cache-Control": "no-store" } });
}
