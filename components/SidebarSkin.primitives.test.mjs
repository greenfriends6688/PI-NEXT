import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:design-components —— 侧栏三块「自绘 → 画板件」的落地契约（源码级，与本目录其它 UI 测试同法）。
// 画板：v5 D-02（`.d-group-title` / `.d-row`）、v5 D-01 帧 C（`.d-empty` / `.d-starters` /
// `.d-starter`）、`.d-drop`、图标一律 `i[data-ico]`。
const groups = await readFile(new URL("./fork/GroupedProjectList.tsx", import.meta.url), "utf8");
const guide = await readFile(new URL("./fork/EmptyStateGuide.tsx", import.meta.url), "utf8");
const chatRow = await readFile(new URL("./ChatWorkspaceRow.tsx", import.meta.url), "utf8");

test("the user group header is the board's .d-group-title with board icons", () => {
  assert.match(groups, /className="d-group-title"/);
  // 折叠箭头 = 画板行内箭头的直接 `<i data-ico>`，随折叠态换 chevron，不再自绘旋转。
  assert.match(groups, /data-ico=\{group\.collapsed \? "chevron-right" : "chevron-down"\}/);
  assert.match(groups, /data-ico="pencil"/);
  assert.match(groups, /data-ico="trash-2"/);
  assert.match(groups, /className="d-iconbtn"/);
  // 改名态的输入框也是画板件。
  assert.match(groups, /className="d-input d-grow"/);
  // 旧的自绘旋转变换、整段手绘 svg、iconButtonStyle 一并退役。
  assert.doesNotMatch(groups, /rotate\(-90deg\)/);
  assert.doesNotMatch(groups, /<svg/);
  assert.doesNotMatch(groups, /iconButtonStyle/);
  // 拖放落点高亮用画板 D-02d 帧 B 的 `.d-group-title.is-on`。
  assert.match(groups, /dropActive \? " is-on" : ""/);
  assert.doesNotMatch(groups, /background: dropActive/);
});

test("the 'back to ungrouped' drop zone is the board's .d-drop", () => {
  assert.match(groups, /d-drop/);
  assert.match(groups, /data-fork-ungroup-drop=""/);
  assert.match(groups, /ungroupDropActive \? " over" : ""/);
  assert.match(groups, /data-ico="inbox"/);
  // 画板 D-02d 的 `.d-drop` 已经有虚线 / 强调底 / 居中。
  assert.doesNotMatch(groups, /border: "1px dashed/);
});

test("the zero-session guide is the board's empty state with starter cards", () => {
  // v5 画板 D-01 帧 C：.d-empty（.d-empty-t + .d-starters > .d-starter ×3）。
  assert.match(guide, /className="d-empty"/);
  assert.match(guide, /className="d-empty-t"/);
  assert.match(guide, /className="d-starters"/);
  assert.match(guide, /className="d-starter"/);
  // 三张卡都是真 button，悬停由 system.css 的 .d-starter:hover 给，不再改内联底色。
  assert.doesNotMatch(guide, /currentTarget\.style\.background/);
  // 展开出来的两块也只用画板件：最近项目 = .d-pop.is-open + .d-menu-row + .d-col.d-grow，
  // 导入 = .d-field + .d-input + .d-btn.sm.primary，出错是 .d-err。
  assert.match(guide, /className="d-pop is-open"/);
  assert.match(guide, /className="d-menu-row"/);
  assert.match(guide, /className="d-col d-grow"/);
  assert.match(guide, /className="d-set-row-t"/);
  assert.match(guide, /className="d-field"/);
  assert.match(guide, /className="d-input"/);
  assert.match(guide, /className="d-btn sm primary"/);
  assert.match(guide, /role="alert" className="d-err"/);
  // 三只手绘 svg（folder / clock / import）换成 data-ico。
  assert.doesNotMatch(guide, /<svg/);
  assert.match(guide, /data-ico="folder"/);
  assert.match(guide, /data-ico="clock"/);
  assert.match(guide, /data-ico="import"/);
  // 旧 pw-* 一件不留。
  assert.doesNotMatch(guide, /pw-(empty|starter|pop|litem|rowgap|input|btn|alert)/);
});

test("the chat workspace row trigger carries no inline button reset", () => {
  // fork:v5-frame-audit-2026-10-05 —— 聊天工作区行照画板 D-02d 帧 A 逐节点抄：
  // 头行是 `div.d-group-title` + role=button（板面上就是 div），名字是一枚
  // `span.d-grow`，行内两枚动作是真 `button.d-iconbtn`。仍然**不**内联按钮 UA 归零
  // （那条值只有一个来源：库里 `button.d-row` 的归零）。
  assert.match(chatRow, /className="d-group-title"/);
  assert.match(chatRow, /role="button"/);
  assert.match(chatRow, /<span className="d-grow"/);
  assert.doesNotMatch(chatRow, /className="d-row d-grow"/);
  assert.doesNotMatch(chatRow, /background: "none", border: 0, padding: 0/);
  assert.doesNotMatch(chatRow, /font: "inherit"/);
});
