import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const pwaSettingsCssSource = await readFile(new URL("../app/pwa-settings.css", import.meta.url), "utf8");
const pwaSystemCssSource = await readFile(new URL("../design/v5/pwa/system.css", import.meta.url), "utf8");
const globalCssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const navSource = await readFile(new URL("../lib/settings-navigation.ts", import.meta.url), "utf8");
const sidebarSource = await readFile(new URL("./SessionSidebar.tsx", import.meta.url), "utf8");
const themeSource = await readFile(new URL("../hooks/useTheme.ts", import.meta.url), "utf8");
const themeOptionsSource = await readFile(new URL("../lib/theme.ts", import.meta.url), "utf8");
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");

test("opens one settings panel from the AppShell sidebar footer", () => {
  assert.match(shellSource, /<SettingsPanel/);
  // fork:ui-03b — 底栏收敛成一个齿轮按钮：模型/技能等分区都在面板里，
  // 原来的三个图标行（models / skills / settings）已删除。
  assert.match(shellSource, /onClick=\{\(\) => setSettingsSection\(getLastSettingsSection\(projectTrustCwd\)\)\}/);
  assert.match(shellSource, /initialSection=\{settingsSection\}/);
  assert.doesNotMatch(shellSource, /onClick=\{\(\) => setSettingsSection\(section\)\}/);
  assert.doesNotMatch(shellSource, /<SettingsSectionIcon/);
  assert.doesNotMatch(sidebarSource, /section="settings"/);
  assert.doesNotMatch(sidebarSource, /onOpenSettings/);
  assert.doesNotMatch(sidebarSource, /section="(?:models|skills|plugins)"/);
  assert.doesNotMatch(shellSource, /\["plugins", translate\("common\.plugins"\)\]/);
  assert.doesNotMatch(shellSource, /setModelsConfigOpen|setSkillsConfigOpen|setAgentsConfigOpen|setPluginsConfigOpen/);
});

