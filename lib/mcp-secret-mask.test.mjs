/**
 * fork:secrets-never-reach-browser —— JSON 编辑器这条路的掩码 / 还原。
 *
 * 背景：本仓 MCP 详情有个 JSON 编辑器，靠 `POST /api/mcp {action:"get"}` 拿整份 def。
 * 那条路原本把 env / headers / oauth.clientSecret **明文送进浏览器**。上游 0.10 是从读侧
 * 就掩码（那边同时没有 JSON 编辑器）；我们保留编辑器，所以做另一半：出去掩码、回来按
 * 等值换回真值。掩码规则本身来自上游 `lib/mcp-secrets.ts`，不在这里另写一套。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { maskMcpDefForBrowser, restoreMaskedMcpDef } = await jiti.import("./mcp-secret-mask.ts");
const { SECRET_MASK } = await jiti.import("./mcp-secrets.ts");

const STORED = {
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem"],
  env: { API_TOKEN: "sk-live-abcdef123456", PATH_HINT: "/usr/bin" },
  headers: { Authorization: "Bearer sekret-value-1234567890" },
  oauth: { clientId: "abc", clientSecret: "top-secret-client" },
  timeout: 30,
};

test("字面量密钥出去就变成掩码，非密钥字段原样", () => {
  const masked = maskMcpDefForBrowser(STORED);
  assert.equal(masked.env.API_TOKEN, SECRET_MASK);
  assert.equal(masked.env.PATH_HINT, "/usr/bin", "不像密钥的字段不动");
  assert.equal(masked.headers.Authorization, SECRET_MASK);
  assert.equal(masked.oauth.clientSecret, SECRET_MASK);
  assert.equal(masked.oauth.clientId, "abc");
  assert.equal(masked.command, "npx", "命令没被误伤");
  assert.deepEqual(masked.args, ["-y", "@modelcontextprotocol/server-filesystem"]);
  assert.equal(masked.timeout, 30);
  // 落盘那份不能被就地改掉。
  assert.equal(STORED.env.API_TOKEN, "sk-live-abcdef123456");
});

test("引用（${VAR} / !cmd）是名字不是密钥，不该被掩", () => {
  const masked = maskMcpDefForBrowser({
    url: "https://example.com/mcp",
    headers: { Authorization: "Bearer ${DOCS_TOKEN}" },
    env: { KEY: "!op read op://vault/token" },
  });
  assert.equal(masked.headers.Authorization, "Bearer ${DOCS_TOKEN}");
  assert.equal(masked.env.KEY, "!op read op://vault/token");
});

test("url / command / args 里带的凭据也掩掉", () => {
  const masked = maskMcpDefForBrowser({
    url: "https://user:s3cr3t-password@example.com/mcp",
    args: ["--token", "abcdef0123456789abcdef0123456789"],
  });
  assert.doesNotMatch(String(masked.url), /s3cr3t-password/);
  assert.notDeepEqual(masked.args, ["--token", "abcdef0123456789abcdef0123456789"]);
});

test("没动过的字段回来时换回真值，改过的按新值走", () => {
  // 浏览器拿到掩码版，用户只改了 timeout。
  const submitted = { ...maskMcpDefForBrowser(STORED), timeout: 60 };
  const restored = restoreMaskedMcpDef(submitted, STORED);
  assert.equal(restored.env.API_TOKEN, "sk-live-abcdef123456", "没动过的密钥不能被写成掩码");
  assert.equal(restored.headers.Authorization, "Bearer sekret-value-1234567890");
  assert.equal(restored.oauth.clientSecret, "top-secret-client");
  assert.equal(restored.timeout, 60, "用户改的字段按新值");
  assert.equal(restored.env.PATH_HINT, "/usr/bin");
});

test("用户真的换了一个新密钥，就用新值", () => {
  const submitted = maskMcpDefForBrowser(STORED);
  submitted.env.API_TOKEN = "sk-live-NEWVALUE-999999";
  const restored = restoreMaskedMcpDef(submitted, STORED);
  assert.equal(restored.env.API_TOKEN, "sk-live-NEWVALUE-999999");
});

test("删掉一个字段就是删掉，不会被真值补回来", () => {
  const submitted = maskMcpDefForBrowser(STORED);
  delete submitted.env.API_TOKEN;
  const restored = restoreMaskedMcpDef(submitted, STORED);
  assert.equal("API_TOKEN" in (restored.env ?? {}), false);
});

test("整体掩码的 url / args：没变取回、变了当新的", () => {
  const stored = { url: "https://user:s3cr3t@example.com/mcp", args: ["--token", "abcdef0123456789abcdef0123456789"] };
  const untouched = restoreMaskedMcpDef(maskMcpDefForBrowser(stored), stored);
  assert.equal(untouched.url, stored.url);
  assert.deepEqual(untouched.args, stored.args);

  const edited = maskMcpDefForBrowser(stored);
  edited.args = ["--token", "NEWVALUE"];
  const withEdit = restoreMaskedMcpDef(edited, stored);
  assert.deepEqual(withEdit.args, ["--token", "NEWVALUE"]);
});