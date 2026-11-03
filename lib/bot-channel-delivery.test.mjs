import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { newBotSession, runPromptAndWait } = await jiti.import("./bot-channel-delivery.ts");

/** 一个假装成 /api/agent 的桩：记下收到的命令，按剧本回答。 */
async function agentStub(script) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const command = body ? JSON.parse(body) : {};
      calls.push({ url: req.url, command });
      const answer = script(command, calls.length);
      res.writeHead(answer.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}/api/agent/`, calls, close: () => new Promise((r) => server.close(r)) };
}

test("a scratch session is created through POST /api/agent/new", async () => {
  // 真实路由回的是 { success, sessionId, data }（不是包在 data 里）。
  const stub = await agentStub(() => ({ body: { success: true, sessionId: "s-new", data: null } }));
  try {
    const sessionId = await newBotSession(stub.base);
    assert.equal(sessionId, "s-new");
    assert.equal(stub.calls[0].url, "/api/agent/new");
    assert.ok(stub.calls[0].command.cwd, "a cwd is sent");
    // 路由要求带 type：没有它是 400 "Unsupported command"（真踩过）。
    assert.equal(stub.calls[0].command.type, "ensure_session");
  } finally {
    await stub.close();
  }
});

test("a prompt is delivered, waited out, and the last assistant text comes back", async () => {
  let stateCalls = 0;
  const stub = await agentStub((command) => {
    if (command.type === "get_state") {
      stateCalls += 1;
      // 第一次问：空闲 → 发 prompt；第二次问：还在跑；第三次：跑完。
      return { body: { data: { isStreaming: stateCalls > 1 && stateCalls < 3 } } };
    }
    if (command.type === "get_last_assistant_text") return { body: { data: { text: "  hello  " } } };
    return { body: { data: null } };
  });
  try {
    const reply = await runPromptAndWait(stub.base, "s-1", "hi", { settleMs: 1 });
    assert.equal(reply, "hello");
    const types = stub.calls.map((call) => call.command.type);
    assert.equal(types[0], "get_state");
    assert.equal(types[1], "prompt");
    assert.equal(types.at(-1), "get_last_assistant_text");
    // 字段名必须与浏览器发消息一致：`message`，不是 `text`。
    assert.equal(stub.calls[1].command.message, "hi");
    assert.equal(stub.calls[1].url, "/api/agent/s-1");
  } finally {
    await stub.close();
  }
});

test("a session that is mid-turn is not injected into", async () => {
  const stub = await agentStub(() => ({ body: { data: { isStreaming: true } } }));
  try {
    const reply = await runPromptAndWait(stub.base, "s-2", "hi", { settleMs: 1 });
    assert.match(reply, /running a turn right now/);
    assert.deepEqual(stub.calls.map((call) => call.command.type), ["get_state"], "no prompt was sent");
  } finally {
    await stub.close();
  }
});
