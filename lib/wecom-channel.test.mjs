import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  parseWecomCallback,
  readXmlField,
  wecomDecrypt,
  wecomEncrypt,
  wecomSignature,
  wecomSignatureMatches,
} = await jiti.import("./wecom-channel.ts");

const AES_KEY = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"; // 43 字符 → base64 后 32 字节
const TOKEN = "callback-token";
const CORP_ID = "ww1234567890";

function callbackXml(encrypt) {
  return `<xml><ToUserName><![CDATA[${CORP_ID}]]></ToUserName><Encrypt><![CDATA[${encrypt}]]></Encrypt><AgentID><![CDATA[1000002]]></AgentID></xml>`;
}

function textMessage(text, sender = "zhangsan") {
  return `<xml><ToUserName><![CDATA[${CORP_ID}]]></ToUserName><FromUserName><![CDATA[${sender}]]></FromUserName><CreateTime>1700000000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[${text}]]></Content><MsgId>123456789</MsgId><AgentID><![CDATA[1000002]]></AgentID></xml>`;
}

test("encrypt then decrypt round-trips", () => {
  const encrypted = wecomEncrypt(textMessage("你好"), AES_KEY, CORP_ID);
  assert.equal(wecomDecrypt(encrypted, AES_KEY, CORP_ID), textMessage("你好"));
});

test("the signature is sha1 over the sorted token/timestamp/nonce/encrypt", () => {
  const signature = wecomSignature(TOKEN, "1700000000", "nonce", "cipher");
  assert.match(signature, /^[0-9a-f]{40}$/);
  assert.equal(wecomSignatureMatches(TOKEN, "1700000000", "nonce", "cipher", signature), true);
  assert.equal(wecomSignatureMatches(TOKEN, "1700000000", "nonce", "other", signature), false);
  assert.equal(wecomSignatureMatches(TOKEN, "1700000001", "nonce", "cipher", signature), false);
});

test("a callback is parsed into its sender and text", () => {
  const encrypt = wecomEncrypt(textMessage("hello agent"), AES_KEY, CORP_ID);
  const signature = wecomSignature(TOKEN, "1700000000", "nonce", encrypt);
  const parsed = parseWecomCallback({
    token: TOKEN,
    encodingAesKey: AES_KEY,
    corpId: CORP_ID,
    signature,
    timestamp: "1700000000",
    nonce: "nonce",
    body: callbackXml(encrypt),
  });
  assert.deepEqual(parsed, {
    senderId: "zhangsan",
    text: "hello agent",
    messageId: "123456789",
    agentId: "1000002",
  });
});

test("a bad signature or the wrong corp id refuses the callback", () => {
  const encrypt = wecomEncrypt(textMessage("hi"), AES_KEY, CORP_ID);
  assert.throws(() => parseWecomCallback({
    token: TOKEN,
    encodingAesKey: AES_KEY,
    corpId: CORP_ID,
    signature: "deadbeef",
    timestamp: "1700000000",
    nonce: "nonce",
    body: callbackXml(encrypt),
  }), /signature mismatch/);

  assert.throws(() => parseWecomCallback({
    token: TOKEN,
    encodingAesKey: AES_KEY,
    corpId: "another-corp",
    signature: "",
    timestamp: "1700000000",
    nonce: "nonce",
    body: callbackXml(encrypt),
  }), /receive id does not match/);
});

test("non-text messages (an event, an image) carry nothing for the agent", () => {
  const event = `<xml><ToUserName><![CDATA[${CORP_ID}]]></ToUserName><FromUserName><![CDATA[zhangsan]]></FromUserName><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[enter_agent]]></Event></xml>`;
  const encrypt = wecomEncrypt(event, AES_KEY, CORP_ID);
  assert.equal(parseWecomCallback({
    token: TOKEN, encodingAesKey: AES_KEY, corpId: CORP_ID,
    signature: "", timestamp: "1", nonce: "n", body: callbackXml(encrypt),
  }), null);
});

test("an XML field is read with or without CDATA", () => {
  assert.equal(readXmlField("<xml><Encrypt><![CDATA[abc]]></Encrypt></xml>", "Encrypt"), "abc");
  assert.equal(readXmlField("<xml><Encrypt>abc</Encrypt></xml>", "Encrypt"), "abc");
  assert.equal(readXmlField("<xml><Other>x</Other></xml>", "Encrypt"), null);
});
