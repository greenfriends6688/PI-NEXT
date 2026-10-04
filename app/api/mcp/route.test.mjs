import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:simulator-section —— `/api/mcp` 的 `add` 接受 `{ type:"stdio", script: "mcp/x.mjs" }`
// 这个简写（浏览器不知道仓库里文件的绝对路径）。解析与全部校验在
// `lib/mcp-bundled-script.ts`，那里有**行为**测试；这里只锁「路由确实接上了它」。

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("the add action resolves the bundled-script shorthand before validating", () => {
  // 必须在校验**之前**展开：校验器要看到真正的 command/args，
  // 否则 `{ type:"stdio", script }` 会被判成「三者必居其一」而拒掉。
  assert.match(source, /import \{ resolveBundledScript \} from "@\/lib\/mcp-bundled-script"/);
  // 只看 add/update 那个分支里的**局部**顺序：文件别处（checkServer 助手函数里）
  // 也有 validateMcpServer，比全文字符位置会被函数定义位置带偏，测不出真实不变式。
  const branch = source.slice(
    source.indexOf('body.action === "add" || body.action === "update"'),
    source.indexOf('body.action === "patch"'),
  );
  const expand = branch.indexOf("resolveBundledScript(");
  const check = branch.indexOf("checkServer(");
  assert.ok(expand > 0, "add 分支没有展开 script 简写");
  assert.ok(check > 0, "add 分支没有走 checkServer");
  assert.ok(expand < check, "展开必须发生在 checkServer 之前");

  // 失败回 400（调用方给了坏路径），不是 500。
  assert.match(
    source,
    /if \(!resolved\.ok\) \{\s*return NextResponse\.json\(\{ error: resolved\.error \}, \{ status: 400 \}\)/,
  );
});

test("the shorthand is stripped so it never reaches the mcp config file", () => {
  // 落盘的是 command/args；`script` 这个键必须被删掉，否则它会跟着写进 mcp.json，
  // 变成一份 SDK 不认识、但每次读都会让人以为还有第二个真相源的字段。
  assert.match(source, /delete record\.script/);
});