// fix:search-collapsed / no-time-groups / sidebar-scroll / row-actions-drag
// —— 2026-09-30 用户在真机上点出来的四处侧栏缺陷的守护测试。
//
// 这些是**行为**而不是纯函数，所以按本仓惯例钉源码结构（与 SessionSearch.test.mjs
// 的写法一致）：改错了就红，改对了也读得懂为什么。
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const css = await readFile(new URL("../app/fork-ui.css", import.meta.url), "utf8");

test("搜索框默认收起：只在 sessionSearchOpen 时渲染，点头部搜索钮才展开并聚焦", () => {
  // 台账 DIVERGENCE 38：画板 02 帧 A（项目 pane）没有搜索格，只出现在帧 C（搜索态）。
  assert.match(code, /const \[sessionSearchOpen, setSessionSearchOpen\] = useState\(false\)/);
  // fork:v5-wave-b —— 搜索格只在 `sessionSearchOpen` 时渲染这条不变。
  // fork:v5-landing-2026-10-04 —— 两支拆开（桌面那份按画板 D-02 帧 D / D-02d 帧 E
  // 补了外层 `.d-side-nav`，间距不再走内联 margin），所以这里钉的是**新的等价约束**：
  //   ① 搜索格只有一个守卫 `sessionSearchOpen`（两支共用，少一个就是「有一档常显」）；
  //   ② input 本体只有一份（同一个 id / ref / Esc 行为），形态由取类名的
  //      `sessionSearchField` 决定：窄屏 `.m-searchfield`、宽屏 `.d-searchfield`；
  //   ③ 宽屏那份落在 `.d-side-nav` 盒子里，且不再有内联 margin ——
  //      间距只有一个来源（system.css）。
  assert.match(code, /const sessionSearchField = \(className: string\) => \(\s*<label className=\{className\}>/);
  assert.match(code, /\{sessionSearchOpen && \(\s*isMobile \? sessionSearchField\("m-searchfield"\) : \(\s*<div className="d-side-nav">\{sessionSearchField\("d-searchfield"\)\}<\/div>/);
  assert.equal(
    (code.match(/id="session-search-input"/g) ?? []).length,
    1,
    "搜索格只有一份 input（两支共用），不是复制两遍",
  );
  assert.doesNotMatch(code, /margin: "0 var\(--nx-sp-2\)"/);
  assert.match(code, /setSessionSearchOpen\(true\)/);
  assert.match(code, /requestAnimationFrame\(\(\) => searchInputRef\.current\?\.focus\(\)\)/);
  assert.match(code, /aria-expanded=\{sessionSearchOpen\}/);
  // 清除钮 / Esc 都走同一个收起点，并且把焦点交还触发钮（键盘 Tab 不从 body 重新开始）。
  assert.match(code, /const closeSessionSearch = useCallback/);
  assert.match(code, /searchToggleRef\.current\?\.focus\(\)/);
  assert.equal((code.match(/closeSessionSearch\}/g) ?? []).length >= 1, true);
  assert.match(code, /if \(event\.key === "Escape"\)[\s\S]{0,80}?closeSessionSearch\(\)/);
});

test("会话列表不再分时间桶（今天/昨天/本周…），三处调用点都走扁平化", () => {
  assert.equal((code.match(/flatTimeGroupEntries\(/g) ?? []).length, 3, "项目 / 聊天 / 全局三处");
  assert.doesNotMatch(code, /groupByTimeBucket\(/);
  assert.doesNotMatch(code, /TimeGroupHeader/);
  assert.doesNotMatch(code, /collapsedGroups/);
});

test("侧栏列表是滚动的：容器占满父级高度并自己滚（flex 简写在非 flex 父级里失效）", () => {
  // fork:mobile-drawer-2026-03 —— ref 与 style 之间现在还夹着三个 touch 处理器
  // （下拉刷新），所以两条事实分开断言，而不是用「200 字内必须出现」这种
  // 会随无关属性一起碎的窗口。
  assert.match(code, /ref=\{listScrollRef\}/);
  assert.match(code, /style=\{\{ height: "100%", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain"/);
  assert.doesNotMatch(code, /flex: "1 1 auto", overflowY: "auto", minHeight: 80/);
});

test("项目行的动作区不会把点击吃成拖拽", () => {
  // 行是 draggable，⋯ 只有 22px：几像素位移就会起 drag 并取消 click。
  assert.match(code, /closest\?\.\("\[data-project-actions\]"\)/);
  assert.match(code, /event\.preventDefault\(\);\s*return;\s*\}/);
  assert.match(code, /data-project-actions=""/);
});

test("搜索结果区同样是滚动容器（父级 .pw-side-scroll 只裁圆角）", () => {
  const rule = css.match(/\.pw-search-results\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.match(rule, /overflow-y:\s*auto/);
  assert.match(rule, /height:\s*100%/);
});
