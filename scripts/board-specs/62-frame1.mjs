// 设置新框架 · 列表页骨架（画板 62 · 帧 1）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况：
// SettingsPanel.tsx:1198-1240 设壳 + SettingsUi.tsx:103-480 基件）。
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
  // fork:v5-settings-map —— 画板帧 1 量的是选中一条技能之后的右列（含 SKILL.md 文本域），
  // 默认停在空态，点开第一行再量。
  const first = document.querySelector(".settings-section-host:not([hidden]) .d-set-nav .d-sess");
  if (first) { first.click(); await new Promise((r) => setTimeout(r, 1800)); }
  // SKILL.md 卡片默认是只读回显，要点「编辑」才换成文本域（SkillsConfig.tsx:497-546）。
  const edit = [...document.querySelectorAll(".settings-section-host:not([hidden]) .d-btn.sm")]
    .find((b) => /编辑|edit/i.test(b.textContent ?? ""));
  if (edit) { edit.click(); await new Promise((r) => setTimeout(r, 1200)); }`;

export default {
  "name": "设置新框架 · 列表页（画板 62 · 帧 1）",
  "board": "62-settings-layout.html",
  "boardFrame": 1,
  "app": { "script": OPEN_SKILLS, "settle": 2200 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".settings-section-tabs.d-set-nav",
      "reason": "**取样差异**：画板帧的左导航画着 12 个分节 + 一枚「返回工作区」；产品只有 11 项（三个分节 2026-10-01 下线、「返回工作区」同日撤掉）。高度差来自**行数不同**，属接线层。"
    },
    {
      "sel": ".settings-section-tabs .d-set-navitem",
      "reason": "**取样差异**：v1 导航行分装在 `.pw-ico` + `.pw-name`；v5 的 `button.d-set-navitem` 直接放文案，没有独立名字类。行本体仍逐项对位。"
    },
    {
      "sel": ".settings-dialog-main",
      "reason": "**取样差异**：`.pw-sbody`（board.css:713，「`overflow:hidden` + 左右 40px」）在 v5 拆成 `main.settings-dialog-main`（零几何）+ 里层 `.d-set-main`（`overflow-y:auto` + `padding: sp-6 sp-8`）。"
    },
    {
      "sel": ".d-set-main .d-set-sec",
      "reason": "**取样差异（页头 → 分节）**：v1 的 `.pw-shead` 是一行页头（下边框 + `align-items:flex-end`）；v5 的 `SettingsPage` 收成 `div.d-set-sec`。"
    },
    {
      "sel": ".d-set-main .d-set-sec + .d-row",
      "reason": "**取样差异（`.pw-stools`）**：board.css:741 的工具栏是「40 高 + 上下发丝边框」的一条独立横条；v5 只发一块普通 `div.d-row`。真实几何差。"
    },
    {
      "sel": ".d-set-main .d-set",
      "reason": "**取样差异（列表 300 + 内容 760 → 220 定宽 + 720 居中）**：board.css:899 的 `.pw-cols` 写死 `300px minmax(0,760px)`；v5 的 `ConfigSplitView` 发纯 flex 的 `div.d-set`，列宽落在 `.d-set-nav`（220）与 `.d-set-inner`（max-width 720 居中）。**这是一处真实的几何差。**"
    },
    {
      "sel": ".d-set-nav > .d-col",
      "reason": "**形态差异**：`.pw-list`（board.css:900，`display:grid; gap:space-tight`）↔ v5 的 `ConfigSidebarList` 发 `div.d-col`（flex column）。"
    },
    {
      "sel": ".d-set-nav .d-sess",
      "reason": "**形态差异**：`.pw-litem`（board.css:901，7px/8px + 圆角 4 + gap 8）↔ v5 的技能行发 `button.d-sess`（`system.css:49`，整行块级无描边）。行骨架相同，档位按 v5 系统表取值。内容宽度差来自「画板第一行是项目作用域技能、产品第一行是全局技能」，宽度不参与判定。"
    },
    {
      "sel": ".d-set-main .d-set > .d-set-inner",
      "reason": "**取样差异（详情卡 → 内容列）**：`.pw-detail`（board.css:923，描边 + 圆角 6 的巨卡）在 v5 被撤掉（`SkillsConfig.tsx:1459` 注释同款）；右列就是 `.d-set-inner`。高度差来自内容收口。"
    },
    {
      "sel": ".d-set-main .d-badge.warn",
      "reason": "**状态依赖**：画板帧里那枚是技能列表行的「SkillHub 徽章」；v5 的技能行尾是 span.d-switch.on（整组开关），徽章换成了开关，详情里也没有这一枚。这一对量到的是内容区里实际存在的那一枚 .d-badge.warn（若没有则按取样差异记）。"
    },
    {
      "sel": ".d-set-main .d-set-inner .d-col",
      "reason": "**取样差异（`.pw-kv`）**：v1 的 `.pw-kv` 是「标签 / 值」纵向表（`.pw-kv dt` / `.pw-kv dd` 两列）；v5 的技能详情不用 `ConfigKv`（`SettingsUi.tsx:297` 那个组件只发 `dl.d-col`），而是把属性表排成 `.d-set-row` + `.d-set-row-t` + `.d-set-row-s` 那一族。所以三对分别落到这三枚上。"
    }
  ],
  "pairs": [
    [".pw-settings", ".settings-dialog-body.d-set"],
    [".pw-snav", ".settings-section-tabs.d-set-nav"],
    [".pw-snav .pw-row", ".settings-section-tabs .d-set-navitem"],
    [".pw-snav .pw-name", ".settings-section-tabs .d-set-navitem"],
    [".pw-snav-close", ".settings-section-tabs .d-set-navitem"],
    [".pw-sbody", ".settings-dialog-main"],
    [".pw-shead", ".d-set-main .d-set-sec"],
    [".pw-shead-copy", ".d-set-main .d-set-sec > .d-row"],
    [".pw-shead-copy > h2", ".d-set-main .d-set-sec > .d-row > .d-t-lg.d-t-b"],
    [".pw-shead-copy > p.sub", ".d-set-main .d-set-sec > .d-t-xs.d-t-faint"],
    [".pw-shead-acts", ".d-set-main .d-set-sec > .d-row > .d-row"],
    [".pw-btn.outline.sm", ".d-set-main .d-btn.sm"],
    [".pw-btn.primary.sm", ".d-set-main .d-btn.primary.sm"],
    [".pw-stools", ".d-set-main .d-set-sec + .d-row"],
    [".pw-search", ".d-set-main .d-searchfield"],
    [".pw-search input", ".d-set-main .d-searchfield > input"],
    [".pw-sep", ".d-set-main .d-sep-v"],
    [".pw-radio", ".d-set-main .d-seg"],
    [".pw-grow", ".d-set-main .d-grow"],
    [".pw-badge.count", ".d-set-main .d-badge.count"],
    [".pw-btn.sm", ".d-set-main .d-btn.sm"],
    [".pw-scontent", ".d-set-main"],
    [".pw-scontent.is-fixed", ".d-set-main"],
    [".pw-cols", ".d-set-main .d-set"],
    [".pw-group-title", ".d-set-main .d-group-title"],
    [".pw-list", ".d-set-nav > .d-col"],
    [".pw-litem", ".d-set-nav .d-sess"],
    [".pw-litem.is-on", ".d-set-nav .d-sess.is-on"],
    [".pw-lname", ".d-set-nav .d-sess-t"],
    [".pw-lsub", ".d-set-nav .d-sess-t.d-grow"],
    [".pw-badge.accent", ".d-set-main .d-badge"],
    [".pw-badge.warn", ".d-set-main .d-badge.warn"],
    [".pw-switch", ".d-switch"],
    [".pw-detail", ".d-set-main .d-set > .d-set-inner"],
    [".pw-inline", ".d-set-main .d-set-inner .d-row"],
    [".pw-kv", ".d-set-main .d-set-inner .d-set-row"],
    [".pw-kv dt", ".d-set-main .d-set-inner .d-set-row-t"],
    [".pw-kv dd", ".d-set-main .d-set-inner .d-set-row-s"],
    [".pw-sec-title", ".d-set-main .d-set-inner .d-set-row-t"],
    [".pw-textarea", ".d-textarea"],
    [".pw-btn.primary.sm", ".d-set-main .d-btn.primary.sm"]
  ]
};