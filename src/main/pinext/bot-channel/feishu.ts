/**
 * fork:bot-channel —— **飞书 / Lark 渠道的真实现**（扫码一键建应用 + 官方 SDK 长连接）。
 *
 * 协议逐字对拍 ZCode 的实现（`pi参考项目/ZCode-main/packages/services/src/bots/providers/`
 * 下的 `feishuAppRegistration.ts` 与 `feishuProvider.ts`）：
 *
 * - **注册**：`accounts.feishu.cn/oauth/v1/app/registration` 的 device-flow 三步
 *   （init → begin → poll），**不用预先在开放平台建应用** —— `archetype: "PersonalAgent"`
 *   会现建一个自建应用并把 `client_id`/`client_secret` 直接发回来；二维码内容就是
 *   `verification_uri_complete`。Lark（国际站）租户在 poll 阶段按 `tenant_brand` 切到
 *   `accounts.larksuite.com`。
 * - **收消息**：官方 `@larksuiteoapi/node-sdk` 的 `WSClient`（WebSocket 长连接，握手/心跳/
 *   重连全在 SDK 里）—— 自己手写网关帧协议不划算，这也是 ZCode 的选择。SDK 在
 *   `startFeishuRunner` 里**动态 import**：浏览器依赖图永远看不到它，没装包时给出明确报错。
 * - **发消息**：普通 REST —— `tenant_access_token`（缓存 90 分钟）+
 *   `POST /open-apis/im/v1/messages?receive_id_type=…`（`oc_` 开头是群 chat_id，否则 open_id）。
 */

/** 可覆盖只是为了测试打桩；默认值是两套官方账号域。 */
export function feishuAccountsBase(domain: "feishu" | "lark", env: NodeJS.ProcessEnv = process.env): string {
  const fallback = domain === "lark" ? "https://accounts.larksuite.com" : "https://accounts.feishu.cn";
  return (env.FEISHU_ACCOUNTS_BASE_URL ?? fallback).replace(/\/+$/, "");
}

export function feishuOpenApiBase(provider: "feishu" | "lark"): string {
  return provider === "lark" ? "https://open.larksuite.com" : "https://open.feishu.cn";
}

const REGISTRATION_PATH = "/oauth/v1/app/registration";
const REGISTRATION_TIMEOUT_MS = 10_000;
/** 与 ZCode 同款：注册服务的来源标识 —— 平台对已知客户端放行，不乱改这个值。 */
const REGISTRATION_SOURCE = "node-sdk/zcode";
export const FEISHU_POLL_INTERVAL_SECONDS = 5;

async function postRegistration<T extends Record<string, unknown>>(
  domain: "feishu" | "lark",
  body: Record<string, string>,
  doFetch: typeof fetch,
  env?: NodeJS.ProcessEnv,
): Promise<T> {
  const response = await doFetch(`${feishuAccountsBase(domain, env)}${REGISTRATION_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(REGISTRATION_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Feishu registration failed: HTTP ${response.status}`);
  return await response.json() as T;
}

