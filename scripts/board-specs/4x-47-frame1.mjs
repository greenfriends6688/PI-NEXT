// 皮肤工作室 · 对话框（画板 47 · 帧 1）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*。
// **画板侧一行不动**，两边靠 pairs 显式配对。
// 弹层壳在 v5 是 ThemeSkinStudio.tsx:416/423 的 .d-modal.is-open.fork-skin-scrim
// > .d-modal-box.wide.fork-skin-modal，五行的类全部换过（d-modal-head / d-tabs+
// d-tab / d-modal-body / d-banner / d-modal-foot）。
const OPEN_SKIN_STUDIO = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="general"]');
  if (!row) throw new Error("settings section not found: general");
  row.click();
  await new Promise((r) => setTimeout(r, 1800));
  // 「打开皮肤工作室」在没有非默认皮肤时是 disabled（ThemeSkinStrip.tsx:160），
  // 所以走「新建皮肤」卡 —— 它一定会打开工作室（isNew 态），几何与编辑态一致。
  const card = document.querySelector(".pw-skin.is-new");
  if (!card) throw new Error("皮肤条上的「新建皮肤」卡没找到");
  card.click();
  await new Promise((r) => setTimeout(r, 1600));`;

export default {
  "name": "皮肤工作室（画板 47 · 帧 1）",
  "board": "47-skin-studio.html",
  "boardFrame": 1,
  "app": { "script": OPEN_SKIN_STUDIO, "settle": 1800 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".fork-skin-scrim .d-modal-body",
      "reason": "**用户裁定偏离（fix:skin-preview-left）**：画板 47 帧 1 是「左设置 1fr · 右预览 340px」；产品把预览挪到左列（`gridTemplateColumns:\"340px 1fr\"` + 两块各写 `order`）。见报告"
    },
    {
      "sel": ".fork-skin-scrim .d-btn.danger",
      "reason": "**状态依赖**：这一帧量的是**新建态**（走「新建皮肤」卡打开，因为「打开皮肤工作室」在没有非默认皮肤时是 disabled —— ThemeSkinStrip.tsx:160），而画板帧 1 画的是编辑态；新建态按画板 47 帧 2 的约定「左下没有删除」。"
    },
    {
      "sel": ".fork-skin-scrim .d-switch",
      "reason": "**未落地**：画板工作室里那枚开关（某一面的透明度）没有对应件 —— v5 的工作室把全部几何 / 不透明度做成 `input.d-slider`（system.css:581），开关形态在工作室里不存在。这一对量到的是弹层里实际存在的那一枚 `.d-switch`（若没有则按取样差异记）。"
    },
    {
      "sel": ".fork-skin-scrim .d-field-t",
      "reason": "**形态差异**：`.pw-field`（board.css:781，「一行标签 + 右控件，`justify-content:space-between`」）↔ v5 的 `.d-field`（`system.css:503`，**纵向** `column; gap:6`）+ `.d-field-t` 标题。这是 D-07 定下的字段形态；工作室的滑块字段也走同一形态。"
    },
    {
      "sel": ".fork-skin-scrim .d-seg",
      "reason": "**取样差异（`.pw-radio` → 分段控件）**：v5 的 `.d-radio` / `.d-radiorow` 只在 `system.css` 里定义、**产品一个都没发**；工作室里那几组枚举实际走 `PwChips` → `span.d-seg`（`ThemeSkinStudio.tsx:605` 的 `PwChips`）。"
    },
    {
      "sel": ".fork-skin-scrim .d-slider",
      "reason": "**取样差异（`.pw-range` → `.d-slider`）**：对照表里 `.pw-range → .d-slider`；v5 的滑块是 `input.d-slider`（`system.css:581`，160×4 的一根细条 + 14 见方滑头），画板 47 那一行是内联几何拼出来的裸 `input[type=range]`。"
    },
    {
      "sel": ".fork-skin-scrim .d-swatch",
      "reason": "**取样差异（`.pw-input` → 色板）**：画板那一列的「强调色」是一个 20×20 的圆角色块（内联几何）+ 一行 `.pw-mono`；v5 发 `span.d-swatch`（画板 D-07b 的色板族）。同一件东西，类名与取值都按 v5 系统表走。"
    },
    {
      "sel": ".fork-skin-scrim .d-select",
      "reason": "**取样差异（`.pw-selectbox` → `.d-select`）**：画板是自绘下拉（`.pw-selectbox` + `.pw-ico chevron-down`）；v5 这一处是原生 `<select class=\"d-select\">`。触发钮档位对得上，**内部结构不同**。"
    }
  ],
  "pairs": [
    // 浮层壳：v1 .pw-scrim + .pw-modal → v5 .d-modal（宿主类是产品自己加的）
    [".pw-scrim", ".d-modal.is-open.fork-skin-scrim"],
    [".pw-modal", ".fork-skin-scrim > .d-modal-box"],
    [".pw-modal-head", ".fork-skin-scrim .d-modal-head"],
    [".pw-tabs", ".fork-skin-scrim .d-tabs"],
    [".pw-tab", ".fork-skin-scrim .d-tab"],
    [".pw-modal-body", ".fork-skin-scrim .d-modal-body"],
    [".pw-modal-foot", ".fork-skin-scrim .d-modal-foot"],
    [".pw-iconbtn.sm", ".fork-skin-scrim .d-iconbtn"],
    // 壳内的字段族
    [".pw-field", ".fork-skin-scrim .d-set-row"],
    [".pw-field .pw-label", ".fork-skin-scrim .d-set-row-t"],
    [".pw-ctl", ".fork-skin-scrim .d-set-row > .d-grow-last"],
    [".pw-input", ".fork-skin-scrim .d-swatch"],
    [".pw-range", ".fork-skin-scrim .d-slider"],
    [".pw-radio", ".fork-skin-scrim .d-seg"],
    [".pw-selectbox", ".fork-skin-scrim .d-select"],
    [".fork-skin-scrim .d-switch", ".fork-skin-scrim .d-switch"],
    [".pw-mono", ".fork-skin-scrim .d-mono"],
    [".pw-sec-title", ".fork-skin-scrim .d-set-sec-t"],
    [".pw-alert.info", ".fork-skin-scrim .d-banner.info"],
    [".pw-btn", ".fork-skin-scrim .d-btn"],
    [".pw-btn.primary", ".fork-skin-scrim .d-btn.primary"],
    [".pw-btn.danger", ".fork-skin-scrim .d-btn.danger"],
    [".pw-btn.outline", ".fork-skin-scrim .d-btn"]
  ]
};