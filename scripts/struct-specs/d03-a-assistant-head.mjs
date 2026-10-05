// 转录族 spec 的跑法（会话走 APP_URL，冷启动时侧栏不渲染会话行，点不出来）：
//   APP_URL="http://127.0.0.1:30141/?session=01a1072d-8cf2-70ad-a269-00c3f5ebf799" \
//     node scripts/struct-diff.mjs scripts/struct-specs/<this file>
// SESSION 是一条内容够全的真实会话（1318 条消息：工具调用 / 思考 / 代码块 /
// markdown 全块 / 文件 chips 都在里面）。
const IGNORE = ["d-grow"];

// D-03 帧 A · 助手消息的身份行（品牌头像 + 产品名 + 模型徽章）。
// 板面每一条 `.d-msg-ai` 的第一块都是它；产品此前桌面侧完全没有这一行
// （只有 PWA 分支有），所以这一帧就是「MISSING = 新增内容」的基准。
export default {
  name: "D-03 帧A · 助手身份行",
  board: "v5/web/boards/D-03-transcript.html",
  boardRoot: ".d-msg-ai-head",
  app: { script: `await new Promise(r => setTimeout(r, 6000));` },
  appRoot: ".d-msg-ai > .d-msg-ai-head",
  ignore: IGNORE,
  maxRows: 20,
};
