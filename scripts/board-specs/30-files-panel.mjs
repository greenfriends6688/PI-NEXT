// 画板 30 文件面板 —— 帧 A「整屏 · 文件面板展开」。
//
// 这一帧定死的是**右栏外壳的四层**：面板（`.pw-panel`）→ 面板头
// （`.pw-panel-head`）→ 标签条（`.pw-tabs` / `.pw-tab`）→ 面板体
// （`.pw-panel-body`），以及体里的**文件树行**（`.pw-trow`）与**查看器**
// （`.pw-viewer` / `.pw-viewer-head`）。
//
// 两条接线上的坑，写在这里免得后面的人重踩：
//
// 1. **产品有两个 `.pw-panel-head`。** 外层那枚是工作区合并头行（G 轮把标签行
//    提上来与它并成一行，登记见 DIVERGENCE 49），内层 `.file-explorer-header`
//    才是画板 30 的「文件」头行。所以这一对必须**显式配对**，不能靠同名直取
//    ——直取会拿外层那枚去比，padding / 宽度全在比另一个东西。
// 2. **查看器有两个 `.pw-viewer-head`。** 外层 `.file-viewer-shell > .pw-viewer-head`
//    是文档级头（路径 + 元信息徽章 + 同步点 + 动作区），内层 `.pw-viewer > .pw-viewer-head`
//    才是画板 52 帧 A 的「文件名 + 格式徽章 + 撤销/保存」那一枚。这一帧比内层。
//
// app.script 自带驱动（不去抢 board-diff.mjs 的 PRESETS）：开右栏 → 在文件树里
// 点一个源码文件，把产品逼到画板这一帧的形态（树 + 查看器并排）。选文件时排除
// 目录行（目录行带 `chevron-right` 折叠箭头），并且**不能写死文件名** —— 工作区
// 由运行实例决定，写死就成了一份只在某台机器上绿的规格。
const OPEN_PANEL = `
  const toggle = document.querySelector(".desktop-secondary-workspace-toggle");
  const panel = document.querySelector(".right-panel-container");
  if (toggle && panel && !panel.className.includes("right-panel-open")) {
    toggle.click();
    await new Promise((r) => setTimeout(r, 1100));
  }
`;

const OPEN_A_SOURCE_FILE = `
  const rows = [...document.querySelectorAll(".file-explorer-section .d-trow")];
  const isDir = (r) => !!r.querySelector('[data-ico="chevron-right"]');
  const row = rows.find((r) => !isDir(r));
  if (!row) {
    const cwd = document.querySelector(".file-explorer-title-label.d-mono");
    throw new Error("文件树里没有可打开的文件（工作区 "
      + (cwd ? cwd.getAttribute("title") : "?") + " 是空的）——板 30 这一帧量的是树+查看器并排态");
  }
  row.click();
`;

