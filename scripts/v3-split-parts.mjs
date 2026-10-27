// design/v3 的整屏画板 → 部件微画板。
//
// 抄 AcpAgentClient 的做法（画板 11–34）：一个部件一张板、一张 PNG，
// 每次只做一块、只验一块。部件 HTML 由整屏画板的真实 DOM 切下来，不手抄，
// 所以画板一改，重跑这个脚本，部件跟着改。
//
//   node scripts/v3-split-parts.mjs            # 切全部部件
//   node scripts/v3-split-parts.mjs bubble     # 只切名字含该串的
//
// 产物：design/v3/parts/<id>.html + design/v3/PARTS.md（索引，跟着脚本走）
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = process.cwd();
const BOARD_DIR = path.join(ROOT, "design/v3/boards");
const PART_DIR = path.join(ROOT, "design/v3/parts");
mkdirSync(PART_DIR, { recursive: true });

// id · 画板 · 选择器 · 第几个 · 标题
const PARTS = [
  ["01-chrome", "web-running", ".chrome", 0, "会话头 chrome"],
  ["02-side-tools", "web-running", ".side__tools", 0, "侧栏工具行"],
  ["03-side-list", "web-running", ".side__list", 0, "侧栏列表（分区头 + 会话行）"],
  ["04-side-foot", "web-running", ".side__foot", 0, "侧栏页脚"],
  ["05-rail", "web-running", ".rail", 0, "左缘 minimap"],
  ["06-bubble", "web-running", ".bubble-row", 0, "用户气泡"],
  ["07-prose", "web-running", ".prose", 0, "助手正文"],
  ["08-group-head", "web-running", ".grp-head", 0, "折叠头 · 展开"],
  ["09-group-head-closed", "web-running", ".grp-head.is-closed", 0, "折叠头 · 收起"],
  ["10-steps", "web-running", ".steps", 0, "步骤树"],
  ["11-step-live", "web-running", ".step.is-live", 0, "单步 · 运行中"],
  ["12-status", "web-running", ".status", 0, "状态行"],
  ["13-filecard", "web-running", ".filecard", 0, "文件卡"],
  ["14-earlier", "web-running", ".earlier", 0, "更早的消息"],
  ["15-turn", "web-running", ".turn", 1, "完整回合"],
  ["16-composer", "web-running", ".composer", 0, "输入胶囊"],
  ["17-composer-area", "web-running", ".composer-area", 0, "输入区（含变更条）"],
  ["18-diff", "web-changes", ".diff-pop", 0, "变更浮层"],
  ["19-filetree", "web-files", ".filetree", 0, "文件树"],
  ["20-viewer", "web-files", ".viewer", 0, "文件查看器"],
  ["21-terminal", "web-terminal", ".term", 0, "终端面板"],
  ["22-agent-panel", "web-subagents", ".agent-panel", 0, "子代理面板"],
  ["23-search", "web-search", ".search-panel", 0, "会话搜索"],
  ["24-palette", "web-palette", ".search-panel", 0, "命令面板"],
  ["25-menu", "web-menu-session", ".menu", 0, "会话菜单"],
  ["26-toast", "web-menu-session", ".toast", 0, "提示条"],
  ["27-settings", "web-settings-mcp", ".settings-modal", 0, "设置弹窗"],
  ["28-login", "web-login", ".login-pane", 0, "登录页"],
  ["29-approval", "web-approval", ".composer-wrap", 0, "输入区 · 授权态"],
  ["30-question", "web-question", ".composer-wrap", 0, "输入区 · 提问态"],
  ["31-attachments", "web-attachments", ".composer-wrap", 0, "输入区 · 附件态"],
  // ---- PWA（手机）：390 宽，一套自己的布局分支
  ["32-m-top", "pwa-running", ".m-top", 0, "手机 · 顶栏"],
  ["33-m-thread", "pwa-running", ".m-thread", 0, "手机 · 会话流"],
  ["34-m-composer-area", "pwa-running", ".m-composer-area", 0, "手机 · 输入区"],
  ["35-m-home", "pwa-running", ".m-home", 0, "手机 · 底部条"],
  ["36-m-sheet-files", "pwa-files", ".m-sheet", 0, "手机 · 文件抽屉"],
  ["37-m-sheet-changes", "pwa-changes", ".m-sheet", 0, "手机 · 变更抽屉"],
  ["38-sheet-menu", "pwa-menu", ".sheet-menu", 0, "手机 · 动作面板"],
  ["39-m-drawer-sessions", "pwa-sessions", ".m-drawer", 0, "手机 · 会话抽屉"],
  ["40-m-sheet-model", "pwa-model", ".m-sheet", 0, "手机 · 模型选择"],
  ["41-statusbar", "pwa-running", ".statusbar", 0, "手机 · 状态条"],
  ["42-pwa-file", "pwa-file", ".m-sheet", 0, "手机 · 文件页"],
  ["43-pwa-settings", "pwa-settings", ".m-sheet", 0, "手机 · 设置页"],
  ["44-pwa-search", "pwa-search", ".m-sheet", 0, "手机 · 搜索页"],
  ["45-pwa-new", "pwa-new", ".phone", 0, "手机 · 新会话"],
  ["46-pwa-welcome", "pwa-welcome", ".phone", 0, "手机 · 欢迎页"],
  ["47-pwa-login", "pwa-login", ".phone", 0, "手机 · 登录页"],
];

