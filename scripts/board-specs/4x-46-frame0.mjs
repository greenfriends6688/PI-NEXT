
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-46-frame0.mjs
export default {
  "name": "自定义命令（画板 46 · 帧 0）",
  "board": "46-settings-prompts-archive-import.html",
  "boardFrame": 0,
  "app": {
    "open": "settings:prompts"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-litem",
      "reason": "**数据依赖**：种子 agent 目录 0 条自定义命令 → 列表是空态"
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
      "reason": "**状态依赖**：没选中命令 → 详情是空态"
    },
    {
      "sel": ".settings-dialog-surface .pw-inline",
      "reason": "同上（详情头 + 占位符提示行）"
    },
    {
      "sel": ".settings-dialog-surface .pw-field",
      "reason": "同上（编辑器字段行）"
    },
    {
      "sel": ".settings-dialog-surface .pw-field .pw-label",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-field .pw-label small",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-ctl",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-mono.pw-dim",
      "reason": "同上（`/` 前缀格）"
    },
    {
      "sel": ".settings-dialog-surface .pw-sec-title",
      "reason": "同上（正文小标题）"
    },
    {
      "sel": ".settings-dialog-surface .pw-textarea",
      "reason": "同上（正文编辑器）"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge.accent",
      "reason": "同上（占位符提示徽章）"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.sm",
      "reason": "同上（在查看器打开）"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.danger.sm",
      "reason": "同上（删除）"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn",
      "reason": "同上（取消）"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.primary",
      "reason": "同上（保存）"
    },
    {
      "sel": ".settings-dialog-surface .pw-mono",
      "reason": "同上"
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
      ".pw-badge.count",
      ".settings-dialog-surface .pw-badge.count"
    ],
    [
      ".pw-btn.primary.sm",
      ".settings-dialog-surface .pw-btn.primary.sm"
    ],
    [
      ".pw-scontent",
      ".settings-dialog-surface .pw-scontent"
    ],
    [
      ".pw-cols",
      ".settings-dialog-surface .pw-cols"
    ],
    [
      ".pw-input",
      ".settings-dialog-surface .pw-input"
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
      ".pw-detail",
      ".settings-dialog-surface .pw-detail"
    ],
    [
      ".pw-inline",
      ".settings-dialog-surface .pw-inline"
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
      ".pw-field",
      ".settings-dialog-surface .pw-field"
    ],
    [
      ".pw-field .pw-label",
      ".settings-dialog-surface .pw-field .pw-label"
    ],
    [
      ".pw-field .pw-label small",
      ".settings-dialog-surface .pw-field .pw-label small"
    ],
    [
      ".pw-ctl",
      ".settings-dialog-surface .pw-ctl"
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
      ".pw-sec-title",
      ".settings-dialog-surface .pw-sec-title"
    ],
    [
      ".pw-textarea",
      ".settings-dialog-surface .pw-textarea"
    ],
    [
      ".pw-badge.accent",
      ".settings-dialog-surface .pw-badge.accent"
    ],
    [
      ".pw-btn",
      ".settings-dialog-surface .pw-btn"
    ],
    [
      ".pw-btn.primary",
      ".settings-dialog-surface .pw-btn.primary"
    ],
    [
      ".pw-empty",
      ".settings-dialog-surface .pw-empty"
    ],
    [
      ".pw-empty-inner",
      ".settings-dialog-surface .pw-empty-inner"
    ]
  ]
};