export interface FeishuRegistrationBegin {
  deviceCode: string;
  /** 二维码要画的内容（登录授权页的完整链接，已追加来源参数）。 */
  qrContent: string;
  userCode?: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

/** 第一步：init（确认环境支持 client_secret 注册）→ begin（拿 device_code 与二维码链接）。 */
export async function feishuBeginRegistration(
  options: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<FeishuRegistrationBegin> {
  const doFetch = options.fetchImpl ?? fetch;
  const init = await postRegistration<Record<string, unknown>>("feishu", { action: "init" }, doFetch, options.env);
  const methods = init.supported_auth_methods;
  if (Array.isArray(methods) && !methods.includes("client_secret")) {
    throw new Error("Current Feishu environment does not support client_secret registration.");
  }
  const begin = await postRegistration<Record<string, unknown>>("feishu", {
    action: "begin",
    archetype: "PersonalAgent",
    auth_method: "client_secret",
    request_user_info: "open_id",
  }, doFetch, options.env);
  const deviceCode = typeof begin.device_code === "string" ? begin.device_code : "";
  const verificationUri = typeof begin.verification_uri_complete === "string" ? begin.verification_uri_complete : "";
  if (!deviceCode || !verificationUri) {
    throw new Error("Feishu app registration did not return a device code.");
  }
  const qrUrl = new URL(verificationUri);
  qrUrl.searchParams.set("from", "sdk");
  qrUrl.searchParams.set("source", REGISTRATION_SOURCE);
  qrUrl.searchParams.set("tp", "sdk");
  const expireIn = typeof begin.expire_in === "number" ? begin.expire_in : 600;
  const interval = typeof begin.interval === "number" && begin.interval > 0 ? begin.interval : FEISHU_POLL_INTERVAL_SECONDS;
  return {
    deviceCode,
    qrContent: qrUrl.toString(),
    userCode: typeof begin.user_code === "string" ? begin.user_code : undefined,
    expiresInSeconds: expireIn,
    intervalSeconds: interval,
  };
}

export type FeishuRegistrationStatus = "pending" | "success" | "access_denied" | "expired" | "error";

export interface FeishuRegistrationPoll {
  status: FeishuRegistrationStatus;
  intervalSeconds: number;
  appId?: string;
  appSecret?: string;
  openId?: string;
  appName?: string;
  message?: string;
  /** 平台判定这是 Lark 租户 —— 下一轮 poll 要换 accounts.larksuite.com。 */
  pollDomain?: "feishu" | "lark";
}

/** 第三步：轮询授权结果。`authorization_pending`/`slow_down` 都是正常等待，不是错误。 */
export async function feishuPollRegistration(
  deviceCode: string,
  domain: "feishu" | "lark",
  options: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<FeishuRegistrationPoll> {
  let payload: Record<string, unknown>;
  try {
    payload = await postRegistration<Record<string, unknown>>(
      domain,
      { action: "poll", device_code: deviceCode },
      options.fetchImpl ?? fetch,
      options.env,
    );
  } catch (error) {
    return { status: "error", intervalSeconds: FEISHU_POLL_INTERVAL_SECONDS, message: error instanceof Error ? error.message : String(error) };
  }
  const userInfo = typeof payload.user_info === "object" && payload.user_info !== null && !Array.isArray(payload.user_info)
    ? payload.user_info as Record<string, unknown>
    : undefined;
  const tenantBrand = userInfo && typeof userInfo.tenant_brand === "string" ? userInfo.tenant_brand : undefined;
  if (tenantBrand === "lark" && domain !== "lark") {
    return { status: "pending", intervalSeconds: 0, pollDomain: "lark" };
  }
  const appId = typeof payload.client_id === "string" ? payload.client_id : "";
  const appSecret = typeof payload.client_secret === "string" ? payload.client_secret : "";
  if (appId && appSecret) {
    const app = typeof payload.app === "object" && payload.app !== null ? payload.app as Record<string, unknown> : undefined;
    const appName = [payload.app_name, payload.client_name, payload.name, app?.app_name, app?.name]
      .find((value): value is string => typeof value === "string" && value.length > 0);
    return {
      status: "success",
      intervalSeconds: FEISHU_POLL_INTERVAL_SECONDS,
      appId,
      appSecret,
      openId: userInfo && typeof userInfo.open_id === "string" ? userInfo.open_id : undefined,
      appName,
    };
  }
  const error = typeof payload.error === "string" ? payload.error : "";
  const description = typeof payload.error_description === "string" ? payload.error_description : "";
  if (!error || error === "authorization_pending") return { status: "pending", intervalSeconds: FEISHU_POLL_INTERVAL_SECONDS };
  if (error === "slow_down") return { status: "pending", intervalSeconds: 10 };
  if (error === "access_denied") return { status: "access_denied", intervalSeconds: FEISHU_POLL_INTERVAL_SECONDS };
  if (error === "expired_token") return { status: "expired", intervalSeconds: FEISHU_POLL_INTERVAL_SECONDS };
  return { status: "error", intervalSeconds: FEISHU_POLL_INTERVAL_SECONDS, message: `${error}: ${description || "unknown"}` };
}

// ── 事件解析（纯函数，导出为了测试） ────────────────────────────────────────

export interface FeishuInboundMessage {
  senderId: string;
  /** 群聊才有：`oc_` 开头的 chat_id。 */
  chatId?: string;
  /** 群聊 = true —— 回程发到 chatId，否则发给 senderId。 */
  isGroup: boolean;
  text: string;
  messageId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown> | undefined, keys: readonly string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** post 富文本：title + 逐行 token 拼接（at 跳过，a 拼链接）—— 对齐 ZCode 的 readFeishuPostText。 */
function readFeishuPostText(content: Record<string, unknown> | undefined): string | null {
  const post = content && isRecord(content.post) ? content.post : undefined;
  if (!post) return null;
  const langKey = ["zh_cn", "en_us"].find((key) => isRecord(post[key]));
  const body = langKey ? post[langKey] as Record<string, unknown> : undefined;
  if (!body) return null;
  const lines: string[] = [];
  const title = readString(body, ["title"]);
  if (title) lines.push(title);
  const contentBlocks = Array.isArray(body.content) ? body.content : [];
  for (const block of contentBlocks) {
    if (!Array.isArray(block)) continue;
    const parts: string[] = [];
    for (const token of block) {
      if (!isRecord(token)) continue;
      const tag = typeof token.tag === "string" ? token.tag : "";
      if (tag === "at") continue;
      if (tag === "a") {
        const text = readString(token, ["text"]);
        const href = readString(token, ["href"]);
        parts.push(text && href ? `${text}(${href})` : text ?? href ?? "");
        continue;
      }
      const text = readString(token, ["text", "content"]);
      if (text) parts.push(text);
    }
    if (parts.length > 0) lines.push(parts.join(""));
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

function stripFeishuMentions(text: string): string {
  return text
    .replace(/<at[^>]*>.*?<\/at>/gu, "")
    .replace(/<at[^>]*\/>/gu, "")
    .replace(/(?:^|\s)@[^\s@]+\b/gu, "")
    .trim();
}

/**
 * 解析 `im.message.receive_v1` 的事件帧。SDK 可能摊平 `event`，两处都读；文本按
 * text → post 富文本 → text_without_at_bot 的顺序取，最后统一剥 @提及。
 */
export function parseFeishuMessageEvent(payload: Record<string, unknown>): FeishuInboundMessage | null {
  const event = isRecord(payload.event) ? payload.event : payload;
  const message = isRecord(event.message) ? event.message : undefined;
  const sender = isRecord(event.sender) ? event.sender : undefined;
  const senderIdRecord = isRecord(sender?.sender_id) ? sender.sender_id as Record<string, unknown> : undefined;
  const content = parseJsonRecord(message?.content);
  const messageType = readString(message, ["message_type", "msg_type"]);
  if (!message || !senderIdRecord) return null;
  if (messageType && messageType !== "text" && messageType !== "post") return null;

  const rawText =
    readString(content, ["text"])
    ?? readFeishuPostText(content)
    ?? readString(event, ["text_without_at_bot"])
    ?? readString(event, ["text"])
    ?? "";
  const text = stripFeishuMentions(rawText);
  if (!text) return null;

  const chatType = readString(message, ["chat_type"]) ?? readString(event, ["chat_type"]) ?? "";
  const isGroup = chatType.startsWith("group");
  const chatId = readString(message, ["chat_id"]) ?? readString(event, ["open_chat_id"]) ?? undefined;
  return {
    senderId: readString(senderIdRecord, ["open_id", "user_id", "union_id"]) ?? "",
    chatId: isGroup ? chatId : undefined,
    isGroup,
    text,
    messageId: readString(message, ["message_id"]) ?? undefined,
  };
}

/** `oc_` 开头是群 chat_id，否则按 open_id 发。 */
export function resolveFeishuReceiveIdType(receiveId: string): "chat_id" | "open_id" {
  return receiveId.startsWith("oc_") ? "chat_id" : "open_id";
}

// ── 回程（REST） ────────────────────────────────────────────────────────────

interface CachedToken {
  token: string;
  expiresAt: number;
}

const TOKEN_TTL_MS = 90 * 60_000;
const tokenCache = new Map<string, CachedToken>();

export function clearFeishuTokenCache(): void {
  tokenCache.clear();
}

async function feishuTenantAccessToken(
  provider: "feishu" | "lark",
  appId: string,
  appSecret: string,
  doFetch: typeof fetch,
): Promise<string> {
  const cacheKey = `${provider}:${appId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const response = await doFetch(`${feishuOpenApiBase(provider)}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json() as { tenant_access_token?: string; code?: number; msg?: string };
  if (!payload.tenant_access_token) {
    throw new Error(`Feishu token failed: ${payload.msg ?? `HTTP ${response.status}`}`);
  }
  tokenCache.set(cacheKey, { token: payload.tenant_access_token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return payload.tenant_access_token;
}

export interface FeishuSendOutcome {
  ok: boolean;
  detail: string;
}

export async function feishuSendText(
  provider: "feishu" | "lark",
  appId: string,
  appSecret: string,
  receiveId: string,
  text: string,
  options: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<FeishuSendOutcome> {
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const token = await feishuTenantAccessToken(provider, appId, appSecret, doFetch);
    const response = await doFetch(
      `${feishuOpenApiBase(provider)}/open-apis/im/v1/messages?receive_id_type=${resolveFeishuReceiveIdType(receiveId)}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ receive_id: receiveId, msg_type: "text", content: JSON.stringify({ text }) }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    const payload = await response.json().catch(() => ({})) as { code?: number; msg?: string };
    if (payload.code === 0) return { ok: true, detail: "sent" };
    return { ok: false, detail: payload.msg ?? `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

// ── 收消息运行时（官方 SDK 的 WebSocket 长连接） ─────────────────────────────

export interface FeishuRunnerOptions {
  appId: string;
  appSecret: string;
  provider: "feishu" | "lark";
  /** **可变**数组：首个发信人自动绑定时 runner 自己 push 进来，route 只负责落盘。 */
  allowFrom: string[];
  sessionId: string;
  deliver: (sessionId: string, text: string) => Promise<string>;
  /** 白名单为空时，首个发信人自动绑定（写回 allowFrom）—— 见 route 里的接线。 */
  onBindFirstSender?: (senderId: string) => void;
  onLog?: (line: string) => void;
  signal: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

export interface FeishuRunnerHandle {
  stop(): void;
  readonly ready: boolean;
  readonly processed: number;
}

/** 白名单判定与微信同一套：空 = 谁都不许，等首个发信人自动绑定。 */
export function isFeishuAllowedSender(allowFrom: readonly string[], senderId: string): boolean {
  return allowFrom.length > 0 && allowFrom.includes(senderId);
}

/**
 * 起 WS 长连接。SDK 动态 import（浏览器依赖图看不到它）；启动 20s 超时。
 * 事件处理不 await 交付（SDK 对事件回执有自己的时限），逐条 fire-and-forget。
 */
export async function startFeishuRunner(options: FeishuRunnerOptions): Promise<FeishuRunnerHandle> {
  const log = (line: string) => options.onLog?.(line);
  let stopped = false;
  let processed = 0;
  let closeClient: (() => void) | null = null;

  // 首个发信人自动绑定（跟微信同一套语义）：回一句欢迎语而不是当指令跑。
  const handleInbound = async (inbound: FeishuInboundMessage): Promise<void> => {
    try {
      if (!isFeishuAllowedSender(options.allowFrom, inbound.senderId)) {
        if (options.allowFrom.length === 0) {
          options.allowFrom.push(inbound.senderId);
          options.onBindFirstSender?.(inbound.senderId);
          await feishuSendText(
            options.provider,
            options.appId,
            options.appSecret,
            inbound.isGroup && inbound.chatId ? inbound.chatId : inbound.senderId,
            "Connected. This sender is now bound to the agent — try sending a message.",
            { env: options.env },
          );
          log(`feishu: bound first sender ${inbound.senderId}`);
          return;
        }
        log(`feishu: ignored a sender outside the allowlist (${inbound.senderId})`);
        return;
      }
      const reply = await options.deliver(options.sessionId, inbound.text);
      processed += 1;
      const target = inbound.isGroup && inbound.chatId ? inbound.chatId : inbound.senderId;
      const outcome = await feishuSendText(options.provider, options.appId, options.appSecret, target, reply || "(no reply)", { env: options.env });
      if (!outcome.ok) log(`feishu reply failed: ${outcome.detail}`);
    } catch (error) {
      log(`feishu deliver failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const runner = (async () => {
    const Lark = await import("@larksuiteoapi/node-sdk");
    const eventDispatcher = new Lark.EventDispatcher({});
    eventDispatcher.register({
      "im.message.receive_v1": (payload: unknown) => {
        if (stopped || options.signal.aborted) return;
        const inbound = parseFeishuMessageEvent(payload as Record<string, unknown>);
        if (!inbound) return;
        void handleInbound(inbound);
      },
    });
    const wsClient = new Lark.WSClient({
      appId: options.appId,
      appSecret: options.appSecret,
      domain: options.provider === "lark" ? Lark.Domain.Lark : Lark.Domain.Feishu,
      loggerLevel: Lark.LoggerLevel.info,
    });
    closeClient = () => {
      try {
        wsClient.close();
      } catch (error) {
        log(`feishu close failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    options.signal.addEventListener("abort", () => { stopped = true; closeClient?.(); }, { once: true });
    await wsClient.start({ eventDispatcher });
  })();

  // SDK 的 start() 是**长驻 Promise**（连接断开才 settle），不在连接建立时 resolve ——
  // 所以不能 await 它来「确认启动成功」。启动即返回；凭据错误等连不上时由 runner 的
  // catch 打日志（SDK 自带重连，不会把进程拖死）。
  runner.catch((error: unknown) => {
    log(`feishu websocket exited: ${error instanceof Error ? error.message : String(error)}`);
  });
  log(`feishu(${options.provider}) websocket starting for ${options.appId}`);

  return {
    stop() {
      stopped = true;
      closeClient?.();
    },
    get ready() {
      return !stopped;
    },
    get processed() {
      return processed;
    },
  };
}
