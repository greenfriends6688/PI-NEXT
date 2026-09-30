// SW-15 设置页新框架（画板 62 · 帧 C 两栏块流）—— 常规 / 用量这类「没有条目概念」的分节。
//
// 与 62-settings-layout.mjs（帧 B 列表页）成对：帧 B 验「列表 300 + 内容 760」，
// 帧 C 验「两栏块流 570 × 2 + 字段行跨度」。两份合起来覆盖画板 62 的两个骨架。
//
// 用法：node scripts/board-diff.mjs scripts/board-specs/62-settings-blockflow.mjs
export default {
  name: "设置新框架（画板 62 · 帧 C 两栏块流）",
  board: "62-settings-layout.html",
  boardFrame: 2,
  app: { open: "settings:general" },
  selectors: [
    ".pw-settings",
    ".pw-shead",
    ".pw-shead-copy > h2",
    ".pw-shead-copy > p.sub",
    ".pw-scontent",
    ".pw-grid2",
    ".pw-block",
    ".pw-field",
    ".pw-label",
    ".pw-switch",
  ],
  tolerance: { box: 2, fontSize: 0 },
  knownDiffs: [
    {
      sel: ".pw-block",
      reason: "块高按内容；画板帧画的是「外观 / 主题皮肤 / 侧栏 / 字体」四块，"
        + "产品左栏是同一组，但皮肤卡片数量不同（画板 2 张 + 新建，产品按已装皮肤数）",
    },
    {
      sel: ".pw-field",
      reason: "fork:settings-field-density 接线（标签 132px 下限 + 放不下换行），"
        + "settings.css 有注释登记，画板 40 的 spec 也登记过同一条",
    },
    {
      sel: ".pw-label",
      reason: "标签宽度由文字长度决定；画板帧与产品的行集合不完全相同（画板是节选）",
    },
  ],
};
