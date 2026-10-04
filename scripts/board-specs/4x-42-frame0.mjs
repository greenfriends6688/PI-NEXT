// 子代理（画板 42 · 帧 0）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况：
// SettingsUi.tsx:103-480 的分栏基件 + AgentsConfig.tsx:552-895 的页面）。
// **画板侧一行不动**，两边靠 pairs 显式配对。
const OPEN_AGENTS = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="agents"]');
  if (!row) throw new Error("settings section not found: agents");
  row.click();
  await new Promise((r) => setTimeout(r, 1800));`;

export default {
  "name": "子代理（画板 42 · 帧 0）",
  "board": "42-settings-agents-skills.html",
  "boardFrame": 0,
  "app": { "script": OPEN_AGENTS, "settle": 2000 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".d-set-main .d-set-sec",
      "reason": "**取样差异（页头 → 分节）**：v1 的 `.pw-shead` 是一行页头（下边框 + `align-items:flex-end`）；v5 的 `SettingsPage`（`SettingsUi.tsx:618-631`）把它收成 `div.d-set-sec` —— 标题 `.d-row > .d-t-lg.d-t-b`、副标题 `.d-t-xs.d-t-faint`、动作在标题行右端。内容逐项对位，外层那一圈按 v5 系统表取值。"
    },
    {
      "sel": ".d-set-main .d-set > .d-set-inner",
      "reason": "**取样差异（详情卡 → 内容列）**：`.pw-detail`（board.css:923，描边 + 圆角 6 的一张巨卡）在 v5 被撤掉（`AgentsConfig.tsx:667` 的注释同款）；右列就是 `.d-set-inner`。"
    },
    {
      "sel": ".d-set-nav .d-set-sec",
      "reason": "**取样差异（卡 → 分节）**：画板把「内置子代理 / 并发上限」做成一张 `.pw-block` 卡；v5 在列表列里用 `div.d-set-sec` + `.d-set-row` 直接排（`AgentsConfig.tsx:576-600`），不套卡壳。卡壳的描边 / 圆角 / 内距随 v5「无框分节」裁定退场。"
    },
    {
      "sel": ".d-group-title",
      "reason": "**取样差异（`.pw-block > h3`）**：画板那一块的标题写在 `.pw-block > h3` 上；v5 的列表列里没有块标题，那一句「内置」是**分组标题** `div.d-group-title`（`SettingsUi.tsx:128` 的 `ConfigSidebarGroupLabel`）。这一对量的是分组标题行本体。"
    },
    {
      "sel": ".d-sess",
      "reason": "**形态差异**：v1 的 `.pw-litem`（board.css:901）是「7px/8px + 圆角 4 + gap 8」的行；v5 的子代理行发 `button.d-sess`（`system.css:49`，会话行那一族：整行、块级、无描边）。行的骨架逐项在 `.d-sess-t` / `.d-sess-m` 里对；行盒本身按 v5 系统表取值。"
    },
    {
      "sel": ".d-sess-m",
      "reason": "**形态差异**：`.pw-lsub` 是行内一行弱化副标题；v5 拆成 `.d-sess-t`（名字）+ `.d-sess-m`（副标题，`system.css:61`，`margin-top:2px`）。同一句说明，落在 v5 指定的类上。"
    },
    {
      "sel": ".d-field-t",
      "reason": "**形态差异**：右列字段从 v1 的「一行标签 + 右控件」改成 v5 的纵向 `.d-field`（`SettingsUi.tsx:377` / `system.css:503`）。这是 D-07 定下的字段形态，逐项在 `.d-field` / `.d-field-t` 两对里做。"
    },
    {
      "sel": ".d-set-main .d-set > .d-set-inner > .d-row",
      "reason": "**取样差异（`.pw-inline`）**：v1 的 `.pw-inline` 是详情头那一行横排；v5 发 `div.d-row.fork-pwa-head`（`AgentsConfig.tsx:676`）。同一行，类名换过。"
    },
    {
      "sel": ".d-field-t",
      "reason": "**取样差异（`.pw-sec-title` → 字段标题）**：画板右列的「描述 / 系统指令 / 工具与资源」是独立的 `.pw-sec-title`（带一条撑满的发丝线）；v5 把它们降成 `.d-field` 的 `.d-field-t` 标题。分节壳没有了。"
    },
    {
      "sel": ".d-chips",
      "reason": "**取样差异（`.pw-wrap`）**：v1 的 `.pw-wrap` 是「flex-wrap 一排芯片」；v5 发 `div.d-chips`（画板 D-12 的芯片行）。芯片本体是 `button.d-chipbtn`，选中态是 `.is-on`（不再是 `.accent`）。"
    },
    {
      "sel": ".d-set-main .d-set-row > .d-grow-last",
      "reason": "**取样差异（`.pw-ctl`）**：board.css:786 的 `.pw-field .pw-ctl` 是字段行右端槽；v5 的 `.d-field` 是纵向字段、没有这一槽，槽位只存在于 `.d-set-row` 一族（`system.css:492`）。这一对量的是 v5 里实际承载控件槽的那一枚。"
    },
    {
      "sel": ".d-set-nav .d-badge.ok",
      "reason": "**数据依赖**：画板帧里 `.pw-badge.ok`（Explore / Plan 的「启用」徽章）在 v5 的子代理列表行上不存在 —— 行尾是 `.d-dot.run`（运行态圆点），v5 把这层徽章换成了点。徽章盒的档位由 `.d-badge` 那一对量。"
    },
    {
      "sel": ".d-set-main .d-btn.danger.sm",
      "reason": "**状态依赖**：画板帧里那两枚是详情头部的「复制」与「删除」；v5 的子代理页只在**编辑态**（`mode === \"edit\"`，`AgentsConfig.tsx:697`）发「删除」，默认停在**查看态**（只有「创建副本」）。量到的是实际存在的那一枚 `.d-btn.danger.sm`。"
    },
    {
      "sel": ".d-set-main .d-badge.warn",
      "reason": "**状态依赖**：画板帧里 `.pw-badge.warn` 是「改动需要重载会话才生效」；v5 的子代理页把这句降成行内说明（`.d-set-row-s`）与 `.d-banner.info`（`AgentsConfig.tsx` 的详情里），列表列里没有这一枚 warn 徽章。"
    }
  ],
  "pairs": [
    // 页头
    [".pw-shead", ".d-set-main .d-set-sec"],
    [".pw-shead-copy > h2", ".d-set-main .d-set-sec > .d-row > .d-t-lg.d-t-b"],
    [".pw-shead-copy > p.sub", ".d-set-main .d-set-sec > .d-t-xs.d-t-faint"],
    [".pw-shead-acts", ".d-set-main .d-set-sec > .d-row > .d-row"],
    [".pw-btn.primary.sm", ".d-set-main .d-btn.primary.sm"],
    // 工具栏
    [".pw-stools", ".d-set-main .d-set-sec + .d-row"],
    [".pw-search", ".d-set-main .d-searchfield"],
    [".pw-badge.count", ".d-set-main .d-badge.count"],
    // 内容
    [".pw-scontent", ".d-set-main"],
    [".pw-cols", ".d-set-main .d-set"],
    // 列表列里的那块「内置子代理」
    [".pw-block", ".d-set-nav .d-set-sec"],
    [".pw-block > h3", ".d-set-nav .d-group-title"],
    [".pw-list", ".d-set-nav > .d-col"],
    [".pw-group-title", ".d-group-title"],
    [".pw-litem", ".d-set-nav .d-sess"],
    [".pw-litem.is-on", ".d-set-nav .d-sess.is-on"],
    [".pw-lname", ".d-set-nav .d-sess-t"],
    [".pw-lsub", ".d-set-nav .d-sess-m"],
    [".pw-badge.ok", ".d-set-nav .d-badge.ok"],
    [".pw-badge.warn", ".d-set-main .d-badge.warn"],
    // 右列
    [".pw-detail", ".d-set-main .d-set > .d-set-inner"],
    [".pw-inline", ".d-set-main .d-set > .d-set-inner > .d-row"],
    [".pw-grid2", ".d-set-main .d-set-inner .d-grid2"],
    [".pw-field", ".d-set-main .d-set-inner .d-field"],
    [".pw-field .pw-label", ".d-set-main .d-set-inner .d-field-t"],
    [".pw-ctl", ".d-set-main .d-set-row > .d-grow-last"],
    [".pw-selectbox", ".d-select"],
    [".pw-input", ".d-input"],
    [".pw-switch", ".d-switch"],
    [".pw-sec-title", ".d-set-main .d-set-inner .d-field-t"],
    [".pw-textarea", ".d-textarea"],
    [".pw-wrap", ".d-set-main .d-set-inner .d-chips"],
    [".pw-chip", ".d-chips .d-chipbtn"],
    [".pw-chip.accent", ".d-chips .d-chipbtn.is-on"],
    [".pw-btn.sm", ".d-set-main .d-btn.sm"],
    [".pw-btn.danger.sm", ".d-set-main .d-btn.danger.sm"],
    [".pw-mono", ".d-mono"]
  ]
};