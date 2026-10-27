import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.goto(`http://127.0.0.1:30141/?session=${process.argv[2]}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
await page.locator(".app-mobile-toolbar").first().locator("xpath=preceding-sibling::button[1]").click({ force: true }).catch(() => {});
await page.waitForTimeout(900);
await page.screenshot({ path: ".shots/mobile-drawer.png" });
const info = await page.evaluate(() => {
  const s = document.querySelector(".app-sidebar").getBoundingClientRect();
  return { w: Math.round(s.width), h: Math.round(s.height), x: Math.round(s.x), y: Math.round(s.y) };
});
console.log(JSON.stringify(info));
await browser.close();
