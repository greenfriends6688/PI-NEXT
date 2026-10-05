// D-22 帧 A —— 「前缀即语法」浮层（`.d-pop`）。产品里常驻 DOM、用 hidden 开关。
export default {
  name: "D-22 命令中心 · 帧 A 前缀语法浮层",
  board: "v5/web/boards/D-22-command-center.html",
  boardRoot: ".d-scene:nth-of-type(1) .d-cmd .d-pop",
  app: {
    script: `
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
      await new Promise(r => setTimeout(r, 900));
    `,
  },
  appRoot: ".d-cmd .d-pop",
  maxRows: 20,
};
