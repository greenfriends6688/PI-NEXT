// 插件（画板 43 · 帧 0）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况：
// SettingsUi.tsx:103-480 的分栏基件 + PluginsConfig.tsx 的页面）。
// **画板侧一行不动**，两边靠 pairs 显式配对。
const OPEN_PLUGINS = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="plugins"]');
  if (!row) throw new Error("settings section not found: plugins");
  row.click();
  await new Promise((r) => setTimeout(r, 1800));`;

export default {
  "name": "插件（画板 43 · 帧 0）",
  "board": "43-settings-plugins-mcp.html",
  "boardFrame": 0,
  "app": { "script": OPEN_PLUGINS, "settle": 2000 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".d-set-main .d-set-sec",
      "reason": "**取样差异（页头 → 分节）**：v1 的 `.pw-shead` 是一行页头（下边框 + `align-items:flex-end`）；v5 的 `SettingsPage`（`SettingsUi.tsx:618-631`）收成 `div.d-set-sec`。"
    },
    {
      "sel": ".d-set-main .d-set-sec + .d-row",
      "reason": "**取样差异（`.pw-stools`）**：board.css:741 的工具栏是「40 高 + 上下发丝边框 + 左右 40px」的一条独立横条；v5 的 `SettingsPage` 只发一块普通 `div.d-row`。真实几何差：工具条从 40 高带双边框变成内容行高。"
    },
    {
      "sel": ".d-set-main .d-set > .d-set-inner",
      "reason": "**取样差异（详情卡 → 内容列）**：`.pw-detail`（board.css:923，描边 + 圆角 6 的巨卡）在 v5 被撤掉（`PluginsConfig.tsx` 右列同款）；右列就是 `.d-set-inner`。"
    },
    {
      "sel": ".d-set-nav > .d-col",
      "reason": "**形态差异**：`.pw-list`（board.css:900，`display:grid; gap:space-tight`）↔ v5 的 `ConfigSidebarList` 发 `div.d-col`（flex column）。行本身在下面几对里逐项对。"
    },
    {
      "sel": ".d-sess",
      "reason": "**形态差异**：`.pw-litem`（board.css:901，7px/8px + 圆角 4 + gap 8）↔ v5 的插件行发 `button.d-sess`（`system.css:49`，整行块级无描边）。骨架相同，档位按 v5 系统表取值。"
    },
    {
      "sel": ".d-sess-t",
      "reason": "**形态差异**：`.pw-lname`（行内一行名字）↔ v5 的 `.d-sess-t`（`system.css:59`，`fs-body` + 控件行高）。"
    },
    {
      "sel": ".d-set-nav .d-badge.warn",
      "reason": "**状态依赖**：画板帧里 `.pw-badge.warn`（「可更新」）挂在插件列表行尾；v5 的插件列表行尾是 `.d-dot.run`（运行态圆点），徽章只出现在详情里。列表列里没有这一枚 warn 徽章。"
    },
    {
      "sel": ".d-set-main .d-set-inner .d-field-t",
      "reason": "**取样差异（`.pw-kv` / `.pw-sec-title`）**：v1 的右列是「`.pw-kv` 标签/值表 + `.pw-sec-title` 分节标题」；v5 把两样都收成 `.d-set-sec` + `.d-set-row` + `.d-set-row-t/s` 那一族（`PluginsConfig.tsx` 的详情里全是 `d-set-row`）。属性表的行盒档位按 v5 系统表取值。"
    },
    {
      "sel": ".d-set-main .d-set > .d-set-inner > .d-row",
      "reason": "**取样差异（`.pw-inline`）**：详情头那一行横排在 v5 发 `div.d-row.fork-pwa-head`。"
    }
  ],
  "pairs": [
    // 页头
    [".pw-shead", ".d-set-main .d-set-sec"],
    [".pw-shead-copy > h2", ".d-set-main .d-set-sec > .d-row > .d-t-lg.d-t-b"],
    [".pw-shead-acts", ".d-set-main .d-set-sec > .d-row > .d-row"],
    [".pw-btn.outline.sm", ".d-set-main .d-btn.outline.sm"],
    [".pw-btn.primary.sm", ".d-set-main .d-btn.primary.sm"],
    [".pw-btn.danger.sm", ".d-set-main .d-btn.danger.sm"],
    [".pw-btn.sm", ".d-set-main .d-btn.sm"],
    // 工具栏
    [".pw-stools", ".d-set-main .d-set-sec + .d-row"],
    [".pw-badge.count", ".d-set-main .d-badge.count"],
    // 内容
    [".pw-scontent", ".d-set-main"],
    [".pw-cols", ".d-set-main .d-set"],
    // 列表列
    [".pw-list", ".d-set-nav > .d-col"],
    [".pw-litem", ".d-set-nav .d-sess"],
    [".pw-lname", ".d-set-nav .d-sess-t"],
    [".pw-lsub", ".d-set-nav .d-sess-t.d-grow"],
    [".pw-badge.warn", ".d-set-nav .d-badge.warn"],
    [".pw-badge", ".d-set-main .d-badge"],
    // 右列
    [".pw-detail", ".d-set-main .d-set > .d-set-inner"],
    [".pw-inline", ".d-set-main .d-set > .d-set-inner > .d-row"],
    [".pw-kv", ".d-set-main .d-set-inner .d-set-sec"],
    [".pw-kv dt", ".d-set-main .d-set-inner .d-set-row-t"],
    [".pw-kv dd", ".d-set-main .d-set-inner .d-set-row-s"],
    [".pw-sec-title", ".d-set-main .d-set-inner .d-set-sec-t"],
    [".pw-switch", ".d-switch"],
    [".pw-mono", ".d-mono"]
  ]
};