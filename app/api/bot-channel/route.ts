import { NextResponse } from "next/server";

import {
  CHANNELS,
  channelReadiness,
  readChatChannelConfig,
  writeChatChannelConfig,
  type ChatChannelId,
} from "@/lib/chat-channel";
import {
  startChatChannel,
  stopChatChannel,
} from "@/lib/bot-channel-runtime";
import { telegramApiBase } from "@/lib/telegram-channel";
import {
  beginRegistration,
  cancelRegistration,
  pollRegistration,
  type ScannableChannelId,
} from "@/lib/chat-channel-register";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/** 能扫码接入的渠道（微信 iLink / 飞书与 Lark 的 device-flow 一键建应用）。 */
const SCANNABLE: readonly ScannableChannelId[] = ["wechat", "feishu", "lark"];

/**
 * GET /api/bot-channel —— 右栏那一片：每个渠道的规格 + 当前配置 + 在跑没有。
 * POST /api/bot-channel —— 配渠道 / 扫码注册 / 启动 / 停止。
 *
 * 启动一个渠道 = 起一个**进程内长轮询/长连接循环**（telegram 与 weixin 长轮询、
 * feishu 官方 SDK 的 WebSocket），所以状态只在内存里。
 *
 * fork:bot-channel-autostart（2026-10-06）—— 这里原来写着「重启进程后不会自己回来
 * —— 界面上如实显示未运行」。用户实拍后推翻：那意味着每次改代码 / 重启都静默断掉，
 * 表现就是「绑定了，发消息没有任何回应」。现在启动 / 停止的实现搬到
 * `lib/bot-channel-runtime.ts`，与 `instrumentation-node.ts` 的启动器共用一份；
 * `enabled` 字段从此就是「**该不该在跑**」。
 */
export async function GET() {
  const config = readChatChannelConfig();
  const { chatChannelRunners } = await import("@/lib/telegram-channel");
  const running = chatChannelRunners();
  return NextResponse.json({
    channels: CHANNELS.map((spec) => {
      const readiness = channelReadiness(spec.id, config);
      const entry = config.channels[spec.id];
      return {
        ...spec,
        // 只回「有没有配」，绝不回 token / secret。
        configured: Boolean(entry?.token),
        hasChatId: Boolean(entry?.chatId),
        hasAppId: Boolean(entry?.appId),
        sessionId: entry?.sessionId ?? "",
        allowCount: entry?.allowFrom?.length ?? 0,
        ready: readiness.ready,
        missing: readiness.missing,
        running: running.has(spec.id),
      };
    }),
    apiBase: telegramApiBase(),
  });
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  let body: {
    action?: unknown; id?: unknown; token?: unknown; chatId?: unknown; appId?: unknown;
    sessionId?: unknown; allowFrom?: unknown;
  };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const rawId = typeof body.id === "string" ? body.id : "";
  const spec = CHANNELS.find((entry) => entry.id === rawId);
  if (!spec) {
    return NextResponse.json({ error: `Unknown channel: ${rawId}` }, { status: 400 });
  }
  const id: ChatChannelId = spec.id;
  const config = readChatChannelConfig();
  const current = config.channels[id] ?? { allowFrom: [], enabled: true };

  if (body.action === "configure") {
    const token = typeof body.token === "string" ? body.token.trim() : current.token;
    const chatId = typeof body.chatId === "string" ? body.chatId.trim() : current.chatId;
    const appId = typeof body.appId === "string" ? body.appId.trim() : current.appId;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : current.sessionId;
    const allowFrom = Array.isArray(body.allowFrom)
      ? body.allowFrom.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
      : current.allowFrom;
    writeChatChannelConfig({
      version: 1,
      channels: { ...config.channels, [id]: { ...current, ...(token ? { token } : {}), ...(chatId ? { chatId } : {}), ...(appId ? { appId } : {}), ...(sessionId ? { sessionId } : {}), allowFrom } },
    });
    return NextResponse.json({ ok: true, configured: true });
  }

  // fork:bot-channel 扫码注册 —— 微信 iLink / 飞书 device-flow。二维码内容串与
  // device_code 由 lib/chat-channel-register.ts 的 globalThis registry 跨请求持有。
  if (body.action === "register-begin") {
    if (!SCANNABLE.includes(id as ScannableChannelId)) {
      return NextResponse.json({ error: `${id} does not support scan registration` }, { status: 400 });
    }
    const result = await beginRegistration(id as ScannableChannelId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }
    return NextResponse.json(result);
  }

  if (body.action === "register-poll") {
    if (!SCANNABLE.includes(id as ScannableChannelId)) {
      return NextResponse.json({ error: `${id} does not support scan registration` }, { status: 400 });
    }
    const result = await pollRegistration(id as ScannableChannelId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error, status: result.status ?? "error" }, { status: 502 });
    }
    if (result.status === "success") {
      const credentials = result.credentials;
      /* fork:bot-channel-allowlist（2026-10-06 用户实拍「微信发了没有回应」）——
         只有**飞书 / Lark** 的 `botUserId` 是「扫码那个人自己的 open_id」，预置成白名单
         是对的（扫码的人就是主人）。
         **微信的 `botUserId` 是 bot 自己的 `ilink_bot_id`（`…@im.bot`）**：写进白名单
         等于「允许 bot 自己驱动 agent」，而且因为列表非空，真人第一条消息再也不会被
         runner 的「首个发信人自动绑定」接住 —— 表现就是「发什么都没回应」。
         微信保持空列表，交给 runner 自己绑定。 */
      const seedOwner = id === "feishu" || id === "lark";
      const allowFrom = seedOwner && credentials.botUserId && current.allowFrom.length === 0
        ? [credentials.botUserId]
        : current.allowFrom;
      writeChatChannelConfig({
        version: 1,
        channels: {
          ...config.channels,
          [id]: {
            ...current,
            token: credentials.token,
            ...(credentials.appId ? { appId: credentials.appId } : {}),
            ...(credentials.botUserId ? { botUserId: credentials.botUserId } : {}),
            allowFrom,
          },
        },
      });
      return NextResponse.json({ ok: true, status: "success", configured: true });
    }
    return NextResponse.json(result);
  }

  if (body.action === "register-cancel") {
    if (SCANNABLE.includes(id as ScannableChannelId)) cancelRegistration(id as ScannableChannelId);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "stop") {
    stopChatChannel(id);
    return NextResponse.json({ ok: true, running: false });
  }

  if (body.action === "start") {
    const result = await startChatChannel(id, config);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status ?? 500 });
    }
    // 记下「该不该在跑」：下次进程启动由启动器自动拉起（stop 会把这一位写回 false）。
    const fresh = readChatChannelConfig();
    const channel = fresh.channels[id];
    if (channel && channel.enabled === false) {
      writeChatChannelConfig({
        version: 1,
        channels: { ...fresh.channels, [id]: { ...channel, enabled: true } },
      });
    }
    return NextResponse.json({ ok: true, running: true });
  }

  return NextResponse.json({ error: "action must be configure | register-begin | register-poll | register-cancel | start | stop" }, { status: 400 });
}
