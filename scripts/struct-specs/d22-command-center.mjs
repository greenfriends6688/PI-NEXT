// D-22 命令中心 · 帧 A/B/C —— 板面 `.d-cmd.is-open` vs 产品真实 DOM。
// 三帧逐帧比；板侧 selector 用 `.d-scene:nth-of-type(n)` 定位到具体那一帧。
export default {
  name: "D-22 命令中心 · 帧 A 默认",
  board: "v5/web/boards/D-22-command-center.html",
  boardRoot: ".d-scene:nth-of-type(1) .d-cmd",
  app: {
    script: `
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
      await new Promise(r => setTimeout(r, 900));
    `,
  },
  ignore: ["d-grow"],
  appRoot: ".d-cmd",
  maxRows: 40,
};