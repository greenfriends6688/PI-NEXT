// 画板 01 工作台 —— 帧 A（新会话空态）
//
// 注意：board-diff 里 `pairs` 一旦给出就**替换**整个比较清单（`pairs ?? selectors.map(...)`），
// 所以这里把同名类和不同名宿主都写进 pairs，不再用 selectors。
// fork:v5-old-layer（2026-10-04）—— 画板侧仍是 v1 的 pw-*，**产品侧**已换 v5 类。
// 这里只登记等价映射，选择器不删、也不标 skip：对照的两端都必须还能选中元素。
//
//   .pw-side-head      → SessionSidebar.tsx:1813  d-side-head
//   .pw-brand          → :1814 d-brand-lockup
//   .pw-side-nav/.pw-row → :1873 d-side-nav / :1880 d-row
//   .pw-seg            → :1889 d-seg（项目 / 聊天切换）
//   .pw-side-scroll    → :1950 d-side-scroll
//   .pw-group-title    → :472 / :516 d-group-title
//   .pw-side-foot      → AppShell.tsx:2181 d-side-foot
//   .pw-topbar         → AppShell.tsx:3129 main-workspace-header d-topbar
//   .pw-tb-title       → :2532 d-tb-title
//   .pw-empty/-inner   → AppShell.tsx:3368 d-empty / d-empty-s
//   .pw-starters/-starter → EmptyStateGuide.tsx:130/133 d-starters / d-starter
//   .pw-composer*      → ChatInput.tsx:3777/3825/3957 d-composer / -top / -bar
//   .pw-select         → ChatInput.tsx:4984 d-select
//   .pw-send           → :3120 d-send
const APP = {
  ".pw-side": ".sidebar-container.d-side",
  ".pw-side-head": ".d-side-head",
  ".pw-side-head .pw-brand": ".d-side-head .d-brand-lockup",
  ".pw-side-nav": ".d-side-nav",
  ".pw-side-nav .pw-row": ".d-side-nav .d-row",
  ".pw-seg": ".d-seg",
  ".pw-side-scroll": ".d-side-scroll",
  ".pw-group-title": ".d-group-title",
  ".pw-side-foot": ".d-side-foot",
  ".pw-topbar": ".main-workspace-header.d-topbar",
  ".pw-tb-title": ".d-tb-title",
  ".pw-empty": ".d-empty",
  ".pw-empty-inner": ".d-empty-s",
  ".pw-starters": ".d-starters",
  ".pw-starter": ".d-starter",
  ".pw-starter b": ".d-starter b",
  ".pw-composer": ".chat-input-shell.d-composer",
  ".pw-composer-top": ".chat-input-editor-row.d-composer-top",
  ".pw-composer-bar": ".chat-input-toolbar.d-composer-bar",
  ".pw-select": ".d-select",
  ".pw-send": ".d-send",
};

const SAME = [
  ".pw-side",
  ".pw-side-head",
  ".pw-side-head .pw-brand",
  ".pw-side-nav",
  ".pw-side-nav .pw-row",
  ".pw-seg",
  ".pw-side-scroll",
  ".pw-group-title",
  ".pw-side-foot",
  ".pw-topbar",
  ".pw-tb-title",
  ".pw-empty",
  ".pw-empty-inner",
  ".pw-starters",
  ".pw-starter",
  ".pw-starter b",
  ".pw-composer",
  ".pw-composer-top",
  ".pw-composer-bar",
  ".pw-select",
  ".pw-send",
];

export default {
  name: "工作台（画板 01 · 帧 A 新会话）",
  board: "01-workbench.html",
  boardFrame: 0,
  app: { open: "new-session" },
  pairs: [
    ...SAME.map((sel) => [sel, APP[sel] ?? sel]),
    // 画板里的静态件 ↔ 产品里的同名宿主（选择器不同名时走 pairs）
    [".pw-composer-bar .pw-iconbtn", ".chat-input-toolbar .d-iconbtn"],
    [".pw-composer-bar", ".chat-input-toolbar"],
  ],
  knownDiffs: [
    {
      sel: ".d-empty",
      reason: "产品给空态加了 padding 32/16 + overflow-y:auto（place-items:center 下居中位置不变，"
        + "窄屏滚动用），画板是纯 0 内边距容器 —— 登记不改。",
    },
    {
      sel: ".chat-input-shell.d-composer",
      reason: "产品多一个「拖动调整高度」句柄（.chat-input-resize-handle），外壳必须是 flex 列容器；"
        + "画板是静态 block。外观值（面板底/发丝线/radius-6/阴影/800×88）逐项一致。",
    },
    {
      sel: ".chat-input-editor-row.d-composer-top",
      reason: "产品在同一格里叠了高亮层 + textarea（.chat-input-editor-row = flex + gap 8），"
        + "画板是单层 block 文本。内边距 12/12/6 与最小高 46 一致。",
    },
    {
      sel: ".chat-input-toolbar.d-composer-bar",
      reason: "产品右端多了窄屏「更多控件」溢出位；内边距 6/8/6/12 与 gap 4 一致。",
    },
    {
      sel: ".chat-input-toolbar .d-iconbtn",
      reason: "画板 .pw-iconbtn 是裸 <button>（带 UA 的 1px 6px 内边距与 13.33px 字号），"
        + "产品按 §4.1 把 button 的 UA 值归零 —— 只差 UA 层，盒子 24×24 与图标居中一致。",
    },
    {
      sel: ".chat-input-toolbar",
      reason: "同 .pw-composer-bar：产品右端多一个窄屏溢出位。",
    },
    {
      sel: ".main-workspace-header.d-topbar",
      reason: "右内边距 28 = 让位给右栏边界的面板开关（.desktop-secondary-workspace-toggle，"
        + "绝对定位在顶栏右端，画板里这枚钮是顶栏内最后一个子元素）—— 视觉终点同一个位置。",
    },
    {
      sel: ".d-select",
      reason: "**接线**：产品每个下拉芯片外面套一层 `position: relative` 锚点 div（浮窗要相对它定位），"
        + "于是芯片不再是 flex 的直接子元素、display 停在 inline-flex（与画板同值，blockification "
        + "链不同）；盒子 24 高、padding 0/7、gap 4、圆角逐项一致。",
    },
  ],
};
