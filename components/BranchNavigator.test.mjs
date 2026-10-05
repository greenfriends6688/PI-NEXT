import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { buildActivePath, compressChain, hasSessionBranches, selectTopLevelBranches } = await jiti.import("./BranchNavigator.tsx");

const msg = (id, role, text) => ({ type: "message", id, parentId: null, timestamp: "t", message: { role, content: text } });
const info = (id) => ({ type: "session_info", id, parentId: null, timestamp: "t", name: "x" });
const model = (id) => ({ type: "model_change", id, parentId: null, timestamp: "t", provider: "test", modelId: "test" });
const node = (entry, children = []) => ({ entry, children });

test("compressChain labels a chain by its first message entry", () => {
  const chain = node(msg("u1", "user", "原问题"), [node(msg("a1", "assistant", "回答"))]);
  const { labelEntry, node: rep } = compressChain(chain);
  assert.equal(labelEntry.id, "u1");
  assert.equal(rep.entry.id, "a1");
});

test("compressChain skips non-message entries such as session_info", () => {
  const chain = node(info("s1"), [node(msg("u1", "user", "原始问题"), [node(msg("a1", "assistant", "答"))])]);
  const { labelEntry, node: rep, skipped } = compressChain(chain);
  assert.equal(labelEntry.id, "u1");
  assert.equal(rep.entry.id, "a1");
  assert.equal(skipped, 2);
});

test("compressChain labels a projected chain by its preview but selects its representative", () => {
  const representative = {
    entry: msg("a1", "assistant", "回答"),
    children: [],
    compressedEntryIds: ["u1"],
    branchPreview: { role: "user", text: "原始问题" },
  };
  const chain = node(info("s1"), [representative]);
  const { branchPreview, node: rep, skipped } = compressChain(chain);
  assert.deepEqual(branchPreview, { role: "user", text: "原始问题" });
  assert.equal(rep.entry.id, "a1");
  assert.equal(skipped, 2);
});

test("compressChain falls back to the chain end when no message entry exists", () => {
  const chain = node(info("s1"), [node(info("s2"))]);
  const { labelEntry } = compressChain(chain);
  assert.equal(labelEntry.id, "s2");
});

test("selectTopLevelBranches returns all roots for multi-root trees", () => {
  const r1 = node(msg("u1", "user", "第一问"));
  const r2 = node(msg("u1b", "user", "第一问改"));
  assert.deepEqual(selectTopLevelBranches([r1, r2]).map((n) => n.entry.id), ["u1", "u1b"]);
});

test("selectTopLevelBranches returns children of the first branching node", () => {
  const b1 = node(msg("u2", "user", "分支一"));
  const b2 = node(msg("u2b", "user", "分支二"));
  const root = node(msg("u1", "user", "第一问"), [node(msg("a1", "assistant", "答"), [b1, b2])]);
  assert.deepEqual(selectTopLevelBranches([root]).map((n) => n.entry.id), ["u2", "u2b"]);
});

test("selectTopLevelBranches returns empty for a linear session", () => {
  const root = node(msg("u1", "user", "第一问"), [node(msg("a1", "assistant", "答"))]);
  assert.deepEqual(selectTopLevelBranches([root]), []);
});

test("hasSessionBranches distinguishes linear sessions from branched sessions", () => {
  const linear = node(msg("u1", "user", "第一问"), [node(msg("a1", "assistant", "答"))]);
  const branched = node(msg("u1", "user", "第一问"), [
    node(msg("a1", "assistant", "答"), [
      node(msg("u2", "user", "分支一")),
      node(msg("u2b", "user", "分支二")),
    ]),
  ]);

  assert.equal(hasSessionBranches([]), false);
  assert.equal(hasSessionBranches([linear]), false);
  assert.equal(hasSessionBranches([branched]), true);
  assert.equal(hasSessionBranches([linear, branched]), true);
});

