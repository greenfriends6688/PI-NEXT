// 画板 10 转录正文 —— 帧 A（用户气泡 / 操作行）
//
// 气泡与操作行是「按钮和位置对不上」最常被指到的两处，所以单独一份规格。
// 数据来自种子会话（verify-boards-live 的 PI_CODING_AGENT_DIR）。
//
// 注意 `.pw-quote` **不在这份里比**：画板自己有两套引用样式 —— 独立原子
// `.pw-quote`（board.css:271，padding-left 8）与 `.pw-md blockquote`（board.css:298，
// padding 2/0/2/10）。画板的用户气泡样张走前者，产品的引用块只从 markdown 出来、
// 走后者。两边都照画板做了，硬比就是拿两种上下文当同一种。
const SAME = [".pw-msg-user", ".pw-msg-acts"];

export default {
  name: "转录正文（画板 10 · 帧 A 用户气泡）",
  board: "10-transcript-text.html",
  boardFrame: 0,
  app: { open: "session:first" },
  pairs: SAME.map((s) => [s, s]),
  knownDiffs: [
    {
      sel: ".pw-msg-user",
      reason: "**产品有意为之**：聊天正文基准字号是 14px（globals.css 的 `--chat-content-font-size`，"
        + "注释写明「Zeno 的转录是正文尺寸，聊天是唯一值得多一个像素的地方」），画板样张是 13px 的 "
        + "`--text-body`；行高跟着字号走（1.65 → 23.1px）。盒子（78% / padding 8-12 / "
        + "发丝边框 / radius-6 / 面板底）逐项一致。要改回 13 是产品决策，不是接线。",
    },
  ],
  tolerance: { box: 2, fontSize: 0 },
};
