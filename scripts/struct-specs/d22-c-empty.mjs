// D-22 帧 C —— 空态那块（`.d-cmd-tabs` + `.d-empty` 兄弟段单独比，避免样例数据条数干扰）。
export default {
  name: "D-22 命令中心 · 帧 C 页签行 + 空态",
  board: "v5/web/boards/D-22-command-center.html",
  boardRoot: ".d-scene:nth-of-type(3) .d-cmd-tabs",
  app: {
    script: `
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
      await new Promise(r => setTimeout(r, 900));
      const input = document.querySelector(".d-cmd-input input");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "zzzz-no-such-thing");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise(r => setTimeout(r, 1400));
    `,
  },
  ignore: ["d-grow"],
  appRoot: ".d-cmd-tabs",
  maxRows: 20,
};
