/**
 * fork:mcp-native-exposure —— `GET /api/mcp/log` 的行为。
 *
 * 这个路由读的是 pi 的 mcp 扩展写的那个文件（agent 目录的 `mcp.log`，
 * `dist/extensions/mcp/index.js:253`）。此前它对用户完全不可见：server 连不上时浏览器
 * 只有一句「MCP failed to load」，看不到是哪个 server、握手断在哪一步。
 *
 * `getAgentDir()` 认 `PI_CODING_AGENT_DIR`，所以这里用临时 agent 目录，不碰用户真实的
 * `~/.pi/agent/mcp.log`。
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET } = await jiti.import("../app/api/mcp/log/route.ts");

async function withAgentDir(lines, run) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-mcp-log-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    if (lines !== null) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "mcp.log"), lines);
    }
    return await run();
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

const get = async (query = "") => {
  const response = await GET(new Request(`http://127.0.0.1/api/mcp/log${query}`));
  return { status: response.status, body: await response.json() };
};

test("没有日志不是错误：exists=false，空列表", async () => {
  await withAgentDir(null, async () => {
    const { status, body } = await get();
    assert.equal(status, 200);
    assert.equal(body.exists, false);
    assert.equal(body.size, 0);
    assert.deepEqual(body.lines, []);
    assert.match(body.path, /mcp\.log$/);
  });
});

test("返回末尾若干行，并丢掉文件末尾那个空行", async () => {
  const content = ["line-1", "line-2", "line-3", "line-4", ""].join("\n");
  await withAgentDir(content, async () => {
    const { body } = await get("?lines=2");
    assert.equal(body.exists, true);
    assert.ok(body.size > 0);
    // 文件以换行结尾 → split 出来的最后一个空串不该算成一行。
    assert.deepEqual(body.lines, [{ text: "line-3" }, { text: "line-4" }]);
  });
});

test("超长行被截断并标注丢了多少字符", async () => {
  const long = "x".repeat(900);
  await withAgentDir(`${long}\n`, async () => {
    const { body } = await get();
    assert.equal(body.lines.length, 1);
    // 结构化截断：路由不写本地化文案，只给丢了多少字符，界面那侧再拼。
    assert.equal(body.lines[0].text.length, 500);
    assert.equal(body.lines[0].truncatedChars, 400);
  });
});

test("lines 参数被夹在 1..2000，不接受调用方把它撑爆", async () => {
  const many = Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n") + "\n";
  await withAgentDir(many, async () => {
    assert.equal((await get("?lines=99999")).body.lines.length, 50, "上限之上取到全部（文件本来就短）");
    assert.equal((await get("?lines=0")).body.lines.length, 1, "0 被夹到 1");
    assert.equal((await get("?lines=abc")).body.lines.length, 50, "非数字回到默认 200");
  });
});
