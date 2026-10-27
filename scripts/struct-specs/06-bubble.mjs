// 06 用户气泡：板侧 parts/06-bubble.html 的 .bubble，产品侧一条用户消息的气泡。
// 已知：产品气泡里是 markdown 渲染出来的 <p>，板上是裸文本（不计为偏差）。
export default {
  name: "06 用户气泡",
  board: "parts/06-bubble.html",
  boardRoot: ".bubble",
  appUrl: "http://127.0.0.1:30141/?session=01a16df7-be77-7480-964b-41159805256c",
  appRoot: ".message-user-bubble",
  settleMs: 7000,
  viewport: { width: 1440, height: 900 },
};
