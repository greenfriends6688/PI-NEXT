// 设置新框架 · 块流页（画板 62 · 帧 2）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况：
// SettingsPanel.tsx:1198-1240 设壳 + SettingsPanel.tsx:486 的常规分节内容）。
// **画板侧一行不动**，两边靠 pairs 显式配对。
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
  "name": "设置新框架 · 块流页（画板 62 · 帧 2）",
  "board": "62-settings-layout.html",
  "boardFrame": 2,
  "app": { "script": OPEN_GENERAL, "settle": 1600 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".settings-section-tabs .d-set-navitem",
      "reason": "**取样差异**：画板帧的左导航画着 12 个分节 + 一枚「返回工作区」；产品只有 11 项（三个分节 2026-10-01 下线、「返回工作区」同日撤掉）。高度差来自**行数不同**，属接线层。v1 导航行分装在 `.pw-ico` + `.pw-name`；v5 的 `button.d-set-navitem` 直接放文案，没有独立名字类。"
    },
    {
      "sel": ".settings-section-tabs .d-set-navitem:last-child",
      "reason": "**已下线**：`.pw-snav-close`（「返回工作区」）与画板帧 1 的「快捷键 / 记忆 / 自定义命令」两个分节都按 2026-10-03 / 10-01 用户裁定从产品撤掉（弹窗右上角的关闭钮是唯一出口）。这一对量的是产品导航里的**最后一枚**行（导入），不是「返回工作区」—— 取样差异。"
    },
    {
      "sel": ".settings-dialog-main",
      "reason": "**取样差异**：`.pw-sbody`（board.css:713，「`overflow:hidden` + 左右 40px」）在 v5 拆成 `main.settings-dialog-main`（零几何）+ 里层 `.d-set-main`（`overflow-y:auto` + `padding: sp-6 sp-8`）。"
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
      "sel": ".d-set-main .d-set-sec",
      "reason": "**取样差异（页头 → 分节）**：v1 的 `.pw-shead` 是一行页头（下边框 + `align-items:flex-end`）；v5 的常规分节把页头也收进一块 `.d-set-sec`，而 v5 的常规分节本身**没有独立的页头块**（`.d-set-sec` 就是第一块「外观」）。这一对量的是内容区里那一块。**取样差异。**"
    },
    {
      "sel": ".d-set-main .d-set-sec + .d-row",
      "reason": "**取样差异**：画板帧 2 的内容区里没有工具条（块流页不需要）；产品常规分节也没有。这一对落到的是第一块分节下面那一行（皮肤条那一行 `.d-row`）。按取样差异登记。"
    },
    {
      "sel": ".d-set-main .d-badge",
      "reason": "**未落地**：画板帧 2 的页头动作区挂着一枚「无页级动作 · 即时生效」的 `.pw-badge`；v5 的常规分节页头动作区是**空的**（`SettingsPage` 的 `actions` 省略时不渲染右槽，SettingsUi.tsx:624）。这一对量到的是内容区里实际存在的那一枚 `.d-badge`（若没有则按取样差异记）。"
    },
    {
      "sel": ".d-set-main .d-thumb",
      "reason": "**状态依赖**：`WallpaperSettings.tsx` 在 `url == null` 时不渲染壁纸缩略格（这台机器还没设过壁纸）；画板帧 2 画的是「已有当前壁纸」那一态。"
    },
    {
      "sel": ".d-set-main .d-grid2",
      "reason": "**取样差异（两栏块流 → 单列）**：画板帧 2 明确画「两栏块流，每栏 570」；v5 的常规分节是**单列** `.d-set-inner`（`system.css:483`，max-width 720 居中）。**这是一处真实的几何差。**"
    },
    {
      "sel": ".d-set-main .d-set-sec",
      "reason": "**取样差异（v1 卡片 → v5 分节）**：`.pw-block` 的描边 / 圆角 / 内距随 v5「无框分节」裁定退场。"
    },
    {
      "sel": ".d-set-main .d-set-row",
      "reason": "**形态差异**：`.pw-field`（board.css:781，一行标签 + 右控件，`justify-content:space-between`）↔ v5 的 `.d-set-row`（`system.css:486`，左标题盒 + 右 `margin-left:auto` 控件槽）。字段密度接线随该形态一起退场。"
    },
    {
      "sel": ".d-set-main .d-set-row-t",
      "reason": "标签宽度由文字长度决定；画板帧与产品的行集合不完全相同（画板是节选）"
    },
    {
      "sel": ".d-set-main .d-range",
      "reason": "**画板自身不一致（B 类·UA 层）**：board.css 的 `.pw-range` 只给几何、没写 `font: inherit`，画板里那个裸 `<input type=range>` 保留 UA 字体（13.3333px / normal）；产品按 §4.1 把表单控件 UA 归零（12px / 18px）。range 不渲染文字，这三项不可见。"
    },
    {
      "sel": ".settings-dialog-surface .pw-skin-strip",
      "reason": "**取样差异（皮肤条尚未换皮）**：`.pw-skin-strip` / `.pw-skin` / `.cap` 是产品**现在实际发的类**（v5 设置面板里仅剩的 `pw-*`），两侧原样保留。接线层补了 padding-bottom 2px。"
    },
    {
      "sel": ".settings-dialog-surface .d-set-main .d-row",
      "reason": "**取样差异（`.pw-inline.pw-skin-actions`）**：v1 的皮肤动作行是 `.pw-inline` + `.pw-skin-actions` 两枚类；v5 退成一块普通 `div.d-row`。"
    }
  ],
  "pairs": [
    [".pw-settings", ".settings-dialog-body.d-set"],
    [".pw-snav", ".settings-section-tabs.d-set-nav"],
    [".pw-snav-close", ".settings-section-tabs .d-set-navitem:last-child"],
    [".pw-sbody", ".settings-dialog-main"],
    [".pw-shead", ".d-set-main .d-set-sec"],
    [".pw-shead-copy > h2", ".d-set-main .d-set-sec > .d-set-sec-t"],
    [".pw-shead-copy > p.sub", ".d-set-main .d-set-row > .d-set-row-box > .d-set-row-s"],
    [".pw-shead-acts", ".d-set-main .d-set-sec > .d-row"],
    [".d-set-main .d-badge", ".d-set-main .d-badge"],
    [".pw-scontent", ".d-set-main"],
    [".pw-grid2", ".d-set-main .d-grid2"],
    [".pw-block", ".d-set-main .d-set-sec"],
    [".pw-block > h3", ".d-set-main .d-set-sec > .d-set-sec-t"],
    [".pw-field", ".d-set-main .d-set-row"],
    [".pw-field .pw-label", ".d-set-main .d-set-row-t"],
    [".pw-field .pw-label small", ".d-set-main .d-set-row-s"],
    [".pw-radio", ".d-set-main .d-seg"],
    [".pw-range", ".d-set-main .d-slider"],
    [".pw-mono.pw-dim", ".d-set-main .d-mono"],
    [".pw-btn.sm", ".d-set-main .d-btn.sm"],
    [".pw-skin-strip", ".settings-dialog-surface .pw-skin-strip"],
    [".pw-skin", ".settings-dialog-surface .pw-skin"],
    [".pw-inline.pw-skin-actions", ".settings-dialog-surface .d-set-main .d-row"],
    [".pw-btn.outline.sm", ".d-set-main .d-btn.sm"],
    [".pw-switch", ".d-switch"],
    [".pw-selectbox", ".d-select"],
    [".d-set-main .d-thumb", ".d-set-main .d-thumb"]
  ]
};