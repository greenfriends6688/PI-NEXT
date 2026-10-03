// fork:im-bridge —— 报文构造、加签、响应判读、配置读写。
//
// 加签向量是**当场用 node:crypto 独立算一遍**再钉住构造本身（不是抄另一段实现）：
//   飞书   key = "<ts>\nsecret"，message = ""            （文档：bot-v3/add-custom-bot）
//   钉钉   key = secret，message = "<ms>\nsecret"        （文档：customize-robot-security-settings）
// 两者互为镜像，这是本文件最容易踩的坑，所以两条都钉。
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { ...subject } = await createJiti(import.meta.url, { moduleCache: false }).import("./im-bridge.ts");
const {
  IM_SECRET_MASK,
  ImMessageTooLongError,
  buildImRequest,
  detectImProvider,
  dingtalkSignature,
  feishuSignature,
  isMaskedSecret,
  maskedImTargets,
  needsImChatId,
  needsImSecret,
  readImBridgeConfig,
  readTargetForTest,
  resolveImTargets,
  sendImMessage,
  writeImBridgeConfig,
} = subject;

const NOW = 1_760_000_000_000;
const SECONDS = Math.floor(NOW / 1000);
const SECRET = "SEC0123456789abcdef";

function target(overrides = {}) {
  return {
    id: "t1",
    label: "团队群",
    provider: "feishu",
    url: "https://open.feishu.cn/open-apis/bot/v2/hook/abc",
    enabled: true,
    ...overrides,
  };
}

// ── 平台识别 ────────────────────────────────────────────────────────────────

test("按 host 认平台；认不出就是 custom（绝不猜）", () => {
  assert.equal(detectImProvider("https://open.feishu.cn/open-apis/bot/v2/hook/x"), "feishu");
  assert.equal(detectImProvider("https://open.larksuite.cn/open-apis/bot/v2/hook/x"), "feishu");
  assert.equal(detectImProvider("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k"), "wecom");
  assert.equal(detectImProvider("https://oapi.dingtalk.com/robot/send?access_token=t"), "dingtalk");
  assert.equal(detectImProvider("https://hooks.slack.com/services/T/B/X"), "slack");
  assert.equal(detectImProvider("https://api.telegram.org/bot123/sendMessage"), "telegram");
  assert.equal(detectImProvider("https://chat.example.com/hook"), "custom");
  assert.equal(detectImProvider("not a url"), "custom");
});

test("企业微信群机器人没有加签（官方页只有 IP 白名单），别让人以为填 secret 更安全", () => {
  assert.equal(needsImSecret("feishu"), true);
  assert.equal(needsImSecret("dingtalk"), true);
  assert.equal(needsImSecret("wecom"), false);
  assert.equal(needsImSecret("slack"), false);
  assert.equal(needsImChatId("telegram"), true);
});

// ── 加签：两个镜像 ──────────────────────────────────────────────────────────

test("飞书加签：key 是 stringToSign、message 为空、单位秒、字段在 body", () => {
  const expected = createHmac("sha256", `${SECONDS}\n${SECRET}`).update("").digest("base64");
  assert.equal(feishuSignature(SECONDS, SECRET), expected);

  const request = buildImRequest(target({ secret: SECRET }), { text: "hi" }, NOW);
  const body = JSON.parse(request.body);
  assert.equal(body.timestamp, String(SECONDS));
  assert.equal(body.sign, expected);
  // 必须与 msg_type 同级放 body，不能跑到 query 里。
  assert.equal(request.url.includes("sign="), false);
});

test("钉钉加签：key 是 secret、message 是 stringToSign、单位毫秒、字段在 query 且已 URL 编码", () => {
  const raw = createHmac("sha256", SECRET).update(`${NOW}\n${SECRET}`).digest("base64");
  assert.equal(decodeURIComponent(dingtalkSignature(NOW, SECRET)), raw);
  // base64 里的 + / = 在 query 里必须编码过。
  assert.match(dingtalkSignature(NOW, SECRET), /%2B|%3D|%2F/);

  const request = buildImRequest(
    target({ provider: "dingtalk", url: "https://oapi.dingtalk.com/robot/send?access_token=t", secret: SECRET }),
    { text: "hi" },
    NOW,
  );
  assert.match(request.url, /timestamp=1760000000000/);
  assert.match(request.url, /sign=/);
  assert.equal(request.url.includes("timestamp"), true);
});

test("两家的构造真的互为镜像（照抄会静默失败，所以钉住这个差异）", () => {
  // 同样的输入下，两个签名不相同 —— 若哪天有人「顺手统一」了，这条会红。
  assert.notEqual(decodeURIComponent(dingtalkSignature(NOW, SECRET)), feishuSignature(NOW, SECRET));
});