const filter = process.argv[2] ?? "";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });

const written = [];
const missing = [];

for (const [id, board, sel, index, title] of PARTS) {
  if (filter && !id.includes(filter) && !board.includes(filter)) continue;
  await page.goto(pathToFileURL(path.join(BOARD_DIR, board + ".html")).href, { waitUntil: "load" });
  await page.waitForTimeout(120);
  const cut = await page.evaluate(({ sel, index, title }) => {
    const el = document.querySelectorAll(sel)[index];
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { html: el.outerHTML, w: Math.round(b.width), h: Math.round(b.height), title };
  }, { sel, index, title });
  if (!cut) {
    missing.push(`${id} ← ${board} ${sel}[${index}]`);
    continue;
  }
  const doc = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>部件 · ${title}</title>
<!-- 由 scripts/v3-split-parts.mjs 从 design/v3/boards/${board}.html 切出，不要手改。 -->
<link rel="stylesheet" href="../assets/running.css">
<script src="../assets/running.js" defer></script>
<style>
  /* 微画板外壳：只裁出这一块，不是设计的一部分 */
  body.part-board { margin: 0; min-height: 100vh; background: var(--desk);
    display: grid; place-items: start center; padding: 28px; }
  .part-label { font: 500 11px/1.9 ui-sans-serif, system-ui; color: var(--ink-3);
    letter-spacing: .04em; margin: 0 0 8px; }
  .part-stage { position: relative; }
</style>
</head>
<body class="part-board">
  <div>
    <p class="part-label">${id} · ${title} · ${board} ${sel}</p>
    <div class="part-stage" style="width:${cut.w + 12}px;height:${cut.h}px">
${cut.html}
    </div>
  </div>
</body>
</html>
`;
  writeFileSync(path.join(PART_DIR, id + ".html"), doc, "utf8");
  written.push({ id, board, sel, title, w: cut.w, h: cut.h });
  console.log(`${id.padEnd(22)} ${String(cut.w).padStart(5)}×${String(cut.h).padEnd(5)} ${title}`);
}

await browser.close();

if (written.length) {
  const rows = written
    .map((p) => `| [${p.id}](${p.id}.html) | ${p.title} | \`${p.board}\` \`${p.sel}\` | ${p.w}×${p.h} |`)
    .join("\n");
  writeFileSync(
    path.join(ROOT, "design/v3/PARTS.md"),
    `# 部件微画板索引

> 由 \`node scripts/v3-split-parts.mjs\` 从整屏画板切出（\`design/v3/parts/<id>.html\`），
> 基线 PNG 在 \`design/v3/baseline/parts/<id>.png\`（\`node scripts/v3-part-baseline.mjs\`）。
> 一个部件 = 一次能做完、能对着 PNG 验的一块。**不要手改 parts/ 下的 HTML**，改画板再重切。

| 部件 | 名称 | 来源 | 尺寸 |
|---|---|---|---|
${rows}
`,
    "utf8"
  );
}

if (missing.length) {
  console.error("\n没切到（选择器在画板里不存在）：\n" + missing.join("\n"));
  process.exitCode = 1;
}
