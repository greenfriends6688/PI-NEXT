// D-06b 帧 E · 打不开的类型降级卡（`.d-card` + 头 + 体 + `.d-pop-foot` 三条路）。
import { OPEN_PANEL, OPEN_FILE } from "./_lib.mjs";
export default {
  name: "D-06b 帧 E · 不支持类型降级卡",
  board: "v5/web/boards/D-06b-file-viewer-modes.html",
  frame: 4,
  boardRoot: '.d-scene:nth-of-type(5) .d-card [data-demo-pane="ug-binary"] .d-card',
  app: { script: `${OPEN_PANEL}${OPEN_FILE("notes.psd")}` },
  appRoot: ".file-panel-main .d-card",
  maxRows: 30,
};
