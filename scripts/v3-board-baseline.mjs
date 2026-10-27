// design/v3 画板 → 验收基准 PNG。
// 对应 AcpAgentClient 的 scripts/render-design.ps1：每张画板入库一张确定性快照，
// 之后「实现对不对」对着 PNG 比，而不是对着活画布或人眼记忆。
//   node scripts/v3-board-baseline.mjs            # 全部 47 张
//   node scripts/v3-board-baseline.mjs web-file   # 只渲名字含该串的
import { chromium } from "playwright";
import { readdirSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();
const boardDir = path.join(root, "design/v3/boards");
const outDir = path.join(root, "design/v3/baseline");
mkdirSync(outDir, { recursive: true });

const filter = process.argv[2] ?? "";
const boards = readdirSync(boardDir).filter((f) => f.endsWith(".html") && f.includes(filter));

const browser = await chromium.launch();
// 1600 宽保证 running.js 的 fit 缩放算到 1（它按 available/1440 收，上限 1）。
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
const errors = [];

for (const file of boards) {
  const url = pathToFileURL(path.join(boardDir, file)).href;
  page.removeAllListeners("pageerror");
  page.on("pageerror", (e) => errors.push(`${file}: ${e.message}`));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(350); // 精灵注入 + 字体落位
  const stage = page.locator(".stage").first();
  if ((await stage.count()) === 0) {
    errors.push(`${file}: 没有 .stage`);
    continue;
  }
  const out = path.join(outDir, file.replace(/\.html$/, ".png"));
  await stage.screenshot({ path: out });
  const box = await stage.boundingBox();
  console.log(`${file}  ${Math.round(box.width)}×${Math.round(box.height)}`);
}

await browser.close();
if (errors.length) {
  console.error("\n" + errors.join("\n"));
  process.exitCode = 1;
}
