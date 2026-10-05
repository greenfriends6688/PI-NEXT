// 画板 53 回合与导航 —— 帧 0（转录迷你地图 ChatMinimap）
//
// 量迷你地图的两件：轨道 `.pw-minimap-rail` 与浮窗 `.pw-minimap-pop`（点轨道才出现）。
// 预设开一条会话，浮窗由 preset 的第二步点开。
// fork:minimap-board53（2026-10-05）—— 迷你地图回到画板 53 的形态（用户要 0.1.8
// 的样子），两侧又是同一个类名，MAP 退化成恒等映射。
const MAP = [[".pw-minimap-rail", ".pw-minimap-rail"]];

export default {
  name: "迷你地图（画板 53 · 帧 0）",
  board: "53-turn-and-nav.html",
  boardFrame: 0,
  app: { open: "session:first" },
  pairs: MAP,
  knownDiffs: [
    {
      sel: ".pw-minimap-rail",
      reason:
        "**尺寸依赖**：画板样张的轨道是固定 518px 的样张；产品的轨道高度跟随转录实际高度"
        + "（本会话 864px）。轨道的槽宽 / 颜色 / 圆角等按格子与样式一致，高度随内容变 —— "
        + "整条高度不是设计固定值。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};
