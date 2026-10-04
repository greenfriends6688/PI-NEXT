// 画板 60 手机 / PWA —— 帧 A（手机三种主状态之一，空态）
//
// 只量**手机壳**的三件（`.pw-touch` 表头触控钮 / `.pw-drawer` 侧栏抽屉 / `.pw-brand` 品牌），
// 它们在 390×800 下与画板一致。composer 三段不在这里量：画板 60 帧 0 画的是**阅读态**
// （`继续…`、min-height 34、bar 紧凑 2/4/4/8），而种子/真机在窄屏下打开的是**空闲完整态**
// （top 12/12/6、bar grid）—— 那是 20-composer 的状态，两者不可在同一帧对位。
// 手机阅读态要流式折叠才能造出来，属于数据/状态依赖，登记在 DIVERGENCE。
// 断点由 board-diff 的 viewport 固定（390×800），不在产品里手动缩放。
// fork:v5-old-layer（2026-10-04）—— 手机壳已换 v5：`m-drawer`（AppShell.tsx:3080，
// 抽屉本体）与抽屉里的触控钮 `m-drawer-foot`（:2184）。旧名 `.pw-drawer` / `.pw-touch`
// 在产品里已不存在（只剩注释）。
const SHELL = [
  [".pw-touch", ".m-drawer-foot button"],
  [".pw-drawer", ".sidebar-container.m-drawer"],
];

export default {
  name: "手机壳（画板 60 · 帧 A）",
  board: "60-mobile-pwa.html",
  boardFrame: 0,
  viewport: { width: 390, height: 800 },
  app: { open: "new-session" },
  pairs: SHELL,
  knownDiffs: [],
  tolerance: { box: 2, fontSize: 0 },
};
