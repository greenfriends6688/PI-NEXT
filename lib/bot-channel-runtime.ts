/**
 * fork:bot-channel-autostart —— 渠道运行时的**唯一一份**启动 / 停止实现。
 *
 * 原来它整段写在 `app/api/bot-channel/route.ts` 的 POST 分支里，只有浏览器点「启动」
 * 才会跑。结果是：**渠道是进程内的长轮询循环，每次重启进程（改代码、`npm run prod`、
 * 崩溃重启）它都悄悄消失**，而界面上只显示「未运行」—— 用户看到的现象就是
 * 「我绑定了，发消息却没有任何回应」（2026-10-06 用户实拍）。
 *
 * 现在 route 与进程启动器（`instrumentation-node.ts`）共用这一份：
 * - `enabled` 字段从此有真语义 = 「**该不该在跑**」：start 写 true、stop 写 false，
 *   启动时按它自动拉起。显式停掉的渠道不会在下次开机自己回来。
 * - 启动器只拉起 `enabled !== false` 且 `channelReadiness().ready` 的渠道；
 *   任何一条起不来只打日志，不影响 Pi Web 本身可用。
 */

import {
  CHANNELS,
  channelReadiness,
  readChatChannelConfig,
  readChatChannelState,
  writeChatChannelConfig,
  writeChatChannelState,
  type ChatChannelConfig,
  type ChatChannelId,
} from "./chat-channel";
import { chatChannelRunners, startTelegramRunner } from "./telegram-channel";
import { startWeixinRunner } from "./weixin-channel";
import { startFeishuRunner } from "./feishu-channel";

/** 环境变量：把出站/入站的回复投到别处（测试与「先跑通再接真平台」用）。 */
const REPLY_ENDPOINT = process.env.PI_BOT_CHANNEL_DELIVER_URL;

/** 等这一轮跑完的轮询间隔与上限。够跑完一次普通对话，不够跑一次长任务。 */
export const SETTLE_POLL_MS = 700;
export const SETTLE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 把一条聊天消息交给会话，并把**这一轮 assistant 的最后一段话**带回来。
 *
 * 走的是既有 RPC 面（`POST /api/agent/<id>` 的 prompt / get_state /
 * get_last_assistant_text），与浏览器发消息同一条路 —— 不另开一套 agent 通道，
 * 少一份生命周期、少一处行为漂移。
 */
export async function runOnce(deliverUrl: string, sessionId: string, text: string): Promise<string> {
  /* fork:bot-channel-chat-workspace（2026-10-06）—— 没绑会话时落到**聊天工作区**
     （`~/pi-web-chat`），不是「最近活跃的那个会话」—— 后者会让一条手机消息掉进
     你正开着的任意项目会话里。详见 `chatWorkspaceSessionId` 的注释。 */
  const target = sessionId || await chatWorkspaceSessionId(deliverUrl);
  if (!target) return "Could not open the chat workspace for this channel. Try again, or pick a session in Settings → Phone & push.";

  const post = async (body: Record<string, unknown>) => {
    const response = await fetch(`${deliverUrl}${encodeURIComponent(target)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as { error?: string; data?: unknown };
    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
    return payload.data;
  };

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

function deliverUrl(): string {
  return REPLY_ENDPOINT ?? `http://127.0.0.1:${process.env.PORT ?? 30141}/api/agent/`;
}

/**
 * 渠道消息没绑会话时，落到**聊天工作区**（`~/pi-web-chat`），不是「最近活跃的那个会话」。
 *
 * fork:bot-channel-chat-workspace（2026-10-06 用户裁定）—— 原实现是
 * `latestSessionId()`：取 `listAllSessions()` 里最新的一条顶层会话。后果是
 * **一条微信消息会掉进你上次开着的那个项目会话里** —— 你可能正在改代码，
 * 手机上随手问一句，它就接在那一轮代码对话后面。用户原话：「发送到活跃的对话里，
 * 这不是傻逼行为吗」。
 *
 * 本仓已经有「不在项目里的对话」这个概念（`lib/chat-workspace.ts`，`~/pi-web-chat`，
 * 可在设置里改），所以正确的去处就是它：**一个专门的文件夹**，与任何项目都无关。
 * ZCode 参考项目也是这个形状（bot 绑定 workspace → 再选 task），不是绑定「当前活跃」。
 *
 * 工作区里还没有会话时**现建一个** —— 走 `POST /api/agent/new`（UI「新建会话」同一条
 * 路由），不另开一条创建路径，也不要求用户先去界面里点一下。
 */
async function chatWorkspaceSessionId(deliverUrl: string): Promise<string> {
  try {
    const [{ listAllSessions }, { ensureChatWorkspace, isChatWorkspacePath }] = await Promise.all([
      import("./session-reader"),
      import("./chat-workspace"),
    ]);
    const sessions = await listAllSessions();
    // 子代理会话不算：往它里面注入 prompt 是错的。
    const existing = sessions.find(
      (session) => session.relation?.kind !== "subagent" && isChatWorkspacePath(session.cwd),
    );
    if (existing) return existing.id;

    const cwd = ensureChatWorkspace();
    const response = await fetch(new URL("new", deliverUrl).toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd }),
    });
    const payload = await response.json() as { sessionId?: string };
    if (!response.ok || !payload.sessionId) {
      console.warn("[bot-channel] could not create the chat-workspace session:", response.status);
      return "";
    }
    return payload.sessionId;
  } catch (error) {
    console.warn("[bot-channel] could not resolve the chat-workspace session:", error instanceof Error ? error.message : String(error));
    return "";
  }
}

