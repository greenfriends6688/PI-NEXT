// D-05 帧 B · 终端面板头 + 面板体（`.d-panel-head` / `.d-panel-body[data-demo-pane="term"]`）。
import { OPEN_TERMINAL } from "./_lib.mjs";
export default {
  name: "D-05 帧 B · 终端面板头",
  board: "v5/web/boards/D-05-right-panels.html",
  frame: 1,
  boardRoot: '.d-scene:nth-of-type(2) .d-panel-head[data-demo-pane="term"]',
  app: { script: OPEN_TERMINAL },
  appRoot: ".file-panel-main .terminal-panel > .d-panel-head",
  maxRows: 20,
};