test("selectTopLevelBranches works on preview-only server projections", () => {
  const arm1 = {
    entry: msg("a2", "assistant", "答一"),
    children: [],
    compressedEntryIds: ["s1", "u2"],
    branchPreview: { role: "user", text: "分支一" },
  };
  const arm2 = {
    entry: msg("a2b", "assistant", "答二"),
    children: [],
    compressedEntryIds: ["u2b"],
    branchPreview: { role: "user", text: "分支二" },
  };
  const branchPoint = { entry: msg("a1", "assistant", "答"), children: [arm1, arm2] };
  const root = { entry: msg("u1", "user", "第一问"), children: [branchPoint] };
  const topLevel = selectTopLevelBranches([root]);
  assert.deepEqual(topLevel.map((n) => n.entry.id), ["a2", "a2b"]);
  assert.deepEqual(compressChain(topLevel[0]).branchPreview, { role: "user", text: "分支一" });
  assert.equal(compressChain(topLevel[0]).node.entry.id, "a2");
});

test("multi-root metadata chains use their user previews and assistant representatives", () => {
  const r1 = node(model("m1"), [{
    entry: msg("a1", "assistant", "回答一"),
    children: [],
    compressedEntryIds: ["u1"],
    branchPreview: { role: "user", text: "第一问" },
  }]);
  const r2 = node(info("s2"), [{
    entry: msg("a2", "assistant", "回答二"),
    children: [],
    compressedEntryIds: ["u2"],
    branchPreview: { role: "user", text: "第二问" },
  }]);
  const topLevel = selectTopLevelBranches([r1, r2]);
  assert.deepEqual(topLevel.map((n) => compressChain(n).branchPreview.text), ["第一问", "第二问"]);
  assert.deepEqual(topLevel.map((n) => compressChain(n).node.entry.id), ["a1", "a2"]);
});

// --- #509 regression: recursive tree consumption overflowed the stack on a
// linear session (depth == entry count). The iterative rewrite must survive a
// chain far deeper than V8's call-stack limit.

// Build a linear chain of `n` nodes (each child is the previous one).
function linearTree(n) {
  const nodes = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const entry = { type: "message", id: `e${i}`, parentId: prev, timestamp: "t", message: { role: "user", content: `m${i}` } };
    nodes.push({ entry, children: [] });
    if (prev) nodes[nodes.length - 2].children = [nodes[nodes.length - 1]];
    prev = `e${i}`;
  }
  return nodes[0];
}

test("buildActivePath finds the leaf on a 6000-deep linear chain without a stack overflow", () => {
  const root = linearTree(6000);
  const path = buildActivePath([root], "e5999");
  assert.equal(path.size, 6000);
  assert.ok(path.has("e0"));
  assert.ok(path.has("e5999"));
});

test("hasSessionBranches reports false for a linear chain (no branching) and true otherwise", () => {
  assert.equal(hasSessionBranches([linearTree(5000)]), false);
  const root = linearTree(3);
  root.children[0].children[0].children = [
    { entry: { type: "message", id: "b1", parentId: "e2", timestamp: "t", message: { role: "user", content: "x" } }, children: [] },
    { entry: { type: "message", id: "b2", parentId: "e2", timestamp: "t", message: { role: "user", content: "y" } }, children: [] },
  ];
  assert.equal(hasSessionBranches([root]), true);
  assert.equal(hasSessionBranches([root]), true);
});

test("hasSessionBranches reports true for multiple root nodes (a branch from the first message)", () => {
  // Each root has a single child, so no node.children.length > 1 — only the
  // multiple-root shape makes this a branch.
  const r1 = { entry: { type: "message", id: "r1", parentId: null, timestamp: "t", message: { role: "user", content: "a" } }, children: [] };
  const r2 = { entry: { type: "message", id: "r2", parentId: null, timestamp: "t", message: { role: "user", content: "b" } }, children: [] };
  assert.equal(hasSessionBranches([r1, r2]), true);
});

// fork:upstream-0.9.2-pi087-transcript — #931 迁移的单测
test("compressChain never labels a branch with a transcript system message", () => {
  // Pi >= 0.86 roots new sessions at a system message holding the prompt.
  const system = { type: "message", id: "sys", parentId: null, timestamp: "t", message: { role: "system", content: "", sections: { preamble: "You are an expert coding assistant." } } };
  const chain = node(system, [node(msg("u1", "user", "原始问题"), [node(msg("a1", "assistant", "答"))])]);
  const { labelEntry, node: rep, skipped } = compressChain(chain);
  assert.equal(labelEntry.id, "u1");
  assert.equal(rep.entry.id, "a1");
  assert.equal(skipped, 2);
});

