
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/62-frame2.mjs
export default {
  "name": "设置新框架 · 两栏块流（画板 62 · 帧 2）",
  "board": "62-settings-layout.html",
  "boardFrame": 2,
  "app": {
    "open": "settings:general"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-block",
      "reason": "**数据依赖 + 用户裁定**：块高按内容，画板帧画的是「外观 / 主题皮肤 / 侧栏 / 字体」四块；产品左栏同一组但皮肤卡数量不同，且 2026-10-03 起「壁纸」块从右栏挪到主题皮肤下方"
    },
    {
      "sel": ".settings-dialog-surface .pw-snav-close",
      "reason": "**用户裁定（2026-10-03）**：画板 62 底部那枚「返回工作区」产品不再渲染，关闭口是弹窗右上角的 X"
    },
    {
      "sel": ".settings-dialog-surface .pw-skin-strip",
      "reason": "**接线差异**：产品接线层补了 `padding-bottom:2px`（皮肤卡阴影的呼吸位），画板是 0"
    },
    {
      "sel": ".settings-dialog-surface .pw-skin",
      "reason": "**接线差异**：产品 `.pw-skin` 是 `button`（UA 归零在 fork-ui.css:2327），且末位空槽另加 `.is-new`；画板是 div + 行内 `min-height:96px`"
    },
    {
      "sel": ".settings-dialog-surface .pw-range",
      "reason": "**取景差异**：画板帧第一枚 range 是「边框深度」，产品第一枚也是「边框深度」—— 数值不同但几何应当一致；若报 w/h 差即真漂移，不登记"
    },
    {
      "sel": ".settings-dialog-surface .pw-mono.pw-dim",
      "reason": "**取景差异**：画板帧第一枚是「边框深度」的读数（`50`），产品第一枚是皮肤条动作行末尾那句说明（ThemeSkinStrip.tsx:161）"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.sm",
      "reason": "**取景差异**：画板帧第一枚是「边框深度」的重置钮，产品第一枚是皮肤空槽里的「新建」"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge",
      "reason": "**数据依赖**：产品页头给的是「无页级动作 · 即时生效」这一枚（文案与画板不同 → 宽度不参与判定）"
    },
    {
      "sel": ".settings-dialog-surface .pw-sbody",
      "reason": "**画板自身不一致（B 类）**：同 62-frame1 —— 画板帧 2 的 `.pw-sbody` 同样没归零 24/40/32，与同画板「硬规则」的 1160 自相矛盾；产品 `settings.css:718` 归零后是对的。"
    },
    {
      "sel": ".settings-dialog-surface .pw-wallpaper-thumb",
      "reason": "**状态依赖 + 落位变更**：`WallpaperSettings.tsx:170` 在没设壁纸时不渲染缩略格；2026-10-03 起该块从右栏挪到左栏主题皮肤下方，所以坐标不与画板比。"
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
      ".pw-snav-close",
      ".settings-dialog-surface .pw-snav-close"
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
      ".pw-shead-acts",
      ".settings-dialog-surface .pw-shead-acts"
    ],
    [
      ".pw-badge",
      ".settings-dialog-surface .pw-badge"
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
      ".pw-btn.sm",
      ".settings-dialog-surface .pw-btn.sm"
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
