// 画板 22 顶栏下拉合集 —— 帧 0
//
// 量顶栏下拉族的弹层三件（.pw-pop / .pw-pop-title / .pw-prow）。
// 选中态 .pw-prow.is-on 不在这里量：哪一行高亮取决于「当前会话是哪条」，数据依赖。
//
// fork:no-recent-sessions（2026-10-01）—— 画板帧里的「最近会话」浮窗已从产品撤掉
// （顶栏标题不再有下拉），产品侧改用**同族的另一扇弹层**量这三个原语：输入框工具条的
// 思考档下拉（`composer:model-menu`）。量的是壳 / 头 / 行本身，不依赖是哪一扇浮层。
// fork:v5-old-layer（2026-10-04）—— 弹层三件已换画板 D-02b/D-11 的 v5 类：
// 壳 `.d-pop-float`（TopBarPopovers.tsx:105/207，思考档下拉是 ChatInput.tsx:994 的
// `.d-pop`）/ 头 `.d-pop-title`（:209）/ 行 `.d-menu-row`（:210）。旧的
// `.pw-pop` / `.pw-pop-title` / `.pw-prow` 在产品里已不存在（只剩注释），
// 照旧名取会一路报「产品里没有这个选择器」。画板侧仍取 v1 的 pw-*。
const POP = [[".pw-pop", ".d-pop"], [".pw-pop-title", ".d-pop-title"], [".pw-prow", ".d-menu-row"]];

export default {
  name: "顶栏下拉（画板 22 · 帧 0 · 弹层原语）",
  board: "22-top-panels.html",
  boardFrame: 0,
  app: { open: "composer:model-menu" },
  pairs: POP,
  knownDiffs: [],
  tolerance: { box: 2, fontSize: 0 },
};
