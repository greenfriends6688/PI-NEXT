// M-02 帧 A —— **过程摘要**（用户验收重点：过程默认折叠成一行 `m-tool`，不是逐条平铺）。
import { OPEN_SESSION } from "./_open.mjs";
export default {
  name: "M-02 帧 A · 过程摘要（默认折叠成一行）",
  board: "v5/pwa/boards/M-02-transcript.html",
  frame: 0,
  boardRoot: ".m-scene:nth-of-type(1) .m-tool-head",
  app: { script: OPEN_SESSION },
  appRoot: ".m-tool > .m-tool-head",
  viewport: { width: 390, height: 844 },
  // 残留的那 1 条 TAG 是手册 §1 明确允许的一档：板上是静态件（div），产品里这一行
  // 可点（点开 / 收起过程），按铁律一换标签但**类名保持 `.m-tool-head` 不变**。
  maxRows: 20,
};
