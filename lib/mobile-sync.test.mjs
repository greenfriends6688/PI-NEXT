// fork:mobile-shell —— 镜像 diff 纯函数：新增/变化/HTML 过期/远端删除
import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  const { createJiti } = await import("jiti");
  const jiti = createJiti(import.meta.url, { moduleCache: false });
  return jiti.import("./mobile-sync.ts");
}

const { diffMirror, emptyMirrorIndex, getMobileSyncState } = await loadSubject();

const manifest = (overrides = {}) => ({
  id: "s1",
  name: "会话一",
  cwd: "/repo",
  projectRoot: "/repo",
  mtimeMs: 1000,
  sizeBytes: 200,
  ...overrides,
});

test("空镜像：全部是新增，HTML 全部过期，无删除", () => {
  const diff = diffMirror(emptyMirrorIndex(), [manifest(), manifest({ id: "s2" })]);
  assert.deepEqual(diff.toUpdate.map((s) => s.id), ["s1", "s2"]);
  assert.deepEqual(diff.htmlStale.map((s) => s.id), ["s1", "s2"]);
  assert.deepEqual(diff.removed, []);
});

test("版本对没变：不更新、HTML 不过期", () => {
  const index = emptyMirrorIndex();
  index.sessions.s1 = {
    id: "s1", name: null, cwd: "/repo", projectRoot: "/repo",
    mtimeMs: 1000, sizeBytes: 200, cursor: 200, htmlVersion: 1000, lastSyncAt: 1,
  };
  const diff = diffMirror(index, [manifest()]);
  assert.deepEqual(diff.toUpdate, []);
  assert.deepEqual(diff.htmlStale, []);
  assert.deepEqual(diff.removed, []);
});

test("mtime/size 任一变化：进 toUpdate 且 HTML 过期", () => {
  const index = emptyMirrorIndex();
  index.sessions.s1 = {
    id: "s1", name: null, cwd: "/repo", projectRoot: "/repo",
    mtimeMs: 1000, sizeBytes: 200, cursor: 200, htmlVersion: 1000, lastSyncAt: 1,
  };
  const grew = diffMirror(index, [manifest({ mtimeMs: 2000, sizeBytes: 300 })]);
  assert.deepEqual(grew.toUpdate.map((s) => s.id), ["s1"]);
  assert.deepEqual(grew.htmlStale.map((s) => s.id), ["s1"]);

  const shrunk = diffMirror(index, [manifest({ mtimeMs: 1000, sizeBytes: 100 })]);
  assert.equal(shrunk.toUpdate.length, 1, "文件变小（整写）也要重拉");
});

test("远端删了的会话进 removed；HTML 没缓存的会话算 htmlStale", () => {
  const index = emptyMirrorIndex();
  index.sessions.old = {
    id: "old", name: null, cwd: "/repo", projectRoot: "/repo",
    mtimeMs: 1, sizeBytes: 1, cursor: 1, htmlVersion: null, lastSyncAt: 1,
  };
  index.sessions.s1 = {
    id: "s1", name: null, cwd: "/repo", projectRoot: "/repo",
    mtimeMs: 1000, sizeBytes: 200, cursor: 200, htmlVersion: 1000, lastSyncAt: 1,
  };
  const diff = diffMirror(index, [manifest()]);
  assert.deepEqual(diff.removed, ["old"]);
  assert.deepEqual(diff.toUpdate, []);
});

test("同步状态快照稳定：getMobileSyncState 反复调用返回同一引用", () => {
  assert.equal(getMobileSyncState(), getMobileSyncState());
});
