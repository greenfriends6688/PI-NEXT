// 画板 54 扩展浮窗 / 链接 / 探索分支 —— 能在当前种子数据里量到的那部分
//
// 画板 54 三帧各自的对象：
//   帧 0「扩展浮窗 · 状态胶囊」—— 顶栏 blocks 插件浮窗（`.pw-pop` + `.pw-prow`
//           插件包行 + `.pw-prow.pw-desc` 分节 + `.pw-sep` + 里面的 widget 卡）
//           + 聊天区右上角那枚 mono 胶囊（`ext-float-pill`）；
//   帧 1「链接在哪儿打开 · 附件预览」—— 正文外链的三选一浮窗 + 六种附件预览卡；
//   帧 2「探索分支」—— 转录顶部抬头条 + 右栏只读并排面板（`.pw-panel` 家族）。
//
// 同样不锁 boardFrame：整页取「第一个该类」，和 board-diff 的 `pick()` 取法一致。
//
// app.script（照 board-diff.mjs 的 OPEN_SESSION 思路，带兜底）：
//   1. 展开项目组 → 点第一条会话；
//   2. 点 `.desktop-secondary-workspace-toggle` 开右栏 —— 帧 2 的 `.pw-panel`
//      家族（`.pw-panel` / `.pw-panel-head` / `.pw-panel-body` / `.pw-tabs`）
//      在产品里由右栏面板承担；
//   3. 点顶栏 `blocks` 插件钮出浮窗 —— 帧 0 B 的插件浮窗本体。
//
// ── 本 spec **没有**覆盖的画板 54 元素（真漂移的不登记，留档在此 + 报告里）──
//   · 帧 1 A 的「链接三选一」浮窗（`.pw-pop-title` + `.pw-prow.is-on` + `.pw-sep`
//     + 复制链接行）—— **产品未实现**：LinkOpenContext 只是个回调，
//     MarkdownBody.tsx:56 单左键直接交给应用内浏览器、带修饰键走 target="_blank"，
//     没有菜单、没有「复制链接」、也没有「记住上次选择」。真漂移，不进 pairs。
//   · 帧 0 A 的 mono 状态胶囊（`.ext-float-pill`）—— 画板样张是一枚**内联样式**
//     的 span（没有 pw-* 类），且产品里要 `extensionStatuses.length > 0 || widgets`
//     才渲染；本机没装任何扩展，量不到。
//   · 帧 0 B 的 widget 卡（`.pw-card` / `.pw-card-head` / `.pw-code-body`）——
//     要有一条 `setWidget` 上报的 widget；画板那张 `.pw-code-body` 还自带内联
//     `font-size: var(--text-meta)` + `padding` 覆盖，是样张自己的取景。
//   · 帧 2 的探索抬头条与右栏面板内容（`.pw-list` / `.pw-litem` / `.pw-alert.info`
//     / `.pw-sec-title` / `.pw-card-foot` / `.pw-btn.primary`）—— 全部挂在
//     `ExplorationPane` 上，只有当**当前会话本身是某条会话 fork 出来的分支**
//     时才可能打开（AppShell.tsx `openBranchTab` 只被 `ExplorationBanner` 的
//     「打开右栏」触发，而 Banner 又要 `deriveExplorationOrigin` 推得出来源）。
//     种子里两条会话互不为父子，推不出来源 → 抬头条 return null、右栏 tab 开不出来。
//     这几条留 knownDiffs 之外更合适？—— 不：它们是**接线齐了、只差数据**，所以
//     按状态依赖登记，登记文案写清「差什么才能量到」。
export default {
  name: "扩展链接 · 探索（画板 54 · 可接线的那部分）",
  board: "54-extension-links-exploration.html",
  app: {
    settle: 1800,
    script: `
  const byIco = (root, name) => [...root.querySelectorAll('[data-ico="' + name + '"]')][0];
  if (!document.querySelector(".pw-session")) {
    const chev = byIco(document.querySelector(".pw-side-scroll") ?? document, "chevron-right");
    const toggle = chev?.closest("[role=button]");
    if (toggle) { toggle.click(); await new Promise((r) => setTimeout(r, 700)); }
  }
  const row = document.querySelector(".pw-session");
  if (row) { row.click(); await new Promise((r) => setTimeout(r, 2600)); }

  // 帧 2 的 .pw-panel 家族在产品里是右栏面板：先把它拉出来。
  const panelToggle = document.querySelector(".desktop-secondary-workspace-toggle");
  if (panelToggle) { panelToggle.click(); await new Promise((r) => setTimeout(r, 1600)); }

  // 帧 0 B 的顶栏插件浮窗本体。
  const blocks = byIco(document.querySelector(".pw-topbar"), "blocks");
  const pluginBtn = blocks?.closest("button,[role=button]");
  if (pluginBtn) { pluginBtn.click(); await new Promise((r) => setTimeout(r, 1400)); }
`,
  },
  // fork:v5-old-layer（2026-10-04）—— 产品侧已换 v5：
  //   浮窗壳/行/副文案/分隔 → `.d-pop` / `.d-menu-row` / `.d-menu-row .d-t-xs` / `.d-sep`
  //   右栏三件 → AppShell.tsx:3432 `.right-panel-container.d-panel` /
  //              ExplorerPanel.tsx:321 `.file-explorer-header.d-panel-head` /
  //              AppShell.tsx:3534 `.file-panel-body.d-panel-body`
  //   标签条 → TabBar.tsx:449/503 `.fork-tabbar.d-tabbar` / `.fork-tab.d-tab`
  // 画板侧仍取 v1 的 pw-*。
  pairs: [
    // 帧 0 B：插件浮窗本体 + 它的行族
    [".pw-pop", ".d-pop"],
    [".pw-prow", ".d-menu-row"],
    [".pw-prow.pw-desc", ".d-menu-row .d-t-xs"],
    [".pw-sep", ".d-sep"],
    // 帧 0 B widget 头 / 帧 2 面板头的「只读」徽章 / 帧 1 B 的版本徽章
    [".pw-badge", ".pw-badge"],
    [".pw-badge.count", ".pw-badge.count"],
    // 帧 2：右栏只读并排面板的外壳三件
    [".pw-panel", ".right-panel-container.d-panel"],
    // 画板帧 2 量的是「探索面板」的头；产品的探索面板要分支会话才挂得上，
    // 所以拿同一个 board.css 原子在产品里唯一稳定的位置量（右栏面板头）。
    [".pw-panel-head", ".right-panel-container .file-explorer-header.d-panel-head"],
    [".pw-panel-body", ".file-panel-body.d-panel-body"],
    // 帧 2 的标签行 / 面板体内容 / 帧 1 B 的附件卡 —— 数据或状态依赖
    [".pw-tabs", ".fork-tabbar.d-tabbar"],
    [".pw-tab", ".fork-tab.d-tab"],
    [".pw-list", ".pw-list"],
    [".pw-litem", ".pw-litem"],
    [".pw-alert.info", ".pw-alert.info"],
    [".pw-sec-title", ".pw-sec-title"],
    [".pw-card-foot", ".pw-card-foot"],
    [".pw-filecard", ".pw-filecard"],
    [".pw-fname", ".pw-fname"],
    [".pw-meta", ".pw-meta"],
  ],
  knownDiffs: [
    {
      sel: ".d-sep",
      reason:
        "**数据依赖**：画板帧 0 B 的插件浮窗里，`.pw-sep` 分隔「插件包列表」与「widget 卡」。"
        + "产品的顶栏插件浮窗在本工作区查到 0 个扩展包 / 0 个独立扩展"
        + "（`TopBarPopovers.tsx` 的 `packages.length === 0 && standalone.length === 0` 分支），"
        + "整窗只剩三行 `.pw-prow.pw-desc`，没有分隔线。装上任一扩展（`/api/plugins` "
        + "能报出包）后这一条就能量。",
    },
    {
      sel: ".fork-tab.d-tab",
      reason:
        "**数据依赖**：右栏标签条 `.pw-tabs` 渲染出来了但里面 0 个标签 —— 种子工作区 "
        + "`…/pi-web-board-fixtures-*/workspace` 是空目录，没有文件可开；该目录也不是 git "
        + "仓库，`openGitGraphTab` 的入口不出现；终端 / 浏览器 tab 也没建。"
        + "`TabBar.tsx` 的 `tabs.map` 为空 → 没有 `.pw-tab`。",
    },
    {
      sel: ".fork-tabbar.d-tabbar",
      reason:
        "**取景差异**（已登记形态偏差 DIVERGENCE §49「文件头行 + 标签行 vs 标签行即头行」）："
        + "画板帧 2 的 `.pw-tabs` 是**独立于** `.pw-panel-head` 的一行（高 31，字号从 `.pw-panel` "
        + "继承到 13px）；产品把两行合并成一行 36px 的头（`TabBar.tsx` 内联 "
        + "`height: var(--control-lg)`，字号从合并头继承到 12px）。量到的 13px/19.5px ≠ "
        + "12px/18px 是这个**结构合并**带来的继承差，不是间距 / 圆角 / 发丝底线上的差 —— "
        + "那三项两边逐项一致。已登记形态取舍，不是新发现。",
    },
    {
      sel: ".pw-list",
      reason:
        "**状态依赖**：`.pw-list` 在产品里只出现在 `ExplorationPane` 的只读转录容器"
        + "（`components/fork/ExplorationPane.tsx`）。它要右栏开出一个 `branch:<id>` 标签，"
        + "而 `AppShell.tsx` 的 `openBranchTab` 只被 `ExplorationBanner` 的「打开右栏」触发，"
        + "Banner 又要求 `deriveExplorationOrigin` 能从父会话 context 推出 fork 边界。"
        + "种子里两条会话互不为父子 → 开不出探索 tab。**还差什么**：一条由现有会话 "
        + "fork 出来、且父会话仍可读的分支会话。",
    },
    {
      sel: ".pw-litem",
      reason:
        "**状态依赖**：同 `.pw-list` —— 分支转录列表的每一行。差同一条分支会话。",
    },
    {
      sel: ".pw-alert.info",
      reason:
        "**状态依赖**：`.pw-alert.info` 是探索面板顶部的「只读并排视图」提示条"
        + "（`ExplorationPane.tsx` 的 `!error && context === null` / 正文态两处都有）。"
        + "组件没挂载就没有。差同一条分支会话。",
    },
    {
      sel: ".pw-sec-title",
      reason:
        "**状态依赖**：探索面板里「这条分支的转录」那行分节标题，同属 `ExplorationPane`。"
        + "差同一条分支会话。",
    },
    {
      sel: ".pw-card-foot",
      reason:
        "**状态依赖**：画板帧 2 里右栏页脚那条「右栏刻意不做第二个可交互聊天面板」的脚注，"
        + "以及帧 0 B 里 widget 卡之外的页脚；在产品里对应的是 `ExplorationPane` / "
        + "`TodoChip` 的 `.pw-card-foot`。两者都要上面那两个组件先挂上。",
    },
    {
      sel: ".pw-filecard",
      reason:
        "**数据依赖**：附件预览卡（`.pw-filecard` + `.pw-fname` + `.pw-meta`）由会话里的"
        + "附件条目 / 本轮写入文件驱动（`MessageView.tsx:1704` 的 `TurnWrittenFiles`）。"
        + "种子会话是纯文本 + 一个只读 `read` 工具结果，既没有附件也没有写入文件。"
        + "**还差什么**：一条带 image / pdf / 附件引用的会话。",
    },
    {
      sel: ".pw-fname",
      reason:
        "**数据依赖**：文件名，取自附件条目。种子会话没有附件，随 `.pw-filecard` 一起缺席。",
    },
    {
      sel: ".pw-meta",
      reason:
        "**数据依赖**：文件卡的类型 / 体积说明（board.css 里是 `.pw-filecard .pw-meta` 的"
        + "等宽小字），同样只在附件卡里出现。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};