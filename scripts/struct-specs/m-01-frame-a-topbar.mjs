// M-01 帧 A —— 渐隐顶栏（`m-fade` + `m-top`：抽屉钮 / 会话标题 / ⋯）。
import { OPEN_SESSION } from "./_open.mjs";
export default {
  name: "M-01 帧 A · 渐隐顶栏",
  board: "v5/pwa/boards/M-01-conversation-drawer.html",
  frame: 0,
  boardRoot: ".m-scene:nth-of-type(1) .m-top",
  app: { script: OPEN_SESSION },
  appRoot: ".m-top",
  viewport: { width: 390, height: 844 },
  // 两条已登记的偏离（都不是「忘了抄」，是产品上另有功能、板面那一帧没画）：
  //   `/1` 标题格 —— 产品多一**行副行**（`m-t-xs m-t-faint`：会话所在目录 · 上下文占用 %）。
  //          来源 fork:mobile-tb-subtitle（2026-10-03 用户裁定：窄屏看不到侧栏，副行是
  //          「我在哪」的唯一常驻出口）。删它 = 删功能，故登记为偏离待设计侧裁定。
  //   `/2` 那一格 —— 产品在 `⋯` 之后还有一枚 `panel-right`（右栏面板入口，画板 M-12
  //          帧 A 的那一枚）；M-01/M-02 那几帧画的是**会话页**，没画右栏。
  knownDiffs: ["/1", "/2"],
  maxRows: 20,
};
