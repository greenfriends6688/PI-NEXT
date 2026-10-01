
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-45-frame0.mjs
export default {
  "name": "快捷键（画板 45 · 帧 0）—— **产品里没有这个分节**",
  "board": "45-settings-shortcuts-usage.html",
  "boardFrame": 0,
  "app": {
    "settle": 900,
    "script": "\n      const opener = document.querySelector(\"button.pw-side-foot\");\n      if (opener) opener.click();\n      await new Promise((r) => setTimeout(r, 1600));\n      document.querySelectorAll(\".settings-section-host\").forEach((el) => el.remove());\n      await new Promise((r) => setTimeout(r, 400));"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-snav .pw-row",
      "reason": "**取景差异**：量的是导航第一行。画板帧 0 的 `.is-on` 在第 9 行「快捷键」；产品的 `.is-on` 在第 1 行「常规」—— 因为产品里没有「快捷键」这一行。首行因此一个 400 一个 500（board.css:663 `.pw-snav .pw-row.is-on{font-weight:500}`）。壳本身（200px 导航 + `.pw-row` 32 高）两边一致。"
    }
  ],
  "pairs": [
    [
      ".pw-snav",
      ".settings-dialog-surface .pw-snav"
    ],
    [
      ".pw-snav .pw-row",
      ".settings-dialog-surface .pw-snav .pw-row"
    ],
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
      ".pw-scontent",
      ".settings-dialog-surface .pw-scontent"
    ],
    [
      ".pw-grid2",
      ".settings-dialog-surface .pw-grid2"
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
      ".pw-kbd",
      ".settings-dialog-surface .pw-kbd"
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
      ".pw-alert",
      ".settings-dialog-surface .pw-alert"
    ],
    [
      ".pw-input",
      ".settings-dialog-surface .pw-input"
    ],
    [
      ".pw-inline",
      ".settings-dialog-surface .pw-inline"
    ],
    [
      ".pw-radio",
      ".settings-dialog-surface .pw-radio"
    ]
  ]
};
