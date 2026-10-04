// SW-15 设置页新框架（画板 62 · 帧 B 列表页）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况：
// SettingsPanel.tsx:1198-1240 设壳 + SettingsUi.tsx:103-480 基件）。
// **画板侧一行不动**，两边靠 pairs 显式配对。
//
// 为什么补这一份：画板 62 定义了设置分节的统一骨架（页头 / 工具栏 / 唯一滚动的内容区
// / 两个宽度「列表 300 + 内容 760」），但当时没有配 spec，「画板画了、实现没跟上」
// 只能靠人眼发现。这一份把差距变成数字。
const OPEN_SKILLS = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="skills"]');
  if (!row) throw new Error("settings section not found: skills");
  row.click();
  await new Promise((r) => setTimeout(r, 2000));
  // fork:v5-settings-map —— 画板帧 1 量的是选中一条技能之后的右列（含 SKILL.md 文本域），
  // 默认停在空态，点开第一行再量。
  const first = document.querySelector(".d-set-nav .d-sess");
  if (first) { first.click(); await new Promise((r) => setTimeout(r, 1600)); }`;

export default {
  name: "设置新框架（画板 62 · 帧 B 列表页）",
  board: "62-settings-layout.html",
  // 帧 0 = 诊断，帧 1 = 新框架解剖（列表页形态），帧 2 = 两栏块流
  boardFrame: 1,
  app: { script: OPEN_SKILLS, settle: 2200 },
  pairs: [
    [".pw-settings", ".settings-dialog-body.d-set"],
    [".pw-snav", ".settings-section-tabs.d-set-nav"],
    [".pw-shead", ".d-set-main .d-set-sec"],
    [".pw-shead-copy > h2", ".d-set-main .d-set-sec > .d-row > .d-t-lg.d-t-b"],
    [".pw-stools", ".d-set-main .d-set-sec + .d-row"],
    [".pw-scontent", ".d-set-main"],
    [".pw-cols", ".d-set-main .d-set"],
    [".pw-list", ".d-set-nav > .d-col"],
    [".pw-litem", ".d-set-nav .d-sess"],
    [".pw-detail", ".d-set-main .d-set > .d-set-inner"],
    [".pw-kv", ".d-set-main .d-set-inner .d-set-row"],
  ],
  knownDiffs: [
    {
      sel: ".settings-section-tabs.d-set-nav",
      reason:
        "**取样差异**：画板帧的左导航里画着 12 个分节 + 一枚「返回工作区」；产品导航只有 11 项"
        + "（记忆 / 快捷键 / 自定义命令 2026-10-01 下线，「返回工作区」同日按用户裁定撤掉 —— "
        + "弹窗右上角的关闭钮是唯一出口）。高度差来自**行数不同**，属接线层，不是漂移。",
    },
    {
      sel: ".d-set-main .d-set-sec",
      reason:
        "**取样差异（页头 → 分节）**：v1 的 `.pw-shead` 是一行页头（下边框 + `align-items:flex-end`）；"
        + "v5 的 `SettingsPage`（`SettingsUi.tsx:618-631`）收成 `div.d-set-sec`。",
    },
    {
      sel: ".d-set-main .d-set-sec + .d-row",
      reason:
        "**取样差异（`.pw-stools`）**：board.css:741 的工具栏是「40 高 + 上下发丝边框 + 左右 40px」"
        + "的一条独立横条；v5 只发一块普通 `div.d-row`。真实几何差：工具条从 40 高带双边框变成内容行高。",
    },
    {
      sel: ".d-set-main .d-set",
      reason:
        "**取样差异（列表 300 + 内容 760 → 220 定宽 + 720 居中）**：board.css:899 的 `.pw-cols` 写死 "
        + "`300px minmax(0,760px)`；v5 的 `ConfigSplitView` 发 `div.d-set`（纯 flex，不写列宽），"
        + "列宽落在 `.d-set-nav`（220 定宽）与 `.d-set-inner`（max-width 720 居中）。"
        + "**这是一处真实的几何差**：画板定的两个宽度（300 / 760）在 v5 变成 220 / 720。",
    },
    {
      sel: ".d-set-nav .d-sess",
      reason:
        "**形态差异**：`.pw-litem`（board.css:901，7px/8px + 圆角 4 + gap 8）↔ v5 的技能行发 "
        + "`button.d-sess`（`system.css:49`，整行块级无描边）。行骨架相同，档位按 v5 系统表取值。",
    },
    {
      sel: ".d-set-main .d-set > .d-set-inner",
      reason:
        "**取样差异（详情卡 → 内容列）**：`.pw-detail`（board.css:923，描边 + 圆角 6 + 内距 12/16）"
        + "在 v5 被撤掉（`SkillsConfig.tsx:1459` 的注释同款）；右列就是 `.d-set-inner`。"
        + "画板帧画的是「SKILL.md 可编辑 + 磁盘冲突」那一态，v5 的详情高度按内容收口。",
    },
    {
      sel: ".d-set-main .d-set-inner .d-col",
      reason:
        "**取样差异（`.pw-kv`）**：v1 的 `.pw-kv` 是「标签 / 值」纵向表；v5 的 `ConfigKv`"
        + "（`SettingsUi.tsx:297`）只发一个 `dl.d-col`。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};