import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { BOT_CHANNELS, botChannelReadiness, botChannelSpec } = await jiti.import("./bot-channel.ts");

test("only the channels that need no public URL are lan-friendly", () => {
  const friendly = BOT_CHANNELS.filter((channel) => channel.lanFriendly).map((channel) => channel.id);
  assert.deepEqual(friendly, ["wechat", "feishu", "lark", "dingtalk"]);
  assert.equal(botChannelSpec("wecom").lanFriendly, false, "WeCom only has a callback URL");
});

test("readiness names what is still missing, per channel", () => {
  assert.deepEqual(botChannelReadiness("wechat", undefined).missing, ["扫码授权"]);
  assert.deepEqual(botChannelReadiness("wechat", { token: "t", allowFrom: [], enabled: false }).ready, true);

  assert.deepEqual(
    botChannelReadiness("feishu", { token: "secret", allowFrom: [], enabled: false }).missing,
    ["app id"],
    "Feishu needs the app id beside the secret",
  );
  assert.equal(botChannelReadiness("lark", { token: "s", appId: "a", allowFrom: [], enabled: false }).ready, true);

  // 钉钉的凭证是两个值：Client Secret 走 token，Client ID 走 appId。
  assert.deepEqual(
    botChannelReadiness("dingtalk", { token: "secret", allowFrom: [], enabled: false }).missing,
    ["client id"],
  );
  assert.equal(botChannelReadiness("dingtalk", { token: "s", appId: "ding", allowFrom: [], enabled: false }).ready, true);

  // 什么都没配时只提第一件事：否则界面上会同时挂「扫码授权」和「app id」。
  // 企微额外要一条隧道：那不是配置项，是这台机器的网络条件，所以一直跟着提醒。
  assert.deepEqual(botChannelReadiness("wecom", { allowFrom: [], enabled: false }).missing, [
    "自建应用（CorpID / Secret / AgentId）",
    "public HTTPS callback URL (needs a tunnel)",
  ]);
  const wecom = botChannelReadiness("wecom", { token: "secret", allowFrom: [], enabled: false });
  assert.deepEqual(wecom.missing, [
    "corp id",
    "agent id",
    "callback token / encoding AES key",
    "public HTTPS callback URL (needs a tunnel)",
  ]);
  assert.equal(botChannelReadiness("wecom", {
    token: "secret",
    appId: "ww1",
    agentId: "1000002",
    callbackToken: "t",
    callbackAesKey: "k",
    allowFrom: [],
    enabled: false,
  }).ready, true);
});