/** 落盘 `enabled`（= 该不该在跑）。start / stop 各写一次，启动器按它自动拉起。 */
function setChannelEnabled(id: ChatChannelId, enabled: boolean): void {
  const fresh = readChatChannelConfig();
  const channel = fresh.channels[id];
  if (!channel || channel.enabled === enabled) return;
  writeChatChannelConfig({
    version: 1,
    channels: { ...fresh.channels, [id]: { ...channel, enabled } },
  });
}

export interface StartChannelResult {
  ok: boolean;
  error?: string;
  status?: number;
}

/**
 * 起一个渠道的长轮询 / 长连接循环。**幂等**：已在跑时直接回 ok。
 * 起失败只回错误，不抛。
 */
export async function startChatChannel(
  id: ChatChannelId,
  config: ChatChannelConfig = readChatChannelConfig(),
): Promise<StartChannelResult> {
  const readiness = channelReadiness(id, config);
  if (!readiness.ready) {
    return { ok: false, error: `Not ready: ${readiness.missing.join(", ")}`, status: 409 };
  }
  if (chatChannelRunners().has(id)) return { ok: true };
  const entry = config.channels[id]!;
  if (!entry.token) return { ok: false, error: "token is required", status: 400 };

  const deliver = (sessionId: string, text: string) => runOnce(deliverUrl(), sessionId, text);
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
    if (!entry.chatId) return { ok: false, error: "token and chat id are required", status: 400 };
    chatChannelRunners().set(id, startTelegramRunner({
      token: entry.token,
      chatId: entry.chatId,
      allowFrom: entry.allowFrom,
      sessionId: entry.sessionId ?? "",
      signal: controller.signal,
      onLog,
      deliver,
    }));
    return { ok: true };
  }

  if (id === "wechat") {
    chatChannelRunners().set(id, startWeixinRunner({
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
    }));
    return { ok: true };
  }

  if (id === "feishu" || id === "lark") {
    if (!entry.appId) return { ok: false, error: "app id is required", status: 400 };
    // SDK 缺失时给出用户可见的报错（runner 里动态 import 的失败只进日志）。
    try {
      await import("@larksuiteoapi/node-sdk");
    } catch {
      return { ok: false, error: "@larksuiteoapi/node-sdk is not installed", status: 501 };
    }
    chatChannelRunners().set(id, await startFeishuRunner({
      appId: entry.appId,
      appSecret: entry.token,
      provider: id === "lark" ? "lark" : "feishu",
      allowFrom: entry.allowFrom,
      sessionId: entry.sessionId ?? "",
      signal: controller.signal,
      onLog,
      deliver,
      onBindFirstSender: persistBoundSender,
    }));
    return { ok: true };
  }

  return { ok: false, error: `${id} is not implemented yet`, status: 501 };
}

/** 停一个渠道，并把「该不该在跑」落成 false（下次开机不会自己回来）。 */
export function stopChatChannel(id: ChatChannelId): void {
  chatChannelRunners().get(id)?.stop();
  chatChannelRunners().delete(id);
  setChannelEnabled(id, false);
}

/**
 * 进程启动时按配置自动拉起。**只打日志、不抛** —— 渠道起不来不影响 Pi Web 本身。
 * 幂等：同一个进程重复调用（dev 的 instrumentation 会重跑）第二次直接返回。
 */
export async function startConfiguredChatChannels(): Promise<void> {
  const config = readChatChannelConfig();
  for (const spec of CHANNELS) {
    const entry = config.channels[spec.id];
    if (!entry || entry.enabled === false) continue;
    const readiness = channelReadiness(spec.id, config);
    if (!readiness.ready) {
      console.warn(`[bot-channel] ${spec.id} is configured but not ready: ${readiness.missing.join(", ")}`);
      continue;
    }
    try {
      const result = await startChatChannel(spec.id, config);
      console.warn(result.ok
        ? `[bot-channel] ${spec.id} started on boot`
        : `[bot-channel] ${spec.id} did not start: ${result.error}`);
    } catch (error) {
      console.warn(`[bot-channel] ${spec.id} failed to start: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
