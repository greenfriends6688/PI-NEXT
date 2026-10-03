/**
 * fork:im-bridge —— 让 agent 把消息**推**到 IM 群机器人（飞书 / 企业微信 / 钉钉 /
 * Slack / Telegram），以及任何自建 webhook。
 *
 * 为什么不写成 skill：本仓的铁律是「改状态 ⇒ 必须有工具名」（`AGENTS.md`
 * `fork:proma-00-skill-policy`）。往外部发消息是**出站副作用**：可拦（审批引擎按工具名
 * 匹配）、可统计（有 `get_tools` 清单）、可在设置里配。skill 挂在上面只会变成一条
 * 「模型可能想起来发」的 markdown。
 *
 * 形状只有一种：**POST 一个 JSON 到用户自己粘进来的 URL**。五家群机器人都是这个形状，
 * 差别只在报文字段名与失败标志，所以这里是「一个平台识别 + 五个小构造器」，不是五套集成。
 * 用户粘的 URL 认不出来时落到 `custom`（原样 JSON POST），所以本文件不会因为某家改
 * 字段名而彻底失效 —— 那一路还能用。
 *
 * **这里只做出站。** 入站（你在飞书/钉钉里给机器人发消息、agent 回你）需要平台侧的长连接
 * 或公网回调，是另一个量级的工作，见 `docs/im-bridge-plan-2026-10-03.md`。
 */

import { createHmac, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import { writePrivateFileAtomicSync } from "./atomic-file";
import {
  IM_PROVIDER_IDS,
  IM_SECRET_MASK,
  IM_TEXT_LIMITS,
  detectImProvider,
  isMaskedSecret,
  type ImMessage,
  type ImProvider,
  type ImTarget,
} from "./im-bridge-shared";

// 类型、平台清单、URL 识别、掩码与长度上限都在 `-shared` 里（客户端也要用，见那个文件的头注）。
// 这里再导出一次，是为了让服务端只记一个 import 路径。
export {
  IM_PROVIDER_IDS,
  IM_SECRET_MASK,
  IM_TEXT_LIMITS,
  detectImProvider,
  isMaskedSecret,
  needsImChatId,
  needsImSecret,
  type ImMessage,
  type ImProvider,
  type ImTarget,
} from "./im-bridge-shared";

/**
 * 飞书加签：**key = `timestamp\nsecret`，message = 空**，再 base64。时间戳单位**秒**，
 * `timestamp` 与 `sign` 放 **body**、与 `msg_type` 同级。
 * 文档：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 */
export function feishuSignature(unixSeconds: number, secret: string): string {
  return createHmac("sha256", `${unixSeconds}\n${secret}`).update("").digest("base64");
}

/**
 * 钉钉加签：**key = `secret`，message = `timestamp\nsecret`**，base64 **之后再 URL 编码**。
 * 时间戳单位**毫秒**，`timestamp` 与 `sign` 放 **query**。
 * 文档：https://open.dingtalk.com/document/orgapp/customize-robot-security-settings
 *
 * ⚠️ **与飞书刚好互为镜像**：key 与 message 对调，单位一个秒一个毫秒，字段一个 body 一个
 * query，编码一个 URL-encode 一个不 encode。两段长得几乎一样，所以这里刻意写成两个具名
 * 函数而不是一个「通用签名」—— 合并它们的那个提交就是拿这个坑的。
 */
export function dingtalkSignature(unixMilliseconds: number, secret: string): string {
  const stringToSign = `${unixMilliseconds}\n${secret}`;
  return encodeURIComponent(createHmac("sha256", secret).update(stringToSign).digest("base64"));
}

export interface BuiltImRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
}

