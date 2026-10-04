// 设置 · 常规续（画板 40 · 帧 1：字体 / 语言 / 聊天 / Shell / 推送）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况）。
// **画板侧一行不动**，两边靠 pairs 显式配对。驱动换成 spec 自带的 app.script
// （settings:* 预设的入口选择器在换皮后失效）。
const OPEN_GENERAL = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="general"]');
  if (!row) throw new Error("settings section not found: general");
  row.click();
  await new Promise((r) => setTimeout(r, 1800));`;

export default {
  "name": "设置 · 常规续（画板 40 · 帧 1：字体 / 语言 / 聊天 / Shell / 推送）",
  "board": "40-settings-general.html",
  "boardFrame": 1,
  "app": { "script": OPEN_GENERAL, "settle": 1600 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".pw-frame-body.pw-grid2 > div",
      "reason": "**取样差异（画板取景件）**：`.pw-frame-body.pw-grid2` 是画板页自己的**两栏排版格**（板内演示布局），board-diff 会剥掉 `.pw-frame-body.pw-pad` 的内距，产品里没有任何承载它的东西。这一对量不到产品侧对象，登记在此。"
    },
    {
      "sel": ".d-set-sec",
      "reason": "**取样差异（v1 卡片 → v5 分节）**：board.css:776 的 `.pw-block` 是「margin-top 16 + 描边 + 圆角 6 + 内距 12/16」的一张卡；v5 把同一块放平成 `div.d-set-sec`（`system.css:484`，无描边无圆角）。标题行与行流仍逐项对位。"
    },
    {
      "sel": ".d-seg",
      "reason": "**取样差异（v5 没有单选组）**：v1 的 `.pw-radio` 是一排圆角小片；v5 的 `.d-radio` / `.d-radiorow` 只在 `system.css` 里定义、产品一个都没发，实际承载「语言 / 主题」分档的是 `span.d-seg`。"
    }
  ],
  "pairs": [
    [".pw-frame-body.pw-grid2 > div", ".settings-dialog-surface .d-set-main .d-set-inner"],
    [".pw-block", ".d-set-main .d-set-sec"],
    [".pw-block > h3", ".d-set-main .d-set-sec > .d-set-sec-t"],
    [".pw-field", ".d-set-main .d-set-row"],
    [".pw-field .pw-label", ".d-set-main .d-set-row > .d-set-row-box > .d-set-row-t"],
    [".pw-field .pw-label small", ".d-set-main .d-set-row > .d-set-row-box > .d-set-row-s"],
    [".pw-ctl", ".d-set-main .d-set-row > .d-grow-last"],
    [".pw-selectbox", ".d-select"],
    [".pw-switch", ".d-switch"],
    [".pw-radio", ".d-seg"],
    [".pw-btn.outline.sm", ".d-btn.sm"],
    [".pw-btn.sm", ".d-btn.sm"],
    [".pw-mono.pw-dim", ".d-set-main .d-mono"]
  ]
};