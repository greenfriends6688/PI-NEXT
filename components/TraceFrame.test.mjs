import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// fork:trace-frame —— 「调用轨迹」就是完整历史那一页换个位置放：
// pi 自己导出的会话页（侧栏树 + 搜索 + 五档过滤 + 可展开工具输出）同源 iframe 进来，
// 外面只加刷新与全屏两枚钮。断言钉的是这三条意图。
const frame = await readFile(new URL("./TraceFrame.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const route = await readFile(new URL("../app/api/sessions/[id]/export/route.ts", import.meta.url), "utf8");

test("the trace tab embeds the full-history export page, not a second renderer", () => {
  assert.match(frame, /export\?inline=1/);
  assert.match(frame, /<iframe/);
  // 面板里没有自己的转录渲染：内容全在 iframe 里。
  assert.doesNotMatch(frame, /MessageView|ThinkingBlock|ToolCallBlock|projectTraceCalls/);
  // 顶栏那枚原「完整历史」图标钮仍然是唯一入口（位置 / 图标不变）。
  // fork:mobile-toolbar-slim-2026-10-03 —— 窄屏顶栏那枚「完整历史」钮搬进了输入区的
  // 「更多动作」宫格（`data-mobile-toolbar-action` 钩子随之删除），所以这里钉两件事：
  // 桌面顶栏仍有这枚钮，且宫格里有同一动作（否则手机上就再也到不了轨迹页）。
  assert.match(shell, /onClick=\{\(\) => \{\s*handleViewFullHistory\(\);/);
  assert.match(shell, /id: "trace",[\s\S]{0,240}?handleViewFullHistory\(\)/);
  assert.match(shell, /<i data-ico="history" data-size="15" aria-hidden="true"><\/i>/);
  assert.match(shell, /handleViewFullHistory = useCallback\(\(\) => \{[\s\S]*?setActiveFileTabId\(TRACE_TAB_ID\)/);
  assert.match(shell, /<TraceFrame[\s\S]*?sessionId=\{selectedSession\?\.id \?\? ""\}/);
});

test("the export route allows same-origin framing only for inline=1", () => {
  // 下载仍然是 attachment + DENY；只有 inline（tab / 新标签页）能被同源 iframe 装。
  assert.match(route, /frame-ancestors \$\{inline \? "'self'" : "'none'"\}/);
  assert.match(route, /"X-Frame-Options": inline \? "SAMEORIGIN" : "DENY"/);
  assert.match(route, /"X-Content-Type-Options": "nosniff"/);
});

test("full screen covers the window and Escape leaves it", () => {
  assert.match(frame, /position: "fixed",\s*inset: 0,\s*zIndex: 1000/);
  assert.match(frame, /aria-label=\{t\("trace\.exitFullscreen"\)\}/);
  assert.match(frame, /event\.key === "Escape"\) setFullscreen\(false\)/);
  // 面板态与全屏态各有一枚刷新。
  assert.equal((frame.match(/onClick=\{reload\}/g) ?? []).length, 2);
  // 切回 tab 时重载一次（新回合落盘后 iframe 不会自己更新）。
  assert.match(frame, /if \(active && !wasActiveRef\.current\) setNonce/);
});
