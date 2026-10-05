// M-04 帧 A —— 抽屉底栏（设置行 / 手机与推送 / 版本徽章）。
import { OPEN_DRAWER } from "./_open.mjs";
export default {
  name: "M-04 帧 A · 抽屉底栏",
  board: "v5/pwa/boards/M-04-sessions-drawer.html",
  frame: 0,
  boardRoot: ".m-scene:nth-of-type(1) .m-drawer-foot",
  app: { script: OPEN_DRAWER },
  appRoot: ".sidebar-container .m-drawer-foot",
  viewport: { width: 390, height: 844 },
  maxRows: 20,
};
