// fork:bot-channel —— 渠道清单、白名单判定、Telegram 长轮询与回复。
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
  channelSpec,
  isAllowedSender,
  telegramApiBase,
  telegramGetUpdates,
  telegramSendMessage,
  startTelegramRunner,
} = await jiti.import("./telegram-channel.ts");
const {
  CHANNELS,
  channelReadiness,
  readChatChannelConfig,
  writeChatChannelConfig,
} = await jiti.import("./chat-channel.ts");

function withAgentDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-chan-"));
  const before = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = before;
  }
}

test("清单就是截图上那六个，且每一条都写清了能不能在局域网里跑", () => {
  assert.deepEqual(CHANNELS.map((c) => c.id), ["telegram", "discord", "feishu", "lark", "wechat", "huawei-today"]);
  const lan = CHANNELS.filter((c) => c.lanFriendly).map((c) => c.id);
  // fork:bot-channel 扫码接入（2026-10-03）：微信走 iLink bot 平台长轮询，不再需要公网回调。
  assert.deepEqual(lan, ["telegram", "discord", "feishu", "lark", "wechat"]);
  for (const channel of CHANNELS) {
    assert.ok(channel.note.length > 10, `${channel.id} 缺少说明`);
    assert.ok(channel.requires.length > 0, `${channel.id} 缺少前置条件`);
  }
});

test("配置往返；没有就当没配", () => {
  withAgentDir(() => {
    assert.deepEqual(readChatChannelConfig().channels, {});
    writeChatChannelConfig({ version: 1, channels: { telegram: { token: "123:ABC", chatId: "-100", allowFrom: ["-100", "me"], enabled: true } } });
    const read = readChatChannelConfig();
    assert.equal(read.channels.telegram.token, "123:ABC");
    assert.deepEqual(read.channels.telegram.allowFrom, ["-100", "me"]);
  });
});

test("ready 的判定按渠道各自的必填项来", () => {
  withAgentDir(() => {
    assert.equal(channelReadiness("telegram").ready, false);
    writeChatChannelConfig({ version: 1, channels: { telegram: { token: "123:ABC", chatId: "-100", allowFrom: [], enabled: true } } });
    assert.deepEqual(channelReadiness("telegram"), { ready: true, missing: [] });
    // 微信：有 token（扫码换的 bot_token）就 ready；飞书还要 appId（扫码一键建应用返回的 client_id）。
    writeChatChannelConfig({ version: 1, channels: { wechat: { token: "x", allowFrom: [], enabled: true } } });
    assert.deepEqual(channelReadiness("wechat"), { ready: true, missing: [] });
    writeChatChannelConfig({ version: 1, channels: { feishu: { token: "s", allowFrom: [], enabled: true } } });
    assert.equal(channelReadiness("feishu").ready, false);
    assert.ok(channelReadiness("feishu").missing.includes("app id"));
    writeChatChannelConfig({ version: 1, channels: { feishu: { token: "s", appId: "cli_x", allowFrom: [], enabled: true } } });
    assert.deepEqual(channelReadiness("feishu"), { ready: true, missing: [] });
  });
});

test("白名单为空 = 谁都不许（拿到令牌的人不该顺手就能开你的 agent）", () => {
  assert.equal(isAllowedSender([], { chatId: 42 }), false);
  assert.equal(isAllowedSender(["42"], { chatId: 42 }), true);
  assert.equal(isAllowedSender(["me"], { username: "me" }), true);
  assert.equal(isAllowedSender(["42"], { chatId: 43, username: "other" }), false);
});

test("API 基址可被覆盖（本地打桩用），默认官方地址", () => {
  assert.equal(telegramApiBase({}), "https://api.telegram.org");
  assert.equal(telegramApiBase({ TELEGRAM_API_BASE: "http://127.0.0.1:8099/" }), "http://127.0.0.1:8099");
});

