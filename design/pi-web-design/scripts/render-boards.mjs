// 用 Playwright + 本机 Chrome 把画板渲染成 PNG（设计稿回归用）
// 用法：node scripts/render-boards.mjs [输出目录] [文件...]
import { chromium } from "playwright";
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(here, "..");
const OUT = process.argv[2] || "/tmp/pw-boards";
const files = process.argv.slice(3);
const targets = files.length
  ? files
  : readdirSync(DIR).filter((f) => f.endsWith(".html")).sort();

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 }, deviceScaleFactor: 1 });

for (const f of targets) {
  const url = pathToFileURL(join(DIR, f)).href;
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(600);
  const name = f.replace(/\.html$/, "");
  await page.screenshot({ path: join(OUT, name + ".png"), fullPage: true });
  console.log("rendered", name);
}

await browser.close();
