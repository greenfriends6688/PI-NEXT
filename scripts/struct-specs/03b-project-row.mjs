// 03b 项目行：板侧 `.srow`（文件夹徽标 + 名称 + 计数 + 右侧数字），
// 产品侧目前是 `.session-tree-group`（chevron + 名字 + 计数）。这是"板上有、产品没有"最典型的一段。
export default {
  name: "03b 项目行",
  board: "parts/03-side-list.html",
  boardRoot: ".srow:not(.is-sub):not(.is-sel)",
  appUrl: "http://127.0.0.1:30141/?session=01a16df7-be77-7480-964b-41159805256c",
  appRoot: ".session-tree-group",
  settleMs: 8000,
  viewport: { width: 1440, height: 900 },
};
