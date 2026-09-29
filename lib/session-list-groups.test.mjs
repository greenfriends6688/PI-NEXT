import assert from "node:assert/strict";
import test from "node:test";

const { groupByPinned } = await import("./session-list-groups.ts");

/*
 * fork:flat-sessions — 会话列表只剩「置顶」一个分组。
 *
 * 这几个用例锁的是**契约**，不是实现：返回的是扁平条目数组（头部与条目各占
 * 一个槽位），侧栏虚拟列表按槽位算绝对定位偏移；同桶内顺序必须稳定，
 * 否则 sessionSort / worktree 合并后的相对顺序会被打乱。
 */

const item = (id, pinned = false) => ({ id, pinned });

test("flattens everything into item entries when nothing is pinned", () => {
  const entries = groupByPinned([item("a"), item("b"), item("c")], (x) => x.pinned);
  assert.deepEqual(entries.map((e) => e.type), ["item", "item", "item"]);
  assert.deepEqual(entries.map((e) => e.item.id), ["a", "b", "c"]);
});

test("pinned items come first behind a header, the rest keep their order", () => {
  const entries = groupByPinned(
    [item("a"), item("b", true), item("c"), item("d", true)],
    (x) => x.pinned,
  );
  assert.deepEqual(
    entries.map((e) => (e.type === "header" ? `#${e.bucket}:${e.count}` : e.item.id)),
    ["#pinned:2", "b", "d", "a", "c"],
  );
});

test("a collapsed pinned bucket emits only its header", () => {
  const entries = groupByPinned(
    [item("a"), item("b", true)],
    (x) => x.pinned,
    { pinned: true },
  );
  assert.deepEqual(entries.map((e) => e.type), ["header", "item"]);
  assert.equal(entries[0].count, 1);
  assert.equal(entries[1].item.id, "a");
});

test("no pinned header is emitted for an empty pinned set", () => {
  const entries = groupByPinned([item("a")], (x) => x.pinned, { pinned: true });
  assert.deepEqual(entries.map((e) => e.type), ["item"]);
});

test("the only remaining bucket is 置顶", () => {
  const entries = groupByPinned([item("a", true)], (x) => x.pinned);
  assert.equal(entries[0].bucket, "pinned");
});
