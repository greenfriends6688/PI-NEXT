// D-22 帧 A —— 页签行（`.d-cmd-tabs`，含右端那颗语法说明钮）。
export default {
  name: "D-22 命令中心 · 帧 A 页签行",
  board: "v5/web/boards/D-22-command-center.html",
  boardRoot: ".d-scene:nth-of-type(1) .d-cmd-tabs",
  app: {
    script: `
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
      await new Promise(r => setTimeout(r, 1000));
    `,
  },
  appRoot: ".d-cmd-tabs",
  ignore: ["d-grow"],
  maxRows: 20,
};
