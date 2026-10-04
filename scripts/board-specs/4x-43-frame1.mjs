// MCP 服务器（画板 43 · 帧 1）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况：
// SettingsUi.tsx:103-480 的分栏基件 + McpConfig 的页面）。
// **画板侧一行不动**，两边靠 pairs 显式配对。
const OPEN_MCP = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="mcp"]');
  if (!row) throw new Error("settings section not found: mcp");
  row.click();
  await new Promise((r) => setTimeout(r, 1800));`;

export default {
  "name": "MCP 服务器（画板 43 · 帧 1）",
  "board": "43-settings-plugins-mcp.html",
  "boardFrame": 1,
  "app": { "script": OPEN_MCP, "settle": 2000 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".d-set-main .d-set-sec",
      "reason": "**取样差异（页头 → 分节）**：v1 的 `.pw-shead` 是一行页头（下边框 + `align-items:flex-end`）；v5 的 `SettingsPage`（`SettingsUi.tsx:618-631`）收成 `div.d-set-sec`。"
    },
    {
      "sel": ".d-set-main .d-set-sec > .d-row > .d-row",
      "reason": "**取样差异（`.pw-shead-acts`）**：v1 的动作区是页头右端一块独立的 `.pw-shead-acts`；v5 把它落成标题行里的 `div.d-row`（`SettingsUi.tsx:624`）。"
    },
    {
      "sel": ".d-set-main .d-set > .d-set-inner",
      "reason": "**取样差异（详情卡 → 内容列）**：`.pw-detail`（board.css:923，描边 + 圆角 6 的巨卡）在 v5 被撤掉；右列就是 `.d-set-inner`。"
    },
    {
      "sel": ".d-set-nav > .d-col",
      "reason": "**形态差异**：`.pw-list`（board.css:900，`display:grid; gap:space-tight`）↔ v5 的 `ConfigSidebarList` 发 `div.d-col`（flex column）。"
    },
    {
      "sel": ".d-set-nav .d-trow",
      "reason": "**形态差异**：`.pw-litem`（board.css:901，7px/8px + 圆角 4 + gap 8）↔ v5 的 MCP 行发 `button.d-trow`（`system.css:687`，26 高 + 左右 8px）。骨架相同，档位按 v5 系统表取值。"
    },
    {
      "sel": ".d-set-nav .d-trow .d-t-sm.d-t-b",
      "reason": "**形态差异**：`.pw-lname`（行内一行名字）↔ v5 的 `ConfigSidebarText` 发 `span.d-t-sm.d-t-b`（`SettingsUi.tsx:270`）。"
    },
    {
      "sel": ".d-seg",
      "reason": "**取样差异（`.pw-radio` → 分段控件）**：v1 的 MCP 帧把「工具曝光 / 认证方式」画成 `.pw-radio` 一排小片；v5 的 `system.css` 里 `.d-radio` / `.d-radiorow` 只定义、**产品一个都没发**，实际承载这些枚举的是 `span.d-seg`。"
    },
    {
      "sel": ".d-set-main .d-set-inner .d-field-t",
      "reason": "**取样差异（`.pw-kv` / `.pw-sec-title`）**：v1 的右列是「`.pw-kv` 标签/值表 + `.pw-sec-title` 分节标题」；v5 收成 `.d-set-row` / `.d-field` 那一族（`McpConfig` 的详情里是 `d-set-row-t` + 右侧值）。"
    },
    {
      "sel": ".d-code-body .tok-k",
      "reason": "**取样差异（token 类名）**：v1 是 `.pw-tok-key/-str/-num/-com/-fn`；v5 的着色类收成 `system.css:190-193` 的 `.tok-k / -s / -n / -c`。对照表里 `.pw-tok-* → .d-code-*` 那一行以产品实况为准。"
    },
    {
      "sel": ".d-set-nav .d-trow .d-badge.bad",
      "reason": "**状态依赖**：画板帧里 `.pw-badge.bad` 是「连不上的服务器」那一枚；实际连不上的服务器才会发 `.bad`，跑对位时全绿（`.d-dot.run`）就量不到。徽章盒的档位由 `.d-badge` 那一对量。"
    },
    {
      "sel": ".d-set-nav .d-trow .d-t-xs.d-t-faint",
      "reason": "**取样差异**：画板帧里 `.pw-lsub` 是行内的副标题（v1.4.0 · 6 个资源）；v5 的 MCP 列表行只有一行名字（`.d-t-sm.d-t-b`），副信息进了详情页的行表。列表列里没有这一枚。"
    },
    {
      "sel": ".d-set-nav .d-trow .d-badge.ok",
      "reason": "**状态依赖**：画板帧里那三枚是列表行的连接状态徽章（已连接 / 需授权 / 连不上）；v5 的 MCP 列表行尾是 `.d-dot.run`（运行态圆点），徽章只出现在详情里。"
    },
    {
      "sel": ".d-set-nav .d-trow .d-badge.warn",
      "reason": "**状态依赖**：同上一条（连接状态徽章 → 运行态圆点）。"
    },
    {
      "sel": ".d-set-nav .d-trow .d-badge.bad",
      "reason": "**状态依赖**：同上一条（连接状态徽章 → 运行态圆点）。"
    },
    {
      "sel": ".d-code-body",
      "reason": "**未落地**：画板帧 1 画的是「Basic / JSON 双模式」，JSON 那一半是配置原文回显（.pw-code-body + token 着色）。v5 的 fork/McpConfig.tsx 里没有 JSON 原文视图（全文一处 d-code-body / tok-* 都没有），代码块只存在于日志弹窗 fork/McpLogModal.tsx:291。所以代码块这几对在产品侧取不到 —— 不是换肤漂移，是这一块功能还没做。"
    },
    {
      "sel": ".d-code-body .tok-k",
      "reason": "**未落地**：同上（MCP 详情没有 JSON 原文视图）。"
    },
    {
      "sel": ".d-code-body .tok-s",
      "reason": "**未落地**：同上（MCP 详情没有 JSON 原文视图）。"
    },
    {
      "sel": ".d-set-main .d-field-t",
      "reason": "**形态差异**：`.pw-field`（board.css:781，「一行标签 + 右控件，`justify-content:space-between`」）↔ v5 的纵向 `.d-field`（`SettingsUi.tsx:377` / `system.css:503`）。这是 D-07 定下的字段形态。"
    }
  ],
  "pairs": [
    // 页头
    [".pw-shead", ".d-set-main .d-set-sec"],
    [".pw-shead-copy > h2", ".d-set-main .d-set-sec > .d-row > .d-t-lg.d-t-b"],
    [".pw-shead-acts", ".d-set-main .d-set-sec > .d-row > .d-row"],
    [".pw-badge.count", ".d-set-main .d-badge.count"],
    [".pw-btn.outline.sm", ".d-set-main .d-btn.outline.sm"],
    [".pw-btn.primary.sm", ".d-set-main .d-btn.primary.sm"],
    // 内容
    [".pw-scontent", ".d-set-main"],
    [".pw-cols", ".d-set-main .d-set"],
    // 列表列
    [".pw-list", ".d-set-nav > .d-col"],
    [".pw-litem", ".d-set-nav .d-trow"],
    [".pw-lname", ".d-set-nav .d-trow .d-t-sm.d-t-b"],
    [".pw-lsub", ".d-set-nav .d-trow .d-t-xs.d-t-faint"],
    [".pw-badge.ok", ".d-set-nav .d-trow .d-badge.ok"],
    [".pw-badge.warn", ".d-set-nav .d-trow .d-badge.warn"],
    [".pw-badge.bad", ".d-set-nav .d-trow .d-badge.bad"],
    // 右列
    [".pw-detail", ".d-set-main .d-set > .d-set-inner"],
    [".pw-inline", ".d-set-main .d-set-inner .fork-pwa-head"],
    [".pw-radio", ".d-seg"],
    [".pw-switch", ".d-switch"],
    [".pw-sec-title", ".d-set-main .d-set-inner .d-set-row-t"],
    [".pw-field", ".d-set-main .d-field"],
    [".pw-field .pw-label", ".d-set-main .d-field-t"],
    [".pw-ctl", ".d-set-main .d-set-row > .d-set-row-box + span"],
    [".pw-selectbox", ".d-select"],
    [".pw-input", ".d-input"],
    [".pw-mono", ".d-mono"],
    [".pw-code-body", ".d-code-body"],
    [".pw-tok-key", ".d-code-body .tok-k"],
    [".pw-tok-str", ".d-code-body .tok-s"]
  ]
};