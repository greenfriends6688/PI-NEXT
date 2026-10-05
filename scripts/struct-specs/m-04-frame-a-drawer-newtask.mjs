// M-04 帧 A —— 列表第一行的「新建任务」（square-pen + 文案 + ⌘N 徽章）。
import { OPEN_DRAWER } from "./_open.mjs";
export default {
  name: "M-04 帧 A · 新建任务行",
  board: "v5/pwa/boards/M-04-sessions-drawer.html",
  frame: 0,
  boardRoot: ".m-scene:nth-of-type(1) .m-setrow",
  app: { script: OPEN_DRAWER },
  appRoot: ".sidebar-container .m-setrow",
  viewport: { width: 390, height: 844 },
  maxRows: 20,
};
