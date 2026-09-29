import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelSource = await readFile(new URL("./ToolDefinitionsPanel.tsx", import.meta.url), "utf8");
const systemSource = await readFile(new URL("./SystemPromptPanel.tsx", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");

test("keeps System and Tools in separate adjacent toolbar actions", () => {
  assert.match(appShellSource, /handleSystemInfoToggle\("system", mobile\)[\s\S]*?handleSystemInfoToggle\("tools", mobile\)/);
  assert.match(appShellSource, /activeTopPanel === "system"[\s\S]*?<SystemPromptPanel/);
  assert.match(appShellSource, /activeTopPanel === "tools"[\s\S]*?<ToolDefinitionsPanel/);
  assert.doesNotMatch(systemSource, /ToolEntry|tools/);
  assert.doesNotMatch(systemSource, /system-prompt-heading/);
  assert.doesNotMatch(panelSource, /tool-definitions-heading/);
});

test("renders active tool definitions in a selectable master-detail layout", () => {
  assert.match(panelSource, /tools\?\.filter\(\(tool\) => tool\.active\)/);
  assert.match(panelSource, /setSelectedToolName\(tool\.name\)/);
  assert.match(panelSource, /activeTools\?\.some\(\(tool\) => tool\.name === current\)/);
  assert.match(panelSource, /className="tool-definitions-sidebar pw-pop"/);
  assert.match(panelSource, /className="tool-definition-detail pw-pop"/);
});

test("SW-14: the master-detail grid keeps two columns at every width", () => {
  // 不变量：列表列有 112px 下限、详情列吃掉剩余空间 —— 窄屏因此不需要断点，
  // 也不会退化成上下堆叠（旧内联 <style> 的 @media 规则已随 <style> 一起退役）。
  assert.match(
    panelSource,
    /gridTemplateColumns: "clamp\(112px, 26%, 220px\) minmax\(0, 1fr\)"/,
  );
  assert.doesNotMatch(panelSource, /display: "block"/);
});

test("SW-14: board 22 DOM (search head, group titles, row descriptions, badges)", () => {
  assert.match(panelSource, /className="pw-pop-search"/);
  assert.match(panelSource, /tools\.enabledGroup/);
  assert.match(panelSource, /tools\.disabledGroup/);
  assert.match(panelSource, /className="pw-desc"/);
  assert.match(panelSource, /className="pw-sec-title"/);
  assert.match(panelSource, /className="pw-badge ok"/);
  assert.match(panelSource, /tools\.searchPlaceholder/);
  // 搜索是真的过滤，不是只画一个壳。
  assert.match(panelSource, /tool\.name\.toLowerCase\(\)\.includes\(needle\)/);
});

test("SW-14: parameter table stays two columns (DIVERGENCE 29)", () => {
  assert.match(panelSource, /parameters\.properties/);
  assert.match(panelSource, /parameters\.required/);
  assert.match(panelSource, /field\.allowedValues/);
  assert.match(panelSource, /field\.defaultValue/);
  assert.match(panelSource, /selectedTool\.promptGuidelines/);
  assert.match(panelSource, /<table className="pw-table"/);
  // ⊘ 29 条：四列表格会把字段描述挤掉，登记不改 —— 这里钉住「只有两列」。
  assert.doesNotMatch(panelSource, /<thead/);
});

test("SW-14: the system prompt panel is the board 22 pop shell", () => {
  assert.match(systemSource, /className="pw-pop system-prompt-panel"/);
  assert.match(systemSource, /data-ico="book-marked"/);
  assert.match(systemSource, /className="pw-badge count"/);
  assert.match(systemSource, /className="pw-code-body"/);
  assert.match(systemSource, /className="pw-card-foot"/);
  assert.match(systemSource, /system\.sourceNote/);
  // 复制按钮的两态（copy → check）必须还在。
  assert.match(systemSource, /copied \? "check" : "copy"/);
  // 内嵌 <style> 是 SW-14 明确要退役的东西。
  assert.doesNotMatch(systemSource, /<style/);
  assert.doesNotMatch(panelSource, /<style/);
});
