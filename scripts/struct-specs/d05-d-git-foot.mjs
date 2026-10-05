// D-05 帧 D · Git 面板体脚注（`.d-pop-foot`）：面板只做「看」的那句边界。
import { OPEN_PANEL } from "./_lib.mjs";
export default {
  name: "D-05 帧 D · Git 面板脚注",
  board: "v5/web/boards/D-05-right-panels.html",
  frame: 4,
  boardRoot: '.d-scene:nth-of-type(5) .d-panel-body[data-demo-pane="git"] > .d-pop-foot',
  app: { script: `${OPEN_PANEL}
    const git = document.querySelector(".main-workspace-header .fork-panel-head-act");
    if (git) { git.click(); await new Promise((r) => setTimeout(r, 2000)); }
  ` },
  appRoot: ".file-panel-main .d-pop-foot",
  maxRows: 10,
};
