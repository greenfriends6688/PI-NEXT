# 设置族 v1 → v5 类名对照表（2026-10-04）

> 供 `scripts/board-specs/4x-*` 与 `4[0-7]-*.mjs` 把产品侧选择器从 v1 的 `pw-*` 迁到 v5 的 `d-*`。
> **产品是唯一真值**：本表逐条对照「产品现在实际发的类」（`grep` 自 `SettingsPanel.tsx` /
> `SettingsUi.tsx` / `ModelsConfig` / `SkillsConfig` / `PluginsConfig` / `AgentsConfig`），
> 不是从 v1 板推的。**画板侧不动**（画板仍是 v1 的 `pw-*`），用 spec 的
> `pairs: [["画板选择器", "产品选择器"]]` 显式配对。

## 一 · 设置壳

| v1（画板侧） | v5（产品侧） | 说明 |
|---|---|---|
| `.pw-settings` | `.d-settings` | 设置壳根 |
| `.pw-snav` / `.pw-snav-row` | `.d-set-nav` / `.d-set-navitem` | 左导航列与导航行（`[data-section]` 钩子不变） |
| `.pw-sbody` | `.d-set-main` | 导航右侧的内容外壳 |
| `.pw-cols` | `.d-set-inner` | 内容内两列容器 |
| `.pw-scontent` | `.d-set` | 分节内容宿主 |
| `.pw-shead` / `.pw-shead-copy` / `.pw-shead-acts` | `.d-set-sec` / — / — | 分节头与动作区（动作区无独立类，挂在 `.d-set-sec` 内） |
| `.pw-stools` | `.d-trow`（置于 `.d-card`/`.d-group-title` 容器内） | 工具条 |

## 二 · 行与控件

| v1 | v5 | 说明 |
|---|---|---|
| `.pw-litem` | `.d-set-row` | 设置行（分节导航里的大行） |
| `.pw-block` | `.d-card` | 内容块 |
| `.pw-row` | `.d-row` | 通用行（弹层里是 `.d-menu-row`） |
| `.pw-field` | `.d-field` / `.d-field-t` | 字段容器与字段标题 |
| `.pw-label` | `.d-field-t` | 字段标签 |
| `.pw-hint` | `.d-t-xs d-t-faint` | 说明文字 |
| `.pw-ctl` | `.d-set-row-s` | 行右侧控件位 |
| `.pw-btn` | `.d-btn`（`.primary` / `.outline` / `.danger` / `.sm` 同名档位） | 按钮 |
| `.pw-badge` | `.d-badge`（`.ok`/`.warn`/`.bad`/`.accent`/`.mute`/`.count`） | 徽章 |
| `.pw-switch` | `.d-switch` | 开关 |
| `.pw-input` | `.d-input` | 输入框 |
| `.pw-textarea` | `.d-textarea` | 多行输入 |
| `.pw-select` | `.d-select` | 下拉触发钮（窄屏原生 select 走 `.m-pickselect`） |
| `.pw-radio` / `.pw-radiorow` | `.d-radio` / `.d-set-row`（内含 `.d-radio`） | 单选 |
| `.pw-range` | `.d-slider` | 滑块 |
| `.pw-search` | `.d-searchfield` | 搜索框 |
| `.pw-empty` | `.d-empty`（`d-empty-ico` / `d-empty-t` / `d-empty-s`） | 空态 |
| `.pw-stat` | `.d-stat`（容器 `.d-statgrid`） | 统计块 |
| `.pw-sec` | `.d-set-sec` / `.d-set-sec-t` | 分节 |
| `.pw-grid2` / `.pw-grid4` | `.d-grid2` / `.d-grid2`（四列用 `.d-cardgrid` 或 `.d-grid2` 嵌套） | 栅格 |
| `.pw-col` | `.d-col` | 列容器 |
| `.pw-table` | `.d-table` | 表格 |
| `.pw-modal` 系（`.pw-modal-head/-body/-foot`） | `.d-modal` / `.d-modal-box` / `.d-modal-head` / `.d-modal-body` / `.d-modal-foot` | 弹窗 |
| `.pw-tok-key/str/num/com/fn` | `.d-code-key/str/num/com/fn`（着色在 `.d-code-body` 内的 `span`） | 代码着色 |
| `.pw-trow` | `.d-trow` | 树行 |
| `.pw-ico` | 删（图标直接 `<i data-ico>`，v5 去掉图标壳） | 画板侧保留壳，**产品侧不选它** |

## 三 · 使用纪律

1. spec 的**画板侧选择器保持 `pw-*`**（画板没换）；**产品侧**按本表换 `d-*`。
2. 产品侧若某个 v1 件 v5 没有对应（如 `.pw-shead-acts` 无独立类），就近选承载它的类
   （`.d-set-sec`），并在 `knownDiffs` 里写清「取样差异」原因。
3. 改完跑 `node scripts/board-diff.mjs scripts/board-specs/<该份>`；**不许把 spec 删掉或标 skip**，
   也不许放宽 `tolerance` 来消红——红要么是真几何差（登记 `knownDiffs`），要么是还没换干净。
4. 本表的唯一真值来源是**产品源码**。若产品后续再换类，先更新本表再改 spec。