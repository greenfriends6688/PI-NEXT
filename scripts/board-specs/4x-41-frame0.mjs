// 模型 · 供应商列表 + 详情（画板 41 · 帧 0）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况：
// SettingsPanel.tsx:1198-1240 设壳、SettingsUi.tsx:103-480 基件、ModelsConfig.tsx:3213-3230 分栏）。
// **画板侧一行不动**，两边靠 pairs 显式配对。
const OPEN_MODELS = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="models"]');
  if (!row) throw new Error("settings section not found: models");
  row.click();
  await new Promise((r) => setTimeout(r, 1800));`;

export default {
  "name": "模型 · 供应商详情（画板 41 · 帧 0）",
  "board": "41-settings-models.html",
  "boardFrame": 0,
  "app": { "script": OPEN_MODELS, "settle": 2000 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".settings-section-tabs .d-set-navitem",
      "reason": "**取样差异**：v1 导航行把图标与文案分装在 `.pw-ico` + `.pw-name` 里（board.css:709-712 量 `.pw-row` 与 `.pw-name`）；v5 的 `button.d-set-navitem` 直接放文案，**没有独立的名字类**。这一对量到的仍是导航行本体（高 / 内距 / 字号 / 字重 / 选中态）。"
    },
    {
      "sel": ".d-set-sec",
      "reason": "**取样差异（页头 → 分节）**：v1 的 `.pw-shead` 是「标题 + 副标题 + 右端动作 + 一条下边框」的一行页头（board.css:731-735）；v5 把它收成 `div.d-set-sec`（`system.css:484`），标题是 `.d-row > .d-t-lg.d-t-b`、副标题是 `.d-t-xs.d-t-faint`、动作在标题行右端的 `.d-row`。三块内容逐项对位（下面三对），差的是**外层那一圈**（下边框 / 底部内距 / `align-items:flex-end`）。"
    },
    {
      "sel": ".settings-dialog-main",
      "reason": "**取样差异**：`.pw-sbody`（board.css:713）是「`overflow:hidden` + 左右 40px」的外壳；v5 拆成 `main.settings-dialog-main`（零几何）+ 里层 `.d-set-main`（`overflow-y:auto` + `padding: sp-6 sp-8`）。内容区由 `.d-set-main` 那一对量。"
    },
    {
      "sel": ".d-set-main .d-set",
      "reason": "**取样差异（列表+详情 → 两栏壳）**：board.css:899 的 `.pw-cols` 是 `grid-template-columns: 300px minmax(0,760px)`；v5 的 `ConfigSplitView`（`SettingsUi.tsx:103`）发的是 `div.d-set`（`system.css:470`，纯 flex 两列，不写列宽），列宽落在左列 `.d-set-nav`（220px 定宽）与右列 `.d-set-inner`（max-width 720 居中）。**这就是一处真实的几何差**：内容宽度从「300 + 760」变成「220 + 720 居中」。"
    },
    {
      "sel": ".d-set-nav > .d-col",
      "reason": "**形态差异**：`.pw-list`（board.css:900）是 `display:grid; gap:space-tight; align-content:start` 的行堆；v5 的 `ConfigSidebarList`（`SettingsUi.tsx:115`）发 `div.d-col`（flex column），行是 `button.d-trow`（26 高）。行本身的对位在 `.d-trow` / `.d-t-sm.d-t-b` / `.d-t-xs.d-t-faint` 三对里逐项做。"
    },
    {
      "sel": ".d-set-nav .d-trow",
      "reason": "**形态差异**：`.pw-litem`（board.css:901）是「7px/8px 内距 + 圆角 4 + flex + gap 8」的一行；v5 的 `ConfigSidebarItem`（`SettingsUi.tsx:247`）发 `button.d-trow`（`system.css:687`，26 高 + 左右 8px + gap 6）。同行同职责，几何档位按 v5 系统表取值 —— 这属于换皮后的既定形态，不是漂移。"
    },
    {
      "sel": ".d-set-main .d-set > .d-set-inner",
      "reason": "**取样差异（详情卡 → 内容列）**：board.css:923 的 `.pw-detail` 是「描边 + 圆角 6 + 内距 12/16」的一张巨卡；v5 明确把这一层撤了（`ModelsConfig.tsx:3213` 的注释：「右列是 `.d-set-inner`，不再套一张撑满高度的巨卡 —— 那是『弹窗影子』的来源」）。所以 `.pw-detail` 这一对量到的是**右列本体** `.d-set-inner`，卡片壳本身不存在。"
    },
    {
      "sel": ".d-grid2",
      "reason": "**取样差异（属性表 → 两栏字段）**：v1 的 `.pw-kv`（board.css 里是「标签 / 值」纵向表，`.pw-kv dt` / `.pw-kv dd` 是它的两列）被 v5 换成 `.d-grid2 > .d-field`（`ModelsConfig.tsx:683`：「配置字段走 `.d-grid2 > .d-field`」）。`ConfigKv`（`SettingsUi.tsx:297`）现在只发一个 `dl.d-col`，供应商详情不再用它。"
    },
    {
      "sel": ".d-set-main .d-statgrid",
      "reason": "**数据依赖**：`.pw-stats-grid` / `.pw-stat` 量的是「用量摘要（近 30 天）」那张四列卡网格。产品的这块要么还在统计（`正在统计用量…`），要么按数据出现；跑对位时那一格可能只有标题没有卡片，所以登记为数据依赖而不是漂移。"
    },
    {
      "sel": ".d-set-nav .d-trow .d-t-sm.d-t-b",
      "reason": "**数据依赖**：种子环境里供应商行随 `models.json` 变；`workbuddy2api` 是自定义供应商、没有订阅徽章，所以行内容与画板那一行不同（宽度不参与判定，样式仍逐项比）。"
    },
    {
      "sel": ".d-set-nav .d-badge.info",
      "reason": "**状态依赖**：画板帧里那一枚是 `.pw-badge.warn`（模型行上的告警徽章）；v5 的模型行发的是 `span.d-badge.info`（能力标记 `T`）。徽章盒的档位由 `.d-badge` 那一对量，这里只登记**语义档不同**。"
    },
    {
      "sel": ".d-t-xs.d-t-faint",
      "reason": "**取样差异**：v1 的 `.pw-hint`（board.css:785）是行内的次级说明；v5 把同一句降成 `div.d-t-xs.d-t-faint`（`system.css` 的 `.d-t-xs` + `.d-t-faint` 两枚字阶类），没有独立的 hint 类。"
    }
  ],
  "pairs": [
    // 设壳
    [".pw-settings", ".settings-dialog-body.d-set"],
    [".pw-snav", ".settings-section-tabs.d-set-nav"],
    [".pw-sbody", ".settings-dialog-main"],
    // 页头（v5 退成一块 d-set-sec）
    [".pw-shead", ".d-set-main .d-set-sec"],
    [".pw-shead-copy > h2", ".d-set-main .d-set-sec > .d-row > .d-t-lg.d-t-b"],
    [".pw-shead-copy > p.sub", ".d-set-main .d-set-sec > .d-t-xs.d-t-faint"],
    [".pw-shead-acts", ".d-set-main .d-set-sec > .d-row > .d-row"],
    [".pw-btn.outline.sm", ".d-set-main .d-btn.sm"],
    [".pw-btn.primary.sm", ".d-set-main .d-btn.primary.sm"],
    [".pw-btn.sm", ".d-set-main .d-btn.sm"],
    // 工具栏
    [".pw-stools", ".d-set-main .d-set-sec + .d-row"],
    [".pw-search", ".d-set-main .d-searchfield"],
    [".pw-search input", ".d-set-main .d-searchfield > input"],
    [".pw-badge.count", ".d-set-main .d-badge"],
    // 内容区
    [".pw-scontent.is-fixed", ".d-set-main"],
    [".pw-cols", ".d-set-main .d-set"],
    // 列表列
    [".pw-list", ".d-set-nav > .d-col"],
    [".pw-group-title", ".d-group-title"],
    [".pw-litem", ".d-set-nav .d-trow"],
    [".pw-litem.is-on", ".d-set-nav .d-trow.is-on"],
    [".pw-lname", ".d-set-nav .d-trow .d-t-sm.d-t-b"],
    [".pw-lsub", ".d-set-nav .d-trow .d-t-xs.d-t-faint"],
    [".pw-badge.ok", ".d-set-nav .d-badge.ok"],
    [".pw-badge.warn", ".d-set-nav .d-badge.info"],
    // 右列（v5 是内容列，不是卡）
    [".pw-detail", ".d-set-main .d-set > .d-set-inner"],
    [".pw-detail-stack", ".d-set-main .d-set > .d-set-inner > .d-set-inner"],
    [".pw-inline", ".d-set-main .d-set-inner .d-row"],
    [".pw-kv", ".d-set-main .d-set-inner .d-grid2"],
    [".pw-kv dt", ".d-set-main .d-set-inner .d-grid2 .d-field-t"],
    [".pw-kv dd", ".d-set-main .d-set-inner .d-grid2 .d-field"],
    [".pw-stats-grid", ".d-set-main .d-statgrid"],
    [".pw-stat", ".d-set-main .d-stat"],
    [".pw-stat .k", ".d-set-main .d-stat > span:nth-of-type(1)"],
    [".pw-stat .v", ".d-set-main .d-stat > span:nth-of-type(2)"],
    [".pw-stat .s", ".d-set-main .d-stat > span:nth-of-type(3)"],
    // 原子
    [".pw-switch", ".d-switch"],
    [".pw-hint", ".d-t-xs.d-t-faint"],
    [".pw-mono", ".d-mono"]
  ]
};