// D-01 帧 A · 新会话空态（品牌标 + 标题 + 副行）
export default {
  name: "D-01 帧A 空态",
  board: "v5/web/boards/D-01-workbench.html",
  boardRoot: ".d-empty",
  app: { script: `document.querySelector(".d-side-nav .d-row")?.click(); await new Promise(r => setTimeout(r, 1400));` },
  appRoot: ".d-chat > .d-chat-inner > .d-empty",
  maxRows: 20,
};