// fork:v5-landing D-03 帧 A —— 顶栏那枚兄弟分支切换器 `<span class="d-branch">`
// （chevron-left ｜ `2 / 3` ｜ chevron-right）。序号口径与抽屉里的 `.m-branch`
// 同一份数据：`selectTopLevelBranches` 的顶层就是兄弟分支，当前分支 = 子树命中
// activeLeafId 的那一条。下面是这条口径的纯函数与 DOM 断言。
test("findSiblingIndex finds the top-level branch whose subtree holds the active leaf", async () => {
  const { findSiblingIndex } = await jiti.import("./BranchNavigator.tsx");
  const arm1 = node(msg("u2", "user", "分支一"), [node(msg("a2", "assistant", "答一"))]);
  const arm2 = node(msg("u2b", "user", "分支二"), [node(msg("a2b", "assistant", "答二"))]);
  const root = node(msg("u1", "user", "第一问"), [node(msg("a1", "assistant", "答"), [arm1, arm2])]);
  const topLevel = selectTopLevelBranches([root]);
  assert.deepEqual(topLevel.map((n) => n.entry.id), ["u2", "u2b"]);

  assert.equal(findSiblingIndex(topLevel, "a2"), 0);
  assert.equal(findSiblingIndex(topLevel, "a2b"), 1);
  // 找不到（叶子还没定 / 不属于任何一条）给 -1，调用方据此写总数而不是假序号。
  assert.equal(findSiblingIndex(topLevel, null), -1);
  assert.equal(findSiblingIndex(topLevel, "nope"), -1);
});

test("subtreeContains sees through server-side compressed chains and survives deep chains", async () => {
  const { subtreeContains } = await jiti.import("./BranchNavigator.tsx");
  // 服务端投影把中间条目收进 compressedEntryIds：那些 id 也算命中。
  const projected = { entry: msg("a2", "assistant", "答一"), children: [], compressedEntryIds: ["s1", "u2"] };
  assert.equal(subtreeContains(projected, "u2"), true);
  assert.equal(subtreeContains(projected, "other"), false);
  // 迭代而非递归：6000 深的线性链不许把调用栈打爆（同 buildActivePath 的理由）。
  assert.equal(subtreeContains(linearTree(6000), "e5999"), true);
});

test("顶栏芯片只剩中间那枚图标：.d-branch 壳 + .d-branch-n（无 chevron）", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./BranchNavigator.tsx", import.meta.url), "utf8");
  const start = source.indexOf('<span className="d-branch">');
  const chip = source.slice(start, source.indexOf("</span>", start));
  // 中间那格：span → button（铁律一允许的两处之一），类名一字不动。
  // fork:branch-fixed-icon（2026-10-05 用户裁定）—— 里面不是会跳动的 `2 / 3`
  // 序号，而是一枚固定的 git-fork 图标（同一格、同一动作：开分支树）。
  assert.match(chip, /className="d-branch-n"/);
  assert.match(chip, /<i data-ico="git-fork" data-size="13"/);
  assert.doesNotMatch(chip, /shownIndex/);
  // 旧的两套 UI 不再并存：顶栏不再有 `.d-chipbtn` 的「会话分支」文字芯片。
  assert.doesNotMatch(chip, /d-chipbtn/);
  // fork:branch-chip-icon-only（2026-10-06 用户裁定）—— 两侧那两枚
  // `.d-branch-btn`（上一条 / 下一条兄弟分支）连同 chevron 图标一起撤掉：同一件事在
  // 分支树浮层里点一行更快，顶栏右端没有 40px 让给它。分支树浮层本身不受影响。
  assert.doesNotMatch(chip, /d-branch-btn/);
  assert.doesNotMatch(chip, /chevron-left/);
  assert.doesNotMatch(chip, /chevron-right/);
});
