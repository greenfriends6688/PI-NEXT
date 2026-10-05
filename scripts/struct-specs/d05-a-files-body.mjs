// D-05 帧 A · 文件面板体（`.d-panel-body` 整段：筛选条 / 副头 / 动作条 / 树 / 脚注）。
//
// 板侧的树有 14 行、工作区里的树只有几行，逐行比会被「行数差」淹没：
// 尾部成片 MISSING 是数据差不是结构差，行本身另有一条 spec（d05-a-tree-row）量。
import { OPEN_PANEL } from "./_lib.mjs";
export default {
  name: "D-05 帧 A · 文件面板体",
  board: "v5/web/boards/D-05-right-panels.html",
  frame: 0,
  boardRoot: '.d-scene:nth-of-type(1) .d-panel-body[data-demo-pane="files"]',
  app: { script: OPEN_PANEL },
  appRoot: ".file-explorer-section > .d-panel-body",
  maxRows: 45,
};