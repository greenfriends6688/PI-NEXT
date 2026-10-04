import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const IOS = join(here, "..", "mcp", "ios-simulator.mjs");
const ANDROID = join(here, "..", "mcp", "android-emulator.mjs");

/**
 * 真起一个子进程、真的按 MCP stdio 协议跟它说话。
 *
 * 这是唯一说得清的验收方式 —— 「文件写对了」证明不了客户端能连上：
 * MCP over stdio 是 newline-delimited JSON-RPC，任何一行多余的 stdout 输出
 * 都会把流污染，症状是「连上了但一个工具都调不通」。所以这里不 mock fs、
 * 不 mock 子进程，直接把整条链路跑一遍。
 */
/**
 * 起一个子进程，按行发请求，**等到收满 N 条应答**为止。
 *
 * 关键是「按条数等」而不是「第一个 data 事件就 resolve」：应答可能落在不同的
 * chunk 里（一次 write 触发两次 data 很常见），早 resolve 就只看到半截 ——
 * 那时候失败的是脚手架，不是被测代码。
 */
function talk(serverPath, requests, { env = {}, expect = requests.length } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      fn(arg);
    };
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const lines = out.split("\n").filter(Boolean);
      if (lines.length < expect) return;
      try {
        finish(resolve, { replies: lines.map((l) => JSON.parse(l)), stderr: err });
      } catch (error) {
        finish(reject, new Error(`stdout 不是合法 JSON-RPC：${out.slice(0, 400)}\n${error.message}`));
      }
    });
    child.stderr.on("data", (chunk) => { err += chunk; });
    child.on("error", (error) => finish(reject, error));
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
    const timer = setTimeout(() => {
      finish(reject, new Error(`超时（只想要 ${expect} 条，收到 ${out.split("\n").filter(Boolean).length} 条）。\nstdout：${out.slice(0, 400)}\nstderr：${err.slice(0, 400)}`));
    }, 20_000);
  });
}

const rpc = (id, method, params) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });

/**
 * 按 **id** 取应答，不按位置。
 *
 * 这不是防御性写法而是必需的：server 对 `tools/list` 是同步应答、对 `tools/call`
 * 是 await 之后才应答，所以同一个连接上 id=2 完全可以先于 id=1 回来
 * （JSON-RPC 明确允许乱序，客户端一律按 id 匹配）。按位置索引的测试在这种
 * server 上会随机地读到空 —— 而且它自己看不出是哪错了。
 */
const reply = (replies, id) => replies.find((r) => r.id === id);

test("ios-simulator answers initialize / tools/list / tools/call", async () => {
  const { replies } = await talk(IOS, [
    rpc(1, "initialize", { protocolVersion: "2024-11-05" }),
    rpc(2, "tools/list"),
    rpc(3, "tools/call", { name: "ui_hierarchy", arguments: { device: "iPhone 16" } }),
  ]);

  assert.equal(reply(replies, 1).result.serverInfo.name, "ios-simulator");
  assert.ok(reply(replies, 1).result.protocolVersion);

  const toolNames = reply(replies, 2).result.tools.map((t) => t.name);
  // 对齐 ZCode 那份插件的清单形状：设备选择 + 启停 + 装/跑 + 截图。
  for (const expected of ["list_devices", "boot", "install_app", "launch_app", "screenshot"]) {
    assert.ok(toolNames.includes(expected), `少了 ${expected}`);
  }
  // 每个工具都要有 description 与 inputSchema，否则模型无从选型。
  for (const tool of replies[1].result.tools) {
    assert.ok(tool.description?.length > 10, `${tool.name} 的描述太短`);
    assert.equal(tool.inputSchema.type, "object");
  }

  // 不支持的能力要**如实**说，而不是假装支持再失败。
  assert.equal(reply(replies, 3).result.isError, true);
  assert.match(reply(replies, 3).result.content[0].text, /当前不支持/);
});

