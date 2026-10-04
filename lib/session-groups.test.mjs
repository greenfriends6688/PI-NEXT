import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const G = await jiti.import("./session-groups.ts");

// fork:task-groups —— 这个模块此前**没有任何测试**，而它是侧栏持久化的真相源：
// 一次手滑的解析就能让所有分组静默消失。下面把解析与各个纯操作都钉住。
// 只测纯函数那一半（不碰 localStorage）。

const parse = G.parseSessionGroups;

test("a round-trip keeps order, groups, collapse state and assignments", () => {
  const state = parse(JSON.stringify({
    order: ["p2", "p1"],
    groups: [
      { id: "g1", name: "在做", collapsed: false },
      { id: "g2", name: "查资料", collapsed: true },
    ],
    assignments: { p1: "g1", p2: "g2" },
  }));
  assert.deepEqual(state.order, ["p2", "p1"]);
  assert.equal(state.groups.length, 2);
  assert.equal(state.groups[1].collapsed, true);
  assert.deepEqual(state.assignments, { p1: "g1", p2: "g2" });
});

test("garbage input degrades to empty rather than throwing", () => {
  for (const bad of [null, "", "{oops", "[]", '"a string"', "123"]) {
    const state = parse(bad);
    assert.deepEqual(state.groups, [], `${JSON.stringify(bad)} 不该抛也不该留组`);
  }
});

// 名字是侧栏行上唯一可变的东西：控制字符会破坏布局，空白名会让行只剩一个色点。
test("group names are sanitised, and empty-after-clean is rejected", () => {
  const state = parse(JSON.stringify({
    groups: [
      { id: "g1", name: "  在做\u0000\u0007  " },
      { id: "g2", name: "   " },
      { id: "g3", name: "\t\n" },
      { id: "g4", name: "x".repeat(500) },
    ],
  }));
  const byId = new Map(state.groups.map((g) => [g.id, g.name]));
  assert.ok(byId.has("g1"), "控制字符该被剥掉而不是整条丢弃");
  assert.equal(byId.get("g1").includes("\u0000"), false);
  assert.equal(byId.has("g2"), false, "清洗后为空 = 非法");
  assert.equal(byId.has("g3"), false);
  assert.ok(byId.get("g4").length <= G.MAX_GROUP_NAME_LENGTH);
});

test("duplicate group ids are dropped — two groups would fight over one project", () => {
  const state = parse(JSON.stringify({
    groups: [
      { id: "g1", name: "第一个" },
      { id: "g1", name: "第二个" },
    ],
    assignments: { p1: "g1" },
  }));
  assert.equal(state.groups.length, 1);
});

test("assignments pointing at groups that did not survive are discarded", () => {
  const state = parse(JSON.stringify({
    groups: [{ id: "g1", name: "有效" }],
    assignments: { p1: "g1", p2: "g9", p3: "g8" },
  }));
  // 否则侧栏会渲染出一个「有色点但没有组」的孤儿归属。
  assert.deepEqual(state.assignments, { p1: "g1" });
});

test("group and order counts are capped", () => {
  const groups = Array.from({ length: G.MAX_SESSION_GROUPS + 20 }, (_, i) => ({
    id: `g${i}`, name: `组 ${i}`,
  }));
  const order = Array.from({ length: G.MAX_PROJECT_ORDER_ENTRIES + 20 }, (_, i) => `p${i}`);
  const state = parse(JSON.stringify({ groups, order, assignments: {} }));
  assert.ok(state.groups.length <= G.MAX_SESSION_GROUPS);
  assert.ok(state.order.length <= G.MAX_PROJECT_ORDER_ENTRIES);
});

// ── 颜色（fork:task-groups 新增）────────────────────────────────────────

test("colors round-trip, and a missing or unknown one falls back", () => {
  const state = parse(JSON.stringify({
    groups: [
      { id: "g1", name: "有颜色", color: "violet" },
      { id: "g2", name: "老数据没这个键" },
      { id: "g3", name: "颜色不认识", color: "chartreuse" },
      { id: "g4", name: "颜色不是字符串", color: 42 },
    ],
  }));
  const byId = new Map(state.groups.map((g) => [g.id, g.color]));
  assert.equal(byId.get("g1"), "violet");
  // 老数据是这个功能的主要来源 —— 少一个键不该丢整条分组。
  assert.equal(byId.get("g2"), G.DEFAULT_SESSION_GROUP_COLOR);
  assert.equal(byId.get("g3"), G.DEFAULT_SESSION_GROUP_COLOR);
  assert.equal(byId.get("g4"), G.DEFAULT_SESSION_GROUP_COLOR);
  assert.equal(state.groups.length, 4, "四组都该留下");
});

