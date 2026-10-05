// D-01 帧 A · 四张起步卡容器
export default {
  name: "D-01 帧A 起步卡容器",
  board: "v5/web/boards/D-01-workbench.html",
  boardRoot: ".d-grid2",
  app: { script: `document.querySelector(".d-side-nav .d-row")?.click(); await new Promise(r => setTimeout(r, 1400));` },
  appRoot: ".d-grid2",
  maxRows: 20,
};
