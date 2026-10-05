/* D-04 帧 B —— `@` 提文件补全面板（画板 `m-mention`）。
 *
 * 触发方式：聚焦输入框后 `execCommand("insertText")` 打出 `@src` —— 走真输入事件，
 * React 的 onChange / updateAtQuery 与用户键入同一条路。文件索引来自
 * `?session=` 里那条内容够全的真实会话（冷启动不带会话时索引为空，补全面板只出
 * 「未找到匹配的文件」那一行）。
 *
 * APP_URL="http://127.0.0.1:30141/?session=<SESSION>" \
 *   node scripts/struct-diff.mjs scripts/struct-specs/d04-b-mention-pop.mjs
 */
import { waitFor } from "./_d04.mjs";

export default {
  name: "D-04 帧 B · @ 提及补全面板",
  board: "v5/web/boards/D-04-composer.html",
  frame: 1,
  boardRoot: '[data-demo-pop="m-mention"]',
  app: {
    script: `
      ${waitFor(".chat-input-textarea", { retries: 60 })}
      const ed = document.querySelector(".chat-input-textarea");
      if (ed) {
        ed.focus();
        document.execCommand("insertText", false, "@src");
      }
    `,
  },
  appRoot: ".d-composer-wrap > .d-pop-float",
  ignore: [],
  maxRows: 40,
};
