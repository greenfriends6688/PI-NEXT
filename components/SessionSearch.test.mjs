// fork:v5-landing —— 结果区改为画板 D-02d 搜索态的行件（`.d-group-title` + `.d-sess`），
// 直接落在 SessionSidebar 的 `listScrollRef` 里（唯一滚动容器），不再自建内层滚动。
//
// 钉住两件事：
//   1. 归组 / 排序是纯函数（可在没有 DOM 的环境里单测）；
//   2. 结果区用的是画板的行件，且不再自己滚（由侧栏列表容器统一滚）。
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

test("结果区用画板行件，且跟随侧栏唯一滚动容器", async () => {
  const source = await readFile(new URL("./SessionSearch.tsx", import.meta.url), "utf8");
  // 分区头 / 项目组头是画板 D-02d 的 .d-group-title；命中行是 .d-sess。
  // fork:v5-wave-b —— 窄屏（≤640）换成画板 M-04 的 `.m-group-title` / `.m-row`，
  // 所以下面钉的是「两个形态各有一套行件」这条等价约束，而不是某一个类名。
  assert.match(source, /className=\{isPhone \? "m-group-title" : "d-group-title"\}/);
  assert.match(source, /: `d-sess\$\{isCurrent \? " is-on" : ""\}`/);
  assert.match(source, /isPhone \? `m-row\$\{isCurrent \? " is-on" : ""\}` : `d-sess\$\{isCurrent \? " is-on" : ""\}`/);
  assert.match(source, /className="d-cmd-hit"/, "命中片段用系统高亮类 .d-cmd-hit");
  // 结果直接落在 SessionSidebar 的 listScrollRef 里，不再自建内层滚动容器。
  assert.doesNotMatch(source, /className="pw-search-results"/);
});
