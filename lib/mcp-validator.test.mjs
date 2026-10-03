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
  assert.match(result.detail, /structurally valid/i);
  assert.match(result.detail, /no connection was attempted/i);
  assert.doesNotMatch(result.detail, /connected/i);
});

test("形状合法但连不上的 command 也不会被说成成功", async () => {
  // validateMcpServerConfig 是纯结构校验：command 存不存在它不知道，也不该说知道。
  const result = await validateMcpServer("ghost", { command: "definitely-not-a-real-mcp-binary-xyz" });
  assert.equal(result.ok, true, result.detail);
  assert.match(result.detail, /no connection was attempted/i);
  assert.doesNotMatch(result.detail, /^Valid /i);
  assert.doesNotMatch(result.detail, /\bconnected\b/i);
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

test("fork:mcp-native-exposure —— 项目级 mcp.json 不许用 auth.provider", async () => {
  // 这条 pi 的校验器看不到（它不知道这份配置是全局还是项目级），但 SDK 文档明确要求：
  // 「Project files cannot use it, so a repository cannot pick where the credential
  // goes.」仓库内容不该决定凭据发给哪个 provider。
  const withAuth = { url: "https://mcp.example.com/mcp", auth: { provider: "github-copilot" } };

  const globalResult = await validateMcpServer("remote", withAuth, { scope: "global" });
  assert.equal(globalResult.ok, true, globalResult.detail);

  const projectResult = await validateMcpServer("remote", withAuth, { scope: "project" });
  assert.equal(projectResult.ok, false);
  assert.equal(projectResult.error, "invalid-config");
  assert.match(projectResult.detail, /auth\.provider is not allowed in a project mcp\.json/);

  // oauth 那条路不受这条限制（OAuth 不指向某个 pi provider）。
  const oauthProject = await validateMcpServer("remote", {
    url: "https://mcp.example.com/mcp",
    oauth: { clientId: "abc" },
  }, { scope: "project" });
  assert.equal(oauthProject.ok, true, oauthProject.detail);

  // stdio 分支上根本没有 auth 这个字段，窄化之后也不该炸。
  const stdio = await validateMcpServer("files", { command: "npx" }, { scope: "project" });
  assert.equal(stdio.ok, true, stdio.detail);
});

test("fork:mcp-native-exposure —— 1.0 的字段由 SDK 自己把关（本仓不重复实现）", async () => {
  // pi 1.0 的 validateMcpServerConfig 已经覆盖 timeout / description / toolExposure /
  // oauth.callbackUrl 的 loopback 要求 / auth 的 https-or-loopback 要求。逐项钉一下，
  // 免得哪天以为「本仓漏了」又去手写一套。
  const bad = [
    [{ url: "https://x.example/mcp", timeout: 0 }, /timeout/i],
    [{ command: "x", description: 7 }, /description/i],
    [{ command: "x", toolExposure: { read: "nope" } }, /toolExposure/i],
    [{ url: "https://x.example/mcp", oauth: { callbackUrl: "https://evil.example/cb" } }, /callbackUrl/i],
    [{ url: "http://evil.example/mcp", auth: { provider: "p" } }, /https/i],
    [{ type: "sse", url: "https://x.example/mcp" }, /SSE/i],
  ];
  for (const [def, pattern] of bad) {
    const result = await validateMcpServer("s", def);
    assert.equal(result.ok, false, `应当被拒：${JSON.stringify(def)}`);
    assert.match(result.detail, pattern);
  }
  const good = await validateMcpServer("s", {
    url: "https://x.example/mcp",
    timeout: 30,
    description: "示例服务",
    toolExposure: { read: "direct" },
    oauth: { callbackUrl: "http://127.0.0.1:8080/oauth/callback", callbackPort: 8080 },
  });
  assert.equal(good.ok, true, good.detail);
});
