
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-42-frame0.mjs
export default {
  "name": "子代理（画板 42 · 帧 0）",
  "board": "42-settings-agents-skills.html",
  "boardFrame": 0,
  "app": {
    "open": "settings:agents"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-badge.ok",
      "reason": "**数据依赖**：画板帧 0 的「内置」组里有 Explore / Plan 两行带 `.pw-badge ok`；种子环境只有 3 个自定义子代理，内置组为空。"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge.warn",
      "reason": "**状态依赖**：`AgentsConfig.tsx:553-561` 那枚「改动需要重载会话才生效」徽章 gated 在 `reloadNeeded`（本次会话没改过内置开关 → false）。"
    },
    {
      "sel": ".settings-dialog-surface .pw-btn.danger.sm",
      "reason": "**状态依赖**：「删除」在详情头，要先选中一条子代理。"
    },
    {
      "sel": ".settings-dialog-surface .pw-group-title",
      "reason": "**画板自身不一致（B 类）**：board.css:157-160 的 `.pw-group-title` 是 `padding: var(--s3) var(--s2) var(--s1)`（12px 8px 4px），产品照的就是它；画板帧 0 / 帧 1 的**样张**又行内写了 `padding-top:0` / `padding-top:var(--s2)`（8px），把上内距压掉。以规则为准。"
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
      ".pw-shead-acts",
      ".settings-dialog-surface .pw-shead-acts"
    ],
    [
      ".pw-btn.primary.sm",
      ".settings-dialog-surface .pw-btn.primary.sm"
    ],
    [
      ".pw-stools",
      ".settings-dialog-surface .pw-stools"
    ],
    [
      ".pw-search",
      ".settings-dialog-surface .pw-search"
    ],
    [
      ".pw-badge.count",
      ".settings-dialog-surface .pw-badge.count"
    ],
    [
      ".pw-scontent",
      ".settings-dialog-surface .pw-scontent"
    ],
    [
      ".pw-cols",
      ".settings-dialog-surface .pw-cols"
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
      ".pw-list",
      ".settings-dialog-surface .pw-list"
    ],
    [
      ".pw-group-title",
      ".settings-dialog-surface .pw-group-title"
    ],
    [
      ".pw-litem",
      ".settings-dialog-surface .pw-litem"
    ],
    [
      ".pw-litem.is-on",
      ".settings-dialog-surface .pw-litem.is-on"
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
      ".pw-badge.ok",
      ".settings-dialog-surface .pw-badge.ok"
    ],
    [
      ".pw-badge.warn",
      ".settings-dialog-surface .pw-badge.warn"
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
      ".pw-grid2",
      ".settings-dialog-surface .pw-grid2"
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
      ".pw-selectbox",
      ".settings-dialog-surface .pw-selectbox"
    ],
    [
      ".pw-input",
      ".settings-dialog-surface .pw-input"
    ],
    [
      ".pw-switch",
      ".settings-dialog-surface .pw-switch"
    ],
    [
      ".pw-sec-title",
      ".settings-dialog-surface .pw-sec-title"
    ],
    [
      ".pw-textarea",
      ".settings-dialog-surface .pw-textarea"
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
      ".pw-btn.sm",
      ".settings-dialog-surface .pw-btn.sm"
    ],
    [
      ".pw-btn.danger.sm",
      ".settings-dialog-surface .pw-btn.danger.sm"
    ],
    [
      ".pw-mono",
      ".settings-dialog-surface .pw-mono"
    ]
  ]
};
