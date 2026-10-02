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
