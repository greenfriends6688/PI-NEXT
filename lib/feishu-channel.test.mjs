// fork:bot-channel —— 飞书/Lark 渠道：device-flow 注册、事件帧解析、回程 REST 的请求形状。
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  feishuAccountsBase,
  feishuBeginRegistration,
  feishuPollRegistration,
  parseFeishuMessageEvent,
  resolveFeishuReceiveIdType,
  feishuSendText,
  clearFeishuTokenCache,
} = await jiti.import("./feishu-channel.ts");

function formHandler(handler) {
  return (async (url, init) => {
    const body = handler(url, init);
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
}

test("begin：init 校验 client_secret → begin 拿 device_code，二维码链接追加来源参数", async () => {
  const calls = [];
  const begin = await feishuBeginRegistration({
    fetchImpl: formHandler((url, init) => {
      calls.push({ url: String(url), body: String(init.body) });
      if (String(init.body).includes("action=init")) {
        return { supported_auth_methods: ["client_secret", "pkce"] };
      }
      return {
        device_code: "DC-1",
        verification_uri_complete: "https://accounts.feishu.cn/qr_connect?token=x",
        user_code: "ABCD",
        interval: 4,
        expire_in: 300,
      };
    }),
  });
  assert.equal(calls[0].url, "https://accounts.feishu.cn/oauth/v1/app/registration");
  assert.ok(calls[1].body.includes("archetype=PersonalAgent"));
  assert.ok(calls[1].body.includes("auth_method=client_secret"));
  assert.ok(calls[1].body.includes("request_user_info=open_id"));
  assert.equal(begin.deviceCode, "DC-1");
  const qr = new URL(begin.qrContent);
  assert.equal(qr.searchParams.get("from"), "sdk");
  assert.equal(qr.searchParams.get("source"), "node-sdk/zcode");
  assert.equal(qr.searchParams.get("tp"), "sdk");
  assert.equal(begin.expiresInSeconds, 300);
  assert.equal(begin.intervalSeconds, 4);

  // 环境不支持 client_secret 注册要如实报错，不要让人对着一张死码等。
  await assert.rejects(
    feishuBeginRegistration({
      fetchImpl: formHandler(() => ({ supported_auth_methods: ["pkce"] })),
    }),
    /client_secret/,
  );
});

test("poll：成功拿 client_id/secret，authorization_pending 与 slow_down 是正常等待", async () => {
  const success = await feishuPollRegistration("DC", "feishu", {
    fetchImpl: formHandler(() => ({
      client_id: "cli_x",
      client_secret: "SEC",
      app_name: "My Agent",
      user_info: { open_id: "ou_1", tenant_brand: "feishu" },
    })),
  });
  assert.equal(success.status, "success");
  assert.equal(success.appId, "cli_x");
  assert.equal(success.appSecret, "SEC");
  assert.equal(success.openId, "ou_1");
  assert.equal(success.appName, "My Agent");

  const pending = await feishuPollRegistration("DC", "feishu", {
    fetchImpl: formHandler(() => ({ error: "authorization_pending" })),
  });
  assert.equal(pending.status, "pending");
  assert.equal(pending.intervalSeconds, 5);

  const slow = await feishuPollRegistration("DC", "feishu", {
    fetchImpl: formHandler(() => ({ error: "slow_down" })),
  });
  assert.equal(slow.status, "pending");
  assert.equal(slow.intervalSeconds, 10);

  // Lark 租户：poll 换域，interval 0 = 立即重试。
  const lark = await feishuPollRegistration("DC", "feishu", {
    fetchImpl: formHandler(() => ({ user_info: { tenant_brand: "lark" } })),
  });
  assert.equal(lark.status, "pending");
  assert.equal(lark.pollDomain, "lark");
  assert.equal(lark.intervalSeconds, 0);

  const denied = await feishuPollRegistration("DC", "feishu", {
    fetchImpl: formHandler(() => ({ error: "access_denied" })),
  });
  assert.equal(denied.status, "access_denied");

  const expired = await feishuPollRegistration("DC", "feishu", {
    fetchImpl: formHandler(() => ({ error: "expired_token" })),
  });
  assert.equal(expired.status, "expired");
  assert.equal(feishuAccountsBase("lark"), "https://accounts.larksuite.com");
});

test("事件帧解析：text/post/提及剥离/群聊 chat_id，非文本消息一律不进 agent", () => {
  const text = parseFeishuMessageEvent({
    event: {
      message: { message_id: "om_1", message_type: "text", chat_type: "p2p", chat_id: "oc_x", content: JSON.stringify({ text: "<at user_id=\"ou_z\">@Bot</at> 帮我看看构建" }) },
      sender: { sender_id: { open_id: "ou_1" } },
    },
  });
  assert.equal(text.senderId, "ou_1");
  assert.equal(text.text, "帮我看看构建");
  assert.equal(text.isGroup, false);
  assert.equal(text.chatId, undefined);
  assert.equal(text.messageId, "om_1");

  const group = parseFeishuMessageEvent({
    message: { message_type: "text", chat_type: "group", chat_id: "oc_g", content: JSON.stringify({ text: "跑一下测试" }) },
    sender: { sender_id: { open_id: "ou_2" } },
  });
  assert.equal(group.isGroup, true);
  assert.equal(group.chatId, "oc_g");

  const post = parseFeishuMessageEvent({
    message: {
      message_type: "post",
      chat_type: "p2p",
      content: JSON.stringify({ post: { zh_cn: { title: "标题", content: [[{ tag: "text", text: "正文" }, { tag: "at", user_id: "ou" }], [{ tag: "a", text: "链接", href: "https://x" }]] } } }),
    },
    sender: { sender_id: { open_id: "ou_3" } },
  });
  assert.equal(post.text, "标题\n正文\n链接(https://x)");

  // 图片/文件消息：解析不出文本就返回 null（附件下载是后话，先不进 prompt）。
  const image = parseFeishuMessageEvent({
    message: { message_type: "image", chat_type: "p2p", content: JSON.stringify({ image_key: "img_v2" }) },
    sender: { sender_id: { open_id: "ou_4" } },
  });
  assert.equal(image, null);
});

test("回程：先换 tenant_access_token（缓存），oc_ 走 chat_id、其余走 open_id", async () => {
  clearFeishuTokenCache();
  const calls = [];
  const stub = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("tenant_access_token")) {
      return new Response(JSON.stringify({ code: 0, tenant_access_token: "T-TOK", expire: 7200 }), { status: 200 });
    }
    return new Response(JSON.stringify({ code: 0 }), { status: 200 });
  };
  const ok = await feishuSendText("feishu", "cli_x", "SEC", "oc_group", "群发", { fetchImpl: stub });
  assert.equal(ok.ok, true);
  assert.ok(calls[1].url.includes("receive_id_type=chat_id"));
  assert.equal(calls[1].init.headers.authorization, "Bearer T-TOK");
  assert.deepEqual(JSON.parse(calls[1].init.body), { receive_id: "oc_group", msg_type: "text", content: JSON.stringify({ text: "群发" }) });

  await feishuSendText("feishu", "cli_x", "SEC", "ou_dm", "私聊", { fetchImpl: stub });
  assert.ok(calls[2].url.includes("receive_id_type=open_id"));
  // 同一个 app 的 token 已缓存：第二次发消息只打消息端点（token 0 + 消息 1 + 消息 2 = 3 次调用）。
  assert.equal(calls.length, 3);
  assert.equal(resolveFeishuReceiveIdType("ou_x"), "open_id");
  assert.equal(resolveFeishuReceiveIdType("oc_y"), "chat_id");

  // 平台业务错误（code != 0）要落成 ok:false。
  const bad = await feishuSendText("feishu", "cli_other", "SEC2", "ou_x", "hi", {
    fetchImpl: formHandler((url) => {
      if (String(url).includes("tenant_access_token")) return { code: 0, tenant_access_token: "T2" };
      return { code: 99991663, msg: "wrong token" };
    }),
  });
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /wrong token/);
});
