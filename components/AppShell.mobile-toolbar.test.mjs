import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const mobileHookSource = await readFile(new URL("../hooks/useIsMobile.ts", import.meta.url), "utf8");

test("keeps action icons inline in medium mobile sidebars", () => {
  assert.match(mobileHookSource, /NARROW_MOBILE_QUERY = "\(max-width: 480px\)"/);
  assert.match(source, /const isNarrowMobile = useIsNarrowMobile\(\);/);
  assert.match(source, /\{!isNarrowMobile && renderChatToolbarActions\(true\)\}/);
  assert.match(source, /\{isNarrowMobile && \([\s\S]*?data-mobile-toolbar-more="true"/);
});

test("uses a compact narrow-mobile toolbar with a floating action layer", () => {
  assert.match(source, /data-mobile-toolbar="true"[\s\S]*?flex: 1,[\s\S]*?minWidth: 0/);
  assert.match(
    source,
    /data-mobile-toolbar-actions="true"[\s\S]*?position: "absolute"[\s\S]*?right: 0,[\s\S]*?left: TOP_BAR_ICON_BUTTON_SIZE/,
  );

  for (const action of ["history", "name", "agents", "branches", "system", "tools"]) {
    assert.match(source, new RegExp(`data-mobile-toolbar-action=(?:\\{mobile \\? )?"${action}"`));
  }
});

test("only renders the Agents switcher when the active session family has subagents", () => {
  assert.match(source, /const hasSubagentSessions = Boolean\(activeSessionFamily\?\.subagents\.length\)/);
  // fork:top-panel-anchor —— 第三个参数是「被点的那颗按钮」，定位时量它而不是整条顶栏。
  assert.match(source, /\{hasSubagentSessions && \(\s*<button[\s\S]*?toggleTopPanel\("agents", mobile, event\.currentTarget\)/);
  assert.match(source, /activeTopPanel === "agents" && activeSessionFamily && selectedSession/);
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

test("keeps covered file controls out of interaction and focus", () => {
  // fork:ui-stats-inline — 统计控件已从顶栏移到 composer 下方，只剩文件开关还吃 covered 状态。
  assert.doesNotMatch(source, /renderSessionStatsButton/);
  assert.match(source, /const covered = mobile && isNarrowMobile && mobileToolbarMoreOpen;/);
  assert.match(source, /disabled=\{covered\}[\s\S]*?tabIndex=\{covered \? -1 : undefined\}/);
  assert.match(source, /data-mobile-toolbar-file=\{mobile \? "true" : undefined\}[\s\S]*?visibility: covered \? "hidden" : "visible"/);
  assert.match(source, /aria-hidden=\{covered \? true : undefined\}/);
});

test("closes the mobile action layer on outside click, Escape, layout changes, and session changes", () => {
  assert.match(source, /event\.composedPath\(\)\.includes\(toolbar\)/);
  assert.match(source, /document\.addEventListener\("pointerdown", handlePointerDown, true\)/);
  assert.match(source, /event\.key !== "Escape"[\s\S]*?setMobileToolbarMoreOpen\(false\)/);
  assert.match(source, /\}, \[isMobile, isNarrowMobile, selectedSession\?\.id, newSessionDraftId\]\);/);
});

test("keeps the mobile action layer open after using an expanded action", () => {
  const toggleTopPanel = source.match(/const toggleTopPanel = useCallback\([\s\S]*?\n  \}, \[isMobile, isNarrowMobile\]\);/)?.[0];
  const historyHandler = source.match(/onClick=\{\(\) => \{[\s\S]*?handleViewFullHistory\(\);[\s\S]*?\n          \}\}/)?.[0];
  const autoNameHandler = source.match(/onClick=\{\(\) => \{[\s\S]*?void handleAutoName\(\);[\s\S]*?\n              \}\}/)?.[0];

  for (const handler of [toggleTopPanel, historyHandler, autoNameHandler]) {
    assert.ok(handler);
    assert.doesNotMatch(handler, /setMobileToolbarMoreOpen\(false\)/);
    assert.match(handler, /setMobileToolbarMoreOpen\(true\)/);
  }

  assert.match(source, /toggleTopPanel\("branches", true, event\.currentTarget\)/);
  assert.match(source, /handleSystemInfoToggle\("system", mobile, event\.currentTarget\)/);
  assert.match(source, /handleSystemInfoToggle\("tools", mobile, event\.currentTarget\)/);
  assert.match(source, /handleViewFullHistory/);
  // fork:ui-stats-inline — 统计不再占顶栏按钮，因此也没有“点开后保持工具条展开”的需求。
  assert.doesNotMatch(source, /toggleTopPanel\("session"\)/);
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
