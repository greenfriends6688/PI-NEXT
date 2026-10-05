// M-04 帧 A —— 会话抽屉整页，**逐段**核对（板上那一段含 demo 接线用的无类名包裹，
// 整页对会把它们算成错位噪音，所以拆成下面五个 spec）：
//   m-04-frame-a-drawer-head / -search / -newtask / -seg / -foot
import { OPEN_DRAWER } from "./_open.mjs";
export default {
  name: "M-04 帧 A · 会话抽屉整页（汇总入口：跑分段 spec）",
  board: "v5/pwa/boards/M-04-sessions-drawer.html",
  frame: 0,
  boardRoot: ".m-scene:nth-of-type(1) .m-drawer",
  app: { script: OPEN_DRAWER },
  appRoot: ".sidebar-container",
  viewport: { width: 390, height: 844 },
  maxRows: 10,
};
