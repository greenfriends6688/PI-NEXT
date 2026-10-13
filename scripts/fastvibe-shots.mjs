#!/usr/bin/env node
/**
 * fork:fastvibe-stack (H6) —— 「与 FastVibe 对照」的新验收通道。
 *
 * ## 它替代什么
 *
 * 用户 2026-10-13 裁定：「V5/V6 画板体系与门禁整套拆掉，验收完全换成 FastVibe 对照」。
 * 旧的 `verify:boards` 量的是「产品 vs 本仓画板」；从 H6 起那套真值作废，
 * 新的真值是 `fastvibe-main` 的源实现。本脚本就是新通道的**本仓那一半**：
 * 把标准视图按固定尺寸截出来，供与 FastVibe 逐张比对。
 *
 * ## 为什么只截本仓、不去启动 FastVibe
 *
 * FastVibe 是 Electron 应用（`pnpm dev` 要拉起整个 electron-vite 生态、
 * 一个主进程、还要一个 pi SDK 会话），在这个仓的 CI 里跑不起来也不该跑。
 * 所以本脚本的定位是：**产出可对照的稳定截图**，对照动作由人（或后续
 * 一个独立的、把两张图并排的工具）完成。这比假装能自动判「像不像」诚实 ——
 * 自动像素 diff 在两个不同技术栈的渲染上必然满屏差异，只会变成噪音门禁。
 *
 * 用法：
 *   node scripts/fastvibe-shots.mjs           # 全部视图
 *   node scripts/fastvibe-shots.mjs --only chat
 *   node scripts/fastvibe-shots.mjs --keep    # 留种子目录，打印怎么手跑
 *
 * 前置：仓库里要有**生产**构建（`npm run build` 或 `npm run prod`）。
 * 输出：`design/fastvibe-shots/<视图>-<宽>.png`（design/ 已在 .gitignore 外，
 * 截图是要提交的对照物，见该目录的 README）。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { launchChrome } from "./launch-chrome.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PORT = Number(process.env.FASTVIBE_SHOT_PORT ?? 32741);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = join(ROOT, "design/fastvibe-shots");
const KEEP = process.argv.includes("--keep");
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

/**
 * 标准视图清单。每一条 = 一个「与 FastVibe 有对应物」的界面。
 *
 * `fastvibe` 列是参考文件（人去比对时打开的那个）—— 写在这里是为了让
 * 「本仓这一张对应它的哪一张」有据可查，而不是靠记忆。
 * `sizes` 是视口：桌面按 1440×900（与 FastVibe 的开发窗口同档），
 * 窄屏按 390×844（iPhone 14 的逻辑尺寸，与它 Flutter 端的目标机型同档）。
 */
const VIEWS = [
  {
    id: "chat",
    label: "聊天 / 转录",
    fastvibe: "src/renderer/src/components/chat/message-list.tsx + message-row.tsx + composer.tsx",
    sizes: [[1440, 900], [390, 844]],
    // 种子里那两条会话之一在首屏就是选中的，直接截。
    async prepare(page) {
      await openSeededSession(page);
      await page.waitForSelector(".d-chat, .m-scroll", { timeout: 15000 }).catch(() => {});
    },
  },
  {
    id: "sidebar",
    label: "侧栏 / 会话列表",
    fastvibe: "src/renderer/src/components/layout/sidebar.tsx + sidebar-rows.tsx",
    sizes: [[1440, 900], [390, 844]],
    async prepare(page) {
      await page.waitForSelector(".d-side, .m-drawer", { timeout: 15000 }).catch(() => {});
    },
  },
  {
    id: "settings",
    label: "设置（弹窗）",
    fastvibe: "src/renderer/src/components/settings/settings-dialog.tsx",
    sizes: [[1440, 900]],
    async prepare(page) {
      // 设置是弹窗、不是路由（与 FastVibe 一致）。入口是侧栏底栏那一条
      // 「设置」行 —— 实测它的类名是 `.d-row.d-grow`（**不是** `.d-iconbtn`，
      // 那一类里只有「设置聊天目录…」，名字像但不是同一个东西）。
      // 窄屏下同一个入口在抽屉底栏（`.m-drawer-foot`），所以先开抽屉再点。
      if (await page.locator(".m-drawer").count()) {
        const opener = page.locator(".m-top-btn").first();
        if (await opener.count()) await opener.click().catch(() => {});
        await page.waitForTimeout(800);
      }
      const row = page.getByRole("button", { name: "设置", exact: true }).first();
      if (await row.count()) {
        await row.click().catch(() => {});
        await page.waitForTimeout(1500);
      }
    },
  },
  {
    id: "composer",
    label: "输入卡（含能力浮层）",
    fastvibe: "src/renderer/src/components/chat/composer.tsx",
    sizes: [[1440, 900]],
    async prepare(page) {
      await openSeededSession(page);
    },
  },
  {
    id: "right-panels",
    label: "右栏面板",
    fastvibe: "src/renderer/src/components/layout/side-pane*.tsx",
    sizes: [[1440, 900]],
    async prepare(page) {
      await openSeededSession(page);
      const button = page.getByRole("button", { name: /文件|Files/ }).first();
      if (await button.count()) {
        await button.click().catch(() => {});
        await page.waitForTimeout(1000);
      }
    },
  },
];

