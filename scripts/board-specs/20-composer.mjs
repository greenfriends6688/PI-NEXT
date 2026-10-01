// 画板 20 输入框 —— 帧 A（空闲 / 流式中 / 无项目）
//
// 「输入框与画板差在哪」的第一份可跑规格：壳三段 `.pw-composer` /
// `.pw-composer-top` / `.pw-composer-bar` 的节奏与工具条控件。
// 同行参考：`01-workbench-a.mjs`（工作台整屏里也覆盖了壳三段，两边结论一致）。
//
// 画板这一帧是「三段各自一个样张」，同名的第一个 `.pw-composer` 就是空闲态那个；
// 产品打开新会话时也是空闲态。
const SAME = [
  ".pw-composer",
  ".pw-composer-top",
  ".pw-composer-bar",
  ".pw-select",
  ".pw-send",
];

export default {
  name: "输入框（画板 20 · 帧 A 空闲）",
  board: "20-composer.html",
  boardFrame: 0,
  app: { open: "new-session" },
  pairs: [
    ...SAME.map((s) => [s, s]),
    // 画板样张的工具条是 `.pw-composer-bar` 本身（控件是它的直接子元素）；
    // 产品的控件分组在 `.chat-input-toolbar` 的子组里，两边取同一个角色。
    [".pw-composer-bar .pw-iconbtn", ".pw-composer-bar .pw-iconbtn"],
  ],
  knownDiffs: [
    {
      sel: ".pw-composer",
      reason: "产品多一个「拖动调整高度」句柄（.chat-input-resize-handle），外壳必须是 flex 列容器；"
        + "画板是静态 block。外观值（面板底/发丝线/radius-6/阴影/800×88）逐项一致。",
    },
    {
      sel: ".pw-composer-top",
      reason: "产品在这一行里叠了高亮层（.chat-input-highlight + textarea）并在窄屏转列，"
        + "所以是 flex + gap 8 + flex-start；画板是纯文本 block。单行之内的文字起点"
        + "（padding 12/12/6、min-height 46）逐项一致。",
    },
    {
      sel: ".pw-select",
      reason: "**接线**：产品每个下拉芯片外面套一层 `position: relative` 锚点 div（浮窗要相对它定位，"
        + "画板把按钮与浮窗画成两个独立样张），于是芯片不再是 flex 的直接子元素、display 保留 "
        + "inline-flex（blockification 链不同）；盒子 24 高、padding 0/7、gap 4、圆角逐项一致。",
    },
    {
      sel: ".pw-ring",
      reason: "**数据依赖**：上下文环要有上下文占用才出现，新会话（空闲态）不渲染。"
        + "画板帧画的是有占用时的样子；打开一条有消息的会话才量得到。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};
