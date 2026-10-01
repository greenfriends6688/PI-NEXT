import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// 经 jiti 加载：模块自身的无扩展名 import 要按 app 的方式解析（bundler）。
async function loadSubject() {
  const { createJiti } = await import("jiti");
  return createJiti(import.meta.url).import("./linked-directory.ts");
}

// project/
//   inner/            真实目录
//   inside-link   ->  ./inner
//   outside-link  ->  ../outside
//   file-link     ->  ../outside/file.txt
//   dangling-link ->  ../missing
// outside/
//   file.txt
//   nested-link   ->  ../secret
// secret/
function createFixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-linked-dir-")));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const project = path.join(base, "project");
  const outside = path.join(base, "outside");
  const secret = path.join(base, "secret");
  fs.mkdirSync(path.join(project, "inner"), { recursive: true });
  fs.mkdirSync(outside);
  fs.mkdirSync(secret);
  fs.writeFileSync(path.join(outside, "file.txt"), "outside");
  const dirType = process.platform === "win32" ? "junction" : "dir";
  try {
    fs.symlinkSync(path.join(project, "inner"), path.join(project, "inside-link"), dirType);
    fs.symlinkSync(outside, path.join(project, "outside-link"), dirType);
    fs.symlinkSync(secret, path.join(outside, "nested-link"), dirType);
    fs.symlinkSync(path.join(outside, "file.txt"), path.join(project, "file-link"), "file");
    fs.symlinkSync(path.join(base, "missing"), path.join(project, "dangling-link"), dirType);
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("Creating symbolic links requires additional privileges on this platform");
      return null;
    }
    throw error;
  }
  // `base` 已经是规范路径，所以这些 root 同时就是解析后的 root。
  return { base, project, outside, secret, roots: new Set([project]) };
}

test("报出通向 roots 之外的目录链接的目标", async (t) => {
  const { getOutsideLinkTarget } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { project, outside, roots } = fixture;

  assert.equal(getOutsideLinkTarget(path.join(project, "outside-link"), roots), outside);
  assert.equal(getOutsideLinkTarget(path.join(project, "inside-link"), roots), null);
  assert.equal(getOutsideLinkTarget(path.join(project, "inner"), roots), null);
  assert.equal(getOutsideLinkTarget(path.join(project, "dangling-link"), roots), null);
});

test("只标注列表里真正通向外的目录", async (t) => {
  const { withOutsideLinkTargets } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { project, outside, roots } = fixture;

  const dirents = fs.readdirSync(project, { withFileTypes: true });
  const entries = [
    { name: "inner", isDir: true },
    { name: "inside-link", isDir: true },
    { name: "outside-link", isDir: true },
    { name: "file-link", isDir: false },
  ];
  assert.deepEqual(withOutsideLinkTargets(project, entries, dirents, roots), [
    { name: "inner", isDir: true },
    { name: "inside-link", isDir: true },
    { name: "outside-link", isDir: true, outsideLinkTarget: outside },
    { name: "file-link", isDir: false },
  ]);
  // 有 root 能到达目标时，这条链接就是普通目录。
  assert.equal(
    withOutsideLinkTargets(project, entries, dirents, new Set([project, outside]))[2].outsideLinkTarget,
    undefined,
  );
});

test("靠自身类型就知道是目录的条目连解析都不做", async (t) => {
  const { withOutsideLinkTargets } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { base, roots } = fixture;

  // `base/secret` 在 roots 之外，但被列在已授权目录里的真实目录不可能通向外面。
  const dirents = [{ name: "secret", isDirectory: () => true }];
  assert.deepEqual(
    withOutsideLinkTargets(base, [{ name: "secret", isDir: true }], dirents, roots),
    [{ name: "secret", isDir: true }],
  );
});

test("放行直接坐在 roots 内的链接目标", async (t) => {
  const { checkLinkedDirectoryApproval } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { project, outside, roots } = fixture;

  assert.deepEqual(
    checkLinkedDirectoryApproval(path.join(project, "outside-link"), outside, roots),
    { ok: true, target: outside, alreadyAllowed: false },
  );
  const inner = path.join(project, "inner");
  assert.deepEqual(
    checkLinkedDirectoryApproval(path.join(project, "inside-link"), inner, roots),
    { ok: true, target: inner, alreadyAllowed: true },
  );
});

test("链接被改指到别处就拒绝", async (t) => {
  const { checkLinkedDirectoryApproval } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { project, secret, roots } = fixture;

  const result = checkLinkedDirectoryApproval(path.join(project, "outside-link"), secret, roots);
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test("拒绝经由另一条从未放行的链接到达的链接", async (t) => {
  const { checkLinkedDirectoryApproval } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { project, outside, secret, roots } = fixture;

  const nested = path.join(project, "outside-link", "nested-link");
  const refused = checkLinkedDirectoryApproval(nested, secret, roots);
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 403);
  // 操作员放行了第一个目标之后，第二条链接又是一次新的选择。
  assert.deepEqual(
    checkLinkedDirectoryApproval(nested, secret, new Set([project, outside])),
    { ok: true, target: secret, alreadyAllowed: false },
  );
});

test("拒绝会被文件系统顺着链接解出 roots 的 `..` 路径", async (t) => {
  const { checkLinkedDirectoryApproval } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { project, secret, roots } = fixture;

  // 文件系统从链接目标解析这个 `..`，到达真实的 outside/nested-link；
  // 按字典序它指的是 project/outside/nested-link。
  const traversal = [project, "outside-link", "..", "outside", "nested-link"].join(path.sep);
  assert.deepEqual(
    checkLinkedDirectoryApproval(traversal, secret, roots),
    { ok: false, status: 403, error: "Access denied" },
  );
});

test("拒绝 roots 之外的路径、普通目录、文件链接与悬空链接", async (t) => {
  const { checkLinkedDirectoryApproval } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { base, project, outside, roots } = fixture;

  const status = (candidate, target) => {
    const result = checkLinkedDirectoryApproval(candidate, target, roots);
    assert.equal(result.ok, false);
    return result.status;
  };
  assert.equal(status(outside, outside), 403);
  assert.equal(status(path.join(project, "inner"), outside), 400);
  assert.equal(status(path.join(project, "file-link"), path.join(outside, "file.txt")), 400);
  assert.equal(status(path.join(project, "dangling-link"), path.join(base, "missing")), 404);
  assert.equal(status(path.join(project, "missing"), outside), 404);
});

test("标记那些把项目或家目录包进去的链接", async (t) => {
  const { withOutsideLinkTargets } = await loadSubject();
  const fixture = createFixture(t);
  if (!fixture) return;
  const { base, project, outside, roots } = fixture;
  // 仓库里可能带着一条指向克隆位置的父目录的链接。
  fs.symlinkSync(base, path.join(project, "parent-link"), process.platform === "win32" ? "junction" : "dir");

  const dirents = fs.readdirSync(project, { withFileTypes: true });
  const entries = [{ name: "outside-link", isDir: true }, { name: "parent-link", isDir: true }];
  assert.deepEqual(withOutsideLinkTargets(project, entries, dirents, roots), [
    { name: "outside-link", isDir: true, outsideLinkTarget: outside },
    { name: "parent-link", isDir: true, outsideLinkTarget: base, outsideLinkEncloses: true },
  ]);
});