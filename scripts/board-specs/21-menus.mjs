// 画板 21 弹层合集 —— 输入框上的下拉（模型 / 思考档 / 工具 / 权限 / @ 引用）
//
// 产品的下拉有两种写法：思考档 / 工具 / 权限走画板原子（`.anim-popover.pw-pop` +
// `.pw-prow`），模型选择器是自绘浮层。这份规格量「第一个打开的下拉」，
// 也就是思考档那一族，画的与实现的是不是同一套盒子。
const SAME = [".pw-pop", ".pw-pop-title", ".pw-prow", ".pw-prow.is-on"];

export default {
  name: "输入框下拉（画板 21 · 弹层合集）",
  board: "21-menus.html",
  boardFrame: 0,
  app: { open: "composer:model-menu" },
  pairs: SAME.map((s) => [s, s]),
  knownDiffs: [],
  tolerance: { box: 2, fontSize: 0 },
};
