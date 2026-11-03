import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { beginRegistration, cancelRegistration, currentRegistration, pollRegistration } = await jiti.import("./bot-channel-register.ts");

/** 微信 iLink 的最小桩：一个二维码、一次「已确认」、返回 bot_token。 */
async function weixinStub() {
  let polls = 0;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const json = (v) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    if (url.pathname.endsWith("/get_bot_qrcode")) {
      return json({ qrcode: "qr-1", qrcode_img_content: "https://weixin/qr-1", expire_time: 120 });
    }
    if (url.pathname.endsWith("/get_qrcode_status")) {
      polls += 1;
      // 第一轮：等待；第二轮：授权完成，带 bot_token 与 ilink_bot_id。
      if (polls === 1) return json({ status: "pending" });
      return json({ status: "success", bot_token: "bot-token-1", ilink_bot_id: "bot@im.bot" });
    }
    json({});
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    env: { WEIXIN_ILINK_BASE_URL: `http://127.0.0.1:${server.address().port}` },
    close: () => new Promise((r) => server.close(r)),
  };
}

test("a WeChat sign-in goes begin → pending → success with the bot token", async () => {
  const stub = await weixinStub();
  try {
    const begin = await beginRegistration("wechat", { env: stub.env });
    assert.equal(begin.ok, true);
    assert.equal(begin.qrContent, "https://weixin/qr-1");
    assert.ok(currentRegistration("wechat"), "the in-flight session is registered");

    const first = await pollRegistration("wechat", { env: stub.env });
    assert.deepEqual(first, { ok: true, status: "pending", intervalSeconds: 3 });

    const second = await pollRegistration("wechat", { env: stub.env });
    assert.equal(second.ok && second.status, "success");
    if (second.ok && second.status === "success") {
      assert.equal(second.credentials.token, "bot-token-1");
      assert.equal(second.credentials.botUserId, "bot@im.bot");
    }
    assert.equal(currentRegistration("wechat"), null, "the session is consumed");
  } finally {
    await stub.close();
  }
});

test("polling without a session says expired instead of throwing", async () => {
  cancelRegistration("feishu");
  const polled = await pollRegistration("feishu");
  assert.deepEqual(polled, { ok: true, status: "expired" });
});

test("a failing begin reports the platform's error", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(500, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const begin = await beginRegistration("wechat", { env: { WEIXIN_ILINK_BASE_URL: `http://127.0.0.1:${server.address().port}` } });
    assert.equal(begin.ok, false);
    assert.match(begin.error, /HTTP 500/);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
