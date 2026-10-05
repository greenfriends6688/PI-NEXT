// D-05 帧 A · 文件树的一行（`.d-tree > .d-trow`）。
// 只量一行：板面的 14 行与工作区的若干行在行数上天然不等，比「一行的骨架」才量得到东西。
import { OPEN_PANEL } from "./_lib.mjs";
export default {
  name: "D-05 帧 A · 文件树行（目录）",
  board: "v5/web/boards/D-05-right-panels.html",
  frame: 0,
  boardRoot: '.d-scene:nth-of-type(1) .d-panel-body[data-demo-pane="files"] .d-tree > .d-trow:nth-child(3)',
  app: { script: OPEN_PANEL },
  appRoot: ".file-panel-main .d-tree > .d-trow",
  maxRows: 20,
};