test("发消息：成功 / 平台报错 / 网络炸，都归一成 ok+detail", async () => {
  const ok = await telegramSendMessage("T", "-100", "hi", {
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }),
  });
  assert.deepEqual(ok, { ok: true, detail: "sent" });

  const rejected = await telegramSendMessage("T", "-100", "hi", {
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, description: "chat not found" }), { status: 400 }),
  });
  assert.equal(rejected.ok, false);
  assert.match(rejected.detail, /chat not found/);

  const boom = await telegramSendMessage("T", "-100", "hi", {
    fetchImpl: async () => { throw new Error("ECONNRESET"); },
  });
  assert.equal(boom.ok, false);
  assert.match(boom.detail, /ECONNRESET/);
});

test("拉更新：offset 只前进不后退，空批不报错", async () => {
  const batch = await telegramGetUpdates("T", 10, {
    fetchImpl: async (url) => {
      assert.match(String(url), /offset=10/);
      assert.match(String(url), /timeout=25/);
      return new Response(JSON.stringify({ ok: true, result: [{ update_id: 11 }, { update_id: 12 }] }), { status: 200 });
    },
  });
  assert.equal(batch.nextOffset, 13);
  assert.equal(batch.updates.length, 2);

  const empty = await telegramGetUpdates("T", 13, {
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 }),
  });
  assert.equal(empty.updates.length, 0);
  assert.equal(empty.nextOffset, 13);

  const unauthorized = await telegramGetUpdates("T", 0, {
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, description: "Unauthorized" }), { status: 401 }),
  });
  assert.match(unauthorized.error, /Unauthorized/);
});

test("runner：白名单外的人被忽略；白名单内的消息走完 交付→回复", async () => {
  const controller = new AbortController();
  const delivered = [];
  const sent = [];
  let batchIndex = 0;
  const batches = [
    { ok: true, result: [
      { update_id: 1, message: { message_id: 1, text: "陌生人", chat: { id: 999 }, from: { id: 999, username: "stranger" } } },
      { update_id: 2, message: { message_id: 2, text: "帮我看下测试", chat: { id: -100 }, from: { id: 7, username: "me" } } },
    ] },
    { ok: true, result: [] },
  ];

  const handle = startTelegramRunner({
    token: "T",
    chatId: "-100",
    allowFrom: ["me", "-100"],
    sessionId: "session-1",
    signal: controller.signal,
    deliver: async (sessionId, text) => { delivered.push({ sessionId, text }); return "3 个测试通过"; },
    fetchImpl: async (url, init) => {
      if (String(url).includes("getUpdates")) {
        const payload = batches[Math.min(batchIndex, batches.length - 1)];
        batchIndex += 1;
        return new Response(JSON.stringify(payload), { status: 200 });
      }
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
    },
  });

  // 跑够几轮就停
  for (let i = 0; i < 50 && handle.processed === 0; i++) await new Promise((r) => setTimeout(r, 5));
  controller.abort();
  handle.stop();

  assert.deepEqual(delivered, [{ sessionId: "session-1", text: "帮我看下测试" }]);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { chat_id: "-100", text: "3 个测试通过" });
});

test("runner：交付抛错只记日志，循环继续", async () => {
  const controller = new AbortController();
  const logs = [];
  let attempts = 0;
  const handle = startTelegramRunner({
    token: "T",
    chatId: "-100",
    allowFrom: ["-100"],
    sessionId: "s",
    signal: controller.signal,
    onLog: (line) => logs.push(line),
    deliver: async () => { attempts += 1; throw new Error("session busy"); },
    fetchImpl: async (url) => String(url).includes("getUpdates")
      ? new Response(JSON.stringify(attempts < 1
        ? { ok: true, result: [{ update_id: 1, message: { message_id: 1, text: "a", chat: { id: -100 }, from: { id: 1 } } }] }
        : { ok: true, result: [] }), { status: 200 })
      : new Response(JSON.stringify({ ok: true }), { status: 200 }),
  });
  for (let i = 0; i < 50 && logs.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
  controller.abort();
  handle.stop();
  assert.ok(logs.some((line) => /deliver failed/.test(line)));
  assert.equal(CHANNELS.find((c) => c.id === "telegram").lanFriendly, true);
});