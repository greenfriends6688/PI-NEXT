/**
 * fork:pr11-mcp — `lib/mcp-transport.ts` 的测试（上游依据 85f9cb1 + ADR 0006）。
 *
 * 分两类，跟 `lib/pi-sdk-internals.test.mjs` 同一个分法：
 *   1. **无条件跑**：env 清洗的纯函数（`PI_WEB_PASSWORD` / `PORT` / `NODE_ENV` /
 *      `NEXT_*` 都不进子进程、entry 自己的 `env` 盖在上面、Windows 大小写）。
 *      这条线不依赖 SDK，所以本仓锁 0.87 时也守得住。
 *   2. **SDK 不具备 MCP 就跳过**：真连一个 stdio server、子进程里断言没有
 *      `PI_WEB_PASSWORD`、拒绝引用密码的条目、http 原样透传、绝不回退默认 transport。
 *      升级到 0.99 后这些才真跑（命令见 AGENTS.md / 补丁台账）。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  createMcpSessionLivenessGate,
  createPiNextMcpTransportFactory,
  createSessionGatedTransportFactory,
  findWebPasswordReference,
  sanitizedMcpServerEnvironment,
} = await createJiti(import.meta.url).import("./mcp-transport.ts");
const { detectMcpSdkSupport, loadPiSdkInternals } =
  await createJiti(import.meta.url).import("./pi-sdk-internals.ts");
const { acquireSessionLivenessLease } =
  await createJiti(import.meta.url).import("./session-liveness.ts");

const support = detectMcpSdkSupport();

const HOST_ENVIRONMENT = {
  PI_WEB_PASSWORD: "web-password",
  PORT: "30141",
  NODE_ENV: "production",
  NEXT_TEST: "1",
  PI_WEB_TEST_REFERENCED: "referenced-value",
  PI_WEB_TEST_INHERITED: "inherited-value",
  HOME: "/home/pi",
};

/** 一个只会说真话的最小 MCP stdio server：报出它看到的 env。 */
const ENV_SERVER = `
// 行分隔 JSON-RPC over stdio，实现 initialize / tools/list / tools/call。
import { createInterface } from "node:readline";

if (process.env.PI_WEB_FIXTURE_FAIL) {
  process.stderr.write(process.env.PI_WEB_FIXTURE_FAIL + "\\n");
  process.exit(1);
}

const TOOLS = [
  {
    name: "env_has",
    description: "Whether the server's environment defines a variable.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "env_get",
    description: "The value of a variable in the server's environment, or null.",
    inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    annotations: { readOnlyHint: true },
  },
];

const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
const result = (structuredContent) => ({
  content: [{ type: "text", text: JSON.stringify(structuredContent) }],
  structuredContent,
});

function call(name, args) {
  if (name === "env_has") return result({ has: Object.hasOwn(process.env, args.name) });
  if (name === "env_get") return result({ value: process.env[args.name] ?? null });
  return undefined;
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.method === "initialize") {
    send({ id: request.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "env-fixture", version: "1.0.0" } } });
  } else if (request.method === "tools/list") {
    send({ id: request.id, result: { tools: TOOLS } });
  } else if (request.method === "tools/call") {
    const payload = call(request.params.name, request.params.arguments ?? {});
    send(payload ? { id: request.id, result: payload } : { id: request.id, error: { code: -32601, message: "unknown tool" } });
  } else if (request.id !== undefined) {
    send({ id: request.id, result: {} });
  }
});
`;

let fixtureCounter = 0;

/** 一个永不回 initialize 的 MCP server：进程活着、stdin 开着，用来测回收。 */
const HANGING_SERVER = `
import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", () => {});
`;

/** 把最小 MCP server 写到临时目录（每次一个），用完就删。 */
async function withFixtureServer(run, script = ENV_SERVER) {
  const dir = await mkdtemp(join(tmpdir(), `pi-next-mcp-server-${process.pid}-${fixtureCounter++}-`));
  const path = join(dir, "env-server.mjs");
  await writeFile(path, script);
  try {
    return await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`condition not met within ${timeoutMs}ms`);
}

function stdioEntry(config = {}) {
  return {
    name: "env-fixture",
    config: { command: process.execPath, args: [], ...config },
    source: "test",
  };
}

