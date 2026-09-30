// SW-07 设置壳（已完成的批次）—— 用来验证 board-diff 工具本身可用
export default {
  name: "设置壳（画板 40 · 帧 0）",
  board: "40-settings-general.html",
  boardFrame: 0,
  app: { open: "settings:general" },
  selectors: [
    ".pw-settings",
    ".pw-snav",
    ".pw-snav .pw-row",
    ".pw-snav .pw-name",
    ".pw-sbody",
    ".pw-block",
    ".pw-field",
    ".pw-label",
    ".pw-switch",
    ".pw-radio",
    ".pw-selectbox",
  ],
  // 画板 40 画了六档主题（浅/深/跟随 + 雾/玫瑰/松），产品只保留三档
  // （计划 §6.3 历史裁定「主题三档 light/dark/auto」）。宽度差来自选项个数，不是样式。
  knownDiffs: [
    { sel: ".pw-radio", reason: "主题六档 vs 三档（历史裁定保留三档，DIVERGENCE 已登记）" },
    {
      sel: ".pw-field",
      reason: "gap 6 16 vs 画板 16：fork:settings-field-density 接线（控件放不下换行、"
        + "标签 132px 下限），settings.css 有注释登记",
    },
  ],
};
