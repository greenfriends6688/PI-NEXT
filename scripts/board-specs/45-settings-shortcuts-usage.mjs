// 画板 45 设置 · 快捷键与用量（帧 A 快捷键）
//
// 同 44：控件词表以 62 的基件为准（.pw-field/.pw-label/.pw-ctl/.pw-radio），
// 画板里的 .pw-input/.pw-kbd 是旧口径、不再逐项比；量**壳与字段基件**。
const SHELL = [".pw-field", ".pw-label", ".pw-ctl", ".pw-radio"];

export default {
  name: "快捷键（画板 45 · 帧 A）",
  board: "45-settings-shortcuts-usage.html",
  boardFrame: 0,
  app: { open: "settings:general" },
  selectors: SHELL,
  knownDiffs: [
    {
      sel: ".pw-field",
      reason: "同 62/40 的 fork:settings-field-density 接线（标签下限 + gap 6/16）；既有登记。",
    },
    {
      sel: ".pw-label",
      reason: "同 .pw-field 的标签下限接线。",
    },
    {
      sel: ".pw-radio",
      reason:
        "**画板自身不一致（B 类）**：board.css:799 的 `.pw-radio > span` 是 font-size var(--text-meta)=12px，"
        + "但画板 45 帧里的样张写成了 13px（--text-body）。产品照 board.css 的规则做 12px —— "
        + "以规则为准、样张待设计侧修正。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};
