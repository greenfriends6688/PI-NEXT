// 设置 · 常规整屏（画板 40 · 帧 0）
//
// fork:v5-settings-map（2026-10-04）—— **产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*。
// 映射依据是 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况
// （SettingsPanel.tsx / SettingsUi.tsx / ModelsConfig / …）。**画板侧一行不动**
// （画板仍是 v1 的 pw-*），两边靠 pairs 显式配对。
//
// 三处**不是**照抄对照表，而是按产品实况改的（理由都登记在 knownDiffs 里）：
//   1. 对照表写 .pw-settings → .d-settings，但产品里**没有 .d-settings**：
//      设置壳根是 SettingsPanel.tsx:1198 的 div.settings-dialog-body.d-set
//      （.d-set = flex 两列，system.css:470），它是 .pw-settings 那一层的真身。
//   2. 对照表写 .pw-block → .d-card，但**常规分节里根本没有 .d-card**：
//      v5 把「带描边的一块」放平成一块 .d-set-sec（system.css:484，无描边无圆角）。
//   3. app.open: "settings:*" 的驱动在换皮后失效（入口 .d-side-foot 挂在 div 上、
//      分节行是 .d-set-navitem），所以这份 spec 自带 app.script。
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
  "name": "设置 · 常规整屏（画板 40 · 帧 0）",
  "board": "40-settings-general.html",
  "boardFrame": 0,
  "app": { "script": OPEN_GENERAL, "settle": 1600 },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-section-tabs .d-set-navitem",
      "reason": "**取样差异**：v1 的导航行把图标与文案分装在 `.pw-ico` + `.pw-name` 两个壳里（board.css:709-712 量的是 `.pw-row` 与 `.pw-name`）；v5 把它们拆掉，文案直接落在 `button.d-set-navitem` 的文本里（SettingsPanel.tsx:1204-1237），**没有独立的名字类**。这一对量的仍是导航行本体（高度 / 内距 / 字号 / 字重 / 选中态底色），与画板 `.pw-snav .pw-row` 对得上；`.pw-snav .pw-name` 那一对只能取到同一枚按钮。"
    },
    {
      "sel": ".d-set-main .d-set-sec > .d-set-sec-t",
      "reason": "**取样差异（分节页头已退）**：画板每个分节顶部都有一行独立的 .pw-shead（标题 h2 + 一句 p.sub）；v5 的**常规分节没有页头块** —— 分节标题退成弹窗级的一行 .settings-dialog-header.d-modal-head（见 40-settings-general 那一份），内容区直接从第一块 .d-set-sec 开始。所以 .pw-shead-copy > h2 这一对量的是**内容区里最近的一行分节标题**（.d-set-sec-t），不是页头标题。页头本身的差由 40-settings-general 量。"
    },
    {
      "sel": ".d-set-main .d-set-row > .d-set-row-box > .d-set-row-s",
      "reason": "**取样差异（分节页头已退）**：同上一条 —— 画板页头上那句 p.sub 在 v5 的常规分节里没有位置；这一对量的是内容区里最近的一行**行内说明**（.d-set-row-s，字阶与 v1 的 .pw-hint 同档）。"
    },
    {
      "sel": ".d-set-sec",
      "reason": "**取样差异（v1 卡片 → v5 分节）**：board.css:776 的 `.pw-block` 是「margin-top 16 + 描边 + 圆角 6 + 内距 12/16」的一张卡；v5 把常规分节的同一块放平成 `div.d-set-sec`（`system.css:484`，只有 `display:flex; column; gap:4`）。标题行与行流仍逐项对位（下面 `.d-set-sec-t` / `.d-set-row` 都在），差别只在**卡壳本身**：描边、圆角、内距都随 v5 的「无框分节」裁定一起退了。这是 v5 系统表里的既定形态，不是接线漂移。"
    },
    {
      "sel": ".d-set-row",
      "reason": "**形态差异**：`.pw-field`（board.css:781）是「一行标签 + 右侧控件，`justify-content:space-between`，字段之间一条发丝线」；v5 的 `.d-set-row`（system.css:486）是「左标题盒 + 右控件槽 `margin-left:auto`，行间一条发丝线」。同一行的骨架，逐项（行高 / 内距 / 字号 / 描边）对得上；`justify-content` 这类布局值不在本工具的判定项里。"
    },
    {
      "sel": ".d-seg",
      "reason": "**取样差异（v5 没有单选组）**：v1 的 `.pw-radio` 是一排圆角小片（board.css 内联）；v5 的 `system.css` 里 `.d-radio` / `.d-radiorow` 只定义、**产品一个都没发**，实际承载「主题三档」的是 `span.d-seg`（`system.css:566`，同形态的分段控件）。所以这一对量的是 `.d-seg` 盒本身，不是里面的档位按钮。"
    },
    {
      "sel": ".d-slider",
      "reason": "**画板自身不一致（B 类·UA 层）**：board.css 的 `.pw-range` 只给几何，没写 `font: inherit`，所以画板里那个裸 `<input type=range>` 保留 UA 字体（13.3333px / normal）；产品按 §4.1 把表单控件 UA 归零（12px / 18px）。range 不渲染文字，这三项不可见。"
    },
    {
      "sel": ".d-thumb",
      "reason": "**状态依赖**：`WallpaperSettings.tsx` 在 `url == null` 时**不渲染**缩略格（种子环境没设壁纸）；画板帧 0 画的是「已有当前壁纸」那一态。"
    },
    {
      "sel": ".settings-dialog-surface .pw-skin-strip",
      "reason": "**取样差异（皮肤条尚未随设置族换皮）**：`.pw-skin-strip` / `.pw-skin` / `.cap` 在 v5 里**仍然是产品实际发的类**（实况 dump 确认，只有它们还留在 `pw-*`），所以画板侧选择器原样保留。接线层给皮肤条补了 padding-bottom 2px（卡片阴影的呼吸位），画板没有。"
    },
    {
      "sel": ".settings-dialog-surface .pw-skin .cap",
      "reason": "**接线层**：app/fork-ui.css 把 `.cap` 从 board.css 的 `display:flex` 改成 `display:grid; grid-auto-flow:column`（button 的内容模型只能放 phrasing 内容，`prev` 也一并改成 grid）。外观近似但结构已不同。"
    },
    {
      "sel": ".settings-dialog-main",
      "reason": "**取样差异**：`.pw-sbody`（board.css:713）是「`overflow:hidden` + 左右 40px 内距」的外壳；v5 把它拆成 `main.settings-dialog-main`（不设几何）+ 里层 `.d-set-main`（`overflow-y:auto` + `padding: sp-6 sp-8`）。这一对量的是**外层壳**（默认块、零内距），内容区那一层由 `.d-set-main` 那一对量。"
    }
  ],
  "pairs": [
    [".pw-settings", ".settings-dialog-body.d-set"],
    [".pw-snav", ".settings-section-tabs.d-set-nav"],
    [".pw-snav .pw-row", ".settings-section-tabs .d-set-navitem"],
    [".pw-snav .pw-name", ".settings-section-tabs .d-set-navitem"],
    [".pw-sbody", ".settings-dialog-main"],
    [".pw-shead", ".d-set-main .d-set-sec"],
    [".pw-shead-copy > h2", ".d-set-main .d-set-sec > .d-set-sec-t"],
    [".pw-shead-copy > p.sub", ".d-set-main .d-set-row > .d-set-row-box > .d-set-row-s"],
    [".pw-scontent", ".d-set-main"],
    [".pw-block", ".d-set-main .d-set-sec"],
    [".pw-block > h3", ".d-set-main .d-set-sec > .d-set-sec-t"],
    [".pw-field", ".d-set-main .d-set-row"],
    [".pw-field .pw-label", ".d-set-main .d-set-row > .d-set-row-box > .d-set-row-t"],
    [".pw-field .pw-label small", ".d-set-main .d-set-row > .d-set-row-box > .d-set-row-s"],
    [".pw-ctl", ".d-set-main .d-set-row > .d-grow-last"],
    [".pw-radio", ".d-seg"],
    [".pw-range", ".d-slider"],
    [".pw-mono.pw-dim", ".d-set-main .d-mono"],
    // 皮肤条：v5 里仍是产品实际发的 pw-*，画板侧原样保留。
    [".pw-skin-strip", ".settings-dialog-surface .pw-skin-strip"],
    [".pw-skin", ".settings-dialog-surface .pw-skin"],
    [".pw-skin .prev", ".settings-dialog-surface .pw-skin .prev"],
    [".pw-skin .cap", ".settings-dialog-surface .pw-skin .cap"],
    // 皮肤动作行：v1 是 .pw-inline.pw-skin-actions，v5 退成一块普通 .d-row
    // （SettingsPanel.tsx 的皮肤分节里就是 div.d-row + 若干 .d-btn.sm）。
    [".pw-inline.pw-skin-actions", ".settings-dialog-surface .d-set-main .d-row"],
    [".pw-btn.outline.sm", ".d-btn.sm"],
    [".pw-switch", ".d-switch"],
    [".pw-selectbox", ".d-select"],
    [".pw-wallpaper-thumb", ".d-thumb"]
  ]
};