import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AgentSessionPanel.tsx", import.meta.url), "utf8");
const icons = await readFile(new URL("../design/pi-web-design/assets/icons.js", import.meta.url), "utf8");

test("keeps the main session first and makes every agent session selectable", () => {
  const mainRow = source.indexOf("session={rootSession}");
  const subagentRows = source.indexOf("visibleSubagents.map");
  assert.ok(mainRow > 0);
  assert.ok(subagentRows > mainRow);
  assert.match(source, /onSelect=\{\(\) => onSelectSession\(rootSession\)\}/);
  assert.match(source, /onSelect=\{\(\) => onSelectSession\(session\)\}/);
  assert.match(source, /aria-selected=\{selected\}/);
});

test("sorts running subagents first and enables search only for larger families", () => {
  assert.match(source, /if \(aRunning !== bRunning\) return aRunning \? -1 : 1/);
  assert.match(source, /subagents\.length > 8/);
  assert.match(source, /relation\?\.description, relation\?\.profile, session\.name, session\.firstMessage/);
  assert.match(source, /maxHeight: "min\(58dvh, 480px\)"/);
});

test("the panel is the board's popover, not a hand-drawn dropdown box", () => {
  // fork:design-components —— 画板 22 的 `.pw-pop` + `.pw-pop-title` + `.pw-sep`。
  assert.match(source, /className="pw-pop agent-session-panel"/);
  assert.match(source, /className="pw-pop-title"/);
  assert.match(source, /className="pw-sep"/);
  // 旧的左侧贴边 + 下圆角 + 三面边框内联样式全部退场。
  assert.doesNotMatch(source, /borderLeft: "1px solid var\(--border\)"/);
  assert.doesNotMatch(source, /borderRadius: "0 0 var\(--radius-md\) var\(--radius-md\)"/);
  assert.doesNotMatch(source, /boxShadow: "var\(--shadow-md\)"/);
});

test("rows are the board's prow, with the search header wired as pop-search", () => {
  // 行 = .pw-prow（当前项 is-on），副标题与状态短标签 = .pw-desc。
  assert.match(source, /className=\{`pw-prow\$\{selected \? " is-on" : ""\}`\}/);
  assert.equal((source.match(/className="pw-desc"/g) ?? []).length, 3);
  // 搜索头 = .pw-pop-search（search 图标槽 + .pw-input）。
  assert.match(source, /className="pw-pop-search"/);
  assert.match(source, /className="pw-input"/);
  // 空结果也是一行 .pw-prow（画板 22 的「没有匹配」写法），不再是居中 div。
  assert.match(source, /<div className="pw-prow"><span className="pw-desc">\{t\("agentSwitcher\.noMatches"\)\}/);
});

test("hover is owned by board.css, not by hand-written mouse handlers", () => {
  assert.doesNotMatch(source, /onMouseEnter=\{/);
  assert.doesNotMatch(source, /onMouseLeave=\{/);
  // 行里不再自带边框 / 底色 / 选中左边线。
  assert.doesNotMatch(source, /borderBottom: "1px solid var\(--border\)"/);
  assert.doesNotMatch(source, /background: selected \? "var\(--bg-selected\)" : "transparent"/);
  assert.doesNotMatch(source, /borderLeft: selected \? "2px solid var\(--accent\)"/);
});

test("the six status icons come from the board vocabulary", () => {
  for (const ico of ["loader-circle", "clock", "check", "circle-x", "circle-stop", "ban"]) {
    assert.match(source, new RegExp(`ico: "${ico}"`), `missing status icon: ${ico}`);
    assert.match(icons, new RegExp(`^  "${ico}":`, "m"), `unknown board icon: ${ico}`);
  }
  // 主代理 user / 子代理 bot（画板 22 的两枚身份图）。
  assert.match(source, /data-ico=\{main \? "user" : "bot"\}/);
  // 零手绘内联 svg：图标只走 <i data-ico>。
  assert.doesNotMatch(source, /<svg/);
  assert.equal((source.match(/data-ico=\{ico\}/g) ?? []).length, 1);
});
test("shows persisted completion states while live running state takes precedence", () => {
  // fork:proma-06-delegation — 状态不再就地算：
  // 「不在跑 + 持久化是活状态」必须变成 interrupted（重启后不再假装在跑），
  // 这条不变式在 lib/subagent-status.ts 里实现，这里只钉「组件确实走它 + 不再自己判」。
  assert.match(source, /const status: SubagentSessionStatus = effectiveSubagentStatus\(relation\?\.status, \{ running \}\)/);
  assert.doesNotMatch(source, /running \? "running" : relation\?\.status/);
  assert.match(source, /t\(`agentSwitcher\.status\.\$\{status\}`\)/);
  // 每个持久化状态都有确定的图标分支（failed / aborted / interrupted 不再挤在一个分支里）。
  assert.match(source, /failed: \{ ico: "circle-x", color: "var\(--error\)" \}/);
  assert.match(source, /aborted: \{ ico: "circle-stop" \}/);
  assert.match(source, /interrupted: \{ ico: "ban" \}/);
  assert.match(source, /completed: \{ ico: "check", color: "var\(--success\)" \}/);
  assert.match(source, /queued: \{ ico: "clock", color: "var\(--warning\)" \}/);
  assert.match(source, /starting: \{ ico: "loader-circle", color: "var\(--accent-text\)", spin: true \}/);
  assert.match(source, /running: \{ ico: "loader-circle", color: "var\(--accent-text\)", spin: true \}/);
  // 中止/中断两态走 .pw-dim（画板 22 的 41/42 行），不再自造中性色变量。
  assert.doesNotMatch(source, /statusColor/);
});
