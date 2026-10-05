// M-04 帧 A —— 分段（项目 / 聊天，只有两档）。
import { OPEN_DRAWER } from "./_open.mjs";
export default {
  name: "M-04 帧 A · 分段",
  board: "v5/pwa/boards/M-04-sessions-drawer.html",
  frame: 0,
  boardRoot: ".m-scene:nth-of-type(1) .m-seg",
  app: { script: OPEN_DRAWER },
  appRoot: ".sidebar-container .m-seg",
  viewport: { width: 390, height: 844 },
  maxRows: 20,
};
