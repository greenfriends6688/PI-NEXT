// 转录族 spec 的跑法（会话走 APP_URL，冷启动时侧栏不渲染会话行，点不出来）：
//   APP_URL="http://127.0.0.1:30141/?session=01a1072d-8cf2-70ad-a269-00c3f5ebf799" \
//     node scripts/struct-diff.mjs scripts/struct-specs/<this file>
// SESSION 是一条内容够全的真实会话（1318 条消息：工具调用 / 思考 / 代码块 /
// markdown 全块 / 文件 chips 都在里面）。
const IGNORE = ["d-grow"];

// D-03 帧 A · 助手消息的动作行（悬浮显现的那一行）。
export default {
  name: "D-03 帧A · 助手动作行",
  board: "v5/web/boards/D-03-transcript.html",
  boardRoot: ".d-msg-ai .d-msg-acts",
  app: {
    script: `
      const msg = document.querySelector("[data-message-role='assistant'] .d-msg-acts");
      if (msg) msg.classList.add("is-on");
      await new Promise(r => setTimeout(r, 200));
    `,
  },
  appRoot: ".d-msg-ai > .d-msg-acts",
  ignore: IGNORE,
  maxRows: 20,
};
