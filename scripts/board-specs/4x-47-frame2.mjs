// 皮肤工作室 · 自定义 CSS 页签（画板 47 · 帧 2）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*。
// **画板侧一行不动**，两边靠 pairs 显式配对。
// 驱动与帧 1 相同，但多切一次页签到「自定义 CSS」（ThemeSkinStudio.tsx:459 的第二枚 tab）。
const OPEN_SKIN_STUDIO_CSS = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="general"]');
  if (!row) throw new Error("settings section not found: general");
  row.click();
  await new Promise((r) => setTimeout(r, 1800));
  const card = document.querySelector(".pw-skin.is-new");
  if (!card) throw new Error("皮肤条上的「新建皮肤」卡没找到");
  card.click();
  await new Promise((r) => setTimeout(r, 1600));
  const cssTab = [...document.querySelectorAll(".fork-skin-scrim .d-tab")]
    .find((t) => /CSS/i.test(t.textContent ?? ""));
  if (!cssTab) throw new Error("工作室的「自定义 CSS」页签没找到");
  cssTab.click();
  await new Promise((r) => setTimeout(r, 1200));`;

export default {
  "name": "皮肤工作室 · 自定义 CSS（画板 47 · 帧 2）",
  "board": "47-skin-studio.html",
  "boardFrame": 2,
  "app": { "script": OPEN_SKIN_STUDIO_CSS, "settle": 1500 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".fork-skin-scrim .d-tabs",
      "reason": "**取样差异（`.pw-tabs` 换名 + 内距）**：board.css 的 `.pw-tabs` 是「一条底部发丝线的页签行」，内距写在画板内联里；v5 发 `div.d-tabs`（`system.css` 的页签族），内距按 v5 系统表取值。页签本体由 `.d-tab` 那一对量。"
    },
    {
      "sel": ".fork-skin-scrim .d-tab.is-on",
      "reason": "**取样差异**：选中态在 v5 由 `.d-tab.is-on` 表达（画板也是 `.is-on`），但 `.d-tab` 本身是 `button`（产品按铁律一「保留原类名、UA 归零在接线层做」），画板是 `span` —— 盒模型档位按 v5 系统表取值。"
    },
    {
      "sel": ".fork-skin-scrim .d-field-t",
      "reason": "**形态差异**：`.pw-field`（board.css:781，一行标签 + 右控件）↔ v5 的纵向 `.d-field`（`system.css:503`）+ `.d-field-t`。这是 D-07 定下的字段形态。"
    },
    {
      "sel": ".fork-skin-scrim .d-btn.danger",
      "reason": "**状态依赖 + 未落地**：画板帧 2/3 的脚行左端有一枚 danger「清空」；v5 的工作室脚行只有「取消 / 恢复默认 / 保存」三枚（ThemeSkinStudio.tsx:726），没有 danger —— 新建态更没有（按画板 47 帧 2 的约定「左下没有删除」）。这一对量到的是弹层里实际存在的那一枚 `.d-btn.danger`（若没有则按取样差异记）。"
    },
    {
      "sel": ".fork-skin-scrim .d-input",
      "reason": "**取样差异（`.pw-input`）**：画板那一格是「名称」输入框（v1 的 `.pw-input`，`--control-sm` 高、200px 下限）；v5 的工作室把名称行做成 `.d-set-row` 里的 `input.d-input`，色值那一列则是 `input.d-swatch`（原生取色器）。这一对量的是名称那一枚。"
    },
    {
      "sel": ".fork-skin-scrim .d-field",
      "reason": "**形态差异**：`.pw-field`（board.css:781，一行标签 + 右控件，`justify-content:space-between`）↔ v5 的纵向 `.d-field`（system.css:503）。工作室里只有「各面适配」那一块用 `.d-field`，其余全是 `.d-set-row`。"
    },
    {
      "sel": ".fork-skin-scrim .d-row",
      "reason": "**取样差异（`.pw-inline`）**：画板那一行是「校验错误 + 格式化」那一行横排；v5 的工作室里对应的是壁纸那一行（`.d-row` + 选择壁纸 / 移除壁纸 + 填充方式）。"
    },
    {
      "sel": ".fork-skin-scrim .d-mono",
      "reason": "**取样差异（`.pw-mono`）**：画板那一行是滑块旁的等宽数值；v5 的滑块行同样是 `span.d-t-xs.d-mono`（`ThemeSkinStudio.tsx:555` 一带）。这一对量的是那一枚等宽数值。"
    },
    {
      "sel": ".fork-skin-scrim .d-grid3",
      "reason": "**取样差异（`.pw-grid3` 同名换体系）**：v1 的 `.pw-grid3` 来自 board.css；v5 有自己的 `.d-grid3`（`system.css`）。同名不同源，值按 v5 系统表取。"
    },
    {
      "sel": ".fork-skin-scrim .d-banner.warn",
      "reason": "**取样差异（`.pw-alert` → `.d-banner`）**：对照表里的 `.pw-alert` 在 v5 没有同名类，实际承载它的是 `.d-banner` + 档位类（`system.css:456-467`）。CSS 页签那条是 `.d-banner.warn`（`ThemeSkinStudio.tsx:696`）。"
    },
    {
      "sel": ".fork-skin-scrim .d-badge.warn",
      "reason": "**取样差异**：画板帧 3 的 `.pw-badge.warn`「高级」在 v5 落在**头行**（`ThemeSkinStudio.tsx:438`，`d-modal-head` 里），不在页签行上。这一对量的仍是那一枚徽章盒。",
    },
    {
      "sel": ".fork-skin-scrim .d-set-row",
      "reason": "**取样差异（换页签）**：画板帧 2 的这一格量的是「主题设置」页签的字段行（名称 / 四色 / 几何）；v5 的驱动切到**自定义 CSS**页签去量文本域与提示条，那一页签里**没有字段行**（`ThemeSkinStudio.tsx:688-720` 只有一块 `.d-banner.warn` 与一个 `textarea.d-textarea`）。几何 / 不透明度那一族由 4x-47-frame1 量。"
    },
    {
      "sel": ".fork-skin-scrim .d-set-row-t",
      "reason": "**取样差异（换页签）**：同上一条 —— 字段标题在主题设置页签，驱动停在 CSS 页签，所以量不到。"
    },
    {
      "sel": ".fork-skin-scrim .d-set-row > .d-grow-last",
      "reason": "**取样差异（换页签）**：同上一条 —— 控件槽在主题设置页签，驱动停在 CSS 页签，所以量不到。"
    },
  ],
  "pairs": [
    [".pw-scrim", ".d-modal.is-open.fork-skin-scrim"],
    [".pw-modal", ".fork-skin-scrim > .d-modal-box"],
    [".pw-modal-head", ".fork-skin-scrim .d-modal-head"],
    [".pw-iconbtn.sm", ".fork-skin-scrim .d-iconbtn"],
    [".pw-tabs", ".fork-skin-scrim .d-tabs"],
    [".pw-tab", ".fork-skin-scrim .d-tab"],
    [".pw-tab.is-on", ".fork-skin-scrim .d-tab.is-on"],
    [".pw-modal-body", ".fork-skin-scrim .d-modal-body"],
    [".fork-skin-scrim .d-set-row", ".fork-skin-scrim .d-set-row"],
    [".fork-skin-scrim .d-set-row-t", ".fork-skin-scrim .d-set-row-t"],
    [".fork-skin-scrim .d-set-row > .d-grow-last", ".fork-skin-scrim .d-set-row > .d-grow-last"],
    [".fork-skin-scrim .d-input", ".fork-skin-scrim .d-input"],
    [".pw-textarea", ".fork-skin-scrim .d-textarea"],
    [".pw-mono", ".fork-skin-scrim .d-mono"],
    [".pw-alert.info", ".fork-skin-scrim .d-banner.warn"],
    [".pw-modal-foot", ".fork-skin-scrim .d-modal-foot"],
    [".pw-inline", ".fork-skin-scrim .d-row"],
    [".pw-btn", ".fork-skin-scrim .d-btn"],
    [".pw-btn.primary", ".fork-skin-scrim .d-btn.primary"],
    [".fork-skin-scrim .d-btn.danger", ".fork-skin-scrim .d-btn.danger"],
    [".pw-btn.outline", ".fork-skin-scrim .d-btn"]
  ]
};