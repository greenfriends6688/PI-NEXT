/**
 * 钉钉渠道（**Stream 模式**：机器人走 WebSocket 长连接，不需要公网回调地址）。
 *
 * 这是钉钉自己推的「不用暴露公网」的接入方式，和飞书的 WSClient 是同一形状：
 * - 收消息：`dingtalk-stream` 的 `DWClient` 连 `api.dingtalk.com/v1.0/gateway/connections/open`，
 *   订阅 `/v1.0/im/bot/messages/get`（机器人消息回调）。握手、心跳、重连都在 SDK 里。
 * - 发消息：**用回调里的 `sessionWebhook`** 直接回（官方推荐，不需要自己算加签）。
 *   它的有效期是 `sessionWebhookExpiredTime`（约 1.5 小时），所以回程必须在同一轮里完成。
 *
 * SDK 在 runner 里**动态 import**：浏览器依赖图永远看不到它；没装包时给出明确报错。
 */

/** 钉钉机器人消息回调的订阅 topic（SDK 的 `TOPIC_ROBOT`）。 */
export const DINGTALK_TOPIC_ROBOT = "/v1.0/im/bot/messages/get";

export interface DingtalkInbound {
  senderId: string;
  senderNick: string;
  text: string;
  /** 回程地址：官方推荐直接回这个 webhook。 */
  sessionWebhook: string;
  messageId?: string;
  conversationId?: string;
  isGroup: boolean;
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

/**
 * 解析一条下行事件的 `data`（JSON 字符串）。
 *
 * 钉钉的消息体有两种形状：`{ msgtype: "text", text: { content } }` 与
 * `{ msgtype: "richText", content: { richText: [...] } }`。只认文本，其余返回 null。
 * `@机器人` 会以 `@robotCode` 的形式留在正文里，这里剥掉。
 */
export function parseDingtalkMessage(data: unknown): DingtalkInbound | null {
  const payload = typeof data === "string" ? safeJson(data) : data;
  if (!isRecord(payload)) return null;
  const msgtype = readString(payload, ["msgtype", "msgType"]) ?? "";
  let text = "";
  if (msgtype === "text") {
    const textBody = isRecord(payload.text) ? payload.text : undefined;
    text = readString(textBody, ["content"]) ?? "";
  } else if (msgtype === "richText") {
    const content = isRecord(payload.content) ? payload.content : undefined;
    const blocks = Array.isArray(content?.richText) ? content!.richText : [];
    text = blocks
      .map((block) => (isRecord(block) && typeof block.text === "string" ? block.text : ""))
      .join("")
      .trim();
  } else {
    return null;
  }
  const robotCode = readString(payload, ["robotCode"]) ?? "";
  if (robotCode) text = text.split(`@${robotCode}`).join("");
  text = text.trim();
  if (!text) return null;

  const senderId = readString(payload, ["senderStaffId", "senderId"]) ?? "";
  const sessionWebhook = readString(payload, ["sessionWebhook"]) ?? "";
  if (!senderId || !sessionWebhook) return null;
  return {
    senderId,
    senderNick: readString(payload, ["senderNick"]) ?? senderId,
    text,
    sessionWebhook,
    messageId: readString(payload, ["msgId"]) ?? undefined,
    conversationId: readString(payload, ["conversationId"]) ?? undefined,
    isGroup: readString(payload, ["conversationType"]) === "2",
  };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export interface DingtalkSendOutcome { ok: boolean; detail: string }

/** 用回调给的 sessionWebhook 回一条文本（官方推荐路径，不需要加签）。 */
export async function dingtalkSendViaWebhook(
  sessionWebhook: string,
  text: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<DingtalkSendOutcome> {
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const response = await doFetch(sessionWebhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msgtype: "text", text: { content: text } }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as { errcode?: number; errmsg?: string };
    if (payload.errcode === undefined || payload.errcode === 0) return { ok: true, detail: "sent" };
    return { ok: false, detail: payload.errmsg ?? `errcode ${payload.errcode}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export interface DingtalkRunnerOptions {
  clientId: string;
  clientSecret: string;
  /** **可变**数组：首个发信人自动绑定时 runner 自己 push 进来，运行时负责落盘。 */
  allowFrom: string[];
  sessionId: string;
  deliver: (sessionId: string, text: string) => Promise<string>;
  onBindFirstSender?: (senderId: string) => void;
  onLog?: (line: string) => void;
  signal: AbortSignal;
}

export interface DingtalkRunnerHandle {
  stop(): void;
  readonly processed: number;
}

/** 白名单判定与其它渠道同一套：空 = 谁都不许，等首个发信人自动绑定。 */
export function isDingtalkAllowedSender(allowFrom: readonly string[], senderId: string): boolean {
  return allowFrom.length > 0 && allowFrom.includes(senderId);
}

/**
 * 起 Stream 长连接。SDK 动态 import；事件处理 fire-and-forget（SDK 对每条事件有自己的
 * 应答时限，await 一轮 agent 会把连接拖死）。
 */
export async function startDingtalkRunner(options: DingtalkRunnerOptions): Promise<DingtalkRunnerHandle> {
  const log = (line: string) => options.onLog?.(line);
  let stopped = false;
  let processed = 0;
  let client: { disconnect?: () => void } | null = null;

  const handleInbound = async (inbound: DingtalkInbound): Promise<void> => {
    try {
      if (!isDingtalkAllowedSender(options.allowFrom, inbound.senderId)) {
        if (options.allowFrom.length === 0) {
          options.allowFrom.push(inbound.senderId);
          options.onBindFirstSender?.(inbound.senderId);
          await dingtalkSendViaWebhook(inbound.sessionWebhook, "已连接。这条消息的发送者现在绑定到 agent 了，直接发消息即可。");
          log(`dingtalk: bound first sender ${inbound.senderId}`);
          return;
        }
        log(`dingtalk: ignored a sender outside the allowlist (${inbound.senderId})`);
        return;
      }
      const reply = await options.deliver(options.sessionId, inbound.text);
      processed += 1;
      const outcome = await dingtalkSendViaWebhook(inbound.sessionWebhook, reply || "(无回复)");
      if (!outcome.ok) log(`dingtalk reply failed: ${outcome.detail}`);
    } catch (error) {
      log(`dingtalk deliver failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const { DWClient, TOPIC_ROBOT, EventAck } = await import("dingtalk-stream");
  const dw = new DWClient({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    // 断线重连、心跳都由 SDK 负责；这里只负责把事件交出去。
    autoReconnect: true,
    keepAlive: true,
  });
  client = dw as unknown as { disconnect?: () => void };

  dw.registerAllEventListener(async (message: { data?: unknown }) => {
    if (stopped || options.signal.aborted) return { status: EventAck.SUCCESS };
    const inbound = parseDingtalkMessage(message.data);
    // 先把应答回掉，再跑会话：钉钉 60 秒内没有应答会重推同一条消息。
    if (inbound) void handleInbound(inbound);
    return { status: EventAck.SUCCESS };
  });

  options.signal.addEventListener("abort", () => { stopped = true; client?.disconnect?.(); }, { once: true });

  // 订阅机器人消息回调：connect() 内部完成 gateway 握手，断线自动重连。
  void dw.connect().catch((error: unknown) => {
    log(`dingtalk stream exited: ${error instanceof Error ? error.message : String(error)}`);
  });
  log(`dingtalk stream starting for ${options.clientId} on ${TOPIC_ROBOT}`);

  return {
    stop() {
      stopped = true;
      client?.disconnect?.();
    },
    get processed() {
      return processed;
    },
  };
}
