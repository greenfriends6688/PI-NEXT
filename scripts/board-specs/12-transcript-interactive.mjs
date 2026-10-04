// 画板 12 交互类卡片 —— 转录里的卡片原子（工具卡 / 回合结束行 / 浮窗行）
//
// 为什么不用 boardFrame 锁某一帧：画板 12 是**一叠卡片样张**（7 帧 = 权限卡 /
// 计划+压缩卡 / 内容块 / 回合结束行 / 状态条 / 壳级状态 / 动效），每帧里的
// `.pw-card` `.pw-badge` `.pw-btn.sm` 都是同一个原子在换内容。逐帧拆成 7 份
// spec 会把同一批原子重复量 7 次，所以这里取整页（boardFrame 不给），
// 让 probe 取「整页里第一个该类」——两边的取法完全一样（board-diff 的
// `pick()` 就是 `querySelectorAll` 的第一个），比的是原子不是内容。
//
// app.script 干的事（照 board-diff.mjs 的 OPEN_SESSION 思路，全部带兜底、
// 找不到就跳过，不静默假设）：
//   1. 展开项目组 → 点第一条会话（种子里那条带思考 / 工具调用 / 最终回答 /
//      任务清单 / 表格 / 引用 / 代码块）；
//   2. 展开过程时间轴（回合结束后默认折起）；
//   3. 点开那一步的 `.pw-card-head` —— `.pw-card` / `.pw-card-body`（内含
//      `.pw-term`）只在工具卡**展开或报错**时才上屏（MessageView.tsx:1193
//      的 `showExpandedSurface`）；收起态那张卡把 className 置空、只留时间轴行。
//   4. 点 `.pw-tb-title` 出浮窗 —— 画板帧 0 B 的「范围下拉」那族浮窗原子
//      （`.pw-pop` / `.pw-pop-title` / `.pw-prow` / `.pw-sep`）在产品里由
//      顶栏会话切换器承担同样的渲染路径（`.pw-pop` + `.pw-prow` 行族）。
//
// ── 本 spec **没有**覆盖的画板 12 元素（原因逐条列在下方报告里，这里也留档）──
//   · `.pw-perm` / `.pw-perm-title` / `.pw-perm-body` / `.pw-perm-acts`
//     —— **产品未实现**（board.css 有样式、`grep -r "pw-perm" components app lib`
//     为空）。产品的挂起请求走画板 50 的 `.pw-modal` 对话框。这是真漂移，
//     所以不放进 pairs 也不进 knownDiffs（knownDiffs 只登记数据/状态/取景类）。
//   · `.pw-audio` —— **产品未实现**（音频走 FileViewer 的自定义播放器）。
//     同上，不登记。
//   · `.pw-term` —— 画板帧 2 E 的样张自带 `style="font-size:var(--text-meta)"`
//     （11px），产品的 `.pw-term` 是 board.css 原值 12.5px。样张自带内联覆盖，
//     拿它当原子量是量画板自己，不登记。
//   · `.pw-inline` —— 画板帧 4 B 的「Awaiting Confirmation」等待行同样自带内联
//     覆盖（gap 6 / padding 0 12 / 12px），同上。
//   · `.pw-badge` / `.pw-badge.count` 裸取 —— board.css 没给 `.pw-badge` 写
//     font-weight，它从宿主继承：画板样张落在 `.pw-perm-title`（500）里、
//     产品落在侧栏脚（400）里，差的是宿主不是徽章。改成量有确定宿主的
//     `.pw-badge.ok`（帧 3 的 stop 徽章 ↔ 过程头行的「已完成」徽章）。
//   · `.pw-iconbtn.sm` 裸取 —— 同上的继承问题（画板 12 帧 0 B 的那枚在 13px/400
//     宿主里，产品的第一枚落在 13px/500 的宿主里；画板 54 帧 0 B 的那枚又是 12px）。
//     board.css 的 `.pw-iconbtn` 只定 `width/height` 与 `.sm` 的 22×22，不定字号字重。
//   · `.pw-md` / `.pw-table` / `.pw-tasklist` / `.pw-quote` / `.pw-code-body`
//     —— 归画板 10 的 `10-transcript-md.mjs`，本板不重复量。
export default {
  name: "转录交互卡（画板 12 · 卡片原子）",
  board: "12-transcript-interactive.html",
  app: {
    settle: 1800,
    script: `
  const byIco = (root, name) => [...root.querySelectorAll('[data-ico="' + name + '"]')][0];
  // 项目组默认收着：先点箭头展开，再点第一条会话。
  if (!document.querySelector(".d-sess")) {
    const chev = byIco(document.querySelector(".d-side-scroll") ?? document, "chevron-right");
    const toggle = chev?.closest("[role=button]");
    if (toggle) { toggle.click(); await new Promise((r) => setTimeout(r, 700)); }
  }
  const row = document.querySelector(".d-sess");
  if (row) { row.click(); await new Promise((r) => setTimeout(r, 2600)); }

  // 回合结束后过程时间轴是折起的（画板 08 的折叠规则）。
  const head = document.querySelector(".d-card-head");
  if (head && head.getAttribute("aria-expanded") === "false") {
    head.click(); await new Promise((r) => setTimeout(r, 1200));
  }
  // 工具卡只有「展开 / 报错」时才上卡（MessageView.tsx: showExpandedSurface）。
  const steps = [...document.querySelectorAll(".d-step")];
  const step = steps.find((s) => /read|读取/i.test(s.textContent || "")) ?? steps[steps.length - 1];
  if (step) { step.click(); await new Promise((r) => setTimeout(r, 1200)); }
  const cardHead = document.querySelector(".pw-card-head");
  if (cardHead) { cardHead.click(); await new Promise((r) => setTimeout(r, 1200)); }

  // 画板帧 0 B 的「范围下拉」那族浮窗原子：产品里由顶栏会话切换器出同样的 DOM。
  const title = document.querySelector(".d-tb-title");
  if (title) { title.click(); await new Promise((r) => setTimeout(r, 1200)); }
`,
  },
  // fork:v5-old-layer（2026-10-04）—— 产品侧全部换成画板 D-03c/D-03d 的 v5 类；
  // 画板侧仍取 v1 的 pw-*。逐条依据：
  //   .pw-turn-end   → MessageView.tsx:1090 d-turn-end（行内三格是 .d-mono.d-t-xs）
  //   .pw-card/-head/-body → ChatWindow.tsx:587 d-card + d-card-head、d-card-body
  //   .pw-pop/-title/-prow/-sep → d-pop / d-pop-title / d-menu-row / d-sep
  //   .pw-badge.ok / .pw-btn.sm → d-badge.ok / d-btn.sm（画板帧 3 的「已完成」）
  //   .pw-todo        → TodoChip.tsx:102 d-card（条目本体是 .d-row）
  //   .pw-img         → MessageView.tsx:1878 d-placeholder（图片块）
  //   .pw-filecard    → TurnWrittenFiles.tsx:30/37 d-chips + d-cite
  pairs: [
    // 帧 3 回合结束行：行本身 / 行内徽章 / 行内发丝线
    [".pw-turn-end", ".d-turn-end"],
    [".pw-turn-end .pw-badge", ".d-turn-end .d-badge"],
    [".pw-turn-end .rule", ".d-turn-end .d-grow"],
    // 帧 1 B / 帧 2 E / 帧 4 A 共用的工具卡三件（`.pw-card` 壳 + 头 + 体）
    [".pw-card", ".d-card"],
    [".pw-card-head", ".d-card-head"],
    [".pw-card-body", ".d-card-body"],
    // 帧 3 的 success 徽章（产品侧对应过程头行的「已完成」）
    [".pw-badge.ok", ".d-badge.ok"],
    // 帧 0 A/B 的小按钮与浮窗行族
    [".pw-btn.sm", ".d-btn.sm"],
    [".pw-pop", ".d-pop"],
    [".pw-pop-title", ".d-pop-title"],
    [".pw-prow", ".d-menu-row"],
    [".pw-sep", ".d-sep"],
    // 下面这些是**内容决定**的：种子会话里没有对应内容，产品就整个不渲染。
    [".pw-compact", ".d-card:has(.d-card-head .d-mono)"],
    [".pw-toast", ".d-toast"],
    [".pw-plan", ".d-plan"],
    [".pw-todo", ".d-card:has(.fork-todo-title)"],
    [".pw-img", ".d-tool-body .d-placeholder"],
    [".pw-filecard", ".d-chips"],
    [".pw-turn-end .pw-mono", ".d-turn-end .d-mono"],
  ],
  knownDiffs: [
    {
      sel: ".d-card",
      reason:
        "**取景差异（比到的是继承字号）**：`board.css` 的 `.pw-card` 没写 font-size，"
        + "所以这一条量到的是**宿主继承来的值**。画板帧 1 B / 帧 4 A 那两张卡的可见文字"
        + "全在 `.pw-card-head` 里（board.css 固定 `--text-secondary` = 12px），帧 2 E 的"
        + "正文在样张自带内联 11px 的 `.pw-term` 里 —— 13px 这个继承值在画板样张上不落到"
        + "任何一行可见文字。产品在 MessageView.tsx:1199 给卡挂了内联 `fontSize: TEXT.sm`"
        + "（12px），于是卡体里没被 `.pw-card-head` / `.pw-term` 接管的那部分文字是 12px。"
        + "卡片真正被指定的属性（圆角 6px、padding 0、display block）两边逐项一致。"
        + "**这是产品侧的一处内联覆盖，不是 board.css 的差** —— 记在这里是为了下次有人"
        + "往卡体里直接放裸文本时能看到它。",
    },
    {
      sel: ".d-card-body",
      reason:
        "**取景差异（比到的是继承字号）**：同 `.pw-card`。`.pw-card-body` 在 board.css 里"
        + "只声明 `border-top` 与背景，没有字号，比到的是继承值（画板 13px/19.5，"
        + "产品 12px/18 —— 产品那张卡的字号来自 MessageView.tsx:1199 的内联覆盖）。"
        + "画板帧 2 E 的正文被样张的 `.pw-term`（内联 11px）接管，产品侧的等宽正文被"
        + "`.pw-term`（board.css 原值 12.5px）接管；盒模型与发丝线两边逐项一致。",
    },
    {
      sel: ".d-turn-end .d-grow",
      reason:
        "**取景差异**：`.rule` 是 `flex: 1`，宽度完全由所在行宽决定。画板整页帧宽 1440"
        + "→ 回合结束行 1440、`.rule` 1115.7；产品转录列 800 → 回合结束行 800、"
        + "`.rule` 721.3。差 394.4px 是列宽差不是组件差（板面自身的取景）。",
    },
    {
      sel: ".d-sep",
      reason:
        "**取景差异**：`.pw-sep` 没有自己的宽度，撑满所在浮窗。画板帧 0 B 的浮窗样张"
        + "内联 `width:280px` → 分隔线 258；产品顶栏会话切换器浮窗 320 → 分隔线 298。"
        + "高 1px、底色、圆角两边一致。",
    },
    {
      sel: ".d-card:has(.d-card-head .d-mono)",
      reason:
        "**数据依赖**：压缩卡只在会话里出现过 compaction 消息时才有（MessageView.tsx:1618 "
        + "的 `CompactionMessageView`）。种子会话没有压缩事件，产品整个节点不存在。",
    },
    {
      sel: ".d-toast",
      reason:
        "**状态依赖**：通知条由运行时 notice 队列驱动（ChatWindow.tsx `NoticeShelf`），"
        + "只出现在失败 / 警告 / 成功事件之后，且 6 秒自收。静态会话打开后没有 notice，"
        + "不渲染 `.pw-toast`。",
    },
    {
      sel: ".d-plan",
      reason:
        "**数据依赖**：计划卡由 `todo` 工具的 tool-result `details`（`kind: pi-web-todo`）"
        + "驱动（components/fork/TodoChip.tsx + lib/todo-state.ts）。种子会话里没有 "
        + "todo 工具结果 → `summary.total === 0` → 组件 return null，连 chip 都不渲染。",
    },
    {
      sel: ".d-card:has(.fork-todo-title)",
      reason:
        "**数据依赖**：同 `.pw-plan` —— 条目本体只在计划卡展开面板里，展开的前提是有 todo 数据。",
    },
    {
      sel: ".d-tool-body .d-placeholder",
      reason:
        "**数据依赖**：内嵌图片预览要有消息 / 工具结果里的 image 块（MessageView.tsx:1556 "
        + "的 `ResultImages`）。种子会话是纯文本 + 一个 read 工具结果，没有图片。",
    },
    {
      sel: ".d-chips",
      reason:
        "**数据依赖**：文件卡由「本轮写入的文件」或附件条目驱动（TurnWrittenFiles / "
        + "MessageView.tsx:1704）。种子会话的 read 是只读工具，不产生写入文件，也没有附件。",
    },
    {
      sel: ".d-turn-end .d-mono",
      reason:
        "**数据依赖**：回合结束行里的耗时 / token / 成本三格都来自 `message.usage` 与"
        + "「与上一条消息的时间差」（MessageView.tsx:839-850）。种子会话的 assistant "
        + "消息没有 usage 字段、相邻消息时间戳又相同，于是三格全不渲染，行里只剩徽章 + 分隔线。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};