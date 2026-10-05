/* D-04 帧 C —— 队列面板（画板帧 C 的 `.d-queue`）。
 * 队列是**运行中**的瞬时状态：只有 `queuedMessages` 非空才渲染，且产品没有「暂停队列」
 * 那一档（见汇报）。这一帧要人先把一条消息排进去才比得了，脚本里做不出来 ——
 * 没有 steering hook 的测试口，所以默认比不到；见汇报。
 */
import { waitFor } from "./_d04.mjs";

export default {
  name: "D-04 帧 C · 队列面板",
  board: "v5/web/boards/D-04-composer.html",
  frame: 2,
  boardRoot: "section.d-scene:nth-of-type(3) .d-queue",
  app: {
    script: `
      ${waitFor(".chat-input-shell.d-composer", { retries: 60 })}
    `,
  },
  appRoot: ".d-queue",
  ignore: ["d-grow"],
  maxRows: 40,
};
