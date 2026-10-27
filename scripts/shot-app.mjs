// 一张产品截图（默认 1440×900）+ 关键几何读数。
//   node scripts/shot-app.mjs <sessionId> [out.png] [width] [height]
import { chromium } from "playwright";

const [id, out = ".shots/app-1440.png", width = "1440", height = "900"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 1 });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message.slice(0, 160)));
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: out });
const m = await page.evaluate(() => {
  const r = (s) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
  return { side: r(".app-sidebar"), prose: r(".prose"), steps: r(".steps"), step: r(".step"), composer: r(".composer"), grpHead: r(".grp-head"), status: r(".status") };
});
console.log(JSON.stringify({ ...m, errors: errs.slice(0, 4) }));
await browser.close();
