/**
 * 企业微信渠道（自建应用：回调收消息 + 应用消息发出去）。
 *
 * ## 它和另外两家的**根本差别**：企业微信只有回调 URL，没有长连接
 *
 * 所以它必须有一个**公网 HTTPS 地址**（cloudflared / Tailscale Funnel / 自己的反代都行）：
 *
 *   1. 在企微管理后台 › 应用 › 接收消息 里填 `<你的公网地址>/api/bot-channel/wecom`，
 *      随机生成 Token 与 EncodingAESKey，连同 CorpID、应用 Secret、AgentId 填进设置；
 *   2. 保存时企微会 GET 一次做**地址校验**（`echostr`，加密的），
 *      路由必须解出来原样回纯文本 —— 见 `verifyWecomCallback()`；
 *   3. 之后每条消息企微 POST 一个 XML（`Encrypt` 字段是 AES-CBC 密文），路由解密、
 *      交给会话、再异步用 `message/send` 把答复发回去（回调要求 5 秒内应答，
 *      所以**不能**在回调里同步等一轮 agent 跑完）。
 *
 * 协议细节（与官方文档一致）：
 * - 签名：`sha1(sort(token, timestamp, nonce, encrypt).join(""))`；
 * - AES：32 字节 key = base64decode(EncodingAESKey + "=")，**CBC + PKCS#7**，
 *   IV = key 前 16 字节；明文 = `random(16) + msg_len(4, 大端) + msg + receiveid`；
 * - 发出的**应用消息**走 `https://qyapi.weixin.qq.com/cgi-bin/...`，access_token 缓存 2 小时。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const WECOM_API_BASE = "https://qyapi.weixin.qq.com";
/** 企微要求 5 秒内应答回调，所以交付是异步的（fire and forget）。 */
const ACCESS_TOKEN_TTL_MS = 110 * 60_000;

export function wecomApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return (env.WECOM_API_BASE_URL ?? WECOM_API_BASE).replace(/\/+$/, "");
}

/** `sha1` over the lexicographically sorted token/timestamp/nonce/encrypt. */
export function wecomSignature(token: string, timestamp: string, nonce: string, encrypt: string): string {
  return createHash("sha1").update([token, timestamp, nonce, encrypt].sort().join("")).digest("hex");
}

export function wecomSignatureMatches(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  signature: string,
): boolean {
  const expected = wecomSignature(token, timestamp, nonce, encrypt);
  // 定长比较：签名不是秘密，但别给时序侧信道留口子。
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index++) {
    diff |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return diff === 0;
}

function aesKey(encodingAesKey: string): Buffer {
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  if (key.length !== 32) throw new Error("EncodingAESKey must decode to 32 bytes");
  return key;
}

function pkcs7Unpad(buffer: Buffer): Buffer {
  const pad = buffer[buffer.byteLength - 1];
  if (pad < 1 || pad > 32 || pad > buffer.byteLength) return buffer;
  return buffer.subarray(0, buffer.byteLength - pad);
}

/**
 * 解开一个 `Encrypt` 字段。`receiveId` 是 CorpID：明文尾部必须与它一致，
 * 否则说明这条消息不是发给这个应用的（拿到别人 AppSecret 的请求会被挡下）。
 */
export function wecomDecrypt(encrypt: string, encodingAesKey: string, receiveId?: string): string {
  const key = aesKey(encodingAesKey);
  const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const plain = pkcs7Unpad(Buffer.concat([decipher.update(Buffer.from(encrypt, "base64")), decipher.final()]));
  if (plain.byteLength < 20) throw new Error("WeCom payload is too short");
  const messageLength = plain.readUInt32BE(16);
  const message = plain.subarray(20, 20 + messageLength).toString("utf8");
  const fromReceiveId = plain.subarray(20 + messageLength).toString("utf8");
  if (receiveId && fromReceiveId !== receiveId) throw new Error("WeCom payload receive id does not match this app");
  return message;
}