// ── 报文构造 ────────────────────────────────────────────────────────────────

test("飞书：纯文本用 msg_type=text；带标题用 post（它没有 markdown 这个类型）", () => {
  const plain = JSON.parse(buildImRequest(target(), { text: "任务跑完了" }, NOW).body);
  assert.equal(plain.msg_type, "text");
  assert.equal(plain.content.text, "任务跑完了");

  const titled = JSON.parse(buildImRequest(target(), { text: "详情", title: "完成" }, NOW).body);
  assert.equal(titled.msg_type, "post");
  assert.equal(titled.content.post.zh_cn.title, "完成");
});

test("企业微信：text 用 content，markdown 也用 content", () => {
  const plain = JSON.parse(buildImRequest(target({ provider: "wecom" }), { text: "a" }, NOW).body);
  assert.deepEqual(plain, { msgtype: "text", text: { content: "a" } });

  const titled = JSON.parse(buildImRequest(target({ provider: "wecom" }), { text: "a", title: "T" }, NOW).body);
  assert.equal(titled.msgtype, "markdown");
  assert.match(titled.markdown.content, /\*\*T\*\*/);
});

test("钉钉：markdown 的正文字段叫 text（不叫 content），且 title 必填", () => {
  const body = JSON.parse(buildImRequest(target({ provider: "dingtalk" }), { text: "a", title: "T" }, NOW).body);
  assert.equal(body.msgtype, "markdown");
  assert.equal(body.markdown.title, "T");
  assert.equal(body.markdown.text, "a");
  assert.equal(body.markdown.content, undefined);
});

test("Slack：只有 text；Telegram：URL 挂 chat_id 与 text", () => {
  const slack = JSON.parse(buildImRequest(target({ provider: "slack" }), { text: "a" }, NOW).body);
  assert.deepEqual(slack, { text: "a" });

  const tg = buildImRequest(
    target({ provider: "telegram", url: "https://api.telegram.org/bot123/sendMessage", chatId: "-100" }),
    { text: "hello world" },
    NOW,
  );
  const url = new URL(tg.url);
  assert.equal(url.searchParams.get("chat_id"), "-100");
  assert.equal(url.searchParams.get("text"), "hello world");
  assert.equal(tg.body, "");

  assert.throws(
    () => buildImRequest(target({ provider: "telegram", url: "https://api.telegram.org/bot123/sendMessage" }), { text: "x" }, NOW),
    /chat id/,
  );
});

test("custom 平台原样 POST —— 平台没收录也能用，不至于整条路失效", () => {
  const body = JSON.parse(buildImRequest(target({ provider: "custom", url: "https://chat.example.com/hook" }), { text: "a" }, NOW).body);
  assert.deepEqual(body, { text: "a" });
});

test("只对文档写明上限的平台拦长度，不给它编一个上限", () => {
  const long = "x".repeat(5000);
  assert.throws(
    () => buildImRequest(target({ provider: "wecom" }), { text: long }, NOW),
    (error) => error instanceof ImMessageTooLongError && error.limit === 2_048,
  );
  // 钉钉 / Slack / Telegram 的文档没给上限 → 不拦。
  for (const provider of ["dingtalk", "slack", "telegram"]) {
    const request = buildImRequest(
      target({ provider, url: "https://x.example/hook", ...(provider === "telegram" ? { chatId: "1" } : {}) }),
      { text: long },
      NOW,
    );
    assert.ok(request.body || request.url);
  }
});

// ── 响应判读 ────────────────────────────────────────────────────────────────

function fakeFetch(status, body) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return new Response(body, { status });
  };
  impl.calls = calls;
  return impl;
}

test("各家判成功的方式不同", async () => {
  const ok = await sendImMessage(target(), { text: "a" }, { fetchImpl: fakeFetch(200, '{"code":0,"msg":"success"}'), now: NOW });
  assert.equal(ok.ok, true);

  // 飞书失败：code 非零（且不能拿 StatusCode 当判据）。
  const feishuBad = await sendImMessage(target(), { text: "a" }, { fetchImpl: fakeFetch(200, '{"code":19024,"msg":"keyword not matched","StatusCode":0}'), now: NOW });
  assert.equal(feishuBad.ok, false);
  assert.match(feishuBad.detail, /19024/);

  // 钉钉的 errcode 在官方示例里是字符串 "0"。
  const ddOk = await sendImMessage(target({ provider: "dingtalk", url: "https://oapi.dingtalk.com/robot/send?access_token=t" }), { text: "a" }, { fetchImpl: fakeFetch(200, '{"errcode":"0","errmsg":"ok"}'), now: NOW });
  assert.equal(ddOk.ok, true);
  const ddBad = await sendImMessage(target({ provider: "dingtalk", url: "https://oapi.dingtalk.com/robot/send?access_token=t" }), { text: "a" }, { fetchImpl: fakeFetch(200, '{"errcode":40035,"errmsg":"缺少参数 json"}'), now: NOW });
  assert.equal(ddBad.ok, false);
  assert.match(ddBad.detail, /40035/);

  // 企业微信：响应形状官方没写 → 落到 HTTP 2xx 判据，仍然可用。
  const wc = await sendImMessage(target({ provider: "wecom" }), { text: "a" }, { fetchImpl: fakeFetch(200, "ok"), now: NOW });
  assert.equal(wc.ok, true);
});

