// M-04 帧 A / 帧 B —— 抽屉里的搜索格（常驻；帧 B 多一枚命中数徽章）。
import { OPEN_DRAWER } from "./_open.mjs";
export default {
  name: "M-04 帧 A · 抽屉搜索格",
  board: "v5/pwa/boards/M-04-sessions-drawer.html",
  frame: 0,
  boardRoot: ".m-scene:nth-of-type(1) .m-searchfield",
  app: { script: OPEN_DRAWER },
  appRoot: ".sidebar-container .m-searchfield",
  viewport: { width: 390, height: 844 },
  maxRows: 20,
};