test("keeps every requested configuration surface inside the settings panel", () => {
  // fork:command-palette —— 分节清单搬到了 `lib/settings-navigation.ts`（`SETTINGS_SECTIONS`，
  // 带 labelKey）以便命令面板复用同一份，所以断言也跟着换地方。
  for (const section of ["general", "models", "skills", "agents", "plugins"]) {
    assert.match(navSource, new RegExp(`id: "${section}"`));
  }
  // 面板确实读的是那一份，而不是又抄了一份。
  assert.match(panelSource, /SETTINGS_SECTIONS\.map\(/);
  for (const component of ["ModelsConfig", "SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(panelSource, new RegExp(`<${component} embedded`));
  }
});

test("restores the settings section and each list detail selection", async () => {
  assert.match(shellSource, /initialSection=\{settingsSection\}/);
  assert.match(panelSource, /setLastSettingsSection\(initialSection\)/);
  assert.match(panelSource, /setLastSettingsSection\(nextSection\)/);
  for (const name of ["ModelsConfig", "SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(
      await readFile(new URL(`./${name}.tsx`, import.meta.url), "utf8"),
      /getLastSettingsSelection/,
    );
  }
});

test("keeps visited settings sections mounted and contains nested Escape handling", async () => {
  const modelsSource = await readFile(new URL("./ModelsConfig.tsx", import.meta.url), "utf8");
  assert.match(panelSource, /mountedSections\.has\(id\)/);
  // fork:v5-landing Wave B（M-05）—— 桌面上「当前分节」永远是 `section`；手机上多一层
  // hub，所以可见分节由 `activeSection` 决定（hub 上时它是 null，全部 hidden）。
  assert.match(panelSource, /hidden=\{activeSection !== id\}/);
  assert.match(panelSource, /const activeSection: SettingsSection \| null = isMobile \? phoneSection : section;/);
  assert.match(panelSource, /event\.defaultPrevented/);
  assert.match(modelsSource, /e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*onClose\(\);/);
});

test("offers light / dark / system theme selection as board radio chips", () => {
  // fork:design-system SW-07 —— 主题改用画板 40 的 `.pw-radio` 芯片组（`PwRadio`
  // 内部是 `role="radio"` 的真按钮）。三档仍是 light / dark / auto。
  for (const preference of ["light", "dark", "auto"]) {
    assert.match(themeOptionsSource, new RegExp(`id: "${preference}"`));
  }
  assert.match(panelSource, /THEME_OPTIONS\.map/);
  assert.match(panelSource, /<PwRadio/);
  assert.match(panelSource, /onChange=\{setThemePreference\}/);
  assert.match(themeSource, /const setThemePreference = useCallback/);
  // 芯片图标走画板图标集（sun / moon / monitor），不再有手绘 SVG。
  for (const icon of ["sun", "moon", "monitor"]) {
    assert.match(panelSource, new RegExp(`"${icon}"`));
  }
});

test("keeps language selection in General settings", () => {
  // fork:design-system SW-07 —— 语言也换成画板的 `.pw-radio` 芯片组，
  // 选项仍来自 `supportedLocales` 插件表。
  assert.match(panelSource, /t\("common\.language"\)/);
  assert.match(panelSource, /supportedLocales\.map/);
  assert.match(panelSource, /onChange=\{\(next\) => setLocale\(next\)\}/);
});

test("groups chat display controls in one board block", () => {
  // fork:design-system SW-07 —— 画板 40 把「聊天」画成一个 `.pw-block`，行是
  // `.pw-field`（标签在左、控件在右，见 SettingsUi 的 PwField）。这里钉住 chat
  // 块里仍是**同一张卡**里的若干行，而不是各画各的背景。
  // fork:settings-frame 2026-10-01 —— 62 帧 C 把通知 / 壁纸排到了聊天块之后，
  // 切片终点从「Shell 块开头」改为聊天块自己的闭合标签（块内没有嵌套 PwBlock），
  // 不再受块顺序调整影响。
  const chatStart = panelSource.indexOf('<PwBlock icon="message-square"');
  const chatSection = panelSource.slice(chatStart, panelSource.indexOf("</PwBlock>", chatStart));

  assert.match(chatSection, /<PwBlock icon="message-square"/);
  // 行数：思考块 1 + 界面密度 1 + 步骤展开 1 + 宽度 / 字号 / 扩展字号 3 + 选中文字 1
  // = 7 行；自动命名那两行在 TitleSettingsControls 里（同一个块，同一套行规格）。
  assert.equal((chatSection.match(/<PwField/g) ?? []).length, 7);
  assert.match(panelSource, /<TitleSettingsControls cwd=\{cwd\} \/>/);
  // 开关 3 个：思考块默认展开、选中文字操作条，以及自动命名（在 TitleSettingsControls 里）。
  assert.equal((chatSection.match(/<PwSwitch/g) ?? []).length, 2);
  for (const key of ["thinkingExpandedDefault", "chatContentWidth", "chatContentFontSize", "extensionWidgetFontSize", "quoteSelection"]) {
    assert.match(chatSection, new RegExp(`t\\("settings\\.${key}"\\)`));
  }
  // 三个类别芯片的文案走 map 的 key 数组，不是直接写 t("...")；画板里这组是
  // `.pw-radio`，产品是三个**独立**开关，所以用 `aria-pressed` 而不是 role=radio。
  for (const key of ["stepExpandReasoning", "stepExpandCommand", "stepExpandTool"]) {
    assert.match(chatSection, new RegExp(`"settings\\.${key}"`));
  }
  assert.match(chatSection, /aria-pressed=\{on\}/);
  assert.match(chatSection, /setStepCategoryExpanded\(category, !on\)/);

  assert.doesNotMatch(panelSource, /ThinkingIcon|settings-thinking-/);
  // chat 块的所有行共用画板的 `.pw-field` 规格（board.css），产品不再自带行样式。
  // 不带作用域的裸 `.pw-field {` 一律不许有。
  const fieldStyles = cssSource.match(/^\.pw-field \{[\s\S]*?\}/m)?.[0] ?? "";
  assert.equal(fieldStyles, "");
  // fork:settings-field-density 2026-10-01 重修为画板 62 帧 C 语义：整族接线覆盖拆除 ——
  // 标签不再有 132px/104px 的不可压缩下限（board.css 的 flex 默认就能收缩、文字照常
  // 换行），控件槽 `.pw-ctl` 回到画板的 `flex: none`，字段行不再 flex-wrap；整行控件
  // 照 62 帧 B 放 `.pw-detail` 直下，不进字段行。
  assert.doesNotMatch(cssSource, /\.settings-dialog-main \.pw-field/);
  assert.doesNotMatch(cssSource, /min-width: 132px|min-width: 104px/);
});

test("keeps General free of divider rows", () => {
  // fork:design-system SW-07 —— 设置是**整屏**（画板 40/45 的 `.pw-settings` 就是整个
  // 窗口）：桌面没有页头（画板没画）；窄屏才恢复页头（那一列被隐藏，分节下拉与关闭都在
  // 页头上）。
  assert.match(panelSource, /className="settings-dialog-header d-modal-head"/);
  // 2026-10-03 用户裁定 —— 左导航底部那枚「返回工作区」撤了，关闭口只剩弹窗右上角的
  // 那一枚 X（宽屏也可见）。`.pw-snav-close` 是画板 62 的那一行，产品不再渲染。
  assert.match(panelSource, /className="config-close-button settings-dialog-close d-iconbtn"/);
  assert.doesNotMatch(panelSource, /className="pw-row pw-snav-close"/);
  assert.doesNotMatch(panelSource, /t\("settings\.backToWorkspace"\)/);
  assert.match(cssSource, /\.settings-dialog-header\.pw-modal-head \{[\s\S]*?display: none/);
  const narrowHead = cssSource.match(/@media \(max-width: 640px\)[\s\S]*?\.settings-dialog-header\.pw-modal-head \{[\s\S]*?\}/)?.[0] ?? "";
  assert.match(narrowHead, /display: flex/);
  assert.match(cssSource, /\.settings-dialog-surface\.pw-modal \{[\s\S]*?width: 100%[\s\S]*?height: 100%/);
  assert.doesNotMatch(panelSource, /sections\.find\(\(item\) => item\.id === section\)/);
  assert.doesNotMatch(panelSource, /<section style=\{\{[^}]*borderBottom/);
  assert.doesNotMatch(panelSource, /borderLeft: index > 0/);
});

test("uses a left section column on desktop and one compact picker on mobile", () => {
  assert.match(panelSource, /className="settings-mobile-section-picker"/);
  // fork:design-system SW-07 —— 左导航 = 画板 D-07 的 `.d-set-nav` + `.d-set-navitem`
  // （图标 + 文案），选中态是 `.is-on`。旧的 pw-snav / pw-row / pw-name 已随换皮移除。
  assert.match(panelSource, /className="settings-section-tabs d-set-nav"/);
  assert.match(panelSource, /className=\{`d-set-navitem\$\{selected \? " is-on" : ""\}`\}/);
  assert.match(panelSource, /<SettingsSectionIcon section=\{item\.id\} size=\{14\} \/>/);
  assert.doesNotMatch(panelSource, /settings-section-tab(?!s)/);
  // fork:ui-08 — a vertical column (upstream 0.14.6 layout) instead of a row of
  // fixed 96px cells. 宽度 / 内边距 / 底色现在只有一个来源：board.css 的 `.pw-snav`。
  // fork:v5-landing 逐帧核对（M-05 帧 D / 弹窗宿主）—— 窄屏那一支的内容壳是
  // `.settings-dialog-body.d-set`（画板 M-05 帧 D 的底部面板内容列），桌面仍是
  // `.d-modal-body.settings-dialog-body`。断言跟着新结构走，约束不变：
  // 「窄屏发 `d-set`、桌面发 `d-modal-body`」。
  // D-07 / D-07b 板面原文是**两级**：`.d-modal-body` › `.d-set`（`d-set-nav` +
  // `d-set-main`）；窄屏（M-05）保持合并写法 `settings-dialog-body.d-set`。所以这两支
  // 各有自己的 className 字面量，约束从「一个三元表达式」改成「窄屏发 d-set、
  // 桌面发 d-modal-body 且里面套一层 d-set」，内容列两端共用同一份 `sectionChildren`。
  assert.match(panelSource, /className="settings-dialog-body d-set"/);
  assert.match(panelSource, /className="d-modal-body settings-dialog-body"/);
  assert.match(panelSource, /<div className="d-set">/);
  assert.match(panelSource, /const sectionChildren = \(<>/);
  assert.match(cssSource, /\.settings-section-tabs \{[\s\S]*?flex-shrink: 0/);
  assert.doesNotMatch(cssSource, /\.settings-section-tabs \{[\s\S]{0,400}?width: 184px/);
  // 焦点环仍由 globals.css 的皮肤覆盖层统一提供；导航行只内缩 offset，
  // 不清 outline（200px 的列里 offset:2px 会越过分隔线画到内容页上）。
  const navFocusRule = cssSource.match(/\.settings-section-tabs \.pw-row:focus-visible \{[\s\S]*?\}/)?.[0] ?? "";
  assert.ok(navFocusRule, "the nav row focus rule should exist");
  assert.doesNotMatch(navFocusRule, /outline: none/);
  assert.match(navFocusRule, /outline-offset: -2px/);
  // fork:design-system —— 焦点环由 globals.css 的 `:where(button…):focus-visible`
  // 统一提供（1.5px 强调色 + 1px offset），画板 40 的导航行只内缩 offset。
  assert.match(globalCssSource, /:where\(button[\s\S]*?:focus-visible \{[\s\S]*?outline: 1\.5px solid var\(--accent\) !important/);
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?\.settings-section-tabs \{[\s\S]*?display: none/);
  assert.match(cssSource, /@media \(max-width: 640px\)[\s\S]*?\.settings-mobile-section-picker \{[\s\S]*?display: block/);
  assert.doesNotMatch(panelSource, /width: isMobile \? "100%" : 188/);
  // fork:v5-landing-frame —— `main.settings-dialog-main` 这一层已撤掉（它不在板面上，
  // 又与里层 `.d-set-main` 重复承担滚动与内距）；内容列就是 `.d-set` 的第二个子元素
  // `div.settings-section-host`。等价约束：不再有那层 `<main>`，内容列仍是宿主。
  assert.doesNotMatch(panelSource, /<main className="settings-dialog-main">/);
  assert.match(panelSource, /className=\{`settings-section-host\$\{isMobile \? "" : " d-set-main"\}/);
  assert.doesNotMatch(panelSource, /<style>/);
  assert.doesNotMatch(panelSource, /style=\{\{/);
});

test("labels agent profiles as sub-agents", () => {
  assert.match(enSource, /"common\.agents": "Sub-agents"/);
  assert.match(enSource, /"agents\.new": "New sub-agent"/);
  assert.match(zhSource, /"common\.agents": "子代理"/);
  assert.match(zhSource, /"agents\.new": "新建子代理"/);
});

test("uses the board 40 icon set for every settings section", () => {
  // fork:design-system SW-07 —— 分节图标一律走画板图标集（icons.js 的 lucide，
  // 经 <i data-ico> 水合）。13 段手绘 SVG 与 agents 的 scale(1.25) 补丁都已退役，
  // 名称与画板 40 的左导航逐项一致。（`shortcuts` 一节已按用户要求从设置里去掉，
  // 快捷键引擎本身（lib/shortcuts.ts + useKeyboardShortcuts）不受影响；`cron` / `memory` /
  // `prompts` 三节已整体下线，同样只剩历史画板。）
  const expected = {
    general: "sliders-horizontal",
    models: "cpu",
    skills: "box",
    agents: "bot",
    plugins: "blocks",
    mcp: "server",
    usage: "chart-column",
    archived: "archive",
    import: "import",
  };
  for (const [section, icon] of Object.entries(expected)) {
    assert.match(
      panelSource,
      new RegExp(`${section}: "${icon}"`),
      `section "${section}" should use the board icon "${icon}"`,
    );
  }
  assert.match(panelSource, /return <i data-ico=\{SECTION_ICON_BY_ID\[section\] \?\? "settings"\}/);
  assert.doesNotMatch(panelSource, /<svg \{\.\.\.common\}/);
  assert.doesNotMatch(cssSource, /settings-section-icon/);
  // 会话行里的子代理标记仍是画板 02 的 corner-down-right。
  assert.match(sidebarSource, /data-ico=\{collapsed \? "chevron-right" : "chevron-down"\}/);
  assert.match(sidebarSource, /data-ico="corner-down-right"/);
});

/**
 * fork:v5-landing Wave B（M-05）—— 手机端设置是**两层**：hub → 分节二级页。
 *
 * 三条硬要求（画板 M-05 帧 A / B / C + `lib/settings-navigation.ts`）：
 *   · hub 只列那**十一个**分节，按「什么时候来改它」分四组卡片；
 *   · 二级页左上角**永远**是返回箭头，不摆左导航；
 *   · 分节内容还是同一份（惰挂载 + `hidden` 切换），桌面那条路径一个字没改。
 */
test("窄屏设置是 hub → 分节二级页两层（M-05），且不摆左导航", async () => {
  // 1. 形态分流：`useIsMobile()` 决定发 `m-*` 还是 `d-*`。
  assert.match(panelSource, /const isMobile = useIsMobile\(\);/);
  // 2. 两层指针：null = hub。
  assert.match(panelSource, /const \[phoneSection, setPhoneSection\] = useState<SettingsSection \| null>\(null\);/);
  assert.match(panelSource, /const backToPhoneHub = \(\) => setPhoneSection\(null\);/);
  // 3. 渐隐顶栏 + 永远在左上角的返回箭头（M-05 帧 B）。
  assert.match(panelSource, /className="m-fade"/);
  assert.match(panelSource, /className="m-top"/);
  assert.match(panelSource, /data-ico="chevron-left"/);
  assert.match(panelSource, /onClick=\{backToPhoneHub\}/);
  // 4. hub 本体：hero + 四组 `.m-cardgroup`，每行一个分节（图标 / 标题 / 副行 / 徽章 / 箭头）。
  assert.match(panelSource, /data-settings-hub/);
  assert.match(panelSource, /className="m-hero"/);
  assert.match(panelSource, /className="m-cardgroup" key=\{group\.id\}/);
  assert.match(panelSource, /className="m-setrow-body"/);
  assert.match(panelSource, /className="m-badge mute"/);
  assert.match(panelSource, /data-ico="chevron-right"/);
  // 5. 分节流：窄屏宿主不带任何 `display` 类（`hidden` 才生效），内容外面套一层
  //    `.m-settings`（灰底白卡、108px 顶栏让位）；桌面是 `d-set-main` 宿主 + 裸内容。
  //    断言跟着新结构走：等价约束仍然是「窄屏有 `.m-settings`、桌面没有」。
  assert.match(panelSource, /className=\{`settings-section-host\$\{isMobile \? "" : " d-set-main"\}/);
  assert.match(panelSource, /\{isMobile \? <div className="m-settings">\{content\}<\/div> : content\}/);
  // 6. 窄屏不渲染左导航（CSS 侧的隐藏规则跟着换皮失效了，得由组件保证）。
  //    fork:settings-no-explainer 之后不能再拿「{isMobile ? null : (…)}」当探针 ——
  //    那个探针指的是弹窗脚那句说明（已按用户裁定删除）。改成直接钉结构：
  //    紧挨左导航的那个 `{isMobile ? (` 分支里只有 `{sectionChildren}`，
  //    `<nav … d-set-nav>` 必须落在它的 `) : (` 之后（= 桌面那一支）。
  const navAt = panelSource.indexOf('"settings-section-tabs d-set-nav"');
  const mobileStart = panelSource.lastIndexOf("{isMobile ? (", navAt);
  const mobileEnd = panelSource.indexOf(") : (", mobileStart);
  assert.ok(
    navAt > 0 && mobileStart > 0 && mobileEnd > mobileStart && mobileEnd < navAt,
    "找不到「窄屏那一支 → 桌面那一支」的结构",
  );
  assert.doesNotMatch(
    panelSource.slice(mobileStart, mobileEnd),
    /d-set-nav/,
    "窄屏那一支里不许渲染左导航",
  );
  assert.match(panelSource, /<nav aria-label=\{t\("settings\.title"\)\} className="settings-section-tabs d-set-nav">/);
  // 7. 分节清单没被改动：hub 的分组必须盖满同一份十四个分节，一个不多一个不少。
  const hubSource = await readFile(new URL("./pwa/settingsHub.ts", import.meta.url), "utf8");
  const groups = hubSource.slice(hubSource.indexOf("SETTINGS_HUB_GROUPS"), hubSource.indexOf("type HubCopy"));
  const groupIds = new Set([...groups.matchAll(/id: "([a-zA-Z]+)", sections/g)].map((m) => m[1]));
  const listed = [...groups.matchAll(/"([a-zA-Z]+)"/g)].map((m) => m[1]).filter((id) => !groupIds.has(id));
  const navIds = [...navSource.matchAll(/id: "([a-zA-Z]+)"/g)].map((m) => m[1]);
  assert.equal(listed.length, 14, "hub 必须正好列十四个分节");
  assert.deepEqual(
    [...listed].sort(),
    [...navIds].sort(),
    "hub 与 lib/settings-navigation.ts 必须是同一份分节清单",
  );
});

/**
 * fork:pwa-settings-height-chain（2026-10-05）—— 手机档（M-05）**能滑**，
 * 且工具栏不横向溢出。
 *
 * 故障（用户实测）：390×844 的「设置 › 技能」竖向滑不动、内容被裁掉九屏。
 * 根因是**高度链断在宿主那一层**：窄屏的 `div.settings-section-host` 刻意不带任何
 * 带 `display` 的类（`[hidden]` 的 UA 规则是作者层 `display` 的下位，挂了
 * `d-set-main` 就再也藏不住分节），于是它退化成普通块，内层 `.m-settings` 的
 * `flex: 1 1 auto; min-height: 0; overflow-y: auto` 全部落空 —— 高度 = 内容高
 * （实测 clientHeight === scrollHeight === 8702），`overflow-y: auto` 形同虚设。
 *
 * 等价约束（本轮锁的就是这几条，DOM 一个字没动）：
 *   ① 宿主**可见时**才变 flex 列（`:not([hidden])`），`hidden` 的分节仍 `display: none`；
 *   ② 中途两层为**桌面**分栏写的 `height: 100%` 在这条窄屏链上归零，
 *      否则它们会在 `.m-settings` 里面再养一个滚动容器（`.m-list`），
 *      高度到不了 `.m-settings`；
 *   ③ `.m-fieldrow` 允许换行（库级语义）—— 工具栏「搜索 + 分段 + 计数 + 全部更新」
 *      在 390px 上要 ~352px，不换行就被 `.config-panel-surface` 的 overflow 裁掉。
 */
test("窄屏设置是唯一滚动容器：宿主高度链 + 工具栏换行（手机实测修复）", () => {
  // ① 宿主 :not([hidden]) → flex 列。`:not([hidden])` 是这套修法的关键：
  //    去掉它就等于给宿主发 `display`，`hidden` 的分节会全部同时显形。
  assert.match(
    pwaSettingsCssSource,
    /\.settings-section-host:not\(\[hidden\]\) \{[^}]*display: flex;[^}]*flex-direction: column;[^}]*overflow: hidden;/,
  );
  // ② 中途两层的 height:100% 归零 —— 缺了它 `.m-list` 会抢走高度，
  //    `.m-settings` 仍然 clientHeight === scrollHeight。
  assert.match(
    pwaSettingsCssSource,
    /\.m-settings > \.config-panel-root\.is-embedded,\s*\.settings-dialog-surface \.m-settings \.config-panel-surface \{[^}]*height: auto;/,
  );
  // 详情列 720px 定宽在 390px 上放不下（作为 flex 项，min-width:auto 不肯缩）。
  assert.match(pwaSettingsCssSource, /\.m-settings \.d-set-inner \{[^}]*max-width: 100%;/);
  // ③ 库里的 `.m-fieldrow` 自带换行（放不下时换行，而不是顶出卡体右缘）。
  const fieldrow = pwaSystemCssSource.match(/\.m-fieldrow \{[^}]*\}/)?.[0] ?? "";
  assert.match(fieldrow, /flex-wrap: wrap/);
  // 全部关在 ≤640px 这一档里 —— ≥641px 一条都不命中，桌面像素逐字不变。
  const mediaOpen = pwaSettingsCssSource.indexOf("@media (max-width: 640px) {");
  assert.ok(mediaOpen > -1, "pwa-settings.css 必须有 @media (max-width: 640px) 档");
  for (const rule of [":not([hidden])", "config-panel-root.is-embedded", ".m-settings .d-set-inner"]) {
    const idx = pwaSettingsCssSource.indexOf(rule, mediaOpen);
    assert.ok(idx > -1, `窄屏档里必须有 ${rule}`);
    assert.equal(pwaSettingsCssSource.lastIndexOf("@media", idx), mediaOpen, `${rule} 必须落在 ≤640px 这一档里`);
  }
  // 回归：`.m-settings` 自己是唯一滚动容器（库定义，flex:1 1 auto + min-height:0 + overflow-y:auto）。
  const settingsRule = pwaSystemCssSource.match(/\.m-settings \{[^}]*\}/)?.[0] ?? "";
  assert.match(settingsRule, /flex: 1 1 auto/);
  assert.match(settingsRule, /min-height: 0/);
  assert.match(settingsRule, /overflow-y: auto/);
});

test("the product has no login surface at all", async () => {
  // fork:design-system（用户裁定 2026-09-28）—— 本产品没有登录：
  // `/login` 路由、`/api/web-auth`、`lib/web-auth`、`lib/auth-throttle` 全部删除，
  // 设置里也没有「退出登录」。见 design/pi-web-design/50-dialogs.html。
  await assert.rejects(readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(new URL("../app/api/web-auth/route.ts", import.meta.url), "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(new URL("../lib/web-auth.ts", import.meta.url), "utf8"), { code: "ENOENT" });
  assert.doesNotMatch(panelSource, /api\/web-auth|auth\.logOut|webAuthEnabled/);
  assert.doesNotMatch(globalCssSource, /\.web-login/);
});
