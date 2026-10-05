// 结构比对冒烟：M-02 帧 A 的过程摘要 vs 产品转录。
export default {
  name: "M-02 手机转录 · 过程摘要",
  board: "v5/pwa/boards/M-02-transcript.html",
  frame: 0,
  boardRoot: ".m-phone-inner",  // 板侧第一处 .m-phone-inner（M-02 帧 A 的机身内容）
  app: {
    script: `
      const rows = [...document.querySelectorAll(".d-sess, .m-row")];
      const last = rows[rows.length - 1];
      if (last) { last.click(); await new Promise(r => setTimeout(r, 3200)); }
    `,
  },
  appRoot: ".m-workspace, .chat-slot",
  ignore: ["d-grow", "m-grow"],
  maxRows: 25,
};