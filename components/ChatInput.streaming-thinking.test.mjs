import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const controls = source.slice(source.indexOf("{isStreaming && onThinkingLevelChange &&"));

test("shows the reasoning level of the running turn without offering a control", () => {
  const readOnly = controls.slice(0, controls.indexOf("{!isStreaming && onThinkingLevelChange &&"));
  assert.match(readOnly, /className="pw-select"\s+title=\{t\("chat\.currentReasoning", \{ level: thinkingDisplayLabel \}\)\}/);
  assert.match(readOnly, /\{thinkingDisplayLabel\}<\/span>/);
  assert.doesNotMatch(readOnly, /<button|onClick=/);
});

test("keeps the read-only level aligned with the neighbouring controls", () => {
  const readOnly = controls.slice(0, controls.indexOf("{!isStreaming && onThinkingLevelChange &&"));
  const dropdown = controls.slice(controls.indexOf("{!isStreaming && onThinkingLevelChange &&"));
  // fork:design-components —— 尺寸不再写在各处 inline style 里，而是统一由
  // 画板 .pw-select（board.css：24px 高 / 0 7px 内边距 / radius-4）提供；
  // 这里断言的是「两个控件都用同一个画板组件」，这才是这条测试的真正约束。
  for (const [label, markup] of [["read-only", readOnly], ["dropdown", dropdown]]) {
    assert.match(markup, /className="pw-select"/, `${label} uses the board select`);
  }
  // The label collapses to the icon exactly like the editable control, at the
  // breakpoint that collapses the strip (fork:pwa-tablet-tier).
  assert.match(readOnly, /\(!narrowControls \|\| controlsMenuOpen\) &&/);
});

test("shows the level the runtime actually applies, not the selector placeholder", async () => {
  const session = await readFile(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
  const start = session.slice(session.indexOf('case "agent_start":'), session.indexOf('case "agent_end":'));
  // Choosing "auto" leaves pi's setting untouched, so the selector alone cannot be trusted.
  assert.match(session, /if \(level === "auto"\) return;/);
  assert.match(start, /fetch\(`\/api\/agent\/\$\{encodeURIComponent\(sessionIdRef\.current\)\}`\)/);
  assert.match(start, /if \(!agentRunningRef\.current \|\| !d\.state\?\.thinkingLevel\) return;\s*setThinkingLevel\(d\.state\.thinkingLevel as ThinkingLevelOption\);/);
});
