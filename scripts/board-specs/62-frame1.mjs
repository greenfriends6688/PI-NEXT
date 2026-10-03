
//
// 跑法：APP_URL=http://127.0.0.1:32141 node scripts/board-diff.mjs scripts/board-specs/62-frame1.mjs
export default {
  "name": "设置新框架 · 列表页解剖（画板 62 · 帧 1）",
  "board": "62-settings-layout.html",
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
      "sel": ".settings-dialog-surface .pw-snav",
      "reason": "**取景差异**：画板帧 1 的导航多一行「返回工作区」（2026-10-03 用户裁定已从产品撤掉）；项数是 12，高度差来自滚动条与分组间距"
    },
    {
      "sel": ".settings-dialog-surface .pw-snav .pw-row",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-snav .pw-name",
      "reason": "同上（第一行是「常规」，两边文本不同 → 宽度不参与判定）"
    },
    {
      "sel": ".settings-dialog-surface .pw-snav-close",
      "reason": "**用户裁定（2026-10-03）**：画板 62 底部那枚「返回工作区」产品不再渲染，关闭口是弹窗右上角的 X。画板自身也不一致（62 用 `arrow-left`、40 用 `panel-left-close`）"
    },
    {
      "sel": ".settings-dialog-surface .pw-sep",
      "reason": "**未实现**：画板 62 帧 B 工具栏里搜索与筛选芯片之间有一条 `.pw-sep` 发丝线；产品的 `.pw-stools` 没有这一枚（见报告）"
    },
    {
      "sel": ".settings-dialog-surface .pw-litem",
      "reason": "**数据依赖**：列表第一行的内容不同（画板是项目作用域技能 + SkillHub 徽章），宽度按文本判定后跳过"
    },
    {
      "sel": ".settings-dialog-surface .pw-litem.is-on",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-lname",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-lsub",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge.accent",
      "reason": "**数据依赖**：SkillHub 来源徽章只挂在市场来源的技能上"
    },
    {
      "sel": ".settings-dialog-surface .pw-badge.warn",
      "reason": "同上（「可更新」徽章）"
    },
    {
      "sel": ".settings-dialog-surface .pw-detail",
      "reason": "**状态依赖**：详情卡高度按内容收口，画板画的是「SKILL.md 可编辑 + 磁盘冲突」那一态，产品是只读态"
    },
    {
      "sel": ".settings-dialog-surface .pw-kv",
      "reason": "同上"
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
      "sel": ".settings-dialog-surface .pw-sec-title",
      "reason": "同上"
    },
    {
      "sel": ".settings-dialog-surface .pw-textarea",
      "reason": "同上（SKILL.md）"
    },
    {
      "sel": ".settings-dialog-surface .pw-switch",
      "reason": "**数据依赖**：技能行的启用开关只出现在全局作用域的技能上"
    },
    {
      "sel": ".settings-dialog-surface .pw-inline",
      "reason": "同上（详情头）"
    },
    {
      "sel": ".settings-dialog-surface .pw-sbody",
      "reason": "**画板自身不一致（B 类）**：画板 62 帧 1 的 `.pw-sbody` 只有行内 `display:flex; flex-direction:column; min-height:0`，**没有把 board.css 的 24/40/32 内边距归零**，于是页头与内容区各自再出 40 → 横向实际内缩 80px，与同帧「硬规则」里写的「可用 1160」自相矛盾（1240−160=1080）。产品 `settings.css:718` 用 `:has(.pw-shead)` 把宿主内边距归零 → 1240−80=1160，**与画板自己的硬规则一致、与画板样张不一致**。"
    },
    {
      "sel": ".settings-dialog-surface .pw-search input",
      "reason": "**画板自身不一致（B 类·UA 层）**：board.css:705 的 `.pw-stools .pw-search input` 没归零 `padding`，画板量到 UA 的 `1px 2px`；产品归零为 `0`。"
    },
    {
      "sel": ".settings-dialog-surface .pw-group-title",
      "reason": "**画板自身不一致（B 类）**：board.css:157-160 的 `.pw-group-title` 是 `padding: var(--s3) var(--s2) var(--s1)`（12px 8px 4px），产品照的就是它；画板帧 0 / 帧 1 的**样张**又行内写了 `padding-top:0` / `padding-top:var(--s2)`（8px），把上内距压掉。以规则为准。"
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
      ".pw-shead-copy",
      ".settings-dialog-surface .pw-shead-copy"
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
      ".pw-sep",
      ".settings-dialog-surface .pw-sep"
    ],
    [
      ".pw-radio",
      ".settings-dialog-surface .pw-radio"
    ],
    [
      ".pw-grow",
      ".settings-dialog-surface .pw-grow"
    ],
    [
      ".pw-badge.count",
      ".settings-dialog-surface .pw-badge.count"
    ],
    [
      ".pw-btn.sm",
      ".settings-dialog-surface .pw-btn.sm"
    ],
    [
      ".pw-scontent",
      ".settings-dialog-surface .pw-scontent"
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
      ".pw-group-title",
      ".settings-dialog-surface .pw-group-title"
    ],
    [
      ".pw-list",
      ".settings-dialog-surface .pw-list"
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
      ".pw-btn.primary.sm",
      ".settings-dialog-surface .pw-btn.primary.sm"
    ]
  ]
};
