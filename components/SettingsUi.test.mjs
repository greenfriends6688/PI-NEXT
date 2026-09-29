import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templateSource = await readFile(new URL("./SettingsUi.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const globalCssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const boardSource = await readFile(new URL("../design/pi-web-design/assets/board.css", import.meta.url), "utf8");
const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");
const configSources = await Promise.all(
  ["ModelsConfig", "SkillsConfig", "AgentsConfig", "PluginsConfig"].map(async (name) => [
    name,
    await readFile(new URL(`./${name}.tsx`, import.meta.url), "utf8"),
  ]),
);

// fork:design-system SW-08~14 —— 画板 41/42/43 是两栏结构：`.pw-cols` 左列表右详情。
// 下面断言的是**现在**的结构（SettingsUi 的共享基件 → board.css 的 pw-* 类），
// 旧的 `config-sidebar*` / `config-detail*` 自绘类名已随画板类退役。
test("provides one template for config layout and controls", () => {
  for (const primitive of [
    "ConfigPanelShell",
    "ConfigSplitView",
    "ConfigSidebar",
    "ConfigSidebarGroupLabel",
    "ConfigSidebarItem",
    "ConfigSidebarText",
    "ConfigSidebarSub",
    "ConfigBadge",
    "ConfigKv",
    "ConfigControl",
    "ConfigStatGrid",
    "ConfigStat",
    "ConfigDetail",
    "ConfigDetailStack",
    "ConfigDetailHeader",
    "ConfigDetailHeaderInfo",
    "ConfigDetailActions",
    "ConfigDetailTitle",
    "ConfigSectionTitle",
    "ConfigField",
    "ConfigEmptyState",
    "ConfigFooter",
    "ConfigButton",
    "ConfigSwitch",
    "ConfigListAction",
    "ConfigStatusDot",
  ]) {
    assert.match(templateSource, new RegExp(`export function ${primitive}`));
  }
  // 两栏骨架 = 画板 41 的 `.pw-cols`（260px 列表 + 1fr 详情，gap s4）。
  assert.match(templateSource, /export function ConfigSplitView[\s\S]*?className="pw-cols"/);
  assert.match(templateSource, /export function ConfigSidebarList[\s\S]*?className="pw-list"/);
  assert.match(templateSource, /export function ConfigDetail[\s\S]*?className="pw-detail"/);
  assert.match(boardSource, /\.pw-cols \{[\s\S]*?grid-template-columns: 260px minmax\(0, 1fr\)/);
  assert.match(boardSource, /\.pw-detail \{[\s\S]*?border: 1px solid var\(--n-border-subtle\)/);
  // 列宽 / 卡内距的唯一来源是 board.css；模板直接输出 `.pw-cols` / `.pw-detail`，
  // 不再输出 settings.css 里那套 240px / 20px 抄写对应的自绘类。
  assert.doesNotMatch(templateSource, /"config-sidebar"|"config-detail"/);
});

test("loads settings presentation from its dedicated stylesheet", () => {
  // fork:design-system —— app/layout.tsx 现在按「设计 token → 产品 token → 全局 →
  // 设置 → 壁纸」顺序引入；画板的 tokens.css / board.css 在 globals 之前。
  assert.match(layoutSource, /import "\.\.\/design\/pi-web-design\/assets\/tokens\.css";/);
  assert.match(layoutSource, /import "\.\/globals\.css";\s*import "\.\/settings\.css";/);
  assert.match(cssSource, /\.config-panel-root \{/);
  assert.match(cssSource, /\.settings-dialog-backdrop \{/);
  assert.doesNotMatch(globalCssSource, /\.config-panel-root \{/);
  assert.doesNotMatch(globalCssSource, /\.settings-dialog-backdrop \{/);
});

test("all four settings sections use the shared list-detail layout", () => {
  for (const [name, source] of configSources) {
    for (const primitive of ["ConfigPanelShell", "ConfigSplitView", "ConfigSidebar", "ConfigDetail", "ConfigFooter"]) {
      assert.match(source, new RegExp(`<${primitive}`), `${name} should use ${primitive}`);
    }
  }
});

test("all subpanel sidebars share one typography scale", () => {
  const sources = Object.fromEntries(configSources);
  // 列表行 = 画板 41/42/43 的 `.pw-litem`：名称 `.pw-lname`、副标题 `.pw-lsub`，
  // 两者都是 board.css 的类，产品不再各写一份字号。
  assert.match(templateSource, /export function ConfigSidebarText[\s\S]*?"pw-lname"/);
  assert.match(templateSource, /export function ConfigSidebarSub[\s\S]*?"pw-lsub"/);
  assert.match(boardSource, /\.pw-litem \.pw-lname \{[\s\S]*?text-overflow: ellipsis/);
  assert.match(boardSource, /\.pw-litem \.pw-lsub \{[\s\S]*?color: var\(--n-placeholder\)/);
  for (const source of Object.values(sources)) {
    assert.match(source, /<ConfigSidebarText/);
  }
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigSidebarGroupLabel/);
  }
  assert.match(templateSource, /export function ConfigSidebarGroupLabel[\s\S]*?"pw-group-title"/);
});

test("skills and sub-agents share interactive sidebar rows", () => {
  const sources = Object.fromEntries(configSources);
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigSidebarItem/);
  }
  // 选中态 = 画板的 `.is-on`（强调淡底 + 强调色文字），不再是自绘的 active 类。
  assert.match(templateSource, /export function ConfigSidebarItem[\s\S]*?className=\{\["pw-litem", active \? "is-on" : ""/);
  assert.match(templateSource, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(boardSource, /\.pw-litem:hover \{[\s\S]*?background: var\(--overlay-hover\)/);
  assert.match(boardSource, /\.pw-litem\.is-on \{[\s\S]*?background: var\(--accent-soft\)/);
  assert.doesNotMatch(templateSource, /setHovered|setFocusVisible|useState/);
  assert.doesNotMatch(sources.SkillsConfig, /onMouseEnter[\s\S]*?var\(--bg-hover\)/);
});

test("all shared config sidebar items use the board list row", () => {
  // 行高 / 内距的唯一来源是 board.css 的 `.pw-litem`（7px × s2），产品不再钉 30px。
  assert.match(boardSource, /\.pw-litem \{[\s\S]*?padding: 7px var\(--s2\)/);
  assert.match(templateSource, /export function ConfigListAction[\s\S]*?"pw-litem", "pw-litem-add"/);
  assert.match(boardSource, /\.pw-litem-add \{[\s\S]*?color: var\(--n-muted\)/);
});

test("plugin sidebar rows omit detail metadata", () => {
  const pluginSource = Object.fromEntries(configSources).PluginsConfig;
  const sidebarSource = pluginSource.match(/<ConfigSidebarList>[\s\S]*?<\/ConfigSidebarList>/)?.[0] ?? "";
  assert.match(sidebarSource, /<ConfigSidebarItem/);
  assert.match(sidebarSource, /<ConfigSidebarText[\s\S]*?\{pkg\.source\}/);
  assert.doesNotMatch(sidebarSource, /resourceSummary\(pkg|versionSummary\(pkg/);
});

test("skill scope group labels are localized", () => {
  const skillsSource = Object.fromEntries(configSources).SkillsConfig;
  for (const scope of ["global", "project", "path"]) {
    assert.match(skillsSource, new RegExp(`t\\("skills\\.scope\\.${scope}"\\)`));
    assert.match(enSource, new RegExp(`"skills\\.scope\\.${scope}":`));
    assert.match(zhSource, new RegExp(`"skills\\.scope\\.${scope}":`));
  }
  assert.match(zhSource, /"skills\.scope\.global": "全局"/);
  assert.match(zhSource, /"skills\.scope\.project": "项目"/);
});

test("all subpanel detail panes share one content hierarchy", () => {
  const sources = Object.fromEntries(configSources);
  // 详情列 = 画板 41 的 `style="display:grid;gap:var(--s3)"` 容器；
  // 卡 = `.pw-detail`，字段行 = `.pw-field > .pw-label`，空态 = `.pw-empty`。
  assert.match(templateSource, /export function ConfigDetailStack[\s\S]*?style=\{\{ display: "grid", gap: "var\(--s3\)"/);
  assert.match(templateSource, /export function ConfigField[\s\S]*?className="pw-field"[\s\S]*?<span className="pw-label">/);
  assert.match(templateSource, /export function ConfigEmptyState[\s\S]*?"pw-empty"[\s\S]*?"pw-empty-inner"/);
  assert.match(templateSource, /export function ConfigSectionTitle[\s\S]*?"pw-sec-title"/);
  assert.match(boardSource, /\.pw-field \{[\s\S]*?justify-content: space-between/);
  assert.match(boardSource, /\.pw-empty \{[\s\S]*?place-items: center/);
  for (const source of Object.values(sources)) {
    assert.match(source, /<ConfigDetailStack/);
    assert.match(source, /<ConfigEmptyState/);
  }
});

test("detail header actions keep buttons and switches aligned to the right", () => {
  const sources = Object.fromEntries(configSources);
  // 详情头一行 = 画板 41/42/43 的 `.pw-inline`；左信息块带 `.pw-grow` 把动作推到右端。
  assert.match(templateSource, /export function ConfigDetailHeader[\s\S]*?"pw-inline", className/);
  assert.match(templateSource, /export function ConfigDetailHeaderInfo[\s\S]*?"pw-inline", "pw-grow"/);
  assert.match(templateSource, /export function ConfigDetailActions[\s\S]*?"pw-inline", className/);
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigDetailActions>/);
  }
  assert.match(sources.PluginsConfig, /<ConfigDetailActions>[\s\S]*?<ConfigSwitch[\s\S]*?<\/ConfigDetailActions>/);
});

test("keeps shared static presentation in the design system stylesheet", () => {
  assert.doesNotMatch(templateSource, /<style>/);
  assert.doesNotMatch(templateSource, /onMouseEnter|onMouseLeave/);
  // fork:design-system SW-08~14 —— 视觉只来自 board.css：模板里**不再有产品自创的
  // config-* 静态类**，每个共享基件直接挂画板类（`.pw-cols`/`.pw-list`/`.pw-litem`/
  // `.pw-detail`/`.pw-field`/`.pw-btn`/`.pw-switch`），只有画板 DOM 本身那行
  // `display:grid;gap:var(--s3)` 保留为 inline（它就是画板的一部分）。
  for (const className of [
    "pw-cols",
    "pw-list",
    "pw-litem",
    "pw-detail",
    "pw-field",
    "pw-btn",
    "pw-switch",
    "pw-sec-title",
    "pw-kv",
    "pw-empty",
  ]) {
    assert.match(templateSource, new RegExp(className), `SettingsUi should render ${className}`);
    assert.match(boardSource, new RegExp(`\\.${className}\\b`), `board.css should define .${className}`);
  }
  for (const retired of [
    "config-split-view",
    "config-sidebar-item",
    "config-detail-stack",
    "config-button",
    "config-switch",
  ]) {
    assert.doesNotMatch(templateSource, new RegExp(retired), `${retired} should be retired from the template`);
  }
  // 模板里只剩两行 inline，且两行都是画板 DOM 本身的一部分：
  // 右列容器 `display:grid;gap:var(--s3)`，以及详情卡的 `<h3 style="margin:0">`。
  assert.equal(
    (templateSource.match(/style=\{\{/g) ?? []).length,
    2,
    "SettingsUi should keep only the two artboard-inline styles",
  );
});

test("embedded sections do not repeat Settings close actions", () => {
  const sources = Object.fromEntries(configSources);
  assert.match(sources.ModelsConfig, /!embedded && <ConfigButton onClick=\{onClose\}>\{t\("i18n\.cancel"\)\}/);
  assert.match(sources.SkillsConfig, /!embedded && <ConfigButton onClick=\{onClose\}>\{t\("i18n\.close"\)\}/);
  assert.match(sources.PluginsConfig, /!embedded && <ConfigButton onClick=\{onClose\}>\{t\("i18n\.close"\)\}/);
});

test("subpanel footers share sizing while maintenance actions stay secondary", () => {
  const sources = Object.fromEntries(configSources);
  // 底栏 = 画板的 `.pw-modal-foot`（左状态等宽弱化 + 右动作组），字号与内距来自 board.css。
  assert.match(templateSource, /export function ConfigFooter[\s\S]*?className="pw-modal-foot"/);
  assert.match(boardSource, /\.pw-modal-foot \{[\s\S]*?display: flex[\s\S]*?justify-content: space-between/);
  for (const source of Object.values(sources)) {
    assert.match(source, /<ConfigFooter/);
  }
  assert.match(sources.ModelsConfig, /<ConfigButton\s+variant="primary"[\s\S]*?onClick=\{handleSave\}/);
  assert.match(sources.AgentsConfig, /<ConfigButton\s+variant="primary"[\s\S]*?onClick=\{\(\) => void save\(\)\}/);
  assert.match(sources.SkillsConfig, /<ConfigButton variant="secondary" onClick=\{\(\) => void checkForUpdates\(\)\}/);
  assert.match(sources.PluginsConfig, /<ConfigButton variant="secondary" onClick=\{\(\) => void loadPlugins\(\)\}/);
});

test("skills, agents, and plugins share enabled and disabled controls", () => {
  const sources = Object.fromEntries(configSources);
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigSwitch/);
    assert.match(sources[name], /<ConfigStatusDot/);
  }
});

// fork:design-system SW-14 —— 五个「列表 + 详情」分节的详情里不再有产品自创的
// `config-*` 类：作用域走 `.pw-badge`、路径走 `.pw-mono`、提示走 `.pw-alert`、
// 属性表走 `.pw-kv`、图标走 `<i data-ico>`。这条测试守住这个结论。
test("list-detail sections carry no self-invented config classes", () => {
  const sources = Object.fromEntries(configSources);
  for (const [name, source] of Object.entries(sources)) {
    for (const retired of [
      "config-scope-tag",
      "config-detail-path",
      "config-sidebar-message",
      "config-trust-notice",
    ]) {
      assert.doesNotMatch(source, new RegExp(retired), `${name} should not use .${retired}`);
    }
  }
  // 成功态不再手绘 SVG：AgentsConfig 的保存按钮挂画板图标（ModelsConfig 的同一处
  // 由并行改写 ModelsConfig 的那一刀收尾，见交付报告第 4 节）。
  assert.match(sources.AgentsConfig, /savedOk && \(\s*<span className="pw-ico"><i data-ico="check" data-size="13"><\/i><\/span>/);
  // 提示条是画板 42/43 的 `.pw-alert info` 一行。
  assert.match(sources.SkillsConfig, /className="pw-alert info"[\s\S]*?trust\.skillsNotLoaded/);
  assert.match(sources.PluginsConfig, /className="pw-alert info"[\s\S]*?trust\.pluginsNotLoaded/);
  // 插件 / MCP 详情的属性表是画板的 `.pw-kv`。
  assert.match(sources.PluginsConfig, /<ConfigKv>[\s\S]*?i18n\.package/);
  assert.match(sources.PluginsConfig, /<ConfigKv>[\s\S]*?mcp\.fieldArgs/);
});

test("provider usage summary renders the artboard stat cards", async () => {
  const usageSource = await readFile(new URL("./ProviderUsageSummary.tsx", import.meta.url), "utf8");
  assert.match(usageSource, /<ConfigStatGrid>/);
  assert.match(usageSource, /<ConfigStat\s+key=\{bucket\.id\}/);
  assert.match(usageSource, /<ConfigStat\s+key=\{metric\.id\}/);
  assert.match(usageSource, /className="pw-alert"/);
  // 刷新动作是画板按钮 + 画板图标，旋转用 board.css 的持续动画类。
  assert.match(usageSource, /data-ico="refresh-cw"/);
  assert.match(usageSource, /pw-anim-spin/);
  assert.doesNotMatch(usageSource, /<svg/);
  assert.doesNotMatch(usageSource, /style=\{\{/);
});
