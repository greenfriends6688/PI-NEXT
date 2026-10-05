// M-04 帧 D —— 删除确认：底部面板（标题写清删的是哪条 + 一句代价 + 两个等宽钮）。
import { OPEN_DRAWER, EXPAND_PROJECT } from "./_open.mjs";
export default {
  name: "M-04 帧 D · 删除确认面板",
  board: "v5/pwa/boards/M-04-sessions-drawer.html",
  frame: 3,
  boardRoot: ".m-scene:nth-of-type(4) .m-sheet",
  app: {
    script: OPEN_DRAWER + EXPAND_PROJECT + `
      const rows = [...document.querySelectorAll(".sidebar-container .m-drawer-body .m-row")];
      const more = rows[0]?.querySelector(".fork-pwa-sb-row-menu button");
      if (more) { more.click(); await sleep(900); }
      const del = [...document.querySelectorAll(".m-menu-row.danger")][0];
      if (del) { del.click(); await sleep(1400); }
    `,
  },
  appRoot: ".m-sheet",
  viewport: { width: 390, height: 844 },
  maxRows: 30,
};
