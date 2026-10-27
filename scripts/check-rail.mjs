import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:30141/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);
await page.goto(`http://127.0.0.1:30141/?session=${process.argv[2]}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const info = await page.evaluate(() => {
  const ticks = document.querySelectorAll(".tick");
  const first = ticks[0];
  const r = first ? first.getBoundingClientRect() : null;
  return {
    ticks: ticks.length,
    now: document.querySelectorAll(".tick.is-now").length,
    first: r ? { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) } : null,
    rail: !!document.querySelector(".rail"),
    minimap: !!document.querySelector("[data-minimap-node-index]"),
  };
});
console.log(JSON.stringify(info));
await browser.close();
