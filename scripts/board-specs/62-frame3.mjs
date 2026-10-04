// 设置新框架 · 空态三态（画板 62 · 帧 3）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*。
// **画板侧一行不动**，两边靠 pairs 显式配对。
// 原驱动是 settings:prompts（自定义命令一节已下线），换成同样会出空态的归档历史。
const OPEN_ARCHIVED = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="archived"]');
  if (!row) throw new Error("settings section not found: archived");
  row.click();
  await new Promise((r) => setTimeout(r, 2600));`;

export default {
  "name": "设置新框架 · 空态三态（画板 62 · 帧 3）",
  "board": "62-settings-layout.html",
  "boardFrame": 3,
  "app": { "script": OPEN_ARCHIVED, "settle": 2600 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".d-set-main .d-empty",
      "reason": "**取样差异（`.pw-empty-inner`）**：v1 的空态是「`.pw-empty` > `.pw-empty-inner` > `.mark` + `p`」两层壳；v5 的 `ConfigEmptyState`（`SettingsUi.tsx:406`）把 `span.mark` + `p` **直接放在 `.d-empty` 里**，内层壳没有了。所以 `.pw-empty-inner` 那一对量到的也是 `.d-empty` 本体 —— 两对量的是同一枚元素。"
    },
    {
      "sel": ".d-set-main .d-empty > span.mark",
      "reason": "**取样差异**：v1 的图标壳是 `.pw-empty-inner .mark`；v5 直接是 `.d-empty > span.mark`（`ImportPanel.tsx:257` / `ProjectArchivePanel` 同款）。图标壳本身按 v5 系统表取值。"
    },
    {
      "sel": ".d-set-main .d-t-xs.d-t-faint",
      "reason": "**接线差异**：画板空态下面那两段是**画板说明文字**（解释为什么这么排），不是产品 UI；v5 把同一层说明降成 `.d-t-xs.d-t-faint`（系统表里没有 `.pw-hint` 这个类）。按取样差异登记。"
    }
  ],
  "pairs": [
    [".pw-empty", ".d-set-main .d-empty"],
    [".pw-empty-inner", ".d-set-main .d-empty"],
    [".pw-empty-inner .mark", ".d-set-main .d-empty > span.mark"],
    [".pw-empty-inner > p", ".d-set-main .d-empty > p"],
    [".pw-hint", ".d-set-main .d-t-xs.d-t-faint"]
  ]
};