import { chromium } from "playwright";
const id = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.goto(`http://127.0.0.1:30141/?session=${id}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
// 点会话头里的子代理钮（person-2 那颗）
const btn = page.locator(".ccap .cbtn").nth(2);
await btn.click({ force: true }).catch(() => {});
await page.waitForTimeout(1200);
await page.screenshot({ path: ".shots/agents.png" });
const info = await page.evaluate(() => {
  const p = document.querySelector(".agent-panel");
  const r = p ? p.getBoundingClientRect() : null;
  return { panel: r ? { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) } : null,
    radius: p ? getComputedStyle(p).borderRadius : null, bg: p ? getComputedStyle(p).backgroundColor : null };
});
console.log(JSON.stringify(info));
await browser.close();
