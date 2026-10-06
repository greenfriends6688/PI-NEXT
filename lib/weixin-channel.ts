/**
 * fork:bot-channel —— **微信渠道的真实现**（iLink bot 平台，零新依赖）。
 *
 * 协议逐字对拍 ZCode 的实现（`pi参考项目/ZCode-main/packages/services/src/bots/providers/`
 * 下的 `weixinRegistration.ts` 与 `weixinProvider.ts`）：微信个人号的 bot 能力挂在微信自家的
 * **iLink bot 平台**上（`https://ilinkai.weixin.qq.com/ilink/bot`）—— 这推翻了本仓早先
 * 「个人微信没有任何官方 bot API」的结论，扫码 → 拿 bot_token → `getupdates` 长轮询收、
 * `sendmessage` 发，全程普通 HTTPS，不需要公网回调。
 *
 * 凭证只有扫码换来的 bot_token（请求头 `AuthorizationType: ilink_bot_token` +
 * `Bearer`），平台侧没有任何签名/设备校验 —— 所以**白名单仍是本仓自己的防线**：
 * 首个发信人自动绑定（写进 allowFrom），之后别人发来的消息一律忽略。
 */

/** 可覆盖只是为了测试打桩（本地 HTTP 桩）；默认值是微信 iLink 平台地址。 */
export function weixinApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return (env.WEIXIN_ILINK_BASE_URL ?? "https://ilinkai.weixin.qq.com").replace(/\/+$/, "");
}

const WEIXIN_BOT_API_PREFIX = "/ilink/bot";
/** 与 ZCode 同款：注册轮询 3s，二维码默认 120s，收消息长轮询 90s。 */
export const WEIXIN_POLL_INTERVAL_SECONDS = 3;
export const WEIXIN_QR_EXPIRE_SECONDS = 120;
const WEIXIN_GET_UPDATES_TIMEOUT_MS = 90_000;

export type WeixinQrStatus = "pending" | "scanned" | "success" | "expired" | "error";

