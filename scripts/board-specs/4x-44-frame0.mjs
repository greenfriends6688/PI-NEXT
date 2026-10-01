
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-44-frame0.mjs
export default {
  "name": "定时任务（画板 44 · 帧 0）",
  "board": "44-settings-cron-memory.html",
  "boardFrame": 0,
  "app": {
    "open": "settings:cron"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-litem",
      "reason": "**数据依赖**：种子 agent 目录 0 条定时任务，左列是空态"
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
      "sel": ".settings-dialog-surface .pw-switch",
      "reason": "同上（任务行最左的开关）"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge.ok",
      "reason": "同上（「上次成功」）"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge.accent",
      "reason": "同上（「运行中」/「未保存」）"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge.warn",
      "reason": "同上（「错过一次」）"
    },
    {
      "sel": ".settings-dialog-surface .pw-detail",
      "reason": "**状态依赖**：没选中任务时右栏是空态；画板量的是「新建任务」表单"
    },
    {
      "sel": ".settings-dialog-surface .pw-inline",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-field",
      "reason": "同上（表单字段行）"
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
      "sel": ".settings-dialog-surface .pw-input",
      "reason": "同上（名称 / 最大运行次数）"
    },
    {
      "sel": ".settings-dialog-surface .pw-textarea",
      "reason": "同上（提示词）"
    },
    {
      "sel": ".settings-dialog-surface .pw-sec-title",
      "reason": "同上（提示词 / 频率 小标题）"
    },
    {
      "sel": ".settings-dialog-surface .pw-selectbox",
      "reason": "同上（模型 / 思考强度 / 通知策略 / 时区）"
    },
    {
      "sel": ".settings-dialog-surface .pw-radio",
      "reason": "同上（会话模式 / 频率八档）"
    },
    {
      "sel": ".settings-dialog-surface .pw-mono",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-grid3",
      "reason": "同上（频率补充字段三格）"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.sm",
      "reason": "同上（选择 / 编辑 / 加载更早）"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn",
      "reason": "同上（取消 / 保存任务）"
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
      ".pw-switch",
      ".settings-dialog-surface .pw-switch"
    ],
    [
      ".pw-badge.ok",
      ".settings-dialog-surface .pw-badge.ok"
    ],
    [
      ".pw-badge.accent",
      ".settings-dialog-surface .pw-badge.accent"
    ],
    [
      ".pw-badge.warn",
      ".settings-dialog-surface .pw-badge.warn"
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
      ".pw-input",
      ".settings-dialog-surface .pw-input"
    ],
    [
      ".pw-textarea",
      ".settings-dialog-surface .pw-textarea"
    ],
    [
      ".pw-sec-title",
      ".settings-dialog-surface .pw-sec-title"
    ],
    [
      ".pw-selectbox",
      ".settings-dialog-surface .pw-selectbox"
    ],
    [
      ".pw-radio",
      ".settings-dialog-surface .pw-radio"
    ],
    [
      ".pw-mono",
      ".settings-dialog-surface .pw-mono"
    ],
    [
      ".pw-grid3",
      ".settings-dialog-surface .pw-grid3"
    ],
    [
      ".pw-btn.sm",
      ".settings-dialog-surface .pw-btn.sm"
    ],
    [
      ".pw-btn",
      ".settings-dialog-surface .pw-btn"
    ]
  ]
};
