// 模型 · 单个模型的编辑块（画板 41 · 帧 1）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*。
// **画板侧一行不动**，两边靠 pairs 显式配对。
// 驱动：开设置 → 模型 → 点第一个供应商 → 点它的第一个模型（对应画板帧 1 的「选中一个模型」态）。
const OPEN_MODEL_EDIT = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="models"]');
  if (!row) throw new Error("settings section not found: models");
  row.click();
  await new Promise((r) => setTimeout(r, 1800));
  const nav = document.querySelector(".d-set-main .d-set > .d-set-nav");
  if (!nav) throw new Error("供应商列表列没找到");
  const provider = nav.querySelector("button.d-trow");
  if (provider) { provider.click(); await new Promise((r) => setTimeout(r, 1400)); }
  const model = [...nav.querySelectorAll("button.d-trow.models-sidebar-indented-item")]
    .find((b) => !b.className.includes("models-sidebar-add-item"));
  if (model) { model.click(); await new Promise((r) => setTimeout(r, 1500)); }`;

export default {
  "name": "模型 · 单模型编辑块（画板 41 · 帧 1）",
  "board": "41-settings-models.html",
  "boardFrame": 1,
  "app": { "script": OPEN_MODEL_EDIT, "settle": 2000 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".d-set-main .d-set > .d-set-inner",
      "reason": "**取样差异（详情卡 → 内容列）**：`.pw-detail`（board.css:923，描边 + 圆角 6 的一张巨卡）在 v5 被撤掉，右列就是 `.d-set-inner`（`ModelsConfig.tsx:3213` 有注释）。卡片壳不存在，量到的是内容列本体。"
    },
    {
      "sel": ".d-field-t",
      "reason": "**形态差异**：v1 的 `.pw-field`（board.css:781）是「一行标签 + 右侧控件，`justify-content:space-between`」；v5 的 `ConfigField`（`SettingsUi.tsx:377`）发 `div.d-field`（`system.css:503`，**纵向** `column; gap:6`）。同一行的职责在 v5 里改成「标题在上、控件在下」，这是 D-07 定下的字段形态。"
    },
    {
      "sel": ".d-field .d-t-xs.d-t-faint",
      "reason": "**取样差异（说明文字从标签里搬出来）**：v1 把说明放在 `.pw-label small` 里（`display:block`，board.css:783）；v5 的 `ModelsConfig` 手写字段时把说明降成 `.d-field` 下的 `div.d-t-xs.d-t-faint`，**不在标签内**。所以 `.pw-field .pw-label small` 这一对量的是「说明那一行」而不是「标签内的小字」。"
    },
    {
      "sel": ".d-set-row > .d-grow-last",
      "reason": "**取样差异（`.pw-ctl` → 控件槽）**：board.css:786 的 `.pw-field .pw-ctl` 是「字段行右端的 flex 槽」；v5 的 `.d-field` 是纵向字段、没有这一槽，槽位只存在于 `.d-set-row` 这一族（`system.css:492`：`.d-set-row > .d-grow-last { margin-left:auto }`）。这一对量的是 v5 里**实际承载控件槽**的那一枚。"
    },
    {
      "sel": ".d-code-body",
      "reason": "**未落地**：画板帧 1 的「自定义请求头 / 兼容性」块里有配置原文回显（.pw-code-body + token 着色）；v5 的模型详情页没有代码回显区（ModelsConfig.tsx 全文没有 .d-code-body / .tok-*，代码块只存在于转录区与日志弹窗）。"
    },
    {
      "sel": ".d-code-body .tok-k",
      "reason": "**未落地**：同上（模型详情没有代码回显区）。"
    },
    {
      "sel": ".d-code-body .tok-s",
      "reason": "**未落地**：同上（模型详情没有代码回显区）。"
    },
    {
      "sel": ".d-code-body .tok-c",
      "reason": "**未落地**：同上（模型详情没有代码回显区）。"
    },
    {
      "sel": ".d-code-body .tok-k",
      "reason": "**取样差异（token 类名）**：v1 的 token 是 `.pw-tok-key/-str/-num/-com/-fn`；v5 的着色类收成 `system.css:190-193` 的 `.tok-k / -s / -n / -c`（画板 D-03b 帧 C 的写法），值仍来自同一套代码令牌。对照表里 `.pw-tok-* → .d-code-key/str/num/com/fn` 那一行同样以产品实况为准。"
    }
  ],
  "pairs": [
    [".pw-detail", ".d-set-main .d-set > .d-set-inner"],
    [".pw-inline", ".d-set-main .d-set-inner .d-row"],
    [".pw-badge", ".d-set-main .d-badge"],
    [".pw-sec-title", ".d-set-main .d-set-sec-t"],
    [".pw-field", ".d-set-main .d-field"],
    [".pw-field .pw-label", ".d-set-main .d-field-t"],
    [".pw-field .pw-label small", ".d-set-main .d-field .d-t-xs.d-t-faint"],
    [".pw-ctl", ".d-set-main .d-set-row > .d-grow-last"],
    [".pw-switch", ".d-switch"],
    [".pw-selectbox", ".d-select"],
    [".pw-mono", ".d-mono"],
    [".pw-mono.pw-dim", ".d-set-main .d-mono"],
    [".pw-btn.sm", ".d-set-main .d-btn.sm"],
    [".pw-btn.primary.sm", ".d-set-main .d-btn.primary.sm"],
    [".pw-btn.danger.sm", ".d-set-main .d-btn.danger.sm"],
    [".d-code-body", ".d-code-body"],
    [".d-code-body .tok-k", ".d-code-body .tok-k"],
    [".d-code-body .tok-s", ".d-code-body .tok-s"],
    [".d-code-body .tok-c", ".d-code-body .tok-c"]
  ]
};