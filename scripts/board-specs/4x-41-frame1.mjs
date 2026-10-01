
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-41-frame1.mjs
export default {
  "name": "模型详情（画板 41 · 帧 1：能力 / 规格 / 成本 / 高级 / 测试连接）",
  "board": "41-settings-models.html",
  "boardFrame": 1,
  "app": {
    "settle": 2600,
    "script": "\n      const opener = document.querySelector(\"button.pw-side-foot\");\n      if (opener) opener.click();\n      await new Promise((r) => setTimeout(r, 1500));\n      const row = document.querySelector('button.pw-row[data-section=\"models\"]');\n      if (!row) throw new Error(\"models 分节没找到\");\n      row.click();\n      await new Promise((r) => setTimeout(r, 1800));\n      const items = [...document.querySelectorAll(\"button.pw-litem\")];\n      if (items[0]) { items[0].click(); await new Promise((r) => setTimeout(r, 1500)); }\n      const models = [...document.querySelectorAll(\"button.pw-litem\")].slice(1);\n      if (models[0]) { models[0].click(); await new Promise((r) => setTimeout(r, 1500)); }"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-detail",
      "reason": "**数据依赖**：种子 agent 目录 0 个供应商 → 0 个模型 → 模型详情根本不存在（能力/规格/成本/高级/测试连接全部量不到）"
    },
    {
      "sel": ".settings-dialog-surface .pw-inline",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-sec-title",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-field",
      "reason": "同上"
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
      "sel": ".settings-dialog-surface .pw-switch",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-selectbox",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-mono",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-mono.pw-dim",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.sm",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.primary.sm",
      "reason": "同上（发一条测试请求）"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.danger.sm",
      "reason": "同上（删除这个模型）"
    },
    {
      "sel": ".settings-dialog-surface .pw-code-body",
      "reason": "同上（测试连接的原始请求回显）"
    },
    {
      "sel": ".settings-dialog-surface .pw-tok-key",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-tok-str",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-tok-com",
      "reason": "同上"
    }
  ],
  "pairs": [
    [
      ".pw-detail",
      ".settings-dialog-surface .pw-detail"
    ],
    [
      ".pw-inline",
      ".settings-dialog-surface .pw-inline"
    ],
    [
      ".pw-badge",
      ".settings-dialog-surface .pw-badge"
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
      ".pw-field .pw-label small",
      ".settings-dialog-surface .pw-field .pw-label small"
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
      ".pw-selectbox",
      ".settings-dialog-surface .pw-selectbox"
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
      ".pw-btn.sm",
      ".settings-dialog-surface .pw-btn.sm"
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
    ],
    [
      ".pw-tok-com",
      ".settings-dialog-surface .pw-tok-com"
    ]
  ]
};
