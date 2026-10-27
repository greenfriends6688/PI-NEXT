// 一次跑完：每张画板的骨架（.win 的前两层 + 尺寸），用来挑微画板的根选择器。
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { readdirSync } from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "design/v3/boards");
const only = process.argv[2] ?? "";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

for (const file of readdirSync(dir).filter((f) => f.endsWith(".html") && f.includes(only))) {
  await page.goto(pathToFileURL(path.join(dir, file)).href, { waitUntil: "load" });
  await page.waitForTimeout(150);
  const out = await page.evaluate(() => {
    const root = document.querySelector(".win") ?? document.querySelector(".stage");
    if (!root) return "no .win";
    const lines = [];
    const walk = (el, depth) => {
      const cls = typeof el.className === "string" ? el.className.trim() : "";
      const b = el.getBoundingClientRect();
      lines.push(`${"  ".repeat(depth)}<${el.tagName.toLowerCase()}${cls ? "." + cls.split(/\s+/).join(".") : ""}> ${Math.round(b.width)}x${Math.round(b.height)}`);
      if (depth < 1) for (const c of el.children) walk(c, depth + 1);
    };
    walk(root, 0);
    return lines.join("\n");
  });
  console.log(`\n### ${file}\n${out}`);
}
await browser.close();
