// 用量（画板 45 · 帧 1）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况：
// SettingsUi.tsx:618-631 的页壳 + fork/UsageStatsPanel.tsx + fork/usage-charts.tsx）。
// **画板侧一行不动**，两边靠 pairs 显式配对。
const OPEN_USAGE = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="usage"]');
  if (!row) throw new Error("settings section not found: usage");
  row.click();
  // fork:v5-settings-map —— 用量页要先扫本机会话文件，扫描没完之前页面只有一句
  // 「正在统计…」，统计卡与图表一块都不在 DOM 里。轮询等它们真的挂上再量。
  for (let i = 0; i < 60; i++) {
    if (document.querySelector(".d-set-main .d-stat, .d-set-main .d-chart")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 1200));`;

export default {
  "name": "用量（画板 45 · 帧 1）",
  "board": "45-settings-shortcuts-usage.html",
  "boardFrame": 1,
  "app": { "script": OPEN_USAGE, "settle": 1500 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".d-set-main .d-set-sec",
      "reason": "**取样差异（页头 → 分节）**：v1 的 `.pw-shead` 是一行页头（下边框 + `align-items:flex-end`）；v5 的 `SettingsPage`（`SettingsUi.tsx:618-631`）收成 `div.d-set-sec`。"
    },
    {
      "sel": ".d-set-main .d-seg",
      "reason": "**取样差异（`.pw-radio` → 分段控件 + 位置变了）**：画板把「7 天 / 30 天 / 1 年 / 全部」放在**页头动作区**里；v5 把它降成内容区第一行的 `span.d-seg`（`UsageStatsPanel.tsx:369`），页头动作区只剩一枚刷新钮。v5 的 `.d-radio` / `.d-radiorow` 只定义、**产品一个都没发**。"
    },
    {
      "sel": ".d-btn.ghost.sm",
      "reason": "**取样差异（`.pw-btn.outline` → `.d-btn`）**：v5 的 `.d-btn` 只有 `primary` / `danger` / `ghost` 三档 + `sm` 尺寸档，**没有 `.outline`**（`system.css:102-118`）：次要档就是裸 `.d-btn` 的发丝边框，`ghost` 是无边框档。用量的「重新扫描」在 v5 是 `ghost.sm`。"
    },
    {
      "sel": ".d-set-main .d-statgrid",
      "reason": "**取样差异 + 数据依赖**：`.pw-stats-grid` 是四列统计卡网格；v5 的 `StatGrid`（`UsageStatsPanel.tsx:71-74`）在两栏块流那一档会退成 `.d-grid2`（注释写明：一栏只有 570，四列会挤成 130px 一卡）。这一对量的是**默认那档**四列网格。"
    },
    {
      "sel": ".d-set-main .d-stat > span:nth-of-type(1)",
      "reason": "**形态差异**：`.pw-stat .k` / `.v` / `.s` 是 v1 的三个语义类；v5 的 `StatCard`（`UsageStatsPanel.tsx:58-69`）把它们换成 `span.d-t-xs.d-t-faint` / `span.d-t-title.d-num` / `span.d-t-xs.d-t-faint` 三个字阶类，没有语义名。这里按**位置**（第 1/2/3 个 span）对位。"
    },
    {
      "sel": ".d-set-main .d-chart",
      "reason": "**取样差异（`.pw-cell` → `.d-chart`）**：画板把每种图表做成一张 `.pw-cell`（描边 + 圆角 + `.pw-cell > h4` 标题）；v5 发 `div.d-chart` + `div.d-chart-head`（`system.css` 的图表族）+ 里层 `.d-card-body`。格盒与标题行分别由 `.d-chart` / `.d-chart-head` 两对量。"
    },
    {
      "sel": ".d-set-main .d-bars > i.hot",
      "reason": "**形态差异**：画板给峰值那根柱加了 `.hot`（更深的填充）；v5 的 `UsageDailyBars`（`fork/usage-charts.tsx:355`）逐根发 `.d-bar-rise` 做错峰入场，**没有 `.hot` 这一档**，柱高全部走同一条 `background`。这一对量到的是第一根普通柱（画板的第一根也不是 `.hot`）。"
    },
    {
      "sel": ".d-set-main .d-badge.ok",
      "reason": "**未落地**：画板帧里的 .pw-badge.ok 是模型份额行上的「已启用」；v5 的用量页把份额写进 UsageListRow 的 d-t-xs 三列文本里，没有徽章。这一对量到的是内容区里实际存在的那一枚 .d-badge.ok（若没有则按取样差异记）。"
    },
    {
      "sel": ".d-set-main .d-badge.bad",
      "reason": "**未落地**：同上一条（用量页没有徽章，只有 d-t-xs.d-t-faint 的文字）。"
    },
    {
      "sel": ".d-set-main .d-badge",
      "reason": "**未落地**：同上一条（用量页没有徽章）。徽章盒的档位由其它设置族 spec 的 .d-badge 那一对量。"
    },
    {
      "sel": ".d-set-main .d-chart .d-row",
      "reason": "**取样差异（`.pw-legend .li` → `.d-row`）**：v1 的图例是一列「色块 + 名字 + 百分比」；v5 的 `UsageListRow`（`fork/usage-charts.tsx:524`）发 `div.d-row.d-t-xs`（可选图标 + 名字 + 口径 + 数值），**没有 `.sw` 色块**，也没有 `.d-legend` 这个类。`.pw-legend` / `.pw-legend .sw` 两对都落在它身上（取样差异）。"
    },
    {
      "sel": ".d-set-main .d-chart .d-row .d-grow.d-mono",
      "reason": "**取样差异（`.pw-lname`）**：v1 的图例行里名字是 `.pw-lname`（一行不折）；v5 的 `UsageListRow` 里名字是 `span.d-grow.d-mono`。"
    }
  ],
  "pairs": [
    // 页头
    [".pw-shead", ".d-set-main .d-set-sec"],
    [".pw-shead-copy > h2", ".d-set-main .d-set-sec > .d-row > .d-t-lg.d-t-b"],
    [".pw-shead-acts", ".d-set-main .d-set-sec > .d-row > .d-row"],
    [".pw-radio", ".d-set-main .d-seg"],
    [".pw-btn.outline.sm", ".d-set-main .d-btn.ghost.sm"],
    // 内容区
    [".pw-scontent", ".d-set-main"],
    // 统计卡
    [".pw-stats-grid", ".d-set-main .d-statgrid"],
    [".pw-stat", ".d-set-main .d-stat"],
    [".pw-stat .k", ".d-set-main .d-stat > span:nth-of-type(1)"],
    [".pw-stat .v", ".d-set-main .d-stat > span:nth-of-type(2)"],
    [".pw-stat .s", ".d-set-main .d-stat > span:nth-of-type(3)"],
    [".pw-stat.is-wide", ".d-set-main .d-statgrid > .d-stat:nth-of-type(4)"],
    // 图表格
    [".pw-grid2", ".d-set-main .d-grid2"],
    [".pw-cell", ".d-set-main .d-chart"],
    [".pw-cell > h4", ".d-set-main .d-chart > .d-chart-head"],
    [".pw-bars", ".d-set-main .d-bars"],
    [".pw-bars i", ".d-set-main .d-bars > i"],
    [".pw-bars i.hot", ".d-set-main .d-bars > i.hot"],
    [".pw-legend", ".d-set-main .d-chart .d-row"],
    [".pw-legend .li", ".d-set-main .d-chart .d-row"],
    [".pw-legend .sw", ".d-set-main .d-chart .d-row > span"],
    // 图例里的列表行
    [".pw-list", ".d-set-main .d-chart .d-col"],
    [".pw-litem", ".d-set-main .d-chart .d-row.d-t-xs"],
    [".pw-lname", ".d-set-main .d-chart .d-row .d-grow.d-mono"],
    // 原子
    [".pw-mono", ".d-mono"],
    [".pw-mono.pw-dim", ".d-set-main .d-mono"],
    [".pw-inline", ".d-set-main .d-row"],
    [".d-set-main .d-badge.ok", ".d-set-main .d-badge.ok"],
    [".d-set-main .d-badge.bad", ".d-set-main .d-badge.bad"],
    [".d-set-main .d-badge", ".d-set-main .d-badge"]
  ]
};