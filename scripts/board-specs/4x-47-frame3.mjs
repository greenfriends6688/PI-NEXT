// 皮肤工作室 · CSS 覆盖层与壁纸画廊（画板 47 · 帧 3）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*。
// **画板侧一行不动**，两边靠 pairs 显式配对。
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
  "name": "皮肤工作室 · CSS 覆盖层与壁纸画廊（画板 47 · 帧 3）",
  "board": "47-skin-studio.html",
  "boardFrame": 3,
  "app": { "script": OPEN_SKIN_STUDIO_CSS, "settle": 1500 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".fork-skin-scrim > .d-modal-box",
      "reason:": "",
      "reason": "**取样差异（宿主选择器）**：画板侧写的是 `.fork-skin-scrim > .pw-modal`；产品侧的对应物是 `div.d-modal-box.wide.fork-skin-modal`（`ThemeSkinStudio.tsx:423`）—— v5 的浮层壳拆成了「遮罩 `.d-modal` + 盒子 `.d-modal-box`」两层。弹层盒的尺寸档位按 v5 系统表取值（`.d-modal-box.wide` 680，`fork-skin-modal` 再按画板 47 的 900×720 覆写）。"
    },
    {
      "sel": ".fork-skin-scrim .d-modal-body",
      "reason": "**用户裁定偏离（fix:skin-preview-left）**：画板 47 帧 1/3 是「左设置 1fr · 右预览 340px」；产品把预览挪到左列。这一对量的内容行盒本身，行内分栏方向的差是产品侧的既定裁定。"
    },
    {
      "sel": ".fork-skin-scrim .d-banner",
      "reason:": "",
      "reason": "**取样差异（`.pw-alert` → `.d-banner`）**：对照表里的 `.pw-alert` 在 v5 没有同名类，实际承载它的是 `.d-banner`（`system.css:456`）。"
    },
    {
      "sel": ".fork-skin-scrim .d-grid3",
      "reason": "**取样差异（同名不同源）**：v1 的 `.pw-grid3` 来自 board.css；v5 有自己的 `.d-grid3`（`system.css`）。值按 v5 系统表取。"
    },
    {
      "sel": ".fork-skin-scrim .d-thumb",
      "reason": "**取样差异（`.pw-wallpaper-thumb` → `.d-thumb`）**：画板那一格是内联几何拼的缩略格；v5 的壁纸画廊发 `.d-thumb` + `.d-image`（`WallpaperSettings.tsx` 的 `d-thumb`/`d-image`/`d-type`/`d-grid3`）。缩略格盒按 v5 系统表取值。"
    },
    {
      "sel": ".fork-skin-scrim .d-field-t",
      "reason": "**形态差异**：`.pw-field`（board.css:781，一行标签 + 右控件）↔ v5 的纵向 `.d-field`（`system.css:503`）+ `.d-field-t`。"
    },
    {
      "sel": ".fork-skin-scrim .d-seg",
      "reason": "**取样差异（`.pw-radio` → 分段控件）**：v5 的 `.d-radio` / `.d-radiorow` 只定义、**产品一个都没发**；工作室里那几组枚举实际走 `PwChips` → `span.d-seg`。"
    },
    {
      "sel": ".fork-skin-scrim .d-badge.bad",
      "reason": "**未落地**：画板 CSS 覆盖层那一行的 .pw-badge.bad 是「第 6 行：--radius-6 超出规范上限」这一条静态校验结果；v5 的工作室没有 CSS 静态校验（ThemeSkinStudio.tsx:688-720 只有一块 .d-banner.warn 与一个 textarea），没有这一枚徽章。"
    },
    {
      "sel": ".fork-skin-scrim .d-btn.sm",
      "reason": "**未落地**：画板那一行右端有「格式化」；v5 的 CSS 页签没有格式化按钮。这一对量到的是弹层里实际存在的那一枚 .d-btn.sm（若没有则按取样差异记）。"
    },
    {
      "sel": ".fork-skin-scrim .d-set-row",
      "reason": "**形态差异（`.pw-field` → `.d-set-row`）**：board.css:781 的 .pw-field 是「一行标签 + 右控件，justify-content:space-between」；v5 的工作室把几何 / 不透明度 / 壁纸焦点全排成 .d-set-row（左标题盒 + 右 margin-left:auto 槽，system.css:486）。"
    },
    {
      "sel": ".fork-skin-scrim .d-set-row-t",
      "reason": "**形态差异（`.pw-field .pw-label`）**：同上一条，标签那一枚在 v5 是 .d-set-row-t（system.css:489）。"
    },
    {
      "sel": ".fork-skin-scrim .d-set-row > .d-grow-last",
      "reason": "**取样差异（`.pw-ctl`）**：board.css:786 的 .pw-field .pw-ctl 是字段行右端的 flex 槽；v5 的工作室那一槽是 .d-set-row > .d-grow-last（system.css:492），里面装滑块 / 色板 / 分段控件。"
    },
    {
      "sel": ".fork-skin-scrim .d-btn.danger",
      "reason": "**状态依赖 + 未落地**：画板帧 2/3 的脚行左端有一枚 danger「清空」；v5 的工作室脚行只有「取消 / 恢复默认 / 保存」三枚（ThemeSkinStudio.tsx:726），没有 danger —— 新建态更没有（按画板 47 帧 2 的约定「左下没有删除」）。"
    },
    {
      "sel": ".fork-skin-scrim .d-row",
      "reason": "**取样差异（`.pw-inline`）**：画板那一行是「校验错误 + 格式化」那一行横排；v5 的工作室里对应的是**主题设置**页签的壁纸那一行（.d-row + 选择壁纸 / 移除壁纸 + 填充方式）—— 驱动停在 CSS 页签，所以量不到。"
    },
    {
      "sel": ".fork-skin-scrim .d-mono",
      "reason": "**取样差异（`.pw-mono`）**：画板那一行是滑块旁的等宽数值；v5 的等宽数值在**主题设置**页签的滑块行（span.d-t-xs.d-mono）—— 驱动停在 CSS 页签，所以量不到。"
    },
    {
      "sel": ".fork-skin-scrim .d-seg",
      "reason": "**取样差异（`.pw-radio` → 分段控件 + 换页签）**：画板「内置壁纸」面板头那枚两档切换在**主题设置**页签（span.d-seg「明暗预览」），CSS 页签里没有；且 v5 的 .d-radio / .d-radiorow 只定义、产品一个都没发。"
    },
    {
      "sel": ".fork-skin-scrim .d-grid3",
      "reason": "**取样差异（两个并列面板 → 两个页签）**：画板帧 3 把「自定义 CSS」与「内置壁纸」画成两个并列面板，所以一个帧里同时有 CSS 文本域与壁纸画廊。v5 把它们折进同一个工作室对话框的两个页签（主题设置 = 壁纸画廊 + 各面适配 .d-grid3；自定义 CSS = 文本域 + .d-banner.warn），一次只可能量到一个 —— 驱动停在 CSS 页签，于是这两对量不到。"
    },
    {
      "sel": ".fork-skin-scrim .d-thumb",
      "reason": "**取样差异（同上）**：壁纸画廊的缩略格在主题设置页签（.d-store-grid / .d-store-card，ThemeSkinStudio.tsx:589-601），驱动停在 CSS 页签，所以量不到 .d-thumb。"
    },
    {
      "sel": ".fork-skin-scrim .d-set-sec-t",
      "reason": "**取样差异（换页签）**：画板帧 3 两个并列面板的标题各是一行 `.pw-sec-title`；v5 把它们折进工作室的两个页签，CSS 页签里**没有分节标题**（只有一块 `.d-banner.warn` + 一个 textarea）。主题设置页签那一族由 4x-47-frame1 量。"
    },
  ],
  "pairs": [
    [".pw-modal", ".fork-skin-scrim > .d-modal-box"],
    [".pw-modal-head", ".fork-skin-scrim .d-modal-head"],
    [".pw-badge.warn", ".fork-skin-scrim .d-badge.warn"],
    [".fork-skin-scrim .d-badge.bad", ".fork-skin-scrim .d-badge.bad"],
    [".pw-modal-body", ".fork-skin-scrim .d-modal-body"],
    [".pw-alert", ".fork-skin-scrim .d-banner"],
    [".pw-textarea", ".fork-skin-scrim .d-textarea"],
    [".pw-inline", ".fork-skin-scrim .d-row"],
    [".fork-skin-scrim .d-btn.sm", ".fork-skin-scrim .d-btn.sm"],
    [".pw-modal-foot", ".fork-skin-scrim .d-modal-foot"],
    [".pw-btn", ".fork-skin-scrim .d-btn"],
    [".pw-btn.primary", ".fork-skin-scrim .d-btn.primary"],
    [".fork-skin-scrim .d-btn.danger", ".fork-skin-scrim .d-btn.danger"],
    [".fork-skin-scrim .d-seg", ".fork-skin-scrim .d-seg"],
    [".fork-skin-scrim .d-grid3", ".fork-skin-scrim .d-grid3"],
    [".fork-skin-scrim .d-set-sec-t", ".fork-skin-scrim .d-set-sec-t"],
    [".pw-field", ".fork-skin-scrim .d-set-row"],
    [".pw-field .pw-label", ".fork-skin-scrim .d-set-row-t"],
    [".pw-ctl", ".fork-skin-scrim .d-set-row > .d-grow-last"],
    [".pw-mono", ".fork-skin-scrim .d-mono"],
    [".fork-skin-scrim .d-thumb", ".fork-skin-scrim .d-thumb"]
  ]
};