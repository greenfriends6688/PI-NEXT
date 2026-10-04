// 画板 40 常规分节 —— 区块节奏与皮肤条
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况）。
// **画板侧一行不动**，两边靠 pairs 显式配对。
// 驱动换成 spec 自带的 app.script（settings:* 预设的入口/分节行选择器在换皮后失效）。
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
  name: "设置 · 常规（画板 40 · 帧 0）",
  board: "40-settings-general.html",
  boardFrame: 0,
  app: { script: OPEN_GENERAL, settle: 1600 },
  pairs: [
    // 设壳
    [".pw-settings", ".settings-dialog-body.d-set"],
    [".pw-snav", ".settings-section-tabs.d-set-nav"],
    [".pw-sbody", ".settings-dialog-main"],
    [".pw-sbody > h2", ".settings-dialog-header .settings-dialog-title"],
    // 内容区
    [".pw-sec-title", ".d-set-main .d-set-sec-t"],
    [".pw-block", ".d-set-main .d-set-sec"],
    [".pw-block > h3", ".d-set-main .d-set-sec > .d-set-sec-t"],
    [".pw-field", ".d-set-main .d-set-row"],
    [".pw-field .pw-label", ".d-set-main .d-set-row-t"],
    [".pw-radio", ".d-seg"],
    // 皮肤条（v5 里仍是产品实际发的 pw-*，两侧都原样保留）
    [".pw-skin-strip", ".settings-dialog-surface .pw-skin-strip"],
    [".pw-skin", ".settings-dialog-surface .pw-skin"],
    [".pw-skin .prev", ".settings-dialog-surface .pw-skin .prev"],
    [".pw-skin .cap", ".settings-dialog-surface .pw-skin .cap"],
    // 原子
    [".pw-btn.outline.sm", ".d-btn.sm"],
    [".pw-switch", ".d-switch"],
    [".pw-selectbox", ".d-select"],
  ],
  knownDiffs: [
    {
      sel: ".settings-dialog-header .settings-dialog-title",
      reason:
        "**取样差异**：board.css:714 的 `.pw-sbody > h2` 是**分节级**标题（常规 / 模型 / …，`text-title` + 500）；"
        + "v5 把分节标题收进内容区的一块 `.d-set-sec`，弹窗头行只剩一枚全局的「设置」"
        + "（`SettingsPanel.tsx:1174` 的 `settings-dialog-header.d-modal-head`）。这一对量的是**全局弹窗标题**，"
        + "不是分节标题 —— 两者不是同一个件，所以按取样差异登记。",
    },
    {
      sel: ".d-set-main .d-set-sec",
      reason:
        "**取样差异（v1 卡片 → v5 分节）**：board.css:776 的 `.pw-block` 是「margin-top 16 + 描边 + 圆角 6 + 内距 12/16」"
        + "的一张卡；v5 把同一块放平成 `div.d-set-sec`（`system.css:484`，无描边无圆角）。标题行与行流仍逐项对位。",
    },
    {
      sel: ".d-set-main .d-set-row",
      reason:
        "**形态差异**：`.pw-field`（board.css:781）是「一行标签 + 右侧控件，`justify-content:space-between`」；"
        + "v5 的 `.d-set-row`（`system.css:486`）是「左标题盒 + 右控件槽 `margin-left:auto`」。同一行的骨架，档位按 v5 系统表取值。",
    },
    {
      sel: ".d-seg",
      reason:
        "**取样差异（v5 没有单选组）**：v1 的 `.pw-radio` 是一排圆角小片；v5 的 `.d-radio` / `.d-radiorow` "
        + "只在 `system.css` 里定义、产品一个都没发，实际承载「主题三档」的是 `span.d-seg`。",
    },
    {
      sel: ".settings-dialog-surface .pw-skin-strip",
      reason:
        "**取样差异（皮肤条尚未换皮）**：`.pw-skin-strip` / `.pw-skin` / `.cap` 是产品**现在实际发的类**"
        + "（v5 设置面板里仅剩的 `pw-*`），两侧原样保留。接线层补了 padding-bottom 2px。",
    },
    {
      sel: ".settings-dialog-surface .pw-skin .cap",
      reason:
        "皮肤卡脚注：画板用 flex 横排，产品用 grid（名字 + 可选徽章两行对齐），board 47 的皮肤条规格为准。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};