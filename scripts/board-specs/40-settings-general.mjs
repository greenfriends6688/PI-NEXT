// 画板 40 常规分节 —— 区块节奏与皮肤条
export default {
  name: "设置 · 常规（画板 40 · 帧 0）",
  board: "40-settings-general.html",
  boardFrame: 0,
  app: { open: "settings:常规" },
  selectors: [
    ".pw-settings",
    ".pw-snav",
    ".pw-sbody",
    ".pw-sbody > h2",
    ".pw-sec-title",
    ".pw-block",
    ".pw-block > h3",
    ".pw-field",
    ".pw-field .pw-label",
    ".pw-radio",
    ".pw-skin-strip",
    ".pw-skin",
    ".pw-skin .prev",
    ".pw-skin .cap",
    ".pw-btn.outline.sm",
    ".pw-switch",
    ".pw-selectbox",
  ],
  knownDiffs: [
    {
      sel: ".pw-field",
      reason:
        "fork:settings-field-density 接线（标签 132px 下限 + 控件放不下换行），settings.css 有注释登记；画板 40 的 spec 也登记过同一条",
    },
    {
      sel: ".pw-skin-strip",
      reason:
        "产品接线层给皮肤条补了 padding-bottom 2px（皮肤卡阴影的呼吸位），画板是 0 —— 外观值一致，只差这一档留白",
    },
    {
      sel: ".pw-skin .cap",
      reason:
        "皮肤卡脚注：画板用 flex 横排，产品用 grid（名字 + 可选徽章两行对齐），board 47 的皮肤条规格为准",
    },
    {
      sel: ".pw-radio",
      reason: "主题六档 vs 产品三档（历史裁定保留 light/dark/auto，DIVERGENCE 已登记）。",
    },
  ],
};
