import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:ui-stats-ring — 统计长条（.pw-stats）已按用户裁定删除，完整统计收进
// 上下文环浮窗（SessionStatsDetails），这些结构断言跟着搬进浮窗链路。
const stats = await readFile(new URL("./SessionStatsBar.tsx", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("reports the session message count alongside tokens and context", () => {
  assert.match(stats, /const totalMessages = sessionStats\?\.totalMessages \?\? 0;/);
  // 消息计数在浮窗明细里，且带着「会话文件过大」的配色提醒。
  assert.match(stats, /t\("session\.messages"\), messageRows\.map[\s\S]*?messageCountColor\)/);
  // 明细里的数字统一走 toLocaleString(locale)（formatNumber）。
  assert.match(stats, /const formatNumber = \(value: number\) => value\.toLocaleString\(locale\)/);
  assert.match(stats, /t\("session\.cacheHitRate"\)/);
  // 折叠长条不再存在：统计只有环浮窗一个宿主（文件里不留 className 级别的 .pw-stats 用法）。
  assert.doesNotMatch(stats, /className=["'`][^"'`]*pw-stats/);
  assert.doesNotMatch(stats, /session-stats-inline-toggle/);
  // 环浮窗里渲染完整明细；/session 与触屏通过 openStatsPopover 钉住浮窗。
  assert.match(chatInput, /<SessionStatsDetails[\s\S]*?statsDetails[\s\S]*?statsSession/);
  assert.match(chatInput, /openStatsPopover: \(\) => void;/);
  assert.match(chatInput, /openStatsPopover\(\) \{[\s\S]*?setRingPinned\(true\)/);
});

test("warns before a session grows large enough to slow switching", () => {
  // Skin tokenisation: the upstream literals are replaced by semantic tokens.
  // fork:design-components —— 设计系统里错误色叫 --error（不再用 Zeno 的 --danger）。
  assert.match(stats, /totalMessages > 5000\s*\?\s*"var\(--danger\)"/);
  assert.match(stats, /totalMessages > 2000\s*\?\s*"var\(--warning\)"/);
});

test("feeds the ring popover from ChatWindow instead of a bottom strip", () => {
  assert.match(stats, /t\("session\.input"\)/);
  assert.match(stats, /t\("session\.output"\)/);
  assert.match(stats, /t\("session\.cacheRead"\)/);
  assert.match(stats, /t\("session\.total"\)/);
  assert.match(stats, /t\("session\.cost"\)/);
  assert.match(stats, /t\("session\.context"\)/);
  assert.match(stats, /t\("session\.cacheHitRate"\)/);
  // ChatWindow 不再渲染底部统计条；明细经 statsDetails/statsSession 进环浮窗。
  assert.doesNotMatch(chatWindow, /<SessionStatsBar/);
  assert.doesNotMatch(chatWindow, /statsExpanded/);
  assert.match(chatWindow, /statsDetails=\{sessionStats\}/);
  assert.match(chatWindow, /statsSession=\{session \? \{/);
  // 顶栏那条老路径必须彻底消失，否则会同时出现两个入口。
  assert.doesNotMatch(appShell, /renderSessionStatsButton/);
  assert.doesNotMatch(appShell, /session-info-popover/);
  assert.doesNotMatch(appShell, /activeTopPanel === "session"/);
});
