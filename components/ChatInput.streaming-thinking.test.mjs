import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const start = source.indexOf("{onThinkingLevelChange && (", source.indexOf("fork:thinking-level-while-running"));
const control = source.slice(start, source.indexOf("</button>", start) + 9);

// fork:thinking-level-while-running（用户 2026-10-02，对齐上游 0.10）——
// 这条测试原先钉的是**运行中只读**（上一轮的实现）。上游 0.10 把这枚芯片在流式期间
// 保持可点（只有 title 换成「当前推理档」），所以断言反过来：运行中也能打开下拉、
// 按钮不被 disabled、置灰样式不再挂在这枚芯片上。
test("the reasoning level stays editable while a turn runs", () => {
  assert.match(control, /<button/);
  assert.match(control, /onClick=\{\(\) => setThinkingDropdownOpen/);
  assert.doesNotMatch(control, /disabled=\{isStreaming\}/);
  assert.doesNotMatch(control, /not-allowed/);
  assert.doesNotMatch(control, /opacity: isStreaming/);
  // 流式期间 title 说明「这是当前这一轮的档」，避免读成「改它就能改这一轮」。
  assert.match(control, /title=\{isStreaming\s*\? t\("chat\.currentReasoning", \{ level: thinkingDisplayLabel \}\)\s*: t\("chat\.changeReasoning", \{ level: thinkingDisplayLabel \}\)\}/);
});

test("keeps the level control on the board select", () => {
  // fork:design-components —— 尺寸由画板 .pw-select 提供（board.css：24px 高 /
  // 0 7px 内边距 / radius-4），不再写在各处 inline style 里。
  assert.match(control, /className="pw-select"/);
  // fork:pwa-composer-slim-2026-10-03 —— 覆盖式工具条拆了，标签的显隐只剩窄屏这一个条件。
  assert.match(control, /!narrowControls && <span style=\{\{ whiteSpace: "nowrap" \}\}>/);
  assert.doesNotMatch(control, /controlsMenuOpen/);
});

test("shows the level the runtime actually applies, not the selector placeholder", async () => {
  const session = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const start = session.slice(session.indexOf('case "agent_start":'), session.indexOf('case "agent_end":'));
  // Choosing "auto" leaves pi's setting untouched, so the selector alone cannot be trusted.
  assert.match(session, /if \(level === "auto"\) return;/);
  assert.match(start, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sessionIdRef\.current\)\}`\)/);
  assert.match(start, /if \(!agentRunningRef\.current \|\| !d\.state\?\.thinkingLevel\) return;\s*setThinkingLevel\(d\.state\.thinkingLevel as ThinkingLevelOption\);/);
});
