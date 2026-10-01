// 画板 51 菜单原子 —— 帧 0
//
// 帧 0 是菜单**原语合集**（同一个 .pw-pop 里把搜索头 / 分组标题 / 行 / 分隔 / kbd 都画一遍）。
// 产品里这些原语分布在不同下拉（思考档、工具档、会话切换器、@ 引用…），
// 所以这里量「弹层壳 + 行」：打开会话切换器（帧 0 那种最完整的弹层）。
const POP = [".pw-pop", ".pw-pop-title", ".pw-prow"];

export default {
  name: "菜单原语（画板 51 · 帧 0）",
  board: "51-menus.html",
  boardFrame: 0,
  app: { open: "topbar:session-switcher" },
  selectors: POP,
  knownDiffs: [],
  tolerance: { box: 2, fontSize: 0 },
};
