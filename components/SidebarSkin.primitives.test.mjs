import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:design-components —— 侧栏三块「自绘 → 画板件」的落地契约（源码级，与本目录其它 UI 测试同法）。
// 画板：02（`.pw-group-title` / `.pw-row` / `.pw-acts`）、01（`.pw-empty` / `.pw-starters` /
// `.pw-starter`）、61（`.pw-drop`）、图标一律 `i[data-ico]`。
const groups = await readFile(new URL("./fork/GroupedProjectList.tsx", import.meta.url), "utf8");
const guide = await readFile(new URL("./fork/EmptyStateGuide.tsx", import.meta.url), "utf8");
const chatRow = await readFile(new URL("./ChatWorkspaceRow.tsx", import.meta.url), "utf8");

test("the user group header is the board's .pw-group-title with board icons", () => {
  assert.match(groups, /className="pw-group-title"/);
  // 折叠箭头 = 画板行内箭头的 `.pw-ico .pw-row-toggle`，随折叠态换 chevron，不再自绘旋转。
  assert.match(groups, /className="pw-ico pw-row-toggle"/);
  assert.match(groups, /data-ico=\{group\.collapsed \? "chevron-right" : "chevron-down"\}/);
  assert.match(groups, /data-ico="pencil"/);
  assert.match(groups, /data-ico="trash-2"/);
  assert.match(groups, /className="pw-iconbtn sm"/);
  // 改名态的输入框也是画板件。
  assert.match(groups, /className="pw-input"/);
  // 旧的自绘旋转变换、整段手绘 svg、iconButtonStyle 一并退役。
  assert.doesNotMatch(groups, /rotate\(-90deg\)/);
  assert.doesNotMatch(groups, /<svg/);
  assert.doesNotMatch(groups, /iconButtonStyle/);
  // 拖放落点高亮从内联背景改成状态属性，样式归 `.pw-group-title[data-fork-group-header]`。
  assert.match(groups, /data-active=\{dropActive \? "true" : undefined\}/);
  assert.doesNotMatch(groups, /background: dropActive/);
});

test("the 'back to ungrouped' drop zone is the board's .pw-drop", () => {
  assert.match(groups, /className="pw-drop"/);
  assert.match(groups, /data-fork-ungroup-drop=""/);
  assert.match(groups, /data-active=\{ungroupDropActive \? "true" : undefined\}/);
  assert.match(groups, /data-ico="inbox"/);
  // 画板 61 的 `.pw-drop` 已经有虚线 / 强调底 / 居中，行高那一档在 fork-ui.css。
  assert.doesNotMatch(groups, /border: "1px dashed/);
});

test("the zero-session guide is the board's empty state with starter cards", () => {
  assert.match(guide, /className="pw-empty"/);
  assert.match(guide, /className="pw-empty-inner"/);
  assert.match(guide, /className="pw-starters"/);
  assert.match(guide, /className="pw-starter"/);
  // 三张卡都是真 button（`button.pw-starter` 的 UA 归零在 fork-ui.css），悬停不再改内联底色。
  assert.doesNotMatch(guide, /currentTarget\.style\.background/);
  // 展开出来的两块也只用画板件。
  assert.match(guide, /className="pw-pop"/);
  assert.match(guide, /className="pw-litem"/);
  assert.match(guide, /className="pw-lname"/);
  assert.match(guide, /className="pw-rowgap"/);
  assert.match(guide, /className="pw-input"/);
  assert.match(guide, /className="pw-btn primary sm"/);
  assert.match(guide, /role="alert" className="pw-alert"/);
  // 三只手绘 svg（folder / clock / import）换成 data-ico。
  assert.doesNotMatch(guide, /<svg/);
  assert.match(guide, /data-ico="folder"/);
  assert.match(guide, /data-ico="clock"/);
  assert.match(guide, /data-ico="import"/);
});

test("the chat workspace row trigger carries no inline button reset", () => {
  // 行内主触发钮的 UA 归零 + 铺满剩余宽度都在 fork-ui.css 的接线块里。
  assert.match(chatRow, /className="pw-inline"/);
  assert.doesNotMatch(chatRow, /background: "none", border: 0, padding: 0/);
  assert.doesNotMatch(chatRow, /font: "inherit"/);
});