function utf8Bytes(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

export class ImMessageTooLongError extends Error {
  constructor(readonly provider: ImProvider, readonly limit: number, actual: number) {
    super(`${provider} limits a message to ${limit} bytes; this one is ${actual}. Shorten it.`);
    this.name = "ImMessageTooLongError";
  }
}

function assertWithinLimit(provider: ImProvider, message: ImMessage): void {
  const limit = IM_TEXT_LIMITS[provider];
  if (limit === undefined) return;
  const actual = utf8Bytes(message.text);
  if (actual > limit) throw new ImMessageTooLongError(provider, limit, actual);
}

export function buildImRequest(target: ImTarget, message: ImMessage, now: number = Date.now()): BuiltImRequest {
  if (!message.text.trim()) throw new Error("message text is required");
  const json = { "content-type": "application/json" };

  switch (target.provider) {
    case "feishu": {
      assertWithinLimit("feishu", message);
      const body: Record<string, unknown> = {
        msg_type: message.title ? "post" : "text",
        content: message.title
          ? { post: { zh_cn: { title: message.title, content: [[{ tag: "text", text: message.text }]] } } }
          : { text: message.text },
      };
      if (target.secret) {
        const seconds = Math.floor(now / 1000);
        body.timestamp = String(seconds);
        body.sign = feishuSignature(seconds, target.secret);
      }
      return { url: target.url, body: JSON.stringify(body), headers: json };
    }
    case "wecom": {
      assertWithinLimit("wecom", message);
      const body: Record<string, unknown> = message.title
        ? { msgtype: "markdown", markdown: { content: `**${message.title}**\n${message.text}` } }
        : { msgtype: "text", text: { content: message.text } };
      // 企业微信群机器人**没有**加签（见 needsImSecret 的注释）：安全设置只有 IP 白名单。
      return { url: target.url, body: JSON.stringify(body), headers: json };
    }
    case "dingtalk": {
      assertWithinLimit("dingtalk", message);
      const body: Record<string, unknown> = message.title
        ? { msgtype: "markdown", markdown: { title: message.title, text: message.text } }
        : { msgtype: "text", text: { content: message.text } };
      let url = target.url;
      if (target.secret) {
        const milliseconds = now;
        url += `${url.includes("?") ? "&" : "?"}timestamp=${milliseconds}&sign=${dingtalkSignature(milliseconds, target.secret)}`;
      }
      return { url, body: JSON.stringify(body), headers: json };
    }
    case "slack": {
      assertWithinLimit("slack", message);
      return {
        url: target.url,
        body: JSON.stringify(message.title ? { text: `*${message.title}*\n${message.text}` } : { text: message.text }),
        headers: json,
      };
    }
    case "telegram": {
      assertWithinLimit("telegram", message);
      if (!target.chatId) throw new Error("Telegram targets need a chat id (the bot URL does not carry it)");
      const url = new URL(target.url);
      url.searchParams.set("chat_id", target.chatId);
      url.searchParams.set("text", message.title ? `${message.title}\n${message.text}` : message.text);
      return { url: url.toString(), body: "", headers: {} };
    }
    default: {
      // custom：原样 POST。给「本文件没收录的平台」和自建服务留一条活路。
      return {
        url: target.url,
        body: JSON.stringify(message.title ? { title: message.title, text: message.text } : { text: message.text }),
        headers: json,
      };
    }
  }
}

export interface ImSendOutcome {
  targetId: string;
  label: string;
  provider: ImProvider;
  ok: boolean;
  /** 平台回的正文（截断后），失败时给模型看，便于它改文案或换目标。 */
  detail: string;
}

const DETAIL_MAX_CHARS = 300;

function clip(text: string): string {
  return text.length > DETAIL_MAX_CHARS ? `${text.slice(0, DETAIL_MAX_CHARS)}…` : text;
}

/** 一家一个判成功的方式；认不出来的一律看 HTTP 2xx。 */
function readOutcome(provider: ImProvider, status: number, bodyText: string): { ok: boolean; detail: string } {
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  if (provider === "feishu" && parsed && typeof parsed.code === "number") {
    // 只认 `code`：飞书文档明确写了 `StatusCode`/`StatusMessage` 是冗余字段、不建议使用。
    const message = typeof parsed.msg === "string" ? parsed.msg : "";
    return { ok: parsed.code === 0, detail: clip(`code=${parsed.code} ${message}`.trim()) };
  }
  if (provider === "wecom" || provider === "dingtalk") {
    // 钉钉官方示例里 errcode 是**带引号的字符串** `"0"`，企业微信是数字。两种都收。
    const raw = parsed?.errcode;
    const errcode = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : null;
    if (errcode !== null && Number.isFinite(errcode)) {
      const message = typeof parsed?.errmsg === "string" ? parsed.errmsg : "";
      return { ok: errcode === 0, detail: clip(`errcode=${errcode} ${message}`.trim()) };
    }
  }
  // ⚠️ Telegram 段**未经官方文档核实**（core.telegram.org 在本机网络不可达，见
  // lib/im-bridge.test.mjs 的同名说明）。`{"ok":true,...}` / `error_code` 是长期稳定的
  // 公开契约，但仍算「按记忆实现」，改这里前请先核对文档。
  if (provider === "telegram" && parsed && typeof parsed.ok === "boolean") {
    const description = typeof parsed.description === "string" ? parsed.description : "";
    return { ok: parsed.ok, detail: clip(description || String(parsed.ok)) };
  }
  if (provider === "slack" && status === 200) {
    return { ok: true, detail: clip(bodyText.trim() || "ok") };
  }

  const ok = status >= 200 && status < 300;
  return { ok, detail: clip(ok ? `HTTP ${status}` : `HTTP ${status} ${bodyText.trim()}`) };
}

export async function sendImMessage(
  target: ImTarget,
  message: ImMessage,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; now?: number; signal?: AbortSignal } = {},
): Promise<ImSendOutcome> {
  const request = buildImRequest(target, message, options.now ?? Date.now());
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  // 自己的超时信号 + 调用方的中止信号，两个原因归成一个。
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await doFetch(request.url, {
      method: "POST",
      headers: request.headers,
      ...(request.body ? { body: request.body } : {}),
      signal: controller.signal,
      redirect: "error",
    });
    const bodyText = await response.text().catch(() => "");
    const { ok, detail } = readOutcome(target.provider, response.status, bodyText);
    return { targetId: target.id, label: target.label, provider: target.provider, ok, detail };
  } catch (error) {
    const reason = timedOut
      ? `timed out after ${timeoutMs}ms`
      : options.signal?.aborted
        ? "cancelled by the caller"
        : error instanceof Error ? error.message : String(error);
    return {
      targetId: target.id,
      label: target.label,
      provider: target.provider,
      ok: false,
      detail: clip(reason),
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

// ── 配置读写 ────────────────────────────────────────────────────────────────

export interface ImBridgeConfig {
  version: 1;
  targets: ImTarget[];
}

export const EMPTY_IM_BRIDGE_CONFIG: ImBridgeConfig = { version: 1, targets: [] };

const CONFIG_VERSION = 1;

function imBridgeConfigPath(): string {
  return join(getAgentDir(), "im-bridge.json");
}

function asProvider(value: unknown): ImProvider {
  return typeof value === "string" && (IM_PROVIDER_IDS as readonly string[]).includes(value)
    ? value as ImProvider
    : "custom";
}

function readTarget(value: unknown): ImTarget | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const url = typeof entry.url === "string" ? entry.url.trim() : "";
  if (!/^https?:\/\//i.test(url)) return null;
  const label = typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : "IM";
  const provider = asProvider(entry.provider);
  return {
    id: typeof entry.id === "string" && entry.id.trim() ? entry.id.trim() : randomUUID(),
    label,
    // 平台没认出来就落 custom；反之认出来了但用户写了别的 host，仍按他写���的 provider 走。
    provider,
    url,
    ...(typeof entry.secret === "string" && entry.secret ? { secret: entry.secret } : {}),
    ...(typeof entry.chatId === "string" && entry.chatId.trim() ? { chatId: entry.chatId.trim() } : {}),
    enabled: entry.enabled !== false,
  };
}

export function readImBridgeConfig(): ImBridgeConfig {
  const path = imBridgeConfigPath();
  if (!existsSync(path)) return { ...EMPTY_IM_BRIDGE_CONFIG };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // 解析失败不回显文件内容（可能含 webhook），也不改它。
    return { ...EMPTY_IM_BRIDGE_CONFIG };
  }
  if (!parsed || typeof parsed !== "object") return { ...EMPTY_IM_BRIDGE_CONFIG };
  const rawTargets = (parsed as Record<string, unknown>).targets;
  const targets = Array.isArray(rawTargets)
    ? rawTargets.map(readTarget).filter((target): target is ImTarget => target !== null)
    : [];
  return { version: CONFIG_VERSION, targets };
}

/** 掩码值表示「沿用原来的 secret」，所以编辑一条目标不会清掉它的加签密钥。 */
export function writeImBridgeConfig(config: ImBridgeConfig): ImBridgeConfig {
  const current = new Map(readImBridgeConfig().targets.map((target) => [target.id, target]));
  const targets = config.targets
    .map((target) => ({
      ...target,
      secret: isMaskedSecret(target.secret) ? current.get(target.id)?.secret : target.secret,
      chatId: isMaskedSecret(target.chatId) ? current.get(target.id)?.chatId : target.chatId,
    }))
    .filter((target) => /^[a-z][a-z0-9+.-]*:\/\//i.test(target.url));

  mkdirSync(dirname(imBridgeConfigPath()), { recursive: true });
  writePrivateFileAtomicSync(imBridgeConfigPath(), `${JSON.stringify({ version: CONFIG_VERSION, targets }, null, 2)}\n`);
  return { version: CONFIG_VERSION, targets };
}

/** 给设置页 / 工具用的掩码视图：url 只给 host，secret 一律掩码。 */
export function maskedImTargets(config: ImBridgeConfig = readImBridgeConfig()): Array<Omit<ImTarget, "url"> & { host: string }> {
  return config.targets.map(({ url, ...rest }) => {
    let host = url;
    try {
      host = new URL(url).host;
    } catch {
      // 保留原样：设置页要能看出这条配坏了
    }
    return {
      ...rest,
      host,
      ...(rest.secret ? { secret: IM_SECRET_MASK } : {}),
      ...(rest.chatId ? { chatId: IM_SECRET_MASK } : {}),
    };
  });
}

export function resolveImTargets(config: ImBridgeConfig, targetId?: string): ImTarget[] {
  const enabled = config.targets.filter((target) => target.enabled);
  if (!targetId) return enabled;
  const wanted = enabled.filter((target) => target.id === targetId || target.label === targetId);
  if (wanted.length > 0) return wanted;
  const any = config.targets.find((target) => target.id === targetId || target.label === targetId);
  if (!any) return [];
  return [any];
}
