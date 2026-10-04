import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { BUNDLED_SCRIPT_ROOTS, resolveBundledScript } = await jiti.import("./mcp-bundled-script.ts");

/** 建一个带 `mcp/ios-simulator.mjs` 的假仓库。 */
function fakeRepo() {
  const root = mkdtempSync(join(tmpdir(), "pi-mcp-script-"));
  mkdirSync(join(root, "mcp"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "mcp", "ios-simulator.mjs"), "// server\n");
  writeFileSync(join(root, "scripts", "other.mjs"), "// elsewhere\n");
  return root;
}

test("a legit bundled script resolves to a runnable stdio def", () => {
  const root = fakeRepo();
  const result = resolveBundledScript("mcp/ios-simulator.mjs", root);
  assert.equal(result.ok, true);
  assert.equal(result.def.type, "stdio");
  // 用 process.execPath 而不是裸 "node"：装完不依赖 PATH 上有没有 node。
  assert.equal(result.def.command, process.execPath);
  assert.ok(result.def.args[0].endsWith("/mcp/ios-simulator.mjs"));
  // 返回的是**realpath**（macOS 上 tmpdir 是 `/var/...` → `/private/var/...`）。
  // 这不是巧合：正是靠 realpath 才能挡住软链逃逸，代价就是返回的也是 realpath。
  assert.equal(result.def.args[0], realpathSync(join(root, "mcp", "ios-simulator.mjs")));
});

// 这是 PR 的安全核心。每一类逃逸都要被挡，而且**要说清为什么**（用户要看得懂）。
test("traversal outside the repo is refused, with a reason", () => {
  const root = fakeRepo();
  for (const bad of [
    "../outside.mjs",
    "../../etc/passwd.mjs",
    "mcp/../../scripts/other.mjs",
    "./../scripts/other.mjs",
  ]) {
    const result = resolveBundledScript(bad, root);
    assert.equal(result.ok, false, `${bad} 不该通过`);
    assert.match(result.error, /repository root|not found/, `${bad} 的错误信息要说明原因`);
  }
});

test("absolute paths are refused — the shorthand means relative to the repo", () => {
  const root = fakeRepo();
  const result = resolveBundledScript(join(root, "mcp", "ios-simulator.mjs"), root);
  assert.equal(result.ok, false);
  assert.match(result.error, /relative/);
});

test("only whitelisted directories are allowed, not every .mjs in the repo", () => {
  const root = fakeRepo();
  // scripts/other.mjs 是真存在的 .mjs —— 放行它等于把口开给整棵仓库树。
  const result = resolveBundledScript("scripts/other.mjs", root);
  assert.equal(result.ok, false);
  assert.match(result.error, /must live under mcp\//);
  assert.deepEqual([...BUNDLED_SCRIPT_ROOTS], ["mcp"]);
});

// 软链能把「仓库内的一个 .mjs」指向仓库外的可执行文件 —— 只查路径前缀挡不住。
test("a symlink pointing outside the repo is refused", () => {
  const root = fakeRepo();
  const outside = join(mkdtempSync(join(tmpdir(), "pi-outside-")), "evil.mjs");
  writeFileSync(outside, "// evil\n");
  symlinkSync(outside, join(root, "mcp", "sneaky.mjs"));
  const result = resolveBundledScript("mcp/sneaky.mjs", root);
  assert.equal(result.ok, false, "软链逃逸不该通过");
  assert.match(result.error, /outside the repository root/);
});

test("non-.mjs and missing files are refused", () => {
  const root = fakeRepo();
  assert.equal(resolveBundledScript("mcp/ios-simulator.json", root).ok, false);
  assert.equal(resolveBundledScript("mcp/package.json", root).ok, false);
  const missing = resolveBundledScript("mcp/nope.mjs", root);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not found/);
  // 目录也不行。
  assert.equal(resolveBundledScript("mcp", root).ok, false);
  assert.equal(resolveBundledScript("", root).ok, false);
});

test("a NUL byte is refused outright", () => {
  const root = fakeRepo();
  assert.equal(resolveBundledScript("mcp/a\0.mjs", root).ok, false);
});

// 前缀比较的老坑：`/repo-evil` 不该被 `/repo` 认成子目录。
test("a sibling directory sharing the root's name prefix is not inside it", () => {
  const parent = mkdtempSync(join(tmpdir(), "pi-prefix-"));
  const root = join(parent, "repo");
  mkdirSync(join(root, "mcp"), { recursive: true });
  mkdirSync(join(parent, "repo-evil", "mcp"), { recursive: true });
  writeFileSync(join(parent, "repo-evil", "mcp", "x.mjs"), "// evil\n");
  const result = resolveBundledScript("mcp/x.mjs", join(parent, "repo-evil"));
  // 这个调用把 repo-evil 当成根，所以它**应该**通过 —— 重点是另一个方向：
  // 从真根去看 sibling 时不该被误判为在里面。
  assert.equal(result.ok, true, "把 sibling 当根时它就是自己的根");
  const fromRealRoot = resolveBundledScript("../repo-evil/mcp/x.mjs", root);
  assert.equal(fromRealRoot.ok, false, "`..` 逃逸到同前缀的兄弟目录要被挡住");
});