test("there are exactly eight distinct named colors", () => {
  assert.equal(G.SESSION_GROUP_COLORS.length, 8);
  assert.equal(new Set(G.SESSION_GROUP_COLORS).size, 8, "不能重名");
  assert.ok(G.SESSION_GROUP_COLORS.every((c) => /^[a-z]+$/.test(c)), "色名要能当 CSS 后缀用");
});

// 建组不指定颜色时轮着挑：连着建 8 组应该各拿一个不同的色，再建回到第一个。
test("createGroup rotates colors so a fresh list is not monochrome", () => {
  let state = G.emptyState ? G.emptyState() : parse(JSON.stringify({ order: [], groups: [], assignments: {} }));
  const seen = [];
  for (let i = 0; i < G.SESSION_GROUP_COLORS.length; i += 1) {
    const before = state.groups.length;
    const next = G.createGroup(state, `组 ${i}`);
    assert.equal(next.groups.length, before + 1, "createGroup 该返回新状态");
    state = next;
    seen.push(next.groups.at(-1).color);
  }
  assert.equal(new Set(seen).size, G.SESSION_GROUP_COLORS.length, "8 组应该 8 个不同颜色");
});

test("recolorGroup refuses unknown colors and unknown ids", () => {
  let state = G.createGroup(parse(JSON.stringify({ order: [], groups: [], assignments: {} })), "组");
  const id = state.groups[0].id;
  assert.equal(G.recolorGroup(state, id, "teal").groups[0].color, "teal");
  // 色名会被直接拼进 CSS 类名，所以不在 8 档里的一律拒绝。
  assert.equal(G.recolorGroup(state, id, "chartreuse"), state);
  assert.equal(G.recolorGroup(state, "不存在", "teal"), state);
});

test("deleting a group releases its projects instead of deleting them", () => {
  let state = parse(JSON.stringify({
    groups: [{ id: "g1", name: "组" }, { id: "g2", name: "另一组" }],
    assignments: { p1: "g1", p2: "g2" },
  }));
  state = G.deleteGroup(state, "g1");
  assert.equal(state.groups.length, 1);
  // p1 只是**退出分组**，会话还在 —— 另一条路（成员一并删）会让人以为项目没了。
  assert.deepEqual(state.assignments, { p2: "g2" });
});

test("groupProjects puts groups first (empty ones kept as drop targets) and ungrouped last", () => {
  const state = parse(JSON.stringify({
    order: ["p1", "p2", "p3"],
    groups: [
      { id: "g1", name: "在做" },
      { id: "g2", name: "空的" },
    ],
    assignments: { p1: "g1" },
  }));
  const sections = G.groupProjects([{ key: "p1" }, { key: "p2" }, { key: "p3" }], state);
  assert.deepEqual(sections.map((s) => s.group?.id ?? null), ["g1", "g2", null]);
  // 空组必须保留：它是往里拖项目的落点，删掉就没法往里加东西了。
  assert.equal(sections[1].projects.length, 0);
  assert.deepEqual(sections[2].projects.map((p) => p.key), ["p2", "p3"]);
});

test("with no groups at all there is a single ungrouped bucket", () => {
  const state = parse(JSON.stringify({ order: ["p1"], groups: [], assignments: {} }));
  const sections = G.groupProjects([{ key: "p1" }], state);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].group, null);
  assert.deepEqual(sections[0].projects.map((p) => p.key), ["p1"]);
});

test("collapse toggles are independent and reversible", () => {
  const state = parse(JSON.stringify({ groups: [{ id: "g1", name: "组", collapsed: false }] }));
  assert.equal(state.groups[0].collapsed, false);
  const toggled = G.toggleGroupCollapsed(state, "g1");
  assert.equal(toggled.groups[0].collapsed, true);
  assert.equal(G.toggleGroupCollapsed(toggled, "g1").groups[0].collapsed, false);
  // 不存在的 id 是无操作，不是崩溃。
  assert.equal(G.toggleGroupCollapsed(state, "没有这个组"), state);
});