// 画板 22 顶栏下拉合集 —— 帧 0（会话切换器）
//
// 量会话切换器下拉的弹层三件（.pw-pop / .pw-pop-title / .pw-prow）。
// 选中态 .pw-prow.is-on 不在这里量：切换器里哪一行高亮取决于「当前会话是哪条」，数据依赖。
// 预设先开一条会话再点顶栏标题。
const POP = [".pw-pop", ".pw-pop-title", ".pw-prow"];

export default {
  name: "顶栏会话切换器（画板 22 · 帧 0）",
  board: "22-top-panels.html",
  boardFrame: 0,
  app: { open: "topbar:session-switcher" },
  selectors: POP,
  knownDiffs: [],
  tolerance: { box: 2, fontSize: 0 },
};
