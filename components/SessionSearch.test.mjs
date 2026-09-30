// fix:search-grouping —— 结果区按项目归组（画板 02 帧 C）。
//
// 钉住两件事：
//   1. 归组 / 排序是纯函数（可在没有 DOM 的环境里单测）；
//   2. 结果区自己滚（`.pw-search-results` 必须是滚动容器）——父级 `.pw-side-scroll`
//      是 `overflow:hidden`，容器不滚就只剩裁切，表现就是「结果不全、还很乱」。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: "automatic" },
  tsconfigPaths: true,
});
const { groupSearchResults, projectLabelOf } = await jiti.import("./SessionSearch.tsx");

const result = (session, overrides = {}) => ({
  session: {
    id: session.id,
    path: `/tmp/${session.id}.jsonl`,
    cwd: session.cwd,
    created: "2026-01-01",
    modified: session.modified,
    firstMessage: "first",
    messageCount: 1,
  },
  blockIndex: 0,
  before: "…",
  match: "命中",
  after: "…",
  ...overrides,
});

test("projectLabelOf 取 cwd 末段，容忍尾斜杠", () => {
  assert.equal(projectLabelOf("/Users/yingjing/Desktop/pi-codex"), "pi-codex");
  assert.equal(projectLabelOf("/Users/yingjing/Desktop/pi-codex/"), "pi-codex");
  assert.equal(projectLabelOf(""), "");
});

test("结果按项目归组：组内按时间降序，组间按组内最新时间降序", () => {
  const groups = groupSearchResults([
    result({ id: "a", cwd: "/p/alpha", modified: "2026-01-01" }),
    result({ id: "b", cwd: "/p/beta", modified: "2026-03-01" }),
    result({ id: "c", cwd: "/p/alpha", modified: "2026-02-01" }),
  ]);
  assert.deepEqual(groups.map((group) => group.label), ["beta", "alpha"]);
  assert.deepEqual(groups[1].results.map(({ session }) => session.id), ["c", "a"]);
  assert.equal(groups[1].results.length, 2);
  assert.equal(groups[1].fullPath, "/p/alpha");
});

test("同项目不同会话名互不干扰；空 cwd 也能成组", () => {
  const groups = groupSearchResults([
    result({ id: "x", cwd: "", modified: "2026-01-01" }),
    result({ id: "y", cwd: "", modified: "2026-02-01" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, "");
  assert.deepEqual(groups[0].results.map(({ session }) => session.id), ["y", "x"]);
});

test("结果区是滚动容器（父级只裁圆角，不滚）", async () => {
  const css = await readFile(new URL("../app/fork-ui.css", import.meta.url), "utf8");
  const rule = css.match(/\.pw-search-results\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.match(rule, /overflow-y:\s*auto/, "结果区必须自己滚");
  assert.match(rule, /height:\s*100%/, "结果区要占满可用高度");

  const source = await readFile(new URL("./SessionSearch.tsx", import.meta.url), "utf8");
  assert.match(source, /className="pw-search-results"/);
  assert.match(source, /className="pw-search-result/, "命中行是结果行按钮，不再复用 .pw-session.child");
  assert.match(source, /className="pw-mark"/, "命中片段用画板的 .pw-mark");
});
