
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/4x-41-frame0.mjs
export default {
  "name": "模型 · 供应商详情（画板 41 · 帧 0）",
  "board": "41-settings-models.html",
  "boardFrame": 0,
  "app": {
    "open": "settings:models"
  },
  "tolerance": {
    "box": 2,
    "fontSize": 0
  },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-litem",
      "reason": "**数据依赖**：种子 agent 目录里 0 个供应商，左列没有行"
    },
    {
      "sel": ".settings-dialog-surface .pw-litem.is-on",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-lname",
      "reason": "同上（随 .pw-litem 才有）"
    },
    {
      "sel": ".settings-dialog-surface .pw-lsub",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-detail",
      "reason": "**状态依赖**：没选中供应商时右列是空态"
    },
    {
      "sel": ".settings-dialog-surface .pw-detail-stack",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-inline",
      "reason": "同上（详情头行）"
    },
    {
      "sel": ".settings-dialog-surface .pw-kv",
      "reason": "同上（供应商属性表）"
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
      "sel": ".settings-dialog-surface .pw-badge.ok",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-stats-grid",
      "reason": "同上（用量摘要）"
    },
    {
      "sel": ".settings-dialog-surface .pw-stat",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-stat .k",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-stat .v",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-switch",
      "reason": "同上（模型启用行左侧的开关）"
    },
    {
      "sel": ".settings-dialog-surface .pw-hint",
      "reason": "同上（模型列表下方的说明）"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge.warn",
      "reason": "**数据依赖**：徽章挂在列表行上"
    },
    {
      "sel": ".settings-dialog-surface .pw-group-title",
      "reason": "**数据依赖**：`ModelsConfig.tsx:2539/2587` 的分组标题（「订阅」/「自定义」）是**条件渲染**（`managedProviders.length > 0` / `visibleProviders.length > 0`）；种子目录 0 个供应商 → 一条都没有。画板 41 帧 0 画的是 6 个供应商那一态。"
    },
    {
      "sel": ".settings-dialog-surface .pw-stat .s",
      "reason": "**数据依赖**：第三行补充只在有用量时渲染（同 `.pw-stats-grid`）"
    },
    {
      "sel": ".settings-dialog-surface .pw-mono",
      "reason": "**数据依赖**：画板里第一枚 `.pw-mono` 在 `.pw-kv dd`（接口地址），没选中供应商时没有"
    },
    {
      "sel": ".settings-dialog-surface .pw-search input",
      "reason": "**画板自身不一致（B 类·UA 层）**：board.css:705 的 `.pw-stools .pw-search input` 只归零 `border/background`，没归零 `padding`，所以画板量到 UA 的 `1px 2px`；产品的 UA 归零层给出 `0`。搜索框是空的，肉眼不可见。"
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
      ".pw-btn.outline.sm",
      ".settings-dialog-surface .pw-btn.outline.sm"
    ],
    [
      ".pw-btn.primary.sm",
      ".settings-dialog-surface .pw-btn.primary.sm"
    ],
    [
      ".pw-btn.sm",
      ".settings-dialog-surface .pw-btn.sm"
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
      ".pw-search input",
      ".settings-dialog-surface .pw-search input"
    ],
    [
      ".pw-badge.count",
      ".settings-dialog-surface .pw-badge.count"
    ],
    [
      ".pw-scontent.is-fixed",
      ".settings-dialog-surface .pw-scontent.is-fixed"
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
      ".pw-detail-stack",
      ".settings-dialog-surface .pw-detail-stack"
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
      ".pw-stats-grid",
      ".settings-dialog-surface .pw-stats-grid"
    ],
    [
      ".pw-stat",
      ".settings-dialog-surface .pw-stat"
    ],
    [
      ".pw-stat .k",
      ".settings-dialog-surface .pw-stat .k"
    ],
    [
      ".pw-stat .v",
      ".settings-dialog-surface .pw-stat .v"
    ],
    [
      ".pw-stat .s",
      ".settings-dialog-surface .pw-stat .s"
    ],
    [
      ".pw-switch",
      ".settings-dialog-surface .pw-switch"
    ],
    [
      ".pw-hint",
      ".settings-dialog-surface .pw-hint"
    ],
    [
      ".pw-mono",
      ".settings-dialog-surface .pw-mono"
    ]
  ]
};
