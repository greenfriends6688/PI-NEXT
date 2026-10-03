import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const mobileHookSource = await readFile(new URL("../hooks/useIsMobile.ts", import.meta.url), "utf8");

test("the phone top bar carries exactly one action: the session menu", () => {
  // fork:mobile-toolbar-slim（2026-10-03）—— 手机上这条工具条只留会话动作 ⋯。
  // 历史 / 生成标题 / 子代理 / 分支 / 导出 Markdown 五枚全部搬进输入区的
  // 「更多动作」宫格（有文字、拇指够得到），所以窄屏不再需要那条**盖住会话标题**的
  // 覆盖层 —— 那是「同构 + 不新增底部条」这条裁定的必然后果，不是一个设计。
  assert.match(source, /if \(mobile\) \{\s*return \(\s*<div[\s\S]*?renderSessionActionsMenu\(true\)/);
  // 覆盖层与它的入口必须彻底消失，不是留着不渲染。
  assert.doesNotMatch(source, /mobileToolbarMoreOpen/);
  assert.doesNotMatch(source, /data-mobile-toolbar-more/);
  assert.doesNotMatch(source, /data-mobile-toolbar-actions/);
  assert.doesNotMatch(source, /data-mobile-toolbar-action=/);
  // ⋯ 菜单抽成了函数：桌面在工具条末尾用它，手机在顶栏用它。
  assert.match(source, /const renderSessionActionsMenu = \(mobile: boolean\) => \(/);
});
test("the desktop toolbar keeps all five icon actions", () => {
  // 桌面这条一行摆得下，顶栏本来就是它最快的入口 —— 只有手机瘦身。
  for (const icon of ["history", "wand-sparkles", "download"]) {
    assert.match(source, new RegExp(`data-ico="${icon}"`));
  }
  assert.match(source, /\{sessionHasBranches && \(mobile \? \(/);
});
test("only renders the Agents switcher when the active session family has subagents", () => {
  assert.match(source, /const hasSubagentSessions = Boolean\(activeSessionFamily\?\.subagents\.length\)/);
  // fork:top-panel-anchor —— 第二个参数是「被点的那颗按钮」，定位时量它而不是整条顶栏。
  // （原来还有第三个「保持手机工具条展开」参数，覆盖层拆掉后已删。）
  assert.match(source, /\{hasSubagentSessions && \(\s*<button[\s\S]*?toggleTopPanel\("agents", event\.currentTarget\)/);
  assert.match(source, /activeTopPanel === "agents" && activeSessionFamily && selectedSession/);
  assert.doesNotMatch(source, /keepMobileToolbarOpen/);
});
test("keeps the Agents panel open while switching sessions and hangs it under its button", () => {
  assert.match(source, /const AGENT_PANEL_WIDTH = 420/);
  // fork:top-panel-anchor —— 画板 22：浮层从**各自的按钮下方**挂出，左缘对齐按钮
  // 左缘（右缘贴边时收回来），而不是贴在顶栏最左、横向拉满整条顶栏。
  assert.match(
    source,
    /const anchor = topPanelAnchorRef\.current;[\s\S]*?left: Math\.max\(8, Math\.min\(rect\.left, window\.innerWidth - width - 8\)\)/,
  );
  assert.match(source, /activeTopPanel === "agents" \? AGENT_PANEL_WIDTH/);
  // 拿不到按钮时（手机工具条、尚未挂载）才回落到顶栏左缘。
  assert.match(source, /if \(activeTopPanel === "agents"\) \{[\s\S]*?left: topBarRect\.left/);
  assert.match(source, /<AgentSessionPanel[\s\S]*?onSelectSession=\{handleSelectSession\}/);
});

test("only renders branch toolbar controls for sessions with branches", () => {
  assert.match(source, /const sessionHasBranches = hasSessionBranches\(branchTree\)/);
  assert.match(source, /\{sessionHasBranches && \(mobile \? \(/);
  assert.match(source, /\{isMobile && sessionHasBranches && \(/);
  assert.match(source, /panel === "branches" \? null : panel/);
});

test("the file toggle is always interactive (the covered trio is gone)", () => {
  // fork:mobile-toolbar-slim —— 这枚钮原来在窄屏要被「盖住」处理（覆盖层铺开时
  // visibility:hidden + disabled + tabIndex:-1 + aria-hidden）。覆盖层拆了，
  // 三件套也一起删：一枚永远可点、永远在无障碍树里的面板开关。
  assert.doesNotMatch(source, /const covered = mobile/);
  assert.doesNotMatch(source, /visibility: covered/);
  assert.match(source, /data-mobile-toolbar-file=\{mobile \? "true" : undefined\}/);
  assert.match(source, /aria-controls=\{mobile \? "file-panel" : secondaryWorkspaceId\}/);
});
test("the composer no longer hides its context ring behind an overlay", () => {
  // fork:pwa-composer-slim（2026-10-03）—— 输入区行二原本有一条**覆盖式**工具条
  // （ellipsis 展开，把上下文环与声音藏起来）。与顶栏那条盖住标题的覆盖层是同一个
  // 毛病，一起拆了：声音开关搬进宫格，上下文环常驻（它是这块屏上唯一说
  // 「还剩多少上下文」的地方）。
  const chatInput = readFileSync(new URL("./ChatInput.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(chatInput, /controlsMenuOpen/);
  assert.doesNotMatch(chatInput, /chat\.moreControls/);
  assert.doesNotMatch(chatInput, /chat\.collapseControls/);
  assert.doesNotMatch(chatInput, /!narrowControls \|\| controlsMenuOpen/);
  // 声音开关**不**进宫格：拆掉覆盖层之后它本来就常驻在行二，再给一格就是
  // 「同一块屏上摆两枚同一个动作」（AGENTS.md 那条裁定）。
  assert.doesNotMatch(source, /id: "sound"/);
  assert.match(chatInput, /data-ico=\{soundEnabled \? "volume-2" : "volume-x"\}/);
});
test("keeps theme and language in settings instead of the chat toolbar", () => {
  assert.doesNotMatch(source, /renderThemeButton/);
  assert.doesNotMatch(source, /renderLanguageButton/);
  assert.doesNotMatch(source, /toggleTopPanel\("language"/);
  assert.doesNotMatch(source, /data-mobile-toolbar-action=\{mobile \? "theme"/);
  assert.doesNotMatch(source, /data-mobile-toolbar-action=\{mobile \? "language"/);
  assert.match(source, /import \{ useTheme \} from "@\/hooks\/useTheme"/);
  assert.match(source, /useTheme\(\);/);
});

test("keeps the session stats in the context-ring popover, not a bottom strip", async () => {
  // fork:ui-stats-ring — 输入框下方不再有任何常驻条：完整统计（SessionStatsDetails）
  // 收进上下文环浮窗，/session 与触屏用 openStatsPopover 钉住它。
  const stats = await readFile(new URL("./SessionStatsBar.tsx", import.meta.url), "utf8");
  assert.match(stats, /export function SessionStatsDetails/);
  assert.match(stats, /export function formatCompactTokens/);
  assert.match(stats, /t\("session\.cacheHitRate"\)/);
  assert.doesNotMatch(stats, /session-stats-inline-toggle/);
  const chatWindow = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(chatWindow, /statsDetails=\{sessionStats\}/);
  // fix:mcp-topbar-icons（用户裁定 2026-09-30）—— 扩展状态（MCP / 插件）从「聊天区
  // 右上角胶囊浮标」搬去顶栏两枚图标：ChatWindow 只负责把 statuses / widgets 上报，
  // 浮窗由 AppShell 的 McpStatusButton / PluginStatusButton 渲染。
  assert.match(chatWindow, /onExtensionStatusChange\?\.\(statuses, widgets\)/);
  assert.doesNotMatch(chatWindow, /<ExtensionStatusFloat/);
  assert.match(source, /<McpStatusButton[\s\S]{0,120}?statuses=\{extensionStatuses\}/);
  assert.match(source, /<PluginStatusButton[\s\S]{0,160}?widgets=\{extensionWidgets\}/);
  assert.doesNotMatch(chatWindow, /<ExtensionStatusBar[\s\S]*?statuses=\{extensionStatuses\}[\s\S]*?widgets=\{extensionWidgets\}[\s\S]*?\/>/);
});

test("places trust warnings below the mobile toolbar and the file toggle in toolbar flow", () => {
  assert.match(source, /\{isMobile && renderProjectTrustWarning\(true\)\}/);
  // fork:design-system SW-16 —— 画板 60 帧 D：移动端横幅内联「信任」钮，不再弹模态框。
  assert.match(source, /data-mobile-trust-banner="true"/);
  assert.match(source, /className="pw-btn primary sm"[\s\S]{0,160}?void handleTrustProject\(\)/);
  assert.doesNotMatch(source, /File panel toggle — always visible at top-right/);
  assert.doesNotMatch(source, /position: "fixed", top: "env\(safe-area-inset-top\)"/);
});
