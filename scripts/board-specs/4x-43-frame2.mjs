
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-43-frame2.mjs
export default {
  "name": "导入 MCP · OAuth 授权（画板 43 · 帧 2）",
  "board": "43-settings-plugins-mcp.html",
  "boardFrame": 2,
  "app": {
    "settle": 2400,
    "script": "\n      const opener = document.querySelector(\"button.pw-side-foot\");\n      if (opener) opener.click();\n      await new Promise((r) => setTimeout(r, 1500));\n      const row = document.querySelector('button.pw-row[data-section=\"mcp\"]');\n      if (!row) throw new Error(\"mcp 分节没找到\");\n      row.click();\n      await new Promise((r) => setTimeout(r, 1800));\n      const btn = [...document.querySelectorAll(\".pw-shead-acts button\")]\n        .find((b) => /导入|import/i.test(b.textContent ?? \"\"));\n      if (!btn) { throw new Error(\"页头的「从其它 agent 导入」按钮没找到\"); }\n      btn.click();\n      await new Promise((r) => setTimeout(r, 1600));"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-chip",
      "reason": "**接线依赖**：画板列了八个来源芯片（Claude Code / Codex / Cursor / Gemini / Windsurf / VS Code / OpenCode / mcp.json）；产品这个对话框的来源清单要扫描后才有，量的是第一枚"
    },
    {
      "sel": ".settings-dialog-surface .pw-chip.accent",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-prow",
      "reason": "**接线依赖**：画板 `.pw-prow` 是导入对话框里的待选条目；产品同一层用的是 `.pw-litem` 列表行（形状不同，见报告）"
    },
    {
      "sel": ".settings-dialog-surface .pw-switch",
      "reason": "同上（待选条目左侧的开关）"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge.warn",
      "reason": "同上（「同名已存在」徽章）"
    },
    {
      "sel": ".settings-dialog-surface .pw-sep",
      "reason": "同上（来源区与条目区之间的发丝线）"
    },
    {
      "sel": ".pw-cols > .pw-modal",
      "reason": "**未实现（不是模态）**：画板 43 帧 2 是两枚并排的模态（导入 MCP + OAuth 授权）。产品的 MCP 导入是**详情卡里的内联视图** —— `PluginsConfig.tsx:1626` 的 `view === \"mcp\" && mcpImportOpen ? <div className=\"pw-rowgap\">…`，OAuth 那块由 `McpConfig.tsx:57-79` 作为详情插槽渲染。整页没有 `.pw-modal`。"
    },
    {
      "sel": ".settings-dialog-surface .pw-cell",
      "reason": "**接线差异**：画板「连接成功的回显」用的是 `.pw-cell` 文档格，产品把这段回显放在导入结果里，不是 `.pw-cell`"
    },
    {
      "sel": ".settings-dialog-surface .pw-code-body",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-tok-com",
      "reason": "同上"
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
      ".pw-wrap",
      ".settings-dialog-surface .pw-wrap"
    ],
    [
      ".pw-chip",
      ".settings-dialog-surface .pw-chip"
    ],
    [
      ".pw-chip.accent",
      ".settings-dialog-surface .pw-chip.accent"
    ],
    [
      ".pw-sep",
      ".settings-dialog-surface .pw-sep"
    ],
    [
      ".pw-prow",
      ".settings-dialog-surface .pw-prow"
    ],
    [
      ".pw-switch",
      ".settings-dialog-surface .pw-switch"
    ],
    [
      ".pw-badge.warn",
      ".settings-dialog-surface .pw-badge.warn"
    ],
    [
      ".pw-alert.info",
      ".settings-dialog-surface .pw-alert.info"
    ],
    [
      ".pw-mono",
      ".settings-dialog-surface .pw-mono"
    ],
    [
      ".pw-inline",
      ".settings-dialog-surface .pw-inline"
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
      ".pw-btn.danger",
      ".settings-dialog-surface .pw-btn.danger"
    ],
    [
      ".pw-btn.outline",
      ".settings-dialog-surface .pw-btn.outline"
    ],
    [
      ".pw-cell",
      ".settings-dialog-surface .pw-cell"
    ],
    [
      ".pw-code-body",
      ".settings-dialog-surface .pw-code-body"
    ],
    [
      ".pw-tok-com",
      ".settings-dialog-surface .pw-tok-com"
    ]
  ]
};
