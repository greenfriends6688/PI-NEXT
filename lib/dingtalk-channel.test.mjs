import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  dingtalkSendViaWebhook,
  isDingtalkAllowedSender,
  parseDingtalkMessage,
} = await jiti.import("./dingtalk-channel.ts");

const base = {
  senderId: "staff-1",
  senderNick: "张三",
  chatbotCorpId: "corp",
  chatbotUserId: "bot",
  msgId: "msg-1",
  conversationId: "cid",
  conversationType: "1",
  sessionWebhook: "https://oapi.dingtalk.com/robot/sendBySession?session=abc",
  robotCode: "dingrobot1",
};

test("a text robot message is read, with the @robot mention stripped", () => {
  const inbound = parseDingtalkMessage(JSON.stringify({
    ...base,
    msgtype: "text",
    text: { content: "@dingrobot1 帮我看看这个报错" },
  }));
  assert.deepEqual(inbound, {
    senderId: "staff-1",
    senderNick: "张三",
    text: "帮我看看这个报错",
    sessionWebhook: base.sessionWebhook,
    messageId: "msg-1",
    conversationId: "cid",
    isGroup: false,
  });
});

test("a richText message joins its blocks and marks groups", () => {
  const inbound = parseDingtalkMessage(JSON.stringify({
    ...base,
    conversationType: "2",
    msgtype: "richText",
    content: { richText: [{ text: "第一段，" }, { text: "第二段" }, { downloadCode: "x" }] },
  }));
  assert.equal(inbound.text, "第一段，第二段");
  assert.equal(inbound.isGroup, true, "conversationType 2 is a group");
});

test("other message types, empty text and a missing webhook carry nothing for the agent", () => {
  assert.equal(parseDingtalkMessage(JSON.stringify({ ...base, msgtype: "picture", content: {} })), null);
  assert.equal(parseDingtalkMessage(JSON.stringify({ ...base, msgtype: "text", text: { content: "  " } })), null);
  assert.equal(parseDingtalkMessage(JSON.stringify({ ...base, msgtype: "text", text: { content: "hi" }, sessionWebhook: "" })), null);
  assert.equal(parseDingtalkMessage("not json"), null);
  assert.equal(parseDingtalkMessage({ ...base, msgtype: "text", text: { content: "hi" } }).text, "hi", "an already-parsed payload works too");
});

test("the allowlist is fail-closed until someone is bound", () => {
  assert.equal(isDingtalkAllowedSender([], "staff-1"), false);
  assert.equal(isDingtalkAllowedSender(["staff-1"], "staff-1"), true);
  assert.equal(isDingtalkAllowedSender(["staff-2"], "staff-1"), false);
});

test("a reply goes back through the callback's sessionWebhook", async () => {
  const seen = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      seen.push({ url: req.url, body: JSON.parse(body) });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ errcode: 0, errmsg: "ok" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const hook = `http://127.0.0.1:${server.address().port}/robot/sendBySession?session=abc`;
    const outcome = await dingtalkSendViaWebhook(hook, "答复", {});
    assert.deepEqual(outcome, { ok: true, detail: "sent" });
    assert.deepEqual(seen[0].body, { msgtype: "text", text: { content: "答复" } });
    assert.match(seen[0].url, /session=abc/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a platform error code is reported, not swallowed", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ errcode: 310000, errmsg: "invalid webhook" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const outcome = await dingtalkSendViaWebhook(`http://127.0.0.1:${server.address().port}/x`, "hi");
    assert.equal(outcome.ok, false);
    assert.equal(outcome.detail, "invalid webhook");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
