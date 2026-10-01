
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-45-frame1.mjs
export default {
  "name": "用量（画板 45 · 帧 1）",
  "board": "45-settings-shortcuts-usage.html",
  "boardFrame": 1,
  "app": {
    "open": "settings:usage"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-stat.is-wide",
      "reason": "**画板自身不一致（B 类）**：画板 45 帧 1 是「9 张 4 列网格」，board.css 的 `.pw-stats-grid > .pw-stat.is-wide` 是给**奇数张**（1 + 2×4）用的横跨整行规则；这一帧九张既没标 `is-wide` 也没有第五行孤张"
    },
    {
      "sel": ".settings-dialog-surface .pw-bars i",
      "reason": "**画板自身不一致**：柱高是每根 inline `style=\"height:NN%\"` 的示意值，不是规格"
    },
    {
      "sel": ".settings-dialog-surface .pw-bars i.hot",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-stat .v",
      "reason": "**数据依赖**：数值文本不同（画板 3,694.3M vs 产品实数），宽度按文本判定后跳过，字号/行高仍逐项比"
    },
    {
      "sel": ".settings-dialog-surface .pw-legend .li",
      "reason": "**数据依赖**：图例条目来自真实用量，模型名不同"
    },
    {
      "sel": ".settings-dialog-surface .pw-mono",
      "reason": "**取景差异**：`.pw-mono` 的 `display` 是父容器 blockify 的结果（画板第一枚在 `.pw-inline` 里 → block；产品第一枚在块级 `.pw-litem` 里 → block / 在 inline 上下文 → inline）。不是样式差异。"
    },
    {
      "sel": ".settings-dialog-surface .pw-radio",
      "reason": "**取景差异（字体度量）**：两边四枚芯片的文字完全相同（7 天 / 30 天 / 1 年 / 全部），宽度 183.3 vs 185.7 = 2.4px 的中文字形度量差，落在 `tolerance.box` 之外 0.4px。不登记成硬差异，单独在报告里记一笔。"
    }
  ],
  "pairs": [
    [
      ".pw-shead",
      ".settings-dialog-surface .pw-shead"
    ],
    [
      ".pw-shead-copy > h2",
      ".settings-dialog-surface .pw-shead-copy > h2"
    ],
    [
      ".pw-shead-acts",
      ".settings-dialog-surface .pw-shead-acts"
    ],
    [
      ".pw-radio",
      ".settings-dialog-surface .pw-radio"
    ],
    [
      ".pw-btn.outline.sm",
      ".settings-dialog-surface .pw-btn.outline.sm"
    ],
    [
      ".pw-scontent",
      ".settings-dialog-surface .pw-scontent"
    ],
    [
      ".pw-stats-grid",
      ".settings-dialog-surface .pw-stats-grid"
    ],
    [
      ".pw-stat",
      ".settings-dialog-surface .pw-stat"
    ],
    [
      ".pw-stat .k",
      ".settings-dialog-surface .pw-stat .k"
    ],
    [
      ".pw-stat .v",
      ".settings-dialog-surface .pw-stat .v"
    ],
    [
      ".pw-stat .s",
      ".settings-dialog-surface .pw-stat .s"
    ],
    [
      ".pw-stat.is-wide",
      ".settings-dialog-surface .pw-stat.is-wide"
    ],
    [
      ".pw-grid2",
      ".settings-dialog-surface .pw-grid2"
    ],
    [
      ".pw-cell",
      ".settings-dialog-surface .pw-cell"
    ],
    [
      ".pw-cell > h4",
      ".settings-dialog-surface .pw-cell > h4"
    ],
    [
      ".pw-bars",
      ".settings-dialog-surface .pw-bars"
    ],
    [
      ".pw-bars i",
      ".settings-dialog-surface .pw-bars i"
    ],
    [
      ".pw-bars i.hot",
      ".settings-dialog-surface .pw-bars i.hot"
    ],
    [
      ".pw-legend",
      ".settings-dialog-surface .pw-legend"
    ],
    [
      ".pw-legend .li",
      ".settings-dialog-surface .pw-legend .li"
    ],
    [
      ".pw-legend .sw",
      ".settings-dialog-surface .pw-legend .sw"
    ],
    [
      ".pw-list",
      ".settings-dialog-surface .pw-list"
    ],
    [
      ".pw-litem",
      ".settings-dialog-surface .pw-litem"
    ],
    [
      ".pw-lname",
      ".settings-dialog-surface .pw-lname"
    ],
    [
      ".pw-mono",
      ".settings-dialog-surface .pw-mono"
    ],
    [
      ".pw-mono.pw-dim",
      ".settings-dialog-surface .pw-mono.pw-dim"
    ],
    [
      ".pw-inline",
      ".settings-dialog-surface .pw-inline"
    ],
    [
      ".pw-badge.ok",
      ".settings-dialog-surface .pw-badge.ok"
    ],
    [
      ".pw-badge.bad",
      ".settings-dialog-surface .pw-badge.bad"
    ],
    [
      ".pw-badge",
      ".settings-dialog-surface .pw-badge"
    ],
    [
      ".pw-hint",
      ".settings-dialog-surface .pw-hint"
    ]
  ]
};
