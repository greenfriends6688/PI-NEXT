import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.goto(`http://127.0.0.1:30141/?session=${process.argv[2]}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
await page.locator(".composer .chip").first().click({ force: true }).catch(() => {});
await page.waitForTimeout(900);
await page.screenshot({ path: ".shots/mobile-model.png" });
const info = await page.evaluate(() => {
  const p = document.querySelector('[role="listbox"]');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y), radius: getComputedStyle(p).borderRadius, bottom: Math.round(r.bottom) };
});
console.log(JSON.stringify(info));
await browser.close();
