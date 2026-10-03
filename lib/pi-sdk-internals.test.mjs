/**
 * fork:pr11-mcp — `lib/pi-sdk-internals.ts` 的契约测试（上游依据 85f9cb1 + ADR 0006）。
 *
 * 分两类：
 *   1. **无条件跑**：三道防线（`PI_PACKAGE_DIR`、realpath 不一致、第二份 SDK / 第二份
 *      pi-mcp 副本）、每进程只加载一次、能力探测、内置扩展条目的形状。这些在 SDK 0.87
 *      （没有 MCP）上也要绿——它们是纯逻辑，用假模块喂进去。
 *   2. **SDK 不具备 MCP 就跳过**：真正把 0.99 内部件当契约钉住的那几条
 *      （路径、导出名、参数个数、prototype 方法）。本仓 SDK 锁 0.87，所以升级前它们
 *      打印一句原因就跳过；升级到 0.99 后必须全绿，否则说明 SDK 挪了路径或改了导出名，
 *      MCP 会在运行时悄悄变味。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { getPackageDir } from "@earendil-works/pi-coding-agent";
import { createRequire } from "node:module";
import { createJiti } from "jiti";

const require_fs = () => ({ readFileSync: createRequire(import.meta.url)("node:fs").readFileSync });

const {
  detectMcpSdkSupport,
  extensionContextFromPiContext,
  importPiSdkInternals,
  isMcpServerEnabled,
  loadPiSdkInternals,
  mcpBuiltinExtensionEntries,
  mcpDiscoveryExtensionEntries,
  normalizeMcpConfigForPiWeb,
  sanitizeMcpConfigErrors,
} = await createJiti(import.meta.url).import("./pi-sdk-internals.ts");

// 适配器伸手去拿 SDK 没导出的文件。SDK 升级只要挪了位置、改了名字或改了形状，
// 这里就得先红，而不是等到运行时 MCP 自己关掉。
const EXPECTED_MEMBERS = {
  McpServerConnection: {
    kind: "class",
    length: 1,
    methods: ["getClient", "callTool", "reconnect", "signOut", "oauthSettings", "close"],
  },
  createDefaultTransport: { kind: "function", length: 3 },
  StdioTransport: {
    kind: "class",
    length: 1,
    methods: ["start", "send", "close", "onMessage", "onError", "onClose"],
  },
  loadMcpConfig: { kind: "function", length: 1 },
  addMcpServerConfig: { kind: "function", length: 3 },
  updateMcpServerConfig: { kind: "function", length: 3 },
  removeMcpServerConfig: { kind: "function", length: 2 },
  validateMcpServerConfig: { kind: "function", length: 2 },
  getMcpToolExposure: { kind: "function", length: 2 },
  signInMcpServer: { kind: "function", length: 1 },
  McpOAuthCredentialStore: { kind: "class", length: 2, methods: ["forServer", "tokens", "remove"] },
  McpSignInCancelledError: { kind: "class", length: 0 },
  resolveConfigValueOrThrow: { kind: "function", length: 3 },
  resolveHeadersOrThrow: { kind: "function", length: 3 },
  getConfigValueEnvVarNames: { kind: "function", length: 1 },
  isCommandConfigValue: { kind: "function", length: 1 },
};

const MCP_CLIENT_ENTRY = "/fake/node_modules/@earendil-works/pi-mcp/dist/index.js";
const INTERNALS_CACHE = Symbol.for("pi-web.piSdkInternals");

const support = detectMcpSdkSupport();
const SKIP_REASON = support.ok
  ? false
  : `pi SDK ${support.version} 没有内置 MCP 扩展：${support.reason}`;

/** SDK 具备 MCP 才跑的契约测试的统一入口。 */
function withMcpSdk(t) {
  if (support.ok) return true;
  t.skip(SKIP_REASON);
  return false;
}

