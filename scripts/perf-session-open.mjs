#!/usr/bin/env node
/**
 * fork:perf-session-open —— 「打开一个会话要多久、多少字节」的可复算读数。
 *
 * 为什么要有这个脚本：P3（打开对话速度）改的是**线上载荷**，而载荷大小只在
 * 真实的 `~/.pi/agent/sessions` 上量得出来 —— 仓库里那 4051 条单测一个都不测它的
 * 体积。没有这条脚本，下一次改动是变快还是变慢没人知道（AGENTS.md 里
 * 「一方扩展的注册 ≠ 模型看得见」讲的就是同一件事：静态门禁抓不住运行时事实）。
 *
 * 用法：
 *   npm run perf:session                 # 对当前运行中的服务（默认 127.0.0.1:30141）
 *   PORT=30141 npm run perf:session
 *   npm run perf:session -- --full       # 顺带打每条 message 的占用 Top 5
 *
 * 它**只读** `/api/sessions` 与 `/api/sessions/[id]`，不写任何东西。
 * 指标就是客户端真正收到的那几个数：字节数 + 服务端耗时，按会话大小分档
 * （最大 / 中位 / 最小），所以「一条异常会话」不会淹掉整张表。
 */

const PORT = process.env.PORT || "30141";
const BASE = `http://127.0.0.1:${PORT}`;
const FULL = process.argv.includes("--full");

/** 客户端真正发的那组参数（hooks/useAgentSession.ts 的加载请求）。 */
const CLIENT_QUERY = "deferThinking=1&deferMedia=1&tree=summary";

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function timed(url) {
  const started = performance.now();
  const response = await fetch(url);
  const text = await response.text();
  const ms = performance.now() - started;
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return { ms, bytes: Buffer.byteLength(text), text };
}

async function main() {
  let list;
  try {
    list = await timed(`${BASE}/api/sessions`);
  } catch (error) {
    console.error(`× 连不上 ${BASE} —— 先把应用起起来（npm run prod），或设 PORT=…`);
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  const parsed = JSON.parse(list.text);
  const sessions = parsed.sessions ?? parsed;
  console.log(`服务 ${BASE} · 会话 ${sessions.length} 个\n`);
  console.log(`GET /api/sessions                ${kb(list.bytes).padStart(10)}  ${list.ms.toFixed(0)} ms`);

  /* 分档按 `messageCount`（列表本来就带它）。**不要按 id 排**：id 是时间戳前缀，
     那样分出来的是「最新 / 中间 / 最早」，与「大 / 中 / 小」不是一回事 ——
     第一版就是这么写的，标签与事实对不上。 */
  const sorted = [...sessions].sort((a, b) => (a.messageCount ?? 0) - (b.messageCount ?? 0));
  const picks = [
    ["消息最多", sorted[sorted.length - 1]],
    ["中位", sorted[Math.floor(sorted.length / 2)]],
    ["消息最少", sorted[0]],
  ].filter(([, session]) => session);

  console.log("");
  for (const [label, session] of picks) {
    const url = `${BASE}/api/sessions/${session.id}?${CLIENT_QUERY}`;
    let cold;
    try {
      cold = await timed(url);
    } catch (error) {
      console.log(`${label}  ${session.id.slice(0, 8)}  读取失败: ${error instanceof Error ? error.message : error}`);
      continue;
    }
    const hot = await timed(url);
    const body = JSON.parse(cold.text);
    const context = body.context ?? {};
    const messages = context.messages ?? [];
    const messageBytes = messages.reduce((sum, message) => sum + JSON.stringify(message).length, 0);
    const biggest = messages
      .map((message) => JSON.stringify(message).length)
      .sort((a, b) => b - a)
      .slice(0, 1)[0] ?? 0;

    console.log(
      `${label}  ${session.id.slice(0, 8)}  ${kb(cold.bytes).padStart(10)}  冷 ${cold.ms.toFixed(0)} ms / 热 ${hot.ms.toFixed(0)} ms`
      + `  · 消息 ${messages.length} 条 ${kb(messageBytes)}`
      + `  · 最大一条 ${kb(biggest)}${messages.length ? ` (${(100 * biggest / (messageBytes || 1)).toFixed(0)}%)` : ""}`,
    );

    if (FULL && messages.length) {
      const rows = messages
        .map((message, index) => ({ index, len: JSON.stringify(message).length, role: message.role }))
        .sort((a, b) => b.len - a.len)
        .slice(0, 5);
      for (const row of rows) console.log(`      #${String(row.index).padStart(4)}  ${row.role.padEnd(12)} ${kb(row.len)}`);
    }
  }

  console.log("\n读数怎么用：");
  console.log("  · 列表那一行是侧栏每次刷新都要付的；");
  console.log("  · 「最大一条」占消息总量的比例高，说明慢的是**某一条超大消息**（粘贴的长文本 /");
  console.log("    巨型工具输出），不是会话本身 —— 那种要靠按需加载，不是靠缩小列表。");
}

await main();
