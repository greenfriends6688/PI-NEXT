/**
 * fork:proma-46-mcp-catalog — 目录纯逻辑 + 冷却状态机 + 凭据前缀/绑定的单测。
 *
 * 不依赖 SDK：目录与冷却都是纯函数，所以这份测试在任何 SDK 版本下都跑。
 * 冷却的 transport 包装（`createCooldownGatedTransportFactory`）另用假 transport 验证。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const catalog = await jiti.import("./mcp-catalog.ts");
const transport = await jiti.import("./mcp-transport.ts");

const {
  MCP_CATALOG,
  MCP_FAILURE_COOLDOWN_MS,
  buildCatalogServerConfig,
  compareCatalogEntries,
  createMcpFailureCooldown,
  createStdioCredentialBinding,
  findCatalogEntry,
  formatCredentialValue,
  groupCatalogEntries,
  isCatalogEntryValid,
  mcpFailureKey,
  referencesWebPassword,
  sortCatalogEntries,
  stableStringify,
  stdioCredentialBindingMatches,
  stripCredentialPrefix,
} = catalog;

// ───────────────────────────── 目录数据 / 排序 ─────────────────────────────

test("目录里每条都是有效的、且按类分组后顺序稳定", () => {
  assert.equal(MCP_CATALOG.length, 10);
  for (const entry of MCP_CATALOG) {
    assert.equal(isCatalogEntryValid(entry), true, `${entry.id} 应该有效`);
    assert.equal(referencesWebPassword(entry), false, `${entry.id} 不许引用 PI_WEB_PASSWORD`);
  }
  const groups = groupCatalogEntries();
  assert.deepEqual(groups.map((group) => group.category), ["mcp", "credential", "cli"]);
  // 组内 priority 单调不减。
  for (const group of groups) {
    const priorities = group.entries.map((entry) => entry.priority);
    assert.deepEqual(priorities, [...priorities].sort((a, b) => a - b), `${group.category} 应稳定排序`);
  }
});

test("目录排序：先 priority，再 bottom 沉底，且不修改入参", () => {
  const entries = [
    { priority: 2, placement: "bottom" },
    { priority: 1 },
    { priority: 2 },
    { priority: 1, placement: "bottom" },
  ];
  assert.deepEqual(
    [...entries].sort(compareCatalogEntries).map((entry) => `${entry.priority}${entry.placement === "bottom" ? "b" : ""}`),
    ["1", "1b", "2", "2b"],
  );
  const valid = (id, priority, placement) => ({
    id, category: "mcp", name: id, descriptionKey: "k", transport: "remote", requiresCredential: false,
    priority, placement, serverName: id, setupUrl: "https://example.com", url: "https://example.com/mcp",
  });
  const frozen = Object.freeze([valid("a", 9), valid("b", 1)]);
  const sorted = sortCatalogEntries(frozen);
  assert.deepEqual(sorted.map((entry) => entry.id), ["b", "a"]);
  assert.deepEqual(frozen.map((entry) => entry.id), ["a", "b"], "sortCatalogEntries 不能改入参");
});

test("无效条目被剔除：缺 endpoint / 引用了登录口令", () => {
  const base = { id: "x", category: "mcp", name: "X", descriptionKey: "k", transport: "remote", requiresCredential: false, priority: 1, serverName: "x", setupUrl: "https://example.com", url: "https://example.com/mcp" };
  assert.equal(isCatalogEntryValid(base), true);
  assert.equal(isCatalogEntryValid({ ...base, url: undefined }), false);
  assert.equal(isCatalogEntryValid({ ...base, url: "ftp://example.com" }), false);
  assert.equal(isCatalogEntryValid({ ...base, args: ["$PI_WEB_PASSWORD"] }), false);
  assert.equal(isCatalogEntryValid({ ...base, credential: { envName: "PI_WEB_PASSWORD" } }), false);
});

// ───────────────────────────── 凭据前缀剥离 ─────────────────────────────

test("粘贴的 Bearer 前缀被剥离，且只拼一次", () => {
  assert.equal(stripCredentialPrefix("Bearer abc", "Bearer "), "abc");
  assert.equal(stripCredentialPrefix("bearer   abc", "Bearer "), "abc");
  assert.equal(stripCredentialPrefix("abc", "Bearer "), "abc");
  assert.equal(stripCredentialPrefix("  abc  "), "abc");
  assert.equal(stripCredentialPrefix("", "Bearer "), "");
  // 用户直接粘了完整 header 值：不会变成 "Bearer Bearer abc"。
  assert.equal(formatCredentialValue("Bearer abc", "Bearer "), "Bearer abc");
  assert.equal(formatCredentialValue("abc", "Bearer "), "Bearer abc");
  assert.equal(formatCredentialValue("abc", undefined), "abc");
});

// ───────────────────────────── stdio 命令绑定 ─────────────────────────────

test("stdio 凭据只在启动命令完全一致时才注入", () => {
  const binding = createStdioCredentialBinding("npx", ["-y", "@brave/brave-search-mcp-server", "--transport", "stdio"]);
  assert.equal(stdioCredentialBindingMatches(binding, { command: "npx", args: binding.args }), true);
  assert.equal(stdioCredentialBindingMatches(binding, { command: "node", args: binding.args }), false);
  assert.equal(stdioCredentialBindingMatches(binding, { command: "npx", args: ["-y", "evil"] }), false);
  assert.equal(stdioCredentialBindingMatches(binding, { command: "npx", args: [...binding.args, "extra"] }), false);
  assert.equal(stdioCredentialBindingMatches(undefined, { command: "npx", args: binding.args }), false);
});

// ───────────────────────────── 目录 → 配置 ─────────────────────────────

test("remote 条目的凭据写进 headers，stdio 条目的密钥不写进 mcp.json", () => {
  const exa = findCatalogEntry("exa");
  const remote = buildCatalogServerConfig(exa, "exa-key");
  assert.deepEqual(remote.config, { url: "https://mcp.exa.ai/mcp", headers: { "x-api-key": "exa-key" } });

  const tavily = buildCatalogServerConfig(findCatalogEntry("tavily-search"), "Bearer tvly-key");
  assert.deepEqual(tavily.config.headers, { Authorization: "Bearer tvly-key" });
  assert.equal(tavily.headerValue, "Bearer tvly-key");

  const brave = buildCatalogServerConfig(findCatalogEntry("brave-search"), "brave-key");
  assert.equal("env" in brave.config, false, "stdio 密钥不许写进 mcp.json");
  assert.equal(brave.envName, "BRAVE_API_KEY");
  assert.equal(brave.envValue, "brave-key");
  assert.equal(stdioCredentialBindingMatches(brave.credentialBinding, brave.config), true);
});

// ───────────────────────────── 冷却状态机 ─────────────────────────────

test("失败冷却：2 分钟内不可用，到点自动恢复，成功立即恢复", () => {
  let now = 1_000;
  const cooldown = createMcpFailureCooldown({ now: () => now });
  const key = mcpFailureKey("github", { url: "https://example.com/mcp" });
  assert.equal(cooldown.isCoolingDown(key), false);
  cooldown.markFailure(key);
  assert.equal(cooldown.isCoolingDown(key), true);
  now += MCP_FAILURE_COOLDOWN_MS - 1;
  assert.equal(cooldown.isCoolingDown(key), true, "窗口内仍冷却");
  now += 1;
  assert.equal(cooldown.isCoolingDown(key), false, "到点自动恢复");
  assert.equal(cooldown.size, 0, "过期的项被惰性清掉");

  cooldown.markFailure(key);
  cooldown.markSuccess(key);
  assert.equal(cooldown.isCoolingDown(key), false, "后台重连成功立即恢复");
});

test("冷却 key 含配置指纹：改配置即解除冷却", () => {
  const before = mcpFailureKey("srv", { command: "npx", args: ["a"] });
  const after = mcpFailureKey("srv", { args: ["a"], command: "npx" });
  assert.equal(before, after, "键顺序不影响指纹");
  assert.notEqual(before, mcpFailureKey("srv", { command: "npx", args: ["b"] }));
  assert.notEqual(before, mcpFailureKey("other", { command: "npx", args: ["a"] }));
  assert.equal(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
});

test("冷却表有上限，超出时淘汰最旧", () => {
  let now = 0;
  const cooldown = createMcpFailureCooldown({ limit: 2, now: () => now++ });
  cooldown.markFailure("a");
  cooldown.markFailure("b");
  cooldown.markFailure("c");
  assert.equal(cooldown.size, 2);
  assert.equal(cooldown.isCoolingDown("a"), false, "最旧的 a 被淘汰");
  assert.equal(cooldown.isCoolingDown("c"), true);
});

test("冷却包装：窗口内 start 直接失败，不建连；成功后清除", async () => {
  let now = 0;
  const cooldown = createMcpFailureCooldown({ now: () => now });
  const entry = { name: "srv", config: { command: "npx", args: ["a"] } };
  const key = mcpFailureKey("srv", entry.config);
  cooldown.markFailure(key);
  let created = 0;
  const factory = transport.createCooldownGatedTransportFactory(() => {
    created += 1;
    return fakeTransport(true);
  }, cooldown);
  const blocked = factory(entry, "/work", undefined);
  await assert.rejects(() => blocked.start(), /cooldown/);
  assert.equal(created, 0, "冷却期不许构造内层 transport");

  now += MCP_FAILURE_COOLDOWN_MS;
  const ok = factory(entry, "/work", undefined);
  await ok.start();
  assert.equal(created, 1);
  assert.equal(cooldown.isCoolingDown(key), false);
});

function fakeTransport(succeeds) {
  return {
    async start() { if (!succeeds) throw new Error("boom"); },
    async send() {},
    async close() {},
    onMessage() { return () => {}; },
    onError() { return () => {}; },
    onClose() { return () => {}; },
  };
}
