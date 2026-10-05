// 转录族 spec 的跑法（会话走 APP_URL，冷启动时侧栏不渲染会话行，点不出来）：
//   APP_URL="http://127.0.0.1:30141/?session=01a1072d-8cf2-70ad-a269-00c3f5ebf799" \
//     node scripts/struct-diff.mjs scripts/struct-specs/<this file>
// SESSION 是一条内容够全的真实会话（1318 条消息：工具调用 / 思考 / 代码块 /
// markdown 全块 / 文件 chips 都在里面）。
const IGNORE = ["d-grow"];

// D-03b 帧 C · 代码块（语言标签 + 复制；体里带 `.d-ln` 行号）。
export default {
  name: "D-03b 帧C · 代码块",
  board: "v5/web/boards/D-03b-transcript-content.html",
  boardRoot: ".d-chat-inner > .d-code",
  app: { script: `await new Promise(r => setTimeout(r, 6000));` },
  appRoot: ".d-md .d-code",
  ignore: IGNORE,
  maxRows: 30,
};
