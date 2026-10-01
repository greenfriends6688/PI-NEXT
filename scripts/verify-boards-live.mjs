// 自带种子的 live 对位：建一份临时 agent 目录（画板对位要的确定性会话数据）→
// 起一个 next start（`PI_CODING_AGENT_DIR` 指向它）→ 跑 board-diff-all → 收摊。
//
// 为什么要种子：`scripts/board-specs/` 里大多数画板（侧栏会话行、转录卡片、输入框
// 弹层）都要产品**开着一条有消息的会话**才量得到。此前只有设置页能确定性打开，
// 于是 30 张画板里只有 10 张有 spec。种子走 SDK 自己的 `PI_CODING_AGENT_DIR`
// （`@earendil-works/pi-coding-agent/dist/config.js:421`），不碰用户真实数据。
//
// 用法：
//   node scripts/verify-boards-live.mjs            # 全量
//   node scripts/verify-boards-live.mjs --only 20  # 只跑匹配的 spec
//   node scripts/verify-boards-live.mjs --keep     # 留着种子目录与日志，打印怎么手跑
//
// 前置：仓库里要有**生产**构建（`npm run prod` 或 `npm run build`）；dev 缓存不能
// 拿来 `next start`（见 AGENTS.md 的 dev/生产共用 .next 说明）。
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PORT = Number(process.env.BOARD_DIFF_PORT ?? 32141);
const BASE = `http://127.0.0.1:${PORT}`;
const KEEP = process.argv.includes("--keep");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

if (!existsSync(join(ROOT, ".next/BUILD_ID"))) {
  console.error("✗ 没有生产构建（.next/BUILD_ID 不存在）：先跑 `npm run prod`（它要起服）或 `npm run build`。");
  process.exit(2);
}

/* ---------------------------------------------------------------- 种子数据 */
// 目录编码与 pi 一致：非 [a-zA-Z0-9] 全变 `-`，两侧包 `--`
// （例：/Users/me/proj → --Users-me-proj--）。列表扫描不依赖它，但工作区分组看 cwd。
const encodeCwd = (cwd) => `--${cwd.replace(/[^a-zA-Z0-9]/g, "-")}--`;
const hex = (n) => n.toString(16).padStart(8, "0");

