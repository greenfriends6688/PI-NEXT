// 部件微画板 → 基线 PNG（design/v3/baseline/parts/<id>.png）。
// 与 v3-board-baseline.mjs 同一口径：deviceScaleFactor 1，只截 .part-stage。
import { chromium } from "playwright";
import { readdirSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();
const partDir = path.join(root, "design/v3/parts");
const outDir = path.join(root, "design/v3/baseline/parts");
mkdirSync(outDir, { recursive: true });

const filter = process.argv[2] ?? "";
const files = readdirSync(partDir).filter((f) => f.endsWith(".html") && f.includes(filter));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1400 }, deviceScaleFactor: 1 });
const errors = [];

for (const file of files) {
  page.removeAllListeners("pageerror");
  page.on("pageerror", (e) => errors.push(`${file}: ${e.message}`));
  await page.goto(pathToFileURL(path.join(partDir, file)).href, { waitUntil: "load" });
  await page.waitForTimeout(300);
  const stage = page.locator(".part-stage").first();
  if ((await stage.count()) === 0) {
    errors.push(`${file}: 没有 .part-stage`);
    continue;
  }
  await stage.screenshot({ path: path.join(outDir, file.replace(/\.html$/, ".png")), animations: "disabled" }).catch(async (e) => {
    errors.push(`${file}: 截不到（${e.message.split("\n")[0]}）`);
  });
  const box = await stage.boundingBox();
  console.log(`${file.replace(/\.html$/, "").padEnd(22)} ${box ? Math.round(box.width) + "×" + Math.round(box.height) : "不可见"}`);
}

await browser.close();
if (errors.length) {
  console.error("\n" + errors.join("\n"));
  process.exitCode = 1;
}
