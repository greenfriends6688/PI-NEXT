/* D-04 帧 A —— 思考强度浮层（画板 `m-think`）。
 * 触发器 = 工具条「模式」组三枚 `.d-select` 里的第 1 枚（思考 / 权限 / 工具）。
 */
import { waitFor } from "./_d04.mjs";

export default {
  name: "D-04 帧 A · 思考强度浮层",
  board: "v5/web/boards/D-04-composer.html",
  frame: 0,
  boardRoot: '[data-demo-pop="m-think"]',
  app: {
    script: `
      ${waitFor(".chat-input-toolbar .fork-pwa-wb-modes > div > button.d-select")}
      document
        .querySelectorAll(".d-composer-bar .fork-pwa-wb-modes > div > button.d-select")[0]
        .click();
    `,
  },
  appRoot: ".chat-input-toolbar .d-pop",
  ignore: [],
  maxRows: 40,
};
