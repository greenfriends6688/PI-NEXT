// SW-07 设置壳（画板 40 · 帧 0）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况：SettingsPanel.tsx:1198-1240）。
// **画板侧一行不动**，两边靠 pairs 显式配对。
// 这一份专门盯**设壳三层**：.pw-settings → .pw-snav → .pw-sbody 与里面的行。
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
  name: "设置壳（画板 40 · 帧 0）",
  board: "40-settings-general.html",
  boardFrame: 0,
  app: { script: OPEN_GENERAL, settle: 1600 },
  pairs: [
    [".pw-settings", ".settings-dialog-body.d-set"],
    [".pw-snav", ".settings-section-tabs.d-set-nav"],
    [".pw-snav .pw-row", ".settings-section-tabs .d-set-navitem"],
    [".pw-snav .pw-name", ".settings-section-tabs .d-set-navitem"],
    [".pw-sbody", ".settings-dialog-main"],
    [".pw-block", ".d-set-main .d-set-sec"],
    [".pw-field", ".d-set-main .d-set-row"],
    [".pw-label", ".d-set-main .d-set-row-t"],
    [".pw-switch", ".d-switch"],
    [".pw-radio", ".d-seg"],
    [".pw-selectbox", ".d-select"],
  ],
  knownDiffs: [
    {
      sel: ".settings-section-tabs .d-set-navitem",
      reason:
        "**取样差异**：v1 的导航行把图标与文案分装在 `.pw-ico` + `.pw-name` 两个壳里；"
        + "v5 的 `button.d-set-navitem` 直接放文案，**没有独立的名字类**。"
        + "所以 `.pw-snav .pw-row` 与 `.pw-snav .pw-name` 两对都落到同一枚按钮上 ——"
        + "行本体（高 / 内距 / 字号 / 字重 / 选中态底色）仍逐项对位。",
    },
    {
      sel: ".settings-dialog-main",
      reason:
        "**取样差异**：`.pw-sbody`（board.css:713）是「`overflow:hidden` + 左右 40px 内距」的外壳；"
        + "v5 拆成 `main.settings-dialog-main`（零几何）+ 里层 `.d-set-main`（`overflow-y:auto` + `padding: sp-6 sp-8`）。",
    },
    {
      sel: ".d-set-main .d-set-sec",
      reason:
        "**取样差异（v1 卡片 → v5 分节）**：`.pw-block` 的描边 / 圆角 / 内距随 v5「无框分节」裁定退场。",
    },
    {
      sel: ".d-set-main .d-set-row",
      reason:
        "**形态差异**：`.pw-field`（board.css:781，`justify-content:space-between`）↔ "
        + "v5 的 `.d-set-row`（`system.css:486`，左标题盒 + 右 `margin-left:auto` 控件槽）。"
        + "字段密度接线（标签 132px 下限 + 控件放不下换行）已随该形态一起退场。",
    },
    {
      sel: ".d-seg",
      reason:
        "**取样差异（v5 没有单选组）**：画板 40 画了六档主题（浅 / 深 / 跟随 + 雾 / 玫瑰 / 松），"
        + "产品只保留三档（历史裁定 light/dark/auto，DIVERGENCE 已登记），且承载它的是 `span.d-seg`。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};