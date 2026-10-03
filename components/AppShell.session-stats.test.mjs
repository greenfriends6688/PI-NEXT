import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:ui-stats-ring — 统计长条（.pw-stats）已按用户裁定删除，完整统计收进
// 上下文环浮窗（SessionStatsDetails），这些结构断言跟着搬进浮窗链路。
const stats = await readFile(new URL("./SessionStatsBar.tsx", import.meta.url), "utf8");
const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const chatInput = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const appShell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const actionsMenu = await readFile(new URL("./fork/SessionActionsMenu.tsx", import.meta.url), "utf8");

test("reports the session message count alongside tokens and context", () => {
  assert.match(stats, /const totalMessages = sessionStats\?\.totalMessages \?\? 0;/);
  // 消息计数在浮窗明细里，且带着「会话文件过大」的配色提醒。
  assert.match(stats, /t\("session\.messages"\), messageRows, messageCountColor\)/);
  // 明细里的数字统一走 toLocaleString(locale)（formatNumber）。
  assert.match(stats, /const formatNumber = \(value: number\) => value\.toLocaleString\(locale\)/);
  assert.match(stats, /t\("session\.cacheHitRate"\)/);
  // 折叠长条不再存在：统计只有环浮窗一个宿主（文件里不留 className 级别的 .pw-stats 用法）。
  assert.doesNotMatch(stats, /className=["'`][^"'`]*pw-stats/);
  assert.doesNotMatch(stats, /session-stats-inline-toggle/);
  // 环浮窗里渲染完整明细；/session 与触屏通过 openStatsPopover 钉住浮窗。
  // fork:trace-menu —— 明细只留读数；路径类动作在顶栏 ⋯ 菜单，所以浮窗不再挂 session。
  assert.match(chatInput, /<SessionStatsDetails[\s\S]*?statsDetails[\s\S]*?contextUsage/);
  assert.match(chatInput, /openStatsPopover: \(\) => void;/);
  assert.match(chatInput, /openStatsPopover\(\) \{[\s\S]*?setRingPinned\(true\)/);
  // 浮窗里那几行带复制钮的路径明细已经搬走（会话文件 / ID / 项目目录 / 分支）。
  assert.doesNotMatch(stats, /session\.copyFile/);
  assert.doesNotMatch(stats, /session\.copyId/);
  assert.doesNotMatch(stats, /session\.projectDir/);
  assert.doesNotMatch(chatInput, /statsSession/);
  assert.doesNotMatch(chatWindow, /statsSession/);
});

test("the session action menu keeps the path copies the ring popover dropped", () => {
  // 同一个动作只留一个入口：复制项目路径 / 会话文件路径 / 会话 ID 都在 ⋯ 菜单里。
  const menu = actionsMenu;
  // 菜单里那三条复制与两条归档动作都还在（文案按 ZCode 那张图改成「复制路径」+ 右侧提示）。
  assert.match(menu, /t\("session\.copyPath"\)/);
  assert.match(menu, /t\("session\.copyTaskPath"\)/);
  assert.match(menu, /t\("session\.copyId"\)/);
  assert.match(menu, /pin\(session\.id\)/);
  assert.match(menu, /archive\(session\.id\)/);
  // 图 2 的其余条目也都实现了：重命名 / 未读 / 访达 / 配置 / 轨迹。
  assert.match(menu, /onRename/);
  assert.match(menu, /onMarkUnread/);
  assert.match(menu, /onReveal/);
  assert.match(menu, /onOpenSettings/);
  assert.match(menu, /onViewTrace/);
  assert.match(appShell, /<SessionActionsMenu/);
  // fork:trace-menu-2026-10-02 —— 三条复制改由 AppShell 统一处理（失败要弹 toast，
  // 不能菜单里报了「已复制」其实没复制上）；导出改成同源下载（桌面端 window.open
  // 会被交给系统浏览器，在应用里等于「点了没反应」）。
  assert.match(appShell, /const copyWithFeedback = useCallback/);
  assert.match(appShell, /function downloadSessionFile\(url: string\)/);
  assert.match(appShell, /onExportHtml=\{\(\) => \{[\s\S]*?downloadSessionFile\(/);
  // 系统提示词 / 工具定义从顶栏收进菜单（触发钮 ⋯ 当锚点）。
  assert.match(menu, /t\("system\.prompt"\)/);
  assert.match(menu, /t\("tools\.title"\)/);
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
  // ChatWindow 不再渲染底部统计条；明细经 statsDetails 进环浮窗。
  assert.doesNotMatch(chatWindow, /<SessionStatsBar/);
  assert.doesNotMatch(chatWindow, /statsExpanded/);
  assert.match(chatWindow, /statsDetails=\{sessionStats\}/);
  // 顶栏那条老路径必须彻底消失，否则会同时出现两个入口。
  assert.doesNotMatch(appShell, /renderSessionStatsButton/);
  assert.doesNotMatch(appShell, /session-info-popover/);
  assert.doesNotMatch(appShell, /activeTopPanel === "session"/);
});