/** 加密（测试与「自己造一条回调」用；线上只解密）。 */
export function wecomEncrypt(message: string, encodingAesKey: string, receiveId = ""): string {
  const key = aesKey(encodingAesKey);
  const body = Buffer.from(message, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.byteLength, 0);
  const raw = Buffer.concat([randomBytes(16), length, body, Buffer.from(receiveId, "utf8")]);
  const padLength = 32 - (raw.byteLength % 32);
  const padded = Buffer.concat([raw, Buffer.alloc(padLength, padLength)]);
  const encrypter = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  encrypter.setAutoPadding(false);
  return Buffer.concat([encrypter.update(padded), encrypter.final()]).toString("base64");
}

/** 只取 XML 里那一个 `Encrypt` / `echostr`：企微的回调体很小，不值得引 XML 解析器。 */
export function readXmlField(xml: string, field: string): string | null {
  const match = new RegExp(`<${field}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${field}>`).exec(xml);
  return match ? match[1] : null;
}

export interface WecomInbound {
  senderId: string;
  text: string;
  messageId?: string;
  agentId?: string;
}

/**
 * 解一条回调 XML：签名 → 解密 → 取 `FromUserName` / `Content`。
 * 返回 null 表示「不是一条能交给会话的文本消息」（事件、语音、空消息）。
 */
export interface WecomCallbackInput {
  token: string;
  encodingAesKey: string;
  corpId?: string;
  signature: string;
  timestamp: string;
  nonce: string;
  body: string;
}

export function parseWecomCallback(input: WecomCallbackInput): WecomInbound | null {
  const encrypt = readXmlField(input.body, "Encrypt");
  if (!encrypt) return null;
  if (input.signature && !wecomSignatureMatches(input.token, input.timestamp, input.nonce, encrypt, input.signature)) {
    throw new Error("WeCom callback signature mismatch");
  }
  const xml = wecomDecrypt(encrypt, input.encodingAesKey, input.corpId);
  const messageType = readXmlField(xml, "MsgType");
  if (messageType && messageType !== "text") return null;
  const text = readXmlField(xml, "Content")?.trim();
  const senderId = readXmlField(xml, "FromUserName");
  if (!text || !senderId) return null;
  return {
    senderId,
    text,
    messageId: readXmlField(xml, "MsgId") ?? undefined,
    agentId: readXmlField(xml, "AgentID") ?? undefined,
  };
}

// ── 发消息（应用消息） ──────────────────────────────────────────────────────

interface CachedToken { token: string; expiresAt: number }
const tokenCache = new Map<string, CachedToken>();

export function clearWecomTokenCache(): void { tokenCache.clear(); }

async function wecomAccessToken(
  corpId: string,
  secret: string,
  doFetch: typeof fetch,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const cached = tokenCache.get(corpId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const url = new URL(`${wecomApiBase(env)}/cgi-bin/gettoken`);
  url.searchParams.set("corpid", corpId);
  url.searchParams.set("corpsecret", secret);
  const response = await doFetch(url.toString(), { signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({})) as { errcode?: number; errmsg?: string; access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error(`WeCom token failed: ${payload.errmsg ?? `HTTP ${response.status}`}`);
  const ttl = Math.min((payload.expires_in ?? 7200) * 1000, ACCESS_TOKEN_TTL_MS);
  tokenCache.set(corpId, { token: payload.access_token, expiresAt: Date.now() + ttl });
  return payload.access_token;
}

export interface WecomSendOutcome { ok: boolean; detail: string }

/** 发一条文本应用消息给某个人（`touser` 是企微的 UserID）。 */
export async function wecomSendText(
  corpId: string,
  secret: string,
  agentId: string,
  toUser: string,
  text: string,
  options: { fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<WecomSendOutcome> {
  const doFetch = options.fetchImpl ?? fetch;
  const env = options.env ?? process.env;
  try {
    const token = await wecomAccessToken(corpId, secret, doFetch, env);
    const url = new URL(`${wecomApiBase(env)}/cgi-bin/message/send`);
    url.searchParams.set("access_token", token);
    const response = await doFetch(url.toString(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      // 企微的 text.content 上限 2048 字节，超了整条被拒，所以这里直接截。
      body: JSON.stringify({ touser: toUser, msgtype: "text", agentid: Number(agentId) || agentId, text: { content: text.slice(0, 2000) } }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => ({})) as { errcode?: number; errmsg?: string };
    if (payload.errcode === 0) return { ok: true, detail: "sent" };
    return { ok: false, detail: payload.errmsg ?? `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