/* ---------------------------------------------------------------- 共有步骤 */

/**
 * 把种子会话打开。
 *
 * 两步而不是一步（实测出来的）：① 项目组默认是**折叠**的，会话行还没进 DOM，
 * 直接找 `.d-sess` 会扑空；② 展开后那一条会话还需要被点一下才会成为当前会话 ——
 * 首屏默认落在「新会话」空态，而空态量不到转录区（正文 / 工具行 / 折叠都看不到）。
 * 这两步是截图能不能用于对照的前提，不是锦上添花。
 */
async function openSeededSession(page) {
  await page.waitForTimeout(1500);
  for (const selector of [".fork-proj-title", ".d-group-title", ".m-trow"]) {
    const group = page.locator(selector).first();
    if (await group.count()) {
      await group.click().catch(() => {});
      await page.waitForTimeout(1200);
      break;
    }
  }
  const row = page.locator(".d-sess, .m-row").first();
  if (await row.count()) {
    await row.click().catch(() => {});
    await page.waitForTimeout(1800);
  }
}

/* ---------------------------------------------------------------- 种子数据 */
// 与 verify-boards-live.mjs 同一套精简夹具：一条有思考/工具/富文本正文的会话，
// 否则转录区量到的是空态。共用形状（而不是抽公共模块）是因为那个脚本还要
// 接着退役（它服务的是旧画板对位），抽出来会让两边都更难删。
const encodeCwd = (cwd) => `--${cwd.replace(/[^a-zA-Z0-9]/g, "-")}--`;
const hex = (n) => n.toString(16).padStart(8, "0");