/** 平台两套状态值（数字/字符串）归一成四态。导出是为了测试。 */
export function normalizeWeixinQrStatus(status: unknown): WeixinQrStatus {
  if (typeof status === "number") {
    if (status === 0) return "pending";
    if (status === 1) return "scanned";
    if (status === 2) return "success";
    if (status === 3 || status === 4) return "expired";
  }
  if (typeof status !== "string") return "pending";
  const normalized = status.toLowerCase();
  if (["confirmed", "confirm", "authorized", "success", "ok"].includes(normalized)) return "success";
  if (["scaned", "scanned", "scan", "confirmed_wait"].includes(normalized)) return "scanned";
  if (["expired", "timeout", "cancel", "cancelled", "canceled"].includes(normalized)) return "expired";
  if (["error", "failed", "fail"].includes(normalized)) return "error";
  return "pending";
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

function readNumber(record: Record<string, unknown> | undefined, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/** 平台会把业务字段包在 `data` 里 —— 有就摊平到顶层再读（ZCode 的 `unwrapData`）。 */
function unwrapData(payload: Record<string, unknown>): Record<string, unknown> {
  const data = payload.data;
  return isRecord(data) ? { ...payload, ...data } : payload;
}

/** 统一 GET：带客户端版本头；`ret`/`errcode` 非零按错误抛。 */
async function getWeixinJson<T extends Record<string, unknown>>(
  base: string,
  path: string,
  doFetch: typeof fetch,
): Promise<T> {
  const response = await doFetch(`${base}${WEIXIN_BOT_API_PREFIX}${path}`, {
    method: "GET",
    headers: { "iLink-App-ClientVersion": "1" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Weixin ${path} failed: HTTP ${response.status}`);
  const payload = unwrapData(await response.json() as Record<string, unknown>);
  const ret = readNumber(payload, ["ret"]);
  const errcode = readNumber(payload, ["errcode"]);
  if ((ret !== null && ret !== 0) || (errcode !== null && errcode !== 0)) {
    throw new Error(readString(payload, ["errmsg", "errormsg"]) ?? `ret=${ret ?? ""} errcode=${errcode ?? ""}`.trim());
  }
  return payload as T;
}

export interface WeixinRegistrationBegin {
  /** 轮询用的码（`qrcode`）。 */
  qrCode: string;
  /** 二维码要画的内容（`qrcode_img_content`）。 */
  qrContent: string;
  expiresInSeconds: number;
}

/** 第一步：拿登录二维码。 */
export async function weixinBeginRegistration(
  options: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<WeixinRegistrationBegin> {
  const base = weixinApiBase(options.env);
  const payload = await getWeixinJson<Record<string, unknown>>(base, "/get_bot_qrcode?bot_type=3", options.fetchImpl ?? fetch);
  const qrCode = readString(payload, ["qrcode", "qr_code"]);
  const qrContent = readString(payload, ["qrcode_img_content", "qrcode_url"]) ?? qrCode;
  if (!qrCode || !qrContent) throw new Error("Weixin login did not return a QR code.");
  const expiresInSeconds = readNumber(payload, ["expire_time", "expires_in"]) ?? WEIXIN_QR_EXPIRE_SECONDS;
  return { qrCode, qrContent, expiresInSeconds };
}

export interface WeixinRegistrationPoll {
  status: WeixinQrStatus;
  intervalSeconds: number;
  botToken?: string;
  botId?: string;
  message?: string;
}

/**
 * 第二步：轮询扫码状态。**平台可能长挂等手机确认**，fetch 超时（TimeoutError）按
 * pending 处理而不是报错 —— 这是 ZCode 实测出来的行为。
 */
export async function weixinPollRegistration(
  qrCode: string,
  options: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<WeixinRegistrationPoll> {
  const base = weixinApiBase(options.env);
  let payload: Record<string, unknown>;
  try {
    payload = await getWeixinJson<Record<string, unknown>>(
      base,
      `/get_qrcode_status?qrcode=${encodeURIComponent(qrCode)}`,
      options.fetchImpl ?? fetch,
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      return { status: "pending", intervalSeconds: WEIXIN_POLL_INTERVAL_SECONDS };
    }
    return { status: "error", intervalSeconds: WEIXIN_POLL_INTERVAL_SECONDS, message: error instanceof Error ? error.message : String(error) };
  }
  const status = normalizeWeixinQrStatus(
    payload.status ?? payload["qrcode_status"] ?? payload["qr_status"],
  );
  if (status === "success") {
    const botToken = readString(payload, ["bot_token", "token"]);
    if (!botToken) {
      return { status: "error", intervalSeconds: WEIXIN_POLL_INTERVAL_SECONDS, message: "Weixin login succeeded but returned no bot token." };
    }
    return {
      status,
      intervalSeconds: WEIXIN_POLL_INTERVAL_SECONDS,
      botToken,
      botId: readString(payload, ["ilink_bot_id", "bot_id"]) ?? undefined,
    };
  }
  if (status === "error") {
    return { status, intervalSeconds: WEIXIN_POLL_INTERVAL_SECONDS, message: readString(payload, ["errmsg"]) ?? "Weixin login failed." };
  }
  return { status, intervalSeconds: WEIXIN_POLL_INTERVAL_SECONDS };
}

// ── 收发运行时 ──────────────────────────────────────────────────────────────

function buildRandomWechatUin(): string {
  return Buffer.from(String(Math.floor(1000000000 + Math.random() * 9000000000))).toString("base64");
}

function weixinHeaders(token: string): Record<string, string> {
  return {
    "content-type": "application/json",
    AuthorizationType: "ilink_bot_token",
    Authorization: `Bearer ${token}`,
    "X-WECHAT-UIN": buildRandomWechatUin(),
  };
}

/** 每个 POST body 头部都注入平台版本号（对齐 ZCode 的 `requestWeixinJson`）。 */
async function postWeixinJson(
  base: string,
  path: string,
  token: string,
  body: Record<string, unknown>,
  doFetch: typeof fetch,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await doFetch(`${base}${WEIXIN_BOT_API_PREFIX}${path}`, {
    method: "POST",
    headers: weixinHeaders(token),
    body: JSON.stringify({ base_info: { channel_version: "2.0.0" }, ...body }),
    signal: signal ?? AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Weixin ${path} failed: HTTP ${response.status}`);
  const payload = unwrapData(await response.json() as Record<string, unknown>);
  const ret = readNumber(payload, ["ret"]);
  const errcode = readNumber(payload, ["errcode"]);
  if ((ret !== null && ret !== 0) || (errcode !== null && errcode !== 0)) {
    throw new Error(readString(payload, ["errmsg", "errormsg"]) ?? `ret=${ret ?? ""} errcode=${errcode ?? ""}`.trim());
  }
  return payload;
}

export interface WeixinInboundMessage {
  senderId: string;
  chatId?: string;
  text: string;
  contextToken?: string;
  messageId?: string;
}

/**
 * 解析 `getupdates` 的一批响应。导出是为了测试：
 * - 容器字段有五套拼写（msgs/messages/updates/items/list）；
 * - 游标有六套拼写（get_updates_buf/buf/next_buf/...）；
 * - `message_type === 2` 是**自己发的 bot 消息回显**，必须丢弃，否则自问自答死循环；
 * - 文本要么在 `text|content|message`，要么藏在 `item_list[].text_item.text`。
 */
export function parseWeixinUpdates(payload: Record<string, unknown>): { messages: WeixinInboundMessage[]; nextBuf?: string } {
  const containerKey = ["msgs", "messages", "updates", "items", "list"].find((key) => Array.isArray(payload[key]));
  const rawMessages = containerKey ? (payload[containerKey] as unknown[]) : [];
  const messages: WeixinInboundMessage[] = [];
  for (const raw of rawMessages) {
    if (!isRecord(raw)) continue;
    const msg = isRecord(raw.msg) ? raw.msg : raw;
    const messageType = readNumber(msg, ["message_type", "msg_type"]) ?? readNumber(raw, ["message_type", "msg_type"]);
    if (messageType === 2) continue;
    const itemList = Array.isArray(msg.item_list) ? msg.item_list : Array.isArray(raw.item_list) ? raw.item_list : [];
    let text = readString(msg, ["text", "content", "message"]) ?? readString(raw, ["text", "content", "message"]) ?? "";
    if (!text) {
      const parts: string[] = [];
      for (const item of itemList) {
        if (!isRecord(item)) continue;
        const textItem = isRecord(item.text_item) ? item.text_item : undefined;
        const part = readString(textItem, ["text"]);
        if (part) parts.push(part);
      }
      text = parts.join("");
    }
    if (!text) continue;
    const sender = isRecord(raw.from) ? raw.from : undefined;
    const senderId = readString(raw, ["from_user_id", "from_user"])
      ?? readString(msg, ["from_user_id", "from_user"])
      ?? readString(sender, ["id", "wxid"])
      ?? readString(raw, ["from"]);
    if (!senderId) continue;
    messages.push({
      senderId,
      chatId: readString(raw, ["room", "room_id"]) ?? readString(msg, ["room", "room_id"]) ?? undefined,
      text,
      contextToken: readString(raw, ["context_token"]) ?? readString(msg, ["context_token"]) ?? undefined,
      messageId: readString(raw, ["id", "msg_id"]) ?? readString(msg, ["id", "msg_id"]) ?? undefined,
    });
  }
  const nextBuf = readString(payload, ["get_updates_buf", "buf", "next_buf", "nextBuf", "getUpdatesBuf", "syncKey"]) ?? undefined;
  return { messages, nextBuf };
}

export async function weixinGetUpdates(
  token: string,
  buf: string,
  options: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {},
): Promise<{ messages: WeixinInboundMessage[]; nextBuf?: string; error?: string }> {
  const base = weixinApiBase(options.env);
  try {
    const payload = await postWeixinJson(
      base,
      "/getupdates",
      token,
      { get_updates_buf: buf },
      options.fetchImpl ?? fetch,
      WEIXIN_GET_UPDATES_TIMEOUT_MS,
      options.signal,
    );
    return parseWeixinUpdates(payload);
  } catch (error) {
    if (options.signal?.aborted) return { messages: [] };
    return { messages: [], error: error instanceof Error ? error.message : String(error) };
  }
}

export interface WeixinSendOutcome {
  ok: boolean;
  detail: string;
}

/** 发一条纯文本。换行统一 CRLF（平台要求），`from_user_id` 用扫码返回的 ilink_bot_id。 */
export async function weixinSendText(
  token: string,
  fromBotId: string,
  toUserId: string,
  text: string,
  options: { contextToken?: string; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<WeixinSendOutcome> {
  const base = weixinApiBase(options.env);
  try {
    await postWeixinJson(base, "/sendmessage", token, {
      msg: {
        from_user_id: fromBotId,
        to_user_id: toUserId,
        client_id: `pi-web-weixin-${crypto.randomUUID()}`,
        message_type: 2,
        message_state: 2,
        ...(options.contextToken ? { context_token: options.contextToken } : {}),
        item_list: [{ type: 1, text_item: { text: text.replace(/\r?\n/g, "\r\n") } }],
      },
    }, options.fetchImpl ?? fetch, 30_000);
    return { ok: true, detail: "sent" };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

// ── 收消息运行时 ────────────────────────────────────────────────────────────

export interface WeixinRunnerOptions {
  token: string;
  /** 扫码成功返回的 ilink_bot_id（`sendmessage` 的 from_user_id）。 */
  fromBotId: string;
  /** **可变**数组：首个发信人自动绑定时 runner 自己 push 进来，route 只负责落盘。 */
  allowFrom: string[];
  /** 重启续传的游标（`chat-channels-state.json` 里的 `weixinGetUpdatesBuf`）。 */
  initialBuf?: string;
  sessionId: string;
  deliver: (sessionId: string, text: string) => Promise<string>;
  /** 白名单为空时，首个发信人自动绑定（写回 allowFrom）—— 见 route 里的接线。 */
  onBindFirstSender?: (senderId: string) => void;
  /** 本批消息全部处理完后的游标（`get_updates_buf`）。**处理完才写**，失败不丢消息。 */
  onCursor?: (buf: string) => void;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  onLog?: (line: string) => void;
  signal: AbortSignal;
}

export interface WeixinRunnerHandle {
  stop(): void;
  readonly processed: number;
}

/**
 * 长轮询循环。与 Telegram runner 同一套骨架：每条消息 白名单 → 交给会话 → 拿答复 →
 * 回微信；任何一条出错只记日志不退出循环。与 Telegram 的两个差别：
 * - 游标是**不透明字符串**（`get_updates_buf`），每批处理完经 `onCursor` 落盘，重启续传；
 * - 回程发给**发信人**（`to_user_id`），不是配置里的 chat id —— 微信没有频道概念，
 *   谁发的就回给谁（`context_token` 原样带回，客户端靠它串联会话）。
 */
export function startWeixinRunner(options: WeixinRunnerOptions): WeixinRunnerHandle {
  let buf = options.initialBuf ?? "";
  let processed = 0;
  let stopped = false;
  const log = (line: string) => options.onLog?.(line);

  /* fork:bot-channel-allowlist（2026-10-06 用户实拍「微信发了没有回应」）——
     就地洗掉白名单里的 **bot 自己**。iLink 的 id 后缀区分得很清楚：bot 账号是
     `…@im.bot`，真人微信是 `…@im.wechat`。历史版本的 `register-poll` 会把扫码拿到的
     `ilink_bot_id`（= bot 自己）预置进白名单（已修），而白名单一旦非空，下面那条
     「首个发信人自动绑定」就永远不会触发 —— 真人发什么都被当成名单外的人忽略掉。
     老配置因此在本行自愈，不必让人去改配置文件。 */
  const allowed = options.allowFrom.filter(
    (id) => id && id !== options.fromBotId && !id.endsWith("@im.bot"),
  );
  options.allowFrom.length = 0;
  options.allowFrom.push(...allowed);

  const loop = async () => {
    while (!stopped && !options.signal.aborted) {
      const batch = await weixinGetUpdates(options.token, buf, {
        fetchImpl: options.fetchImpl,
        signal: options.signal,
        ...(options.env ? { env: options.env } : {}),
      });
      if (batch.error) {
        log(`weixin poll failed: ${batch.error}`);
        await delay(5_000, options.signal);
        continue;
      }
      if (batch.messages.length === 0) {
        await delay(IDLE_POLL_MS, options.signal);
        continue;
      }
      for (const message of batch.messages) {
        if (stopped || options.signal.aborted) return;
        if (!options.allowFrom.includes(message.senderId)) {
          if (options.allowFrom.length === 0) {
            // 首个发信人自动绑定：写回白名单，回欢迎语，**不当指令跑** —— 跟 ZCode 的
            // 「首条消息只激活」同款语义；没有它，任何加了这个 bot 的微信用户都能开你的 agent。
            options.allowFrom.push(message.senderId);
            options.onBindFirstSender?.(message.senderId);
            const welcome = await weixinSendText(options.token, options.fromBotId, message.senderId,
              "Connected. This sender is now bound to the agent — try sending a message.",
              { contextToken: message.contextToken, fetchImpl: options.fetchImpl, ...(options.env ? { env: options.env } : {}) });
            if (!welcome.ok) log(`weixin welcome failed: ${welcome.detail}`);
            log(`weixin: bound first sender ${message.senderId}`);
            continue;
          }
          log(`weixin: ignored a sender outside the allowlist (${message.senderId})`);
          continue;
        }
        try {
          const reply = await options.deliver(options.sessionId, message.text);
          processed += 1;
          const outcome = await weixinSendText(options.token, options.fromBotId, message.senderId, reply || "(no reply)", {
            contextToken: message.contextToken,
            fetchImpl: options.fetchImpl,
            ...(options.env ? { env: options.env } : {}),
          });
          if (!outcome.ok) log(`weixin reply failed: ${outcome.detail}`);
        } catch (error) {
          log(`weixin deliver failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      // 游标最后写：本批全部处理完才推进，中途失败下一轮会重放（幂等靠会话侧，先不追求）。
      if (batch.nextBuf) {
        buf = batch.nextBuf;
        options.onCursor?.(buf);
      }
    }
  };

  void loop();
  return {
    stop() { stopped = true; },
    get processed() { return processed; },
  };
}

const IDLE_POLL_MS = 1_000;

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}
