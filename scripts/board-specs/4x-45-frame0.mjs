// 快捷键（画板 45 · 帧 0）—— **分节已下线**
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*。
// **画板侧一行不动**，两边靠 pairs 显式配对。
//
// 画板帧 0 量的是「快捷键」分节。产品里**没有这个分节**（设置导航只有 11 项），
// 所以原驱动先把所有分节宿主摘掉 —— 这一份剩下的可比项全是**与分节无关的通用基件**
// （.pw-snav 左导航 / .pw-field 字段行 / .pw-kbd / .pw-alert），拿设置壳本身对位。
const OPEN_GENERAL = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="general"]');
  if (!row) throw new Error("settings section not found: general");
  row.click();
  await new Promise((r) => setTimeout(r, 1800));`;

export default {
  "name": "快捷键（画板 45 · 帧 0 · 分节已下线，只对通用基件）",
  "board": "45-settings-shortcuts-usage.html",
  "boardFrame": 0,
  "app": { "script": OPEN_GENERAL, "settle": 1600 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".settings-section-tabs .d-set-navitem",
      "reason": "**取样差异 + 分节已下线**：画板帧 0 的左导航里画着「快捷键 / 记忆 / 自定义命令」三个分节，产品设置导航**已经没有这三项**（快捷键与自定义命令 2026-10-01 按用户裁定下线，记忆同批）。所以两边的导航行集合不同：这一对量的是**第一枚**导航行本体（高 / 内距 / 字号 / 字重 / 选中态底色），逐项一致。"
    },
    {
      "sel": ".d-set-main .d-set-sec",
      "reason": "**取样差异 + 分节已下线**：画板帧 0 的页头与字段行属于「快捷键」分节，产品**没有这一节**（2026-10-01 用户裁定删分节 + 停执行器）。所以这一份量的字段行原子（.pw-field / .pw-label / .pw-ctl）与页头三枚落在**常规**分节的同类基件上 —— 那一节是产品里唯一还在用「字段行 + 右控件槽」的分节，量到的是行盒本身（高 / 内距 / 字号 / 描边 / 描边宽度）。"
    },
    {
      "sel": ".d-set-main .d-set-row",
      "reason": "**取样差异 + 形态差异**：同上一条（快捷键分节已下线，量的是常规分节的字段行）。另外 v5 的 `.d-set-row`（system.css:486，左标题盒 + 右 margin-left:auto 槽）与 v1 的 `.pw-field`（board.css:781，justify-content:space-between）本身也不是同一形态。"
    },
    {
      "sel": ".d-set-main .d-badge.count",
      "reason": "**状态依赖**：画板帧 0 的页头动作区挂着一枚 `.pw-badge.count`（快捷键总数）；产品常规分节的页头动作区是**空的**（`SettingsPage` 的 `actions` 省略时不渲染右槽），分节内容里也没有 count 徽章。这一对量到的是内容区里实际存在的那一枚（若没有则按取样差异记）。"
    },
    {
      "sel": ".d-set-main .d-set-inner",
      "reason": "**取样差异（`.pw-grid2`）**：画板帧 0 的内容区是两栏并排的快捷键表格（`.pw-grid2`，每栏 570）；v5 的常规分节是**单列** `.d-set-inner`（`system.css:483`，max-width 720 居中）。**这是一处真实的几何差。** 这一对量的是内容列盒本体。"
    },
    {
      "sel": ".d-set-main .d-set-row-t",
      "reason": "**取样差异（`.pw-sec-title`）**：画板帧 0 右栏那块的标题是 `.pw-sec-title`；v5 的常规分节里对应的是「主题」行，标题落在 `.d-set-row-t`。这一对量的是行标题盒本体。"
    },
    {
      "sel": ".d-set-main .d-seg",
      "reason": "**取样差异（`.pw-radio` → 分段控件）**：v5 的 `.d-radio` / `.d-radiorow` 只在 `system.css` 里定义、产品一个都没发；实际承载枚举的是 `span.d-seg`。"
    },
    {
      "sel": ".d-set-main .d-t-xs.d-t-faint",
      "reason": "**取样差异（`.pw-alert` → `.d-banner` 没有同类件）**：对照表里 `.pw-alert` 在 v5 由 `.d-banner` 承载，但**常规分节里没有提示条**（只有详情 / 插件 / 导入那几节用 `.d-banner`）。这一对量到的是内容区里实际存在的那一枚行内说明（若没有则按取样差异记）。"
    },
    {
      "sel": ".d-set-main .d-select",
      "reason": "**取样差异（`.pw-input`）**：画板帧 0 里那枚 `.pw-input` 是快捷键一类的窄文本框；v5 的常规分节没有那一行 —— 内容区里实际存在的是字体 / 主题那几枚 `.d-select`。这一对量到的是内容区里实际存在的那一枚（若没有则按取样差异记）。"
    },
    {
      "sel": ".d-set-main .d-row",
      "reason": "**取样差异（`.pw-inline`）**：v1 的 `.pw-inline` 是详情头 / 动作行那一行横排；v5 的常规分节里对应的是皮肤条下面那一行 `.d-row`（导入 / 导出 / 打开皮肤工作室 + 一句说明）。"
    },
    {
      "sel": ".d-set-main .d-set-sec",
      "reason": "**取样差异（页头动作区）**：画板帧 0 的页头右端挂着一枚 `.pw-shead-acts`（快捷键那一块的页级动作）；v5 的常规分节**没有页头动作区** —— `SettingsPage` 的 `actions` 省略时不渲染右槽（`SettingsUi.tsx:624`），动作下沉到皮肤条下面那一行 `.d-row`。这一对量的是内容区里承载动作的那一块分节。"
    },
    {
      "sel": ".d-set-main .d-set-inner",
      "reason": "**取样差异（`.pw-inline` → 详情头那一行）**：v1 的 `.pw-inline` 是详情头那一行横排；v5 的技能详情头是 `.d-set-inner > .d-col > .d-row`（`h3` 名字 + 徽章 + 等宽路径 + 动作）。这一对量的是那一行盒本体。"
    }
  ],
  "pairs": [
    [".pw-snav", ".settings-section-tabs.d-set-nav"],
    [".pw-snav .pw-row", ".settings-section-tabs .d-set-navitem"],
    [".pw-shead", ".d-set-main .d-set-sec"],
    [".pw-shead-copy > h2", ".d-set-main .d-set-sec > .d-set-sec-t"],
    [".pw-shead-acts", ".d-set-main .d-set-sec"],
    [".pw-badge.count", ".d-set-main .d-badge.count"],
    [".pw-btn.outline.sm", ".d-set-main .d-btn.sm"],
    [".pw-scontent", ".d-set-main"],
    [".pw-grid2", ".d-set-main .d-set-inner"],
    [".pw-sec-title", ".d-set-main .d-set-row-t"],
    [".pw-field", ".d-set-main .d-set-row"],
    [".pw-field .pw-label", ".d-set-main .d-set-row-t"],
    [".pw-ctl", ".d-set-main .d-set-row > .d-grow-last"],
    [".pw-kbd", ".d-kbd"],
    [".pw-btn.sm", ".d-set-main .d-btn.sm"],
    [".pw-btn.primary.sm", ".d-set-main .d-btn.sm"],
    [".pw-alert", ".d-set-main .d-t-xs.d-t-faint"],
    [".pw-input", ".d-set-main .d-select"],
    [".pw-inline", ".d-set-main .d-set-inner"],
    [".pw-radio", ".d-set-main .d-seg"]
  ]
};