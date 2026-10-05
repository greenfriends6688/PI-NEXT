// D-01 帧 A · 单张起步卡
export default {
  name: "D-01 帧A 起步卡",
  board: "v5/web/boards/D-01-workbench.html",
  boardRoot: ".d-store-card",
  app: { script: `document.querySelector(".d-side-nav .d-row")?.click(); await new Promise(r => setTimeout(r, 1400));` },
  appRoot: ".d-store-card",
  maxRows: 20,
};
