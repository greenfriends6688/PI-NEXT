// 插件 / MCP 分节（画板 43 · 帧 0）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况：PluginsConfig.tsx）。
// **画板侧一行不动**，两边靠 pairs 显式配对。
const OPEN_PLUGINS = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="plugins"]');
  if (!row) throw new Error("settings section not found: plugins");
  row.click();
  await new Promise((r) => setTimeout(r, 2000));`;

export default {
  name: "插件分节（画板 43 · 帧 0）",
  board: "43-settings-plugins-mcp.html",
  boardFrame: 0,
  app: { script: OPEN_PLUGINS, settle: 2200 },
  pairs: [
    [".pw-cols", ".d-set-main .d-set"],
    [".pw-list", ".d-set-nav > .d-col"],
    [".pw-litem", ".d-set-nav .d-sess"],
    [".pw-litem-add", ".d-set-nav .d-sess.models-sidebar-add-item"],
    [".pw-detail", ".d-set-main .d-set > .d-set-inner"],
    [".pw-kv", ".d-set-main .d-set-inner .d-set-sec"],
    [".pw-badge", ".d-set-main .d-badge"],
    [".pw-alert", ".d-set-main .d-banner"],
  ],
  knownDiffs: [
    {
      sel: ".d-set-main .d-set > .d-set-inner",
      reason:
        "**取样差异（详情卡 → 内容列）**：`.pw-detail`（board.css:923，描边 + 圆角 6 的巨卡）在 v5 被撤掉；"
        + "右列就是 `.d-set-inner`。",
    },
    {
      sel: ".d-set-nav .d-sess",
      reason:
        "**形态差异**：`.pw-litem`（board.css:901，7px/8px + 圆角 4 + gap 8）↔ v5 的插件行发 `button.d-sess`"
        + "（`system.css:49`，整行块级无描边）。",
    },
    {
      sel: ".d-set-nav .d-sess.models-sidebar-add-item",
      reason:
        "**取样差异（`.pw-litem-add`）**：画板那一行是 `.pw-litem` 再加一枚 `.pw-litem-add` 表示「新建」；"
        + "v5 的模型页有 `models-sidebar-add-item`（`ModelsConfig.tsx:3201`），插件页的列表里**没有**对应的"
        + "「新建」行（新建在页头动作区）。所以这一对量到的是列表里第一枚带 `models-sidebar-add-item` 的行"
        + "（若不存在就按取样差异记）。",
    },
    {
      sel: ".d-set-main .d-set-inner .d-set-sec",
      reason:
        "**取样差异（`.pw-kv` → 分节）**：v1 的右列是「`.pw-kv` 标签/值表」；v5 把属性表收成 `.d-set-sec` + "
        + "`.d-set-row`（`PluginsConfig.tsx` 的详情里全是 `d-set-row`）。",
    },
    {
      sel: ".d-set-main .d-banner",
      reason:
        "**取样差异（`.pw-alert` → `.d-banner`）**：对照表里的 `.pw-alert` 在 v5 没有同名类，"
        + "实际承载它的是 `.d-banner`（`system.css:456`）。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};