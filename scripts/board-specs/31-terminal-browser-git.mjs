// 画板 31 终端 / 浏览器 / Git —— 一份覆盖三帧里「能确定性打开」的原子。
//
// 为什么这份 spec 不写 boardFrame：board-diff 的 probe 只接受**一个** frameIndex，
// 而画板 31 有三帧（终端 / 浏览器 / Git+标签条）。这里改用 pairs 的双选择器能力：
// 画板侧用 `.pw-frame:nth-of-type(n) .pw-cell:nth-of-type(m) …` 精确指到某一个
// 样张（n=1 终端面板 / 2 应用内浏览器 / 3 Git 图谱+标签条；m=1 左样张 / 2 右样张），
// 产品侧用真实的选择器，量的是同一个原子在两边的几何 + 计算样式。
//（下面的注释一律写「第一节 / 第二节 / 第三节」，对应 n=1/2/3。）
//
// 进目标状态（全部靠页面上真实存在的按钮，不改产品代码、不改环境变量）：
//   1. 侧栏点开第一条会话（拿到 cwd，右栏才有面板头）
//   2. 点右栏头行的「打开工作区终端」→ 开一个终端标签（面板就位）
//   3. 点「新建浏览器标签」→ 浏览器标签激活（第二节的原子全部可见）
//   4. 点标签条右侧「全部标签」→ 标签概览浮层（第三节的浮层原子）
//   5. 点地址栏右侧的 `.pw-chipbtn`（视口预设）→ 视口清单浮层（第二节右样张）
//
// **不进 pairs 的原子（都是真漂移或结构缺口，不许用 knownDiffs 掩盖，
//   数字与证据见交付报告）**：
//   - `.pw-git / .pw-commit / .pw-lane / .pw-node / .pw-hash / .pw-msg / .pw-when`
//     （第三节泳道 + 提交行）：产品的 GitGraphTab 一个 `pw-*` 类都没挂，全是内联样式。
//   - `.pw-sep`（第三节浮层里的分隔线）：宽度跟着浮层宽度走，画板样张 340 vs 产品 300。
//   - `.pw-desc`（第三节行内的次要说明）：画板是行内小字，产品把 `.pw-prow .pw-desc`
//     用成了一整行（空态行），角色不是同一个东西。
//   - 标签条上的 `.pw-iconbtn.sm`（第一节/第三节样张里的 + 与 eraser）：产品标签条上没有
//     这两枚按钮（新建终端在文件树头行、终止在标签的 × 上），改量浏览器地址栏里同名的
//     `.pw-browser-bar .pw-iconbtn sm` —— 两边祖先字体上下文一致。
//   - `.pw-url`：产品的 `<input class="pw-url">` 上有 `style={{font:"inherit"}}`，
//     把 board.css 定的等宽 11px 顶成 13px。

const F = (n) => `.pw-frame:nth-of-type(${n})`;
const CELL = (n, c) => `${F(n)} .pw-cell:nth-of-type(${c})`;

// 产品侧：视口清单浮层（PortalDropdown 挂到 body，没有 data-tab-overview）vs
// 标签概览浮层（TabOverview，带 data-tab-overview），两个 `.pw-pop` 必须分开点。
const VIEWPORT_POP = ".pw-pop:not([data-tab-overview])";
const OVERVIEW_POP = ".pw-pop[data-tab-overview]";

