import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Loaded through jiti so the module's own extensionless imports resolve the way
// the app resolves them (tsconfig moduleResolution: "bundler"); bare
// `import("./path-security.ts")` only works while that file has no imports.
async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./path-security.ts");
}

test("rejects an existing path that escapes an allowed root through a symlink", async (t) => {
  const { isExistingPathWithinRoots, isPathWithinRoots } = await loadSubject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-file-access-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
  const link = path.join(allowed, "link");
  fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  const target = path.join(link, "secret.txt");
  const roots = new Set([allowed]);

  assert.equal(isPathWithinRoots(target, roots), true);
  assert.equal(isExistingPathWithinRoots(target, roots), false);
});

// fork:linked-directory — `..` 的拒绝放在**边界函数**里（#748）。
// Node 的 realpathSync 先消 `..` 再跟链接，文件系统反过来，于是 `root/link/..`
// 字典序上等于 `root`（授权通过），实际打开的却是链接目标旁边那一格。
test("rejects a `..` segment instead of letting realpath collapse it first", async (t) => {
  const { isExistingPathWithinRoots, hasParentDirectorySegment } = await loadSubject();
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-dotdot-")));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  fs.writeFileSync(path.join(base, "inside.txt"), "inside");
  const roots = new Set([base]);

  // path.join 会先把 `..` 消掉，所以这里必须自己拼串。
  assert.equal(hasParentDirectorySegment([base, "link", "..", "x"].join(path.sep)), true);
  assert.equal(hasParentDirectorySegment(path.join(base, ".", "link")), false);
  // 名字里带 `..` 的 POSIX 文件不是路径分段，不能误伤。
  assert.equal(hasParentDirectorySegment(path.join(base, "名字 带 .. 的文件.txt")), false);

  assert.equal(isExistingPathWithinRoots(path.join(base, "inside.txt"), roots), true);
  const traversal = `${base}${path.sep}..${path.sep}${path.basename(base)}`;
  assert.equal(isExistingPathWithinRoots(traversal, roots), false);
});
