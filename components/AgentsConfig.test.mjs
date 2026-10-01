// fork:builtin-subagent-disable — upstream-port marker
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./AgentsConfig.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const chatInputSource = await readFile(new URL("./ChatInput.tsx", import.meta.url), "utf8");
const modelSelectorSource = await readFile(new URL("./ModelSelector.tsx", import.meta.url), "utf8");

test("keeps same-name profiles selectable by scope and leads the list with the built-in group", () => {
  assert.match(source, /return `\$\{profile\.scope\}:\$\{profile\.name\}`/);
  // fork:settings-frame（画板 62 落位表）—— 「内置」组提到列表首位（组顶部挂紧凑
  // 设置行），自定义组（项目 / 全局 / 工作区）随后。
  assert.match(source, /<ConfigSidebarGroupLabel>\{t\("agents\.scope\.builtin"\)\}<\/ConfigSidebarGroupLabel>/);
  assert.match(source, /\["project", "global", "workspace"\] as const/);
  assert.match(source, /profile\.scope === scope/);
});

test("uses the shared enabled status treatment", () => {
  assert.match(source, /<ConfigStatusDot active=\{profile\.enabled\}/);
  // 画板 42 的停用行只弱化行首图标（pw-dim）与状态点，名字保持正文色 ——
  // settings.css 的 config-sidebar-text.is-muted 族已退役，不再挂死类。
  assert.match(source, /className=\{`pw-ico\$\{profile\.enabled \? "" : " pw-dim"\}`\}/);
  assert.doesNotMatch(source, /is-muted/);
  // settings.css 里只允许退役说明注释提到这个族，不允许再出现活的选择器。
  assert.doesNotMatch(cssSource, /(^|[,{])\s*\.config-sidebar-text/m);
});

test("offers a persisted built-in sub-agent switch with explicit session reload", () => {
  assert.match(source, /fetch\("\/api\/subagents\/settings"/);
  assert.match(source, /JSON\.stringify\(\{ enabled \}\)/);
  assert.match(source, /<ConfigSwitch[\s\S]*?checked=\{builtInEnabled\}[\s\S]*?t\("agents\.builtInTitle"\)/);
  assert.match(source, /sendAgentCommand\(sessionId, \{ type: "reload" \}\)/);
  assert.match(source, /reloadNeeded && sessionId/);
  // fork:settings-frame（画板 62 落位表）—— 开关 + 并发上限收成「内置」组顶部的
  // 一条紧凑设置行（pw-field，行 anatomy 照画板 42：标签 + small 说明在左、
  // pw-ctl 控件在右），不再是独立卡片。
  assert.match(source, /<ConfigField label=\{t\("agents\.builtInTitle"\)\} hint=\{t\("agents\.builtInDescription"\)\}>/);
  assert.match(source, /<ConfigControl>\s*<ConfigSwitch\s+checked=\{builtInEnabled\}/);
  // 窗口只看「开关与数字框在同一条 pw-ctl 里」；中间的注释不计入（原先 600 字符刚好
  // 卡在注释长度上，fix:agents-row-collapse 加了病因注释就被顶出去了）。
  assert.match(source, /checked=\{builtInEnabled\}[\s\S]{0,1200}?aria-label=\{t\("agents\.maxConcurrent"\)\}/);
  // fix:agents-row-collapse —— `.pw-input` 的 `min-width: 200px` 会压过内联的
  // `width: 64`，把 295px 列表列里的标签挤成 53px（一行 194px 高）。两处窄数字框
  // （并发上限 / 最大回合数）都必须同时归零 min-width。
  for (const width of ["width: 64", "width: 80"]) {
    assert.match(source, new RegExp(`${width}, minWidth: 0`), `${width} also needs minWidth: 0`);
  }
  // 独立卡片形态（pw-block）已删除；重载提示是画板的警示徽章（空标签 + 右侧控件）。
  assert.doesNotMatch(source, /className="pw-block"/);
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

test("fork:settings-frame（画板 62 落位表）— 详情字段是 pw-field 行，系统指令整行宽直下", () => {
  // 字段一律「标签左 / 控件右」的 pw-field 行：子代理 ID / 显示名称 / 指定模型 / 描述。
  assert.match(source, /<ConfigField label=\{t\("agents\.name"\)\}>/);
  assert.match(source, /<ConfigField label=\{t\("agents\.displayName"\)\}>/);
  assert.match(source, /<ConfigField label=\{t\("agents\.model"\)\}>/);
  assert.match(source, /<ConfigField label=\{t\("agents\.description"\)\}>/);
  // 原 .pw-grid2 两栏网格（标签在控件上方）与它的 gridFieldStyle inline 退役。
  assert.doesNotMatch(source, /pw-grid2|gridFieldStyle/);
  // 系统指令是整行宽控件：pw-sec-title + pw-textarea 直接挂在详情栈下，不塞进字段行。
  assert.match(source, /<ConfigSectionTitle>\{t\("agents\.prompt"\)\}<\/ConfigSectionTitle>[\s\S]{0,400}?<textarea\s+className="pw-textarea agents-system-prompt"/);
  assert.doesNotMatch(source, /<ConfigField[^>]*>[\s\S]{0,300}?agents-system-prompt/);
  // 详情未选照 62 帧 D：40px 方框图标（.mark）+ 一句引导，居中。
  assert.match(source, /<span className="mark"><i data-ico="square-mouse-pointer" data-size="16" aria-hidden="true" \/><\/span>/);
  // 「工具与资源」照画板 42 合并为一个芯片区：工具芯片 + 加载技能 / 加载扩展入口芯片。
  assert.match(source, /TOOL_OPTIONS\.map\(\(tool\) => \([\s\S]{0,700}?<ToolChip selected=\{draft\.loadSkills\}/);
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
