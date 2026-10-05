// D-05 帧 A · 文件面板头（`.d-panel-head`）。板面那一枚与产品 `.file-explorer-header`
// 讲同一件事，所以两边各取各的那一枚（同层双 `.d-panel-head` 不能直取，见板 30 spec 的坑 1）。
import { OPEN_PANEL } from "./_lib.mjs";
export default {
  name: "D-05 帧 A · 文件面板头",
  board: "v5/web/boards/D-05-right-panels.html",
  frame: 0,
  boardRoot: '.d-scene:nth-of-type(1) .d-panel-head[data-demo-pane="files"]',
  app: { script: OPEN_PANEL },
  appRoot: ".file-explorer-section > .file-explorer-header",
  maxRows: 30,
};