
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-40-frame1.mjs
export default {
  "name": "设置 · 常规续（画板 40 · 帧 1：字体 / 语言 / 聊天 / Shell / 推送）",
  "board": "40-settings-general.html",
  "boardFrame": 1,
  "app": {
    "open": "settings:general"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-frame-body.pw-grid2 > div",
      "reason": "**取景差异**：board-diff 会剥掉画板的 `.pw-frame-body.pw-pad`，这一格在剥壳后不再是同一层；行集合也不同（画板是节选）"
    }
  ],
  "pairs": [
    [
      ".pw-frame-body.pw-grid2 > div",
      ".settings-dialog-surface .pw-frame-body.pw-grid2 > div"
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
      ".pw-field .pw-label small",
      ".settings-dialog-surface .pw-field .pw-label small"
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
      ".pw-switch",
      ".settings-dialog-surface .pw-switch"
    ],
    [
      ".pw-radio",
      ".settings-dialog-surface .pw-radio"
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
      ".pw-mono.pw-dim",
      ".settings-dialog-surface .pw-mono.pw-dim"
    ]
  ]
};
