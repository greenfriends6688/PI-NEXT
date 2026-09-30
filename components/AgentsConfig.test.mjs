// fork:builtin-subagent-disable — upstream-port marker
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AgentsConfig.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const modelSelectorSource = await readFile(new URL("./ModelSelector.tsx", import.meta.url), "utf8");

test("keeps same-name profiles selectable by scope and groups writable sources first", () => {
  assert.match(source, /return `\$\{profile\.scope\}:\$\{profile\.name\}`/);
  assert.match(source, /\["project", "global", "workspace", "builtin"\] as const/);
  assert.match(source, /profile\.scope === scope/);
});

test("uses the shared enabled status treatment", () => {
  assert.match(source, /<ConfigStatusDot active=\{profile\.enabled\}/);
  assert.match(source, /className=\{profile\.enabled \? "" : " is-muted"\}/);
  assert.match(cssSource, /\.config-sidebar-text\.is-muted \{[\s\S]*?color: var\(--text-dim\)/);
});

test("offers a persisted built-in sub-agent switch with explicit session reload", () => {
  assert.match(source, /fetch\("\/api\/subagents\/settings"/);
  assert.match(source, /JSON\.stringify\(\{ enabled \}\)/);
  assert.match(source, /<ConfigSwitch[\s\S]*?checked=\{builtInEnabled\}[\s\S]*?t\("agents\.builtInTitle"\)/);
  assert.match(source, /sendAgentCommand\(sessionId, \{ type: "reload" \}\)/);
  assert.match(source, /reloadNeeded && sessionId/);
  // fork:design-system —— 画板 42 的「内置子代理」块：`pw-block` 卡 + `pw-field`
  // 行（开关与并发各一行），不再是自绘的横条。
  assert.match(source, /className="pw-block"[\s\S]*?t\("agents\.maxConcurrent"\)/);
  assert.match(source, /aria-label=\{t\("agents\.maxConcurrent"\)\}/);
  // 重载提示是画板的警示徽章（空标签 + 右侧控件），旧的横条 CSS 已退役。
  assert.match(source, /<ConfigBadge tone="warn">[\s\S]*?t\("agents\.reloadRequired"\)/);
  assert.doesNotMatch(cssSource, /\.agents-feature-setting|\.agents-concurrency-control/);
});

test("marks profiles shadowed by a higher-precedence source", () => {
  assert.match(source, /isSubagentProfileOverridden\(profile, profiles\)/);
  // 画板 42：被覆盖项给一枚中性 `.pw-badge`，不标红。
  assert.match(source, /overridden && <ConfigBadge>\{t\("agents\.overridden"\)\}<\/ConfigBadge>/);
  assert.doesNotMatch(cssSource, /\.agents-overridden-label/);
});

test("treats global and project profiles as directly editable", () => {
  assert.match(source, /scope === "global" \|\| scope === "project"/);
  assert.match(source, /setMode\(isWritableScope\(profile\.scope\) \? "edit" : "view"\)/);
  assert.match(source, /selected && isWritableScope\(selected\.scope\) && mode === "edit"/);
});

test("offers both writable scopes when creating a profile", () => {
  assert.match(source, /\{creating && \(/);
  // 画板 42 编辑器的「保存作用域」是 `PwRadio` 芯片单选组。
  assert.match(source, /<PwRadio[\s\S]*?value=\{targetScope\}[\s\S]*?t\("agents\.scope\.global"\)[\s\S]*?t\("agents\.scope\.project"\)/);
  assert.doesNotMatch(source, /beginOverride|mode === "override"|agents\.readOnly|agents\.override/);
});

test("fork:settings-frame — 新建入口在页头（画板 62），搜索在工具栏，不在列表末尾", () => {
  assert.match(source, /<PwSearch[\s\S]{0,260}?placeholder=\{t\("agents\.searchPlaceholder"\)\}/);
  assert.match(source, /variant="primary" size="small" onClick=\{beginCreate\}/);
  // 列表末尾那行 `.pw-litem-add` 已按画板 42 撤掉（41/43 才用 pw-litem-add）。
  assert.doesNotMatch(source, /<ConfigListAction/);
});

test("fix:agents-layout — 列表行是「图标 + 名字 + 一句说明」两段", () => {
  assert.match(source, /<i data-ico="bot" data-size="14" aria-hidden="true" \/>/);
  assert.match(source, /<ConfigSidebarSub>\{profile\.description \|\| profile\.name\}<\/ConfigSidebarSub>/);
});

test("sends the selected scope for saves and the source scope for deletes", () => {
  assert.match(source, /JSON\.stringify\(\{ cwd, scope: targetScope, profile: draft \}\)/);
  assert.match(source, /JSON\.stringify\(\{ cwd, scope: selected\.scope, name: selected\.name \}\)/);
});

test("shows a Skills-style path row with the same switch in editable and readonly modes", () => {
  assert.match(source, /function displayProfilePath\(profile: SubagentProfile, cwd: string\)/);
  assert.match(source, /profile\.scope === "project" \|\| profile\.scope === "workspace"/);
  assert.match(source, /`~\/\.pi\/agent\/agents\/\$\{draft\.name \|\| "\.\.\."\}\.md`/);
  assert.match(source, /<ConfigSwitch checked=\{draft\.enabled\} disabled=\{switchDisabled\}/);
  assert.doesNotMatch(source, /agents-readonly-status/);
  assert.doesNotMatch(source, /<Toggle label=\{t\("agents\.enabled"\)\}/);
});

test("keeps the enabled switch live for built-ins whose fields stay read-only", () => {
  assert.match(source, /function isTogglableScope\(scope: SubagentScope\): boolean \{\s*return isWritableScope\(scope\) \|\| scope === "builtin";/);
  assert.match(source, /const switchDisabled = creating\s*\? disabled\s*: !selected \|\| !isTogglableScope\(selected\.scope\) \|\| saving \|\| toggling;/);
  assert.match(source, /if \(!selected \|\| !isTogglableScope\(selected\.scope\)\) return;/);
  // Everything else on a built-in stays read-only: only the switch has somewhere to write.
  assert.match(source, /setMode\(isWritableScope\(profile\.scope\) \? "edit" : "view"\)/);
});

test("persists existing profile toggles immediately without submitting unsaved fields", () => {
  assert.match(source, /const toggleEnabled = async \(enabled: boolean\)/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /JSON\.stringify\(\{ cwd, scope: selected\.scope, name: selected\.name, enabled \}\)/);
  assert.match(source, /setDraft\(\(current\) => \(\{ \.\.\.current, enabled: saved\.enabled \}\)\)/);
  assert.doesNotMatch(source, /method: "PATCH"[\s\S]*?profile: draft/);
});

test("reuses the ChatInput model selector with scoped models", () => {
  assert.match(source, /fetch\(`\/api\/models\?cwd=\$\{encodeURIComponent\(cwd\)\}`/);
  assert.match(source, /import \{ ModelSelector \} from "\.\/ModelSelector"/);
  assert.match(chatInputSource, /import \{ ModelSelector, type ModelSelectorOption \} from "\.\/ModelSelector"/);
  assert.match(source, /<ModelSelector[\s\S]*?options=\{modelSelectorOptions\}[\s\S]*?variant="field"/);
  assert.match(chatInputSource, /<ModelSelector[\s\S]*?options=\{modelOptions\}/);
  assert.match(modelSelectorSource, /filterModelOptions\(sortedOptions, filter\)/);
  assert.match(modelSelectorSource, /modelsByProvider\.map/);
  assert.match(modelSelectorSource, /event\.key !== "Escape" \|\| !open[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)/);
  assert.match(source, /agents\.modelUnavailable/);
  assert.doesNotMatch(source, /placeholder="provider\/modelId"/);
});

test("renders the stable agent id as text outside create mode", () => {
  assert.match(source, /creating \? \(\s*<input aria-label=\{t\("agents\.name"\)\}/);
  // 只读 ID 是等宽文本（画板 42 的 ID 字段形态），不再带手写 inline。
  assert.match(source, /<code className="pw-mono">\{draft\.name\}<\/code>/);
  assert.doesNotMatch(source, /disabled=\{disabled \|\| !creating\}/);
});

test("uses the same form controls for editable and readonly profiles", () => {
  assert.match(source, /<input aria-label=\{t\("agents\.displayName"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /<input aria-label=\{t\("agents\.description"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /<textarea\s+className="pw-textarea agents-system-prompt"[\s\S]*?aria-label=\{t\("agents\.prompt"\)\}[\s\S]*?disabled=\{disabled\}/);
  // 画板 42 的「工具与资源」：已选 accent 芯片 / 未选带 plus 的芯片。
  assert.match(source, /TOOL_OPTIONS\.map\(\(tool\) => \(/);
  assert.match(source, /<ToolChip[\s\S]*?selected=\{draft\.tools\.includes\(tool\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /<PwSelectBox[\s\S]*?ariaLabel=\{t\("agents\.thinking"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /<input[\s\S]*?aria-label=\{t\("agents\.maxTurns"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /<ConfigSwitch checked=\{draft\.inheritContext\} disabled=\{disabled\}/);
  assert.match(source, /<ConfigSwitch checked=\{draft\.runInBackground\} disabled=\{disabled\}/);
  assert.match(source, /<ToolChip selected=\{draft\.loadSkills\} disabled=\{disabled\}/);
  assert.match(source, /<ToolChip selected=\{draft\.loadExtensions\} disabled=\{disabled\}/);
  assert.doesNotMatch(source, /ReadonlyValue|readonlyPromptStyle|agents-readonly/);
});

test("shows disabled controls with a gray background", () => {
  const disabledStyle = source.match(/const disabledInputStyle: CSSProperties = \{([\s\S]*?)\n\};/)?.[1] ?? "";
  assert.match(source, /<textarea[^>]*aria-label=\{t\("agents\.prompt"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /minHeight: 195,[\s\S]*?maxHeight: "60vh"[\s\S]*?resize: disabled \? "none" : "vertical"/);
  assert.doesNotMatch(source, /agents-system-prompt[^\n]*fontFamily/);
  assert.match(disabledStyle, /background: "var\(--bg-panel\)"/);
  assert.match(disabledStyle, /color: "var\(--text-dim\)"/);
  assert.match(modelSelectorSource, /background: locked \? "var\(--bg-panel\)" : "var\(--bg\)"/);
});

test("keeps a larger resize corner when system instructions need a scrollbar", () => {
  assert.match(source, /<textarea\s+className="pw-textarea agents-system-prompt"[\s\S]*?aria-label=\{t\("agents\.prompt"\)\}/);
  assert.match(cssSource, /.agents-system-prompt \{[\s\S]*?scrollbar-width: auto;/);
  assert.match(cssSource, /\.agents-system-prompt::-webkit-scrollbar \{[\s\S]*?width: 14px;[\s\S]*?height: 14px;/);
  assert.match(cssSource, /\.agents-system-prompt::-webkit-scrollbar-thumb \{[\s\S]*?border: 5px solid transparent;/);
});

test("duplicates any selected profile through the existing create flow", () => {
  assert.match(source, /function duplicateProfileName\(name: string, profiles: readonly SubagentProfile\[\]\)/);
  assert.match(source, /while \(existing\.has\(candidate\.toLowerCase\(\)\)\) candidate = `\$\{base\}-\$\{suffix\+\+\}`/);
  assert.match(source, /const beginDuplicate = \(\) =>/);
  assert.match(source, /\.\.\.editableProfile\(selected\),[\s\S]*?name,[\s\S]*?displayName: t\("agents\.copyName"/);
  assert.match(source, /setMode\("create"\)/);
  assert.match(source, /setTargetScope\(isWritableScope\(selected\.scope\) \? selected\.scope : "global"\)/);
  assert.match(source, /onClick=\{beginDuplicate\}[^>]*>[\s\S]*?t\("agents\.duplicate"\)/);
});

test("places duplicate and delete immediately before the enabled switch", () => {
  assert.match(source, /onClick=\{beginDuplicate\}[\s\S]*?onClick=\{\(\) => void remove\(\)\}[\s\S]*?<ConfigSwitch checked=\{draft\.enabled\}/);
});

test("confirms deletion and limits it to writable profiles", () => {
  assert.match(source, /window\.confirm\(t\("agents\.deleteConfirm", \{ name: selected\.displayName \}\)\)/);
  assert.match(source, /selected && isWritableScope\(selected\.scope\) && mode === "edit"/);
  assert.match(source, /method: "DELETE"/);
});
