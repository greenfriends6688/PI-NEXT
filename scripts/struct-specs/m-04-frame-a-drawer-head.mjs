// M-04 帧 A —— 抽屉头（画板：标题 + 一个关闭钮，就这两样）。
import { OPEN_DRAWER } from "./_open.mjs";
export default {
  name: "M-04 帧 A · 抽屉头",
  board: "v5/pwa/boards/M-04-sessions-drawer.html",
  frame: 0,
  boardRoot: ".m-scene:nth-of-type(1) .m-drawer-head",
  app: { script: OPEN_DRAWER },
  appRoot: ".sidebar-container .m-drawer-head",
  viewport: { width: 390, height: 844 },
  maxRows: 20,
};
