// D-06 帧 A · 查看器外壳（`.d-viewer` + `.d-viewer-bar`：面包屑 + 模式切换）。
// 帧 A 画的是「可打开一个脚本文件看源码」；产品把 .js/.mjs 交给可编辑编辑器那一支，
// 所以这一条量的是**只读那一支**（FileViewer 的源码模式，用 .html 触发同一条外壳）。
import { OPEN_PANEL, OPEN_FILE } from "./_lib.mjs";
export default {
  name: "D-06 帧 A · 查看器头行",
  board: "v5/web/boards/D-06-file-viewer.html",
  frame: 0,
  boardRoot: '.d-scene:nth-of-type(1) .d-viewer > .d-viewer-bar',
  app: { script: `${OPEN_PANEL}${OPEN_FILE("page.html")}` },
  appRoot: ".file-panel-main .file-viewer-shell > .d-viewer-bar",
  maxRows: 30,
};
