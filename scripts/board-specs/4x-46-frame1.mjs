
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-46-frame1.mjs
export default {
  "name": "归档历史（画板 46 · 帧 1）",
  "board": "46-settings-prompts-archive-import.html",
  "boardFrame": 1,
  "app": {
    "open": "settings:archived"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-list",
      "reason": "**数据依赖**：种子 agent 目录没有归档项目 / 归档会话"
    },
    {
      "sel": ".settings-dialog-surface .pw-litem",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-lname",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-lsub",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-detail",
      "reason": "同上（项目卡 / 会话分组卡）"
    },
    {
      "sel": ".settings-dialog-surface .pw-grid2",
      "reason": "同上（归档会话按项目两栏分组）"
    },
    {
      "sel": ".settings-dialog-surface .pw-switch",
      "reason": "同上（「显示文件已消失的会话」）"
    },
    {
      "sel": ".settings-dialog-surface .pw-alert",
      "reason": "同上（底部「彻底删除」危险提示条）"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.danger.sm",
      "reason": "同上（行内垃圾桶）"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.sm",
      "reason": "同上（恢复）"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.outline.sm",
      "reason": "同上（恢复项目）"
    },
    {
      "sel": ".settings-dialog-surface .pw-mono.pw-dim",
      "reason": "同上（归档日期）"
    },
    {
      "sel": ".settings-dialog-surface .pw-sec-title",
      "reason": "同上（两个小标题）"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge.count",
      "reason": "同上（会话数徽章）"
    },
    {
      "sel": ".settings-dialog-surface .pw-ico",
      "reason": "**取景差异**：量的是设置壳里的第一枚 `.pw-ico`（导航里的分节图标 20px 容器），画板帧 1 的第一枚是模态说明行里的 14px 图标"
    },
    {
      "sel": ".settings-dialog-surface .pw-inline",
      "reason": "**数据依赖**：0 个归档项目 / 0 条归档会话 → 项目卡与分组卡都没有，连带的 `.pw-inline` 也没有（空态只给了一句 `<p class=\"sub\">`，见报告）。"
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
      ".pw-shead-copy > p.sub",
      ".settings-dialog-surface .pw-shead-copy > p.sub"
    ],
    [
      ".pw-scontent",
      ".settings-dialog-surface .pw-scontent"
    ],
    [
      ".pw-sec-title",
      ".settings-dialog-surface .pw-sec-title"
    ],
    [
      ".pw-badge.count",
      ".settings-dialog-surface .pw-badge.count"
    ],
    [
      ".pw-detail",
      ".settings-dialog-surface .pw-detail"
    ],
    [
      ".pw-inline",
      ".settings-dialog-surface .pw-inline"
    ],
    [
      ".pw-ico",
      ".settings-dialog-surface .pw-ico"
    ],
    [
      ".pw-mono.pw-dim",
      ".settings-dialog-surface .pw-mono.pw-dim"
    ],
    [
      ".pw-btn.outline.sm",
      ".settings-dialog-surface .pw-btn.outline.sm"
    ],
    [
      ".pw-btn.sm",
      ".settings-dialog-surface .pw-btn.sm"
    ],
    [
      ".pw-btn.danger.sm",
      ".settings-dialog-surface .pw-btn.danger.sm"
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
      ".pw-lsub",
      ".settings-dialog-surface .pw-lsub"
    ],
    [
      ".pw-grid2",
      ".settings-dialog-surface .pw-grid2"
    ],
    [
      ".pw-switch",
      ".settings-dialog-surface .pw-switch"
    ],
    [
      ".pw-alert",
      ".settings-dialog-surface .pw-alert"
    ],
    [
      ".pw-empty",
      ".settings-dialog-surface .pw-empty"
    ]
  ]
};
