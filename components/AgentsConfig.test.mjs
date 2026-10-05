// fork:builtin-subagent-disable — upstream-port marker
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AgentsConfig.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const modelSelectorSource = await readFile(new URL("./ModelSelector.tsx", import.meta.url), "utf8");

test("keeps same-name profiles selectable by scope, one row each in the D-12 table", () => {
  assert.match(source, /return `\$\{profile\.scope\}:\$\{profile\.name\}`/);
  // fork:v5-landing · D-12 —— profile 不再按作用域分组列在左栏（`.d-group-title`
  // 那一族随之退场），改成一张表：作用域进「状态」那一格，分组信息没丢。
  assert.match(source, /<Badge>\{t\(`agents\.scope\.\$\{profile\.scope\}`\)\}<\/Badge>/);
  assert.match(source, /visibleProfiles\.map\(renderAgentRow\)/);
  assert.match(source, /isSubagentProfileOverridden\(profile, profiles\)/);
});

test("fork:v5-landing · D-12 — profile 列表是 .d-card > .d-table，左栏那一列撤掉", () => {
  assert.match(source, /<div className="d-card">\s*<table className="d-table">/);
  // 六列表头逐条等于画板帧 B：名称 / 描述 / 模型 / 思考 / max turns / 状态。
  for (const key of ["colName", "description", "colModel", "thinking", "maxTurns", "colStatus"]) {
    assert.match(source, new RegExp(`<th>\\{t\\("agents\\.${key}"\\)\\}<\\/th>`), `missing column ${key}`);
  }
  // 点行选中（键盘 Enter / Space 同一条路），选中态是画板的 `.d-table tr.is-on`。
  assert.match(source, /<tr[\s\S]{0,400}?onClick=\{\(\) => selectProfile\(profile\)\}/);
  assert.match(source, /className=\{isActive \? "is-on" : undefined\}/);
  // v1 画板 42 的主从两栏与列表行族在本页已完全退场。
  assert.doesNotMatch(source, /<ConfigSplitView|<ConfigSidebar|className="d-sess|d-group-title/);
  assert.doesNotMatch(
    source.match(/import \{([\s\S]*?)\} from "\.\/SettingsUi";/)[1],
    /ConfigSidebar|ConfigSplitView/,
    "the settings shell import must not pull the two-column primitives back in",
  );
});

test("uses the D-12 status badge column instead of a list-row status dot", () => {
  assert.match(source, /<Badge tone=\{profile\.enabled \? "ok" : "mute"\}>/);
  assert.match(source, /t\("agents\.statusReady"\) : t\("agents\.statusOff"\)/);
  // 停用项在表格里靠状态列说，不再弱化行首图标（表格没有行首图标）。
  assert.doesNotMatch(source, /StatusDot|d-dot|className=\{`pw-ico/);
  // settings.css 里只允许退役说明注释提到这个族，不允许再出现活的选择器。
  assert.doesNotMatch(cssSource, /(^|[,{])\s*\.config-sidebar-text/m);
});

test("offers a persisted built-in sub-agent switch with explicit session reload", () => {
  assert.match(source, /fetch\("\/api\/subagents\/settings"/);
  assert.match(source, /JSON\.stringify\(\{ enabled \}\)/);
  // 画板 D-12 帧 A 的总开关是 `.d-switch`（真按钮 role=switch）。
  assert.match(source, /aria-checked=\{builtInEnabled\}[\s\S]*?toggleBuiltInSubagents/);
  assert.match(source, /sendAgentCommand\(sessionId, \{ type: "reload" \}\)/);
  // 画板 D-12 帧 A：重载提示是 `.d-banner warn` + `.d-btn.sm.d-banner-btn` 重载入口。
  assert.match(source, /reloadNeeded && \(/);
  assert.match(source, /sessionId && \(/);
  assert.match(source, /className="d-banner warn"/);
  // fork:v5-landing · D-12 —— 帧 A 把总开关与上限拆成两节两条 `.d-set-row`
  // （行 anatomy 照画板：`.d-set-row-box` 标签 + 说明在左、右控件），
  // 不再把开关与并发输入框挤进左栏一条窄行里。
  assert.match(source, /className="d-set-sec"/);
  assert.match(source, /t\("agents\.builtInTitle"\)/);
  assert.match(source, /t\("agents\.builtInDescription"\)/);
  assert.match(source, /t\("agents\.limitsSection"\)[\s\S]{0,900}?aria-label=\{t\("agents\.maxConcurrent"\)\}/);
  // 总开关在上、并发上限在下（帧 A 的两节顺序）。
  assert.ok(
    source.indexOf('aria-checked={builtInEnabled}') > 0
      && source.indexOf('aria-checked={builtInEnabled}') < source.indexOf('aria-label={t("agents.maxConcurrent")}'),
    "the master switch must come before the concurrency cap",
  );
  // 画板帧 A 的两个窄数字框（并发上限 / 最大回合数）都用 90px 且同时归零 min-width。
  for (const label of ["width: 90", "width: 90, minWidth: 0"]) {
    assert.match(source, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  // 独立卡片形态（pw-block）已删除。
  assert.doesNotMatch(source, /className="pw-block"/);
  assert.match(source, /t\("agents\.reloadRequired"\)/);
  // 「需重载会话」常驻在开关旁边（画板帧 A 的 `.d-badge mute` + lock）。
  assert.match(source, /t\("agents\.reloadBadge"\)/);
  assert.doesNotMatch(cssSource, /\.agents-feature-setting|\.agents-concurrency-control/);
});

test("marks profiles shadowed by a higher-precedence source", () => {
  assert.match(source, /isSubagentProfileOverridden\(profile, profiles\)/);
  // 画板 42：被覆盖项给一枚中性 `.pw-badge`，不标红。
  assert.match(source, /overridden && <Badge>\{t\("agents\.overridden"\)\}<\/Badge>/);
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

test("fork:v5-landing · D-12 — 新建在 profile 行右槽（D-12 帧 B），搜索在工具栏", () => {
  assert.match(source, /<PwSearch[\s\S]{0,260}?placeholder=\{t\("agents\.searchPlaceholder"\)\}/);
  // 画板帧 B：新建是 `.d-set-row` 右槽（`.d-grow-last`）里那枚 `d-btn sm primary`。
  assert.match(source, /t\("agents\.profilesTitle"\)[\s\S]{0,900}?<Btn\s+variant="primary"\s+size="small"\s+onClick=\{beginCreate\}/);
  // 页头右端在三帧里都是空的（D-12 没有页级动作）。
  assert.doesNotMatch(source, /actions=\{[\s\S]{0,200}beginCreate/);
  // 列表末尾那行 `.pw-litem-add` 早已撤掉（41/43 才用 pw-litem-add）。
  assert.doesNotMatch(source, /<ConfigListAction/);
});

test("fork:v5-landing · D-12 — 表格行把「名称 / 描述 / 模型」一行给全", () => {
  assert.match(source, /<td className="d-mono d-t-b">\{profile\.name\}<\/td>/);
  assert.match(source, /<td className="d-t-xs">\{profile\.description \|\| profile\.name\}<\/td>/);
  assert.match(source, /<td className="d-mono d-t-xs">\{profile\.model \?\? "—"\}<\/td>/);
  assert.match(source, /HIGH_THINKING\.has\(profile\.thinking\) \? "warn" : "ok"/);
  assert.match(source, /<td className="d-mono">\{profile\.maxTurns \?\? "—"\}<\/td>/);
});

test("fork:settings-frame（画板 D-12 落位表）— 详情字段是 d-field 行，系统指令整行宽直下", () => {
  // 字段一律 `d-field`（`.d-field-t` + 控件）：子代理 ID / 显示名称 / 指定模型 / 描述。
  assert.match(source, /t\("agents\.name"\)/);
  assert.match(source, /t\("agents\.displayName"\)/);
  assert.match(source, /t\("agents\.model"\)/);
  assert.match(source, /t\("agents\.description"\)/);
  assert.match(source, /className="d-field"/);
  // 原 .pw-grid2 两栏网格与它的 gridFieldStyle inline 退役（改用 `.d-grid2`）。
  assert.doesNotMatch(source, /pw-grid2|gridFieldStyle/);
  // 系统指令是整行宽控件：`.d-field-t` + `.d-textarea` 直接挂在详情栈下，不塞进其它字段行。
  assert.match(source, /<span className="d-field-t">\{t\("agents\.prompt"\)\}<\/span>[\s\S]{0,400}?<textarea\s+className="d-textarea agents-system-prompt"/);
  assert.doesNotMatch(source, /<ConfigField[^>]*>[\s\S]{0,300}?agents-system-prompt/);
  // 详情未选照画板 D-12 帧 D：`.d-empty` 记号 + 一句引导。
  assert.match(source, /<span className="d-empty-ico"><i data-ico="square-mouse-pointer"/);
  // 「工具白名单」照画板 D-12 帧 C 拆成**两组**芯片：内置工具一块（工具芯片），
  // 外置资源（技能 / 扩展）另一块，计数徽标行在两组下面。
  assert.match(source, /t\("agents\.toolsBuiltin"\)[\s\S]{0,400}?TOOL_OPTIONS\.map\(\(tool\) => \(/);
  assert.match(source, /t\("agents\.toolsExternal"\)[\s\S]{0,400}?<ToolChip selected=\{draft\.loadSkills\}/);
  assert.match(source, /t\("agents\.toolsEnabled", \{ count: String\(enabledToolCount\) \}\)/);
  assert.match(source, /t\("agents\.toolsWrite", \{ count: String\(writeToolCount\) \}\)/);
  assert.match(source, /WRITE_TOOL_NAMES = new Set\(\["bash", "edit", "write"\]\)/);
  assert.doesNotMatch(source, /t\("agents\.resources"\)/);
});

test("sends the selected scope for saves and the source scope for deletes", () => {
  assert.match(source, /JSON\.stringify\(\{ cwd, scope: targetScope, profile: draft \}\)/);
  assert.match(source, /JSON\.stringify\(\{ cwd, scope: selected\.scope, name: selected\.name \}\)/);
});

test("shows a Skills-style path row with the same switch in editable and readonly modes", () => {
  assert.match(source, /function displayProfilePath\(profile: SubagentProfile, cwd: string\)/);
  assert.match(source, /profile\.scope === "project" \|\| profile\.scope === "workspace"/);
  assert.match(source, /`~\/\.pi\/agent\/agents\/\$\{draft\.name \|\| "\.\.\."\}\.md`/);
  assert.match(source, /aria-checked=\{draft\.enabled\}[\s\S]*?disabled=\{switchDisabled\}/);
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
  // 只读 ID 是等宽文本（画板 D-12 的 ID 字段形态），不再带手写 inline。
  assert.match(source, /<code className="d-mono">\{draft\.name\}<\/code>/);
  assert.doesNotMatch(source, /disabled=\{disabled \|\| !creating\}/);
});

test("uses the same form controls for editable and readonly profiles", () => {
  assert.match(source, /<input aria-label=\{t\("agents\.displayName"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /<input aria-label=\{t\("agents\.description"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /<textarea\s+className="d-textarea agents-system-prompt"[\s\S]*?aria-label=\{t\("agents\.prompt"\)\}[\s\S]*?disabled=\{disabled\}/);
  // 画板 D-12 帧 C 的「工具」：已选 accent 芯片 / 未选圆斜杠芯片。
  assert.match(source, /TOOL_OPTIONS\.map\(\(tool\) => \(/);
  assert.match(source, /<ToolChip[\s\S]*?selected=\{draft\.tools\.includes\(tool\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /<PwSelectBox[\s\S]*?ariaLabel=\{t\("agents\.thinking"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /<input[\s\S]*?aria-label=\{t\("agents\.maxTurns"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /aria-checked=\{draft\.inheritContext\}[\s\S]*?aria-label=\{t\("agents\.inheritContext"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /aria-checked=\{draft\.runInBackground\}[\s\S]*?aria-label=\{t\("agents\.background"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /<ToolChip selected=\{draft\.loadSkills\} disabled=\{disabled\}/);
  assert.match(source, /<ToolChip selected=\{draft\.loadExtensions\} disabled=\{disabled\}/);
  assert.doesNotMatch(source, /ReadonlyValue|readonlyPromptStyle|agents-readonly/);
});

test("shows disabled controls with a gray background", () => {
  // 禁用态底色不再写组件内联 —— 画板的 `.d-input:disabled` / `.d-textarea:disabled`
  // 已在 system.css 里给灰底（--nx-surface + --nx-text-3），组件只负责传 disabled。
  assert.match(source, /<textarea[^>]*aria-label=\{t\("agents\.prompt"\)\}[\s\S]*?disabled=\{disabled\}/);
  assert.match(source, /minHeight: 195,[\s\S]*?maxHeight: "60vh"[\s\S]*?resize: disabled \? "none" : "vertical"/);
  assert.doesNotMatch(source, /agents-system-prompt[^\n]*fontFamily/);
  assert.doesNotMatch(source, /disabledInputStyle/);
  assert.match(modelSelectorSource, /background: locked \? "var\(--bg-panel\)" : "var\(--bg\)"/);
});

test("keeps a larger resize corner when system instructions need a scrollbar", () => {
  assert.match(source, /<textarea\s+className="d-textarea agents-system-prompt"[\s\S]*?aria-label=\{t\("agents\.prompt"\)\}/);
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
  assert.match(source, /onClick=\{beginDuplicate\}[\s\S]*?onClick=\{\(\) => void remove\(\)\}[\s\S]*?aria-checked=\{draft\.enabled\}/);
});

test("confirms deletion and limits it to writable profiles", () => {
  assert.match(source, /window\.confirm\(t\("agents\.deleteConfirm", \{ name: selected\.displayName \}\)\)/);
  assert.match(source, /selected && isWritableScope\(selected\.scope\) && mode === "edit"/);
  assert.match(source, /method: "DELETE"/);
});
