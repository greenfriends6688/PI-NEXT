import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:30141/login", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.screenshot({ path: ".shots/login.png" });
const info = await page.evaluate(() => {
  const card = document.querySelector(".login-card");
  const main = document.querySelector(".login-pane");
  const r = (e) => (e ? { w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) } : null);
  return { card: r(card), main: r(main), radius: card ? getComputedStyle(card).borderRadius : null };
});
console.log(JSON.stringify(info));
await browser.close();
