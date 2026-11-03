import { NextResponse } from "next/server";

import { readBotChannelConfig, type BotChannelEntry } from "@/lib/bot-channel";
import { bindFirstSender, isBotChannelRunning } from "@/lib/bot-channel-runtime";
import { newBotSession, runPromptAndWait } from "@/lib/bot-channel-delivery";
import {
  parseWecomCallback,
  readXmlField,
  wecomDecrypt,
  wecomSendText,
  wecomSignatureMatches,
} from "@/lib/wecom-channel";

export const dynamic = "force-dynamic";

/**
 * 企业微信的回调端点（`<公网 HTTPS 地址>/api/bot-channel/wecom`）。
 *
 * - **GET** 是企微保存回调时做的地址校验：解出 `echostr` 原样回纯文本。
 * - **POST** 是消息：验签 → 解 XML → 交给会话 → 用应用消息把答复发回去。
 *
 * 企微要求 **5 秒内**应答，而一轮 agent 可能要跑几分钟，所以回执立刻回（空串），
 * 交付异步进行 —— 答复到的时候用服务端 API 发到发信人那里。
 *
 * 只有**在跑**的渠道才接受回调：停掉之后旧隧道的请求不该继续驱动 agent。
 */
function entryOrNull(): BotChannelEntry | null {
  if (!isBotChannelRunning("wecom")) return null;
  const entry = readBotChannelConfig().channels.wecom;
  if (!entry?.token || !entry.appId || !entry.agentId || !entry.callbackToken || !entry.callbackAesKey) return null;
  return entry;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const signature = url.searchParams.get("msg_signature") ?? "";
  const timestamp = url.searchParams.get("timestamp") ?? "";
  const nonce = url.searchParams.get("nonce") ?? "";
  const echostr = url.searchParams.get("echostr") ?? "";
  const entry = entryOrNull();
  if (!entry || !echostr) return new NextResponse("forbidden", { status: 403 });
  try {
    // 签名覆盖的是 encrypted echostr 本身；验过再解，别拿它当解密 oracle。
    if (signature && !wecomSignatureMatches(entry.callbackToken!, timestamp, nonce, echostr, signature)) {
      return new NextResponse("forbidden", { status: 403 });
    }
    const plain = wecomDecrypt(echostr, entry.callbackAesKey!, entry.appId);
    return new NextResponse(plain, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch (error) {
    console.warn("[bot-channel:wecom] callback verification failed:", error instanceof Error ? error.message : String(error));
    return new NextResponse("bad request", { status: 400 });
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const entry = entryOrNull();
  if (!entry) return new NextResponse("", { status: 200 });

  let body = "";
  try {
    body = await req.text();
  } catch {
    return new NextResponse("", { status: 200 });
  }
  const encrypt = readXmlField(body, "Encrypt");
  const signature = url.searchParams.get("msg_signature") ?? encrypt ?? "";

  // 验签失败一律当没发生：回 200 空串，不把「签名不对」告诉扫描者。
  const inbound = (() => {
    try {
      return parseWecomCallback({
        token: entry.callbackToken!,
        encodingAesKey: entry.callbackAesKey!,
        corpId: entry.appId,
        signature,
        timestamp: url.searchParams.get("timestamp") ?? "",
        nonce: url.searchParams.get("nonce") ?? "",
        body,
      });
    } catch (error) {
      console.warn("[bot-channel:wecom] callback refused:", error instanceof Error ? error.message : String(error));
      return null;
    }
  })();
  if (!inbound) return new NextResponse("", { status: 200 });

  // 白名单 fail closed：空 = 首个发信人自动绑定（回一句欢迎语，不当指令跑）。
  const current = readBotChannelConfig().channels.wecom ?? entry;
  if (!current.allowFrom.includes(inbound.senderId)) {
    if (current.allowFrom.length === 0) {
      bindFirstSender("wecom", inbound.senderId);
      void wecomSendText(entry.appId!, entry.token!, entry.agentId!, inbound.senderId,
        "已连接。这条消息的发送者现在绑定到 agent 了，直接发消息即可。");
      return new NextResponse("", { status: 200 });
    }
    return new NextResponse("", { status: 200 });
  }

  // 回执先走，交付后跑（企微 5 秒的时限）。
  const origin = new URL(req.url).origin;
  void (async () => {
    try {
      const sessionId = current.sessionId || await newBotSession(`${origin}/api/agent/`);
      if (!sessionId) {
        await wecomSendText(entry.appId!, entry.token!, entry.agentId!, inbound.senderId, "打不开会话，稍后再试。");
        return;
      }
      const reply = await runPromptAndWait(`${origin}/api/agent/`, sessionId, inbound.text);
      const outcome = await wecomSendText(entry.appId!, entry.token!, entry.agentId!, inbound.senderId, reply || "(无回复)");
      if (!outcome.ok) console.warn("[bot-channel:wecom] reply failed:", outcome.detail);
    } catch (error) {
      console.warn("[bot-channel:wecom] deliver failed:", error instanceof Error ? error.message : String(error));
    }
  })();

  return new NextResponse("", { status: 200 });
}