function seedAgentDir() {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-board-fixtures-"));
  const workspace = join(agentDir, "workspace");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify({ defaultModel: "anthropic/claude-sonnet-4-5" }, null, 2)}\n`,
  );

  /** 一条会话：用户消息 + 思考 + 正文 + 工具调用 + 工具结果 + 最终回答。 */
  function writeSession({ id, startedAt, title, body, finalBody }) {
    const dir = join(agentDir, "sessions", encodeCwd(workspace));
    mkdirSync(dir, { recursive: true });
    const stamp = startedAt.replace(/[:.]/g, "-");
    const file = join(dir, `${stamp}_${id}.jsonl`);

    const lines = [
      { type: "session", version: 3, id, timestamp: startedAt, cwd: workspace },
      {
        type: "model_change",
        id: hex(1),
        parentId: null,
        provider: "anthropic",
        modelId: "claude-sonnet-4-5",
        timestamp: startedAt,
      },
      {
        type: "message",
        id: hex(2),
        parentId: hex(1),
        timestamp: startedAt,
        message: { role: "user", content: title },
      },
      {
        type: "message",
        id: hex(3),
        parentId: hex(2),
        timestamp: startedAt,
        message: {
          role: "assistant",
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          stopReason: "end_turn",
          content: [
            { type: "thinking", thinking: "先看那段宽度逻辑落在哪一层，再决定抽成什么形状。" },
            { type: "text", text: body },
            {
              type: "toolCall",
              id: "toolu_board_fixture",
              name: "read",
              arguments: { path: "components/AppShell.tsx", limit: 120 },
            },
          ],
        },
      },
      {
        type: "message",
        id: hex(4),
        parentId: hex(3),
        timestamp: startedAt,
        message: {
          role: "toolResult",
          toolCallId: "toolu_board_fixture",
          toolName: "read",
          content: [{ type: "text", text: "  120→   const width = clamp(min, max, next);" }],
          isError: false,
        },
      },
      // 回合的**最终回答**：工具跑完后再来一段助手文本。缺了它，整段正文会被折进
      // 过程块（画板 08 的折叠规则），转录里就只剩思考 + 工具行 —— 于是所有
      // 富文本类（表格 / 任务清单 / 引用 / 代码卡）都量不到。
      {
        type: "message",
        id: hex(5),
        parentId: hex(4),
        timestamp: startedAt,
        message: {
          role: "assistant",
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          stopReason: "end_turn",
          content: [{ type: "text", text: finalBody }],
        },
      },
      {
        type: "session_info",
        id: hex(6),
        parentId: hex(5),
        name: "右栏宽度抽成 hook",
      },
    ];
    writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
    return file;
  }

  const day = "2026-09-30T";
  const richFinal = [
    "## 抽完之后的形状",
    "",
    "调用点只剩三处：",
    "",
    "1. `AppShell` 的把手",
    "2. 存档恢复",
    "3. 窄屏折叠",
    "",
    "- [ ] 把 clamp 抽出去",
    "- [x] 把手保持双绑",
    "",
    "| 档位 | 宽度 | 备注 |",
    "|---|---|---|",
    "| 面板 | 320 | 默认 |",
    "| 窄屏 | 全宽 | <900 |",
    "",
    "> 引用块也要跟着走。",
    "",
    "```ts",
    "const width = clamp(min, max, next);",
    "```",
    "",
    "行内码 `--right-panel-width`、粗体 **默认 320**、链接 [画板](design/pi-web-design/30-files-panel.html) 各一份。",
  ].join("\n");
  writeSession({
    id: "01a0f000-0000-7000-8000-00000000b0a1",
    startedAt: `${day}09:12:00.000Z`,
    title: "把右栏宽度的逻辑抽出来，顺便看看 @AppShell.tsx 里那段吸附",
    body: "先落到 `useResizablePanel`，调用点只剩三处：\n\n1. `AppShell` 的把手\n2. 存档恢复\n3. 窄屏折叠\n\n```ts\nconst width = clamp(min, max, next);\n```",
    finalBody: richFinal,
  });
  writeSession({
    id: "01a0f000-0000-7000-8000-00000000b0a2",
    startedAt: `${day}08:40:00.000Z`,
    title: "会话列表的空态文案改成两句",
    body: "空态文案已按画板 01 改成标题 + 一行说明。",
    finalBody: "空态已改：标题一行、说明一行，不再用大段说明。\n\n- [x] 文案收敛\n- [ ] 截图复核",
  });
  return agentDir;
}

/* ---------------------------------------------------------------- 起服 / 收摊 */
const agentDir = seedAgentDir();
const logPath = join(agentDir, "server.log");
const log = [];
const server = spawn(
  process.execPath,
  [join(ROOT, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(PORT)],
  { cwd: ROOT, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, stdio: ["ignore", "pipe", "pipe"] },
);
server.stdout.on("data", (d) => log.push(String(d)));
server.stderr.on("data", (d) => log.push(String(d)));

const done = (code) => {
  // `--keep`：服务**不杀**，留着手工探 DOM / 截图（种子目录与日志也留着）。
  if (!KEEP) { try { server.kill("SIGTERM"); } catch {} }
  if (KEEP) {
    writeFileSync(logPath, log.join(""));
    console.log(`\n种子目录与日志留着（--keep）：\n  种子：${agentDir}\n  日志：${logPath}\n  手跑：PI_CODING_AGENT_DIR=${agentDir} npx next start -H 127.0.0.1 -p ${PORT}`);
  } else {
    try { rmSync(agentDir, { recursive: true, force: true }); } catch {}
  }
  process.exit(code);
};

const ready = async () => {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
};

if (!(await ready())) {
  console.error(`✗ 种服务在 ${BASE} 起不来。日志：\n${log.join("")}`);
  done(2);
}

// 种子里到底有没有会话 —— 空的话说明对位会全报「产品里没有」，先挡住这个假阴性。
const sessions = await (await fetch(`${BASE}/api/sessions`)).json().catch(() => null);
const count = Array.isArray(sessions) ? sessions.length : (sessions?.sessions?.length ?? 0);
console.log(`种子就绪：${BASE}（${count} 条会话，agentDir=${agentDir}）`);
if (!count) {
  console.error("✗ 种子里的会话没被列出来：对位会全报缺失，先修种子。");
  done(2);
}

const res = spawnSync(
  process.execPath,
  [join(HERE, "board-diff-all.mjs"), ...(only ? ["--only", only] : [])],
  { cwd: ROOT, stdio: "inherit", env: { ...process.env, APP_URL: BASE } },
);
done(res.status ?? 1);
