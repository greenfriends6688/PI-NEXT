
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-44-frame1.mjs
export default {
  "name": "记忆（画板 44 · 帧 1）",
  "board": "44-settings-cron-memory.html",
  "boardFrame": 1,
  "app": {
    "open": "settings:memory"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-list",
      "reason": "**数据依赖**：种子 agent 目录没有记忆文件目录条目"
    },
    {
      "sel": ".settings-dialog-surface .pw-litem",
      "reason": "同上（记忆文件行 / 记忆工具行）"
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
      "sel": ".settings-dialog-surface .pw-badge",
      "reason": "同上（只读徽章 / 允许自动调用徽章）"
    },
    {
      "sel": ".settings-dialog-surface .pw-cols",
      "reason": "同上（文件列表 + 编辑器两栏）"
    },
    {
      "sel": ".settings-dialog-surface .pw-detail",
      "reason": "同上（编辑器卡）"
    },
    {
      "sel": ".settings-dialog-surface .pw-inline",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-input",
      "reason": "同上（按文件名过滤的搜索框）"
    },
    {
      "sel": ".settings-dialog-surface .pw-iconbtn.sm",
      "reason": "同上（新建记忆文件的图标钮）"
    },
    {
      "sel": ".settings-dialog-surface .pw-textarea",
      "reason": "同上（记忆文件编辑器）"
    },
    {
      "sel": ".settings-dialog-surface .pw-empty",
      "reason": "同上（没选中记忆文件时的空态）"
    },
    {
      "sel": ".settings-dialog-surface .pw-switch",
      "reason": "**状态依赖**：`PiMemoryConfig.tsx:281` 的「启用记忆」开关只在 `installed`（本机装了 pi-memory）时渲染，否则整行换成「安装」按钮。画板帧 1 画的是「已安装 · 已启用 v0.4.2」那一态 —— 画板自己的 notes 也写了「未安装时整块换成安装引导」。"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge.ok",
      "reason": "**状态依赖**：同一行（:295）`enabled ? \"pw-badge ok\" : \"pw-badge\"`；没装 pi-memory 时 `enabled` 为 false → 落在 `.pw-badge` 而非 `.ok`。"
    },
    {
      "sel": ".settings-dialog-surface .pw-mono",
      "reason": "**取景差异**：画板帧 1 的第一枚 `.pw-mono` 在 `.pw-ctl` 里（inline，被 blockify 成 block）；产品第一枚在块级容器里。`display` 那一项是 blockify 的结果，不是样式差异。"
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
      ".pw-block",
      ".settings-dialog-surface .pw-block"
    ],
    [
      ".pw-block > h3",
      ".settings-dialog-surface .pw-block > h3"
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
      ".pw-switch",
      ".settings-dialog-surface .pw-switch"
    ],
    [
      ".pw-badge.ok",
      ".settings-dialog-surface .pw-badge.ok"
    ],
    [
      ".pw-badge",
      ".settings-dialog-surface .pw-badge"
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
      ".pw-btn.primary.sm",
      ".settings-dialog-surface .pw-btn.primary.sm"
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
      ".pw-cols",
      ".settings-dialog-surface .pw-cols"
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
      ".pw-input",
      ".settings-dialog-surface .pw-input"
    ],
    [
      ".pw-iconbtn.sm",
      ".settings-dialog-surface .pw-iconbtn.sm"
    ],
    [
      ".pw-textarea",
      ".settings-dialog-surface .pw-textarea"
    ],
    [
      ".pw-mono",
      ".settings-dialog-surface .pw-mono"
    ],
    [
      ".pw-empty",
      ".settings-dialog-surface .pw-empty"
    ],
    [
      ".pw-alert.info",
      ".settings-dialog-surface .pw-alert.info"
    ]
  ]
};
