// fork:im-bridge —— im_send 工具的三个面：list / 无配置 / 逐目标结果。
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { createImExtension, HOST_IM_EXTENSION_NAME } = await jiti.import("./im-extension.ts");
const { writeImBridgeConfig } = await jiti.import("./im-bridge.ts");

function loadTool() {
  const tools = new Map();
  const extension = createImExtension();
  extension.factory({ registerTool(tool) { tools.set(tool.name, tool); } });
  return tools.get("im_send");
}

function withAgentDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-im-tool-"));
  const before = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = before;
  }
}

const FLESHU = { id: "fs", label: "飞书群", provider: "feishu", url: "https://open.feishu.cn/open-apis/bot/v2/hook/abc", enabled: true };
const WECOM = { id: "wc", label: "企微群", provider: "wecom", url: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k", enabled: true };

test("工具注册名与宿主名", () => {
  assert.equal(HOST_IM_EXTENSION_NAME, "pi-web-im");
  const tool = loadTool();
  assert.equal(tool.name, "im_send");
  assert.equal(tool.label, "Send IM message");
  // 提示片段要让模型知道这个工具存在，否则它想不到用。
  assert.match(tool.promptSnippet, /chat app/);
});

test("一个都没配：list 如实说没有，不报错", async () => {
  await withAgentDir(async () => {
    const tool = loadTool();
    const result = await tool.execute("call", { action: "list" });
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /No IM targets are configured/);
    assert.match(result.content[0].text, /Settings/);
  });
});

test("send 但没配目标：告诉模型去哪儿配，而不是静默成功", async () => {
  await withAgentDir(async () => {
    const tool = loadTool();
    const result = await tool.execute("call", { text: "hi" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Settings/);
  });
});

test("send 缺 text 直接报错，不进网络", async () => {
  await withAgentDir(async () => {
    writeImBridgeConfig({ version: 1, targets: [FLESHU] });
    const tool = loadTool();
    const result = await tool.execute("call", {});
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /text is required/);
  });
});

test("指名的 target 不存在：报「没有匹配」并教它先 list", async () => {
  await withAgentDir(async () => {
    writeImBridgeConfig({ version: 1, targets: [FLESHU] });
    const tool = loadTool();
    const result = await tool.execute("call", { text: "hi", target: "不存在的群" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /No IM target matches/);
    assert.match(result.content[0].text, /action=list/);
  });
});

test("list 只回 host，不回完整 webhook URL（它是凭证）", async () => {
  await withAgentDir(async () => {
    writeImBridgeConfig({ version: 1, targets: [FLESHU, WECOM] });
    const tool = loadTool();
    const result = await tool.execute("call", { action: "list" });
    assert.match(result.content[0].text, /fs · 飞书群 · feishu · open\.feishu\.cn · enabled/);
    assert.doesNotMatch(result.content[0].text, /bot\/v2\/hook/);
    assert.doesNotMatch(result.content[0].text, /key=k/);
  });
});

test("按 target 指名只发那一个（用 stub fetch 拦住真网络）", async () => {
  await withAgentDir(async () => {
    writeImBridgeConfig({ version: 1, targets: [FLESHU, WECOM] });
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ code: 0, msg: "success" }), { status: 200 });
    };
    try {
      const tool = loadTool();
      const result = await tool.execute("call", { text: "done", title: "T", target: "wc" });
      assert.equal(calls.length, 1);
      assert.match(calls[0].url, /qyapi\.weixin\.qq\.com/);
      assert.match(result.content[0].text, /^Sent to 1 target/);
    } finally {
      globalThis.fetch = original;
    }
  });
});

test("部分失败：只有全失败才算错误，部分成功如实报出哪几个挂了", async () => {
  await withAgentDir(async () => {
    writeImBridgeConfig({ version: 1, targets: [FLESHU, WECOM] });
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => String(url).includes("feishu")
      ? new Response(JSON.stringify({ code: 19024, msg: "keyword not matched" }), { status: 200 })
      : new Response("ok", { status: 200 });
    try {
      const tool = loadTool();
      const result = await tool.execute("call", { text: "done" });
      assert.equal(result.isError, undefined);
      assert.match(result.content[0].text, /1 of 2 target\(s\) failed/);
      assert.match(result.content[0].text, /FAILED 飞书群/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
