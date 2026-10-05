// D-05 帧 B · 终端页脚（`.d-terminfo`）：分支 · PID/网格 · 已用时长 · 编码。
import { OPEN_TERMINAL } from "./_lib.mjs";
export default {
  name: "D-05 帧 B · 终端页脚",
  board: "v5/web/boards/D-05-right-panels.html",
  frame: 1,
  boardRoot: '.d-scene:nth-of-type(2) .d-panel-body[data-demo-pane="term"] .d-terminfo',
  app: { script: OPEN_TERMINAL },
  appRoot: ".file-panel-main .terminal-panel > .d-terminfo",
  maxRows: 15,
};