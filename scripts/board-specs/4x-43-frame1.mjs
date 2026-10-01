
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-43-frame1.mjs
export default {
  "name": "MCP 服务器（画板 43 · 帧 1）",
  "board": "43-settings-plugins-mcp.html",
  "boardFrame": 1,
  "app": {
    "open": "settings:mcp"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-litem",
      "reason": "**数据依赖**：种子 agent 目录 0 个 MCP 服务器"
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
      "sel": ".settings-dialog-surface .pw-badge.ok",
      "reason": "同上（列表行「已连接」徽章）"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge.warn",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge.bad",
      "reason": "同上（「需要授权」徽章）"
    },
    {
      "sel": ".settings-dialog-surface .pw-detail",
      "reason": "**状态依赖**：没选中服务器时右列是空态"
    },
    {
      "sel": ".settings-dialog-surface .pw-inline",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-radio",
      "reason": "同上（Basic / JSON 模式芯片）"
    },
    {
      "sel": ".settings-dialog-surface .pw-switch",
      "reason": "同上（详情头的启用开关）"
    },
    {
      "sel": ".settings-dialog-surface .pw-sec-title",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-field",
      "reason": "同上（行式字段）"
    },
    {
      "sel": ".settings-dialog-surface .pw-field .pw-label",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-ctl",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-selectbox",
      "reason": "同上（传输方式 / 来源）"
    },
    {
      "sel": ".settings-dialog-surface .pw-input",
      "reason": "同上（命令 / 参数）"
    },
    {
      "sel": ".settings-dialog-surface .pw-mono",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-code-body",
      "reason": "同上（JSON 只读回显）"
    },
    {
      "sel": ".settings-dialog-surface .pw-tok-key",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-tok-str",
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
      ".pw-btn.outline.sm",
      ".settings-dialog-surface .pw-btn.outline.sm"
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
      ".pw-badge.ok",
      ".settings-dialog-surface .pw-badge.ok"
    ],
    [
      ".pw-badge.warn",
      ".settings-dialog-surface .pw-badge.warn"
    ],
    [
      ".pw-badge.bad",
      ".settings-dialog-surface .pw-badge.bad"
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
      ".pw-radio",
      ".settings-dialog-surface .pw-radio"
    ],
    [
      ".pw-switch",
      ".settings-dialog-surface .pw-switch"
    ],
    [
      ".pw-sec-title",
      ".settings-dialog-surface .pw-sec-title"
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
      ".pw-ctl",
      ".settings-dialog-surface .pw-ctl"
    ],
    [
      ".pw-selectbox",
      ".settings-dialog-surface .pw-selectbox"
    ],
    [
      ".pw-input",
      ".settings-dialog-surface .pw-input"
    ],
    [
      ".pw-mono",
      ".settings-dialog-surface .pw-mono"
    ],
    [
      ".pw-code-body",
      ".settings-dialog-surface .pw-code-body"
    ],
    [
      ".pw-tok-key",
      ".settings-dialog-surface .pw-tok-key"
    ],
    [
      ".pw-tok-str",
      ".settings-dialog-surface .pw-tok-str"
    ]
  ]
};
