
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-46-frame2.mjs
export default {
  "name": "从其它 agent 导入（画板 46 · 帧 2）",
  "board": "46-settings-prompts-archive-import.html",
  "boardFrame": 2,
  "app": {
    "settle": 3200,
    "script": "\n      const opener = document.querySelector(\"button.pw-side-foot\");\n      if (opener) opener.click();\n      await new Promise((r) => setTimeout(r, 1500));\n      const row = document.querySelector('button.pw-row[data-section=\"import\"]');\n      if (!row) throw new Error(\"import 分节没找到\");\n      row.click();\n      await new Promise((r) => setTimeout(r, 1800));\n      const scan = [...document.querySelectorAll(\".pw-shead-acts button\")]\n        .find((b) => /扫描|scan/i.test(b.textContent ?? \"\"));\n      if (!scan) throw new Error(\"页头的「扫描」按钮没找到\");\n      scan.click();\n      await new Promise((r) => setTimeout(r, 2600));"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-list",
      "reason": "**数据依赖**：种子 agent 目录里没有别的 agent 配置可扫（tmp 目录只有本 agent）"
    },
    {
      "sel": ".settings-dialog-surface .pw-litem",
      "reason": "同上（待导入条目）"
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
      "reason": "同上（待导入条目左侧的开关）"
    },
    {
      "sel": ".settings-dialog-surface .pw-sec-title",
      "reason": "同上（按来源分组的小标题）"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.sm",
      "reason": "同上（全选 / 看详细日志）"
    },
    {
      "sel": ".settings-dialog-surface .pw-detail",
      "reason": "**状态依赖**：右栏「本次选择」「上次导入结果」依赖扫描结果"
    },
    {
      "sel": ".settings-dialog-surface .pw-kv",
      "reason": "同上（本次选择的属性表）"
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
      "sel": ".settings-dialog-surface .pw-btn.primary.sm",
      "reason": "同上（导入所选）"
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
      ".pw-scontent",
      ".settings-dialog-surface .pw-scontent"
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
      ".pw-cols",
      ".settings-dialog-surface .pw-cols"
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
      ".pw-sec-title",
      ".settings-dialog-surface .pw-sec-title"
    ],
    [
      ".pw-btn.sm",
      ".settings-dialog-surface .pw-btn.sm"
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
      ".pw-switch",
      ".settings-dialog-surface .pw-switch"
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
      ".pw-btn.primary.sm",
      ".settings-dialog-surface .pw-btn.primary.sm"
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
