import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

/*
 * fork:file-tree-slot-swap — 右栏把同一棵文件树在两个槽之间搬（没开文件时占满
 * 面板，第一个文件打开后变成 `.explorer-column` 里的一列），React 认的是父节点，
 * 所以这一搬是一次卸载+重挂。这份测试锁住「重挂后看起来没搬过」的那份状态：
 *   · `readFileTreeSnapshot` / `writeFileTreeSnapshot`：树上一次列到的样子
 *   · `readExplorerPanelViewState` / `writeExplorerPanelViewState`：改动列表 / 筛选条
 * TTL 是这个缓存唯一的过期口径，过期就该当没有（宁可显示加载态，也不摆一份旧目录）。
 */

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const {
  readFileTreeSnapshot,
  writeFileTreeSnapshot,
  readExplorerPanelViewState,
  writeExplorerPanelViewState,
} = await jiti.import("./FileExplorer.tsx");

const ROOT = {
  name: "lib",
  fullPath: "/repo/lib",
  isDir: true,
  size: 0,
};

function snapshotOf(overrides = {}) {
  return {
    roots: [ROOT],
    gitFiles: [{ path: "/repo/lib/a.ts", status: "modified", additions: 3, deletions: 1 }],
    additions: 3,
    deletions: 1,
    ...overrides,
  };
}

test("写进去的快照原样读得回来（重挂后不必先空一帧）", () => {
  writeFileTreeSnapshot("/repo", snapshotOf(), 1_000);
  const read = readFileTreeSnapshot("/repo", 1_000);
  assert.deepEqual(read.roots, [ROOT]);
  assert.equal(read.additions, 3);
  assert.equal(read.deletions, 1);
  assert.equal(read.gitFiles.length, 1);
  assert.equal(read.savedAt, 1_000);
});

test("按 cwd 分开：换一个项目读到的是它自己那一份", () => {
  writeFileTreeSnapshot("/repo-a", snapshotOf({ additions: 1 }), 1_000);
  writeFileTreeSnapshot("/repo-b", snapshotOf({ additions: 2 }), 1_000);
  assert.equal(readFileTreeSnapshot("/repo-a", 1_000).additions, 1);
  assert.equal(readFileTreeSnapshot("/repo-b", 1_000).additions, 2);
  assert.equal(readFileTreeSnapshot("/repo-c", 1_000), null);
});

test("过期即失效（宁可走加载态，也不摆一份可能已经旧的目录）", () => {
  assert.equal(readFileTreeSnapshot("/repo-stale", 1_000), null, "没写过的 cwd 读不到");
  writeFileTreeSnapshot("/repo-stale", snapshotOf(), 1_000);
  assert.notEqual(readFileTreeSnapshot("/repo-stale", 1_000), null, "刚写的还新鲜");
  // TTL 是 15s；越过它就该当没有，并且顺手把槽位腾出来。
  assert.equal(readFileTreeSnapshot("/repo-stale", 1_000 + 15_001), null);
});

test("面板视图状态按 cwd 记，读改写互不覆盖", () => {
  writeExplorerPanelViewState("/repo-panel", { changesCollapsed: false });
  writeExplorerPanelViewState("/repo-panel", { fileSearchOpen: true });
  assert.deepEqual(readExplorerPanelViewState("/repo-panel"), {
    changesCollapsed: false,
    fileSearchOpen: true,
  });
  assert.equal(readExplorerPanelViewState("/repo-panel-missing"), null);
});

test("缓存不会无限长（同时开着的那块面板之外一律清掉）", () => {
  for (let i = 0; i < 40; i += 1) {
    writeFileTreeSnapshot(`/repo-many-${i}`, snapshotOf(), 1_000 + i);
  }
  // 后写进去的那些仍然读得到（整体清理只发生在写满且扫不出过期项时）。
  assert.notEqual(readFileTreeSnapshot("/repo-many-39", 1_039), null);
  assert.equal(readFileTreeSnapshot("/repo-many-0", 1_039), null);
});