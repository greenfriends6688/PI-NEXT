// 诊断壁纸为何被遮：列出 .app-shell 到 .composer 祖先链上每层的 computed background。
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(process.env.APP_URL || "http://127.0.0.1:30141/", { waitUntil: "load", timeout: 120000 });
await page.waitForTimeout(2000);

const report = await page.evaluate(() => {
  const rows = [];
  const shell = document.querySelector(".app-shell");
  if (!shell) return ["no .app-shell"];
  rows.push([".app-shell classes", shell.className]);
  const before = getComputedStyle(shell, "::before");
  rows.push(["shell::before bg", before.background.slice(0, 120) || before.backgroundColor]);
  rows.push(["shell::before z", before.zIndex]);
  // 祖先链采样：shell 直系两层 + main + sidebar
  const main = document.querySelector(".app-main");
  if (main) {
    const cs = getComputedStyle(main);
    rows.push([".app-main bg", cs.backgroundColor, "classes:", main.className.slice(0, 80)]);
  }
  const side = document.querySelector(".app-sidebar");
  if (side) {
    const cs = getComputedStyle(side);
    rows.push([".app-sidebar bg", cs.backgroundColor]);
    const ss = side.querySelector(".session-sidebar");
    if (ss) rows.push([".session-sidebar bg", getComputedStyle(ss).backgroundColor]);
    const lights = side.querySelector(".lights");
    rows.push([".lights count", lights ? lights.children.length : "MISSING"]);
  }
  // 找出 main 里面第一个不透明的块
  if (main) {
    const all = main.querySelectorAll("*");
    const seen = new Set();
    for (let i = 0; i < Math.min(all.length, 400); i++) {
      const el = all[i];
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && !bg.startsWith("rgba(0, 0, 0, 0)") && bg !== "transparent") {
        const key = `${el.tagName}.${String(el.className).slice(0, 40)} -> ${bg}`;
        if (!seen.has(key)) { seen.add(key); rows.push(["opaque-node", key]); }
        if (seen.size > 8) break;
      }
    }
  }
  return rows.map((r) => r.join(" | "));
});

console.log(report.join("\n"));
await browser.close();
