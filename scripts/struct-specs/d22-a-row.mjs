// D-22 帧 A —— 单条命中行的形状（`.d-cmd-row` 整块）。列表条数随真实数据变，
// 整页逐节点比会被条数错位淹没，所以这一帧拆成「壳 + 单行」两段分别收敛。
export default {
  name: "D-22 命令中心 · 帧 A 命中行",
  board: "v5/web/boards/D-22-command-center.html",
  boardRoot: '.d-scene:nth-of-type(1) [data-demo-pane="all"] > .d-cmd-row.is-on',
  app: {
    script: `
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
      await new Promise(r => setTimeout(r, 1200));
    `,
  },
  appRoot: ".d-cmd-results .d-cmd-row.is-on",
  maxRows: 20,
};
