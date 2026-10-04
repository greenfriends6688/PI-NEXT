// SW-15 设置页新框架（画板 62 · 帧 C 两栏块流）—— 常规 / 用量这类「没有条目概念」的分节。
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*。
// **画板侧一行不动**，两边靠 pairs 显式配对。
// 与 62-settings-layout.mjs（帧 B 列表页）成对：帧 B 验「列表 300 + 内容 760」，
// 帧 C 验「两栏块流 570 × 2 + 字段行跨度」。两份合起来覆盖画板 62 的两个骨架。
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
  name: "设置新框架（画板 62 · 帧 C 两栏块流）",
  board: "62-settings-layout.html",
  boardFrame: 2,
  app: { script: OPEN_GENERAL, settle: 1600 },
  pairs: [
    [".pw-settings", ".settings-dialog-body.d-set"],
    [".pw-shead", ".d-set-main .d-set-sec"],
    [".pw-shead-copy > h2", ".d-set-main .d-set-sec > .d-set-sec-t"],
    [".pw-shead-copy > p.sub", ".d-set-main .d-set-row > .d-set-row-box > .d-set-row-s"],
    [".pw-scontent", ".d-set-main"],
    [".pw-grid2", ".d-set-main .d-grid2"],
    [".pw-block", ".d-set-main .d-set-sec"],
    [".pw-field", ".d-set-main .d-set-row"],
    [".pw-label", ".d-set-main .d-set-row-t"],
    [".pw-switch", ".d-switch"],
  ],
  knownDiffs: [
    {
      "sel": ".d-set-main .d-set-sec > .d-set-sec-t",
      "reason": "**取样差异（分节页头已退）**：画板每个分节顶部都有一行独立的 .pw-shead（标题 h2 + 一句 p.sub）；v5 的**常规分节没有页头块** —— 分节标题退成弹窗级的一行 .settings-dialog-header.d-modal-head（见 40-settings-general 那一份），内容区直接从第一块 .d-set-sec 开始。所以 .pw-shead-copy > h2 这一对量的是**内容区里最近的一行分节标题**（.d-set-sec-t），不是页头标题。页头本身的差由 40-settings-general 量。"
    },
    {
      "sel": ".d-set-main .d-set-row > .d-set-row-box > .d-set-row-s",
      "reason": "**取样差异（分节页头已退）**：同上一条 —— 画板页头上那句 p.sub 在 v5 的常规分节里没有位置；这一对量的是内容区里最近的一行**行内说明**（.d-set-row-s，字阶与 v1 的 .pw-hint 同档）。"
    },
    {
      sel: ".d-set-main .d-grid2",
      reason:
        "**取样差异（两栏块流 → 单列）**：画板帧 2 明确画的是「两栏块流，每栏 570 —— "
        + "字段行跨度从 1160 收到 570」；v5 的常规分节是**单列**（`SettingsPanel.tsx:486` 的 "
        + "`div.d-set-inner`，`system.css:483` 的 `max-width:720 + margin:auto`）。"
        + "**这是一处真实的几何差**：两栏 570×2 → 单列 720 居中。",
    },
    {
      sel: ".d-set-main .d-set-sec",
      reason:
        "**取样差异（v1 卡片 → v5 分节）**：`.pw-block` 的描边 / 圆角 / 内距随 v5「无框分节」裁定退场。"
        + "块高按内容；画板帧画的是「外观 / 主题皮肤 / 侧栏 / 字体」四块，产品的分节集合与之不同"
        + "（皮肤卡数量按已装皮肤数），属取样差异。",
    },
    {
      sel: ".d-set-main .d-set-row",
      reason:
        "**形态差异**：`.pw-field`（board.css:781，一行标签 + 右控件，`justify-content:space-between`）"
        + "↔ v5 的 `.d-set-row`（`system.css:486`，左标题盒 + 右 `margin-left:auto` 控件槽）。"
        + "字段密度接线（标签 132px 下限 + 控件放不下换行）随该形态一起退场。",
    },
    {
      sel: ".d-set-main .d-set-row-t",
      reason: "标签宽度由文字长度决定；画板帧与产品的行集合不完全相同（画板是节选）",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};