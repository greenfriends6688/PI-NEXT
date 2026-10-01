// 画板 22 顶栏下拉合集 —— 帧 0
//
// 量顶栏下拉族的弹层三件（.pw-pop / .pw-pop-title / .pw-prow）。
// 选中态 .pw-prow.is-on 不在这里量：哪一行高亮取决于「当前会话是哪条」，数据依赖。
//
// fork:no-recent-sessions（2026-10-01）—— 画板帧里的「最近会话」浮窗已从产品撤掉
// （顶栏标题不再有下拉），产品侧改用**同族的另一扇弹层**量这三个原语：输入框工具条的
// 思考档下拉（`composer:model-menu`）。量的是壳 / 头 / 行本身，不依赖是哪一扇浮层。
const POP = [".pw-pop", ".pw-pop-title", ".pw-prow"];

export default {
  name: "顶栏下拉（画板 22 · 帧 0 · 弹层原语）",
  board: "22-top-panels.html",
  boardFrame: 0,
  app: { open: "composer:model-menu" },
  selectors: POP,
  knownDiffs: [],
  tolerance: { box: 2, fontSize: 0 },
};
