
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-42-frame1.mjs
export default {
  "name": "技能（画板 42 · 帧 1：作用域列表 + SKILL.md）",
  "board": "42-settings-agents-skills.html",
  "boardFrame": 1,
  "app": {
    "open": "settings:skills"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-switch",
      "reason": "**取景差异 + 独立真偏离**：画板帧 1 的第一枚 `.pw-switch` 是**列表行里**那枚（写了 `transform:scale(.8)` → 24×13.6），产品的第一枚在 `.pw-field` 里（30×17）。取景不同先放行；「产品没给列表行开关做 scale(.8)」这条单独记在报告里（见 42-frame0 / 44-frame0 / 46-frame2 同一现象）。"
    },
    {
      "sel": ".settings-dialog-surface .pw-kv dd",
      "reason": "**取景差异**：画板第一枚 `<dd>` 是纯文本（继承 `.pw-kv` 的 `--text-secondary` 12px），产品第一枚 `<dd class=\"pw-mono\">`（board.css:65 的 `.pw-mono` 是 `--text-meta` 11px）。"
    },
    {
      "sel": ".settings-dialog-surface .pw-textarea",
      "reason": "**状态依赖**：SKILL.md 只读态走 `.skill-content-view`（SkillsConfig.tsx:357），`.pw-textarea`（:342）只在编辑态渲染。"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge.accent",
      "reason": "**数据依赖**：`ConfigBadge tone=\"accent\"` 挂在技能行与详情头（SkillsConfig.tsx:191），第一行恰好没有。"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge.warn",
      "reason": "**数据依赖**：同 `.pw-badge.accent`（「可更新」）。"
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
      ".pw-btn.primary.sm",
      ".settings-dialog-surface .pw-btn.primary.sm"
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
      ".pw-badge.accent",
      ".settings-dialog-surface .pw-badge.accent"
    ],
    [
      ".pw-badge.warn",
      ".settings-dialog-surface .pw-badge.warn"
    ],
    [
      ".pw-switch",
      ".settings-dialog-surface .pw-switch"
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
      ".pw-sec-title",
      ".settings-dialog-surface .pw-sec-title"
    ],
    [
      ".pw-textarea",
      ".settings-dialog-surface .pw-textarea"
    ],
    [
      ".pw-btn.sm",
      ".settings-dialog-surface .pw-btn.sm"
    ],
    [
      ".pw-btn.primary.sm",
      ".settings-dialog-surface .pw-btn.primary.sm"
    ]
  ]
};
