// D-22 帧 C —— 空态本体（`.d-cmd-results > .d-empty`）。
export default {
  name: "D-22 命令中心 · 帧 C 空态",
  board: "v5/web/boards/D-22-command-center.html",
  boardRoot: ".d-scene:nth-of-type(3) .d-empty",
  app: {
    script: `
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
      await new Promise(r => setTimeout(r, 900));
      const input = document.querySelector(".d-cmd-input input");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(input, "zzzz-no-such-thing");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise(r => setTimeout(r, 1600));
    `,
  },
  appRoot: ".d-cmd-results .d-empty",
  maxRows: 20,
};
