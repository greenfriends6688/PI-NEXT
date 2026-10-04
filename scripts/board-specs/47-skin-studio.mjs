// SW-13 皮肤工作室外壳（画板 47 · 帧 1）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （产品实况：ThemeSkinStudio.tsx:416/423/429/445/472/726）。
// **画板侧一行不动**，两边靠 pairs 显式配对。
//
// 两个修正（一份是换皮前的，两份是换皮后新发现的）：
// 1) 驱动要**真正打开工作室**。原驱动 settings:general 下 probe 量到的是设置壳自己的
//    弹层，于是「工作室已经不是 .pw-modal 结构」那条 knownDiff 是**基于错误对象的结论**。
// 2) 选择器加宿主限定：工作室的浮层在 v5 是 .d-modal.is-open.fork-skin-scrim >
//    .d-modal-box.wide.fork-skin-modal，而设置壳自己也有一个 .d-modal-head
//    （settings-dialog-header，在 .settings-dialog-surface 内），不限定会量错对象。
const OPEN_SKIN_STUDIO = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="general"]');
  if (!row) throw new Error("settings section not found: general");
  row.click();
  await new Promise((r) => setTimeout(r, 1800));
  const card = document.querySelector(".pw-skin.is-new");
  if (!card) throw new Error("皮肤条上的「新建皮肤」卡没找到");
  card.click();
  await new Promise((r) => setTimeout(r, 1600));`;

export default {
  name: "皮肤工作室外壳（画板 47 · 帧按实现）",
  board: "47-skin-studio.html",
  boardFrame: 1,
  app: { settle: 1800, script: OPEN_SKIN_STUDIO },
  // 都限定在工作室自己的浮层内 —— 设置壳也有一个同名 .d-modal-head，不限定会量错对象。
  pairs: [
    [".fork-skin-modal", ".fork-skin-scrim > .d-modal-box"],
    [".fork-skin-modal .pw-modal-head", ".fork-skin-scrim .d-modal-head"],
    [".pw-tabs", ".fork-skin-scrim .d-tabs"],
    [".pw-tab", ".fork-skin-scrim .d-tab"],
    [".fork-skin-modal .pw-modal-body", ".fork-skin-scrim .d-modal-body"],
    [".pw-field", ".fork-skin-scrim .d-field"],
    [".pw-radio", ".fork-skin-scrim .d-seg"],
    [".pw-selectbox", ".fork-skin-scrim .d-select"],
    [".fork-skin-modal .pw-modal-foot", ".fork-skin-scrim .d-modal-foot"],
  ],
  // 画板的 shell 帧是 200px 演示列，产品内容行是 1fr + 340px（帧 1 的真实布局）。
  knownDiffs: [
    {
      sel: ".fork-skin-scrim > .d-modal-box",
      reason:
        "**取样差异（宿主名换过 + 尺寸档位）**：v1 的工作室浮层是 `.pw-modal`（board.css 的 560 默认宽，"
        + "画板内联压到 900×720）；v5 拆成「遮罩 `.d-modal` + 盒子 `.d-modal-box.wide`」两层"
        + "（`system.css:425-437`），工作室盒子带 `fork-skin-modal` 把 900×720 写回类里。"
        + "这一对量的是**盒子**本体（v1 是浮层本体）。",
    },
    {
      sel: ".fork-skin-scrim .d-field",
      reason:
        "**形态差异**：`.pw-field`（board.css:781，一行标签 + 右控件，`justify-content:space-between`）"
        + "↔ v5 的纵向 `.d-field`（`system.css:503`，`column; gap:6`）。字段密度接线（标签 132px 下限 + "
        + "控件放不下换行）随该形态一起退场。",
    },
    {
      sel: ".fork-skin-scrim .d-seg",
      reason:
        "**取样差异（v5 没有单选组 + 位置）**：画板帧的 `.pw-radio` 容器继承正文 13px / 500，"
        + "产品那一枚继承 12px / 400；承载它的是 `span.d-seg`（工作室里走 `PwChips`）。"
        + "芯片本身两边都是 11px 一档。",
    },
    {
      sel: ".fork-skin-scrim .d-modal-body",
      reason: "演示帧 200px 预览列 vs 产品 340px（画板 47 帧 1 的真实值）",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};