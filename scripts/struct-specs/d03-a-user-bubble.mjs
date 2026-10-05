// 转录族 spec 的跑法（会话走 APP_URL，冷启动时侧栏不渲染会话行，点不出来）：
//   APP_URL="http://127.0.0.1:30141/?session=01a1072d-8cf2-70ad-a269-00c3f5ebf799" \
//     node scripts/struct-diff.mjs scripts/struct-specs/<this file>
// SESSION 是一条内容够全的真实会话（1318 条消息：工具调用 / 思考 / 代码块 /
// markdown 全块 / 文件 chips 都在里面）。
const IGNORE = ["d-grow"];

// D-03b 帧 A1 · 用户气泡（贴右 + 强调底；正文是 `.d-md`）。
// D-03 帧 A 那一格是裸文字（板上的简化画法），D-03b 帧 A1 才是产品的形态：
// 产品要把用户消息走 markdown（@ 文件 / /skill 高亮），所以抄带 `.d-md` 的那一帧。
export default {
  name: "D-03b 帧A1 · 用户气泡",
  board: "v5/web/boards/D-03b-transcript-content.html",
  boardRoot: 'section[data-demo-pane="u1"] .d-msg-user',
  app: { script: `await new Promise(r => setTimeout(r, 6000));` },
  appRoot: "[data-message-role='user'] > div > .d-msg-user:has(.d-md):not(:has(.d-placeholder))",
  ignore: IGNORE,
  maxRows: 20,
};
