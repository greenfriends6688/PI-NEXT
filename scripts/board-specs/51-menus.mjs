// 画板 51 菜单原子 —— 帧 0
//
// 帧 0 是菜单**原语合集**（同一个 .pw-pop 里把搜索头 / 分组标题 / 行 / 分隔 / kbd 都画一遍）。
// 产品里这些原语分布在不同下拉（思考档、工具档、MCP 浮窗、@ 引用…），
// 所以这里量「弹层壳 + 行」。
// fork:no-recent-sessions（2026-10-01）—— 原先用顶栏「最近会话」浮窗当量尺，那扇浮窗已撤；
// 换成输入框工具条的思考档下拉（`composer:model-menu`），量的仍是同三个原语。
// fork:v5-old-layer（2026-10-04）—— 弹层三件已换画板 D-02b/D-11 的 v5 类：
// 壳 `.d-pop-float`（TopBarPopovers.tsx:105/207，思考档下拉是 ChatInput.tsx:994 的
// `.d-pop`）/ 头 `.d-pop-title`（:209）/ 行 `.d-menu-row`（:210）。旧的
// `.pw-pop` / `.pw-pop-title` / `.pw-prow` 在产品里已不存在（只剩注释），
// 照旧名取会一路报「产品里没有这个选择器」。画板侧仍取 v1 的 pw-*。
const POP = [[".pw-pop", ".d-pop"], [".pw-pop-title", ".d-pop-title"], [".pw-prow", ".d-menu-row"]];

export default {
  name: "菜单原语（画板 51 · 帧 0）",
  board: "51-menus.html",
  boardFrame: 0,
  app: { open: "composer:model-menu" },
  pairs: POP,
  knownDiffs: [],
  tolerance: { box: 2, fontSize: 0 },
};
