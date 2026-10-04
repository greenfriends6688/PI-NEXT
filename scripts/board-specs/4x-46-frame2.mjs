// 从其它 agent 导入（画板 46 · 帧 2）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况：ImportPanel.tsx）。
// **画板侧一行不动**，两边靠 pairs 显式配对。
const OPEN_IMPORT_SCANNED = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="import"]');
  if (!row) throw new Error("settings section not found: import");
  row.click();
  await new Promise((r) => setTimeout(r, 1800));
  const scan = [...document.querySelectorAll(".d-set-main .d-set-sec .d-row button")]
    .find((b) => /扫描|scan/i.test(b.textContent ?? ""));
  if (!scan) throw new Error("页头动作区的「扫描」按钮没找到");
  scan.click();
  // fork:v5-settings-map —— 扫描要跑一会儿，扫完之前四类资产都是空态。
  // 等结果行（.d-set-row）或「扫到 0 条」的空态真的挂上再量。
  for (let i = 0; i < 60; i++) {
    if (document.querySelector(".d-set-main .d-set-row, .d-set-main .d-t-xs.d-t-faint")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 1200));`;

export default {
  "name": "从其它 agent 导入（画板 46 · 帧 2）",
  "board": "46-settings-prompts-archive-import.html",
  "boardFrame": 2,
  "app": { "script": OPEN_IMPORT_SCANNED, "settle": 1500 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".d-set-main .d-set-sec",
      "reason": "**取样差异（页头 → 分节）**：v1 的 `.pw-shead` 是一行页头（下边框 + `align-items:flex-end`）；v5 的 `SettingsPage`（`SettingsUi.tsx:618-631`）收成 `div.d-set-sec`。"
    },
    {
      "sel": ".d-set-main .d-set-sec > .d-row > .d-row",
      "reason": "**取样差异（`.pw-shead-acts`）**：v1 的动作区是页头右端一块独立的 `.pw-shead-acts`；v5 把它落成标题行里的 `div.d-row`（`SettingsUi.tsx:624`）。"
    },
    {
      "sel": ".d-set-main .d-seg",
      "reason": "**取样差异（`.pw-radio` → 分段控件）**：画板把「会话 / 模型 / 技能 / MCP」四类资产画成 `.pw-radio`；v5 用画板 62 帧 B 的 `PwRadio` → `span.d-seg`（`ImportPanel.tsx:586` 的注释同款）。v5 的 `.d-radio` / `.d-radiorow` 只定义、**产品一个都没发**。"
    },
    {
      "sel": ".d-set-main .d-set",
      "reason": "**取样差异（`.pw-cols` → 两栏壳）**：board.css:899 的 `.pw-cols` 是 `grid-template-columns: 300px minmax(0,760px)`；v5 的 `ConfigSplitView`（`SettingsUi.tsx:103`）发 `div.d-set`（纯 flex，不写列宽）。真实几何差：内容宽度从「300 + 760」变成「220 定宽 + 剩余」。"
    },
    {
      "sel": ".d-set-nav .d-set-row",
      "reason": "**形态差异（`.pw-litem` → `.d-set-row`）**：画板把每个候选做成 `.pw-litem`（7px/8px + 圆角 4）；v5 的导入列表行发 `div.d-set-row`（`ImportPanel.tsx:294`，行首一枚 `.d-switch` 当选中态）。骨架不同、档位按 v5 系统表取值。"
    },
    {
      "sel": ".d-set-nav .d-set-row-t",
      "reason": "**形态差异（`.pw-lname`）**：v1 是行内一行名字；v5 拆成 `.d-set-row-t`（名字）+ `.d-set-row-s`（副行）。"
    },
    {
      "sel": ".d-set-nav .d-set-row-s",
      "reason": "**形态差异（`.pw-lsub`）**：v1 是行内一行弱化副标题；v5 是 `.d-set-row-s`（`system.css:490`，`fs-xs` + `margin-top:2px`）。"
    },
    {
      "sel": ".d-set-main .d-col",
      "reason": "**取样差异（`.pw-detail` → 详情栈）**：画板右列是一张 `.pw-detail` 巨卡；v5 的导入页右列是 `ConfigDetailStack`（`SettingsUi.tsx:328`）发的 `div.d-col` —— 卡片壳没有了，内容直接摊在详情列里。"
    },
    {
      "sel": ".d-set-main .d-input",
      "reason": "**取样差异（`.pw-input`）**：画板那一格是「重命名输入框 + 保存/取消」；v5 的导入详情里没有这一枚改名输入框（扫描结果是只读的，导入后才改名）。这一对量的是内容区里实际存在的那枚 `.d-input`。"
    },
    {
      "sel": ".d-set-main .d-empty",
      "reason": "**取样差异（`.pw-empty` / `.pw-empty-inner`）**：v1 的空态是「`.pw-empty` > `.pw-empty-inner` > `.mark` + `p`」两层壳；v5 的 `ConfigEmptyState`（`SettingsUi.tsx:406`）把 `.mark` + `p` **直接放在 `.d-empty` 里**，内层壳没有了。所以 `.pw-empty-inner` 那一对量到的也是 `.d-empty` 本体。"
    },
    {
      "sel": ".d-set-main .d-mono",
      "reason": "**取样差异（等宽数字位）**：画板帧里 `.pw-mono` 挂在四类资产页签的计数上；v5 的导入页**没有等宽数字位**（`ImportPanel.tsx` 里一处 `d-mono` 都没有，计数直接跟在标签后面）。这一对量到的是内容区里实际存在的那一枚 `.d-mono`（若没有则按取样差异记）。"
    },
    {
      "sel": ".d-set-main .d-set-sec-t",
      "reason": "**形态差异（`.pw-sec-title`）**：v1 的 `.pw-sec-title` 带一条撑满的发丝线（board.css:75）；v5 的 `.d-set-sec-t` 是「`fs-lg` + 600」的一行标题，发丝线没有。导入页里它还兼作分组标题（`ImportPanel.tsx:278` 写成 `.d-set-sec-t.d-row`）。"
    },
    {
      "sel": ".d-set-main .d-kbd",
      "reason": "**数据依赖**：画板帧里的 `.pw-kbd` 挂在「重命名输入框」旁；那一处在 v5 的导入详情里没有对应件。量到的是内容区里实际存在的那一枚 `.d-kbd`（若没有就按取样差异记）。"
    }
  ],
  "pairs": [
    // 页头
    [".pw-shead", ".d-set-main .d-set-sec"],
    [".pw-shead-copy > h2", ".d-set-main .d-set-sec > .d-row > .d-t-lg.d-t-b"],
    [".pw-shead-acts", ".d-set-main .d-set-sec > .d-row > .d-row"],
    [".pw-btn.outline.sm", ".d-set-main .d-btn.sm"],
    [".pw-scontent", ".d-set-main"],
    [".pw-radio", ".d-set-main .d-seg"],
    [".pw-mono", ".d-set-main .d-mono"],
    [".pw-cols", ".d-set-main .d-set"],
    [".pw-inline", ".d-set-main .d-row"],
    [".pw-input", ".d-set-main .d-input"],
    [".pw-sec-title", ".d-set-main .d-set-sec-t"],
    [".pw-btn.sm", ".d-set-main .d-btn.sm"],
    // 列表列
    [".pw-list", ".d-set-nav .d-col"],
    [".pw-litem", ".d-set-nav .d-set-row"],
    [".pw-switch", ".d-set-nav .d-switch"],
    [".pw-lname", ".d-set-nav .d-set-row-t"],
    [".pw-lsub", ".d-set-nav .d-set-row-s"],
    // 右列
    [".pw-detail", ".d-set-main .d-col"],
    [".pw-kv", ".d-set-main .d-set-sec-t"],
    [".pw-kv dt", ".d-set-main .d-set-sec-t"],
    [".pw-kv dd", ".d-set-main .d-set-sec-t"],
    [".pw-btn.primary.sm", ".d-set-main .d-btn.primary.sm"],
    // 空态
    [".pw-empty", ".d-set-main .d-empty"],
    [".pw-empty-inner", ".d-set-main .d-empty"]
  ]
};