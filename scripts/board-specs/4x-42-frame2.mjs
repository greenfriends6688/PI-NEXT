
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-42-frame2.mjs
export default {
  "name": "安装技能对话框（画板 42 · 帧 2）",
  "board": "42-settings-agents-skills.html",
  "boardFrame": 2,
  "app": {
    "settle": 2400,
    "script": "\n      const opener = document.querySelector(\"button.pw-side-foot\");\n      if (opener) opener.click();\n      await new Promise((r) => setTimeout(r, 1500));\n      const row = document.querySelector('button.pw-row[data-section=\"skills\"]');\n      if (!row) throw new Error(\"skills 分节没找到\");\n      row.click();\n      await new Promise((r) => setTimeout(r, 1800));\n      const btn = [...document.querySelectorAll(\".pw-shead-acts button\")]\n        .find((b) => /添加技能|安装技能|add skill|install skill/i.test(b.textContent ?? \"\"));\n      if (!btn) throw new Error(\"页头的「添加技能」按钮没找到\");\n      btn.click();\n      await new Promise((r) => setTimeout(r, 1400));"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".pw-cols > .pw-modal",
      "reason": "**未实现（不是模态）**：画板 42 帧 2 画的是一枚独立的 `.pw-modal`（640px 宽，带头/体/脚三段）。产品的「添加技能」是**详情列里的内联视图** —— `SkillsConfig.tsx:1048` 的 `addMode ? <AddSkillPanel/> : …`，而 `AddSkillPanel` 直接返回 `<ConfigDetailStack>`（:540），既没有 `.pw-modal` 也没有 `.pw-scrim`。同一个细节列里根本不存在模态这一层。同理 `.pw-modal-head/-body/-foot` 三项都是 FAIL。"
    },
    {
      "sel": ".settings-dialog-surface .pw-pop",
      "reason": "**接线依赖**：画板用 `.pw-pop` 画结果浮层，产品把结果直接排在对话框体内（没有这一层浮层）"
    },
    {
      "sel": ".settings-dialog-surface .pw-prow",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-prow.is-on",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge.count",
      "reason": "同上（结果行的下载数徽章）"
    },
    {
      "sel": ".settings-dialog-surface .pw-inline",
      "reason": "**取景差异**：画板第一枚 `.pw-inline` 在 `.pw-modal-body`（13px 正文），产品第一枚在 `.pw-field` 上下文（12px）。"
    },
    {
      "sel": ".settings-dialog-surface .pw-radio",
      "reason": "**取景差异**：画板第一枚 `.pw-radio` 在 `.pw-modal-body`（13px），产品第一枚在 `.pw-field`（12px）；芯片本身（`.pw-radio > span` vs 产品 `.pw-radio > button`）两边都是 24 高 / 11px。"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn",
      "reason": "**取景差异**：画板第一枚 `.pw-btn` 是对话框动作行那枚**默认档**（28 高 / 0 12px / 12px）；产品设置面板里的第一枚是皮肤条动作行的 `.pw-btn.sm`（24 高 / 0 8px / 11px）。"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.primary",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-input",
      "reason": "**取景差异**：画板帧 2 的搜索框是 `.pw-modal-body` 满宽（515px），产品是详情列满宽（670px）—— 两栏宽度不同（见 62-frame1 的 300/760 规则）。"
    }
  ],
  "pairs": [
    [
      ".pw-modal",
      ".pw-cols > .pw-modal"
    ],
    [
      ".pw-modal-head",
      ".pw-cols > .pw-modal-head"
    ],
    [
      ".pw-modal-body",
      ".pw-cols > .pw-modal-body"
    ],
    [
      ".pw-modal-foot",
      ".pw-cols > .pw-modal-foot"
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
      ".pw-selectbox",
      ".settings-dialog-surface .pw-selectbox"
    ],
    [
      ".pw-input",
      ".settings-dialog-surface .pw-input"
    ],
    [
      ".pw-kbd",
      ".settings-dialog-surface .pw-kbd"
    ],
    [
      ".pw-pop",
      ".settings-dialog-surface .pw-pop"
    ],
    [
      ".pw-prow",
      ".settings-dialog-surface .pw-prow"
    ],
    [
      ".pw-prow.is-on",
      ".settings-dialog-surface .pw-prow.is-on"
    ],
    [
      ".pw-badge.count",
      ".settings-dialog-surface .pw-badge.count"
    ],
    [
      ".pw-alert.info",
      ".settings-dialog-surface .pw-alert.info"
    ],
    [
      ".pw-btn",
      ".settings-dialog-surface .pw-btn"
    ],
    [
      ".pw-btn.primary",
      ".settings-dialog-surface .pw-btn.primary"
    ]
  ]
};
