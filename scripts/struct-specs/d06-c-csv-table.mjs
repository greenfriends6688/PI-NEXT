// D-06 帧 C · CSV 预览（`.d-viewer` / `.d-viewer-bar` / `.d-tbl-wrap > .d-table` + 脚注）。
import { OPEN_PANEL, OPEN_FILE } from "./_lib.mjs";
export default {
  name: "D-06 帧 C · CSV 表格（.d-tbl-wrap）",
  board: "v5/web/boards/D-06-file-viewer.html",
  frame: 2,
  boardRoot: '.d-scene:nth-of-type(3) .d-tbl-wrap',
  app: { script: `${OPEN_PANEL}${OPEN_FILE("data.csv")}` },
  appRoot: ".file-panel-main .d-tbl-wrap",
  maxRows: 25,
};
