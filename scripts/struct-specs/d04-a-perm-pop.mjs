/* D-04 帧 A —— 权限档浮层（画板 `m-perm`）。触发器 = 模式组第 2 枚。 */
import { waitFor } from "./_d04.mjs";

export default {
  name: "D-04 帧 A · 权限档浮层",
  board: "v5/web/boards/D-04-composer.html",
  frame: 0,
  boardRoot: '[data-demo-pop="m-perm"]',
  app: {
    script: `
      ${waitFor(".chat-input-toolbar .fork-pwa-wb-modes > div > button.d-select")}
      document
        .querySelectorAll(".d-composer-bar .fork-pwa-wb-modes > div > button.d-select")[1]
        .click();
    `,
  },
  appRoot: ".chat-input-toolbar .d-pop",
  ignore: [],
  maxRows: 40,
};
