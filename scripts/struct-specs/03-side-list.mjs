// 03 侧栏列表：板侧 parts/03-side-list.html 的 .side__list（分区头 + 项目行 + 会话行），
// 产品侧整个会话树滚动区。这是目前偏差最大的一块，也是 V5 D-02 里最丰富的一段。
export default {
  name: "03 侧栏列表",
  board: "parts/03-side-list.html",
  boardRoot: ".side__list",
  appUrl: "http://127.0.0.1:30141/?session=01a16df7-be77-7480-964b-41159805256c",
  appRoot: ".session-tree-inner",
  settleMs: 8000,
  viewport: { width: 1440, height: 900 },
};
