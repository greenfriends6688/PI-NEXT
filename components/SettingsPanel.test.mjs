import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelSource = await readFile(new URL("./SettingsPanel.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const globalCssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const shellSource = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
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
  for (const section of ["general", "models", "skills", "agents", "plugins"]) {
    assert.match(panelSource, new RegExp(`id: "${section}"`));
  }
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
  assert.match(panelSource, /hidden=\{section !== id\}/);
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
  // 窗口）：桌面没有页头（画板没画），关闭入口在左导航底部最后一行；窄屏才恢复页头
  // （那一列被隐藏，分节下拉与关闭都在页头上）。
  assert.match(panelSource, /className="settings-dialog-header pw-modal-head"/);
  assert.match(panelSource, /className="pw-row pw-snav-close"/);
  assert.match(panelSource, /<span className="pw-grow" aria-hidden="true" \/>/);
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
  // fork:design-system SW-07 —— 左导航 = 画板 40 的 `.pw-snav` + `.pw-row`/`.pw-name`，
  // 选中态是 `.is-on`。旧的 `settings-section-tab` 与它那套自绘下划线已退役。
  assert.match(panelSource, /className="settings-section-tabs pw-snav"/);
  assert.match(panelSource, /className=\{`pw-row\$\{selected \? " is-on" : ""\}`\}/);
  assert.match(panelSource, /className="pw-name"/);
  assert.doesNotMatch(panelSource, /settings-section-tab(?!s)/);
  // fork:ui-08 — a vertical column (upstream 0.14.6 layout) instead of a row of
  // fixed 96px cells. 宽度 / 内边距 / 底色现在只有一个来源：board.css 的 `.pw-snav`。
  assert.match(panelSource, /className="settings-dialog-body pw-settings"/);
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
  // fork:ui-14 — the content column carries the search-highlight ref now.
  // 搜索已移除：mainRef 只服务于搜索高亮，随之删掉，这里只断言容器本身。
  assert.match(panelSource, /<main className="settings-dialog-main">/);
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
