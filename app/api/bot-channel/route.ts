import { NextResponse } from "next/server";

import {
  CHANNELS,
  channelReadiness,
  readChatChannelConfig,
  readChatChannelState,
  writeChatChannelConfig,
  writeChatChannelState,
  type ChatChannelId,
} from "@/lib/chat-channel";
import { startTelegramRunner, telegramApiBase } from "@/lib/telegram-channel";
import { startWeixinRunner } from "@/lib/weixin-channel";
import { startFeishuRunner } from "@/lib/feishu-channel";
import {
  beginRegistration,
  cancelRegistration,
  pollRegistration,
  type ScannableChannelId,
} from "@/lib/chat-channel-register";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

/** 环境变量：把出站/入站的回复投到别处（测试与「先跑通再接真平台」用）。 */
const REPLY_ENDPOINT = process.env.PI_BOT_CHANNEL_DELIVER_URL;

/** 能扫码接入的渠道（微信 iLink / 飞书与 Lark 的 device-flow 一键建应用）。 */
const SCANNABLE: readonly ScannableChannelId[] = ["wechat", "feishu", "lark"];

/**
 * GET /api/bot-channel —— 右栏那一片：每个渠道的规格 + 当前配置 + 在跑没有。
 * POST /api/bot-channel —— 配渠道 / 扫码注册 / 启动 / 停止。
 *
 * 启动一个渠道 = 起一个**进程内长轮询/长连接循环**（telegram 与 weixin 长轮询、
 * feishu 官方 SDK 的 WebSocket），所以状态只在内存里；重启进程后不会自己回来 ——
 * 界面上如实显示「未运行」，而不是假装它还连着。
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
  const { chatChannelRunners } = await import("@/lib/telegram-channel");

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
      const allowFrom = credentials.botUserId && current.allowFrom.length === 0
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
    chatChannelRunners().get(id)?.stop();
    chatChannelRunners().delete(id);
    return NextResponse.json({ ok: true, running: false });
  }

  if (body.action === "start") {
    const readiness = channelReadiness(id, config);
    if (!readiness.ready) {
      return NextResponse.json({ error: `Not ready: ${readiness.missing.join(", ")}` }, { status: 409 });
    }
    if (chatChannelRunners().has(id)) {
      return NextResponse.json({ ok: true, running: true, alreadyRunning: true });
    }
    const entry = config.channels[id]!;
    if (!entry.token) {
      return NextResponse.json({ error: "token is required" }, { status: 400 });
    }

    // 交付通道：默认走本机的 agent RPC 面（和浏览器发消息同一条路）。
    const deliverUrl = REPLY_ENDPOINT ?? `http://127.0.0.1:${process.env.PORT ?? 30141}/api/agent/`;
    const deliver = (sessionId: string, text: string) => runOnce(deliverUrl, sessionId, text);
    // 首发信人自动绑定：runner 已把人 push 进 entry.allowFrom（内存），这里负责落盘。
    const persistBoundSender = (senderId: string) => {
      const fresh = readChatChannelConfig();
      const channel = fresh.channels[id];
      if (!channel) return;
      writeChatChannelConfig({
        version: 1,
        channels: { ...fresh.channels, [id]: { ...channel, allowFrom: [...new Set([...channel.allowFrom, senderId])] } },
      });
    };
    const onLog = (line: string) => console.warn("[bot-channel]", line);
    const controller = new AbortController();

    if (id === "telegram") {
      if (!entry.chatId) {
        return NextResponse.json({ error: "token and chat id are required" }, { status: 400 });
      }
      const handle = startTelegramRunner({
        token: entry.token,
        chatId: entry.chatId,
        allowFrom: entry.allowFrom,
        sessionId: entry.sessionId ?? "",
        signal: controller.signal,
        onLog,
        deliver,
      });
      chatChannelRunners().set(id, handle);
      return NextResponse.json({ ok: true, running: true });
    }

    if (id === "wechat") {
      const handle = startWeixinRunner({
        token: entry.token,
        fromBotId: entry.botUserId ?? "",
        allowFrom: entry.allowFrom,
        sessionId: entry.sessionId ?? "",
        signal: controller.signal,
        onLog,
        deliver,
        onBindFirstSender: persistBoundSender,
        onCursor: (buf) => writeChatChannelState({ weixinGetUpdatesBuf: buf }),
        initialBuf: readChatChannelState().weixinGetUpdatesBuf ?? "",
      });
      chatChannelRunners().set(id, handle);
      return NextResponse.json({ ok: true, running: true });
    }

    if (id === "feishu" || id === "lark") {
      if (!entry.appId) {
        return NextResponse.json({ error: "app id is required" }, { status: 400 });
      }
      // SDK 缺失时给出用户可见的报错（runner 里动态 import 的失败只进日志）。
      try {
        await import("@larksuiteoapi/node-sdk");
      } catch {
        return NextResponse.json({ error: "@larksuiteoapi/node-sdk is not installed" }, { status: 501 });
      }
      const handle = await startFeishuRunner({
        appId: entry.appId,
        appSecret: entry.token,
        provider: id === "lark" ? "lark" : "feishu",
        allowFrom: entry.allowFrom,
        sessionId: entry.sessionId ?? "",
        signal: controller.signal,
        onLog,
        deliver,
        onBindFirstSender: persistBoundSender,
      });
      chatChannelRunners().set(id, handle);
      return NextResponse.json({ ok: true, running: true });
    }

    return NextResponse.json({ error: `${id} is not implemented yet` }, { status: 501 });
  }

  return NextResponse.json({ error: "action must be configure | register-begin | register-poll | register-cancel | start | stop" }, { status: 400 });
}

/** 等这一轮跑完的轮询间隔与上限。够跑完一次普通对话，不够跑一次长任务。 */
const SETTLE_POLL_MS = 700;
const SETTLE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 把一条聊天消息交给会话，并把**这一轮 assistant 的最后一段话**带回来。
 *
 * 走的是既有 RPC 面（`POST /api/agent/<id>` 的 prompt / get_state /
 * get_last_assistant_text），与浏览器发消息同一条路 —— 不另开一套 agent 通道，
 * 少一份生命周期、少一处行为漂移。
 */
