import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templateSource = await readFile(new URL("./SettingsUi.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const globalCssSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
// fork:v5-landing Wave B —— 画板样式表的**唯一来源**现在是 v5 两套形态表：
// ≥641px 走 `design/v5/web/system.css`（`d-*`），≤640px 走
// `design/v5/pwa/system.css`（`m-*`，由 `app/design/v5-forms.css` 按媒体条件引入）。
// `design/pi-web-design/assets/board.css`（v1 的 `pw-*`）不再参与设置基件。
const boardSource = await readFile(new URL("../design/v5/web/system.css", import.meta.url), "utf8");
const pwaSource = await readFile(new URL("../design/v5/pwa/system.css", import.meta.url), "utf8");
// fork:v5-landing Wave B —— v1 画板样式表还在加载（没换完的组件靠它），
// 但设置基件已经不再用它；下面两条守卫只看产品样式表自己的规则是否还在。
const layoutSource = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const zhSource = await readFile(new URL("../lib/i18n/messages/zh-CN.ts", import.meta.url), "utf8");
const configSources = await Promise.all(
  ["ModelsConfig", "SkillsConfig", "AgentsConfig", "PluginsConfig"].map(async (name) => [
    name,
    await readFile(new URL(`./${name}.tsx`, import.meta.url), "utf8"),
  ]),
);

// fork:design-system SW-08~14 / fork:v5-landing Wave B —— 两栏结构：D-07 设置壳的
// `.d-set`（flex 两列）+ `.d-set-nav`（左列）+ `.d-card`（右列详情）；
// 窄屏（M-05）左列与右列各塔成一列。
// 下面断言的是**现在**的结构（SettingsUi 的共享基件 → v5 `d-*` / `m-*` 类），
// 旧的 `config-sidebar*` / `config-detail*` 自绘类名与 v1 的 `pw-*` 都已退役。
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
  // 两栏骨架 = D-07 的 `.d-set`（两列各自滚）+ `.d-set-nav`（左列）+ `.d-card`（右列）。
  assert.match(templateSource, /export function ConfigSplitView[\s\S]*?"d-set"/);
  assert.match(templateSource, /export function ConfigSidebar\b[\s\S]*?"d-set-nav"/);
  assert.match(templateSource, /export function ConfigDetail\b[\s\S]*?"d-card"/);
  assert.match(boardSource, /\.d-set-nav \{[\s\S]*?width: 220px/);
  assert.match(boardSource, /\.d-card \{[\s\S]*?border: 1px solid var\(--nx-line\)/);
  // 列宽 / 卡内距的唯一来源是 v5 system.css；模板直接输出 `d-*` / `m-*`，
  // 不再输出 settings.css 里那套 240px / 20px 抄写对应的自绘类。
  assert.doesNotMatch(templateSource, /"config-sidebar"|"config-detail"/);
  // fork:v5-landing Wave B —— v1 画板（`board.css`）的 `pw-*` 基件已在本文件清零。
  assert.doesNotMatch(templateSource, /className="pw-|\["pw-/);
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

test("all four settings sections use the shared page frame", () => {
  // fork:v5-landing · D-08 / D-12 —— **左栏不再是必需的**：已落地的两节（模型 / 子代理）
  // 按画板发一列 `.d-set-inner`，左导航就是设置壳那一列 `.d-set-nav`。
  for (const [name, source] of configSources) {
    for (const primitive of ["ConfigPanelShell", "SettingsPage"]) {
      assert.match(source, new RegExp(`<${primitive}`), `${name} should use ${primitive}`);
    }
    // fork:v5-landing —— **详情列有两种合法形状**（均为已登记的板面对应）：
    //   · 共享分列基件 `ConfigSplitView`；
    //   · 画板 D-08 的直接 `.d-set-inner`（模型页用它：布局与板面逐行一致，
    //     再套一层 ConfigSplitView 反而多一层与板面无关的壳）。
    //   任一即可，但必须是这两种之一 —— 不许两套都不发。
    assert.match(
      source,
      /<ConfigSplitView|className="d-set-inner"/,
      `${name} should use ConfigSplitView or the D-08 detail column`,
    );
  }
});

test("all subpanel sidebars share one typography scale", () => {
  const sources = Object.fromEntries(configSources);
  // 列表行 = D-07 的 `.d-trow`：名称行 `.d-t-sm .d-t-b`、副行 `.d-t-xs .d-t-faint`；
  // 窄屏是 M-05 的 `.m-trow` + `.m-setrow-t` / `.m-setrow-s`。两端各一套类名。
  assert.match(templateSource, /export function ConfigSidebarText[\s\S]*?"d-t-sm d-t-b"/);
  assert.match(templateSource, /export function ConfigSidebarSub[\s\S]*?"d-t-xs d-t-faint"/);
  assert.match(boardSource, /\.d-trow \{[\s\S]*?text-overflow: ellipsis|\.d-trow \{/);
  assert.match(boardSource, /\.d-t-faint \{ color: var\(--nx-text-3\)/);
  assert.match(pwaSource, /\.m-trow \{[\s\S]*?min-height: var\(--nx-ctl-md\)/);
  assert.match(pwaSource, /\.m-setrow-s \{[\s\S]*?color: var\(--nx-text-3\)/);
  // fork:settings-frame —— 技能列表行直接发列表行类（不经过 ConfigSidebarText 包装）；
  // 其余分节走共享基件。两种发射都归同一套类，守卫按「谁在发」断言。
  // fork:v5-landing · D-12 —— 子代理分节是**例外**：profile 走 `.d-card > .d-table`，
  // 这一列没有列表行了（画板 D-12 的十一张分节里没有一处 `.d-sess`）。
  for (const name of ["SkillsConfig", "PluginsConfig", "ModelsConfig"]) {
    assert.match(sources[name], /<ConfigSidebarText|className=\{`d-sess-t|d-sess-t/);
  }
  assert.match(sources.AgentsConfig, /<table className="d-table">/);
  for (const name of ["SkillsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigSidebarGroupLabel|d-group-title/);
  }
  assert.match(templateSource, /export function ConfigSidebarGroupLabel[\s\S]*?"d-group-title"/);
});

test("skills and plugins share interactive sidebar rows", () => {
  const sources = Object.fromEntries(configSources);
  for (const name of ["SkillsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigSidebarItem|d-sess/);
  }
  // 选中态 = 画板的 `.is-on`（强调淡底 + 强调色文字），不再是自绘的 active 类。
  assert.match(templateSource, /export function ConfigSidebarItem[\s\S]*?isMobile \? "m-trow" : "d-trow"/);
  assert.match(templateSource, /export function ConfigSidebarItem[\s\S]*?active \? "is-on" : ""/);
  assert.match(templateSource, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(boardSource, /\.d-trow\.is-on \{/);
  assert.match(pwaSource, /\.m-trow\.is-on \{/);
  assert.doesNotMatch(templateSource, /setHovered|setFocusVisible|useState/);
  assert.doesNotMatch(sources.SkillsConfig, /onMouseEnter[\s\S]*?var\(--bg-hover\)/);
});

test("all shared config sidebar items use the board list row", () => {
  // 行高 / 内距的唯一来源是画板行类（`d-trow` 桌面 / `m-trow` 窄屏），产品不钉 30px。
  assert.match(boardSource, /\.d-trow \{/);
  assert.match(pwaSource, /\.m-trow \{/);
  assert.match(templateSource, /export function ConfigListAction[\s\S]*?isMobile \? "m-trow" : "d-trow"/);
  assert.match(templateSource, /export function ConfigListAction[\s\S]*?data-ico="plus"/);
});

test("plugin sidebar rows omit detail metadata", () => {
  const pluginSource = Object.fromEntries(configSources).PluginsConfig;
  const sidebarSource = pluginSource.match(/<ConfigSidebarList>[\s\S]*?<\/ConfigSidebarList>/)?.[0] ?? "";
  // fork:v5-landing —— 包列表已迁到画板 D-13 的 `.d-sess`（MCP 服务器列表仍走 ConfigSidebarItem）。
  assert.match(sidebarSource, /<ConfigSidebarItem|className=\{`d-sess/);
  assert.match(sidebarSource, /d-sess-t[\s\S]{0,160}\{pkg\.source\}|<ConfigSidebarText[\s\S]{0,160}\{pkg\.source\}/);
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
  // 详情列 = D-07 的 `.d-card`；内容栈 = `.d-col`；字段行 = `.d-field > .d-field-t`；
  // 空态 = `.d-empty`（窄屏 M-05：`.m-cardgroup` / `.m-setrow` / `.m-empty`）。
  // fork:v5-landing Wave B —— 上一版那条 inline `gap: var(--s3)` 已撤：间距是**角色值**，
  // 归 `system.css` 独占（铁律三 / 四），空态居中改由 `.d-empty` 自己负责。
  assert.match(templateSource, /export function ConfigDetailStack[\s\S]*?className=\{\["d-col", className\]/);
  // ConfigDetailStack 自己那一层不写任何 inline（取一段以 `/>` 收尾的窗口，
  // 不用 `[\s\S]*?` 扫到下一个函数去 —— 下一个函数里本来就有合法的 inline）。
  const stackBody = templateSource.match(/export function ConfigDetailStack[\s\S]*?\/>;\n}/)?.[0] ?? "";
  assert.ok(stackBody, "ConfigDetailStack body should be readable");
  assert.doesNotMatch(stackBody, /style=/);
  assert.match(templateSource, /export function ConfigField[\s\S]*?className="d-field"[\s\S]*?<span className="d-field-t">/);
  assert.match(templateSource, /export function ConfigField[\s\S]*?className="m-setrow"[\s\S]*?className="m-setrow-body"/);
  assert.match(templateSource, /export function ConfigEmptyState[\s\S]*?"m-empty"[\s\S]*?"d-empty"/);
  assert.match(templateSource, /export function ConfigSectionTitle[\s\S]*?"d-set-sec-t"/);
  assert.match(boardSource, /\.d-field \{/);
  assert.match(boardSource, /\.d-empty \{[\s\S]*?justify-content: center/);
  assert.match(pwaSource, /\.m-empty \{[\s\S]*?justify-content: center/);
  for (const source of Object.values(sources)) {
    assert.match(source, /<ConfigDetailStack|className="d-set-inner"/);
    // 空态基件：共享 `ConfigEmptyState`，或已换皮为 v5 `.d-empty`；
    // fork:agents-detail-modal（2026-10-07 用户裁定）—— 子代理的细节改走弹窗，
    // 页面上不再留详情空态，所以 `.d-modal` 也算一种合法的「未选时没东西可显示」。
    assert.match(source, /<ConfigEmptyState|className="d-empty|className="d-modal/);
  }
});

test("detail header actions keep buttons and switches aligned to the right", () => {
  const sources = Object.fromEntries(configSources);
  // 详情头一行 = D-07 的 `.d-row`；左信息块带 `.d-grow` 把动作推到右端。
  assert.match(templateSource, /export function ConfigDetailHeader\b[\s\S]*?"d-row", className/);
  assert.match(templateSource, /export function ConfigDetailHeaderInfo[\s\S]*?"d-col", "d-grow"/);
  assert.match(templateSource, /export function ConfigDetailActions[\s\S]*?"d-row", className/);
  for (const name of ["AgentsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigDetailActions>|className="d-row"/);
  }
  // fork:settings-frame —— 技能详情头照 D-11 帧用 `.d-row` + `.d-grow` 把动作推到右端，
  // 不经过 ConfigDetailActions 基件。
  assert.match(sources.SkillsConfig, /className="d-row">[\s\S]{0,400}d-grow/);
  assert.match(sources.PluginsConfig, /<ConfigDetailActions|<ConfigField|className="d-row"/);
  assert.match(sources.PluginsConfig, /<ConfigSwitch|d-switch/);
});

test("keeps shared static presentation in the design system stylesheet", () => {
  assert.doesNotMatch(templateSource, /<style>/);
  assert.doesNotMatch(templateSource, /onMouseEnter|onMouseLeave/);
  // fork:v5-landing Wave B —— 视觉只来自两套形态表：模板里**不再有产品自创的
  // config-* 静态类**，每个共享基件按形态直接挂画板类（桌面 `d-*`、窄屏 `m-*`），
  // 连 v1 画板的 `pw-*` 也清零了。剩下一行 inline 是画板 DOM 本身的一部分
  // （详情卡标题的 `<h3 style="margin:0">`）。
  for (const className of [
    "d-set",
    "d-set-nav",
    "d-trow",
    "d-card",
    "d-field",
    "d-btn",
    "d-switch",
    "d-set-sec-t",
    "d-stat",
    "d-empty",
  ]) {
    assert.match(templateSource, new RegExp(className), `SettingsUi should render ${className}`);
    assert.match(boardSource, new RegExp(`\\.${className}\\b`), `system.css should define .${className}`);
  }
  // fork:v5-landing Wave B（M-05）—— 窄屏那套也是「类只出自那张表」。
  for (const className of [
    "m-list",
    "m-cardgroup",
    "m-trow",
    "m-setrow",
    "m-btn",
    "m-switch",
    "m-pickbar",
    "m-picktag",
    "m-empty",
  ]) {
    assert.match(templateSource, new RegExp(className), `SettingsUi should render ${className}`);
    assert.match(pwaSource, new RegExp(`\\.${className}\\b`), `pwa/system.css should define .${className}`);
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
  // 模板里只剩一行 inline（画板 DOM 的一部分：详情卡标题的 `<h3 style="margin:0">`）。
  assert.equal(
    (templateSource.match(/style=\{\{/g) ?? []).length,
    1,
    "SettingsUi should keep only the artboard-inline style on the detail title",
  );
});

/**
 * fork:v5-landing-frame · D-07 帧 B —— 单选行（`.d-radiorow`）的 DOM 守卫。
 *
 * 设置里的「多选一」有两种形态，判据是「值本身带不带一句说明」：
 *   · `PwRadio`    = `.d-seg` 分段芯片（两个字的档位，落在行尾 `.d-grow-last`）；
 *   · `PwRadioRow` = `.d-radiorow` **整行**（圆点 + 标题 + 副标题，占满整列）。
 * 这条守的是后者的**画板原文**：圆点 `.d-radio`、标题 `.d-radiorow-t`、副标题
 * `.d-radiorow-s`，选中挂 `.on`（**不是** `.is-on` —— 板面原文就是 `.on`）；
 * 窄屏是 M-05 帧 A 的 `.m-cardgroup` › `.m-setrow` + 行尾 `.m-radio`。
 *
 * 为什么要有它：这两件在 2026-10-05 之前是一件事（只有 `.d-seg`），于是带说明的
 * 档位只能把说明挤进标签里；结构一变，能查的就只有类名与状态类。
 */
test("单选行按 D-07 帧 B 的原文发类（圆点 + 标题 + 副标题，选中 .on）", () => {
  const start = templateSource.indexOf("export function PwRadioRow");
  const end = templateSource.indexOf("export function PwSelectBox");
  assert.ok(start > 0 && end > start, "PwRadioRow should sit between PwRadio and PwSelectBox");
  const row = templateSource.slice(start, end);
  for (const className of ["d-radiorow", "d-radio", "d-radiorow-t", "d-radiorow-s"]) {
    assert.match(row, new RegExp(className), `PwRadioRow should render .${className}`);
    assert.match(boardSource, new RegExp(`\\.${className}\\b`), `system.css should define .${className}`);
  }
  // 选中态：行 `.d-radiorow.on`、圆点 `.d-radio.on`（两处都带，板面同款）。
  assert.match(row, /d-radiorow text-left\$\{on \? " on" : ""\}/);
  assert.match(row, /d-radio\$\{on \? " on" : ""\}/);
  // 语义：整行是 role=radio + aria-checked，组是 role=radiogroup（键盘可达）。
  assert.match(row, /role="radiogroup"/);
  assert.match(row, /role="radio"/);
  assert.match(row, /aria-checked=\{on\}/);
  // 标签行是画板里的**上一级**（`.d-set-row` › `.d-set-row-box`），不是挤在行尾的芯片。
  assert.match(row, /className="d-set-row"/);
  assert.match(row, /className="d-set-row-t"/);
  // 窄屏那一支：M-05 帧 A 的分组行 + 行尾圆点；**不套 `.m-cardgroup`**
  // （宿主 `PwBlock` 的窄屏形态就是它，再套一层是卡中卡）—— 所以窄屏的组容器
  // 不发类名，只留 `role="radiogroup"`。
  assert.match(row, /className="m-setrow"/);
  assert.match(row, /m-radio/);
  assert.match(row, /className=\{isMobile \? undefined : "d-col"\} role="radiogroup"/);
  assert.doesNotMatch(row, /className="m-cardgroup"/);
  // 按钮的 UA 归零：`.d-radiorow` 库里没有 text-align（板面也是 button），
  // 所以桌面那一支带 Tailwind 的 text-left —— 去掉它文字会居中。
  assert.match(row, /d-radiorow text-left/);
});

/**
 * fork:v5-landing Wave B —— **画板与实现必须是同一套 DOM**。
 *
 * 用户实测反馈：「设计的好，但真正落地的时候就有差距了，就不按照规划的进行设计了」。
 * 根因：产品自造类（当年的 `.pw-shead` / `.pw-stools` / `.pw-scontent`）与画板没有
 * 共同选择器 → `scripts/board-diff.mjs` 逐项报「画板里没有这个选择器」→ 只能靠人眼
 * 比 → 必然漂移。
 *
 * 这条测试把「共用同一套类」钉死，**不需要浏览器**，所以能进 check:design。
 * 形态来源：`design/v5/web/system.css`（`d-*`）+ `design/v5/pwa/system.css`（`m-*`）。
 */
test("画板与实现共用同一套设置页框架类（否则 live 对位失效）", async () => {
  // 1. 实现：`SettingsPage` 输出的类，v5 形态表必须有对应规则
  for (const cls of ["d-set-sec", "d-set-sec-t", "d-row", "d-col"]) {
    assert.match(templateSource, new RegExp(cls), `SettingsPage 应输出 .${cls}`);
    assert.match(boardSource, new RegExp(`\\.${cls}\\b`), `web/system.css 应定义 .${cls}`);
  }
  // fork:v5-landing Wave B（M-05）—— 窄屏那套页帧同理：`.m-hero` / `.m-cardgroup`。
  for (const cls of ["m-hero", "m-cardgroup", "m-setrow"]) {
    assert.match(templateSource, new RegExp(cls), `SettingsPage 应输出 .${cls}`);
    assert.match(pwaSource, new RegExp(`\\.${cls}\\b`), `pwa/system.css 应定义 .${cls}`);
  }
  // 2. 画板：v5 的 D-07 / D-07b 设置壳帧必须用 `.d-set` 三件套。
  for (const name of [
    "D-07-settings-general",
    "D-07b-settings-general-detail",
  ]) {
    const src = await readFile(
      new URL(`../design/v5/web/boards/${name}.html`, import.meta.url),
      "utf8",
    );
    assert.match(src, /class="d-set"/, `${name} 的页帧应使用 .d-set`);
    assert.match(src, /class="d-set-nav"/, `${name} 的页帧应使用 .d-set-nav`);
    assert.match(src, /class="d-set-main"/, `${name} 的页帧应使用 .d-set-main`);
  }
  // 3. M-05 的手机帧：hub（帧 A）与分节二级页（帧 B / C）三层都在。
  const m05 = await readFile(
    new URL("../design/v5/pwa/boards/M-05-settings.html", import.meta.url),
    "utf8",
  );
  for (const cls of ["m-settings", "m-cardgroup", "m-setrow", "m-top-btn", "m-sheet"]) {
    assert.match(m05, new RegExp(cls), `M-05 应画出 .${cls}`);
  }
  assert.match(m05, /data-ico="chevron-left"/, "M-05 的分节二级页左上角是返回箭头");
});

test("embedded sections do not repeat Settings close actions", () => {
  const sources = Object.fromEntries(configSources);
  for (const [name, source] of Object.entries(sources)) {
    // fork:settings-frame（画板 62）—— 关闭动作只属于设置面板的页头，
    // 嵌入的分节一个都不重复（原先靠页脚里 `!embedded &&` 兜着，页脚已删）。
    //
    // fork:v5-landing —— **窄屏卡片里那个 `.d-modal` 是例外**：它的页脚有一枚
    // `onClick={onClose}`，关的是**这一张模型/技能卡自己的浮层**（标题即
    // 「编辑模型」），不是设置页。所以判据得先排除「前面紧挨着一个
    // `.d-modal-foot`」的关闭，否则这张卡片会被误报成“重复了页头关闭”。
    const stray = [...source.matchAll(/onClick=\{onClose\}/g)].filter((m) => {
      const before = source.slice(Math.max(0, m.index - 600), m.index);
      // 最近一层容器是 modal-foot（在 600 字内且其后没有再开新块）就算合法。
      return before.lastIndexOf("d-modal-foot") < 0;
    });
    assert.equal(
      stray.length,
      0,
      `${name} should not repeat the page-level close action (offenders: ${stray.length})`,
    );
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
  assert.match(sources.ModelsConfig, /<(?:ConfigButton|DButton)\s+variant="primary"[\s\S]*?onClick=\{handleSave\}/);
  assert.match(sources.AgentsConfig, /<(?:ConfigButton|Btn|DButton)\s+variant="primary"[\s\S]*?onClick=\{\(\) => void save\(\)\}/);
  // ② 列表级：刷新 / 检查更新与计数同排（工具栏）。
  assert.match(sources.SkillsConfig, /onClick=\{\(\) => void checkForUpdates\(\)\}/);
  assert.match(sources.PluginsConfig, /onClick=\{\(\) => void loadPlugins\(\)\}/);
});

test("skills, agents, and plugins share enabled and disabled controls", () => {
  const sources = Object.fromEntries(configSources);
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigSwitch|d-switch/);
  }
  // 状态点只属于插件的列表行（行 anatomy）；子代理分节的状态照画板 D-12 帧 B
  // 落在表格的「状态」列徽章上，技能行尾是「可更新」warn 徽标或开关快捷切换。
  for (const name of ["PluginsConfig"]) {
    assert.match(sources[name], /<ConfigStatusDot|d-dot/);
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
  assert.match(sources.AgentsConfig, /savedOk && \(\s*<i data-ico="check"/);
  // 提示条是 v5 的 `.d-banner` 一行（v1 曾是 `.pw-alert info`）。
  assert.match(sources.SkillsConfig, /className="(?:pw-alert info|d-banner[^"]*)"[\s\S]*?trust\.skillsNotLoaded/);
  assert.match(sources.PluginsConfig, /className="(?:pw-alert info|d-banner[^"]*)"[\s\S]*?trust\.pluginsNotLoaded/);
  // 插件 / MCP 详情的属性表是画板的 `.pw-kv`（`ConfigKv` 基件，现发 `d-col`）。
  assert.match(sources.PluginsConfig, /<ConfigKv>[\s\S]*?i18n\.package|d-set-row-t">\{t\("i18n\.package"\)\}/);
  assert.match(sources.PluginsConfig, /<ConfigKv>[\s\S]*?mcp\.fieldArgs|<McpReadonlyField[\s\S]*?mcp\.fieldArgs/);
});

test("provider usage summary renders the artboard quota bars and stat cards", async () => {
  const usageSource = await readFile(new URL("./ProviderUsageSummary.tsx", import.meta.url), "utf8");
  // v5 D-08 帧 A「配额」：分节 + 逐条 `.d-bar` 进度行；指标走 `.d-statgrid > .d-stat`。
  assert.match(usageSource, /<section className="d-set-sec">/);
  assert.match(usageSource, /className="d-bar"/);
  assert.match(usageSource, /key=\{bucket\.id\}/);
  assert.match(usageSource, /<div className="d-statgrid">/);
  assert.match(usageSource, /key=\{metric\.id\}/);
  // 数值淡入用 D-28 的 `.d-num`（key 跟值走，命中时重挂载触发一次）。
  assert.match(usageSource, /className="d-num d-t-lg d-t-b"/);
  assert.match(usageSource, /key=\{String\(metric\.value\)\}/);
  // 错误走 `.d-banner err`。
  assert.match(usageSource, /className="d-banner err"/);
  // 刷新动作是画板按钮 + 画板图标，旋转用 `.d-run` 的持续动画。
  assert.match(usageSource, /data-ico="refresh-cw"/);
  assert.match(usageSource, /className="d-run"/);
  assert.doesNotMatch(usageSource, /<svg/);
  // 内联只允许进度条宽度百分比，不允许颜色 / 间距 / 字号等设计值。
  assert.doesNotMatch(usageSource, /style=\{\{[^}]*(color|gap|padding|margin|fontSize|borderRadius)/);
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
  // fork:v5-landing Wave B —— 规则迁到 `design/v5/web/system.css`：两栏就是 D-07 的
  // `.d-set`（弹窗里 `.d-modal-box > .d-set` 两列各自滚）+ `.d-set-nav`（自带
  // `overflow-y: auto`）。下面两条只看样式表自己的规则还在，不看组件。
  assert.match(boardSource, /\.d-modal-box > \.d-set \{[\s\S]*?flex: 1 1 auto;[\s\S]*?min-height: 0/);
  assert.match(boardSource, /\.d-set-nav \{[\s\S]*?overflow-y: auto/);
  // 装了三件套的分节宿主是唯一滚动容器（app/settings.css 里的 `.pw-sbody:has(...)`
  // 规则是 v1 时期的遗留，选择器已经挂不到组件，Wave Z 一并清）。
  assert.match(
    cssSource,
    /\.settings-section-host\.pw-sbody:has\(\.pw-shead\) \{[\s\S]*?overflow: hidden/,
  );
});

/**
 * fix:block-rhythm —— 块内紧跟字段行的提示 / 横幅要有上边距。
 * 这是 `design/pi-web-design/assets/board.css`（v1）自己的规则，设置基件已不再发
 * `pw-block` / `pw-alert`；守卫保留到 Wave Z 与那段旧样式一并删。
 */
test("块内的提示与横幅不再贴着上一行", () => {
  assert.match(
    cssSource,
    /\.pw-block > \.pw-alert,\s*\n\.pw-block > \.pw-hint,[\s\S]*?margin-top: var\(--s2\)/,
  );
});