function seedAgentDir() {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-fastvibe-shots-"));
  const workspace = join(agentDir, "workspace");
  mkdirSync(workspace, { recursive: true });
  writeFileSync(
    join(agentDir, "settings.json"),
    `${JSON.stringify({ defaultModel: "anthropic/claude-sonnet-4-5" }, null, 2)}\n`,
  );

  const dir = join(agentDir, "sessions", encodeCwd(workspace));
  mkdirSync(dir, { recursive: true });
  const id = "01a0f000-0000-7000-8000-00000000f001";
  const startedAt = "2026-10-13T02:00:00.000Z";
  const stamp = startedAt.replace(/[:.]/g, "-");

  const rich = [
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
    "行内码 `--right-panel-width`、粗体 **默认 320**。",
  ].join("\n");

  const lines = [
    { type: "session", version: 3, id, timestamp: startedAt, cwd: workspace },
    { type: "model_change", id: hex(1), parentId: null, provider: "anthropic", modelId: "claude-sonnet-4-5", timestamp: startedAt },
    { type: "message", id: hex(2), parentId: hex(1), timestamp: startedAt, message: { role: "user", content: "把右栏宽度的逻辑抽出来，顺便看看那段吸附" } },
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
          { type: "text", text: "先落到 `useResizablePanel`，调用点只剩三处。" },
          { type: "toolCall", id: "toolu_shot_fixture", name: "read", arguments: { path: "components/AppShell.tsx", limit: 120 } },
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
        toolCallId: "toolu_shot_fixture",
        toolName: "read",
        content: [{ type: "text", text: "  120→   const width = clamp(min, max, next);" }],
        isError: false,
      },
    },
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
        content: [{ type: "text", text: rich }],
      },
    },
    { type: "session_info", id: hex(6), parentId: hex(5), name: "右栏宽度抽成 hook" },
  ];
  writeFileSync(join(dir, `${stamp}_${id}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
  return agentDir;
}

/* ---------------------------------------------------------------- 起服 / 收摊 */
if (!existsSync(join(ROOT, ".next/BUILD_ID"))) {
  console.error("✗ 没有生产构建（.next/BUILD_ID 不存在）：先跑 `npm run build`。");
  process.exit(2);
}

const agentDir = seedAgentDir();
const log = [];
const server = spawn(
  process.execPath,
  [join(ROOT, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(PORT)],
  { cwd: ROOT, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir }, stdio: ["ignore", "pipe", "pipe"] },
);
server.stdout.on("data", (d) => log.push(String(d)));
server.stderr.on("data", (d) => log.push(String(d)));

function done(code) {
  if (!KEEP) {
    try { server.kill("SIGTERM"); } catch {}
    try { rmSync(agentDir, { recursive: true, force: true }); } catch {}
  } else {
    writeFileSync(join(agentDir, "server.log"), log.join(""));
    console.log(`\n--keep：\n  种子：${agentDir}\n  手跑：PI_CODING_AGENT_DIR=${agentDir} npx next start -H 127.0.0.1 -p ${PORT}`);
  }
  process.exit(code);
}

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/* ---------------------------------------------------------------- 主流程 */
const selected = only ? VIEWS.filter((v) => v.id.includes(only)) : VIEWS;
if (selected.length === 0) {
  console.error(`✗ --only ${only} 没有匹配的视图。可选：${VIEWS.map((v) => v.id).join(" / ")}`);
  done(2);
}

if (!(await waitForServer())) {
  console.error("✗ 服务没起来。最后几行日志：");
  console.error(log.join("").split("\n").slice(-12).join("\n"));
  done(2);
}

mkdirSync(OUT, { recursive: true });
const browser = await launchChrome();
const results = [];

for (const view of selected) {
  for (const [width, height] of view.sizes) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e.message)));
    try {
      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });
      // 首帧是桌面分支（`useIsMobile` 的 getServerSnapshot 恒 false），
      // hydrate 后才切窄屏 —— 等够，否则窄屏截到的是桌面版缩窄。
      await page.waitForTimeout(2500);
      if (view.prepare) await view.prepare(page);
      await page.waitForTimeout(800);
      const file = join(OUT, `${view.id}-${width}.png`);
      await page.screenshot({ path: file });
      results.push({ view: view.id, size: `${width}x${height}`, file, errors: errors.length });
    } catch (error) {
      results.push({ view: view.id, size: `${width}x${height}`, error: String(error).slice(0, 200) });
    } finally {
      await page.close();
    }
  }
}

await browser.close();

let failed = 0;
console.log(`\n与 FastVibe 对照 · 本仓截图（输出到 ${OUT}）\n`);
for (const r of results) {
  if (r.error) { failed += 1; console.log(`  ✗ ${r.view} @ ${r.size}  ${r.error}`); }
  else console.log(`  ✓ ${r.view} @ ${r.size} → ${r.file.replace(`${ROOT}/`, "")}${r.errors ? ` (${r.errors} console 报错)` : ""}`);
}
const viewById = new Map(selected.map((v) => [v.id, v]));
console.log("\n对照时打开 FastVibe 的：");
for (const r of results) {
  const v = viewById.get(r.view);
  if (v && !r.error) console.log(`  ${r.view.padEnd(14)} → fastvibe-main/${v.fastvibe}`);
}
done(failed ? 1 : 0);