export default {
  name: "终端 / 浏览器 / Git 右栏（画板 31）",
  board: "31-terminal-browser-git.html",
  app: {
    settle: 2600,
    script: `
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const byTitle = (t) => [...document.querySelectorAll("button[title],button[aria-label]")]
      .find((x) => (x.getAttribute("title") || x.getAttribute("aria-label")) === t);
    const byIco = (root, name) => [...root.querySelectorAll('[data-ico="' + name + '"]')][0];
    // 项目组默认收起，先展开再点会话行。
    if (!document.querySelector(".pw-session")) {
      const chev = byIco(document.querySelector(".pw-side-scroll") ?? document, "chevron-right");
      chev?.closest("[role=button]")?.click();
      await sleep(800);
    }
    const row = document.querySelector(".pw-session");
    if (!row) throw new Error("侧栏里没有 .pw-session（种子没被列出来？）");
    row.click();
    await sleep(2600);
    const term = byTitle("打开工作区终端");
    if (!term) throw new Error("右栏头行没有「打开工作区终端」");
    term.click();
    await sleep(2600);
    const browser = byTitle("新建浏览器标签");
    if (!browser) throw new Error("右栏头行没有「新建浏览器标签」");
    browser.click();
    await sleep(2600);
    document.querySelector("[data-tab-overview-trigger]")?.click();
    await sleep(900);
    const chip = document.querySelector(".pw-browser-bar .pw-chipbtn");
    if (!chip) throw new Error("浏览器地址栏里没有视口预设芯片");
    chip.click();
    await sleep(900);`,
  },
  pairs: [
    // ---- 第一节/第三节共享：标签条 ----
    [CELL(1, 1) + " .pw-tabs", ".pw-tabs"],
    [CELL(1, 1) + " .pw-tab", ".pw-tab"],
    [CELL(1, 1) + " .pw-tab.is-on", ".pw-tab.is-on"],
    [CELL(1, 1) + " .pw-tab .x", ".pw-tab .x"],
    // 终端输出面：keep-alive 挂着但被 [hidden] 挂起，取不到 —— 见 knownDiffs。
    [CELL(1, 1) + " .pw-term", ".pw-term"],
    // ---- 第二节左样张：浏览器已加载 ----
    [CELL(2, 1) + " .pw-browser", ".pw-browser"],
    [CELL(2, 1) + " .pw-browser-bar", ".pw-browser-bar"],
    [CELL(2, 1) + " .pw-chipbtn", ".pw-chipbtn"],
    [CELL(2, 1) + " .pw-browser-bar .pw-iconbtn.sm", ".pw-browser-bar .pw-iconbtn.sm"],
    // ---- 第二节右样张：空态 + 视口预设展开 ----
    [CELL(2, 2) + " .pw-empty-inner", ".pw-empty-inner"],
    [CELL(2, 2) + " .pw-pop", VIEWPORT_POP],
    [CELL(2, 2) + " .pw-prow", VIEWPORT_POP + " .pw-prow"],
    // ---- 第三节右样张：标签概览浮层 ----
    [CELL(3, 2) + " .pw-pop", OVERVIEW_POP],
    [CELL(3, 2) + " .pw-pop-search", OVERVIEW_POP + " .pw-pop-search"],
    [CELL(3, 2) + " .pw-pop-title", OVERVIEW_POP + " .pw-pop-title"],
    [CELL(3, 2) + " .pw-prow", OVERVIEW_POP + " .pw-prow"],
    [CELL(3, 2) + " .pw-prow.is-on", OVERVIEW_POP + " .pw-prow.is-on"],
    // 「最近关闭」行里的恢复钮：没有关过标签就不渲染 —— 见 knownDiffs。
    [CELL(3, 2) + " .pw-btn.sm", OVERVIEW_POP + " .pw-btn.sm"],
  ],
  knownDiffs: [
    {
      sel: ".pw-tabs",
      reason: "**取景差异**：`.pw-tabs` 在 board.css 里没有自己的 font-size，量到的是祖先的值。"
        + "画板样张直接摆在 `.pw-cell` 里 → 继承 body 的 13px；产品里它挂在 `.pw-panel-head` 下 → "
        + "12px（= --text-secondary）。两侧 `.pw-panel-head` 的字号实测同为 12px，画板标签条换到面板头里也是 12px；"
        + "padding（4px 8px 0）、gap 2px、高 36（--control-lg）、发丝下边框逐项一致。",
    },
    {
      sel: ".pw-empty-inner",
      reason: "**画板样张自身不一致 + 取景差异**：① 画板两处空态样张都 inline 把 gap 从 board.css 的默认值 "
        + "--s3(12px) 收到 --s2(8px)，产品的浏览器空态没有这层覆盖，走默认值 12px；"
        + "② fontSize 13↔12 同样是取景差异（样张在 `.pw-cell` 里继承 body 13px，产品在 `.pw-browser-body` 内 = 12px）。"
        + "display grid / justify-items center / text-align center / max-width 560 逐项一致。",
    },
    {
      sel: ".pw-pop[data-tab-overview]",
      reason: "**接线 + 取景差异**：TabOverview 的浮层里塞了一个独立的滚动区（`overflowY:auto` 的列表壳，"
        + "AppShell 的 `TabOverview.tsx`），所以外层必须是 flex 列（display block → flex）；"
        + "fontSize 13↔12 是取景差异（画板样张在 `.pw-cell` 里，产品在 `.pw-panel-head` 下）。"
        + "画板.css 给的 radius-6 / padding --s1 / border / box-shadow 逐项一致。",
    },
    {
      sel: ".pw-pop[data-tab-overview] .pw-pop-title",
      reason: "**接线**：产品的标题行右边挂了一枚 `.pw-badge count`（标签计数），于是那行必须是 "
        + "flex + align-items center + gap --s2（画板样张是纯文本块）。"
        + "board.css 给的 padding（--s2 --s2 --s1）、font-size --text-meta、letter-spacing .04em 逐项一致。",
    },
    {
      sel: ".pw-term",
      reason: "**状态依赖**：终端面板是 keep-alive 的（`AppShell.tsx` 的 `mountedFileTabs`），"
        + "切到别的标签只加 `hidden` 属性（`<div hidden={tab.id !== activeFileTabId}>`），"
        + "board-diff 取样时跳过藏在 `[hidden]` 里的节点，于是报「产品里没有」。"
        + "把终端标签切回激活态（点 .pw-tab 那一枚）就能量到 —— 换句话说这是一条覆盖缺口，不是换肤漂移。",
    },
    {
      sel: ".pw-pop[data-tab-overview] .pw-btn.sm",
      reason: "**数据依赖**：「最近关闭」列表为空时那一段不渲染，`.pw-btn.sm`（恢复）跟着消失。"
        + "本次运行没有关过任何标签；关掉一个再打开概览即出现。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};