function withHostEnvironment(run) {
  const previous = Object.fromEntries(Object.keys(HOST_ENVIRONMENT).map((name) => [name, process.env[name]]));
  Object.assign(process.env, HOST_ENVIRONMENT);
  try {
    return run();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

async function loadInternals() {
  const internals = await loadPiSdkInternals();
  assert.equal(internals.ok, true, internals.reason);
  return internals;
}

async function callTool(connection, name, args) {
  const result = await connection.callTool(name, args, {});
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return result.structuredContent;
}

test("stdio server 拿不到配置/守护 PI NEXT 的变量", () => {
  const environment = sanitizedMcpServerEnvironment(HOST_ENVIRONMENT, {}, "linux");
  for (const name of ["PI_WEB_PASSWORD", "PORT", "NODE_ENV", "NEXT_TEST"]) {
    assert.equal(Object.hasOwn(environment, name), false, `${name} 留在了子进程环境里`);
  }
  // 没被点名的东西照旧传下去：MCP server 常常要 PATH / HOME / 代理。
  assert.equal(environment.HOME, "/home/pi");
  assert.equal(environment.PI_WEB_TEST_INHERITED, "inherited-value");
});

test("server 自己声明的 env 盖在洗过的环境上", () => {
  assert.deepEqual(
    sanitizedMcpServerEnvironment(
      { ...HOST_ENVIRONMENT, NEXT_RUNTIME: "nodejs" },
      { NODE_ENV: "development", TOKEN: "literal" },
      "linux",
    ),
    { HOME: "/home/pi", PI_WEB_TEST_REFERENCED: "referenced-value", PI_WEB_TEST_INHERITED: "inherited-value", NODE_ENV: "development", TOKEN: "literal" },
  );
});

test("Windows 上变量名按大小写不敏感处理", () => {
  const environment = sanitizedMcpServerEnvironment(
    { Path: "C:\\bin", Pi_Web_Password: "web-password", Port: "30141", SystemRoot: "C:\\Windows" },
    { PATH: "D:\\tools" },
    "win32",
  );
  assert.deepEqual(environment, { SystemRoot: "C:\\Windows", PATH: "D:\\tools" });
  assert.equal(Object.hasOwn(environment, "Pi_Web_Password"), false, "换了个大小写的密码变量也被洗掉了");
  assert.equal(Object.hasOwn(environment, "Port"), false);
  assert.equal(Object.hasOwn(environment, "Path"), false, "声明 PATH 时会替掉任何大小写的 PATH");
});

// ─────────────────── fan-out 闸门（不依赖 SDK） ───────────────────

function fakeTransport(log) {
  const listeners = { message: new Set(), error: new Set(), close: new Set() };
  return {
    started: false,
    closed: false,
    sent: [],
    async start() { this.started = true; log.push("start"); },
    async send(message) { this.sent.push(message); },
    async close() { this.closed = true; log.push("close"); },
    onMessage(listener) { listeners.message.add(listener); return () => listeners.message.delete(listener); },
    onError(listener) { listeners.error.add(listener); return () => listeners.error.delete(listener); },
    onClose(listener) { listeners.close.add(listener); return () => listeners.close.delete(listener); },
    emitMessage(message) { for (const listener of listeners.message) listener(message); },
  };
}

test("liveness 闸门：已活跃立即放行，活跃后放行，关停拒绝", async () => {
  const active = createMcpSessionLivenessGate({ sessionId: "s1", isActive: () => true });
  await active.waitForActive();

  let live = false;
  const later = createMcpSessionLivenessGate({ sessionId: "s2", isActive: () => live, pollMs: 2 });
  const waiting = later.waitForActive();
  live = true;
  await waiting;

  const disposed = createMcpSessionLivenessGate({ sessionId: "s3", isActive: () => false, pollMs: 2 });
  const pending = disposed.waitForActive();
  disposed.dispose();
  assert.equal(disposed.disposed, true);
  await assert.rejects(pending, /session ended before the server could start/);
  await assert.rejects(disposed.waitForActive(), /session ended before the server could start/);
});

test("liveness 闸门默认只看浏览器 SSE 租约，不把委派工作当「在看」", async (t) => {
  const sessionId = "gate-lease-only";
  const gate = createMcpSessionLivenessGate({ sessionId, pollMs: 2 });

  // 没有租约：一直等，不 resolve。
  let settled = false;
  const pending = gate.waitForActive().then(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(settled, false, "无租约时不得放行");

  // 浏览器租约出现（与 SSE 路径同一份 store）：放行。
  const lease = acquireSessionLivenessLease(sessionId);
  t.after(() => lease.release());
  await pending;
  assert.equal(settled, true);

  // 已有委派工作但没有租约的另一个会话：仍然不放行。
  const delegatedOnly = "gate-delegated-only";
  globalThis.__piSubagentRuns = new Map([
    ["run-1", { run: { parentSessionId: delegatedOnly, status: "running" } }],
  ]);
  t.after(() => { delete globalThis.__piSubagentRuns; });
  const gate2 = createMcpSessionLivenessGate({ sessionId: delegatedOnly, pollMs: 2 });
  let settled2 = false;
  const pending2 = gate2.waitForActive().then(() => { settled2 = true; });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(settled2, false, "只有后台子代理在跑 ≠ 浏览器在看，不得 spawn MCP server");
  gate2.dispose();
  await assert.rejects(pending2, /session ended before the server could start/);
});

test("闸门 transport：活跃才构造内层，监听器/发送/关闭都转发", async () => {
  const log = [];
  const inner = fakeTransport(log);
  const gate = createMcpSessionLivenessGate({ sessionId: "s", isActive: () => true });
  const transport = createSessionGatedTransportFactory(() => inner, gate)(stdioEntry(), "/work", undefined);

  const seen = [];
  const disposeMessage = transport.onMessage((message) => seen.push(message));
  await transport.start();
  assert.equal(inner.started, true);
  inner.emitMessage({ jsonrpc: "2.0" });
  assert.deepEqual(seen, [{ jsonrpc: "2.0" }]);
  disposeMessage();
  inner.emitMessage({ jsonrpc: "2.0", ignored: true });
  assert.equal(seen.length, 1, "退订后不再转发");

  await transport.send({ id: 1 });
  assert.deepEqual(inner.sent, [{ id: 1 }]);
  await transport.close();
  assert.equal(inner.closed, true);
});

test("闸门 transport：没人看会话时绝不 spawn，会话关停立即中止", async () => {
  const log = [];
  let created = 0;
  const gate = createMcpSessionLivenessGate({ sessionId: "s", isActive: () => false, pollMs: 2 });
  const transport = createSessionGatedTransportFactory(() => {
    created += 1;
    return fakeTransport(log);
  }, gate)(stdioEntry(), "/work", undefined);

  const pending = transport.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(created, 0, "等待活跃期间不能构造内层 transport");
  gate.dispose();
  await assert.rejects(pending, /session ended before the server could start/);
  assert.equal(created, 0);
  assert.deepEqual(log, []);

  // close 等待中的 transport 同样拒绝且不 spawn。
  const gate2 = createMcpSessionLivenessGate({ sessionId: "s2", isActive: () => false, pollMs: 2 });
  const transport2 = createSessionGatedTransportFactory(() => {
    created += 1;
    return fakeTransport(log);
  }, gate2)(stdioEntry(), "/work", undefined);
  const pending2 = transport2.start();
  await transport2.close();
  await assert.rejects(pending2, /closed before it started/);
  assert.equal(created, 0);
});

test("闸门 transport：放行后 dispose 会关掉已创建但 connect 未完成的内层", async () => {
  const log = [];
  const gate = createMcpSessionLivenessGate({ sessionId: "s", isActive: () => true });
  const inner = fakeTransport(log);
  // 模拟 connect 卡在 start：start 不 resolve，但 transport 已经被登记。
  inner.start = async () => { inner.started = true; await new Promise(() => {}); };
  const transport = createSessionGatedTransportFactory(() => inner, gate)(stdioEntry(), "/work", undefined);
  const pending = transport.start();
  await waitFor(() => inner.started);
  gate.dispose();
  await waitFor(() => inner.closed);
  assert.equal(inner.closed, true, "dispose 必须关掉 connect 中的内层 transport");
  await transport.close();
  void pending.catch(() => {});
});

test("闸门 transport：租约稍后出现时补连", async () => {
  const log = [];
  let live = false;
  const gate = createMcpSessionLivenessGate({ sessionId: "s", isActive: () => live, pollMs: 2 });
  const inner = fakeTransport(log);
  const transport = createSessionGatedTransportFactory(() => inner, gate)(stdioEntry(), "/work", undefined);
  const pending = transport.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(inner.started, false);
  live = true;
  await pending;
  assert.equal(inner.started, true);
});

// ─────────────────── 以下需要 SDK 0.99 的内置 MCP 扩展 ───────────────────

test("stdio server 起进程时看不到 PI_WEB_PASSWORD，但拿得到自己声明的值", async (t) => {
  if (!support.ok) return t.skip(`pi SDK ${support.version} 没有内置 MCP 扩展：${support.reason}`);
  const internals = await loadInternals();
  // 工厂在任何测试改 process.env 之前建好：它必须在**连接时**读环境，不是建的时候。
  const factory = createPiNextMcpTransportFactory(internals);
  await withFixtureServer(async (server) => {
    await withHostEnvironment(async () => {
      const transports = [];
      const connection = new internals.McpServerConnection({
        entry: stdioEntry({
          args: [server],
          env: {
            FROM_CONFIG: "literal-value",
            FROM_REFERENCE: "${PI_WEB_TEST_REFERENCED}",
            FROM_COMMAND: "!echo command-value",
            ESCAPED: "$${PI_WEB_TEST_REFERENCED}",
          },
        }),
        cwd: tmpdir(),
        createTransport: (...args) => {
          const transport = factory(...args);
          transports.push(transport);
          return transport;
        },
        credentials: new internals.McpOAuthCredentialStore(),
        onTools: () => {},
      });
      try {
        await connection.getClient();
        assert.equal(connection.state, "connected");
        assert.ok(connection.tools.some((tool) => tool.name === "env_has"));

        for (const name of ["PI_WEB_PASSWORD", "PORT", "NODE_ENV", "NEXT_TEST"]) {
          assert.deepEqual(await callTool(connection, "env_has", { name }), { has: false }, `${name} 到了子进程`);
        }
        assert.deepEqual(await callTool(connection, "env_get", { name: "PI_WEB_TEST_INHERITED" }), { value: "inherited-value" });
        assert.deepEqual(await callTool(connection, "env_get", { name: "FROM_CONFIG" }), { value: "literal-value" });
        assert.deepEqual(await callTool(connection, "env_get", { name: "FROM_REFERENCE" }), { value: "referenced-value" });
        assert.deepEqual(await callTool(connection, "env_get", { name: "FROM_COMMAND" }), { value: "command-value" });
        assert.deepEqual(await callTool(connection, "env_get", { name: "ESCAPED" }), { value: "${PI_WEB_TEST_REFERENCED}" });

        assert.equal(transports.length, 1);
        assert.ok(transports[0] instanceof internals.StdioTransport);
        assert.equal(transports[0].options.inheritEnv, false);
      } finally {
        await connection.close();
      }
    });
  });
});

test("引用 PI_WEB_PASSWORD 的条目一律拒绝，且在 SDK 解析之前就拒", async (t) => {
  if (!support.ok) return t.skip(`pi SDK ${support.version} 没有内置 MCP 扩展：${support.reason}`);
  const internals = await loadInternals();
  const refused = [
    [stdioEntry({ env: { TOKEN: "${PI_WEB_PASSWORD}" } }), 'env "TOKEN"'],
    [stdioEntry({ env: { TOKEN: "$PI_WEB_PASSWORD" } }), 'env "TOKEN"'],
    [stdioEntry({ env: { OTHER: "x", TOKEN: "Bearer ${PI_WEB_PASSWORD}" } }), 'env "TOKEN"'],
    [stdioEntry({ env: { TOKEN: "${pi_web_password}" } }), 'env "TOKEN"'],
    [stdioEntry({ env: { TOKEN: "!printenv PI_WEB_PASSWORD" } }), 'env "TOKEN"'],
    [
      { name: "remote", config: { url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer $PI_WEB_PASSWORD" } }, source: "test" },
      'header "Authorization"',
    ],
    [
      { name: "remote", config: { url: "https://mcp.example.com/mcp", oauth: { clientId: "id", clientSecret: "${PI_WEB_PASSWORD}" } }, source: "test" },
      "oauth.clientSecret",
    ],
  ];
  let sdkCalls = 0;
  const factory = createPiNextMcpTransportFactory({
    ...internals,
    createDefaultTransport: (...args) => {
      sdkCalls++;
      return internals.createDefaultTransport(...args);
    },
  });
  for (const [entry, field] of refused) {
    assert.equal(findWebPasswordReference(entry.config, internals), field);
    assert.throws(
      () => factory(entry, "/work", undefined),
      new RegExp(`MCP server "${entry.name}" ${field} references PI_WEB_PASSWORD`),
    );
  }
  // 拒在 SDK 解析任何值之前，所以一条 `!command` 都没跑。
  assert.equal(sdkCalls, 0);

  for (const value of ["$${PI_WEB_PASSWORD}", "${PI_WEB_PASSWORD_HINT}", "literal PI_WEB_PASSWORD"]) {
    assert.equal(findWebPasswordReference({ command: "server", env: { TOKEN: value } }, internals), undefined, value);
  }
});

test("被拒的条目连不上，也不会起任何进程", async (t) => {
  if (!support.ok) return t.skip(`pi SDK ${support.version} 没有内置 MCP 扩展：${support.reason}`);
  const internals = await loadInternals();
  const factory = createPiNextMcpTransportFactory(internals);
  const transports = [];
  await withFixtureServer(async (server) => {
    await withHostEnvironment(async () => {
      const connection = new internals.McpServerConnection({
        entry: stdioEntry({ args: [server], env: { TOKEN: "${PI_WEB_PASSWORD}" } }),
        cwd: tmpdir(),
        createTransport: (...args) => {
          const transport = factory(...args);
          transports.push(transport);
          return transport;
        },
        credentials: new internals.McpOAuthCredentialStore(),
        onTools: () => {},
      });
      try {
        await assert.rejects(connection.getClient(), /references PI_WEB_PASSWORD/);
        assert.equal(connection.state, "failed");
        assert.equal(transports.length, 0);
      } finally {
        await connection.close();
      }
    });
  });
});

test("stdio transport 保留 SDK 传下来的每个选项，只换 env", async (t) => {
  if (!support.ok) return t.skip(`pi SDK ${support.version} 没有内置 MCP 扩展：${support.reason}`);
  const internals = await loadInternals();
  const entry = stdioEntry({
    command: "~/bin/server",
    args: ["~/data", "--flag"],
    cwd: "sub",
    env: { TOKEN: "literal" },
  });
  const sdkTransport = internals.createDefaultTransport(entry, "/work", undefined);
  const transport = createPiNextMcpTransportFactory(internals)(entry, "/work", undefined);

  assert.ok(transport instanceof internals.StdioTransport);
  assert.notEqual(transport, sdkTransport);
  assert.equal(transport.pid, undefined);
  const { env, inheritEnv, ...options } = transport.options;
  assert.deepEqual({ ...options, env: sdkTransport.options.env }, sdkTransport.options);
  assert.equal(inheritEnv, false);
  assert.equal(env.TOKEN, "literal");
  assert.equal(Object.hasOwn(env, "PI_WEB_PASSWORD"), false);
});

test("http server 原样用 SDK 的 transport", async (t) => {
  if (!support.ok) return t.skip(`pi SDK ${support.version} 没有内置 MCP 扩展：${support.reason}`);
  const internals = await loadInternals();
  await withHostEnvironment(() => {
    const entry = {
      name: "remote",
      config: { url: "https://mcp.example.com/mcp", headers: { "X-Reference": "${PI_WEB_TEST_REFERENCED}" } },
      source: "test",
    };
    const authProvider = { token: async () => "token" };
    const sdkTransport = internals.createDefaultTransport(entry, "/work", authProvider);
    const transport = createPiNextMcpTransportFactory(internals)(entry, "/work", authProvider);

    assert.equal(transport.constructor, sdkTransport.constructor);
    assert.ok(!(transport instanceof internals.StdioTransport));
    assert.deepEqual(transport.options, sdkTransport.options);
    assert.deepEqual(transport.options.headers, { "X-Reference": "referenced-value" });
    assert.equal(transport.options.authProvider, authProvider);
  });
});

test("绝不使用本仓没有洗过的 transport", async (t) => {
  if (!support.ok) return t.skip(`pi SDK ${support.version} 没有内置 MCP 扩展：${support.reason}`);
  const internals = await loadInternals();
  const notStdio = createPiNextMcpTransportFactory({ ...internals, createDefaultTransport: () => ({}) });
  assert.throws(() => notStdio(stdioEntry(), "/work", undefined), /the SDK did not create a stdio transport/);

  const extraEnvironment = createPiNextMcpTransportFactory({
    ...internals,
    createDefaultTransport: () => new internals.StdioTransport({ command: "server", env: { HOME: "/home/pi" } }),
  });
  assert.throws(
    () => extraEnvironment(stdioEntry(), "/work", undefined),
    /the SDK set environment variable HOME, which its config does not declare/,
  );
});

test("server 的 stderr 能进到连接错误里", async (t) => {
  if (!support.ok) return t.skip(`pi SDK ${support.version} 没有内置 MCP 扩展：${support.reason}`);
  const internals = await loadInternals();
  const factory = createPiNextMcpTransportFactory(internals);
  await withFixtureServer(async (server) => {
    const connection = new internals.McpServerConnection({
      entry: stdioEntry({ args: [server], env: { PI_WEB_FIXTURE_FAIL: "fixture cannot start" } }),
      cwd: tmpdir(),
      createTransport: factory,
      credentials: new internals.McpOAuthCredentialStore(),
      onTools: () => {},
    });
    try {
      // McpServerConnection 只从 runtime.js 自己 import 的 StdioTransport 实例上读 stderr，
      // 认错类就丢，所以这条同时也是「没有第二份 pi-mcp」的回归。
      await assert.rejects(connection.getClient(), /failed to connect: [^]*fixture cannot start/);
      assert.equal(connection.state, "failed");
      assert.match(connection.error, /fixture cannot start/);
    } finally {
      await connection.close();
    }
  });
});

test("环境是在连接时读的，不是工厂建好时", async (t) => {
  if (!support.ok) return t.skip(`pi SDK ${support.version} 没有内置 MCP 扩展：${support.reason}`);
  const internals = await loadInternals();
  const factory = createPiNextMcpTransportFactory(internals);
  const entry = stdioEntry();
  const before = factory(entry, "/work", undefined).options.env;
  await withHostEnvironment(() => {
    const during = factory(entry, "/work", undefined).options.env;
    assert.equal(Object.hasOwn(before, "PI_WEB_TEST_INHERITED"), false);
    assert.equal(during.PI_WEB_TEST_INHERITED, "inherited-value");
    assert.equal(Object.hasOwn(during, "PI_WEB_PASSWORD"), false);
  });
});

test("会话关停会回收已创建但 initialize 卡住的子进程", async (t) => {
  if (!support.ok) return t.skip(`pi SDK ${support.version} 没有内置 MCP 扩展：${support.reason}`);
  const internals = await loadInternals();
  const innerFactory = createPiNextMcpTransportFactory(internals);
  const gate = createMcpSessionLivenessGate({ sessionId: "shutdown-reap", isActive: () => true });
  const transports = [];
  const factory = createSessionGatedTransportFactory((...args) => {
    const transport = innerFactory(...args);
    transports.push(transport);
    return transport;
  }, gate);
  await withFixtureServer(async (server) => {
    const connection = new internals.McpServerConnection({
      entry: stdioEntry({ args: [server] }),
      cwd: tmpdir(),
      createTransport: factory,
      credentials: new internals.McpOAuthCredentialStore(),
      onTools: () => {},
    });
    try {
      const pending = connection.getClient().catch((error) => error);
      await waitFor(() => transports[0]?.pid !== undefined);
      const pid = transports[0].pid;
      assert.equal(isProcessAlive(pid), true, "initialize 卡住时子进程应该还活着");

      // session_shutdown 的时序：闸门已放行、connect 还没完成。
      gate.dispose();
      const error = await pending;
      assert.ok(error instanceof Error, "connect 应该以错误结束而不是永远挂着");
      await waitFor(() => !isProcessAlive(pid));
      assert.equal(isProcessAlive(pid), false, `子进程 ${pid} 活过了会话关停`);
    } finally {
      await connection.close();
    }
  }, HANGING_SERVER);
});
