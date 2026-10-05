/* D-04 帧 A —— 模型选择浮层（画板 `m-model`）。 */
import { waitFor } from "./_d04.mjs";

export default {
  name: "D-04 帧 A · 模型选择浮层",
  board: "v5/web/boards/D-04-composer.html",
  frame: 0,
  boardRoot: '[data-demo-pop="m-model"]',
  app: {
    script: `
      ${waitFor(".model-selector.is-toolbar button.d-select", { retries: 60 })}
      const trigger = document.querySelector(".model-selector.is-toolbar button.d-select");
      if (trigger) trigger.click();
    `,
  },
  appRoot: ".model-selector .d-pop",
  ignore: [],
  maxRows: 40,
};