async function runOnce(deliverUrl: string, sessionId: string, text: string): Promise<string> {
  const post = async (body: Record<string, unknown>) => {
    const response = await fetch(`${deliverUrl}${encodeURIComponent(sessionId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as { error?: string; data?: unknown };
    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
    return payload.data;
  };

  if (!sessionId) return "No session is bound to this channel yet. Pick one in Settings → Phone & push.";

  // **注入前先看这个会话是不是正在跑。**
  //
  // 这条不是假想：实测把渠道绑到一个**人正在用的**会话上时，机器人的消息会直接插进
  // 那一轮对话里，把人正在进行的操作冲掉（用户 2026-10-03 亲眼在聊天里看到了这条）。
  // 所以正在跑就**不注入**，只回一句「它现在在忙」，让人自己决定什么时候放机器人进来。
  const before = await post({ type: "get_state" }) as { isStreaming?: boolean } | null;
  if (before?.isStreaming === true) {
    return "That session is running a turn right now — not injecting into it. Try again when it settles.";
  }

  // 字段名与浏览器发消息那条路一致：是 `message`，不是 `text`
  // （`hooks/useAgentSession.ts` 的 sendAgentCommand({type:"prompt", message})）。
  await post({ type: "prompt", message: text });

  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
    const state = await post({ type: "get_state" }) as { isStreaming?: boolean } | null;
    if (state && state.isStreaming === false) break;
  }

  const final = await post({ type: "get_last_assistant_text" }) as { text?: string } | string | null;
  const reply = typeof final === "string" ? final : final?.text;
  return (reply ?? "").trim() || "(no reply)";
}
