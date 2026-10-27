// 截产品 1440×900，与 design/v3/baseline/web-running.png 拼一张并排对比图。
//   node scripts/v3-shot-compare.mjs [board-name]   # 默认 web-running
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const root = process.cwd();
const name = process.argv[2] ?? "web-running";
const APP_URL = process.env.APP_URL || "http://127.0.0.1:30141";
const outDir = path.join(root, "preview-shots/v3-compare");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(`product: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

await page.goto(APP_URL, { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(2500); // dev 编译 + 渲染落位
const appShot = path.join(outDir, `app-${name}.png`);
await page.screenshot({ path: appShot });
await browser.close();

// 拼：左画板基线 / 右产品，等高缩放
const { createCanvas, loadImage } = await import("canvas").catch(() => ({}));
let side = "";
if (createCanvas) {
  const base = path.join(root, `design/v3/baseline/${name}.png`);
  if (existsSync(base)) {
    const [bImg, aImg] = await Promise.all([loadImage(base), loadImage(appShot)]);
    const H = 640;
    const bw = Math.round((bImg.width / bImg.height) * H);
    const aw = Math.round((aImg.width / aImg.height) * H);
    const canvas = createCanvas(bw + aw + 24, H + 16);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bImg, 8, 8, bw, H);
    ctx.drawImage(aImg, bw + 16, 8, aw, H);
    side = path.join(outDir, `compare-${name}.png`);
    writeFileSync(side, canvas.toBuffer("image/png"));
  }
}

console.log(JSON.stringify({ app: appShot, compare: side, errors }, null, 2));
