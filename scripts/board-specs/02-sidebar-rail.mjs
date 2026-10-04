// 画板 02 侧栏与顶栏 —— 帧 C 的折叠导轨（本项目唯一一处「折叠态左边那一条」）
//
// 导轨原先的实现是绝对定位在顶栏左端的 3 按钮浮块：少了 logo 与设置、也不占列宽
// （顶栏只能靠 92px 的 leading inset 让位）。2026-09-30 照画板重抄成全高竖列。
// 这份规格就是那次改动的验收：结构（logo 在顶 / 设置贴底）、列宽、图标按钮尺寸。
// fork:v5-old-layer（2026-10-04）—— 产品侧已换 v5：AppShell.tsx 的导轨是
// `.d-rail`，logo 是 `.d-logo`，动作钮是 `.d-iconbtn`。画板侧仍取 v1 的 pw-*。
const SAME = [
  [".pw-rail", ".d-rail"],
  [".pw-rail .pw-logo", ".d-rail .d-logo"],
  [".pw-rail .pw-iconbtn", ".d-rail .d-iconbtn"],
];

export default {
  name: "折叠导轨（画板 02 · 帧 C）",
  board: "02-sidebar-topbar.html",
  boardFrame: 2,
  app: { open: "sidebar:collapsed" },
  pairs: SAME,
  knownDiffs: [
    {
      sel: ".d-rail",
      reason: "**取样差异**：画板那一帧把导轨画在一张 300px 高的演示卡里"
        + "（inline height/border/radius-6），产品的导轨是全高的一列、没有圆角与描边。"
        + "列宽、背景、发丝右线、间距与逐个按钮的位置一致。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};
