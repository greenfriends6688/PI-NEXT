// 子代理 / 技能分节（画板 42 · 帧 0）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况：AgentsConfig.tsx）。
// **画板侧一行不动**，两边靠 pairs 显式配对。
const OPEN_AGENTS = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="agents"]');
  if (!row) throw new Error("settings section not found: agents");
  row.click();
  await new Promise((r) => setTimeout(r, 2000));`;

export default {
  name: "子代理分节（画板 42 · 帧 0）",
  board: "42-settings-agents-skills.html",
  boardFrame: 0,
  app: { script: OPEN_AGENTS, settle: 2200 },
  pairs: [
    [".pw-cols", ".d-set-main .d-set"],
    [".pw-list", ".d-set-nav > .d-col"],
    [".pw-litem", ".d-set-nav .d-sess"],
    [".pw-lname", ".d-set-nav .d-sess-t"],
    [".pw-lsub", ".d-set-nav .d-sess-m"],
    [".pw-detail", ".d-set-main .d-set > .d-set-inner"],
    [".pw-field", ".d-set-main .d-field"],
    [".pw-label", ".d-set-main .d-field-t"],
    [".pw-switch", ".d-switch"],
    [".pw-badge", ".d-set-main .d-badge"],
  ],
  knownDiffs: [
    {
      sel: ".d-set-main .d-field",
      reason:
        "**形态差异**：`.pw-field`（board.css:781，一行标签 + 右控件，`justify-content:space-between`）"
        + "↔ v5 的纵向 `.d-field`（`SettingsUi.tsx:377` / `system.css:503`）。字段密度接线随该形态一起退场。",
    },
    {
      sel: ".d-set-main .d-set > .d-set-inner",
      reason:
        "**取样差异（详情卡 → 内容列）**：`.pw-detail`（board.css:923，描边 + 圆角 6 的巨卡）在 v5 被撤掉"
        + "（`AgentsConfig.tsx:667` 的注释同款）；右列就是 `.d-set-inner`。",
    },
    {
      sel: ".d-set-nav .d-sess",
      reason:
        "**形态差异**：`.pw-litem`（board.css:901，7px/8px + 圆角 4 + gap 8）↔ v5 的子代理行发 `button.d-sess`"
        + "（`system.css:49`，会话行那一族：整行、块级、无描边）。行的骨架逐项在 `.d-sess-t` / `.d-sess-m` 里对。",
    },
    {
      sel: ".d-set-main .d-badge",
      reason:
        "**状态依赖**：画板帧里列表行带一枚 `.pw-badge.ok`（Explore / Plan 的「启用」）；"
        + "v5 的子代理行尾是 `.d-dot.run`（运行态圆点），徽章换成了点。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};