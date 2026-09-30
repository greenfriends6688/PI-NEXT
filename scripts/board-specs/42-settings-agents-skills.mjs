// SW-09 子代理 / 技能（2026-09-30 收尾轮补规格）—— ConfigSplitView 双栏骨架
export default {
  name: "子代理与技能（画板 42）",
  board: "42-settings-agents-skills.html",
  boardFrame: 0,
  app: { open: "settings:agents" },
  selectors: [
    ".pw-cols",
    ".pw-list",
    ".pw-litem",
    ".pw-lname",
    ".pw-lsub",
    ".pw-detail",
    ".pw-field",
    ".pw-label",
    ".pw-switch",
    ".pw-badge",
  ],
  knownDiffs: [
    {
      sel: ".pw-field",
      reason:
        "fork:settings-field-density 接线（标签 132px 下限 + 控件放不下换行），settings.css 有注释登记；画板 40 的 spec 也登记过同一条",
    },
  ],
};
