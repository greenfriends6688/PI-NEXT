// M-12 帧 A · 右栏入口底部面板（六项列表）
// 板侧：`.m-sheet.is-open` › grab / title / body(`.m-group-title` + 六个 `.m-sheet-row`) / `.m-sheet-foot`
// 产品现状（2026-10-05 核对）：sheet 壳与两行文案都对上了，但**列表为空** ——
// `mobileRightPanelItems` 取的是 `panelTabs`（当前打开的右栏页签），
// 而手机端没有任何入口能打开右栏页签，于是六项列表永远渲染 0 行。
// 宿主在 components/AppShell.tsx（不在本轮可改文件里），详见汇报。
export default {
  name: "M-12 帧A · 右栏六项列表",
  board: "v5/pwa/boards/M-12-right-panels.html",
  frame: 0,
  boardRoot: ".m-sheet.is-open",
  viewport: { width: 390, height: 844 },
  app: {
    script: `
      for (let i = 0; i < 60 && !document.querySelector(".m-composer-wrap"); i++) {
        await new Promise(r => setTimeout(r, 250));
      }
      document.querySelector(".m-top-btn[aria-haspopup='dialog']")?.click();
      for (let i = 0; i < 20 && !document.querySelector(".m-sheet.is-open"); i++) {
        await new Promise(r => setTimeout(r, 250));
      }
    `,
  },
  appRoot: ".m-sheet.is-open",
  ignore: ["d-grow", "m-grow"],
  maxRows: 20,
};