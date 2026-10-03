/**
 * fork:bot-channel —— 扫码注册的**在途会话**（weixin / feishu / lark 共用一份 registry）。
 *
 * 注册是两步交互（begin 出二维码 → 前端隔几秒来 poll），状态必须**跨请求**活着：
 * Next.js 热重载会重建模块，所以挂在 `globalThis`（与 `lib/lan-pair.ts` 的配对码同款做法）。
 * 每个渠道同一时间只有一场注册 —— 再点「扫码」就覆盖旧的；过期即废。
 *
 * registry 只存**非凭证**内容（二维码内容串、device_code、过期时间）。真正换来的
 * bot_token / app_secret 在 poll 成功时由 route 直接写进 `chat-channels.json`（0600），
 * 不在内存里多留一份。
 */

import { feishuBeginRegistration, feishuPollRegistration, type FeishuRegistrationPoll } from "./feishu-channel";
import { weixinBeginRegistration, weixinPollRegistration, type WeixinRegistrationPoll } from "./weixin-channel";

export type ScannableChannelId = "wechat" | "feishu" | "lark";

export interface ChatChannelRegistration {
  provider: ScannableChannelId;
  /** 二维码要画的内容（微信 iLink 串 / 飞书 verification_uri_complete）。 */
  qrContent: string;
  /** 微信 = qrcode（轮询 key）；飞书 = device_code。 */
  secret: string;
  expiresAt: number;
  intervalSeconds: number;
  /** 飞书 poll 阶段按 tenant_brand 换域（feishu → lark）。 */
  pollDomain?: "feishu" | "lark";
}

export type RegistrationBeginResult =
  | { ok: true; qrContent: string; expiresInSeconds: number; intervalSeconds: number }
  | { ok: false; error: string };

export type RegistrationPollResult =
  | { ok: true; status: "pending" | "scanned"; intervalSeconds: number }
  | { ok: true; status: "expired" }
  | { ok: true; status: "success"; credentials: RegistrationCredentials }
  | { ok: false; error: string; status?: "error" };

/** poll 成功时交给 route 落盘的凭证。 */
export interface RegistrationCredentials {
  provider: ScannableChannelId;
  /** 微信 bot_token / 飞书 app_secret —— 都进 `chat-channels.json` 的 token 字段。 */
  token: string;
  /** 飞书 client_id；微信没有对应物（bot id 走 botUserId）。 */
  appId?: string;
  /** 微信 ilink_bot_id / 飞书扫码人的 open_id（自动绑定的白名单第一人）。 */
  botUserId?: string;
  appName?: string;
}

const REGISTRY_KEY = Symbol.for("pi-web.chatChannelRegistrations");
const REGISTRY_TTL_MS = 15 * 60_000;

function registry(): Map<string, ChatChannelRegistration> {
  const holder = globalThis as unknown as Record<symbol, Map<string, ChatChannelRegistration> | undefined>;
  const existing = holder[REGISTRY_KEY];
  if (existing) return existing;
  const created = new Map<string, ChatChannelRegistration>();
  holder[REGISTRY_KEY] = created;
  return created;
}

export function currentRegistration(id: ScannableChannelId): ChatChannelRegistration | null {
  const session = registry().get(id);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    registry().delete(id);
    return null;
  }
  return session;
}

export function cancelRegistration(id: ScannableChannelId): void {
  registry().delete(id);
}

/** 第一步：起一场注册，拿二维码内容。同渠道旧会话直接覆盖。 */
export async function beginRegistration(
  id: ScannableChannelId,
  options: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<RegistrationBeginResult> {
  try {
    if (id === "wechat") {
      const begin = await weixinBeginRegistration(options);
      registry().set(id, {
        provider: id,
        qrContent: begin.qrContent,
        secret: begin.qrCode,
        expiresAt: Date.now() + begin.expiresInSeconds * 1000,
        intervalSeconds: 3,
      });
      return { ok: true, qrContent: begin.qrContent, expiresInSeconds: begin.expiresInSeconds, intervalSeconds: 3 };
    }
    const begin = await feishuBeginRegistration(options);
    registry().set(id, {
      provider: id,
      qrContent: begin.qrContent,
      secret: begin.deviceCode,
      expiresAt: Date.now() + begin.expiresInSeconds * 1000,
      intervalSeconds: begin.intervalSeconds,
      pollDomain: "feishu",
    });
    return { ok: true, qrContent: begin.qrContent, expiresInSeconds: begin.expiresInSeconds, intervalSeconds: begin.intervalSeconds };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 第二步：轮询。飞书 poll 换域（tenant_brand=lark）时更新会话里的 pollDomain，
 * 下一轮打到 accounts.larksuite.com。
 */
export async function pollRegistration(
  id: ScannableChannelId,
  options: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<RegistrationPollResult> {
  const session = currentRegistration(id);
  if (!session) return { ok: true, status: "expired" };
  try {
    if (session.provider === "wechat") {
      const poll: WeixinRegistrationPoll = await weixinPollRegistration(session.secret, options);
      if (poll.status === "success" && poll.botToken) {
        registry().delete(id);
        return {
          ok: true,
          status: "success",
          credentials: { provider: "wechat", token: poll.botToken, ...(poll.botId ? { botUserId: poll.botId } : {}) },
        };
      }
      if (poll.status === "expired") {
        registry().delete(id);
        return { ok: true, status: "expired" };
      }
      if (poll.status === "error") {
        registry().delete(id);
        return { ok: false, error: poll.message ?? "Weixin registration failed", status: "error" };
      }
      return { ok: true, status: poll.status === "scanned" ? "scanned" : "pending", intervalSeconds: poll.intervalSeconds };
    }
    const domain = session.pollDomain ?? "feishu";
    const poll: FeishuRegistrationPoll = await feishuPollRegistration(session.secret, domain, options);
    if (poll.pollDomain && poll.pollDomain !== domain) {
      registry().set(id, { ...session, pollDomain: poll.pollDomain });
    }
    if (poll.status === "success" && poll.appId && poll.appSecret) {
      registry().delete(id);
      return {
        ok: true,
        status: "success",
        credentials: {
          provider: session.provider,
          token: poll.appSecret,
          appId: poll.appId,
          ...(poll.openId ? { botUserId: poll.openId } : {}),
          ...(poll.appName ? { appName: poll.appName } : {}),
        },
      };
    }
    if (poll.status === "expired") {
      registry().delete(id);
      return { ok: true, status: "expired" };
    }
    if (poll.status === "error") {
      registry().delete(id);
      return { ok: false, error: poll.message ?? "Feishu registration failed", status: "error" };
    }
    if (poll.status === "access_denied") {
      registry().delete(id);
      return { ok: false, error: "Feishu authorization was denied", status: "error" };
    }
    return { ok: true, status: "pending", intervalSeconds: poll.intervalSeconds };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), status: "error" };
  }
}
