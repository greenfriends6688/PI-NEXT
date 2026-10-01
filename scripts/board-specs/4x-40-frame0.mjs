
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-40-frame0.mjs
export default {
  "name": "设置 · 常规整屏（画板 40 · 帧 0）",
  "board": "40-settings-general.html",
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
      "sel": ".settings-dialog-surface .pw-range",
      "reason": "**画板自身不一致（B 类·UA 层）**：board.css:1191 的 `.pw-range` 只给几何，没写 `font: inherit`，所以画板里那个裸 `<input type=range>` 保留 UA 字体（13.3333px / normal）；产品按 §4.1 把表单控件 UA 归零（12px / 18px）。range 不渲染文字，这三项不可见。"
    },
    {
      "sel": ".settings-dialog-surface .pw-wallpaper-thumb",
      "reason": "**状态依赖**：`WallpaperSettings.tsx:170` 在 `url == null` 时**不渲染**缩略格（种子环境没设壁纸）；画板帧 0 画的是「已有当前壁纸」那一态。"
    },
    {
      "sel": ".settings-dialog-surface .pw-skin-strip",
      "reason": "**接线层**：app/fork-ui.css:2347 给皮肤条补 `padding-bottom: 2px`（卡片阴影的呼吸位）+ `overflow-x:auto`；画板 board.css:855 没有。外观值一致，只差这一档留白。"
    },
    {
      "sel": ".settings-dialog-surface .pw-skin .cap",
      "reason": "**接线层**：app/fork-ui.css:2339 把 `.cap` 从 board.css:861 的 `display:flex` 改成 `display:grid; grid-auto-flow:column`（button 的内容模型只能放 phrasing 内容，`prev` 也一并改成 grid）。外观近似但结构已不同。"
    }
  ],
  "pairs": [
    [
      ".pw-settings",
      ".settings-dialog-body.pw-settings"
    ],
    [
      ".pw-snav",
      ".settings-dialog-surface .pw-snav"
    ],
    [
      ".pw-snav .pw-row",
      ".settings-dialog-surface .pw-snav .pw-row"
    ],
    [
      ".pw-snav .pw-name",
      ".settings-dialog-surface .pw-snav .pw-name"
    ],
    [
      ".pw-sbody",
      ".settings-dialog-surface .pw-sbody"
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
      ".pw-shead-copy > p.sub",
      ".settings-dialog-surface .pw-shead-copy > p.sub"
    ],
    [
      ".pw-scontent",
      ".settings-dialog-surface .pw-scontent"
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
      ".pw-radio",
      ".settings-dialog-surface .pw-radio"
    ],
    [
      ".pw-range",
      ".settings-dialog-surface .pw-range"
    ],
    [
      ".pw-mono.pw-dim",
      ".settings-dialog-surface .pw-mono.pw-dim"
    ],
    [
      ".pw-skin-strip",
      ".settings-dialog-surface .pw-skin-strip"
    ],
    [
      ".pw-skin",
      ".settings-dialog-surface .pw-skin"
    ],
    [
      ".pw-skin .prev",
      ".settings-dialog-surface .pw-skin .prev"
    ],
    [
      ".pw-skin .cap",
      ".settings-dialog-surface .pw-skin .cap"
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
      ".pw-switch",
      ".settings-dialog-surface .pw-switch"
    ],
    [
      ".pw-selectbox",
      ".settings-dialog-surface .pw-selectbox"
    ],
    [
      ".pw-wallpaper-thumb",
      ".settings-dialog-surface .pw-wallpaper-thumb"
    ]
  ]
};
