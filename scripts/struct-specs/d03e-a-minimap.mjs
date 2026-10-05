// 转录族 spec 的跑法（会话走 APP_URL，冷启动时侧栏不渲染会话行，点不出来）：
//   APP_URL="http://127.0.0.1:30141/?session=01a1072d-8cf2-70ad-a269-00c3f5ebf799" \
//     node scripts/struct-diff.mjs scripts/struct-specs/<this file>
// SESSION 是一条内容够全的真实会话（1318 条消息：工具调用 / 思考 / 代码块 /
// markdown 全块 / 文件 chips 都在里面）。
const IGNORE = ["d-grow"];

// D-03e 帧 A · 转录迷你地图导轨（36px 导轨：节点 + 针 + 编号）。
export default {
  name: "D-03e 帧A · 迷你地图导轨",
  board: "v5/web/boards/D-03e-transcript-nav.html",
  boardRoot: ".d-minimap",
  app: { script: `await new Promise(r => setTimeout(r, 6000));` },
  appRoot: ".d-minimap",
  ignore: IGNORE,
  maxRows: 30,
};
