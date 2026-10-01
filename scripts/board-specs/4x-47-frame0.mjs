
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-47-frame0.mjs
export default {
  "name": "皮肤条（画板 47 · 帧 0）",
  "board": "47-skin-studio.html",
  "boardFrame": 0,
  "app": {
    "open": "settings:general"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-btn.danger.sm",
      "reason": "**接线差异**：画板 47 帧 0 的动作行末尾有「删除当前皮肤」；产品的删除在工作室对话框的动作行里（ThemeSkinStudio），条上没有这一枚 —— 见报告"
    },
    {
      "sel": ".settings-dialog-surface .pw-alert.info",
      "reason": "**接线差异**：画板 47 帧 0 在条下面常驻一条「皮肤覆盖单一强调色约定」的提示；产品把这句降级成动作行末端的 `.pw-mono.pw-dim` 小字，不是 `.pw-alert`"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.sm",
      "reason": "**取景差异**：画板量的是「新建皮肤」空槽里那枚；产品空槽的类名是 `.pw-skin.is-new`（接线层补的几何），量到的是别的 `.pw-btn.sm`"
    },
    {
      "sel": ".settings-dialog-surface .pw-grow",
      "reason": "**取景差异**：画板帧 0 的第一枚 `.pw-grow` 是皮肤动作行里那个撑满剩余宽度的 spacer（1031×0）；产品设置面板里的第一枚是别的位置的 grow（183×447）。"
    }
  ],
  "pairs": [
    [
      ".pw-skin-strip",
      ".settings-dialog-surface .pw-skin-strip"
    ],
    [
      ".pw-skin",
      ".settings-dialog-surface .pw-skin"
    ],
    [
      ".pw-skin.is-on",
      ".settings-dialog-surface .pw-skin.is-on"
    ],
    [
      ".pw-skin .prev",
      ".settings-dialog-surface .pw-skin .prev"
    ],
    [
      ".pw-skin .prev .a",
      ".settings-dialog-surface .pw-skin .prev .a"
    ],
    [
      ".pw-skin .prev .b",
      ".settings-dialog-surface .pw-skin .prev .b"
    ],
    [
      ".pw-skin .cap",
      ".settings-dialog-surface .pw-skin .cap"
    ],
    [
      ".pw-btn.sm",
      ".settings-dialog-surface .pw-btn.sm"
    ],
    [
      ".pw-inline.pw-skin-actions",
      ".settings-dialog-surface .pw-inline.pw-skin-actions"
    ],
    [
      ".pw-btn.outline.sm",
      ".settings-dialog-surface .pw-btn.outline.sm"
    ],
    [
      ".pw-btn.danger.sm",
      ".settings-dialog-surface .pw-btn.danger.sm"
    ],
    [
      ".pw-grow",
      ".settings-dialog-surface .pw-grow"
    ],
    [
      ".pw-alert.info",
      ".settings-dialog-surface .pw-alert.info"
    ]
  ]
};