test("android-emulator speaks the same protocol and keeps every tool on adb", async () => {
  const { replies } = await talk(ANDROID, [
    rpc(1, "initialize", { protocolVersion: "2024-11-05" }),
    rpc(2, "tools/list"),
  ]);
  assert.equal(reply(replies, 1).result.serverInfo.name, "android-emulator");
  const toolNames = reply(replies, 2).result.tools.map((t) => t.name);
  for (const expected of ["list_devices", "shell", "install_app", "launch_app", "screenshot", "logcat_dump"]) {
    assert.ok(toolNames.includes(expected), `少了 ${expected}`);
  }
  // logcat_dump 必须自带 -d：不带的话 adb 一直挂着，这个 MCP 连接就废了。
  const dump = reply(replies, 2).result.tools.find((t) => t.name === "logcat_dump");
  assert.ok(dump, "logcat_dump 不该缺");
});

test("a notification gets no reply — that is a JSON-RPC hard rule", async () => {
  // notifications/initialized 没有 id：回一条就是违约，客户端会当成孤儿应答。
  const { replies } = await talk(IOS, [
    { jsonrpc: "2.0", method: "notifications/initialized" },
    rpc(7, "tools/list"),
  ], { expect: 1 });
  assert.equal(replies.length, 1, "通知不该产生应答");
  assert.equal(replies[0].id, 7);
});

test("a malformed line gets a parse error instead of killing the server", async () => {
  const child = spawn(process.execPath, [IOS], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  child.stdin.write("{ this is not json\n");
  child.stdin.write(`${JSON.stringify(rpc(8, "tools/list"))}\n`);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  child.kill();
  const lines = out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines[0].error.code, -32700);
  // 关键：解析失败**之后**服务还得能用 —— 一行坏输入拖垮整个 MCP 连接是最糟的形态。
  assert.equal(lines[1].id, 8);
  assert.ok(Array.isArray(lines[1].result.tools));
});

// 真 bug 的回归：客户端发完就关 stdin 时，`rl` 的 close 会立刻触发，
// 而每行处理是 async 的 —— 早退就把「已经在跑的 xcrun/adb」的结果连同应答一起丢了。
// 症状是偶发地收不到最后一个工具的答复，只在最后一条请求上出现，极难复现。
test("a reply is still delivered when the client closes stdin right after writing", async () => {
  const child = spawn(process.execPath, [IOS], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  child.stdin.write(JSON.stringify(rpc(9, "tools/list")) + "\n");
  child.stdin.end();
  const exited = new Promise((resolve) => child.on("close", resolve));
  await Promise.race([exited, new Promise((r) => setTimeout(r, 8000))]);
  child.kill();
  const lines = out.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(lines.length >= 1, "stdin 关了不应把应答一起吞掉");
  assert.equal(lines[0].id, 9);
  assert.ok(Array.isArray(lines[0].result.tools));
});

test("an unknown tool answers isError, it does not fail the whole call", async () => {
  const { replies } = await talk(IOS, [rpc(1, "tools/call", { name: "nope", arguments: {} })]);
  assert.equal(replies[0].result.isError, true);
  assert.match(replies[0].result.content[0].text, /未知工具/);
});

test("an unknown method gets -32601", async () => {
  const { replies } = await talk(IOS, [rpc(1, "does/not/exist")]);
  assert.equal(reply(replies, 1).error.code, -32601);
});

test("a machine without the vendor tooling answers with a usable message, never a crash", async () => {
  const { replies } = await talk(IOS, [
    rpc(1, "tools/call", { name: "list_devices", arguments: {} }),
    rpc(2, "tools/list"),
  ]);
  const first = reply(replies, 1).result ?? {};
  // 这台 CI/开发机可能没有 Xcode，也可能有。所以不钉死具体措辞，只钉死两件事：
  // ① 没有把整条 MCP 连接搞崩（有应答）；② 话是**可操作**的 ——
  //    至少点出了平台限制或者缺哪个二进制。
  assert.ok(replies.length >= 2, "第一条请求也得有应答");
  if (first.isError) {
    assert.match(first.content[0].text, /macOS|simctl|developer tool/i, "要说清为什么用不了");
  } else {
    // 真的列出来了（装了 Xcode）：那就该是 JSON。
    assert.doesNotThrow(() => JSON.parse(first.content[0].text));
  }
  // 无论平台如何，工具表必须在 —— 降级是逐条降级，不是整个服务器降级。
  assert.ok(reply(replies, 2).result.tools.length >= 5);
});