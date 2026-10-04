// SW-08 模型分节（画板 41 · 帧 0：供应商列表 + 详情）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况：
// SettingsUi.tsx:103-480 的分栏基件 + ModelsConfig.tsx:3213-3230）。
// **画板侧一行不动**，两边靠 pairs 显式配对。
const OPEN_MODELS = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="models"]');
  if (!row) throw new Error("settings section not found: models");
  row.click();
  await new Promise((r) => setTimeout(r, 2000));`;

export default {
  name: "模型分节（画板 41 · 帧 0）",
  board: "41-settings-models.html",
  boardFrame: 0,
  app: { script: OPEN_MODELS, settle: 2200 },
  pairs: [
    [".pw-settings", ".settings-dialog-body.d-set"],
    [".pw-snav", ".settings-section-tabs.d-set-nav"],
    [".pw-sbody", ".settings-dialog-main"],
    [".pw-cols", ".d-set-main .d-set"],
    [".pw-list", ".d-set-nav > .d-col"],
    [".pw-litem", ".d-set-nav .d-trow"],
    [".pw-lname", ".d-set-nav .d-trow .d-t-sm.d-t-b"],
    [".pw-lsub", ".d-set-nav .d-trow .d-t-xs.d-t-faint"],
    [".pw-group-title", ".d-group-title"],
    [".pw-detail", ".d-set-main .d-set > .d-set-inner"],
    [".pw-kv", ".d-set-main .d-set-inner .d-grid2"],
    [".pw-stats-grid", ".d-set-main .d-statgrid"],
    [".pw-stat", ".d-set-main .d-stat"],
    [".pw-field", ".d-set-main .d-field"],
    [".pw-label", ".d-set-main .d-field-t"],
    [".pw-btn", ".d-set-main .d-btn"],
    [".pw-badge", ".d-set-main .d-badge"],
  ],
  knownDiffs: [
    {
      sel: ".d-set-main .d-field",
      reason:
        "**形态差异**：`.pw-field`（board.css:781，一行标签 + 右控件，`justify-content:space-between`）"
        + "↔ v5 的纵向 `.d-field`（`SettingsUi.tsx:377` / `system.css:503`）。字段密度接线随该形态一起退场。",
    },
    {
      sel: ".d-set-main .d-set > .d-set-inner",
      reason:
        "**取样差异（详情卡 → 内容列）**：board.css:923 的 `.pw-detail` 是「描边 + 圆角 6 + 内距 12/16」的一张巨卡；"
        + "v5 明确撤掉这一层（`ModelsConfig.tsx:3213`：「右列是 `.d-set-inner`，不再套一张撑满高度的巨卡 —— "
        + "那是『弹窗影子』的来源」）。这一对量的是**右列本体**。",
    },
    {
      sel: ".d-set-main .d-set",
      reason:
        "**取样差异（列表+详情 → 两栏壳）**：board.css:899 的 `.pw-cols` 写死 `300px minmax(0,760px)`；"
        + "v5 的 `ConfigSplitView` 发 `div.d-set`（纯 flex，不写列宽），列宽落在 `.d-set-nav`（220 定宽）"
        + "与 `.d-set-inner`（max-width 720 居中）。**这是一处真实的几何差**：300+760 → 220+720 居中。",
    },
    {
      sel: ".d-set-nav .d-trow",
      reason:
        "**形态差异**：`.pw-litem`（board.css:901，7px/8px + 圆角 4 + gap 8）↔ v5 的 `button.d-trow`"
        + "（`system.css:687`，26 高 + 左右 8px + gap 6）。行骨架相同，档位按 v5 系统表取值。",
    },
    {
      sel: ".d-set-main .d-grid2",
      reason:
        "**取样差异（`.pw-kv` → 两栏字段）**：v1 的 `.pw-kv` 是「标签 / 值」纵向表；v5 换成 `.d-grid2 > .d-field`"
        + "（`ModelsConfig.tsx:683`）。`ConfigKv`（`SettingsUi.tsx:297`）现在只发一个 `dl.d-col`，供应商详情不再用它。",
    },
    {
      sel: ".d-set-main .d-statgrid",
      reason:
        "**数据依赖**：「用量摘要（近 30 天）」那张卡网格要么还在统计、要么按数据出现；"
        + "跑对位时那一格可能只有标题没有卡片。这是数据依赖，不是漂移。",
    },
    {
      sel: ".d-set-main .d-stat",
      reason: "**数据依赖**：同上（单张统计卡随 `.d-statgrid` 一起出现或一起不出现）。",
    },
    {
      sel: ".d-set-nav .d-trow",
      reason:
        "**数据依赖**：种子环境（verify-boards-live 的临时 agent 目录）里供应商行随 `models.json` 变；"
        + "对着本机真服务跑时会列出来并逐项对位。",
    },
    {
      sel: ".d-set-nav .d-trow .d-t-sm.d-t-b",
      reason: "**数据依赖**：供应商行的名字列（随 `.d-trow` 一起才有）。",
    },
    {
      sel: ".d-set-nav .d-trow .d-t-xs.d-t-faint",
      reason: "**数据依赖**：供应商行的副标题列（随 `.d-trow` 一起才有）。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};