function isClass(value) {
  return typeof value === "function" && /^class[\s{]/.test(Function.prototype.toString.call(value));
}

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "pi-next-sdk-internals-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 假模块：路径后缀 → 命名空间。`overrides` 按模块名打洞。 */
function fakeModules(overrides = {}) {
  class FakeStdioTransport {
    constructor(options) {
      this.options = options;
      this.pid = undefined;
      this.stderr = "";
    }
  }
  class FakeServerConnection {}
  class FakeCredentialStore {}
  class FakeCancelledError extends Error {}
  const createMcpExtension = () => () => {};
  const createDefaultTransport = (entry) => new FakeStdioTransport({ command: entry.config.command });
  const modules = {
    mcpExtension: { createMcpExtension },
    mcpRuntime: {
      McpServerConnection: FakeServerConnection,
      McpOAuthCredentialStore: FakeCredentialStore,
      McpSignInCancelledError: FakeCancelledError,
      createDefaultTransport,
      signInMcpServer: () => {},
    },
    mcpConfig: {
      loadMcpConfig: () => ({ servers: [], errors: [] }),
      addMcpServerConfig: () => false,
      updateMcpServerConfig: () => {},
      removeMcpServerConfig: () => false,
    },
    mcpServers: {
      validateMcpServerConfig: () => ({ command: "npx" }),
      getMcpToolExposure: () => "codemode",
    },
    mcpOAuth: {
      McpOAuthCredentialStore: FakeCredentialStore,
      McpSignInCancelledError: FakeCancelledError,
      signInMcpServer: () => {},
    },
    mcpClient: { StdioTransport: FakeStdioTransport },
    configValues: {
      resolveConfigValueOrThrow: (config) => config,
      resolveHeadersOrThrow: (headers) => headers,
      getConfigValueEnvVarNames: () => [],
      isCommandConfigValue: (config) => config.startsWith("!"),
    },
  };
  for (const [name, patch] of Object.entries(overrides)) {
    modules[name] = { ...modules[name], ...patch };
  }
  return modules;
}

const MODULE_BY_PATH = {
  "extensions/mcp/index.js": "mcpExtension",
  "extensions/mcp/runtime.js": "mcpRuntime",
  "extensions/mcp/config.js": "mcpConfig",
  "extensions/mcp/oauth.js": "mcpOAuth",
  "core/mcp-servers.js": "mcpServers",
  "core/resolve-config-value.js": "configValues",
};

/** 把 `importPiSdkInternals` 的测试接缝接上，返回一个只等结果的小工具。 */
function loadWithFakes({ overrides = {}, failPath = null, resolveMcpClient, secondCopy = false } = {}) {
  const modules = fakeModules(overrides);
  const loadModule = async (path) => {
    if (failPath !== null && path.endsWith(failPath)) throw new Error("boom");
    const name = path === MCP_CLIENT_ENTRY ? "mcpClient" : Object.entries(MODULE_BY_PATH)
      .find(([tail]) => path.endsWith(tail))?.[1];
    if (name === undefined) throw new Error(`unexpected module: ${path}`);
    return modules[name];
  };
  return importPiSdkInternals({
    loadModule,
    resolveMcpClient: resolveMcpClient ?? (() => MCP_CLIENT_ENTRY),
    // 正常情况下内部模块里的 createMcpExtension 就是根导出的那一个；`secondCopy`
    // 故意换一个函数实例，模拟「file URL 加载出了第二份 SDK」。
    rootCreateMcpExtension: secondCopy ? () => () => {} : modules.mcpExtension.createMcpExtension,
  });
}

test("能力探测说清楚这份 SDK 有没有内置 MCP 扩展", () => {
  if (support.ok) {
    assert.equal(support.packageDir, realpathSync(getPackageDir()));
    assert.match(support.version, /^\d+\.\d+\.\d+/);
    return;
  }
  assert.match(support.reason, /createMcpExtension|dist\/extensions\/mcp|dist\/core\/mcp-servers/);
  assert.match(support.reason, /0\.99/, "要说出需要哪个版本，升级的人才知道去哪儿");
});

test("SDK 不带 MCP 时不注册 builtin:mcp，带的时候按 CLI 的形状注册", () => {
  const entries = mcpBuiltinExtensionEntries();
  if (!support.ok) {
    // 0.87：没有 createMcpExtension 这个导出，硬接会让 tsc 直接红，所以这里必须是空数组。
    assert.deepEqual(entries, []);
    return;
  }
  assert.equal(entries.length, 1);
  const [entry] = entries;
  assert.equal(entry.name, "mcp", "名字要跟 CLI 一致，DefaultResourceLoader 才按 builtin:mcp 解析");
  assert.equal(entry.replaceable, true, "第三方扩展注册 /mcp 时要让位");
  assert.equal(entry.builtin, true, "要成为 -builtin:mcp / --no-extensions 能关掉的资源");
  assert.equal(typeof entry.factory, "function");
});

test("fork:mcp-auto-reload —— `/mcp` 的落盘交给宿主，扩展注册的 server 不落盘", () => {
  // P0-3：不传 updateConfig 时 pi 自己改 mcp.json，会绕开本仓的 0600 + staging 原子写。
  // 这里钉住三件事：钩子被接上、`extension` scope 按 pi 的约定不写、没注入时不报错。
  const { readFileSync } = require_fs();
  const source = readFileSync(new URL("./pi-sdk-internals.ts", import.meta.url), "utf8");
  assert.match(source, /updateConfig: \(entry, patch\) => \{/);
  assert.match(source, /if \(!applyPatch\) return;/);
  assert.match(source, /if \(entry\.scope === "extension"\) return;/);
  assert.match(
    source,
    /updateConfig\?: \(entry: McpServerEntry, patch: McpServerConfigPatch\) => void;/,
  );

  // 不注入 applyPatch 也必须能构造出条目（契约测试与 0.87 降级路径都这么调）。
  const entries = mcpBuiltinExtensionEntries();
  if (support.ok) {
    assert.equal(entries.length, 1);
    assert.equal(typeof entries[0].factory, "function");
  }
});

test("扩展 ctx 只取接线要用的字段，缺什么都有安全默认", () => {
  assert.deepEqual(
    extensionContextFromPiContext({
      cwd: "/repo",
      isProjectTrusted: () => true,
      sessionManager: { getSessionId: () => "sid-1", getSessionFile: () => "/tmp/sid-1.jsonl" },
    }),
    { cwd: "/repo", projectTrusted: true, sessionId: "sid-1", sessionFile: "/tmp/sid-1.jsonl" },
  );

  const bare = extensionContextFromPiContext({});
  assert.equal(bare.projectTrusted, false, "ctx 不认识时按未信任处理");
  assert.equal(bare.sessionId, "", "没有会话身份就不放行连接（闸门会等超时）");
  assert.equal(bare.sessionFile, undefined);
  assert.equal(typeof bare.cwd, "string");

  // 会抛的 isProjectTrusted / 非字符串 sessionFile 不当成信任。
  const odd = extensionContextFromPiContext({
    isProjectTrusted: () => { throw new Error("boom"); },
    sessionManager: { getSessionFile: () => 42 },
  });
  assert.equal(odd.projectTrusted, false);
  assert.equal(odd.sessionFile, undefined);
});

test("fork:mcp-native-exposure —— exposure 原样透传，只归一别名 + 折 legacy disabled", () => {
  // 1.0 起 codemode / tool_search 已公开导出并在会话里注册（mcpDiscoveryExtensionEntries），
  // 所以运行时不再把 codemode/deferred 降级成 direct —— 那是当年为了绕开「包不导出」
  // 才加的 workaround，前提已经不存在。现在只做三件事：别名归一、legacy disabled 折叠、
  // 错误清洗。
  const loaded = {
    servers: [
      { name: "a", config: { command: "x", exposure: "codemode" }, source: "s", scope: "global" },
      { name: "b", config: { command: "y", exposure: "deferred", toolExposure: { read: "codemode", write: "hidden" } }, source: "s", scope: "global" },
      { name: "c", config: { url: "https://example.com/mcp", exposure: "hidden" }, source: "s", scope: "global" },
      { name: "alias", config: { command: "z", exposure: "codemode-deferred" }, source: "s", scope: "global" },
      { name: "bare", config: { command: "w" }, source: "s", scope: "global" },
      { name: "legacy", config: { command: "old", disabled: true }, source: "s", scope: "global" },
    ],
    errors: ["e"],
  };
  const normalized = normalizeMcpConfigForPiWeb(loaded);
  assert.equal(normalized.servers[0].config.exposure, "codemode", "codemode 保持原样（模型工具表里不该有它）");
  assert.equal(normalized.servers[1].config.exposure, "deferred", "deferred 保持原样");
  assert.deepEqual(normalized.servers[1].config.toolExposure, { read: "codemode", write: "hidden" });
  assert.equal(normalized.servers[2].config.exposure, "hidden", "hidden 保持隐藏");
  assert.equal(normalized.servers[3].config.exposure, "codemode", "别名 codemode-deferred 归一成 codemode");
  assert.equal("exposure" in normalized.servers[4].config, false, "没声明就留空，让 pi 自己按默认值（codemode）处理");
  assert.equal(normalized.servers[5].config.enabled, false, "legacy disabled:true 折成 enabled:false");
  assert.equal("disabled" in normalized.servers[5].config, false, "disabled 键必须删掉（isEnabled 不认它）");
  assert.deepEqual(normalized.errors, ["e"]);
  assert.equal(loaded.servers[0].config.exposure, "codemode", "不修改原对象");
  assert.equal(loaded.servers[5].config.disabled, true, "不修改原对象（legacy）");
});

test("fork:mcp-native-exposure —— SDK 不带这两个扩展时退回降级", () => {
  // 本仓历史上锁过 0.87 / 0.99，那时 `createCodemodeExtension` 不存在、codemode 曝光的
  // 工具没人能调 —— 所以降级逻辑没有删，只是变成「按能力选」，不会在老 SDK 上退化。
  const loaded = {
    servers: [
      { name: "a", config: { command: "x", exposure: "codemode" }, source: "s", scope: "global" },
      { name: "b", config: { command: "y", toolExposure: { read: "codemode", write: "hidden" } }, source: "s", scope: "global" },
      { name: "c", config: { url: "https://example.com/mcp", exposure: "hidden" }, source: "s", scope: "global" },
    ],
    errors: [],
  };
  const downgraded = normalizeMcpConfigForPiWeb(loaded, { nativeExposure: false });
  assert.equal(downgraded.servers[0].config.exposure, "direct");
  assert.deepEqual(downgraded.servers[1].config.toolExposure, { read: "direct", write: "hidden" });
  assert.equal(downgraded.servers[2].config.exposure, "hidden", "hidden 两种模式都保持隐藏");

  const native = normalizeMcpConfigForPiWeb(loaded, { nativeExposure: true });
  assert.equal(native.servers[0].config.exposure, "codemode");
  assert.equal(native.servers[1].config.toolExposure.read, "codemode");
});

test("fork:mcp-native-exposure —— codemode / tool_search 随 MCP 一起注册", () => {
  const entries = mcpDiscoveryExtensionEntries();
  if (!support.ok) {
    // SDK 不带这两个导出时必须是空数组（不能硬引用，那会让 tsc 直接红）。
    assert.deepEqual(entries, []);
    return;
  }
  assert.deepEqual(entries.map((entry) => entry.name), ["codemode", "tool-search"]);
  for (const entry of entries) {
    assert.equal(entry.builtin, true, "要成为 -builtin:<name> / --no-extensions 能关掉的资源");
    assert.equal(typeof entry.factory, "function");
  }
});
test("isMcpServerEnabled 与 pi 的 isEnabled 同口径，UI 与运行时共用", () => {
  assert.equal(isMcpServerEnabled({ command: "x" }), true);
  assert.equal(isMcpServerEnabled({ command: "x", enabled: true }), true);
  assert.equal(isMcpServerEnabled({ command: "x", enabled: false }), false);
  // pi 不认 disabled；它只是旧版 pi.web 的方言，运行时归一化前也必须算禁用。
  assert.equal(isMcpServerEnabled({ command: "x", disabled: true }), false);
  assert.equal(isMcpServerEnabled({ command: "x", disabled: false }), true);
  assert.equal(isMcpServerEnabled({ command: "x", enabled: true, disabled: true }), false);
});

test("sanitizeMcpConfigErrors：parser 原文一律换成 malformed JSON", () => {
  const files = ["/home/u/.pi/agent/mcp.json", "/repo/.pi/mcp.json"];
  const secret = "sk-live-123";
  const parserText = `/home/u/.pi/agent/mcp.json: Unexpected token 's', "{\"a\": ${secret}}" is not valid JSON`;
  const sanitized = sanitizeMcpConfigErrors(files, [
    parserText,
    `/repo/.pi/mcp.json: server "x" needs either "command" (stdio) or "url" (streamable HTTP)`,
    `/home/u/.pi/agent/mcp.json: autoEnableCodemode must be a boolean`,
    `/repo/.pi/mcp.json: expected an object with an "mcpServers" object`,
    "unrelated error stays",
  ]);
  assert.equal(sanitized[0], "/home/u/.pi/agent/mcp.json: malformed JSON");
  assert.ok(!sanitized.some((error) => error.includes(secret)), "秘密不得进任何 error");
  assert.ok(!sanitized.some((error) => error.includes("Unexpected token")), "parser 原文不得进任何 error");
  assert.match(sanitized[1], /server "x" needs either/);
  assert.match(sanitized[2], /autoEnableCodemode/);
  assert.match(sanitized[3], /expected an object/);
  assert.equal(sanitized[4], "unrelated error stays");
});

test("每个进程只加载一次内部件", async () => {
  const first = loadPiSdkInternals();
  assert.equal(first, loadPiSdkInternals(), "重复调用返回同一个 Promise");
  assert.equal(globalThis[INTERNALS_CACHE], first, "缓存挂在 globalThis 上，跨模块图存活");
  assert.equal(await first, await loadPiSdkInternals());
});

test("PI_PACKAGE_DIR 指向别处时拒绝加载", async () => {
  await withTempDir(async (dir) => {
    const result = await importPiSdkInternals({ environment: { ...process.env, PI_PACKAGE_DIR: dir } });
    assert.equal(result.ok, false);
    assert.match(result.reason, /PI_PACKAGE_DIR is set/);
  });
});

test("本仓解析到另一份 SDK 时拒绝加载", async () => {
  await withTempDir(async (dir) => {
    const packageDir = join(dir, "node_modules", "@earendil-works", "pi-coding-agent");
    await mkdir(packageDir, { recursive: true });
    await writeFile(join(packageDir, "package.json"), JSON.stringify({
      name: "@earendil-works/pi-coding-agent",
      type: "module",
      exports: { ".": { import: "./dist/index.js" } },
    }));
    const result = await importPiSdkInternals({ cwd: dir });
    assert.equal(result.ok, false);
    assert.match(result.reason, /is not the package PI NEXT resolves/);
  });
});

test("本仓根本解析不到 SDK 时拒绝加载", async () => {
  await withTempDir(async (dir) => {
    const result = await importPiSdkInternals({ cwd: dir });
    assert.equal(result.ok, false);
    assert.match(result.reason, /cannot locate @earendil-works\/pi-coding-agent/);
  });
});

test("内部件齐了就把它们原样交出来（不多不少）", async () => {
  const internals = await loadWithFakes();
  assert.equal(internals.ok, true, internals.reason);
  const exposed = Object.keys(internals).filter((key) => key !== "ok" && key !== "packageDir").sort();
  assert.deepEqual(exposed, Object.keys(EXPECTED_MEMBERS).sort());
  assert.equal(internals.packageDir, realpathSync(getPackageDir()));
});

test("内部件被改名或挪位置时带着原因拒绝，而不是行为变味", async () => {
  const renamed = await loadWithFakes({ overrides: { mcpRuntime: { McpServerConnection: undefined } } });
  assert.equal(renamed.ok, false);
  assert.match(renamed.reason, /mcp\/runtime\.js does not export McpServerConnection as a class/);

  // 函数与类互换也要看得见：kind 对不上就是搬错了。
  const wrongKind = await loadWithFakes({
    overrides: { mcpServers: { validateMcpServerConfig: class {} } },
  });
  assert.equal(wrongKind.ok, false);
  assert.match(wrongKind.reason, /does not export validateMcpServerConfig as a function/);

  const unresolvable = await loadWithFakes({
    resolveMcpClient: () => {
      throw new Error("cannot resolve @earendil-works/pi-mcp");
    },
  });
  assert.equal(unresolvable.ok, false);
  assert.match(unresolvable.reason, /@earendil-works\/pi-mcp: cannot resolve/);

  const unloadable = await loadWithFakes({ failPath: "core/mcp-servers.js" });
  assert.equal(unloadable.ok, false);
  assert.match(unloadable.reason, /cannot load .*core\/mcp-servers\.js: boom/);
});

test("拒绝第二份 SDK 与第二份 pi-mcp 副本", async () => {
  const secondSdk = await loadWithFakes({ secondCopy: true });
  assert.equal(secondSdk.ok, false);
  assert.match(secondSdk.reason, /loaded as a second copy of @earendil-works\/pi-coding-agent/);

  // McpServerConnection 只认 runtime.js 自己 import 的那个 StdioTransport 类：
  // 认错了就丢 server 的 stderr，所以这里必须当副本处理。
  const secondMcp = await loadWithFakes({
    overrides: { mcpRuntime: { createDefaultTransport: () => ({ options: {} }) } },
  });
  assert.equal(secondMcp.ok, false);
  assert.match(secondMcp.reason, /@earendil-works\/pi-mcp resolved to another copy/);
});

test("真 SDK 上的每一件内部件都还在原来的位置、原来的形状", async (t) => {
  if (!withMcpSdk(t)) return;
  const internals = await loadPiSdkInternals();
  assert.equal(internals.ok, true, internals.reason);
  assert.equal(internals.packageDir, realpathSync(getPackageDir()));
  for (const [name, expected] of Object.entries(EXPECTED_MEMBERS)) {
    const member = internals[name];
    assert.equal(typeof member, "function", `${name} is missing`);
    assert.equal(isClass(member), expected.kind === "class", `${name} is not a ${expected.kind}`);
    assert.equal(member.length, expected.length, `${name} takes ${member.length} parameters`);
    for (const method of expected.methods ?? []) {
      assert.equal(typeof member.prototype[method], "function", `${name}.prototype.${method} is missing`);
    }
  }
  const exposed = Object.keys(internals).filter((key) => key !== "ok" && key !== "packageDir").sort();
  assert.deepEqual(exposed, Object.keys(EXPECTED_MEMBERS).sort());
});

test("SDK 用它自己导出的 StdioTransport 类造 stdio transport", async (t) => {
  if (!withMcpSdk(t)) return;
  const { createDefaultTransport, StdioTransport } = await loadPiSdkInternals();
  const transport = createDefaultTransport(
    {
      name: "contract",
      config: { command: "~/server", args: ["~/data", "--flag"], cwd: "sub", env: { TOKEN: "$${literal}" } },
      source: "test",
    },
    "/work",
    undefined,
  );

  assert.ok(transport instanceof StdioTransport);
  assert.equal(transport.pid, undefined, "constructing a transport spawns nothing");
  // lib/mcp-transport.ts 把这些原样搬过去，只换掉 `env`，所以 `env` 里只能有
  // entry 自己声明的值。
  assert.deepEqual(Object.keys(transport.options).sort(), ["args", "command", "cwd", "env", "stderr"]);
  assert.deepEqual(transport.options.env, { TOKEN: "${literal}" });
  assert.equal(transport.options.inheritEnv, undefined);
  assert.equal(transport.options.cwd, resolve("/work", "sub"));
  assert.equal(transport.options.stderr, "pipe");
});

test("配置、校验与取值助手保持本仓依赖的形状", async (t) => {
  if (!withMcpSdk(t)) return;
  const internals = await loadPiSdkInternals();

  assert.deepEqual(internals.validateMcpServerConfig("files", { command: "npx", args: ["server"] }), {
    command: "npx",
    args: ["server"],
  });
  assert.equal(typeof internals.validateMcpServerConfig("broken", { command: 1 }), "string");
  assert.equal(internals.getMcpToolExposure({ command: "npx" }, "read"), "codemode");

  assert.deepEqual(internals.getConfigValueEnvVarNames("Bearer ${TOKEN} $USER $${ESCAPED}"), ["TOKEN", "USER"]);
  assert.deepEqual(internals.getConfigValueEnvVarNames("!printenv TOKEN"), []);
  assert.equal(internals.isCommandConfigValue("!printenv TOKEN"), true);
  assert.equal(internals.isCommandConfigValue("$!literal"), false);
  assert.equal(internals.resolveConfigValueOrThrow("a-${VALUE}", "test", { VALUE: "b" }), "a-b");
  assert.throws(
    () => internals.resolveConfigValueOrThrow("${PI_WEB_INTERNALS_TEST_MISSING}", "test value"),
    /test value from environment variable: PI_WEB_INTERNALS_TEST_MISSING/,
  );
  assert.ok(new internals.McpSignInCancelledError() instanceof Error);

  await withTempDir(async (dir) => {
    const path = join(dir, "mcp.json");
    assert.equal(internals.addMcpServerConfig(path, "files", { command: "npx" }), false);
    internals.updateMcpServerConfig(path, "files", { enabled: false });
    const loaded = internals.loadMcpConfig({ agentDir: dir, cwd: dir, projectTrusted: false });
    assert.deepEqual(loaded, {
      servers: [{ name: "files", config: { command: "npx", enabled: false }, source: path, scope: "global" }],
      errors: [],
    });
    assert.equal(internals.removeMcpServerConfig(path, "files"), true);
    assert.equal(internals.removeMcpServerConfig(path, "files"), false);
  });
});
