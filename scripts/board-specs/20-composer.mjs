// 画板 20 输入框 —— 帧 A（空闲 / 流式中 / 无项目）
//
// 「输入框与画板差在哪」的第一份可跑规格：壳三段 `.pw-composer` /
// `.pw-composer-top` / `.pw-composer-bar` 的节奏与工具条控件。
// 同行参考：`01-workbench-a.mjs`（工作台整屏里也覆盖了壳三段，两边结论一致）。
//
// 画板这一帧是「三段各自一个样张」，同名的第一个 `.pw-composer` 就是空闲态那个；
// 产品打开新会话时也是空闲态。
// fork:v5-old-layer（2026-10-04）—— 产品侧已换 v5（ChatInput.tsx:3777/3825/3957/
// 4984/3120）：`.chat-input-shell.d-composer` / `.chat-input-editor-row.d-composer-top`
// / `.chat-input-toolbar.d-composer-bar` / `.d-select` / `.d-send`。
// 画板侧仍取 v1 的 pw-*，两边逐条对照，不删条目也不标 skip。
const SAME = [
  [".pw-composer", ".chat-input-shell.d-composer"],
  [".pw-composer-top", ".chat-input-editor-row.d-composer-top"],
  [".pw-composer-bar", ".chat-input-toolbar.d-composer-bar"],
  [".pw-select", ".d-select"],
  [".pw-send", ".d-send"],
];

export default {
  name: "输入框（画板 20 · 帧 A 空闲）",
  board: "20-composer.html",
  boardFrame: 0,
  app: { open: "new-session" },
  pairs: [
    ...SAME,
    // 画板样张的工具条是 `.pw-composer-bar` 本身（控件是它的直接子元素）；
    // 产品的控件分组在 `.chat-input-toolbar` 的子组里，两边取同一个角色。
    [".pw-composer-bar .pw-iconbtn", ".chat-input-toolbar .d-iconbtn"],
  ],
  knownDiffs: [
    {
      sel: ".chat-input-shell.d-composer",
      reason: "产品多一个「拖动调整高度」句柄（.chat-input-resize-handle），外壳必须是 flex 列容器；"
        + "画板是静态 block。外观值（面板底/发丝线/radius-6/阴影/800×88）逐项一致。",
    },
    {
      sel: ".chat-input-editor-row.d-composer-top",
      reason: "产品在这一行里叠了高亮层（.chat-input-highlight + textarea）并在窄屏转列，"
        + "所以是 flex + gap 8 + flex-start；画板是纯文本 block。单行之内的文字起点"
        + "（padding 12/12/6、min-height 46）逐项一致。",
    },
    {
      sel: ".d-select",
      reason: "**接线**：产品每个下拉芯片外面套一层 `position: relative` 锚点 div（浮窗要相对它定位，"
        + "画板把按钮与浮窗画成两个独立样张），于是芯片不再是 flex 的直接子元素、display 保留 "
        + "inline-flex（blockification 链不同）；盒子 24 高、padding 0/7、gap 4、圆角逐项一致。",
    },
    {
      sel: ".pw-ring",
      reason: "**数据依赖**：上下文环要有上下文占用才出现（产品是 ChatInput.tsx:3077 的 "
        + "`.d-ring`），新会话（空闲态）不渲染。画板帧画的是有占用时的样子；"
        + "打开一条有消息的会话才量得到。这条 knownDiff 本来就没有对应的 pair"
        + "（画板侧 `.pw-ring` 不在 SAME 里），留着是为了登记这个数据依赖。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};
