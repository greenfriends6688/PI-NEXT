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
    "SettingsPage",
    "PwSearch",
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
  // 两栏骨架 = 画板 62 的 `.pw-cols`（300px 列表 + 上限 760 的详情，gap s4）。
  assert.match(templateSource, /export function ConfigSplitView[\s\S]*?className="pw-cols"/);
  assert.match(templateSource, /export function ConfigSidebarList[\s\S]*?className="pw-list"/);
  assert.match(templateSource, /export function ConfigDetail[\s\S]*?className="pw-detail"/);
  assert.match(boardSource, /\.pw-cols \{[\s\S]*?grid-template-columns: 300px minmax\(0, 760px\)/);
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

test("all four settings sections use the shared page frame and list-detail layout", () => {
  for (const [name, source] of configSources) {
    for (const primitive of ["ConfigPanelShell", "SettingsPage", "ConfigSplitView", "ConfigSidebar", "ConfigDetail"]) {
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
  // fork:settings-frame（画板 62）—— 技能列表行照 62 帧 B 直接发 `.pw-litem` 的
  // pw-lname/pw-lsub（不经过 ConfigSidebarText 包装）；其余分节仍走共享基件。
  // 两种发射都归 board.css 的同一套 `.pw-litem` 字号，守卫改按「谁在发」断言。
  for (const source of Object.values(sources)) {
    assert.match(source, /<ConfigSidebarText|className=\{`pw-lname/);
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
  // fork:stack-rows（2026-10-01）—— `display` / 行高策略从组件内联搬进 board.css 了
  // （内联优先级高，会把 `.pw-detail-stack:has(> .pw-empty:only-child)` 那条变体顶掉：
  // 实测 `:has` 匹配成功、空态也拿到 `flex:1`，但父层 `display` 仍是 grid → 空态没居中）。
  // 所以这里断言的是**分工**：组件只挂类名 + gap，几何与行高策略由画板样式表给。
  assert.match(templateSource, /export function ConfigDetailStack[\s\S]*?style=\{\{ gap: "var\(--s3\)"/);
  // ce8eff84 把选择器从 `> .pw-detail-stack` 扩成 `> .pw-detail-stack, .pw-detail-stack`
  // （产品里有嵌套一层的详情卡，祖先选择器挂不到），所以断言接受**两者并列**的形状。
  assert.match(boardSource, /\.pw-detail > \.pw-detail-stack,\s*\.pw-detail \.pw-detail-stack \{[\s\S]*?display: grid;[\s\S]*?grid-auto-rows: min-content;[\s\S]*?align-content: start;/);
  assert.match(boardSource, /\.pw-detail \.pw-detail-stack:has\(> \.pw-empty:only-child\) \{[\s\S]*?display: flex;/);
  assert.match(boardSource, /\.pw-detail \.pw-detail-stack:has\(> \.pw-empty:only-child\) > \.pw-empty \{[\s\S]*?flex: 1;/);
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
  for (const name of ["AgentsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigDetailActions>/);
  }
  // fork:settings-frame（画板 62 帧 B）—— 技能详情头照帧直接用 `.pw-inline`
  // （pw-grow 把动作推到右端），不经过 ConfigDetailActions 基件。
  assert.match(sources.SkillsConfig, /className="pw-inline">[\s\S]{0,400}pw-grow/);
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

/**
 * fork:settings-frame（画板 62）—— **画板与实现必须是同一套 DOM**。
 *
 * 用户实测反馈：「设计的好，但真正落地的时候就有差距了，就不按照规划的进行设计了」。
 * 根因（已实测）：画板 62 的帧是**手写内联样式**画的（`pw-shead` 在画板里出现 **0 次**），
 * 而实现落地时新造了 `.pw-shead` / `.pw-stools` / `.pw-scontent` 三个类。
 * 两套 DOM 没有共同选择器 → `scripts/board-diff.mjs` 逐项报「画板里没有这个选择器」
 * → 只能靠人眼比 → 必然漂移。
 *
 * 这条测试把「共用同一套类」钉死，**不需要浏览器**，所以能进 check:design。
 */
test("画板与实现共用同一套设置页框架类（否则 live 对位失效）", async () => {
  // 1. 实现：`SettingsPage` 输出的类，board.css 必须有对应规则
  for (const cls of ["pw-shead", "pw-shead-copy", "pw-shead-acts", "pw-stools", "pw-scontent"]) {
    assert.match(templateSource, new RegExp(cls), `SettingsPage 应输出 .${cls}`);
    assert.match(boardSource, new RegExp(`\\.${cls}\\b`), `board.css 应定义 .${cls}`);
  }
  // 2. 画板：设置分节的页帧必须用三件套，不许再留「.pw-sbody 直接跟标题」的旧帧
  for (const name of [
    "40-settings-general",
    "41-settings-models",
    "42-settings-agents-skills",
    "43-settings-plugins-mcp",
    "44-settings-cron-memory",
    "45-settings-shortcuts-usage",
    "46-settings-prompts-archive-import",
    "62-settings-layout",
  ]) {
    const src = await readFile(
      new URL(`../design/pi-web-design/${name}.html`, import.meta.url),
      "utf8",
    );
    assert.match(src, /class="pw-shead"/, `${name} 的页帧应使用 .pw-shead`);
    assert.match(src, /class="pw-scontent/, `${name} 的页帧应使用 .pw-scontent`);
    assert.doesNotMatch(
      src,
      /class="pw-sbody"[^>]*>\s*<h2>/,
      `${name} 里还有旧帧（.pw-sbody 直接跟 h2）`,
    );
    assert.doesNotMatch(
      src,
      /class="pw-sbody"[^>]*>\s*<div class="pw-inline">/,
      `${name} 里还有旧帧（.pw-sbody 直接跟 pw-inline 标题行）`,
    );
  }
});

test("embedded sections do not repeat Settings close actions", () => {
  const sources = Object.fromEntries(configSources);
  for (const [name, source] of Object.entries(sources)) {
    // fork:settings-frame（画板 62）—— 关闭动作只属于设置面板的页头，
    // 嵌入的分节一个都不重复（原先靠页脚里 `!embedded &&` 兜着，页脚已删）。
    assert.doesNotMatch(source, /onClick=\{onClose\}/, `${name} should not repeat the close action`);
  }
});

test("动作按层级归位：页级在页头、表单级在表单底部，页脚不再放动作", () => {
  const sources = Object.fromEntries(configSources);
  // 画板 62 的 ①：页级动作挂在 SettingsPage 的 actions 槽。
  for (const [name, source] of Object.entries(sources)) {
    assert.match(source, /<SettingsPage/, `${name} should use the shared page frame`);
    assert.doesNotMatch(source, /<ConfigFooter/, `${name} should not render a page footer`);
  }
  // ④ 表单级：保存按钮留在它保存的那张卡里。
  assert.match(sources.ModelsConfig, /<ConfigButton\s+variant="primary"[\s\S]*?onClick=\{handleSave\}/);
  assert.match(sources.AgentsConfig, /<ConfigButton\s+variant="primary"[\s\S]*?onClick=\{\(\) => void save\(\)\}/);
  // ② 列表级：刷新 / 检查更新与计数同排（工具栏）。
  assert.match(sources.SkillsConfig, /onClick=\{\(\) => void checkForUpdates\(\)\}/);
  assert.match(sources.PluginsConfig, /onClick=\{\(\) => void loadPlugins\(\)\}/);
});

test("skills, agents, and plugins share enabled and disabled controls", () => {
  const sources = Object.fromEntries(configSources);
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigSwitch/);
  }
  // 状态点只属于子代理 / 插件的列表行（画板 42/43 的行 anatomy）；技能行尾是
  // 「可更新」warn 徽标或 pw-switch 快捷开关（62 帧 B），不再有状态点。
  for (const name of ["AgentsConfig", "PluginsConfig"]) {
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

/**
 * fork:settings-frame（画板 62）—— 两栏设置页的**两列各自滚动**。
 *
 * 症状（2026-09-30 用户实测）：模型页的「可用模型」列到面板底部被切断、
 * 底部的保存按钮像浮在列表上。根因：只有左列声明了 `overflow-y:auto`，
 * 右列按内容长高；外层 `overflow:hidden` 把多出来的部分直接裁掉。
 *
 * 现在的规格更硬一层：**分节内容区是唯一滚动容器**，列表页把滚动下放给两列。
 */
test("两栏设置页的左右列都是滚动容器（否则右列被裁、底部动作条压内容）", () => {
  assert.match(
    boardSource,
    /\.pw-scontent\.is-fixed > \.pw-cols > \* \{[\s\S]*?overflow-y: auto/,
  );
  // 装了三件套的分节宿主改成 flex column：页头与工具栏固定，内容区接管滚动。
  assert.match(
    cssSource,
    /\.settings-section-host\.pw-sbody:has\(\.pw-shead\) \{[\s\S]*?overflow: hidden/,
  );
});

/**
 * fix:block-rhythm —— 块内紧跟字段行的提示 / 横幅要有上边距。
 * 画板的 `.pw-block` 只有 `.pw-field`；产品补的状态行在 Tailwind preflight
 * 把 `<p>` 的 UA margin 归零后会紧贴上一行（用户实测「间距特别近」）。
 */
test("块内的提示与横幅不再贴着上一行", () => {
  assert.match(
    cssSource,
    /\.pw-block > \.pw-alert,\s*\n\.pw-block > \.pw-hint,[\s\S]*?margin-top: var\(--s2\)/,
  );
});
