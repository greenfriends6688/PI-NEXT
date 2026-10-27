// 21 输入区：板 web-running 帧 A 的 `.composer` ↔ 产品 `.composer`。
// 板 = `.composer__text` + `.composer__bar`；产品目前是 `.chat-input-card` + textarea。
export default {
  name: "21 输入区",
  board: "boards/web-running.html",
  boardRoot: '[data-v5="D-02-sidebar-topbar/A"] .composer',
  appUrl: "http://127.0.0.1:30141/",
  appRoot: ".composer",
  settleMs: 2500,
  viewport: { width: 1440, height: 900 },
  ignore: ["caret", "spacer"],
  // 已收敛的部分：`.composer > .composer__text + .composer__bar`、bar 第一个孩子是
  // `button.composer__plus`（sprite 图标）。剩下的是「产品必须多出来的东西」：
  knownDiffs: [
    { kind: "TAG", why: "板的写字行是 span + i.caret；产品必须是真 textarea（且裹一层 .chat-input-card）" },
    { kind: "TAG", why: "板的模型 chip 是 bar 的直接子节点；产品要一层 .model-selector 做浮层锚点" },
    { kind: "EXTRA", why: "产品 bar 右侧还有思考/工具档/压缩/提示音四个钮，画板帧 A 只画了 chip+ring+send" },
  ],
};
