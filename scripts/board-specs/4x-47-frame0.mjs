// 皮肤条（画板 47 · 帧 0）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*。
// **画板侧一行不动**，两边靠 pairs 显式配对。
//
// 这一份的特殊之处：**皮肤条本身尚未随设置族换皮** —— .pw-skin-strip / .pw-skin /
// .prev / .cap 在 v5 里**仍然是产品实际发的类**（实况 dump 确认：设置面板里残留的
// pw-* 只剩这两个）。所以它们在画板侧与产品侧都原样保留；这一份真正要迁的是
// 皮肤条**周围**的 v1 件（动作行 / 按钮 / 提示条 / 弹性空档）。
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
  "name": "皮肤条（画板 47 · 帧 0）",
  "board": "47-skin-studio.html",
  "boardFrame": 0,
  "app": { "script": OPEN_GENERAL, "settle": 1600 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".settings-dialog-surface .pw-skin-strip",
      "reason": "**取样差异（皮肤条尚未换皮）**：`.pw-skin-strip` / `.pw-skin` / `.prev` / `.cap` 是产品**现在实际发的类**（v5 设置面板里仅剩的 `pw-*`），所以两侧都原样保留。接线层给皮肤条补了 padding-bottom 2px（卡片阴影的呼吸位），画板 board.css 没有。"
    },
    {
      "sel": ".settings-dialog-surface .pw-skin .cap",
      "reason": "**接线层**：app/fork-ui.css 把 `.cap` 从 board.css 的 `display:flex` 改成 `display:grid; grid-auto-flow:column`（button 的内容模型只能放 phrasing 内容，`prev` 也一并改成 grid）。外观近似但结构已不同。"
    },
    {
      "sel": ".settings-dialog-surface .d-set-main .d-row",
      "reason": "**取样差异（`.pw-inline.pw-skin-actions`）**：v1 的皮肤动作行是 `.pw-inline` + `.pw-skin-actions` 两枚类；v5 的常规分节里那一行退成一块普通 `div.d-row`（导入 / 导出 / 打开皮肤工作室 + 一句说明）。动作行本身按 v5 系统表取值。"
    },
    {
      "sel": ".d-btn.sm",
      "reason": "**取景差异**：画板帧 0 量的是「新建皮肤」空槽里那枚按钮；产品空槽的类名是 `.pw-skin.is-new`（接线层补的几何），量到的是别的 `.d-btn.sm`。"
    },
    {
      "sel": ".settings-dialog-surface .d-btn.danger.sm",
      "reason": "**接线差异**：画板 47 帧 0 的动作行末尾有「删除当前皮肤」；产品的删除在工作室对话框的动作行里（`ThemeSkinStudio`），皮肤条上没有这一枚 —— 见报告。"
    },
    {
      "sel": ".settings-dialog-surface .d-banner.info",
      "reason": "**接线差异**：画板 47 帧 0 在条下面常驻一条「皮肤覆盖单一强调色约定」的提示；产品把这句降级成动作行末端的小字（`.d-t-xs.d-t-faint`），不是提示条。对照表里的 `.pw-alert` 在 v5 由 `.d-banner` 承载。"
    },
    {
      "sel": ".settings-dialog-surface .d-grow",
      "reason": "**取景差异**：画板帧 0 的第一枚 `.pw-grow` 是皮肤动作行里那个撑满剩余宽度的 spacer；产品设置面板里的第一枚是别的位置的 grow。"
    }
  ],
  "pairs": [
    // 皮肤条：v5 里仍是产品实际发的 pw-*，两侧都原样保留
    [".pw-skin-strip", ".settings-dialog-surface .pw-skin-strip"],
    [".pw-skin", ".settings-dialog-surface .pw-skin"],
    [".pw-skin.is-on", ".settings-dialog-surface .pw-skin.is-on"],
    [".pw-skin .prev", ".settings-dialog-surface .pw-skin .prev"],
    [".pw-skin .prev .a", ".settings-dialog-surface .pw-skin .prev .a"],
    [".pw-skin .prev .b", ".settings-dialog-surface .pw-skin .prev .b"],
    [".pw-skin .cap", ".settings-dialog-surface .pw-skin .cap"],
    // 周围那圈：v1 → v5
    [".pw-btn.sm", ".settings-dialog-surface .d-btn.sm"],
    [".pw-inline.pw-skin-actions", ".settings-dialog-surface .d-set-main .d-row"],
    [".pw-btn.outline.sm", ".settings-dialog-surface .d-btn.sm"],
    [".pw-btn.danger.sm", ".settings-dialog-surface .d-btn.danger.sm"],
    [".pw-grow", ".settings-dialog-surface .d-grow"],
    [".pw-alert.info", ".settings-dialog-surface .d-banner.info"]
  ]
};