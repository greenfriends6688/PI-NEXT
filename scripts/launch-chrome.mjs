// 画板类脚本共用：启动浏览器。
//
// board-diff / check-align / verify-against-boards 一律优先**真 Chrome**：
// 画板 PNG 基线、图标对齐都是用真 Chrome 渲的，捆绑 Chromium 的字体度量略有差别。
// 回退是因为 CI（ubuntu-latest 的 e2e job）只装 playwright 的 chromium，
// `channel: "chrome"` 会直接抛错 —— 同一条命令要能同时在本地与 CI 跑；
// 两个都没有时仍然报错（不吞）。
import { chromium } from "playwright";

export function launchChrome() {
  return chromium.launch({ channel: "chrome" }).catch((error) => {
    if (process.env.CI) console.log(`（真 Chrome 启动失败，回退捆绑 Chromium：${error.message.split("\n")[0]}）`);
    return chromium.launch();
  });
}