export default {
  name: "文件面板（画板 30 · 帧 A 整屏 · 面板头/标签条/树/查看器）",
  board: "30-files-panel.html",
  boardFrame: 0,
  app: { script: `${OPEN_PANEL}${OPEN_A_SOURCE_FILE}`, settle: 2600 },
  // fork:v5-old-layer（2026-10-04）—— 产品侧已换画板 D-05/D-06 的 v5 类：
  //   .pw-panel        → AppShell.tsx:3432 .right-panel-container.d-panel
  //   .pw-panel-head   → ExplorerPanel.tsx:321 .file-explorer-header.d-panel-head
  //   .pw-tabs/.pw-tab → TabBar.tsx:449/503 .fork-tabbar.d-tabbar / .fork-tab.d-tab
  //   .pw-panel-body   → AppShell.tsx:3534 .file-panel-body.d-panel-body
  //   .pw-trow         → FileExplorer.tsx:567/999 .d-trow
  //   .pw-viewer*      → FileViewer.tsx:2362 .file-viewer-shell.d-viewer +
  //                      CodeFileEditor.tsx:381/385 .d-viewer / .d-viewer-bar
  // 画板侧仍取 v1 的 pw-*。
  pairs: [
    // 外壳三层
    [".pw-panel", ".right-panel-container.d-panel"],
    // 面板头：产品上「文件」那一行是 .file-explorer-header（见文件头第 1 条）
    [".pw-panel-head", ".file-explorer-header.d-panel-head"],
    [".pw-panel-head .pw-iconbtn", ".file-explorer-header .d-iconbtn"],
    [".pw-panel-head b", ".file-explorer-header b"],
    // 标签条
    [".pw-tabs", ".fork-tabbar.d-tabbar"],
    [".pw-tab", ".fork-tab.d-tab"],
    [".pw-tab .x", ".fork-tab.d-tab .x"],   // 关 tab 那枚钮的类就叫 .x（TabBar.tsx:606）
    // 面板体
    [".pw-panel-body", ".file-panel-body.d-panel-body"],
    // 文件树
    [".pw-trow", ".file-explorer-section .d-trow"],
    // 查看器（内层那一枚头，见文件头第 2 条）
    [".pw-viewer", ".file-viewer-shell.d-viewer"],
    [".pw-viewer-head", ".d-viewer .d-viewer-bar"],
    [".pw-viewer-head .pw-ico", ".d-viewer .d-viewer-bar > i[data-ico]"],
    [".pw-viewer-head .pw-mono", ".d-viewer .d-viewer-path"],
    [".pw-viewer-head .pw-badge", ".d-viewer .d-viewer-bar .d-badge"],
  ],
  knownDiffs: [
    {
      // 标签条那一条：DIVERGENCE.md:49 已登记的形态差异，不是这一轮新出现的漂移。
      // 画板 30 是「标题行（`.pw-panel-head`，36 高）+ 标签行（`.pw-tabs`，31 高）」两行；
      // 产品在 G 轮把标签行提上来与头行**并成一行**（`components/TabBar.tsx:213`
      // `height: var(--control-lg)` = 36），`.pw-tabs` 因此不再是 `.pw-panel` 的直接子元素。
      // 这一并带来两处级联，都不是独立画错：
      //   · 行高 31 → 36（合并行的结果）；
      //   · fontSize 13 → 12 / lineHeight 19.5 → 18 —— board.css:561-565 的
      //     `.pw-panel-head { font-size: var(--text-secondary) }`（12px）现在成了祖先，
      //     标签条继承了它；画板里它挂在 `.pw-panel` 下，继承 body 的 13px。
      // 标签**原子**本身仍然逐项对得上（`.pw-tab` 26 高、`.pw-tab .x` 11 见方都在下面的 pairs 里），
      // 这里只登记容器层的形态差异。
      sel: ".fork-tabbar.d-tabbar",
      reason: "**形态差异（已在 DIVERGENCE.md:49 登记）**：画板是「标题行 + 标签行」两行，"
        + "产品并成一行（TabBar.tsx:213 height=var(--control-lg)=36）。"
        + "fontSize 13→12 / lineHeight 19.5→18 不是独立取值，是 `.d-tabbar` 被并进 "
        + "`.d-panel-head`（board.css:561-565 font-size:var(--text-secondary)=12px）之后的继承结果；"
        + "行高 31→36 同理。标签原子（.pw-tab / .pw-tab .x）仍在本 spec 里逐项对位。",
    },
    {
      // knownDiffs 的键是**产品侧**选择器（board-diff.mjs 拿 as_ 去查表）。
      sel: ".file-explorer-header b",
      reason: "**取景差异**，不是换肤漂移。画板这一帧的取景是「右栏 420 / 左树 220」"
        + "（`.pw-split` 的 grid 列宽 220，30-files-panel.html 帧标签也写死了 420）。"
        + "产品的右栏是可拖的，打开文档时还会按 components/AppShell.tsx:1482-1483 一次性撑到 740，"
        + "而树列在 560–759 这一档被 app/fork-ui.css:449-452 压到 200px —— 比画板窄 20px，"
        + "于是 app/globals.css:1856 的 `@container (max-width: 220px) { .file-explorer-title-label { display: none } }` "
        + "命中，`<b>文件浏览器</b>` 被收进折叠态。树列宽本身（200 vs 220）已记在报告里，"
        + "这里只登记它的**后果**不当作产品画错。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};
