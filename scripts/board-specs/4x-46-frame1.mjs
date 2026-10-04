// 归档历史（画板 46 · 帧 1）
//
// fork:v5-settings-map（2026-10-04）—— 产品侧选择器从 v1 的 pw-* 迁到 v5 的 d-*
// （依据 docs/v5-settings-class-map-2026-10-04.md + 产品源码实况：
// SettingsPanel.tsx:1300-1310 的 archived 分节 + ProjectArchivePanel）。
// **画板侧一行不动**，两边靠 pairs 显式配对。
const OPEN_ARCHIVED = `
  const opener = document.querySelector(".d-side-foot button");
  if (!opener) throw new Error("设置入口没找到（.d-side-foot > button）");
  opener.click();
  await new Promise((r) => setTimeout(r, 1600));
  const row = document.querySelector('button.d-set-navitem[data-section="archived"]');
  if (!row) throw new Error("settings section not found: archived");
  row.click();
  // fork:v5-settings-map —— 归档页先拉一次归档清单，拉完之前列表列里只有一行
  // 「加载中...」（.d-run）。等它真的换成内容或空态再量。
  for (let i = 0; i < 40; i++) {
    if (!document.querySelector(".d-set-main .d-run")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 1200));`;

export default {
  "name": "归档历史（画板 46 · 帧 1）",
  "board": "46-settings-prompts-archive-import.html",
  "boardFrame": 1,
  "app": { "script": OPEN_ARCHIVED, "settle": 1500 },
  "tolerance": { "box": 2, "fontSize": 0 },
  "knownDiffs": [
    {
      "sel": ".d-set-main .d-set-sec",
      "reason": "**取样差异（页头 → 分节）**：v1 的 `.pw-shead` 是一行页头（下边框 + `align-items:flex-end`）；v5 的 `SettingsPage`（`SettingsUi.tsx:618-631`）收成 `div.d-set-sec`。"
    },
    {
      "sel": ".d-set-main .d-set-sec-t",
      "reason": "**取样差异**：`.pw-sec-title` 后面挂一条撑满的发丝线（board.css:75）；v5 的 `.d-set-sec-t` 只是「`fs-lg` + 600」的一行标题，发丝线没有了。这一对量的是标题行盒本体。"
    },
    {
      "sel": ".d-set-main .d-card",
      "reason": "**取样差异（详情卡仍在）**：这一帧的 `.pw-detail` 在 v5 仍有承载物 —— `ProjectArchivePanel` 用的是 `ConfigDetail`（`SettingsUi.tsx:413`，发 `div.d-card`），不是列表页那种「撤卡」的形态。"
    },
    {
      "sel": ".d-set-main .d-row",
      "reason": "**取样差异（`.pw-inline`）**：v1 的 `.pw-inline` 是详情头那一行横排；v5 发 `div.d-row`。"
    },
    {
      "sel": ".d-set-main .i[data-ico]",
      "reason": "**取样差异（`.pw-ico`）**：v5 去掉了图标壳 —— 图标直接是 `<i data-ico>`（`system.css` 里没有 `.d-ico`，`PwIcons` 直接渲染 `i`）。所以 `.pw-ico` 那一对量的是产品侧那个**裸图标元素**，而不是一层壳。"
    },
    {
      "sel": ".d-set-main .d-sess",
      "reason": "**形态差异**：`.pw-litem`（board.css:901，7px/8px + 圆角 4 + gap 8）↔ v5 的归档列表行发 `button.d-sess`（`system.css:49`，整行块级无描边）。骨架相同，档位按 v5 系统表取值。"
    },
    {
      "sel": ".d-set-main .d-sess-t",
      "reason": "**形态差异**：`.pw-lname`（行内一行名字，board.css:909）↔ v5 的 `.d-sess-t`（`system.css:59`，`fs-body` + 控件行高）。"
    },
    {
      "sel": ".d-set-main .d-sess-m",
      "reason": "**形态差异**：`.pw-lsub`（行内一行弱化副标题）↔ v5 的 `.d-sess-m`（`system.css:61`，`margin-top:2px`）。"
    },
    {
      "sel": ".d-set-main .d-badge.count",
      "reason": "**状态依赖**：画板帧里 `.pw-badge.count` 挂在「已归档的项目」那一节的标题右端；v5 的归档页把计数放进了分组标题行（`.d-group-title`），没有独立的 count 徽章。这枚量到的是内容区里实际存在的那一枚 `.d-badge.count`（若没有则按取样差异记）。"
    },
    {
      "sel": ".d-set-main .d-btn.danger.sm",
      "reason": "**状态依赖**：画板帧里那枚「彻底删除」在**展开并选中一条归档会话**之后才出现；自动对位停在默认态（右列是空态或项目归档列表），量不到 —— 不是漂移。"
    },
    {
      "sel": ".d-set-main .d-switch",
      "reason": "**状态依赖**：画板帧里那枚开关挂在「允许自动调用」一行（选中一条技能之后）；归档页默认态没有它。"
    },
    {
      "sel": ".d-set-main .d-btn.outline.sm",
      "reason": "**状态依赖**：画板帧里那两枚（「恢复」/「彻底删除」）在**展开一个已归档项目并选中一条归档会话**之后才出现；自动对位停在默认态（右列是空态或项目归档列表），量不到 —— 不是漂移。"
    },
    {
      "sel": ".d-set-main .d-btn.sm",
      "reason": "**状态依赖**：同上一条（动作枚随选中态出现）。"
    },
    {
      "sel": ".d-switch",
      "reason": "**状态依赖**：画板帧里那枚开关挂在「允许自动调用」一行（选中一条技能之后）；归档页默认态没有它。"
    },
    {
      "sel": ".d-set-main .d-col",
      "reason": "**取样差异（`.pw-list`）**：画板那一列是行堆（.pw-list）；v5 的归档页左列是 `ConfigSidebar`（.d-set-nav）+ 内容列（.d-set-inner），没有一处「行堆容器」。这一对量到的是内容区里实际存在的那一枚 `.d-col`（若没有则按取样差异记）。"
    },
    {
      "sel": ".d-set-main .d-mono.d-t-faint",
      "reason": "**取样差异（`.pw-mono.pw-dim`）**：画板那一枚是「磁盘路径」的等宽弱化行；v5 的归档页把它写进 `.d-set-row-s.d-mono`（路径那一行）。这一对量到的是内容区里实际存在的那一枚 `.d-mono.d-t-faint`（若没有则按取样差异记）。"
    },
    {
      "sel": ".d-set-main .d-set-inner",
      "reason": "**取样差异（`.pw-grid2`）**：画板那一格是两栏块流里的一个格子；v5 的归档页右列是 `.d-set-inner`（内容列，`system.css:483`）。这一对量的是**内容列**的盒本体。"
    },
    {
      "sel": ".d-set-main .d-empty",
      "reason": "**数据依赖**：归档为空 / 加载中时 v5 发的是 `.d-empty`（`ImportPanel` / `ProjectArchivePanel` 通用空态）。跑对位时是否落在空态取决于本机有没有归档过会话；这一对量的是空态盒本体。"
    },
    {
      "sel": ".d-set-main .d-banner",
      "reason": "**取样差异（`.pw-alert` → `.d-banner`）**：对照表里的 `.pw-alert` 在 v5 没有同名类，实际承载它的是 `.d-banner`（`system.css:456`）。"
    }
  ],
  "pairs": [
    // 页头 / 内容区
    [".pw-shead", ".d-set-main .d-set-sec"],
    [".pw-shead-copy > h2", ".d-set-main .d-set-sec > .d-row > .d-t-lg.d-t-b"],
    [".pw-shead-copy > p.sub", ".d-set-main .d-set-sec > .d-t-xs.d-t-faint"],
    [".pw-scontent", ".d-set-main"],
    [".pw-sec-title", ".d-set-main .d-set-sec-t"],
    [".pw-badge.count", ".d-set-main .d-badge.count"],
    // 详情卡
    [".pw-detail", ".d-set-main .d-card"],
    [".pw-inline", ".d-set-main .d-row"],
    [".pw-ico", ".d-set-main i[data-ico]"],
    [".pw-mono.pw-dim", ".d-set-main .d-mono.d-t-faint"],
    [".d-set-main .d-btn.outline.sm", ".d-set-main .d-btn.outline.sm"],
    [".d-set-main .d-btn.sm", ".d-set-main .d-btn.sm"],
    [".pw-btn.danger.sm", ".d-set-main .d-btn.danger.sm"],
    // 列表
    [".pw-list", ".d-set-main .d-col"],
    [".pw-litem", ".d-set-main .d-sess"],
    [".pw-lname", ".d-set-main .d-sess-t"],
    [".pw-lsub", ".d-set-main .d-sess-m"],
    // 其余
    [".pw-grid2", ".d-set-main .d-set-inner"],
    [".pw-switch", ".d-switch"],
    [".pw-alert", ".d-set-main .d-banner"],
    [".pw-empty", ".d-set-main .d-empty"]
  ]
};