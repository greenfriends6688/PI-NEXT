/**
 * fork:pr11-mcp — `lib/mcp-config-file.ts` tests.
 *
 * The module forwards reads/edits to pi 1.0's config primitives; these tests pin
 * the two invariants it adds around them: every edit is an atomic 0600 replace,
 * and a malformed file never leaks parser text (which quotes file contents).
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  addMcpServer,
  addMcpServers,
  applyMcpServerPatch,
  getMcpServerConfig,
  loadMcpConfigFile,
  loadMcpConfigFiles,
  removeMcpServer,
  setMcpServerEnabled,
} = await jiti.import("./mcp-config-file.ts");

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-mcp-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function modeOf(file) {
  return statSync(file).mode & 0o777;
}

test("a missing file is an empty config, not an error", async (t) => {
  const dir = fixture(t);
  const file = join(dir, "mcp.json");
  const loaded = await loadMcpConfigFile(file);
  assert.equal(loaded.exists, false);
  assert.deepEqual(loaded.servers, []);
  assert.deepEqual(loaded.errors, []);
});

test("add creates a private (0600) file and keeps unrelated top-level keys", async (t) => {
  const dir = fixture(t);
  const file = join(dir, "mcp.json");
  write(file, `{\n    "autoEnableCodemode": false,\n    "mcpServers": {}\n}\n`);

  const replaced = await addMcpServer(file, "files", {
    command: "npx",
    args: ["-y", "server"],
  });
  assert.equal(replaced, false);
  assert.equal(modeOf(file), 0o600);
  assert.match(readFileSync(file, "utf8"), /^    "autoEnableCodemode": false,/m, "pi keeps the file's indentation");

  const loaded = await loadMcpConfigFile(file);
  assert.deepEqual(loaded.servers.map((server) => server.name), ["files"]);
  assert.equal(loaded.autoEnableCodemode, false);

  const again = await addMcpServer(file, "files", { command: "other" });
  assert.equal(again, true);
  assert.deepEqual(await getMcpServerConfig(file, "files"), { command: "other" });
});

test("enable/disable uses pi's `enabled` key and folds the legacy `disabled` key", async (t) => {
  const dir = fixture(t);
  const file = join(dir, "mcp.json");
  await addMcpServer(file, "files", { command: "npx" });

  await setMcpServerEnabled(file, "files", false);
  assert.deepEqual(await getMcpServerConfig(file, "files"), { command: "npx", enabled: false });
  await setMcpServerEnabled(file, "files", true);
  assert.deepEqual(await getMcpServerConfig(file, "files"), { command: "npx" });

  // A file written by an older pi.web uses `disabled`; enabling must not leave it behind.
  write(file, JSON.stringify({ mcpServers: { legacy: { command: "npx", disabled: true } } }, null, 2) + "\n");
  await setMcpServerEnabled(file, "legacy", true);
  const raw = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(raw.mcpServers.legacy.disabled, undefined);
  assert.equal(raw.mcpServers.legacy.enabled, undefined);
  await setMcpServerEnabled(file, "legacy", false);
  assert.deepEqual(await getMcpServerConfig(file, "legacy"), { command: "npx", enabled: false });
});

test("remove reports whether the file defined the server", async (t) => {
  const dir = fixture(t);
  const file = join(dir, "mcp.json");
  await addMcpServer(file, "files", { command: "npx" });
  assert.equal(await removeMcpServer(file, "files"), true);
  assert.equal(await removeMcpServer(file, "files"), false);
  assert.deepEqual((await loadMcpConfigFile(file)).servers, []);
});

test("a batch lands in one write and a malformed file is refused without parser text", async (t) => {
  const dir = fixture(t);
  const file = join(dir, "mcp.json");
  await addMcpServers(file, [
    { name: "one", config: { command: "one" } },
    { name: "two", config: { command: "two" } },
  ]);
  assert.deepEqual((await loadMcpConfigFile(file)).servers.map((server) => server.name).sort(), ["one", "two"]);

  const secret = "sk-test-mcp-config-7c2f";
  write(file, `{"mcpServers": {"x": {"command": "${secret}"`);
  await assert.rejects(() => addMcpServer(file, "y", { command: "y" }), /malformed JSON/);
  // The original file is untouched, and the parser message never reaches callers.
  assert.match(readFileSync(file, "utf8"), new RegExp(secret));
  const loaded = await loadMcpConfigFile(file);
  assert.equal(loaded.errors.some((error) => error.includes("malformed JSON")), true);
  assert.equal(loaded.errors.some((error) => error.includes(secret)), false, "no config content in diagnostics");
});

test("loadMcpConfigFiles merges global + trusted project with pi's precedence", async (t) => {
  const dir = fixture(t);
  const agentDir = join(dir, "agent");
  const cwd = join(dir, "project");
  write(join(agentDir, "mcp.json"), JSON.stringify({
    mcpServers: { shared: { command: "global" }, globalOnly: { command: "global-only" } },
  }));
  write(join(cwd, ".pi", "mcp.json"), JSON.stringify({
    mcpServers: { shared: { command: "project" }, projectOnly: { command: "project-only" } },
  }));

  const trusted = await loadMcpConfigFiles({ agentDir, cwd, projectTrusted: true });
  const byName = Object.fromEntries(trusted.servers.map((server) => [server.name, server]));
  assert.equal(byName.shared.config.command, "project");
  assert.equal(byName.shared.scope, "project");
  assert.equal(byName.globalOnly.scope, "global");
  assert.equal(byName.projectOnly.scope, "project");

  const untrusted = await loadMcpConfigFiles({ agentDir, cwd, projectTrusted: false });
  assert.deepEqual(untrusted.servers.map((server) => server.name).sort(), ["globalOnly", "shared"]);
  assert.equal(untrusted.servers.find((server) => server.name === "shared").config.command, "global");
});

test("fork:mcp-auto-reload —— `/mcp` 的 patch 走同一套 0600 原子写", async (t) => {
  // P0-3：pi 1.0 的 `McpExtensionOptions.updateConfig` 把「在会话里 /mcp 开关 server、
  // 改 exposure」的落盘交给宿主。不接管时 pi 自己改文件，会绕开这里的两条不变量。
  const dir = fixture(t);
  const file = join(dir, "mcp.json");
  write(file, JSON.stringify({
    $schema: "https://example.com/mcp.schema.json",
    mcpServers: { docs: { url: "https://example.com/mcp", exposure: "direct" } },
  }, null, 2));

  await applyMcpServerPatch(file, "docs", { enabled: false });
  assert.equal(modeOf(file), 0o600, "patch 也必须是 0600");

  const raw = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(raw.mcpServers.docs.enabled, false);
  assert.equal(raw.mcpServers.docs.url, "https://example.com/mcp", "同一份 entry 的其它字段要留着");
  assert.equal(raw.$schema, "https://example.com/mcp.schema.json", "顶层未知键要留着");

  // exposure 也走这条，而且口径与 pi 一致：**写入默认值就把这个键删掉**
  // （SDK 的 McpServerConfigPatch 注释：`enabled: true` 与 `exposure: "codemode"` 是默认值）。
  await applyMcpServerPatch(file, "docs", { exposure: "hidden" });
  const hidden = JSON.parse(readFileSync(file, "utf8"));
  assert.equal(hidden.mcpServers.docs.exposure, "hidden");
  assert.equal(hidden.mcpServers.docs.enabled, false, "只改 exposure 不该动 enabled");

  await applyMcpServerPatch(file, "docs", { exposure: "codemode" });
  const defaulted = JSON.parse(readFileSync(file, "utf8"));
  assert.equal("exposure" in defaulted.mcpServers.docs, false, "写回默认值要删键，而不是写成 codemode");
  assert.equal(modeOf(file), 0o600);
});

test("fork:mcp-native-exposure —— exposure 的写回按 pi 口径：默认值即删键", async (t) => {
  const dir = fixture(t);
  const file = join(dir, "mcp.json");
  write(file, JSON.stringify({ mcpServers: { a: { command: "x" } } }, null, 2));

  await applyMcpServerPatch(file, "a", { exposure: "direct" });
  assert.equal(JSON.parse(readFileSync(file, "utf8")).mcpServers.a.exposure, "direct");

  // codemode 是 pi 的默认值 → 键被删掉（不是写成 "codemode"）。UI 的下拉因此把
  // 「未声明」显示成 codemode，写回去就等于回到文件里没有这个键。
  await applyMcpServerPatch(file, "a", { exposure: "codemode" });
  const def = JSON.parse(readFileSync(file, "utf8")).mcpServers.a;
  assert.equal("exposure" in def, false);
  assert.equal(def.command, "x", "同一份 entry 的其它字段不动");

  // 别名也要能写进去（老配置用 codemode-deferred）；运行时读的时候再归一成 codemode。
  await applyMcpServerPatch(file, "a", { exposure: "codemode-deferred" });
  assert.equal(JSON.parse(readFileSync(file, "utf8")).mcpServers.a.exposure, "codemode-deferred");
});

test("fork:mcp-native-exposure —— `/api/mcp` 的 patch 动作校验 exposure 取值", async () => {
  // 路由层只有这一处把关：非法值必须在写盘之前 400，而不是让 pi 的写入器拿到
  // 一个它不认识的档（那样会静默写进文件，UI 与运行时从此不一致）。
  const { readFileSync: read } = await import("node:fs");
  const source = read(new URL("../app/api/mcp/route.ts", import.meta.url), "utf8");
  assert.match(source, /body\.action === "patch"/);
  assert.match(source, /if \(exposure !== undefined && !MCP_EXPOSURES\.includes/);
  assert.match(source, /Invalid exposure/);
  assert.match(source, /await applyMcpServerPatch\(mcpFilePath\(cwd, scope\), name, patch as McpServerConfigPatch\)/);
});
