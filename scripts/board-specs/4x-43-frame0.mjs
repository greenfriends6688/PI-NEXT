
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-43-frame0.mjs
export default {
  "name": "插件（画板 43 · 帧 0）",
  "board": "43-settings-plugins-mcp.html",
  "boardFrame": 0,
  "app": {
    "open": "settings:plugins"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-litem",
      "reason": "**数据依赖**：种子 agent 目录 0 个插件，左列只有「添加插件」那条 `.pw-litem-add`"
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
      "sel": ".settings-dialog-surface .pw-badge.warn",
      "reason": "同上（列表行的「可更新」徽章）"
    },
    {
      "sel": ".settings-dialog-surface .pw-detail",
      "reason": "**状态依赖**：没选中插件时右列是空态"
    },
    {
      "sel": ".settings-dialog-surface .pw-inline",
      "reason": "同上（详情头 + 启用开关行）"
    },
    {
      "sel": ".settings-dialog-surface .pw-kv",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-kv dt",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-kv dd",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-sec-title",
      "reason": "同上（「已解析资源」小标题）"
    },
    {
      "sel": ".settings-dialog-surface .pw-switch",
      "reason": "同上（详情底部的「启用这个插件」开关）"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.danger.sm",
      "reason": "同上（移除）"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.sm",
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
      ".pw-btn.outline.sm",
      ".settings-dialog-surface .pw-btn.outline.sm"
    ],
    [
      ".pw-btn.primary.sm",
      ".settings-dialog-surface .pw-btn.primary.sm"
    ],
    [
      ".pw-btn.danger.sm",
      ".settings-dialog-surface .pw-btn.danger.sm"
    ],
    [
      ".pw-btn.sm",
      ".settings-dialog-surface .pw-btn.sm"
    ],
    [
      ".pw-stools",
      ".settings-dialog-surface .pw-stools"
    ],
    [
      ".pw-badge.count",
      ".settings-dialog-surface .pw-badge.count"
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
      ".pw-badge.warn",
      ".settings-dialog-surface .pw-badge.warn"
    ],
    [
      ".pw-badge",
      ".settings-dialog-surface .pw-badge"
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
      ".pw-kv",
      ".settings-dialog-surface .pw-kv"
    ],
    [
      ".pw-kv dt",
      ".settings-dialog-surface .pw-kv dt"
    ],
    [
      ".pw-kv dd",
      ".settings-dialog-surface .pw-kv dd"
    ],
    [
      ".pw-sec-title",
      ".settings-dialog-surface .pw-sec-title"
    ],
    [
      ".pw-switch",
      ".settings-dialog-surface .pw-switch"
    ],
    [
      ".pw-mono",
      ".settings-dialog-surface .pw-mono"
    ]
  ]
};
