/* D-04 帧 C —— 运行中的输入卡（画板帧 C 的 `.d-composer.d-loader`）。
 * 产品侧 `.d-loader` / `.d-loader-glow` / `.d-loader-svg` 三个节点要 `isStreaming`
 * 才在，首页自动恢复了上一次会话时能看到，否则这一帧只能比静息形态。
 */
import { waitFor } from "./_d04.mjs";

export default {
  name: "D-04 帧 C · 运行中输入卡",
  board: "v5/web/boards/D-04-composer.html",
  frame: 2,
  boardRoot: "section.d-scene:nth-of-type(3) .d-composer",
  app: { script: `${waitFor(".chat-input-shell.d-composer")}` },
  appRoot: ".chat-input-shell.d-composer",
  ignore: ["d-grow"],
  maxRows: 40,
};
