/* D-04 帧 A —— 上下文环浮窗（画板 `m-ctx`）。
 * 环只在有 `contextUsage` / `sessionStats` 的会话里出现；首页自动恢复不了上一次会话时
 * 这一帧比不了（见汇报）。
 */
import { waitFor } from "./_d04.mjs";

export default {
  name: "D-04 帧 A · 上下文环浮窗",
  board: "v5/web/boards/D-04-composer.html",
  frame: 0,
  boardRoot: '[data-demo-pop="m-ctx"]',
  app: {
    script: `
      ${waitFor(".composer-ring button.d-ring")}
      const r = document.querySelector(".composer-ring button.d-ring");
      if (r) r.click();
    `,
  },
  appRoot: ".composer-ring-pop",
  ignore: [],
  maxRows: 40,
};
