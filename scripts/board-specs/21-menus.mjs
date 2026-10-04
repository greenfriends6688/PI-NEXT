// 画板 21 弹层合集 —— 输入框上的下拉（模型 / 思考档 / 工具 / 权限 / @ 引用）
//
// 产品的下拉有两种写法：思考档 / 工具 / 权限走画板原子（`.anim-popover.pw-pop` +
// `.pw-prow`），模型选择器是自绘浮层。这份规格量「第一个打开的下拉」，
// 也就是思考档那一族，画的与实现的是不是同一套盒子。
// fork:v5-old-layer（2026-10-04）—— 思考档下拉已换 v5：壳是 ChatInput.tsx:994 的
// `.d-pop`，头是 `.d-pop-title`（:1005），行是 `.d-menu-row`（:1039）。
// 画板侧仍取 v1 的 pw-*。
const SAME = [
  [".pw-pop", ".d-pop"],
  [".pw-pop-title", ".d-pop-title"],
  [".pw-prow", ".d-menu-row"],
  [".pw-prow.is-on", ".d-menu-row.is-on"],
];

export default {
  name: "输入框下拉（画板 21 · 弹层合集）",
  board: "21-menus.html",
  boardFrame: 0,
  app: { open: "composer:model-menu" },
  pairs: SAME,
  knownDiffs: [],
  tolerance: { box: 2, fontSize: 0 },
};
