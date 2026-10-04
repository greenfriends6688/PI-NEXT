// 技能（画板 42 · 帧 1）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况：
// SettingsUi.tsx:103-480 的分栏基件 + SkillsConfig.tsx 的页面）。
// **画板侧一行不动**，两边靠 pairs 显式配对。
const OPEN_SKILLS = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="skills"]');
  if (!row) throw new Error("settings section not found: skills");
  row.click();
  await new Promise((r) => setTimeout(r, 2000));
  // fork:v5-settings-map —— 画板帧 1 量的是**选中一条技能**之后的右列（含 SKILL.md
  // 文本域）。默认停在空态，点开第一行再量。
  const first = document.querySelector(".settings-section-host:not([hidden]) .d-set-nav .d-sess");
  if (first) { first.click(); await new Promise((r) => setTimeout(r, 1800)); }
  // SKILL.md 卡片默认是只读回显，要点「编辑」才换成文本域（SkillsConfig.tsx:497-546）。
  const edit = [...document.querySelectorAll(".settings-section-host:not([hidden]) .d-btn.sm")]
    .find((b) => /编辑|edit/i.test(b.textContent ?? ""));
  if (edit) { edit.click(); await new Promise((r) => setTimeout(r, 1200)); }`;

export default {
  "name": "技能（画板 42 · 帧 1）",
  "board": "42-settings-agents-skills.html",
  "boardFrame": 1,
  "app": { "script": OPEN_SKILLS, "settle": 1800 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".d-set-main .d-set-sec",
      "reason": "**取样差异（页头 → 分节）**：v1 的 `.pw-shead` 是一行页头（下边框 + `align-items:flex-end`）；v5 的 `SettingsPage`（`SettingsUi.tsx:618-631`）收成 `div.d-set-sec`。内容逐项对位，外圈按 v5 系统表取值。"
    },
    {
      "sel": ".d-set-main .d-set-sec > .d-row > .d-row",
      "reason": "**取样差异（`.pw-shead-acts`）**：v1 的动作区是页头右端一块独立的 `.pw-shead-acts`（`flex:none; display:flex`）；v5 把它落成标题行里的 `div.d-row`（`SettingsUi.tsx:624`）。同一块动作区，宿主类换了。"
    },
    {
      "sel": ".d-set-main .d-set-sec + .d-row",
      "reason": "**取样差异（`.pw-stools`）**：board.css:741 的工具栏是「40 高 + 上下各一条发丝边框 + 左右 40px 内距」的一条独立横条；v5 的 `SettingsPage` 只发一块普通 `div.d-row`（`SettingsUi.tsx:628`），高度与边框都按 v5 系统表走。这是一处**真实的几何差**：工具条从 40 高带双边框变成内容行高。"
    },
    {
      "sel": ".d-set-main .d-set > .d-set-inner",
      "reason": "**取样差异（详情卡 → 内容列）**：`.pw-detail`（board.css:923，描边 + 圆角 6 的巨卡）在 v5 被撤掉（`SkillsConfig.tsx:1459` 的注释同款）；右列就是 `.d-set-inner`。"
    },
    {
      "sel": ".d-set-nav > .d-col",
      "reason": "**形态差异**：`.pw-list`（board.css:900）是 `display:grid; gap:space-tight; align-content:start`；v5 的 `ConfigSidebarList` 发 `div.d-col`（flex column）。行本身的对位在下面几对里逐项做。"
    },
    {
      "sel": ".d-sess",
      "reason": "**形态差异**：`.pw-litem`（board.css:901，7px/8px + 圆角 4 + gap 8）↔ v5 的 `button.d-sess`（`system.css:49`，会话行那一族，整行块级无描边）。骨架相同、档位按 v5 系统表取值。"
    },
    {
      "sel": ".d-sess-t",
      "reason": "**形态差异**：`.pw-lname` 是行内一行名字；v5 拆成 `.d-sess-t`（`system.css:59`，`fs-body` + 控件行高）。"
    },
    {
      "sel": ".d-set-nav .d-badge.accent",
      "reason": "**状态依赖**：画板帧里列表行带一枚 `.pw-badge.accent`（SkillHub 徽章）；v5 的技能行尾是 `span.d-switch.on`（整组开关），徽章换成了开关。徽章盒的档位由其它 `.d-badge` 那一对量。"
    },
    {
      "sel": ".d-set-main .d-set > .d-set-inner > .d-row",
      "reason": "**取样差异（`.pw-inline`）**：详情头那一行横排在 v5 发 `div.d-row.fork-pwa-head`（`SkillsConfig.tsx` 的详情头）。"
    },
    {
      "sel": ".d-set-main .d-set-inner .d-field-t",
      "reason": "**取样差异（`.pw-sec-title`）**：画板右列的分节标题是独立的 `.pw-sec-title`（带撑满的发丝线）；v5 把它降成 `.d-field` 的 `.d-field-t`（D-07 的纵向字段形态）。"
    },
    {
      "sel": ".d-set-main .d-set-row > .d-grow-last",
      "reason": "**取样差异（`.pw-ctl`）**：`.pw-field .pw-ctl`（board.css:786）在 v5 的纵向 `.d-field` 里不存在，槽位只挂在 `.d-set-row` 一族（`system.css:492`）。这一对量的是 v5 里实际承载控件槽的那一枚。"
    },
    {
      "sel": ".d-col",
      "reason": "**取样差异（`.pw-kv`）**：v1 的 `.pw-kv` 是「标签 / 值」纵向表（`.pw-kv dt` / `.pw-kv dd` 两列）；v5 的技能详情不用 `ConfigKv`（`SettingsUi.tsx:297`，它只发 `dl.d-col`），而是把属性表排成 `.d-set-row` + `.d-set-row-t` + `.d-set-row-s` 那一族。所以 `.pw-kv` / `.pw-kv dt` / `.pw-kv dd` 三对分别落到 `.d-set-row` / `.d-set-row-t` / `.d-set-row-s` 上。行盒档位按 v5 系统表取值。"
    },
    {
      "sel": ".d-set-main .d-badge.warn",
      "reason": "**状态依赖**：画板帧里那枚 `.pw-badge.warn` 是「磁盘上的文件在你编辑期间被改过」；v5 把同一件事做成一块 `.d-banner.warn` 提示条（`SkillsConfig.tsx:1392`），不是徽章。这一对量到的是详情里实际存在的那一枚 `.d-badge.warn`（若没有则按取样差异记）。"
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
    [".pw-group-title", ".d-group-title"],
    [".pw-litem", ".d-set-nav .d-sess"],
    [".pw-litem.is-on", ".d-set-nav .d-sess.is-on"],
    [".pw-lname", ".d-set-nav .d-sess-t"],
    [".pw-lsub", ".d-set-nav .d-sess-t.d-grow"],
    [".pw-badge.accent", ".d-set-nav .d-badge.accent"],
    [".pw-badge.warn", ".d-set-main .d-badge.warn"],
    [".pw-switch", ".d-switch"],
    // 右列
    [".pw-detail", ".d-set-main .d-set > .d-set-inner"],
    [".pw-inline", ".d-set-main .d-set > .d-set-inner > .d-row"],
    [".pw-kv", ".d-set-main .d-set-inner .d-set-row"],
    [".pw-kv dt", ".d-set-main .d-set-inner .d-set-row-t"],
    [".pw-kv dd", ".d-set-main .d-set-inner .d-set-row-s"],
    [".pw-sec-title", ".d-set-main .d-set-inner .d-field-t"],
    [".pw-textarea", ".d-textarea"],
    [".pw-btn.sm", ".d-set-main .d-btn.sm"]
  ]
};