// fork:bot-channel —— 微信 iLink 渠道：状态归一化、updates 解析、注册与收发的请求形状。
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  normalizeWeixinQrStatus,
  parseWeixinUpdates,
  weixinApiBase,
  weixinBeginRegistration,
  weixinPollRegistration,
  weixinGetUpdates,
  weixinSendText,
} = await jiti.import("./weixin-channel.ts");

function jsonHandler(handler) {
  return (async (url, init) => {
    const body = handler(url, init);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
}

test("状态归一化：数字与字符串两套都要认，认不出按 pending 等", () => {
  assert.equal(normalizeWeixinQrStatus(0), "pending");
  assert.equal(normalizeWeixinQrStatus(1), "scanned");
  assert.equal(normalizeWeixinQrStatus(2), "success");
  assert.equal(normalizeWeixinQrStatus(3), "expired");
  assert.equal(normalizeWeixinQrStatus(4), "expired");
  assert.equal(normalizeWeixinQrStatus("confirmed"), "success");
  assert.equal(normalizeWeixinQrStatus("scaned"), "scanned");
  assert.equal(normalizeWeixinQrStatus("expired"), "expired");
  assert.equal(normalizeWeixinQrStatus("whatever"), "pending");
  assert.equal(normalizeWeixinQrStatus(undefined), "pending");
});

test("updates 解析：容器与游标各有好几套拼写，message_type=2 的回显必须丢", () => {
  const { messages, nextBuf } = parseWeixinUpdates({
    msgs: [
      { id: "m1", message_type: 1, from_user_id: "wxid_a", text: "你好", context_token: "ctx-1" },
      { id: "m2", message_type: 2, from_user_id: "bot", text: "自己的回显" },
      { msg: { from_user_id: "wxid_b", item_list: [{ type: 1, text_item: { text: "富文本" } }] } },
    ],
    get_updates_buf: "CURSOR-1",
  });
  assert.equal(messages.length, 2);
  assert.deepEqual(messages[0], { senderId: "wxid_a", chatId: undefined, text: "你好", contextToken: "ctx-1", messageId: "m1" });
  assert.equal(messages[1].text, "富文本");
  assert.equal(messages[1].senderId, "wxid_b");
  assert.equal(nextBuf, "CURSOR-1");

  // 另一套拼写：messages 容器 + buf 游标 + from 对象 + room 群 id
  const alt = parseWeixinUpdates({
    messages: [{ from: { id: "wxid_c" }, room: "room-9", content: "hello" }],
    buf: "CURSOR-2",
  });
  assert.equal(alt.messages[0].senderId, "wxid_c");
  assert.equal(alt.messages[0].chatId, "room-9");
  assert.equal(alt.nextBuf, "CURSOR-2");

  // 没有发送者的消息宁可丢：回程没有地址。
  const orphan = parseWeixinUpdates({ msgs: [{ text: "no sender" }] });
  assert.equal(orphan.messages.length, 0);
});

test("begin：打 get_bot_qrcode?bot_type=3，带客户端版本头，data 包裹会摊平", async () => {
  let seenUrl = "";
  let seenHeaders;
  const begin = await weixinBeginRegistration({
    fetchImpl: jsonHandler((url, init) => {
      seenUrl = String(url);
      seenHeaders = init.headers;
      return { ret: 0, data: { qrcode: "QR-CODE", qrcode_img_content: "https://weixin.qq.com/x/abc", expire_time: 90 } };
    }),
    env: { WEIXIN_ILINK_BASE_URL: "https://stub.local" },
  });
  assert.equal(seenUrl, "https://stub.local/ilink/bot/get_bot_qrcode?bot_type=3");
  assert.equal(seenHeaders["iLink-App-ClientVersion"], "1");
  assert.equal(begin.qrCode, "QR-CODE");
  assert.equal(begin.qrContent, "https://weixin.qq.com/x/abc");
  assert.equal(begin.expiresInSeconds, 90);
  assert.equal(weixinApiBase({ WEIXIN_ILINK_BASE_URL: "https://stub.local/" }), "https://stub.local");
});

test("poll：success 拿 bot_token；fetch 超时按 pending（平台会长挂等手机确认）", async () => {
  const success = await weixinPollRegistration("QR", {
    fetchImpl: jsonHandler(() => ({ ret: 0, status: 2, bot_token: "TOK", ilink_bot_id: "bot-1" })),
  });
  assert.equal(success.status, "success");
  assert.equal(success.botToken, "TOK");
  assert.equal(success.botId, "bot-1");

  const timeout = await weixinPollRegistration("QR", {
    fetchImpl: async () => { throw new DOMException("timed out", "TimeoutError"); },
  });
  assert.equal(timeout.status, "pending");

  const failure = await weixinPollRegistration("QR", {
    fetchImpl: jsonHandler(() => ({ ret: -1, errmsg: "bad qrcode" })),
  });
  assert.equal(failure.status, "error");
  assert.match(failure.message, /bad qrcode/);
});

test("getupdates：游标从 body 传，90s 长轮询；sendmessage 的形状与 base_info 注入", async () => {
  const seen = [];
  const stub = async (url, init) => {
    seen.push({ url: String(url), init });
    const payload = String(url).endsWith("/getupdates")
      ? { msgs: [], get_updates_buf: "" }
      : { ret: 0 };
    return new Response(JSON.stringify(payload), { status: 200 });
  };
  await weixinGetUpdates("TOK", "BUF-1", { fetchImpl: stub, env: { WEIXIN_ILINK_BASE_URL: "https://stub.local" } });
  const pollCall = seen[0];
  const pollBody = JSON.parse(pollCall.init.body);
  assert.equal(pollCall.init.headers.AuthorizationType, "ilink_bot_token");
  assert.equal(pollCall.init.headers.Authorization, "Bearer TOK");
  assert.ok(pollCall.init.headers["X-WECHAT-UIN"]);
  assert.deepEqual(pollBody, { base_info: { channel_version: "2.0.0" }, get_updates_buf: "BUF-1" });

  await weixinSendText("TOK", "bot-1", "wxid_a", "第一行\n第二行", { contextToken: "ctx-9", fetchImpl: stub, env: { WEIXIN_ILINK_BASE_URL: "https://stub.local" } });
  const sendCall = seen[1];
  const sendBody = JSON.parse(sendCall.init.body);
  assert.equal(sendCall.init.headers.AuthorizationType, "ilink_bot_token");
  assert.equal(sendBody.base_info.channel_version, "2.0.0");
  assert.equal(sendBody.msg.from_user_id, "bot-1");
  assert.equal(sendBody.msg.to_user_id, "wxid_a");
  assert.equal(sendBody.msg.message_type, 2);
  assert.equal(sendBody.msg.context_token, "ctx-9");
  assert.equal(sendBody.msg.item_list[0].text_item.text, "第一行\r\n第二行");

  // 平台报错（ret != 0）要变成 ok:false 的 detail，而不是把异常抛进 runner。
  const failing = await weixinSendText("TOK", "bot-1", "wxid_a", "hi", {
    fetchImpl: jsonHandler(() => ({ ret: -2, errmsg: "not allowed" })),
  });
  assert.equal(failing.ok, false);
  assert.match(failing.detail, /not allowed/);
});
