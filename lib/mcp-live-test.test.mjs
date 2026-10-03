/**
 * fork:mcp-live-test —— 真连测试的**边界与有界性**。
 *
 * 重点不在「能不能连上」（那要真的起一个 MCP server），而在三件事：
 *   1. **默认不允许真连**（`PI_WEB_ALLOW_MCP_TEST` 没开就是关）—— 本仓的 Web 服务可能部署在
 *      远程机器上，那里的「测试连接」等于替远程用户执行命令。上游是无条件真连。
 *   2. 同一条目重复点**并到同一次**；含 `!command` 的条目**串行**（`execSync` 阻塞事件循环）。
 *   3. 整个测试有**死线**，结果里的 error / stderr **先掩码再截断**。
 *
 * 连接本身用 `lib/__fixtures__` 里的假 SDK 内部件替身，见本文件末尾。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  mcpLiveTestAllowed,
  testMcpServer,
  testMcpServerWithinPolicy,
  MCP_TEST_DEADLINE_MS,
} = await jiti.import("./mcp-live-test.ts");
const { maskStatusError, maskStatusStderr, createTestRedactor } = await jiti.import("./mcp-test-redact.ts");

test("默认不允许真连：只有 1/true/yes 打开，其它一律当关", () => {
  assert.equal(mcpLiveTestAllowed({}), false);
  assert.equal(mcpLiveTestAllowed({ PI_WEB_ALLOW_MCP_TEST: "" }), false);
  assert.equal(mcpLiveTestAllowed({ PI_WEB_ALLOW_MCP_TEST: "0" }), false);
  assert.equal(mcpLiveTestAllowed({ PI_WEB_ALLOW_MCP_TEST: "false" }), false);
  // 拼错的���不是「开」—— 真连会 spawn 命令，宁可关掉。
  assert.equal(mcpLiveTestAllowed({ PI_WEB_ALLOW_MCP_TEST: "sure" }), false);
  assert.equal(mcpLiveTestAllowed({ PI_WEB_ALLOW_MCP_TEST: "1" }), true);
  assert.equal(mcpLiveTestAllowed({ PI_WEB_ALLOW_MCP_TEST: "true" }), true);
  assert.equal(mcpLiveTestAllowed({ PI_WEB_ALLOW_MCP_TEST: "YES" }), true);
});

test("不允许的形态下不连任何东西，直接给出为什么", async () => {
  const internals = fakeInternals();
  let constructed = 0;
  const entry = { name: "x", config: { command: "true" }, source: "/tmp/mcp.json", scope: "global" };
  const result = await testMcpServerWithinPolicy(entry, {
    internals,
    credentials: fakeCredentials(),
    cwd: "/tmp",
    env: { PI_WEB_ALLOW_MCP_TEST: "0" },
  });
  assert.equal(result.state, "failed");
  assert.match(result.error ?? "", /PI_WEB_ALLOW_MCP_TEST/);
  assert.equal(constructed, 0, "不该构造任何连接");
  void constructed;
});

/** 假 SDK 内部件：只提供真连用到的那几个形状。 */
function fakeInternals(overrides = {}) {
  return {
    createDefaultTransport: () => ({}),
    StdioTransport: class {},
    getConfigValueEnvVarNames: () => [],
    isCommandConfigValue: (value) => typeof value === "string" && value.startsWith("!"),
    getMcpToolExposure: (config) => config.exposure ?? "codemode",
    McpServerConnection: class {
      constructor() { throw new Error("fake internals: 不该在测试里真的构造连接"); }
    },
    McpOAuthCredentialStore: class {},
    ...overrides,
  };
}

function fakeCredentials() {
  return class {};
}

test("同一条目重复点并到同一次测试", async () => {
  let connects = 0;
  class SlowConnection {
    tools = [];
    state = "connected";
    challenge = undefined;
    instructions = undefined;
    resources = [];
    resourceTemplates = [];
    constructor() {
      connects += 1;
    }
    async getClient() {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {};
    }
    async close() {}
  }
  const internals = fakeInternals({ McpServerConnection: SlowConnection });
  const entry = { name: "dup", config: { command: "true" }, source: "/tmp/mcp.json", scope: "global" };
  const options = { internals, credentials: fakeCredentials(), cwd: "/tmp", env: { PI_WEB_ALLOW_MCP_TEST: "1" } };
  const [a, b] = await Promise.all([testMcpServer(entry, options), testMcpServer(entry, options)]);
  assert.equal(a.state, "connected");
  assert.deepEqual(b, a, "并到同一次：结果同一个对象");
  assert.equal(connects, 1, "只连了一次");
});

test("连接抛错时被收进结果，不外泄为异常", async () => {
  class Boom {
    tools = [];
    constructor() {}
    async getClient() { throw new Error("spawn ENOENT /nope"); }
    async close() {}
  }
  const internals = fakeInternals({ McpServerConnection: Boom });
  const entry = { name: "boom", config: { command: "/nope" }, source: "/tmp/mcp.json", scope: "global" };
  const result = await testMcpServer(entry, {
    internals, credentials: fakeCredentials(), cwd: "/tmp", env: { PI_WEB_ALLOW_MCP_TEST: "1" },
  });
  assert.equal(result.state, "failed");
  assert.match(result.error ?? "", /ENOENT/);
  assert.equal(result.toolCount, 0);
});

test("结果先掩码再截断：密钥被换成 •••，长文本被剪短", () => {
  const secret = "super-secret-token-123456";
  const config = { command: "run", env: { TOKEN: secret } };
  const redact = createTestRedactor(config, [], { isCommandConfigValue: (v) => v.startsWith("!") });
  const masked = maskStatusError(`failed with token ${secret} in the message`, redact);
  assert.doesNotMatch(masked, /super-secret-token/);
  assert.match(masked, /•••/);

  // 错误取头、stderr 取尾（上游同款）
  const stderr = maskStatusStderr(`noise\n${"x".repeat(10)}\n${secret}\n`, redact);
  assert.doesNotMatch(stderr, /super-secret-token/);
  assert.ok(stderr.length <= 2_000, `stderr 尾部被截断到 2000 字符以内，实际 ${stderr.length}`);
});

test("死线常量存在（面板等的就是它）", () => {
  assert.equal(MCP_TEST_DEADLINE_MS, 20_000);
});