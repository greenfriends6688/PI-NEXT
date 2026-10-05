// M-03 帧 A · 静息输入卡（`.m-composer-wrap` 一段）
// 说明：
//   · 视口 390×844（手机档，isMobile 走 m-* 分支）；
//   · `.m-tray`（工作区/待办芯片，随会话恢复异步出现，会让比对抖动）→ appSkip；
//   · 高亮 overlay（`.chat-input-highlight-wrap`）无形态类，工具的 skipBare 已自动略过。
export default {
  name: "M-03 帧A · 手机输入卡",
  board: "v5/pwa/boards/M-03-composer-sheet.html",
  frame: 0,
  boardRoot: ".m-composer-wrap",
  viewport: { width: 390, height: 844 },
  app: { script: `/* 静息 */` },
  // 产品里此刻有两层 .m-composer-wrap（外层是别的接线刚加的壳，含 .m-fade-tail），
  // 板面只有一枚 —— 这里取**内层**那枚真正装输入卡的那层，外层的重复已在汇报里登记。
  appRoot: ".m-composer-wrap .m-composer-wrap",
  appSkip: [".m-composer-wrap > .m-tray"],  // 工作区/待办芯片（异步到达，会让比对抖动）
  // 板上是静态 <input class="m-input">（摆拍件），产品是真textarea（可多行 / 高亮 / 自适应高度）。
  // 铁律一允许的 div→button/input 替换，按 LANDING §2① 登记为等价件。
  knownDiffs: ["/0/0/1"],
  ignore: ["d-grow", "m-grow"],
  maxRows: 40,
};