test("网络错误与超时都变成失败结果，不抛给模型", async () => {
  const boom = await sendImMessage(target(), { text: "a" }, {
    fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
    now: NOW,
  });
  assert.equal(boom.ok, false);
  assert.match(boom.detail, /ECONNREFUSED/);

  const slow = await sendImMessage(target(), { text: "a" }, {
    fetchImpl: (url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")));
    }),
    timeoutMs: 5,
    now: NOW,
  });
  assert.equal(slow.ok, false);
  assert.match(slow.detail, /timed out/);
});

test("空正文不进网络", async () => {
  await assert.rejects(() => Promise.resolve().then(() => buildImRequest(target(), { text: "  " }, NOW)), /text is required/);
});

// ── 配置读写 ────────────────────────────────────────────────────────────────

function withAgentDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-im-"));
  const before = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    return fn(join(dir, "im-bridge.json"));
  } finally {
    if (before === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = before;
  }
}

test("配置往返：写进去能读回来，坏条目被丢掉", () => {
  withAgentDir((path) => {
    assert.deepEqual(readImBridgeConfig(), { version: 1, targets: [] });

    writeImBridgeConfig({
      version: 1,
      targets: [
        target({ id: "a", label: "飞书群", secret: SECRET }),
        { id: "b", label: "坏的", provider: "custom", url: "javascript:alert(1)", enabled: true },
      ],
    });
    const read = readImBridgeConfig();
    assert.equal(read.targets.length, 1);
    assert.equal(read.targets[0].secret, SECRET);

    const raw = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(raw.version, 1);
  });
});

test("坏 JSON 不抛、也不回显内容、更不改文件", () => {
  withAgentDir((path) => {
    writeFileSync(path, "{ not json, secret=leak");
    assert.deepEqual(readImBridgeConfig(), { version: 1, targets: [] });
    assert.match(readFileSync(path, "utf8"), /leak/);
  });
});

test("掩码值表示「沿用原来的 secret」，编辑目标不会清掉加签密钥", () => {
  withAgentDir(() => {
    writeImBridgeConfig({ version: 1, targets: [target({ secret: SECRET })] });
    writeImBridgeConfig({
      version: 1,
      targets: [{ ...target({ secret: IM_SECRET_MASK, label: "改了名字" }) }],
    });
    const [stored] = readImBridgeConfig().targets;
    assert.equal(stored.secret, SECRET);
    assert.equal(stored.label, "改了名字");
    assert.equal(isMaskedSecret(IM_SECRET_MASK), true);
  });
});

test("设置页拿到的是掩码视图：host 而非完整 URL，secret 一律不打回浏览器", () => {
  withAgentDir(() => {
    writeImBridgeConfig({ version: 1, targets: [target({ secret: SECRET })] });
    const [masked] = maskedImTargets();
    assert.equal(masked.host, "open.feishu.cn");
    assert.equal(masked.url, undefined);
    assert.equal(masked.secret, IM_SECRET_MASK);
    assert.doesNotMatch(JSON.stringify(maskedImTargets()), /open-apis\/bot\/v2\/hook/);
  });
});

test("解析目标：默认只发启用的，按 id 或 label 指名，未知名字给空", () => {
  const config = {
    version: 1,
    targets: [target({ id: "a", label: "飞书群" }), target({ id: "b", label: "钉钉群", provider: "dingtalk", url: "https://oapi.dingtalk.com/robot/send?access_token=t", enabled: false })],
  };
  assert.deepEqual(resolveImTargets(config).map((t) => t.id), ["a"]);
  assert.deepEqual(resolveImTargets(config, "b").map((t) => t.id), ["b"]);
  assert.deepEqual(resolveImTargets(config, "飞书群").map((t) => t.id), ["a"]);
  assert.deepEqual(resolveImTargets(config, "不存在"), []);
});
