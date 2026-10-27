import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.goto(`http://127.0.0.1:30141/?session=${process.argv[2]}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
// 手机顶栏里最右那颗是文件面板开关
await page.locator('button[aria-controls="file-panel"]').first().click({ force: true }).catch(() => {});
await page.waitForTimeout(1200);
await page.screenshot({ path: ".shots/mobile-sheet.png" });
const info = await page.evaluate(() => {
  const p = document.querySelector(".right-panel-container");
  if (!p) return null;
  const r = p.getBoundingClientRect();
  const cs = getComputedStyle(p);
  return { w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y), radius: cs.borderRadius, open: p.className.includes("open") };
});
console.log(JSON.stringify(info));
await browser.close();
