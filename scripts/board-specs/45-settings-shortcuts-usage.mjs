// 画板 45（快捷键 / 用量）—— 快捷键分节已下线，这份只对位仍存在的通用基件。
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*。
// **画板侧一行不动**，两边靠 pairs 显式配对。
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
  name: "快捷键 · 通用基件（画板 45 · 帧 0 · 分节已下线）",
  board: "45-settings-shortcuts-usage.html",
  boardFrame: 0,
  app: { script: OPEN_GENERAL, settle: 1600 },
  pairs: [
    [".pw-field", ".d-set-main .d-set-row"],
    [".pw-label", ".d-set-main .d-set-row-t"],
    [".pw-ctl", ".d-set-main .d-set-row > .d-grow-last"],
    [".pw-radio", ".d-seg"],
  ],
  knownDiffs: [
    {
      sel: ".d-set-main .d-set-row",
      reason:
        "**取样差异 + 分节已下线**：画板帧 0 的字段行属于「快捷键」分节，产品**没有这一节**"
        + "（2026-10-01 用户裁定删分节 + 停执行器）。所以这一份量的**字段行原子**（`.pw-field` /"
        + " `.pw-label` / `.pw-ctl` 三枚）落在**常规**分节的同类基件上 —— 那一节是产品里唯一"
        + "还在用「字段行 + 右控件槽」的分节，量到的是行盒本身（高 / 内距 / 字号 / 描边）。"
        + "另外 v5 的 `.d-set-row`（`system.css:486`）与 v1 的 `.pw-field`（board.css:781 的"
        + " `justify-content:space-between`）本身也不是同一形态。",
    },
    {
      sel: ".d-seg",
      reason:
        "**取样差异（v5 没有单选组）**：v1 的 `.pw-radio` 是一排圆角小片；v5 的 `.d-radio` / `.d-radiorow` "
        + "只在 `system.css` 里定义、产品一个都没发，实际承载枚举的是 `span.d-seg`。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};