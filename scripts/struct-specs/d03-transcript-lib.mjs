// 转录族（D-03 / D-03b / D-03c / D-03d / D-03e）spec 共用的常量。
//
// 产品侧的会话由 APP_URL 带进去：struct-diff.mjs 先 `page.goto(APP_URL)`，而冷启动
// （不带 ?session=）时侧栏一行会话都不渲染，没法用点击选会话。所以每个 spec 用
// 自己的会话，命令写成：
//
//   APP_URL="http://127.0.0.1:30141/?session=<SESSION>" \
//     node scripts/struct-diff.mjs scripts/struct-specs/<file>.mjs
//
// SESSION 取一条**内容够全**的真实会话：1318 条消息，工具调用 / 思考 / 代码块 /
// markdown 全块 / 文件 chips 都在里面。
export const SESSION = "01a1072d-8cf2-70ad-a269-00c3f5ebf799";

/** 纯占位（flex 撑开）无视觉，比对时忽略。 */
export const IGNORE = ["d-grow"];
