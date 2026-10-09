import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

// fork:pi-1.1（上游 3e693c7b3）—— 信任对话框里那张「它会跑什么」的表。
const { readProjectMcpSummary } = await createJiti(import.meta.url, { interopDefault: true }).import("./project-trust-mcp.ts");

function fixture(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-trust-mcp-"));
  fs.mkdirSync(path.join(root, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(root, ".pi", "mcp.json"), JSON.stringify(config, null, 2));
  return root;
}

test("lists a project's stdio command as written and masks the URL's credentials", async (t) => {
  const cwd = fixture({
    mcpServers: {
      docs: { command: "npx", args: ["-y", "@acme/mcp-docs", "--token", "sk-live-SECRET123456"] },
      remote: { url: "https://mcp.example.com/sse?token=sk-live-SECRET456789", headers: { Authorization: "Bearer x" } },
    },
  });
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  const summary = await readProjectMcpSummary(cwd);
  assert.equal(summary.exists, true);

  const docs = summary.servers.find((server) => server.name === "docs");
  assert.equal(docs.transport, "stdio");
  // 命令**按原文**：掩码会把「信任后会跑什么」藏起来，而那正是这张表要回答的。
  assert.match(docs.command, /^npx -y @acme\/mcp-docs --token /);
  assert.ok(docs.command.includes("sk-live-SECRET123456"));

  const remote = summary.servers.find((server) => server.name === "remote");
  assert.equal(remote.transport, "http");
  assert.equal(remote.command, undefined);
  assert.ok(!remote.url.includes("SECRET456789"), `URL 里的凭证必须掩掉：${remote.url}`);
  assert.match(remote.url, /^https:\/\/mcp\.example\.com/, "host 保留");
  assert.deepEqual(remote.headerNames, ["Authorization"]);
});

test("reports a missing file instead of an empty server list", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-trust-mcp-none-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  const summary = await readProjectMcpSummary(cwd);
  assert.equal(summary.exists, false);
  assert.deepEqual(summary.servers, []);
});

test("a malformed file is reported, not silently read as no servers", async (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-trust-mcp-bad-"));
  fs.mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(cwd, ".pi", "mcp.json"), "{ not json");
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));

  const summary = await readProjectMcpSummary(cwd);
  assert.equal(summary.exists, true);
  assert.deepEqual(summary.servers, []);
  assert.ok(summary.errors.length > 0, "解析失败必须说出来");
});
