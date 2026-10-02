/**
 * lib/mcp-validator.test.mjs 对应的被测模块见 ./mcp-validator.ts。
 *
 * fork:pr11-mcp — 校验现在是 pi 1.0 `validateMcpServerConfig` 的薄转发：纯结构
 * 校验、不连任何 server。测试直接打真 SDK 内部件（1.0.0 下全绿），把语义钉住：
 * 名称规则、stdio/http 形状、legacy SSE 被拒、exposure 别名归一。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { validateMcpServer } = await jiti.import("./mcp-validator.ts");

test("stdio 配置通过并返回 pi 校验后的副本", async () => {
  const result = await validateMcpServer("files", {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    env: { TOKEN: "${TOKEN}" },
  });
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(result.config, {
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    env: { TOKEN: "${TOKEN}" },
  });
  assert.match(result.detail, /Valid stdio server: npx/);
});

test("http 配置通过，exposure 别名按 pi 归一", async () => {
  const http = await validateMcpServer("docs", { url: "https://example.com/mcp" });
  assert.equal(http.ok, true, http.detail);
  assert.deepEqual(http.config, { url: "https://example.com/mcp" });

  const alias = await validateMcpServer("alias", { command: "npx", exposure: "codemode-deferred" });
  assert.equal(alias.ok, true, alias.detail);
  assert.equal(alias.config.exposure, "codemode");
});

test("非法名称 / 缺 command 与 url / legacy SSE / 类型错误都返回 invalid-config", async () => {
  const badName = await validateMcpServer("bad name", { command: "npx" });
  assert.equal(badName.ok, false);
  assert.equal(badName.error, "invalid-config");
  assert.match(badName.detail, /invalid server name/);

  const empty = await validateMcpServer("empty", {});
  assert.equal(empty.ok, false);
  assert.equal(empty.error, "invalid-config");
  assert.match(empty.detail, /needs either "command" \(stdio\) or "url"/);

  // pi 1.0 不再支持 legacy SSE transport。
  const sse = await validateMcpServer("legacy", { type: "sse", url: "https://example.com/sse" });
  assert.equal(sse.ok, false);
  assert.match(sse.detail, /legacy SSE transport is not supported/);

  const badArgs = await validateMcpServer("args", { command: "npx", args: "not-an-array" });
  assert.equal(badArgs.ok, false);
  assert.match(badArgs.detail, /args must be an array of strings/);

  const badUrl = await validateMcpServer("url", { url: "ftp://example.com/mcp" });
  assert.equal(badUrl.ok, false);
  assert.match(badUrl.detail, /url must be an http or https URL/);
});

test("校验绝不抛异常：非对象与超时选项都不再是入参", async () => {
  const notAnObject = await validateMcpServer("weird", null);
  assert.equal(notAnObject.ok, false);
  assert.equal(notAnObject.error, "invalid-config");
});
